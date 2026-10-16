"""Validate the canonical Colab notebook without rewriting its experiment workflow."""
from pathlib import Path
import nbformat
p = Path(__file__).resolve().parents[1] / 'notebooks/01_fashion_lora_colab.ipynb'
nb = nbformat.read(p, as_version=4)
nbformat.validate(nb)
for cell in nb.cells:
    if cell.cell_type == 'code': compile(cell.source, 'colab-cell', 'exec')
print('Notebook structure and Python syntax validated; no cloud execution performed.')
