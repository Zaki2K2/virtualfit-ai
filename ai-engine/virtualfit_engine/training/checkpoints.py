"""Checkpoint handling: resumable training checkpoints and the final adapter release.

* `checkpoint-<step>/`  - everything needed to RESUME (adapter, optimizer, scheduler, RNG, state).
* `adapter/`            - the small deliverable used for inference: adapter weights + metadata.
Base (pretrained) weights are never written, so the baseline checkpoints cannot be changed.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

import torch
from safetensors.torch import load_file, save_file

from .metadata import ADAPTER_CONFIG, ADAPTER_FILE, METADATA_FILE, is_genuine_finetune, read_adapter_metadata  # noqa: F401

def _checkpoint_step(path: Path) -> int:
    m = re.fullmatch(r"checkpoint-(\d+)", path.name)
    return int(m.group(1)) if m else -1


def list_checkpoints(output_dir: str | Path) -> list[Path]:
    root = Path(output_dir)
    if not root.is_dir():
        return []
    found = [p for p in root.iterdir() if p.is_dir() and _checkpoint_step(p) >= 0 and (p / "COMPLETE").exists()]
    return sorted(found, key=_checkpoint_step)


def find_latest_checkpoint(output_dir: str | Path) -> Path | None:
    ckpts = list_checkpoints(output_dir)
    return ckpts[-1] if ckpts else None


def save_training_checkpoint(
    output_dir: str | Path,
    step: int,
    adapter_state: dict[str, torch.Tensor],
    lora_config: dict,
    optimizer,
    lr_scheduler,
    state: dict,
    keep: int = 2,
) -> Path:
    """Write to a temp dir then rename, so a disconnect mid-save never leaves a half checkpoint."""
    root = Path(output_dir)
    final = root / f"checkpoint-{step}"
    tmp = root / f".tmp-checkpoint-{step}"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    save_file({k: v.detach().cpu().contiguous() for k, v in adapter_state.items()}, str(tmp / ADAPTER_FILE))
    (tmp / ADAPTER_CONFIG).write_text(json.dumps(lora_config, indent=2), encoding="utf-8")
    torch.save(optimizer.state_dict(), tmp / "optimizer.pt")
    torch.save(lr_scheduler.state_dict(), tmp / "scheduler.pt")
    (tmp / "trainer_state.json").write_text(json.dumps(state, indent=2), encoding="utf-8")
    (tmp / "COMPLETE").write_text("ok")
    shutil.rmtree(final, ignore_errors=True)
    tmp.rename(final)
    for old in list_checkpoints(root)[:-keep] if keep > 0 else []:
        shutil.rmtree(old, ignore_errors=True)
    return final


def load_training_checkpoint(path: str | Path) -> dict:
    p = Path(path)
    if not (p / "COMPLETE").exists():
        raise FileNotFoundError(f"{p} is not a complete checkpoint")
    return {
        "adapter_state": load_file(str(p / ADAPTER_FILE)),
        "lora_config": json.loads((p / ADAPTER_CONFIG).read_text(encoding="utf-8")),
        "optimizer": torch.load(p / "optimizer.pt", map_location="cpu", weights_only=True),
        "scheduler": torch.load(p / "scheduler.pt", map_location="cpu", weights_only=True),
        "state": json.loads((p / "trainer_state.json").read_text(encoding="utf-8")),
    }


def write_adapter_release(out_dir: str | Path, adapter_state: dict[str, torch.Tensor], lora_config: dict, metadata: dict) -> Path:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    save_file({k: v.detach().cpu().contiguous() for k, v in adapter_state.items()}, str(out / ADAPTER_FILE))
    (out / ADAPTER_CONFIG).write_text(json.dumps(lora_config, indent=2), encoding="utf-8")
    (out / METADATA_FILE).write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return out
