"""FastAPI inference service.

    uvicorn virtualfit_engine.service.app:app --host 127.0.0.1 --port 8000

It is NOT started by `npm run dev`. On a machine without a CUDA GPU it starts fine and reports
`GPU_UNAVAILABLE` for inference instead of attempting (or faking) generation.
Uploaded images live only in memory for the duration of the request and are never written to disk.
"""

from __future__ import annotations

import asyncio
import hmac
import io
import time
from functools import partial

import numpy as np
from fastapi import FastAPI, File, Form, Header, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image

from .. import __version__
from ..images import ImageError, load_image_bytes, to_png_bytes
from ..models import VARIANTS, EngineModels, ModelUnavailable, cuda_available
from ..postprocessing import repaint
from ..preprocessing import mask_to_array, prepare_inputs, validate_mask
from .masking import AutoMaskerBackend
from .settings import Settings

CATEGORY_TO_CLOTH_TYPE = {"tops": "upper", "outerwear": "upper", "bottoms": "lower", "dresses": "overall"}
# The released vitonhd attention weights were trained on upper-body garments only.
SUPPORTED_CLOTH_TYPES = {"vitonhd": {"upper"}, "mix": {"upper", "lower", "overall"}, "dresscode": {"upper", "lower", "overall"}}

STATUS = {
    "VALIDATION_ERROR": 400,
    "UNAUTHORIZED": 401,
    "UNSUPPORTED_IMAGE": 415,
    "FILE_TOO_LARGE": 413,
    "UNSUPPORTED_CATEGORY": 422,
    "BAD_MASK": 422,
    "BUSY": 429,
    "GPU_UNAVAILABLE": 503,
    "MODEL_UNAVAILABLE": 503,
    "MASKER_UNAVAILABLE": 503,
    "TIMEOUT": 504,
    "INFERENCE_FAILED": 500,
}


class EngineError(Exception):
    def __init__(self, code: str, message: str):
        self.code, self.message = code, message


def _err(code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=STATUS.get(code, 500), content={"error": {"code": code, "message": message}})


def create_app(settings: Settings | None = None, models: EngineModels | None = None, masker=None) -> FastAPI:
    settings = settings or Settings.from_env()
    models = models or EngineModels(settings.paths, allow_cpu=settings.allow_cpu)
    masker = masker or AutoMaskerBackend(settings.catvton_repo, settings.masker_ckpt, "cuda")
    app = FastAPI(title="VirtualFit AI engine", version=__version__, docs_url=None, redoc_url=None)
    gpu_slot = asyncio.Semaphore(1)  # one generation at a time per process

    @app.exception_handler(EngineError)
    async def engine_error(_: Request, exc: EngineError):
        return _err(exc.code, exc.message)

    @app.exception_handler(ModelUnavailable)
    async def model_unavailable(_: Request, exc: ModelUnavailable):
        return _err(exc.code, exc.message)

    @app.get("/health")
    def health():
        masker_ok, masker_why = masker.available() if hasattr(masker, "available") else (True, "ok")
        return {
            "status": "ok",
            "version": __version__,
            "cuda": cuda_available(),
            "models": models.availability(),
            "masker": {"available": masker_ok, "reason": masker_why},
            "supported_cloth_types": sorted(SUPPORTED_CLOTH_TYPES[settings.paths.attn_version]),
            "limits": {"max_upload_mb": settings.max_upload_mb, "timeout_s": settings.timeout_s},
        }

    async def read_image(upload: UploadFile, label: str) -> Image.Image:
        limit = settings.max_upload_mb * 1024 * 1024
        data = await upload.read(limit + 1)
        if len(data) > limit:
            raise EngineError("FILE_TOO_LARGE", f"{label} is larger than {settings.max_upload_mb} MB")
        try:
            return load_image_bytes(data, label)
        except ImageError as exc:
            raise EngineError("UNSUPPORTED_IMAGE", str(exc)) from exc

    @app.post("/v1/inference/try-on")
    async def try_on(
        person: UploadFile = File(...),
        garment: UploadFile = File(...),
        category: str = Form(...),
        model_version: str = Form("pretrained"),
        mask: UploadFile | None = File(None),
        seed: int = Form(555),
        steps: int = Form(30),
        guidance: float = Form(2.5),
        x_engine_key: str | None = Header(None),
    ):
        if settings.api_key and not (x_engine_key and hmac.compare_digest(x_engine_key, settings.api_key)):
            raise EngineError("UNAUTHORIZED", "missing or invalid X-Engine-Key")
        if model_version not in VARIANTS:
            raise EngineError("VALIDATION_ERROR", f"model_version must be one of {list(VARIANTS)}")
        if category not in CATEGORY_TO_CLOTH_TYPE:
            raise EngineError("VALIDATION_ERROR", f"category must be one of {sorted(CATEGORY_TO_CLOTH_TYPE)}")
        if not (1 <= steps <= 100 and 1.0 <= guidance <= 15.0):
            raise EngineError("VALIDATION_ERROR", "steps must be 1-100 and guidance 1-15")
        cloth_type = CATEGORY_TO_CLOTH_TYPE[category]
        if cloth_type not in SUPPORTED_CLOTH_TYPES[settings.paths.attn_version]:
            raise EngineError(
                "UNSUPPORTED_CATEGORY",
                f"the '{settings.paths.attn_version}' weights only support {sorted(SUPPORTED_CLOTH_TYPES[settings.paths.attn_version])} garments",
            )

        person_img = await read_image(person, "person image")
        garment_img = await read_image(garment, "garment image")
        mask_img = None
        if mask is not None:
            raw = await mask.read(settings.max_upload_mb * 1024 * 1024 + 1)
            try:
                mask_img = Image.open(io.BytesIO(raw)).convert("L")
            except Exception as exc:
                raise EngineError("UNSUPPORTED_IMAGE", "mask is not a readable image") from exc
            if mask_img.size != person_img.size:
                raise EngineError("BAD_MASK", "mask must have the same size as the person image")

        pipe = models.pipeline(model_version)  # may raise GPU_UNAVAILABLE / MODEL_UNAVAILABLE
        version_label = _version_label(settings, models, model_version)

        if gpu_slot.locked():
            raise EngineError("BUSY", "another generation is running; retry shortly")
        await gpu_slot.acquire()
        started = time.perf_counter()
        loop = asyncio.get_running_loop()
        fut = loop.run_in_executor(
            None,
            partial(_generate, pipe, models, masker, person_img, garment_img, mask_img, cloth_type, settings, model_version, seed, steps, guidance),
        )
        fut.add_done_callback(lambda _f: gpu_slot.release())  # slot frees when the thread really ends
        try:
            result = await asyncio.wait_for(asyncio.shield(fut), settings.timeout_s)
        except asyncio.TimeoutError:
            raise EngineError("TIMEOUT", f"generation exceeded {settings.timeout_s:.0f}s") from None
        except ModelUnavailable:
            raise
        except EngineError:
            raise
        except Exception as exc:  # model failure: report, never substitute output
            raise EngineError("INFERENCE_FAILED", f"{type(exc).__name__}: {exc}") from exc

        return Response(
            content=to_png_bytes(result),
            media_type="image/png",
            headers={
                "X-Model-Version": version_label,
                "X-Duration-Ms": str(round((time.perf_counter() - started) * 1000)),
                "X-Simulated": "false",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    return app


def _version_label(settings: Settings, models: EngineModels, variant: str) -> str:
    base = f"catvton-{settings.paths.attn_version}"
    if variant == "custom":
        meta = models.adapter_metadata() or {}
        return f"{base}+virtualfit-lora({meta.get('optimizer_steps_completed', '?')} steps)"
    return base


def _generate(pipe, models, masker, person, garment, mask, cloth_type, settings, variant, seed, steps, guidance):
    """Blocking inference. Runs in a worker thread, serialised by the model lock."""
    import torch

    with models.lock:
        pipe_ready = models.pipeline(variant)  # re-assert adapter state under the lock
        if mask is None:
            mask = masker(person, cloth_type)  # may raise MASKER_UNAVAILABLE
        arr = mask_to_array(mask)
        ok, why = validate_mask(arr)
        if not ok:
            raise EngineError("BAD_MASK", why)
        gen = torch.Generator(device="cpu").manual_seed(seed)
        result = pipe_ready(person, garment, mask, steps, guidance, settings.paths.height, settings.paths.width, gen)
        prep = prepare_inputs(person, garment, mask, settings.paths.width, settings.paths.height)
        return repaint(prep.person, prep.mask, result)


def __getattr__(name: str):
    # `uvicorn virtualfit_engine.service.app:app` builds the app lazily from the environment.
    if name == "app":
        global _APP
        try:
            return _APP
        except NameError:
            _APP = create_app()
            return _APP
    raise AttributeError(name)
