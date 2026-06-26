"""Offline real tests for Pipelines & Jobs: pure normalizers + the cancel guard.
Live list/trigger/retry/cancel against GitLab live in test_seam_project.py.
"""

from types import SimpleNamespace

import pytest

from src.connectors.gitlab import pipelines
from src.connectors.gitlab.client import ConfirmationRequired


def test_pipeline_to_dict_maps_core_fields():
    obj = SimpleNamespace(attributes={
        "id": 42, "status": "success", "ref": "main",
        "sha": "abc123", "source": "push", "web_url": "https://gitlab.com/p/-/pipelines/42",
    })
    d = pipelines._pipeline_to_dict(obj)
    assert d["id"] == 42 and d["status"] == "success" and d["ref"] == "main"


def test_job_to_dict_maps_core_fields():
    obj = SimpleNamespace(attributes={
        "id": 7, "name": "build", "stage": "build", "status": "failed", "allow_failure": False,
    })
    d = pipelines._job_to_dict(obj)
    assert d["name"] == "build" and d["status"] == "failed" and d["allow_failure"] is False


def test_cancel_pipeline_requires_confirm():
    with pytest.raises(ConfirmationRequired):
        pipelines.cancel_pipeline("group/proj", 42, confirm=False)
