"""Tests for the MCP tool registry. Targets the SDK-free `tools.py` so they run
without the `mcp` package installed.
"""

import pytest

from src.connectors.gitlab.client import ConfirmationRequired
from src.mcp.tools import TOOLS, ToolSpec, tool_names


def test_tool_names_unique():
    names = tool_names()
    assert len(names) == len(set(names))


def test_runner_tools_registered():
    names = set(tool_names())
    assert {
        "gitlab_list_runners",
        "gitlab_get_runner",
        "gitlab_pause_runner",
        "gitlab_resume_runner",
        "gitlab_delete_runner",
    } <= names


def test_every_spec_is_callable():
    for spec in TOOLS:
        assert isinstance(spec, ToolSpec)
        assert callable(spec.fn)
        assert spec.description


def test_destructive_tools_enforce_confirm():
    # Every tool flagged destructive must refuse to act without confirm=True.
    # Two dummy positional args cover both 1-arg (runners) and 2-arg
    # (project-scoped) verbs; require_confirm fires before either is used.
    for spec in TOOLS:
        if spec.destructive:
            with pytest.raises(ConfirmationRequired):
                spec.fn(1, 1, confirm=False)
