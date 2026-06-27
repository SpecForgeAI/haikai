"""Per-call OAuth token refresh: a long-running worker that captured a token at
startup must pick up the CLI-rotated token, or it 401s once the old one is
refreshed elsewhere. When CLAUDE_OAUTH_CREDENTIALS_FILE is set, the executor
re-reads the live token from that file before each call. Opt-in; no-op without.
"""

import json

from src.chat.oauth_chat_executor import OAuthChatExecutor

OLD = "sk-ant-oat01-stale-token"
NEW = "sk-ant-oat01-rotated-token"


def _creds_file(tmp_path, token):
    f = tmp_path / "creds.json"
    f.write_text(json.dumps({"claudeAiOauth": {"accessToken": token}}), encoding="utf-8")
    return f


def test_refresh_picks_up_rotated_token(tmp_path, monkeypatch):
    creds = _creds_file(tmp_path, NEW)
    monkeypatch.setenv("CLAUDE_OAUTH_CREDENTIALS_FILE", str(creds))
    ex = OAuthChatExecutor("acme", "shop", tmp_path, OLD)
    # construction calls _create_client -> _refresh_oauth_token
    assert ex.anthropic_api_key == NEW


def test_no_env_is_noop(tmp_path, monkeypatch):
    monkeypatch.delenv("CLAUDE_OAUTH_CREDENTIALS_FILE", raising=False)
    ex = OAuthChatExecutor("acme", "shop", tmp_path, OLD)
    assert ex.anthropic_api_key == OLD


def test_refresh_after_rotation(tmp_path, monkeypatch):
    creds = _creds_file(tmp_path, OLD)
    monkeypatch.setenv("CLAUDE_OAUTH_CREDENTIALS_FILE", str(creds))
    ex = OAuthChatExecutor("acme", "shop", tmp_path, OLD)
    assert ex.anthropic_api_key == OLD
    # CLI rotates the token in the file; next refresh must pick it up
    creds.write_text(json.dumps({"claudeAiOauth": {"accessToken": NEW}}), encoding="utf-8")
    ex._refresh_oauth_token()
    assert ex.anthropic_api_key == NEW
