# Experiment log

Append one entry per run. Only record numbers that a notebook/CLI actually produced.

## Status summary (2026-10-15)

| Question                                               | Answer                                                                                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Has a real training step completed on the real model?  | **No.** No GPU is available in the development environment.                                                                                          |
| Does a genuine customised checkpoint exist?            | **No.**                                                                                                                                              |
| Has real baseline inference with our engine succeeded? | **No** (needs a CUDA GPU). The _hosted_ IDM-VTON Space was used earlier for real try-ons (`docs/ai-integration.md`); that is a different model/path. |
| Is the dataset available locally?                      | **No.** VITON-HD was not downloaded (research-only license, multi-GB, Drive link needs a browser).                                                   |
| What _has_ been verified?                              | See below.                                                                                                                                           |

### Verified on this machine (CPU, no GPU)

| Check                                                                                 | Result                                                                                                                                                              |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine loads CatVTON's **real released attention checkpoint** into the correct layers | 80/80 tensors matched (same shapes, equal after load); attention parameters 49.57M = the paper's trainable count (`tools/check_attention_checkpoint.py`)            |
| LoRA r=16 size                                                                        | 1.60M trainable parameters = 0.19% of the 859.5M-parameter UNet                                                                                                     |
| Sampling loop vs reference `CatVTONPipeline` (tiny random weights, same RNG)          | max pixel difference <= 1 for guidance 1.0 and 2.5                                                                                                                  |
| Training code path (tiny random UNet/VAE, synthetic test images)                      | forward -> loss -> backward -> optimizer step -> checkpoint -> resume -> reload all pass; frozen weights bit-identical; LoRA-B updated; toy run flagged non-genuine |
| Python test suite                                                                     | 69 passed (dataset, preprocessing, arch, training toy, parity, service, evaluation, notebooks)                                                                      |
| Express <-> FastAPI                                                                   | real sockets: Express forwards the request, the GPU-less engine answers `GPU_UNAVAILABLE`, Express surfaces `AI_UNAVAILABLE`; no mock substitution                  |

### Requires a cloud GPU (not done)

GPU diagnostics, real baseline inference + parity with the reference on real weights, the 1-step smoke test with a **measured** peak memory, the training run, held-out evaluation.

## Entry template

```
### EXP-001 - <title>  (<date>)
- Notebook / command:
- Hardware (GPU, VRAM):
- Data: manifest sha256 (train/val/heldout), counts
- Config: config.json (link/path), seed
- Smoke test: peak_gpu_mem_gb = , step time =
- Training: steps completed = , final train loss = , final val loss = , wall time =
- Checkpoint: path, metadata.json -> genuine = true/false
- Evaluation (held-out n = ): table from report.md, CI, win counts
- Visual review: artifacts score mean, notes
- Conclusion (including null/negative results):
- Problems / follow-ups:
```

## Entries

_None yet. The first entry must come from `notebooks/03_finetune.ipynb` (smoke test first)._
