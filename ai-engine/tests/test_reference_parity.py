"""Parity of our sampling loop with the REFERENCE CatVTON pipeline, on tiny random models.

Runs only when ENGINE_CATVTON_REPO points to a CatVTON checkout (so the reference code can be
imported). Both implementations get identical weights, inputs and RNG state.
"""

import os
import sys
from pathlib import Path

import numpy as np
import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("diffusers")

REPO = os.environ.get("ENGINE_CATVTON_REPO")
pytestmark = [pytest.mark.torch, pytest.mark.skipif(not REPO or not Path(REPO, "model", "pipeline.py").is_file(), reason="set ENGINE_CATVTON_REPO to a CatVTON checkout")]

from PIL import Image
from conftest import tiny_models
from virtualfit_engine.pipeline import TryOnPipeline


def _reference_pipeline(unet, vae, scheduler):
    sys.path.insert(0, REPO)
    try:
        from model.pipeline import CatVTONPipeline  # reference implementation (CC BY-NC-SA 4.0)
    finally:
        sys.path.remove(REPO)
    ref = CatVTONPipeline.__new__(CatVTONPipeline)  # bypass the constructor that downloads weights
    ref.device, ref.weight_dtype, ref.skip_safety_check = "cpu", torch.float32, True
    ref.noise_scheduler, ref.vae, ref.unet = scheduler, vae, unet
    return ref


@pytest.mark.parametrize("guidance", [1.0, 2.5])
def test_sampling_matches_reference(guidance):
    from diffusers import DDIMScheduler

    unet, vae, _ = tiny_models()
    scheduler = DDIMScheduler(num_train_timesteps=100, prediction_type="epsilon", clip_sample=False, set_alpha_to_one=False)
    rng = np.random.default_rng(3)
    person = Image.fromarray((rng.random((128, 96, 3)) * 255).astype(np.uint8))
    garment = Image.fromarray((rng.random((90, 90, 3)) * 255).astype(np.uint8))
    mask_arr = np.zeros((128, 96), np.uint8)
    mask_arr[30:90, 20:76] = 255
    mask = Image.fromarray(mask_arr)

    torch.manual_seed(11)
    ours = TryOnPipeline(unet, vae, scheduler, "cpu", torch.float32)(
        person, garment, mask, 3, guidance, 64, 48, torch.Generator().manual_seed(5)
    )
    torch.manual_seed(11)
    theirs = _reference_pipeline(unet, vae, scheduler)(
        person, garment, mask, num_inference_steps=3, guidance_scale=guidance, height=64, width=48, generator=torch.Generator().manual_seed(5)
    )[0]
    diff = np.abs(np.asarray(ours, np.int16) - np.asarray(theirs, np.int16))
    assert ours.size == theirs.size == (48, 64)
    assert diff.max() <= 1, f"max pixel difference vs reference: {diff.max()}"
