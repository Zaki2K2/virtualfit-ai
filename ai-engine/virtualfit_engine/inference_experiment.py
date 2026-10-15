"""Pinned real vision experiment. Explicit person/garment/mask, CUDA required before downloads."""
import argparse
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import shutil
import time

ROOT = Path(__file__).resolve().parents[1]


def require_gpu(config):
    import torch
    if not torch.cuda.is_available(): raise RuntimeError('Real vision inference requires a cloud CUDA GPU; no local model download attempted')
    free, _total = torch.cuda.mem_get_info()
    if free < config['minimum_free_vram_gib'] * 1024**3: raise RuntimeError('Insufficient free GPU memory')


def run(person_path, garment_path, mask_path, output, config, steps=None):
    require_gpu(config)
    import torch
    from PIL import Image
    from huggingface_hub import snapshot_download
    from .models import EngineModels, ModelPaths
    from .images import load_image_bytes, to_png_bytes
    from .preprocessing import mask_to_array, validate_mask, prepare_inputs
    from .postprocessing import repaint
    from .training.config import ATTN_SUBFOLDERS
    if shutil.disk_usage(output.parent if output.parent.exists() else ROOT).free < config['minimum_free_disk_gib'] * 1024**3:
        raise RuntimeError('Need at least 12 GiB free disk before vision weight download')
    person = load_image_bytes(person_path.read_bytes(), 'person', 8*1024**2)
    garment = load_image_bytes(garment_path.read_bytes(), 'garment', 8*1024**2)
    if mask_path.stat().st_size > 8*1024**2: raise ValueError('Mask is larger than 8 MiB')
    with Image.open(mask_path) as raw:
        if raw.size != person.size: raise ValueError('Mask and person dimensions must match')
        mask = raw.convert('L')
    valid, why = validate_mask(mask_to_array(mask))
    if not valid: raise ValueError(why)
    # Fixed snapshots become local paths. EngineModels can already load local snapshot directories.
    base = snapshot_download(config['base_model'], revision=config['base_revision'], allow_patterns=['unet/*', 'scheduler/*'])
    vae = snapshot_download(config['vae_model'], revision=config['vae_revision'])
    attention = snapshot_download(config['attention_model'], revision=config['attention_revision'], allow_patterns=[f"{ATTN_SUBFOLDERS[config['attention_variant']]}/attention/*"])
    paths = ModelPaths(base_model=base, vae_model=vae, attn_repo=attention, attn_version=config['attention_variant'], height=config['height'], width=config['width'])
    models = EngineModels(paths)
    pipe = models.pipeline('pretrained')
    torch.manual_seed(config['seed']); torch.cuda.manual_seed_all(config['seed'])
    generator = torch.Generator(device='cpu').manual_seed(config['seed'])
    count = steps if steps is not None else config['steps']
    if not 1 <= count <= 100: raise ValueError('Steps must be 1-100')
    started = time.perf_counter()
    result = pipe(person, garment, mask, count, config['guidance'], config['height'], config['width'], generator)
    inputs = prepare_inputs(person, garment, mask, config['width'], config['height'])
    result = repaint(inputs.person, inputs.mask, result)
    output.mkdir(parents=True, exist_ok=True)
    image = to_png_bytes(result); (output / 'result.png').write_bytes(image)
    report = {'simulated': False, 'smoke_only': count == 1, 'steps_executed': count, 'config': config,
        'cuda_device': torch.cuda.get_device_name(0), 'torch_version': torch.__version__, 'resolved_paths': asdict(paths),
        'elapsed_seconds': time.perf_counter()-started, 'result_sha256': hashlib.sha256(image).hexdigest(),
        'input_sha256': {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in [('person',person_path),('garment',garment_path),('mask',mask_path)]}}
    (output/'manifest.json').write_text(json.dumps(report, indent=2))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['person', 'garment', 'mask', 'output']: parser.add_argument('--'+name, type=Path, required=True)
    parser.add_argument('--config', type=Path, default=ROOT/'configs/inference-experiment.json')
    parser.add_argument('--steps', type=int)
    args=parser.parse_args()
    run(args.person,args.garment,args.mask,args.output,json.loads(args.config.read_text()),args.steps)
