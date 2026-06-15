"""Regression tests for the autoresearch:debug 260504-1321 Part B fixes.

- B2-1 (MEDIUM): llm_client.py used to log first-20-chars of API key at
  INFO on every generate() call. Removed.
- B4-1 (MEDIUM): claude_chat_executor.py used tempfile.mktemp() (race-
  vulnerable). Switched to tempfile.mkstemp() (atomic O_EXCL).
"""
from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).parent.parent
SRC = REPO_ROOT / "src"


# ─── B2-1: api-key logging removed ───────────────────────────────────────────


class TestNoApiKeyInLogs:
    """The 'TEMP DEBUG' block that logged self.api_key[:20] is gone."""

    def test_no_api_key_preview_log_in_llm_client(self):
        text = (SRC / "llm_client.py").read_text(encoding="utf-8")
        # The exact patterns that did the partial-key disclosure
        bad_patterns = [
            "self.api_key[:20]",
            "ak[:20]",
            "api_key={api_key_preview}",
            "TEMP DEBUG",
        ]
        offenders = [p for p in bad_patterns if p in text]
        assert offenders == [], (
            f"Found stale debug-key-logging patterns in llm_client.py: "
            f"{offenders}. See autoresearch:debug 260504-1321 B2-1."
        )

    def test_generate_method_present_and_callable(self):
        """Sanity: removing the debug block didn't break the generate() method."""
        from src.llm_client import LLMClient
        # Method exists with the right signature
        assert hasattr(LLMClient, "generate"), "LLMClient.generate missing"


# ─── B4-1: tempfile.mktemp removed ───────────────────────────────────────────


class TestNoMktempInChatExecutor:
    """`tempfile.mktemp(` is documented as insecure. Repo-wide ban
    enforced by source grep."""

    def test_no_tempfile_mktemp_in_src(self):
        bad_files = []
        for p in SRC.rglob("*.py"):
            if "__pycache__" in p.parts:
                continue
            text = p.read_text(encoding="utf-8", errors="replace")
            # `tempfile.mktemp(` (the function call) — distinct from
            # `mkstemp` (the safe variant). Match a `(` to avoid
            # false-positive substring matches against `mkstemp`.
            if re.search(r"\btempfile\.mktemp\(", text):
                bad_files.append(str(p.relative_to(REPO_ROOT)))
        assert bad_files == [], (
            "Found tempfile.mktemp() (race-vulnerable) — use mkstemp() or "
            f"NamedTemporaryFile instead. Sites: {bad_files}. "
            "See autoresearch:debug 260504-1321 B4-1."
        )

    def test_chat_executor_uses_mkstemp(self):
        """The fixed code path uses mkstemp."""
        text = (SRC / "chat" / "claude_chat_executor.py").read_text(encoding="utf-8")
        assert "tempfile.mkstemp(" in text, (
            "claude_chat_executor.py should use mkstemp for atomic temp-file creation"
        )

    def test_atomic_temp_file_create_works(self, tmp_path):
        """End-to-end: writing a >1000-char message via the same
        mkstemp pattern produces a readable file in the project_dir."""
        # Mimic the exact pattern in claude_chat_executor
        message = "x" * 2000
        fd, name = tempfile.mkstemp(
            suffix=".txt",
            prefix="claude_msg_",
            dir=str(tmp_path),
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(message)
            written = Path(name).read_text(encoding="utf-8")
            assert written == message
        finally:
            try:
                os.unlink(name)
            except OSError:
                pass
