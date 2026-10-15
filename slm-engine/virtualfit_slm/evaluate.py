"""Evaluate the real Express styling route; save per-case outputs and explicit failures."""
import argparse
import json
from pathlib import Path
import time
import urllib.error
import urllib.request

from .data import load_records

ROOT = Path(__file__).resolve().parents[1]


def score(expected, actual):
    wanted, got = set(expected["itemIds"]), set(actual["itemIds"])
    return {"exact_ids": wanted == got, "precision": len(wanted & got) / len(got) if got else float(not wanted),
        "recall": len(wanted & got) / len(wanted) if wanted else float(not got),
        "categories_exact": set(expected["categories"]) == set(actual["categories"])}


def evaluate(url, records):
    cases = []
    for row in records:
        context = json.loads(row["messages"][1]["content"])
        expected = json.loads(row["messages"][2]["content"])
        start = time.perf_counter()
        case = {"id": row["id"], "request": context["message"], "expected": expected}
        try:
            req = urllib.request.Request(url.rstrip("/") + "/api/v1/styling/recommend", method="POST",
                data=json.dumps({"message": context["message"]}).encode(), headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=125) as response: actual = json.load(response)
            case.update({"success": True, "actual": actual, **score(expected, actual)})
        except (OSError, ValueError, KeyError) as exc:
            case.update({"success": False, "error": str(exc)})
        case["seconds"] = round(time.perf_counter() - start, 3)
        cases.append(case)
        print(json.dumps({"id": case["id"], "success": case["success"], "exact_ids": case.get("exact_ids")}), flush=True)
    total = len(cases)
    successful = [c for c in cases if c["success"]]
    return {"total": total, "successful": len(successful), "exact_id_rate": sum(c.get("exact_ids", False) for c in cases) / total,
        "mean_precision": sum(c.get("precision", 0) for c in cases) / total,
        "mean_recall": sum(c.get("recall", 0) for c in cases) / total,
        "cases": cases, "limitations": "Eight synthetic paraphrase scenarios; not an independent fashion-quality benchmark. Includes retrieval and guardrails, not just raw model quality."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:5000")
    parser.add_argument("--split", choices=["validation", "test"], default="test")
    parser.add_argument("--output", type=Path, default=ROOT / "runs/baseline-evaluation.json")
    args = parser.parse_args()
    result = evaluate(args.url, load_records(ROOT / "data" / f"{args.split}.jsonl"))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2))
    print(json.dumps({k: v for k, v in result.items() if k != "cases"}, indent=2))
    if result["successful"] != result["total"]: raise SystemExit(1)
