"""Resource-checked, hash-verified Windows CPU runtime setup and launcher. No GPU use."""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import secrets
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / "configs/local.json").read_text())


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


def serve(variant="base", candidate_path=None):
    # Read only language-runtime options from the existing root .env; never modify it.
    env_file = ROOT.parent / ".env"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf8").splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() in {"SLM_MODEL_PATH", "SLM_MODEL", "LLAMA_SERVER_PATH"}:
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    c = CONFIG
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
    if free_ram() < 768 * 1024**2:
        raise RuntimeError("Need at least 768 MiB free RAM to start. Close unused applications.")
    keyfile = ROOT / "runtime" / "api-key.txt"
    keyfile.parent.mkdir(parents=True, exist_ok=True)
    if not keyfile.exists():
        keyfile.write_text(secrets.token_urlsafe(32))
        keyfile.chmod(0o600)
    command = [executable, "-m", str(model), "--host", "127.0.0.1", "--port", str(port),
               "--api-key-file", str(keyfile), "--cors-origins", "http://localhost:3000", "--no-webui",
               "--alias", alias, "-c", str(c["context"]),
               "-t", str(c["threads"]), "-ngl", "0", "--parallel", "1", "-b", "128", "-ub", "64"]
    print(f"Starting {variant} CPU inference on 127.0.0.1:{port}", flush=True)
    process = subprocess.Popen(command)
    proof = ROOT / "runtime/custom-loaded.json"
    if variant != "base":
        proof.write_text(json.dumps({"pid": process.pid, "variant": variant, "model": alias,
            "gguf_path": str(model.resolve()), "gguf_sha256": sha256(model)}))
    try:
        raise SystemExit(process.wait())
    finally:
        if process.poll() is None: process.terminate()
        if variant != "base" and proof.exists() and json.loads(proof.read_text()).get("pid") == process.pid:
            proof.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["setup", "serve", "inspect"])
    parser.add_argument("--variant", choices=["base", "candidate", "custom"], default="base")
    parser.add_argument("--model-path", type=Path)
    args = parser.parse_args()
    if args.command == "setup": setup()
    elif args.command == "serve": serve(args.variant, args.model_path)
    else: print(json.dumps({"free_disk_bytes": shutil.disk_usage(ROOT).free, "free_ram_bytes": free_ram(), "config": CONFIG}, indent=2))
