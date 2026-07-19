"""Executor-aware startup env check (the ignorable ANTHROPIC_API_KEY warning).

Behavior: `src.entrypoints.env_check.anthropic_key_requirement` must skip the
ANTHROPIC_API_KEY requirement exactly when the active CHAT_EXECUTOR backend is
flagged ``brings_own_auth`` in the backend registry (kiro / kiro-cli SSO), and
stay conservative (required) for claude / unset / unrecognized values.

Guard (helper-exists-sibling-missed): no entrypoint may reintroduce the
hardcoded ``"ANTHROPIC_API_KEY": "Required ...`` required_keys entry, and BOTH
debug entrypoints must consume the helper. Counts are asserted as equalities,
never ``>= N``.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from src.entrypoints.env_check import anthropic_key_requirement

REPO_ROOT = Path(__file__).parent.parent
ENTRYPOINTS_DIR = REPO_ROOT / "src" / "entrypoints"
DEBUG_ENTRYPOINTS = ["debug_api.py", "debug_worker.py"]


class TestAnthropicKeyRequirement:
    def test_kiro_backend_brings_own_auth_key_not_required(self, monkeypatch):
        monkeypatch.setenv("CHAT_EXECUTOR", "kiro")
        required, note = anthropic_key_requirement()
        assert required is False
        assert "kiro" in note and "own auth" in note

    def test_executor_value_is_trimmed_and_case_insensitive(self, monkeypatch):
        monkeypatch.setenv("CHAT_EXECUTOR", "  KIRO  ")
        required, _ = anthropic_key_requirement()
        assert required is False

    def test_claude_backend_key_required(self, monkeypatch):
        monkeypatch.setenv("CHAT_EXECUTOR", "claude")
        required, note = anthropic_key_requirement()
        assert required is True
        assert note == "Required for orchestration jobs"

    def test_unset_executor_stays_conservative(self, monkeypatch):
        monkeypatch.delenv("CHAT_EXECUTOR", raising=False)
        required, _ = anthropic_key_requirement()
        assert required is True

    def test_unrecognized_executor_stays_conservative(self, monkeypatch):
        monkeypatch.setenv("CHAT_EXECUTOR", "no-such-backend")
        required, _ = anthropic_key_requirement()
        assert required is True


class TestEntrypointGuards:
    """Source-grep guards, equality-asserted per the process rule."""

    def test_zero_hardcoded_anthropic_required_entries_in_entrypoints(self):
        offenders = []
        for path in sorted(ENTRYPOINTS_DIR.glob("*.py")):
            text = path.read_text(encoding="utf-8")
            if '"ANTHROPIC_API_KEY": "Required' in text:
                offenders.append(path.name)
        assert offenders == [], (
            "Hardcoded ANTHROPIC_API_KEY required_keys entry found — use "
            "src.entrypoints.env_check.anthropic_key_requirement() instead. "
            f"Sites: {offenders}"
        )

    def test_both_debug_entrypoints_consume_the_helper(self):
        consuming = [
            name
            for name in DEBUG_ENTRYPOINTS
            if "anthropic_key_requirement"
            in (ENTRYPOINTS_DIR / name).read_text(encoding="utf-8")
        ]
        assert consuming == DEBUG_ENTRYPOINTS, (
            "Every debug entrypoint must route its ANTHROPIC_API_KEY startup "
            f"check through env_check. Consuming: {consuming}, "
            f"expected: {DEBUG_ENTRYPOINTS}"
        )
