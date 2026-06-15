# Task Breakdown: RM Increment 2 -- Internal Roadmap Pre-check + Branching Logic

## Overview
Total Tasks: 35 (across 4 task groups)

This spec enhances the `roadmap_pm` conversation startup so the gateway pre-checks whether the project already has an internal roadmap (Initiatives/Epics in the architecture-model-service), then returns a deterministic first assistant response for both branches -- "roadmap exists" (summarize and offer to refine) or "no roadmap" (ask about external roadmap) -- without calling the LLM. All branching logic is server-side in the gateway.

**Systems affected:** Gateway (services, routes)
**Systems NOT affected:** Frontend, mcp-server, architecture-model-service

## Task List

### Gateway Service Layer

#### Task Group 1: Roadmap Summary Builder, First-Turn Detection Helper, and fetchProductSummary Integration
**Dependencies:** None

- [x] 1.0 Complete gateway service layer for roadmap pre-check
  - [x] 1.1 Write 8 focused tests for roadmap summary builder and first-turn detection
    - Test `buildRoadmapSummary()` with a `ProductSummaryDto` containing 2 initiatives, each with 2 epics: verify output contains initiative titles, epic titles, and excludes features
    - Test `buildRoadmapSummary()` truncation: provide data that exceeds 2,000 characters and verify the result ends with `"...truncated"` and total length is at or below the cap
    - Test `buildRoadmapSummary()` with orphan epics (initiative with empty/missing title): verify output includes "Orphan Epics" heading with epic titles listed
    - Test `buildRoadmapSummary()` with an empty `ProductSummaryDto` (`initiatives: []`): verify it returns an empty string
    - Test `buildRoadmapSummary()` with a mix of normal initiatives and orphan epics: verify both are represented and orphan epic count is included
    - Test `isFirstTurnRoadmapPm()` returns `true` when `session.conversation` is `undefined` and `context.mode === 'roadmap_pm'`
    - Test `isFirstTurnRoadmapPm()` returns `false` when `session.conversation` contains prior messages (non-empty array)
    - Test `hasExistingRoadmap()` returns `true` when `initiatives.length > 0`; returns `true` when orphan epics exist (initiative with empty title and non-empty epics array); returns `false` when `initiatives` is an empty array
    - File: `gateway/src/__tests__/rm-increment-2-service-layer.test.ts`
  - [x] 1.2 Create `buildRoadmapSummary()` pure function in `gateway/src/services/roadmapSummaryBuilder.ts`
    - **New file**: `gateway/src/services/roadmapSummaryBuilder.ts`
    - Signature: `export function buildRoadmapSummary(productSummary: ProductSummaryDto, maxChars?: number): string`
    - Default `maxChars` to `2000`
    - Import `ProductSummaryDto` from `'../types/chat'`
    - Logic:
      - Separate initiatives into "normal" (non-empty title) and "orphan" (empty/missing title with non-empty epics)
      - For each normal initiative: output line `"- {title}: {description}"` then indent each epic as `"  - {epicTitle}"`
      - For orphan epics: output a heading `"Orphan Epics:"` then list each epic title as `"  - {epicTitle}"`
      - Exclude Features (L3) and Stories (L4) -- do NOT traverse `epics[].features[]`
      - If the assembled string exceeds `maxChars`, truncate to `maxChars - 12` characters and append `"...truncated"`
      - If no initiatives and no orphan epics, return empty string `""`
  - [x] 1.3 Create `hasExistingRoadmap()` helper in `gateway/src/services/roadmapSummaryBuilder.ts`
    - Signature: `export function hasExistingRoadmap(productSummary: ProductSummaryDto): boolean`
    - Returns `true` when `productSummary.initiatives.length > 0` OR when any initiative has an empty/missing title but non-empty `epics` array (orphan epics)
    - Returns `false` when `initiatives` is an empty array and no orphan epics are detected
  - [x] 1.4 Create `isFirstTurnRoadmapPm()` helper in `gateway/src/services/roadmapSummaryBuilder.ts`
    - Signature: `export function isFirstTurnRoadmapPm(session: GatewaySession, context?: ChatContext): boolean`
    - Import `GatewaySession` from `'../types/session'` and `ChatContext` from `'../types/chat'`
    - Returns `true` when `context?.mode === 'roadmap_pm'` AND (`session.conversation === undefined` OR `session.conversation.length === 0`)
    - Returns `false` otherwise
  - [x] 1.5 Create `countRoadmapItems()` helper in `gateway/src/services/roadmapSummaryBuilder.ts`
    - Signature: `export function countRoadmapItems(productSummary: ProductSummaryDto): { initiativeCount: number; epicCount: number }`
    - Counts only "normal" initiatives (non-empty title) for `initiativeCount`
    - Counts all epics across all initiatives (including orphan epics) for `epicCount`
    - Used to generate the dynamic summary text in the deterministic first response
  - [x] 1.6 Export new functions from `gateway/src/services/index.ts`
    - Add export block after the Roadmap PM Response Validator exports (after line 93):
      ```
      // Roadmap Summary Builder (Spec 2026-02-15: RM Increment 2)
      export {
        buildRoadmapSummary,
        hasExistingRoadmap,
        isFirstTurnRoadmapPm,
        countRoadmapItems,
      } from './roadmapSummaryBuilder';
      ```
  - [x] 1.7 Ensure service layer tests pass
    - Run ONLY the 8 tests written in 1.1
    - Verify `buildRoadmapSummary()` produces correct summaries with truncation
    - Verify `isFirstTurnRoadmapPm()` correctly detects first turn
    - Verify `hasExistingRoadmap()` correctly classifies roadmap existence including orphan EPICs
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `buildRoadmapSummary()` produces a condensed L1/L2-only text summary capped at ~2,000 characters
- Orphan EPICs appear under an "Orphan Epics" heading in the summary
- Features (L3) are excluded from the summary output
- `isFirstTurnRoadmapPm()` correctly returns `true` only for first-turn `roadmap_pm` sessions
- `hasExistingRoadmap()` correctly classifies roadmap existence including orphan EPICs
- `countRoadmapItems()` returns accurate initiative and epic counts
- All functions are exported from `gateway/src/services/index.ts`
- The 8 tests from 1.1 pass

---

### Prompt Builder Updates

#### Task Group 2: EXISTING ROADMAP Injection and Conditional Instruction Block in System Prompt
**Dependencies:** Task Group 1 (completed)

- [x] 2.0 Complete prompt builder updates for roadmap context injection
  - [x] 2.1 Write 6 focused tests for prompt builder roadmap injection
    - Test that `buildSystemPrompt()` with `mode === 'roadmap_pm'` and non-empty `existingRoadmapSummary` returns a prompt containing the `=== EXISTING ROADMAP ===` delimited section with the summary text
    - Test that `buildSystemPrompt()` with `mode === 'roadmap_pm'` and non-empty `existingRoadmapSummary` also contains the conditional instruction block (text: "A roadmap already exists in the tool")
    - Test that `buildSystemPrompt()` with `mode === 'roadmap_pm'` and `existingRoadmapSummary` as `undefined` does NOT contain `=== EXISTING ROADMAP ===` section
    - Test that `buildSystemPrompt()` with `mode === 'roadmap_pm'` and `existingRoadmapSummary` as `undefined` does NOT contain the conditional instruction block
    - Test that the `=== EXISTING ROADMAP ===` section appears after the `=== PRODUCT MISSION ===` section when both `missionContent` and `existingRoadmapSummary` are provided
    - Test that the prompt contains the Jira-awareness instruction block (text referencing "Jira import" and "future increment")
    - File: `gateway/src/__tests__/rm-increment-2-prompt-builder.test.ts`
  - [x] 2.2 Define `ROADMAP_EXISTS_INSTRUCTION_BLOCK` constant in `gateway/src/services/promptBuilder.ts`
    - Place near the existing `FOLLOW_UP_TURN_GUIDANCE` constant (after line 187)
    - Content: A multi-line instruction block telling the LLM:
      ```
      ## EXISTING ROADMAP GUIDANCE
      A roadmap already exists in the tool. The roadmap_existence_check section is pre-answered. Skip directly to outcome_alignment and focus on reviewing, refining, and extending the existing roadmap. Do not ask the user whether they have a roadmap -- it has already been detected and is included below.
      ```
    - Follow the same pattern as `FOLLOW_UP_TURN_GUIDANCE` (a constant string conditionally appended)
  - [x] 2.3 Define `JIRA_AWARENESS_INSTRUCTION_BLOCK` constant in `gateway/src/services/promptBuilder.ts`
    - Place after `ROADMAP_EXISTS_INSTRUCTION_BLOCK`
    - Content: A multi-line instruction telling the LLM how to handle Jira references:
      ```
      ## JIRA ROADMAP AWARENESS
      If the user mentions having a Jira roadmap, Jira backlog, or external roadmap tool, respond with: "Jira import is coming in a future increment. Please provide the JQL query or describe your Jira structure anyway so we are ready when that feature arrives." Do not attempt any actual Jira API calls or import operations.
      ```
  - [x] 2.4 Extend `buildSystemPrompt()` signature to accept `existingRoadmapSummary` as an 8th parameter
    - File: `gateway/src/services/promptBuilder.ts`, function `buildSystemPrompt()` (line 1621)
    - Change signature from:
      ```typescript
      export function buildSystemPrompt(
        session: GatewaySession,
        context?: ChatContext,
        resolvedContext?: ResolvedImplementContextDto | null,
        productSummary?: ProductSummaryDto | null,
        metaModelSummary?: MetaModelSummaryDto | null,
        missionContent?: string,
        techStackContent?: string
      ): string {
      ```
      to:
      ```typescript
      export function buildSystemPrompt(
        session: GatewaySession,
        context?: ChatContext,
        resolvedContext?: ResolvedImplementContextDto | null,
        productSummary?: ProductSummaryDto | null,
        metaModelSummary?: MetaModelSummaryDto | null,
        missionContent?: string,
        techStackContent?: string,
        existingRoadmapSummary?: string
      ): string {
      ```
  - [x] 2.5 Update the `roadmap_pm` branch in `buildSystemPrompt()` to inject roadmap context
    - File: `gateway/src/services/promptBuilder.ts`, in the `roadmap_pm` block (line 1657-1668)
    - After the existing PRODUCT MISSION injection block (line 1663), add:
      1. Always append `JIRA_AWARENESS_INSTRUCTION_BLOCK` to the prompt (this is relevant for both branches)
      2. If `existingRoadmapSummary` is a non-empty string:
         - Append `'\n\n=== EXISTING ROADMAP ===\n' + existingRoadmapSummary`
         - Append `'\n\n' + ROADMAP_EXISTS_INSTRUCTION_BLOCK`
    - The final order of appended sections should be: PRODUCT MISSION (if present) -> JIRA AWARENESS -> EXISTING ROADMAP (if present) -> ROADMAP EXISTS GUIDANCE (if roadmap present)
  - [x] 2.6 Update JSDoc comment on `buildSystemPrompt()` to document the new parameter
    - Add line to the JSDoc block: `@param existingRoadmapSummary - Optional existing roadmap summary for RM mode context injection (Spec 2026-02-15: RM Increment 2)`
    - Add file header comment: `Spec 2026-02-15: RM Increment 2 - Added existingRoadmapSummary parameter and EXISTING ROADMAP injection`
  - [x] 2.7 Ensure prompt builder tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify `=== EXISTING ROADMAP ===` injection and conditional instruction block work correctly
    - Verify Jira awareness instruction is present
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `buildSystemPrompt()` accepts an 8th `existingRoadmapSummary` parameter
- When `existingRoadmapSummary` is non-empty, the `=== EXISTING ROADMAP ===` delimited section is appended to the prompt after PRODUCT MISSION
- When `existingRoadmapSummary` is non-empty, the `ROADMAP_EXISTS_INSTRUCTION_BLOCK` is appended (skip roadmap_existence_check, proceed to outcome_alignment)
- When `existingRoadmapSummary` is undefined/empty, neither the `=== EXISTING ROADMAP ===` section nor the instruction block is appended
- The Jira awareness instruction block is always appended for `roadmap_pm` mode
- Existing `roadmap_pm` prompt behavior (PRODUCT MISSION injection) is unchanged
- The 6 tests from 2.1 pass

---

### Chat Route Short-Circuit

#### Task Group 3: Deterministic First-Turn Responses for Both Branches with Graceful Degradation
**Dependencies:** Task Groups 1 and 2 (both completed)

- [x] 3.0 Complete chat route short-circuit for roadmap pre-check
  - [x] 3.1 Write 8 focused tests for first-turn short-circuit logic in chat route
    - Test "roadmap exists" branch: when `isFirstTurnRoadmapPm()` is true and `hasExistingRoadmap()` returns true, verify the response is a valid `RoadmapPmResponse` with `phase: 'questions'`, `section: 'outcome_alignment'`, non-empty `summary` containing initiative/epic counts, 2-3 questions, and `proposedInitiatives: []`
    - Test "no roadmap" branch: when `isFirstTurnRoadmapPm()` is true and `hasExistingRoadmap()` returns false (or productSummary initiatives is empty), verify the response is a valid `RoadmapPmResponse` with `phase: 'questions'`, `section: 'roadmap_existence_check'`, non-empty `summary`, and at least one question mentioning "Jira" or "external roadmap"
    - Test graceful degradation: when `isFirstTurnRoadmapPm()` is true and `fetchProductSummary()` returns null (simulating service failure), verify the response falls through to the "no roadmap" branch (same as no roadmap response) and a warning is logged
    - Test persistence: when either short-circuit branch fires, verify `persistConversation()` is called with short-circuit messages (system empty, user bootstrap message, assistant deterministic response)
    - Test transcript: when either short-circuit branch fires, verify `appendTranscriptEntry()` is called for both USER and ASSISTANT entries, and `flushTranscriptToDisk()` is called
    - Test that the deterministic "roadmap exists" response passes `validateRoadmapPmResponse()` validation (construct the JSON, call the real validator)
    - Test that the deterministic "no roadmap" response passes `validateRoadmapPmResponse()` validation
    - Test that when `isFirstTurnRoadmapPm()` returns false (non-first-turn), the short-circuit block is skipped entirely and the normal LLM call path proceeds
    - File: `gateway/src/__tests__/rm-increment-2-chat-route-short-circuit.test.ts`
  - [x] 3.2 Add imports for new functions in `gateway/src/routes/chat.ts`
    - Add to the service imports block (line 81-116):
      ```typescript
      import {
        // ...existing imports...
        buildRoadmapSummary,
        hasExistingRoadmap,
        isFirstTurnRoadmapPm,
        countRoadmapItems,
      } from '../services';
      ```
  - [x] 3.3 Implement the first-turn pre-check block in `gateway/src/routes/chat.ts`
    - Place AFTER the MISSION.MD loading block for `roadmap_pm` (after line 827), and BEFORE the SA standards-missing short-circuit block (line 833)
    - Structure:
      ```typescript
      // Spec 2026-02-15: RM Increment 2 - Roadmap pre-check and deterministic first-turn response
      if (isFirstTurnRoadmapPm(session, context)) {
        // Call fetchProductSummary for roadmap pre-check
        let productSummaryForPrecheck: ProductSummaryDto | null = null;
        try {
          productSummaryForPrecheck = await fetchProductSummary(context!.filename!);
        } catch (error) {
          logger.warn('RM roadmap pre-check: fetchProductSummary failed, degrading to no-roadmap branch', {
            requestId,
            sessionId: effectiveSessionId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
        // ... branching logic (see 3.4 and 3.5)
      }
      ```
  - [x] 3.4 Implement "roadmap exists" short-circuit branch
    - Inside the pre-check block from 3.3, when `productSummaryForPrecheck !== null && hasExistingRoadmap(productSummaryForPrecheck)`:
    - Build roadmap summary: `const roadmapSummary = buildRoadmapSummary(productSummaryForPrecheck);`
    - Get counts: `const { initiativeCount, epicCount } = countRoadmapItems(productSummaryForPrecheck);`
    - Build the system prompt WITH the roadmap summary: `const systemPromptWithRoadmap = buildSystemPrompt(session, context, null, null, null, missionContent, undefined, roadmapSummary);`
    - Construct a valid `RoadmapPmResponse`:
      ```typescript
      const roadmapPmResponse: RoadmapPmResponse = {
        phase: 'questions',
        section: 'outcome_alignment',
        summary: `I found an existing roadmap with ${initiativeCount} initiative${initiativeCount !== 1 ? 's' : ''} and ${epicCount} epic${epicCount !== 1 ? 's' : ''}. Let's review and refine it.`,
        questions: [
          'Are these initiatives still aligned with your current business goals, or have priorities shifted?',
          'Are there any new initiatives or epics that should be added to the roadmap?',
          'Would you like to adjust the sequencing or dependencies between any existing items?',
        ],
        proposedInitiatives: [],
        assumptions: [],
        openItems: [],
      };
      ```
    - Follow the SA short-circuit persistence pattern (lines 845-879 of chat.ts):
      1. Build `shortCircuitMessages`: `[{ role: 'system', content: systemPromptWithRoadmap }, { role: 'user', content: message }, { role: 'assistant', content: JSON.stringify(roadmapPmResponse) }]`
      2. Call `persistConversation(effectiveSessionId, shortCircuitMessages)`
      3. If `shouldAppendToTranscript(context)`: append USER and ASSISTANT transcript entries, call `flushTranscriptToDisk()`
      4. Log the short-circuit event
      5. Return `res.json({ sessionId: effectiveSessionId, assistant: { message: roadmapPmResponse.summary }, roadmapPmResponse } as ChatResponse)`
      6. `return;` to exit early
  - [x] 3.5 Implement "no roadmap" short-circuit branch
    - Inside the pre-check block from 3.3, as the `else` branch (when `productSummaryForPrecheck` is null or `hasExistingRoadmap()` returns false):
    - Construct a valid `RoadmapPmResponse`:
      ```typescript
      const roadmapPmResponse: RoadmapPmResponse = {
        phase: 'questions',
        section: 'roadmap_existence_check',
        summary: 'No internal roadmap found for this project. Let\'s figure out the best starting point.',
        questions: [
          'Do you have an existing roadmap in an external tool such as Jira, Azure DevOps, or a spreadsheet that we should use as a starting point?',
          'Or would you prefer to create a new roadmap from scratch based on your product goals?',
        ],
        proposedInitiatives: [],
        assumptions: [],
        openItems: [],
      };
      ```
    - Follow the same persistence pattern as the "roadmap exists" branch (3.4):
      1. Build `shortCircuitMessages` with system prompt (WITHOUT roadmap summary): `[{ role: 'system', content: '' }, { role: 'user', content: message }, { role: 'assistant', content: JSON.stringify(roadmapPmResponse) }]`
      2. Call `persistConversation(effectiveSessionId, shortCircuitMessages)`
      3. If `shouldAppendToTranscript(context)`: append USER and ASSISTANT transcript entries, call `flushTranscriptToDisk()`
      4. Log the short-circuit event (include `fetchFailed: productSummaryForPrecheck === null` for degradation tracking)
      5. Return `res.json({ sessionId: effectiveSessionId, assistant: { message: roadmapPmResponse.summary }, roadmapPmResponse } as ChatResponse)`
      6. `return;` to exit early
  - [x] 3.6 Update the `buildSystemPrompt()` call site for non-first-turn roadmap_pm requests
    - File: `gateway/src/routes/chat.ts`, at the `buildSystemPrompt()` call site (line 903)
    - The existing call already passes `missionContent` as the 6th parameter
    - For non-first-turn `roadmap_pm` requests where a roadmap exists, we need to pass the `existingRoadmapSummary` as the 8th parameter on subsequent turns so the LLM has roadmap context
    - After the first-turn pre-check block (which returns early), for subsequent turns:
      - If `context?.mode === 'roadmap_pm'` and `context?.filename`, call `fetchProductSummary(context.filename)` with graceful degradation
      - If productSummary is non-null and `hasExistingRoadmap()` is true, call `buildRoadmapSummary()` and pass the result as the 8th parameter to `buildSystemPrompt()`
      - If productSummary is null or no roadmap exists, pass `undefined` as the 8th parameter (no roadmap injection)
    - This ensures the LLM always has the `=== EXISTING ROADMAP ===` context on subsequent turns when a roadmap exists
    - Use the same graceful degradation pattern: catch errors, log warning, proceed with `undefined`
  - [x] 3.7 Add file header comment for RM Increment 2 to `gateway/src/routes/chat.ts`
    - Add to the JSDoc block at the top of the file (after the RM Increment 1 comment at line 53):
      ```
      * Spec 2026-02-15: RM Increment 2 - Internal Roadmap Pre-check + Branching Logic
      * - Added first-turn detection and roadmap pre-check for roadmap_pm mode
      * - Deterministic short-circuit responses for "roadmap exists" and "no roadmap" branches
      * - Graceful degradation when architecture-model-service is unreachable
      * - Passes existingRoadmapSummary to buildSystemPrompt for EXISTING ROADMAP injection
      ```
  - [x] 3.8 Ensure chat route short-circuit tests pass
    - Run ONLY the 8 tests written in 3.1
    - Verify both branches produce valid `RoadmapPmResponse` objects
    - Verify graceful degradation works correctly
    - Verify persistence (persistConversation + transcript) is invoked
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- First-turn `roadmap_pm` requests trigger a pre-check via `fetchProductSummary()`
- When roadmap exists: deterministic response with `section: 'outcome_alignment'`, summary with initiative/epic counts, 2-3 review questions
- When no roadmap exists: deterministic response with `section: 'roadmap_existence_check'`, summary mentioning no internal roadmap, questions asking about external roadmap (Jira)
- When `fetchProductSummary()` fails: graceful degradation to "no roadmap" branch with warning log including `requestId` and `sessionId`
- Both deterministic responses are valid `RoadmapPmResponse` objects that pass `validateRoadmapPmResponse()`
- Short-circuit messages are persisted via `persistConversation()` and transcript entries are appended and flushed
- Non-first-turn requests pass roadmap summary to `buildSystemPrompt()` as 8th parameter for LLM context
- The response is returned immediately without calling the LLM (short-circuit pattern)
- The 8 tests from 3.1 pass

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3 (all completed)

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 8 tests written by Task Group 1 (roadmap summary builder and first-turn detection)
    - Review the 6 tests written by Task Group 2 (prompt builder roadmap injection)
    - Review the 8 tests written by Task Group 3 (chat route short-circuit)
    - Total existing tests: approximately 22 tests
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 4.3 Write up to 10 additional strategic tests maximum
    - File: `gateway/src/__tests__/rm-increment-2-gap-tests.test.ts`
    - Potential gap areas to consider:
      - End-to-end flow: first-turn `roadmap_pm` message -> fetchProductSummary -> deterministic response -> correct `ChatResponse` shape
      - Orphan EPICs edge case: `ProductSummaryDto` with only orphan EPICs (initiative with empty title) results in "roadmap exists" branch
      - `buildRoadmapSummary()` with a single initiative and zero epics: verify summary is generated without epic sub-items
      - `buildRoadmapSummary()` exactly at the 2,000-char boundary: verify no truncation occurs at exactly the limit
      - `countRoadmapItems()` with orphan epics: verify orphan epics contribute to epic count but not initiative count
      - Prompt injection ordering: when both missionContent and existingRoadmapSummary are present, verify PRODUCT MISSION appears before EXISTING ROADMAP in the prompt
      - Non-regression: existing SA short-circuit behavior in `chat.ts` is unaffected by the new RM pre-check block placement
      - Non-regression: existing `roadmap_pm` non-first-turn LLM validation/corrective-retry flow is unaffected
      - `isFirstTurnRoadmapPm()` returns false for `solution_architect` mode even if conversation is empty
      - The "roadmap exists" branch system prompt passed to `persistConversation()` includes the `=== EXISTING ROADMAP ===` section
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature:
      - Tests from 1.1: `gateway/src/__tests__/rm-increment-2-service-layer.test.ts`
      - Tests from 2.1: `gateway/src/__tests__/rm-increment-2-prompt-builder.test.ts`
      - Tests from 3.1: `gateway/src/__tests__/rm-increment-2-chat-route-short-circuit.test.ts`
      - Tests from 4.3: `gateway/src/__tests__/rm-increment-2-gap-tests.test.ts`
    - Expected total: approximately 22-32 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 22-32 tests total)
- Critical user workflows for this feature are covered (both branches, graceful degradation, orphan EPICs, persistence, prompt injection)
- No more than 10 additional tests added when filling in testing gaps
- Non-regression verified for existing SA and RM modes
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1: Roadmap Summary Builder + First-Turn Detection + fetchProductSummary Integration
    |
    +---> Task Group 2: Prompt Builder EXISTING ROADMAP Injection + Conditional Instruction Block
    |         |
    +---------+---> Task Group 3: Chat Route Short-Circuit (depends on summary builder + prompt builder)
                        |
                        +---> Task Group 4: Test Review & Gap Analysis
```

1. **Task Group 1** (Service Layer) -- no dependencies; foundational pure functions needed by subsequent groups
2. **Task Group 2** (Prompt Builder) -- depends on Task Group 1 (uses `buildRoadmapSummary` output format to test injection)
3. **Task Group 3** (Chat Route Short-Circuit) -- depends on Task Groups 1 and 2 (uses service helpers + updated `buildSystemPrompt()`)
4. **Task Group 4** (Test Review & Gap Analysis) -- depends on all prior groups

## Key Files Modified

| File | Task Group | Change Description |
|------|-----------|-------------------|
| `gateway/src/services/roadmapSummaryBuilder.ts` | TG1 | **New file**: `buildRoadmapSummary()`, `hasExistingRoadmap()`, `isFirstTurnRoadmapPm()`, `countRoadmapItems()` |
| `gateway/src/services/index.ts` | TG1 | Export new roadmap summary builder functions |
| `gateway/src/services/promptBuilder.ts` | TG2 | Add `ROADMAP_EXISTS_INSTRUCTION_BLOCK` and `JIRA_AWARENESS_INSTRUCTION_BLOCK` constants; extend `buildSystemPrompt()` with 8th param `existingRoadmapSummary`; update `roadmap_pm` branch to inject `=== EXISTING ROADMAP ===` section and conditional instruction block |
| `gateway/src/routes/chat.ts` | TG3 | Add first-turn pre-check block for `roadmap_pm`: call `fetchProductSummary()`, branch on `hasExistingRoadmap()`, return deterministic `RoadmapPmResponse` for both branches, persist short-circuit messages, graceful degradation; pass `existingRoadmapSummary` to `buildSystemPrompt()` on subsequent turns |

## Key Files Referenced (Read-Only)

| File | Purpose |
|------|---------|
| `gateway/src/services/architectureModelClient.ts` (line 298) | `fetchProductSummary()` -- existing function reused for roadmap pre-check |
| `gateway/src/services/roadmapPmResponseValidator.ts` | Existing validator reused to verify deterministic responses are valid |
| `gateway/src/routes/chat.ts` (lines 833-880) | SA standards-missing short-circuit pattern -- template for the RM first-turn short-circuit |
| `gateway/src/routes/chat.ts` (lines 655-722) | `tryFetchBootstrapSummaries()` -- graceful degradation pattern reference |
| `gateway/src/services/promptBuilder.ts` (line 184) | `FOLLOW_UP_TURN_GUIDANCE` -- pattern for conditionally appended instruction blocks |
| `gateway/src/services/promptBuilder.ts` (line 1660) | PRODUCT MISSION injection -- pattern for `=== DELIMITED ===` section appending in RM mode |
| `gateway/src/types/chat.ts` (line 769) | `RoadmapPmResponse` interface -- existing type used for deterministic responses |
| `gateway/src/types/chat.ts` (line 1117) | `ProductSummaryDto`, `InitiativeSummary`, `EpicSummary` -- types consumed by roadmap summary builder |
| `gateway/src/types/session.ts` (line 65) | `GatewaySession.conversation?: OpenAIMessage[]` -- used for first-turn detection |
