import io
import time

import numpy as np
import pytest
from PIL import Image

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient

from conftest import png_bytes
from virtualfit_engine.models import EngineModels, ModelPaths, ModelUnavailable
from virtualfit_engine.service.app import create_app
from virtualfit_engine.service.masking import AutoMaskerBackend
from virtualfit_engine.service.settings import Settings


def settings(**env):
    base = {"ENGINE_HOST": "127.0.0.1"}
    base.update(env)
    return Settings.from_env(base)


def rect_mask_png(w=160, h=200, coverage_box=(40, 50, 120, 150)) -> bytes:
    arr = np.zeros((h, w), np.uint8)
    x0, y0, x1, y1 = coverage_box
    arr[y0:y1, x0:x1] = 255
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    return buf.getvalue()


def files(person=None, garment=None, **extra):
    f = {
        "person": ("p.png", person or png_bytes(160, 200), "image/png"),
        "garment": ("g.png", garment or png_bytes(160, 160, (10, 200, 10)), "image/png"),
    }
    f.update(extra)
    return f


DATA = {"category": "tops", "model_version": "pretrained"}


# ---- explicit TEST DOUBLES (never shipped): they exercise the HTTP plumbing only ----
class FakePipeline:
    def __init__(self, delay=0.0, fail=False):
        self.delay, self.fail = delay, fail

    def __call__(self, person, garment, mask, steps, guidance, height, width, generator):
        time.sleep(self.delay)
        if self.fail:
            raise RuntimeError("CUDA out of memory (fake)")
        return Image.new("RGB", (width, height), (1, 2, 3))


class FakeModels:
    lock = __import__("threading").Lock()

    def __init__(self, pipe, custom_ok=True):
        self.pipe, self.custom_ok = pipe, custom_ok

    def availability(self):
        return {"pretrained": {"available": True, "reason": "ok"}, "custom": {"available": self.custom_ok, "reason": "ok" if self.custom_ok else "no adapter"}}

    def pipeline(self, variant):
        if variant == "custom" and not self.custom_ok:
            raise ModelUnavailable("MODEL_UNAVAILABLE", "no adapter")
        return self.pipe

    def adapter_metadata(self):
        return {"optimizer_steps_completed": 500}


class FakeMasker:
    def available(self):
        return True, "ok"

    def __call__(self, person, cloth_type):
        return Image.open(io.BytesIO(rect_mask_png(*person.size)))


def client_with(models=None, masker=None, **env):
    s = settings(**env)
    models = models or EngineModels(s.paths)
    return TestClient(create_app(s, models, masker or AutoMaskerBackend(None)))


# ---- real components on a machine without a GPU ----
def test_health_reports_missing_gpu_honestly():
    body = client_with().get("/health").json()
    assert body["status"] == "ok" and body["cuda"] is False
    assert body["models"]["pretrained"] == {"available": False, "reason": "no CUDA GPU available"}
    assert body["models"]["custom"]["available"] is False
    assert body["masker"]["available"] is False
    assert body["supported_cloth_types"] == ["upper"]


def test_inference_without_gpu_fails_with_gpu_unavailable_never_a_fake_image():
    r = client_with().post("/v1/inference/try-on", data=DATA, files=files())
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "GPU_UNAVAILABLE"
    assert r.headers["content-type"].startswith("application/json")


def test_custom_model_without_adapter_is_unavailable():
    models = EngineModels(ModelPaths(adapter_dir=None), allow_cpu=True)
    assert models.availability()["custom"]["available"] is False
    assert "adapter" in models.availability()["custom"]["reason"]


# ---- request validation ----
@pytest.mark.parametrize(
    "data,files_,code,status",
    [
        ({"category": "hats", "model_version": "pretrained"}, files(), "VALIDATION_ERROR", 400),
        ({"category": "tops", "steps": "500"}, files(), "VALIDATION_ERROR", 400),
        ({"category": "bottoms"}, files(), "UNSUPPORTED_CATEGORY", 422),
        (DATA, files(person=b"<?php echo 1 ?>"), "UNSUPPORTED_IMAGE", 415),
        (DATA, files(garment=png_bytes(30, 30)), "UNSUPPORTED_IMAGE", 415),
    ],
)
def test_validation_errors(data, files_, code, status):
    models = FakeModels(FakePipeline())
    r = client_with(models, FakeMasker()).post("/v1/inference/try-on", data=data, files=files_)
    assert (r.status_code, r.json()["error"]["code"]) == (status, code)


def test_oversized_upload_rejected():
    c = client_with(FakeModels(FakePipeline()), FakeMasker(), ENGINE_MAX_UPLOAD_MB="1")
    big = png_bytes(96, 128) + b"\0" * (1024 * 1024 + 10)
    r = c.post("/v1/inference/try-on", data=DATA, files=files(person=big))
    assert (r.status_code, r.json()["error"]["code"]) == (413, "FILE_TOO_LARGE")


def test_api_key_is_enforced_and_non_loopback_requires_one():
    c = client_with(FakeModels(FakePipeline()), FakeMasker(), ENGINE_API_KEY="s3cret")
    assert c.post("/v1/inference/try-on", data=DATA, files=files()).status_code == 401
    assert c.post("/v1/inference/try-on", data=DATA, files=files(), headers={"X-Engine-Key": "wrong"}).status_code == 401
    ok = c.post("/v1/inference/try-on", data=DATA, files=files(), headers={"X-Engine-Key": "s3cret"})
    assert ok.status_code == 200
    with pytest.raises(RuntimeError, match="ENGINE_API_KEY"):
        Settings.from_env({"ENGINE_HOST": "0.0.0.0"})
    assert Settings.from_env({"ENGINE_HOST": "0.0.0.0", "ENGINE_API_KEY": "k"}).api_key == "k"


# ---- success path and failure semantics (with test doubles) ----
def test_success_returns_png_with_model_headers():
    c = client_with(FakeModels(FakePipeline()), FakeMasker())
    r = c.post("/v1/inference/try-on", data=DATA, files=files())
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.headers["x-model-version"] == "catvton-vitonhd" and r.headers["x-simulated"] == "false"
    assert r.headers["cache-control"] == "no-store"
    assert Image.open(io.BytesIO(r.content)).size == (384, 512)

    custom = c.post("/v1/inference/try-on", data={**DATA, "model_version": "custom"}, files=files())
    assert custom.headers["x-model-version"] == "catvton-vitonhd+virtualfit-lora(500 steps)"


def test_unknown_or_unavailable_model_version():
    c = client_with(FakeModels(FakePipeline(), custom_ok=False), FakeMasker())
    assert c.post("/v1/inference/try-on", data={**DATA, "model_version": "custom"}, files=files()).json()["error"]["code"] == "MODEL_UNAVAILABLE"
    assert c.post("/v1/inference/try-on", data={**DATA, "model_version": "magic"}, files=files()).status_code == 400


def test_missing_masker_is_reported_not_faked():
    r = client_with(FakeModels(FakePipeline()), AutoMaskerBackend(None)).post("/v1/inference/try-on", data=DATA, files=files())
    assert (r.status_code, r.json()["error"]["code"]) == (503, "MASKER_UNAVAILABLE")


def test_supplied_mask_is_validated():
    c = client_with(FakeModels(FakePipeline()), AutoMaskerBackend(None))
    good = c.post("/v1/inference/try-on", data=DATA, files=files(mask=("m.png", rect_mask_png(), "image/png")))
    assert good.status_code == 200
    wrong_size = c.post("/v1/inference/try-on", data=DATA, files=files(mask=("m.png", rect_mask_png(50, 50, (5, 5, 30, 30)), "image/png")))
    assert wrong_size.json()["error"]["code"] == "BAD_MASK"
    empty = c.post("/v1/inference/try-on", data=DATA, files=files(mask=("m.png", rect_mask_png(coverage_box=(0, 0, 0, 0)), "image/png")))
    assert empty.json()["error"]["code"] == "BAD_MASK"


def test_model_errors_are_reported_and_never_replaced_by_placeholder_output():
    r = client_with(FakeModels(FakePipeline(fail=True)), FakeMasker()).post("/v1/inference/try-on", data=DATA, files=files())
    assert (r.status_code, r.json()["error"]["code"]) == (500, "INFERENCE_FAILED")
    assert "out of memory" in r.json()["error"]["message"]


def test_slow_generation_times_out():
    c = client_with(FakeModels(FakePipeline(delay=1.0)), FakeMasker(), ENGINE_TIMEOUT_S="0.2")
    r = c.post("/v1/inference/try-on", data=DATA, files=files())
    assert (r.status_code, r.json()["error"]["code"]) == (504, "TIMEOUT")
    time.sleep(1.2)  # let the worker thread finish so the slot is released
