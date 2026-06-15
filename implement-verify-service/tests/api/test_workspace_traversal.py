"""Regression: company/project params can't traverse outside API_WORKSPACE_DIR.

Five sites in src/api/__init__.py used to do
`API_WORKSPACE_DIR / request.company / request.project` directly. With
attacker-controlled company/project, `company=".."` would escape the
workspace. They now go through `_safe_project_dir` which calls
`sanitize_path` (rejects `..`, asserts result is within workspace).

Also covers the dep_routes/refactor_routes _open_graph hardening — `..`
in snapshot path → 400, missing marker file → 400.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("STANDARDS_API_KEY", "test-secret")
    monkeypatch.setenv("API_WORKSPACE_DIR", str(tmp_path / "workspace"))
    import importlib
    import src.api as api_pkg
    importlib.reload(api_pkg)
    from fastapi.testclient import TestClient
    return TestClient(api_pkg.app)


def test_safe_project_dir_blocks_dotdot(client, monkeypatch):
    """company='..' must be rejected by sanitize_path."""
    from src.api import _safe_project_dir
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        _safe_project_dir("..", "anything")
    assert exc.value.status_code == 400


def test_safe_project_dir_blocks_absolute(client, monkeypatch):
    """An absolute path in company would escape via the path-join — rejected."""
    from src.api import _safe_project_dir
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        _safe_project_dir("/etc/passwd", "x")
    assert exc.value.status_code == 400


def test_safe_project_dir_normal_case(client, monkeypatch):
    """Plain identifiers resolve cleanly under workspace."""
    from src.api import _safe_project_dir, API_WORKSPACE_DIR
    p = _safe_project_dir("acme", "backend")
    assert p == (API_WORKSPACE_DIR / "acme" / "backend").resolve()


# ─── _open_graph hardening (dep_routes + refactor_routes) ────────────────────


def test_dep_open_graph_rejects_dotdot(client):
    H = {"Authorization": "Bearer test-secret"}
    r = client.get("/api/dep/processes?snapshot=../etc/passwd", headers=H)
    assert r.status_code == 400
    assert ".." in r.json()["detail"]


def test_dep_open_graph_404_no_path_leak(client):
    """404 detail no longer contains the path."""
    H = {"Authorization": "Bearer test-secret"}
    r = client.get("/api/dep/processes?snapshot=/totally/no/such/path", headers=H)
    assert r.status_code == 404
    assert "/totally/no/such/path" not in r.json()["detail"]


def test_dep_open_graph_rejects_dir_without_marker(client, tmp_path):
    """Plain directories without _index.txt or _depgraph.sqlite get rejected."""
    bare = tmp_path / "bare-dir"
    bare.mkdir()
    H = {"Authorization": "Bearer test-secret"}
    r = client.get(f"/api/dep/processes?snapshot={bare}", headers=H)
    assert r.status_code == 400
    assert "_index.txt" in r.json()["detail"] or "_depgraph.sqlite" in r.json()["detail"]


def test_refactor_open_graph_rejects_dotdot(client):
    H = {"Authorization": "Bearer test-secret"}
    r = client.get("/api/refactor/staleness?snapshot=../x&repo=/x", headers=H)
    assert r.status_code == 400
