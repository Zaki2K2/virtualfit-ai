# Training guide (CatVTON + LoRA)

Training code: `ai-engine/virtualfit_engine/training/`. It runs on a CUDA GPU (free Colab T4 / Kaggle) and, for
tests only, on CPU with tiny random models.

## Honesty box - what is and is not from the reference

CatVTON publishes **no training script**. This pipeline is our own reconstruction:

| Element                                                                                           | Provenance                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UNet surgery: cross-attention skipped, `attn1` kept                                               | **Reference** (`model/utils.py::init_adapter`, `model/attn_processor.py`) - ported; module order verified against the real attention checkpoint                                                                  |
| 9-channel input `[noisy(4)                                                                        | mask(1)                                                                                                                                                                                                          | masked-person+garment latents(4)]`, height-axis concatenation, mask zero on garment half | **Reference** (`model/pipeline.py`) - ported; sampler verified against the reference to 1 pixel |
| Garment latent zeroed for the unconditional branch (CFG)                                          | **Reference** (sampling)                                                                                                                                                                                         |
| `enable_condition_noise` (noise both halves vs only the person half)                              | **Reference** helper `prepare_inpainting_input`; we default to noising both halves, which matches sampling (pure noise everywhere)                                                                               |
| Epsilon prediction, noise-added latents via `add_noise`                                           | Standard DDPM; the reference scheduler config is epsilon                                                                                                                                                         |
| **MSE loss on the predicted noise, uniform timesteps, 10% garment dropout, optimiser, LR, steps** | **Ours** - not taken from the authors; their exact recipe (incl. optional DREAM) is unknown to us. DREAM (`compute_dream_and_update_latents_for_inpaint`) exists in the reference `utils.py` but is **not** used |
| LoRA instead of full attention training                                                           | **Ours** (keeps baseline intact, tiny artifact); `method: attn_selective` trains the attention weights directly like the paper                                                                                   |

So results are "CatVTON-style fine-tuning by this project", not a reproduction of the authors' training.

## Objective (`training/objective.py`)

For a paired sample (person `x`, own garment `g`, mask `m`), with VAE latents `z_x`, `z_g`, `z_masked = E(x * (m<0.5))`:

```
clean   = concat_height(z_x, z_g)                 # enable_condition_noise = True
eps     ~ N(0, I);  t ~ U{0..T-1};  noisy = add_noise(clean, eps, t)
cond    = concat_height(z_masked, drop(z_g))      # drop() zeros z_g with p = 0.1
maskc   = concat_height(m_latent, zeros)
loss    = MSE( UNet([noisy | maskc | cond], t, encoder_hidden_states=None), eps )
```

With `enable_condition_noise: false` only the person half is noised, the garment half is passed clean, and the loss uses the person half.
The target is the person's original photo: no synthetic labels exist or are created.

## Method details

- Frozen: whole UNet and VAE. Trainable: LoRA on `attn1.to_q/to_k/to_v/to_out.0` (regex `LORA_TARGET_REGEX`), r=16, alpha=16, B initialised to zero so the model equals the baseline at step 0 (tested).
- Precision: frozen weights fp16 (`mixed_precision: fp16`; T4 has no native bf16), trainable fp32, `accelerate` mixed precision + gradient scaling, gradient clipping 1.0.
- Memory: gradient checkpointing (default on), batch 1 with gradient accumulation 8, optional 8-bit AdamW (`use_8bit_adam`, needs `bitsandbytes`).
- Reproducibility: `seed` seeds Python/NumPy/torch; per-step noise/timestep generators are derived from `seed` and the step; the data order is derived from `seed + epoch`; the full config is saved as `config.json`; the manifest SHA-256 is stored in `metadata.json`.
- Resolution 512x384 to match the `vitonhd-16k-512` starting weights (assumption: "512" is the image height; verify with notebook 02 outputs).

## Run it

1. `python tools/package_engine.py` -> upload `ai-engine.zip` to `MyDrive/virtualfit/`; put VITON-HD at `MyDrive/virtualfit/VITON-HD`.
2. Open `notebooks/01_gpu_check.ipynb` (Colab, GPU runtime).
3. `02_baseline.ipynb` - proves the pretrained model runs and records baseline outputs.
4. `03_finetune.ipynb` - memory gate -> manifests -> **1-step smoke test** -> training -> evaluation.

Command line equivalents (inside the notebook or any GPU box):

```bash
python -m virtualfit_engine.dataset.cli prepare --root VITON-HD --out runs/exp1/data
python -m virtualfit_engine.training.train --config configs/finetune_catvton_lora.yaml --smoke      # exactly 1 optimizer step
python -m virtualfit_engine.training.train --config configs/finetune_catvton_lora.yaml --resume latest
```

## Checkpoints

```
runs/exp1/train/
  config.json  metrics.jsonl  samples/            validation try-ons after training
  checkpoint-<step>/   adapter.safetensors adapter_config.json optimizer.pt scheduler.pt trainer_state.json COMPLETE
  adapter/             adapter.safetensors adapter_config.json metadata.json     <- the deliverable
```

- Checkpoints are written to a temp folder and renamed, so a disconnect never leaves a half-written checkpoint; only folders with `COMPLETE` are resumable. The last 2 are kept.
- Resume restores adapter, optimizer, LR scheduler, step counter and the position inside the epoch.
- **Baseline weights are never written.** The adapter is a separate file applied on top of the pretrained UNet.
- `metadata.json` records: base/VAE/attention-weights ids, `pretrained_weights_loaded`, `attention_checkpoint_loaded`, `optimizer_steps_completed`, trainable/total parameters, resolution, manifest hash, losses, device, library versions, timestamp.

### When does a checkpoint count as "the VirtualFit model"?

`is_genuine_finetune(metadata)` is true only if the real pretrained weights **and** the released attention checkpoint were loaded, at least one optimizer step ran, and training completed. The inference service refuses to serve the `custom` model unless this holds, and the API/UI show the real model version. Toy/CPU test runs are therefore never presentable as a custom model.

## Validation

- Every `val_every` steps: mean loss on the 40 validation samples with **fixed noise and timesteps** (comparable across checkpoints).
- After training: 4 validation try-ons are generated with the trained weights (`samples/`).
- Validation loss is a training diagnostic; judge the model with the held-out evaluation (`evaluation-methodology.md`).

## Tested on CPU (tiny random models)

`tests/test_training_toy.py`: finite loss in both noise modes; gradients reach only `attn1` LoRA weights; LoRA identity at init; cross-attention skipped; **one real optimizer step** updates LoRA-B and leaves every frozen weight bit-identical; checkpoint save -> resume continues the step counter; released adapter reloads to identical outputs and differs from the baseline; gradient checkpointing + validation samples run; NaN loss aborts; toy runs are flagged non-genuine.
