# Nova deployment strategy

Target machine today: Windows, **no NVIDIA GPU, limited free RAM (about 1.7 GiB seen during one earlier inspection)**. The design keeps the always-on footprint to what already runs and pushes heavy work to optional, remote, opt-in workers.

## Topology

| Process | Where | Always on? | Purpose |
| --- | --- | --- | --- |
| Next.js | local | yes | UI and `/api` proxy (timeout 610 s, see `nova-platform.md`) |
| Express API (orchestrator) | local | yes | routing, queues, memory, tools |
| MongoDB | local | yes (optional; memory fallback) | persistence |
| llama.cpp + Qwen2.5-0.5B | local CPU | yes, started by existing scripts | default text model |
| `nova-engine` worker | **remote GPU** (or local if RAM allows) | **no, opt-in** | vision, image generation |
| Future speech / embedding workers | remote or small CPU | no | planned |

No new background process is added by the orchestrator. It is a library inside the API.

## Resource awareness (Implemented)

- `ResourceMonitor` samples free/total RAM, free disk (`statfs`), load average and CPU count on demand (`GET /api/v1/nova/resources`). There is no polling timer.
- Registry models flagged `loadsOnDemand` must pass an admission check (required free RAM plus a 512 MiB reserve) before they can resolve; otherwise the router returns `unavailable` with the reason instead of loading and swapping the machine.
- Existing limits remain: `NOVA_CONCURRENCY`, `NOVA_QUEUE_SIZE`, `NOVA_TIMEOUT_MS`, `NOVA_STORAGE_MB`, `NOVA_MIN_FREE_DISK_MB`.
- Lazy loading is the rule: nothing loads at API start, and the worker loads models only on first request and only when downloads are explicitly allowed.

## Configuration summary

```dotenv
SLM_URL=http://127.0.0.1:8081          # local Qwen (unchanged)
NOVA_VISION_URL=  NOVA_VISION_KEY=  NOVA_VISION_EXTERNAL=     # empty = disabled
NOVA_IMAGE_URL=   NOVA_IMAGE_KEY=   NOVA_IMAGE_EXTERNAL=      # empty = disabled
NOVA_TOOLS_ENABLED=                    # empty = every tool denied
WEB_PROXY_TIMEOUT_MS=610000
```

## Provider-independent interfaces

Every remote capability speaks an OpenAI-compatible HTTP shape (`/v1/chat/completions` with image blocks, `/v1/images/generations`; planned `/v1/audio/*`, `/v1/embeddings`). Replacing the SmolVLM worker with another compatible host is a URL/key change plus a registry descriptor.

## Hardware and GPU requirements

Figures are model-card estimates, **not measured here**.

| Workload | Minimum | Recommended |
| --- | --- | --- |
| Qwen2.5-0.5B text (today) | CPU, about 1 GiB free RAM | same |
| SmolVLM-256M vision | CPU possible but slow (operator must opt in with `NOVA_ALLOW_CPU_VISION=1`), about 2 GiB RAM | GPU with 4 GB+ VRAM |
| SSD-1B image generation | GPU with about 8 GB VRAM; CPU generation is disabled | 12 GB+ VRAM, CUDA PyTorch |
| Speech-to-text (small Whisper-class) | CPU | GPU for real time |
| Larger chat or coding model (3B-7B quantised) | 8 GB+ RAM or 6 GB+ VRAM | GPU host |
| Fine-tuning (LoRA) | cloud GPU (Colab/Kaggle/rented) | never on this machine |

## Remote GPU worker (operator steps, not performed automatically)

Follow "Worker setup on your own GPU host" in `nova-platform.md`: separate Python env, private key of 24+ characters, TLS or SSH tunnel, explicit enable flags, one-time download opt-in, then benchmark. Paid providers need the operator's explicit approval; none is provisioned by this repository.

## Graceful unavailability

Missing or unhealthy providers produce a structured `unavailable` decision and, in the existing media routes, 503 `AI_UNAVAILABLE`. The UI shows the reason. Nothing substitutes a different model silently, except the labelled `code -> text` fallback.
