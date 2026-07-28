"""Repo-target resolution resilience + step-question failure (2026-07-28).

Live run: steps 1-3 produced the real migration artifacts, then (a) the git
phase found "no repo targets" at the run-worktree product root and committed
NOTHING (reclamation then destroyed all output), and (b) the skill-less
step 4 improvised /ask-questions and stalled a headless job ~7 minutes.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from src.job_queue.tasks import _resolve_repo_targets, _scan_git_subdirs


def _git_init(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q", str(path)], check=True, capture_output=True)


def test_broken_coordination_falls_back_to_git_scan(tmp_path):
    (tmp_path / "coordination.yaml").write_text("[broken yaml: [", encoding="utf-8")
    _git_init(tmp_path / "backend")

    targets = _resolve_repo_targets(tmp_path)

    assert targets == [("backend", tmp_path / "backend")]


def test_missing_coordination_falls_back_to_git_scan(tmp_path):
    _git_init(tmp_path / "backend")
    _git_init(tmp_path / "frontend")

    targets = _resolve_repo_targets(tmp_path)

    assert [f for f, _ in targets] == ["backend", "frontend"]


def test_coordination_naming_unmatched_folders_falls_back(tmp_path):
    # Coordination names a folder that does not exist on disk, but a real
    # repo dir DOES exist — the scan recovers it.
    (tmp_path / "coordination.yaml").write_text(
        'ghost: "https://example.com/x.git"\n', encoding="utf-8"
    )
    _git_init(tmp_path / "actual-repo")

    targets = _resolve_repo_targets(tmp_path)

    assert targets == [("actual-repo", tmp_path / "actual-repo")]


def test_worktree_style_git_file_counts(tmp_path):
    # A git WORKTREE has a `.git` FILE (gitdir pointer), not a directory.
    sub = tmp_path / "repo"
    sub.mkdir()
    (sub / ".git").write_text("gitdir: ../somewhere/.git/worktrees/repo\n")

    assert _scan_git_subdirs(tmp_path) == [("repo", sub)]


def test_bare_root_still_resolves_nothing(tmp_path):
    (tmp_path / "docs").mkdir()

    assert _resolve_repo_targets(tmp_path) == []


def test_valid_coordination_still_wins_over_scan(tmp_path):
    # Coordination declares ONE of the two repos — its scoping is respected
    # (the scan is a fallback, not an override).
    (tmp_path / "coordination.yaml").write_text(
        'backend: "https://example.com/b.git"\n', encoding="utf-8"
    )
    _git_init(tmp_path / "backend")
    _git_init(tmp_path / "unrelated")

    targets = _resolve_repo_targets(tmp_path)

    assert targets == [("backend", tmp_path / "backend")]
