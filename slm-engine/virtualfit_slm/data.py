"""JSONL contracts and train/eval leakage checks. No user data is imported."""
import json
from pathlib import Path

CATEGORIES = {"tops", "bottoms", "dresses", "outerwear"}


def load_records(path):
    records = [json.loads(line) for line in Path(path).read_text(encoding="utf8").splitlines() if line.strip()]
    if not records:
        raise ValueError("Dataset is empty")
    seen = set()
    for row in records:
        messages = row["messages"]
        if [m["role"] for m in messages] != ["system", "user", "assistant"]:
            raise ValueError("Expected system/user/assistant messages")
        context, output = json.loads(messages[1]["content"]), json.loads(messages[2]["content"])
        ids = {item["id"] for item in context["wardrobe"]}
        if not set(output["itemIds"]) <= ids or len(set(output["itemIds"])) != len(output["itemIds"]):
            raise ValueError("Ungrounded or duplicate target IDs")
        if not set(output["categories"]) <= CATEGORIES or len(output["itemIds"]) > 4:
            raise ValueError("Invalid output categories or count")
        if not output["answer"] or not isinstance(output["occasion"], str):
            raise ValueError("Invalid output text")
        key = context["message"].strip().casefold()
        if key in seen:
            raise ValueError("Duplicate request")
        seen.add(key)
    return records


def validate_splits(root):
    root = Path(root)
    seen = set()
    counts = {}
    for split in ["train", "validation", "test"]:
        rows = load_records(root / f"{split}.jsonl")
        keys = {json.loads(row["messages"][1]["content"])["message"].strip().casefold() for row in rows}
        if seen & keys:
            raise ValueError("Request leakage between dataset splits")
        seen |= keys
        counts[split] = len(rows)
    return counts
