"""Path-safety regression for src/chat/session_store.

Before fix: `_session_file(workspace_dir, company, project)` joined raw
company/project into the path. company=".." would write the active session
file outside the workspace. 9 callers in src/api/__init__.py passed
request.company / request.project unsanitized.

After fix: `_safe_segment` validates each segment matches
`^[A-Za-z0-9_.-]+$` and is not "." or "..". All three public functions
(`create_active_session`, `get_active_session`, `clear_active_session`)
go through `_session_file` so they're all protected by the same check.
"""
from __future__ import annotations

import pytest

from src.chat.session_store import (
    _session_file,
    create_active_session,
    get_active_session,
    clear_active_session,
)


@pytest.fixture
def workspace(tmp_path):
    return tmp_path / "ws"


# ─── _session_file directly ──────────────────────────────────────────────────


@pytest.mark.parametrize("bad,kind", [
    ("..",          "company"),
    ("../etc",      "company"),
    ("../../etc",   "company"),
    ("",            "company"),
    (".",           "company"),
    ("foo/bar",     "company"),
    (r"foo\bar",    "company"),
    ("my company",  "company"),  # space rejected
    (None,          "company"),
    (123,           "company"),  # non-str rejected
])
def test_session_file_rejects_unsafe_company(workspace, bad, kind):
    with pytest.raises(ValueError, match=kind):
        _session_file(workspace, bad, "ok-project")


@pytest.mark.parametrize("bad", ["..", "../etc", "", ".", "foo/bar", "evil project"])
def test_session_file_rejects_unsafe_project(workspace, bad):
    with pytest.raises(ValueError, match="project"):
        _session_file(workspace, "ok-company", bad)


@pytest.mark.parametrize("good", [
    "acme",
    "acme.io",
    "acme-prod",
    "acme_prod",
    "Acme123",
    "v1.2.3",
])
def test_session_file_accepts_safe_segments(workspace, good):
    p = _session_file(workspace, good, good)
    # Result must stay under workspace
    assert workspace in p.parents


# ─── End-to-end: each public function inherits the same guard ────────────────


def test_create_active_session_rejects_traversal(workspace):
    with pytest.raises(ValueError):
        create_active_session(workspace, "..", "anything")


def test_get_active_session_rejects_traversal(workspace):
    with pytest.raises(ValueError):
        get_active_session(workspace, "..", "anything")


def test_clear_active_session_rejects_traversal(workspace):
    with pytest.raises(ValueError):
        clear_active_session(workspace, "..", "anything")


# ─── Happy path still works ──────────────────────────────────────────────────


def test_create_then_get_then_clear_normal_flow(workspace):
    sid = create_active_session(workspace, "acme", "backend")
    assert sid
    assert get_active_session(workspace, "acme", "backend") == sid
    assert clear_active_session(workspace, "acme", "backend") is True
    assert get_active_session(workspace, "acme", "backend") is None
