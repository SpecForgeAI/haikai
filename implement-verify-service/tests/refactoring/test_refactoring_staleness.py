"""Tests for src/refactoring/staleness.py."""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from src.refactoring.staleness import check_staleness


def _git(repo: Path, *args: str) -> str:
    env = os.environ.copy()
    env.setdefault("GIT_AUTHOR_NAME", "Test")
    env.setdefault("GIT_AUTHOR_EMAIL", "test@example.com")
    env.setdefault("GIT_COMMITTER_NAME", "Test")
    env.setdefault("GIT_COMMITTER_EMAIL", "test@example.com")
    return subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, text=True,
        env=env, check=True,
    ).stdout


@pytest.fixture
def repo(tmp_path: Path):
    r = tmp_path / "r"
    r.mkdir()
    _git(r, "init", "-b", "main")
    _git(r, "config", "commit.gpgsign", "false")
    (r / "a.py").write_text("x = 1\n", encoding="utf-8")
    _git(r, "add", "a.py")
    _git(r, "commit", "-m", "init")
    return r


def _head(r: Path) -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=r, capture_output=True, text=True, check=True,
    ).stdout.strip()


def test_fresh_when_meta_matches_head_clean_tree(tmp_path: Path, repo: Path):
    snap = tmp_path / "snap"
    snap.mkdir()
    head = _head(repo)
    (snap / "_meta.json").write_text(json.dumps({"commit_sha": head}), encoding="utf-8")
    rep = check_staleness(snap, repo)
    assert rep.level == "fresh"
    assert rep.snapshot_sha == head
    assert rep.head_sha == head


def test_stale_when_sha_matches_but_tree_dirty(tmp_path: Path, repo: Path):
    snap = tmp_path / "snap"
    snap.mkdir()
    head = _head(repo)
    (snap / "_meta.json").write_text(json.dumps({"commit_sha": head}), encoding="utf-8")
    (repo / "a.py").write_text("x = 999\n", encoding="utf-8")
    rep = check_staleness(snap, repo)
    assert rep.level == "stale"
    assert "a.py" in rep.modified_files_since


def test_outdated_when_head_advanced(tmp_path: Path, repo: Path):
    snap = tmp_path / "snap"
    snap.mkdir()
    old_head = _head(repo)
    (snap / "_meta.json").write_text(json.dumps({"commit_sha": old_head}), encoding="utf-8")
    # Advance HEAD
    (repo / "b.py").write_text("y = 2\n", encoding="utf-8")
    _git(repo, "add", "b.py")
    _git(repo, "commit", "-m", "second")
    new_head = _head(repo)
    rep = check_staleness(snap, repo)
    assert rep.level == "outdated"
    assert rep.snapshot_sha == old_head
    assert rep.head_sha == new_head


def test_no_sha_falls_back_to_mtime(tmp_path: Path, repo: Path):
    """When no SHA can be found, the mtime fallback kicks in and reports
    fresh-mtime / stale-mtime instead of plain 'unknown'. The pure 'unknown'
    level now only fires when the fallback itself errors."""
    snap = tmp_path / "snap"
    snap.mkdir()  # no meta files, no sha-like dirname
    rep = check_staleness(snap, repo)
    assert rep.snapshot_sha is None
    assert rep.level in ("fresh-mtime", "stale-mtime")
    assert any("snapshot SHA not found" in n for n in rep.notes)


def test_dir_name_fallback_full_sha(tmp_path: Path, repo: Path):
    head = _head(repo)
    snap = tmp_path / head  # dir name is the SHA
    snap.mkdir()
    rep = check_staleness(snap, repo)
    assert rep.snapshot_sha == head
    assert rep.level in ("fresh", "stale")  # depending on tree state — clean here


def test_dir_name_fallback_repo_then_sha(tmp_path: Path, repo: Path):
    head = _head(repo)
    snap = tmp_path / "myrepo" / head
    snap.mkdir(parents=True)
    rep = check_staleness(snap, repo)
    assert rep.snapshot_sha == head


def test_meta_yaml_fallback(tmp_path: Path, repo: Path):
    """SHA stored in _meta.yaml (V2 runner format) — we don't have pyyaml as a
    dep so we line-grep the file."""
    snap = tmp_path / "snap"
    snap.mkdir()
    head = _head(repo)
    (snap / "_meta.yaml").write_text(
        f"repo: foo\ncommit: {head}\nbranch: main\n", encoding="utf-8",
    )
    rep = check_staleness(snap, repo)
    assert rep.snapshot_sha == head
    assert rep.level == "fresh"


def test_mtime_fallback_fresh_when_nothing_newer(tmp_path: Path, repo: Path):
    """No SHA, no edits since snapshot — mtime fallback says fresh-mtime."""
    import time as _t
    snap = tmp_path / "snap"
    snap.mkdir()
    # Create a depgraph file BEFORE no source changes
    _t.sleep(0.05)  # ensure source files predate the dep-graph
    (snap / "_depgraph.sqlite").write_bytes(b"")
    rep = check_staleness(snap, repo)
    assert rep.level == "fresh-mtime"


def test_mtime_fallback_stale_when_source_newer(tmp_path: Path, repo: Path):
    """No SHA, source modified after snapshot build — stale-mtime."""
    import time as _t
    snap = tmp_path / "snap"
    snap.mkdir()
    (snap / "_depgraph.sqlite").write_bytes(b"")
    _t.sleep(1.1)  # ensure subsequent edits are clearly newer
    (repo / "a.py").write_text("x = 999\n", encoding="utf-8")
    rep = check_staleness(snap, repo)
    assert rep.level == "stale-mtime"
    assert "a.py" in rep.modified_files_since
