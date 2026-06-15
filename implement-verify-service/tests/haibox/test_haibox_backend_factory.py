"""HAIBOX_BACKEND env selects the backend — the one place the choice is made."""

from __future__ import annotations

import pytest

from src.haibox.backends import DockerBackend, LocalSubprocessBackend
from src.haibox.service import _build_backend


def test_default_is_local(monkeypatch):
    monkeypatch.delenv("HAIBOX_BACKEND", raising=False)
    assert isinstance(_build_backend(), LocalSubprocessBackend)


def test_local_explicit(monkeypatch):
    monkeypatch.setenv("HAIBOX_BACKEND", "local")
    assert isinstance(_build_backend(), LocalSubprocessBackend)
    monkeypatch.setenv("HAIBOX_BACKEND", "local-subprocess")
    assert isinstance(_build_backend(), LocalSubprocessBackend)


def test_docker_selected(monkeypatch):
    monkeypatch.setenv("HAIBOX_BACKEND", "docker")
    b = _build_backend()
    assert isinstance(b, DockerBackend) and b.name == "docker"


def test_case_insensitive(monkeypatch):
    monkeypatch.setenv("HAIBOX_BACKEND", "DOCKER")
    assert isinstance(_build_backend(), DockerBackend)


def test_unknown_raises(monkeypatch):
    monkeypatch.setenv("HAIBOX_BACKEND", "k8s")
    with pytest.raises(ValueError, match="unknown backend"):
        _build_backend()
