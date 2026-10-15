# AI integration

## Current status

**Real AI try-on is verified and available** through a free Hugging Face Space. It is **off by default** (`AI_PROVIDER=mock`) so the app runs with no setup and no external calls. No GPU is needed locally; models are never run on your machine.

| Mode           | How                                             | Output                                                                                             |
| -------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Mock (default) | `AI_PROVIDER=mock`                              | Your own photo with a permanent "SIMULATION - NOT AI OUTPUT" banner. API: `simulated: true`        |
| Real           | `AI_PROVIDER=gradio` + `GRADIO_PRESET=idm-vton` | Genuine diffusion try-on from `yisol/IDM-VTON`. API: `simulated: false`, `model: "yisol/IDM-VTON"` |

## Switching modes

Put these in `.env` in the repo root (copy `.env.example`), then restart `npm run dev`.

```
# Real AI
AI_PROVIDER=gradio
GRADIO_PRESET=idm-vton
# optional, server side only: raises free GPU quota
# HF_TOKEN=hf_xxx

# Back to mock: set AI_PROVIDER=mock (or delete the lines)
```

Settings page -> "AI & server status" shows the active mode. With a real provider the studio asks for consent before sending photos, and the API enforces it (`CONSENT_REQUIRED`).

### Optional Hugging Face token

Anonymous use worked in testing, but ZeroGPU quota for anonymous users is small and shared. For more quota: create a free account at huggingface.co -> Settings -> Access Tokens -> create a **read** token -> set `HF_TOKEN` in `.env`. The token is read only by the API, never sent to the browser, and never logged. Do not commit `.env` (it is git-ignored).

## Verified provider: `yisol/IDM-VTON`

- Host: Hugging Face Spaces, `https://yisol-idm-vton.hf.space`, Gradio 4.24, ZeroGPU (free shared GPU)
- License: CC BY-NC-SA 4.0 - **noncommercial only** (fits this university project)
- Endpoint: `/tryon` (read from the Space with `view_api`; not guessed)
- Inputs: `dict` (image editor object `{background, layers, composite}` - we send the person photo as `background`), `garm_img` (garment image), `garment_des` (text), `is_checked` (auto-mask, we send `true`), `is_checked_crop` (`false`), `denoise_steps` (`30`), `seed` (`42`)
- Output: index 0 = result image (file URL on `*.hf.space`); index 1 = masked image (ignored)
- Auth: none required for anonymous calls; optional token for quota

The preset lives in `apps/api/src/integrations/ai/providers/gradio.presets.ts`. Any `GRADIO_*` variable you set overrides the preset.

### Verification performed (2026-10-15)

1. Used the Space's own bundled example photos (no personal photos sent): person `00034_00.jpg` + a VITON garment photo. A pink sleeveless shirt was replaced with the blue velvet wrap top; face, pose and background preserved. 18 s, anonymous.
2. Full app path: web proxy -> Express -> Space -> MongoDB, person example + catalog illustration "Oxford Button Shirt". Completed in ~20 s; stored as `provider: gradio, simulated: false, model: yisol/IDM-VTON, durationMs: 19877`; image served with HTTP 200 `image/png`.
3. No consent -> `CONSENT_REQUIRED`. Non-existent Space -> `AI_UNAVAILABLE`.
4. Mock mode regression: all tests pass; mock output unchanged.

### Alternatives investigated

| Space                                  | State                                                                                                         | Notes                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `zhengchong/CatVTON` (preferred model) | **RUNTIME_ERROR** when inspected - cannot load gated `black-forest-labs/FLUX.1-Fill-dev`; hosted API unusable | CC BY-NC-SA 4.0. Re-check with `npm run ai:inspect -- zhengchong/CatVTON`; if it returns, add a preset |
| `Nymbo/Virtual-Try-On`                 | Running at inspection                                                                                         | Not evaluated further                                                                                  |
| `Kwai-Kolors/Kolors-Virtual-Try-On`    | Running (apache-2.0)                                                                                          | Not evaluated further                                                                                  |

Community Spaces change or disappear. Nothing here is guaranteed infrastructure; the provider fails gracefully and you can point it elsewhere (below).

## Using a different Space

1. `npm run ai:inspect -- owner/space-name` prints the real endpoint names and parameters (sends no images).
2. Set `GRADIO_SPACE_ID`, `GRADIO_API_NAME`, `GRADIO_PARAMS_TEMPLATE` (and `GRADIO_OUTPUT_INDEX` if needed). Template placeholders: `{{person}}`, `{{garment}}`, `{{clothType}}` (`upper|lower|overall`), `{{category}}`. Object = named params, array = positional.
3. Smoke test (from `apps/api`): `npx tsx --env-file=../../.env scripts/live-smoke.ts person.jpg garment.png out.png`

If space, endpoint or template are missing the provider reports `configured: false` and generation fails with `AI_UNAVAILABLE`; it never falls back to the mock.

## Behaviour and limits

- Provider interface: `VirtualTryOnProvider` (`generate`, `simulated`, `model`, `externalProcessing`, `isConfigured`). `GenerationService` adds the hard timeout (`AI_TIMEOUT_MS`, default 180 s), validates the returned bytes as a real image, and maps errors to codes.
- Errors: quota/rate -> `AI_QUOTA_EXHAUSTED`; asleep/removed/inaccessible Space -> `AI_UNAVAILABLE`; timeout -> `AI_TIMEOUT`; other -> `AI_FAILED`. A failed job never has a result URL; the UI shows the error with Retry.
- Metadata stored per try-on: provider, model, simulated, status, durationMs, error code/message. The result is labelled "AI-generated" in the UI only when the job completed with a real provider.
- Free tier: ZeroGPU queues and quotas apply; generation can wait or fail when the quota is spent. A cold Space can take minutes to wake.
- Quality caveats: the model works best on a single, front-facing person with plain background; catalog illustrations are simplified garments so details are approximated. Results can contain artifacts and **do not predict physical fit**.
- Privacy: with a real provider the photo and garment go to Hugging Face and the Space operator. Consent is required. Our server does not keep the original photo.

## Models offered in the studio (v0.3)

| Option       | Provider      | Runs                                        | Needs                                                   |
| ------------ | ------------- | ------------------------------------------- | ------------------------------------------------------- |
| `mock`       | mock          | locally, simulation (watermarked)           | nothing                                                 |
| `hosted`     | gradio        | Hugging Face Space (`yisol/IDM-VTON`)       | `GRADIO_PRESET=idm-vton`                                |
| `pretrained` | custom-python | our Python engine, original CatVTON weights | `ENGINE_URL` + engine on a CUDA GPU host                |
| `custom`     | custom-python | our engine, CatVTON + VirtualFit LoRA       | as above + a **genuine** adapter (`ENGINE_ADAPTER_DIR`) |

`GET /api/v1/health` lists every option with `available` and a `reason`; `POST /api/v1/try-on` accepts an optional `model` field (default = the server default: `AI_PROVIDER`). A request for an unavailable model fails with `AI_UNAVAILABLE` **before** any job is created. There is no fallback between models, and the stored try-on records the real provider, model/version string (for the engine: `catvton-vitonhd` or `catvton-vitonhd+virtualfit-lora(N steps)`) and `simulated`.

### Python engine integration

Express -> `POST {ENGINE_URL}/v1/inference/try-on` (multipart, header `X-Engine-Key`), answer = PNG + `X-Model-Version`. Engine error codes map to API codes (`GPU_UNAVAILABLE`/`MODEL_UNAVAILABLE`/`MASKER_UNAVAILABLE` -> `AI_UNAVAILABLE`, `TIMEOUT` -> `AI_TIMEOUT`, `BUSY` -> `RATE_LIMITED`, others -> `AI_FAILED`). Photos are treated as leaving the machine (consent required) unless `ENGINE_URL` is loopback.

Verified here with a real socket: the actual FastAPI engine on a machine without a GPU reports both models unavailable ("no CUDA GPU available"); Express shows them as unavailable and refuses jobs with `AI_UNAVAILABLE`. **Not verified:** a successful inference through the engine (needs a GPU host with the weights, and a CatVTON checkout + DensePose/SCHP checkpoints for automatic masks; `docs/research/experiment-log.md`).

Limitations: the released `vitonhd` weights handle upper-body garments only; the Express adapter sends no mask, so the engine must have its automatic masker configured (`ENGINE_CATVTON_REPO`); a free Colab session cannot be reached from your PC without a tunnel (not automated here).

### Security and privacy

Engine access needs the shared `X-Engine-Key` (required when the engine binds a non-loopback address); the key is read only server side. The engine decodes uploads itself (magic bytes, size/dimension limits), keeps them in memory only, never fetches URLs from requests, and never stores personal images. The web API keeps its own guest-session ownership checks, upload validation and retention purge. Checkpoints (`*.safetensors`, `runs/`, data) are git-ignored; notebooks contain no secrets (tested).
