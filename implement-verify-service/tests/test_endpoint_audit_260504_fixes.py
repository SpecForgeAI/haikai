"""Regression tests for the autoresearch:debug 260504-1229 endpoint-audit fixes.

Five findings landed in this commit:
- #1 (HIGH): 17 endpoint sites bypassed _safe_project_dir; replaced with helper.
- #2 (HIGH): spec_name URL param unvalidated in package endpoints; now safe_segment.
- #3 (MEDIUM): /api/v1/analyze-repo/stream's repo_path unvalidated; now workspace-bounded.
- #4 (MEDIUM): SSE handlers leak thread/subprocess on disconnect; now use stop_flag.
- #5 (LOW): orchestration_id URL param allowed `..` traversal; now format-validated.
"""
from __future__ import annotations

import os
import threading

import pytest

# Set env vars BEFORE importing the app module
os.environ.setdefault("STANDARDS_API_KEY", "test-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test")

from fastapi.testclient import TestClient

AUTH = {"Authorization": "Bearer test-key"}


@pytest.fixture
def client():
    from src.api import app
    return TestClient(app)


# ─── #1: company/project validated across endpoints ─────────────────────────


class TestCompanyProjectValidation:
    """Endpoints that build paths from company/project must reject ..-traversal."""

    def test_shape_spec_history_rejects_traversal(self, client):
        r = client.get(
            "/api/v1/shape-spec/history",
            params={"company": "..", "project": "x"},
            headers=AUTH,
        )
        # _safe_project_dir raises ValueError → bubbles up to 500 unless
        # handler catches. Either way: not 200 with leaked file content.
        assert r.status_code in (400, 500), (
            f"expected 4xx/5xx, got {r.status_code}: {r.text[:200]}"
        )

    def test_plan_product_history_rejects_traversal(self, client):
        r = client.get(
            "/api/v1/plan-product/history",
            params={"company": "..", "project": "x"},
            headers=AUTH,
        )
        assert r.status_code in (400, 500)

    def test_specs_list_rejects_traversal(self, client):
        r = client.get(
            "/api/v1/specs/..%2Fetc/x",
            headers=AUTH,
        )
        assert r.status_code in (400, 404, 500)


# ─── #2: spec_name validation ────────────────────────────────────────────────


class TestSpecNameValidation:
    """The package zip and json endpoints must reject ..-traversal in spec_name."""

    def test_safe_segment_called_in_package_handlers(self):
        """The actual URL-path attack vector is blocked upstream by
        Starlette's URL normalization (`..` segments dropped before
        routing). The safe_segment guard remains as defense-in-depth
        for any programmatic callers and to fail loud on weird inputs.
        Source-level check: both package handlers reference safe_segment
        on spec_name."""
        from pathlib import Path
        # Package handlers moved to src/api/packages.py per spec Phase A.4.
        packages_src = Path(__file__).parent.parent / "src" / "api" / "packages.py"
        text = packages_src.read_text(encoding="utf-8")
        # Both package handlers should call safe_segment(spec_name, ...)
        count = text.count('safe_segment(spec_name, "spec_name")')
        assert count >= 2, (
            f"expected safe_segment(spec_name, ...) in both zip + json package handlers "
            f"(src/api/packages.py), found {count}"
        )

    def test_safe_segment_rejects_bare_dotdot(self):
        """Programmatic callers that pass spec_name=`..` directly are
        rejected at the safe_segment boundary."""
        from src.path_safety import safe_segment
        with pytest.raises(ValueError, match="unsafe spec_name"):
            safe_segment("..", "spec_name")


# ─── #3: analyze-repo repo_path workspace containment ───────────────────────


class TestAnalyzeRepoRepoPath:
    def test_absolute_path_outside_workspace_rejected(self, client):
        r = client.post(
            "/api/v1/analyze-repo/stream",
            json={
                "company": "acme",
                "project": "backend",
                "repo_path": "/etc",  # absolute path well outside workspace
                "session_mode": "new",
            },
            headers=AUTH,
        )
        assert r.status_code == 400
        # Error message should mention the path or workspace context
        assert "workspace" in r.text.lower() or "/etc" in r.text

    def test_dotdot_traversal_path_rejected(self, client):
        r = client.post(
            "/api/v1/analyze-repo/stream",
            json={
                "company": "acme",
                "project": "backend",
                "repo_path": "../../../../../../etc/passwd",
                "session_mode": "new",
            },
            headers=AUTH,
        )
        assert r.status_code == 400


# ─── #4: SSE thread cleanup helper ───────────────────────────────────────────


class TestSseThreadCleanup:
    """The stop_flag pattern is in-place across the 4 SSE handlers; this is a
    structural check that the threading.Event is wired into each."""

    def test_threading_imported_in_api(self):
        import src.api as api_module
        assert hasattr(api_module, "threading"), (
            "api should import threading for SSE stop_flag"
        )

    def test_stop_flag_pattern_present(self):
        """Superseded by tests/test_anti_pattern_guards.py — that test
        asserts EQUALITY (not >=) so a new SSE handler can't slip past
        without a paired stop_flag, the way the v2 handlers did under
        the original >=4 assertion (autoresearch:debug 260504-1301 #1).
        Kept as a thin shim that delegates."""
        from tests.test_anti_pattern_guards import (
            TestSseHandlerStopFlag as Guard,
        )
        Guard().test_run_in_executor_count_matches_stop_flag_count()


# ─── #5: orchestration_id format validation ─────────────────────────────────


class TestOrchestrationIdValidation:
    def test_status_rejects_dotdot(self, client):
        # Use a single-segment id with .. — FastAPI's path matching would
        # split %2F-encoded slashes into separate path parts, so use a
        # name that's a single segment but still escapes via Path/.
        r = client.get(
            "/api/v1/orchestrations/..foo/status",
            headers=AUTH,
        )
        assert r.status_code == 400
        assert "YYYYMMDD_HHMMSS" in r.text

    def test_logs_rejects_dotdot(self, client):
        r = client.get(
            "/api/v1/orchestrations/..foo/logs",
            headers=AUTH,
        )
        assert r.status_code == 400
        assert "YYYYMMDD_HHMMSS" in r.text

    def test_status_rejects_non_timestamp(self, client):
        r = client.get(
            "/api/v1/orchestrations/not-a-timestamp/status",
            headers=AUTH,
        )
        assert r.status_code == 400

    def test_status_accepts_valid_format(self, client):
        # Valid format passes the validator but the orchestration doesn't
        # exist on disk → 404 (not 400).
        r = client.get(
            "/api/v1/orchestrations/20260101_120000/status",
            headers=AUTH,
        )
        assert r.status_code == 404
