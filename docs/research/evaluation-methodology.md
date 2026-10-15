# Evaluation methodology

Code: `ai-engine/virtualfit_engine/evaluation/`. CLI: `python -m virtualfit_engine.evaluation.cli` (GPU).

## Design

- **A = original pretrained model, B = VirtualFit fine-tuned model**, run by the _same resident UNet_: A with the LoRA adapter disabled, B enabled. Same 40 held-out samples (official VITON-HD **test** split, never trained on), same seed, steps, guidance, resolution, mask and repaint step.
- Paired comparison: for every metric the per-sample difference B - A is computed; we report mean, 95% bootstrap CI (2,000 resamples) and "B better in k of n samples". "CI excludes 0" is stated explicitly. With n = 40 results are indicative, not conclusive.
- Nothing is estimated: a metric that cannot be computed is left empty with the reason; `manual_artifact_score_1to5` stays blank for a human reviewer.

## Metrics - what each one means

| Aspect asked for                                         | Metric                                                                                                               | Notes                                                                                                                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image alignment / perceptual similarity to the reference | **PSNR, SSIM, LPIPS (AlexNet)** against the original person photo (paired ground truth)                              | Paired reconstruction: the person wears their own garment, so closeness to the photo is meaningful, but it rewards copying and is not a realism score                        |
| Identity preservation                                    | **outside_mask_mae**: mean absolute pixel change outside the try-on mask                                             | Proxy (face, hair, hands and background are outside the upper-body mask). `repaint` forces ~0, so this mainly detects mask/blend problems. No face-recognition model is used |
| Garment-detail preservation                              | **clip_garment_sim**: CLIP-ViT-B/32 cosine similarity between the garment photo and the mask-bbox crop of the result | Proxy; CLIP captures colour/pattern/category, not fine print or logos                                                                                                        |
| Visual artifacts                                         | **manual score (1-5)** in `results.csv` + side-by-side images                                                        | Not measured automatically on purpose                                                                                                                                        |
| Latency                                                  | seconds per image (CUDA-synchronised)                                                                                | includes VAE encode/decode and 30 sampling steps by default                                                                                                                  |
| Peak GPU memory                                          | `torch.cuda.max_memory_allocated` per sample                                                                         | `reset_peak_memory_stats` before each generation                                                                                                                             |
| Distribution quality                                     | **FID / KID: intentionally not computed**                                                                            | They need thousands of images; at n = 40 the estimates are unreliable (`distribution_metrics_note`)                                                                          |

## Outputs

`results.csv` (one row per sample x model), `summary.json`, `report.md` (means with CIs, paired comparison table, caveats), `images/<id>__baseline.png` / `__custom.png`, `adapter_metadata.json`.

## How to read the report

- If CI of a paired difference excludes 0 **and** the visual review agrees, the change is likely real for these samples.
- If not, say so in the experiment log. A fine-tune with 200 samples and a few hundred steps can easily be indistinguishable from, or worse than, the strong released baseline; that is a legitimate finding.
- Metrics against the original photo can _favour a model that repaints less_; always look at the images.

## Verified vs not verified

Verified (CPU, `tests/test_evaluation_checkpoints.py`): metric properties (PSNR/SSIM identity, outside-mask MAE only counts outside pixels, bootstrap CI), paired comparison logic (a deliberately darkened stub model is worse everywhere; confidence intervals and win counts correct), CSV/Markdown generation, human-only field left empty, missing metrics never invented.
**Not verified:** LPIPS and CLIP metrics (need downloaded weights; code paths only run on the GPU notebooks), and everything involving real models: no real comparison has been run yet.
