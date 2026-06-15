"""SQLite-backed persistent session storage for chat memory.

Stores conversations, summaries, preferences, and extraction results
across sessions. Uses WAL mode for concurrent access.
"""
import json
import logging
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_DB_DIR = ".chat-memory"
DEFAULT_DB_NAME = "sessions.db"


class PersistentSessionStore:
    """SQLite-backed persistent session store.

    Implements the same conceptual interface as the existing session_store.py
    functions but backed by SQLite for persistence across restarts.
    """

    def __init__(self, db_path: Optional[str] = None):
        if db_path:
            self._db_path = db_path
        else:
            self._db_path = os.path.join(DEFAULT_DB_DIR, DEFAULT_DB_NAME)

        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self):
        """Create tables if they don't exist. Enable WAL mode."""
        conn = None
        try:
            conn = self._connect()
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    project TEXT NOT NULL,
                    company TEXT NOT NULL,
                    user_id TEXT,
                    created_at TEXT DEFAULT (datetime('now')),
                    last_active TEXT DEFAULT (datetime('now')),
                    status TEXT DEFAULT 'active'
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
                    role TEXT NOT NULL,
                    content TEXT,
                    tool_calls TEXT,
                    timestamp TEXT DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS summaries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
                    summary_text TEXT NOT NULL,
                    covers_up_to_message_id INTEGER,
                    created_at TEXT DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS preferences (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT,
                    project TEXT NOT NULL,
                    category TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    source_session_id TEXT,
                    created_at TEXT DEFAULT (datetime('now')),
                    UNIQUE(user_id, project, category, key)
                );

                CREATE TABLE IF NOT EXISTS extractions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
                    project TEXT NOT NULL,
                    company TEXT NOT NULL,
                    timestamp TEXT DEFAULT (datetime('now')),
                    config_hash TEXT,
                    file_count INTEGER,
                    output_path TEXT,
                    summary TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
                CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id);
                CREATE INDEX IF NOT EXISTS idx_preferences_project ON preferences(user_id, project);
                CREATE INDEX IF NOT EXISTS idx_extractions_project ON extractions(project, company);
            """)
            conn.commit()
            conn.close()
        except sqlite3.DatabaseError as e:
            logger.error(f"DB init failed — corrupt DB? {e}")
            if conn:
                conn.close()
            self._recover_corrupt_db()
            self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _recover_corrupt_db(self):
        """Backup corrupt DB and create fresh one."""
        backup = self._db_path + ".corrupt"
        logger.warning(f"Recovering corrupt DB: {self._db_path} → {backup}")
        try:
            os.rename(self._db_path, backup)
        except OSError:
            os.remove(self._db_path)

    # --- Session CRUD ---

    def create_session(self, project: str, company: str,
                       user_id: str = "", session_id: str = None) -> str:
        """Create a new session. Returns session ID."""
        session_id = session_id or str(uuid.uuid4())
        conn = self._connect()
        try:
            conn.execute(
                "INSERT INTO sessions (id, project, company, user_id) VALUES (?, ?, ?, ?)",
                (session_id, project, company, user_id),
            )
            conn.commit()
            logger.info(f"Created session {session_id} for {company}/{project}")
            return session_id
        finally:
            conn.close()

    def get_session(self, session_id: str) -> Optional[dict]:
        """Get session metadata."""
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_active_session(self, project: str, company: str) -> Optional[str]:
        """Get the most recent active session for a project. Returns session ID or None."""
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT id FROM sessions WHERE project = ? AND company = ? AND status = 'active' "
                "ORDER BY rowid DESC LIMIT 1",
                (project, company),
            ).fetchone()
            return row["id"] if row else None
        finally:
            conn.close()

    def list_sessions(self, project: str, company: str) -> list[dict]:
        """List all sessions for a project."""
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM sessions WHERE project = ? AND company = ? ORDER BY last_active DESC",
                (project, company),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def archive_session(self, session_id: str):
        """Mark session as archived."""
        conn = self._connect()
        try:
            conn.execute("UPDATE sessions SET status = 'archived' WHERE id = ?", (session_id,))
            conn.commit()
        finally:
            conn.close()

    def delete_session(self, session_id: str):
        """Hard delete session and all associated data."""
        conn = self._connect()
        try:
            conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            conn.commit()
            logger.info(f"Deleted session {session_id}")
        finally:
            conn.close()

    # --- Messages ---

    def save_message(self, session_id: str, role: str, content: str,
                     tool_calls: str = None) -> int:
        """Save a message to a session. Returns message ID."""
        conn = self._connect()
        try:
            cursor = conn.execute(
                "INSERT INTO messages (session_id, role, content, tool_calls) VALUES (?, ?, ?, ?)",
                (session_id, role, content, tool_calls),
            )
            conn.execute(
                "UPDATE sessions SET last_active = datetime('now') WHERE id = ?",
                (session_id,),
            )
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def get_history(self, session_id: str, limit: int = 50) -> list[dict]:
        """Get conversation history for a session."""
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?",
                (session_id, limit),
            ).fetchall()
            return [dict(r) for r in reversed(rows)]
        finally:
            conn.close()

    def get_message_count(self, session_id: str) -> int:
        """Get number of messages in a session."""
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            return row["cnt"]
        finally:
            conn.close()

    # --- Summaries ---

    def save_summary(self, session_id: str, summary_text: str,
                     covers_up_to_message_id: int = None) -> int:
        """Save a conversation summary."""
        conn = self._connect()
        try:
            cursor = conn.execute(
                "INSERT INTO summaries (session_id, summary_text, covers_up_to_message_id) "
                "VALUES (?, ?, ?)",
                (session_id, summary_text, covers_up_to_message_id),
            )
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def get_latest_summary(self, session_id: str) -> Optional[str]:
        """Get the most recent summary for a session."""
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT summary_text FROM summaries WHERE session_id = ? "
                "ORDER BY id DESC LIMIT 1",
                (session_id,),
            ).fetchone()
            return row["summary_text"] if row else None
        finally:
            conn.close()

    # --- Preferences ---

    def set_preference(self, project: str, category: str, key: str, value: str,
                       user_id: str = "", source_session_id: str = None):
        """Set a user preference. Upserts on (user_id, project, category, key)."""
        conn = self._connect()
        try:
            conn.execute(
                "INSERT INTO preferences (user_id, project, category, key, value, source_session_id) "
                "VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(user_id, project, category, key) DO UPDATE SET "
                "value = excluded.value, source_session_id = excluded.source_session_id, "
                "created_at = datetime('now')",
                (user_id, project, category, key, value, source_session_id),
            )
            conn.commit()
        finally:
            conn.close()

    def get_preferences(self, project: str, user_id: str = "") -> list[dict]:
        """Get all preferences for a project/user."""
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT category, key, value FROM preferences "
                "WHERE project = ? AND user_id = ? ORDER BY category, key",
                (project, user_id),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    # --- Extractions ---

    def save_extraction(self, session_id: str, project: str, company: str,
                        config_hash: str = "", file_count: int = 0,
                        output_path: str = "", summary: str = "") -> int:
        """Save an extraction result reference."""
        conn = self._connect()
        try:
            cursor = conn.execute(
                "INSERT INTO extractions (session_id, project, company, config_hash, "
                "file_count, output_path, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (session_id, project, company, config_hash, file_count, output_path, summary),
            )
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def get_extractions(self, project: str, company: str, limit: int = 10) -> list[dict]:
        """Get recent extractions for a project."""
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM extractions WHERE project = ? AND company = ? "
                "ORDER BY id DESC LIMIT ?",
                (project, company, limit),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_latest_extraction(self, project: str, company: str) -> Optional[dict]:
        """Get the most recent extraction for a project."""
        results = self.get_extractions(project, company, limit=1)
        return results[0] if results else None


def create_session_store(persistent: bool = True, db_path: str = None) -> PersistentSessionStore:
    """Factory function for creating a session store.

    Controlled by CHAT_PERSISTENT_MEMORY env var (default: true).
    """
    if not persistent:
        persistent = os.getenv("CHAT_PERSISTENT_MEMORY", "true").lower() == "true"
    return PersistentSessionStore(db_path=db_path)
