"""Regression: mounted routers (dep/refactor/discovery) must enforce auth.

Before the fix, these three routers were mounted without
`Depends(verify_api_key)`, so all 12 endpoints behind them were reachable
unauthenticated even though every other route in the app required a Bearer
token. This made the entire `/api/discovery/*`, `/api/dep/*`, and
`/api/refactor/*` surface a privilege escalation vector — including the
destructive `POST /api/refactor/rename-apply`.
"""
from __future__ import annotations

import os

import pytest


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("STANDARDS_API_KEY", "test-secret")
    # Force re-import so the new env var is picked up
    import importlib
    import src.api as api_pkg
    importlib.reload(api_pkg)
    from fastapi.testclient import TestClient
    return TestClient(api_pkg.app)


@pytest.mark.parametrize("path", [
    "/api/discovery/trace?model=anything",
    "/api/dep/processes?snapshot=/tmp/x",
    "/api/dep/impact?snapshot=/tmp/x&symbol=foo",
    "/api/refactor/staleness?snapshot=/tmp/x&repo=/tmp/y",
    "/api/refactor/detect?snapshot=/tmp/x&repo=/tmp/y",
])
def test_router_endpoint_requires_auth(client, path):
    """No auth header → 401."""
    r = client.get(path)
    assert r.status_code == 401, f"{path} returned {r.status_code} without auth — auth bypass!"


@pytest.mark.parametrize("path", [
    "/api/discovery/trace?model=anything",
    "/api/dep/processes?snapshot=/tmp/x",
    "/api/refactor/staleness?snapshot=/tmp/x&repo=/tmp/y",
])
def test_router_endpoint_rejects_wrong_key(client, path):
    r = client.get(path, headers={"Authorization": "Bearer wrong-key"})
    assert r.status_code == 401, f"{path} accepted wrong key"


def test_router_endpoint_accepts_correct_key(client):
    """Sanity: with correct key, auth passes (gets to route logic, fails on missing snapshot)."""
    r = client.get("/api/dep/processes?snapshot=/definitely/no/such/path",
                   headers={"Authorization": "Bearer test-secret"})
    assert r.status_code == 404  # auth passed; snapshot lookup failed
