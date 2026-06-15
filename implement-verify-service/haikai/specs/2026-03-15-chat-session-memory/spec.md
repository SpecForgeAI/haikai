# Specification: Claude Chat Session Memory Skill

## Summary

Add persistent memory to the conversational chat API. Conversations, extraction results, and user preferences are stored in SQLite and carried forward across sessions. Returning users get context-aware interactions without re-explaining their project, preferences, or prior extraction results. Long conversations are automatically summarized to fit within LLM context windows while preserving essential context.

---

## Current Flow

```
1. User starts chat session → new empty context
2. session_store.py → in-memory dict, keyed by session_id
3. User converses, refines extractions iteratively
4. Session ends → all context lost
5. User returns → starts from zero, re-explains everything
```

### Current flow issues

- Every session starts cold — no memory of previous interactions
- Users must re-explain project context, preferences, and prior decisions
- Previous extraction results not accessible in new sessions
- Iterative refinement resets between sessions
- No learning from user corrections ("I prefer X over Y")

---

## Proposed Flow

```
1. User starts chat session
   ├─ POST /chat/sessions/{id}/resume → loads previous context
   ├─ persistent_store.py → retrieves conversation summary
   ├─ preference_store.py → retrieves user preferences
   └─ extraction_memory.py → retrieves relevant past results
2. Context injected into LLM system prompt:
   "Previous conversation summary: ...
    User preferences: camelCase, skip test files, verbose output
    Last extraction: 2026-03-14, 47 files, 12 standards sections"
3. User converses with full historical context
4. Session ends → conversation persisted, summarized, preferences updated
5. User returns → seamless continuation
```

---

## Code Changes

### 1. New: `src/chat/persistent_store.py`

SQLite-backed persistent session storage.

- `PersistentSessionStore` class implementing same interface as `SessionStore`
- SQLite database: `{project_dir}/.chat-memory/sessions.db` (WAL mode for concurrency)
- Tables:
  - `sessions`: id, project, company, user_id, created_at, last_active, status (active/archived)
  - `messages`: id, session_id, role, content, tool_calls_json, timestamp
  - `summaries`: id, session_id, summary_text, covers_up_to_message_id, created_at
- Methods:
  - `save_message(session_id, message)` — persist each turn
  - `get_history(session_id, limit)` — retrieve conversation
  - `get_context(session_id, max_tokens)` — summary + recent turns within budget
  - `archive_session(session_id)` — mark inactive, keep data
  - `delete_session(session_id)` — hard delete all data
  - `list_sessions(project, company)` — list with metadata

### 2. New: `src/chat/conversation_summarizer.py`

Automatic conversation summarization.

- `ConversationSummarizer` class using configured LLM
- `summarize(messages: list[Message], max_tokens: int) -> str`
- Triggered when conversation exceeds `CHAT_SUMMARY_THRESHOLD` turns (default: 20)
- Summary captures: key decisions, user preferences expressed, extraction requests, outcomes
- Summary stored in `summaries` table, linked to message range it covers
- Incremental: new summary builds on previous summary + new turns
- Summary prompt optimized for context continuity (not general summarization)

### 3. New: `src/chat/preference_store.py`

User preference learning and storage.

- `PreferenceStore` class backed by SQLite table `preferences`
- Table: session_id, user_id, project, key, value, source_message_id, created_at
- Preference categories:
  - `naming`: camelCase, snake_case, PascalCase preferences
  - `filtering`: file/directory exclusion preferences
  - `output`: verbosity, format, section ordering preferences
  - `extraction`: which strategies to emphasize/skip
- Extraction: chat executor detects preference signals in user messages
  - Explicit: "I prefer X", "always use Y", "skip Z"
  - Correction: "No, use X instead" → overwrite previous preference
- Injection: preferences formatted as bullet list in LLM system prompt

### 4. New: `src/chat/extraction_memory.py`

Link extraction results to chat sessions.

- `ExtractionMemory` class backed by SQLite table `extractions`
- Table: id, session_id, project, timestamp, config_hash, file_count, output_path, summary
- After each extraction triggered from chat, store result reference
- Retrieval: "show me last week's extraction" → query by date range
- Context injection: last extraction summary included in session context
- Cross-reference: which chat conversations led to which standards documents

### 5. Modified: `src/chat/session_store.py`

- Add abstract interface `BaseSessionStore` with `save`, `get`, `delete`, `list` methods
- Current in-memory implementation becomes `InMemorySessionStore`
- Factory function: `create_session_store(persistent: bool)` → returns appropriate implementation
- Controlled by `CHAT_PERSISTENT_MEMORY` env var (default: true)

### 6. Modified: `src/chat/claude_chat_executor.py` and `openai_chat_executor.py`

- On session start: load context from `PersistentSessionStore.get_context()`
- Inject historical context into system prompt (within token budget)
- After each turn: persist message via `save_message()`
- Detect preference signals in user messages → update `PreferenceStore`
- After extraction: store result in `ExtractionMemory`

### 7. Modified: `src/chat/tool_executor.py`

- New tool: `recall_previous(query: str)` — search past conversations semantically
- New tool: `get_extraction_history(since: str)` — retrieve past extraction results
- New tool: `set_preference(key: str, value: str)` — explicitly set user preference
- Tools available to LLM during chat for explicit memory operations

### 8. Modified: `src/api.py`

- `GET /api/v1/chat/sessions?project={}&company={}` — list sessions with metadata
- `GET /api/v1/chat/sessions/{session_id}/history?limit=50` — conversation history
- `POST /api/v1/chat/sessions/{session_id}/resume` — resume with context injection
- `DELETE /api/v1/chat/sessions/{session_id}` — delete session + all associated data
- `GET /api/v1/chat/sessions/{session_id}/preferences` — view extracted preferences

### 9. Config

- `CHAT_PERSISTENT_MEMORY` (default: true)
- `CHAT_SUMMARY_THRESHOLD` (default: 20 turns)
- `CHAT_CONTEXT_BUDGET_TOKENS` (default: 2000)
- `CHAT_SESSION_TTL_DAYS` (default: 30)
- `CHAT_MAX_SESSIONS_PER_PROJECT` (default: 100)

---

## Context Injection Strategy

When resuming a session, context is injected in priority order within the token budget:

```
1. User preferences (highest priority, ~200 tokens)
2. Last extraction summary (~300 tokens)
3. Conversation summary (~500-1000 tokens)
4. Recent turns verbatim (remaining budget)
```

If budget is exhausted, lower-priority items are truncated or omitted.

---

## Database Schema

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    company TEXT NOT NULL,
    user_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'active'  -- active, archived
);

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,  -- user, assistant, system, tool
    content TEXT,
    tool_calls TEXT,  -- JSON
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    summary_text TEXT NOT NULL,
    covers_up_to_message_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    project TEXT NOT NULL,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    source_session_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, project, category, key)
);

CREATE TABLE extractions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    project TEXT NOT NULL,
    company TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    config_hash TEXT,
    file_count INTEGER,
    output_path TEXT,
    summary TEXT
);
```

---

## Error Handling

- SQLite DB locked (concurrent writes) → WAL mode handles most cases; retry with backoff for edge cases
- Summarization LLM call fails → keep full history in context (may truncate), retry summary next turn
- Corrupted DB → detect on open, backup corrupt file, create fresh DB, log error
- Session not found on resume → create new session, no error (graceful cold start)
- Preference conflict (contradictory preferences) → most recent wins, log override
- Storage limit exceeded → archive oldest sessions, warn in response
