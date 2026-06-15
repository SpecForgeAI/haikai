"""Tests for /api/discovery REST endpoints (V1 standalone surface).

These tests mock both the LLM client and `discover_endpoints` so they don't
spawn subprocesses or hit external APIs. The point is to verify the route
wiring, request validation, and response shape — not the discovery loop
itself, which has its own coverage in tests/test_v1_reporter_loader.py.
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.discovery_routes import router
from src.ast.models import EndpointInfo
import src.ast.endpoint_discoverer  # noqa: F401 — required so unittest.mock.patch can resolve the dotted target


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


@pytest.fixture
def snapshot(tmp_path: Path) -> Path:
    """A directory that looks like a structural-store snapshot."""
    snap = tmp_path / "snap"
    snap.mkdir()
    (snap / "_index.txt").write_text("# fake index", encoding="utf-8")
    return snap


@pytest.fixture
def project(tmp_path: Path) -> Path:
    p = tmp_path / "project"
    p.mkdir()
    return p


class _FakeLLMClient:
    """Stand-in for src.llm_client.LLMClient with the attributes V1 uses."""
    def __init__(self, provider: str = "openai", model: str = "gpt-test"):
        self.provider = provider
        self.model = model
        self.log_dir = None


def test_missing_project_root_returns_404(client, snapshot):
    r = client.post("/api/discovery/endpoints", json={
        "project_root": "/does/not/exist/anywhere",
        "snapshot_path": str(snapshot),
        "model": "gpt-test",
    })
    assert r.status_code == 404
    assert "project_root not found" in r.json()["detail"]


def test_missing_snapshot_returns_404(client, project):
    r = client.post("/api/discovery/endpoints", json={
        "project_root": str(project),
        "snapshot_path": "/does/not/exist",
        "model": "gpt-test",
    })
    assert r.status_code == 404
    assert "snapshot_path not found" in r.json()["detail"]


def test_snapshot_without_index_returns_400(client, project, tmp_path):
    bare = tmp_path / "bare"
    bare.mkdir()
    r = client.post("/api/discovery/endpoints", json={
        "project_root": str(project),
        "snapshot_path": str(bare),
        "model": "gpt-test",
    })
    assert r.status_code == 400
    assert "_index.txt" in r.json()["detail"]


def test_build_llm_client_no_provider_raises_400(monkeypatch):
    """No provider anywhere → HTTPException 400."""
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.setenv("LLM_MODEL", "anything")
    from src.api.discovery_routes import _build_llm_client
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        _build_llm_client(None, None, None)
    assert exc.value.status_code == 400
    assert "provider" in exc.value.detail.lower()


def test_build_llm_client_no_model_raises_400(monkeypatch):
    """No model anywhere → HTTPException 400."""
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.delenv("LLM_MODEL", raising=False)
    from src.api.discovery_routes import _build_llm_client
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        _build_llm_client(None, None, None)
    assert exc.value.status_code == 400
    assert "model" in exc.value.detail.lower()


def test_build_llm_client_custom_without_base_url_raises_400(monkeypatch):
    """provider='custom' without LLM_BASE_URL → HTTPException 400."""
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    from src.api.discovery_routes import _build_llm_client
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        _build_llm_client("custom", "any-model", None)
    assert exc.value.status_code == 400
    assert "LLM_BASE_URL" in exc.value.detail


def test_build_llm_client_request_overrides_env(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "ignored")
    monkeypatch.setenv("LLM_MODEL", "ignored")
    captured = {}

    class _Capture:
        def __init__(self, provider, model, **kw):
            captured["provider"], captured["model"] = provider, model
            self.provider, self.model = provider, model

    with patch("src.llm_client.LLMClient", _Capture):
        from src.api.discovery_routes import _build_llm_client
        _build_llm_client("openai", "gpt-test", None)

    assert captured["provider"] == "openai"
    assert captured["model"] == "gpt-test"


def test_happy_path_returns_endpoints(client, project, snapshot):
    fake_eps = [
        EndpointInfo(
            type="REST", path="/users", operation="GET",
            handler_class="UserController", handler_method="list",
            file="src/users.py", line=10, framework="fastapi",
        ),
        EndpointInfo(
            type="REST", path="/users/{id}", operation="GET",
            handler_class="UserController", handler_method="get",
            file="src/users.py", line=20, framework="fastapi",
        ),
    ]
    with patch("src.api.discovery_routes._build_llm_client",
               return_value=_FakeLLMClient(provider="openai", model="gpt-test")), \
         patch("src.ast.endpoint_discoverer.discover_endpoints",
               return_value=fake_eps):
        r = client.post("/api/discovery/endpoints", json={
            "project_root": str(project),
            "snapshot_path": str(snapshot),
            "model": "gpt-test",
        })
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 2
    assert body["provider"] == "openai"
    assert body["model"] == "gpt-test"
    assert body["endpoints"][0]["path"] == "/users"
    assert body["endpoints"][1]["path"] == "/users/{id}"


def test_discovery_failure_returns_500(client, project, snapshot):
    with patch("src.api.discovery_routes._build_llm_client",
               return_value=_FakeLLMClient()), \
         patch("src.ast.endpoint_discoverer.discover_endpoints",
               side_effect=RuntimeError("subprocess died")):
        r = client.post("/api/discovery/endpoints", json={
            "project_root": str(project),
            "snapshot_path": str(snapshot),
            "model": "gpt-test",
        })
    assert r.status_code == 500
    assert "subprocess died" in r.json()["detail"]


def test_build_llm_client_custom_uses_env_base_url(monkeypatch):
    """provider='custom' with LLM_BASE_URL set passes it through to the client."""
    monkeypatch.setenv("LLM_BASE_URL", "http://example.invalid/v1")
    captured = {}

    class _Capture:
        def __init__(self, provider, model, **kw):
            captured["kwargs"] = kw
            self.provider, self.model = provider, model

    with patch("src.llm_client.LLMClient", _Capture):
        from src.api.discovery_routes import _build_llm_client
        _build_llm_client("custom", "any-model", None)

    assert captured["kwargs"]["base_url"] == "http://example.invalid/v1"


# ─── Trace endpoint security ─────────────────────────────────────────────────

class TestTraceEndpointSecurity:
    """Regression tests for the path-traversal vulnerability in GET /api/discovery/trace.

    The endpoint used to interpolate `discovery` and `model` directly into a
    filename, letting an attacker escape the temp dir with `\\..\\..\\file`.
    """

    def test_invalid_discovery_value_rejected(self, client):
        r = client.get("/api/discovery/trace", params={"discovery": "x", "model": "anything"})
        assert r.status_code == 422  # FastAPI Literal validation

    def test_traversal_via_backslash_in_model_rejected(self, client):
        r = client.get("/api/discovery/trace", params={
            "discovery": "endpoint", "model": r"\..\..\STOLEN",
        })
        assert r.status_code == 400
        assert "invalid model" in r.json()["detail"].lower()

    def test_traversal_via_forward_slash_in_model_rejected(self, client):
        r = client.get("/api/discovery/trace", params={
            "discovery": "endpoint", "model": "../../STOLEN",
        })
        assert r.status_code == 400

    def test_dotdot_only_model_rejected(self, client):
        r = client.get("/api/discovery/trace", params={
            "discovery": "endpoint", "model": ".."
        })
        assert r.status_code == 400

    def test_legitimate_model_name_allowed(self, client, tmp_path, monkeypatch):
        # gettempdir() must point at a writable dir so the trace lookup succeeds.
        monkeypatch.setenv("TMPDIR", str(tmp_path))
        monkeypatch.setenv("TEMP", str(tmp_path))
        monkeypatch.setenv("TMP", str(tmp_path))
        # Plant a real trace file with a normal model name
        import tempfile
        # tempfile caches gettempdir on first call; clear it
        tempfile.tempdir = str(tmp_path)
        (tmp_path / "endpoint_trace_claude-sonnet-4-6.json").write_text(
            '[{"role": "user", "content": "hi"}]', encoding="utf-8"
        )
        r = client.get("/api/discovery/trace", params={
            "discovery": "endpoint", "model": "claude-sonnet-4-6"
        })
        assert r.status_code == 200
        assert r.json()["turns"] == 1
        tempfile.tempdir = None  # reset

    def test_404_does_not_leak_server_path(self, client):
        r = client.get("/api/discovery/trace", params={
            "discovery": "endpoint", "model": "definitely-no-such-model"
        })
        assert r.status_code == 404
        # Detail should not include any filesystem paths
        detail = r.json()["detail"]
        assert "\\" not in detail and "/" not in detail
        assert detail == "trace not found"
