"""ClaudeCLIExecutor must fall back to a global `claude` on PATH when there's no
project-local node_modules install — otherwise the worker's verify-task-group /
repair path dies with "Project-local Claude CLI not found" even though a global
CLI is available (ClaudeChatExecutor already has this fallback).
"""

import platform
import shutil
from pathlib import Path

import pytest

from src import claude_cli_executor as mod

_LOCAL = (
    Path(mod.__file__).parent.parent / "node_modules" / ".bin"
    / ("claude.cmd" if platform.system() == "Windows" else "claude")
)


@pytest.mark.skipif(_LOCAL.exists() or not shutil.which("claude"),
                    reason="needs no project-local CLI and a global `claude` on PATH")
def test_falls_back_to_global_claude(tmp_path, monkeypatch):
    monkeypatch.setattr(mod.ClaudeCLIExecutor, "_setup_claude_commands", lambda self, root: None)
    ex = mod.ClaudeCLIExecutor(project_dir=str(tmp_path), anthropic_api_key="sk-ant-oat01-x")
    assert ex.claude_cli_path == Path(shutil.which("claude"))


@pytest.mark.skipif(_LOCAL.exists(), reason="needs no project-local CLI")
def test_raises_when_no_cli_anywhere(tmp_path, monkeypatch):
    monkeypatch.setattr(mod.ClaudeCLIExecutor, "_setup_claude_commands", lambda self, root: None)
    monkeypatch.setattr(mod.shutil, "which", lambda n: None)
    with pytest.raises(ValueError):
        mod.ClaudeCLIExecutor(project_dir=str(tmp_path), anthropic_api_key="x")
