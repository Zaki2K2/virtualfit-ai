# Roadmap

## Done (v0.1)

- Monorepo, shared types/schemas, lint/format/test tooling
- Landing page, try-on studio, wardrobe, favorites, history, profile, settings
- API: health, clothing, try-on (async + polling), history, favorites, profile, erase-my-data
- Mock provider + configurable Gradio adapter; upload validation; retention purge; guest sessions
- MongoDB schemas with in-memory fallback

## Done (v0.2 - real AI)

- Real try-on verified end to end with `yisol/IDM-VTON` (free Hugging Face Space) and MongoDB persistence
- Verified `idm-vton` preset (`GRADIO_PRESET`), model/duration metadata, "AI-generated" labelling only on real completed results, better error classification
- MongoDB verified against a local instance

## Done (v0.3 - own AI engine, code complete / unrun on GPU)

- `ai-engine/`: VITON-HD dataset pipeline, CatVTON LoRA training (resumable), evaluation, FastAPI service, 3 Colab notebooks, 69 tests
- Verified without a GPU: released attention checkpoint loads into the right layers, sampler = reference (<=1 px), tiny-model training step/resume/reload, Express <-> FastAPI over real sockets
- Express `custom-python` provider, model registry, studio model selector, no silent fallbacks

## Next (research, needs a cloud GPU)

1. Run notebooks 01-03: measure real memory, **complete the first real training step**, produce and evaluate a genuine adapter; write `docs/research/experiment-log.md`.
2. Obtain VITON-HD and verify folder names / masks against `dataset-preparation.md`.
3. Validate CatVTON's automatic masker (DensePose + SCHP) for arbitrary user photos, or require user-supplied masks.
4. Deploy the engine on a GPU host you control (not a free notebook) before using it from the web app.

## Next (product)

1. **Quality tuning:** garment descriptions, denoise steps/seed, preprocessing garment illustrations (real garment photos give better results than the sample illustrations); re-check CatVTON when its Space is repaired.
2. **Resilience:** fallback/second Space, queue/wait-time feedback for ZeroGPU, token-based quota guidance.
3. **Authentication** (replace guest cookie), ownership via user id, email on `User`.
4. **Background jobs** that survive restarts (queue) if needed; currently in-process.
5. Python/FastAPI inference provider (own GPU host).
6. Size recommendation research (needs real body measurements and garment size charts - not height/weight alone).
7. Live camera try-on.
8. End-to-end browser tests (Playwright) and accessibility audit.
