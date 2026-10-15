"""Resumable LoRA checkpoints, including optimizer/scaler/RNG and dataset/model identity."""
import json
from pathlib import Path
import random
import uuid


def save_checkpoint(model, optimizer, scaler, root, step, order, losses, identity):
    import torch
    root = Path(root); root.mkdir(parents=True, exist_ok=True)
    final = root / f'checkpoint-{step:06d}'
    if final.exists(): raise FileExistsError(f'Refusing to overwrite {final}')
    temporary = root / f'.checkpoint-{step:06d}-{uuid.uuid4().hex}'
    temporary.mkdir()
    model.save_pretrained(temporary, safe_serialization=True)
    torch.save({'optimizer': optimizer.state_dict(), 'scaler': scaler.state_dict(), 'step': step,
        'order': order, 'losses': losses, 'python_rng': random.getstate(), 'torch_rng': torch.get_rng_state(),
        'cuda_rng': torch.cuda.get_rng_state_all() if torch.cuda.is_available() else []}, temporary / 'trainer-state.pt')
    (temporary / 'checkpoint.json').write_text(json.dumps({'identity': identity, 'optimizer_steps_completed': step}, indent=2))
    temporary.rename(final)
    return final


def resume_checkpoint(model, optimizer, scaler, directory, identity):
    import torch
    from peft import set_peft_model_state_dict
    from safetensors.torch import load_file
    directory = Path(directory)
    metadata = json.loads((directory / 'checkpoint.json').read_text())
    if metadata['identity'] != identity:
        raise ValueError('Checkpoint model, dataset or training hyperparameters do not match this run')
    result = set_peft_model_state_dict(model, load_file(directory / 'adapter_model.safetensors'))
    if result.unexpected_keys: raise ValueError('Adapter checkpoint has incompatible parameter keys')
    state = torch.load(directory / 'trainer-state.pt', map_location='cpu', weights_only=True)
    if state['step'] != metadata['optimizer_steps_completed'] or len(state['losses']) != state['step']:
        raise ValueError('Inconsistent optimizer step metadata')
    optimizer.load_state_dict(state['optimizer']); scaler.load_state_dict(state['scaler'])
    random.setstate(state['python_rng']); torch.set_rng_state(state['torch_rng'])
    if state['cuda_rng']:
        if not torch.cuda.is_available(): raise ValueError('CUDA checkpoint requires CUDA to resume')
        torch.cuda.set_rng_state_all(state['cuda_rng'])
    return state
