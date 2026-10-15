from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, model_validator

ATTN_SUBFOLDERS = {"mix": "mix-48k-1024", "vitonhd": "vitonhd-16k-512", "dresscode": "dresscode-16k-512"}


class TrainConfig(BaseModel):
    """All knobs of a fine-tuning run. Saved next to every checkpoint for reproducibility."""

    # --- pretrained weights (never modified; the baseline stays intact) ---
    base_model: str = "booksforcharlie/stable-diffusion-inpainting"  # SD-1.5 inpainting copy used by CatVTON
    vae_model: str = "stabilityai/sd-vae-ft-mse"
    attn_repo: str = "zhengchong/CatVTON"  # HF repo id or local folder holding released attention weights
    attn_version: Literal["mix", "vitonhd", "dresscode"] = "vitonhd"

    # --- data ---
    dataset_root: str
    train_manifest: str
    val_manifest: str
    height: int = 512  # "vitonhd-16k-512" was trained at 512x384; keep the same scale when fine-tuning
    width: int = 384
    num_workers: int = 2

    # --- method: parameter-efficient fine-tuning of the self-attention layers ---
    method: Literal["lora", "attn_selective"] = "lora"
    lora_rank: int = 16
    lora_alpha: int = 16

    # --- objective (see docs/research/training-guide.md for what is and is not from the reference) ---
    enable_condition_noise: bool = True  # noise person+garment halves (matches sampling start)
    condition_dropout: float = Field(0.1, ge=0.0, le=0.5)  # garment dropped -> enables CFG at inference

    # --- optimisation ---
    learning_rate: float = 1e-4
    batch_size: int = 1
    grad_accum: int = 8
    max_steps: int = 500  # optimizer steps
    warmup_steps: int = 20
    max_grad_norm: float = 1.0
    mixed_precision: Literal["no", "fp16", "bf16"] = "fp16"
    gradient_checkpointing: bool = True
    use_8bit_adam: bool = False
    seed: int = 42
    force_cpu: bool = False  # tests only

    # --- bookkeeping ---
    output_dir: str = "runs/exp1"
    save_every: int = 50
    keep_checkpoints: int = 2
    val_every: int = 50
    val_batches: int = 20
    sample_count: int = 4  # validation images generated after training (0 = skip)
    sample_steps: int = 30
    resume: str | None = None  # "latest" or a checkpoint directory

    @model_validator(mode="after")
    def _check(self):
        if self.height % 8 or self.width % 8:
            raise ValueError("height and width must be multiples of 8 (VAE downsampling)")
        if self.lora_rank < 1:
            raise ValueError("lora_rank must be >= 1")
        return self

    @property
    def attn_subfolder(self) -> str:
        return ATTN_SUBFOLDERS[self.attn_version]

    @classmethod
    def from_yaml(cls, path: str | Path, **overrides) -> "TrainConfig":
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        data.update({k: v for k, v in overrides.items() if v is not None})
        return cls(**data)
