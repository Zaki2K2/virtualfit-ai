import io

import numpy as np
import pytest
from PIL import Image

from conftest import png_bytes
from virtualfit_engine.images import ImageError, load_image_bytes, resize_and_crop, resize_and_padding, sniff_image_type
from virtualfit_engine.preprocessing import (
    apply_mask,
    dilate_mask,
    image_to_array,
    mask_coverage,
    mask_from_parsing,
    mask_to_array,
    prepare_inputs,
    validate_mask,
)


def test_sniff_uses_magic_bytes_not_declared_type():
    assert sniff_image_type(png_bytes()) == "image/png"
    assert sniff_image_type(png_bytes(fmt="JPEG")) == "image/jpeg"
    assert sniff_image_type(b"GIF89a....") is None
    assert sniff_image_type(b"") is None


def test_load_accepts_valid_and_rejects_bad_uploads():
    img = load_image_bytes(png_bytes(200, 300))
    assert img.size == (200, 300) and img.mode == "RGB"
    with pytest.raises(ImageError, match="JPEG or PNG"):
        load_image_bytes(b"<html>not an image</html>")
    with pytest.raises(ImageError, match="corrupt"):
        load_image_bytes(png_bytes(200, 300)[:60])  # valid header, truncated body
    with pytest.raises(ImageError, match="between"):
        load_image_bytes(png_bytes(40, 40))
    with pytest.raises(ImageError, match="larger"):
        load_image_bytes(png_bytes(200, 300), max_bytes=100)


def test_exif_orientation_is_applied_and_metadata_dropped():
    src = Image.new("RGB", (300, 200), (10, 20, 30))
    exif = Image.Exif()
    exif[274] = 6  # rotate 90
    buf = io.BytesIO()
    src.save(buf, format="JPEG", exif=exif)
    out = load_image_bytes(buf.getvalue())
    assert out.size == (200, 300)
    assert not out.getexif()


def test_resize_policies():
    img = Image.new("RGB", (400, 400), (255, 0, 0))
    cropped = resize_and_crop(img, (384, 512))
    assert cropped.size == (384, 512)
    padded = resize_and_padding(img, (384, 512))
    assert padded.size == (384, 512)
    assert padded.getpixel((0, 0)) == (255, 255, 255)  # padding is white
    assert padded.getpixel((192, 256)) == (255, 0, 0)  # content centred


def test_array_conventions_match_reference():
    arr = image_to_array(Image.new("RGB", (4, 2), (255, 0, 127)))
    assert arr.shape == (3, 2, 4) and arr.dtype == np.float32
    assert arr[0].max() == 1.0 and arr[1].min() == -1.0
    m = mask_to_array(Image.fromarray(np.array([[0, 100, 200, 255]], np.uint8)))
    assert m.shape == (1, 1, 4) and set(np.unique(m)) <= {0.0, 1.0}
    assert m.tolist() == [[[0.0, 0.0, 1.0, 1.0]]]


def test_apply_mask_zeroes_masked_pixels_only():
    person = np.ones((3, 2, 2), np.float32)
    mask = np.array([[[1, 0], [0, 0]]], np.float32)
    out = apply_mask(person, mask)
    assert out[:, 0, 0].tolist() == [0, 0, 0] and out[:, 0, 1].tolist() == [1, 1, 1]


def test_validate_mask_flags_empty_and_full_masks():
    ok = np.zeros((1, 100, 100), np.float32)
    ok[0, 20:60, 20:60] = 1
    assert validate_mask(ok)[0]
    assert not validate_mask(np.zeros((1, 100, 100), np.float32))[0]
    assert not validate_mask(np.ones((1, 100, 100), np.float32))[0]
    assert not validate_mask(np.ones((100, 100), np.float32))[0]
    assert mask_coverage(ok) == pytest.approx(0.16)


def test_dilate_and_parse_mask():
    m = np.zeros((1, 11, 11), np.float32)
    m[0, 5, 5] = 1
    d = dilate_mask(m, 2)
    assert d.sum() == 25 and d[0, 3:8, 3:8].all()
    parse = np.zeros((20, 20), np.uint8)
    parse[5:10, 5:10] = 5  # upper-clothes
    parse[12:15, 12:15] = 9  # trousers: must NOT be masked
    mask = mask_from_parsing(parse, dilate_px=0)
    assert mask[0, 6, 6] == 1 and mask[0, 13, 13] == 0


def test_prepare_inputs_sizes_and_mismatch():
    person, garment = Image.new("RGB", (96, 128)), Image.new("RGB", (80, 80))
    mask = Image.fromarray(np.full((128, 96), 255, np.uint8))
    prepared = prepare_inputs(person, garment, mask, width=48, height=64)
    assert prepared.person.size == prepared.garment.size == prepared.mask.size == (48, 64)
    assert set(np.unique(np.asarray(prepared.mask))) <= {0, 255}
    with pytest.raises(ValueError, match="same size"):
        prepare_inputs(person, garment, Image.new("L", (10, 10)), 48, 64)
