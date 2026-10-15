# VirtualFit AI - Intelligent Virtual Dressing Room

Upload a photo, pick a garment, preview how it could look on you. A **noncommercial university project**.

- **Web:** Next.js (App Router), React, TypeScript, Tailwind CSS v4, shadcn/ui-style components, TanStack Query, React Hook Form + Zod
- **API:** Express 5, TypeScript, Multer, Zod, Mongoose (MongoDB optional)
- **AI:** provider abstraction with a clearly labelled **mock** provider and a configurable **Hugging Face Gradio** adapter
- **Monorepo:** npm workspaces (`apps/web`, `apps/api`, `packages/shared`)

> **AI status:** real try-on works through a free Hugging Face Space (`yisol/IDM-VTON`, verified) but is **off by default**. Default mock mode runs a _simulation_ with a visible "SIMULATION - NOT AI OUTPUT" banner. Turn real AI on with two lines in `.env` - see [Real AI](#real-ai-try-on) and [docs/ai-integration.md](docs/ai-integration.md).
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

## Real AI try-on

```
# .env (repo root)
AI_PROVIDER=gradio
GRADIO_PRESET=idm-vton
# HF_TOKEN=hf_xxx   # optional free token for more GPU quota (server side only)
```

Restart `npm run dev`. The studio asks for consent before photos are sent to Hugging Face. To go back to mock mode, set `AI_PROVIDER=mock`. The free GPU is shared, so quota limits and cold starts apply; failures show a clear error with Retry. The model is licensed for noncommercial use only.

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

## Licensing note

Research models such as CatVTON and IDM-VTON are licensed CC BY-NC-SA 4.0 (noncommercial). This project must not be used commercially with them.
