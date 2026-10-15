"""Result post-processing (Pillow/numpy only, so the service can import it without torch)."""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageFilter


def repaint(person: Image.Image, mask: Image.Image, result: Image.Image, blur_px: int = 9) -> Image.Image:
    """Paste the generated result only inside the (softened) mask so everything outside is
    pixel-identical to the input photo (identity/background preservation)."""
    person = person.convert("RGB").resize(result.size)
    soft = mask.convert("L").resize(result.size, Image.NEAREST).filter(ImageFilter.GaussianBlur(blur_px))
    m = np.asarray(soft, dtype=np.float32)[..., None] / 255.0
    out = np.asarray(person, dtype=np.float32) * (1 - m) + np.asarray(result, dtype=np.float32) * m
    return Image.fromarray(out.round().astype(np.uint8))
