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
