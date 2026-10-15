"""Baseline-vs-custom evaluation on identical inputs and generation settings.

`evaluate()` is model-agnostic: it takes named generator callables, so the original pretrained
model and the fine-tuned model are measured by exactly the same code, samples, seed and steps.
Nothing is estimated or filled in: a metric that cannot be computed is left empty with the reason.
"""

from __future__ import annotations

import csv
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from PIL import Image

from ..dataset.viton_hd import Record
from ..training.data import load_record_mask
from ..postprocessing import repaint
from ..preprocessing import prepare_inputs
from . import metrics as M

Generator = Callable[[Image.Image, Image.Image, Image.Image], Image.Image]  # person, garment, mask -> result


@dataclass
class EvalSettings:
    height: int = 512
    width: int = 384
    seed: int = 555
    steps: int = 50
    guidance: float = 2.5
    use_lpips: bool = True
    use_clip: bool = True


def _peak_gpu_gb() -> float | None:
    try:
        import torch

        return round(torch.cuda.max_memory_allocated() / 1024**3, 3) if torch.cuda.is_available() else None
    except ImportError:
        return None


def _reset_gpu_peak() -> None:
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
            torch.cuda.synchronize()
    except ImportError:
        pass


def evaluate(
    records: list[Record],
    root: str | Path,
    generators: dict[str, Generator],
    out_dir: str | Path,
    settings: EvalSettings = EvalSettings(),
    do_repaint: bool = True,
) -> dict:
    root, out = Path(root), Path(out_dir)
    (out / "images").mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    for rec in records:
        person = Image.open(root / rec.person).convert("RGB")
        garment = Image.open(root / rec.cloth).convert("RGB")
        mask = load_record_mask(root, rec)
        prep = prepare_inputs(person, garment, mask, settings.width, settings.height)
        for name, gen in generators.items():
            _reset_gpu_peak()
            t0 = time.perf_counter()
            result = gen(person, garment, mask)
            try:
                import torch

                if torch.cuda.is_available():
                    torch.cuda.synchronize()
            except ImportError:
                pass
            latency = time.perf_counter() - t0
            if do_repaint:
                result = repaint(prep.person, prep.mask, result)
            result.save(out / "images" / f"{rec.id}__{name}.png")

            row = {"id": rec.id, "model": name, "latency_s": round(latency, 3), "peak_gpu_gb": _peak_gpu_gb()}
            row["psnr"] = round(M.psnr(result, prep.person), 4)
            row["ssim"] = round(M.ssim(result, prep.person), 4)
            row["outside_mask_mae"] = round(M.outside_mask_mae(result, prep.person, prep.mask), 5)
            row["lpips"] = round(M.lpips_distance(result, prep.person), 4) if settings.use_lpips else None
            row["clip_garment_sim"] = (
                round(M.clip_garment_similarity(result, prep.garment, prep.mask), 4) if settings.use_clip else None
            )
            row["manual_artifact_score_1to5"] = ""  # to be filled by a human reviewer
            rows.append(row)

    out.mkdir(parents=True, exist_ok=True)
    fields = list(rows[0].keys()) if rows else []
    with (out / "results.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    summary = summarize(rows, len(records))
    (out / "summary.json").write_text(json.dumps({"settings": settings.__dict__, **summary}, indent=2), encoding="utf-8")
    (out / "report.md").write_text(render_report(summary, settings), encoding="utf-8")
    return summary


_HIGHER_BETTER = {"psnr": True, "ssim": True, "clip_garment_sim": True, "lpips": False, "outside_mask_mae": False, "latency_s": False}


def summarize(rows: list[dict], n_samples: int) -> dict:
    models = sorted({r["model"] for r in rows})
    metrics = [k for k in _HIGHER_BETTER if any(r.get(k) is not None for r in rows)]
    per_model = {}
    for m in models:
        mine = [r for r in rows if r["model"] == m]
        per_model[m] = {}
        for k in metrics:
            vals = [r[k] for r in mine if r.get(k) is not None]
            if vals:
                lo, hi = M.bootstrap_ci(vals)
                per_model[m][k] = {"mean": sum(vals) / len(vals), "ci95": [lo, hi], "n": len(vals)}
        peaks = [r["peak_gpu_gb"] for r in mine if r.get("peak_gpu_gb") is not None]
        per_model[m]["peak_gpu_gb_max"] = max(peaks) if peaks else None

    comparisons = {}
    if len(models) == 2:
        a, b = models
        by_id = {m: {r["id"]: r for r in rows if r["model"] == m} for m in models}
        shared = sorted(set(by_id[a]) & set(by_id[b]))
        for k in metrics:
            diffs = [by_id[b][i][k] - by_id[a][i][k] for i in shared if by_id[a][i].get(k) is not None and by_id[b][i].get(k) is not None]
            if not diffs:
                continue
            lo, hi = M.bootstrap_ci(diffs)
            better = (lambda d: d > 0) if _HIGHER_BETTER[k] else (lambda d: d < 0)
            comparisons[k] = {
                "second_minus_first_mean": sum(diffs) / len(diffs),
                "ci95": [lo, hi],
                "second_better_in": sum(1 for d in diffs if better(d)),
                "n_pairs": len(diffs),
                "ci_excludes_zero": bool(lo > 0 or hi < 0),
            }
        comparisons["_models"] = {"first": a, "second": b}
    return {
        "n_samples": n_samples,
        "models": per_model,
        "comparison": comparisons,
        "distribution_metrics": M.distribution_metrics_note(n_samples),
    }


def render_report(summary: dict, settings: EvalSettings) -> str:
    lines = ["# Evaluation report", "", f"Samples: **{summary['n_samples']}** (held-out, never used for training)", ""]
    lines += [f"Settings: {settings.__dict__}", ""]
    metrics = sorted({k for m in summary["models"].values() for k in m if k != "peak_gpu_gb_max"})
    lines += ["| model | " + " | ".join(metrics) + " | peak GPU GB |", "|" + "---|" * (len(metrics) + 2)]
    for name, data in summary["models"].items():
        cells = [f"{data[k]['mean']:.4f} [{data[k]['ci95'][0]:.4f}, {data[k]['ci95'][1]:.4f}]" if k in data else "-" for k in metrics]
        lines.append(f"| {name} | " + " | ".join(cells) + f" | {data['peak_gpu_gb_max']} |")
    cmp_ = summary["comparison"]
    if cmp_:
        a, b = cmp_["_models"]["first"], cmp_["_models"]["second"]
        lines += ["", f"## Paired comparison: {b} minus {a}", "", "| metric | mean diff | 95% CI | better in | CI excludes 0 |", "|---|---|---|---|---|"]
        for k, v in cmp_.items():
            if k == "_models":
                continue
            lines.append(f"| {k} | {v['second_minus_first_mean']:+.4f} | [{v['ci95'][0]:+.4f}, {v['ci95'][1]:+.4f}] | {v['second_better_in']}/{v['n_pairs']} | {'yes' if v['ci_excludes_zero'] else 'no'} |")
    lines += ["", f"_{summary['distribution_metrics']}_", "",
              "Caveats: PSNR/SSIM/LPIPS compare against the original photo (paired reconstruction), not against a perceptual",
              "'realism' ground truth. outside_mask_mae and clip_garment_sim are proxies for identity and garment-detail",
              "preservation. Visual artifacts are NOT measured automatically: fill `manual_artifact_score_1to5` in results.csv.",
              "With a few dozen samples differences are only indicative; check the confidence intervals."]
    return "\n".join(lines) + "\n"
