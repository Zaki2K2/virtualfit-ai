"""The notebooks cannot run here (they need Colab + a GPU), but they must at least be valid,
syntactically correct, consistent with the engine's CLI, and free of secrets / keep-alive hacks."""

import ast
import json
import re
from pathlib import Path

import pytest

nbformat = pytest.importorskip("nbformat")

NB_DIR = Path(__file__).resolve().parents[1] / "notebooks"
NAMES = ["01_gpu_check.ipynb", "02_baseline.ipynb", "03_finetune.ipynb"]
FORBIDDEN = [r"hf_[A-Za-z0-9]{10,}", r"ngrok", r"localtunnel", r"cloudflared", r"keep.?alive", r"while\s+True", r"time\.sleep\(\s*[3-9]\d{2,}"]


def _cells(name):
    nb = nbformat.read(NB_DIR / name, as_version=4)
    return nb, [c for c in nb.cells if c.cell_type == "code"]


@pytest.mark.parametrize("name", NAMES)
def test_notebook_is_valid_nbformat(name):
    nb, _ = _cells(name)
    nbformat.validate(nb)


@pytest.mark.parametrize("name", NAMES)
def test_code_cells_are_syntactically_valid_python(name):
    _, cells = _cells(name)
    assert cells
    for i, c in enumerate(cells):
        lines = [(l[: len(l) - len(l.lstrip())] + "pass") if l.lstrip().startswith(("!", "%")) else l for l in c.source.splitlines()]
        try:
            ast.parse("\n".join(lines))
        except SyntaxError as exc:  # pragma: no cover - failure message only
            pytest.fail(f"{name} cell {i}: {exc}\n{c.source}")


@pytest.mark.parametrize("name", NAMES)
def test_no_secrets_or_platform_circumvention(name):
    text = (NB_DIR / name).read_text(encoding="utf-8")
    for pattern in FORBIDDEN:
        assert not re.search(pattern, text, re.I), f"{name} matches forbidden pattern {pattern}"


def test_generated_notebooks_are_up_to_date():
    import importlib.util

    spec = importlib.util.spec_from_file_location("make_notebooks", NB_DIR.parent / "tools" / "make_notebooks.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for name, nb in (("01_gpu_check.ipynb", mod.nb_gpu_check()), ("02_baseline.ipynb", mod.nb_baseline()), ("03_finetune.ipynb", mod.nb_finetune())):
        on_disk = json.loads((NB_DIR / name).read_text(encoding="utf-8"))
        assert on_disk == json.loads(json.dumps(nb)), f"{name} is stale: run python tools/make_notebooks.py"


def test_notebook_cli_flags_exist_in_the_real_clis():
    """Flags used by the notebooks' shell commands must exist in the engine's CLIs."""
    import contextlib
    import io

    from virtualfit_engine.dataset import cli as dataset_cli
    from virtualfit_engine.evaluation import cli as eval_cli
    from virtualfit_engine.training import train as train_cli

    text = (NB_DIR / "03_finetune.ipynb").read_text(encoding="utf-8")

    def help_of(main, argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), pytest.raises(SystemExit):
            main(argv)
        return buf.getvalue()

    expectations = {
        "dataset prepare": (help_of(dataset_cli.main, ["prepare", "--help"]), ["--root", "--out", "--n-train", "--n-val", "--n-heldout"]),
        "training": (help_of(train_cli.main, ["--help"]), ["--config", "--smoke", "--resume", "--output-dir"]),
        "evaluation": (help_of(eval_cli.main, ["--help"]), ["--root", "--manifest", "--adapter", "--out"]),
    }
    for label, (help_text, flags) in expectations.items():
        for flag in flags:
            assert flag in help_text, f"{label}: {flag} missing from CLI"
            assert flag in text, f"{label}: notebook 03 does not use {flag}"
