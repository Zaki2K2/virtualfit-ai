"""Loading of the real CatVTON weights (pretrained baseline + optional LoRA adapter).

One UNet stays resident. The fine-tuned model is the SAME base weights plus a LoRA adapter, so
"pretrained" runs with the adapter disabled and "custom" with it enabled - the baseline weights are
never modified, and both variants are compared with the exact same code path.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from pathlib import Path

from .training.metadata import ADAPTER_CONFIG, ADAPTER_FILE, METADATA_FILE, is_genuine_finetune

VARIANTS = ("pretrained", "custom")


class ModelUnavailable(RuntimeError):
    """The requested model cannot run here. `code` is surfaced by the API unchanged."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


@dataclass(frozen=True)
class ModelPaths:
    base_model: str = "booksforcharlie/stable-diffusion-inpainting"
    vae_model: str = "stabilityai/sd-vae-ft-mse"
    attn_repo: str = "zhengchong/CatVTON"
    attn_version: str = "vitonhd"
    adapter_dir: str | None = None
    height: int = 512
    width: int = 384


def inspect_adapter(adapter_dir: str | None) -> tuple[bool, str, dict | None]:
    """(usable, reason, metadata). An adapter is usable only if it is a genuine fine-tune."""
    if not adapter_dir:
        return False, "no adapter configured (set ENGINE_ADAPTER_DIR)", None
    d = Path(adapter_dir)
    for name in (ADAPTER_FILE, ADAPTER_CONFIG, METADATA_FILE):
        if not (d / name).is_file():
            return False, f"adapter incomplete: {d / name} missing", None
    meta = json.loads((d / METADATA_FILE).read_text(encoding="utf-8"))
    if not is_genuine_finetune(meta):
        return False, "adapter metadata does not describe a completed fine-tune of the real pretrained model", meta
    return True, "ok", meta


def cuda_available() -> bool:
    try:
        import torch

        return torch.cuda.is_available()
    except ImportError:
        return False


class EngineModels:
    """Lazy, thread-safe holder of the resident pipeline."""

    def __init__(self, paths: ModelPaths, allow_cpu: bool = False):
        self.paths, self.allow_cpu = paths, allow_cpu
        self._lock = threading.Lock()
        self._pipe = None
        self._unet = None
        self._adapter_meta: dict | None = None

    # ---- availability (cheap, never loads weights) ----
    def device_ok(self) -> tuple[bool, str]:
        if cuda_available():
            return True, "cuda"
        if self.allow_cpu:
            return True, "cpu (ENGINE_ALLOW_CPU=1; extremely slow)"
        return False, "no CUDA GPU available"

    def availability(self) -> dict[str, dict]:
        ok, why = self.device_ok()
        out = {"pretrained": {"available": ok, "reason": "ok" if ok else why}}
        adapter_ok, adapter_why, meta = inspect_adapter(self.paths.adapter_dir)
        out["custom"] = {
            "available": ok and adapter_ok,
            "reason": "ok" if ok and adapter_ok else (why if not ok else adapter_why),
            "adapter": None if meta is None else {
                "steps": meta.get("optimizer_steps_completed"),
                "created_utc": meta.get("created_utc"),
                "genuine": adapter_ok,
            },
        }
        return out

    # ---- heavy loading ----
    def _load(self):
        import torch
        from diffusers import AutoencoderKL, DDIMScheduler, UNet2DConditionModel
        from huggingface_hub import snapshot_download

        from .arch import load_attention_checkpoint, prepare_unet
        from .pipeline import TryOnPipeline
        from .training.config import ATTN_SUBFOLDERS
        from .training.lora import attach_lora, load_adapter_state

        ok, why = self.device_ok()
        if not ok:
            raise ModelUnavailable("GPU_UNAVAILABLE", why)
        device = "cuda" if cuda_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32

        p = self.paths
        try:
            unet = UNet2DConditionModel.from_pretrained(p.base_model, subfolder="unet")
            prepare_unet(unet)
            root = Path(p.attn_repo)
            if not root.exists():
                root = Path(snapshot_download(repo_id=p.attn_repo, allow_patterns=[f"{ATTN_SUBFOLDERS[p.attn_version]}/attention/*"]))
            load_attention_checkpoint(unet, str(root / ATTN_SUBFOLDERS[p.attn_version] / "attention"))
            vae = AutoencoderKL.from_pretrained(p.vae_model)
            scheduler = DDIMScheduler.from_pretrained(p.base_model, subfolder="scheduler")
        except Exception as exc:
            raise ModelUnavailable("MODEL_UNAVAILABLE", f"could not load pretrained weights: {type(exc).__name__}: {exc}") from exc
        unet.to(device, dtype=dtype)
        vae.to(device, dtype=dtype)

        adapter_ok, _, meta = inspect_adapter(p.adapter_dir)
        if adapter_ok:
            d = Path(p.adapter_dir)
            from safetensors.torch import load_file

            cfg = json.loads((d / ADAPTER_CONFIG).read_text(encoding="utf-8"))
            attach_lora(unet, cfg)
            load_adapter_state(unet, {k: v.to(device) for k, v in load_file(str(d / ADAPTER_FILE)).items()})
            unet.to(device, dtype=dtype)
            self._adapter_meta = meta
        unet.eval()
        self._unet = unet
        self._pipe = TryOnPipeline(unet, vae, scheduler, device, dtype)

    def pipeline(self, variant: str):
        """Return the resident pipeline configured for `variant`. Raises ModelUnavailable."""
        if variant not in VARIANTS:
            raise ModelUnavailable("VALIDATION_ERROR", f"unknown model version {variant!r}")
        info = self.availability()[variant]
        if not info["available"]:
            code = "GPU_UNAVAILABLE" if "GPU" in info["reason"] or "CUDA" in info["reason"] else "MODEL_UNAVAILABLE"
            raise ModelUnavailable(code, info["reason"])
        with self._lock:
            if self._pipe is None:
                self._load()
            if variant == "custom":
                self._unet.enable_adapters()
            elif self._adapter_meta is not None:
                self._unet.disable_adapters()
        return self._pipe

    @property
    def lock(self) -> threading.Lock:
        return self._lock

    def adapter_metadata(self) -> dict | None:
        return self._adapter_meta
