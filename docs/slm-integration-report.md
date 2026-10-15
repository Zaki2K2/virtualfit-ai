# Small Language Model integration report

Date: October 15, 2026 (Asia/Karachi). Project: VirtualFit AI, `C:\virtualfit-ai`.

## Result

A real local CPU language model is installed, running and integrated into the existing application. Open **http://localhost:3000/stylist**. The styling assistant accepts outfit descriptions, sends bounded wardrobe text to Qwen through authenticated local llama.cpp, validates the response, displays real clothing cards and links them to the existing try-on studio.

This is an experimental styling system. Its current customization consists of fashion prompting, structured output, explicit exclusion guards, and retrieval of the guest's wardrobe. **The shipped model is pretrained, not fine-tuned.** An actual LoRA/optional QLoRA training pipeline, seed datasets, evaluation tools and a Colab walkthrough were implemented. Real cloud fine-tuning and custom-weight export have not been executed. Vision generation remains a separate component and has not become functional merely because language inference now works.

The earlier SLMS investigation is resolved: the user clarified that they meant a new Small Language Model, not an existing SLMS application. No unrelated school/learning-management integration was invented.

## Machine inspection and model choice

| Observed resource         | Measurement / decision                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CPU                       | Intel Core i7-13620H, 10 cores / 16 logical processors.                                                                                                                       |
| Usable system RAM         | 16,494,456 KiB, approximately 15.7 GiB.                                                                                                                                       |
| Free RAM initially        | 1,558,320 KiB, approximately 1.49 GiB; at setup the measured free RAM was 1,343,836,160 bytes (1.25 GiB). Available RAM, rather than total RAM, constrained selection.        |
| Free disk before download | Approximately 135.6 GiB on C:.                                                                                                                                                |
| Selected model            | Official Qwen2.5-0.5B-Instruct Q4_K_M GGUF, 491,400,032 bytes (468.6 MiB).                                                                                                    |
| Alternative inspected     | Official SmolLM2-360M-Instruct and its Q8 GGUF artifact, 386,404,992 bytes. Artifact availability/size were inspected; no comparative quality benchmark against Qwen was run. |
| Runtime                   | Official llama.cpp b11643 Windows x64 CPU build, 19,523,823-byte archive.                                                                                                     |
| Local inference limits    | CPU only (`-ngl 0`), four threads, 2048-token context, one slot, bounded batches.                                                                                             |
| Runtime memory sample     | Approximately 553 MiB working set after inference. This is a sampled working set, not a measured peak or system-wide guarantee.                                               |

Qwen's small instruction model and official quantized artifact support this conservative CPU deployment and the same base architecture can be used for LoRA training. No larger Transformers model weights were downloaded for local training. Setup requires at least 2 GiB free disk and 1 GiB free RAM; launcher requires 768 MiB free RAM. Resource guards fail with actionable messages rather than downloading or starting blindly.

`slm-engine/configs/local.json` records the exact Hugging Face revision, model hash, runtime release and runtime hash. Both downloaded files passed SHA-256 verification. Model/runtime downloads and the local secret are ignored by Git.

## Implemented components

| Module                                             | Implementation                                                                                                                                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/integrations/slm/`                   | Language-only `StylingProvider` port, llama.cpp adapter, prompt/schema construction, exact-model availability probe, bounded response decoding, deadlines, safe failures and returned-model checks.                        |
| `apps/api/src/modules/styling/`                    | Existing ownership-aware ClothingService/Profile retrieval, bounded 12-item lexical shortlist, explicit English category exclusions, one concurrent language request per API process, and validated ID-to-card resolution. |
| `apps/api/src/app.ts` / `container.ts`             | Provider injection and separate guest styling endpoints; dedicated language rate limit rather than consuming the vision quota.                                                                                             |
| `packages/shared/src/schemas/styling.ts`           | Strict request/output schemas and typed styling DTOs.                                                                                                                                                                      |
| `apps/web/src/app/stylist/page.tsx`                | Request form, actual runtime status, unavailable/loading/error/retry/empty/result states, wardrobe cards and Try-on links. Navigation now includes AI Stylist.                                                             |
| `slm-engine/tools/runtime.py`                      | Resource checks, pinned downloads and checksums, safe archive extraction, CPU launcher, local key creation and restricted native server.                                                                                   |
| `slm-engine/virtualfit_slm/`                       | Dataset validation, actual PyTorch/PEFT LoRA/optional CUDA QLoRA training, assistant-only token masking, evaluation, and trained-adapter merge/export preparation.                                                         |
| `slm-engine/data/`                                 | 32 train / 8 validation / 8 test authored synthetic seed records with provenance and distinct request wording.                                                                                                             |
| `slm-engine/notebooks/01_fashion_lora_colab.ipynb` | Colab CUDA check, source upload, dependency setup, training, manifest checks, merge, GGUF conversion, CPU quantization and downloads.                                                                                      |
| `slm-engine/tools/package_training.py`             | Source-only Colab ZIP; excludes runtime, weights, secrets and personal wardrobe records.                                                                                                                                   |

The existing vision provider registry, MongoDB connection, wardrobe, profile, history, favorites, and clearly labeled vision mock remain intact. No database migration or record deletion was introduced.

## Local runtime and security

The browser calls the existing Next.js proxy; Express retrieves current-guest data and calls native llama.cpp at **127.0.0.1:8081**. The runtime was verified listening only on loopback. Its web UI is disabled, CORS is restricted, and a random bearer key is stored server-side in ignored `slm-engine/runtime/api-key.txt`. Direct unauthenticated `/v1/models` returned **401**; authenticated Express status returned available. The secret is never exposed to the frontend.

Only the user's request, preferred categories and bounded garment ID/name/category/description fields enter the language prompt. No photos, measurement fields, display name, guest ID or image URLs are sent. No conversation persistence or new database collection is added. Text is rendered through React, and cards use existing wardrobe DTOs, not URLs fabricated by the model.

Model-generated IDs must satisfy a dynamic schema and backend shortlist membership checks. Unknown/duplicate IDs, truncated output and malformed JSON fail rather than being silently replaced with mock content. Model-reported category interpretation and prose can still be inaccurate. The explicit English category filter is a deterministic guard, not learned language understanding or a complete multilingual constraint system.

The styling endpoint has its own 30-request/IP/hour limit plus the existing general API limit. One request per API process prevents an uncontrolled local inference backlog. Timeouts include body reading, responses are capped at 32 KiB, and redirects are rejected. Runtime availability does not determine whether the vision API is healthy.

## Actual inference results and quality

The initial real Express request completed in approximately **3.4 seconds**, but ignored �no dresses.� That was a genuine model-quality failure. The subsequent explicit-category guard removes such prohibited candidates before inference; it does not prove that the model learned to obey every preference.

The saved held-out evaluation (`docs/slm-baseline-evaluation.json`) contains every request, expected IDs, actual response and per-case timing:

| Metric                                     | Result                        |
| ------------------------------------------ | ----------------------------- |
| Requests returning valid success responses | 8 / 8                         |
| Exact expected item sets                   | 3 / 8 (37.5%)                 |
| Mean item precision                        | 0.53125                       |
| Mean item recall                           | 0.75                          |
| Latency minimum / mean / maximum           | 2.039 / 2.785 / 3.887 seconds |

These are **eight synthetic paraphrase scenarios**, not an independent fashion benchmark. Expected item sets are narrow, and evaluation uses the current application catalog, including more garments than the seed context. Some alternative combinations may be reasonable, while observed extra garments, copied request text and unreliable category interpretation are genuine limitations. The metrics evaluate the complete retrieval/guarded pipeline, not the bare model. The assistant is useful for testing the end-to-end system but is not a dependable fashion expert yet.

Actual browser automation selected an outfit request, obtained a real CPU-generated result, confirmed no dress cards for an explicit exclusion, rendered clothing cards and followed a card into `/try-on?garment=...`. The saved [page preview](slm-stylist-preview.png) was visually inspected. Representative original workflows also passed. No simulated response was used for that language flow.

## Training pipeline and verification limits

The real training code loads the pinned original Transformers checkpoint on CUDA, attaches LoRA to Qwen projection modules, computes loss only on assistant tokens, accumulates gradients, uses mixed precision, checks finite loss and completed optimizer steps, evaluates validation loss, saves adapter/tokenizer and writes a provenance manifest with dataset hashes, model revision, steps, losses, device and software version. QLoRA optionally uses bitsandbytes NF4/double quantization on a compatible cloud CUDA runtime. GGUF is used for inference, not as a training source.

A local compatibility check with the real pinned tokenizer initially found that Transformers 5 returns a BatchEncoding by default. The implementation now explicitly requests token lists. All **48** seed examples encode with aligned assistant masks and **435�464 tokens**, below the configured 1024 limit. Regression coverage checks this with the cached real tokenizer without downloading additional assets.

Two actual CPU optimizer steps on a **tiny random Qwen-shaped model** verified that LoRA weights changed while base weights stayed frozen. This is only a training-mechanics test. Running the real training CLI locally deliberately exited **1**, before model-weight download, with the requirement for a cloud CUDA GPU. No real base-model fine-tuning, trained fashion adapter, merge, GGUF conversion, quantization of a custom checkpoint or trained-model quality comparison has occurred.

The Colab notebook passes nbformat validation and all code cells compile. The pinned conversion script and requirements paths were checked against the upstream release. **The notebook has not been executed or visually reviewed in Colab** because that environment and a GPU were not available here. To validate it end to end: upload the source ZIP, choose a free T4 runtime, run all cells, inspect the training manifest, export/download the GGUF and rerun the held-out evaluator against the custom alias. Free Colab availability/quotas are not guaranteed. Training on this tiny seed set alone is insufficient for quality claims.

## Commands and outcomes

| Command / check                                                                                            | Observed result                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CIM CPU/RAM inspection, C: free-space check                                                                | Measured before any model download.                                                                                                                                                                                             |
| `python slm-engine/tools/runtime.py setup`                                                                 | Downloaded and checksum-verified the 491 MB model and 19.5 MB runtime after resource checks.                                                                                                                                    |
| `npm run slm:serve`                                                                                        | CPU runtime loaded, bound to 127.0.0.1:8081. Left running with the application.                                                                                                                                                 |
| `python slm-engine/tools/prepare_data.py`                                                                  | 32 training, 8 validation, 8 test records; split/ID validation passed.                                                                                                                                                          |
| `ai-engine/.venv/Scripts/python.exe -m pip install --no-deps -e ./slm-engine`                              | Installed the local research package into the already compatible Python environment without upgrading its vision dependencies.                                                                                                  |
| `ai-engine/.venv/Scripts/python.exe -m pytest slm-engine/tests -q`                                         | **8 passed**, including actual tiny CPU LoRA steps, cached real tokenizer masks, dataset checks and notebook static validation.                                                                                                 |
| `ai-engine/.venv/Scripts/python.exe -m virtualfit_slm.train`                                               | Intentional exit 1: real training refuses CPU and requires a cloud CUDA GPU. No real training weights downloaded.                                                                                                               |
| `ai-engine/.venv/Scripts/python.exe -m virtualfit_slm.evaluate --output docs/slm-baseline-evaluation.json` | 8/8 requests completed; quality metrics above.                                                                                                                                                                                  |
| `python slm-engine/tools/package_training.py`                                                              | Created a source-only ZIP of approximately 28 KB, ready for Colab upload.                                                                                                                                                       |
| `ai-engine/.venv/Scripts/python.exe -m pytest -q -m "not gpu"` (inside ai-engine)                          | Existing vision suite: **67 passed, 2 skipped**, one upstream Starlette/httpx deprecation warning; no GPU inference.                                                                                                            |
| `npm run typecheck`                                                                                        | Passed for shared, API and web.                                                                                                                                                                                                 |
| `npm run lint`                                                                                             | Passed.                                                                                                                                                                                                                         |
| `npm test`                                                                                                 | **114 passed:** shared 4, API 73, web 37. Includes 12 new language-protocol/API tests.                                                                                                                                          |
| `npm run build`                                                                                            | Shared/API compiled; Next optimized build succeeded including the new `/stylist` route.                                                                                                                                         |
| `node apps/web/scripts/system-audit.mjs` with `AUDIT_SLM=1` and external cached Playwright/Chromium        | Passed all original pages plus `/stylist`; real SLM request/cards/Try-on navigation; profile persistence; wardrobe upload/search; explicit vision mock generation/download/favorite/history; no browser exceptions or HTTP 5xx. |
| Direct/proxied live HTTP                                                                                   | Health, clothing, profile, styling status returned 200 on both 3000 and 5000. MongoDB healthy and connected.                                                                                                                    |
| Real runtime-unavailable test                                                                              | Stopped only the project-owned model process; styling status returned available=false and recommendation returned 503 AI_UNAVAILABLE. Restarted successfully; no mock fallback.                                                 |
| Runtime access control                                                                                     | Unauthenticated model listing 401; Express-authenticated status available=true; listener 127.0.0.1 only.                                                                                                                        |

Browser tooling was used from the external npm cache; no Node package dependency was added. Existing app development startup remained `npm run dev`; `npm run slm:serve` ran alongside it. The new `dev:slm` script combines those same commands for subsequent starts. Do not run a second app instance on occupied ports.

## What works, what requires cloud training, what remains incomplete

**Works locally:** authenticated CPU language inference; styling frontend/API/provider architecture; guest-scoped wardrobe retrieval; structured recommendations and real clothing cards; explicit exclusion guard; error/timeout/unavailable/concurrency behavior; original app routes and MongoDB; synthetic dataset/evaluator; tiny LoRA mechanics tests and real tokenizer alignment.

**Prepared, requires cloud CUDA execution:** real LoRA/QLoRA fine-tuning, trained-adapter quality evaluation, merge, custom GGUF conversion/quantization and deployment of that checkpoint. The Colab notebook and ZIP are a runnable handoff, not evidence of completed training.

**Incomplete:** high-quality fashion reasoning, multilingual/exhaustive preference constraints, scenario-disjoint diverse training/evaluation, human preference scoring, conversational memory, multi-process job coordination, global cancellation of timed-out native inference, cloud GPU execution and genuine custom checkpoints. A native request that ignores cancellation may occupy its slot after the Express deadline; verify prolonged timeout recovery before any multi-user deployment.

The vision engine remains separate under `ai-engine/`. No local GPU-heavy image model was attempted. Prior audit findings still apply: hosted vision is quota-dependent, Python vision requires configuration/GPU/checkpoints, and no customized vision checkpoint was identified. SLM success does not validate realistic try-on generation.

## Next priorities

1. Expand and review the fashion corpus, with diverse situations, refusal/no-match examples and scenario-/garment-disjoint held-out sets; keep the existing measured baseline intact.
2. Run the Colab LoRA pipeline on a free CUDA runtime, retain its manifest, compare generated outputs and preference/grounding failures against the base model, and ship a custom checkpoint only if the measured behavior improves.
3. Add richer metadata (colors, materials, occasions) and retrieval scoring. Guard explicit constraints with metadata rather than relying on tiny-model prose. Add multilingual test cases before claiming support.
4. Add reliable cancellation/queue coordination and deployment hardening if moving beyond a single local user. Keep the language endpoint local until that work is justified.
5. Continue vision research/training independently; evaluate true image generation and language styling as separate capabilities.

## References

- [Official Qwen quantized model](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF), pinned artifact/revision/hash in local.json.
- [Original Qwen training checkpoint](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct), pinned training revision in lora.json.
- [SmolLM2 comparison candidate](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct).
- [llama.cpp b11643](https://github.com/ggml-org/llama.cpp/tree/b11643) and [server API documentation](https://github.com/ggml-org/llama.cpp/blob/b11643/tools/server/README.md).
- [PEFT quantized training](https://huggingface.co/docs/peft/en/developer_guides/quantization).
- Local implementation/setup: [slm-engine README](../slm-engine/README.md), [Colab notebook](../slm-engine/notebooks/01_fashion_lora_colab.ipynb), [saved baseline](slm-baseline-evaluation.json).
