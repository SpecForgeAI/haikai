"""Tests for PersistentSessionStore — SQLite-backed chat memory."""
import os
import pytest
from src.chat.persistent_store import PersistentSessionStore, create_session_store


@pytest.fixture
def store(tmp_path):
    db_path = str(tmp_path / "test.db")
    return PersistentSessionStore(db_path=db_path)


class TestSessionCRUD:
    def test_create_and_get_session(self, store):
        sid = store.create_session("myproject", "mycompany", "user1")
        session = store.get_session(sid)
        assert session is not None
        assert session["project"] == "myproject"
        assert session["company"] == "mycompany"
        assert session["status"] == "active"

    def test_get_active_session(self, store):
        store.create_session("proj", "co", session_id="s1")
        store.create_session("proj", "co", session_id="s2")
        active = store.get_active_session("proj", "co")
        assert active == "s2"  # most recent

    def test_list_sessions(self, store):
        store.create_session("proj", "co", session_id="s1")
        store.create_session("proj", "co", session_id="s2")
        store.create_session("other", "co", session_id="s3")
        sessions = store.list_sessions("proj", "co")
        assert len(sessions) == 2

    def test_archive_session(self, store):
        sid = store.create_session("proj", "co")
        store.archive_session(sid)
        session = store.get_session(sid)
        assert session["status"] == "archived"
        # Archived session shouldn't be returned as active
        assert store.get_active_session("proj", "co") is None

    def test_delete_session_cascades(self, store):
        sid = store.create_session("proj", "co")
        store.save_message(sid, "user", "hello")
        store.save_message(sid, "assistant", "hi")
        store.delete_session(sid)
        assert store.get_session(sid) is None
        assert store.get_history(sid) == []

    def test_get_nonexistent_session(self, store):
        assert store.get_session("nonexistent") is None


class TestMessages:
    def test_save_and_get_history(self, store):
        sid = store.create_session("proj", "co")
        store.save_message(sid, "user", "hello")
        store.save_message(sid, "assistant", "hi there")
        store.save_message(sid, "user", "how are you")
        history = store.get_history(sid)
        assert len(history) == 3
        assert history[0]["role"] == "user"
        assert history[0]["content"] == "hello"
        assert history[2]["content"] == "how are you"

    def test_history_limit(self, store):
        sid = store.create_session("proj", "co")
        for i in range(10):
            store.save_message(sid, "user", f"msg {i}")
        history = store.get_history(sid, limit=3)
        assert len(history) == 3
        # Should be the LAST 3 messages
        assert history[0]["content"] == "msg 7"

    def test_message_count(self, store):
        sid = store.create_session("proj", "co")
        assert store.get_message_count(sid) == 0
        store.save_message(sid, "user", "hello")
        store.save_message(sid, "assistant", "hi")
        assert store.get_message_count(sid) == 2

    def test_save_message_updates_last_active(self, store):
        sid = store.create_session("proj", "co")
        before = store.get_session(sid)["last_active"]
        store.save_message(sid, "user", "hello")
        after = store.get_session(sid)["last_active"]
        assert after >= before


class TestSummaries:
    def test_save_and_get_summary(self, store):
        sid = store.create_session("proj", "co")
        store.save_summary(sid, "User asked about API design.", covers_up_to_message_id=5)
        summary = store.get_latest_summary(sid)
        assert "API design" in summary

    def test_latest_summary_returns_most_recent(self, store):
        sid = store.create_session("proj", "co")
        store.save_summary(sid, "First summary")
        store.save_summary(sid, "Second summary")
        assert store.get_latest_summary(sid) == "Second summary"

    def test_no_summary(self, store):
        sid = store.create_session("proj", "co")
        assert store.get_latest_summary(sid) is None


class TestPreferences:
    def test_set_and_get(self, store):
        store.set_preference("proj", "naming", "style", "camelCase", user_id="u1")
        prefs = store.get_preferences("proj", user_id="u1")
        assert len(prefs) == 1
        assert prefs[0]["key"] == "style"
        assert prefs[0]["value"] == "camelCase"

    def test_upsert_overwrites(self, store):
        store.set_preference("proj", "naming", "style", "camelCase", user_id="u1")
        store.set_preference("proj", "naming", "style", "snake_case", user_id="u1")
        prefs = store.get_preferences("proj", user_id="u1")
        assert len(prefs) == 1
        assert prefs[0]["value"] == "snake_case"

    def test_different_categories(self, store):
        store.set_preference("proj", "naming", "style", "camelCase")
        store.set_preference("proj", "output", "verbose", "true")
        prefs = store.get_preferences("proj")
        assert len(prefs) == 2

    def test_project_isolation(self, store):
        store.set_preference("proj1", "naming", "style", "camelCase")
        store.set_preference("proj2", "naming", "style", "snake_case")
        assert store.get_preferences("proj1")[0]["value"] == "camelCase"
        assert store.get_preferences("proj2")[0]["value"] == "snake_case"


class TestExtractions:
    def test_save_and_get(self, store):
        sid = store.create_session("proj", "co")
        store.save_extraction(sid, "proj", "co", file_count=47, summary="12 standards")
        exts = store.get_extractions("proj", "co")
        assert len(exts) == 1
        assert exts[0]["file_count"] == 47

    def test_latest_extraction(self, store):
        sid = store.create_session("proj", "co")
        store.save_extraction(sid, "proj", "co", summary="first")
        store.save_extraction(sid, "proj", "co", summary="second")
        latest = store.get_latest_extraction("proj", "co")
        assert latest["summary"] == "second"

    def test_no_extractions(self, store):
        assert store.get_latest_extraction("proj", "co") is None


class TestResilience:
    def test_corrupt_db_recovery(self, tmp_path):
        db_path = str(tmp_path / "corrupt.db")
        # Write garbage
        with open(db_path, "w") as f:
            f.write("this is not a sqlite database")
        # Should recover
        store = PersistentSessionStore(db_path=db_path)
        sid = store.create_session("proj", "co")
        assert store.get_session(sid) is not None

    def test_concurrent_writes(self, tmp_path):
        db_path = str(tmp_path / "concurrent.db")
        store1 = PersistentSessionStore(db_path=db_path)
        store2 = PersistentSessionStore(db_path=db_path)
        sid = store1.create_session("proj", "co")
        store1.save_message(sid, "user", "from store1")
        store2.save_message(sid, "assistant", "from store2")
        history = store1.get_history(sid)
        assert len(history) == 2


class TestFactory:
    def test_create_persistent(self, tmp_path):
        store = create_session_store(persistent=True, db_path=str(tmp_path / "test.db"))
        assert isinstance(store, PersistentSessionStore)
