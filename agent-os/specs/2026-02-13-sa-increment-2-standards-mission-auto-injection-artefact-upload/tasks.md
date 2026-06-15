# Task Breakdown: SA Increment 2 -- Standards + MISSION Auto-Injection + Artefact Upload

## Overview
Total Tasks: 26 (across 4 task groups)

This increment is entirely backend (gateway) focused. There are no frontend changes needed -- the SolutionArchitectChatPanel already has UploadDocumentsModal wired, sends `sources` in postChatMessage, and passes `projectParentFolder` in context. All work is in the gateway layer: file reading, system prompt injection, short-circuit logic, and persistence stripping.

## Key Dependencies from SA Increment 1

All work in this increment builds on the SA Increment 1 foundation:
- `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` in `gateway/src/services/promptBuilder.ts` (lines 367-442)
- `buildSystemPrompt` SA branch in `gateway/src/services/promptBuilder.ts` (lines 1353-1357)
- SA validation with corrective retry in `gateway/src/routes/chat.ts` (lines 781-881)
- `SolutionArchitectResponse` type in `gateway/src/types/chat.ts` (line 700)
- `createFallbackSolutionArchitectResponse()` in `gateway/src/services/solutionArchitectResponseValidator.ts` (line 196)
- `buildAugmentedMessage` in `gateway/src/routes/chat.ts` (lines 294-320)
- `persistConversation` in `gateway/src/services/conversation.ts` (lines 95-119)

## Task List

### System Prompt Layer

#### Task Group 1: SA Prompt Template Update and buildSystemPrompt Signature Extension
**Dependencies:** None (purely additive changes to existing prompt template and function signature)

- [x] 1.0 Complete system prompt layer changes
  - [x] 1.1 Write 4 focused tests for prompt template and signature extension
    - Test 1: `buildSystemPrompt` with `mode='solution_architect'` and both `missionContent` + `techStackContent` provided returns a prompt containing `=== PRODUCT MISSION ===` header followed by mission content and `=== TECHNICAL STANDARDS ===` header followed by tech-stack content
    - Test 2: `buildSystemPrompt` with `mode='solution_architect'` and only `techStackContent` provided (no mission) omits the `=== PRODUCT MISSION ===` section entirely but still includes `=== TECHNICAL STANDARDS ===`
    - Test 3: `buildSystemPrompt` with `mode='solution_architect'` and both params `undefined` returns the base `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` unchanged (backward compatibility)
    - Test 4: `buildSystemPrompt` for non-SA modes (e.g., `mode='product_manager'` or `mode='implement_feature'`) is unaffected by the new optional parameters (backward compatibility)
  - [x] 1.2 Add CONTEXT ALIGNMENT section to SOLUTION_ARCHITECT_PROMPT_TEMPLATE
    - Add a new `## CONTEXT ALIGNMENT` section after the existing `## RULES - DO NOT VIOLATE` section (after line 442 in `gateway/src/services/promptBuilder.ts`)
    - Content (5-8 lines): instruct the SA that architecture decisions must align with the injected PRODUCT MISSION context, technology choices must align with the injected TECHNICAL STANDARDS context, and the SA must never output or quote mission/standards content to the user -- use only as internal reasoning context
    - Keep the section concise; it is instructional guidance, not a new rule block
  - [x] 1.3 Extend `buildSystemPrompt` signature with two optional string parameters
    - Add `missionContent?: string` and `techStackContent?: string` as the 6th and 7th parameters to `buildSystemPrompt` in `gateway/src/services/promptBuilder.ts` (line 1340)
    - All existing callers pass `undefined` implicitly for these new params (no changes needed to non-SA call sites)
  - [x] 1.4 Implement context injection logic in the SA branch of `buildSystemPrompt`
    - In the SA branch (lines 1355-1356 of `gateway/src/services/promptBuilder.ts`), after returning `SOLUTION_ARCHITECT_PROMPT_TEMPLATE`, build a composite string:
      - Start with `SOLUTION_ARCHITECT_PROMPT_TEMPLATE`
      - If `missionContent` is provided (not undefined/empty), append `\n\n=== PRODUCT MISSION ===\n` followed by the mission content
      - If `techStackContent` is provided (not undefined/empty), append `\n\n=== TECHNICAL STANDARDS ===\n` followed by the tech-stack content
      - Return the composite string
    - If neither parameter is provided, return the bare template (existing behavior preserved)
  - [x] 1.5 Ensure prompt layer tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify backward compatibility for all non-SA callers
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests from 1.1 pass
- SOLUTION_ARCHITECT_PROMPT_TEMPLATE contains the new CONTEXT ALIGNMENT section
- `buildSystemPrompt` signature accepts optional `missionContent` and `techStackContent`
- SA branch appends delimited mission/tech-stack sections when content is provided
- Non-SA modes and SA mode with no content params behave identically to before

---

### Gateway Chat Route Layer

#### Task Group 2: MISSION.MD and TECH-STACK.MD File Loading in chat.ts
**Dependencies:** Task Group 1 (needs the extended `buildSystemPrompt` signature to pass loaded content)

- [x] 2.0 Complete file loading logic in chat route
  - [x] 2.1 Write 5 focused tests for file loading and system prompt wiring
    - Test 1: When both `MISSION.MD` and `TECH-STACK.MD` exist at the expected path, both contents are passed to `buildSystemPrompt` and the system prompt contains both `=== PRODUCT MISSION ===` and `=== TECHNICAL STANDARDS ===` sections
    - Test 2: When `MISSION.MD` (uppercase) does not exist but `mission.md` (lowercase) does, the lowercase file content is loaded and passed as `missionContent`
    - Test 3: When neither `MISSION.MD` nor `mission.md` exists, `missionContent` is `undefined` and the request proceeds without mission content (no error, no halt)
    - Test 4: When file content exceeds 50KB, it is truncated to 50KB before being passed to `buildSystemPrompt`
    - Test 5: When `TECH-STACK.MD` (uppercase) does not exist but `tech-stack.md` (lowercase) does, the lowercase file content is loaded and passed as `techStackContent`
  - [x] 2.2 Create async helper function `loadProjectFile` in chat.ts
    - Signature: `async function loadProjectFile(projectParentFolder: string, relativePath: string, fallbackRelativePath: string, requestId: string): Promise<string | undefined>`
    - Try reading `<projectParentFolder>/<relativePath>` first using `fs.readFile` (the `fs` import `promises as fs` already exists at line 39)
    - If the first read fails (catch), try `<projectParentFolder>/<fallbackRelativePath>`
    - If both fail, return `undefined`
    - If content is read, truncate at 50,000 characters (50KB) to match the existing convention in `buildAugmentedMessage` (line 308/311)
    - Log a debug message indicating which file was loaded (or that neither was found)
    - Follow the error handling pattern from `buildAugmentedMessage` (lines 313-316): try/catch with logger.warn on failure
  - [x] 2.3 Wire file loading into the SA mode path in POST /api/chat handler
    - In the POST /api/chat handler (starting at line 429 of `gateway/src/routes/chat.ts`), before the `systemPrompt = buildSystemPrompt(...)` call (lines 482-486):
      - Detect SA mode: `if (context?.mode === 'solution_architect')`
      - Extract `projectParentFolder` from `context.projectParentFolder`
      - Call `loadProjectFile(projectParentFolder, 'agent-os/product/MISSION.MD', 'agent-os/product/mission.md', requestId)` to get `missionContent`
      - Call `loadProjectFile(projectParentFolder, 'agent-os/product/TECH-STACK.MD', 'agent-os/product/tech-stack.md', requestId)` to get `techStackContent`
    - Both calls can run in parallel with `Promise.all` for efficiency
    - Pass `missionContent` and `techStackContent` to `buildSystemPrompt` as the 6th and 7th arguments
  - [x] 2.4 Add structured logging for file loading results
    - After loading both files, log at `info` level: which files were loaded (mission found/not found, tech-stack found/not found), content sizes, whether truncation was applied
    - Use the existing logging pattern (requestId, sessionId, mode fields)
  - [x] 2.5 Ensure file loading tests pass
    - Run ONLY the 5 tests written in 2.1
    - Verify both casing fallback paths work
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests from 2.1 pass
- MISSION.MD is loaded with uppercase-first, lowercase-fallback casing strategy
- TECH-STACK.MD is loaded with uppercase-first, lowercase-fallback casing strategy
- Content is truncated at 50KB per file
- Missing MISSION.MD does not halt the request
- Loaded content flows through to `buildSystemPrompt` via the new parameters

---

#### Task Group 3: Standards-Missing Short-Circuit and Artefact Persistence Stripping
**Dependencies:** Task Group 2 (needs file loading in place; short-circuit depends on TECH-STACK.MD load result)

- [x] 3.0 Complete short-circuit logic and persistence stripping
  - [x] 3.1 Write 6 focused tests for short-circuit and persistence behavior
    - Test 1: When `techStackContent` is `undefined` (TECH-STACK.MD not found), the gateway returns a deterministic `ChatResponse` with `assistant.message` set to `"Project standards have not been generated. Please generate standards before proceeding."` -- no LLM call is made (verify `sendChatRequest` is NOT called)
    - Test 2: The short-circuit response includes a valid `solutionArchitectResponse` object with `phase: "questions"`, `section: "context_and_boundaries"`, empty `questions` array, and the halt message as `summary` -- so the frontend SA panel renders without error
    - Test 3: The short-circuit still calls `persistConversation` with the user message and the deterministic assistant response, so the halt message appears in rehydrated conversations
    - Test 4: When `techStackContent` IS present (file found), the request proceeds normally through `buildSystemPrompt`, `buildAugmentedMessage`, and `sendChatRequest` -- no short-circuit
    - Test 5: For `solution_architect` mode with `sources` present, the messages array passed to `persistConversation` uses the original `message` (not `augmentedMessage`) for the user turn, while `sendChatRequest` receives the `augmentedMessage`
    - Test 6: For `solution_architect` mode WITHOUT sources, persistence behaves identically to the current behavior (no stripping needed since `augmentedMessage === message` when sources are empty)
  - [x] 3.2 Implement standards-missing short-circuit in POST /api/chat
    - After the file loading code from Task Group 2 (which sets `techStackContent`), and BEFORE the `buildSystemPrompt` call:
      - If `context?.mode === 'solution_architect'` and `techStackContent` is `undefined`:
        - Build a deterministic halt message: `"Project standards have not been generated. Please generate standards before proceeding."`
        - Build a `solutionArchitectResponse` object: `{ phase: 'questions', section: 'context_and_boundaries', questions: [], summary: haltMessage, assumptions: [], openItems: [] }`
        - Build the `messages` array for persistence: system message (can be empty string or a minimal system prompt), the user message (`{ role: 'user', content: message }`), and the assistant response (`{ role: 'assistant', content: haltMessage }`)
        - Call `persistConversation(effectiveSessionId, messages)` so the halt appears in session history
        - Return the `ChatResponse` immediately: `{ sessionId: effectiveSessionId, assistant: { message: haltMessage }, solutionArchitectResponse: shortCircuitResponse }`
        - Log at `info` level that the SA request was short-circuited due to missing standards
        - CRITICAL: This must return before `buildSystemPrompt`, `buildAugmentedMessage`, `sendChatRequest`, and the SA validation block
  - [x] 3.3 Implement artefact content stripping from persistence for SA mode
    - In the POST /api/chat handler, after the assistant response is appended to `messages` (line 626) and before `persistConversation` is called (line 637):
      - If `context?.mode === 'solution_architect'` and `sources` is a non-empty array:
        - Find the last user message in the `messages` array (the one whose content is `augmentedMessage`)
        - Replace its `content` with the original `message` (the un-augmented user text)
        - This ensures `persistConversation` stores only the short user sharing message, not the full artefact text
      - One clean approach: create a `messagesForPersistence` array by mapping over `messages` and replacing the user content at the correct index, then pass `messagesForPersistence` to `persistConversation` instead of `messages`
    - Keep the original `messages` array (with augmented content) intact for the SA validation block (lines 781-881) since the corrective retry needs the full context
  - [x] 3.4 Verify persistence stripping does not affect the SA validation/corrective retry
    - The SA validation block at lines 781-881 uses the `messages` array for corrective retry (line 828-832)
    - The stripping must happen AFTER the SA validation block finishes and BEFORE `persistConversation` is called
    - Alternatively, the stripping creates a separate `messagesForPersistence` array so `messages` is never mutated
    - Review the ordering: line 626 (append assistant), lines 781-881 (SA validation may append more messages for retry), line 637 (persist) -- the stripping insertion point must account for this
    - IMPORTANT: If corrective retry occurs, it appends additional messages to `messages` (lines 828-829). The persistence stripping must still find and replace the original user message content even after retry messages are appended. Using a separate `messagesForPersistence` array built from `messages` after all validation is complete is the safest approach.
  - [x] 3.5 Ensure short-circuit and persistence tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify the short-circuit returns the correct deterministic response
    - Verify persistence stripping works for SA mode with sources
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests from 3.1 pass
- When TECH-STACK.MD is missing, a deterministic halt response is returned with no LLM call
- The halt response includes a well-formed `solutionArchitectResponse` for frontend rendering
- The halt message is persisted to conversation history for session rehydration
- When sources are present in SA mode, persisted conversations contain only the original user message (not augmented artefact content)
- SA validation corrective retry flow is unaffected by persistence stripping
- The `sendChatRequest` call receives the full augmented message for OpenAI reasoning

---

### Test Review

#### Task Group 4: Test Review and Critical Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4 tests written in Task Group 1 (prompt template + signature)
    - Review the 5 tests written in Task Group 2 (file loading + wiring)
    - Review the 6 tests written in Task Group 3 (short-circuit + persistence stripping)
    - Total existing tests: 15 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Key workflows to check coverage for:
      - Full happy path: SA mode with both files present, sources provided, content injected, artefact stripped from persistence
      - Short-circuit followed by normal request in same session (conversation rehydration includes halt message)
      - Edge case: `projectParentFolder` is missing or empty in context
      - Edge case: File read permission error (should gracefully handle, not crash)
  - [x] 4.3 Write up to 6 additional strategic tests maximum
    - Add maximum of 6 new tests to fill identified critical gaps
    - Suggested gap-fill tests:
      - Integration test: Full SA request cycle with mocked file system -- mission and tech-stack loaded, injected into system prompt, LLM called, response validated, persistence uses original message
      - Integration test: Short-circuit path persists conversation correctly and next request in same session includes the halt message in conversation history
      - Edge case: `context.projectParentFolder` is undefined -- file loading is skipped gracefully, tech-stack counts as "not found", short-circuit fires
      - Edge case: File read throws a non-ENOENT error (permission denied) -- should be treated as "file not found" for graceful degradation
      - Test: CONTEXT ALIGNMENT section text is present in the prompt when SA mode is used with content injection
      - Test: The `solutionArchitectResponse` in the short-circuit response has all 6 required fields to prevent frontend rendering errors
    - Do NOT write comprehensive coverage for all scenarios
    - Skip performance tests and accessibility tests
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 21 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 21 tests total)
- Critical end-to-end SA workflows for this increment are covered
- No more than 6 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: SA Prompt Template Update and buildSystemPrompt Signature Extension** -- No dependencies. Adds the CONTEXT ALIGNMENT section to the template and extends the function signature. This is the foundation that Task Groups 2 and 3 depend on.

2. **Task Group 2: MISSION.MD and TECH-STACK.MD File Loading in chat.ts** -- Depends on Task Group 1. Implements the async file reading logic and wires loaded content into `buildSystemPrompt`. After this group, the SA system prompt dynamically includes mission and tech-stack content.

3. **Task Group 3: Standards-Missing Short-Circuit and Artefact Persistence Stripping** -- Depends on Task Group 2. Uses the `techStackContent` result from file loading to decide whether to short-circuit. Also implements the persistence stripping for artefact content. This is the most complex group with the most integration points.

4. **Task Group 4: Test Review and Critical Gap Analysis** -- Depends on Task Groups 1-3. Reviews all tests, identifies gaps, and adds up to 6 additional strategic tests for end-to-end and edge case coverage.

## Files Modified (Summary)

| File | Changes |
|------|---------|
| `gateway/src/services/promptBuilder.ts` | Add CONTEXT ALIGNMENT section to `SOLUTION_ARCHITECT_PROMPT_TEMPLATE`; extend `buildSystemPrompt` signature with `missionContent?` and `techStackContent?`; implement conditional context injection in SA branch |
| `gateway/src/routes/chat.ts` | Add `loadProjectFile` helper function; wire file loading for SA mode before `buildSystemPrompt` call; implement standards-missing short-circuit before LLM call; implement persistence stripping for SA mode with sources |
| `gateway/src/__tests__/sa-increment-2-prompt-template.test.ts` | New: 4 tests for prompt template and signature extension (Task Group 1) |
| `gateway/src/__tests__/sa-increment-2-file-loading.test.ts` | New: 5 tests for file loading and system prompt wiring (Task Group 2) |
| `gateway/src/__tests__/sa-increment-2-short-circuit-persistence.test.ts` | New: 6 tests for short-circuit and persistence stripping (Task Group 3) |
| `gateway/src/__tests__/sa-increment-2-gap-fill.test.ts` | New: 5 gap-fill tests (Task Group 4) |

## Files NOT Modified (Confirmed by Spec)

| File | Reason |
|------|--------|
| `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx` | Already fully wired with UploadDocumentsModal, handleSendWithSources, sources field, projectParentFolder |
| `frontend/src/components/ProductView/UploadDocumentsModal.tsx` | Shared component, no changes needed |
| `gateway/src/services/conversation.ts` | `persistConversation` and `buildMessagesForTurn` are unchanged; stripping happens in chat.ts before calling `persistConversation` |
| `gateway/src/services/solutionArchitectResponseValidator.ts` | Validator and fallback creator are unchanged |
| `gateway/src/types/chat.ts` | No new types needed; `SolutionArchitectResponse` and `ChatResponse` already have the required shape |
