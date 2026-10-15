"""Real CUDA LoRA/optional QLoRA training; CPU smoke tests use only tiny random weights."""
import argparse
import hashlib
import json
import random
from pathlib import Path

from .data import load_records, validate_splits
from .checkpoint import save_checkpoint, resume_checkpoint

ROOT = Path(__file__).resolve().parents[1]


def encode_record(tokenizer, row, max_length):
    messages = row["messages"]
    prefix = tokenizer.apply_chat_template(messages[:-1], tokenize=True, add_generation_prompt=True, return_dict=False)
    full = tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=False, return_dict=False)
    if len(full) > max_length:
        raise ValueError("Training example exceeds max_length; increase it or shorten the example, never silently truncate targets")
    if full[:len(prefix)] != prefix or len(prefix) >= len(full):
        raise ValueError("Chat template has no aligned assistant target")
    return {"input_ids": full, "attention_mask": [1] * len(full), "labels": [-100] * len(prefix) + full[len(prefix):]}


def attach_lora(model, config):
    from peft import LoraConfig, get_peft_model
    return get_peft_model(model, LoraConfig(task_type="CAUSAL_LM", r=config["rank"], lora_alpha=config["alpha"],
        lora_dropout=0.05, bias="none", target_modules=config["target_modules"]))


def train(config, data_root=None, resume=None):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    from peft import prepare_model_for_kbit_training
    if not torch.cuda.is_available():
        raise RuntimeError("Real fine-tuning requires a cloud CUDA GPU. Use the CPU toy tests locally.")
    data_root = Path(data_root or ROOT / config.get("data_dir", "data/training-v2"))
    counts = validate_splits(data_root)
    dataset_hashes = {split: hashlib.sha256((data_root / f"{split}.jsonl").read_bytes()).hexdigest() for split in counts}
    random.seed(config["seed"])
    torch.manual_seed(config["seed"])
    tokenizer = AutoTokenizer.from_pretrained(config["base_model"], revision=config["revision"], trust_remote_code=False)
    tokenizer.pad_token = tokenizer.eos_token
    load_kwargs = dict(revision=config["revision"], trust_remote_code=False, device_map={"": 0}, torch_dtype=torch.float16)
    if config.get("qlora"):
        load_kwargs["quantization_config"] = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.float16)
    base = AutoModelForCausalLM.from_pretrained(config["base_model"], **load_kwargs)
    if config.get("qlora"): base = prepare_model_for_kbit_training(base)
    base.config.use_cache = False
    model = attach_lora(base, config)
    model.print_trainable_parameters()
    train_rows = [encode_record(tokenizer, r, config["max_length"]) for r in load_records(Path(data_root) / "train.jsonl")]
    validation = [encode_record(tokenizer, r, config["max_length"]) for r in load_records(Path(data_root) / "validation.jsonl")]
    optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad), lr=config["learning_rate"])
    scaler = torch.amp.GradScaler("cuda")
    steps = config["max_steps"]
    accum = config["gradient_accumulation"]
    losses = []
    order = list(range(len(train_rows)))
    output = ROOT / config["output_dir"]
    identity = {"base_model": config["base_model"], "revision": config["revision"], "dataset_sha256": dataset_hashes,
        "hyperparameters": {key: config[key] for key in ["rank", "alpha", "target_modules", "learning_rate", "gradient_accumulation", "max_length", "seed", "qlora"]}}
    first_step = 0
    if resume:
        state = resume_checkpoint(model, optimizer, scaler, resume, identity)
        first_step, losses, order = state["step"], state["losses"], state["order"]
        if first_step >= steps: raise ValueError("Resume checkpoint already reached max_steps; increase the target")
    for step in range(first_step, steps):
        model.train()
        optimizer.zero_grad(set_to_none=True)
        loss_value = 0.0
        for micro in range(accum):
            if (step * accum + micro) % len(order) == 0: random.shuffle(order)
            row = train_rows[order[(step * accum + micro) % len(order)]]
            batch = {k: torch.tensor([v], device="cuda") for k, v in row.items()}
            with torch.autocast("cuda", dtype=torch.float16): loss = model(**batch).loss / accum
            if not torch.isfinite(loss): raise RuntimeError("Nonfinite training loss")
            scaler.scale(loss).backward()
            loss_value += loss.item()
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        previous_scale = scaler.get_scale()
        scaler.step(optimizer)
        scaler.update()
        if scaler.get_scale() < previous_scale:
            raise RuntimeError("Optimizer step skipped due to overflow; reduce learning rate before claiming completion")
        losses.append(loss_value)
        print(json.dumps({"optimizer_step": step + 1, "loss": loss_value}), flush=True)
        if (step + 1) % config.get("checkpoint_every", 4) == 0 or step + 1 == steps:
            save_checkpoint(model, optimizer, scaler, output, step + 1, order, losses, identity)
    model.eval()
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.float16):
        validation_loss = sum(model(**{k: torch.tensor([v], device="cuda") for k, v in row.items()}).loss.item() for row in validation) / len(validation)
    import math
    if not math.isfinite(validation_loss): raise RuntimeError("Nonfinite validation loss")
    output.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(output, safe_serialization=True)
    tokenizer.save_pretrained(output)
    manifest = {"base_model": config["base_model"], "resolved_revision": getattr(base.config, "_commit_hash", None),
        "config": config, "optimizer_steps_completed": steps, "training_losses": losses,
        "validation_loss": validation_loss, "dataset_counts": counts,
        "dataset_sha256": dataset_hashes,
        "cuda_device": torch.cuda.get_device_name(0), "torch_version": torch.__version__, "seed_corpus_only": True}
    (output / "training-manifest.json").write_text(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=ROOT / "configs/lora.json")
    parser.add_argument("--qlora", action="store_true")
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--max-steps", type=int)
    parser.add_argument("--output-dir")
    parser.add_argument("--data-dir", type=Path)
    args = parser.parse_args()
    cfg = json.loads(args.config.read_text())
    if args.qlora: cfg["qlora"] = True
    if args.max_steps is not None:
        if args.max_steps < 1: parser.error("--max-steps must be positive")
        cfg["max_steps"] = args.max_steps
    if args.output_dir: cfg["output_dir"] = args.output_dir
    train(cfg, data_root=args.data_dir, resume=args.resume)
