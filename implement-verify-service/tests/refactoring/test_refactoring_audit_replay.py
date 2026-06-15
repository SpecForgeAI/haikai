"""Phase 8 hardening — audit log replay + atomic apply."""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from src.dep.db import DepGraph
from src.refactoring import __version__
from src.refactoring.rename_engine import (
    AUDIT_LOG_NAME,
    rename_apply,
    rename_preview,
)


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
def harness(tmp_path: Path):
    repo = tmp_path / "repo"
    snap = tmp_path / "snap"
    repo.mkdir(); snap.mkdir()
    _git(repo, "init", "-b", "main")
    _git(repo, "config", "commit.gpgsign", "false")
    (repo / "lib.py").write_text(
        "class Greeter:\n    def hello(self):\n        return 'hi'\n",
        encoding="utf-8",
    )
    _git(repo, "add", "."); _git(repo, "commit", "-m", "init")

    g = DepGraph.create_empty(snap / "_depgraph.sqlite")
    g.execute("INSERT INTO files(id, path, language) VALUES (1, 'lib.py', 'python')")
    g.execute(
        "INSERT INTO symbols(id, name, qualified_name, kind, file_id, line, language) "
        "VALUES (?,?,?,?,?,?,?)",
        (1, "Greeter", "lib.Greeter", "class", 1, 1, "python"),
    )
    g.commit()
    yield repo, g, snap
    g.close()


def test_audit_log_record_shape(harness):
    """Record contains all required fields per spec."""
    repo, g, snap = harness
    plan = rename_preview(repo, g, "lib.Greeter", "Salutator")
    rename_apply(repo, g, plan, snapshot_path=snap)
    log = (snap / AUDIT_LOG_NAME).read_text(encoding="utf-8").strip()
    rec = json.loads(log)
    assert set(rec.keys()) == {
        "timestamp", "op", "old_qname", "new_name", "kind",
        "files_changed", "sha_before", "triggered_by", "tool_version",
    }
    assert rec["tool_version"] == __version__


def test_replay_log_produces_same_result(harness):
    """Apply a rename, revert via git checkout, replay the audit log →
    state matches the first apply (same files patched, same content)."""
    repo, g, snap = harness
    plan = rename_preview(repo, g, "lib.Greeter", "Salutator")
    rename_apply(repo, g, plan, snapshot_path=snap)
    after_first = (repo / "lib.py").read_text(encoding="utf-8")

    # Revert
    _git(repo, "checkout", "--", "lib.py")
    assert "Salutator" not in (repo / "lib.py").read_text(encoding="utf-8")

    # Replay: read the audit log, run the same preview + apply
    log = (snap / AUDIT_LOG_NAME).read_text(encoding="utf-8").strip()
    rec = json.loads(log)
    plan2 = rename_preview(repo, g, rec["old_qname"], rec["new_name"])
    rename_apply(repo, g, plan2, snapshot_path=snap)
    after_replay = (repo / "lib.py").read_text(encoding="utf-8")
    assert after_replay == after_first


def test_atomic_apply_no_temp_files_left(harness):
    """A successful apply leaves no .tmp files behind."""
    repo, g, snap = harness
    plan = rename_preview(repo, g, "lib.Greeter", "Salutator")
    rename_apply(repo, g, plan, snapshot_path=snap)
    leftover = list(repo.rglob("*.tmp"))
    assert leftover == []


def test_triggered_by_recorded(harness):
    """`triggered_by` propagates from the apply call into the log."""
    repo, g, snap = harness
    plan = rename_preview(repo, g, "lib.Greeter", "Salutator")
    rename_apply(repo, g, plan, snapshot_path=snap, triggered_by="rest")
    rec = json.loads((snap / AUDIT_LOG_NAME).read_text(encoding="utf-8").strip())
    assert rec["triggered_by"] == "rest"
