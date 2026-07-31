"""Model pinning for CLI executor spawns (2026-07-31).

kiro-cli silently ignored ``settings chat.defaultModel`` (2026-07-30
live), and the Claude-CLI spawn paths ignored ``LLM_MODEL`` entirely
(only the OAuth-SDK / OpenAI fallbacks honoured it). Every spawn now
pins the model explicitly via ``--model`` (src/chat/model_pinning.py),
and executor init logs state the resolved model.
"""
from __future__ import annotations

import platform
import subprocess
from pathlib import Path

import pytest

# Warm platform's process-global uname cache BEFORE any test patches
# subprocess.Popen (Windows shells out on the first platform.system()).
platform.system()

from src.chat.model_pinning import (
    CLAUDE_MODEL_ENV,
    KIRO_MODEL_DEFAULT,
    KIRO_MODEL_ENV,
    claude_pinned_model,
    kiro_pinned_model,
    model_args,
)


class _FakeProc:
    pid = 4242
    returncode = 0
    stderr = None

    def __init__(self):
        self.stdout = iter(())

    def communicate(self, input=None, timeout=None):
        return ('{"result": "ok"}', "")

    def wait(self):
        return 0


@pytest.fixture()
def capture_popen(monkeypatch):
    captured = {}

    def _fake_popen(args, **kwargs):
        captured["args"] = list(args)
        return _FakeProc()

    monkeypatch.setattr(subprocess, "Popen", _fake_popen)
    return captured


def _assert_model_flag(args, expected):
    assert "--model" in args, f"--model missing from argv: {args}"
    assert args[args.index("--model") + 1] == expected
    # the positional prompt stays last — the flag must precede it
    assert args.index("--model") < len(args) - 1


class TestResolvePinnedModel:
    def test_kiro_default_applies_when_unset(self, monkeypatch):
        monkeypatch.delenv(KIRO_MODEL_ENV, raising=False)
        assert kiro_pinned_model() == KIRO_MODEL_DEFAULT

    def test_kiro_env_overrides_default(self, monkeypatch):
        monkeypatch.setenv(KIRO_MODEL_ENV, "claude-sonnet-4-6")
        assert kiro_pinned_model() == "claude-sonnet-4-6"

    @pytest.mark.parametrize("value", ["", "  ", "auto", "AUTO"])
    def test_empty_or_auto_disables_pinning(self, monkeypatch, value):
        monkeypatch.setenv(KIRO_MODEL_ENV, value)
        assert kiro_pinned_model() is None

    def test_claude_has_no_default(self, monkeypatch):
        monkeypatch.delenv(CLAUDE_MODEL_ENV, raising=False)
        assert claude_pinned_model() is None

    def test_claude_env_pins(self, monkeypatch):
        monkeypatch.setenv(CLAUDE_MODEL_ENV, "claude-opus-4-5")
        assert claude_pinned_model() == "claude-opus-4-5"

    def test_model_args_shapes(self):
        assert model_args("m") == ["--model", "m"]
        assert model_args(None) == []


class TestKiroChatExecutorSpawn:
    def _executor(self, tmp_path, model):
        from src.chat.kiro_chat_executor import KiroChatExecutor

        ex = KiroChatExecutor.__new__(KiroChatExecutor)
        ex.company = "acme"
        ex.project = "proj"
        ex.session_id = "acme_proj"
        ex.session_uuid = "u" * 36
        ex.project_dir = tmp_path
        ex.kiro_cli_path = Path("kiro-cli")
        ex._use_wsl = False
        ex.model = model
        return ex

    def test_spawn_pins_model(self, tmp_path, capture_popen):
        ex = self._executor(tmp_path, "claude-opus-4.8")
        list(ex.stream_message("hello", is_new_session=False))
        _assert_model_flag(capture_popen["args"], "claude-opus-4.8")

    def test_spawn_omits_flag_when_disabled(self, tmp_path, capture_popen):
        ex = self._executor(tmp_path, None)
        list(ex.stream_message("hello", is_new_session=False))
        assert "--model" not in capture_popen["args"]

    def test_init_resolves_default_model(self, tmp_path, monkeypatch):
        monkeypatch.delenv(KIRO_MODEL_ENV, raising=False)
        monkeypatch.setattr(
            "src.chat.kiro_chat_executor.locate_kiro_cli",
            lambda: ("kiro-cli", False),
        )
        from src.chat.kiro_chat_executor import KiroChatExecutor

        ex = KiroChatExecutor(company="acme", project="proj", workspace_dir=tmp_path)
        assert ex.model == KIRO_MODEL_DEFAULT


class TestKiroCLIExecutorSpawn:
    def _executor(self, tmp_path, model):
        from src.kiro_cli_executor import KiroCLIExecutor

        ex = KiroCLIExecutor.__new__(KiroCLIExecutor)
        ex.project_dir = tmp_path
        ex.kiro_cli_path = Path("kiro-cli")
        ex._use_wsl = False
        ex.model = model
        return ex

    def test_execute_pins_model(self, tmp_path, capture_popen):
        ex = self._executor(tmp_path, "claude-opus-4.8")
        result = ex.execute("/write-spec for x", timeout=5)
        _assert_model_flag(result["cli_args"], "claude-opus-4.8")

    def test_execute_omits_flag_when_disabled(self, tmp_path, capture_popen):
        ex = self._executor(tmp_path, None)
        result = ex.execute("/write-spec for x", timeout=5)
        assert "--model" not in result["cli_args"]


class TestClaudeExecutorArgs:
    def _chat_executor(self, tmp_path, model):
        from src.chat.claude_chat_executor import ClaudeChatExecutor

        ex = ClaudeChatExecutor.__new__(ClaudeChatExecutor)
        ex.claude_cli_path = Path("claude")
        ex.session_uuid = "s" * 36
        ex.project_dir = tmp_path
        ex.extra_dirs = []
        ex.model = model
        return ex

    def test_chat_builder_pins_model_when_set(self, tmp_path):
        ex = self._chat_executor(tmp_path, "claude-opus-4-5")
        args = ex._build_cli_command("do it", is_new_session=True)
        _assert_model_flag(args, "claude-opus-4-5")

    def test_chat_builder_back_compat_when_unset(self, tmp_path):
        ex = self._chat_executor(tmp_path, None)
        args = ex._build_cli_command("do it", is_new_session=True)
        assert "--model" not in args

    def test_cli_executor_pins_model_when_set(self, tmp_path, capture_popen):
        from src.claude_cli_executor import ClaudeCLIExecutor

        ex = ClaudeCLIExecutor.__new__(ClaudeCLIExecutor)
        ex.project_dir = tmp_path
        ex.anthropic_api_key = "sk-test"
        ex.claude_cli_path = Path("claude")
        ex.model = "claude-opus-4-5"
        result = ex.execute("/write-spec", timeout=5)
        _assert_model_flag(result["cli_args"], "claude-opus-4-5")

    def test_cli_executor_back_compat_when_unset(self, tmp_path, capture_popen):
        from src.claude_cli_executor import ClaudeCLIExecutor

        ex = ClaudeCLIExecutor.__new__(ClaudeCLIExecutor)
        ex.project_dir = tmp_path
        ex.anthropic_api_key = "sk-test"
        ex.claude_cli_path = Path("claude")
        ex.model = None
        result = ex.execute("/write-spec", timeout=5)
        assert "--model" not in result["cli_args"]
