# Nova AI — Powered by NovaCTO

Nova is the VirtualFit AI fashion assistant developed and customized by NovaCTO. Its unchanged Qwen2.5-0.5B-Instruct Q4_K_M foundation model was created by the Qwen team at Alibaba Cloud. NovaCTO did not create Qwen. **No successful Nova fine-tuning run or custom checkpoint exists.** The present customization uses prompts, product labels and wardrobe grounding.

## One identity configuration

[`packages/shared/src/nova.json`](../packages/shared/src/nova.json) is authoritative: name, developer, public labels, foundation attribution, capabilities, persistent identity prompt, structured styling rules, identity-topic facts and native UI temperature. The shared TypeScript module exports this configuration to Express and the Stylist. It also routes identity/capability questions and validates key provenance facts in generated API replies.

`slm-engine/configs/prompt.json` and dataset system messages are generated snapshots, not separately maintained identities. The test suite checks that the ordinary serving prompt matches the training snapshot.

## Native browser chat

`npm run slm:serve` reads the central identity and creates ignored `slm-engine/runtime/nova-qwen.jinja` and `nova-ui.json`. The launcher passes `--chat-template-file` and `--ui-config-file` to the existing llama.cpp b11643 executable, retaining `--ui`, `--host 127.0.0.1`, port 8081, the existing API-key file, CPU mode, model hash verification and model alias `virtualfit-style-base`.

The version-controlled `configs/nova-qwen.jinja.in` preserves the installed Qwen ChatML and tool-message formatting. It adds Nova's trusted system identity even when a client supplies no system message. A supplied matching identity is removed before composition to avoid duplication. For recognized identity questions it adds centrally configured facts and one synthetic example exchange to the inference prompt. These are few-shot prompts, not learned weights or real prior user conversations. Other internal chat-completions clients using the server's default template receive the same identity.

The native UI's default system-message label is **Nova AI — Powered by NovaCTO**, visible in a conversation. The official llama.cpp shell, welcome screen and technical model alias remain intact; no runtime binary or UI bundle was replaced. The assistant identifies as Nova in its replies. API clients continue to use the original technical alias.

Native UI temperature defaults to **0**, after real testing found that temperature 0.2 could introduce a contradictory “Yes” in a provenance answer. Express outfit generation retains temperature 0.2, seed 42 and its existing token budget. Existing browser preferences may override UI defaults: start a new conversation and set **Settings → Sampling & Penalties → Temperature** to **0** if needed. The server template applies even when an older browser has a blank or stale UI system message.

Open `http://127.0.0.1:8081/`, select **Enter API Key**, and paste the existing local key from `slm-engine/runtime/api-key.txt`. Never put the key in a URL or share it. Native chat is a text-testing sandbox without MongoDB wardrobe retrieval or Express output validation. User messages do not write identity configuration, weights or persistent server state. Prompt adherence is probabilistic; browser owners can change sampling or supply other prompts. Treat the configured identity as assistant behavior, not an authorization boundary.

## Stylist and Express

`http://localhost:3000/stylist` displays **Nova AI**, **Powered by NovaCTO**, and **Ask Nova**, while keeping VirtualFit AI branding elsewhere. It still uses the existing Next.js-to-Express proxy. Only Express reads the private inference token for these requests.

The provider composes the central identity with the existing structured JSON and catalog rules. Identity questions are routed as nonselecting advice: no garment IDs, no categories and no inherited outfit selection. They still make a real local inference request. Advice and identity replies do not display the empty-wardrobe error. If the output is invalid, omits necessary provenance or echoes prompt instructions, Express returns the configured truthful answer with `source: deterministic-fallback`; it never labels that answer as generated model output. Ordinary garment requests retain ownership-aware retrieval, schema/ID/category validation, ranking and explanation checks.

No MongoDB isolation, model-selection/rollback gates, mock provider or vision-provider implementation was changed. The original model remains the default, future custom models remain disabled, and no photo or measurement input was added to the language service.

## Updating the identity

1. Edit `packages/shared/src/nova.json`. Keep product development distinct from foundation authorship. Update the explicit training-status fact only after a genuine, validated training run.
2. Run `python slm-engine/tools/prepare_nova_data.py`. This synchronizes prompt snapshots, existing training system turns, identity examples and dataset hashes. It is idempotent and does not train anything.
3. Run the checks below. Restart the owning `slm:serve` terminal to regenerate its template and UI defaults; restart the app through `npm run dev:ai`. Use a new browser conversation so earlier responses do not remain in context.
4. Rebuild the cloud source bundle with `python slm-engine/tools/package_training.py` before any Colab run. The bundle includes the authoritative identity JSON alongside the training sources and split data.

## Training preparation

The active `data/training-v2` corpus contains **72 training / 11 validation / 17 test** examples, including **8 / 3 / 9** Nova identity and capability examples. Existing structured clothing/outfit examples remain. New examples cover introductions, assistant development, Qwen attribution, local execution, capabilities, physical-fit limits, absence of fine-tuning and attempted identity replacement. Questions are disjoint across splits; the separate 102-case wardrobe API evaluation corpus remains unchanged. Validation checks target IDs and request leakage. The pinned real tokenizer verifies chat-template alignment and the 1024-token limit without truncation.

This small synthetic corpus prepares a first LoRA experiment; it does not establish fashion quality or successful training. Original rollback GGUF weights were neither modified nor replaced. SHA-256 remains `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db`.

Dataset hashes changed. Start a new cloud experiment for this corpus; the existing provenance checks correctly reject resuming a checkpoint made with different dataset hashes.

## Verified results — 16 October 2026

- Nine identity questions in isolated native Chrome conversations passed, including Qwen attribution and the explicit “Did NovaCTO create your underlying foundation model?” question. Nova's label rendered in the conversation. The final configuration uses native temperature 0; earlier exploratory temperature-0.2 runs exposed contradictory yes/no wording and were not treated as passes.
- The same nine questions in the real Stylist browser passed the identity checks with empty selections: nine accepted model replies, all invoking local inference. Earlier exploratory runs included a disclosed fallback after output validation; it was never counted as an accepted generated response.
- The wardrobe browser regression returned the expected verified IDs across three requests: two accepted model responses and one explicit fallback, with studio links, guest-facing unavailability and custom-model disabling intact.
- Native root and health returned 200, real authenticated streaming chat returned 200, and missing/wrong keys returned 401. A single llama-server process listened only on `127.0.0.1:8081`. The original model checksum remained unchanged.
- 140 JavaScript tests and 30 SLM Python tests passed, along with TypeScript checks, lint and the complete production build. The Python suite also validated the pinned real tokenizer and all dataset split contracts; no cloud training was executed.

Exact final browser answers and model/fallback sources are in [nova-identity-verification.json](nova-identity-verification.json). Local screenshots are under ignored `slm-engine/runs/nova-native.png` and `nova-stylist.png`. These checks establish the listed behavior, not universal resistance to adversarial prompts or production fashion quality.

## Verification commands

```powershell
npm test
ai-engine/.venv/Scripts/python.exe -m pytest slm-engine/tests -q
npm run typecheck
npm run lint
npm run build
```

With the local services running, optional isolated Chrome/Playwright checks:

```powershell
node apps/web/scripts/verify-nova.mjs
node apps/web/scripts/verify-slm-ui.mjs
node apps/web/scripts/verify-stylist.mjs
```

The browser dependency setup is described in [the native UI guide](slm-web-ui.md). Run live checks sequentially because the CPU service intentionally accepts one application generation at a time. Concurrent independent test suites can receive the expected HTTP 429 busy response.

Official references: [installed-version llama.cpp server flags](https://github.com/ggml-org/llama.cpp/blob/b11643/tools/server/README.md), [UI system-message settings](https://github.com/ggml-org/llama.cpp/blob/b11643/tools/ui/src/lib/constants/settings.constants.ts), [Qwen2.5-0.5B-Instruct attribution and license](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct).
