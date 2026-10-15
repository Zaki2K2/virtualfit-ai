"""Torch dataset over a manifest produced by `dataset.cli prepare` (real files only)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
from PIL import Image
from torch.utils.data import Dataset

from ..dataset.viton_hd import DatasetLayout, Record
from ..preprocessing import image_to_array, mask_from_parsing, mask_to_array, prepare_inputs


def load_record_mask(root: Path, record: Record, layout: DatasetLayout = DatasetLayout()) -> Image.Image:
    """Mask image (L, 0/255) for a record: dataset-provided if present, otherwise the documented
    parse-derived approximation."""
    if record.mask_source == "agnostic-mask" and record.mask:
        return Image.open(root / record.mask).convert("L")
    if record.mask_source == "parse-derived" and record.parse:
        parse = np.asarray(Image.open(root / record.parse))
        m = mask_from_parsing(parse, layout.parse_labels, layout.parse_dilate_px)[0]
        return Image.fromarray((m * 255).astype(np.uint8), "L")
    raise ValueError(f"record {record.id} has no usable mask source ({record.mask_source})")


class TryOnTrainDataset(Dataset):
    """Paired samples: person photo, its own garment photo and a try-on mask. The training target
    is the original person photo (reconstruction), so no synthetic labels are ever created."""

    def __init__(self, records: list[Record], root: str | Path, width: int, height: int):
        if not records:
            raise ValueError("empty manifest")
        self.records, self.root, self.width, self.height = records, Path(root), width, height

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor]:
        r = self.records[idx]
        person = Image.open(self.root / r.person).convert("RGB")
        cloth = Image.open(self.root / r.cloth).convert("RGB")
        mask = load_record_mask(self.root, r)
        inputs = prepare_inputs(person, cloth, mask, self.width, self.height)
        return {
            "person": torch.from_numpy(image_to_array(inputs.person)),
            "garment": torch.from_numpy(image_to_array(inputs.garment)),
            "mask": torch.from_numpy(mask_to_array(inputs.mask)),
        }
