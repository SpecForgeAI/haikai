"""Worktree paths are ALWAYS absolute (2026-07-28).

The live failure: API_WORKSPACE_DIR held the RELATIVE value "api_workspace".
`git -C <live_repo> worktree add <dest>` resolves a relative dest against
the LIVE REPO, not the process cwd — so git planted the worktree INSIDE the
live clone while Python mkdir'd/seeded/validated an empty cwd-relative twin,
and allocation failed "resolves no repo targets after seeding" (and, before
that gate existed, a whole run's output was silently discarded).
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from src.git import worktree_runs as wr


def _init_repo(path: Path) -> None:
    path.mkdir(parents=True)

    def git(*a):
        subprocess.run(
            ["git", "-C", str(path), *a], check=True, capture_output=True
        )

    subprocess.run(["git", "init", "-q", "-b", "main", str(path)],
                   check=True, capture_output=True)
    (path / "base.txt").write_text("base\n", encoding="utf-8")
    git("add", "-A")
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init")


def test_add_worktree_relative_dest_lands_at_cwd_not_inside_live_repo(
    tmp_path, monkeypatch
):
    live = tmp_path / "live"
    _init_repo(live)
    monkeypatch.chdir(tmp_path)

    # The live bug shape: BOTH args relative (as the job layer passed them).
    wr.add_worktree(Path("live"), Path("ws/wt/abc123/repo"),
                    "feature/abs-test", "main")

    # The worktree must exist at the cwd-resolved destination…
    assert (tmp_path / "ws" / "wt" / "abc123" / "repo" / ".git").exists()
    # …and must NOT have been planted inside the live clone.
    assert not (live / "ws").exists()


def test_run_root_is_absolute_for_relative_workspace(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    root = wr.run_root("api_workspace", "f9e6a1a6-03e1-40c3-9cb5-5a05c5ef63d5")

    assert root.is_absolute()
    assert root == tmp_path / "api_workspace" / "wt" / "f9e6a1a603e140c3"
