"""Shared test helpers.

IMPORTANT: everything here is a TEST FIXTURE. The synthetic "dataset" and the tiny randomly
initialised models only exercise code paths on CPU. They are never used for real training and
checkpoints produced from them are marked as non-genuine by the metadata check.
"""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

W, H = 96, 128  # tiny "person" size used by fixtures


def png_bytes(w=W, h=H, color=(120, 90, 60), fmt="PNG") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format=fmt)
    return buf.getvalue()


def _person(seed: int) -> Image.Image:
    rng = np.random.default_rng(seed)
    arr = (rng.random((H, W, 3)) * 255).astype(np.uint8)  # unique content -> unique sha1
    return Image.fromarray(arr)


def _cloth(seed: int) -> Image.Image:
    rng = np.random.default_rng(10_000 + seed)
    base = rng.integers(0, 255, size=3)
    arr = np.tile(base, (H, W, 1)).astype(np.uint8)
    arr[::8] = 255 - arr[::8]
    return Image.fromarray(arr)


def make_viton_tree(
    root: Path,
    n_train: int = 12,
    n_test: int = 6,
    masks: str = "agnostic",  # "agnostic" | "parse" | "none"
) -> Path:
    """Create a miniature directory tree in VITON-HD layout (synthetic images)."""
    for split, n, off in (("train", n_train, 0), ("test", n_test, 1000)):
        for sub in ("image", "cloth", "agnostic-mask", "image-parse-v3"):
            (root / split / sub).mkdir(parents=True, exist_ok=True)
        lines = []
        for i in range(n):
            name = f"{off + i:06d}_00.jpg"
            _person(off + i).save(root / split / "image" / name)
            _cloth(off + i).save(root / split / "cloth" / name)
            mask = np.zeros((H, W), np.uint8)
            mask[30:90, 20:76] = 255  # ~32% coverage
            if masks == "agnostic":
                Image.fromarray(mask).save(root / split / "agnostic-mask" / name.replace(".jpg", "_mask.png"))
            elif masks == "parse":
                parse = np.zeros((H, W), np.uint8)
                parse[30:90, 20:76] = 5
                Image.fromarray(parse).save(root / split / "image-parse-v3" / name.replace(".jpg", ".png"))
            other = f"{off + (i + 1) % n:06d}_00.jpg"
            lines.append(f"{name} {other}")
        (root / f"{split}_pairs.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return root


@pytest.fixture
def viton_tree(tmp_path):
    return make_viton_tree(tmp_path / "viton")


# ---------- tiny random models (torch tests) ----------
def tiny_models():
    """Randomly initialised miniature CatVTON-shaped models (9-channel UNet). Not pretrained."""
    import torch
    from diffusers import AutoencoderKL, DDPMScheduler, UNet2DConditionModel

    from virtualfit_engine.arch import prepare_unet

    torch.manual_seed(0)
    unet = UNet2DConditionModel(
        sample_size=16,
        in_channels=9,
        out_channels=4,
        down_block_types=("CrossAttnDownBlock2D", "DownBlock2D"),
        up_block_types=("UpBlock2D", "CrossAttnUpBlock2D"),
        block_out_channels=(16, 32),
        layers_per_block=1,
        cross_attention_dim=16,
        attention_head_dim=4,
        norm_num_groups=8,
    )
    prepare_unet(unet)
    vae = AutoencoderKL(
        in_channels=3,
        out_channels=3,
        down_block_types=("DownEncoderBlock2D",) * 3,
        up_block_types=("UpDecoderBlock2D",) * 3,
        block_out_channels=(8, 8, 8),
        latent_channels=4,
        norm_num_groups=8,
        sample_size=32,
    )
    scheduler = DDPMScheduler(num_train_timesteps=100, prediction_type="epsilon")
    return unet.eval(), vae.eval(), scheduler
