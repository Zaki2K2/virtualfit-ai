import copy
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_reviewed_nova', ROOT / 'tools/prepare_reviewed_nova.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def bundle(tmp_path):
    seed = json.loads((ROOT / 'data/train.jsonl').read_text().splitlines()[0])
    rows = []
    for index in range(5):
        row = copy.deepcopy(seed)
        row['source'] = 'explicitly-consented-operator-reviewed'
        row['scenario'] = str(index)
        context = json.loads(row['messages'][1]['content'])
        context['message'] += f' Reviewed example {index}.'
        row['messages'][1]['content'] = json.dumps(context)
        rows.append(row)
    source = tmp_path / 'reviewed.json'
    source.write_text(json.dumps({'datasetVersion':'reviewed-test','sourceIds':['approved-1'], 'records':rows}))
    return source


def test_reviewed_export_creates_valid_disjoint_versioned_splits(tmp_path):
    source = bundle(tmp_path)
    manifest = module.prepare(source, tmp_path / 'dataset')
    assert manifest['counts'] == {'train':3,'validation':1,'test':1}
    assert manifest['dataset_version'] == 'reviewed-test'
    assert len(manifest['source_export_sha256']) == 64
    with pytest.raises(FileExistsError): module.prepare(source, tmp_path / 'dataset')


def test_unreviewed_and_invalid_targets_are_refused(tmp_path):
    source = bundle(tmp_path)
    data = json.loads(source.read_text())
    data['records'][0]['source'] = 'unreviewed'
    source.write_text(json.dumps(data))
    with pytest.raises(ValueError,match='operator-reviewed'): module.prepare(source,tmp_path/'bad-source')
    data['records'][0]['source'] = 'explicitly-consented-operator-reviewed'
    target = json.loads(data['records'][0]['messages'][2]['content']);target['itemIds']=['invented']
    data['records'][0]['messages'][2]['content']=json.dumps(target);source.write_text(json.dumps(data))
    with pytest.raises(ValueError,match='Ungrounded'): module.prepare(source,tmp_path/'bad-ids')
    assert (tmp_path/'bad-ids/INVALID.txt').is_file()
