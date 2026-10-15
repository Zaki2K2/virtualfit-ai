"""Generates the three Colab/Kaggle notebooks in ../notebooks (nbformat v4 JSON).

    python tools/make_notebooks.py

Notebooks are generated so their code stays reviewable as plain strings and syntax-checked in tests.
"""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "notebooks"
CATVTON_COMMIT = "7818397f25613beedb3d861a34769f607cfcf3b1"


_IDS = iter(range(10_000))


def _id() -> str:
    return f"cell-{next(_IDS):04d}"


def md(text: str) -> dict:
    return {"cell_type": "markdown", "id": _id(), "metadata": {}, "source": text.strip("\n").splitlines(keepends=True)}


def code(text: str) -> dict:
    return {
        "cell_type": "code",
        "id": _id(),
        "metadata": {},
        "execution_count": None,
        "outputs": [],
        "source": text.strip("\n").splitlines(keepends=True),
    }


def notebook(cells: list[dict]) -> dict:
    return {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python"},
            "accelerator": "GPU",
            "colab": {"provenance": [], "gpuType": "T4"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


SETUP = '''
# --- Setup: Google Drive (persistent storage) + engine source -------------------------------
# Free runtimes disconnect. Everything that must survive (dataset, checkpoints, outputs) lives in Drive.
from google.colab import drive
drive.mount('/content/drive')

import pathlib, zipfile
WORK = pathlib.Path('/content/drive/MyDrive/virtualfit')
WORK.mkdir(parents=True, exist_ok=True)
ENGINE_ZIP = WORK / 'ai-engine.zip'   # create locally with:  python ai-engine/tools/package_engine.py
assert ENGINE_ZIP.exists(), f'Upload ai-engine.zip to {WORK} first (see ai-engine/README.md)'
if not pathlib.Path('/content/ai-engine').exists():
    zipfile.ZipFile(ENGINE_ZIP).extractall('/content')

%cd /content/ai-engine
!pip -q install -e . --no-deps
!pip -q install "diffusers>=0.31" "transformers>=4.46" "accelerate>=0.31" "peft>=0.13" safetensors lpips scikit-image opencv-python-headless pyyaml pydantic
'''

DATASET_CHECK = '''
# --- Dataset location -------------------------------------------------------------------------
# VITON-HD is NOT included in this project and is licensed for research use only.
# Download it yourself from https://github.com/shadow2496/VITON-HD (link in its README) and place the
# unzipped folder at  <WORK>/VITON-HD  so that it contains train/, test/, train_pairs.txt, test_pairs.txt.
VITON_ROOT = WORK / 'VITON-HD'
assert (VITON_ROOT / 'train_pairs.txt').exists(), (
    f'{VITON_ROOT} is missing or incomplete. Download VITON-HD and put it there (see ai-engine/README.md).')
RUN = WORK / 'runs' / 'exp1'
DATA = RUN / 'data'
'''

PREPARE = '''
# --- Validate the dataset and write train/val/held-out manifests (200 / 40 / 40) ----------------
# train+val come from the official TRAIN split; held-out comes from the official TEST split and is
# used for evaluation only. The command fails loudly if the dataset has too few valid samples.
!python -m virtualfit_engine.dataset.cli prepare --root "{VITON_ROOT}" --out "{DATA}" --n-train 200 --n-val 40 --n-heldout 40
'''


def nb_gpu_check() -> dict:
    return notebook(
        [
            md(
                """
# 01 - GPU diagnostics

Checks whether this runtime can host CatVTON **inference** (about 8 GB VRAM in bf16 at 1024x768) and
**LoRA fine-tuning at 512x384** (estimated 6-10 GB with fp16 base weights, gradient checkpointing, batch 1).
The training estimate is NOT verified until notebook 03's one-step smoke test reports a measured peak.

Use *Runtime -> Change runtime type -> T4 GPU* (Colab) or *Accelerator -> GPU* (Kaggle). Nothing here
installs or downloads model weights.
"""
            ),
            code("!nvidia-smi"),
            code(
                '''
import shutil, subprocess, sys
import torch

print('python        :', sys.version.split()[0])
print('torch         :', torch.__version__)
print('torch CUDA    :', torch.version.cuda)
print('CUDA available:', torch.cuda.is_available())

report = {'cuda_available': torch.cuda.is_available()}
if torch.cuda.is_available():
    p = torch.cuda.get_device_properties(0)
    report.update(gpu=p.name, vram_gb=round(p.total_memory / 1024**3, 1),
                  compute_capability=f'{p.major}.{p.minor}', bf16_supported=torch.cuda.is_bf16_supported())
    print('GPU           :', p.name)
    print('VRAM          : %.1f GB' % report['vram_gb'])
    print('compute cap.  :', report['compute_capability'])
    print('bf16 supported:', report['bf16_supported'], '(T4 lacks native bf16: use fp16)')
else:
    print('\\nNo GPU. Change the runtime type before running notebooks 02 and 03.')

total, used, free = shutil.disk_usage('/content')
report['disk_free_gb'] = round(free / 1024**3, 1)
print('disk free     : %.1f GB (/content)' % report['disk_free_gb'])
'''
            ),
            code(
                '''
# Verdict (thresholds are rules of thumb, not guarantees)
def verdict(r):
    if not r['cuda_available']:
        return 'NO GPU: inference and training cannot run here.'
    v = r['vram_gb']
    out = []
    out.append('inference (bf16/fp16, 1024x768): ' + ('likely OK' if v >= 10 else 'marginal / may fail'))
    out.append('LoRA fine-tune 512x384, batch 1  : ' + ('likely OK' if v >= 14 else 'marginal - try batch 1, 8-bit Adam' if v >= 10 else 'NOT recommended (<10 GB)'))
    if r['disk_free_gb'] < 15:
        out.append('disk: <15 GB free - base weights (~4 GB) + caches may not fit')
    return '\\n'.join(out)

print(verdict(report))
report
'''
            ),
        ]
    )


def nb_baseline() -> dict:
    return notebook(
        [
            md(
                """
# 02 - Baseline inference (original pretrained CatVTON)

Runs the **unmodified pretrained** CatVTON weights (`zhengchong/CatVTON`, `vitonhd-16k-512` attention
weights on top of the Stable Diffusion inpainting UNet) on held-out VITON-HD test samples, shows
person / garment / result, and saves outputs plus the exact generation settings.

* Needs a GPU (run notebook 01 first) and the VITON-HD dataset in your Drive.
* Weights download into the runtime cache (a few GB); nothing is stored in the repository.
* If the GPU cannot load the model the notebook stops with the real error. It never fabricates results.
* License: CatVTON and its checkpoints are CC BY-NC-SA 4.0 (noncommercial).
"""
            ),
            code(SETUP),
            code(DATASET_CHECK),
            code(PREPARE),
            code(
                '''
# --- Load the pretrained model ---------------------------------------------------------------
import json, time, torch
from pathlib import Path
from PIL import Image
from virtualfit_engine.dataset.viton_hd import read_manifest
from virtualfit_engine.models import EngineModels, ModelPaths, ModelUnavailable
from virtualfit_engine.training.data import load_record_mask

paths = ModelPaths()                      # pretrained only: no adapter
models = EngineModels(paths)
try:
    pipe = models.pipeline('pretrained')
except ModelUnavailable as e:
    raise SystemExit(f'CANNOT RUN: [{e.code}] {e.message}')
except Exception as e:                    # e.g. CUDA OOM while loading
    raise SystemExit(f'MODEL FAILED TO LOAD: {type(e).__name__}: {e}')
print('loaded; VRAM allocated: %.2f GB' % (torch.cuda.memory_allocated() / 1024**3))
'''
            ),
            code(
                '''
# --- Baseline inference on held-out samples ----------------------------------------------------
import matplotlib.pyplot as plt
from virtualfit_engine.postprocessing import repaint
from virtualfit_engine.preprocessing import prepare_inputs

N, STEPS, GUIDANCE, SEED = 6, 30, 2.5, 555
heldout = read_manifest(DATA / 'heldout.jsonl')[:N]
OUT = RUN / 'baseline'; OUT.mkdir(parents=True, exist_ok=True)

rows, torch_peak = [], []
fig, axes = plt.subplots(len(heldout), 3, figsize=(9, 4.5 * len(heldout)))
for i, rec in enumerate(heldout):
    person = Image.open(VITON_ROOT / rec.person).convert('RGB')
    garment = Image.open(VITON_ROOT / rec.cloth).convert('RGB')
    mask = load_record_mask(VITON_ROOT, rec)
    torch.cuda.reset_peak_memory_stats(); t0 = time.perf_counter()
    gen = torch.Generator(device='cpu').manual_seed(SEED)
    result = pipe(person, garment, mask, STEPS, GUIDANCE, paths.height, paths.width, gen)
    torch.cuda.synchronize(); dt = time.perf_counter() - t0
    prep = prepare_inputs(person, garment, mask, paths.width, paths.height)
    final = repaint(prep.person, prep.mask, result)
    final.save(OUT / f'{rec.id}.png')
    rows.append({'id': rec.id, 'latency_s': round(dt, 2), 'peak_gpu_gb': round(torch.cuda.max_memory_allocated() / 1024**3, 2)})
    for ax, im, title in zip(axes[i], (prep.person, prep.garment, final), ('person', 'garment', 'baseline result')):
        ax.imshow(im); ax.set_title(f'{rec.id}: {title}'); ax.axis('off')
plt.tight_layout(); plt.show()
rows
'''
            ),
            code(
                '''
# --- Record exactly how these outputs were produced -----------------------------------------------
import diffusers, transformers, peft
settings = {
    'model': 'pretrained CatVTON (no adapter)', 'base_model': paths.base_model, 'vae': paths.vae_model,
    'attention_weights': f'{paths.attn_repo}/{paths.attn_version}', 'resolution_hw': [paths.height, paths.width],
    'steps': STEPS, 'guidance_scale': GUIDANCE, 'seed': SEED, 'dtype': 'float16', 'repaint': True,
    'samples': [r.id for r in heldout], 'per_sample': rows,
    'gpu': torch.cuda.get_device_name(0),
    'versions': {'torch': torch.__version__, 'diffusers': diffusers.__version__, 'transformers': transformers.__version__, 'peft': peft.__version__},
}
(OUT / 'baseline_settings.json').write_text(json.dumps(settings, indent=2))
print('saved to', OUT)
'''
            ),
            md(
                f"""
## Optional: parity check against the reference implementation

Our sampler (`virtualfit_engine/pipeline.py`) is a port of CatVTON's. On tiny random models it matches the
reference to within 1 pixel (unit tests). This cell repeats the comparison with the **real weights** on
one sample, so you know the engine reproduces the official baseline. It clones CatVTON at the commit this
project was developed against (`{CATVTON_COMMIT[:10]}`).
"""
            ),
            code(
                f'''
PARITY = True
if PARITY:
    !git clone -q https://github.com/Zheng-Chong/CatVTON.git /content/CatVTON && git -C /content/CatVTON checkout -q {CATVTON_COMMIT}
    !pip -q install -r /content/CatVTON/requirements.txt 2>/dev/null || true
    import sys, numpy as np
    sys.path.insert(0, '/content/CatVTON')
    from model.pipeline import CatVTONPipeline
    ref = CatVTONPipeline(base_ckpt=paths.base_model, attn_ckpt=paths.attn_repo, attn_ckpt_version=paths.attn_version,
                          weight_dtype=torch.float16, device='cuda', skip_safety_check=True)
    rec = heldout[0]
    person = Image.open(VITON_ROOT / rec.person).convert('RGB'); garment = Image.open(VITON_ROOT / rec.cloth).convert('RGB')
    mask = load_record_mask(VITON_ROOT, rec)
    torch.manual_seed(1); ours = pipe(person, garment, mask, STEPS, GUIDANCE, paths.height, paths.width, torch.Generator(device='cpu').manual_seed(SEED))
    torch.manual_seed(1); theirs = ref(person, garment, mask, num_inference_steps=STEPS, guidance_scale=GUIDANCE, height=paths.height, width=paths.width, generator=torch.Generator(device='cpu').manual_seed(SEED))[0]
    d = np.abs(np.asarray(ours, np.int16) - np.asarray(theirs, np.int16))
    print('max abs pixel diff:', int(d.max()), '| mean:', round(float(d.mean()), 4), '(fp16 kernels may differ slightly; large values would indicate a porting bug)')
'''
            ),
        ]
    )


def nb_finetune() -> dict:
    return notebook(
        [
            md(
                """
# 03 - Custom fine-tuning (LoRA on CatVTON self-attention)

A real, measured experiment - or a clear error message. Steps:

1. check GPU memory, 2. prepare manifests (200 train / 40 val from the official train split, 40 held-out from the official test split),
3. **one-step smoke test** (forward + backward + optimizer step + save), 4. short training with resumable checkpoints,
5. evaluate **baseline vs custom** on the 40 held-out samples, 6. export configuration and metrics.

Important:
* The reference CatVTON repository has **no training script**. This pipeline is our reconstruction from its inference code and
  helper functions; see `docs/research/training-guide.md` for what is and is not from the reference.
* A checkpoint counts as "VirtualFit custom model" only if `metadata.json` says a real optimizer run completed on the real pretrained weights.
* Free runtimes disconnect: re-run the training cell and it resumes from the latest checkpoint in Drive.
* Nothing here tries to stop the runtime from disconnecting or to bypass usage limits; respect the platform's rules.
"""
            ),
            code(SETUP),
            code(
                '''
# --- GPU memory gate ----------------------------------------------------------------------------
import torch
assert torch.cuda.is_available(), 'No GPU. Change the runtime type (see notebook 01).'
props = torch.cuda.get_device_properties(0)
vram = props.total_memory / 1024**3
print(f'{props.name}: {vram:.1f} GB VRAM')
FORCE_LOW_MEMORY = False
if vram < 12 and not FORCE_LOW_MEMORY:
    raise SystemExit('Less than 12 GB VRAM: training at 512x384 is unlikely to fit. Set FORCE_LOW_MEMORY=True to try anyway '
                     '(consider use_8bit_adam: true and lora_rank: 8 in the config).')
'''
            ),
            code(DATASET_CHECK),
            code(PREPARE),
            code(
                '''
# --- Write the training config for this Drive layout -----------------------------------------------
import yaml
cfg = yaml.safe_load(open('configs/finetune_catvton_lora.yaml'))
cfg.update(dataset_root=str(VITON_ROOT), train_manifest=str(DATA / 'train.jsonl'),
           val_manifest=str(DATA / 'val.jsonl'), output_dir=str(RUN / 'train'))
if vram < 14:                         # smaller GPUs: be conservative
    cfg.update(use_8bit_adam=True, lora_rank=8, lora_alpha=8)
    !pip -q install bitsandbytes
CFG = RUN / 'finetune.yaml'; CFG.parent.mkdir(parents=True, exist_ok=True)
CFG.write_text(yaml.safe_dump(cfg, sort_keys=False))
print(CFG.read_text())
'''
            ),
            md(
                """
## Step 1 - one-step smoke test

Runs exactly **one optimizer step** into a separate folder (`train_smoke`) and prints the measured peak GPU memory.
Only continue if this succeeds.
"""
            ),
            code(
                '''
SMOKE = RUN / 'train_smoke'
!python -m virtualfit_engine.training.train --config "{CFG}" --smoke --output-dir "{SMOKE}"
import json
meta = json.loads((SMOKE / 'adapter' / 'metadata.json').read_text())
from virtualfit_engine.training.metadata import is_genuine_finetune
print('optimizer steps completed:', meta['optimizer_steps_completed'])
print('trainable parameters     :', meta['trainable_parameters'], 'of', meta['total_unet_parameters'])
print('real pretrained weights  :', meta['pretrained_weights_loaded'])
print('smoke adapter is genuine :', is_genuine_finetune(meta), '(1 step is a smoke test, not a useful model)')
print(open(SMOKE / 'metrics.jsonl').read())
'''
            ),
            md(
                """
## Step 2 - training run (resumable)

Default: 300 optimizer steps (~2400 samples seen). If the runtime disconnects, reconnect, re-run the setup cells
and this cell: `--resume latest` continues from the newest complete checkpoint in Drive.
"""
            ),
            code(
                '''
TRAIN = RUN / 'train'
!python -m virtualfit_engine.training.train --config "{CFG}" --resume latest
'''
            ),
            code(
                '''
meta = json.loads((TRAIN / 'adapter' / 'metadata.json').read_text())
print('completed:', meta['completed'], '| optimizer steps:', meta['optimizer_steps_completed'])
print('final train loss:', meta['final_train_loss'], '| final val loss:', meta['final_val_loss'])
print('GENUINE custom checkpoint:', is_genuine_finetune(meta))
import matplotlib.pyplot as plt
plt.plot(meta['loss_history']); plt.xlabel('logged step'); plt.ylabel('train loss'); plt.title('Training loss'); plt.show()
'''
            ),
            md(
                """
## Step 3 - baseline vs custom on the 40 held-out samples

Both columns use the same resident UNet (adapter disabled vs enabled), identical samples, seed, steps and guidance.
FID/KID are intentionally not computed (n=40 is far too small). Fill `manual_artifact_score_1to5` in `results.csv` by eye.
"""
            ),
            code(
                '''
EVAL = RUN / 'eval'
!python -m virtualfit_engine.evaluation.cli --root "{VITON_ROOT}" --manifest "{DATA / 'heldout.jsonl'}" --adapter "{TRAIN / 'adapter'}" --out "{EVAL}"
'''
            ),
            code(
                '''
import pandas as pd
from IPython.display import display
df = pd.read_csv(EVAL / 'results.csv')
display(df.groupby('model').mean(numeric_only=True))
'''
            ),
            code(
                '''
# Visual side-by-side for the first 4 held-out samples
import matplotlib.pyplot as plt
from PIL import Image
ids = df['id'].unique()[:4]
fig, axes = plt.subplots(len(ids), 2, figsize=(7, 5 * len(ids)))
for r, i in enumerate(ids):
    for c, m in enumerate(('baseline', 'custom')):
        axes[r][c].imshow(Image.open(EVAL / 'images' / f'{i}__{m}.png')); axes[r][c].set_title(f'{i} - {m}'); axes[r][c].axis('off')
plt.tight_layout(); plt.show()
'''
            ),
            code(
                '''
# --- Export configuration and metrics for the experiment log -----------------------------------------
import shutil
EXPORT = WORK / 'exports' / 'exp1'; EXPORT.mkdir(parents=True, exist_ok=True)
for src in (CFG, TRAIN / 'config.json', TRAIN / 'metrics.jsonl', TRAIN / 'adapter' / 'metadata.json',
            EVAL / 'results.csv', EVAL / 'summary.json', EVAL / 'report.md', DATA / 'summary.json'):
    shutil.copy(src, EXPORT / src.name if src.name != 'summary.json' else EXPORT / f'{src.parent.name}_summary.json')
print('exported to', EXPORT, '- copy these into docs/research/experiment-log.md; do NOT commit the adapter if it was trained on data you cannot share.')
'''
            ),
        ]
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, nb in (
        ("01_gpu_check.ipynb", nb_gpu_check()),
        ("02_baseline.ipynb", nb_baseline()),
        ("03_finetune.ipynb", nb_finetune()),
    ):
        (OUT / name).write_text(json.dumps(nb, indent=1) + "\n", encoding="utf-8")
        print("wrote", OUT / name)


if __name__ == "__main__":
    main()
