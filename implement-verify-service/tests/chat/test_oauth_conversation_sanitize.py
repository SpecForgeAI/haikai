"""Conversation-history sanitize: a run cancelled mid-tool-call leaves a trailing
assistant `tool_use` with no `tool_result`; reloading it makes the API 400 on the
next run. _sanitize_conversation truncates at the first unanswered tool_use.
"""

from src.chat.oauth_chat_executor import OAuthChatExecutor as E


def _tu(i):
    return {"role": "assistant", "content": [{"type": "tool_use", "id": i, "name": "bash", "input": {}}]}


def _tr(i):
    return {"role": "user", "content": [{"type": "tool_result", "tool_use_id": i, "content": "ok"}]}


def _txt(role, t):
    return {"role": role, "content": t}


def test_drops_trailing_dangling_tool_use():
    h = [_txt("user", "hi"), _tu("a"), _tr("a"), _tu("b")]  # b unanswered
    assert E._sanitize_conversation(h) == [_txt("user", "hi"), _tu("a"), _tr("a")]


def test_immediately_dangling():
    h = [_txt("user", "hi"), _tu("a")]
    assert E._sanitize_conversation(h) == [_txt("user", "hi")]


def test_complete_history_unchanged():
    h = [_txt("user", "hi"), _tu("a"), _tr("a"), _txt("assistant", "done")]
    assert E._sanitize_conversation(h) == h


def test_empty():
    assert E._sanitize_conversation([]) == []
