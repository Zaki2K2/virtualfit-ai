# VirtualFit AI - Intelligent Virtual Dressing Room

Upload a photo, pick a garment, preview how it could look on you. A **noncommercial university project**.

- **Web:** Next.js (App Router), React, TypeScript, Tailwind CSS v4, shadcn/ui-style components, TanStack Query, React Hook Form + Zod
- **API:** Express 5, TypeScript, Multer, Zod, Mongoose (MongoDB optional)
- **AI:** provider abstraction with a clearly labelled **mock** provider and a configurable **Hugging Face Gradio** adapter
- **Monorepo:** npm workspaces (`apps/web`, `apps/api`, `packages/shared`)

> **AI status:** the real try-on adapter targets a free Hugging Face Space (`yisol/IDM-VTON`) and is **off in the default configuration**. Availability depends on that service and its GPU quota; the October 15, 2026 audit reached the service but inference was quota-blocked. See [the system audit](docs/system-audit-report.md). Default mock mode runs a _simulation_ with a visible "SIMULATION - NOT AI OUTPUT" banner. Turn real AI on with two lines in `.env` - see [Real AI](#real-ai-try-on) and [docs/ai-integration.md](docs/ai-integration.md).
> Virtual try-on shows how a garment may **look**. It does not predict physical fit or size.

## Quick start

Requirements: Node.js >= 20.9 (developed on 22). MongoDB is **optional**.

```bash
npm install
npm run dev
```

- Web: http://localhost:3000
- API: http://localhost:5000 (health: http://localhost:5000/api/v1/health)

The browser only talks to the Next.js server; it proxies `/api/*` to the API (`API_URL`). No `.env` is needed for mock mode. To customise, copy `.env.example` to `.env` in the repo root.

## Local AI styling assistant (language model)

Latest: [Phase 3 fine-tuning and grounding progress](docs/slm-finetuning-progress.md).

The **AI Stylist** at http://localhost:3000/stylist uses a real CPU-only Qwen2.5-0.5B-Instruct Q4_K_M language model through llama.cpp. It recommends current-guest wardrobe items and stays separate from the vision model. Run `npm run slm:setup` once, then `npm run dev:slm`; if the app is already running, start only `npm run slm:serve` in another terminal. Setup checks RAM/disk and verifies downloads; it needs no NVIDIA GPU or paid API.

Current customization is fashion prompting, structured output and wardrobe grounding. The pretrained model is **not yet fine-tuned** and recommendation quality is limited. The project includes an actual LoRA/optional QLoRA pipeline, authored seed datasets, held-out evaluation and a Colab notebook. See [SLM setup/training](slm-engine/README.md), [implementation report](docs/slm-integration-report.md), and [measured baseline](docs/slm-baseline-evaluation.json). Cloud training and custom checkpoint export have not run.

## Python vision engine (research track)

`ai-engine/` is a separate Python project: VITON-HD dataset tools, a **CatVTON LoRA fine-tuning pipeline**, a baseline-vs-custom evaluation, three Colab notebooks and a FastAPI inference service. The web API reaches it through the `custom-python` provider, and the studio has a model selector (mock / hosted / original pretrained / VirtualFit custom). Models that cannot run are shown as unavailable with the reason; they are never silently replaced by the mock.

**Honest status:** the engine code is tested on CPU with tiny random models and against CatVTON's real attention checkpoint format, but **no real training step has been run and no custom checkpoint exists yet** (no GPU here). Start with `ai-engine/README.md` and `docs/research/`.

## Real AI try-on

```
# .env (repo root)
AI_PROVIDER=gradio
GRADIO_PRESET=idm-vton
# HF_TOKEN=hf_xxx   # optional free token for more GPU quota (server side only)
```

Restart `npm run dev`. The studio asks for consent before photos are sent to Hugging Face. To go back to mock mode, set `AI_PROVIDER=mock`. The free GPU is shared, so quota limits and cold starts apply; failures show a clear error with Retry. The model is licensed for noncommercial use only.

## Troubleshooting

| Symptom in the browser                                                       | Meaning                                                                                                                              | Fix                                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Banner: _"The app could not reach the API server"_ / clothing shows an error | The web app (port 3000) is up but nothing answers on the API (port 5000). Next's proxy reports a dead API as a bare HTTP 500         | Start the stack with `npm run dev` (it now exits loudly if either service dies)                          |
| _"The server hit an unexpected error"_                                       | The API answered with a real HTTP 500                                                                                                | Read the API terminal: the log line has the route and stack (development only)                           |
| _"The database is not reachable right now"_ (503)                            | MongoDB went away while the API runs. `/api/v1/health` reports `status: "degraded"`                                                  | Start MongoDB; the API reconnects by itself                                                              |
| API terminal: _"Port 5000 is already in use by another process"_             | A stale API (or another program) owns the port. On Windows a second process can silently bind the same port, so the API checks first | Stop the old process (`netstat -ano \| findstr :5000`) or set `API_PORT` (and `API_URL` for the web app) |
| `npm run dev` ends right after one service fails                             | `--kill-others`: a half-running stack is worse than none                                                                             | Fix the printed error and run it again                                                                   |

Only one `next dev` can run per checkout (Next 16 locks the directory), so do not start `npm run dev` twice.

## Scripts

| Command                             | What it does                                            |
| ----------------------------------- | ------------------------------------------------------- |
| `npm run dev`                       | Builds `shared`, then runs API and web together         |
| `npm run build`                     | Production build of all workspaces                      |
| `npm start`                         | Runs the built API and web                              |
| `npm test`                          | Unit + API integration tests (Vitest, Supertest)        |
| `npm run typecheck`                 | TypeScript checks for all workspaces                    |
| `npm run lint`                      | ESLint                                                  |
| `npm run format`                    | Prettier                                                |
| `npm run generate:catalog`          | Regenerates the sample garment illustrations            |
| `npm run ai:inspect -- owner/space` | Prints a Hugging Face Space's real API (no images sent) |

## Environment variables

All documented in [.env.example](.env.example).

| Variable                                                                                          | Default                 | Notes                                             |
| ------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------- |
| `API_PORT`                                                                                        | `5000`                  |                                                   |
| `WEB_ORIGIN`                                                                                      | `http://localhost:3000` | CORS origin (only for direct API calls)           |
| `API_URL`                                                                                         | `http://localhost:5000` | Web server -> API proxy target                    |
| `MONGODB_URI`                                                                                     | _unset_                 | Unset = in-memory store (lost on restart)         |
| `UPLOAD_DIR`                                                                                      | `uploads`               | Result/garment files (git-ignored)                |
| `MAX_UPLOAD_MB`                                                                                   | `8`                     | Per image                                         |
| `RESULT_RETENTION_HOURS`                                                                          | `24`                    | Results (except favorites) are deleted after this |
| `AI_PROVIDER`                                                                                     | `mock`                  | `mock` or `gradio`                                |
| `AI_TIMEOUT_MS`                                                                                   | `180000`                | Hard generation timeout                           |
| `GRADIO_SPACE_ID`, `GRADIO_API_NAME`, `GRADIO_PARAMS_TEMPLATE`, `GRADIO_OUTPUT_INDEX`, `HF_TOKEN` | _unset_                 | Server-side only; see AI docs                     |

## Features

**Implemented:** landing page; try-on studio (upload, validation, garment picker with category filter, one-off garment upload, generate with progress, before/after slider, download, save to favorites, error/retry states); wardrobe (10 sample garments, search, filter, upload/delete your own); favorites; history (reuse outfit, delete); profile (optional measurements, categories, consent preference); settings (AI/server status, privacy, erase all data); guest sessions; MongoDB schemas with in-memory fallback.

**Not implemented:** user accounts, size recommendations, live camera try-on. These are marked in the UI under Settings.

## Docs

- [Architecture & database design](docs/architecture.md)
- [API documentation](docs/api-documentation.md)
- [AI integration](docs/ai-integration.md)
- [Roadmap](docs/project-roadmap.md)
- Research: [model selection](docs/research/model-selection.md), [dataset](docs/research/dataset-preparation.md), [training](docs/research/training-guide.md), [evaluation](docs/research/evaluation-methodology.md), [experiment log](docs/research/experiment-log.md); engine: [ai-engine/README.md](ai-engine/README.md)

## Licensing note

Research models such as CatVTON and IDM-VTON are licensed CC BY-NC-SA 4.0 (noncommercial). This project must not be used commercially with them.
