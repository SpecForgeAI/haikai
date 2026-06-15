"""Tests for the polyrepo POST /projects/init route.

Covers Phase 2 of haikai/specs/2026-05-25-polyrepo-analysis/tasks.md
(T2.1, T2.2, T2.3, T2.4, T2.6). T2.7 is the petclinic integration test —
network-gated, lives separately.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

# Set env vars BEFORE importing the app module.
os.environ.setdefault("STANDARDS_API_KEY", "test-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test")

from fastapi.testclient import TestClient

from src.api import app
from src.git.config import GitConfigError
from src.git.coordination import COORDINATION_FILENAME, read_coordination
from src.git.git_manager import GitManagerError


AUTH = {"Authorization": "Bearer test-key"}


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean_workspace():
    """Wipe the API workspace before each test in this module."""
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


def _mock_git_config():
    cfg = Mock()
    cfg.provider = "github"
    cfg.default_branch = "main"
    cfg.github_token = "ghp_test"
    cfg.bitbucket_username = None
    cfg.bitbucket_app_password = None
    cfg.auto_push = True
    cfg.auto_pr = True
    return cfg


# ── N = 1: backward compat via repos field ───────────────────────────────────


class TestPolyrepoInitN1:
    """N=1 init via the new `repos` field — same on-disk effect as legacy."""

    @patch("src.api.routes.projects.GitManager")
    @patch("src.api.routes.projects.load_git_config")
    def test_n1_via_repos_field_returns_single_repo_mode(
        self, mock_load_cfg, mock_gm_cls, client
    ):
        mock_load_cfg.return_value = _mock_git_config()
        mock_gm = Mock()
        mock_gm.init_project.return_value = "brownfield"
        mock_gm_cls.return_value = mock_gm

        resp = client.post(
            "/projects/init",
            json={
                "company": "acme",
                "project": "petclinic",
                "repos": {"app": "https://github.com/acme/app.git"},
            },
            headers=AUTH,
        )
        assert resp.status_code == 200, resp.json()
        data = resp.json()
        # Top-level mode passes through for N=1
        assert data["mode"] == "brownfield"
        assert data["success"] is True
        assert len(data["repos"]) == 1
        assert data["repos"][0]["folder"] == "app"
        assert data["repos"][0]["mode"] == "brownfield"

    @patch("src.api.routes.projects.GitManager")
    @patch("src.api.routes.projects.load_git_config")
    def test_n1_writes_coordination_yaml(
        self, mock_load_cfg, mock_gm_cls, client
    ):
        from src.api import API_WORKSPACE_DIR

        mock_load_cfg.return_value = _mock_git_config()
        mock_gm = Mock()
        mock_gm.init_project.return_value = "brownfield"
        mock_gm_cls.return_value = mock_gm

        resp = client.post(
            "/projects/init",
            json={
                "company": "acme",
                "project": "petclinic",
                "repos": {"app": "https://github.com/acme/app.git"},
            },
            headers=AUTH,
        )
        assert resp.status_code == 200
        product_root = API_WORKSPACE_DIR / "acme" / "petclinic"
        coord = read_coordination(product_root)
        assert coord == {"app": "https://github.com/acme/app.git"}


# ── N > 1: poly init ─────────────────────────────────────────────────────────


class TestPolyrepoInitN3:
    """N=3 init — all clones succeed, coordination.yaml written."""

    @patch("src.api.routes.projects.GitManager")
    @patch("src.api.routes.projects.load_git_config")
    def test_n3_all_success(self, mock_load_cfg, mock_gm_cls, client):
        from src.api import API_WORKSPACE_DIR

        mock_load_cfg.return_value = _mock_git_config()
        mock_gm = Mock()
        mock_gm.init_project.return_value = "brownfield"
        mock_gm_cls.return_value = mock_gm

        resp = client.post(
            "/projects/init",
            json={
                "company": "acme",
                "project": "petclinic",
                "repos": {
                    "backend": "https://github.com/acme/backend.git",
                    "frontend": "https://github.com/acme/frontend.git",
                    "shared": "git@github.com:acme/shared.git",
                },
            },
            headers=AUTH,
        )
        assert resp.status_code == 200, resp.json()
        data = resp.json()
        # Top-level mode is 'polyrepo' for N>1
        assert data["mode"] == "polyrepo"
        assert len(data["repos"]) == 3
        folders = [r["folder"] for r in data["repos"]]
        # Sorted folder iteration is part of the contract
        assert folders == ["backend", "frontend", "shared"]
        # GitManager instantiated once per repo
        assert mock_gm_cls.call_count == 3
        # coordination.yaml present at product root
        product_root = API_WORKSPACE_DIR / "acme" / "petclinic"
        coord = read_coordination(product_root)
        assert set(coord.keys()) == {"backend", "frontend", "shared"}

    @patch("src.api.routes.projects.GitManager")
    @patch("src.api.routes.projects.load_git_config")
    def test_n3_rollback_on_second_repo_failure(
        self, mock_load_cfg, mock_gm_cls, client, tmp_path
    ):
        """If clone #2 of 3 fails, the whole workspace is rolled back.

        No coordination.yaml is written; the sub-directories created so far
        are removed; the product root itself is removed if we created it.
        """
        from src.api import API_WORKSPACE_DIR

        mock_load_cfg.return_value = _mock_git_config()

        # First GitManager succeeds, second raises, third should never be
        # constructed (loop short-circuits on exception).
        first_gm = Mock()
        first_gm.init_project.return_value = "brownfield"
        second_gm = Mock()
        second_gm.init_project.side_effect = GitManagerError(
            "Repository unreachable: backend.git"
        )
        third_gm = Mock()

        # Side_effect on the class constructor: also create the .git dir
        # for the first one so rollback has something to clean.
        def gm_factory(*args, **kwargs):
            repo_dir = kwargs.get("project_dir") or args[0]
            Path(repo_dir).mkdir(parents=True, exist_ok=True)
            Path(repo_dir / ".git").mkdir(exist_ok=True)
            # Return the next mock in sequence
            if mock_gm_cls.call_count == 1:
                return first_gm
            if mock_gm_cls.call_count == 2:
                return second_gm
            return third_gm

        mock_gm_cls.side_effect = gm_factory

        resp = client.post(
            "/projects/init",
            json={
                "company": "acme",
                "project": "petclinic",
                "repos": {
                    "alpha": "https://github.com/acme/alpha.git",
                    "backend": "https://github.com/acme/backend.git",
                    "gamma": "https://github.com/acme/gamma.git",
                },
            },
            headers=AUTH,
        )
        assert resp.status_code == 400, resp.json()
        assert "unreachable" in resp.json()["detail"].lower()
        # Only two GitManagers constructed — the third was never reached.
        assert mock_gm_cls.call_count == 2
        # Workspace rolled back: no product dir, no coordination.yaml.
        product_root = API_WORKSPACE_DIR / "acme" / "petclinic"
        assert not product_root.exists(), (
            f"Rollback failed: {product_root} still exists. "
            f"Contents: {list(product_root.iterdir()) if product_root.exists() else 'n/a'}"
        )


# ── Re-init guard ────────────────────────────────────────────────────────────


class TestPolyrepoReinitGuard:
    """A project that already has coordination.yaml cannot be re-init'd."""

    @patch("src.api.routes.projects.GitManager")
    @patch("src.api.routes.projects.load_git_config")
    def test_reinit_after_successful_init_rejected(
        self, mock_load_cfg, mock_gm_cls, client
    ):
        mock_load_cfg.return_value = _mock_git_config()
        mock_gm = Mock()
        mock_gm.init_project.return_value = "brownfield"
        mock_gm_cls.return_value = mock_gm

        body = {
            "company": "acme",
            "project": "petclinic",
            "repos": {"app": "https://github.com/acme/app.git"},
        }
        first = client.post("/projects/init", json=body, headers=AUTH)
        assert first.status_code == 200

        second = client.post("/projects/init", json=body, headers=AUTH)
        assert second.status_code == 400
        assert "already initialised" in second.json()["detail"].lower()
        assert COORDINATION_FILENAME in second.json()["detail"]


# ── Legacy repo_url promotion via API ────────────────────────────────────────


class TestLegacyRepoUrlViaApi:
    """The legacy `repo_url` body must still work end-to-end via the API."""

    @patch("src.api.routes.projects.GitManager")
    @patch("src.api.routes.projects.load_git_config")
    def test_legacy_repo_url_promotes_and_succeeds(
        self, mock_load_cfg, mock_gm_cls, client
    ):
        from src.api import API_WORKSPACE_DIR

        mock_load_cfg.return_value = _mock_git_config()
        mock_gm = Mock()
        mock_gm.init_project.return_value = "brownfield"
        mock_gm_cls.return_value = mock_gm

        resp = client.post(
            "/projects/init",
            json={
                "company": "acme",
                "project": "backend",
                "repo_url": "https://github.com/acme/backend.git",
            },
            headers=AUTH,
        )
        assert resp.status_code == 200, resp.json()
        data = resp.json()
        # Folder alias defaults to the project name
        assert len(data["repos"]) == 1
        assert data["repos"][0]["folder"] == "backend"
        # coordination.yaml uses the project name as the folder key
        product_root = API_WORKSPACE_DIR / "acme" / "backend"
        assert read_coordination(product_root) == {
            "backend": "https://github.com/acme/backend.git",
        }
