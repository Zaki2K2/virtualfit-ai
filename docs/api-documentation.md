# API documentation

Base URL: `http://localhost:5000/api/v1` (or `/api/v1` through the web app). Identity is a server-set `vf_guest` cookie; clients send cookies automatically.

Errors: `{ "error": { "code": "...", "message": "...", "details"?: ... } }`. Codes: `VALIDATION_ERROR`, `UNSUPPORTED_IMAGE`, `FILE_TOO_LARGE`, `NOT_FOUND`, `CONSENT_REQUIRED`, `AI_UNAVAILABLE`, `AI_QUOTA_EXHAUSTED`, `AI_TIMEOUT`, `AI_FAILED`, `RATE_LIMITED`, `INTERNAL_ERROR`.

| Method | Path                  | Description                                                                                                                                                        |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/health`             | Status, database mode, AI provider (`simulated`, `externalProcessing`, `configured`), limits                                                                       |
| GET    | `/clothing`           | Catalog + your garments. Query: `category` (`tops\|outerwear\|bottoms\|dresses`), `q`                                                                              |
| GET    | `/clothing/:id`       | One item                                                                                                                                                           |
| GET    | `/clothing/:id/image` | Garment image                                                                                                                                                      |
| POST   | `/clothing`           | Multipart: `image` (JPEG/PNG), `name`, `category`, `description?` -> 201                                                                                           |
| DELETE | `/clothing/:id`       | Delete your own garment (204)                                                                                                                                      |
| POST   | `/try-on`             | Multipart: `person` (file), `category`, and either `clothingId` **or** `garment` (file); `consent=true` for external AI -> **202** `{tryOn}` (status `processing`) |
| GET    | `/try-on/:id`         | Poll status: `processing`, `completed` (has `resultUrl`) or `failed` (has `error`)                                                                                 |
| GET    | `/try-on/:id/image`   | Result image (`?download=1` for attachment)                                                                                                                        |
| GET    | `/history`            | Your try-ons, newest first                                                                                                                                         |
| DELETE | `/history/:id`        | Deletes the try-on and its image                                                                                                                                   |
| GET    | `/favorites`          | Saved results                                                                                                                                                      |
| POST   | `/favorites`          | JSON `{ tryOnId }` (completed, yours). Idempotent                                                                                                                  |
| DELETE | `/favorites/:id`      | Remove favorite                                                                                                                                                    |
| GET    | `/profile`            | Guest profile (defaults if none)                                                                                                                                   |
| PATCH  | `/profile`            | Partial update; strict schema, measurement ranges validated                                                                                                        |
| DELETE | `/profile`            | Erase all of this guest's data                                                                                                                                     |

Limits: images JPEG/PNG only, `MAX_UPLOAD_MB` each, min 128 px; 1 concurrent generation per guest; 30 try-ons/hour/IP.
