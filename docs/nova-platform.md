# Nova AI platform

Nova's branded application is **http://localhost:3000/nova**, with browser title **Nova AI**, its own header/sidebar, and **Powered by NovaCTO** attribution. `/stylist` remains available and links to Nova. The native llama.cpp diagnostic UI at `127.0.0.1:8081` remains unchanged and authenticated; it is not the new application frontend.

## Implemented

- Responsive dark/light chat UI, previous conversations, new/rename/delete, title and message-content search, Markdown/GFM tables and fenced code, copy, regenerate, stop, model status, image attachment previews, image mode and generation history.
- Real streaming text through Next.js → Express → the existing CPU Qwen/llama.cpp server. No browser receives the llama.cpp key or calls port 8081. The central Nova identity remains in use. ChatML template/tokenization preflight measures the effective prompt and removes old turns when necessary; the current request is never silently truncated.
- Fashion requests route through the existing wardrobe retrieval and schema/ID/explanation validation. That path buffers output until grounding checks pass rather than streaming unsafe drafts. Source metadata distinguishes accepted model replies from deterministic fallbacks. General chat streams genuine model deltas.
- Separate MongoDB conversation, message, preference, settings, attachment, image-job and training-example collections. Failed/cancelled/partial replies survive refresh. Regeneration retains superseded audit output without duplicating the user turn. API restart marks interrupted jobs failed; it does not restart them indefinitely.
- Explicitly approved memory with view/edit/delete/disable controls. Up to four approved preferences are selected by keyword relevance and injected as untrusted context. Older user topics get a bounded **extractive** summary; no embedding model or invented semantic summarization is claimed. Memories are not automatically harvested from conversations.
- JPEG/PNG/WebP content decoding, static-image and 16-megapixel checks, rotation, metadata stripping and safe WebP normalization. Images live in the controlled `uploads/nova` bucket; MongoDB stores references/metadata, not binary payloads. Download and preview routes enforce ownership.
- Separate configurable vision and image-generation adapters, authenticated provider requests, model-revision metadata, bounded response bodies, timeouts, queue/status/retry/cancel/delete paths. A disabled/failed provider never substitutes text-model guesses or fake image files.
- Consent-based text training submissions, user correction and revocation controls, local operator-only review/export, deduplication and contract/PII checks, versioned split preparation, current-consent verification and explicit Colab packaging. No automatic weight changes occur.

This extends the existing application; it does not replace the Stylist, MongoDB wardrobe, mock provider, Gradio/try-on vision service, LoRA trainer, checkpoint evaluation or rollback gates.

## What was verified with real AI

The isolated Chrome live check used the actual local Qwen model and **MongoDB**, not an in-memory database or a mock language provider. It verified streamed token events; Nova's introduction; persisted messages and recovery after browser refresh; conversation rename/regenerate; explicit memory creation, retrieval and deletion; cross-guest access denial; real image upload decoding/previews; Stop generation; mobile layout/themes; and Express-only browser traffic. An actual remembered preference reply was: “You have shared the preference that you prefer black formal outfits.”

The media URLs are **not configured** in the current environment. Image understanding and generation correctly returned unavailable errors, with no fabricated caption or generation result. No real media-model inference, GPU training or new checkpoint was completed. Adapter/job tests use explicitly named test fixtures; they establish protocol and lifecycle behavior, not AI image quality.

The live test writes ignored `slm-engine/runs/nova-platform-live.json`, `nova-platform-desktop.png` and `nova-platform-mobile.png`. It uses a fresh anonymous session and deletes only its own synthetic fixtures. The original Qwen GGUF remains unchanged and remains the production/default model.

Verification on 16 October 2026: **165 JavaScript tests passed** (7 shared, 117 API, 41 web), **35 Python tests passed** (32 SLM/training/runtime and 3 media-worker protocol/security tests), and lint/type checks plus the complete production build passed, including `/nova` and all existing routes. The Python suite emitted one existing Starlette/httpx deprecation warning. Its initial slow import was diagnosed in Transformers' import-structure scanning; the completed run passed all checkpoint/resume and optimizer tests. CPU toy optimizer tests are not a real fine-tune of the production Qwen model. API test workers are capped at two to avoid competing with the local model for all available RAM; test timeout thresholds were not raised. See [the saved live verification report](nova-platform-verification.json).

## Start and verify

```powershell
cd C:\virtualfit-ai
npm run dev:ai
# Open http://localhost:3000/nova
```

An already healthy Qwen on loopback 8081 is reused after real inference verification. `npm run dev` and `npm run slm:serve` remain supported. The optional media worker is never started by these commands. A successful health check alone is not treated as successful generation.

```powershell
npm test
npm run lint
npm run typecheck
npm run build
ai-engine/.venv/Scripts/python.exe -m pytest slm-engine/tests nova-engine/test_server.py -q
node apps/web/scripts/verify-nova-platform.mjs
node apps/web/scripts/verify-stylist.mjs
```

Browser checks use the isolated Chrome/Playwright setup documented in `slm-web-ui.md`. Run live checks sequentially; concurrent independent clients can legitimately receive a busy/queue response. Stop development servers before a production build so Next.js output is not modified beneath a running dev server.

## Persistence, isolation and deletion

Ownership comes only from the existing unpredictable httpOnly guest-session cookie, never from a request body. Every conversation, message, memory, image/job and submission is scoped to that identity. Cross-origin writes are rejected. There is no public model-administration, dataset-approval or dataset-export API.

This app currently has guest sessions, not newly invented account/login support. Persistence works across refresh/restart while the same guest cookie remains. Clearing/expiring the cookie loses access to that guest's data; cross-device identity recovery is not implemented. Public deployment needs real account authentication and stronger deployment/session policy.

New Nova data defaults to **30-day retention**, configurable per guest from 1–365 days. Conversation expiry follows its last update; approved memory expiry follows its last edit; image-job and submission expiry follow creation. The existing purge timer runs every ten minutes. Unreferenced uploads expire after one day. Referenced files are retained while their conversation/job is retained, then removed. Clear-history removes conversations and linked training submissions; approved memory is separate. Delete-all-Nova-data removes that guest's Nova chats, preferences, images, jobs, submissions and settings. Existing profile erasure also calls the Nova eraser. Active jobs must finish stopping before deletion succeeds; a conflict response asks the caller to retry.

The API reports `persistence: memory` with a visible warning if the existing application falls back to temporary storage. It does not claim MongoDB durability in that mode. No destructive database migration or deletion of existing user records was performed.

Approved text can exist in an earlier conversation even after its separate memory entry is deleted. Use clear-history/delete-all to remove that history too. Exported datasets/checkpoints on an operator's disk cannot be retroactively erased or “unlearned” by deleting a database row; verify current consent and remove/regenerate exported artifacts before training or activation.

## Resource settings

All values are server-side environment settings; restart the API after changing them. They do not require a paid subscription or impose daily chat/image quotas.

| Setting | Default | Purpose |
| --- | --- | --- |
| `MAX_UPLOAD_MB` | Existing app setting | Compressed upload byte cap |
| `NOVA_STORAGE_MB` | 512 | Total controlled Nova image-file storage |
| `NOVA_MIN_FREE_DISK_MB` | 256 | Refuse new files when remaining disk is too low |
| `NOVA_CONCURRENCY` | 1 | Concurrent Nova inference jobs |
| `NOVA_QUEUE_SIZE` | 8 | Bounded waiting queue, then explicit 429 |
| `NOVA_TIMEOUT_MS` | 120000 | Queue + inference deadline |
| `NOVA_REQUESTS_PER_MINUTE` | 180 | Technical per-IP rate protection, not a daily allowance |

`/nova/status` reports queue depth, active jobs, image bytes, storage allowance and free disk. The byte allowance covers this application's image bucket, not MongoDB's own storage allocation. One API process owns the current scheduler; multiple replicas would need a shared durable queue and distributed storage accounting. The native llama.cpp server still has one slot. Other existing Stylist/native clients share that CPU capacity. Aborting a fetch stops local delivery; arbitrary third-party GPU backends may continue compute. The supplied worker checks cancellation during generation steps, but model download/loading cannot be interrupted immediately.

There are no claims of unlimited GPU time, bandwidth, storage or free hosted inference. Colab/Kaggle availability and quotas are external constraints.

A live Stylist regression also exposed the installed Next.js rewrite proxy's **30-second default**: it returned a socket-reset 500 while the backend subsequently produced a valid recommendation. Native logs showed roughly 28–32 seconds for those inference tasks under current machine load, plus readiness/request overhead. The proxy now has a finite 610-second ceiling, just above Express's maximum configurable 600-second media deadline. Existing model deadlines remain enforced (including the Stylist's 60-second limit). A configuration regression test checks this ordering. This fixes premature proxy disconnection; it does not claim to make CPU inference faster or eliminate genuine backend timeouts.

## Optional real media models

Current hardware is CPU-only PyTorch; inspection found roughly 1.7 GiB free RAM at the start of this task. No extra model was downloaded into this memory-constrained running environment.

| Candidate | License from model card | Decision |
| --- | --- | --- |
| [SmolVLM-256M-Instruct](https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct) | Apache-2.0 | Selected small vision baseline; optional CPU benchmark or remote GPU host. Fashion-detail quality still needs evaluation. |
| [Qwen2.5-VL-3B-Instruct](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct) | Qwen research license | Larger candidate; not silently treated as Apache-licensed or selected for this CPU machine. |
| [Segmind SSD-1B](https://huggingface.co/segmind/SSD-1B) | Apache-2.0 in its model card | Selected smaller GPU image candidate, with SDXL-family 1024px inference and CPU offload. GPU memory/latency must be measured on the actual host. |
| [FLUX.1-schnell](https://huggingface.co/black-forest-labs/FLUX.1-schnell) | Apache-2.0; gated access conditions | Larger 12B alternative, not downloaded or selected for the current machine. |
| [SDXL Turbo](https://huggingface.co/stabilityai/sdxl-turbo) | Stability noncommercial/community terms | Not chosen as a license-interchangeable default. |

These are model-card license reports, not a guarantee that all downstream deployment/use obligations disappear. Review the full licenses and any upstream/usage conditions before deployment. `nova-engine/models.json` pins the selected model revisions. The existing Qwen text weights and llama.cpp installation are untouched. Technical attribution remains visible in Memory & privacy and in the existing model documentation.

### Worker setup on your own GPU host

The supplied FastAPI worker contains real Transformers vision and Diffusers image inference implementations. It has been protocol/security tested **without loading weights**. Real model execution remains unverified until these steps are run on a suitable host.

1. Copy `nova-engine/` to the GPU host. Create a separate Python environment; install CUDA PyTorch suitable for that host, then `pip install -r requirements.txt`. Do not replace the app's existing CPU environment.
2. Set a private `NOVA_WORKER_API_KEY` of at least 24 characters. Enable only needed functions: `NOVA_ENABLE_VISION=1` and/or `NOVA_ENABLE_IMAGES=1`. Set `NOVA_MEDIA_ALLOW_DOWNLOADS=1` only when deliberately downloading the pinned models. By default only cached weights can load. No model loads at worker import/startup.
3. Run `python server.py` from `nova-engine/`. It binds `127.0.0.1:8090`, requires bearer authentication, and serializes compute. For remote use, put it behind authenticated TLS/private networking or a controlled SSH tunnel. Do not publish an unauthenticated notebook port.
4. Configure the Express root `.env` with the worker origin and private matching keys:

```dotenv
NOVA_VISION_URL=https://your-private-worker.example
NOVA_VISION_KEY=your-private-worker-key
NOVA_VISION_MODEL=HuggingFaceTB/SmolVLM-256M-Instruct
NOVA_VISION_EXTERNAL=true
NOVA_IMAGE_URL=https://your-private-worker.example
NOVA_IMAGE_KEY=your-private-worker-key
NOVA_IMAGE_MODEL=segmind/SSD-1B
NOVA_IMAGE_EXTERNAL=true
```

5. Restart Express. Select Understand image or Generate image in Nova. Approve external processing for that request, then run a real inference and inspect the output, model revision, persisted status and file. Configured is not the same as verified inference readiness.

The adapters use `/v1/chat/completions` with an image content block and `/v1/images/generations` with base64 image output. Other compatible gateways can be configured without replacing the language provider. Arbitrary output URLs are not downloaded. Remote origins require HTTPS; redirects are rejected. Consent defaults **on even for localhost gateways**, because a loopback URL might forward to a remote GPU. Set `NOVA_*_EXTERNAL=false` only for genuinely local processing. A tunnel to another computer must remain disclosed as external.

For a deliberate SmolVLM CPU benchmark, explicitly set `NOVA_ALLOW_CPU_VISION=1` on a host with adequate spare RAM and enable vision. Record cold start, inference latency, peak memory and visual correctness before claiming CPU suitability. Image generation on CPU is disabled; no CPU speed or GPU-memory benchmark is claimed. For Colab/Kaggle, an available GPU runtime, package installation, model downloads and a private connection back to Express remain operator tasks; this agent cannot access your notebook session.

## Controlled learning lifecycle

1. Use **Offer for training review** on a completed text reply. Correct the answer and explicitly consent. Photo/vision replies are excluded. The HTTP record is always pending review; users cannot set approval/quality fields.
2. As the local operator, inspect examples with `npm run nova:training -- list`. Review each independently: `npm run nova:training -- review <submission-id> approved` (or `rejected`). The CLI applies privacy/schema/verified-ID gates, but human factual review is still required.
3. Export only approved, consented, validated examples with an absolute new filename: `npm run nova:training -- export C:\virtualfit-ai\slm-engine\runs\nova-reviewed-v1.json`. It deduplicates normalized requests and writes a content-derived dataset version. It never overwrites an earlier export implicitly.
4. Recheck current consent with `npm run nova:training -- verify C:\virtualfit-ai\slm-engine\runs\nova-reviewed-v1.json`. Deleted/rejected submissions or changed reviewed content/configuration invalidate the export. Repeat this check before upload/training and activation.
5. Create a new split directory: `python slm-engine/tools/prepare_reviewed_nova.py slm-engine/runs/nova-reviewed-v1.json slm-engine/data/reviewed/v1`. At least three unique reviewed examples are required. The existing Python validator checks target grounding and split leakage; a failed directory is marked INVALID and must not be trained from. Private reviewed datasets are ignored by Git.
6. Package explicitly: `python slm-engine/tools/package_training.py --reviewed-data slm-engine/data/reviewed/v1`. Default packaging never picks up private reviewed datasets. This option includes only validated split/manifest files and selects that dataset in the ZIP's LoRA config; it does not modify the local base config or model.
7. Use the existing `01_fashion_lora_colab.ipynb` and [first real training guide](first-cloud-training-run.md). The notebook reads its dataset from the packaged config. Run GPU/tokenizer checks, genuine optimizer smoke steps, persistent checkpoints/resume, then paired base/candidate evaluation. No heavy training runs when the web server starts.
8. Preserve experiment manifests, dataset hashes, resume metadata and checkpoint files. Export/convert with the existing pipeline. Activate only through the existing quality/registration/loading gates; keep the original Qwen rollback available. No custom checkpoint is fabricated or automatically activated.

## API inventory

All paths below are under `/api/v1/nova`, use the existing guest session and strict body validation, and return conventional application errors. Streams use `meta`, `status`, `delta`, `done` and `error` SSE events, with heartbeats. A disconnect cancels work and persists partial output.

| Path | Methods | Purpose |
| --- | --- | --- |
| `/status`, `/settings` | GET; settings PATCH | Real language readiness, resources, media configuration, own privacy settings |
| `/conversations` | GET, POST, DELETE | Search/list, create, clear own history |
| `/conversations/:id` | GET, PATCH, DELETE | Owned messages, rename, cascade deletion |
| `/conversations/:id/stop` | POST | Stop owned active chat |
| `/chat`, `/chat/stream` | POST | Persisted nonstreaming/streaming chat; explicit regenerate flag |
| `/attachments` | POST multipart `image` | Validate/re-encode/store image |
| `/attachments/:id` | GET, DELETE | Private preview/download (`?download=1`) and unreferenced-file deletion |
| `/memory`, `/memory/:id` | GET/POST; PATCH/DELETE | Explicit approved preferences |
| `/images/generate` | POST | Create real-provider image job; 503 when unavailable |
| `/generations`, `/generations/:id` | GET; GET/DELETE | Own generation history/status/files |
| `/generations/:id/cancel`, `/retry` | POST | Cancellation, explicit retry with renewed external consent |
| `/training/examples`, `/training/examples/:id` | GET/POST; DELETE | Pending consented submissions and revocation; never public approval/export |
| `/data` | DELETE | Erase the current guest's Nova data |

## Stabilization report (16 October 2026)

### Proxy timeout: root cause and fix

Chain: Browser → Next.js rewrite proxy (`httpxy`) → Express → llama.cpp.

- **Root cause:** Next.js 16.4.1 `proxyRequest` uses `proxyTimeout || 30000` for rewrites. A silent response taking longer than 30 s (local Qwen at 28–32 s plus template/tokenize overhead) had its upstream socket destroyed, producing `socket hang up / ECONNRESET` and a bare HTTP 500, while Express carried on and finished.
- **Reproduced** with a fake upstream behind a real `next dev` proxy at the 30 s setting: a silent 35 s JSON response failed at exactly 30.0 s with ECONNRESET. A heartbeating SSE stream survived (the proxy timeout is an *idle* timeout, which the 15 s Nova heartbeats keep alive).
- **Fix:** `apps/web/next.config.ts` sets `experimental.proxyTimeout` from `WEB_PROXY_TIMEOUT_MS` (validated 1000–3600000, default 610000, just above Express's 600 s maximum), via `resolveProxyTimeout` in `apps/web/src/lib/api-url.ts`. Express keep-alive (`keepAliveTimeout` 65 s, `headersTimeout` 66 s) is now explicit in `apps/api/src/server.ts` instead of Node's 5 s default.
- **Deadline ordering (innermost fires first):** llama.cpp call `SLM_TIMEOUT_MS` (60 s, Stylist) / `NOVA_TIMEOUT_MS` (120 s, Nova; max 600 s) → Express `AbortSignal` returns a structured `AI_TIMEOUT` → Next proxy 610 s. The browser has no fixed timer on the stream; Stop cancels it.
- **Verified after the fix** (fake upstream, real Next proxy): 35 s silent JSON → 200 at 35.1 s; 20 s heartbeat SSE → 200 with all frames; client abort of a 60 s stream at 4 s → upstream observed the abort (cancellation propagates browser → proxy → upstream, and Nova's `res.on('close')` aborts the llama.cpp fetch); with `WEB_PROXY_TIMEOUT_MS=8000` a silent 20 s response failed cleanly at 8.1 s and the upstream saw the disconnect (genuine timeout still works), while heartbeating SSE correctly continued.
- Not every timeout was raised: model deadlines are unchanged, and only the proxy (which was *below* the API's deadlines) was corrected. No test timeouts were changed. The Express→llama.cpp leg was not separately load-tested with a >30 s real Qwen response this session (Qwen answered quickly); it was verified by code review and the fake-upstream tests above.

### Exact results (current repository, re-run, not copied from earlier reports)

| Check | Result |
| --- | --- |
| Shared build, API `tsc --noEmit`, web `tsc --noEmit` | pass |
| ESLint (`npm run lint`) | pass, no findings |
| JavaScript tests | 165 passed (shared 7, API 117, web 41) |
| SLM/training/runtime Python (`slm-engine`) | 32 passed |
| Nova media worker (`nova-engine/test_server.py`) | 3 passed (protocol/security; no weights loaded) |
| Vision (`ai-engine`) | 69 passed, 2 skipped |
| Production build (`npm run build`) | pass; `/nova` and all routes built |
| Live Chrome check (`verify-nova-platform.mjs`, production servers, real Qwen + MongoDB) | pass: title/branding, streaming, rename, refresh persistence, regenerate, Stop, memory consent/recall/deletion, guest isolation, invalid + valid image upload, vision and image-generation unavailable states, mobile + light theme, Express-only traffic |

`npm run format:check` still reports Prettier differences in about 35 files (mostly JSON data, docs and files outside this change); it is not part of the requested gates and was not bulk-reformatted.

### Files changed during stabilization

`apps/web/next.config.ts`, `apps/web/src/lib/api-url.ts`, `apps/web/src/lib/api-url.test.ts`, `apps/api/src/server.ts`, `docs/nova-platform.md`. The rest of the earlier Nova work was preserved.

### Real versus simulated

- **Real:** local Qwen2.5-0.5B text streaming, MongoDB persistence, memory, ownership isolation, upload validation, cancellation.
- **Not exercised with real models:** SmolVLM vision and SSD-1B image generation (no worker configured; both return explicit unavailable errors, and no image was generated). Adapter tests use named fixtures that prove protocol, not model quality.
- "Authentication" is the existing anonymous guest-session cookie plus the bearer key between Express and llama.cpp; there is no user login system.

### Media configuration and GPU plan

Licenses recorded in `nova-engine/models.json` (SmolVLM-256M-Instruct: Apache-2.0; SSD-1B: Apache-2.0) come from the earlier model-card review and were not re-fetched in this pass; review the full terms before deployment. Both workers stay off unless `NOVA_VISION_URL` / `NOVA_IMAGE_URL` are set; the worker loads nothing at import and downloads only with `NOVA_MEDIA_ALLOW_DOWNLOADS=1`. Nothing heavy was downloaded or loaded on this CPU-only machine. When a GPU host is available: follow "Worker setup on your own GPU host" above, keep it behind TLS or an SSH tunnel, set the matching `NOVA_*` variables, benchmark, and only then call image features working.

### Training and memory safety (reviewed)

Training submissions need per-example user consent and stay pending until a local operator approves via CLI (no HTTP route approves or exports). Export requires consent + approval + contract validation, is write-once, deduplicated and content-versioned. `verify` rechecks that every source still exists with consent and that the dataset hash is unchanged. Conversation deletion revokes submissions. Cloud bundles are an allowlist of source, configs, public training data and an explicitly named reviewed split, never conversations, memories, uploads or `.env`. Covered by `nova.test.ts` and `test_reviewed_nova.py`. No weights are changed automatically; the original Qwen GGUF is untouched.

### Remaining blockers

No real vision/image-generation inference (needs a GPU worker); no custom model has been trained; Prettier drift; single-instance in-process queue.

## Remaining limits

The small text model is not a general-purpose frontier model; token/context limits and disclosed fallbacks still apply. Image understanding/generation require configured real workers and model-quality evaluation. No GPU experiment was executed. Current search is owner-scoped lexical search, not vector retrieval; list/search repository scans and the in-process queue suit a local single-instance app, not a large public multi-replica service. Authentication remains the application's guest-session design. External media backends can impose their own availability/compute limits. These limits are visible rather than masked with simulated successes.
