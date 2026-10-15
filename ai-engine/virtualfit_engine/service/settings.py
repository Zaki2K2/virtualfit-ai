from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass

from ..models import ModelPaths


def _bool(v: str | None) -> bool:
    return (v or "").strip().lower() in {"1", "true", "yes"}


def is_loopback(host: str) -> bool:
    if host in {"localhost"}:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    api_key: str | None
    max_upload_mb: int
    timeout_s: float
    allow_cpu: bool
    catvton_repo: str | None
    masker_ckpt: str
    paths: ModelPaths

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Settings":
        e = env if env is not None else os.environ
        defaults = ModelPaths()
        paths = ModelPaths(
            base_model=e.get("ENGINE_BASE_MODEL", defaults.base_model),
            vae_model=e.get("ENGINE_VAE_MODEL", defaults.vae_model),
            attn_repo=e.get("ENGINE_ATTN_REPO", defaults.attn_repo),
            attn_version=e.get("ENGINE_ATTN_VERSION", defaults.attn_version),
            adapter_dir=e.get("ENGINE_ADAPTER_DIR") or None,
            height=int(e.get("ENGINE_HEIGHT", defaults.height)),
            width=int(e.get("ENGINE_WIDTH", defaults.width)),
        )
        s = cls(
            host=e.get("ENGINE_HOST", "127.0.0.1"),
            port=int(e.get("ENGINE_PORT", "8000")),
            api_key=e.get("ENGINE_API_KEY") or None,
            max_upload_mb=int(e.get("ENGINE_MAX_UPLOAD_MB", "8")),
            timeout_s=float(e.get("ENGINE_TIMEOUT_S", "300")),
            allow_cpu=_bool(e.get("ENGINE_ALLOW_CPU")),
            catvton_repo=e.get("ENGINE_CATVTON_REPO") or None,
            masker_ckpt=e.get("ENGINE_MASKER_CKPT", "zhengchong/CatVTON"),
            paths=paths,
        )
        if not is_loopback(s.host) and not s.api_key:
            raise RuntimeError("ENGINE_API_KEY is required when ENGINE_HOST is not a loopback address")
        return s
