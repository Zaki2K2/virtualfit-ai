"""Register a locally loaded custom GGUF only after genuine training and same-suite gates."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def quality_gate(base, candidate):
    for field in ['version', 'split', 'dataset_sha256', 'catalog_sha256', 'total', 'fixture_ids', 'code_sha256']:
        if base.get(field) != candidate.get(field): raise ValueError(f'Comparison mismatch: {field}')
    if candidate.get('split') != 'heldout' or candidate.get('total', 0) < 100 or candidate.get('model_selection') != 'custom':
        raise ValueError('Need the full held-out suite evaluated against the custom runtime')
    if candidate['successful'] != candidate['total']: raise ValueError('Candidate has failed requests')
    if candidate.get('served_models') != ['virtualfit-fashion-custom']: raise ValueError('Wrong served model')
    for metric, baseline in base['metrics'].items():
        value = candidate['metrics'][metric]
        if value['total'] != baseline['total'] or value['rate'] is None or value['rate'] < baseline['rate']:
            raise ValueError(f'Candidate regressed: {metric}')
    for metric in ['json_schema_valid', 'valid_catalog_selection']:
        if candidate['metrics'][metric]['rate'] != 1: raise ValueError(f'Unsafe candidate: {metric}')
    if not candidate.get('model_calls') or not candidate.get('accepted_model_outputs'):
        raise ValueError('Deterministic policy alone cannot validate a custom checkpoint')
    if candidate['accepted_model_outputs'] / candidate['model_calls'] < base['accepted_model_outputs'] / max(base['model_calls'], 1):
        raise ValueError('Raw model acceptance regressed')


def register(gguf, manifest_path, baseline_path, candidate_path):
    manifest = json.loads(manifest_path.read_text())
    config = json.loads((ROOT / 'configs/lora.json').read_text())
    if manifest.get('optimizer_steps_completed', 0) < 1 or not manifest.get('cuda_device') or 'cpu' in manifest['cuda_device'].lower():
        raise ValueError('No verified CUDA fine-tuning steps')
    if manifest.get('base_model') != config['base_model'] or manifest.get('resolved_revision') != config['revision']:
        raise ValueError('Training base/revision is incompatible')
    quality_gate(json.loads(baseline_path.read_text()), json.loads(candidate_path.read_text()))
    with gguf.open('rb') as source:
        if source.read(4) != b'GGUF': raise ValueError('Not a GGUF artifact')
    key = (ROOT / 'runtime/api-key.txt').read_text().strip()
    request = urllib.request.Request('http://127.0.0.1:8082/v1/models', headers={'Authorization': 'Bearer ' + key})
    with urllib.request.urlopen(request, timeout=5) as response: models = json.load(response)
    if not any(item['id'] == 'virtualfit-fashion-custom' for item in models['data']): raise ValueError('Candidate model has not loaded')
    def digest(path):
        h = hashlib.sha256()
        with path.open('rb') as source:
            while chunk := source.read(1024 * 1024): h.update(chunk)
        return h.hexdigest()
    if json.loads(candidate_path.read_text()).get('artifact_sha256') != digest(gguf):
        raise ValueError('Candidate report was not generated with this GGUF artifact')
    loaded = json.loads((ROOT / 'runtime/custom-loaded.json').read_text())
    if loaded['gguf_path'] != str(gguf.resolve()) or loaded['gguf_sha256'] != digest(gguf): raise ValueError('Loaded artifact differs from the evaluated candidate path/hash')
    # Authenticated /v1/models above is the liveness check. os.kill(pid, 0) is not safe on Windows.
    registration = {'approved': True, 'model': 'virtualfit-fashion-custom', 'gguf_path': str(gguf.resolve()), 'gguf_sha256': digest(gguf),
        'optimizer_steps_completed': manifest['optimizer_steps_completed'], 'training_manifest_sha256': digest(manifest_path),
        'baseline_report_sha256': digest(baseline_path), 'candidate_report_sha256': digest(candidate_path)}
    output = ROOT / 'configs/custom-model.json'
    temporary = output.with_suffix('.tmp'); temporary.write_text(json.dumps(registration, indent=2)); temporary.replace(output)
    return registration


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['gguf', 'manifest', 'baseline', 'candidate']: parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    register(args.gguf, args.manifest, args.baseline, args.candidate)
    print('Custom model registered. Original model and rollback remain available.')
