"""Model-specific conditioning inputs for CatVTON (numpy / Pillow only, no torch required).

CatVTON consumes: person image in [-1, 1], garment image in [-1, 1] (white-padded), and a binary
"cloth-agnostic" mask (1 = region to repaint). The masked person is `person * (mask < 0.5)`.
Masks are never invented here: they come from the dataset, from a caller, or from an explicitly
named estimator (see `service/masking.py`) and are always checked with `validate_mask`.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image

from .images import resize_and_crop, resize_and_padding

# VITON-HD human-parsing label ids, taken from the VITON-HD reference code (datasets.py):
# 5 upper-clothes, 6 dress, 7 coat, 10 neck, 14 left-arm, 15 right-arm.
PARSE_UPPER_BODY_LABELS: tuple[int, ...] = (5, 6, 7, 14, 15)


def image_to_array(image: Image.Image) -> np.ndarray:
    """RGB image -> float32 CHW array in [-1, 1] (same normalisation as CatVTON)."""
    arr = np.asarray(image.convert("RGB"), dtype=np.float32)
    return (arr / 127.5 - 1.0).transpose(2, 0, 1)


def mask_to_array(mask: Image.Image) -> np.ndarray:
    """Mask image -> float32 1HW array of exactly 0.0 / 1.0 (threshold 0.5)."""
    arr = np.asarray(mask.convert("L"), dtype=np.float32) / 255.0
    return (arr >= 0.5).astype(np.float32)[None]


def apply_mask(person: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Masked person (CHW in [-1,1]); masked pixels become 0 (mid-grey), as in CatVTON."""
    return person * (mask < 0.5)


def mask_coverage(mask: np.ndarray) -> float:
    return float(mask.mean())


def validate_mask(
    mask: np.ndarray, min_coverage: float = 0.03, max_coverage: float = 0.60
) -> tuple[bool, str]:
    """Plausibility check for a try-on mask. This detects broken masks (empty / whole image);
    it does NOT prove the mask is anatomically correct."""
    if mask.ndim != 3 or mask.shape[0] != 1:
        return False, "mask must have shape 1xHxW"
    cov = mask_coverage(mask)
    if cov < min_coverage:
        return False, f"mask covers only {cov:.1%} of the image"
    if cov > max_coverage:
        return False, f"mask covers {cov:.1%} of the image"
    return True, "ok"


def dilate_mask(mask: np.ndarray, radius_px: int) -> np.ndarray:
    """Binary dilation with a square structuring element (numpy only)."""
    if radius_px <= 0:
        return mask
    m = mask[0] > 0.5
    padded = np.pad(m, radius_px)
    out = np.zeros_like(m)
    h, w = m.shape
    for dy in range(2 * radius_px + 1):
        for dx in range(2 * radius_px + 1):
            out |= padded[dy : dy + h, dx : dx + w]
    return out.astype(np.float32)[None]


def mask_from_parsing(
    parse: np.ndarray, labels: tuple[int, ...] = PARSE_UPPER_BODY_LABELS, dilate_px: int = 8
) -> np.ndarray:
    """Approximate upper-body try-on mask from a VITON-HD human-parsing label map (HxW ints).

    This is an APPROXIMATION of CatVTON's agnostic mask (union of garment + arm labels, slightly
    dilated). Prefer a dataset-provided `agnostic-mask` when it exists.
    """
    mask = np.isin(parse, labels).astype(np.float32)[None]
    return dilate_mask(mask, dilate_px)


@dataclass
class TryOnInputs:
    person: Image.Image  # resized + cropped RGB
    garment: Image.Image  # resized + padded RGB
    mask: Image.Image  # resized + cropped L, binary 0/255


def prepare_inputs(
    person: Image.Image, garment: Image.Image, mask: Image.Image, width: int, height: int
) -> TryOnInputs:
    """Apply CatVTON's resize policy: crop person+mask, pad garment (white)."""
    if person.size != mask.size:
        raise ValueError(f"person {person.size} and mask {mask.size} must have the same size")
    size = (width, height)
    # same policy as the reference: Lanczos resize, then binarise at 0.5
    mask_resized = resize_and_crop(mask.convert("L"), size)
    binary = Image.fromarray(((np.asarray(mask_resized) >= 128) * 255).astype(np.uint8), "L")
    return TryOnInputs(
        person=resize_and_crop(person.convert("RGB"), size),
        garment=resize_and_padding(garment.convert("RGB"), size),
        mask=binary,
    )
