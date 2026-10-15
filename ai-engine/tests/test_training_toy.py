"""CPU tests of the training code path with TINY RANDOMLY INITIALISED models.

What these prove: shapes/conditioning are consistent, a real forward+backward+optimizer step runs,
only LoRA parameters change, checkpoints save/resume/reload to identical weights, and toy runs are
flagged as non-genuine. What they do NOT prove: anything about the real CatVTON model or quality.
"""

import json

import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("diffusers")
pytest.importorskip("peft")

from conftest import tiny_models
from virtualfit_engine.dataset.viton_hd import build_records, write_manifest
from virtualfit_engine.models import inspect_adapter
from virtualfit_engine.training.checkpoints import (
    find_latest_checkpoint,
    is_genuine_finetune,
    list_checkpoints,
    read_adapter_metadata,
)
from virtualfit_engine.training.config import TrainConfig
from virtualfit_engine.training.lora import adapter_state_dict, attach_lora, load_adapter_state, make_lora_config
from virtualfit_engine.training.objective import compute_loss
from virtualfit_engine.training.train import ModelBundle, run_training

pytestmark = pytest.mark.torch


def _latents(bsz=2):
    g = torch.Generator().manual_seed(7)
    r = lambda c, h=8, w=6: torch.randn(bsz, c, h, w, generator=g)
    mask = (torch.rand(bsz, 1, 8, 6, generator=g) > 0.5).float()
    return dict(person_latent=r(4), masked_latent=r(4), garment_latent=r(4), mask_latent=mask)


@pytest.fixture
def cfg_factory(tmp_path, viton_tree):
    train, _ = build_records(viton_tree, "train")
    write_manifest(tmp_path / "train.jsonl", train[:8])
    write_manifest(tmp_path / "val.jsonl", train[8:12])

    def make(**kw):
        base = dict(
            dataset_root=str(viton_tree),
            train_manifest=str(tmp_path / "train.jsonl"),
            val_manifest=str(tmp_path / "val.jsonl"),
            height=64, width=48, lora_rank=4, lora_alpha=4, learning_rate=1e-2,
            batch_size=2, grad_accum=1, max_steps=1, warmup_steps=1,
            mixed_precision="no", gradient_checkpointing=False, force_cpu=True, num_workers=0,
            output_dir=str(tmp_path / "run"), save_every=0, val_every=0, val_batches=2,
            sample_count=0, sample_steps=2,
        )
        base.update(kw)
        return TrainConfig(**base)

    return make


def _bundle():
    unet, vae, sched = tiny_models()
    return ModelBundle(unet, vae, sched, pretrained=False, attention_loaded=False)


def test_loss_is_finite_in_both_noise_modes_and_trains_only_lora():
    unet, _, sched = tiny_models()
    params = attach_lora(unet, make_lora_config(4, 4))
    assert 0 < sum(p.numel() for p in params) < 0.2 * sum(p.numel() for p in unet.parameters())
    for noise_cond in (True, False):
        unet.zero_grad()
        loss = compute_loss(unet, sched, **_latents(), enable_condition_noise=noise_cond, condition_dropout=0.5, generator=torch.Generator().manual_seed(1))
        assert loss.ndim == 0 and torch.isfinite(loss)
        loss.backward()
        graded = {n for n, p in unet.named_parameters() if p.grad is not None and p.grad.abs().sum() > 0}
        assert graded and all("lora" in n for n in graded), "gradients must reach LoRA weights only"
        assert all("attn1" in n for n in graded), "LoRA must sit on self-attention layers"


def test_lora_is_identity_at_initialisation():
    unet, _, _ = tiny_models()
    x, t = torch.randn(1, 9, 16, 12), torch.tensor([10])
    with torch.no_grad():
        before = unet(x, t, encoder_hidden_states=None).sample
    attach_lora(unet, make_lora_config(4, 4))
    with torch.no_grad():
        after = unet(x, t, encoder_hidden_states=None).sample
    assert torch.allclose(before, after, atol=1e-6)


def test_cross_attention_is_skipped_so_no_text_embedding_is_needed():
    unet, _, sched = tiny_models()
    loss = compute_loss(unet, sched, **_latents(), generator=torch.Generator().manual_seed(0))
    assert torch.isfinite(loss)  # would raise if attn2 tried to use encoder_hidden_states=None


def test_single_optimizer_step_updates_only_lora_and_is_marked_non_genuine(cfg_factory):
    bundle = _bundle()
    frozen_before = {n: p.detach().clone() for n, p in bundle.unet.named_parameters()}
    result = run_training(cfg_factory(max_steps=1), bundle)

    meta = result["metadata"]
    assert result["global_step"] == meta["optimizer_steps_completed"] == 1
    assert meta["completed"] and meta["final_val_loss"] is not None
    assert meta["pretrained_weights_loaded"] is False
    assert not is_genuine_finetune(meta), "a toy run must never count as the VirtualFit model"

    changed = []
    for n, p in bundle.unet.named_parameters():
        if n in frozen_before:
            if not torch.equal(p.detach(), frozen_before[n]):
                changed.append(n)
    assert not changed, f"frozen base weights changed: {changed[:3]}"
    lora_b = [p for n, p in bundle.unet.named_parameters() if "lora_B" in n]
    assert lora_b and any(p.abs().sum() > 0 for p in lora_b), "optimizer did not update LoRA B (init is zero)"

    adapter = result["adapter_dir"]
    assert (json.loads(open(f"{adapter}/metadata.json").read()))["optimizer_steps_completed"] == 1
    usable, reason, _ = inspect_adapter(adapter)
    assert not usable and "fine-tune" in reason


def test_checkpoint_save_resume_and_reload_identical_weights(cfg_factory, tmp_path):
    # run A: 2 steps then stop (checkpoint at step 2 is also the final one)
    cfg_a = cfg_factory(max_steps=2, save_every=1, keep_checkpoints=5)
    bundle_a = _bundle()
    run_training(cfg_a, bundle_a)
    ckpts = list_checkpoints(cfg_a.output_dir)
    assert [c.name for c in ckpts] == ["checkpoint-1", "checkpoint-2"]
    assert find_latest_checkpoint(cfg_a.output_dir).name == "checkpoint-2"

    # run B: resume from step 2 and continue to step 3
    bundle_b = _bundle()
    result_b = run_training(cfg_factory(max_steps=3, resume="latest", save_every=1, keep_checkpoints=5), bundle_b)
    assert result_b["global_step"] == 3
    steps = [json.loads(line)["step"] for line in open(f"{cfg_a.output_dir}/metrics.jsonl") if '"loss"' in line]
    assert steps == [1, 2, 3], "resumed run must continue the step counter, not restart"
    assert len(result_b["metadata"]["loss_history"]) == 3

    # reload the released adapter into a fresh model: outputs must match the trained model exactly
    unet2, _, _ = tiny_models()
    cfg_json = json.loads(open(f"{result_b['adapter_dir']}/adapter_config.json").read())
    attach_lora(unet2, cfg_json)
    from safetensors.torch import load_file

    load_adapter_state(unet2, load_file(f"{result_b['adapter_dir']}/adapter.safetensors"))
    x, t = torch.randn(1, 9, 16, 12), torch.tensor([20])
    with torch.no_grad():
        out_trained = bundle_b.unet(x, t, encoder_hidden_states=None).sample
        out_reloaded = unet2(x, t, encoder_hidden_states=None).sample
    assert torch.allclose(out_trained, out_reloaded, atol=1e-5)
    # ... and differs from the untouched baseline (the adapter really changes the model)
    base, _, _ = tiny_models()
    with torch.no_grad():
        assert not torch.allclose(base(x, t, encoder_hidden_states=None).sample, out_reloaded, atol=1e-4)


def test_training_with_gradient_checkpointing_and_validation_samples(cfg_factory):
    bundle = _bundle()
    result = run_training(cfg_factory(max_steps=2, grad_accum=2, gradient_checkpointing=True, val_every=1, sample_count=1), bundle)
    assert result["global_step"] == 2
    assert len(result["samples"]) == 1
    assert read_adapter_metadata(result["adapter_dir"])["trainable_parameters"] > 0


def test_non_finite_loss_stops_training(cfg_factory, monkeypatch):
    import virtualfit_engine.training.train as train_mod

    monkeypatch.setattr(train_mod, "compute_loss", lambda *a, **k: torch.tensor(float("nan"), requires_grad=True))
    with pytest.raises(FloatingPointError):
        run_training(cfg_factory(), _bundle())


def test_adapter_state_keys_are_lora_only():
    unet, _, _ = tiny_models()
    attach_lora(unet, make_lora_config(4, 4))
    assert adapter_state_dict(unet) and all("lora" in k for k in adapter_state_dict(unet))


def test_config_validation():
    with pytest.raises(ValueError, match="multiples of 8"):
        TrainConfig(dataset_root="x", train_manifest="a", val_manifest="b", height=65)
