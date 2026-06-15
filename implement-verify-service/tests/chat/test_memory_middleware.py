"""Tests for ChatMemoryMiddleware — integration between store, summarizer, and chat."""
import pytest

from src.chat.memory_middleware import ChatMemoryMiddleware


@pytest.fixture
def mw(tmp_path):
    return ChatMemoryMiddleware("proj", "co", "user1", db_path=str(tmp_path / "test.db"))


class TestSessionStart:
    def test_new_session(self, mw):
        sid, ctx = mw.on_session_start(is_new=True)
        assert sid is not None
        assert mw.store.get_session(sid) is not None

    def test_resume_existing(self, mw):
        sid1, _ = mw.on_session_start(is_new=True)
        sid2, _ = mw.on_session_start(is_new=False)
        assert sid2 == sid1  # should resume same session

    def test_auto_create_on_no_session(self, tmp_path):
        mw = ChatMemoryMiddleware("newproj", "co", db_path=str(tmp_path / "test.db"))
        sid, _ = mw.on_session_start(is_new=False)
        assert sid is not None  # creates one automatically

    def test_context_injection_on_resume(self, mw):
        sid, _ = mw.on_session_start(is_new=True)
        mw.store.set_preference("proj", "naming", "style", "camelCase", user_id="user1")
        mw.on_user_message(sid, "hello")
        mw.on_assistant_message(sid, "hi there")

        # Resume — should get context
        _, ctx = mw.on_session_start(session_id=sid, is_new=False)
        assert "camelCase" in ctx


class TestMessagePersistence:
    def test_user_message_saved(self, mw):
        sid, _ = mw.on_session_start(is_new=True)
        mw.on_user_message(sid, "hello world")
        history = mw.get_session_history(sid)
        assert len(history) == 1
        assert history[0]["content"] == "hello world"

    def test_assistant_message_saved(self, mw):
        sid, _ = mw.on_session_start(is_new=True)
        mw.on_user_message(sid, "hello")
        mw.on_assistant_message(sid, "hi there")
        history = mw.get_session_history(sid)
        assert len(history) == 2


class TestPreferenceDetection:
    def test_detects_naming_preference(self, mw):
        sid, _ = mw.on_session_start(is_new=True)
        mw.on_user_message(sid, "I prefer camelCase for all variables")
        prefs = mw.get_preferences()
        assert any(p["value"] == "camelCase" for p in prefs)

    def test_detects_snake_case(self, mw):
        sid, _ = mw.on_session_start(is_new=True)
        mw.on_user_message(sid, "use snake_case please")
        prefs = mw.get_preferences()
        assert any(p["value"] == "snake_case" for p in prefs)

    def test_detects_skip_preference(self, mw):
        sid, _ = mw.on_session_start(is_new=True)
        mw.on_user_message(sid, "skip the test files")
        prefs = mw.get_preferences()
        assert any(p["key"] == "skip" for p in prefs)

    def test_no_false_positive(self, mw):
        sid, _ = mw.on_session_start(is_new=True)
        mw.on_user_message(sid, "Can you help me with the API?")
        prefs = mw.get_preferences()
        assert len(prefs) == 0


class TestExtractionMemory:
    def test_records_extraction(self, mw):
        sid, _ = mw.on_session_start(is_new=True)
        mw.on_extraction_complete(sid, file_count=47, summary="12 standards")
        ext = mw.store.get_latest_extraction("proj", "co")
        assert ext["file_count"] == 47
        assert ext["summary"] == "12 standards"


class TestSessionManagement:
    def test_list_sessions(self, mw):
        mw.on_session_start(is_new=True)
        mw.on_session_start(is_new=True)
        sessions = mw.list_sessions()
        assert len(sessions) == 2

    def test_delete_session(self, mw):
        sid, _ = mw.on_session_start(is_new=True)
        mw.on_user_message(sid, "hello")
        mw.delete_session(sid)
        assert mw.store.get_session(sid) is None
