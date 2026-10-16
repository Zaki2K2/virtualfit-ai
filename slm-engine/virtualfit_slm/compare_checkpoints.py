"""Paired raw-model held-out comparison; no API fallback and no production writes."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import time

from .data import load_records, validate_splits
from .train import encode_record
from .evaluate import score


def compare(adapter, data, output):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel
    from safetensors.torch import load_file
    if not torch.cuda.is_available():
        raise RuntimeError('Run this comparison on the Colab CUDA GPU')
    manifest = json.loads((adapter / 'training-manifest.json').read_text())
    assert manifest['optimizer_steps_completed'] > 0 and manifest['changed_adapter_parameters']
    validate_splits(data)
    hashes = {s: hashlib.sha256((data / f'{s}.jsonl').read_bytes()).hexdigest() for s in ['train', 'validation', 'test']}
    assert hashes == manifest['dataset_sha256'], 'Evaluation data differs from training provenance'
    weights = load_file(adapter / 'adapter_model.safetensors')
    assert weights and all(torch.isfinite(v).all() for v in weights.values())
    tokenizer = AutoTokenizer.from_pretrained(adapter, trust_remote_code=False)
    base = AutoModelForCausalLM.from_pretrained(manifest['base_model'], revision=manifest['resolved_revision'],
        trust_remote_code=False, torch_dtype=torch.float16, device_map={'': 0})
    assert base.config.model_type == 'qwen2'
    assert len(tokenizer) <= base.get_input_embeddings().num_embeddings
    model = PeftModel.from_pretrained(base, adapter).eval()
    model.config.use_cache = True
    rows = load_records(data / 'test.jsonl')
    report = {'base_model': manifest['base_model'], 'revision': manifest['resolved_revision'],
              'dataset_sha256': hashes, 'adapter_sha256': hashlib.sha256((adapter / 'adapter_model.safetensors').read_bytes()).hexdigest(),
              'generation': {'do_sample': False, 'max_new_tokens': 260}, 'variants': {}}
    for variant in ['base', 'adapter']:
        cases = []
        from contextlib import nullcontext
        with model.disable_adapter() if variant == 'base' else nullcontext():
            for i, row in enumerate(rows):
                batch = {k: torch.tensor([v], device='cuda') for k, v in encode_record(tokenizer, row, manifest['config']['max_length']).items()}
                torch.cuda.synchronize(); started = time.perf_counter()
                with torch.inference_mode():
                    loss = model(**batch).loss.item()
                    prompt = tokenizer.apply_chat_template(row['messages'][:-1], tokenize=True, add_generation_prompt=True, return_tensors='pt').to('cuda')
                    generated = model.generate(prompt, attention_mask=torch.ones_like(prompt), do_sample=False,
                        max_new_tokens=260, pad_token_id=tokenizer.eos_token_id)
                torch.cuda.synchronize()
                raw = tokenizer.decode(generated[0, prompt.shape[1]:], skip_special_tokens=True)
                result = {'id': i, 'raw': raw, 'loss': loss, 'seconds': time.perf_counter()-started, 'valid': False}
                assert math.isfinite(loss)
                try:
                    actual = json.loads(raw)
                    assert set(actual) == {'answer', 'itemIds', 'occasion', 'categories'}
                    assert isinstance(actual['answer'], str) and 0 < len(actual['answer']) <= 600
                    assert isinstance(actual['occasion'], str) and len(actual['occasion']) <= 80
                    assert isinstance(actual['categories'], list) and all(c in ['tops','bottoms','outerwear','dresses'] for c in actual['categories'])
                    ids = actual['itemIds']; allowed = {x['id'] for x in json.loads(row['messages'][1]['content'])['wardrobe']}
                    assert isinstance(ids, list) and all(isinstance(x, str) for x in ids) and len(ids) <= 4 and len(ids) == len(set(ids)) and set(ids) <= allowed
                    result.update(valid=True, **score(json.loads(row['messages'][-1]['content']), actual))
                except (ValueError, TypeError, KeyError, AssertionError):
                    result.update(exact_ids=False, precision=0.0, recall=0.0, categories_exact=False)
                cases.append(result)
        report['variants'][variant] = {'cases': cases, 'mean_loss': sum(c['loss'] for c in cases)/len(cases),
            'valid_rate': sum(c['valid'] for c in cases)/len(cases), 'exact_id_rate': sum(c['exact_ids'] for c in cases)/len(cases)}
    report['status'] = 'comparison-only; human review and GGUF/API loading gates still required'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding='utf8')
    print(json.dumps({v: {k:x for k,x in r.items() if k != 'cases'} for v,r in report['variants'].items()}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adapter', type=Path, required=True)
    parser.add_argument('--data', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    compare(args.adapter, args.data, args.output)
