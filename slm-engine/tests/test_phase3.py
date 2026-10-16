import json
from pathlib import Path
import random

import pytest
from virtualfit_slm.data import validate_splits
from virtualfit_slm.checkpoint import save_checkpoint, resume_checkpoint
from virtualfit_slm.train import attach_lora
from virtualfit_slm.register_custom import quality_gate

ROOT = Path(__file__).resolve().parents[1]


def test_training_v2_and_evaluation_are_separate():
    assert validate_splits(ROOT / 'data/training-v2') == {'train': 72, 'validation': 11, 'test': 17}
    scenarios, messages = set(), set()
    for split, count in [('development', 16), ('validation', 16), ('heldout', 102)]:
        rows = [json.loads(line) for line in (ROOT / 'evaluation' / f'{split}.jsonl').read_text().splitlines()]
        assert len(rows) == count
        current = {row['scenario'] for row in rows}
        assert not scenarios & current
        scenarios |= current
        for row in rows:
            assert row['message'] not in messages
            messages.add(row['message'])
    for file in (ROOT / 'data/training-v2').glob('*.jsonl'):
        for line in file.read_text().splitlines():
            row = json.loads(line); context = json.loads(row['messages'][1]['content'])
            assert context['message'] not in messages
            assert all(item['id'].startswith('train-') for item in context['wardrobe'])


def test_real_adapter_checkpoint_resume_matches_uninterrupted_cpu_training(tmp_path):
    import torch
    from transformers import Qwen2Config, Qwen2ForCausalLM
    def setup():
        torch.manual_seed(15); random.seed(15)
        base = Qwen2ForCausalLM(Qwen2Config(vocab_size=32, hidden_size=16, intermediate_size=32,
            num_hidden_layers=1, num_attention_heads=2, num_key_value_heads=1, max_position_embeddings=32))
        model = attach_lora(base, {'rank': 2, 'alpha': 4, 'target_modules': ['q_proj', 'v_proj']})
        return model, torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=0.01), torch.amp.GradScaler('cpu', enabled=False)
    def step(model, optimizer):
        optimizer.zero_grad(); tokens = torch.tensor([[1, 2, 3, 4]])
        loss = model(input_ids=tokens, labels=tokens).loss; loss.backward(); optimizer.step()
        return loss.item()
    model, optimizer, scaler = setup()
    losses = [step(model, optimizer)]
    identity = {'base': 'tiny-random-test-only', 'data_hash': 'test'}
    checkpoint = save_checkpoint(model, optimizer, scaler, tmp_path, 1, [0], losses, identity)
    step(model, optimizer)
    expected = {n: p.detach().clone() for n, p in model.named_parameters() if p.requires_grad}
    other, opt, scale = setup()
    state = resume_checkpoint(other, opt, scale, checkpoint, identity)
    assert state['step'] == 1
    step(other, opt)
    assert all(torch.equal(expected[n], p) for n, p in other.named_parameters() if p.requires_grad)
    with pytest.raises(ValueError, match='do not match'):
        resume_checkpoint(other, opt, scale, checkpoint, {'base': 'wrong'})


def test_checkpoint_quality_gate_rejects_different_dataset():
    with pytest.raises(ValueError, match='Comparison mismatch'):
        quality_gate({'version': 'v2', 'dataset_sha256': 'one'}, {'version': 'v2', 'dataset_sha256': 'two'})
