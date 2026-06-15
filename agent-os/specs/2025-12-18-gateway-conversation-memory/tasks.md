# Task Breakdown: Gateway Conversation Memory

## Overview
Total Tasks: 18

This spec addresses the "LLM has no conversation history" issue by persisting full multi-turn conversation state in GatewaySession and replaying that state to OpenAI on every turn.

## Task List

### Session Layer

#### Task Group 1: Session Type and Store Updates
**Dependencies:** None

- [x] 1.0 Complete session layer updates
  - [x] 1.1 Write 3-4 focused tests for session conversation field
    - Test that new sessions are created with empty conversation array
    - Test that existing sessions without conversation field are handled (treated as empty array)
    - Test that conversation field can be updated via SessionUpdate
    - Test session serialization/deserialization with conversation data
  - [x] 1.2 Add conversation field to GatewaySession interface
    - File: `gateway/src/types/session.ts`
    - Add `conversation?: OpenAIMessage[]` to GatewaySession interface (line ~35)
    - Import OpenAIMessage type from services/openaiClient or define locally
    - Conversation excludes system prompt (rebuilt fresh per-request)
    - Conversation includes: user messages, assistant messages (with tool_calls), and tool result messages
  - [x] 1.3 Update SessionUpdate type to support conversation updates
    - File: `gateway/src/types/session.ts`
    - Verify existing `Partial<Omit<GatewaySession, 'sessionId' | 'createdAt'>>` pattern covers conversation field
  - [x] 1.4 Initialize conversation array in getOrCreateSession()
    - File: `gateway/src/services/sessionStore.ts`
    - Update session creation (lines 157-163) to include `conversation: []`
    - Ensure backward compatibility: treat undefined conversation as empty array
  - [x] 1.5 Ensure session layer tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify session creation includes conversation field
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- GatewaySession interface includes optional conversation field
- New sessions are created with empty conversation array
- Existing sessions without conversation field continue to work

---

### Conversation Service Layer

#### Task Group 2: Conversation Helper Service
**Dependencies:** Task Group 1

- [x] 2.0 Complete conversation service
  - [x] 2.1 Write 6-8 focused tests for conversation helper functions
    - Test buildMessagesForTurn returns [system, ...conversation, user]
    - Test buildMessagesForTurn with empty conversation
    - Test buildMessagesForTurn with multi-turn conversation
    - Test persistConversation filters out system prompt
    - Test truncateConversation removes oldest messages first (FIFO)
    - Test truncateConversation respects message count limit
    - Test truncateConversation respects byte size limit
    - Test calculateConversationBytes sums content byte sizes correctly
  - [x] 2.2 Create conversation.ts service file
    - File: `gateway/src/services/conversation.ts`
    - Import dependencies: OpenAIMessage, GatewaySession, updateSession, getConfig, logger
  - [x] 2.3 Implement calculateConversationBytes function
    - Signature: `calculateConversationBytes(conversation: OpenAIMessage[]): number`
    - Sum `Buffer.byteLength(message.content, 'utf8')` for all messages
    - Handle messages with empty or undefined content
  - [x] 2.4 Implement truncateConversation function
    - Signature: `truncateConversation(conversation: OpenAIMessage[]): OpenAIMessage[]`
    - Get limits from config: maxConversationMessages, maxConversationBytes
    - Check message count limit first, remove oldest messages (FIFO)
    - Then check byte size limit, continue removing oldest until under limit
    - Return truncated conversation array (do not mutate input)
  - [x] 2.5 Implement buildMessagesForTurn function
    - Signature: `buildMessagesForTurn(session: GatewaySession, systemPrompt: string, userMessage: string): OpenAIMessage[]`
    - Return: `[{ role: 'system', content: systemPrompt }, ...session.conversation, { role: 'user', content: userMessage }]`
    - Handle undefined conversation as empty array
  - [x] 2.6 Implement persistConversation function
    - Signature: `persistConversation(sessionId: string, messages: OpenAIMessage[]): void`
    - Filter out system prompt (remove messages where role === 'system')
    - Apply truncateConversation to enforce limits
    - Call updateSession with truncated conversation
    - Add debug logging for conversation size metrics
  - [x] 2.7 Ensure conversation service tests pass
    - Run ONLY the 6-8 tests written in 2.1
    - Verify all helper functions work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6-8 tests written in 2.1 pass
- buildMessagesForTurn correctly constructs message array with history
- persistConversation filters system prompts and truncates conversation
- Truncation follows FIFO order and respects both limits
- calculateConversationBytes accurately measures conversation size

---

### Configuration Layer

#### Task Group 3: Config Updates
**Dependencies:** None (can be done in parallel with Task Groups 1-2)

- [x] 3.0 Complete configuration updates
  - [x] 3.1 Write 2-3 focused tests for new config fields
    - Test maxConversationMessages defaults to 80 when env var not set
    - Test maxConversationBytes defaults to 200000 when env var not set
    - Test config fields are parsed correctly from environment variables
  - [x] 3.2 Add conversation memory config fields to Config interface
    - File: `gateway/src/config.ts`
    - Add `maxConversationMessages: number` to Config interface (around line 30)
    - Add `maxConversationBytes: number` to Config interface
  - [x] 3.3 Parse conversation config in loadConfig()
    - File: `gateway/src/config.ts`
    - Add: `maxConversationMessages: parseIntEnv(process.env.MAX_CONVERSATION_MESSAGES, 80)`
    - Add: `maxConversationBytes: parseIntEnv(process.env.MAX_CONVERSATION_BYTES, 200000)`
    - Place in Session Management section (after sessionTtlHours, around line 118)
  - [x] 3.4 Ensure config tests pass
    - Run ONLY the 2-3 tests written in 3.1
    - Verify default values are correct
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-3 tests written in 3.1 pass
- Config interface includes maxConversationMessages and maxConversationBytes
- Environment variables are parsed with correct defaults

---

### Service Exports Layer

#### Task Group 4: Service Exports Update
**Dependencies:** Task Group 2

- [x] 4.0 Complete service exports
  - [x] 4.1 Export conversation helpers from services/index.ts
    - File: `gateway/src/services/index.ts`
    - Add export: `export { buildMessagesForTurn, persistConversation } from './conversation';`
    - Keep truncateConversation and calculateConversationBytes internal (not exported)
  - [x] 4.2 Verify imports compile without errors
    - Ensure circular dependency issues are avoided
    - Verify chat.ts can import from services/index.ts

**Acceptance Criteria:**
- buildMessagesForTurn and persistConversation are exported
- No circular dependency issues
- Imports compile successfully

---

### Integration Layer

#### Task Group 5: Chat Routes Integration
**Dependencies:** Task Groups 1, 2, 3, 4

- [x] 5.0 Complete chat routes integration
  - [x] 5.1 Write 4-6 focused tests for conversation memory in chat routes
    - Test POST /api/chat persists conversation after successful response
    - Test POST /api/chat replays prior conversation history to OpenAI
    - Test GET /api/chat/stream persists conversation after streaming completes
    - Test GET /api/chat/stream replays prior conversation history
    - Test tool call messages are included in persisted conversation
    - Test multi-turn conversation maintains context across requests
  - [x] 5.2 Update POST /api/chat to use buildMessagesForTurn
    - File: `gateway/src/routes/chat.ts`
    - Import buildMessagesForTurn, persistConversation from services
    - Replace lines 77-80 static message construction:
      ```typescript
      const messages = buildMessagesForTurn(session, systemPrompt, message);
      ```
    - Add debug logging: `priorConversationCount: session.conversation?.length || 0`
  - [x] 5.3 Update POST /api/chat to persist conversation
    - After agent loop completes and final response received:
      - Append final assistant response to messages array:
        ```typescript
        messages.push({ role: 'assistant', content: response.content || '' });
        ```
      - Call `persistConversation(effectiveSessionId, messages)` before returning response
    - Add debug logging: `messagesSentCount: messages.length`
  - [x] 5.4 Update GET /api/chat/stream to use buildMessagesForTurn
    - File: `gateway/src/routes/chat.ts`
    - Replace lines 249-252 static message construction:
      ```typescript
      const messages = buildMessagesForTurn(session, systemPrompt, message);
      ```
    - Add debug logging for prior conversation count
  - [x] 5.5 Update GET /api/chat/stream to persist conversation
    - After streaming completes (before res.end()):
      - Append fullMessage as assistant content to messages:
        ```typescript
        messages.push({ role: 'assistant', content: fullMessage });
        ```
      - Ensure tool call messages accumulated during streaming are in messages array
      - Call `persistConversation(effectiveSessionId, messages)` before res.end()
  - [x] 5.6 Ensure chat routes integration tests pass
    - Run ONLY the 4-6 tests written in 5.1
    - Verify conversation persistence works for both endpoints
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 5.1 pass
- Both POST /api/chat and GET /api/chat/stream replay conversation history
- Both endpoints persist updated conversation after completion
- Tool calls and results are included in conversation history

---

### Verification Layer

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 3-4 tests written by Task Group 1 (session layer)
    - Review the 6-8 tests written by Task Group 2 (conversation service)
    - Review the 2-3 tests written by Task Group 3 (config)
    - Review the 4-6 tests written by Task Group 5 (chat routes)
    - Total existing tests: approximately 15-21 tests
  - [x] 6.2 Analyze test coverage gaps for conversation memory feature
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Prioritize end-to-end conversation flows
  - [x] 6.3 Write up to 5 additional strategic tests maximum
    - Add maximum of 5 new tests to fill identified critical gaps
    - Focus on edge cases:
      - Empty conversation handling
      - Maximum conversation size boundary conditions
      - Concurrent session updates
      - Error recovery (persist fails gracefully)
    - Do NOT write exhaustive coverage for all scenarios
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to conversation memory feature
    - Expected total: approximately 20-26 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical conversation memory workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-26 tests total)
- Critical conversation memory user workflows are covered
- No more than 5 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 3: Config Updates** (no dependencies, quick wins)
2. **Task Group 1: Session Type and Store Updates** (no dependencies)
3. **Task Group 2: Conversation Helper Service** (depends on Task Group 1)
4. **Task Group 4: Service Exports Update** (depends on Task Group 2)
5. **Task Group 5: Chat Routes Integration** (depends on all above)
6. **Task Group 6: Test Review and Gap Analysis** (final verification)

Note: Task Groups 1 and 3 can be executed in parallel as they have no mutual dependencies.

---

## Files Modified Summary

| File | Change Type | Task Group |
|------|-------------|------------|
| `gateway/src/types/session.ts` | Modify | 1 |
| `gateway/src/services/sessionStore.ts` | Modify | 1 |
| `gateway/src/config.ts` | Modify | 3 |
| `gateway/src/services/conversation.ts` | **NEW** | 2 |
| `gateway/src/services/index.ts` | Modify | 4 |
| `gateway/src/routes/chat.ts` | Modify | 5 |

---

## Key Implementation Notes

1. **OpenAIMessage Type Reuse**: The existing `OpenAIMessage` interface in `gateway/src/services/openaiClient.ts` (lines 38-50) supports all required message types including tool_calls and tool_call_id.

2. **Backward Compatibility**: Existing sessions without the conversation field should continue to work - treat undefined as empty array throughout.

3. **System Prompt Exclusion**: The conversation array EXCLUDES system prompts since they are rebuilt fresh per-request via buildSystemPrompt.

4. **Truncation Strategy**: FIFO (oldest messages removed first), with message count checked before byte size.

5. **Logging Pattern**: Follow existing logger.debug() pattern from `gateway/src/services/logger.ts` for diagnostic logging.
