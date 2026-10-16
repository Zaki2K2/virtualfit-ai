# SLM runtime shutdown investigation — 16 October 2026

## Verified cause and limits

The exact reported traceback was reproduced by sending Ctrl+C to the original `npm run slm:serve` terminal after successful loading. Python raised `KeyboardInterrupt` while evaluating `process.wait()` inside `raise SystemExit(process.wait())`. An independent Windows process handle captured the real native child's exit code: **0 (0x00000000)**. llama.cpp printed `operator(): cleaning up before exit...`. The outer terminal command returned 1 because of its interrupted shell/Python execution; that was not the native server's status.

The wrapper previously handled no interrupt, returned no child-exit diagnostics and called `terminate()` in `finally` without subsequently waiting. `SystemExit` itself was not the crash: the interrupt occurred before `process.wait()` returned. This reproduction proves the misleading traceback is caused by unhandled terminal interruption. It does not prove which actor originally signaled the user's earlier session, for which the full historical traceback/process status is unavailable. No spontaneous native crash or model-loading failure was reproduced.

There was initially no 8081 listener. During investigation, two `npm -> cmd -> Python -> llama-server` chains targeting 8081 were observed (native PIDs 14768 and 5724). The first was our test instance; the second appeared separately and was preserved. At final verification, only PID 5724 remained on 8081. Duplicate launch is therefore an observed risk, but not proven as the cause of the original traceback. Existing llama.cpp port binding alone did not reliably prevent two server processes; the wrapper now guards both loading and listening intervals.

`package.json` starts exactly one wrapper for `slm:serve`. `dev:slm` starts one SLM plus the app through `concurrently --kill-others`: an app-process exit deliberately shuts down its SLM sibling. No infinite restart loop exists or was added. Running both commands starts two independent SLM launch attempts. Closing the terminal or forcibly killing a supervisor can also end the process tree; forced OS termination cannot guarantee Python finalizers or a final log event.

The Windows Application log query for llama-server fault events 1000/1001 in the preceding seven days returned no matching records. That is not proof that no crash ever occurred. The memory preflight also rejected some additional test launches when available RAM was below 768 MiB; this was an explicit prelaunch failure, not a shutdown after listening. The guard was preserved.

## Changes

`slm-engine/tools/runtime.py` now:

- Handles SIGINT/SIGTERM and Windows SIGBREAK while supervising the child. Windows keeps the shared console so llama.cpp receives its native Ctrl+C cleanup event. POSIX signals are relayed to the child. No console-wide synthetic signal is broadcast by the wrapper.
- Allows ten seconds for intentional cleanup, then logs and performs bounded terminate/kill cleanup if needed, always waiting for the child. Forced cleanup is a failure, not a reported clean stop.
- Logs timestamp, wrapper/parent/child PID, endpoint, model path, context, thread count, uptime, requested signal and exact child exit code in decimal/hex. Common Windows crash/control statuses receive descriptions. Native stdout/stderr remain visible; no prompt/key contents are added to lifecycle logs.
- Returns 0 after a clean intentional stop. Unexpected native nonzero codes 1–255 are propagated; larger Windows statuses and unexpected native code 0 return wrapper failure 1, with the exact native status retained in the diagnostic. There is no retry/restart policy.
- Rejects duplicate wrappers with an OS-held per-port file lock, including before the child listens. The OS releases the lock on owner exit; the persistent lock filename is not a stale live lock. A socket check rejects other listeners and reports their Windows PID without killing them. An unrelated non-wrapper process can still race the final bind; its resulting native failure is reported normally.
- Adds optional `--port` for isolated diagnostics. Defaults remain 8081/base and 8082/candidate. Model hash checks, model alias, authentication, four threads, context 2048, CPU/Q4 inference and custom-model registration behavior are retained.

No model weights were changed or downloaded, no runtime/model reinstall ran, and `.env`/production configuration was not edited. The original checksum continued to pass. Existing training-preparation changes in the working tree were retained.

## Direct verification

| Check | Observed result |
| --- | --- |
| Original wrapper Ctrl+C reproduction | Native PID 14768 exited 0; cleanup logged; original Python printed `KeyboardInterrupt` traceback |
| Health and model endpoint | `/health` and authenticated `/v1/models` returned 200, correct base alias |
| Final corrected wrapper, isolated Windows console | Genuine model loaded; inference succeeded; generated console Ctrl+C; native exit 0, wrapper exit 0, cleanup logged, no traceback |
| Controlled unexpected native termination | Only our isolated child was externally terminated with code 23; native and wrapper exit 23, `unexpected-exit`, no traceback, no restart. This was a deliberate diagnostic test, not a spontaneous crash |
| Actual occupied-port launch | 8081 launch rejected with owner PID 5724 and wrapper exit 1; existing listener preserved |
| Actual duplicate corrected wrapper | 8083 launch rejected with existing-wrapper lock diagnostic and owner PID 21836; no second child launched |
| Sustained final-wrapper check | Seven HTTP 200 health checks over 60.143 seconds; subsequent inference and stylist requests succeeded; test server stayed running for 119.902 seconds until intentional Ctrl+C, then native exit 0/no traceback |
| Live VirtualFit stylist | Existing Express/provider/service stack in isolated in-memory harness, pointed at test port 8083: HTTP 200, `source: model`, `modelUsed: true`, `simulated: false`, expected `tee-classic-white`, schema and selection checks true; 3.975 seconds |
| Python regressions | Final complete Python suite: 19 passed, including 8 runtime lifecycle regressions |
| API regressions | `styling.test.ts` and `grounding.test.ts`: 21 passed |
| Whitespace | `git diff --check` passed |

The two preliminary direct completions deliberately used small token budgets to test transport and process stability; they were not fashion-quality evaluations. The stylist check used the provider's existing schema and 260-token budget without changing quality settings. A two-minute stability check does not establish indefinite uptime.

Live local evidence (ignored generated artifacts, retained on this workstation):
- `slm-engine/runs/runtime-clean-stop.json` and `.log`: isolated-console native/wrapper-zero result.
- `slm-engine/runs/runtime-unexpected-exit.json` and `.log`: explicit native/wrapper-23 failure result.
- `slm-engine/runs/runtime-final-live-check.json`: sustained health samples, native completion and actual stylist response.
- `slm-engine/runs/runtime-shutdown-live-check.json`: preliminary direct inference and API checks.

Re-run automated checks:

```powershell
ai-engine/.venv/Scripts/python.exe -m pytest slm-engine/tests -q
npm run test -w @virtualfit/api -- src/styling.test.ts src/grounding.test.ts
```

## Operation

Keep using `npm run slm:serve` for an independently running foreground SLM. Keep the terminal open. Use Ctrl+C to stop it. Use `npm run dev:slm` instead if the SLM should share the application's lifetime, and do not launch standalone `slm:serve` alongside it. A duplicate/occupied-port failure now identifies the existing listener rather than silently adding another instance.

All diagnostic instances on 8083 and the isolated benchmark harness on 5100 were intentionally stopped after verification. The existing 8081 listener was preserved and health-checked again. It loaded the old Python wrapper before the edit; apply the new wrapper on its next intentional stop/start. The model and running service do not need reinstallation.

Implementation semantics were cross-checked against [Python subprocess process waiting and return codes](https://docs.python.org/3/library/subprocess.html) and [Python signal handling](https://docs.python.org/3/library/signal.html).
