"""Safe image decoding and the two resize policies used by CatVTON."""

from __future__ import annotations

import io
from hashlib import sha1

from PIL import Image, ImageOps

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MIN_DIMENSION = 128
MAX_DIMENSION = 8000


class ImageError(ValueError):
    """Raised for uploads that are not valid JPEG/PNG images."""


def sniff_image_type(data: bytes) -> str | None:
    """Real type from magic bytes. The client-declared content type is never trusted."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == PNG_SIGNATURE:
        return "image/png"
    return None


def load_image_bytes(data: bytes, label: str = "image", max_bytes: int | None = None) -> Image.Image:
    """Decode an uploaded JPEG/PNG into an RGB image (EXIF orientation applied, metadata dropped)."""
    if max_bytes is not None and len(data) > max_bytes:
        raise ImageError(f"{label} is larger than {max_bytes // (1024 * 1024)} MB")
    if sniff_image_type(data) is None:
        raise ImageError(f"{label} must be a JPEG or PNG image")
    try:
        with Image.open(io.BytesIO(data)) as probe:
            width, height = probe.size
            if not (MIN_DIMENSION <= width <= MAX_DIMENSION and MIN_DIMENSION <= height <= MAX_DIMENSION):
                raise ImageError(
                    f"{label} must be between {MIN_DIMENSION} and {MAX_DIMENSION}px on each side"
                )
        # Re-open: verify() would invalidate the first handle. load() forces full decoding,
        # so truncated files are rejected here and not later in the pipeline.
        with Image.open(io.BytesIO(data)) as img:
            img = ImageOps.exif_transpose(img)
            img.load()
            return img.convert("RGB")
    except ImageError:
        raise
    except Exception as exc:  # corrupt / truncated / decompression bomb
        raise ImageError(f"{label} is corrupt or unreadable") from exc


def to_png_bytes(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def file_sha1(path: str) -> str:
    h = sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def resize_and_crop(image: Image.Image, size: tuple[int, int], resample=Image.LANCZOS) -> Image.Image:
    """Center-crop to the target aspect ratio, then resize (used for person and mask)."""
    w, h = image.size
    target_w, target_h = size
    if w / h < target_w / target_h:
        new_w, new_h = w, w * target_h // target_w
    else:
        new_h, new_w = h, h * target_w // target_h
    left, top = (w - new_w) // 2, (h - new_h) // 2
    image = image.crop((left, top, left + new_w, top + new_h))
    return image.resize(size, resample)


def resize_and_padding(image: Image.Image, size: tuple[int, int], fill=(255, 255, 255)) -> Image.Image:
    """Fit inside the target size keeping aspect ratio, pad with white (used for garments)."""
    w, h = image.size
    target_w, target_h = size
    if w / h < target_w / target_h:
        new_h, new_w = target_h, w * target_h // h
    else:
        new_w, new_h = target_w, h * target_w // w
    image = image.resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new("RGB", size, fill)
    canvas.paste(image, ((target_w - new_w) // 2, (target_h - new_h) // 2))
    return canvas
