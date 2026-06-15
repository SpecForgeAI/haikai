# Requirements: Chat Session Memory

## Functional Requirements

### FR-1: Persistent Session Storage
- Sessions persisted to SQLite (WAL mode) at `{project_dir}/.chat-memory/sessions.db`
- Sessions, messages, summaries, preferences, extractions tables
- Implements same interface as existing `SessionStore`
- Factory function: `create_session_store(persistent: bool)`

### FR-2: Conversation Summarization
- Auto-summarize when conversation exceeds threshold (default: 20 turns)
- Summary captures: key decisions, user preferences, extraction requests, outcomes
- Incremental: new summary builds on previous + new turns
- Stored in `summaries` table linked to message range

### FR-3: User Preference Learning
- Detect preference signals in user messages (explicit + corrections)
- Categories: naming, filtering, output, extraction
- Inject as bullet list in LLM system prompt
- Most recent preference wins on conflict

### FR-4: Extraction Memory
- Link extraction results to chat sessions
- Store: session_id, config_hash, file_count, output_path, summary
- Cross-reference: which conversations led to which standards docs

### FR-5: Context Injection
- Priority order within token budget: preferences → last extraction → summary → recent turns
- Configurable budget (default: 2000 tokens)
- Graceful degradation: truncate lower-priority items

### FR-6: API Endpoints
- List sessions, view history, resume session, delete session, view preferences
- Resume endpoint loads context and injects into system prompt

### FR-7: Chat Tools
- `recall_previous(query)` — search past conversations
- `get_extraction_history(since)` — retrieve past results
- `set_preference(key, value)` — explicitly set preference

## Non-Functional Requirements

### NFR-1: Performance
- Session resume < 500ms (context loading + injection)
- Message persistence < 50ms per turn
- Summary generation < 10s (LLM call)

### NFR-2: Storage
- WAL mode for concurrent access
- TTL: 30 days default, configurable
- Max 100 sessions per project default

### NFR-3: Reliability
- Graceful cold start if session not found
- Retry on DB lock with backoff
- Corrupt DB detection → backup + fresh DB

### NFR-4: Privacy
- Session data scoped to project/company
- Hard delete removes all associated data
- No cross-project data leakage
