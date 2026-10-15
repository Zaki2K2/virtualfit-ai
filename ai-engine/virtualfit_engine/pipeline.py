"""Try-on sampling loop (a port of the reference `CatVTONPipeline.__call__`, CC BY-NC-SA 4.0).

Kept deliberately close to the reference so results are comparable; the `tests` compare it against
the reference implementation on a tiny random model when a CatVTON checkout is available.
"""

from __future__ import annotations

import inspect

import numpy as np
import torch
from diffusers.utils.torch_utils import randn_tensor
from PIL import Image

from .arch import CONCAT_DIM, build_conditioning
from .preprocessing import image_to_array, mask_to_array, prepare_inputs


def encode_vae(image: torch.Tensor, vae) -> torch.Tensor:
    """Posterior sample * scaling factor (identical to the reference `compute_vae_encodings`)."""
    pixel_values = image.to(memory_format=torch.contiguous_format).float().to(vae.device, dtype=vae.dtype)
    with torch.no_grad():
        latents = vae.encode(pixel_values).latent_dist.sample()
    return latents * vae.config.scaling_factor


def _to_tensor(arr: np.ndarray, device, dtype) -> torch.Tensor:
    return torch.from_numpy(arr).unsqueeze(0).to(device, dtype=dtype)


class TryOnPipeline:
    def __init__(self, unet, vae, scheduler, device="cuda", dtype=torch.float16):
        self.unet, self.vae, self.scheduler = unet, vae, scheduler
        self.device, self.dtype = device, dtype

    @torch.no_grad()
    def __call__(
        self,
        person: Image.Image,
        garment: Image.Image,
        mask: Image.Image,
        num_inference_steps: int = 50,
        guidance_scale: float = 2.5,
        height: int = 512,
        width: int = 384,
        generator: torch.Generator | None = None,
        eta: float = 1.0,
    ) -> Image.Image:
        inputs = prepare_inputs(person, garment, mask, width, height)
        person_t = _to_tensor(image_to_array(inputs.person), self.device, self.dtype)
        garment_t = _to_tensor(image_to_array(inputs.garment), self.device, self.dtype)
        mask_t = _to_tensor(mask_to_array(inputs.mask), self.device, self.dtype)

        masked_latent = encode_vae(person_t * (mask_t < 0.5), self.vae)
        garment_latent = encode_vae(garment_t, self.vae)
        mask_latent = torch.nn.functional.interpolate(mask_t, size=masked_latent.shape[-2:], mode="nearest")

        mask_concat, masked_concat = build_conditioning(masked_latent, garment_latent, mask_latent)
        latents = randn_tensor(
            masked_concat.shape, generator=generator, device=masked_concat.device, dtype=self.dtype
        )

        self.scheduler.set_timesteps(num_inference_steps, device=self.device)
        timesteps = self.scheduler.timesteps
        latents = latents * self.scheduler.init_noise_sigma

        use_cfg = guidance_scale > 1.0
        if use_cfg:
            uncond_mask, uncond_masked = build_conditioning(
                masked_latent, garment_latent, mask_latent,
                drop_garment=torch.ones(1, dtype=torch.bool, device=masked_concat.device),
            )
            masked_concat = torch.cat([uncond_masked, masked_concat])
            mask_concat = torch.cat([mask_concat, mask_concat])

        step_params = set(inspect.signature(self.scheduler.step).parameters)
        extra = {}
        if "eta" in step_params:
            extra["eta"] = eta
        if "generator" in step_params:
            extra["generator"] = generator

        for t in timesteps:
            model_input = torch.cat([latents] * 2) if use_cfg else latents
            model_input = self.scheduler.scale_model_input(model_input, t)
            model_input = torch.cat([model_input, mask_concat, masked_concat], dim=1)
            noise_pred = self.unet(model_input, t.to(self.device), encoder_hidden_states=None, return_dict=False)[0]
            if use_cfg:
                uncond, cond = noise_pred.chunk(2)
                noise_pred = uncond + guidance_scale * (cond - uncond)
            latents = self.scheduler.step(noise_pred, t, latents, **extra).prev_sample

        person_latent = latents.split(latents.shape[CONCAT_DIM] // 2, dim=CONCAT_DIM)[0]
        decoded = self.vae.decode((person_latent / self.vae.config.scaling_factor).to(self.device, dtype=self.dtype)).sample
        decoded = (decoded / 2 + 0.5).clamp(0, 1)
        arr = (decoded.cpu().permute(0, 2, 3, 1).float().numpy()[0] * 255).round().astype(np.uint8)
        return Image.fromarray(arr)
