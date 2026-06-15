# Specification: Gateway Conversation Memory

## Goal
Fix the "LLM has no conversation history" issue by persisting full multi-turn conversation state (including tool calls and results) in GatewaySession and replaying that state to OpenAI on every turn.

## User Stories
- As an API designer, I want the assistant to remember my prior answers (server name, security scheme, version) so that I am not asked the same questions repeatedly within a session
- As an API designer, I want tool outputs from prior turns (interface lists, OAS context, computed gaps) to be available to the assistant so that it does not re-run tools unnecessarily

## Specific Requirements

**Extend GatewaySession with conversation array**
- Add `conversation: OpenAIMessage[]` field to the `GatewaySession` interface in `gateway/src/types/session.ts`
- Conversation array EXCLUDES the system prompt (rebuilt fresh per-request from buildSystemPrompt)
- Conversation INCLUDES: user messages, assistant messages (including those with tool_calls), and tool result messages
- Update `SessionUpdate` type to allow partial updates including conversation

**Initialize conversation for new sessions**
- Update `getOrCreateSession()` in `gateway/src/services/sessionStore.ts` to initialize `conversation: []` when creating new sessions
- Ensure existing sessions without conversation field continue to work (treat undefined as empty array)

**Create conversation helper service**
- Create new file `gateway/src/services/conversation.ts` with helper functions
- `buildMessagesForTurn(session, systemPrompt, userMessage)`: returns `[system, ...session.conversation, user]`
- `persistConversation(sessionId, messages)`: filters out system prompt, truncates, and calls updateSession
- `truncateConversation(conversation)`: enforces message count and byte size limits by removing oldest messages first
- `calculateConversationBytes(conversation)`: sums Buffer.byteLength of all message content fields

**Add conversation memory config knobs**
- Add `maxConversationMessages: number` to Config interface (env: `MAX_CONVERSATION_MESSAGES`, default: 80)
- Add `maxConversationBytes: number` to Config interface (env: `MAX_CONVERSATION_BYTES`, default: 200000)
- Parse these in `loadConfig()` using existing `parseIntEnv` helper

**Update POST /api/chat to replay and persist history**
- Replace static message construction (lines 77-80) with call to `buildMessagesForTurn(session, systemPrompt, message)`
- After the tool loop completes and final response is received, append the assistant response to messages array
- Call `persistConversation(effectiveSessionId, messages)` before returning response
- Add debug logging: `priorConversationCount`, `messagesSentCount` for diagnostics

**Update GET /api/chat/stream to replay and persist history**
- Replace static message construction (lines 249-252) with call to `buildMessagesForTurn(session, systemPrompt, message)`
- After streaming completes, append `fullMessage` as assistant content to messages array
- Call `persistConversation(effectiveSessionId, messages)` before calling `res.end()`
- Ensure tool call messages accumulated during streaming are also persisted

**Export conversation helpers from services/index.ts**
- Export `buildMessagesForTurn` and `persistConversation` from `gateway/src/services/index.ts`
- These are the only functions needed by chat.ts; keep truncation internal

**Conversation truncation behavior**
- Truncation removes oldest messages first (FIFO) to stay within limits
- Message count limit checked first, then byte size limit
- Truncation happens in-place on the conversation array before persisting

## Existing Code to Leverage

**GatewaySession interface (gateway/src/types/session.ts)**
- Existing session type with sessionId, mcpSessionId, filename, interfaceId, lastDraftOas, lastSavedSpecSummary
- SessionUpdate type already supports partial updates via Omit pattern
- Add conversation field following same pattern as existing optional fields

**sessionStore.ts getOrCreateSession and updateSession functions**
- getOrCreateSession() at lines 154-169 creates new sessions with initial fields
- updateSession() at lines 178-196 merges partial updates and refreshes lastActivity
- Conversation field will be persisted via existing updateSession mechanism

**OpenAIMessage type (gateway/src/services/openaiClient.ts)**
- Existing type at lines 38-50 supports role, content, tool_call_id, and tool_calls
- buildToolResultMessages() already constructs proper message format for tool results
- Reuse this type for conversation array storage

**Config pattern (gateway/src/config.ts)**
- parseIntEnv helper at lines 71-75 for parsing integer env vars with defaults
- Config interface pattern at lines 9-40 for adding new configuration fields
- getConfig() singleton pattern for accessing configuration

**Logger service (gateway/src/services/logger.ts)**
- Existing logger.debug() for diagnostic logging
- logRequestStart/logRequestEnd for request lifecycle logging
- Use same logging patterns for conversation memory diagnostics

## Out of Scope
- Migrating to OpenAI "Responses + conversation=conv_..." state management API
- Changing MCP server or backend model endpoints
- UI/frontend changes beyond existing chat panel
- Session persistence to database or Redis (remains in-memory only)
- Conversation history visible to user in UI
- Manual conversation clear/reset endpoint
- Per-message token counting or token-based truncation
- Compression of stored conversation content
- Encryption of stored conversation content
- Cross-session conversation sharing or forking
