import json
from pathlib import Path
import pytest
from virtualfit_engine.inference_experiment import require_gpu


def test_pinned_vision_experiment_refuses_cpu_before_weight_download(monkeypatch):
    import torch
    monkeypatch.setattr(torch.cuda, 'is_available', lambda: False)
    config = json.loads((Path(__file__).resolve().parents[1]/'configs/inference-experiment.json').read_text())
    assert all(len(config[key]) == 40 for key in ['base_revision','vae_revision','attention_revision'])
    with pytest.raises(RuntimeError, match='no local model download'):
        require_gpu(config)


def test_vision_experiment_notebook_static_validation():
    nbformat = pytest.importorskip('nbformat')
    root = Path(__file__).resolve().parents[1]
    notebook = nbformat.read(root / 'notebooks/04_inference_experiment.ipynb', as_version=4)
    nbformat.validate(notebook)
    for cell in notebook.cells:
        if cell.cell_type == 'code': compile(cell.source, 'vision-colab-cell', 'exec')
