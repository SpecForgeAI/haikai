"""Tests for the polyrepo CRUD endpoints (Phase 3).

Covers:
  GET    /projects/{c}/{p}/repos
  POST   /projects/{c}/{p}/repos
  PUT    /projects/{c}/{p}/repos/{folder}
  DELETE /projects/{c}/{p}/repos/{folder}

Each test cleans the workspace, inits a baseline project, and then
exercises one CRUD scenario. Matches the 5 scenarios in the flow-diagram
(``haikai/specs/2026-05-25-polyrepo-analysis/flow-diagram/``).
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

os.environ.setdefault("STANDARDS_API_KEY", "test-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test")

from fastapi.testclient import TestClient

from src.api import app
from src.git.coordination import read_coordination

AUTH = {"Authorization": "Bearer test-key"}


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean_workspace():
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


def _init_project(client, repos):
    """Helper: init a project with the given KV map. Returns the API response."""
    with patch("src.api.routes.projects.GitManager") as mock_gm_cls, patch(
        "src.api.routes.projects.load_git_config"
    ) as mock_cfg:
        mock_cfg.return_value = _mock_git_config()
        mock_gm = Mock()
        mock_gm.init_project.return_value = "brownfield"
        mock_gm_cls.return_value = mock_gm
        return client.post(
            "/projects/init",
            json={"company": "acme", "project": "petclinic", "repos": repos},
            headers=AUTH,
        )


# ── GET ──────────────────────────────────────────────────────────────────────


class TestListRepos:
    def test_list_after_init(self, client):
        _init_project(
            client, {"app": "https://github.com/acme/app.git"}
        ).raise_for_status()
        resp = client.get(
            "/projects/acme/petclinic/repos", headers=AUTH
        )
        assert resp.status_code == 200, resp.json()
        assert resp.json()["repos"] == {
            "app": "https://github.com/acme/app.git",
        }

    def test_list_uninitialised_project_returns_404(self, client):
        resp = client.get(
            "/projects/acme/nonexistent/repos", headers=AUTH
        )
        assert resp.status_code == 404


# ── POST ─────────────────────────────────────────────────────────────────────


class TestAddRepo:
    @patch("src.api.routes.repos.GitManager")
    @patch("src.api.routes.repos.load_git_config_for_product_root")
    def test_add_succeeds(self, mock_cfg, mock_gm_cls, client):
        _init_project(
            client, {"backend": "https://github.com/acme/backend.git"}
        ).raise_for_status()
        mock_cfg.return_value = _mock_git_config()
        mock_gm = Mock()
        mock_gm.init_project.return_value = "brownfield"
        mock_gm_cls.return_value = mock_gm

        resp = client.post(
            "/projects/acme/petclinic/repos",
            json={
                "folder": "frontend",
                "url": "https://github.com/acme/frontend.git",
            },
            headers=AUTH,
        )
        assert resp.status_code == 200, resp.json()
        assert set(resp.json()["repos"].keys()) == {"backend", "frontend"}

    def test_add_duplicate_folder_rejected(self, client):
        _init_project(
            client, {"backend": "https://github.com/acme/backend.git"}
        ).raise_for_status()

        resp = client.post(
            "/projects/acme/petclinic/repos",
            json={
                "folder": "backend",
                "url": "https://github.com/acme/other.git",
            },
            headers=AUTH,
        )
        assert resp.status_code == 400
        assert "already mapped" in resp.json()["detail"]

    def test_add_duplicate_url_rejected(self, client):
        _init_project(
            client, {"backend": "https://github.com/acme/shared.git"}
        ).raise_for_status()

        resp = client.post(
            "/projects/acme/petclinic/repos",
            json={
                "folder": "shared",
                "url": "https://github.com/acme/shared.git",
            },
            headers=AUTH,
        )
        assert resp.status_code == 400
        assert "already claimed" in resp.json()["detail"]

    def test_add_invalid_folder_rejected(self, client):
        _init_project(
            client, {"backend": "https://github.com/acme/backend.git"}
        ).raise_for_status()

        resp = client.post(
            "/projects/acme/petclinic/repos",
            json={
                "folder": "Frontend",  # capital — invalid
                "url": "https://github.com/acme/frontend.git",
            },
            headers=AUTH,
        )
        assert resp.status_code == 400
        assert "Invalid folder alias" in resp.json()["detail"]


# ── PUT ──────────────────────────────────────────────────────────────────────


class TestUpdateRepo:
    @patch("src.api.routes.repos.GitManager")
    @patch("src.api.routes.repos.load_git_config_for_product_root")
    def test_update_re_clones(self, mock_cfg, mock_gm_cls, client):
        from src.api import API_WORKSPACE_DIR

        # Seed: init with backend pointing at v1
        _init_project(
            client, {"backend": "https://github.com/acme/v1.git"}
        ).raise_for_status()

        # Put a sentinel file in backend/ so we can detect re-clone
        product_root = API_WORKSPACE_DIR / "acme" / "petclinic"
        backend_dir = product_root / "backend"
        backend_dir.mkdir(parents=True, exist_ok=True)
        (backend_dir / "v1-only.txt").write_text("v1", encoding="utf-8")

        mock_cfg.return_value = _mock_git_config()

        def fake_init(url):
            # Simulate a clone by creating .git/ on the (already-mkdir'd) repo_dir.
            return "brownfield"

        mock_gm = Mock()
        mock_gm.init_project.side_effect = fake_init
        mock_gm_cls.return_value = mock_gm

        resp = client.put(
            "/projects/acme/petclinic/repos/backend",
            json={"url": "https://github.com/acme/v2.git"},
            headers=AUTH,
        )
        assert resp.status_code == 200, resp.json()
        assert resp.json()["repos"]["backend"] == "https://github.com/acme/v2.git"

        # Sentinel file gone — the old folder was torn down.
        assert not (backend_dir / "v1-only.txt").exists()

        # coordination.yaml updated
        coord = read_coordination(product_root)
        assert coord == {"backend": "https://github.com/acme/v2.git"}

    def test_update_unknown_folder_returns_404(self, client):
        _init_project(
            client, {"backend": "https://github.com/acme/backend.git"}
        ).raise_for_status()

        resp = client.put(
            "/projects/acme/petclinic/repos/nope",
            json={"url": "https://github.com/acme/whatever.git"},
            headers=AUTH,
        )
        assert resp.status_code == 404

    def test_update_dup_url_rejected(self, client):
        _init_project(
            client,
            {
                "backend": "https://github.com/acme/backend.git",
                "frontend": "https://github.com/acme/frontend.git",
            },
        ).raise_for_status()

        resp = client.put(
            "/projects/acme/petclinic/repos/backend",
            json={"url": "https://github.com/acme/frontend.git"},
            headers=AUTH,
        )
        assert resp.status_code == 400
        assert "already claimed" in resp.json()["detail"]

    def test_update_same_url_is_noop(self, client):
        _init_project(
            client, {"backend": "https://github.com/acme/backend.git"}
        ).raise_for_status()

        resp = client.put(
            "/projects/acme/petclinic/repos/backend",
            json={"url": "https://github.com/acme/backend.git"},
            headers=AUTH,
        )
        assert resp.status_code == 200


# ── DELETE ───────────────────────────────────────────────────────────────────


class TestDeleteRepo:
    def test_delete_succeeds(self, client):
        from src.api import API_WORKSPACE_DIR

        _init_project(
            client,
            {
                "backend": "https://github.com/acme/backend.git",
                "frontend": "https://github.com/acme/frontend.git",
            },
        ).raise_for_status()
        # Put sentinel in frontend/ to verify the sub-dir is removed
        product_root = API_WORKSPACE_DIR / "acme" / "petclinic"
        frontend_dir = product_root / "frontend"
        frontend_dir.mkdir(parents=True, exist_ok=True)
        (frontend_dir / "x.txt").write_text("present", encoding="utf-8")

        resp = client.delete(
            "/projects/acme/petclinic/repos/frontend", headers=AUTH
        )
        assert resp.status_code == 200
        assert set(resp.json()["repos"].keys()) == {"backend"}
        assert not frontend_dir.exists()

    def test_delete_last_entry_rejected(self, client):
        _init_project(
            client, {"backend": "https://github.com/acme/backend.git"}
        ).raise_for_status()

        resp = client.delete(
            "/projects/acme/petclinic/repos/backend", headers=AUTH
        )
        assert resp.status_code == 400
        assert "last entry" in resp.json()["detail"]

    def test_delete_unknown_folder_returns_404(self, client):
        _init_project(
            client, {"backend": "https://github.com/acme/backend.git"}
        ).raise_for_status()

        resp = client.delete(
            "/projects/acme/petclinic/repos/nope", headers=AUTH
        )
        assert resp.status_code == 404
