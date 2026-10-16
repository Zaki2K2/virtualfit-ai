# Local SLM hosting

Verified on 16 October 2026 in `C:\virtualfit-ai` with Windows, Node 22.19.0, Python 3.13 and CPU-only llama.cpp b11643. The original Qwen remains the default. No custom fine-tuned checkpoint was created or activated.

## 1. Existing issues found

The existing architecture already used local Qwen for outfit recommendations. A real request through Express returned HTTP 200 with `source: model` and valid catalog IDs in 2.896 seconds before changes. There was no external language-provider dependency to replace. Gradio was and remains a separate vision provider.

The gaps were model-list-only readiness, no single all-services command, category/no-match/clarification replies bypassing Qwen, no follow-up context, weak explanations despite valid garment IDs, and no repeatable CPU comparison. A browser test also found that Next.js blocked dev assets at the numeric loopback origin. Earlier shutdown investigation found uncaught Ctrl+C and duplicate launch risks; those wrapper fixes were retained.

The root health endpoint's existing `ai` block describes **vision**, so a Gradio label there does not mean the stylist is using Gradio. Language readiness is `/api/v1/styling/status`.

## 2. Changes made

- Added `npm run dev:ai`, reusing the existing `npm run dev` workspace command. `npm run dev` itself is unchanged. Qwen starts first; health, exact alias and a genuine generated completion must pass before the API/web start. The launcher reports fully ready only after Express verifies generation and `/stylist` responds.
- An existing healthy Qwen on 8081 is reused after actual inference verification. It is never stopped by a launcher that did not start it. Occupied app ports fail clearly; duplicate SLM launches are prevented by the existing OS-held per-port lock. Failures stop owned services with an explicit reason, without restart loops.
- Kept the Windows shared-console Ctrl+C path, bounded cleanup, process reaping and decimal/hex child exit diagnostics. Launching npm through its native Node CLI with closed stdin prevents an interactive batch prompt from hanging shutdown. Windows npm may still print batch-termination text; no response is needed.
- `/stylist` remains base-Qwen-first and uses the Next.js-to-Express proxy. It shows the local model name, real generation readiness, progress, selected clothing cards, source labels and studio links. Unavailable custom models stay disabled. A new conversation button clears tab-local state.
- Every validated language request now invokes Qwen: outfits, category questions, occasion/color requests, general color advice, unavailable inventory and clarification. Recent user requests (maximum two, 600 characters each) resolve follow-up constraints in Express against a fresh permitted wardrobe. Raw prior requests are not forwarded to Qwen; resolved current preferences avoid contradictory old instructions. Independent requests start new constraints.
- Preserved retrieval and ranking: current guest's uploads plus public catalog, attribute/exclusion filters, preference/user-item ranking, at most three candidates per slot and twelve overall, with a complete one-item-per-slot plan. No image URLs, image bytes or body profile fields enter the model context.
- Tightened native JSON constraints to verified selection/category counts. Express independently checks schema, IDs, uniqueness, inventory scope, complete selection and categories. Known garment/color mentions in outfit explanations must also match selected inventory. Repetition, overlong prose, reasoning tags, unsupported physical claims and dishonest no-match statements are rejected. Invalid replies return `source: deterministic-fallback`, with diagnostics such as `ungrounded-explanation`; they are never labeled as Qwen-generated advice. Runtime outages/timeouts remain explicit errors.
- Status now performs a real small generation probe after matching `/v1/models`. Successful inference is cached for up to 30 seconds, with `inferenceVerified` and `checkedAt`; concurrent status probes share one in-flight operation. Recent successful recommendations also establish readiness. This verifies execution, not fashion quality.
- Language input rejects unknown fields, photo payloads and common numeric body-measurement patterns. Inventory metadata removes links and numeric measurements. Python language probes disable external proxies and redirects; the Express provider also rejects remote endpoints and redirects.
- Added the numeric loopback host to Next.js `allowedDevOrigins`, without broad wildcard origins.

No vision-provider or try-on studio source was changed. The studio's external-photo-processing consent disclosure remains in place. No real photograph was submitted during verification.

The official native browser chat is also enabled with `--ui`; see [authentication and browser verification](slm-web-ui.md). It remains separate from the wardrobe-grounded Stylist.

## 3. Local files and configuration

| Item                  | Value                                                                       |
| --------------------- | --------------------------------------------------------------------------- |
| GGUF                  | `C:\virtualfit-ai\slm-engine\models\qwen2.5-0.5b-instruct-q4_k_m.gguf`      |
| Executable            | `C:\virtualfit-ai\slm-engine\runtime\b11643\llama-server.exe`               |
| Config                | `slm-engine/configs/local.json`                                             |
| Model alias           | `virtualfit-style-base`                                                     |
| Language URL          | `http://127.0.0.1:8081`                                                     |
| Custom language URL   | `http://127.0.0.1:8082`                                                     |
| CPU settings          | 4 threads, context 2048, parallel 1, batch 128, microbatch 64, `-ngl 0`     |
| Provider generation   | 260-token maximum, temperature 0.2, seed 42, schema constrained             |
| Inference deadline    | 60,000 ms, unchanged                                                        |
| Native authentication | Private `slm-engine/runtime/api-key.txt`; Express reads it server-side. Direct native UI requires the local user to enter it manually. |
| Model SHA-256         | `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db`          |

The GGUF, runtime, tokens, checkpoints and local registration are ignored by Git. Model checksum verification remains enabled. Neither weights nor runtime binaries were replaced or reinstalled. `.env` and vision settings were preserved; `.env.example` documents the new command. `dev:ai` explicitly supplies the loopback base URL/alias to the existing API workspace.

## 4. Exact startup and shutdown

From PowerShell:

```powershell
cd C:\virtualfit-ai
npm run dev:ai
```

Open **http://localhost:3000/stylist**. Express is on 5000 and Qwen is bound only to **127.0.0.1:8081**. Wait for the `dev_ai_ready` event and the UI's verified-inference status. Keep the terminal open. Press Ctrl+C to stop services owned by this launcher; a reused standalone SLM remains running.

Stop an existing `npm run dev` before starting `dev:ai`, because app ports cannot be reused safely. If you prefer separate terminals, the original `npm run dev` plus `npm run slm:serve` still works. Do not start multiple SLM commands alongside `dev:ai`. Setup is needed only when the already installed model/runtime is missing, not on every launch.

This is a local development supervisor, not an installed Windows service or unattended production daemon. It does not survive terminal closure by design.

## 5. Verified results

| Verification                 | Actual result                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| JavaScript suites            | 135 passed: shared 4, API 94, web 37                                                                                                                                                                                     |
| SLM Python suite             | 29 passed                                                                                                                                                                                                                |
| Separate vision Python suite | 69 passed, 2 skipped because a CatVTON reference checkout was not configured; one existing Starlette/httpx deprecation warning                                                                                           |
| Lint                         | `npm run lint` passed                                                                                                                                                                                                    |
| Types                        | `npm run typecheck` passed                                                                                                                                                                                               |
| Production builds            | `npm run build` passed for shared, API and Next.js, including `/stylist`                                                                                                                                                 |
| Cold `dev:ai`                | One Qwen process; actual generation passed before full readiness; MongoDB connected; all three ports served                                                                                                              |
| Normal shutdown              | Isolated Windows console test: native Qwen exit 0, launcher exit 0, no Python traceback, no forced cleanup; owned app ports released                                                                                     |
| Existing-Qwen reuse          | Generation verified, no second model started; Ctrl+C closed owned API/web and preserved the standalone SLM                                                                                                               |
| Unexpected child failure     | Deliberate termination of only the test child with native code 23; code 23 logged, launcher exited 1, owned app stopped, no restart                                                                                      |
| Duplicate launch             | Existing app ports rejected without killing their owners; native wrapper locks/listener checks also tested                                                                                                               |
| Browser                      | Headless Chrome through Playwright: default base selected, custom disabled, real model replies plus honest fallback, follow-up and studio link verified; browser never called 8081/8082                                  |
| Unavailable UI               | Browser status response simulation disabled generation and displayed the local startup guidance; genuine provider outages/deadlines also covered by API tests                                                            |
| Live MongoDB isolation       | Synthetic purple kurta selected for its owner; another guest had no candidate/selected ID; synthetic fixture deleted afterward                                                                                           |
| Live eight-case API suite    | 8/8 HTTP success and exact expected IDs; Qwen attempted on 8/8; 7 accepted model replies, 1 disclosed fallbacks; median 1.369 s, max 2.086 s, zero timeouts. Full report: `slm-engine/runs/local-hosting-api-final.json` |
| General color advice         | Live request verified `intent: advice`, local model attempted, no invented item IDs                                                                                                                                      |
| Privacy/admin boundary       | Measurement input rejected with HTTP 400; raw model admin route through the app returned HTTP 404                                                                                                                        |

The first raw Chrome-debugging launch was rejected by automatic approval review; browser verification succeeded with an isolated Playwright profile and no debugging port. The optional test runner was installed only under ignored `slm-engine/runs/browser-test`, not into application dependencies. No personal browser profile was accessed.

Local generated evidence is retained under `slm-engine/runs/`: `dev-ai-cold.json`, `dev-ai-reuse.json`, `dev-ai-failure.json` and corresponding logs; `stylist-browser-check.json`; browser screenshots; `local-hosting-mongo-isolation.json`; and final API/protocol reports. Earlier cloud-training preparation and shutdown-investigation work was preserved.

## 6. CPU measurements and the earlier timeouts

Hardware: Intel Core i7-13620H, 10 cores / 16 logical processors. Each raw experiment used eight identical public synthetic requests, real schema-constrained generation, an exclusive model process and cache-disabled benchmark requests. First-token latency is measured from HTTP request start to the first nonempty streamed content delta. Native timings provide prompt/generated throughput. Process working set and private bytes were sampled every 100 ms on Windows.

| Raw profile                        | Threads / context / token cap | Startup to health (s) | Median first token (s) | Median total (s) | Prompt tok/s | Generated tok/s | Peak working set (MiB) | Timeouts |
| ---------------------------------- | ----------------------------- | --------------------: | ---------------------: | ---------------: | -----------: | --------------: | ---------------------: | -------: |
| Existing prompt                    | 4 / 2048 / 260                |                 1.461 |                  1.194 |            2.491 |       261.46 |           53.14 |                 544.96 |      0/8 |
| Shorter prompt                     | 4 / 2048 / 260                |                 1.231 |                  1.124 |            2.277 |       263.36 |           55.14 |                 544.85 |      0/8 |
| Two threads, shorter prompt        | 2 / 2048 / 260                |                 1.435 |                  1.895 |            3.695 |       161.84 |           40.88 |                 526.66 |      0/8 |
| Smaller context, shorter prompt    | 4 / 1024 / 260                |                 1.258 |                  1.284 |            2.568 |       225.34 |           52.32 |                 538.23 |      0/8 |
| Smaller output cap, shorter prompt | 4 / 2048 / 180                |                 1.337 |                  1.316 |            2.437 |       230.48 |           53.43 |                 550.41 |      0/8 |
| Alternative grounded prompt        | 4 / 2048 / 260                |                 1.255 |                  1.209 |            1.990 |       296.88 |           55.64 |                 536.60 |      0/8 |
| Few-shot prompt                    | 4 / 2048 / 260                |                 1.158 |                  1.893 |            2.839 |       231.76 |           52.41 |                 520.69 |      0/8 |

**No faster prompt/configuration was promoted.** All 56 raw requests completed with valid IDs, but category accuracy ranged from 3/8 to 6/8 and manual inspection found copied requests, contradictions and invented availability in some prose. Faster completion is not proof of good advice. The final service's tighter schema and prose checks address detected failures separately and disclose fallback. The original serving system prompt, four threads, context 2048, precision and 260-token budget remain unchanged.

This is one pass over a tiny synthetic suite, not a statistically robust quality or load test. Startup measurements benefit from the OS file cache and do not represent a cold machine boot. Background applications were not controlled. The first two few-shot requests overlapped a short unit-test run, so that profile's latency is not a controlled comparison. Peak native working set was approximately 521-550 MiB and sampled private memory approximately 185-218 MiB. Raw source-backed records are in [local-slm-benchmark.json](local-slm-benchmark.json).

The archived 60-second timeouts (`docs/slm-v2-original-eight.json`) occurred at 60.310 and 60.092 seconds; other model paths then took 18-59 seconds. Native timing/CPU/paging/queue data was not recorded, so the historical cause cannot be proven. They were not reproduced in these 56 raw requests or the final integrated suite. This does **not** prove elimination under load.

Safe operating choices are one warmed model instance, readiness before user traffic, avoiding competing heavy workloads, retained token/context/precision settings, and explicit timeout failure. Increasing the deadline would not make inference faster. Future load tests should record queue time, prompt/decode timing and paging, and verify recovery after a timed-out native request; cancellation of fetch does not itself prove immediate native cancellation.

To repeat exclusive experiments, intentionally stop the app/model first:

```powershell
npx tsx apps/api/scripts/slm-cpu-fixtures.ts
python slm-engine/tools/benchmark_cpu.py
```

This creates ignored reports and per-profile logs. It refuses to benchmark over an occupied model port. Optional `runtime.py serve --threads N --context N` overrides are for measured CPU experiments; defaults are unchanged. Raw fixture/protocol timing is distinct from the final Express acceptance report.

## 7. Local inference and privacy confirmation

Language request flow is **browser -> Next.js proxy -> Express validation/retrieval -> local Qwen/llama.cpp -> Express validation -> browser**. The only language-provider URLs permitted by configuration are HTTP loopback origins, and redirects are disallowed. Python readiness/benchmark connections also bypass HTTP proxies. No Hugging Face, Gradio, OpenAI, Gemini or hosted language fallback is called for styling.

Model downloads during an explicit missing-model setup are separate from inference. Vision remains independent and may send photographs externally only through its existing consent flow. No language request adds photo uploads or sends stored body measurements. Guest isolation is enforced before candidates enter the prompt and after returned IDs are parsed. Conversation state stays in the tab; there is no new server conversation collection. The local inference token is not returned by status, embedded in frontend code or checked into Git. Express exposes no raw model administration endpoints.

## 8. Remaining limitations

The 0.5B model is a small pretrained assistant, not a verified fashion specialist. Exact IDs do not guarantee useful or truthful prose. Conservative parsing and explanation checks cover known English garment/color terms, not every possible claim. Fallback is part of the disclosed safety boundary, not evidence of fine-tuning. Human review and a broader held-out evaluation are still required before claiming high fashion quality.

The current service returns one grounded outfit per request and supports a bounded recent-request context. It is not unrestricted long-term chat memory or an exhaustive fashion ontology. Context remains 2048 tokens. Difficult/long requests may fail or fall back rather than produce a usable answer. Runtime outages and timeouts deliberately remain visible errors.

Inference is serialized per API process and the native server has one slot. Multiple API processes would require shared scheduling. This is not a multi-user production deployment or a throughput guarantee. The earlier timeouts and hard OS termination/cancellation behavior still warrant load/recovery testing. A forced OS process kill can bypass a wrapper's final log, despite normal shutdown being verified.

## 9. Future custom checkpoint and rollback

Keep the original Qwen as default. Use the prepared Colab notebook for genuine LoRA training; no completed training run is claimed. Preserve the trained adapter, validated checkpoint and training manifest, then merge/export with the existing tools and pinned llama.cpp conversion instructions.

Start the candidate separately on 8082 with `runtime.py serve --variant candidate --model-path C:/path/custom.gguf`. Evaluate original and candidate on the same current code and frozen held-out suite using the isolated benchmark harness. Run the existing `virtualfit_slm.register_custom` gates with the actual GGUF, training manifest, baseline and candidate reports. Require genuine CUDA optimizer steps, compatible base/revision, model loading, correct artifact hashes, non-regressing metrics and human review. See [the first cloud-run guide](first-cloud-training-run.md).

Only an approved, loaded and inference-ready custom checkpoint becomes selectable. It is never fabricated from the base GGUF. The UI still defaults to original Qwen; selecting it is explicit rollback and clears conversation state. Original model weights are never overwritten.

Implementation references: [pinned llama.cpp server protocol](https://github.com/ggml-org/llama.cpp/blob/b11643/tools/server/README.md), [Python subprocess lifecycle](https://docs.python.org/3/library/subprocess.html), and [Next.js loopback development origins](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins).
