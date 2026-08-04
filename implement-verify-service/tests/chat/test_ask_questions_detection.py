"""/ask-questions invocation detection (2026-08-04 live incident).

A skills DIRECTORY LISTING line (``./.kiro/skills/haikai/ask-questions``)
tripped the old substring detector during a successful /write-spec run,
buffered the rest of the output as question content, and the orchestrator
hard-failed a step that exited 0. The rule now: line-START command only,
shared by every executor (kiro checks lines; openai/oauth assemble deltas
into lines first).
"""
from __future__ import annotations

from src.chat.ask_questions_detection import (
    AskQuestionsDeltaDetector,
    is_ask_questions_invocation,
)


class TestIsAskQuestionsInvocation:
    def test_bare_command(self):
        assert is_ask_questions_invocation("/ask-questions")

    def test_command_with_args(self):
        assert is_ask_questions_invocation("/ask-questions What database engine?")

    def test_kiro_response_prefix(self):
        assert is_ask_questions_invocation("> /ask-questions")
        assert is_ask_questions_invocation(">  /ask-questions now")

    def test_leading_whitespace(self):
        assert is_ask_questions_invocation("  /ask-questions")

    def test_skills_directory_listing_never_trips(self):
        # THE live incident line.
        assert not is_ask_questions_invocation("./.kiro/skills/haikai/ask-questions")
        assert not is_ask_questions_invocation(".kiro/skills/haikai/ask-questions/skill.md")

    def test_prose_mentions_never_trip(self):
        assert not is_ask_questions_invocation(
            "use the /ask-questions skill and then STOP"
        )
        assert not is_ask_questions_invocation("Ask-Questions is a skill")
        assert not is_ask_questions_invocation("see haikai/ask-questions for details")

    def test_similar_command_names_never_trip(self):
        assert not is_ask_questions_invocation("/ask-questionsfoo")

    def test_mid_line_command_never_trips(self):
        assert not is_ask_questions_invocation("Next run /ask-questions please")


class TestAskQuestionsDeltaDetector:
    def test_invocation_split_across_deltas(self):
        d = AskQuestionsDeltaDetector()
        assert not d.feed("/ask-que")
        assert d.feed("stions\nsome question text\n")

    def test_path_mention_across_deltas_never_trips(self):
        d = AskQuestionsDeltaDetector()
        assert not d.feed("./.kiro/skills/haikai/ask-")
        assert not d.feed("questions\nmore output\n")
        assert not d.flush()

    def test_flush_evaluates_final_unterminated_line(self):
        d = AskQuestionsDeltaDetector()
        assert not d.feed("preamble\n/ask-questions")
        assert d.flush()

    def test_flush_resets(self):
        d = AskQuestionsDeltaDetector()
        d.feed("/ask-questions")
        assert d.flush()
        assert not d.flush()
