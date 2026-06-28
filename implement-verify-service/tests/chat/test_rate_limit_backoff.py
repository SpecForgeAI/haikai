"""Unit tests for the deterministic 429 rate-limit detection + backoff in
ClaudeChatExecutor.

Context (debug 260615): the Claude CLI swallows HTTP 429s inside its own internal
retries and emits no stream output, so the executor only saw a silent hang -> kill
(exit 143). `_probe_rate_limited` checks the Messages API directly (a 429 returns in
<1s) and `_rate_limit_backoff` gates the spawn with backoff. The backoff schedule,
budget and emitted signal now live in `src.chat.rate_limit_backoff` (shared with the
SDK lane); the budget is time-based (minutes), not a fixed attempt count. The 429 is
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

from src.chat.claude_chat_executor import ClaudeChatExecutor, _CLI_ERROR_PATTERNS


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
    events = []
    try:
        while True:
            events.append(next(gen))
    except StopIteration as e:
        return events, e.value


# ─── _probe_rate_limited (deterministic detector — unchanged) ─────────────────
class TestProbeRateLimited:
    def test_429_reports_limited_with_retry_after(self, executor):
        err = urllib.error.HTTPError(
            url="https://api.anthropic.com/v1/messages", code=429,
            msg="Too Many Requests", hdrs={"retry-after": "7"}, fp=None)
        with patch("urllib.request.urlopen", side_effect=err):
            limited, retry_after = executor._probe_rate_limited()
        assert limited is True and retry_after == 7.0

    def test_429_without_retry_after(self, executor):
        err = urllib.error.HTTPError(url="x", code=429, msg="429", hdrs={}, fp=None)
        with patch("urllib.request.urlopen", side_effect=err):
            limited, retry_after = executor._probe_rate_limited()
        assert limited is True and retry_after is None

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


# ─── _rate_limit_backoff (now time-budgeted, shared schedule + signal) ────────
class TestRateLimitBackoff:
    def test_not_limited_proceeds_immediately(self, executor):
        executor._probe_rate_limited = MagicMock(return_value=(False, None))
        with patch("time.sleep") as sleep:
            events, cleared = _drive(executor._rate_limit_backoff())
        assert cleared is True and events == []
        sleep.assert_not_called()

    def test_backs_off_then_clears_with_visible_signal(self, executor):
        executor._probe_rate_limited = MagicMock(
            side_effect=[(True, None), (True, None), (False, None)])
        with patch("time.sleep") as sleep, patch("random.random", return_value=1.0):
            events, cleared = _drive(executor._rate_limit_backoff())
        assert cleared is True
        rl = [e for e in events if e["type"] == "rate_limited"]
        assert len(rl) == 2
        # each retry is visible: status, retrying flag, next retry time, elapsed/budget
        assert all(e["status"] == 429 and e["retrying"] is True for e in rl)
        assert all("next_retry_in_s" in e and "budget_s" in e for e in rl)
        # full-jitter at random()=1.0 == ceiling, which doubles -> strictly increasing
        assert rl[0]["next_retry_in_s"] < rl[1]["next_retry_in_s"]
        assert sleep.call_count == 2

    def test_exhausts_budget_then_terminal_error(self, executor, monkeypatch):
        monkeypatch.setenv("RATE_LIMIT_MAX_ELAPSED_SECONDS", "3")  # tiny budget
        executor._probe_rate_limited = MagicMock(return_value=(True, None))
        with patch("time.sleep"), patch("random.random", return_value=1.0):
            events, cleared = _drive(executor._rate_limit_backoff())
        assert cleared is False
        assert any(e["type"] == "rate_limited" and e["retrying"] is True for e in events)
        giveup = [e for e in events if e["type"] == "rate_limited" and e["retrying"] is False]
        assert len(giveup) == 1
        err = [e for e in events if e["type"] == "error"]
        assert len(err) == 1 and err[0]["message"] == "rate_limited"

    def test_retries_far_more_than_old_five_attempts(self, executor):
        # The old loop gave up after a fixed 5 attempts (~45s). Now it keeps going
        # (here until the attempt backstop, since mocked sleep freezes wall-clock).
        executor._probe_rate_limited = MagicMock(return_value=(True, None))  # never clears
        with patch("time.sleep"), patch("random.random", return_value=1.0):
            events, cleared = _drive(executor._rate_limit_backoff())
        assert cleared is False
        retries = [e for e in events if e["type"] == "rate_limited" and e["retrying"] is True]
        assert len(retries) > 5  # far beyond the old fixed 5

    def test_honors_retry_after(self, executor):
        executor._probe_rate_limited = MagicMock(side_effect=[(True, 30.0), (False, None)])
        with patch("time.sleep"), patch("random.random", return_value=1.0):
            events, cleared = _drive(executor._rate_limit_backoff())
        assert cleared is True
        assert events[0]["next_retry_in_s"] == pytest.approx(30.0)
        assert events[0]["retry_after_honored"] is True


def test_rate_limit_patterns_still_registered():
    assert "rate_limit_error" in _CLI_ERROR_PATTERNS
    assert "overloaded_error" in _CLI_ERROR_PATTERNS
