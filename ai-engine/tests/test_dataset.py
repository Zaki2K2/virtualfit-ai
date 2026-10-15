import json
import shutil

import pytest
from PIL import Image

from conftest import make_viton_tree
from virtualfit_engine.dataset import cli
from virtualfit_engine.dataset.viton_hd import (
    build_records,
    drop_duplicates,
    make_experiment_splits,
    manifest_sha256,
    read_manifest,
    summarize,
    write_manifest,
)


def test_build_records_on_valid_tree(viton_tree):
    records, report = build_records(viton_tree, "train")
    assert report.n_listed == 12 and len(records) == 12 and not report.issues
    r = records[0]
    assert r.mask_source == "agnostic-mask" and r.category == "upper_body"
    assert r.person.startswith("train") and (viton_tree / r.person).is_file()
    assert r.unpaired_cloth and r.unpaired_cloth != r.id + ".jpg"


def test_missing_directories_and_pairs_are_reported(tmp_path):
    _, report = build_records(tmp_path, "train")
    assert report.counts() == {"missing_pairs_file": 1}
    (tmp_path / "train_pairs.txt").write_text("a.jpg b.jpg\n")
    _, report = build_records(tmp_path, "train")
    assert "missing_directory" in report.counts()


def test_corrupt_missing_and_bad_mask_samples_are_excluded(tmp_path):
    root = make_viton_tree(tmp_path / "d", n_train=6, n_test=2)
    (root / "train/image/000001_00.jpg").write_bytes(b"not a jpeg")  # corrupt person
    (root / "train/cloth/000002_00.jpg").unlink()  # missing garment
    (root / "train/agnostic-mask/000003_00_mask.png").unlink()  # missing mask
    Image.new("L", (96, 128), 255).save(root / "train/agnostic-mask/000004_00_mask.png")  # covers 100%
    records, report = build_records(root, "train")
    assert {r.id for r in records} == {"000000_00", "000005_00"}
    counts = report.counts()
    assert counts["corrupt_person"] == counts["missing_cloth"] == counts["missing_mask"] == counts["bad_mask"] == 1


def test_parse_derived_mask_fallback(tmp_path):
    root = make_viton_tree(tmp_path / "d", n_train=3, n_test=1, masks="parse")
    records, report = build_records(root, "train")
    assert len(records) == 3 and all(r.mask_source == "parse-derived" for r in records)
    assert not report.issues


def test_mask_size_mismatch_detected(tmp_path):
    root = make_viton_tree(tmp_path / "d", n_train=2, n_test=1)
    Image.new("L", (50, 50), 0).save(root / "train/agnostic-mask/000000_00_mask.png")
    _, report = build_records(root, "train")
    assert {"bad_mask", "mask_size_mismatch"} & set(report.counts())


def test_duplicates_are_dropped(tmp_path):
    root = make_viton_tree(tmp_path / "d", n_train=4, n_test=1)
    shutil.copy(root / "train/image/000000_00.jpg", root / "train/image/000001_00.jpg")  # same bytes
    records, report = build_records(root, "train")
    kept = drop_duplicates(records, report)
    assert len(kept) == 3 and report.duplicates == [["000000_00", "000001_00"]]


def test_splits_are_disjoint_and_official_test_never_trains(viton_tree):
    train, _ = build_records(viton_tree, "train")
    test, _ = build_records(viton_tree, "test")
    splits = make_experiment_splits(train, test, n_train=8, n_val=4, n_heldout=5, seed=1)
    assert {k: len(v) for k, v in splits.items()} == {"train": 8, "val": 4, "heldout": 5}
    assert all(r.split == "train" for r in splits["train"] + splits["val"])
    assert all(r.split == "test" for r in splits["heldout"])
    assert not {r.id for r in splits["train"]} & {r.id for r in splits["val"]}
    # deterministic for a seed, different for another
    again = make_experiment_splits(train, test, 8, 4, 5, seed=1)
    assert [r.id for r in again["train"]] == [r.id for r in splits["train"]]
    other = make_experiment_splits(train, test, 8, 4, 5, seed=2)
    assert [r.id for r in other["train"]] != [r.id for r in splits["train"]]


def test_splits_refuse_to_shrink_or_mix_pools(viton_tree):
    train, _ = build_records(viton_tree, "train")
    test, _ = build_records(viton_tree, "test")
    with pytest.raises(ValueError, match="need 300"):
        make_experiment_splits(train, test, n_train=200, n_val=100, n_heldout=5)
    with pytest.raises(ValueError, match="official train"):
        make_experiment_splits(test, test, 2, 2, 2)
    with pytest.raises(ValueError, match="official test"):
        make_experiment_splits(train, train, 2, 2, 2)


def test_content_leakage_between_splits_is_caught(viton_tree):
    train, _ = build_records(viton_tree, "train")
    test, _ = build_records(viton_tree, "test")
    test[0].person_sha1 = train[0].person_sha1  # same photo in official train and test
    with pytest.raises(ValueError, match="leakage"):
        make_experiment_splits(sorted(train, key=lambda r: r.id), test, n_train=12, n_val=0, n_heldout=6)


def test_manifest_roundtrip_hash_and_summary(viton_tree, tmp_path):
    train, _ = build_records(viton_tree, "train")
    write_manifest(tmp_path / "m.jsonl", train)
    back = read_manifest(tmp_path / "m.jsonl")
    assert back == train and manifest_sha256(back) == manifest_sha256(train)
    s = summarize(train)
    assert s["count"] == 12 and s["mask_sources"] == {"agnostic-mask": 12} and s["resolution"]["width"] == [96, 96]


def test_cli_prepare_end_to_end_and_failure(viton_tree, tmp_path, capsys):
    out = tmp_path / "out"
    rc = cli.main(["prepare", "--root", str(viton_tree), "--out", str(out), "--n-train", "6", "--n-val", "3", "--n-heldout", "4"])
    assert rc == 0
    summary = json.loads((out / "summary.json").read_text())
    assert summary["splits"]["train"]["count"] == 6 and summary["splits"]["heldout"]["count"] == 4
    assert (out / "train.jsonl").is_file() and (out / "issues.json").is_file()
    # asking for more than exists fails loudly instead of silently shrinking
    rc = cli.main(["prepare", "--root", str(viton_tree), "--out", str(tmp_path / "o2"), "--n-train", "200", "--n-val", "40", "--n-heldout", "40"])
    assert rc == 2
    assert cli.main(["summary", "--manifest", str(out / "train.jsonl")]) == 0
