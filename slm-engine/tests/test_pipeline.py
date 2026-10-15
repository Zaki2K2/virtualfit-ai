import copy
import json
from pathlib import Path

import pytest

from virtualfit_slm.data import load_records, validate_splits
from virtualfit_slm.evaluate import score
from virtualfit_slm.train import attach_lora, encode_record, train

ROOT = Path(__file__).resolve().parents[1]


def test_seed_splits_are_valid_and_disjoint():
    assert validate_splits(ROOT / "data") == {"train": 32, "validation": 8, "test": 8}


def test_hallucinated_training_target_rejected(tmp_path):
    row = copy.deepcopy(load_records(ROOT / "data/train.jsonl")[0])
    output = json.loads(row["messages"][-1]["content"])
    output["itemIds"] = ["not-in-wardrobe"]
    row["messages"][-1]["content"] = json.dumps(output)
    file = tmp_path / "bad.jsonl"
    file.write_text(json.dumps(row))
    with pytest.raises(ValueError, match="Ungrounded"):
        load_records(file)


class Tokenizer:
    def apply_chat_template(self, messages, tokenize=True, add_generation_prompt=False, return_dict=False):
        if len(messages) == 2: return [1, 2, 3]
        return [1, 2, 3, 4, 5, 6]


def test_assistant_only_labels_and_no_silent_truncation():
    row = load_records(ROOT / "data/train.jsonl")[0]
    result = encode_record(Tokenizer(), row, 10)
    assert result["labels"] == [-100, -100, -100, 4, 5, 6]
    with pytest.raises(ValueError, match="exceeds"):
        encode_record(Tokenizer(), row, 4)


def test_evaluation_counts_invented_and_missing_ids():
    expected = {"itemIds": ["a", "b"], "categories": ["tops"]}
    actual = {"itemIds": ["a", "invented"], "categories": ["tops"]}
    result = score(expected, actual)
    assert result["precision"] == 0.5
    assert result["recall"] == 0.5
    assert not result["exact_ids"]
    assert result["categories_exact"]


def test_actual_cpu_lora_optimizer_steps_on_tiny_random_model():
    torch = pytest.importorskip("torch")
    from transformers import Qwen2Config, Qwen2ForCausalLM
    torch.manual_seed(42)
    base = Qwen2ForCausalLM(Qwen2Config(vocab_size=64, hidden_size=32, intermediate_size=64,
        num_hidden_layers=1, num_attention_heads=4, num_key_value_heads=2, max_position_embeddings=64))
    model = attach_lora(base, {"rank": 2, "alpha": 4, "target_modules": ["q_proj", "v_proj"]})
    before = {n: p.detach().clone() for n, p in model.named_parameters()}
    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=0.01)
    for _ in range(2):
        optimizer.zero_grad()
        tokens = torch.tensor([[1, 2, 3, 4, 5, 6]])
        labels = tokens.clone()
        labels[:, :3] = -100
        loss = model(input_ids=tokens, attention_mask=torch.ones_like(tokens), labels=labels).loss
        assert torch.isfinite(loss)
        loss.backward()
        optimizer.step()
    changed = [n for n, p in model.named_parameters() if not torch.equal(before[n], p)]
    assert changed and all("lora_" in n for n in changed)
    assert not any(p.requires_grad for n, p in model.named_parameters() if "lora_" not in n)


def test_all_examples_with_real_pinned_tokenizer_when_cached():
    from transformers import AutoTokenizer
    config = json.loads((ROOT / "configs/lora.json").read_text())
    try:
        tokenizer = AutoTokenizer.from_pretrained(config["base_model"], revision=config["revision"], local_files_only=True)
    except OSError:
        pytest.skip("Pinned tokenizer is not cached; this test never downloads model assets")
    for split in ["train", "validation", "test"]:
        for row in load_records(ROOT / "data" / f"{split}.jsonl") + load_records(ROOT / "data/training-v2" / f"{split}.jsonl"):
            encoded = encode_record(tokenizer, row, config["max_length"])
            labels = encoded["labels"]
            assert labels[0] == -100 and labels[-1] != -100
            assert len(labels) == len(encoded["input_ids"])
            assert 'itemIds' in tokenizer.decode([token for token in labels if token != -100])


def test_real_training_refuses_cpu_before_downloading_weights(monkeypatch):
    import torch
    monkeypatch.setattr(torch.cuda, 'is_available', lambda: False)
    with pytest.raises(RuntimeError, match="cloud CUDA GPU"):
        train({})


def test_colab_notebook_structure_and_python_cells():
    nbformat = pytest.importorskip('nbformat')
    notebook = nbformat.read(ROOT / 'notebooks/01_fashion_lora_colab.ipynb', as_version=4)
    nbformat.validate(notebook)
    for cell in notebook.cells:
        if cell.cell_type == 'code': compile(cell.source, 'colab-cell', 'exec')
    assert 'not been executed' in notebook.cells[0].source
