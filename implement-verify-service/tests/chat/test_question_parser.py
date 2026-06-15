"""Regression tests for src.chat.question_parser.

Covers the four supported formats that chat executors must parse from the
buffered `/ask-questions` assistant response. Pattern 2 (colon-separated
IDs) is the load-bearing one — the OpenAI executor's old hand-rolled
parser was missing it, causing a silent "zero questions returned" bug
in production. See learn/260520-1850-deep-src-smells/validation-report.md
finding N1.
"""

from __future__ import annotations

import pytest

from src.chat.question_parser import parse_questions


class TestPattern1Brackets:
    """`- [uuid] Question text` — bracket-style IDs."""

    def test_single_question(self):
        chunks = ["- [q1] Should we support OAuth?"]
        out = parse_questions(chunks)
        assert out == [{"id": "q1", "question": "Should we support OAuth?"}]

    def test_multiple_questions(self):
        chunks = [
            "- [q1] Should we support OAuth?\n"
            "- [q2] Do you want rate limiting?"
        ]
        out = parse_questions(chunks)
        assert len(out) == 2
        assert out[0]["id"] == "q1"
        assert out[1]["id"] == "q2"
        assert "rate limiting" in out[1]["question"]

    def test_uuid_id(self):
        chunks = ["- [550e8400-e29b-41d4-a716-446655440000] What scope?"]
        out = parse_questions(chunks)
        assert out[0]["id"] == "550e8400-e29b-41d4-a716-446655440000"


class TestPattern2ColonIDs:
    """`- q1: Question text` — colon-separated IDs.

    This is the format the Claude CLI Skill tool emits in its args field,
    and the one the pre-fix OpenAI parser missed.
    """

    def test_single_question(self):
        chunks = ["- q1: Should we support OAuth?"]
        out = parse_questions(chunks)
        assert out == [{"id": "q1", "question": "Should we support OAuth?"}]

    def test_multiple_questions(self):
        chunks = [
            "- q1: Should we support OAuth?\n"
            "- q2: I'm thinking rate-limit at 100rps — sound right?"
        ]
        out = parse_questions(chunks)
        assert len(out) == 2
        assert out[0]["id"] == "q1"
        assert out[1]["id"] == "q2"
        assert "rate-limit" in out[1]["question"]

    def test_pattern_2_is_what_openai_used_to_drop(self):
        """Regression for N1: silent OpenAI bug.

        Pre-fix, openai_chat_executor._parse_questions_from_content only
        knew patterns 1 + 3 — colon-format input returned an empty list.
        After delegating to parse_questions, this must return 2 items.
        """
        chunks = [
            "- a: First question?\n"
            "- b: Second question?"
        ]
        out = parse_questions(chunks)
        assert len(out) == 2, "Pattern 2 must parse — this is the N1 regression"


class TestPattern3Numbered:
    """`**1.** Text`  /  `**Q1:** Text`  /  `**Question 1:** Text`."""

    def test_double_star_dotted(self):
        chunks = [
            "**1.** Should we support OAuth?\n"
            "**2.** Do you want rate limiting?"
        ]
        out = parse_questions(chunks)
        assert len(out) == 2
        assert out[0]["id"] == "q1"
        assert "OAuth" in out[0]["question"]

    def test_q_prefix(self):
        chunks = ["**Q1:** First?\n**Q2:** Second?"]
        out = parse_questions(chunks)
        assert len(out) == 2

    def test_question_word_prefix(self):
        chunks = ["**Question 1:** First?\n**Question 2:** Second?"]
        out = parse_questions(chunks)
        assert len(out) == 2

    def test_section_header_skipped(self):
        """Lines ending in `:` are treated as section headers, not questions."""
        chunks = [
            "**1.** Existing Code Reuse:\n"
            "**2.** Are there shared utilities to leverage?"
        ]
        out = parse_questions(chunks)
        # Only the second one survives — the first ends in ':'.
        assert len(out) == 1
        assert "shared utilities" in out[0]["question"]


class TestPattern4PlainNumbered:
    """`1. Question text` — bare numbered list (Kiro fallback)."""

    def test_plain_numbered(self):
        chunks = [
            "1. Should we support OAuth integration?\n"
            "2. Do you need rate limiting on the endpoint?"
        ]
        out = parse_questions(chunks)
        assert len(out) == 2
        assert out[0]["id"] == "q1"

    def test_short_items_filtered(self):
        """Short lines (<= 10 chars) are filtered to avoid catching ToC numbers."""
        chunks = [
            "1. ok\n"
            "2. Should we support OAuth integration?"
        ]
        out = parse_questions(chunks)
        assert len(out) == 1
        assert "OAuth" in out[0]["question"]


class TestEdgeCases:

    def test_empty_input(self):
        assert parse_questions([]) == []

    def test_empty_string_chunk(self):
        assert parse_questions([""]) == []

    def test_no_pattern_matches(self):
        chunks = ["Just some prose with no question structure at all."]
        assert parse_questions(chunks) == []

    def test_pattern_1_takes_priority_over_pattern_2(self):
        """If both bracket and colon formats are present, Pattern 1 wins."""
        chunks = [
            "- [q1] Bracket question\n"
            "- q2: Colon question"
        ]
        out = parse_questions(chunks)
        # Pattern 1 matches the first line and returns; Pattern 2 is never tried.
        assert len(out) == 1
        assert out[0]["id"] == "q1"

    def test_chunked_input_joined_with_newlines(self):
        """Adjacent list items split across chunks must still parse."""
        chunks = ["- q1: First?", "- q2: Second?"]
        out = parse_questions(chunks)
        assert len(out) == 2


@pytest.mark.parametrize(
    "executor_cls_path",
    [
        "src.chat.claude_chat_executor.ClaudeChatExecutor",
        "src.chat.kiro_chat_executor.KiroChatExecutor",
        "src.chat.oauth_chat_executor.OAuthChatExecutor",
        "src.chat.openai_chat_executor.OpenAIChatExecutor",
    ],
)
def test_executor_delegates_to_shared_parser(executor_cls_path):
    """Anti-divergence: every executor's `_parse_questions_from_content`
    must produce the same result as the shared `parse_questions`.

    Critically exercises Pattern 2 — the format whose absence on OpenAI
    caused the original silent bug.
    """
    import importlib
    module_path, cls_name = executor_cls_path.rsplit(".", 1)
    cls = getattr(importlib.import_module(module_path), cls_name)

    # Build instance without invoking __init__ (avoids requiring API keys,
    # workspace dirs, etc.). The method we're testing is pure.
    instance = cls.__new__(cls)
    chunks = ["- q1: Colon-format A?\n- q2: Colon-format B?"]

    direct = parse_questions(chunks)
    delegated = instance._parse_questions_from_content(chunks)

    assert direct == delegated
    assert len(delegated) == 2, (
        f"{cls_name} must return 2 questions for Pattern 2 input "
        "(N1 regression — pre-fix OpenAI returned 0)"
    )
