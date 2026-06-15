"""Shared CLI-spawn limits used across chat executors.

The single fact: OS subprocess arg-list size has an upper bound
(Windows is the tightest at ~32 KB total command line; POSIX systems
allow more but still cap at ARG_MAX). Each chat executor that spawns
a CLI checks the prompt length against this limit and falls back to
writing the prompt to a tempfile + telling the CLI to read it.

Originally defined twice (claude_chat_executor.py:257 as a class
attribute, kiro_chat_executor.py:229 as a function-local). Promoted
here so both executors agree on the threshold and a future contributor
can't introduce a third silently-divergent copy. See D4' in
debug/260520-1700-executor-smell-taxonomy-pass2/findings.md.
"""
from __future__ import annotations

# Threshold (chars) above which a CLI prompt gets written to a
# tempfile instead of passed as a positional arg. 1000 is well under
# the Windows 32 KB ceiling — picked conservatively to leave headroom
# for env vars + the rest of argv.
MAX_CLI_ARG_LENGTH: int = 1000
