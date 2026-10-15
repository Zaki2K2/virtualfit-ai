"""Parameter-efficient adaptation of the CatVTON self-attention layers."""

from __future__ import annotations

import torch

from ..arch import attention_modules

# Only the self-attention (attn1) projections - the same layers CatVTON trains in full.
LORA_TARGET_REGEX = r".*attn1\.(to_q|to_k|to_v|to_out\.0)"


def make_lora_config(rank: int, alpha: int) -> dict:
    return {"r": rank, "lora_alpha": alpha, "target_modules": LORA_TARGET_REGEX, "init_lora_weights": True}


def attach_lora(unet, lora_cfg: dict) -> list[torch.nn.Parameter]:
    """Freeze the whole UNet, add zero-initialised LoRA layers (B=0 -> output identical to the
    baseline at step 0) and return the trainable parameters (cast to fp32 for stable updates)."""
    from peft import LoraConfig

    unet.requires_grad_(False)
    unet.add_adapter(LoraConfig(**lora_cfg))
    params = [p for p in unet.parameters() if p.requires_grad]
    for p in params:
        p.data = p.data.float()
    return params


def select_attention_params(unet) -> list[torch.nn.Parameter]:
    """Alternative method: train the self-attention weights directly (the official recipe)."""
    unet.requires_grad_(False)
    seen: set[int] = set()
    params = []
    for module in attention_modules(unet):
        for p in module.parameters():
            if id(p) not in seen:
                seen.add(id(p))
                p.requires_grad_(True)
                p.data = p.data.float()
                params.append(p)
    return params


def adapter_state_dict(unet) -> dict[str, torch.Tensor]:
    from peft import get_peft_model_state_dict

    return get_peft_model_state_dict(unet)


def load_adapter_state(unet, state: dict[str, torch.Tensor]) -> None:
    """Attach LoRA layers with the saved config first (see `attach_lora`), then call this."""
    from peft import set_peft_model_state_dict

    result = set_peft_model_state_dict(unet, state)
    unexpected = getattr(result, "unexpected_keys", None)
    if unexpected:
        raise ValueError(f"adapter has keys the UNet does not: {unexpected[:3]}")


def count_parameters(params: list[torch.nn.Parameter]) -> int:
    return sum(p.numel() for p in params)
