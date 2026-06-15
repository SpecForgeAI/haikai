"""Tests for ConversationSummarizer — summarization + context injection."""
import pytest
from unittest.mock import MagicMock

from src.chat.persistent_store import PersistentSessionStore
from src.chat.conversation_summarizer import ConversationSummarizer


@pytest.fixture
def store(tmp_path):
    return PersistentSessionStore(db_path=str(tmp_path / "test.db"))


@pytest.fixture
def session(store):
    sid = store.create_session("proj", "co", "user1")
    return sid


class TestMaybeSummarize:
    def test_no_summary_below_threshold(self, store, session):
        for i in range(5):
            store.save_message(session, "user", f"msg {i}")
        summarizer = ConversationSummarizer(store, summary_threshold=20)
        result = summarizer.summarize_conversation(session)
        assert result is None

    def test_summarizes_at_threshold(self, store, session):
        for i in range(25):
            store.save_message(session, "user" if i % 2 == 0 else "assistant", f"msg {i}")
        summarizer = ConversationSummarizer(store, summary_threshold=20)
        result = summarizer.summarize_conversation(session)
        assert result is not None
        assert len(result) > 0
        # Should be saved to store
        assert store.get_latest_summary(session) is not None

    def test_uses_llm_when_available(self, store, session):
        for i in range(25):
            store.save_message(session, "user", f"msg {i}")
        mock_llm = MagicMock()
        mock_llm.generate.return_value = "User discussed API design and preferred REST."
        summarizer = ConversationSummarizer(store, llm_client=mock_llm, summary_threshold=20)
        result = summarizer.summarize_conversation(session)
        assert "API design" in result
        mock_llm.generate.assert_called_once()

    def test_fallback_on_llm_error(self, store, session):
        for i in range(25):
            store.save_message(session, "user" if i % 2 == 0 else "assistant", f"msg {i}")
        mock_llm = MagicMock()
        mock_llm.generate.side_effect = Exception("LLM down")
        summarizer = ConversationSummarizer(store, llm_client=mock_llm, summary_threshold=20)
        result = summarizer.summarize_conversation(session)
        # Should fallback to extractive, not crash
        assert result is not None


class TestGetContext:
    def test_empty_context(self, store, session):
        summarizer = ConversationSummarizer(store)
        ctx = summarizer.get_context(session, "proj", "co")
        assert ctx == ""

    def test_preferences_included(self, store, session):
        store.set_preference("proj", "naming", "style", "camelCase", user_id="user1")
        summarizer = ConversationSummarizer(store)
        ctx = summarizer.get_context(session, "proj", "co", user_id="user1")
        assert "camelCase" in ctx
        assert "User preferences" in ctx

    def test_extraction_included(self, store, session):
        store.save_extraction(session, "proj", "co", file_count=47, summary="12 standards extracted")
        summarizer = ConversationSummarizer(store)
        ctx = summarizer.get_context(session, "proj", "co")
        assert "47" in ctx or "12 standards" in ctx

    def test_summary_included(self, store, session):
        store.save_summary(session, "User wants REST API standards for their Java project.")
        summarizer = ConversationSummarizer(store)
        ctx = summarizer.get_context(session, "proj", "co")
        assert "REST API standards" in ctx

    def test_recent_turns_included(self, store, session):
        store.save_message(session, "user", "Can you extract standards from my repo?")
        store.save_message(session, "assistant", "Sure, I'll analyze your codebase.")
        summarizer = ConversationSummarizer(store)
        ctx = summarizer.get_context(session, "proj", "co")
        assert "extract standards" in ctx

    def test_priority_order(self, store, session):
        # Add all context types
        store.set_preference("proj", "naming", "style", "camelCase", user_id="user1")
        store.save_extraction(session, "proj", "co", summary="47 files analyzed")
        store.save_summary(session, "Discussed Java standards extraction.")
        store.save_message(session, "user", "Final question about tests.")

        summarizer = ConversationSummarizer(store)
        ctx = summarizer.get_context(session, "proj", "co", user_id="user1")

        # All should be present
        assert "camelCase" in ctx
        assert "47 files" in ctx
        assert "Java standards" in ctx
        assert "Final question" in ctx

        # Preferences should come first
        pref_pos = ctx.index("User preferences")
        summary_pos = ctx.index("Conversation summary")
        assert pref_pos < summary_pos

    def test_budget_truncation(self, store, session):
        # Add a very long summary
        long_summary = "x" * 20000
        store.save_summary(session, long_summary)
        summarizer = ConversationSummarizer(store, context_budget=500)
        ctx = summarizer.get_context(session, "proj", "co")
        # Should be truncated, not the full 20k
        assert len(ctx) < 5000

    def test_budget_excludes_low_priority(self, store, session):
        # Tiny budget — only preferences should fit
        store.set_preference("proj", "naming", "style", "camelCase", user_id="user1")
        store.save_summary(session, "Long summary about many things discussed.")
        for i in range(10):
            store.save_message(session, "user", f"Message {i} with some content here.")

        summarizer = ConversationSummarizer(store, context_budget=100)
        ctx = summarizer.get_context(session, "proj", "co", user_id="user1")
        # Preferences should fit, but not everything
        assert "camelCase" in ctx
