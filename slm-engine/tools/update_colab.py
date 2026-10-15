"""Update the existing tutorial with persistent smoke-test and resume cells; no GPU execution."""
from pathlib import Path
import nbformat as n

ROOT = Path(__file__).resolve().parents[1]
p = ROOT / 'notebooks/01_fashion_lora_colab.ipynb'
nb = n.read(p, as_version=4)
md, code = n.v4.new_markdown_cell, n.v4.new_code_cell
for cell in nb.cells:
    if cell.cell_type == 'code' and 'validate_splits' in cell.source:
        cell.source = '''from google.colab import drive
drive.mount('/content/drive')
from virtualfit_slm.data import validate_splits
DATA = slm_root / 'data/training-v2'
print(validate_splits(DATA))
RUN = Path('/content/drive/MyDrive/virtualfit-slm/experiment-v2')
RUN.mkdir(parents=True, exist_ok=True)
base_command = [sys.executable, '-m', 'virtualfit_slm.train', '--config', str(slm_root / 'configs/lora.json'), '--data-dir', str(DATA)]
if USE_QLORA: base_command.append('--qlora')
smoke = RUN / 'smoke'
if not (smoke / 'training-manifest.json').exists():
    subprocess.check_call(base_command + ['--max-steps', '2', '--output-dir', str(smoke)])
smoke_manifest = json.loads((smoke / 'training-manifest.json').read_text())
assert smoke_manifest['optimizer_steps_completed'] == 2
assert (smoke / 'adapter_model.safetensors').stat().st_size > 0
checkpoint = smoke / 'checkpoint-000002'
assert (checkpoint / 'trainer-state.pt').is_file()
print({'smoke_steps': 2, 'validation_loss': smoke_manifest['validation_loss']})'''
    if cell.cell_type == 'markdown':
        cell.source = cell.source.replace('32 authored synthetic train / 8 validation / 8 test examples',
            '64 independently authored synthetic train / 8 validation / 8 test examples, separate from the 102-case held-out API suite')
if not any(c.cell_type == 'markdown' and 'Resume the smoke' in c.source for c in nb.cells):
    index = next(i for i, c in enumerate(nb.cells) if c.cell_type == 'code' and 'smoke_manifest' in c.source)
    nb.cells[index+1:index+1] = [
        md('### Resume the smoke checkpoint into the full run\nOptimizer, scaler, Python/PyTorch/CUDA RNG, shuffled order and completed steps are restored. Model revision, dataset hashes and optimization settings must match. Checkpoints are saved every four steps and at the final step. After a Colab disconnect, rerun setup and this cell: it chooses the latest persistent checkpoint. Use a new RUN directory for incompatible experiments.'),
        code('''adapter = RUN / 'fashion-lora'
checkpoints = sorted(adapter.glob('checkpoint-*')) if adapter.exists() else []
resume = checkpoints[-1] if checkpoints else checkpoint
manifest_file = adapter / 'training-manifest.json'
if not manifest_file.exists():
    subprocess.check_call(base_command + ['--max-steps', '64', '--output-dir', str(adapter), '--resume', str(resume)])
manifest = json.loads(manifest_file.read_text())
assert manifest['optimizer_steps_completed'] == 64
assert manifest['base_model'] == 'Qwen/Qwen2.5-0.5B-Instruct'
assert (adapter / 'adapter_model.safetensors').stat().st_size > 0
print({key: manifest[key] for key in ['optimizer_steps_completed', 'validation_loss', 'dataset_counts', 'resolved_revision']})''')]
    nb.cells.append(md('''## Validate locally before activation
This notebook has not been executed on a real GPU. Select a free T4 runtime, upload the source-only ZIP and run every cell. Training uses the pinned original Transformers checkpoint, never the Q4 GGUF.

After downloading the custom GGUF and its training manifest:
1. Keep the original runtime on port 8081. Start the candidate: `python slm-engine/tools/runtime.py serve --variant candidate --model-path C:/path/custom.gguf` (8082).
2. Start the isolated evaluation harness: `npx tsx apps/api/scripts/styling-benchmark-server.ts`.
3. Run `python -m virtualfit_slm.evaluate_suite --model custom --split heldout --output docs/slm-v2-heldout-custom.json`.
4. Register only after gates pass: `python -m virtualfit_slm.register_custom --gguf C:/path/custom.gguf --manifest C:/path/training-manifest.json --baseline docs/slm-v2-heldout-base.json --candidate docs/slm-v2-heldout-custom.json`.
5. The custom selector stays unavailable until registration and runtime loading succeed. Select Original Qwen to roll back; its GGUF is never overwritten.

Compare pipeline metrics and raw-model acceptance/fallback rates. Require independent human review before making broad quality claims.'''))
n.validate(nb)
for cell in nb.cells:
    if cell.cell_type == 'code': compile(cell.source, 'colab-cell', 'exec')
n.write(nb, p)
print('Updated Colab notebook; static validation only.')
