"""Build the independent, manual-mask GPU inference experiment walkthrough."""
from pathlib import Path
import nbformat as n

root = Path(__file__).resolve().parents[1]
md, code = n.v4.new_markdown_cell, n.v4.new_code_cell
nb = n.v4.new_notebook(cells=[
    md('# Real vision inference experiment\n\n## Goal\nGenerate an actual upper-body try-on using pinned pretrained CatVTON components. **Not executed on GPU by Codex.** The SLM is not involved. Use images you have permission to process. A manually supplied mask avoids requiring DensePose/SCHP for this experiment. White pixels identify the clothing region to replace; the mask must match person dimensions. A one-step smoke image is not a quality result. Research/noncommercial model licenses apply.'),
    md('## Setup\nChoose a free Colab T4 GPU. Locally run `python ai-engine/tools/package_engine.py`, then upload `ai-engine.zip` below. GPU, free VRAM and disk are checked before any weight download.'),
    code("""import torch
assert torch.cuda.is_available(), 'Select a GPU runtime first'
from google.colab import files
from pathlib import Path
import zipfile, subprocess, sys, json
uploaded = files.upload()
archive = Path('ai-engine.zip')
assert archive.name in uploaded
destination = Path('/content').resolve()
with zipfile.ZipFile(archive) as bundle:
    assert all((destination / entry.filename).resolve().is_relative_to(destination) for entry in bundle.infolist())
    bundle.extractall(destination)
engine = destination / 'ai-engine'
subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-e', str(engine) + '[train,serve]'])
print(torch.cuda.get_device_name(0))"""),
    md('### Supply explicit inference inputs\nUpload `person.png`, `garment.png` and `mask.png`. Use a front-facing person and a clear upper-body garment photo. Do not substitute generated catalog illustrations when evaluating realistic quality. The manual mask removes the need for the optional automatic masker. No public tunnel is opened.'),
    code("""uploaded = files.upload()
for name in ['person.png', 'garment.png', 'mask.png']: assert name in uploaded
from virtualfit_engine.inference_experiment import require_gpu
config_path = engine / 'configs/inference-experiment.json'
config = json.loads(config_path.read_text())
require_gpu(config)
print(config)
command = [sys.executable, '-m', 'virtualfit_engine.inference_experiment', '--person', 'person.png', '--garment', 'garment.png', '--mask', 'mask.png', '--config', str(config_path)]"""),
    md('## Steps\nRun one real diffusion step to verify downloads, architecture, tensors and image saving. Only proceed to the 30-step experiment if its manifest and image exist.'),
    code("""subprocess.check_call(command + ['--steps', '1', '--output', '/content/vision-smoke'])
smoke = json.loads(Path('/content/vision-smoke/manifest.json').read_text())
assert smoke['steps_executed'] == 1 and smoke['simulated'] is False
assert Path('/content/vision-smoke/result.png').is_file()
subprocess.check_call(command + ['--output', '/content/vision-baseline'])
manifest = json.loads(Path('/content/vision-baseline/manifest.json').read_text())
assert manifest['steps_executed'] == 30 and manifest['simulated'] is False
from IPython.display import display, Image
display(Image(filename='/content/vision-baseline/result.png'))
print(manifest)"""),
    md('## Checks\nInspect garment fidelity, pose, face/background preservation and mask boundaries. Download the image and its manifest (input/output hashes, seed, component revisions, GPU and settings). Generation success is not proof of realistic quality or physical fit.'),
    code("""files.download('/content/vision-baseline/result.png')
files.download('/content/vision-baseline/manifest.json')"""),
    md('## Next Steps\nRepeat with the same inputs/settings to study repeatability, then use licensed held-out paired images for quality evaluation. The existing FastAPI vision service supports the same manual mask field and X-Engine-Key authentication; automatic masks additionally require the pinned reference checkout, DensePose/SCHP checkpoints and compatible detectron2. Do not expose a free Colab runtime publicly. This experiment does not claim that the application can reach your Colab instance or that a custom vision model has been trained.')])
nb.metadata = {'kernelspec': {'display_name': 'Python 3', 'language': 'python', 'name': 'python3'}, 'language_info': {'name': 'python'}, 'accelerator': 'GPU'}
n.validate(nb)
for cell in nb.cells:
    if cell.cell_type == 'code': compile(cell.source, 'vision-colab-cell', 'exec')
n.write(nb, root / 'notebooks/04_inference_experiment.ipynb')
print('Vision notebook statically validated; GPU execution not performed.')
