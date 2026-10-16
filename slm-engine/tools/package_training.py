"""Bundle only training source, seed data, configs and notebook; never models or secrets."""
from pathlib import Path
import zipfile
import argparse
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--reviewed-data', type=Path, help='Explicit consented/reviewed split folder; never included implicitly')
args = parser.parse_args()
if args.reviewed_data:
    sys.path.insert(0, str(ROOT))
    from virtualfit_slm.data import validate_splits
    if (args.reviewed_data / 'INVALID.txt').exists(): raise ValueError('Invalid dataset marker exists')
    manifest = json.loads((args.reviewed_data / 'manifest.json').read_text(encoding='utf8'))
    if not manifest.get('review_required') or not manifest.get('source_export_sha256'): raise ValueError('Expected an operator-reviewed dataset manifest')
    validate_splits(args.reviewed_data)
destination = ROOT / "runs/virtualfit-slm-training.zip"
destination.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    identity = ROOT.parent / 'packages/shared/src/nova.json'
    archive.write(identity, 'packages/shared/src/nova.json')
    for directory in ['virtualfit_slm', 'configs', 'data/training-v2', 'evaluation', 'notebooks']:
        for file in (ROOT / directory).rglob('*'):
            if file.is_file() and '__pycache__' not in file.parts and file.name != 'custom-model.json':
                name = 'slm-engine/' + file.relative_to(ROOT).as_posix()
                if args.reviewed_data and file == ROOT / 'configs/lora.json':
                    config = json.loads(file.read_text()); config['data_dir'] = 'data/reviewed-selected'
                    archive.writestr(name, json.dumps(config, indent=2))
                else: archive.write(file, name)
    if args.reviewed_data:
        for name in ['train.jsonl','validation.jsonl','test.jsonl','manifest.json']:
            archive.write(args.reviewed_data / name, 'slm-engine/data/reviewed-selected/' + name)
    for name in ['pyproject.toml', 'README.md', 'requirements-colab.txt']:
        file = ROOT / name
        if file.exists(): archive.write(file, 'slm-engine/' + name)
print(f"Created source-only Colab bundle: {destination} ({destination.stat().st_size} bytes)")
