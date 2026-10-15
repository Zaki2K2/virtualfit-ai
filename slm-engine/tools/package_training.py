"""Bundle only training source, seed data, configs and notebook; never models or secrets."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
destination = ROOT / "runs/virtualfit-slm-training.zip"
destination.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for directory in ['virtualfit_slm', 'configs', 'data/training-v2', 'notebooks']:
        for file in (ROOT / directory).rglob('*'):
            if file.is_file() and '__pycache__' not in file.parts and file.name != 'custom-model.json':
                archive.write(file, 'slm-engine/' + file.relative_to(ROOT).as_posix())
    for name in ['pyproject.toml', 'README.md']:
        file = ROOT / name
        if file.exists(): archive.write(file, 'slm-engine/' + name)
print(f"Created source-only Colab bundle: {destination} ({destination.stat().st_size} bytes)")
