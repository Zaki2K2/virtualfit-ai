"""CatVTON parameter-efficient fine-tuning.

    python -m virtualfit_engine.training.train --config configs/finetune_catvton_lora.yaml --smoke
    python -m virtualfit_engine.training.train --config configs/finetune_catvton_lora.yaml
    python -m virtualfit_engine.training.train --config ... --resume latest   # after a disconnect

`--smoke` runs exactly ONE optimizer step (forward, backward, update, save, reload) before you
commit GPU time to a longer run.
"""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from .. import __version__
from ..arch import load_attention_checkpoint, prepare_unet
from ..dataset.viton_hd import manifest_sha256, read_manifest
from ..pipeline import TryOnPipeline, encode_vae
from ..postprocessing import repaint
from .checkpoints import (
    find_latest_checkpoint,
    load_training_checkpoint,
    save_training_checkpoint,
    write_adapter_release,
)
from .config import TrainConfig
from .data import TryOnTrainDataset, load_record_mask
from .lora import (
    adapter_state_dict,
    attach_lora,
    count_parameters,
    load_adapter_state,
    make_lora_config,
    select_attention_params,
)
from .objective import compute_loss

DTYPES = {"no": torch.float32, "fp16": torch.float16, "bf16": torch.bfloat16}


@dataclass
class ModelBundle:
    unet: torch.nn.Module
    vae: torch.nn.Module
    noise_scheduler: object  # DDPM-style scheduler with add_noise()
    pretrained: bool  # real pretrained base weights were loaded (False for injected test models)
    attention_loaded: bool  # released CatVTON attention weights were loaded
    info: dict = field(default_factory=dict)


def load_pretrained_bundle(cfg: TrainConfig, device: torch.device, dtype: torch.dtype) -> ModelBundle:
    """Download/load the real pretrained weights. Needs network + several GB; run on a cloud GPU."""
    from diffusers import AutoencoderKL, DDPMScheduler, UNet2DConditionModel
    from huggingface_hub import snapshot_download

    unet = UNet2DConditionModel.from_pretrained(cfg.base_model, subfolder="unet")
    prepare_unet(unet)
    attn_root = Path(cfg.attn_repo)
    if not attn_root.exists():
        attn_root = Path(snapshot_download(repo_id=cfg.attn_repo, allow_patterns=[f"{cfg.attn_subfolder}/attention/*"]))
    attn_dir = attn_root / cfg.attn_subfolder / "attention"
    if not attn_dir.exists():
        raise FileNotFoundError(f"attention checkpoint not found: {attn_dir}")
    load_attention_checkpoint(unet, str(attn_dir))
    vae = AutoencoderKL.from_pretrained(cfg.vae_model)
    scheduler = DDPMScheduler.from_pretrained(cfg.base_model, subfolder="scheduler")
    return ModelBundle(
        unet.to(device, dtype=dtype),
        vae.to(device, dtype=dtype),
        scheduler,
        pretrained=True,
        attention_loaded=True,
        info={"attention_checkpoint": str(attn_dir)},
    )


def _batch_latents(batch: dict, vae, device, dtype) -> dict[str, torch.Tensor]:
    person = batch["person"].to(device, dtype=dtype)
    garment = batch["garment"].to(device, dtype=dtype)
    mask = batch["mask"].to(device, dtype=dtype)
    with torch.no_grad():
        person_latent = encode_vae(person, vae)
        masked_latent = encode_vae(person * (mask < 0.5), vae)
        garment_latent = encode_vae(garment, vae)
    mask_latent = torch.nn.functional.interpolate(mask, size=masked_latent.shape[-2:], mode="nearest")
    return {
        "person_latent": person_latent,
        "masked_latent": masked_latent,
        "garment_latent": garment_latent,
        "mask_latent": mask_latent,
    }


@torch.no_grad()
def validate(unet, bundle: ModelBundle, loader: DataLoader, cfg: TrainConfig, device, dtype) -> float:
    """Mean loss on the validation set with fixed noise/timesteps (comparable across checkpoints)."""
    was_training = unet.training
    unet.eval()
    gen = torch.Generator().manual_seed(1234)
    losses = []
    for i, batch in enumerate(loader):
        if i >= cfg.val_batches:
            break
        lat = _batch_latents(batch, bundle.vae, device, dtype)
        loss = compute_loss(
            unet, bundle.noise_scheduler, **lat,
            enable_condition_noise=cfg.enable_condition_noise, condition_dropout=0.0, generator=gen,
        )
        losses.append(loss.item())
    unet.train(was_training)
    return float(sum(losses) / max(1, len(losses)))


def _sample_images(unet, bundle: ModelBundle, records, cfg: TrainConfig, device, dtype, out_dir: Path) -> list[str]:
    """Generate a few validation try-ons with the trained weights (visual sanity check)."""
    from diffusers import DDIMScheduler
    from PIL import Image

    out_dir.mkdir(parents=True, exist_ok=True)
    pipe = TryOnPipeline(unet, bundle.vae, DDIMScheduler.from_config(bundle.noise_scheduler.config), device, dtype)
    root = Path(cfg.dataset_root)
    paths = []
    for r in records[: cfg.sample_count]:
        person = Image.open(root / r.person).convert("RGB")
        cloth = Image.open(root / r.cloth).convert("RGB")
        mask = load_record_mask(root, r)
        gen = torch.Generator(device="cpu").manual_seed(cfg.seed)
        result = pipe(person, cloth, mask, cfg.sample_steps, 2.5, cfg.height, cfg.width, gen)
        result = repaint(person.resize(result.size), mask.resize(result.size, Image.NEAREST), result)
        sheet = Image.new("RGB", (result.width * 3, result.height))
        for k, im in enumerate((person.resize(result.size), cloth.resize(result.size), result)):
            sheet.paste(im, (k * result.width, 0))
        p = out_dir / f"{r.id}.png"
        sheet.save(p)
        paths.append(str(p))
    return paths


def run_training(cfg: TrainConfig, bundle: ModelBundle | None = None) -> dict:
    """Runs the experiment and returns a result dict. A real optimizer step is only reported when
    `optimizer.step()` actually executed `optimizer_steps_completed` times."""
    from accelerate import Accelerator
    from accelerate.utils import set_seed

    out = Path(cfg.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "config.json").write_text(cfg.model_dump_json(indent=2), encoding="utf-8")
    set_seed(cfg.seed)

    accelerator = Accelerator(
        mixed_precision=cfg.mixed_precision,
        gradient_accumulation_steps=cfg.grad_accum,
        cpu=cfg.force_cpu or not torch.cuda.is_available(),
    )
    device = accelerator.device
    dtype = DTYPES[cfg.mixed_precision]
    if device.type == "cpu" and cfg.mixed_precision != "no":
        raise RuntimeError("mixed precision needs a GPU; use mixed_precision: 'no' on CPU")

    if bundle is None:
        bundle = load_pretrained_bundle(cfg, device, dtype)
    unet = bundle.unet

    # ---- trainable parameters (everything else stays frozen) ----
    lora_cfg = make_lora_config(cfg.lora_rank, cfg.lora_alpha)
    trainable = attach_lora(unet, lora_cfg) if cfg.method == "lora" else select_attention_params(unet)
    bundle.vae.requires_grad_(False)
    n_trainable, n_total = count_parameters(trainable), sum(p.numel() for p in unet.parameters())
    if cfg.gradient_checkpointing:
        unet.enable_gradient_checkpointing()
    unet.train()

    if cfg.use_8bit_adam:
        import bitsandbytes as bnb

        optimizer = bnb.optim.AdamW8bit(trainable, lr=cfg.learning_rate)
    else:
        optimizer = torch.optim.AdamW(trainable, lr=cfg.learning_rate, weight_decay=1e-2)
    lr_scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lambda s: min(1.0, (s + 1) / max(1, cfg.warmup_steps)))

    # ---- data ----
    train_records = read_manifest(Path(cfg.train_manifest))
    val_records = read_manifest(Path(cfg.val_manifest))
    manifest_hash = manifest_sha256(train_records)
    train_ds = TryOnTrainDataset(train_records, cfg.dataset_root, cfg.width, cfg.height)
    val_ds = TryOnTrainDataset(val_records, cfg.dataset_root, cfg.width, cfg.height)
    val_loader = DataLoader(val_ds, batch_size=cfg.batch_size, shuffle=False, num_workers=cfg.num_workers)

    # ---- resume ----
    global_step, start_epoch, start_batch, history = 0, 0, 0, []
    resume_dir = find_latest_checkpoint(out) if cfg.resume == "latest" else (Path(cfg.resume) if cfg.resume else None)
    if resume_dir is not None:
        ckpt = load_training_checkpoint(resume_dir)
        if cfg.method == "lora":
            load_adapter_state(unet, {k: v.to(device) for k, v in ckpt["adapter_state"].items()})
        optimizer.load_state_dict(ckpt["optimizer"])
        lr_scheduler.load_state_dict(ckpt["scheduler"])
        st = ckpt["state"]
        global_step, start_epoch, start_batch, history = st["global_step"], st["epoch"], st["batch_in_epoch"], st["history"]
        print(f"resumed from {resume_dir} at step {global_step}")

    unet, optimizer, lr_scheduler = accelerator.prepare(unet, optimizer, lr_scheduler)
    metrics_path = out / "metrics.jsonl"
    started = time.time()
    last_val = None

    epoch = start_epoch
    while global_step < cfg.max_steps:
        g = torch.Generator().manual_seed(cfg.seed + epoch)
        loader = DataLoader(train_ds, batch_size=cfg.batch_size, shuffle=True, generator=g, num_workers=cfg.num_workers)
        for i, batch in enumerate(loader):
            if epoch == start_epoch and i < start_batch:
                continue  # already consumed before the checkpoint we resumed from
            step_gen = torch.Generator().manual_seed(cfg.seed * 1_000_003 + global_step * 997 + i)
            with accelerator.accumulate(unet):
                lat = _batch_latents(batch, bundle.vae, device, dtype)
                loss = compute_loss(
                    unet, bundle.noise_scheduler, **lat,
                    enable_condition_noise=cfg.enable_condition_noise,
                    condition_dropout=cfg.condition_dropout, generator=step_gen,
                )
                if not torch.isfinite(loss):
                    raise FloatingPointError(f"non-finite loss at step {global_step}")
                accelerator.backward(loss)
                if accelerator.sync_gradients:
                    accelerator.clip_grad_norm_(trainable, cfg.max_grad_norm)
                optimizer.step()
                lr_scheduler.step()
                optimizer.zero_grad(set_to_none=True)

            if accelerator.sync_gradients:
                global_step += 1
                history.append(loss.item())
                row = {"step": global_step, "loss": history[-1], "lr": lr_scheduler.get_last_lr()[0], "elapsed_s": round(time.time() - started, 1)}
                if device.type == "cuda":
                    row["peak_gpu_mem_gb"] = round(torch.cuda.max_memory_allocated() / 1024**3, 2)
                with metrics_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(row) + "\n")
                print(row)

                if cfg.val_every and global_step % cfg.val_every == 0:
                    last_val = validate(unet, bundle, val_loader, cfg, device, dtype)
                    print(f"  val_loss={last_val:.5f}")
                    with metrics_path.open("a", encoding="utf-8") as f:
                        f.write(json.dumps({"step": global_step, "val_loss": last_val}) + "\n")
                if cfg.save_every and global_step % cfg.save_every == 0 and global_step < cfg.max_steps:
                    _save(out, cfg, lora_cfg, accelerator.unwrap_model(unet), optimizer, lr_scheduler, global_step, epoch, i + 1, history)
            if global_step >= cfg.max_steps:
                break
        epoch += 1

    unet = accelerator.unwrap_model(unet)
    last_val = validate(unet, bundle, val_loader, cfg, device, dtype)
    _save(out, cfg, lora_cfg, unet, optimizer, lr_scheduler, global_step, epoch, 0, history)

    sample_paths = []
    if cfg.sample_count > 0 and cfg.method == "lora":
        sample_paths = _sample_images(unet, bundle, val_records, cfg, device, dtype, out / "samples")

    metadata = {
        "format": 1,
        "package_version": __version__,
        "completed": True,
        "method": cfg.method,
        "base_model": cfg.base_model,
        "vae_model": cfg.vae_model,
        "attn_repo": cfg.attn_repo,
        "attn_version": cfg.attn_version,
        "pretrained_weights_loaded": bundle.pretrained,
        "attention_checkpoint_loaded": bundle.attention_loaded,
        "optimizer_steps_completed": global_step,
        "trainable_parameters": n_trainable,
        "total_unet_parameters": n_total,
        "lora": {"rank": cfg.lora_rank, "alpha": cfg.lora_alpha},
        "resolution_hw": [cfg.height, cfg.width],
        "dataset": {"name": "VITON-HD", "n_train": len(train_records), "n_val": len(val_records), "train_manifest_sha256": manifest_hash},
        "final_train_loss": history[-1] if history else None,
        "final_val_loss": last_val,
        "loss_history": history[:: max(1, len(history) // 200)],
        "seed": cfg.seed,
        "torch": torch.__version__,
        "device": str(device) + (f" ({torch.cuda.get_device_name(0)})" if device.type == "cuda" else ""),
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "config": json.loads(cfg.model_dump_json()),
    }
    adapter_dir = out / "adapter"
    if cfg.method == "lora":
        write_adapter_release(adapter_dir, adapter_state_dict(unet), lora_cfg, metadata)
    else:
        (out / "adapter").mkdir(exist_ok=True)
        (out / "adapter" / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return {"global_step": global_step, "final_val_loss": last_val, "adapter_dir": str(adapter_dir), "samples": sample_paths, "metadata": metadata}


def _save(out, cfg, lora_cfg, unet, optimizer, lr_scheduler, step, epoch, batch_in_epoch, history):
    if cfg.method != "lora":
        raise NotImplementedError("checkpointing is implemented for method=lora")
    state = {"global_step": step, "epoch": epoch, "batch_in_epoch": batch_in_epoch, "history": history}
    return save_training_checkpoint(out, step, adapter_state_dict(unet), lora_cfg, optimizer, lr_scheduler, state, cfg.keep_checkpoints)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="virtualfit-train")
    p.add_argument("--config", required=True)
    p.add_argument("--smoke", action="store_true", help="run exactly one optimizer step")
    p.add_argument("--resume", default=None, help="'latest' or a checkpoint directory")
    p.add_argument("--output-dir", default=None)
    p.add_argument("--max-steps", type=int, default=None)
    args = p.parse_args(argv)
    cfg = TrainConfig.from_yaml(args.config, resume=args.resume, output_dir=args.output_dir, max_steps=args.max_steps)
    if args.smoke:
        cfg = cfg.model_copy(update={"max_steps": 1, "grad_accum": 1, "val_every": 0, "save_every": 0, "val_batches": 2, "sample_count": 0, "warmup_steps": 1})
    result = run_training(cfg)
    print(json.dumps({k: v for k, v in result.items() if k != "metadata"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
