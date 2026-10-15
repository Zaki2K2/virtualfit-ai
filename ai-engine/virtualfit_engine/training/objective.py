"""Diffusion training objective for CatVTON-style try-on.

What comes from the CatVTON reference code (inference code + `utils.py`):
  * 9-channel inpainting input [noisy | mask | masked-person-and-garment latents],
  * person|garment latents concatenated along height, mask zero on the garment half,
  * epsilon prediction (scheduler prediction_type == "epsilon"),
  * garment latent zeroed for the unconditional branch (classifier-free guidance),
  * `enable_condition_noise` semantics of `prepare_inpainting_input`.
What is OUR reconstruction (the reference repo ships no training script): plain MSE between the
predicted and the true noise, uniformly sampled timesteps, and the dropout probability.
"""

from __future__ import annotations

import torch
import torch.nn.functional as F

from ..arch import CONCAT_DIM, build_conditioning


def compute_loss(
    unet,
    noise_scheduler,
    person_latent: torch.Tensor,
    masked_latent: torch.Tensor,
    garment_latent: torch.Tensor,
    mask_latent: torch.Tensor,
    enable_condition_noise: bool = True,
    condition_dropout: float = 0.0,
    generator: torch.Generator | None = None,
) -> torch.Tensor:
    """One forward pass of the denoising objective; returns a scalar fp32 loss."""
    bsz = person_latent.shape[0]
    device = person_latent.device
    t = torch.randint(0, noise_scheduler.config.num_train_timesteps, (bsz,), generator=generator, device="cpu").to(device)

    if condition_dropout > 0:
        drop = (torch.rand(bsz, generator=generator, device="cpu") < condition_dropout).to(device)
    else:
        drop = torch.zeros(bsz, dtype=torch.bool, device=device)
    mask_concat, masked_concat = build_conditioning(masked_latent, garment_latent, mask_latent, drop_garment=drop)

    if enable_condition_noise:
        # noise both halves: the same situation as sampling, which starts from pure noise everywhere
        clean = torch.cat([person_latent, garment_latent], dim=CONCAT_DIM)
        noise = torch.randn(clean.shape, generator=generator, device="cpu", dtype=clean.dtype).to(device)
        noisy = noise_scheduler.add_noise(clean, noise, t)
        target, pred_slice = noise, slice(None)
    else:
        # noise only the person half; the garment half is passed in clean (reference option)
        noise = torch.randn(person_latent.shape, generator=generator, device="cpu", dtype=person_latent.dtype).to(device)
        noisy_person = noise_scheduler.add_noise(person_latent, noise, t)
        noisy = torch.cat([noisy_person, garment_latent], dim=CONCAT_DIM)
        target, pred_slice = noise, "person_half"

    model_input = torch.cat([noisy, mask_concat, masked_concat], dim=1)
    pred = unet(model_input, t, encoder_hidden_states=None).sample
    if pred_slice == "person_half":
        pred = pred.chunk(2, dim=CONCAT_DIM)[0]
    if noise_scheduler.config.prediction_type != "epsilon":
        raise NotImplementedError("only epsilon prediction is supported (as in the CatVTON checkpoints)")
    return F.mse_loss(pred.float(), target.float())
