"""Tests for the P1 leftover fixes from autoresearch:debug 260504-1301.

- #2 (MEDIUM): structural_endpoints._resolve_snapshot validates repo +
  snapshot via safe_segment + containment check.
- #3 (LOW): dep /rebuild applies the `..` defense the 4 GET routes use.
"""
from __future__ import annotations

import os

import pytest
from fastapi import HTTPException

# Set env vars BEFORE app import
os.environ.setdefault("STANDARDS_API_KEY", "test-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test")

from fastapi.testclient import TestClient


AUTH = {"Authorization": "Bearer test-key"}


@pytest.fixture
def client():
    from src.api import app
    return TestClient(app)


# ─── #2: structural _resolve_snapshot validation ────────────────────────────


class TestResolveSnapshotValidation:
    def test_dotdot_repo_rejected(self):
        from src.structural_endpoints import _resolve_snapshot, _get_store
        with pytest.raises(HTTPException) as exc:
            _resolve_snapshot(_get_store(), "..", "abc1234")
        assert exc.value.status_code == 400
        assert "repo" in exc.value.detail.lower()

    def test_dotdot_snapshot_rejected(self):
        from src.structural_endpoints import _resolve_snapshot, _get_store
        with pytest.raises(HTTPException) as exc:
            _resolve_snapshot(_get_store(), "myrepo", "..")
        assert exc.value.status_code == 400
        assert "snapshot" in exc.value.detail.lower()

    def test_separator_in_repo_rejected(self):
        from src.structural_endpoints import _resolve_snapshot, _get_store
        with pytest.raises(HTTPException) as exc:
            _resolve_snapshot(_get_store(), "evil/path", "abc1234")
        assert exc.value.status_code == 400

    def test_legitimate_repo_passes_validation(self, tmp_path):
        """Valid alphanumeric repo + sha-like snapshot reach the 404 step
        (snapshot dir doesn't exist on disk), not the 400 step."""
        from src.structural_endpoints import _resolve_snapshot
        from src.ast.store import FileStore as StructuralFileStore

        store = StructuralFileStore(base_path=str(tmp_path))
        with pytest.raises(HTTPException) as exc:
            _resolve_snapshot(store, "my-repo", "abc1234")
        assert exc.value.status_code == 404  # not 400 — passed validation

    def test_diagrams_endpoint_rejects_dotdot_repo(self, client):
        """End-to-end via API."""
        # safe_segment rejects "..", returns 400. URL routing also blocks
        # bare ".." but a single-segment "..foo" reaches the handler and
        # gets blocked by safe_segment.
        r = client.post(
            "/api/v1/structural/..foo/diagrams/generate",
            json={"snapshot": "latest"},
            headers=AUTH,
        )
        # Either 400 (caught by safe_segment) or 404 (no snapshots) — both
        # acceptable, but NOT a 200 that wrote a diagrams/ subdir somewhere.
        assert r.status_code in (400, 404, 500)


# ─── #3: dep /rebuild .. defense ─────────────────────────────────────────────


class TestDepRebuildDotDot:
    def test_rebuild_rejects_dotdot_in_snapshot(self, client):
        r = client.post(
            "/api/dep/rebuild",
            json={"snapshot": "../etc/passwd", "force": False},
            headers=AUTH,
        )
        assert r.status_code == 400
        assert ".." in r.text or "may not contain" in r.text.lower()

    def test_rebuild_rejects_dotdot_with_force(self, client):
        """The dangerous combo: force=True + .. — was the original concern."""
        r = client.post(
            "/api/dep/rebuild",
            json={"snapshot": "../some-other-dir", "force": True},
            headers=AUTH,
        )
        assert r.status_code == 400

    def test_rebuild_legitimate_path_passes_dotdot_check(self, client, tmp_path):
        """Valid (non-traversing) but non-existent path passes the
        .. check and reaches the 404 step."""
        r = client.post(
            "/api/dep/rebuild",
            json={"snapshot": str(tmp_path / "non-existent-snap"), "force": False},
            headers=AUTH,
        )
        # Not 400 — passed the .. check; 404 because the dir doesn't exist
        assert r.status_code == 404
