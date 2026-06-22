"""
Regression test for the push self-heal (fix 5).

The provider-strategy fix corrects the GitHub remote URL only at *clone* time,
so repos cloned before it keep a broken `origin` (token in the username slot,
no password) and `git push` keeps failing in the headless container
("could not read Password ... No such device or address"). `push_branch` now
refreshes `origin` to the current authenticated URL first, so existing clones
self-heal -- no re-init or new project needed.

These use real git but only LOCAL config ops (`remote get-url` / `set-url`), so
no network is required.
"""

import subprocess
from pathlib import Path

import pytest

from src.git.git_manager import GitManager


def _init_repo_with_origin(tmp_path: Path, origin_url: str) -> Path:
    repo = tmp_path / "repo"
    subprocess.run(["git", "init", str(repo)], check=True, capture_output=True)
    subprocess.run(
        ["git", "remote", "add", "origin", origin_url],
        cwd=repo, check=True, capture_output=True,
    )
    return repo


def _origin_url(repo: Path) -> str:
    return subprocess.run(
        ["git", "remote", "get-url", "origin"],
        cwd=repo, check=True, capture_output=True, text=True,
    ).stdout.strip()


def test_refresh_rewrites_legacy_token_in_username_slot(tmp_path):
    # Simulate a pre-fix clone: token as the bare username, no password.
    repo = _init_repo_with_origin(
        tmp_path, "https://github_pat_OLD@github.com/owner/repo.git"
    )
    gm = GitManager(project_dir=repo, provider="github", github_token="github_pat_NEW")
    gm._refresh_origin_auth_url()
    assert _origin_url(repo) == (
        "https://x-access-token:github_pat_NEW@github.com/owner/repo.git"
    )


def test_refresh_is_idempotent_on_already_fixed_url(tmp_path):
    good = "https://x-access-token:github_pat_NEW@github.com/owner/repo.git"
    repo = _init_repo_with_origin(tmp_path, good)
    gm = GitManager(project_dir=repo, provider="github", github_token="github_pat_NEW")
    gm._refresh_origin_auth_url()
    assert _origin_url(repo) == good


def test_refresh_leaves_ssh_remote_untouched(tmp_path):
    ssh = "git@github.com:owner/repo.git"
    repo = _init_repo_with_origin(tmp_path, ssh)
    gm = GitManager(project_dir=repo, provider="github", github_token="github_pat_NEW")
    gm._refresh_origin_auth_url()
    assert _origin_url(repo) == ssh


def test_refresh_with_no_origin_is_noop(tmp_path):
    repo = tmp_path / "repo"
    subprocess.run(["git", "init", str(repo)], check=True, capture_output=True)
    gm = GitManager(project_dir=repo, provider="github", github_token="github_pat_NEW")
    gm._refresh_origin_auth_url()  # must not raise
