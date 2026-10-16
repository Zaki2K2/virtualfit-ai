"""Optional authenticated media worker. No weights load or download at web-app startup."""
import asyncio
import base64
import binascii
import hmac
import io
import json
import logging
import os
from pathlib import Path
import threading
import time

from fastapi import FastAPI, HTTPException, Request
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, ConfigDict

MODELS = json.loads((Path(__file__).parent / 'models.json').read_text())
TOKEN = os.environ.get('NOVA_WORKER_API_KEY', '')
app = FastAPI(title='Nova separate media inference', docs_url=None, redoc_url=None)
lock = threading.Lock()
loaded = {}
verified = set()
Image.MAX_IMAGE_PIXELS = 16_777_216


@app.middleware('http')
async def authenticated(request: Request, call_next):
    from starlette.responses import JSONResponse
    if len(TOKEN) < 24:
        return JSONResponse({'error': 'Set a private NOVA_WORKER_API_KEY of at least 24 characters.'}, status_code=503)
    if not hmac.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + TOKEN):
        return JSONResponse({'error': 'Unauthorized'}, status_code=401)
    if request.method == 'POST':
        length = request.headers.get('content-length', '')
        if not length.isdigit() or int(length) > 16 * 1024**2:
            return JSONResponse({'error': 'Content-Length is required; body limit is 16 MiB.'}, status_code=413)
    return await call_next(request)


@app.get('/health')
def health():
    return {'status': 'ok', 'loaded': list(loaded), 'configured_models': MODELS,
            'vision_enabled': os.environ.get('NOVA_ENABLE_VISION') == '1',
            'images_enabled': os.environ.get('NOVA_ENABLE_IMAGES') == '1',
            'inference_verified': bool(verified), 'verified_models': sorted(verified)}


def decode_image(url):
    if not isinstance(url, str) or not url.startswith(('data:image/webp;base64,', 'data:image/png;base64,', 'data:image/jpeg;base64,')):
        raise ValueError('Only inline JPEG, PNG or WebP pixels are accepted; no remote URLs')
    raw = base64.b64decode(url.split(',', 1)[1], validate=True)
    if len(raw) > 10 * 1024**2:
        raise ValueError('Image exceeds 10 MiB')
    image = Image.open(io.BytesIO(raw))
    if image.format not in {'JPEG', 'PNG', 'WEBP'} or getattr(image, 'n_frames', 1) != 1:
        raise ValueError('Unsupported image')
    image.load()
    image.thumbnail((1024, 1024))
    return image.convert('RGB')


def load_vision():
    import torch
    from transformers import AutoProcessor, AutoModelForImageTextToText
    if not torch.cuda.is_available() and os.environ.get('NOVA_ALLOW_CPU_VISION') != '1':
        raise RuntimeError('No CUDA GPU. CPU vision requires an explicit NOVA_ALLOW_CPU_VISION=1 benchmark opt-in.')
    if 'vision' not in loaded:
        config = MODELS['vision']
        kwargs = {'revision': config['revision'], 'trust_remote_code': False,
                  'local_files_only': os.environ.get('NOVA_MEDIA_ALLOW_DOWNLOADS') != '1'}
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        torch.set_num_threads(int(os.environ.get('NOVA_CPU_THREADS', '2')))
        processor = AutoProcessor.from_pretrained(config['model'], **kwargs)
        model = AutoModelForImageTextToText.from_pretrained(config['model'],
                    torch_dtype=torch.float16 if device == 'cuda' else torch.float32, **kwargs).to(device).eval()
        loaded['vision'] = (processor, model, device)
    return loaded['vision']


def vision_infer(image, prompt, cancel):
    import torch
    from transformers import StoppingCriteria, StoppingCriteriaList
    processor, model, device = load_vision()
    class Stop(StoppingCriteria):
        def __call__(self, *args, **kwargs): return cancel.is_set()
    messages = [{'role': 'user', 'content': [{'type': 'image'}, {'type': 'text', 'text': prompt}]}]
    text = processor.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)
    inputs = processor(text=text, images=[image], return_tensors='pt').to(device)
    with torch.inference_mode():
        output = model.generate(**inputs, max_new_tokens=160, do_sample=False, stopping_criteria=StoppingCriteriaList([Stop()]))
    if cancel.is_set(): raise RuntimeError('Cancelled')
    return processor.batch_decode(output[:, inputs['input_ids'].shape[1]:], skip_special_tokens=True)[0]


def image_infer(prompt, cancel):
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError('Image generation requires a CUDA GPU; CPU image generation is intentionally disabled.')
    if 'images' not in loaded:
        from diffusers import StableDiffusionXLPipeline
        config = MODELS['images']
        pipe = StableDiffusionXLPipeline.from_pretrained(config['model'], revision=config['revision'],
                 variant='fp16', torch_dtype=torch.float16, use_safetensors=True,
                 local_files_only=os.environ.get('NOVA_MEDIA_ALLOW_DOWNLOADS') != '1')
        pipe.enable_model_cpu_offload()
        pipe.enable_vae_slicing()
        loaded['images'] = pipe
    def step(_pipe, _step, _time, kwargs):
        if cancel.is_set(): raise RuntimeError('Cancelled')
        return kwargs
    # SSD-1B is an SDXL-family model; keep its native 1024 resolution rather than
    # quietly trading quality for a 512px benchmark. Express makes safe previews.
    with torch.inference_mode():
        image = loaded['images'](prompt=prompt, negative_prompt='blurry, low quality, distorted',
                    width=1024, height=1024, guidance_scale=9.0, num_inference_steps=30,
                    callback_on_step_end=step).images[0]
    if cancel.is_set(): raise RuntimeError('Cancelled')
    output = io.BytesIO()
    image.save(output, format='PNG')
    return base64.b64encode(output.getvalue()).decode('ascii')


async def run(request, function, *args):
    if not lock.acquire(blocking=False): raise HTTPException(429, 'Media worker is busy')
    cancel = threading.Event()
    async def watch():
        while not cancel.is_set():
            if await request.is_disconnected(): cancel.set(); return
            await asyncio.sleep(.2)
    monitor = asyncio.create_task(watch())
    def execute():
        try:
            return function(*args, cancel)
        finally:
            # A disconnected HTTP task must not release the compute slot while
            # its model-loading or GPU thread is still running.
            lock.release()
    try:
        return await asyncio.shield(asyncio.to_thread(execute))
    except Exception as error:
        logging.getLogger('nova.media').exception('Media inference failed: %s', type(error).__name__)
        # Never return a fabricated caption/image or prompt/secret in a failure.
        raise HTTPException(503, f'Media inference unavailable: {type(error).__name__}. Check worker logs/model cache and GPU configuration.') from error
    finally:
        cancel.set()
        monitor.cancel()


class VisionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    model: str
    messages: list = Field(max_length=1, min_length=1)
    max_tokens: int = Field(default=160, ge=1, le=160)
    temperature: float = 0


@app.post('/v1/chat/completions')
async def vision(data: VisionRequest, request: Request):
    if os.environ.get('NOVA_ENABLE_VISION') != '1': raise HTTPException(503, 'Vision is disabled')
    if data.model != MODELS['vision']['model']: raise HTTPException(400, 'Unexpected vision model')
    try:
        content = data.messages[0]['content']
        texts = [part['text'] for part in content if part['type'] == 'text']
        images = [decode_image(part['image_url']['url']) for part in content if part['type'] == 'image_url']
        if len(images) != 1 or len(texts) != 1 or len(texts[0]) > 3000: raise ValueError('One image and one bounded question are required')
    except (ValueError, KeyError, TypeError, UnidentifiedImageError, binascii.Error) as error:
        raise HTTPException(400, 'Invalid image request') from error
    started = time.monotonic()
    answer = await run(request, vision_infer, images[0], texts[0])
    if not answer.strip(): raise HTTPException(503, 'Vision generated no description')
    verified.add('vision')
    return {'model': data.model, 'model_version': MODELS['vision']['revision'],
            'elapsed_seconds': time.monotonic() - started, 'choices': [{'message': {'role': 'assistant', 'content': answer}}]}


class ImageRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    model: str
    prompt: str = Field(min_length=3, max_length=1500)
    n: int = Field(default=1, ge=1, le=1)
    size: str = '512x512'  # Gateway hint; native generation is documented as 1024.
    response_format: str = 'b64_json'


@app.post('/v1/images/generations')
async def generate(data: ImageRequest, request: Request):
    if os.environ.get('NOVA_ENABLE_IMAGES') != '1': raise HTTPException(503, 'Image generation is disabled')
    if data.model != MODELS['images']['model'] or data.response_format != 'b64_json': raise HTTPException(400, 'Unexpected model or response format')
    started = time.monotonic()
    pixels = await run(request, image_infer, data.prompt)
    if not pixels: raise HTTPException(503, 'Image model generated no pixels')
    verified.add('images')
    return {'model': data.model, 'model_version': MODELS['images']['revision'],
            'elapsed_seconds': time.monotonic() - started, 'data': [{'b64_json': pixels}]}


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8090, workers=1)
