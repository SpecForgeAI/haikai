"""Offline real tests for Environments & Deployments: normalizers + stop guard."""

from types import SimpleNamespace

import pytest

from src.connectors.gitlab import environments
from src.connectors.gitlab.client import ConfirmationRequired


def test_env_to_dict_maps_core_fields():
    obj = SimpleNamespace(attributes={
        "id": 11, "name": "production", "state": "available",
        "external_url": "https://prod.example.com", "tier": "production",
    })
    d = environments._env_to_dict(obj)
    assert d["name"] == "production" and d["state"] == "available" and d["tier"] == "production"


def test_deployment_to_dict_flattens_environment_name():
    obj = SimpleNamespace(attributes={
        "id": 99, "iid": 5, "status": "success", "ref": "main", "sha": "deadbeef",
        "environment": {"name": "production"},
    })
    d = environments._deployment_to_dict(obj)
    assert d["status"] == "success" and d["environment"] == "production"


def test_stop_environment_requires_confirm():
    with pytest.raises(ConfirmationRequired):
        environments.stop_environment("group/proj", 11, confirm=False)
