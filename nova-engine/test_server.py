"""Protocol/security tests only. No model assets are downloaded or generated here."""
import base64
import importlib.util
import io
from pathlib import Path

import pytest
from PIL import Image
from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location('nova_media_server', Path(__file__).with_name('server.py'))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


def test_authentication_is_required_and_missing_configuration_fails_closed(monkeypatch):
    client = TestClient(server.app)
    monkeypatch.setattr(server, 'TOKEN', '')
    assert client.get('/health').status_code == 503
    monkeypatch.setattr(server, 'TOKEN', 'test-private-key-at-least-24-characters')
    assert client.get('/health').status_code == 401
    assert client.get('/health', headers={'Authorization': 'Bearer ' + server.TOKEN}).json()['inference_verified'] is False


def test_real_image_content_validation_blocks_urls_and_fake_images():
    for value in ['https://example.com/private.png', 'data:image/png;base64,' + base64.b64encode(b'not pixels').decode()]:
        with pytest.raises(Exception): server.decode_image(value)
    image = Image.new('RGB', (32, 32), 'blue')
    out = io.BytesIO(); image.save(out, format='PNG')
    actual = server.decode_image('data:image/png;base64,' + base64.b64encode(out.getvalue()).decode())
    assert actual.size == (32, 32)


def test_disabled_inference_does_not_load_weights(monkeypatch):
    monkeypatch.setattr(server, 'TOKEN', 'test-private-key-at-least-24-characters')
    monkeypatch.delenv('NOVA_ENABLE_IMAGES', raising=False)
    client = TestClient(server.app)
    response = client.post('/v1/images/generations', headers={'Authorization': 'Bearer ' + server.TOKEN}, json={'model': server.MODELS['images']['model'], 'prompt': 'A black suit'})
    assert response.status_code == 503
    assert not server.loaded
