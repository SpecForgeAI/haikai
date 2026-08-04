"""Single source of truth for detecting a genuine /ask-questions invocation.

2026-08-04 live incident: the kiro executor's naive substring match flipped
question-collection on a skills DIRECTORY LISTING line
(``./.kiro/skills/haikai/ask-questions``) during a successful /write-spec
run. Everything after it buffered as "question content", the question parser
scraped 3 "questions" out of ordinary spec prose, and the orchestrator's
non-interactive guard hard-failed a step that exited 0 with an 84-line spec.

The rule everywhere: only a line that STARTS with the command (after an
optional ``> `` response prefix and leading whitespace) is an invocation.
Path mentions, prose mentions, and skill-catalog lines never count. The
openai/oauth executors stream token DELTAS rather than lines, so they feed
:class:`AskQuestionsDeltaDetector`, which assembles complete lines before
applying the same rule.

An anti-pattern guard (``tests/test_anti_pattern_guards.py``) bans the raw
substring form in the executors so the bug cannot be reintroduced.
"""
from __future__ import annotations

import re

#: Line-start command, tolerating kiro's ``> `` response prefix and leading
#: whitespace; ``\b`` keeps ``/ask-questionsfoo`` out while allowing
#: arguments after the command.
_ASK_QUESTIONS_INVOCATION_RE = re.compile(r'^(?:>\s*)?\s*/ask-questions(?:\b|$)')


def is_ask_questions_invocation(line: str) -> bool:
    """True only for a line that actually INVOKES /ask-questions."""
    return bool(_ASK_QUESTIONS_INVOCATION_RE.match(line))


class AskQuestionsDeltaDetector:
    """Line-assembling detector for token-delta streams (openai/oauth).

    Feed each streamed delta; the detector buffers a line tail across
    chunks and applies :func:`is_ask_questions_invocation` to every
    COMPLETE line. Call :meth:`flush` once at stream end so a final
    line without a trailing newline is still evaluated.
    """

    def __init__(self) -> None:
        self._tail = ""

    def feed(self, delta: str) -> bool:
        """Consume one delta; True if any completed line is an invocation."""
        self._tail += delta
        if "\n" not in self._tail:
            return False
        *complete, self._tail = self._tail.split("\n")
        return any(is_ask_questions_invocation(line) for line in complete)

    def flush(self) -> bool:
        """Evaluate the unterminated final line (stream end)."""
        line, self._tail = self._tail, ""
        return is_ask_questions_invocation(line)
