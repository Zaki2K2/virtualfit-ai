import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("diffusers")

from conftest import tiny_models
from virtualfit_engine.arch import SelfAttnProcessor, SkipAttnProcessor, attention_modules

pytestmark = pytest.mark.torch


def test_attention_module_list_has_the_reference_stride_of_eight():
    """Released checkpoints index modules as 0, 8, 16, ... (verified against the real checkpoint:
    its keys are '8.to_q.weight', '16.to_q.weight', ...). A different stride loads weights into the
    wrong layers without raising."""
    unet, _, _ = tiny_models()
    mods = attention_modules(unet)
    n_blocks = sum(1 for n in unet.attn_processors if n.endswith("attn1.processor"))
    assert len(mods) == 8 * n_blocks
    for i in range(n_blocks):
        assert type(mods[8 * i]).__name__ == "Attention"
        assert {"to_q", "to_k", "to_v", "to_out"} <= set(dict(mods[8 * i].named_children()))
    # every tensor key an attention checkpoint can contain is '<8k>.<param>'
    owners = {int(k.split(".")[0]) for k in mods.state_dict() if not k.split(".")[0] == "" and k.split(".")[1] in {"to_q", "to_k", "to_v", "to_out"}}
    assert all(i % 8 == 0 for i in owners)


def test_processors_are_swapped_as_in_the_reference():
    unet, _, _ = tiny_models()
    for name, proc in unet.attn_processors.items():
        assert isinstance(proc, SelfAttnProcessor if name.endswith("attn1.processor") else SkipAttnProcessor), name
