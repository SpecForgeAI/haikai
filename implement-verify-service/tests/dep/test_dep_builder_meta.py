"""Tests for the depgraph builder's `_write_meta_json` — verifies the
commit-SHA propagation added by the 2026-04-27-depgraph-commit-sha spec."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.dep.builder import _read_upstream_meta, _write_meta_json
from src.dep.db import DepGraph

VALID_SHA = "abcdef0123456789abcdef0123456789abcdef01"  # 40 hex chars


def _empty_db(snap: Path) -> Path:
    """Create a minimal valid depgraph SQLite next to a fresh snapshot dir."""
    snap.mkdir(parents=True, exist_ok=True)
    db_path = snap / "_depgraph.sqlite"
    g = DepGraph.create_empty(db_path)
    g.commit(); g.close()
    return db_path


def test_meta_carries_commit_sha_when_yaml_present(tmp_path: Path):
    snap = tmp_path / "snap"
    db = _empty_db(snap)
    (snap / "_meta.yaml").write_text(
        f"repo: foo\ncommit: {VALID_SHA}\nremote: https://example.com/foo.git\n",
        encoding="utf-8",
    )
    _write_meta_json(snap, db, build_seconds=0.5)
    meta = json.loads((snap / "_depgraph.meta.json").read_text(encoding="utf-8"))
    assert meta["commit_sha"] == VALID_SHA
    assert meta["repo_remote"] == "https://example.com/foo.git"


def test_meta_commit_sha_null_when_yaml_missing(tmp_path: Path):
    snap = tmp_path / "snap"
    db = _empty_db(snap)
    _write_meta_json(snap, db, build_seconds=0.5)
    meta = json.loads((snap / "_depgraph.meta.json").read_text(encoding="utf-8"))
    assert meta["commit_sha"] is None
    assert meta["repo_remote"] is None


def test_meta_rejects_non_40_char_sha(tmp_path: Path):
    """Placeholders like `commit: head` or short SHAs must NOT pollute the
    meta JSON — only full 40-char SHAs are accepted."""
    snap = tmp_path / "snap"
    db = _empty_db(snap)
    (snap / "_meta.yaml").write_text(
        "repo: foo\ncommit: head\nremote: https://x/y.git\n",
        encoding="utf-8",
    )
    _write_meta_json(snap, db, build_seconds=0.5)
    meta = json.loads((snap / "_depgraph.meta.json").read_text(encoding="utf-8"))
    assert meta["commit_sha"] is None  # 'head' rejected
    assert meta["repo_remote"] == "https://x/y.git"  # remote still captured


def test_read_upstream_meta_quoted_sha(tmp_path: Path):
    """`commit: 'abc...'` (quoted) should also work."""
    snap = tmp_path / "snap"
    snap.mkdir()
    (snap / "_meta.yaml").write_text(
        f"commit: '{VALID_SHA}'\nremote: \"https://example.com/r.git\"\n",
        encoding="utf-8",
    )
    sha, remote = _read_upstream_meta(snap)
    assert sha == VALID_SHA
    assert remote == "https://example.com/r.git"


def test_existing_meta_keys_unchanged(tmp_path: Path):
    """row_counts, build_seconds, snapshot, db keys must still be present."""
    snap = tmp_path / "snap"
    db = _empty_db(snap)
    _write_meta_json(snap, db, build_seconds=1.23)
    meta = json.loads((snap / "_depgraph.meta.json").read_text(encoding="utf-8"))
    for key in ("snapshot", "db", "build_seconds", "row_counts"):
        assert key in meta
    assert meta["build_seconds"] == 1.23
    assert isinstance(meta["row_counts"], dict)
