"""Resource-checked, hash-verified Windows CPU runtime setup and launcher. No GPU use."""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import secrets
import signal
import socket
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timezone
import subprocess
import urllib.request
import urllib.parse
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / "configs/local.json").read_text())



class NoLocalRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


LOCAL_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoLocalRedirect())


def local_open(request, timeout=3):
    """Language probes never use external HTTP proxies or follow redirects."""
    url = request.full_url if isinstance(request, urllib.request.Request) else request
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1', 'localhost', '::1'} or parsed.username or parsed.password:
        raise ValueError('Local inference requests require an HTTP loopback URL without credentials')
    return LOCAL_OPENER.open(request, timeout=timeout)


def free_ram():
    if os.name != "nt":
        return os.sysconf("SC_AVPHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")
    class MemoryStatus(ctypes.Structure):
        _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [
            (name, ctypes.c_ulonglong) for name in ["total", "available", "page_total", "page_available", "virtual_total", "virtual_available", "extended"]]
    status = MemoryStatus()
    status.length = ctypes.sizeof(status)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        raise RuntimeError("Cannot check available RAM")
    return status.available


def download(url, target, digest, max_bytes):
    if target.exists() and sha256(target) == digest:
        print(f"Verified cached {target.name}")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".partial")
    try:
        with urllib.request.urlopen(url, timeout=60) as response, partial.open("wb") as out:
            size = 0
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise RuntimeError("Download exceeded expected size")
                out.write(chunk)
        if sha256(partial) != digest:
            raise RuntimeError(f"Checksum mismatch: {target.name}")
        partial.replace(target)
        print(f"Downloaded and verified {target.name}: {size} bytes")
    finally:
        partial.unlink(missing_ok=True)


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def setup():
    if os.name != "nt":
        raise RuntimeError("Bundled setup targets Windows x64. Install llama.cpp for your OS manually.")
    disk, ram = shutil.disk_usage(ROOT).free, free_ram()
    print(json.dumps({"free_disk_bytes": disk, "free_ram_bytes": ram}))
    if disk < 2 * 1024**3 or ram < 1024**3:
        raise RuntimeError("Need 2 GiB free disk and 1 GiB free RAM before downloading; close unused applications.")
    c = CONFIG
    download(f"https://huggingface.co/{c['gguf_repo']}/resolve/{c['revision']}/{c['filename']}",
             ROOT / "models" / c["filename"], c["model_sha256"], c["model_bytes"])
    archive = ROOT / "runtime" / c["runtime_file"]
    download(f"https://github.com/ggml-org/llama.cpp/releases/download/{c['runtime_tag']}/{c['runtime_file']}",
             archive, c["runtime_sha256"], 30 * 1024**2)
    destination = (ROOT / "runtime" / c["runtime_tag"]).resolve()
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            if not (destination / entry.filename).resolve().is_relative_to(destination):
                raise RuntimeError("Unsafe runtime archive path")
        bundle.extractall(destination)
    print(f"Ready: python {Path(__file__)} serve")


def lifecycle_log(event, **details):
    """Only lifecycle metadata; never API keys, prompts or response contents."""
    record = {"time": datetime.now(timezone.utc).isoformat(), "event": event,
              "wrapper_pid": os.getpid(), **details}
    print("[slm-runtime] " + json.dumps(record), file=sys.stderr, flush=True)


def port_owner(port):
    if os.name != "nt":
        return "Inspect the listener with ss/lsof."
    # The numeric port is internal/validated; no shell or user interpolation.
    command = (f"Get-NetTCPConnection -LocalPort {int(port)} -State Listen -ErrorAction SilentlyContinue | "
               "Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress")
    try:
        return subprocess.check_output(["powershell", "-NoProfile", "-Command", command],
                                       text=True, timeout=5, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.SubprocessError):
        return "Owner lookup unavailable; inspect Get-NetTCPConnection."


@contextmanager
def reserve_port(port):
    """Prevent concurrent wrappers, including the model-load-before-listen interval."""
    lock_path = ROOT / "runtime" / f"serve-{port}.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as lock:
        lock.seek(0, 2)
        if lock.tell() == 0:
            lock.write(b"0"); lock.flush()
        lock.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise RuntimeError(f"Another SLM wrapper owns port {port} (possibly still loading). "
                               f"Do not start slm:serve alongside dev:slm. {port_owner(port)}") from exc
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                if os.name == "nt":
                    probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                try:
                    probe.bind(("127.0.0.1", port))
                except OSError as exc:
                    raise RuntimeError(f"Port {port} is unavailable: {exc}. Listener: {port_owner(port)}. "
                                       "Keep the existing server or stop it intentionally; no process was killed.") from exc
            yield
        finally:
            lock.seek(0)
            if os.name == "nt":
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock, fcntl.LOCK_UN)


def exit_description(code):
    if code == 0:
        return "Native process returned normally"
    if os.name == "nt":
        return {
            0xC0000005: "Windows access violation",
            0xC000001D: "Windows illegal instruction (check CPU/runtime compatibility)",
            0xC0000017: "Windows insufficient memory",
            0xC0000135: "Windows required DLL not found",
            0xC000013A: "Windows console control termination",
        }.get(code & 0xffffffff, "Native nonzero exit; inspect llama.cpp logs")
    if code < 0:
        return f"Terminated by POSIX signal {-code}"
    return "Native nonzero exit; inspect llama.cpp logs"


def supervise(command, on_start=None, on_finish=None, grace_seconds=10):
    """One child, no restart. Relay intentional signals and always reap the child."""
    requested = []
    def request_stop(signum, _frame):
        if not requested:
            requested.append(signum)
    handled = [signal.SIGINT, signal.SIGTERM]
    if hasattr(signal, "SIGBREAK"):
        handled.append(signal.SIGBREAK)
    previous = {sig: signal.signal(sig, request_stop) for sig in handled}
    process = None
    started = time.monotonic()
    forced = False
    try:
        # Share the console: llama.cpp handles CTRL_C_EVENT gracefully. Creating
        # a new group disables Ctrl+C in the child; CTRL_BREAK can bypass its
        # graceful handler and produce STATUS_CONTROL_C_EXIT instead of code 0.
        process = subprocess.Popen(command)
        lifecycle_log("child_started", child_pid=process.pid, executable=str(command[0]),
                      parent_pid=os.getppid(), signal_mode="shared-console" if os.name == "nt" else "relay-to-child")
        if on_start:
            on_start(process)
        deadline = None
        while True:
            if requested and deadline is None:
                lifecycle_log("shutdown_requested", child_pid=process.pid,
                              signal=signal.Signals(requested[0]).name, grace_seconds=grace_seconds)
                deadline = time.monotonic() + grace_seconds
                if process.poll() is None:
                    try:
                        if os.name != "nt":
                            process.send_signal(requested[0])
                        # Windows console Ctrl+C/Break already reaches the child.
                        # Do not broadcast another event to unrelated processes.
                        # If only the wrapper was signaled, the bounded grace
                        # period ends in an explicitly reported forced cleanup.
                    except OSError as exc:
                        if process.poll() is None:
                            lifecycle_log("signal_delivery_failed", child_pid=process.pid, error=str(exc))
            try:
                code = process.wait(timeout=0.25)
                break
            except subprocess.TimeoutExpired:
                if deadline is not None and time.monotonic() >= deadline:
                    forced = True
                    lifecycle_log("shutdown_grace_expired", child_pid=process.pid, action="terminate")
                    process.terminate()
                    try:
                        code = process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        lifecycle_log("child_kill_required", child_pid=process.pid)
                        process.kill(); code = process.wait(timeout=5)
                    break
        clean = bool(requested) and not forced and code in {0, 130, 143, -2, -15, 0xC000013A, -1073741510}
        lifecycle_log("child_exited", child_pid=process.pid, child_exit_code=code,
                      child_exit_hex=f"0x{code & 0xffffffff:08X}", exit_description=exit_description(code), uptime_seconds=round(time.monotonic()-started, 3),
                      requested_signal=signal.Signals(requested[0]).name if requested else None,
                      outcome="intentional-stop" if clean else "unexpected-exit",
                      forced=forced,
                      diagnostic=None if clean else "See native llama.cpp logs above. Check console/supervisor termination, port ownership and Windows crash events. No restart attempted.")
        # Even spontaneous native code 0 is unexpected for a persistent service.
        return 0 if clean else (code if 0 < code < 256 else 1)
    finally:
        try:
            if process is not None:
                if process.poll() is None:
                    lifecycle_log("wrapper_cleanup", child_pid=process.pid, action="terminate-and-reap")
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill(); process.wait(timeout=5)
                if on_finish:
                    on_finish(process)
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)


def serve(variant="base", candidate_path=None, port_override=None, threads=None, context=None):
    # Read only language-runtime options from the existing root .env; never modify it.
    env_file = ROOT.parent / ".env"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf8").splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() in {"SLM_MODEL_PATH", "SLM_MODEL", "LLAMA_SERVER_PATH"}:
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    c = dict(CONFIG)
    if threads is not None:
        if not 1 <= threads <= (os.cpu_count() or 1): raise RuntimeError("Threads must be between 1 and the logical CPU count")
        c["threads"] = threads
    if context is not None:
        if not 1024 <= context <= 4096: raise RuntimeError("Context must be between 1024 and 4096 for this CPU launcher")
        c["context"] = context
    alias, port = c["alias"], c["port"]
    model = ROOT / "models" / c["filename"]
    if variant == "candidate":
        if not candidate_path: raise RuntimeError("--variant candidate requires --model-path")
        model, alias, port = Path(candidate_path), "virtualfit-fashion-custom", 8082
    elif variant == "custom":
        registration = json.loads((ROOT / "configs/custom-model.json").read_text())
        model, alias, port = Path(registration["gguf_path"]), registration["model"], 8082
        if not registration.get("approved") or sha256(model) != registration["gguf_sha256"]:
            raise RuntimeError("Registered custom model hash does not match")
    elif sha256(model) != c["model_sha256"]:
        raise RuntimeError("Original model hash changed; refusing to replace rollback weights")
    executable = os.environ.get("LLAMA_SERVER_PATH")
    candidates = list((ROOT / "runtime" / c["runtime_tag"]).rglob("llama-server.exe"))
    if not executable and candidates:
        executable = str(candidates[0])
    if not executable or not model.is_file():
        raise RuntimeError("Runtime/model missing. Run npm run slm:setup first.")
    keyfile = ROOT / "runtime" / "api-key.txt"
    keyfile.parent.mkdir(parents=True, exist_ok=True)
    if not keyfile.exists():
        keyfile.write_text(secrets.token_urlsafe(32))
        keyfile.chmod(0o600)
    command = [executable, "-m", str(model), "--host", "127.0.0.1", "--port", str(port),
               "--api-key-file", str(keyfile), "--cors-origins", "http://localhost:3000", "--ui",
               "--alias", alias, "-c", str(c["context"]),
               "-t", str(c["threads"]), "-ngl", "0", "--parallel", "1", "-b", "128", "-ub", "64"]
    if port_override is not None:
        if not 1 <= port_override <= 65535: raise RuntimeError("Port must be between 1 and 65535")
        port = port_override
        command[command.index("--port") + 1] = str(port)
    proof = ROOT / "runtime/custom-loaded.json"
    def on_start(process):
        if variant != "base":
            proof.write_text(json.dumps({"pid": process.pid, "variant": variant, "model": alias,
                "gguf_path": str(model.resolve()), "gguf_sha256": sha256(model)}))
    def on_finish(process):
        if variant != "base" and proof.exists() and json.loads(proof.read_text()).get("pid") == process.pid:
            proof.unlink()
    with reserve_port(port):
        if free_ram() < 768 * 1024**2:
            raise RuntimeError("Need at least 768 MiB free RAM to start. Close unused applications.")
        lifecycle_log("launch", variant=variant, endpoint=f"http://127.0.0.1:{port}", model=str(model),
                      threads=c["threads"], context=c["context"], web_ui=True,
                      note="Run either slm:serve or dev:slm. dev:slm stops this server when its app sibling exits.")
        return supervise(command, on_start, on_finish)



if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["setup", "serve", "inspect"])
    parser.add_argument("--variant", choices=["base", "candidate", "custom"], default="base")
    parser.add_argument("--model-path", type=Path)
    parser.add_argument("--threads", type=int, help="CPU thread override for measured experiments")
    parser.add_argument("--context", type=int, help="Context override (1024-4096); default 2048")
    parser.add_argument("--port", type=int, help="Explicit alternate listener for isolated diagnostics; default unchanged")
    args = parser.parse_args()
    if args.command == "setup": setup()
    elif args.command == "serve":
        try:
            raise SystemExit(serve(args.variant, args.model_path, args.port, args.threads, args.context))
        except KeyboardInterrupt:
            # Covers Ctrl+C during preflight, before child signal handling starts.
            lifecycle_log("preflight_interrupted")
            raise SystemExit(130)
        except (OSError, RuntimeError, ValueError) as exc:
            lifecycle_log("launch_failed", error=str(exc))
            raise SystemExit(1)
    else: print(json.dumps({"free_disk_bytes": shutil.disk_usage(ROOT).free, "free_ram_bytes": free_ram(), "config": CONFIG}, indent=2))
