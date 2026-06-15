"""Tests for src/refactoring/change_detector.py.

Builds a synthetic dep-graph + a parallel git repo so we can edit files,
run detect_changes, and verify symbol attribution + impact aggregation.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

from src.dep.db import DepGraph
from src.refactoring.change_detector import detect_changes
from src.refactoring.git_repo import DiffScope


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


def _build_synthetic_graph(snapshot_dir: Path, repo_root: Path) -> DepGraph:
    """Hand-build a small dep-graph: 2 files, 4 symbols, 2 calls, 1 endpoint.

    Layout in repo:
        a.py:
            line 1: def alpha():            (function)
            line 2:     beta()
            line 3:     return 1
            line 5: def helper():           (function, called by alpha indirectly)
            line 6:     return 2
        b.py:
            line 1: def beta():             (function — called by alpha)
            line 2:     return 3
            line 4: # endpoint handler:
            line 5: def handle_get():       (function, endpoint handler)
            line 6:     return alpha()
    """
    db_path = snapshot_dir / "_depgraph.sqlite"
    g = DepGraph.create_empty(db_path)

    g.execute("INSERT INTO files(id, path, language) VALUES (?, ?, ?)",
              (1, "a.py", "python"))
    g.execute("INSERT INTO files(id, path, language) VALUES (?, ?, ?)",
              (2, "b.py", "python"))

    # Symbols (id, name, qname, kind, file_id, line, language)
    syms = [
        (1, "alpha",      "a.alpha",       "function", 1, 1, "python"),
        (2, "helper",     "a.helper",      "function", 1, 5, "python"),
        (3, "beta",       "b.beta",        "function", 2, 1, "python"),
        (4, "handle_get", "b.handle_get",  "function", 2, 5, "python"),
    ]
    g.executemany(
        "INSERT INTO symbols(id, name, qualified_name, kind, file_id, line, language) "
        "VALUES (?,?,?,?,?,?,?)",
        syms,
    )

    # Calls: alpha calls beta (a.py line 2); handle_get calls alpha (b.py line 6)
    g.execute(
        "INSERT INTO calls(caller_symbol_id, callee_symbol_id, callee_qualified_name, "
        "file_id) VALUES (?,?,?,?)",
        (1, 3, "b.beta", 1),
    )
    g.execute(
        "INSERT INTO calls(caller_symbol_id, callee_symbol_id, callee_qualified_name, "
        "file_id) VALUES (?,?,?,?)",
        (4, 1, "a.alpha", 2),
    )

    # Endpoint: GET /thing handled by handle_get
    g.execute(
        "INSERT INTO endpoints(operation, path, framework, handler_symbol_id, "
        "file_id, line) VALUES (?,?,?,?,?,?)",
        ("GET", "/thing", "test", 4, 2, 5),
    )

    g.commit()

    # Mirror the file layout in the git repo
    (repo_root / "a.py").write_text(
        "def alpha():\n    beta()\n    return 1\n\n"
        "def helper():\n    return 2\n",
        encoding="utf-8",
    )
    (repo_root / "b.py").write_text(
        "def beta():\n    return 3\n\n"
        "# endpoint handler:\ndef handle_get():\n    return alpha()\n",
        encoding="utf-8",
    )
    return g


@pytest.fixture
def repo_with_graph(tmp_path: Path):
    """Synthetic repo + dep-graph wired up. Yields (repo_path, depgraph)."""
    repo = tmp_path / "repo"
    repo.mkdir()
    snapshot = tmp_path / "snap"
    snapshot.mkdir()
    _git(repo, "init", "-b", "main")
    _git(repo, "config", "commit.gpgsign", "false")

    # Place the files via the graph builder (writes them too)
    g = _build_synthetic_graph(snapshot, repo)
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "init")
    yield repo, g
    g.close()


def test_no_changes_yields_empty_report(repo_with_graph):
    repo, g = repo_with_graph
    report = detect_changes(repo, g, scope=DiffScope.UNSTAGED)
    assert report.scope == "unstaged"
    assert report.files == []
    assert report.impacted_symbols == []
    assert report.risk.level == "low"
    assert report.risk.score == 0


def test_in_method_body_edit_attributes_to_enclosing_symbol(repo_with_graph):
    """Editing inside a function body (not the def line) should attribute to that function."""
    repo, g = repo_with_graph
    # a.py line 2 is the body of alpha (def is on line 1). Edit the body.
    p = repo / "a.py"
    p.write_text(
        "def alpha():\n    beta()  # changed\n    return 1\n\n"
        "def helper():\n    return 2\n",
        encoding="utf-8",
    )
    report = detect_changes(repo, g, scope=DiffScope.UNSTAGED)
    assert len(report.files) == 1
    fc = report.files[0]
    assert fc.path == "a.py"
    assert fc.status == "modified"
    qnames = [s.qualified_name for s in fc.impacted_symbols]
    # Alpha's def is on line 1; the edit on line 2 attributes to alpha (nearest preceding).
    assert "a.alpha" in qnames


def test_endpoint_handler_edit_marks_endpoint_affected(repo_with_graph):
    """Edit handle_get → endpoint /thing should appear in affected_endpoints."""
    repo, g = repo_with_graph
    p = repo / "b.py"
    p.write_text(
        "def beta():\n    return 3\n\n"
        "# endpoint handler:\ndef handle_get():\n    return alpha()  # tweak\n",
        encoding="utf-8",
    )
    report = detect_changes(repo, g, scope=DiffScope.UNSTAGED)
    qnames = [s.qualified_name for f in report.files for s in f.impacted_symbols]
    assert "b.handle_get" in qnames
    paths = [(ep.operation, ep.path) for ep in report.affected_endpoints]
    assert ("GET", "/thing") in paths


def test_added_file_no_impact(repo_with_graph):
    repo, g = repo_with_graph
    (repo / "new.py").write_text("def new_thing():\n    pass\n", encoding="utf-8")
    _git(repo, "add", "new.py")
    report = detect_changes(repo, g, scope=DiffScope.STAGED)
    fc = next(f for f in report.files if f.path == "new.py")
    assert fc.status == "added"
    assert fc.impacted_symbols == []
    assert any("no prior symbols" in n for n in fc.notes)


def test_deleted_file_attributes_all_known_symbols(repo_with_graph):
    """Deleting a.py should mark both alpha and helper as impacted."""
    repo, g = repo_with_graph
    _git(repo, "rm", "a.py")
    report = detect_changes(repo, g, scope=DiffScope.STAGED)
    fc = next(f for f in report.files if f.path == "a.py")
    assert fc.status == "deleted"
    qnames = sorted(s.qualified_name for s in fc.impacted_symbols)
    assert qnames == ["a.alpha", "a.helper"]


def test_renamed_file_attributes_to_new_path(repo_with_graph):
    """Rename + edit case: hunks attribute to symbols at the *new* path,
    but our snapshot only knows the *old* path. Note in fc explains the gap."""
    repo, g = repo_with_graph
    _git(repo, "mv", "a.py", "renamed.py")
    report = detect_changes(repo, g, scope=DiffScope.STAGED)
    fc = next(f for f in report.files if f.path == "renamed.py")
    assert fc.status == "renamed"
    assert fc.old_path == "a.py"
    # Symbols are looked up at the new path, which is empty in the snapshot.
    # That's expected — the user is told via the note.
    assert any("renamed from" in n for n in fc.notes)


def test_risk_classification_thresholds(repo_with_graph):
    """Edit handle_get (1 endpoint, ≥1 callers): risk.score = 5*1 + ... ≥ 5 → low<10."""
    repo, g = repo_with_graph
    (repo / "b.py").write_text(
        "def beta():\n    return 3\n\n"
        "# endpoint handler:\ndef handle_get():\n    return alpha()  # x\n",
        encoding="utf-8",
    )
    report = detect_changes(repo, g, scope=DiffScope.UNSTAGED)
    # handle_get has 0 callers and 1 endpoint → score = 0 + 5 = 5
    assert report.risk.level == "low"
    assert report.risk.score >= 5


def test_scope_string_accepted(repo_with_graph):
    """detect_changes should accept scope as a string."""
    repo, g = repo_with_graph
    (repo / "a.py").write_text(
        "def alpha():\n    beta()  # x\n    return 1\n\n"
        "def helper():\n    return 2\n",
        encoding="utf-8",
    )
    report = detect_changes(repo, g, scope="unstaged")
    assert report.scope == "unstaged"
    assert any(s.qualified_name == "a.alpha"
               for f in report.files for s in f.impacted_symbols)
