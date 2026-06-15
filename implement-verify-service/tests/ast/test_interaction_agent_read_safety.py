"""Path-safety regression for interaction_agent._read_source_snippet.

Same bug class as `enrichment_tools.read_source` (fixed in commit
51603da) — `Path(project_root) / file_path` followed by a fallback
`Path(file_path)` let an LLM-supplied absolute path read any file on
disk. Threat model: prompt injection from hostile repo source content
that the classifier reads → LLM emits `caller_file="/etc/passwd"` →
snippet sent back to LLM in next pass → exfiltration via the agent's
own response channel.

Now: reject `..` segments, scope to `Path(project_root).resolve()` via
`relative_to`. On rejection, return empty string (matches the existing
"file not found → empty" semantics).
"""
from __future__ import annotations

import pytest

from src.ast.interaction_agent import _read_source_snippet


def test_read_source_snippet_blocks_absolute_path_outside_project(tmp_path):
    """An absolute path outside project_root → empty (was: returned contents)."""
    proj = tmp_path / "proj"; proj.mkdir()
    secret = tmp_path / "SECRET.txt"
    secret.write_text("password=hunter2\n")
    out = _read_source_snippet(str(secret), 1, str(proj))
    assert out == ""
    assert "hunter2" not in out


def test_read_source_snippet_blocks_dotdot_traversal(tmp_path):
    """A `..`-traversing relative path → empty."""
    proj = tmp_path / "proj"; proj.mkdir()
    out = _read_source_snippet("../../etc/passwd", 1, str(proj))
    assert out == ""


def test_read_source_snippet_blocks_drive_letter_traversal(tmp_path):
    """A Windows-style absolute path → empty."""
    proj = tmp_path / "proj"; proj.mkdir()
    out = _read_source_snippet("C:/Windows/win.ini", 1, str(proj))
    assert out == ""


def test_read_source_snippet_works_for_legitimate_relative_path(tmp_path):
    """Inside-project paths still return the expected snippet."""
    proj = tmp_path / "proj"; proj.mkdir()
    target = proj / "src.py"
    target.write_text("line1\nline2\nline3\nline4\nline5\n")
    out = _read_source_snippet("src.py", 3, str(proj), context_lines=1)
    # Should include the marker for line 3 plus 1 line of context either side
    assert ">>> 3: line3" in out
    assert "    2: line2" in out or "   2: line2" in out


def test_read_source_snippet_returns_empty_for_missing_file(tmp_path):
    """Existing not-found behavior preserved."""
    proj = tmp_path / "proj"; proj.mkdir()
    out = _read_source_snippet("does_not_exist.py", 1, str(proj))
    assert out == ""
