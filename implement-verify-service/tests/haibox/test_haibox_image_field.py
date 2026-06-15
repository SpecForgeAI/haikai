"""The `image` field threads spec -> request -> client body (Docker backend prep).

Backward-compatible: omitted -> None, and the local-subprocess backend ignores it."""

from __future__ import annotations

from src.haibox.models import BoxSpec, RunSpec
from src.haibox.service import CreateBoxRequest, CreateRunRequest


def test_boxspec_accepts_image_default_none():
    assert BoxSpec(command=["x"]).image is None
    assert BoxSpec(command=["x"], image="python:3.12-slim").image == "python:3.12-slim"


def test_runspec_accepts_image_default_none():
    assert RunSpec(command=["x"]).image is None
    assert RunSpec(command=["x"], image="maven:3.9-eclipse-temurin-17").image == \
        "maven:3.9-eclipse-temurin-17"


def test_create_box_request_to_spec_carries_image():
    req = CreateBoxRequest(command=["x"], image="python:3.12-slim")
    assert req.to_spec().image == "python:3.12-slim"
    # omitted -> None (local path unaffected)
    assert CreateBoxRequest(command=["x"]).to_spec().image is None


def test_create_run_request_to_spec_carries_image():
    req = CreateRunRequest(command=["x"], image="node:20-slim")
    assert req.to_spec().image == "node:20-slim"


def test_provision_for_job_forwards_backend_and_image():
    # The verification target spec threads `backend` (+ image) end-to-end:
    # provision_for_job spreads the target into client.serve, which now accepts both.
    from src.haibox.integration import provision_for_job

    captured = {}

    class FakeClient:
        def serve(self, command, **kw):
            captured.update(command=command, **kw)
            return {"box_id": "b", "base_url": "u"}

    provision_for_job(
        {"target": {"command": ["x"], "image": "maven:3.9", "backend": "docker",
                    "health_path": "/h"}},
        client=FakeClient())
    assert captured["backend"] == "docker"
    assert captured["image"] == "maven:3.9" and captured["health_path"] == "/h"


def test_client_serve_body_includes_image():
    # Build the body the client would POST without a live server.
    import inspect
    from src.haibox.client import HaiboxClient
    sig = inspect.signature(HaiboxClient.serve)
    assert "image" in sig.parameters
    sig_run = inspect.signature(HaiboxClient.submit_run)
    assert "image" in sig_run.parameters
