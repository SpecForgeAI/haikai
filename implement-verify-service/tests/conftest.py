"""Shared pytest fixtures for the standards-extractor test suite."""

import os


def pytest_configure(config):
    """Set environment defaults for the test session.

    `CHAT_EXECUTOR` is a required env var in production (see
    `_executor_backend` in `src/api/__init__.py`). Tests run against
    the Claude code path by default; individual tests may override by
    setting the env var or monkeypatching.
    """
    os.environ.setdefault("CHAT_EXECUTOR", "claude")
    # The per-spec verification gate (SPEC_VERIFY_GATE, default ON in
    # production — gold standard 2026-08-07) drives a real /haikai:debug +
    # /haikai:fix LLM loop per spec. Unit suites exercising git plumbing /
    # API endpoints must not spawn LLM executors, so the suite default is
    # OFF; gate-specific tests opt back in via monkeypatch.setenv.
    os.environ.setdefault("SPEC_VERIFY_GATE", "false")
