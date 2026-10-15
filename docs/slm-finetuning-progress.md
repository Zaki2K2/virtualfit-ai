# Phase 3: SLM fine-tuning and grounding progress

Date: October 15, 2026, Asia/Karachi. Workspace: `C:\virtualfit-ai`.

## What changed and what has not happened

Implemented attribute-grounded candidate retrieval, preference/intent parsing, structured semantic validation, explicitly labeled deterministic fallback, a frozen 102-case held-out suite, separate training-v2 data, resumable LoRA checkpoints, a two-step Colab smoke workflow, and gated original/custom model selection. Prepared a separate pinned GPU vision experiment with explicit masks.

**No real Qwen fine-tuning or cloud GPU execution was completed. No genuinely trained fashion checkpoint exists, no custom checkpoint was loaded, and the original quantized Qwen weights were not replaced.** No authorized GPU session was supplied or accessible through the available tools. The local machine has CPU-only PyTorch. Actual tiny-random-model optimizer/checkpoint tests are engineering checks, not a fashion fine-tune.

## Original performance and failure analysis

The original saved evaluation remains unchanged at `docs/slm-baseline-evaluation.json`: 3/8 exact item sets, mean precision 0.53125, recall 0.75, and only 1/8 exact category sets. Every request returned a valid structured success response. All selected IDs existed in the original catalog. These were primarily **semantic selection failures**, not invented IDs, malformed JSON or MongoDB outages.

| Failed case                                              | Observed defect                                                             | Origin                                                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| test-001: blue office shirt + charcoal trousers          | Added sand linen shirt and olive bomber, and reported unrelated categories. | Retrieval ranked but never filtered positive attributes; SLM over-selection; no post-validation of slots, colors or category consistency.                   |
| test-002: denim over white top                           | Added a blue shirt and olive jacket; extra categories.                      | Same missing per-slot filtering and outfit cardinality checks.                                                                                              |
| test-004: red silk scarf                                 | Chose unrelated shirts/dress despite no scarf inventory.                    | No unsupported/no-match intent or retrieval threshold; model reasoning alone could not enforce absence.                                                     |
| test-005: classify denim jacket without selecting outfit | Returned a jacket ID and all categories.                                    | Category question was treated as outfit recommendation. Its generated request prefix was grammatically awkward, but the no-outfit instruction was explicit. |
| test-007: blue office shirt                              | Returned three extra non-blue tops and unrelated categories.                | No color/type enforcement; valid catalog IDs were mistaken for sufficient grounding.                                                                        |

Even exact-ID successes test-003 and test-006 had incorrect category labels. Root causes span parsing, retrieval, prompting and post-processing; simply training the model would not fix the missing guarantees. Machine-readable case evidence: `docs/slm-original-failure-analysis.json`.

## Grounded pipeline

1. Parse outfit/category/clarification/unsupported intent, garment slots, per-slot colors, exclusions, occasion and season. The parser is bounded English rule-based logic, not a claim of learned multilingual understanding.
2. Read current-guest clothing through the existing ownership-aware ClothingService: MongoDB uploads plus the existing bundled catalog. No model-generated query, owner ID or URL is executed. No migration or live database record deletion was introduced.
3. Derive explicit catalog attributes from curated catalog descriptions/style mappings, and conservative text attributes for uploaded garments. Unknown attributes do not count as verified matches. Attributes are **not verified from image pixels**.
4. Filter by category, garment subtype, colors, style/season and exclusions, rank using profile preferences/current-guest items with stable ties, and bound candidates to three per slot / twelve total.
5. Give the SLM only verified candidates, parsed constraints and a deterministic complete-outfit plan. This is additional prompting/grounding, not training.
6. Validate JSON with the shared strict schema; reject unknown/repeated IDs, incomplete or excessive slot assignments, and category labels inconsistent with actual selected cards.
7. On invalid model output, return a deterministic verified outfit **with `source: deterministic-fallback` and a reason**. On category/no-match/clarification requests, return `catalog-policy` without model generation. Outages, timeouts and genuine bugs still fail. The UI labels the source; `modelUsed` records an inference attempt and is not proof that the returned selection came from the model.

The legacy `simulated` field is retained for compatibility; use `source` as the recommendation provenance. No language result is evidence of image generation.

Scoped exclusions such as �avoid blue shirts� are distinct from excluding all tops. Negative unsupported terms such as �no scarves� do not make an otherwise supported request unsupported. Conservative no-match behavior can still reject useful options with missing metadata.

## Evaluation design and measured results

New independently authored evaluation files live in `slm-engine/evaluation/`:

- Development: 16 requests, 8 scenario families.
- Validation: 16 requests, 8 different families.
- Held-out: **102 requests, 34 different families**.

Scenario families and exact requests are disjoint across these evaluation splits. Paraphrases within each split are correlated. Cases cover categories, colors, casual/formal combinations, summer/winter/spring/autumn, kurta/kameez/shalwar/sherwani, multiple garments, explicit negatives, unsupported inventory and ambiguity. This remains a small templated synthetic suite, **not an independent human fashion benchmark**.

The harness uses the actual Express modules and real local CPU model, with isolated in-memory persistence and explicit synthetic uploaded inventory. It does not seed or delete records in live MongoDB. Existing MongoDB behavior is separately checked through the running application. Test-environment rate limiting is omitted only in the private loopback harness to run 102 requests; live application rate limits remain enabled.

The saved development result is 16/16 exact sets, with 8 accepted model outputs and 8 disclosed fallbacks. Validation is 14/16 exact sets. Both validation misses are the same broad �white top� scenario in two paraphrases: the fixture catalog also contains a valid white casual kurta that the narrow expected tee-only answer omits. The misses were preserved rather than editing answers after observing the run. Color scoring there is 12/14; it uses the same narrow ID-specific oracle. This is an evaluation ambiguity, not evidence that the kurta is the wrong color.

Held-out measured result (`docs/slm-v2-heldout-base.json`):

| Metric                                             | Result                                                 |
| -------------------------------------------------- | ------------------------------------------------------ |
| Completed requests                                 | 102/102                                                |
| Intent accuracy                                    | 102/102                                                |
| Category accuracy                                  | 102/102                                                |
| Color accuracy on cases with explicit color oracle | 21/21; other cases are not counted in this denominator |
| Valid catalog selection                            | 102/102                                                |
| Exact accepted outfit set                          | 102/102                                                |
| Final JSON/schema validity                         | 102/102                                                |
| Actual model calls                                 | 42                                                     |
| Model outputs accepted without fallback            | **16/42** (38.1%)                                      |
| Raw model schema validity                          | 41/42                                                  |
| Disclosed deterministic fallbacks                  | 26                                                     |
| Catalog policy without generation                  | 60                                                     |
| Mean / median / p95 total request latency          | 1.617 / 0.025 / 5.234 seconds                          |

**The 102/102 score belongs to the constrained pipeline, including 60 policy answers and 20 fallbacks. It is not 100% SLM accuracy, a fine-tuning result, or proof of broad generalization.** Intent is parsed by rules; raw model acceptance is still limited. Most positive cases have narrow, uniquely filtered choices, so the suite does not prove broad fashion reasoning. Median latency is dominated by policy cases; it is not representative generation latency. Only CPU inference was used.

### Reproducibility check

A fresh-harness repetition (`docs/slm-v2-heldout-repeat.json`) matched all 102 final selected item sets and all aggregate accuracy metrics. Dataset, catalog, fixture-ID, code and model-artifact hashes were identical. Both stable-ID runs accepted 22/42 model responses and used 20 fallbacks. Mean latency was 1.222 versus 1.131 seconds.

Raw output is **not bitwise deterministic**: six cases changed between model acceptance and fallback, and 13 answer texts changed. Identical final item sets come from the validated selection/fallback layer. The same sampling seed does not establish identical prose or raw per-case behavior. `docs/slm-v2-reproducibility.json` records the independent comparison. Future trained-model comparisons should repeat runs and include human review rather than rely on one raw acceptance count.

A later original-eight rerun against the live MongoDB application returned **6/8 correct responses, with two explicit HTTP 504 inference timeouts at approximately 60 seconds** (`docs/slm-v2-original-eight.json`). The six completed requests all matched their expected IDs: three accepted model answers, one disclosed fallback and two catalog-policy answers. This was under machine load after restarting the model; it is preserved as a latency/reliability limitation rather than counted as a perfect rerun. An earlier attempt interrupted by source reload did not produce a completed report and is not counted. New reports preserve requests, expected and actual responses, candidates, raw validation flags, sources, timestamps, dataset/catalog hashes, model revisions/runtime settings and per-case latency. The new evaluator also captures artifact/source hashes and refuses a changing custom artifact during a run. Original archived reports are not overwritten by comparisons.

## Training implementation audit and preparation

The original pipeline already loaded the training-compatible pinned `Qwen/Qwen2.5-0.5B-Instruct` Transformers checkpoint, tokenized chat templates, masked prompt tokens, attached PEFT LoRA, ran forward/backward passes and optimizer steps, validated loss, and saved adapters/manifests. It lacked resumable optimizer/scaler/RNG checkpoints and a distinct smoke stage. These are now implemented.

Current training data is `data/training-v2`, configured by default: **64 train / 8 validation / 8 test** records. It is authored independently, uses disjoint synthetic garment identities across its splits, and does not import the evaluation files or their answers. The old 32/8/8 bootstrap files remain historical artifacts and are not selected by the trainer. The source-only Colab ZIP includes only v2 training data, not evaluation gold files. This small artificial corpus still needs expansion and human review; it is a pipeline starter, not sufficient for a strong stylist.

Training uses the original pinned Transformers revision `7ae557604adf67be50417f59c2c2f167def9a775`, **not the Q4 GGUF**. Rank/target modules, seed, data hashes, maximum sequence length and optimization parameters are recorded. Plain LoRA is the default; optional NF4 QLoRA requires compatible bitsandbytes on CUDA. CPU real-model training refuses to run before weight downloads.

Checkpoint directories contain safe adapter weights/config, trainer state, completed optimizer steps and identity metadata. Resume restores optimizer, GradScaler, Python/PyTorch/CUDA RNG, loss history and shuffled example order, and rejects model/data/hyperparameter mismatches. Checkpoints save every four steps and at the final step. No existing checkpoint directory is overwritten. GPU resume has not been tested; actual CPU tiny-model save/resume was tested against uninterrupted training and produced identical adapter weights.

The Colab walkthrough now runs and verifies a **two-optimizer-step smoke checkpoint**, persists it to Drive, resumes into the longer 64-step run, and checks data/revision identity on rerun. It then merges the genuinely trained adapter, exports FP16 GGUF, quantizes for CPU and provides downloads. Adapter export additionally verifies compatibility with the selected base/revision. Notebook structure and code cells are validated locally; **the notebook has not been executed or visually inspected in a Colab GPU session**.

## Model selection, deployment gates and rollback

The UI/API offer Original Qwen and Custom. Custom is unavailable with an explicit reason until registration succeeds. Original always remains separate; the launcher verifies its original GGUF hash and never overwrites it with a candidate.

A candidate uses a separate authenticated CPU runtime on 8082. Registration requires completed CUDA training provenance, compatible base/revision, a real GGUF, matching loaded artifact hash, a full custom held-out report on the same dataset/catalog, successful schema/grounding checks, no metric regression and no regression in raw model acceptance. Only after these gates does the production custom provider become available. A mismatch/unavailable custom model fails instead of silently switching to Original.

The registration/load/quality-gate code is implemented and tested at available boundaries. **No custom registration was performed**, because no real trained checkpoint exists. Candidate generation quality, GPU fine-tuning, merge/conversion/quantization, real custom loading and a genuine base-vs-trained comparison remain blocked on that artifact.

## Separate vision experiment

The language system does not synthesize realistic clothing images. Vision remains independent:

- Mock: useful for labeled workflow simulation only.
- Hosted Gradio/IDM-VTON: requires the configured Space/API contract, an available remote GPU/quota, valid photos and explicit external-processing consent. The earlier audit was quota-blocked; no new hosted vision success is claimed in this phase.
- Python CatVTON: requires a CUDA host, compatible PyTorch/diffusers/PEFT stack, pretrained inpainting UNet, VAE, CatVTON attention weights, and valid person/garment/mask input. The default vitonhd attention weights support upper-body garments. Automatic masks additionally need the reference checkout plus DensePose/SCHP/checkpoints/detectron2; an explicit manual mask avoids those automatic-mask dependencies. Integration with the application additionally needs an accessible authenticated ENGINE_URL/ENGINE_API_KEY; a Colab notebook alone does not connect the PC to it.

Added `ai-engine/virtualfit_engine/inference_experiment.py`, pinned component revisions in `configs/inference-experiment.json`, and `notebooks/04_inference_experiment.ipynb`. The experiment checks CUDA/free VRAM/free disk before weight downloads, validates supplied images/mask, runs a one-step smoke then a seeded 30-step experiment, and saves the result plus input/output hashes, exact model revisions, GPU/software/settings and timing. No public tunnel is opened. No real vision weights or GPU inference were run locally. A saved one-step image would be only a smoke check, not quality evidence.

## Exact Google Colab next steps

1. Locally run `python slm-engine/tools/package_training.py`. Open `slm-engine/notebooks/01_fashion_lora_colab.ipynb` in Colab, sign in to your own Google account and select a **free T4 GPU** runtime. If none is available, stop; do not switch to paid compute automatically.
2. Run the CUDA guard. Upload `slm-engine/runs/virtualfit-slm-training.zip` in the upload cell. Run dependency setup with plain LoRA first. The notebook asks you to mount your Drive for persistent output at `MyDrive/virtualfit-slm/experiment-v2`.
3. Run the two-step smoke cell. Inspect `smoke/training-manifest.json`, `adapter_model.safetensors`, `checkpoint-000002/checkpoint.json` and `trainer-state.pt`. Verify **two completed optimizer steps**, finite validation loss and non-empty weights. Do not proceed on an exception.
4. Run the 64-step cell, which resumes the smoke checkpoint. After a disconnect, repeat setup and use the latest checkpoint under `fashion-lora/checkpoint-*`. Use a new experiment directory if data/base/hyperparameters change; do not bypass identity checks.
5. Inspect the full training manifest and validation loss. Run merge/conversion/quantization cells on Colab. Download the custom GGUF and training manifest; retain the LoRA adapter and metrics in Drive. No success is established until these files and actual step counts exist.
6. Keep Original on port 8081. Start a separate local candidate with `python slm-engine/tools/runtime.py serve --variant candidate --model-path C:/path/custom.gguf`. Do not replace original weights.
7. Start `npx tsx apps/api/scripts/styling-benchmark-server.ts`. Run `python -m virtualfit_slm.evaluate_suite --model custom --split heldout --output docs/slm-v2-heldout-custom.json`. Compare the same cases, raw acceptance, fallbacks, semantic mistakes and latency with `docs/slm-v2-heldout-base.json`.
8. If all gates pass, run `python -m virtualfit_slm.register_custom --gguf C:/path/custom.gguf --manifest C:/path/training-manifest.json --baseline docs/slm-v2-heldout-base.json --candidate docs/slm-v2-heldout-custom.json`. The UI then enables Custom while the matching model runtime is loaded. Later starts can use `python slm-engine/tools/runtime.py serve --variant custom`. Select Original to roll back.
9. For vision, separately run `python ai-engine/tools/package_engine.py`, upload that source archive into the fourth vision notebook, select a CUDA runtime, upload your authorized person/garment/manual-mask files, and execute smoke/full inference. Inspect the actual image and manifest before recording a success. Do not expose the Colab service publicly.

## Remaining limitations

- English keyword parsing and descriptive metadata are conservative and narrow. Complex negation, ambiguous color scope, multilingual requests, unknown materials and missing uploaded metadata need further development. Style/season mappings are catalog assumptions, not physical fit or temperature guarantees.
- The synthetic suite has correlated paraphrases and finite authored vocabulary. It was not independently human-reviewed. Validation already exposes a narrow-gold ambiguity. Broader, scenario- and garment-diverse human evaluation is needed before quality claims.
- Two live original-eight requests exceeded the 60-second deadline under load. Cold starts and resource contention remain real latency risks; the faster isolated-suite means are not a latency guarantee.
- The SLM still produces many invalid semantic selections, so fallback dependence is substantial. Generated prose is not automatically scored for fashion quality and can echo the request. Metadata/selection checks do not guarantee safe or useful prose.
- No actual GPU fine-tune, genuine custom adapter, custom GGUF, custom load or vision inference success exists. Prepared code/static notebook checks are not substitutes for those runs.
- LoRA/QLoRA CUDA compatibility, full Colab execution, cross-device resume numerical behavior and custom-model conversion need cloud verification. Single-process concurrency does not provide distributed scheduling or guaranteed native cancellation after timeouts.

## Final verification

| Check                                                                             | Outcome                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                               | Passed (shared, API, web).                                                                                                                                                                                                                                       |
| `npm run lint`                                                                    | Passed.                                                                                                                                                                                                                                                          |
| `npm test`                                                                        | 123 passed: shared 4, API 82, web 37.                                                                                                                                                                                                                            |
| `npm run build`                                                                   | Passed shared/API compilation and Next optimized build, including all pages and `/stylist`.                                                                                                                                                                      |
| `ai-engine/.venv/Scripts/python.exe -m pytest slm-engine/tests -q`                | 11 passed; includes real tiny CPU LoRA save/resume equivalence, dataset isolation, cached tokenizer and notebook checks.                                                                                                                                         |
| `ai-engine/.venv/Scripts/python.exe -m pytest -q -m "not gpu"` (inside ai-engine) | 69 passed, 2 skipped, one upstream Starlette/httpx deprecation warning.                                                                                                                                                                                          |
| Browser script with `AUDIT_SLM=1`                                                 | Passed all eight pages, real model-attempt provenance, wardrobe cards/Try-on navigation, profile save/reload, wardrobe search/upload, explicitly selected vision mock generation/download/favorites/history; no browser exceptions or HTTP 5xx in the final run. |
| Live HTTP                                                                         | Health, clothing, profile and styling status returned 200 on both 3000 and 5000. MongoDB connected. Base available; Custom unavailable with truthful registration reason.                                                                                        |
| Original-eight live evaluation                                                    | 6/8 completed correctly; 2 HTTP 504 timeouts. Exit 1 is retained, not reported as a passing evaluation.                                                                                                                                                          |
| GPU training / custom load / real vision                                          | Not executed; no authorized cloud GPU session.                                                                                                                                                                                                                   |

An initial browser run overlapped the live evaluator and hit the expected one-request 429 limit. A subsequent readiness-dependent assertion failed; the final run was performed sequentially with a page-initialization wait and retained the strict model-attempt assertion. No concurrency guard or validation was disabled to pass the browser check.

The isolated benchmark omits request throttling in test mode only. Its fixtures now receive stable IDs through a test-only ID factory; production generation remains unpredictable. Restart the harness for each evaluation. It rejects a second run to prevent fixture-ID drift; registration compares fixture IDs and source hashes as well as dataset/catalog identity. The first randomized-ID held-out report is retained as `docs/slm-v2-heldout-base-initial.json`; the final stable-ID result is stored separately in the baseline path used for custom comparison.

## Sources

- Repository evidence: original and new evaluation JSON, `slm-engine/evaluation/manifest.json`, training-v2 manifest, current provider/service/tests and notebook source.
- [PEFT checkpoint format](https://huggingface.co/docs/peft/en/developer_guides/checkpoint): adapter/base compatibility and safetensors structure.
- [Transformers training documentation](https://huggingface.co/docs/transformers/en/main_classes/trainer): training/checkpoint concepts; this project implements an explicit PyTorch loop.
- [Pinned llama.cpp server API](https://github.com/ggml-org/llama.cpp/blob/b11643/tools/server/README.md): runtime protocol and structured output.
- [CatVTON reference](https://github.com/Zheng-Chong/CatVTON): separate vision architecture and research/noncommercial requirements.
