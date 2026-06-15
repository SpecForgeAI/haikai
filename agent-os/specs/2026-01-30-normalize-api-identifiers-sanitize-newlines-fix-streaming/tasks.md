# Task Breakdown: Normalize API Identifiers, Sanitize Newlines, Fix Streaming

## Overview
Total Tasks: 4 Task Groups with 22 Sub-tasks

## Task List

### Utility Layer

#### Task Group 1: Identifier Normalization Utility
**Dependencies:** None

- [x] 1.0 Complete identifier normalization utility
  - [x] 1.1 Write 4-6 focused tests for normalizeIdentifier function
    - Test basic normalization: "  Rivvy   Studios  " -> "rivvy-studios"
    - Test lowercase conversion: "MyCompany" -> "mycompany"
    - Test edge case: empty string returns empty string
    - Test edge case: null/undefined returns empty string
    - Test single word with extra spaces: "  Project  " -> "project"
    - Test already normalized input: "my-project" -> "my-project"
  - [x] 1.2 Create `src/utils/normalizeIdentifier.ts`
    - Export function `normalizeIdentifier(input: string): string`
    - Algorithm: (1) handle null/undefined -> empty string, (2) trim, (3) toLowerCase, (4) replace /\s+/g with single hyphen
    - Follow pattern from existing `src/utils/sanitize.ts`
  - [x] 1.3 Ensure normalizeIdentifier tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all edge cases handled correctly

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Function correctly normalizes "  Rivvy   Studios  " to "rivvy-studios"
- Empty/null/undefined inputs return empty string
- Single consecutive hyphens replace whitespace runs

---

### API Integration Layer

#### Task Group 2: Apply Normalization and Sanitization to API Calls
**Dependencies:** Task Group 1

- [x] 2.0 Complete API normalization and sanitization integration
  - [x] 2.1 Write 4-6 focused tests for API normalization points
    - Test orchestrationApi.ts normalizes company before request
    - Test orchestrationApi.ts normalizes project before request
    - Test useShapeSpecStream.ts normalizes company in startStream
    - Test useShapeSpecStream.ts normalizes project in startStream
    - Test shapeSpecApi.ts normalizes identifiers if applicable
  - [x] 2.2 Apply normalizeIdentifier in `orchestrationApi.ts`
    - Import normalizeIdentifier from `src/utils/normalizeIdentifier.ts`
    - Call on company field before building request payload in `startOrchestration()`
    - Call on project field before building request payload in `startOrchestration()`
  - [x] 2.3 Apply normalizeIdentifier in `useShapeSpecStream.ts`
    - Import normalizeIdentifier
    - Apply to company before building request body in `startStream()`
    - Apply to project before building request body in `startStream()`
  - [x] 2.4 Apply normalizeIdentifier in `shapeSpecApi.ts` (if applicable)
    - Review file for any direct API calls using company/project
    - Apply normalization where needed
  - [x] 2.5 Implement spec intent newline sanitization
    - Create sanitization logic: replace /[\r\n]+/g with space, collapse /\s+/g to single space, trim
    - Apply in `ImplementationAssistantPanel.tsx` after `composeSpecIntent()` returns
    - Apply immediately before `startStream()` call
    - Ensure final outbound message is newline-free
  - [x] 2.6 Ensure API integration tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify normalization applied at all integration points

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- All /api/v1 requests send normalized company/project identifiers
- Spec intent message is single-line with no newlines before API call

---

### Chat Message Layer

#### Task Group 3: ChatMessage Persona and Streaming Delta Handling
**Dependencies:** None (can run in parallel with Task Groups 1-2)

- [x] 3.0 Complete ChatMessage persona and streaming changes
  - [x] 3.1 Write 5-8 focused tests for ChatMessage and streaming behavior
    - Test ChatMessage interface accepts optional persona field
    - Test persona set to 'Software Architect' on streamed message creation
    - Test each content delta creates new ChatMessage with unique id
    - Test empty delta content does not create ChatMessage
    - Test whitespace-only delta does not create ChatMessage
    - Test message content equals delta only (no accumulation)
    - Test message ordering preserved from stream
  - [x] 3.2 Extend ChatMessage interface in `chatApi.ts`
    - Add optional field: `persona?: 'Product Owner' | 'Software Architect'`
    - No changes to existing fields (id, role, content, timestamp)
  - [x] 3.3 Update streaming message creation in `useShapeSpecStream.ts`
    - Import `generatePrefixedId` from `src/utils/idGenerator.ts`
    - In onContent callback: check if delta is empty/whitespace-only -> skip
    - Create NEW ChatMessage for each non-empty delta:
      - id: generatePrefixedId('stream-msg')
      - role: 'assistant'
      - content: delta content only
      - timestamp: current time
      - persona: 'Software Architect'
    - Remove any accumulation logic (streamedContentRef pattern)
  - [x] 3.4 Update ChatMessageList/ChatBubble to use stored persona
    - Check for message.persona when rendering
    - Use stored persona if available instead of deriving from phase
    - Fallback to existing behavior for messages without persona
  - [x] 3.5 Ensure ChatMessage and streaming tests pass
    - Run ONLY the 5-8 tests written in 3.1
    - Verify persona is stable after message creation
    - Verify each delta creates separate bubble

**Acceptance Criteria:**
- The 5-8 tests written in 3.1 pass
- ChatMessage interface includes optional persona field
- Streamed messages always show "Software Architect"
- Each content delta creates a separate chat bubble
- Empty/whitespace deltas do not create bubbles
- Message content is delta-only, not accumulated

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 tests written for normalizeIdentifier (Task 1.1)
    - Review the 4-6 tests written for API integration (Task 2.1)
    - Review the 5-8 tests written for ChatMessage/streaming (Task 3.1)
    - Total existing tests: approximately 13-20 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify any critical workflows lacking test coverage
    - Focus ONLY on gaps related to this spec's requirements
    - Prioritize integration between normalization -> API call -> streaming response
  - [x] 4.3 Write up to 5 additional integration tests if needed
    - Add maximum of 5 new tests to fill identified critical gaps
    - Focus on end-to-end flow: normalized identifiers + sanitized message -> stream -> individual bubbles
    - Example: Full flow test from ImplementationAssistantPanel through to ChatMessage creation
    - Do NOT write exhaustive edge case coverage
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 18-25 tests maximum
    - Verify critical workflows pass
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-25 tests total)
- Critical user workflows for this feature are covered
- No more than 5 additional tests added when filling gaps
- Testing focused exclusively on this spec's requirements

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1 (Utility) ──────────────────┐
                                         ├──> Task Group 4 (Testing)
Task Group 3 (ChatMessage/Streaming) ────┤
                                         │
Task Group 2 (API Integration) ──────────┘
        │
        └── Depends on Task Group 1 for normalizeIdentifier
```

**Parallel Execution Opportunities:**
- Task Groups 1 and 3 can be executed in parallel (no dependencies)
- Task Group 2 must wait for Task Group 1 (needs normalizeIdentifier utility)
- Task Group 4 must wait for all other groups to complete

**Suggested Order:**
1. **Phase 1** (Parallel):
   - Task Group 1: Identifier Normalization Utility
   - Task Group 3: ChatMessage Persona and Streaming Delta Handling
2. **Phase 2**:
   - Task Group 2: Apply Normalization and Sanitization to API Calls
3. **Phase 3**:
   - Task Group 4: Test Review and Gap Analysis

---

## Files to Create/Modify

### New Files
- `src/utils/normalizeIdentifier.ts` - Identifier normalization utility
- `src/utils/sanitizeSpecIntent.ts` - Spec intent newline sanitization utility (Task 2.5)
- `src/__tests__/apiNormalization.test.ts` - API normalization integration tests (Task 2.1)
- `src/utils/sanitizeSpecIntent.test.ts` - Sanitization unit tests (Task 2.5)

### Modified Files
- `src/api/chatApi.ts` - Add persona field to ChatMessage interface
- `src/api/orchestrationApi.ts` - Apply normalizeIdentifier to company/project
- `src/api/shapeSpecApi.ts` - Apply normalizeIdentifier to company/project
- `src/hooks/useShapeSpecStream.ts` - Apply normalization, update streaming to create individual messages
- `src/components/ProductView/ImplementationAssistantPanel.tsx` - Apply newline sanitization to spec intent
- `src/components/ChatMessageList.tsx` or `ChatBubble.tsx` - Use stored persona for rendering

### Reference Files (read-only)
- `src/utils/sanitize.ts` - Pattern reference for utility functions
- `src/utils/idGenerator.ts` - Use generatePrefixedId for message IDs
