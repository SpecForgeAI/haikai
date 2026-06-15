"""Conversation summarization and context management.

Summarizes long conversations to fit within LLM context windows.
Manages priority-ordered context injection for session resumption.
"""
import logging
from typing import Optional

from src.chat.persistent_store import PersistentSessionStore

logger = logging.getLogger(__name__)

DEFAULT_SUMMARY_THRESHOLD = 20  # turns before auto-summarize
DEFAULT_CONTEXT_BUDGET = 2000   # tokens
TOKENS_PER_CHAR = 0.25          # rough estimate

SUMMARY_SYSTEM_PROMPT = """You are summarizing a conversation between a user and an AI assistant about software development.

Capture:
- Key decisions made
- User preferences expressed (naming, formatting, approach)
- Extraction or analysis requests and their outcomes
- Unresolved questions or next steps

Be concise. Focus on what a future session needs to continue the work."""

SUMMARY_USER_PROMPT = """Summarize this conversation in under 500 words.
{previous_summary}
Recent messages:
{messages}"""


class ConversationSummarizer:
    """Summarizes conversations and manages context injection."""

    def __init__(self, store: PersistentSessionStore, llm_client=None,
                 summary_threshold: int = DEFAULT_SUMMARY_THRESHOLD,
                 context_budget: int = DEFAULT_CONTEXT_BUDGET):
        self._store = store
        self._llm = llm_client
        self._summary_threshold = summary_threshold
        self._context_budget = context_budget

    def summarize_conversation(self, session_id: str) -> Optional[str]:
        """Summarize if conversation exceeds threshold. Returns summary or None."""
        count = self._store.get_message_count(session_id)
        if count < self._summary_threshold:
            return None

        existing = self._store.get_latest_summary(session_id)
        history = self._store.get_history(session_id, limit=self._summary_threshold)

        if not history:
            return None

        summary = self._generate_summary(history, existing)
        if summary:
            last_msg_id = max(m.get("id", 0) for m in history)
            self._store.save_summary(session_id, summary, covers_up_to_message_id=last_msg_id)
            logger.info(f"Generated summary for session {session_id} ({count} messages)")

        return summary

    def _generate_summary(self, messages: list[dict], previous_summary: str = None) -> str:
        """Generate summary using LLM or fallback to extractive."""
        formatted = self._format_messages(messages)

        if self._llm:
            return self._llm_summarize(formatted, previous_summary)

        return self._extractive_summarize(messages, previous_summary)

    def _llm_summarize(self, formatted_messages: str, previous_summary: str = None) -> str:
        """Use LLM to generate abstractive summary."""
        prev = f"Previous summary:\n{previous_summary}\n\n" if previous_summary else ""
        prompt = SUMMARY_USER_PROMPT.format(
            previous_summary=prev,
            messages=formatted_messages,
        )

        try:
            result = self._llm.generate(
                messages=[
                    {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=500,
            )
            return result.strip() if isinstance(result, str) else str(result).strip()
        except Exception as e:
            logger.warning(f"LLM summarization failed: {e}")
            return self._extractive_summarize_from_text(formatted_messages, previous_summary)

    def _extractive_summarize(self, messages: list[dict], previous_summary: str = None) -> str:
        """Fallback: extract key messages without LLM."""
        parts = []
        if previous_summary:
            parts.append(f"Previous context: {previous_summary}")

        # Take first user message (intent), last few exchanges
        user_msgs = [m for m in messages if m.get("role") == "user"]
        if user_msgs:
            parts.append(f"Started with: {user_msgs[0].get('content', '')[:200]}")
        if len(user_msgs) > 1:
            parts.append(f"Most recent: {user_msgs[-1].get('content', '')[:200]}")

        assistant_msgs = [m for m in messages if m.get("role") == "assistant"]
        if assistant_msgs:
            parts.append(f"Last response: {assistant_msgs[-1].get('content', '')[:200]}")

        return " | ".join(parts)

    def _extractive_summarize_from_text(self, text: str, previous: str = None) -> str:
        """Fallback from formatted text."""
        lines = text.strip().splitlines()
        key_lines = lines[:3] + lines[-3:] if len(lines) > 6 else lines
        summary = "\n".join(key_lines)[:500]
        if previous:
            summary = f"{previous}\n---\n{summary}"
        return summary

    def get_context(self, session_id: str, project: str, company: str,
                    user_id: str = "") -> str:
        """Build priority-ordered context within token budget.

        Priority (highest first):
        1. User preferences (~200 tokens)
        2. Last extraction summary (~300 tokens)
        3. Conversation summary (~500-1000 tokens)
        4. Recent turns verbatim (remaining budget)
        """
        budget = self._context_budget
        parts = []

        # 1. Preferences
        prefs = self._store.get_preferences(project, user_id=user_id)
        if prefs:
            pref_text = self._format_preferences(prefs)
            pref_tokens = self._estimate_tokens(pref_text)
            if pref_tokens <= min(200, budget):
                parts.append(f"User preferences:\n{pref_text}")
                budget -= pref_tokens

        # 2. Last extraction
        extraction = self._store.get_latest_extraction(project, company)
        if extraction and budget > 100:
            ext_text = self._format_extraction(extraction)
            ext_tokens = self._estimate_tokens(ext_text)
            if ext_tokens <= min(300, budget):
                parts.append(f"Last extraction:\n{ext_text}")
                budget -= ext_tokens

        # 3. Conversation summary
        summary = self._store.get_latest_summary(session_id)
        if summary and budget > 100:
            summary_tokens = self._estimate_tokens(summary)
            allowed = min(1000, budget)
            if summary_tokens <= allowed:
                parts.append(f"Conversation summary:\n{summary}")
                budget -= summary_tokens
            else:
                # Truncate summary to fit
                truncated = summary[:int(allowed / TOKENS_PER_CHAR)]
                parts.append(f"Conversation summary:\n{truncated}...")
                budget -= allowed

        # 4. Recent turns (remaining budget)
        if budget > 100:
            history = self._store.get_history(session_id, limit=10)
            if history:
                turns_text = self._format_messages(history)
                turns_tokens = self._estimate_tokens(turns_text)
                if turns_tokens <= budget:
                    parts.append(f"Recent conversation:\n{turns_text}")
                else:
                    # Take as many recent turns as fit
                    for i in range(len(history), 0, -1):
                        subset = self._format_messages(history[-i:])
                        if self._estimate_tokens(subset) <= budget:
                            parts.append(f"Recent conversation:\n{subset}")
                            break

        if not parts:
            return ""

        return "\n\n".join(parts)

    @staticmethod
    def _format_messages(messages: list[dict]) -> str:
        lines = []
        for m in messages:
            role = m.get("role", "unknown")
            content = m.get("content", "")
            if content:
                lines.append(f"[{role}]: {content}")
        return "\n".join(lines)

    @staticmethod
    def _format_preferences(prefs: list[dict]) -> str:
        return "\n".join(f"- {p['category']}/{p['key']}: {p['value']}" for p in prefs)

    @staticmethod
    def _format_extraction(extraction: dict) -> str:
        parts = []
        if extraction.get("timestamp"):
            parts.append(f"Date: {extraction['timestamp']}")
        if extraction.get("file_count"):
            parts.append(f"Files: {extraction['file_count']}")
        if extraction.get("summary"):
            parts.append(f"Result: {extraction['summary']}")
        return ", ".join(parts)

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        return int(len(text) * TOKENS_PER_CHAR)
