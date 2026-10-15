"""Adapter metadata rules (pure Python: importable without torch)."""

from __future__ import annotations

import json
from pathlib import Path

ADAPTER_FILE = "adapter.safetensors"
ADAPTER_CONFIG = "adapter_config.json"
METADATA_FILE = "metadata.json"


def read_adapter_metadata(adapter_dir: str | Path) -> dict:
    return json.loads((Path(adapter_dir) / METADATA_FILE).read_text(encoding="utf-8"))


def is_genuine_finetune(metadata: dict) -> bool:
    """True only for adapters produced by a real optimizer run on top of the real pretrained
    CatVTON weights. Anything else (toy tests, injected models) must not be presented as the
    VirtualFit model."""
    return bool(
        metadata.get("pretrained_weights_loaded")
        and metadata.get("attention_checkpoint_loaded")
        and metadata.get("optimizer_steps_completed", 0) > 0
        and metadata.get("completed")
    )
