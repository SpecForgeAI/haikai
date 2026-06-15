# Task Breakdown: Implement Assistant Stage 2 - Phased Conversations

## Overview
Total Tasks: 20

This feature introduces an explicit "phase" field for Implement Assistant conversations to distinguish between refinement dialog (`refine`) and implementation handoff (`handoff`), laying groundwork for future staged workflows while preserving existing behavior.

**Key Files:**
- `frontend/src/api/chatApi.ts` - Frontend type definitions
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` - Frontend component
- `gateway/src/types/chat.ts` - Gateway type definitions
- `gateway/src/services/promptBuilder.ts` - Prompt selection logic

## Task List

### Gateway Layer

#### Task Group 1: Gateway Types and Prompt Builder
**Dependencies:** None

- [x] 1.0 Complete Gateway layer changes
  - [x] 1.1 Write 4-6 focused tests for phase handling in Gateway
    - Test that `ChatPhase` type accepts `'refine'` and `'handoff'` values
    - Test `buildSystemPrompt` returns planner prompt when `phase === 'refine'`
    - Test `buildSystemPrompt` returns generate specs prompt when `phase === 'handoff'`
    - Test `buildSystemPrompt` defaults to planner prompt when phase is undefined
    - Test warning log is emitted for unknown phase values
    - Test `buildContextSummary` includes phase when present
  - [x] 1.2 Add `ChatPhase` type to `gateway/src/types/chat.ts`
    - Add type definition: `export type ChatPhase = 'refine' | 'handoff';`
    - Place near `ChatIntent` type (line 21) for consistency
    - Follow existing string literal union pattern
  - [x] 1.3 Add `phase` field to `ChatContext` interface
    - File: `gateway/src/types/chat.ts`
    - Add field: `phase?: ChatPhase;` to `ChatContext` interface (lines 51-82)
    - Field is optional for backward compatibility
    - Add JSDoc comment explaining phase purpose
  - [x] 1.4 Update `buildSystemPrompt` to check phase for prompt selection
    - File: `gateway/src/services/promptBuilder.ts`
    - Modify logic in lines 164-172 to check `context.phase` value
    - For `phase === 'handoff'`: use `IMPLEMENT_GENERATE_SPECS_PROMPT_TEMPLATE`
    - For `phase === 'refine'` or undefined: use `IMPLEMENT_PLANNER_PROMPT_TEMPLATE`
    - Maintain existing `intent` check as fallback for backward compatibility
  - [x] 1.5 Add warning log for unknown phase values
    - File: `gateway/src/services/promptBuilder.ts`
    - Import logger if not already imported
    - When `context.phase` is present but not `'refine'` or `'handoff'`
    - Log WARN: "Unknown phase value received: {phase}, defaulting to refine"
    - Then use `IMPLEMENT_PLANNER_PROMPT_TEMPLATE`
  - [x] 1.6 Update `buildContextSummary` to include phase
    - File: `gateway/src/services/promptBuilder.ts`
    - In `buildContextSummary` function (lines 327-368)
    - Add: `if (context.phase) { summary.phase = context.phase; }`
    - Follow pattern used for intent at line 345-347
  - [x] 1.7 Ensure Gateway layer tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify type definitions compile correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- `ChatPhase` type is exported and accepts `'refine'` | `'handoff'`
- `phase` field is optional on `ChatContext` interface
- `buildSystemPrompt` correctly routes based on phase value
- Unknown phase values emit WARN log and default to refine behavior
- `buildContextSummary` includes phase in logged output

---

### Frontend Layer

#### Task Group 2: Frontend Types and API Updates
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete Frontend type definitions
  - [x] 2.1 Write 3-4 focused tests for frontend phase types
    - Test that `ImplementChatPhase` type accepts `'refine'` and `'handoff'` values
    - Test that `ImplementChatContext` interface accepts optional `phase` field
    - Test that context with `phase: 'refine'` is valid
    - Test that context with `phase: 'handoff'` is valid
  - [x] 2.2 Add `ImplementChatPhase` type to `frontend/src/api/chatApi.ts`
    - Add type definition: `export type ImplementChatPhase = 'refine' | 'handoff';`
    - Place near `ImplementChatIntent` type (line 47) for consistency
    - Follow existing string literal union pattern
  - [x] 2.3 Add `phase` field to `ImplementChatContext` interface
    - File: `frontend/src/api/chatApi.ts`
    - Add field: `phase?: ImplementChatPhase;` to interface (lines 53-68)
    - Field is optional for backward compatibility
    - Add JSDoc comment explaining phase semantics
  - [x] 2.4 Ensure Frontend type tests pass
    - Run ONLY the 3-4 tests written in 2.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 2.1 pass
- `ImplementChatPhase` type is exported
- `phase` field is optional on `ImplementChatContext` interface
- TypeScript compilation succeeds with new types

---

#### Task Group 3: Frontend Component Integration
**Dependencies:** Task Group 2

- [x] 3.0 Complete Frontend component updates
  - [x] 3.1 Write 4-5 focused tests for phase in ImplementationAssistantPanel
    - Test that `buildContext('normal_chat')` call includes `phase: 'refine'`
    - Test that `buildContext('generate_specs')` call includes `phase: 'handoff'`
    - Test that `handleSend` passes correct phase to API
    - Test that `handleImplement` passes correct phase to API
    - Optionally test context object structure
  - [x] 3.2 Update `buildContext` function signature to accept phase parameter
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Modify function (lines 218-240) to accept `phase` parameter
    - Type: `(intent: ImplementChatIntent, phase: ImplementChatPhase) => ImplementChatContext`
    - Include phase in returned context object
  - [x] 3.3 Update `handleSend` to pass `phase: 'refine'`
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - In `handleSend` function (line 245)
    - Change call at line 261 to: `buildContext('normal_chat', 'refine')`
    - This represents exploratory dialog phase (steps 1a-1e)
  - [x] 3.4 Update `handleImplement` to pass `phase: 'handoff'`
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - In `handleImplement` function (line 305)
    - Change call at line 319 to: `buildContext('generate_specs', 'handoff')`
    - This represents transition from clarification to spec generation
  - [x] 3.5 Ensure Frontend component tests pass
    - Run ONLY the 4-5 tests written in 3.1
    - Verify phase is correctly included in API requests
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-5 tests written in 3.1 pass
- `buildContext` function accepts and includes phase parameter
- Normal chat messages include `phase: 'refine'`
- Implement button clicks include `phase: 'handoff'`
- No visual or UX changes (phase is invisible metadata)

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 tests written by Gateway engineer (Task 1.1)
    - Review the 3-4 tests written by Frontend types engineer (Task 2.1)
    - Review the 4-5 tests written by Frontend component engineer (Task 3.1)
    - Total existing tests: approximately 11-15 tests
  - [x] 4.2 Analyze test coverage gaps for phase feature only
    - Identify critical integration points lacking coverage
    - Focus ONLY on phase-related functionality
    - Prioritize end-to-end request flow verification
    - Do NOT assess entire application test coverage
  - [x] 4.3 Write up to 5 additional strategic tests maximum
    - Add maximum of 5 new tests to fill identified critical gaps
    - Consider: end-to-end phase propagation from frontend to gateway
    - Consider: backward compatibility with requests missing phase
    - Consider: phase logging verification
    - Skip edge cases unless business-critical
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to phase feature (from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 16-20 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical phase workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-20 tests total)
- Phase propagation from frontend to gateway is verified
- Backward compatibility with missing phase is verified
- No more than 5 additional tests added when filling gaps
- Testing focused exclusively on phase feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Groups 1 and 2 (parallel)** - Gateway types/logic and Frontend types
   - These have no dependencies on each other
   - Can be developed simultaneously

2. **Task Group 3** - Frontend Component Integration
   - Depends on Task Group 2 for type definitions

3. **Task Group 4** - Test Review and Gap Analysis
   - Depends on all previous groups completing
   - Final verification of end-to-end functionality

---

## Notes

**Key Insight from Spec:**
The existing `intent` field maps 1:1 with phase currently:
- `intent: 'normal_chat'` corresponds to `phase: 'refine'`
- `intent: 'generate_specs'` corresponds to `phase: 'handoff'`

Phase provides a semantic workflow concept for future phases like "bootstrap" that may not map directly to intent.

**Backward Compatibility:**
- Phase field is optional in all interfaces
- Gateway defaults to `refine` behavior when phase is undefined
- Existing `intent` check remains as fallback

**No UX Changes:**
Phase is invisible request metadata - no visual indicators or user-facing changes required.

---

## Implementation Summary

**Total Tests Written:** 24 tests (9 Gateway + 15 Frontend)

**Test Files Created:**
- `gateway/src/__tests__/phase-handling.test.ts` - 9 tests for Gateway phase handling
- `frontend/src/__tests__/implement-chat-phase-types.test.ts` - 5 tests for frontend types
- `frontend/src/__tests__/implementation-assistant-panel-phase.test.tsx` - 5 tests for component
- `frontend/src/__tests__/phase-e2e-propagation.test.ts` - 5 tests for e2e propagation

**Files Modified:**
- `gateway/src/types/chat.ts` - Added `ChatPhase` type and `phase` field to `ChatContext`
- `gateway/src/services/promptBuilder.ts` - Added phase-based prompt selection and logging
- `frontend/src/api/chatApi.ts` - Added `ImplementChatPhase` type and `phase` field
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` - Updated `buildContext` to accept phase
