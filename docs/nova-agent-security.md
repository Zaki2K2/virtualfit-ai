# Nova agent and tool security

Status: the **permission gateway is implemented and tested**. **No agent loop exists**: the language model cannot call tools, and no filesystem, code-execution, search or external-action tool is shipped. Those are Planned and must follow this design.

## Threat model

- The language model, its prompt and any retrieved document are **untrusted**. A prompt injection must not be able to approve or run an action.
- Users are anonymous guest sessions. Ownership is the guest id.
- The API host is the user's own machine; the blast radius of an unsafe tool is their files and accounts.

## Implemented controls (`modules/orchestrator/tools.ts`)

1. **Deny by default.** A tool must be registered in code **and** named in the operator's `NOVA_TOOLS_ENABLED` allowlist (environment, not user-controllable). Otherwise: HTTP 403 and an audit entry.
2. **Risk classes.** `read`, `write`, `execute`, `external`. Only `read` can run without confirmation.
3. **Two-step approval for everything else.**
   - `POST /tools/:name/approvals` records the exact validated input and returns an approval id. Nothing runs.
   - `POST /tools/approvals/:id/confirm` is a separate user-initiated request. The model has no channel to it.
   - The approval is bound to owner, tool and a SHA-256 of the exact input; it is single use and expires after 5 minutes. A changed input, a different user, a reused or expired approval are all rejected.
4. **Input validation** with a per-tool Zod schema before anything runs.
5. **Timeouts and cancellation.** Every call gets `AbortSignal.any([client disconnect, per-tool timeout])`. A timeout returns `AI_TIMEOUT`; a client disconnect cancels.
6. **Audit log.** Per owner, bounded (500 entries, in memory): tool, risk, outcome (`ok|denied|failed|timeout|cancelled`). Persistent audit storage is Planned.
7. **Rate limit and origin check** inherited from the Nova router (cross-origin writes are refused).

The only shipped tool is `system.resources` (read, disabled until allowlisted). Tests: denied by default, approval binding/ownership/single use, timeout, cancellation, input validation.

## Required design for future tools (Planned)

| Tool | Class | Mandatory constraints |
| --- | --- | --- |
| Filesystem inspect | read | resolve real paths and reject anything outside one configured root (no symlink escape, no `..`), size and count limits, deny dot-files and secrets such as `.env` |
| File modify | write | show a diff to the user; write only after confirmation; keep a backup; never outside the root |
| Code execution | execute | no host shell. Run in a container or VM with no network, read-only root, CPU/RAM/time limits, a throwaway working directory, no mounted secrets. If no real sandbox exists the tool stays disabled |
| Web search | external | provider behind an interface; send only the query text; show the query; results are untrusted data, never instructions; per-user quota |
| External actions (email, purchases, posts) | external | exact action preview, explicit confirmation each time, no stored standing approval |

Destructive or irreversible operations always require confirmation, even if a user once approved a similar action. The language model never receives unrestricted OS access, shell, or credentials.

## Data safety rules

- Knowledge documents need explicit per-document consent, belong to one owner, are searchable only by that owner and are deleted with the document or with "erase my data".
- Private conversations, memories and documents are never used for training automatically; the existing operator-approved export path is the only route (see `nova-platform.md`).
- Retrieved text is context, never an instruction source; it must be presented to the model as quoted, untrusted material.
- Secrets (`.env`, API keys, bearer keys) are not readable by any tool.

## Known gaps

No persistent audit log; no per-tool rate limits beyond the router limit; no real sandbox; retrieved-document prompt-injection defences are not yet exercised because retrieval is not wired into chat.
