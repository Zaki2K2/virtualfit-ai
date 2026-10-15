"""Frozen, scenario-disjoint evaluation through the real API and CPU provider.

Requires the private benchmark server, never writes fixtures to the user's MongoDB.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import http.cookiejar
import json
from pathlib import Path
import statistics
import struct
import time
import urllib.error
import urllib.request
import uuid
import zlib

ROOT = Path(__file__).resolve().parents[1]


def png():
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>2I5B', 128, 128, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress((b'\0' + b'\x88\x99\xaa' * 128) * 128)) + chunk(b'IEND', b'')


class Client:
    def __init__(self, url):
        self.url = url.rstrip('/')
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def get(self, path):
        with self.opener.open(self.url + path, timeout=125) as r: return json.load(r)

    def post(self, path, body):
        request = urllib.request.Request(self.url + path, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'}, method='POST')
        with self.opener.open(request, timeout=125) as r: return json.load(r)

    def fixture(self, item):
        boundary = uuid.uuid4().hex
        data = bytearray()
        for key in ['name', 'category', 'description']:
            data.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{item[key]}\r\n'.encode())
        data.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="synthetic-fixture.png"\r\nContent-Type: image/png\r\n\r\n'.encode())
        data.extend(png()); data.extend(f'\r\n--{boundary}--\r\n'.encode())
        request = urllib.request.Request(self.url + '/api/v1/clothing', data=data, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'}, method='POST')
        with self.opener.open(request, timeout=30) as r: return json.load(r)['item']['id']


def schema_valid(result):
    return isinstance(result, dict) and isinstance(result.get('answer'), str) and 0 < len(result['answer']) <= 600 and \
        isinstance(result.get('itemIds'), list) and len(result['itemIds']) <= 4 and all(isinstance(i, str) for i in result['itemIds']) and \
        isinstance(result.get('occasion'), str) and isinstance(result.get('categories'), list) and \
        all(c in ['tops', 'bottoms', 'outerwear', 'dresses'] for c in result['categories']) and \
        isinstance(result.get('items'), list) and result.get('source') in ['model', 'deterministic-fallback', 'catalog-policy']


def score_case(row, actual, catalog, stable_ids):
    expected = row['expected']
    ids = [stable_ids.get(i, i) for i in actual['itemIds']]
    valid_catalog = len(ids) == len(set(ids)) and all(i in catalog for i in ids) and \
        [stable_ids.get(i['id'], i['id']) for i in actual['items']] == ids
    colors = expected['colorsByItem']
    def color_ok(key, color):
        text = (catalog[key]['name'] + ' ' + catalog[key]['description']).lower()
        aliases = {'gray': ['gray', 'grey', 'graphite', 'charcoal'], 'green': ['green', 'olive']}
        return any(value in text for value in aliases.get(color, [color]))
    # Empty results for a positive color request fail; no-match requests with no color oracle are N/A.
    color_valid = (all(key in ids and color_ok(key, color) for key, color in colors.items()) and
        set(ids) <= set(colors)) if colors else None
    return {'intent_accuracy': actual.get('intent') == expected['intent'],
        'category_accuracy': set(actual['categories']) == set(expected['categories']),
        'color_accuracy': color_valid, 'valid_catalog_selection': valid_catalog,
        'exact_outfit_match': any(set(ids) == set(option) for option in expected['acceptableItemSets']),
        'json_schema_valid': schema_valid(actual), 'selected_stable_ids': ids}


def evaluate(url, split, output, model='base'):
    client = Client(url)
    artifact = json.loads((ROOT / ('runtime/custom-loaded.json' if model == 'custom' else 'configs/local.json')).read_text())
    artifact_hash = artifact['gguf_sha256'] if model == 'custom' else artifact['model_sha256']
    if client.get('/benchmark-manifest') != {'isolated': True, 'database': 'memory', 'version': 'fashion-eval-v2'}:
        raise ValueError('Refusing fixture upload outside the isolated benchmark harness')
    stable_ids = {}
    for item in json.loads((ROOT / 'evaluation/fixtures.json').read_text()): stable_ids[client.fixture(item)] = item['id']
    catalog = {stable_ids.get(item['id'], item['id']): {k: item[k] for k in ['name', 'category', 'description']} for item in client.get('/api/v1/clothing')['items']}
    file = ROOT / 'evaluation' / f'{split}.jsonl'
    records = [json.loads(line) for line in file.read_text().splitlines() if line.strip()]
    cases = []
    for row in records:
        started = time.perf_counter()
        case = {'id': row['id'], 'scenario': row['scenario'], 'message': row['message'], 'expected': row['expected']}
        try:
            actual = client.post('/api/v1/styling/recommend', {'message': row['message'], 'model': model})
            case.update({'success': True, 'actual': actual, **score_case(row, actual, catalog, stable_ids)})
        except (urllib.error.URLError, ValueError, KeyError, TypeError) as exc:
            case.update({'success': False, 'error': str(exc)})
        case['latency_seconds'] = round(time.perf_counter() - started, 4)
        cases.append(case)
        print(json.dumps({'id': row['id'], 'success': case['success'], 'exact': case.get('exact_outfit_match'), 'source': case.get('actual', {}).get('source')}), flush=True)
    metrics = {}
    for name in ['intent_accuracy', 'category_accuracy', 'color_accuracy', 'valid_catalog_selection', 'exact_outfit_match', 'json_schema_valid']:
        evaluated = [c for c in cases if c.get(name) is not None] if name == 'color_accuracy' else cases
        metrics[name] = {'correct': sum(bool(c.get(name)) for c in evaluated), 'total': len(evaluated), 'rate': sum(bool(c.get(name)) for c in evaluated) / len(evaluated) if evaluated else None}
    model_cases = [c for c in cases if c.get('actual', {}).get('modelUsed')]
    latencies = sorted(c['latency_seconds'] for c in cases)
    report = {'version': 'fashion-eval-v2', 'split': split, 'model_selection': model, 'served_models': sorted({c['actual']['model'] for c in cases if c.get('success')}), 'created_at_utc': datetime.now(timezone.utc).isoformat(),
        'artifact_sha256': artifact_hash,
        'fixture_ids': {stable: actual for actual, stable in stable_ids.items()},
        'code_sha256': {str(p.relative_to(ROOT.parent)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT.parent/'apps/api/src/modules/styling/grounding.ts', ROOT.parent/'apps/api/src/modules/styling/styling.service.ts', ROOT.parent/'apps/api/src/integrations/slm/llama-cpp.provider.ts']},
        'dataset_sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'catalog_sha256': hashlib.sha256(json.dumps(catalog, sort_keys=True).encode()).hexdigest(),
        'catalog': catalog, 'model_config': json.loads((ROOT / 'configs/local.json').read_text()),
        'total': len(cases), 'successful': sum(c['success'] for c in cases), 'metrics': metrics,
        'model_calls': len(model_cases), 'accepted_model_outputs': sum(c['actual']['source'] == 'model' for c in model_cases),
        'fallbacks': sum(c.get('actual', {}).get('source') == 'deterministic-fallback' for c in cases),
        'raw_schema_valid': sum(c['actual']['diagnostics']['rawSchemaValid'] is True for c in model_cases),
        'raw_selection_valid': sum(c['actual']['diagnostics']['rawSelectionValid'] is True for c in model_cases),
        'latency_seconds': {'mean': statistics.mean(latencies), 'median': statistics.median(latencies), 'p95': latencies[min(len(latencies)-1, int(len(latencies)*0.95))]},
        'limitations': 'Synthetic scenario suite, correlated paraphrases. Metrics describe the whole pipeline including deterministic policy/fallback, not a trained-model accuracy gain. Memory-isolated API catalog; real CPU inference. No live MongoDB benchmark writes.', 'cases': cases}
    if model == 'custom' and json.loads((ROOT/'runtime/custom-loaded.json').read_text())['gguf_sha256'] != artifact_hash:
        raise ValueError('Candidate changed during evaluation')
    output.parent.mkdir(parents=True, exist_ok=True); output.write_text(json.dumps(report, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k not in ['cases', 'catalog', 'model_config']}, indent=2))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:5100')
    parser.add_argument('--split', choices=['development', 'validation', 'heldout'], default='heldout')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--model', choices=['base', 'custom'], default='base')
    args = parser.parse_args()
    report = evaluate(args.url, args.split, args.output, args.model)
    if report['successful'] != report['total']: raise SystemExit(1)
