"""
Integration test for the V2 git layer's repo-directory resolution.

No mocks at the seam: builds a real product workspace where the repo is cloned
into ``product_root/<folder>`` (exactly as ``POST /projects/init`` lays it out,
see ``src/api/routes/projects.py``) plus a ``coordination.yaml`` at the product
root, then exercises the REAL ``_require_git_manager`` + ``GitManager.pull_latest``
against a real local "remote".

Regression guard for the polyrepo-layout bug: ``_require_git_manager`` used to
build ``GitManager(product_root)``, but the ``.git`` lives in
``product_root/<folder>`` -- so ``pull_latest()`` died with
"fatal: not a git repository". Every prior test mocked one side of this seam
(``projects.GitManager`` on init, ``_require_git_manager`` on the V2 endpoints),
so nothing ever asserted that the git layer runs inside the dir init wrote to.

These tests assert exactly that contract end to end.
"""

import subprocess
import types
from pathlib import Path

import pytest
from fastapi import HTTPException

import src.api as api


def _git(args, cwd):
    subprocess.run(
        ["git", *args], cwd=str(cwd), check=True, capture_output=True, text=True
    )


@pytest.fixture
def fake_git_config():
    """The GLOBAL git config (provider/branch/tokens) -- not the seam under test."""
    return types.SimpleNamespace(
        provider="github",
        default_branch="main",
        github_token=None,
        bitbucket_username=None,
        bitbucket_app_password=None,
    )


def _clone_into(remote: Path, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["git", "clone", str(remote), str(dest)], check=True, capture_output=True
    )
    _git(["config", "user.email", "t@t.com"], dest)
    _git(["config", "user.name", "Test"], dest)


def _make_remote_with_main(tmp_path: Path) -> Path:
    """Create a bare 'remote' repo seeded with one commit on `main`."""
    remote = tmp_path / "remote.git"
    subprocess.run(
        ["git", "init", "--bare", "-b", "main", str(remote)],
        check=True,
        capture_output=True,
    )
    seed = tmp_path / "seed"
    _clone_into(remote, seed)
    (seed / "README.md").write_text("# seed\n")
    _git(["add", "-A"], seed)
    _git(["commit", "-m", "init"], seed)
    _git(["push", "origin", "main"], seed)
    return remote


def test_require_git_manager_points_at_repo_folder_and_pull_succeeds(
    tmp_path, monkeypatch, fake_git_config
):
    # Relocate the workspace into tmp (sanitize_path reads API_WORKSPACE_DIR at
    # call time). Patch only the GLOBAL git config; read_coordination /
    # GitManager / _run_git stay real.
    monkeypatch.setattr(api, "API_WORKSPACE_DIR", tmp_path.resolve())
    monkeypatch.setattr(api, "load_git_config", lambda: fake_git_config)

    company, project, folder = "acme", "backend", "app"
    product_root = tmp_path / company / project
    repo_dir = product_root / folder

    remote = _make_remote_with_main(tmp_path)
    _clone_into(remote, repo_dir)  # the per-folder clone, like init does
    (product_root / "coordination.yaml").write_text(
        f'{folder}: "https://example.com/acme/backend.git"\n', encoding="utf-8"
    )

    gm = api._require_git_manager(company, project)

    # THE SEAM: the GitManager must operate inside the repo folder, never the
    # product root (which holds only coordination.yaml + the subfolder).
    assert Path(gm.project_dir) == repo_dir.resolve()
    assert (Path(gm.project_dir) / ".git").exists()
    assert Path(gm.project_dir) != product_root.resolve()

    # A real pull must NOT raise "fatal: not a git repository" -- the exact
    # failure the old GitManager(product_root) produced.
    gm.pull_latest()


def test_require_git_manager_accepts_polyrepo_uses_first_repo(
    tmp_path, monkeypatch, fake_git_config
):
    # Polyrepo is now SUPPORTED: _require_git_manager no longer 400-rejects >1
    # repo -- it builds the pre-flight GitManager for the FIRST repo folder, and
    # the multi-repo iteration happens later in tasks._resolve_repo_targets. This
    # guards the removal of the old "polyrepo not supported" rejection.
    monkeypatch.setattr(api, "API_WORKSPACE_DIR", tmp_path.resolve())
    monkeypatch.setattr(api, "load_git_config", lambda: fake_git_config)

    company, project = "acme", "multi"
    product_root = tmp_path / company / project
    product_root.mkdir(parents=True)
    # coordination maps two repos; YAML insertion order = a then b
    (product_root / "coordination.yaml").write_text(
        'a: "https://example.com/a.git"\nb: "https://example.com/b.git"\n',
        encoding="utf-8",
    )
    # the FIRST folder must be a real clone -- that's the one it pre-flights
    remote = _make_remote_with_main(tmp_path)
    _clone_into(remote, product_root / "a")

    gm = api._require_git_manager(company, project)  # must NOT raise

    assert Path(gm.project_dir) == (product_root / "a").resolve()
    assert (Path(gm.project_dir) / ".git").exists()


def test_require_git_manager_uninitialized_is_400(tmp_path, monkeypatch, fake_git_config):
    monkeypatch.setattr(api, "API_WORKSPACE_DIR", tmp_path.resolve())
    monkeypatch.setattr(api, "load_git_config", lambda: fake_git_config)

    with pytest.raises(HTTPException) as ei:
        api._require_git_manager("acme", "never-initialized")
    assert ei.value.status_code == 400
    assert "not initialized" in str(ei.value.detail).lower()
