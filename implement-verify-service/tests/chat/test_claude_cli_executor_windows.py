"""Regression: ClaudeCLIExecutor must not crash on Windows.

Before fix: line 206 called `os.getuid()` unconditionally — Windows has
no `os.getuid` so every `executor.execute(...)` raised AttributeError
before subprocess.run could fire. The same module guards
`platform.system() == "Windows"` at lines 61 and 92, and src/api/__init__.py
uses `hasattr(os, 'getuid')` correctly. This was a single missed site.

After fix: `hasattr(os, 'getuid') and os.getuid() == 0` — short-circuits
on Windows; `preexec` becomes None; subprocess.run runs without
preexec_fn (also POSIX-only — None is fine).
"""
from __future__ import annotations

from unittest.mock import patch

import pytest


def test_get_uid_check_safe_when_attribute_missing(monkeypatch, tmp_path):
    """Simulate Windows by hiding os.getuid. Executor must not raise."""
    import os
    monkeypatch.delattr(os, "getuid", raising=False)

    # Stub the haikai-profiles dir so the constructor doesn't fail
    profiles = tmp_path / "haikai-profiles" / "default"
    profiles.mkdir(parents=True)

    # Patch HAIKAI_PROFILES_PATH so the executor doesn't look for the real one
    monkeypatch.setenv("HAIKAI_PROFILES_PATH", str(profiles))

    from src.claude_cli_executor import ClaudeCLIExecutor

    project = tmp_path / "project"
    project.mkdir()
    executor = ClaudeCLIExecutor(project_dir=str(project), anthropic_api_key="test-key")

    # Capture the kwargs the spawn is called with so we can assert
    # preexec_fn was NOT passed (the safe outcome on Windows). Parallel-
    # worktrees D13 moved execution from subprocess.run to Popen (tracked,
    # killable handle) — the guard's contract is unchanged.
    captured = {}

    def fake_popen(args, **kwargs):
        captured["preexec_fn"] = kwargs.get("preexec_fn")
        proc = type("P", (), {})()
        proc.pid = 1234
        proc.returncode = 0
        proc.communicate = lambda **kw: ('{"result": "ok"}', "")
        return proc

    with patch("src.claude_cli_executor.subprocess.Popen", side_effect=fake_popen):
        # The crash we're regressing against was at the getuid guard, before
        # the spawn is even called. If we reach this without raising
        # AttributeError, the guard works.
        result = executor.execute("/write-spec", system_prompt="test", timeout=30)

    # On Windows-simulated environment, no privilege drop should be attempted
    assert captured["preexec_fn"] is None
    # And the call chain reached the spawn successfully
    assert result["return_code"] == 0


def test_get_uid_check_skips_demotion_when_not_root(monkeypatch, tmp_path):
    """Even on Linux, if not running as root, no demotion is attempted."""
    import os
    if not hasattr(os, "getuid"):
        pytest.skip("Linux-only sanity check")

    profiles = tmp_path / "haikai-profiles" / "default"
    profiles.mkdir(parents=True)
    monkeypatch.setenv("HAIKAI_PROFILES_PATH", str(profiles))

    # Pretend we're a regular user (UID 1000)
    monkeypatch.setattr(os, "getuid", lambda: 1000)

    from src.claude_cli_executor import ClaudeCLIExecutor

    project = tmp_path / "project"
    project.mkdir()
    executor = ClaudeCLIExecutor(project_dir=str(project), anthropic_api_key="test-key")

    captured = {}

    def fake_run(args, **kwargs):
        captured["preexec_fn"] = kwargs.get("preexec_fn")
        from subprocess import CompletedProcess
        return CompletedProcess(args, 0, stdout='{"result": "ok"}', stderr="")

    with patch("src.claude_cli_executor.subprocess.run", side_effect=fake_run):
        executor.execute("/write-spec", system_prompt="test", timeout=30)

    assert captured["preexec_fn"] is None
