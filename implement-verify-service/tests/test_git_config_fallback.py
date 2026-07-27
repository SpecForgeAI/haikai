"""Saved-project-provider fallback for git config (2026-07-27).

`POST /projects/init` accepts a per-request `git_provider` and persists it
into each cloned repo's `.haikai/config.json` — but every downstream site
loaded the env-only `load_git_config()`, so a gitlab-initialised project
400'd with "GIT_PROVIDER is required" on its first v2 request (live-confirmed
on the first Stage-1 dispatch). These pins hold the fallback contract:

  1. a COMPLETE env wins untouched (existing single-provider deployments);
  2. an env with no GIT_PROVIDER falls back to the provider saved by init
     (token still sourced from the env);
  3. no saved config -> the ORIGINAL env error re-raises;
  4. `load_git_config_for_product_root` discovers any repo's saved config
     under the product root;
  5. `git_default_branch` never raises: env branch > saved branch > 'main'.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.git.config import (
    GitConfigError,
    git_default_branch,
    load_git_config,
    load_git_config_for_product_root,
    load_git_config_with_project_fallback,
)


def _write_saved_config(repo_dir: Path, provider: str, default_branch: str = "main") -> None:
    cfg_dir = repo_dir / ".haikai"
    cfg_dir.mkdir(parents=True, exist_ok=True)
    (cfg_dir / "config.json").write_text(
        json.dumps(
            {
                "repo_url": "https://gitlab.example.com/examplegroup/backend.git",
                "provider": provider,
                "default_branch": default_branch,
                "initialized_at": "2026-07-27T00:00:00+00:00",
            }
        ),
        encoding="utf-8",
    )


@pytest.fixture()
def clean_git_env(monkeypatch):
    for var in (
        "GIT_PROVIDER",
        "GIT_DEFAULT_BRANCH",
        "GITHUB_TOKEN",
        "GITLAB_TOKEN",
        "BITBUCKET_USERNAME",
        "BITBUCKET_APP_PASSWORD",
    ):
        monkeypatch.delenv(var, raising=False)
    return monkeypatch


def test_complete_env_wins_untouched(clean_git_env, tmp_path):
    clean_git_env.setenv("GIT_PROVIDER", "github")
    clean_git_env.setenv("GITHUB_TOKEN", "tok-env")
    # A saved config with a DIFFERENT provider must not override a valid env.
    _write_saved_config(tmp_path, "gitlab")

    config = load_git_config_with_project_fallback([tmp_path])
    assert config.provider == "github"


def test_missing_env_provider_falls_back_to_saved(clean_git_env, tmp_path):
    # The live shape: no GIT_PROVIDER in the env, but the init saved gitlab
    # and the gitlab token IS in the env (the init clone used it).
    clean_git_env.setenv("GITLAB_TOKEN", "tok-gitlab")
    _write_saved_config(tmp_path, "gitlab")

    config = load_git_config_with_project_fallback([tmp_path])
    assert config.provider == "gitlab"
    assert config.gitlab_token == "tok-gitlab"


def test_no_saved_config_reraises_original_env_error(clean_git_env, tmp_path):
    with pytest.raises(GitConfigError, match="GIT_PROVIDER is required"):
        load_git_config_with_project_fallback([tmp_path])
    # And the bare env loader still behaves identically (unchanged contract).
    with pytest.raises(GitConfigError, match="GIT_PROVIDER is required"):
        load_git_config()


def test_product_root_discovers_any_repo_saved_config(clean_git_env, tmp_path):
    clean_git_env.setenv("GITLAB_TOKEN", "tok-gitlab")
    # Poly layout: product_root/<folder>/.haikai/config.json.
    _write_saved_config(tmp_path / "backend", "gitlab")

    config = load_git_config_for_product_root(tmp_path)
    assert config.provider == "gitlab"


def test_git_default_branch_never_raises(clean_git_env, tmp_path):
    # No env, no saved config, no provider anywhere -> 'main', no exception.
    assert git_default_branch(None) == "main"
    assert git_default_branch(tmp_path) == "main"

    # Saved branch wins over the 'main' default…
    _write_saved_config(tmp_path, "gitlab", default_branch="develop")
    assert git_default_branch(tmp_path) == "develop"

    # …and the env var wins over the saved branch.
    clean_git_env.setenv("GIT_DEFAULT_BRANCH", "trunk")
    assert git_default_branch(tmp_path) == "trunk"
