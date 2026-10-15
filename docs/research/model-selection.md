# Model selection

**Decision: fine-tune CatVTON with LoRA on its self-attention layers, on VITON-HD.**
IDM-VTON is rejected for training on free GPUs; VITON-HD is used as the dataset (and its old GAN-style model only as background).

Everything below was checked in the actual repositories (shallow clones inspected on 2026-10-15) unless it is
explicitly marked _estimate_ or _unverified_.

|                               | CatVTON                                                                                                                                                                                                                                                                               | IDM-VTON                                                                                                                                                                  | VITON-HD (repo)                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Commit inspected              | `7818397f`                                                                                                                                                                                                                                                                            | `0d5f3ec2`                                                                                                                                                                | `02afa4b5`                                                      |
| Architecture                  | Stable Diffusion 1.5 **inpainting** UNet (9-ch input). Cross-attention removed; person and garment latents concatenated along height; only `attn1` self-attention trained. No text encoder, no image encoder, no garment network                                                      | SDXL inpainting UNet + a second SDXL-scale "GarmentNet" + IP-Adapter + CLIP image encoder + text prompts                                                                  | GAN (segmentation generator + ALIAS generator), 2021            |
| Parameters                    | 899.06M total, **49.57M trainable** (our measurement of the `attn1` layers: 49.57M)                                                                                                                                                                                                   | billions (two SDXL-scale UNets)                                                                                                                                           | small                                                           |
| Inference memory              | < 8 GB VRAM at 1024x768, bf16 (README)                                                                                                                                                                                                                                                | needs a large GPU; hosted on ZeroGPU                                                                                                                                      | small                                                           |
| **Training code in the repo** | **None.** Only `inference.py`, `eval.py`, `app*.py` and model code. `utils.py` contains training helpers (`compute_dream_and_update_latents_for_inpaint`, `prepare_inpainting_input(enable_condition_noise=...)`, `init_accelerator`) that show how it was trained, but no `train.py` | **`train_xl.py` + `train_xl.sh`** (official)                                                                                                                              | none (inference `test.py` only; training was not released)      |
| Official training recipe      | n/a                                                                                                                                                                                                                                                                                   | `accelerate launch train_xl.py --gradient_checkpointing --use_8bit_adam --train_batch_size=6` on **4 GPUs** (`CUDA_VISIBLE_DEVICES=0,1,2,3`), default 130 epochs, lr 1e-5 | n/a                                                             |
| Checkpoints needed            | SD-inpainting base (`booksforcharlie/stable-diffusion-inpainting`, mirror of the removed runwayml repo, OpenRAIL-M), `sd-vae-ft-mse` (MIT), CatVTON attention weights (`zhengchong/CatVTON`, 189 MB each for `vitonhd` / `dresscode` / `mix`)                                         | SDXL base + SDXL inpainting + IP-Adapter-plus + CLIP image encoder (several GB)                                                                                           | n/a                                                             |
| License                       | **CC BY-NC-SA 4.0** (code, checkpoints, demo)                                                                                                                                                                                                                                         | **CC BY-NC-SA 4.0**                                                                                                                                                       | **CC BY-NC 4.0** (README: dataset "for research purposes only") |

## Why CatVTON

1. **It is the only candidate that can plausibly be fine-tuned on a free 16 GB GPU.** 99.8% of the UNet stays frozen; the trainable part is the self-attention.
2. **Its architecture is fully specified by its inference code.** Training must use the same input layout as sampling; we rebuilt it from `model/pipeline.py`, `model/attn_processor.py`, `model/utils.py` and `utils.py` and verified our sampler against the reference (below).
3. **Parameter-efficient training is native to the design** (the paper trains only attention). LoRA on top of the released attention weights gives an even smaller, separable artifact (1.60M parameters, a few MB) and **leaves the baseline weights untouched**.
4. Same license family as the rest of the project (noncommercial).

## Why not IDM-VTON for training

- Official recipe: 4 GPUs, per-GPU batch 6, with gradient checkpointing and 8-bit Adam _already switched on_.
- Two SDXL-scale networks must be resident; fp16 weights alone are roughly 10 GB before activations or optimizer state (_estimate from public SDXL parameter counts; not measured_). A free T4 (16 GB) / P100 (16 GB) cannot train it at the shipped resolution.
- It remains useful as an **inference-only hosted baseline** (the app's `hosted` model uses the public Space, see `docs/ai-integration.md`).

## Training method

- Start from the **released `vitonhd-16k-512` attention weights** (trained by the CatVTON authors for 16k steps at 512 px).
- Freeze everything; add **LoRA (r=16, alpha=16) to `attn1` `to_q/to_k/to_v/to_out.0`**: 1.60M trainable parameters (0.19% of the 859.5M-parameter UNet; measured by `tools/check_attention_checkpoint.py`).
- Objective: epsilon-prediction MSE on the concatenated person|garment latents, 9-channel inpainting conditioning, garment dropout 10% (enables classifier-free guidance). Details and provenance: `training-guide.md`.
- fp16 frozen base weights + fp32 LoRA/optimizer, gradient checkpointing, batch 1 x gradient accumulation 8, resumable checkpoints.
- Alternative method kept in code: `method: attn_selective` (train the 49.57M attention weights directly, the official recipe) for larger GPUs.

## Expected memory

| Item                                                                                                 | Value                                        | Status                                          |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------- |
| UNet + VAE weights, fp16                                                                             | ~1.9 GB (859.5M + ~84M parameters x 2 bytes) | computed                                        |
| LoRA weights + grads + AdamW state (fp32, r=16)                                                      | ~26 MB (1.60M x 16 bytes)                    | computed                                        |
| Activations at 512x384 (concat latent 128x48 = 6144 tokens at the top level), batch 1, checkpointing | **~3-6 GB**                                  | **estimate**                                    |
| Expected peak on a T4                                                                                | **~6-10 GB** (fits 16 GB)                    | **estimate, unverified: no GPU available here** |

The measured value is written to `metrics.jsonl` (`peak_gpu_mem_gb`) by the one-step smoke test in notebook 03 and must replace this estimate in `experiment-log.md`.

## GPU feasibility test

Notebook `01_gpu_check.ipynb` reports GPU model, VRAM, CUDA, bf16 support and free disk. Notebook 03 refuses to start training below 12 GB VRAM unless forced, runs a **one-step smoke test** first, and records the measured peak.
Status: **not yet run** (no GPU in this environment); see `experiment-log.md`.

## What was verified without a GPU

- The engine's UNet surgery loads the **real released attention checkpoint** correctly: all 80 tensors map onto same-shape modules and are equal after loading (`python tools/check_attention_checkpoint.py`; downloads only the 189 MB attention file; the UNet is built with random weights because only its structure matters).
  This check found and fixed a real bug: reference processors are `nn.Module`s, so the module list has stride 8 (not 7); with diffusers' own processors weights would have been loaded into the wrong layers silently.
- The sampling loop equals the **reference** `CatVTONPipeline` within 1 pixel on tiny random models, with and without classifier-free guidance (`tests/test_reference_parity.py`, needs a CatVTON checkout).
- A real forward + backward + optimizer step, checkpoint, resume and reload run on CPU with tiny random models (`tests/test_training_toy.py`). This proves the code path, **not** anything about the real model.

## If training fails (alternatives, in order)

1. Out of memory: `use_8bit_adam: true`, `lora_rank: 8`, height/width 448x336, or Kaggle's 2xT4 (still single-GPU training here).
2. Disconnects: re-run with `--resume latest` (checkpoints are saved to Drive).
3. Quality does not improve: report it (the evaluation compares against the untouched baseline and states confidence intervals). A null or negative result is a valid outcome and must be written down as such.
4. Smaller research baseline if even LoRA cannot fit: train LoRA on `attn1.to_q/to_v` only, or fine-tune at 384x288. These variants reuse the same code via config.
5. Fallback product path: keep the `hosted` provider (IDM-VTON Space) and the pretrained CatVTON engine; the custom model is optional.

## Licensing constraints

- CatVTON code, weights, and any derivative (including our LoRA adapter and the code in `ai-engine/` that ports CatVTON logic) are **CC BY-NC-SA 4.0**: noncommercial use only, attribution, and derivatives must use the same license.
- VITON-HD data: research use only, not redistributed by this repository; cite the paper when publishing results.
- Stable Diffusion inpainting base weights: CreativeML OpenRAIL-M (use restrictions apply).
- Fine-tuned adapters trained on VITON-HD inherit these constraints; do not publish them as a commercial product.
