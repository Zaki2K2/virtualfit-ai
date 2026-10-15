"""Merge a real trained adapter. GGUF conversion/quantization remains a llama.cpp step."""
import argparse
import json
from pathlib import Path


def merge(adapter, output):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel, PeftConfig
    manifest = json.loads((adapter / "training-manifest.json").read_text())
    if manifest.get("optimizer_steps_completed", 0) < 1:
        raise ValueError("Refusing to label an untrained adapter as custom")
    expected = json.loads((Path(__file__).resolve().parents[1]/"configs/lora.json").read_text())
    config = PeftConfig.from_pretrained(adapter)
    if config.base_model_name_or_path != manifest["base_model"] or manifest["base_model"] != expected["base_model"] or manifest["resolved_revision"] != expected["revision"]:
        raise ValueError("Adapter and selected pretrained base/revision are incompatible")
    if not (adapter / "adapter_model.safetensors").is_file(): raise ValueError("Trained adapter weights missing")
    base = AutoModelForCausalLM.from_pretrained(manifest["base_model"], revision=manifest["resolved_revision"],
        torch_dtype=torch.float16, trust_remote_code=False)
    merged = PeftModel.from_pretrained(base, adapter).merge_and_unload()
    merged.save_pretrained(output, safe_serialization=True)
    AutoTokenizer.from_pretrained(adapter, trust_remote_code=False).save_pretrained(output)
    (output / "training-manifest.json").write_text(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("adapter", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    merge(args.adapter, args.output)
