"""Image metrics for comparing try-on models. Every metric states what it does and does not show.

* psnr / ssim / lpips: closeness to the ORIGINAL photo (the paired ground truth). They reward
  reproducing the same person wearing their own garment; they are not a direct "realism" score.
* outside_mask_mae: how much pixels OUTSIDE the try-on mask changed - a proxy for identity /
  background preservation (the face is outside the upper-body mask). 0 = untouched.
* clip_garment_similarity: cosine similarity between CLIP embeddings of the garment photo and the
  repainted region - a proxy for garment-detail preservation (needs CLIP weights).
* FID / KID need thousands of images; with ~40 held-out samples they are meaningless, so they are
  intentionally not computed (`distribution_metrics_note`).
"""

from __future__ import annotations

import numpy as np
from PIL import Image

MIN_SAMPLES_FOR_DISTRIBUTION_METRICS = 1000


def distribution_metrics_note(n: int) -> str:
    if n < MIN_SAMPLES_FOR_DISTRIBUTION_METRICS:
        return f"FID/KID skipped: n={n} < {MIN_SAMPLES_FOR_DISTRIBUTION_METRICS} (estimates would be unreliable)"
    return "FID/KID eligible"


def _arr(img: Image.Image) -> np.ndarray:
    return np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0


def psnr(a: Image.Image, b: Image.Image) -> float:
    mse = float(np.mean((_arr(a) - _arr(b)) ** 2))
    return float("inf") if mse == 0 else float(10 * np.log10(1.0 / mse))


def ssim(a: Image.Image, b: Image.Image) -> float:
    from skimage.metrics import structural_similarity

    return float(structural_similarity(_arr(a), _arr(b), channel_axis=2, data_range=1.0))


def outside_mask_mae(result: Image.Image, original: Image.Image, mask: Image.Image) -> float:
    """Mean absolute pixel difference (0..1) outside the mask."""
    m = np.asarray(mask.convert("L").resize(result.size, Image.NEAREST)) < 128
    if not m.any():
        raise ValueError("mask leaves no pixels outside the try-on region")
    diff = np.abs(_arr(result) - _arr(original.resize(result.size)))
    return float(diff[m].mean())


_LPIPS = None


def lpips_distance(a: Image.Image, b: Image.Image) -> float:
    """LPIPS (AlexNet). Lower = more similar. Downloads ~60MB of weights on first use."""
    global _LPIPS
    import lpips
    import torch

    if _LPIPS is None:
        _LPIPS = lpips.LPIPS(net="alex", verbose=False)
    to_t = lambda im: torch.from_numpy(_arr(im).transpose(2, 0, 1) * 2 - 1).unsqueeze(0).float()
    with torch.no_grad():
        return float(_LPIPS(to_t(a), to_t(b)).item())


_CLIP = None


def clip_garment_similarity(result: Image.Image, garment: Image.Image, mask: Image.Image) -> float:
    """Cosine similarity of CLIP embeddings: garment photo vs the mask bounding-box crop of the result."""
    global _CLIP
    import torch
    from transformers import CLIPModel, CLIPProcessor

    if _CLIP is None:
        name = "openai/clip-vit-base-patch32"
        _CLIP = (CLIPModel.from_pretrained(name).eval(), CLIPProcessor.from_pretrained(name))
    model, proc = _CLIP
    m = np.asarray(mask.convert("L").resize(result.size, Image.NEAREST)) >= 128
    ys, xs = np.where(m)
    crop = result.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    with torch.no_grad():
        feats = model.get_image_features(**proc(images=[crop, garment], return_tensors="pt"))
    feats = torch.nn.functional.normalize(feats, dim=-1)
    return float((feats[0] * feats[1]).sum().item())


def bootstrap_ci(values: list[float], n_boot: int = 2000, seed: int = 0) -> tuple[float, float]:
    """95% bootstrap confidence interval of the mean."""
    arr = np.asarray(values, dtype=np.float64)
    rng = np.random.default_rng(seed)
    means = rng.choice(arr, size=(n_boot, len(arr)), replace=True).mean(axis=1)
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))
