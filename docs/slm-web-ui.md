# Local Qwen browser chat

The 404 at `/` was caused by the launcher's explicit `--no-webui` flag. Installed llama.cpp b11643 supports `--ui`; the launcher now passes that flag. The official embedded UI is used without replacing the runtime or model.

1. From `C:\virtualfit-ai`, run `npm run slm:serve`. Keep this terminal open. If the server is already running with the updated launcher, reuse it; duplicate launch attempts are rejected. For an older running instance, stop its owning terminal with Ctrl+C before starting the updated launcher.
2. Open `http://127.0.0.1:8081/`. The initial **Access denied** screen is expected until you authenticate. Click **Enter API Key**.
3. In a local PowerShell terminal, run `Get-Content .\slm-engine\runtime\api-key.txt`. Paste that private value into the UI's password field and select **Save & Retry**. Do not share it, put it in a URL, or commit it. The UI may remember it in that browser profile; use a private browser window for temporary testing.
4. Send a message. For the wardrobe-grounded application, run `npm run dev:ai` in another terminal; it verifies and reuses this model process. Open `http://localhost:3000/stylist`. Express continues to authenticate server-side; Stylist users do not need the native key.
5. Stop services with Ctrl+C in their owning terminals. Stopping `dev:ai` does not stop a separately launched `slm:serve` process.

The native listener remains **127.0.0.1:8081**, CPU-only, with the same API-key file and restricted CORS configuration. `/health` is intentionally public on loopback. Missing and incorrect keys receive HTTP 401 on `/v1/chat/completions`. Do not port-forward this listener. Agent execution and tools were not enabled.

Native chat is a direct model sandbox: it does not search MongoDB, enforce wardrobe grounding, or apply the application's input filters. Use `/stylist` for actual garment recommendations. Submit text only when testing this language model; no photographs or body measurements are needed. The separate vision provider was unchanged.

## Verified on 16 October 2026

- `npm run slm:serve` launched the unchanged original Qwen GGUF using `--ui`, API-key-file authentication, four CPU threads, context 2048 and zero GPU layers.
- Isolated Chrome rendered the official UI at `/` (HTTP 200), displayed the authentication gate, accepted the existing key, and submitted an authenticated streaming `/v1/chat/completions` request (HTTP 200).
- Real prompt: `Say hello in one short sentence.` Real generated response: `Hello! How can I assist you today?`
- `/health`: HTTP 200, `status: ok`. Missing and wrong chat keys: HTTP 401. The only native listener was loopback port 8081; only one llama-server process was running.
- The live Stylist browser regression passed three requests through Express, validated selected IDs, custom-model disabling, studio links and unavailable-state handling. This run returned two explicitly labeled deterministic fallbacks and one accepted Qwen category response; it did not mislabel fallback answers as model output.
- Python SLM suite: 29 passed, including a new launch-command regression that checks UI enablement, loopback binding, CPU mode and retained key-file authentication.

Repeat the optional live browser checks with `node apps/web/scripts/verify-slm-ui.mjs` and `node apps/web/scripts/verify-stylist.mjs`. They require local Chrome and Playwright installed only in the ignored test directory:

```powershell
npm install --prefix slm-engine/runs/browser-test --no-save --package-lock=false playwright
```

The checks use a fresh isolated browser profile and never print the key. Local evidence and screenshots are under ignored `slm-engine/runs/slm-web-ui-check.json` and `slm-web-ui.png`. Native UI behavior is documented in the [installed-version server documentation](https://github.com/ggml-org/llama.cpp/blob/b11643/tools/server/README.md).
