"""Backend registry + per-backend validate_spec — the N-backend seam.

Proves adding a backend is "implement the Protocol + one register_backend(...)" with
no edits to the service factory, alias resolution, or the resolver."""

from __future__ import annotations

import pytest

from src.haibox import backends
from src.haibox.backends import (DockerBackend, LocalSubprocessBackend,
                                  backend_aliases, build_backends, register_backend)
from src.haibox.models import BoxSpec
from src.haibox.service import canonical_backend


def test_registry_builds_registered_backends():
    m = build_backends()
    assert {"local-subprocess", "docker", "remote-ssh"} <= set(m)
    assert isinstance(m["local-subprocess"], LocalSubprocessBackend)
    assert isinstance(m["docker"], DockerBackend)


def test_aliases_from_registry():
    a = backend_aliases()
    assert a["local"] == "local-subprocess" and a["local-subprocess"] == "local-subprocess"
    assert a["docker"] == "docker"
    assert canonical_backend("local") == "local-subprocess"
    with pytest.raises(ValueError, match="unknown backend"):
        canonical_backend("k8s")


def test_validate_spec_is_per_backend():
    # The precondition lives on the backend now, not in a resolver `if`.
    LocalSubprocessBackend().validate_spec(BoxSpec(command=["x"]))  # no-op, no raise
    with pytest.raises(ValueError, match="image"):
        DockerBackend().validate_spec(BoxSpec(command=["x"]))  # docker needs an image
    DockerBackend().validate_spec(BoxSpec(command=["x"], image="img"))  # ok


def test_third_backend_registers_with_zero_plumbing_edits():
    # Adding a backend = implement the Protocol + ONE register_backend(...) line.
    # A new name then flows through build_backends + alias resolution with NO edit
    # to _build_backends / canonical_backend / the resolver.
    snapshot = dict(backends._BACKEND_REGISTRY)
    try:
        class FakeSSH:
            name = "remote-ssh"
            def launch(self, *a): ...
            def is_alive(self, h): return True
            def stop(self, h): ...
            def cleanup(self, h): ...
            def read_log(self, h, max_bytes=0): return ""
            def terminate(self, h): ...
            def start_run(self, *a): ...
            def returncode(self, h): return None
            def sweep_orphans(self, wr): return []
            def validate_spec(self, spec):
                if not getattr(spec, "host", None):
                    raise ValueError("remote-ssh requires a host")

        register_backend("remote-ssh", FakeSSH, aliases=("ssh",))
        m = build_backends()
        assert "remote-ssh" in m and isinstance(m["remote-ssh"], FakeSSH)
        assert canonical_backend("ssh") == "remote-ssh"
        assert canonical_backend("remote-ssh") == "remote-ssh"
    finally:
        backends._BACKEND_REGISTRY.clear()
        backends._BACKEND_REGISTRY.update(snapshot)
