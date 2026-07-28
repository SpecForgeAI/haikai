"""Kiro executors report their spawned pid via `on_spawn` (2026-07-28 sweep).

D13: cancel = kill the TRACKED process tree. The job runner sets
`executor.on_spawn` (tasks.py — orchestrator forwarding + the verification
executor) so every CLI subprocess is registered with the cancel watchdog.
Both Claude executors honoured it; both Kiro executors silently didn't —
a kiro run was unkillable, and KiroCLIExecutor additionally trapped its
handle inside a blocking `subprocess.run`. These pins hold the parity.
"""
from __future__ import annotations

import subprocess
import types

import pytest


class _FakeChatProc:
    """Shape KiroChatExecutor.stream_message consumes: iterable stdout,
    wait(), returncode, stderr (None => skipped)."""

    def __init__(self, pid: int, lines: list):
        self.pid = pid
        self.stdout = iter(lines)
        self.stderr = None
        self.returncode = 0

    def wait(self):
        return self.returncode


class _FakeCliProc:
    """Shape KiroCLIExecutor.execute consumes: communicate(), returncode."""

    def __init__(self, pid: int):
        self.pid = pid
        self.returncode = 0

    def communicate(self, timeout=None):
        return ("done", "")


@pytest.fixture()
def kiro_env(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAT_EXECUTOR", "kiro")
    return tmp_path


def test_kiro_chat_executor_reports_spawned_pid(monkeypatch, kiro_env):
    import src.chat.kiro_chat_executor as mod

    monkeypatch.setattr(mod, "locate_kiro_cli", lambda: ("/fake/kiro-cli", False))

    spawned: list = []
    captured: dict = {}

    def fake_popen(args, **kwargs):
        captured["args"] = args
        return _FakeChatProc(pid=4242, lines=["> hello\n"])

    monkeypatch.setattr(
        mod,
        "subprocess",
        types.SimpleNamespace(Popen=fake_popen, PIPE=subprocess.PIPE, run=None),
    )

    executor = mod.KiroChatExecutor(
        company="acme", project="proj", workspace_dir=kiro_env
    )
    executor.on_spawn = spawned.append

    events = list(executor.stream_message("hi", is_new_session=True))

    assert spawned == [4242]
    assert any(e.get("type") == "content" for e in events)
    # Native (non-WSL) path: platform-native separators are correct here.
    assert captured["args"][0].endswith("kiro-cli")


def test_new_session_reinforcement_is_scoped_per_command(monkeypatch, kiro_env):
    # 2026-07-28 live: the unconditional ask-and-STOP reinforcement was
    # applied to the fresh /write-spec session too (worktree runs start it
    # NEW) — the agent obediently wrote NOTHING and step 1 failed with
    # "expected output files are missing: spec.md". Shape-spec keeps the
    # ask-first block; artifact commands get the opposite: write output now.
    import src.chat.kiro_chat_executor as mod

    monkeypatch.setattr(mod, "locate_kiro_cli", lambda: ("/fake/kiro-cli", False))

    prompts: list = []

    def fake_popen(args, **kwargs):
        prompts.append(args[-1])
        return _FakeChatProc(pid=1, lines=[])

    monkeypatch.setattr(
        mod,
        "subprocess",
        types.SimpleNamespace(Popen=fake_popen, PIPE=subprocess.PIPE, run=None),
    )

    executor = mod.KiroChatExecutor(
        company="acme", project="proj", workspace_dir=kiro_env
    )

    list(executor.stream_message("shape this", is_new_session=True, command_name="shape-spec"))
    list(executor.stream_message("for demo-spec", is_new_session=True, command_name="write-spec"))

    shape_prompt, write_prompt = prompts
    assert "You MUST ask clarifying questions" in shape_prompt

    assert "You MUST ask clarifying questions" not in write_prompt
    assert "WRITE its output files" in write_prompt
    assert "write-spec skill" in write_prompt


def test_kiro_cli_executor_reports_spawned_pid(monkeypatch, kiro_env):
    import src.kiro_cli_executor as mod

    monkeypatch.setattr(mod, "locate_kiro_cli", lambda: ("/fake/kiro-cli", False))

    spawned: list = []

    fake_subprocess = types.SimpleNamespace(
        Popen=lambda args, **kwargs: _FakeCliProc(pid=7777),
        PIPE=subprocess.PIPE,
        CompletedProcess=subprocess.CompletedProcess,
        TimeoutExpired=subprocess.TimeoutExpired,
    )
    monkeypatch.setattr(mod, "subprocess", fake_subprocess)

    project_dir = kiro_env / "acme" / "proj"
    project_dir.mkdir(parents=True)
    executor = mod.KiroCLIExecutor(project_dir=str(project_dir))
    executor.on_spawn = spawned.append

    result = executor.execute("/write-spec for demo", timeout=30)

    assert spawned == [7777]
    assert result["success"] is True
    assert result["stdout"] == "done"
