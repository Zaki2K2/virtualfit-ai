# VirtualFit language engine

**Phase 3 update:** attribute-grounded retrieval, disclosed deterministic fallbacks, scenario-disjoint 16/16/102 evaluation splits, independent 64/8/8 training data, persistent smoke/resume checkpoints and gated base/custom selection are now implemented. Read [the current progress report](../docs/slm-finetuning-progress.md). Earlier 3/8 metrics below describe the original pipeline, not the latest one. No real GPU fine-tune has run.

This directory owns **language recommendations**, dataset preparation, LoRA training and evaluation. `../ai-engine/` continues to own realistic virtual try-on vision. No language model generates clothing images.

## Local CPU inference (Windows x64)

The verified configuration uses the official Qwen2.5-0.5B-Instruct Q4_K_M GGUF and llama.cpp b11643. Setup checks available RAM and disk, pins source revisions, and verifies SHA-256 hashes. It downloads approximately 469 MiB of model weights and 19 MiB of runtime binaries. It does not download the larger Transformers training weights locally.

From the repository root:

```powershell
npm run slm:setup
npm run dev:slm
```

If `npm run dev` is already running, keep it running and use `npm run slm:serve` in another terminal. Open http://localhost:3000/stylist. Avoid starting two copies on the same ports.

The native runtime binds only 127.0.0.1:8081, uses four CPU threads, 2048 tokens of context, one slot, small batches, and zero GPU layers. Its web UI is disabled. It creates a random local API key at ignored `runtime/api-key.txt`; Express reads this file server-side. The browser never receives the key or calls llama.cpp directly. Model files and runtime binaries are ignored by Git.

The existing root `.env` may contain:

```dotenv
SLM_URL=http://127.0.0.1:8081
SLM_MODEL=virtualfit-style-base
SLM_TIMEOUT_MS=60000
```

These defaults work without editing `.env`. The Python launcher reads only `SLM_MODEL_PATH`, `SLM_MODEL`, and `LLAMA_SERVER_PATH` from it; existing vision/MongoDB configuration is untouched. The automatic setup is Windows-specific; on Linux/macOS provide a compatible llama-server and GGUF via those runtime path options. Free-RAM guards deliberately fail rather than downloading/starting when memory is too low. Closing unused apps is preferable to increasing context on this machine.

## Recommendation architecture

`Next.js /stylist ? Express /api/v1/styling ? StylingProvider ? local llama.cpp ? schema/ID validation ? wardrobe cards`.

The service retrieves only current-guest uploads plus the bundled catalog through the existing ClothingService, along with preferred categories from Profile. No measurements, photos, display name, guest ID, or image paths are included in model context. Requests are stateless; no chat history is stored. Only 12 bounded candidate descriptions are sent, ordered by a simple lexical retrieval score. Explicit English category exclusions are filtered before inference. This deterministic guard is separate from learned inference and is not a complete natural-language constraint parser.

The model is customized **through fashion instructions, structured output and live wardrobe grounding**. The shipped model is pretrained, **not fine-tuned**. Unknown/duplicate IDs, malformed or truncated output, timeouts and unavailable runtime errors fail explicitly; there is no silent mock fallback. The assistant can still misunderstand requests, colors or combinations. Its free text is untrusted; cards are resolved from actual database/catalog items, not model-generated image URLs. The existing vision mock and Gradio/Python providers remain separate.

A dedicated rate limit (30 requests/IP/hour), shared API rate limit, and one active language request per API process bound CPU use. This is local development infrastructure, not a hardened multi-user inference deployment. Do not expose port 8081 publicly. Root model URL validation permits only loopback HTTP origins.

## Dataset and evaluation

```powershell
python slm-engine/tools/prepare_data.py
# Use an environment with the optional dev/train dependencies:
python -m pip install -e "./slm-engine[dev,train]"
python -m pytest slm-engine/tests -q
python -m virtualfit_slm.evaluate --output docs/slm-baseline-evaluation.json
```

The prepared corpus contains 32 train, 8 validation and 8 test examples. It covers outfit selection, occasions, categories, preferences/exclusions, and unavailable items. It is an authored synthetic bootstrap corpus. Splits use distinct request wording but overlapping scenarios and garments: exact request leakage is checked, while scenario-level independence is **not** claimed. Expand it substantially and review examples before meaningful fine-tuning. The evaluator uses the live Express route and current catalog, so it measures the complete system including retrieval and guards, not raw model accuracy. Expected exact item sets are narrow and may penalize other valid combinations. It does not automatically score prose quality.

Current real CPU baseline: 8/8 successful responses, 3/8 exact item sets, mean precision 0.53125 and recall 0.75. See `../docs/slm-baseline-evaluation.json` for every request and output. These eight examples are not a broad fashion benchmark. The initial unguarded prototype ignored �no dresses�; the explicit exclusion guard prevents that category from entering model candidates. Other preference failures remain visible in the evaluation.

## Real LoRA training on a free cloud GPU

Open `notebooks/01_fashion_lora_colab.ipynb` in Colab and select a free T4 GPU runtime. Package source locally with:

```powershell
python slm-engine/tools/package_training.py
```

Upload `runs/virtualfit-slm-training.zip` in the notebook. It excludes runtime, models, secrets and all personal wardrobe records. The notebook installs the training extras, validates data, runs actual PyTorch/PEFT LoRA training, merges the adapter, converts the model to GGUF, quantizes to Q4_K_M, and offers downloads. **The GPU notebook has only been structure/code-validated locally; cloud training, merge and GGUF export have not been executed.** It requires Colab network access and a CUDA GPU. No account credentials or paid services are embedded.

Training CLI (inside the installed cloud environment):

```bash
python -m virtualfit_slm.train
# Optional Linux CUDA bitsandbytes QLoRA, after installing [qlora]:
python -m virtualfit_slm.train --qlora
python -m virtualfit_slm.export slm-engine/runs/fashion-lora slm-engine/runs/fashion-merged
```

Configuration pins the base model revision, LoRA targets/rank, seed, sequence limit, 64 optimizer steps and gradient accumulation. GGUF is an inference format; training loads the original Transformers checkpoint. Plain LoRA is default for compatibility; QLoRA uses NF4/double quantization only on compatible CUDA installations. Assistant-only labels prevent learning to reproduce the input wardrobe. The pipeline checks target alignment and refuses truncation, nonfinite loss, skipped optimizer steps, or real CPU training. The manifest records resolved model revision, dataset hashes, actual optimizer steps, losses, CUDA device and software version. The held-out test split is not used for training/validation loss.

Local tests actually ran two optimizer steps on a **tiny random Qwen-shaped model**, verified that only LoRA weights changed, and checked the real pinned tokenizer against all 48 examples (435�464 tokens). This validates mechanics; it does not create a useful fashion checkpoint or prove cloud training works.

After exporting a genuinely trained model, put its GGUF outside source control and configure:

```dotenv
SLM_MODEL_PATH=C:/virtualfit-ai/slm-engine/models/virtualfit-fashion-q4_k_m.gguf
SLM_MODEL=virtualfit-fashion-custom
```

Restart runtime and Express so aliases agree. Run the evaluator to a new file and compare with the baseline. Preserve its training manifest; do not claim improvement just because a file was created or the adapter merged. Inference and custom-export pipeline paths are implemented; no real customized-weight checkpoint exists yet.

## Sources

- [Official Qwen2.5-0.5B-Instruct GGUF](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF): quantized artifacts and Apache-2.0 license.
- [Official SmolLM2-360M-Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct): evaluated alternative; official GGUF repository offers an approximately 369 MiB Q8 file. Qwen Q4 was selected for its modest resource footprint and instruction-oriented language behavior; no comparative quality benchmark between these models was run.
- [Pinned llama.cpp source](https://github.com/ggml-org/llama.cpp/tree/b11643) and [server documentation](https://github.com/ggml-org/llama.cpp/blob/b11643/tools/server/README.md): local CPU server and structured output contract.
- [PEFT quantization guidance](https://huggingface.co/docs/peft/en/developer_guides/quantization): k-bit training preparation and LoRA/QLoRA configuration.

## Phase 3 execution

Use `data/training-v2` (the configured default) for actual fine-tuning. `data/train.jsonl`, `validation.jsonl` and `test.jsonl` are historical bootstrap artifacts, never selected by the current trainer. The source-only Colab packer now includes only the v2 training folder, not the evaluation gold answers.

The revised notebook runs a 2-step smoke test, verifies an adapter and trainer-state checkpoint, then resumes to 64 steps on Google Drive. It restores optimizer, scaler, Python/PyTorch/CUDA RNG and example order, checking model/data/hyperparameter identity. Checkpoints appear every 4 steps; no existing checkpoint is overwritten. Use `--resume <checkpoint-dir>` after a disconnect. GPU execution remains unverified here.

Run the benchmark harness in its own terminal: `npx tsx apps/api/scripts/styling-benchmark-server.ts`. It binds only 127.0.0.1:5100, uses isolated memory storage and the real CPU provider, and accepts explicitly synthetic garment fixtures without writing them to live MongoDB. Restart this isolated harness for every run to retain identical fixture IDs; production IDs remain random. Then run:

```powershell
python -m virtualfit_slm.evaluate_suite --split heldout --output docs/slm-v2-heldout-base.json
```

The harness's test environment omits request throttling so a 102-case benchmark can finish; live application rate limits remain enabled. Do not expose the harness. Evaluation reports include dataset/catalog hashes, latencies, intent/category/color/schema/grounding/exact-match scores, raw model validity, and fallback counts. Read final-pipeline scores separately from model quality.

Base/custom serving is explicit. `npm run slm:serve` always uses the original hash-verified rollback model on 8081. For an exported candidate, use `python slm-engine/tools/runtime.py serve --variant candidate --model-path C:/path/custom.gguf` on 8082. Evaluate with `--model custom`, then run `python -m virtualfit_slm.register_custom --help`. Registration requires real training provenance, a matching loaded GGUF, the same held-out dataset/catalog and non-regressing metrics/raw acceptance. Only then does the production frontend enable Custom. `--variant custom` subsequently starts the registered artifact; Original remains available. The old `SLM_MODEL_PATH` approach no longer replaces the base model.
