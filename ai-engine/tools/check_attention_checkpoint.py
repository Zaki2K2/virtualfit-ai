"""Verifies that our UNet surgery lines up with CatVTON's RELEASED attention checkpoint.

Downloads only the ~189 MB attention weights (+ a tiny UNet config); the multi-GB Stable Diffusion
weights are NOT needed: the UNet is built with random weights because only its structure matters.
Run it once on any machine (about 3.5 GB RAM):

    python tools/check_attention_checkpoint.py [--version vitonhd|mix|dresscode]

Exit code 0 only if every checkpoint tensor maps onto a module of the same shape and, after loading,
every tensor equals the checkpoint. This catches silent mis-loading (wrong module order) that
unit tests on tiny models cannot.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import torch
from diffusers import UNet2DConditionModel
from huggingface_hub import hf_hub_download
from safetensors.torch import load_file

from virtualfit_engine.arch import attention_modules, load_attention_checkpoint, prepare_unet
from virtualfit_engine.training.config import ATTN_SUBFOLDERS
from virtualfit_engine.training.lora import attach_lora, count_parameters, make_lora_config


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="vitonhd", choices=sorted(ATTN_SUBFOLDERS))
    ap.add_argument("--repo", default="zhengchong/CatVTON")
    ap.add_argument("--base", default="booksforcharlie/stable-diffusion-inpainting")
    args = ap.parse_args()

    cfg = UNet2DConditionModel.load_config(args.base, subfolder="unet")
    unet = UNet2DConditionModel.from_config(cfg)  # random weights
    prepare_unet(unet)
    total = sum(p.numel() for p in unet.parameters())
    print(f"UNet: {total / 1e6:.1f}M parameters, in_channels={cfg['in_channels']}")

    sub = ATTN_SUBFOLDERS[args.version]
    file = hf_hub_download(args.repo, f"{sub}/attention/model.safetensors")
    ckpt = load_file(file)
    modules = attention_modules(unet)
    state = modules.state_dict()
    print(f"checkpoint: {len(ckpt)} tensors | module list: {len(modules)} modules")

    missing = [k for k in ckpt if k not in state]
    wrong_shape = [k for k in ckpt if k in state and tuple(ckpt[k].shape) != tuple(state[k].shape)]
    problems = []
    if missing:
        problems.append(f"{len(missing)} checkpoint keys have no matching module (e.g. {missing[:3]})")
    if wrong_shape:
        problems.append(f"{len(wrong_shape)} tensors have mismatching shapes (e.g. {wrong_shape[:3]})")
    if problems:
        print("FAIL:", *problems, sep="\n  ")
        return 1

    before = {k: state[k].clone() for k in ckpt}
    load_attention_checkpoint(unet, str(Path(file).parent))
    after = modules.state_dict()
    equal = sum(torch.equal(after[k], ckpt[k].to(after[k].dtype)) for k in ckpt)
    changed = sum(not torch.equal(after[k], before[k]) for k in ckpt)
    print(f"tensors equal to checkpoint after loading: {equal}/{len(ckpt)} (changed vs random init: {changed})")
    if equal != len(ckpt):
        print("FAIL: weights were not loaded into the expected layers")
        return 1

    unique = {id(p): p.numel() for m in modules for p in m.parameters()}
    print(f"self-attention (attn1) parameters: {sum(unique.values()) / 1e6:.2f}M (CatVTON reports 49.57M trainable)")
    lora = attach_lora(unet, make_lora_config(16, 16))
    print(f"LoRA r=16 trainable parameters: {count_parameters(lora) / 1e6:.2f}M ({100 * count_parameters(lora) / total:.2f}% of the UNet)")
    print("OK: the engine loads the released attention weights into the correct layers.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
