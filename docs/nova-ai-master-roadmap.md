# Nova AI master roadmap

Nova (Powered by NovaCTO) is meant to grow into a self-hosted, extensible assistant. This page is the honest ledger: what exists, what is only a foundation, and what is planned. Detail lives in [model architecture](nova-model-architecture.md), [agent security](nova-agent-security.md), [deployment](nova-deployment-strategy.md) and [the v0.4 platform report](nova-platform.md).

## Capability ledger

| Capability | Status | Evidence / gap |
| --- | --- | --- |
| General conversation (small local Qwen2.5-0.5B) | **Working, limited** | streaming, persistence, cancel, regenerate; a 0.5B model is not frontier-grade |
| Advanced reasoning | **Not delivered** | needs a larger model (remote GPU or bigger local quantised model) |
| Image understanding | **Adapter only** | worker and adapter tested with fixtures; no real inference run yet |
| Image generation | **Adapter only** | same; GPU required |
| Image editing | Planned | registry entry only |
| Virtual try-on | **Working (existing VirtualFit)** | mock and hosted Gradio providers; own engine unrun on GPU |
| Document / PDF understanding | **Foundation** | text/Markdown ingest, chunking, lexical retrieval; PDF and OCR planned |
| Persistent user-approved memory | **Working** | consent, edit, delete, ownership; plus consented document store |
| Semantic retrieval | **Lexical only** | `LexicalHashEmbedder` matches words, not meaning; neural embedder planned |
| Voice (STT/TTS) | Planned | registry entries only |
| Coding assistance | Partial | routed to Qwen with a degraded label; dedicated model planned |
| Web research | Planned | needs search provider tool behind the security gateway |
| Secure tool execution | **Gateway only** | permission/approval layer tested; no real tools, no sandbox |
| Multi-step agent workflows | Planned | no agent loop by design until sandbox and approvals are proven |
| Controlled self-improvement | **Pipeline only** | consent + operator review + versioned export exist; no custom model trained |

## Delivered in this foundation pass

Model registry with health and resource gating; deterministic task router with explicit fallback rules; tool permission gateway with approval binding, timeouts, cancellation and audit; consented knowledge store (ingest, chunk, embed via a pluggable interface, search with attribution, owner isolation, deletion, erase-all); HTTP endpoints under `/api/v1/nova` (`/capabilities`, `/models`, `/models/:id/health`, `/route`, `/resources`, `/tools...`, `/knowledge...`); 22 tests.

Not wired yet: the chat endpoint does not consult the router or retrieve from knowledge; there is no UI for models, knowledge or tools.

## Milestones

1. **M1 - Real media on a remote GPU** (already on `project-roadmap.md`): deploy `nova-engine`, verify genuine captions and generated images, benchmark. Local Qwen stays unchanged.
2. **M2 - Wire the orchestrator into chat**: route requests through `routeTask`; show routing and degraded labels in the UI; add a models/status panel. Keep the existing grounding path for wardrobe requests.
3. **M3 - Grounded retrieval in chat**: retrieve owner-scoped knowledge chunks, present them as quoted untrusted context with citations, UI for upload/consent/delete. Add a real neural embedder (small CPU model or remote) behind `EmbeddingProvider`.
4. **M4 - Documents**: PDF text-layer extraction, size/time limits, then OCR only if needed.
5. **M5 - Voice**: STT/TTS workers behind compatible endpoints; push-to-talk UI.
6. **M6 - Bigger language model**: a larger quantised model locally if hardware allows, or a remote GPU endpoint, registered alongside Qwen; evaluation against the existing eval set before it becomes default.
7. **M7 - Tools and agents**: read-only filesystem tool inside a jailed root, then a real container sandbox for code execution, then search; each with audit persistence and UI confirmation. Only then a bounded, human-supervised agent loop.
8. **M8 - Self-improvement**: first real LoRA run on a cloud GPU with consented, reviewed data; paired base/candidate evaluation; activation only through existing gates with rollback.

Each milestone ends with tests and a browser/real-model verification; a capability moves to "Working" only with that evidence.

## Principal risks

- A 0.5B local model sets a hard ceiling on conversation and reasoning quality.
- No GPU: media and larger models depend on a remote host (cost, privacy, availability).
- Lexical retrieval will miss paraphrases until a neural embedder is added.
- Tool and agent features are security-sensitive; shipping them before a real sandbox would be unsafe.
- In-process queue, in-memory audit and approvals suit one instance, not a replicated deployment.
- Anonymous guest identity limits long-term ownership and sharing; real authentication is a prerequisite for multi-device memory.
