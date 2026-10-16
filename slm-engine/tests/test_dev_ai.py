"""Development launcher ownership and readiness checks without starting any app."""
import importlib.util
from pathlib import Path
import sys
from unittest.mock import Mock

import pytest

TOOLS=Path(__file__).resolve().parents[1]/'tools'
sys.path.insert(0,str(TOOLS))
spec=importlib.util.spec_from_file_location('dev_ai',TOOLS/'dev_ai.py')
dev=importlib.util.module_from_spec(spec);spec.loader.exec_module(dev)


def test_reuse_requires_real_generation_not_only_health(monkeypatch):
    replies=iter([{'status':'ok'},{'data':[{'id':dev.CONFIG['alias']}]},{'model':dev.CONFIG['alias'],'choices':[{'message':{'content':'READY'}}],'usage':{'completion_tokens':1}}])
    request=Mock(side_effect=lambda *a,**k:next(replies))
    monkeypatch.setattr(dev,'local_json',request)
    dev.verify_slm()
    assert request.call_args_list[-1].args[1]=='/v1/chat/completions'


def test_unrelated_listener_is_not_reused(monkeypatch):
    monkeypatch.setattr(dev,'local_json',Mock(side_effect=[{'status':'ok'},{'data':[{'id':'unrelated-model'}]}]))
    with pytest.raises(RuntimeError,match='different model'):dev.verify_slm()


def test_loading_without_generation_is_not_ready(monkeypatch):
    monkeypatch.setattr(dev,'local_json',Mock(side_effect=[{'status':'ok'},{'data':[{'id':dev.CONFIG['alias']}]},{'model':dev.CONFIG['alias'],'choices':[{'message':{'content':''}}],'usage':{'completion_tokens':0}}]))
    with pytest.raises(RuntimeError,match='failed actual'):dev.verify_slm()


def test_child_failure_during_startup_is_not_retried():
    child=Mock();child.poll.return_value=7;child.returncode=7
    with pytest.raises(RuntimeError,match='code 7'):dev.wait_until(lambda:False,[('slm',child)],[],1,'Qwen')
    child.poll.assert_called_once()


def test_owned_cleanup_never_touches_reused_server():
    assert dev.stop_owned([],intentional=True,grace=0) is False


def test_occupied_app_port_fails_before_spawning(monkeypatch):
    monkeypatch.setattr(dev,'port_open',lambda port:True)
    spawn=Mock();monkeypatch.setattr(dev.subprocess,'Popen',spawn)
    # Avoid modifying the test process' signal handlers/cwd.
    monkeypatch.setattr(dev.signal,'signal',Mock())
    monkeypatch.setattr(dev.os,'chdir',Mock())
    assert dev.main()==1
    spawn.assert_not_called()


def test_empty_generation_choices_are_reported_as_readiness_failure(monkeypatch):
    monkeypatch.setattr(dev,'local_json',Mock(side_effect=[{'status':'ok'},{'data':[{'id':dev.CONFIG['alias']}]},{'model':dev.CONFIG['alias'],'choices':[]}]))
    with pytest.raises(RuntimeError,match='failed actual'):dev.verify_slm()
