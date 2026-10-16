"""Convert an operator-approved Nova export into a new, validated LoRA dataset. Never trains."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from virtualfit_slm.data import validate_splits


def prepare(source, destination):
    bundle = json.loads(Path(source).read_text(encoding='utf8'))
    records = bundle['records']
    if len(records) < 3 or any(r.get('source') != 'explicitly-consented-operator-reviewed' for r in records):
        raise ValueError('Need at least three operator-reviewed, consented records')
    if len({r['scenario'] for r in records}) != len(records):
        raise ValueError('Duplicate normalized requests')
    # Stable scenario split, independent of time or random order.
    ordered = sorted(records, key=lambda row: row['scenario'])
    evaluation = max(1, len(ordered) // 10)
    splits = {'test': ordered[:evaluation], 'validation': ordered[evaluation:2*evaluation], 'train': ordered[2*evaluation:]}
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    try:
        for split, rows in splits.items():
            (destination / f'{split}.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in rows), encoding='utf8')
        counts = validate_splits(destination)
        manifest = {'dataset_version': bundle['datasetVersion'], 'counts': counts,
                    'source_export_sha256': hashlib.sha256(Path(source).read_bytes()).hexdigest(),
                    'source_ids': bundle['sourceIds'], 'review_required': True,
                    'files': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in destination.glob('*.jsonl')}}
        (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
        return manifest
    except Exception:
        # Retain failed artifacts for inspection; never silently substitute a training dataset.
        (destination / 'INVALID.txt').write_text('Validation failed. Do not train from this directory.', encoding='utf8')
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.source, args.destination), indent=2))
