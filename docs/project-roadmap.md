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

## Next

1. **Quality tuning:** garment descriptions, denoise steps/seed, preprocessing garment illustrations (real garment photos give better results than the sample illustrations); re-check CatVTON when its Space is repaired.
2. **Resilience:** fallback/second Space, queue/wait-time feedback for ZeroGPU, token-based quota guidance.
3. **Authentication** (replace guest cookie), ownership via user id, email on `User`.
4. **Background jobs** that survive restarts (queue) if needed; currently in-process.
5. Python/FastAPI inference provider (own GPU host).
6. Size recommendation research (needs real body measurements and garment size charts - not height/weight alone).
7. Live camera try-on.
8. End-to-end browser tests (Playwright) and accessibility audit.
