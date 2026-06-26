"""Offline, real (no-mock) tests for the Runners verbs.

Covered here without the network: the pure `_runner_to_dict` normalizer (our
transform, not GitLab behaviour) and the `confirm` guard on destructive verbs
(which rejects before any client/network). Actual list/get/pause/resume/delete
against GitLab live in `test_runners_seam.py` (token-gated).
"""

from types import SimpleNamespace

import pytest

from src.connectors.gitlab import runners
from src.connectors.gitlab.client import ConfirmationRequired


def test_runner_to_dict_maps_core_fields():
    obj = SimpleNamespace(attributes={
        "id": 7,
        "description": "docker-runner-1",
        "active": True,
        "paused": False,
        "online": True,
        "status": "online",
        "tag_list": ["docker", "linux"],
        "runner_type": "instance_type",
    })
    d = runners._runner_to_dict(obj)
    assert d["id"] == 7
    assert d["description"] == "docker-runner-1"
    assert d["paused"] is False
    assert d["tag_list"] == ["docker", "linux"]
    assert d["runner_type"] == "instance_type"


def test_runner_to_dict_infers_paused_from_inactive():
    # GitLab omits `paused` on older payloads; fall back to `not active`.
    obj = SimpleNamespace(attributes={"id": 9, "active": False})
    assert runners._runner_to_dict(obj)["paused"] is True


def test_pause_runner_requires_confirm():
    with pytest.raises(ConfirmationRequired):
        runners.pause_runner(1, confirm=False)


def test_delete_runner_requires_confirm():
    with pytest.raises(ConfirmationRequired):
        runners.delete_runner(1, confirm=False)
