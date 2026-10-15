"""Zip the engine source (no venv, caches or data) for upload to Google Drive / Kaggle.

    python tools/package_engine.py            ->  ai-engine.zip next to this repo's ai-engine/
"""

from __future__ import annotations

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {".venv", "__pycache__", ".pytest_cache", "runs", "data", "checkpoints", "virtualfit_engine.egg-info"}
SKIP_SUFFIXES = {".pyc", ".safetensors", ".pt", ".ckpt", ".bin", ".log"}


def main() -> None:
    out = ROOT / "ai-engine.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(ROOT.rglob("*")):
            rel = path.relative_to(ROOT)
            if path.is_dir() or any(part in SKIP_DIRS for part in rel.parts) or path.suffix in SKIP_SUFFIXES or path == out:
                continue
            z.write(path, Path("ai-engine") / rel)
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
