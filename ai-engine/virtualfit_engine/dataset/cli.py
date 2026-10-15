"""Dataset CLI.

    python -m virtualfit_engine.dataset.cli prepare --root /data/VITON-HD --out runs/exp1/data
    python -m virtualfit_engine.dataset.cli summary --manifest runs/exp1/data/train.jsonl
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from .viton_hd import (
    DatasetLayout,
    ValidationReport,
    build_records,
    drop_duplicates,
    make_experiment_splits,
    manifest_sha256,
    read_manifest,
    summarize,
    write_manifest,
)


def cmd_prepare(args: argparse.Namespace) -> int:
    root, out = Path(args.root), Path(args.out)
    layout = DatasetLayout()
    reports: dict[str, ValidationReport] = {}
    pools = {}
    for split in ("train", "test"):
        # Scan only as many samples as needed (x3 headroom for invalid/duplicate samples).
        need = (args.n_train + args.n_val) if split == "train" else args.n_heldout
        records, report = build_records(root, split, layout, limit=need * 3)
        records = drop_duplicates(records, report)
        reports[split], pools[split] = report, records
        print(f"[{split}] listed={report.n_listed} valid={len(records)} issues={report.counts()}")
    try:
        splits = make_experiment_splits(
            pools["train"], pools["test"], args.n_train, args.n_val, args.n_heldout, args.seed
        )
    except ValueError as exc:
        print(f"ERROR: cannot build experiment splits: {exc}", file=sys.stderr)
        return 2

    summary = {"seed": args.seed, "root_name": root.name, "splits": {}}
    for name, recs in splits.items():
        write_manifest(out / f"{name}.jsonl", recs)
        summary["splits"][name] = {**summarize(recs), "manifest_sha256": manifest_sha256(recs)}
    summary["validation"] = {
        k: {"listed": v.n_listed, "valid": v.n_valid, "issue_counts": v.counts(), "duplicate_groups": len(v.duplicates)}
        for k, v in reports.items()
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    (out / "issues.json").write_text(
        json.dumps({k: [asdict(i) for i in v.issues] for k, v in reports.items()}, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(summary["splits"], indent=2))
    return 0


def cmd_summary(args: argparse.Namespace) -> int:
    print(json.dumps(summarize(read_manifest(Path(args.manifest))), indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="virtualfit-dataset")
    sub = p.add_subparsers(dest="cmd", required=True)
    prep = sub.add_parser("prepare", help="validate a VITON-HD copy and write train/val/heldout manifests")
    prep.add_argument("--root", required=True, help="VITON-HD dataset root (not redistributed)")
    prep.add_argument("--out", required=True)
    prep.add_argument("--n-train", type=int, default=200)
    prep.add_argument("--n-val", type=int, default=40)
    prep.add_argument("--n-heldout", type=int, default=40)
    prep.add_argument("--seed", type=int, default=42)
    prep.set_defaults(func=cmd_prepare)
    summ = sub.add_parser("summary", help="print statistics for a manifest")
    summ.add_argument("--manifest", required=True)
    summ.set_defaults(func=cmd_summary)
    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
