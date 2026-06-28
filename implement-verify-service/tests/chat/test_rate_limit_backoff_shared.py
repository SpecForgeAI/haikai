"""Primitives of the shared 429 backoff (src.chat.rate_limit_backoff), used by
both the CLI lane and the SDK lane so they can't drift."""

from src.chat import rate_limit_backoff as rl


def test_next_wait_exponential_capped_full_jitter():
    for attempt, ceiling in [(1, 2), (2, 4), (3, 8), (4, 16), (5, 32), (6, 60), (12, 60)]:
        for _ in range(60):
            wait, honored = rl.next_wait(attempt)
            assert 0.0 <= wait <= ceiling + 1e-9   # full jitter: 0..ceiling
            assert honored is False


def test_retry_after_wins_and_is_capped():
    assert rl.next_wait(1, retry_after=30) == (30, True)
    assert rl.next_wait(1, retry_after=9999) == (rl.PER_SLEEP_CAP_SECONDS, True)


def test_budget_default_env_and_invalid(monkeypatch):
    monkeypatch.delenv("RATE_LIMIT_MAX_ELAPSED_SECONDS", raising=False)
    assert rl.budget_seconds() == 600.0
    monkeypatch.setenv("RATE_LIMIT_MAX_ELAPSED_SECONDS", "900")
    assert rl.budget_seconds() == 900.0
    monkeypatch.setenv("RATE_LIMIT_MAX_ELAPSED_SECONDS", "nonsense")
    assert rl.budget_seconds() == 600.0


def test_classify_by_status_and_name():
    assert rl.classify(type("E", (Exception,), {"status_code": 429})()) == 429
    assert rl.classify(type("E", (Exception,), {"status_code": 529})()) == 529
    assert rl.classify(type("RateLimitError", (Exception,), {})()) == 429
    assert rl.classify(type("OverloadedError", (Exception,), {})()) == 529
    assert rl.classify(ValueError("nope")) is None


def test_retry_after_of_parses_header():
    resp = type("R", (), {"headers": {"retry-after": "12"}})()
    assert rl.retry_after_of(type("E", (Exception,), {"response": resp})()) == 12.0
    assert rl.retry_after_of(ValueError()) is None


def test_signal_shape_retrying_and_giveup():
    evt = rl.rate_limit_signal(3, 8.0, 14.2, 600, True, retrying=True, status=429)
    assert evt["type"] == "rate_limited" and evt["status"] == 429
    assert evt["attempt"] == 3 and evt["next_retry_in_s"] == 8.0
    assert evt["retry_after_honored"] is True and evt["retrying"] is True
    gv = rl.rate_limit_signal(9, 0.0, 600.0, 600, False, retrying=False, status=529)
    assert gv["retrying"] is False and gv["next_retry_in_s"] is None and gv["status"] == 529


def test_schedule_rides_out_far_past_45s():
    budget = rl.budget_seconds()
    elapsed, attempts = 0.0, 0
    while attempts < rl.ATTEMPT_BACKSTOP:
        attempts += 1
        ceiling = min(rl.PER_SLEEP_CAP_SECONDS, rl.BASE_SECONDS * (rl.FACTOR ** (attempts - 1)))
        if elapsed + ceiling >= budget:
            break
        elapsed += ceiling
    assert elapsed > 120 and attempts > 5
