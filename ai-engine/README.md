# VirtualFit AI engine (Python)

Dataset tools, CatVTON LoRA fine-tuning, evaluation and a FastAPI inference service for the VirtualFit AI web app.
Noncommercial research code; CatVTON-derived parts are **CC BY-NC-SA 4.0**.

> **Status:** the code is implemented and unit-tested on CPU with tiny random models. **No real training step has run and no
> custom checkpoint exists yet** - that needs a cloud GPU (notebooks below). See `../docs/research/experiment-log.md`.

## Layout

```
virtualfit_engine/
  images.py preprocessing.py postprocessing.py   safe decoding, CatVTON resize/mask conventions (no torch needed)
  dataset/       VITON-HD manifest, validation, leakage-safe splits, CLI
  arch.py        CatVTON UNet surgery + conditioning (ported from the reference)
  pipeline.py    sampling loop (verified against the reference implementation)
  models.py      resident model + LoRA adapter (pretrained = adapter disabled, custom = enabled)
  training/      config, objective, data, LoRA, resumable checkpoints, train CLI
  evaluation/    metrics, paired baseline-vs-custom runner + report, CLI
  service/       FastAPI app, settings, mask estimation (isolated heavy dependency)
configs/finetune_catvton_lora.yaml
notebooks/       01_gpu_check, 02_baseline, 03_finetune (Colab/Kaggle)
tools/           make_notebooks.py, package_engine.py, check_attention_checkpoint.py
tests/
```

## Local CPU setup (validation, preprocessing, tests, service without a GPU)

```bash
cd ai-engine
python -m venv .venv
.venv\Scripts\activate                       # Windows (use source .venv/bin/activate elsewhere)
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -e ".[serve,train,eval,dev]"
python -m pytest                             # 69 tests; ~1-2 min (torch import dominates)
```

Tests that need `torch` use tiny randomly initialised models; nothing is downloaded. The reference-parity test additionally needs a
CatVTON checkout: `ENGINE_CATVTON_REPO=/path/to/CatVTON python -m pytest tests/test_reference_parity.py`.
Optional real-checkpoint compatibility check (downloads 189 MB): `python tools/check_attention_checkpoint.py`.

Dataset tools work without torch:

```bash
python -m virtualfit_engine.dataset.cli prepare --root /path/to/VITON-HD --out runs/exp1/data
```

## Cloud GPU workflow (free Colab / Kaggle)

1. `python tools/package_engine.py` -> `ai-engine.zip`; upload it to Google Drive `MyDrive/virtualfit/`. Put VITON-HD at `MyDrive/virtualfit/VITON-HD` (you must download it yourself; research license).
2. Open the notebooks in Colab with a GPU runtime:
   * `01_gpu_check.ipynb` - GPU, VRAM, CUDA, bf16, disk, verdict
   * `02_baseline.ipynb` - pretrained CatVTON on held-out samples, saved with exact settings; optional parity check with the reference
   * `03_finetune.ipynb` - memory gate -> manifests -> **1-step smoke test** -> training (resumable) -> baseline-vs-custom evaluation -> export
3. Record results in `docs/research/experiment-log.md`.

Notebooks never contain secrets and make no attempt to keep a runtime alive or bypass limits. They are regenerated from `tools/make_notebooks.py` (a test checks they are up to date and syntactically valid).

## Inference service

```bash
pip install -e ".[serve,train]"
uvicorn virtualfit_engine.service.app:app --host 127.0.0.1 --port 8000
```

It is **not** started by `npm run dev` and never runs a model on a machine without CUDA (it answers `GPU_UNAVAILABLE`; `ENGINE_ALLOW_CPU=1` exists but is impractically slow).

| Endpoint | |
|---|---|
| `GET /health` | status, CUDA, per-model availability + reason, masker availability, supported garment types, limits |
| `POST /v1/inference/try-on` | multipart: `person`, `garment`, `category` (tops/outerwear/bottoms/dresses), `model_version` (`pretrained`/`custom`), optional `mask`, `seed`, `steps`, `guidance`. Returns `image/png` + headers `X-Model-Version`, `X-Duration-Ms`, `X-Simulated: false` |

Errors are `{error:{code,message}}` with codes `VALIDATION_ERROR UNAUTHORIZED UNSUPPORTED_IMAGE FILE_TOO_LARGE UNSUPPORTED_CATEGORY BAD_MASK BUSY GPU_UNAVAILABLE MODEL_UNAVAILABLE MASKER_UNAVAILABLE TIMEOUT INFERENCE_FAILED`. Failures are never replaced by placeholder images.

| Variable | Default | |
|---|---|---|
| `ENGINE_HOST` / `ENGINE_PORT` | `127.0.0.1` / `8000` | non-loopback host **requires** `ENGINE_API_KEY` |
| `ENGINE_API_KEY` | _unset_ | checked (constant time) from header `X-Engine-Key` on inference |
| `ENGINE_BASE_MODEL`, `ENGINE_VAE_MODEL`, `ENGINE_ATTN_REPO`, `ENGINE_ATTN_VERSION` | CatVTON defaults, `vitonhd` | weights are downloaded on first real use (GPU hosts only) |
| `ENGINE_ADAPTER_DIR` | _unset_ | folder with the trained adapter; `custom` is available only if its metadata proves a genuine fine-tune |
| `ENGINE_CATVTON_REPO`, `ENGINE_MASKER_CKPT` | _unset_ | CatVTON checkout + checkpoints for automatic masks (DensePose + SCHP, needs detectron2). Without it requests lacking a `mask` fail with `MASKER_UNAVAILABLE` |
| `ENGINE_MAX_UPLOAD_MB`, `ENGINE_TIMEOUT_S`, `ENGINE_ALLOW_CPU`, `ENGINE_HEIGHT`, `ENGINE_WIDTH` | `8`, `300`, off, `512`, `384` | |

Notes: the released `vitonhd` weights support **upper-body** garments only (the service rejects other categories with `UNSUPPORTED_CATEGORY`; use `ENGINE_ATTN_VERSION=mix` for all types, untested here). Uploaded images stay in memory and are never written to disk. A free Colab runtime is not reachable from your PC without a tunnel, which this project deliberately does not automate; run the service on a GPU machine you control and point the web API's `ENGINE_URL` at it.

## Connecting to the web app

In the repo root `.env`: `ENGINE_URL=http://<engine-host>:8000`, `ENGINE_API_KEY=...` (same value), optional `AI_PROVIDER=custom-python`. The studio then offers *Original pretrained model* and *VirtualFit custom model* only while the engine reports them available. See `../docs/ai-integration.md`.
