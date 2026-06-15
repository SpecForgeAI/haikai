"""Tests for Git Integration: Init Endpoint (TG3), V2 Endpoints (TG4),
Orchestrator Integration (TG5), and Gap Analysis (TG7)."""

import json
import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

import pytest


# Set env vars BEFORE importing the app module (API_KEY is read at import time)
os.environ.setdefault("STANDARDS_API_KEY", "test-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test")

from fastapi.testclient import TestClient
from src.api import app
from src.git.git_manager import GitManager, GitManagerError
from src.git.config import GitConfigError


@pytest.fixture
def client():
    return TestClient(app)


AUTH = {"Authorization": "Bearer test-key"}


# Tests below were last updated on 2026-03-14. The /api/v2/orchestrations
# endpoint and OrchestrationResponse / ImplementResponse models have drifted
# significantly since (per the autoresearch:debug 260504-* hardening sprint).
# Quarantined here to keep the test suite honest — they need per-test
# revision against the current contracts before re-enabling. Tracked in
# fix/260504-1127-full-repo-green/. To revisit: read the failure mode in
# `pytest --runxfail tests/test_git_v2_endpoints.py -v` then update the
# mock setup (most need `get_active_session` patched) and assertion shapes.
_DRIFT_REASON = (
    "API contract drift since 2026-03-14; needs revision per "
    "fix/260504-1127-full-repo-green"
)


def _mock_git_config():
    """Create a mock git config object."""
    cfg = Mock()
    cfg.provider = "github"
    cfg.default_branch = "main"
    cfg.github_token = "ghp_test"
    cfg.bitbucket_username = None
    cfg.bitbucket_app_password = None
    cfg.auto_push = True
    cfg.auto_pr = True
    return cfg


# ============================================================
# Task Group 3: Init Endpoint Tests (3.1)
# ============================================================

class TestInitEndpoint:
    """Test POST /projects/init."""

    @pytest.fixture(autouse=True)
    def _clean_workspace(self):
        """Wipe the API workspace before each init test.

        Each test creates its own project under API_WORKSPACE_DIR; without
        cleanup the polyrepo coordination.yaml gate fires on the second test
        in the suite and masks the per-test assertions.
        """
        from src.api import API_WORKSPACE_DIR

        if API_WORKSPACE_DIR.exists():
            for child in API_WORKSPACE_DIR.iterdir():
                if child.is_dir():
                    shutil.rmtree(child, ignore_errors=True)
                else:
                    try:
                        child.unlink()
                    except OSError:
                        pass
        yield

    @patch("src.api.routes.projects.GitManager")
    @patch("src.api.routes.projects.load_git_config")
    def test_init_brownfield(self, mock_load_cfg, mock_gm_cls, client):
        """Brownfield init returns success with mode=brownfield."""
        mock_load_cfg.return_value = _mock_git_config()
        mock_gm = Mock()
        mock_gm.init_project.return_value = "brownfield"
        mock_gm_cls.return_value = mock_gm

        resp = client.post(
            "/projects/init",
            json={"company": "acme", "project": "backend", "repo_url": "https://github.com/acme/backend.git"},
            headers=AUTH,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["mode"] == "brownfield"

    @patch("src.api.routes.projects.GitManager")
    @patch("src.api.routes.projects.load_git_config")
    def test_init_greenfield(self, mock_load_cfg, mock_gm_cls, client):
        """Greenfield init returns success with mode=greenfield."""
        mock_load_cfg.return_value = _mock_git_config()
        mock_gm = Mock()
        mock_gm.init_project.return_value = "greenfield"
        mock_gm_cls.return_value = mock_gm

        resp = client.post(
            "/projects/init",
            json={"company": "acme", "project": "new-app", "repo_url": "https://github.com/acme/new-app.git"},
            headers=AUTH,
        )
        assert resp.status_code == 200
        assert resp.json()["mode"] == "greenfield"

    @patch("src.api.routes.projects.GitManager")
    @patch("src.api.routes.projects.load_git_config")
    def test_init_already_initialized(self, mock_load_cfg, mock_gm_cls, client):
        """Already initialized project returns 400."""
        mock_load_cfg.return_value = _mock_git_config()
        mock_gm = Mock()
        mock_gm.init_project.side_effect = GitManagerError("already initialized")
        mock_gm_cls.return_value = mock_gm

        resp = client.post(
            "/projects/init",
            json={"company": "acme", "project": "backend", "repo_url": "https://github.com/acme/backend.git"},
            headers=AUTH,
        )
        assert resp.status_code == 400
        assert "already initialized" in resp.json()["detail"]

    @patch("src.api.routes.projects.load_git_config")
    def test_init_missing_git_config(self, mock_load_cfg, client):
        """Missing git config returns 400."""
        mock_load_cfg.side_effect = GitConfigError("GIT_PROVIDER is required")

        resp = client.post(
            "/projects/init",
            json={"company": "acme", "project": "backend", "repo_url": "https://github.com/acme/backend.git"},
            headers=AUTH,
        )
        assert resp.status_code == 400
        assert "GIT_PROVIDER" in resp.json()["detail"]

    @patch("src.api.routes.projects.GitManager")
    @patch("src.api.routes.projects.load_git_config")
    def test_init_repo_unreachable(self, mock_load_cfg, mock_gm_cls, client):
        """Unreachable repo returns 400."""
        mock_load_cfg.return_value = _mock_git_config()
        mock_gm = Mock()
        mock_gm.init_project.side_effect = GitManagerError("Repository unreachable")
        mock_gm_cls.return_value = mock_gm

        resp = client.post(
            "/projects/init",
            json={"company": "acme", "project": "backend", "repo_url": "https://github.com/acme/no-repo.git"},
            headers=AUTH,
        )
        assert resp.status_code == 400
        assert "unreachable" in resp.json()["detail"].lower()


# ============================================================
# Task Group 4: V2 Endpoint Tests (4.1)
# ============================================================

class TestV2Endpoints:
    """Test V2 git-integrated endpoints."""

    @patch("src.api._require_git_manager")
    def test_v2_endpoint_returns_400_when_not_initialized(self, mock_req_gm, client):
        """V2 endpoint returns 400 when project not initialized."""
        from fastapi import HTTPException
        mock_req_gm.side_effect = HTTPException(
            status_code=400, detail="Project not initialized. Call POST /projects/init first."
        )

        resp = client.get("/api/v2/specs/acme/backend", headers=AUTH)
        assert resp.status_code == 400
        assert "not initialized" in resp.json()["detail"]

    @patch("src.api._require_git_manager")
    def test_v2_endpoint_returns_400_when_git_config_missing(self, mock_req_gm, client):
        """V2 endpoint returns 400 when git config is missing."""
        from fastapi import HTTPException
        mock_req_gm.side_effect = HTTPException(
            status_code=400, detail="Git configuration error: GIT_PROVIDER is required"
        )

        resp = client.get("/api/v2/specs/acme/backend", headers=AUTH)
        assert resp.status_code == 400
        assert "GIT_PROVIDER" in resp.json()["detail"]

    @patch("src.api.get_haikai_service")
    @patch("src.api._require_git_manager")
    def test_v2_write_spec_commits(self, mock_req_gm, mock_svc_fn, client):
        """V2 write-spec commits to feature branch."""
        mock_gm = Mock()
        mock_req_gm.return_value = mock_gm

        from src.haikai_crud_models import WriteSpecResponse
        now = datetime.now()
        mock_svc = Mock()
        mock_svc.write_spec.return_value = WriteSpecResponse(
            id="user-auth",
            company="acme",
            project="backend",
            status="success",
            created_at=now,
            updated_at=now,
        )
        mock_svc_fn.return_value = mock_svc

        resp = client.post(
            "/api/v2/specs/acme/backend/write-spec",
            json={"spec_id": "user-auth"},
            headers=AUTH,
        )
        assert resp.status_code == 200
        mock_gm.commit_all.assert_called_once()
        assert "write-spec" in mock_gm.commit_all.call_args[0][0]

    @patch("src.api.routes.specs.load_git_config")
    @patch("src.api.get_haikai_service")
    @patch("src.api._require_git_manager")
    def test_v2_implement_commits_pushes_pr(self, mock_req_gm, mock_svc_fn, mock_load_cfg, client):
        """V2 implement commits, pushes, and creates PR."""
        mock_gm = Mock()
        mock_gm.commit_all.return_value = "abc123"
        mock_req_gm.return_value = mock_gm

        mock_load_cfg.return_value = _mock_git_config()

        from src.haikai_crud_models import ImplementResponse
        mock_svc = Mock()
        mock_svc.implement_tasks.return_value = ImplementResponse(
            spec_id="user-auth",
            company="acme",
            project="backend",
            status="success",
        )
        mock_svc_fn.return_value = mock_svc

        resp = client.post(
            "/api/v2/specs/acme/backend/user-auth/implement",
            headers=AUTH,
        )
        assert resp.status_code == 200
        mock_gm.commit_all.assert_called_once()
        mock_gm.push_branch.assert_called_once_with("feature/user-auth")
        mock_gm.create_pull_request.assert_called_once()

    @patch("src.api.get_haikai_service")
    @patch("src.api._require_git_manager")
    def test_v2_generate_tasks_commits(self, mock_req_gm, mock_svc_fn, client):
        """V2 tasks/generate commits to feature branch."""
        mock_gm = Mock()
        mock_req_gm.return_value = mock_gm

        from src.haikai_crud_models import GenerateTasksResponse
        now = datetime.now()
        mock_svc = Mock()
        mock_svc.generate_tasks.return_value = GenerateTasksResponse(
            spec_id="user-auth",
            company="acme",
            project="backend",
            total_task_groups=1,
            total_tasks=5,
            created_at=now,
        )
        mock_svc_fn.return_value = mock_svc

        resp = client.post(
            "/api/v2/specs/acme/backend/user-auth/tasks/generate",
            headers=AUTH,
        )
        assert resp.status_code == 200
        mock_gm.commit_all.assert_called_once()
        assert "create-tasks" in mock_gm.commit_all.call_args[0][0]

    @patch("src.api.routes.orchestration.get_active_session")
    @patch("src.api.routes.orchestration.load_git_config")
    @patch("src.api.routes.orchestration.HaikaiOrchestrator")
    @patch("src.api._require_git_manager")
    def test_v2_orchestration_calls_git_ops(self, mock_req_gm, mock_orch_cls, mock_load_cfg, mock_active_session, client):
        """V2 orchestration calls commit, push, and PR creation.

        Drift: the v2 handler now resolves an active session via
        `get_active_session(API_WORKSPACE_DIR, company, project)` and
        returns 400 when the session is missing — must be mocked."""
        mock_active_session.return_value = "active-session-uuid-1234"
        mock_gm = Mock()
        mock_gm.commit_all.return_value = "deadbeef"
        mock_gm.default_branch = "main"
        mock_gm.create_pull_request.return_value = "https://github.com/acme/backend/pull/1"
        mock_req_gm.return_value = mock_gm

        mock_load_cfg.return_value = _mock_git_config()

        from src.haikai_models import OrchestrationResponse
        mock_response = OrchestrationResponse(
            success=True,
            spec_names=["user-auth"],
            session_ids={"user-auth": "sess-00001"},
            results=[],
            total_execution_time_seconds=10.0,
            orchestration_log="/tmp/log.txt",
        )

        mock_orch = Mock()
        mock_orch.run_workflow.return_value = mock_response
        mock_orch_cls.return_value = mock_orch

        resp = client.post(
            "/api/v2/orchestrations",
            json={
                "company": "acme",
                "project": "backend",
                "spec_intents": [{"spec_name": "user-auth", "session_id": "sess-00001"}],
            },
            headers=AUTH,
        )
        assert resp.status_code == 200
        mock_gm.commit_all.assert_called()
        mock_gm.push_branch.assert_called_with("feature/user-auth")
        mock_gm.create_pull_request.assert_called()


# ============================================================
# Task Group 5: Orchestrator Integration Tests (5.1)
# ============================================================

class TestOrchestratorGitIntegration:
    """Test orchestrator git integration behavior."""

    @patch("src.api.routes.orchestration.get_active_session")
    @patch("src.api.routes.orchestration.load_git_config")
    @patch("src.api.routes.orchestration.HaikaiOrchestrator")
    @patch("src.api._require_git_manager")
    def test_orchestrator_commits_after_success(self, mock_req_gm, mock_orch_cls, mock_load_cfg, mock_active_session, client):
        """Orchestrator commits after successful orchestration."""
        mock_active_session.return_value = "active-session-uuid-1234"
        mock_gm = Mock()
        mock_gm.commit_all.return_value = "abc123"
        mock_gm.default_branch = "main"
        mock_req_gm.return_value = mock_gm

        cfg = _mock_git_config()
        cfg.auto_push = False
        cfg.auto_pr = False
        mock_load_cfg.return_value = cfg

        from src.haikai_models import OrchestrationResponse
        mock_response = OrchestrationResponse(
            success=True,
            spec_names=["payments"],
            session_ids={"payments": "sess-00001"},
            results=[],
            total_execution_time_seconds=5.0,
            orchestration_log="/tmp/log.txt",
        )

        mock_orch = Mock()
        mock_orch.run_workflow.return_value = mock_response
        mock_orch_cls.return_value = mock_orch

        resp = client.post(
            "/api/v2/orchestrations",
            json={
                "company": "acme",
                "project": "backend",
                "spec_intents": [{"spec_name": "payments", "session_id": "sess-00001"}],
            },
            headers=AUTH,
        )
        assert resp.status_code == 200
        mock_gm.commit_all.assert_called_once()
        # auto_push=False so push should not be called
        mock_gm.push_branch.assert_not_called()

    @patch("src.api.routes.orchestration.get_active_session")
    @patch("src.api.routes.orchestration.load_git_config")
    @patch("src.api.routes.orchestration.HaikaiOrchestrator")
    @patch("src.api._require_git_manager")
    def test_push_failure_does_not_fail_orchestration(self, mock_req_gm, mock_orch_cls, mock_load_cfg, mock_active_session, client):
        """Push failure doesn't fail the orchestration."""
        mock_active_session.return_value = "active-session-uuid-1234"
        mock_gm = Mock()
        mock_gm.commit_all.return_value = "abc123"
        mock_gm.push_branch.side_effect = GitManagerError("Push rejected")
        mock_gm.default_branch = "main"
        mock_req_gm.return_value = mock_gm

        mock_load_cfg.return_value = _mock_git_config()

        from src.haikai_models import OrchestrationResponse
        mock_response = OrchestrationResponse(
            success=True,
            spec_names=["user-auth"],
            session_ids={"user-auth": "sess-00001"},
            results=[],
            total_execution_time_seconds=5.0,
            orchestration_log="/tmp/log.txt",
        )

        mock_orch = Mock()
        mock_orch.run_workflow.return_value = mock_response
        mock_orch_cls.return_value = mock_orch

        resp = client.post(
            "/api/v2/orchestrations",
            json={
                "company": "acme",
                "project": "backend",
                "spec_intents": [{"spec_name": "user-auth", "session_id": "sess-00001"}],
            },
            headers=AUTH,
        )
        assert resp.status_code == 200

    @patch("src.api.routes.orchestration.get_active_session")
    @patch("src.api.routes.orchestration.load_git_config")
    @patch("src.api.routes.orchestration.HaikaiOrchestrator")
    @patch("src.api._require_git_manager")
    def test_pr_failure_does_not_fail_orchestration(self, mock_req_gm, mock_orch_cls, mock_load_cfg, mock_active_session, client):
        """PR creation failure doesn't fail the orchestration."""
        mock_active_session.return_value = "active-session-uuid-1234"
        mock_gm = Mock()
        mock_gm.commit_all.return_value = "abc123"
        mock_gm.push_branch.return_value = None
        mock_gm.create_pull_request.side_effect = GitManagerError("PR creation failed: 422")
        mock_gm.default_branch = "main"
        mock_req_gm.return_value = mock_gm

        mock_load_cfg.return_value = _mock_git_config()

        from src.haikai_models import OrchestrationResponse
        mock_response = OrchestrationResponse(
            success=True,
            spec_names=["user-auth"],
            session_ids={"user-auth": "sess-00001"},
            results=[],
            total_execution_time_seconds=5.0,
            orchestration_log="/tmp/log.txt",
        )

        mock_orch = Mock()
        mock_orch.run_workflow.return_value = mock_response
        mock_orch_cls.return_value = mock_orch

        resp = client.post(
            "/api/v2/orchestrations",
            json={
                "company": "acme",
                "project": "backend",
                "spec_intents": [{"spec_name": "user-auth", "session_id": "sess-00001"}],
            },
            headers=AUTH,
        )
        assert resp.status_code == 200

    def test_multi_spec_orchestration_rejected_with_400(self, client):
        """Multi-spec orchestration is rejected with 400.

        Drift: the previous test asserted that multi-spec produced 2
        commits + 2 push targets. That behavior was actually B2 — the
        per-spec git loop ran but `commit_all`'s `git add -A` aliased
        all specs' files into iter 1's commit while iters 2..N silently
        produced empty commits (see debug/260504-1620-api-layer-hunt/bugs.md
        B2 + haikai/specs/2026-03-15-deferred-branch-creation/spec.md
        \"Concurrency Concern\"). Multi-spec is now explicitly rejected
        until the per-spec atomic commit flow lands. This test pins the
        new contract."""
        resp = client.post(
            "/api/v2/orchestrations",
            json={
                "company": "acme",
                "project": "backend",
                "spec_intents": [
                    {"spec_name": "user-auth", "session_id": "sess-00001"},
                    {"spec_name": "payments", "session_id": "sess-00002"},
                ],
            },
            headers=AUTH,
        )
        assert resp.status_code == 400
        detail = resp.json()["detail"]
        assert "multi-spec" in detail.lower() or "spec_intents" in detail.lower()
        assert "deferred" in detail.lower() or "B2" in detail

    @patch("src.api.routes.orchestration.get_active_session")
    @patch("src.api.routes.orchestration.load_git_config")
    @patch("src.api.routes.orchestration.HaikaiOrchestrator")
    @patch("src.api._require_git_manager")
    def test_response_includes_git_metadata(self, mock_req_gm, mock_orch_cls, mock_load_cfg, mock_active_session, client):
        """V2 orchestration response includes commit_sha, branch, pr_url."""
        mock_active_session.return_value = "active-session-uuid-1234"
        mock_gm = Mock()
        mock_gm.commit_all.return_value = "deadbeef"
        mock_gm.default_branch = "main"
        mock_gm.create_pull_request.return_value = "https://github.com/acme/backend/pull/42"
        mock_req_gm.return_value = mock_gm

        mock_load_cfg.return_value = _mock_git_config()

        from src.haikai_models import OrchestrationResponse
        mock_response = OrchestrationResponse(
            success=True,
            spec_names=["user-auth"],
            session_ids={"user-auth": "sess-00001"},
            results=[],
            total_execution_time_seconds=5.0,
            orchestration_log="/tmp/log.txt",
        )

        mock_orch = Mock()
        mock_orch.run_workflow.return_value = mock_response
        mock_orch_cls.return_value = mock_orch

        resp = client.post(
            "/api/v2/orchestrations",
            json={
                "company": "acme",
                "project": "backend",
                "spec_intents": [{"spec_name": "user-auth", "session_id": "sess-00001"}],
            },
            headers=AUTH,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["commit_sha"] == "deadbeef"
        assert data["branch"] == "feature/user-auth"
        assert data["pr_url"] == "https://github.com/acme/backend/pull/42"


# ============================================================
# Task Group 7: Gap Analysis Tests (7.3)
# ============================================================

class TestGapAnalysis:
    """Strategic tests for critical integration paths."""

    def test_orchestration_response_model_has_git_fields(self):
        """OrchestrationResponse model includes git metadata fields."""
        from src.haikai_models import OrchestrationResponse
        fields = OrchestrationResponse.model_fields
        assert "commit_sha" in fields
        assert "branch" in fields
        assert "pr_url" in fields
        resp = OrchestrationResponse(
            success=True,
            spec_names=["test"],
            session_ids={"test": "s1"},
            results=[],
            total_execution_time_seconds=1.0,
            orchestration_log="/tmp/log.txt",
        )
        assert resp.commit_sha is None
        assert resp.branch is None
        assert resp.pr_url is None

    def test_git_manager_build_authenticated_url_github(self):
        """GitHub authenticated URL is built correctly."""
        gm = GitManager(
            project_dir=Path("/tmp/test"),
            provider="github",
            default_branch="main",
            github_token="ghp_abc123",
        )
        url = gm._build_authenticated_url("https://github.com/acme/backend.git")
        assert "ghp_abc123" in url
        assert "github.com" in url
        assert "acme/backend" in url

    def test_git_manager_build_authenticated_url_bitbucket(self):
        """Bitbucket authenticated URL is built correctly."""
        gm = GitManager(
            project_dir=Path("/tmp/test"),
            provider="bitbucket",
            default_branch="main",
            bitbucket_username="bb_user",
            bitbucket_app_password="bb_pass",
        )
        url = gm._build_authenticated_url("https://bitbucket.org/workspace/repo.git")
        assert "bb_user" in url
        assert "bb_pass" in url
        assert "bitbucket.org" in url

    def test_git_manager_parse_owner_repo(self):
        """Owner/repo parsed correctly from various URL formats."""
        gm = GitManager(
            project_dir=Path("/tmp/test"),
            provider="github",
            default_branch="main",
            github_token="ghp_test",
        )
        owner, repo = gm._parse_owner_repo("https://github.com/acme/backend.git")
        assert owner == "acme"
        assert repo == "backend"

        owner, repo = gm._parse_owner_repo("https://github.com/acme/backend")
        assert owner == "acme"
        assert repo == "backend"

    @patch("src.api.get_haikai_service")
    @patch("src.api._require_git_manager")
    def test_v2_read_only_endpoints_dont_write_git(self, mock_req_gm, mock_svc_fn, client):
        """V2 read-only endpoints enforce init but don't write to git."""
        mock_gm = Mock()
        mock_req_gm.return_value = mock_gm

        from src.haikai_crud_models import SpecListResponse
        mock_svc = Mock()
        mock_svc.list_specs.return_value = SpecListResponse(specs=[], total=0)
        mock_svc_fn.return_value = mock_svc

        resp = client.get("/api/v2/specs/acme/backend", headers=AUTH)
        assert resp.status_code == 200
        mock_gm.commit_all.assert_not_called()
        mock_gm.push_branch.assert_not_called()
        mock_gm.create_pull_request.assert_not_called()

    def test_v1_endpoints_unaffected_by_git(self, client):
        """V1 endpoints work without git configuration."""
        resp = client.get("/health")
        assert resp.status_code == 200

    @patch("src.api.routes.specs.load_git_config")
    @patch("src.api.get_haikai_service")
    @patch("src.api._require_git_manager")
    def test_v2_implement_push_fails_but_response_still_has_results(
        self, mock_req_gm, mock_svc_fn, mock_load_cfg, client
    ):
        """When push fails, implement still returns the implementation results."""
        mock_gm = Mock()
        mock_gm.commit_all.return_value = "abc123"
        mock_gm.push_branch.side_effect = GitManagerError("Push rejected")
        mock_req_gm.return_value = mock_gm

        mock_load_cfg.return_value = _mock_git_config()

        from src.haikai_crud_models import ImplementResponse
        mock_svc = Mock()
        mock_svc.implement_tasks.return_value = ImplementResponse(
            spec_id="user-auth",
            company="acme",
            project="backend",
            status="success",
        )
        mock_svc_fn.return_value = mock_svc

        resp = client.post(
            "/api/v2/specs/acme/backend/user-auth/implement",
            headers=AUTH,
        )
        assert resp.status_code == 200
        # The push failure must be surfaced via the response's git_errors
        # field (the field is named `git_errors` on ImplementResponse, NOT
        # `errors` — a previous bug used the wrong attribute name and
        # crashed the handler with a Pydantic ValidationError).
        data = resp.json()
        assert data.get("git_errors") and "Push rejected" in data["git_errors"][0]

    def test_config_persistence_round_trip(self, tmp_path):
        """Config written by init_project can be read by load_config."""
        gm = GitManager(
            project_dir=tmp_path,
            provider="github",
            default_branch="main",
            github_token="ghp_test",
        )
        gm._save_config("https://github.com/acme/backend.git")
        loaded = gm.load_config()
        assert loaded["repo_url"] == "https://github.com/acme/backend.git"
        assert loaded["provider"] == "github"
        assert loaded["default_branch"] == "main"
