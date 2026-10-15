"""VITON-HD dataset manifest, validation and experiment splits.

The dataset is NOT redistributed: point `--root` at a copy you downloaded yourself from
https://github.com/shadow2496/VITON-HD (license CC BY-NC 4.0, research use only).

Expected layout (names are configurable through `DatasetLayout`; nothing is assumed silently -
missing folders are reported as issues):

    <root>/train_pairs.txt, <root>/test_pairs.txt      "person.jpg cloth.jpg" per line
    <root>/{train,test}/image/*.jpg                    person photos
    <root>/{train,test}/cloth/*.jpg                    garment photos
    <root>/{train,test}/agnostic-mask/<stem>_mask.png  (preferred) cloth-agnostic masks
    <root>/{train,test}/image-parse-v3/<stem>.png      (fallback) human parsing label maps
"""

from __future__ import annotations

import hashlib
import json
import random
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image

from ..images import file_sha1
from ..preprocessing import PARSE_UPPER_BODY_LABELS, mask_from_parsing, validate_mask

SPLITS = ("train", "test")
CATEGORY = "upper_body"  # VITON-HD contains frontal-view women with top garments only


@dataclass(frozen=True)
class DatasetLayout:
    image_dir: str = "image"
    cloth_dir: str = "cloth"
    mask_dir: str = "agnostic-mask"
    parse_dir: str = "image-parse-v3"
    pairs_files: tuple[tuple[str, str], ...] = (("train", "train_pairs.txt"), ("test", "test_pairs.txt"))
    mask_suffixes: tuple[str, ...] = ("_mask.png", ".png")
    parse_labels: tuple[int, ...] = PARSE_UPPER_BODY_LABELS
    parse_dilate_px: int = 8

    def pairs_file(self, split: str) -> str:
        return dict(self.pairs_files)[split]


@dataclass
class Record:
    id: str
    split: str  # official split the files come from: "train" or "test"
    person: str  # paths relative to the dataset root
    cloth: str
    mask: str | None
    parse: str | None
    mask_source: str  # "agnostic-mask" | "parse-derived" | "none"
    category: str
    person_sha1: str
    cloth_sha1: str
    width: int
    height: int
    unpaired_cloth: str | None = None  # cloth from the official pairs file when it differs


@dataclass
class Issue:
    record_id: str
    code: str
    message: str


@dataclass
class ValidationReport:
    n_listed: int = 0
    n_valid: int = 0
    issues: list[Issue] = field(default_factory=list)
    duplicates: list[list[str]] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        return dict(Counter(i.code for i in self.issues))


def read_pairs(path: Path) -> list[tuple[str, str]]:
    pairs = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        parts = line.split()
        if len(parts) != 2:
            raise ValueError(f"{path}:{n}: expected 'person cloth', got {line!r}")
        pairs.append((parts[0], parts[1]))
    return pairs


def _find_mask(split_dir: Path, layout: DatasetLayout, stem: str) -> Path | None:
    for suffix in layout.mask_suffixes:
        candidate = split_dir / layout.mask_dir / f"{stem}{suffix}"
        if candidate.is_file():
            return candidate
    return None


def _check_image(path: Path) -> tuple[tuple[int, int] | None, str | None]:
    """Fully decode an image; returns (size, error)."""
    try:
        with Image.open(path) as img:
            img.load()
            return img.size, None
    except Exception as exc:  # corrupt or truncated
        return None, f"{type(exc).__name__}: {exc}"


def build_records(
    root: Path, split: str, layout: DatasetLayout = DatasetLayout(), limit: int | None = None
) -> tuple[list[Record], ValidationReport]:
    """Scan one official split. Only PAIRED samples (person with its own garment) are kept as
    training material; the official unpaired garment is recorded for qualitative evaluation."""
    root = Path(root)
    report = ValidationReport()
    split_dir = root / split
    pairs_path = root / layout.pairs_file(split)
    if not pairs_path.is_file():
        report.issues.append(Issue("-", "missing_pairs_file", f"{pairs_path} not found"))
        return [], report
    for sub in (layout.image_dir, layout.cloth_dir):
        if not (split_dir / sub).is_dir():
            report.issues.append(Issue("-", "missing_directory", f"{split_dir / sub} not found"))
    if report.issues:
        return [], report

    pairs = read_pairs(pairs_path)
    report.n_listed = len(pairs)
    seen: set[str] = set()
    records: list[Record] = []
    for person_name, cloth_name in pairs:
        if limit is not None and len(records) >= limit:
            break
        stem = Path(person_name).stem
        if stem in seen:
            report.issues.append(Issue(stem, "duplicate_pair", "person listed more than once"))
            continue
        seen.add(stem)

        person_path = split_dir / layout.image_dir / person_name
        own_cloth_path = split_dir / layout.cloth_dir / person_name  # paired = same file name
        errors = []
        sizes = {}
        for key, p in (("person", person_path), ("cloth", own_cloth_path)):
            if not p.is_file():
                errors.append(Issue(stem, f"missing_{key}", f"{p} not found"))
                continue
            size, err = _check_image(p)
            if err:
                errors.append(Issue(stem, f"corrupt_{key}", err))
            else:
                sizes[key] = size
        if errors:
            report.issues.extend(errors)
            continue

        mask_path = _find_mask(split_dir, layout, stem)
        parse_path = split_dir / layout.parse_dir / f"{stem}.png"
        parse_rel = str(parse_path.relative_to(root)) if parse_path.is_file() else None
        if mask_path is not None:
            mask_source, mask_rel = "agnostic-mask", str(mask_path.relative_to(root))
            m = np.asarray(Image.open(mask_path).convert("L"), dtype=np.float32)[None] / 255.0
            m = (m >= 0.5).astype(np.float32)
            ok, why = validate_mask(m)
            if not ok:
                report.issues.append(Issue(stem, "bad_mask", why))
                continue
            if Image.open(mask_path).size != sizes["person"]:
                report.issues.append(Issue(stem, "mask_size_mismatch", "mask size differs from person"))
                continue
        elif parse_rel is not None:
            mask_source, mask_rel = "parse-derived", None
            parse = np.asarray(Image.open(parse_path))
            if parse.shape[::-1] != sizes["person"]:
                report.issues.append(Issue(stem, "parse_size_mismatch", "parse map size differs from person"))
                continue
            ok, why = validate_mask(
                mask_from_parsing(parse, layout.parse_labels, layout.parse_dilate_px)
            )
            if not ok:
                report.issues.append(Issue(stem, "bad_mask", f"parse-derived mask: {why}"))
                continue
        else:
            report.issues.append(Issue(stem, "missing_mask", "neither agnostic-mask nor parsing map found"))
            continue

        if sizes["person"] != sizes["cloth"] and min(sizes["person"]) < 256:
            report.issues.append(Issue(stem, "too_small", f"person is {sizes['person']}"))
            continue

        records.append(
            Record(
                id=stem,
                split=split,
                person=str(person_path.relative_to(root)),
                cloth=str(own_cloth_path.relative_to(root)),
                mask=mask_rel,
                parse=parse_rel,
                mask_source=mask_source,
                category=CATEGORY,
                person_sha1=file_sha1(str(person_path)),
                cloth_sha1=file_sha1(str(own_cloth_path)),
                width=sizes["person"][0],
                height=sizes["person"][1],
                unpaired_cloth=cloth_name if cloth_name != person_name else None,
            )
        )
    report.n_valid = len(records)
    return records, report


def drop_duplicates(records: list[Record], report: ValidationReport | None = None) -> list[Record]:
    """Remove records whose person image is byte-identical to an earlier one (kept: first)."""
    groups: dict[str, list[str]] = {}
    kept: list[Record] = []
    for r in records:
        groups.setdefault(r.person_sha1, []).append(r.id)
        if len(groups[r.person_sha1]) == 1:
            kept.append(r)
    dups = [ids for ids in groups.values() if len(ids) > 1]
    if report is not None:
        report.duplicates.extend(dups)
    return kept


def make_experiment_splits(
    train_pool: list[Record],
    test_pool: list[Record],
    n_train: int = 200,
    n_val: int = 40,
    n_heldout: int = 40,
    seed: int = 42,
) -> dict[str, list[Record]]:
    """train/val come from the OFFICIAL TRAIN split; the held-out set comes from the OFFICIAL TEST
    split and is only ever used for evaluation. Raises if the pools are too small instead of
    silently shrinking the experiment, and verifies there is no id/content leakage."""
    if any(r.split != "train" for r in train_pool):
        raise ValueError("train_pool must contain official train records only")
    if any(r.split != "test" for r in test_pool):
        raise ValueError("test_pool must contain official test records only")
    if len(train_pool) < n_train + n_val:
        raise ValueError(f"need {n_train + n_val} valid train samples, found {len(train_pool)}")
    if len(test_pool) < n_heldout:
        raise ValueError(f"need {n_heldout} valid test samples, found {len(test_pool)}")

    rng = random.Random(seed)
    train_shuffled = sorted(train_pool, key=lambda r: r.id)
    rng.shuffle(train_shuffled)
    test_shuffled = sorted(test_pool, key=lambda r: r.id)
    rng.shuffle(test_shuffled)
    splits = {
        "train": train_shuffled[:n_train],
        "val": train_shuffled[n_train : n_train + n_val],
        "heldout": test_shuffled[:n_heldout],
    }
    assert_no_leakage(splits)
    return splits


def assert_no_leakage(splits: dict[str, list[Record]]) -> None:
    """No id, person image or garment image may appear in two experiment splits."""
    owner: dict[tuple[str, str], str] = {}
    for name, recs in splits.items():
        for r in recs:
            for kind, key in (("id", r.id), ("person", r.person_sha1), ("cloth", r.cloth_sha1)):
                prev = owner.setdefault((kind, key), name)
                if prev != name:
                    raise ValueError(f"leakage: {kind} {key[:12]} is in both '{prev}' and '{name}'")
    forbidden = {r.id for r in splits.get("train", []) + splits.get("val", []) if r.split == "test"}
    if forbidden:
        raise ValueError(f"official test samples found in training splits: {sorted(forbidden)[:5]}")


def summarize(records: Iterable[Record]) -> dict:
    recs = list(records)
    if not recs:
        return {"count": 0}
    widths = [r.width for r in recs]
    heights = [r.height for r in recs]
    return {
        "count": len(recs),
        "mask_sources": dict(Counter(r.mask_source for r in recs)),
        "categories": dict(Counter(r.category for r in recs)),
        "resolution": {
            "width": [min(widths), max(widths)],
            "height": [min(heights), max(heights)],
        },
    }


def manifest_sha256(records: list[Record]) -> str:
    payload = json.dumps([asdict(r) for r in records], sort_keys=True).encode()
    return hashlib.sha256(payload).hexdigest()


def write_manifest(path: Path, records: list[Record]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(asdict(r), sort_keys=True) + "\n")


def read_manifest(path: Path) -> list[Record]:
    with Path(path).open(encoding="utf-8") as f:
        return [Record(**json.loads(line)) for line in f if line.strip()]
