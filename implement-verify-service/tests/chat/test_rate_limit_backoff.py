"""Unit tests for the deterministic 429 rate-limit detection + exponential backoff
added to ClaudeChatExecutor.

Context (debug 260615): the Claude CLI swallows HTTP 429s inside its own internal
retries and emits no stream output, so the executor only saw a silent hang -> kill
(exit 143). `_probe_rate_limited` checks the Messages API directly (a 429 returns in
<1s) and `_rate_limit_backoff` gates the spawn with exponential backoff. The 429 is
SIMULATED here — no live Anthropic call.
"""
from __future__ import annotations

import os
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("STANDARDS_API_KEY", "test-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test")

from src.chat.claude_chat_executor import (
    ClaudeChatExecutor,
    _RATE_LIMIT_MAX_ATTEMPTS,
    _CLI_ERROR_PATTERNS,
)


@pytest.fixture
def executor(tmp_path: Path) -> ClaudeChatExecutor:
    project_dir = tmp_path / "acme" / "backend"
    project_dir.mkdir(parents=True, exist_ok=True)
    with patch.object(ClaudeChatExecutor, "_setup_claude_commands"):
        with patch.object(ClaudeChatExecutor, "_create_permissions_settings"):
            return ClaudeChatExecutor(
                company="acme", project="backend",
                workspace_dir=tmp_path, anthropic_api_key="sk-ant-oat-TESTTOKEN",
            )


def _drive(gen):
    """Run a generator to exhaustion; return (yielded_events, return_value)."""
    events = []
    try:
        while True:
            events.append(next(gen))
    except StopIteration as e:
        return events, e.value


# ─── _probe_rate_limited (deterministic detector) ────────────────────────────
class TestProbeRateLimited:
    def test_429_reports_limited_with_retry_after(self, executor):
        err = urllib.error.HTTPError(
            url="https://api.anthropic.com/v1/messages", code=429,
            msg="Too Many Requests", hdrs={"retry-after": "7"}, fp=None)
        with patch("urllib.request.urlopen", side_effect=err):
            limited, retry_after = executor._probe_rate_limited()
        assert limited is True
        assert retry_after == 7.0

    def test_429_without_retry_after(self, executor):
        err = urllib.error.HTTPError(url="x", code=429, msg="429", hdrs={}, fp=None)
        with patch("urllib.request.urlopen", side_effect=err):
            limited, retry_after = executor._probe_rate_limited()
        assert limited is True
        assert retry_after is None

    def test_200_reports_not_limited(self, executor):
        with patch("urllib.request.urlopen", return_value=MagicMock()):
            assert executor._probe_rate_limited() == (False, None)

    def test_other_http_error_is_not_a_rate_limit(self, executor):
        err = urllib.error.HTTPError(url="x", code=400, msg="bad", hdrs={}, fp=None)
        with patch("urllib.request.urlopen", side_effect=err):
            assert executor._probe_rate_limited() == (False, None)

    def test_network_error_never_false_positives(self, executor):
        with patch("urllib.request.urlopen", side_effect=OSError("connection refused")):
            assert executor._probe_rate_limited() == (False, None)

    def test_oauth_uses_bearer_plain_key_uses_x_api_key(self, executor):
        captured = {}

        def _fake_urlopen(req, timeout=None):
            captured["headers"] = {k.lower(): v for k, v in req.headers.items()}
            return MagicMock()

        with patch("urllib.request.urlopen", _fake_urlopen):
            executor._probe_rate_limited()
        # fixture token is an OAuth token (sk-ant-oat) -> Bearer + oauth beta, no x-api-key
        assert captured["headers"].get("authorization", "").startswith("Bearer ")
        assert "anthropic-beta" in captured["headers"]
        assert "x-api-key" not in captured["headers"]


# ─── _rate_limit_backoff (exponential backoff gate) ──────────────────────────
class TestRateLimitBackoff:
    def test_not_limited_proceeds_immediately(self, executor):
        executor._probe_rate_limited = MagicMock(return_value=(False, None))
        with patch("time.sleep") as sleep:
            events, cleared = _drive(executor._rate_limit_backoff())
        assert cleared is True
        assert events == []
        sleep.assert_not_called()

    def test_backs_off_then_clears(self, executor):
        # limited (preflight) -> limited (after attempt 1) -> clear (after attempt 2)
        executor._probe_rate_limited = MagicMock(
            side_effect=[(True, None), (True, None), (False, None)])
        with patch("time.sleep") as sleep, patch("random.random", return_value=0.0):
            events, cleared = _drive(executor._rate_limit_backoff())
        assert cleared is True
        rl = [e for e in events if e["type"] == "rate_limited"]
        assert len(rl) == 2
        assert all(e["type"] != "error" for e in events)
        # exponential: each wait ceiling doubles -> wait strictly increases
        assert rl[0]["wait"] < rl[1]["wait"]
        assert sleep.call_count == 2

    def test_exhausts_then_yields_terminal_error(self, executor):
        executor._probe_rate_limited = MagicMock(return_value=(True, None))
        with patch("time.sleep"), patch("random.random", return_value=0.0):
            events, cleared = _drive(executor._rate_limit_backoff())
        assert cleared is False
        rl = [e for e in events if e["type"] == "rate_limited"]
        assert len(rl) == _RATE_LIMIT_MAX_ATTEMPTS
        err = [e for e in events if e["type"] == "error"]
        assert len(err) == 1 and err[0]["message"] == "rate_limited"

    def test_honors_retry_after_over_exponential(self, executor):
        executor._probe_rate_limited = MagicMock(
            side_effect=[(True, 30.0), (False, None)])
        with patch("time.sleep"), patch("random.random", return_value=1.0):
            events, cleared = _drive(executor._rate_limit_backoff())
        assert cleared is True
        # retry_after=30 dominates the 2s exponential base for attempt 1
        assert events[0]["wait"] == pytest.approx(30.0)


def test_rate_limit_patterns_still_registered():
    # the CLI-content detector keeps the rate-limit substrings (belt-and-suspenders)
    assert "rate_limit_error" in _CLI_ERROR_PATTERNS
    assert "overloaded_error" in _CLI_ERROR_PATTERNS
