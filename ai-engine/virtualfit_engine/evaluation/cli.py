"""Baseline-vs-custom evaluation on a GPU.

    python -m virtualfit_engine.evaluation.cli \
        --root /content/drive/MyDrive/virtualfit/VITON-HD \
        --manifest runs/exp1/data/heldout.jsonl \
        --adapter runs/exp1/adapter --out runs/exp1/eval

The same resident UNet produces both columns: "baseline" runs with the LoRA adapter disabled
(the untouched pretrained CatVTON weights) and "custom" with it enabled, using identical samples,
seed, steps and guidance.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ..dataset.viton_hd import read_manifest
from ..models import EngineModels, ModelPaths, inspect_adapter
from .run import EvalSettings, evaluate


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="virtualfit-eval")
    p.add_argument("--root", required=True, help="VITON-HD root (not redistributed)")
    p.add_argument("--manifest", required=True, help="held-out manifest (heldout.jsonl)")
    p.add_argument("--adapter", required=True, help="adapter dir produced by training")
    p.add_argument("--out", required=True)
    p.add_argument("--steps", type=int, default=30)
    p.add_argument("--guidance", type=float, default=2.5)
    p.add_argument("--seed", type=int, default=555)
    p.add_argument("--no-lpips", action="store_true")
    p.add_argument("--no-clip", action="store_true")
    p.add_argument("--limit", type=int, default=None, help="evaluate only the first N samples")
    args = p.parse_args(argv)

    import torch

    usable, why, meta = inspect_adapter(args.adapter)
    if not usable:
        print(f"ERROR: adapter is not a genuine fine-tune: {why}")
        return 2
    records = read_manifest(Path(args.manifest))
    if args.limit:
        records = records[: args.limit]
    if any(r.split != "test" for r in records):
        print("ERROR: the evaluation manifest must contain official TEST samples only (held-out)")
        return 2

    paths = ModelPaths(adapter_dir=args.adapter)
    models = EngineModels(paths)
    settings = EvalSettings(height=paths.height, width=paths.width, seed=args.seed, steps=args.steps,
                            guidance=args.guidance, use_lpips=not args.no_lpips, use_clip=not args.no_clip)

    def generator(variant: str):
        def run(person, garment, mask):
            pipe = models.pipeline(variant)
            gen = torch.Generator(device="cpu").manual_seed(settings.seed)
            return pipe(person, garment, mask, settings.steps, settings.guidance, settings.height, settings.width, gen)
        return run

    summary = evaluate(records, args.root, {"baseline": generator("pretrained"), "custom": generator("custom")}, args.out, settings)
    (Path(args.out) / "adapter_metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print((Path(args.out) / "report.md").read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
