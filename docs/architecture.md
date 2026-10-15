# Architecture

```
Browser ──► Next.js (3000) ──/api/* proxy──► Express API (5000) ──► AI provider (mock | Gradio Space)
                                                  │
                                       MongoDB (optional) / memory
                                       uploads/ (results, user garments)
```

## Why a proxy?

The web app calls relative `/api/v1/...` URLs. Next.js rewrites them to the API. The guest cookie is therefore first-party, and no CORS setup is needed.

## API layout (`apps/api/src`)

- `modules/<feature>/` - `routes` -> `controller` (thin) -> `service` (logic); `validation` (Zod), `model` (Mongoose schema), `types`.
- `integrations/ai/` - `interfaces/VirtualTryOnProvider`, `providers/{mock,gradio}`, `services/{provider-factory,generation}`.
- `db/collection.ts` - persistence port with in-memory and MongoDB implementations; modules never import Mongoose directly.
- `container.ts` - composition root (swap storage/provider in tests).
- `middleware/` - guest session, upload (Multer memory storage), centralized error handler.

## Try-on flow

1. `POST /try-on` (multipart) validates fields (Zod), consent (external providers), and image bytes (magic bytes + decode with sharp, EXIF stripped, size/dimension limits).
2. A `processing` record is stored; HTTP 202 is returned immediately.
3. Generation runs in-process with a hard timeout. Result is validated as a real image and saved under a generated name.
4. The client polls `GET /try-on/:id`. Failures are stored with a stable error code.

Person and garment photos are held in memory only for the job; they are never written to disk.

## Security & privacy decisions

- Identity: server-issued httpOnly cookie (`vf_guest`); client-supplied user IDs are rejected (`.strict()` schemas). Every try-on, favorite, garment and profile is owner-checked (404 on mismatch). This is the seam for real auth.
- Files: ids are generated; the file store validates ids and bucket paths (no traversal); API URLs never expose server paths.
- Retention: results older than `RESULT_RETENTION_HOURS` are purged unless favorited. `DELETE /profile` erases everything for a guest.
- Rate limits: general + stricter on `POST /try-on`; one concurrent generation per guest.
- Logs never contain image data, tokens or measurements.

## Database design

IDs are string UUIDs (`_id`). In-memory mode mirrors the same shapes.

| Collection | Fields                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `User`     | `_id` (guest id), displayName, heightCm, weightKg, chestCm, waistCm, hipsCm, preferredCategories[], rememberAiConsent, timestamps    |
| `Clothing` | `_id`, name, category, description, imageExt, uploadedBy (guest id), createdAt. Bundled catalog items live in code, not the database |
| `TryOn`    | `_id`, ownerId, clothingId?, clothingName, category, provider, simulated, status, resultExt, errorCode, errorMessage, timestamps     |
| `Favorite` | `_id`, ownerId, tryOnId, createdAt                                                                                                   |

`User` has no email yet; account fields are added with authentication. TryOn stores a reference to the result file, not the input photos.

## Frontend layout (`apps/web/src`)

`app/` routes -> `features/*` (feature components/hooks) -> `components/{ui,layout,shared,clothing,try-on}`; `services/api.ts` (typed fetchers), `hooks/use-api.ts` (TanStack Query), `lib/` helpers. Types and Zod schemas come from `@virtualfit/shared`.
