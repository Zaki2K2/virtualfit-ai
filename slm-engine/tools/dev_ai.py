"""Start the existing workspaces plus one verified local CPU SLM. No installs/restarts."""
import json
import os
from pathlib import Path
import signal
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

from runtime import CONFIG, ROOT, lifecycle_log, local_open


def port_open(port):
    with socket.socket() as connection:
        connection.settimeout(.3)
        return connection.connect_ex(('127.0.0.1', port)) == 0


def local_json(port, path, body=None, timeout=3):
    headers = {'Content-Type': 'application/json'}
    if port == 8081:
        key = (ROOT / 'runtime/api-key.txt').read_text().strip()
        headers['Authorization'] = 'Bearer ' + key
    request = urllib.request.Request(f'http://127.0.0.1:{port}{path}',
        data=json.dumps(body).encode() if body is not None else None, headers=headers)
    with local_open(request, timeout=timeout) as response:
        payload = response.read(32_769)
        if len(payload) > 32_768: raise ValueError('Oversized local readiness response')
        return json.loads(payload)


def verify_slm():
    health = local_json(8081, '/health')
    if not isinstance(health, dict) or health.get('status') != 'ok': raise RuntimeError('Qwen health is not ready')
    models = local_json(8081, '/v1/models')
    if not isinstance(models, dict) or not isinstance(models.get('data'), list) or not any(isinstance(m, dict) and m.get('id') == CONFIG['alias'] for m in models['data']):
        raise RuntimeError('8081 is serving a different model; refusing to reuse it')
    result = local_json(8081, '/v1/chat/completions', {
        'model': CONFIG['alias'], 'messages': [{'role': 'user', 'content': 'Reply READY.'}],
        'max_tokens': 4, 'temperature': 0, 'stream': False}, timeout=60)
    if not isinstance(result, dict): raise RuntimeError('Invalid Qwen generation response')
    choices = result.get('choices') or []
    if result.get('model') != CONFIG['alias'] or not choices or not choices[0].get('message', {}).get('content', '').strip() or result.get('usage', {}).get('completion_tokens', 0) < 1:
        raise RuntimeError('8081 accepted a connection but failed actual Qwen generation')


def wait_until(check, owned, stopped, timeout, label):
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline and not stopped:
        for name, process in owned:
            if process.poll() is not None:
                raise RuntimeError(f'{name} exited during startup with code {process.returncode}; see its logs above')
        try:
            if check(): return
        except (OSError, ValueError, KeyError, AssertionError) as exc:
            last_error = type(exc).__name__
        time.sleep(.25)
    if stopped: return
    raise RuntimeError(f'Timed out waiting for {label} ({last_error or "not ready"}). No restart attempted.')


def stop_owned(owned, intentional, grace=12):
    """Console Ctrl+C reaches every owned child. Never stop a reused SLM."""
    if intentional:
        if os.name != 'nt':
            for _, process in owned:
                if process.poll() is None: os.killpg(process.pid, signal.SIGINT)
        deadline = time.monotonic() + grace
        while any(p.poll() is None for _, p in owned) and time.monotonic() < deadline:
            time.sleep(.1)
    forced = False
    for name, process in reversed(owned):
        if process.poll() is not None: continue
        forced = True
        lifecycle_log('dev_ai_stopping_owned_tree', service=name, pid=process.pid,
                      reason='shutdown grace expired' if intentional else 'startup/service failure')
        if os.name == 'nt':
            # Static executable/flags and a PID created by this launcher only.
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True, timeout=10)
        else:
            os.killpg(process.pid, signal.SIGTERM)
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait(timeout=5)
    return forced


def main():
    os.chdir(ROOT.parent)
    stopped = []
    def stop(sig, _frame):
        if not stopped: stopped.append(sig)
    for sig in [signal.SIGINT, signal.SIGTERM] + ([signal.SIGBREAK] if hasattr(signal, 'SIGBREAK') else []):
        signal.signal(sig, stop)
    owned = []
    reused = False
    code = 1
    try:
        for port in [3000, 5000]:
            if port_open(port):
                raise RuntimeError(f'Port {port} is already occupied. Stop the existing app dev command before running dev:ai; no process was killed.')
        env = {**os.environ, 'SLM_URL': 'http://127.0.0.1:8081', 'SLM_MODEL': CONFIG['alias']}
        options = {} if os.name == 'nt' else {'start_new_session': True}
        if port_open(8081):
            verify_slm()
            reused = True
            lifecycle_log('dev_ai_reusing_slm', endpoint='http://127.0.0.1:8081', model=CONFIG['alias'], inference_verified=True,
                          note='This server is externally owned and will remain running on shutdown.')
        else:
            owned.append(('slm', subprocess.Popen([sys.executable, str(ROOT/'tools/runtime.py'), 'serve'], env=env, **options)))
            wait_until(lambda: local_json(8081, '/health').get('status') == 'ok', owned, stopped, 90, 'local Qwen health')
            if stopped: raise InterruptedError('Startup interrupted')
            verify_slm()
            lifecycle_log('dev_ai_slm_ready', inference_verified=True)
        if stopped: raise InterruptedError('Startup interrupted')
        npm_cli = os.environ.get('npm_execpath')
        if not npm_cli and os.name == 'nt':
            npm_cmd = shutil.which('npm.cmd')
            candidate = Path(npm_cmd).parent/'node_modules/npm/bin/npm-cli.js' if npm_cmd else None
            if candidate and candidate.is_file(): npm_cli = str(candidate)
            else: raise RuntimeError('Cannot locate npm CLI. Run this launcher using npm run dev:ai.')
        command = ['node', npm_cli, 'run', 'dev'] if npm_cli else ['npm', 'run', 'dev']
        # A native Node parent and closed stdin avoid cmd.exe's interactive
        # "Terminate batch job (Y/N)?" holding the launcher open after Ctrl+C.
        owned.append(('app', subprocess.Popen(command, env=env, stdin=subprocess.DEVNULL, **options)))
        wait_until(lambda: local_json(5000, '/api/v1/styling/status').get('inferenceVerified') is True, owned, stopped, 120, 'Express/Qwen inference readiness')
        def web_ready():
            with local_open('http://127.0.0.1:3000/stylist', timeout=5) as response:
                return response.status == 200
        wait_until(web_ready, owned, stopped, 120, 'Next.js stylist')
        if stopped: raise InterruptedError('Startup interrupted')
        lifecycle_log('dev_ai_ready', frontend='http://localhost:3000/stylist', api='http://127.0.0.1:5000',
                      slm='http://127.0.0.1:8081', inference_verified=True, reused_slm=reused)
        last_health = time.monotonic()
        while not stopped:
            for name, process in owned:
                if process.poll() is not None:
                    raise RuntimeError(f'{name} exited unexpectedly with code {process.returncode}; no restart attempted')
            if time.monotonic() - last_health > 10:
                if local_json(8081, '/health').get('status') != 'ok': raise RuntimeError('Local Qwen became unavailable')
                last_health = time.monotonic()
            time.sleep(.25)
        code = 0
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, AssertionError, subprocess.SubprocessError) as exc:
        if stopped:
            code = 0
            lifecycle_log('dev_ai_interrupted')
        else:
            lifecycle_log('dev_ai_failed', error=str(exc))
    finally:
        forced = stop_owned(owned, bool(stopped))
        lifecycle_log('dev_ai_stopped', intentional=bool(stopped), forced=forced, reused_slm_preserved=reused)
        if forced and stopped: code = 1
    return code


if __name__ == '__main__':
    raise SystemExit(main())
