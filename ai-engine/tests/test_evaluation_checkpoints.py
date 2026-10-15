import csv
import json

import numpy as np
import pytest
from PIL import Image, ImageEnhance

pytest.importorskip("skimage")

from virtualfit_engine.dataset.viton_hd import build_records
from virtualfit_engine.evaluation import metrics as M
from virtualfit_engine.evaluation.run import EvalSettings, evaluate, summarize
from virtualfit_engine.models import inspect_adapter
from virtualfit_engine.training.checkpoints import ADAPTER_CONFIG, ADAPTER_FILE, METADATA_FILE, is_genuine_finetune

GENUINE = {"pretrained_weights_loaded": True, "attention_checkpoint_loaded": True, "optimizer_steps_completed": 10, "completed": True}


@pytest.mark.parametrize(
    "patch,expected",
    [({}, True), ({"pretrained_weights_loaded": False}, False), ({"attention_checkpoint_loaded": False}, False),
     ({"optimizer_steps_completed": 0}, False), ({"completed": False}, False)],
)
def test_genuine_finetune_requires_real_weights_and_real_steps(patch, expected):
    assert is_genuine_finetune({**GENUINE, **patch}) is expected
    assert is_genuine_finetune({}) is False


def test_inspect_adapter_states(tmp_path):
    assert inspect_adapter(None)[0] is False
    assert "missing" in inspect_adapter(str(tmp_path))[1]
    for name in (ADAPTER_FILE, ADAPTER_CONFIG):
        (tmp_path / name).write_bytes(b"x")
    (tmp_path / METADATA_FILE).write_text(json.dumps({**GENUINE, "pretrained_weights_loaded": False}))
    assert inspect_adapter(str(tmp_path))[0] is False
    (tmp_path / METADATA_FILE).write_text(json.dumps(GENUINE))
    assert inspect_adapter(str(tmp_path))[:2] == (True, "ok")


def test_metrics_basic_properties():
    a = Image.new("RGB", (64, 64), (100, 100, 100))
    assert M.psnr(a, a) == float("inf") and M.ssim(a, a) == pytest.approx(1.0)
    mask = Image.fromarray(np.pad(np.full((20, 20), 255, np.uint8), 22))
    changed = a.copy()
    changed.paste((250, 0, 0), (22, 22, 42, 42))  # edit INSIDE the mask only
    assert M.outside_mask_mae(changed, a, mask) == 0.0
    changed.paste((250, 0, 0), (0, 0, 10, 10))  # edit outside
    assert M.outside_mask_mae(changed, a, mask) > 0
    with pytest.raises(ValueError):
        M.outside_mask_mae(a, a, Image.new("L", (64, 64), 255))
    lo, hi = M.bootstrap_ci([1, 2, 3, 4, 5])
    assert lo <= 3 <= hi
    assert "skipped" in M.distribution_metrics_note(40)


def test_evaluate_compares_two_models_on_identical_samples(viton_tree, tmp_path):
    records, _ = build_records(viton_tree, "test")
    # two stub "models": identity-ish (good) and a heavily darkened one (bad)
    good = lambda person, garment, mask: person.resize((48, 64))
    bad = lambda person, garment, mask: ImageEnhance.Brightness(person.resize((48, 64))).enhance(0.3)
    out = tmp_path / "eval"
    settings = EvalSettings(height=64, width=48, use_lpips=False, use_clip=False)
    summary = evaluate(records, viton_tree, {"baseline": good, "custom": bad}, out, settings, do_repaint=False)

    rows = list(csv.DictReader((out / "results.csv").open()))
    assert len(rows) == 2 * len(records)
    assert {r["model"] for r in rows} == {"baseline", "custom"}
    assert all(r["manual_artifact_score_1to5"] == "" for r in rows)  # human-only field stays empty
    assert summary["comparison"]["psnr"]["second_better_in"] == 0  # the darkened model is worse everywhere
    assert summary["comparison"]["psnr"]["second_minus_first_mean"] < 0
    report = (out / "report.md").read_text()
    assert "Paired comparison: custom minus baseline" in report and "FID/KID skipped" in report
    assert (out / "images" / f"{records[0].id}__baseline.png").is_file()


def test_summarize_never_invents_missing_metrics():
    rows = [{"id": "a", "model": "m", "psnr": 20.0, "latency_s": 1.0, "peak_gpu_gb": None, "lpips": None}]
    s = summarize(rows, 1)
    assert "lpips" not in s["models"]["m"] and s["models"]["m"]["peak_gpu_gb_max"] is None
