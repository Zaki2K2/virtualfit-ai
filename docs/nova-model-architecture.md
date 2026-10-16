# Nova model architecture and orchestrator

Status legend: **Implemented** (code + tests in this repo), **Reused** (existing, unchanged), **Planned** (documented intent only; the registry marks it `planned` and it can never resolve).

## Principles

- The Node/TypeScript API is the orchestrator. Python services (`slm-engine`, `nova-engine`, `ai-engine`) only run machine-learning workloads behind HTTP.
- The orchestrator owns no weights, starts no processes and downloads nothing. It decides, gates and records.
- A capability is "available" only when it is configured **and** its health probe does not fail. Configured is not the same as verified. Nothing is faked: unavailable means an explicit `unavailable` decision with a reason.
- Provider-independent: every capability is a registry entry plus an adapter. Switching providers is a registration/config change, not a rewrite.

## Layers

```
Browser ─► Next.js (/api proxy) ─► Express ─► NovaService (chat, streaming, jobs)   [Reused]
                                      │
                                      └─► Orchestrator  (apps/api/src/modules/orchestrator)  [Implemented]
                                            ├─ ModelRegistry   what exists, what is usable, why not
                                            ├─ router          task → capability → model (deterministic)
                                            ├─ ResourceMonitor RAM / disk / CPU gate for lazy models
                                            ├─ ToolRegistry    deny-by-default, approval-gated tools
                                            └─ KnowledgeService consented documents, chunks, retrieval
                                      ▼
            llama.cpp (Qwen, always on) · nova-engine worker (opt-in) · VirtualFit try-on providers
```

## Model registry (Implemented)

`modules/orchestrator/registry.ts`. Each descriptor has: `id`, `name`, `type` (capability), `provider`, `execution` (`local`|`remote`), `state` (`enabled`|`unconfigured`|`planned`), `loadsOnDemand`, `isDefault`, `contextTokens`, `hardware` (`gpu`, `minFreeRamGb`, `minVramGb`, `estimated`), `license` (name + source), `version`, optional `simulated`, and a live `health` report (`healthy`|`unhealthy`|`unknown`, reason, time).

- Descriptors are derived from environment configuration only. Building the registry makes **no network call**.
- Health is probed lazily, on demand (3 s timeout, 30 s cache). A throwing or hanging probe counts as unhealthy.
- `resolve(type)` returns the default usable model or the reasons none is usable (planned, unconfigured, unhealthy, insufficient RAM).
- Hardware numbers are labelled `estimated: true` unless measured. They come from model cards, not from this project's benchmarks.

| Model | Type | State today | Execution | Notes |
| --- | --- | --- | --- | --- |
| Qwen2.5-0.5B-Instruct via llama.cpp | text (default) | enabled, probed through the existing styling status check | local | 2048-token context, Apache-2.0 per model card |
| SmolVLM-256M-Instruct | vision | unconfigured until `NOVA_VISION_URL` | local or remote | needs the opt-in `nova-engine` worker; never claimed working until a real inference is verified |
| SSD-1B | image-generation | unconfigured until `NOVA_IMAGE_URL` | local or remote | GPU required (estimated 8 GB VRAM) |
| VirtualFit try-on | virtual-try-on | enabled (reused pipeline); `simulated: true` when `AI_PROVIDER=mock` | per provider | existing mock / Gradio / custom-python providers |
| Lexical hashing embedder | embedding | enabled | local | keyword overlap, **not** a neural semantic model |
| Plain-text extractor | document-extraction | enabled | local | text and Markdown only |
| Dedicated coding model | code | planned | – | coding questions may fall back to Qwen, labelled degraded |
| Image editing | image-editing | planned | – | GPU worker |
| Speech-to-text, Text-to-speech | speech-to-text, text-to-speech | planned | – | small models may run on CPU |

## Routing (Implemented)

`router.ts`. `classifyTask` is rule-based and inspectable: image mode, attached image (vision or edit), speech cues, try-on cues, "generate/draw an image", document cues, coding cues, otherwise text. No model chooses which model runs.

`routeTask` returns one of: `routed`, `fallback` (only `code` → `text`, with `degraded: true` and an explanation), or `unavailable` (with the reasons and whether the capability is merely planned). A pinned `modelId` disables fallback.

The classifier and decisions are exposed read-only at `POST /api/v1/nova/route` (dry run). **The live chat path in `NovaService` is not yet driven by the router**; it keeps its existing hard-wired behaviour (Qwen text, stylist grounding, configured media adapters). Switching chat to consult the router is the first integration step (see the master roadmap).

## What is reused

Streaming SSE chat, `AbortController` cancellation, `InferenceQueue` job queue and concurrency limits, timeouts (see the proxy timeout report in `nova-platform.md`), MongoDB/in-memory `CollectionFactory`, guest ownership, consented memory, the vision/image adapters and worker protocol, the VirtualFit try-on providers, the resource figures already shown in `/nova/status`.

## Embeddings and retrieval (Implemented, lexical)

`knowledge.ts`: `EmbeddingProvider` interface (`id`, `dimensions`, `semantic`, `embed`), a dependency-free `LexicalHashEmbedder` (word + bigram hashing, L2-normalised, 256 dims), chunking with overlap, cosine search with source attribution (document, title, chunk index, score). Vectors from different embedder ids are never compared; after a provider switch old documents are reported `stale` and must be re-added. A neural embedder (for example a small sentence-transformer on CPU or a remote GPU) is Planned; it plugs in through `useEmbedder`.

## Planned capabilities and their adapters

| Capability | Likely adapter | Hardware |
| --- | --- | --- |
| Image understanding (verify) | existing `CompatibleVision` + `nova-engine` | remote GPU recommended |
| Image generation/editing | existing `CompatibleImages`; editing needs a new endpoint | remote GPU required |
| Speech-to-text | Whisper-class worker (`/v1/audio/transcriptions`) | CPU possible for small models |
| Text-to-speech | worker (`/v1/audio/speech`) | CPU possible for small models |
| Neural embeddings | worker (`/v1/embeddings`) | CPU possible for small models |
| PDF extraction | text-layer parser first, OCR only if justified | CPU |
| Coding model | OpenAI-compatible llama.cpp or remote endpoint | GPU preferred |
