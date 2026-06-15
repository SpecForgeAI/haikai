"""Tests for src/refactoring/rename_engine.py.

Synthetic repo + dep-graph; covers preview, ambiguity, apply, dirty-tree
refusal, and the audit log.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from src.dep.db import DepGraph
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
def repo_with_graph(tmp_path: Path):
    """Two-file repo with a class `Greeter`, a function `greet`, and several refs."""
    repo = tmp_path / "repo"
    repo.mkdir()
    snapshot = tmp_path / "snap"
    snapshot.mkdir()
    _git(repo, "init", "-b", "main")
    _git(repo, "config", "commit.gpgsign", "false")

    (repo / "lib.py").write_text(
        "class Greeter:\n"
        "    def hello(self):\n"
        "        return 'hi'\n"
        "\n"
        "def greet(name):\n"
        "    return Greeter().hello() + ' ' + name\n",
        encoding="utf-8",
    )
    (repo / "main.py").write_text(
        "from lib import Greeter\n"
        "\n"
        "def run():\n"
        "    g = Greeter()\n"
        "    return g.hello()\n",
        encoding="utf-8",
    )
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "init")

    g = DepGraph.create_empty(snapshot / "_depgraph.sqlite")
    g.execute("INSERT INTO files(id, path, language) VALUES (1, 'lib.py', 'python')")
    g.execute("INSERT INTO files(id, path, language) VALUES (2, 'main.py', 'python')")
    g.executemany(
        "INSERT INTO symbols(id, name, qualified_name, kind, file_id, line, language) "
        "VALUES (?,?,?,?,?,?,?)",
        [
            (1, "Greeter", "lib.Greeter", "class",    1, 1, "python"),
            (2, "hello",   "lib.Greeter.hello", "method", 1, 2, "python"),
            (3, "greet",   "lib.greet", "function", 1, 5, "python"),
            (4, "run",     "main.run",  "function", 2, 3, "python"),
        ],
    )
    # main.run calls Greeter() (treat as call to class)
    g.execute(
        "INSERT INTO calls(caller_symbol_id, callee_symbol_id, callee_qualified_name, file_id) "
        "VALUES (?, ?, ?, ?)",
        (4, 1, "lib.Greeter", 2),
    )
    # main imports Greeter from lib
    g.execute(
        "INSERT INTO imports(file_id, package, imported_name) VALUES (?, ?, ?)",
        (2, "lib", "Greeter"),
    )
    g.commit()
    yield repo, g, snapshot
    g.close()


def test_preview_finds_graph_text_and_import_refs(repo_with_graph):
    repo, g, _snap = repo_with_graph
    plan = rename_preview(repo, g, "lib.Greeter", "Salutator")
    assert not plan.ambiguous
    assert plan.kind == "class"
    assert plan.resolved_old_name == "Greeter"
    # Text refs include lib.py + main.py occurrences
    text_files = {r.file for r in plan.text_refs}
    assert "lib.py" in text_files
    assert "main.py" in text_files
    # Import ref captured
    assert any(r.file == "main.py" for r in plan.import_refs)
    # Patches generated for the both-partition refs
    assert plan.patches
    files_patched = {p.file for p in plan.patches}
    assert "lib.py" in files_patched and "main.py" in files_patched


def test_preview_ambiguous_bare_name(repo_with_graph):
    """A bare name `hello` is unique here (1 hit), so use a name that collides.
    `Greeter` qualified name 'lib.Greeter' is unique → not ambiguous.
    To trigger ambiguity, query the bare 'hello' across multiple files."""
    repo, g, _snap = repo_with_graph
    # Insert a duplicate `hello` symbol in main.py to create ambiguity
    g.execute("INSERT INTO files(id, path, language) VALUES (3, 'extra.py', 'python')")
    g.execute(
        "INSERT INTO symbols(id, name, qualified_name, kind, file_id, line, language) "
        "VALUES (?,?,?,?,?,?,?)",
        (5, "hello", "extra.hello", "function", 3, 1, "python"),
    )
    g.commit()
    plan = rename_preview(repo, g, "hello", "salute")
    assert plan.ambiguous is True
    qnames = sorted(c.qualified_name for c in plan.ambiguity_candidates)
    assert qnames == ["extra.hello", "lib.Greeter.hello"]
    assert plan.patches == []


def test_preview_unknown_symbol_returns_empty_plan(repo_with_graph):
    repo, g, _snap = repo_with_graph
    plan = rename_preview(repo, g, "nope.no_such", "X")
    assert not plan.ambiguous
    assert plan.patches == []
    assert any("no symbol matches" in n for n in plan.notes)


def test_apply_writes_patches_and_audit_log(repo_with_graph):
    repo, g, snap = repo_with_graph
    plan = rename_preview(repo, g, "lib.Greeter", "Salutator")
    applied = rename_apply(repo, g, plan, snapshot_path=snap)
    assert applied.applied is True
    # Source files were updated
    lib = (repo / "lib.py").read_text(encoding="utf-8")
    main = (repo / "main.py").read_text(encoding="utf-8")
    assert "Salutator" in lib
    assert "Salutator" in main
    assert "Greeter" not in lib
    assert "Greeter" not in main
    # Audit log written
    log = (snap / AUDIT_LOG_NAME)
    assert log.exists()
    record = json.loads(log.read_text(encoding="utf-8").strip().splitlines()[0])
    assert record["op"] == "rename"
    assert record["old_qname"] == "lib.Greeter"
    assert record["new_name"] == "Salutator"
    assert record["kind"] == "class"
    assert sorted(record["files_changed"]) == ["lib.py", "main.py"]
    assert record["triggered_by"] == "python_api"
    assert "sha_before" in record and len(record["sha_before"]) == 40


def test_apply_refuses_dirty_tree(repo_with_graph):
    repo, g, snap = repo_with_graph
    # Make working tree dirty
    (repo / "main.py").write_text(
        "from lib import Greeter\n# dirty marker\n", encoding="utf-8",
    )
    plan = rename_preview(repo, g, "lib.Greeter", "Salutator")
    applied = rename_apply(repo, g, plan, snapshot_path=snap)
    assert applied.applied is False
    assert any("dirty" in n for n in applied.notes)
    # Files unchanged because we refused
    main = (repo / "main.py").read_text(encoding="utf-8")
    assert "Salutator" not in main


def test_apply_force_dirty_proceeds(repo_with_graph):
    repo, g, snap = repo_with_graph
    (repo / "main.py").write_text(
        "from lib import Greeter\n# dirty marker\n", encoding="utf-8",
    )
    plan = rename_preview(repo, g, "lib.Greeter", "Salutator")
    applied = rename_apply(repo, g, plan, snapshot_path=snap, force_dirty=True)
    assert applied.applied is True


def test_ambiguous_plan_apply_is_noop(repo_with_graph):
    repo, g, snap = repo_with_graph
    g.execute("INSERT INTO files(id, path, language) VALUES (3, 'extra.py', 'python')")
    g.execute(
        "INSERT INTO symbols(id, name, qualified_name, kind, file_id, line, language) "
        "VALUES (?,?,?,?,?,?,?)",
        (5, "hello", "extra.hello", "function", 3, 1, "python"),
    )
    g.commit()
    plan = rename_preview(repo, g, "hello", "salute")
    assert plan.ambiguous
    applied = rename_apply(repo, g, plan, snapshot_path=snap)
    assert applied.applied is False
    # No log entry written for a no-op
    assert not (snap / AUDIT_LOG_NAME).exists()
