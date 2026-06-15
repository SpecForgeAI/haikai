"""Tests for GitManager module (Task Groups 1, 2, 6)."""

import json
import os
import shutil
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

import pytest

from src.git.git_manager import GitManager, GitManagerError
from src.git.config import load_git_config, GitConfigError


# ============================================================
# Task Group 1: GitManager Tests (1.1)
# ============================================================

@pytest.fixture
def temp_project_dir():
    """Create a temporary project directory."""
    d = tempfile.mkdtemp()
    yield Path(d)
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def git_manager(temp_project_dir):
    """Create a GitManager instance for testing."""
    return GitManager(
        project_dir=temp_project_dir,
        provider="github",
        default_branch="main",
        github_token="ghp_test_token_123",
    )


class TestGitManagerInit:
    """Test init_project brownfield and greenfield flows."""

    @patch.object(GitManager, "_run_git")
    def test_init_project_brownfield(self, mock_run, git_manager, temp_project_dir):
        """Brownfield: clone existing repo with content."""
        # ls-remote returns content (has refs)
        mock_run.side_effect = [
            Mock(returncode=0, stdout="abc123\trefs/heads/main\n", stderr=""),  # ls-remote
            Mock(returncode=0, stdout="", stderr=""),  # clone
            Mock(returncode=0, stdout="", stderr=""),  # checkout
        ]

        mode = git_manager.init_project("https://github.com/acme/backend.git")

        assert mode == "brownfield"
        # Verify clone was called
        clone_call = mock_run.call_args_list[1]
        assert "clone" in clone_call[0][0]

    @patch.object(GitManager, "_run_git")
    def test_init_project_greenfield(self, mock_run, git_manager, temp_project_dir):
        """Greenfield: empty remote → scaffold + push."""
        # ls-remote returns empty (no refs)
        mock_run.side_effect = [
            Mock(returncode=0, stdout="", stderr=""),   # ls-remote (empty)
            Mock(returncode=0, stdout="", stderr=""),   # git init
            Mock(returncode=0, stdout="", stderr=""),   # remote add
            Mock(returncode=0, stdout="", stderr=""),   # add -A
            Mock(returncode=0, stdout="", stderr=""),   # commit
            Mock(returncode=0, stdout="", stderr=""),   # branch -M
            Mock(returncode=0, stdout="", stderr=""),   # push -u
        ]

        mode = git_manager.init_project("https://github.com/acme/backend.git")

        assert mode == "greenfield"
        # Verify scaffold files created
        assert (temp_project_dir / "README.md").exists()
        assert (temp_project_dir / "haikai" / ".gitkeep").exists()
        # Verify config saved
        assert (temp_project_dir / ".haikai" / "config.json").exists()

    @patch.object(GitManager, "_run_git")
    def test_init_project_already_initialized(self, mock_run, git_manager, temp_project_dir):
        """Error if .git/ already exists."""
        (temp_project_dir / ".git").mkdir()

        with pytest.raises(GitManagerError, match="already initialized"):
            git_manager.init_project("https://github.com/acme/backend.git")

        mock_run.assert_not_called()

    def test_ensure_initialized_true(self, git_manager, temp_project_dir):
        """ensure_initialized returns True when .git/ exists."""
        (temp_project_dir / ".git").mkdir()
        assert git_manager.ensure_initialized() is True

    def test_ensure_initialized_false(self, git_manager, temp_project_dir):
        """ensure_initialized returns False when .git/ missing."""
        assert git_manager.ensure_initialized() is False

    def test_ensure_initialized_polyrepo_coordination_yaml(
        self, git_manager, temp_project_dir
    ):
        """Polyrepo product root (coordination.yaml present, no .git/) → True.

        The polyrepo layout writes the cloned repo(s) under {product_root}/{folder}/
        with .git inside each subdir, and coordination.yaml at the product root.
        The gate must accept this shape as 'initialized' or every V2 endpoint
        rejects polyrepo-initialized projects with HTTP 400 'Project not
        initialized'. Empirical trial 2026-05-27 surfaced this; see
        haikai/specs/2026-05-27-od2-empirical-test/findings.md.
        """
        # No .git/ at product root, but coordination.yaml present
        assert not (temp_project_dir / ".git").exists()
        (temp_project_dir / "coordination.yaml").write_text(
            "app: https://github.com/acme/backend.git\n", encoding="utf-8"
        )
        assert git_manager.ensure_initialized() is True

    def test_ensure_initialized_neither(self, git_manager, temp_project_dir):
        """Bare product_dir (no .git/, no coordination.yaml) → False."""
        assert not (temp_project_dir / ".git").exists()
        assert not (temp_project_dir / "coordination.yaml").exists()
        assert git_manager.ensure_initialized() is False

    def test_load_config(self, git_manager, temp_project_dir):
        """load_config reads .haikai/config.json."""
        config_dir = temp_project_dir / ".haikai"
        config_dir.mkdir()
        config = {"repo_url": "https://github.com/acme/backend.git", "provider": "github"}
        (config_dir / "config.json").write_text(json.dumps(config), encoding="utf-8")

        loaded = git_manager.load_config()
        assert loaded["repo_url"] == "https://github.com/acme/backend.git"
        assert loaded["provider"] == "github"

    @patch.object(GitManager, "_run_git")
    def test_pull_latest(self, mock_run, git_manager):
        """pull_latest calls git checkout + git pull."""
        mock_run.return_value = Mock(returncode=0, stdout="", stderr="")

        git_manager.pull_latest()

        assert mock_run.call_count == 2
        checkout_cmd = mock_run.call_args_list[0][0][0]
        pull_cmd = mock_run.call_args_list[1][0][0]
        assert "checkout" in checkout_cmd
        assert "pull" in pull_cmd
        assert "main" in pull_cmd


# ============================================================
# Task Group 2: PR Creation Tests (2.1)
# ============================================================

class TestPRCreation:
    """Test pull request creation for GitHub and Bitbucket."""

    @patch("src.git.provider_strategy.httpx.Client")
    @patch.object(GitManager, "load_config")
    def test_create_github_pr(self, mock_config, mock_client_cls, git_manager):
        """GitHub PR creation sends correct payload."""
        mock_config.return_value = {
            "repo_url": "https://github.com/acme/backend.git",
            "provider": "github",
        }
        mock_response = Mock()
        mock_response.json.return_value = {"html_url": "https://github.com/acme/backend/pull/42"}
        mock_response.raise_for_status = Mock()

        mock_client = MagicMock()
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_cls.return_value = mock_client

        pr_url = git_manager.create_pull_request(
            title="feature: user-auth",
            branch="feature/user-auth",
            body="Spec summary here",
        )

        assert pr_url == "https://github.com/acme/backend/pull/42"
        call_kwargs = mock_client.post.call_args
        assert "acme/backend" in call_kwargs[0][0]
        assert call_kwargs[1]["json"]["title"] == "feature: user-auth"
        assert call_kwargs[1]["json"]["head"] == "feature/user-auth"
        assert call_kwargs[1]["json"]["base"] == "main"

    @patch("src.git.provider_strategy.httpx.Client")
    @patch.object(GitManager, "load_config")
    def test_create_bitbucket_pr(self, mock_config, mock_client_cls):
        """Bitbucket PR creation sends correct payload."""
        gm = GitManager(
            project_dir=Path("/tmp/test"),
            provider="bitbucket",
            default_branch="main",
            bitbucket_username="bb_user",
            bitbucket_app_password="bb_pass",
        )
        mock_config.return_value = {
            "repo_url": "https://bitbucket.org/acme/backend.git",
            "provider": "bitbucket",
        }
        mock_response = Mock()
        mock_response.json.return_value = {
            "links": {"html": {"href": "https://bitbucket.org/acme/backend/pull-requests/7"}}
        }
        mock_response.raise_for_status = Mock()

        mock_client = MagicMock()
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_cls.return_value = mock_client

        pr_url = gm.create_pull_request(
            title="feature: payments",
            branch="feature/payments",
            body="PR body",
        )

        assert pr_url == "https://bitbucket.org/acme/backend/pull-requests/7"
        call_kwargs = mock_client.post.call_args
        payload = call_kwargs[1]["json"]
        assert payload["source"]["branch"]["name"] == "feature/payments"
        assert payload["destination"]["branch"]["name"] == "main"

    @patch("src.git.provider_strategy.httpx.Client")
    @patch.object(GitManager, "load_config")
    def test_create_pr_returns_url(self, mock_config, mock_client_cls, git_manager):
        """PR creation returns the URL string."""
        mock_config.return_value = {"repo_url": "https://github.com/acme/backend.git"}
        mock_response = Mock()
        mock_response.json.return_value = {"html_url": "https://github.com/acme/backend/pull/99"}
        mock_response.raise_for_status = Mock()

        mock_client = MagicMock()
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_cls.return_value = mock_client

        url = git_manager.create_pull_request("title", "branch", "body")
        assert url.startswith("https://")
        assert "/pull/" in url

    @patch("src.git.provider_strategy.httpx.Client")
    @patch.object(GitManager, "load_config")
    def test_create_pr_raises_on_http_error(self, mock_config, mock_client_cls, git_manager):
        """PR creation raises on HTTP error."""
        mock_config.return_value = {"repo_url": "https://github.com/acme/backend.git"}
        mock_response = Mock()
        mock_response.raise_for_status.side_effect = Exception("422 Unprocessable Entity")

        mock_client = MagicMock()
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_cls.return_value = mock_client

        with pytest.raises(Exception, match="422"):
            git_manager.create_pull_request("title", "branch", "body")


# ============================================================
# Task Group 6: Config Loader Tests (6.1)
# ============================================================

class TestGitConfig:
    """Test git config loading from environment variables."""

    def test_load_git_config_github(self, monkeypatch):
        """Loads config correctly for GitHub provider."""
        monkeypatch.setenv("GIT_PROVIDER", "github")
        monkeypatch.setenv("GIT_DEFAULT_BRANCH", "develop")
        monkeypatch.setenv("GIT_AUTO_PUSH", "true")
        monkeypatch.setenv("GIT_AUTO_PR", "false")
        monkeypatch.setenv("GITHUB_TOKEN", "ghp_token_123")

        config = load_git_config()

        assert config.provider == "github"
        assert config.default_branch == "develop"
        assert config.auto_push is True
        assert config.auto_pr is False
        assert config.github_token == "ghp_token_123"

    def test_load_git_config_missing_provider(self, monkeypatch):
        """Raises error when GIT_PROVIDER is missing."""
        monkeypatch.delenv("GIT_PROVIDER", raising=False)

        with pytest.raises(GitConfigError, match="GIT_PROVIDER is required"):
            load_git_config()

    def test_load_git_config_missing_github_token(self, monkeypatch):
        """Raises error when GITHUB_TOKEN missing for github provider."""
        monkeypatch.setenv("GIT_PROVIDER", "github")
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)

        with pytest.raises(GitConfigError, match="GITHUB_TOKEN is required"):
            load_git_config()

    def test_load_git_config_missing_bitbucket_creds(self, monkeypatch):
        """Raises error when Bitbucket credentials missing."""
        monkeypatch.setenv("GIT_PROVIDER", "bitbucket")
        monkeypatch.delenv("BITBUCKET_USERNAME", raising=False)

        with pytest.raises(GitConfigError, match="BITBUCKET_USERNAME is required"):
            load_git_config()
