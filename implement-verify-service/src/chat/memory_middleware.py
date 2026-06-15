"""Chat memory middleware — wraps chat executors with persistent memory.

Handles:
- Session creation/resumption in persistent store
- Context injection before each message
- Message persistence after each turn
- Auto-summarization when threshold reached
- Preference detection from user messages
"""
import logging
import os
import re
from pathlib import Path
from typing import Optional

from src.chat.persistent_store import PersistentSessionStore, create_session_store
from src.chat.conversation_summarizer import ConversationSummarizer

logger = logging.getLogger(__name__)

# Preference detection patterns
PREFERENCE_PATTERNS = [
    (r"(?:I )?prefer (\w+)", "general", "preference"),
    (r"always use (\w+)", "general", "preference"),
    (r"(?:use |switch to )?(camelCase|snake_case|PascalCase|kebab-case)", "naming", "style"),
    (r"skip (?:the )?(\w+) files?", "filtering", "skip"),
    (r"(?:don't |do not )include (\w+)", "filtering", "exclude"),
    (r"(?:verbose|detailed) output", "output", "verbosity"),
]


class ChatMemoryMiddleware:
    """Wraps chat interactions with persistent memory.

    Usage:
        middleware = ChatMemoryMiddleware(project, company)
        context = middleware.on_session_start(session_id, is_new)
        # ... inject context into message or system prompt ...
        middleware.on_user_message(session_id, message)
        middleware.on_assistant_message(session_id, response)
    """

    def __init__(self, project: str, company: str, user_id: str = "",
                 db_path: str = None, llm_client=None):
        self._project = project
        self._company = company
        self._user_id = user_id
        self._store = create_session_store(persistent=True, db_path=db_path)
        self._summarizer = ConversationSummarizer(
            self._store,
            llm_client=llm_client,
            summary_threshold=int(os.getenv("CHAT_SUMMARY_THRESHOLD", "20")),
            context_budget=int(os.getenv("CHAT_CONTEXT_BUDGET_TOKENS", "2000")),
        )

    @property
    def store(self) -> PersistentSessionStore:
        return self._store

    def on_session_start(self, session_id: str = None,
                         is_new: bool = False) -> tuple[str, str]:
        """Handle session start. Returns (session_id, context_text).

        If is_new, creates a new session. Otherwise resumes existing.
        Returns context text to inject into the conversation.
        """
        if is_new or not session_id:
            # Check for existing active session
            if not is_new:
                existing = self._store.get_active_session(self._project, self._company)
                if existing:
                    session_id = existing
                else:
                    is_new = True

            if is_new:
                session_id = self._store.create_session(
                    self._project, self._company, self._user_id, session_id
                )
        else:
            # Verify session exists
            session = self._store.get_session(session_id)
            if not session:
                session_id = self._store.create_session(
                    self._project, self._company, self._user_id, session_id
                )

        # Build context for injection
        context = self._summarizer.get_context(
            session_id, self._project, self._company, self._user_id
        )

        return session_id, context

    def on_user_message(self, session_id: str, message: str):
        """Persist user message and detect preferences."""
        self._store.save_message(session_id, "user", message)
        self._detect_preferences(session_id, message)

    def on_assistant_message(self, session_id: str, message: str):
        """Persist assistant message and maybe summarize."""
        self._store.save_message(session_id, "assistant", message)
        self._summarizer.summarize_conversation(session_id)

    def on_extraction_complete(self, session_id: str, file_count: int = 0,
                                output_path: str = "", summary: str = "",
                                config_hash: str = ""):
        """Record extraction result."""
        self._store.save_extraction(
            session_id, self._project, self._company,
            config_hash=config_hash, file_count=file_count,
            output_path=output_path, summary=summary,
        )

    def _detect_preferences(self, session_id: str, message: str):
        """Detect preference signals in user messages."""
        message_lower = message.lower()
        for pattern, category, key in PREFERENCE_PATTERNS:
            match = re.search(pattern, message, re.IGNORECASE)
            if match:
                value = match.group(1) if match.lastindex else "true"
                self._store.set_preference(
                    self._project, category, key, value,
                    user_id=self._user_id,
                    source_session_id=session_id,
                )
                logger.info(f"Detected preference: {category}/{key}={value}")

    def get_session_history(self, session_id: str, limit: int = 50) -> list[dict]:
        """Get conversation history."""
        return self._store.get_history(session_id, limit=limit)

    def list_sessions(self) -> list[dict]:
        """List all sessions for this project."""
        return self._store.list_sessions(self._project, self._company)

    def delete_session(self, session_id: str):
        """Delete a session and all associated data."""
        self._store.delete_session(session_id)

    def get_preferences(self) -> list[dict]:
        """Get all preferences for this project."""
        return self._store.get_preferences(self._project, user_id=self._user_id)
