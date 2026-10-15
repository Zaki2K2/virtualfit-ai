"""CatVTON architecture helpers (ported from the CatVTON reference code, CC BY-NC-SA 4.0).

CatVTON turns a Stable Diffusion *inpainting* UNet (9 input channels) into a try-on model by:
  1. removing the text conditioning: every cross-attention layer (attn2) is skipped, and
  2. concatenating person and garment latents along the HEIGHT axis so that the remaining
     self-attention layers (attn1) can copy garment detail onto the person.
Only the self-attention layers are trained (~49.6M parameters in the official release).
"""

from __future__ import annotations

import torch
from diffusers.models.attention_processor import AttnProcessor2_0

CONCAT_DIM = -2  # latents are concatenated along height (the reference code's "y axis concat")


class SkipAttnProcessor(torch.nn.Module):
    """Cross-attention replacement that returns its input unchanged (no text prompt exists)."""

    def __call__(self, attn, hidden_states, encoder_hidden_states=None, attention_mask=None, temb=None, *args, **kwargs):
        return hidden_states


class SelfAttnProcessor(torch.nn.Module):
    """Standard SDPA self-attention, wrapped as an nn.Module on purpose.

    The released CatVTON attention checkpoints are indexed by position in `attention_modules()`.
    In the reference code the processors are nn.Modules, so each attn1 block contributes 8 entries
    (attn1, to_q, to_k, to_v, to_out, to_out.0, to_out.1, processor). diffusers' own processor is
    not an nn.Module, which would shrink the stride to 7 and silently load weights into the wrong
    layers. Keeping the stride identical is verified by tests/test_arch.py and by
    tools/check_attention_checkpoint.py against the real checkpoint.
    """

    def __init__(self):
        super().__init__()
        self._impl = AttnProcessor2_0()

    def __call__(self, attn, hidden_states, encoder_hidden_states=None, attention_mask=None, temb=None, *args, **kwargs):
        return self._impl(attn, hidden_states, encoder_hidden_states, attention_mask, temb, *args, **kwargs)


def prepare_unet(unet) -> None:
    """Skip cross-attention, keep standard (SDPA) self-attention. Mirrors reference `init_adapter`."""
    procs = {}
    for name in unet.attn_processors.keys():
        procs[name] = SelfAttnProcessor() if name.endswith("attn1.processor") else SkipAttnProcessor()
    unet.set_attn_processor(procs)


def attention_modules(unet) -> torch.nn.ModuleList:
    """Same selection as the reference `get_trainable_module(unet, "attention")`: every module whose
    qualified name contains 'attn1'. The order matters: released attention checkpoints are indexed
    by position in this list."""
    modules = torch.nn.ModuleList()
    for name, module in unet.named_modules():
        if "attn1" in name:
            modules.append(module)
    return modules


def load_attention_checkpoint(unet, checkpoint_dir: str) -> None:
    """Load a released CatVTON attention checkpoint (`<repo>/<version>/attention`) into the UNet."""
    from accelerate import load_checkpoint_in_model

    load_checkpoint_in_model(attention_modules(unet), checkpoint_dir)


def build_conditioning(
    masked_latent: torch.Tensor,
    garment_latent: torch.Tensor,
    mask_latent: torch.Tensor,
    drop_garment: torch.Tensor | None = None,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Channel conditioning shared by training and sampling.

    Returns (mask_concat, masked_latent_concat), both height-concatenated:
        mask_concat          = [mask | zeros]            (garment half is never repainted)
        masked_latent_concat = [masked person | garment]
    `drop_garment` (bool per batch item) zeroes the garment latent: this is the "unconditional"
    branch used for classifier-free guidance at sampling time.
    """
    if drop_garment is not None:
        keep = (~drop_garment).to(garment_latent.dtype).view(-1, 1, 1, 1)
        garment_latent = garment_latent * keep
    mask_concat = torch.cat([mask_latent, torch.zeros_like(mask_latent)], dim=CONCAT_DIM)
    masked_concat = torch.cat([masked_latent, garment_latent], dim=CONCAT_DIM)
    return mask_concat, masked_concat
