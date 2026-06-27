"""OAUTH_SDK_EXECUTOR opt-in: route an OAuth/Max token through the Anthropic SDK
(OAuthChatExecutor) instead of the Claude CLI, so it doesn't compete with an
outer Claude Code session for the CLI's concurrency slot (the 429 that killed
nested orchestration runs)."""

import pytest

from src.api.factories import _build_claude_chat_executor
from src.chat.oauth_chat_executor import OAuthChatExecutor

OAT = "sk-ant-oat01-fake-token-for-selection-test"


def test_opt_in_routes_oauth_token_to_sdk_executor(tmp_path, monkeypatch):
    monkeypatch.setenv("OAUTH_SDK_EXECUTOR", "true")
    ex = _build_claude_chat_executor("acme", "shop", tmp_path, OAT, session_uuid="s1")
    assert isinstance(ex, OAuthChatExecutor)


def test_default_keeps_cli_path(tmp_path, monkeypatch):
    monkeypatch.delenv("OAUTH_SDK_EXECUTOR", raising=False)
    ex = _build_claude_chat_executor("acme", "shop", tmp_path, OAT, session_uuid="s1")
    # Default behaviour unchanged: OAuth token still goes to the CLI executor.
    assert not isinstance(ex, OAuthChatExecutor)
