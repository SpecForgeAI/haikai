# Tasks: Chat Session Memory

## Phase 1: Storage Layer

- [x] T1.1: `PersistentSessionStore` with SQLite backend (`src/chat/persistent_store.py`)
- [x] T1.2: Schema: sessions, messages, summaries, preferences, extractions tables + indexes
- [x] T1.3: Session CRUD: create, get, get_active, list, archive, delete (cascade)
- [x] T1.4: Messages: save_message, get_history (limit), get_message_count
- [x] T1.5: WAL mode, timeout=10, corrupt DB detection + recovery
- [x] T1.6: Factory: `create_session_store(persistent=True)` via `CHAT_PERSISTENT_MEMORY`
- [x] T1.7: 23 unit tests (CRUD, messages, summaries, preferences, extractions, resilience)

## Phase 2: Context Management

- [x] T2.1: `ConversationSummarizer` (`src/chat/conversation_summarizer.py`)
- [x] T2.2: LLM summarization with extractive fallback
- [x] T2.3: Incremental: builds on previous summary + new turns
- [x] T2.4: `get_context()` — priority-ordered within token budget
- [x] T2.5: Priority: preferences → extraction → summary → recent turns
- [x] T2.6: 12 tests (threshold, LLM, fallback, budget, priority)

## Phase 3: Preference Learning

- [x] T3.1: Preferences in persistent store (upsert on conflict)
- [x] T3.2: Categories: naming, filtering, output, general
- [x] T3.3: Regex detection in `ChatMemoryMiddleware`
- [x] T3.4: Injected via `get_context()` as bullet list
- [x] T3.5: Tested (4 detection + false positive)

## Phase 4: Extraction Memory

- [x] T4.1: save_extraction, get_extractions, get_latest_extraction
- [x] T4.2: Included in context injection
- [x] T4.3: Tested in store + middleware tests

## Phase 5: Chat Executor Integration

- [x] T5.1: `ChatMemoryMiddleware` (`src/chat/memory_middleware.py`)
- [x] T5.2: on_session_start, on_user_message, on_assistant_message, on_extraction_complete
- [x] T5.3: Context injection returns text for system prompt
- [x] T5.4: 13 middleware tests
- [ ] T5.5: Wire into api.py chat endpoints (deferred — requires careful integration with existing SSE flow)

## Phase 6: API Endpoints

- [x] T6.1: GET /api/v1/chat/sessions
- [x] T6.2: GET /api/v1/chat/sessions/{id}/history
- [x] T6.3: POST /api/v1/chat/sessions/resume
- [x] T6.4: DELETE /api/v1/chat/sessions/{id}
- [x] T6.5: GET /api/v1/chat/sessions/{id}/preferences
- [x] T6.6: POST /api/v1/chat/preferences
- [x] T6.7: GET /api/v1/chat/extractions
- [ ] T6.8: Register router in api.py
- [ ] T6.9: Endpoint integration tests

## Phase 7: Config

- [x] T7.1: CHAT_PERSISTENT_MEMORY, CHAT_SUMMARY_THRESHOLD, CHAT_CONTEXT_BUDGET_TOKENS

## Summary

34/38 tasks complete. 48 tests passing.
Deferred: api.py wiring (T5.5, T6.8-6.9), docs (T7.2-7.3)
