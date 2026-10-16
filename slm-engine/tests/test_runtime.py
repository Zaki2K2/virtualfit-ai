"""Launcher lifecycle regressions; no model download or GPU required."""
import importlib.util
from pathlib import Path
import signal
import socket
import subprocess
import sys
from contextlib import nullcontext

import pytest

spec = importlib.util.spec_from_file_location('slm_runtime', Path(__file__).resolve().parents[1] / 'tools/runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


def test_serve_enables_official_ui_without_relaxing_security(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, 'ROOT', tmp_path)
    model = tmp_path / 'models' / runtime.CONFIG['filename']
    model.parent.mkdir(); model.write_bytes(b'test fixture only')
    monkeypatch.setattr(runtime, 'sha256', lambda path: runtime.CONFIG['model_sha256'])
    monkeypatch.setattr(runtime, 'free_ram', lambda: 2 * 1024**3)
    monkeypatch.setattr(runtime, 'reserve_port', lambda port: nullcontext())
    monkeypatch.setattr(runtime, 'prepare_identity', lambda: ('nova-template', 'nova-ui'))
    monkeypatch.setenv('LLAMA_SERVER_PATH', sys.executable)
    commands = []
    monkeypatch.setattr(runtime, 'supervise', lambda command, *callbacks: commands.append(command) or 0)
    assert runtime.serve() == 0
    command = commands[0]
    assert '--ui' in command
    assert '--no-ui' not in command and '--no-webui' not in command
    for flag, value in [('--host', '127.0.0.1'), ('--port', '8081'), ('-ngl', '0'),
                        ('--cors-origins', 'http://localhost:3000'),
                        ('--api-key-file', str(tmp_path / 'runtime/api-key.txt'))]:
        assert command[command.index(flag) + 1] == value
    assert '--api-key' not in command
    assert command[command.index('--chat-template-file') + 1] == 'nova-template'
    assert command[command.index('--ui-config-file') + 1] == 'nova-ui'
    assert (tmp_path / 'runtime/api-key.txt').read_text()


def test_nova_native_template_uses_central_identity_and_keeps_qwen_format(tmp_path, monkeypatch):
    import json
    import shutil
    source = runtime.ROOT
    root = tmp_path / 'slm-engine'
    (root / 'runtime').mkdir(parents=True)
    (root / 'configs').mkdir()
    config = tmp_path / 'packages/shared/src'
    config.mkdir(parents=True)
    shutil.copy(source.parent / 'packages/shared/src/nova.json', config / 'nova.json')
    shutil.copy(source / 'configs/nova-qwen.jinja.in', root / 'configs')
    monkeypatch.setattr(runtime, 'ROOT', root)
    template, ui = runtime.prepare_identity()
    text = template.read_text(encoding='utf8')
    assert '__NOVA_' not in text
    assert 'NovaCTO' in text and 'Alibaba Cloud' in text
    assert '<|im_start|>' in text and '<|im_end|>' in text
    assert 'tool_call' in text  # Preserve the installed model template's formatting.
    settings = json.loads(ui.read_text(encoding='utf8'))
    assert settings['systemMessage'] == 'Nova AI — Powered by NovaCTO'
    assert not settings['useHuggingFaceHub']
    assert settings['temperature'] == 0
    assert 'apiKey' not in settings


@pytest.mark.parametrize('native, expected', [(0, 1), (7, 7)])
def test_spontaneous_exit_is_reported_and_not_restarted(native, expected, capsys):
    assert runtime.supervise([sys.executable, '-c', f'raise SystemExit({native})']) == expected
    output = capsys.readouterr().err
    assert f'"child_exit_code": {native}' in output
    assert '"outcome": "unexpected-exit"' in output
    assert output.count('"event": "child_started"') == 1


def test_ctrl_c_relays_and_exits_without_traceback(monkeypatch, capsys):
    class Child:
        pid = 123
        returncode = None
        def poll(self): return self.returncode
        def send_signal(self, sig): self.sent = sig; self.returncode = 0
        def wait(self, timeout=None):
            if sys.platform == 'win32': self.returncode = 0  # Console delivers Ctrl+C independently.
            assert self.returncode is not None
            return self.returncode
    child = Child()
    monkeypatch.setattr(runtime.subprocess, 'Popen', lambda *a, **kw: child)
    old = signal.getsignal(signal.SIGINT)
    assert runtime.supervise(['test-only'], on_start=lambda p: signal.raise_signal(signal.SIGINT)) == 0
    assert signal.getsignal(signal.SIGINT) == old
    if sys.platform == 'win32': assert not hasattr(child, 'sent')
    else: assert child.sent == signal.SIGINT
    output = capsys.readouterr().err
    assert 'intentional-stop' in output and 'Traceback' not in output


def test_forced_shutdown_is_not_reported_as_clean(monkeypatch, capsys):
    class Child:
        pid = 123
        returncode = None
        def poll(self): return self.returncode
        def send_signal(self, sig): pass  # Unresponsive child
        def terminate(self): self.returncode = 1
        def wait(self, timeout=None):
            if self.returncode is None: raise subprocess.TimeoutExpired('test-only', timeout)
            return self.returncode
    monkeypatch.setattr(runtime.subprocess, 'Popen', lambda *a, **kw: Child())
    assert runtime.supervise(['test-only'], on_start=lambda p: signal.raise_signal(signal.SIGINT), grace_seconds=0) == 1
    assert '"forced": true' in capsys.readouterr().err


def test_start_callback_failure_reaps_child():
    children = []
    def fail(child):
        children.append(child)
        raise RuntimeError('proof-write-failed')
    with pytest.raises(RuntimeError, match='proof-write-failed'):
        runtime.supervise([sys.executable, '-c', 'import time; time.sleep(60)'], on_start=fail)
    assert children[0].poll() is not None


def test_duplicate_wrapper_lock_rejects_before_listener_exists(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, 'ROOT', tmp_path)
    monkeypatch.setattr(runtime, 'port_owner', lambda port: 'test-owner')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    with runtime.reserve_port(port):
        with pytest.raises(RuntimeError, match='Another SLM wrapper'):
            with runtime.reserve_port(port): pass
    with runtime.reserve_port(port): pass  # OS lock released; persistent file is not a stale lock.


def test_existing_listener_is_preserved(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, 'ROOT', tmp_path)
    monkeypatch.setattr(runtime, 'port_owner', lambda port: 'PID-test')
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0)); listener.listen()
        port = listener.getsockname()[1]
        with pytest.raises(RuntimeError, match='PID-test'):
            with runtime.reserve_port(port): pass
        assert listener.fileno() != -1


def test_exit_description_distinguishes_windows_control_from_crash():
    if sys.platform != 'win32': pytest.skip('Windows native status meanings')
    assert 'console control' in runtime.exit_description(0xC000013A)
    assert 'access violation' in runtime.exit_description(0xC0000005)
    assert 'normally' in runtime.exit_description(0)


def test_language_probe_rejects_remote_urls_before_network():
    with pytest.raises(ValueError,match='loopback'): runtime.local_open('https://example.com')


def test_language_probe_does_not_follow_redirects_or_use_proxy(monkeypatch):
    import http.server
    import threading
    import urllib.error
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == '/redirect':
                self.send_response(302); self.send_header('Location','http://example.invalid/collect')
            else: self.send_response(200)
            self.end_headers()
        def log_message(self,*args): pass
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    monkeypatch.setenv('HTTP_PROXY','http://127.0.0.1:9');monkeypatch.setenv('NO_PROXY','')
    try:
        url=f'http://127.0.0.1:{server.server_port}'
        with runtime.local_open(url,timeout=1) as response: assert response.status==200
        with pytest.raises(urllib.error.HTTPError) as error: runtime.local_open(url+'/redirect',timeout=1)
        assert error.value.code==302
    finally: server.shutdown();server.server_close();thread.join(timeout=2)
