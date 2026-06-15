# Task Breakdown: Expanded Planner JSON Contract (v1.1)

## Overview

**Spec ID:** 2026-01-22-expanded-planner-json-contract
**Total Tasks:** 24
**Effort Estimate:** 2-3 days
**Module:** Gateway (Node.js/TypeScript)

This implementation expands the Planner (Product Owner) LLM structured JSON response contract to always return structured JSON in refine phase, include acceptance criteria during shaping, add implementation plans, and implement schema versioning.

---

## Task List

### Type Definitions Layer

#### Task Group 1: Add Type Definitions and Update Enums
**Dependencies:** None

- [x] 1.0 Complete type definitions layer
  - [x] 1.1 Write 4-6 focused tests for type definitions
    - **File:** `gateway/src/__tests__/planner-response-types.test.ts`
    - Test PlannerResponse interface shape validation
    - Test ImplementationPlan interface shape validation
    - Test Increment interface shape validation
    - Test PlannerSchemaVersion type accepts "1.1"
    - Test PlannerValidationResult interface shape
    - Test ImplementChatPhase enum includes 'implementation_planning'
  - [x] 1.2 Add PlannerResponse interface to chat.ts
    - **File:** `gateway/src/types/chat.ts`
    - Add `PlannerSchemaVersion` type: `"1.1"`
    - Add `PlannerResponse` interface with all fields:
      - `schemaVersion: PlannerSchemaVersion`
      - `message: string`
      - `featureUnderstanding: string`
      - `scope: { in: string[]; out: string[] }`
      - `assumptions: string[]`
      - `acceptanceCriteria: string[]`
      - `openQuestions: string[]`
      - `plannerReadyForSpec: boolean`
      - `implementationPlan: ImplementationPlan | null`
  - [x] 1.3 Add ImplementationPlan and Increment interfaces
    - **File:** `gateway/src/types/chat.ts`
    - Add `ImplementationPlan` interface:
      - `planTitle: string`
      - `increments: Increment[]`
    - Add `Increment` interface:
      - `id: string`
      - `title: string`
      - `shortDescription: string`
      - `status: "NOT_STARTED"`
      - `proposedFinalSubFeatureDefinition: string`
  - [x] 1.4 Add PlannerValidationResult interface
    - **File:** `gateway/src/types/chat.ts`
    - Add `PlannerValidationResult` interface:
      - `valid: boolean`
      - `plannerResponse?: PlannerResponse`
      - `error?: string`
  - [x] 1.5 Update ImplementChatPhase enum
    - **File:** `gateway/src/types/chat.ts`
    - Add `'implementation_planning'` to the union type
    - Keep existing phases: `'bootstrap'`, `'refine'`, `'generate_specs'`
    - Remove or deprecate `'handoff'` phase
  - [x] 1.6 Deprecate old types for backward compatibility
    - **File:** `gateway/src/types/chat.ts`
    - Add `@deprecated` JSDoc comment to `HandoffPlanResponse`
    - Add `@deprecated` JSDoc comment to `HandoffIntent`
    - Keep types functional for backward compatibility
  - [x] 1.7 Update ChatResponse interface
    - **File:** `gateway/src/types/chat.ts`
    - Add `plannerResponse?: PlannerResponse` field
    - Add `@deprecated` JSDoc to existing `handoffPlan` field
  - [x] 1.8 Export new types from index
    - **File:** `gateway/src/types/index.ts`
    - Export all new types: `PlannerResponse`, `ImplementationPlan`, `Increment`, `PlannerSchemaVersion`, `PlannerValidationResult`
  - [x] 1.9 Ensure type definition tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- All new interfaces are properly typed
- TypeScript compilation succeeds with new types
- Deprecated types have proper JSDoc annotations
- New types are exported from index

---

### Validator Service Layer

#### Task Group 2: Create Planner Response Validator
**Dependencies:** Task Group 1

- [x] 2.0 Complete validator service layer
  - [x] 2.1 Write 6-8 focused tests for validator
    - **File:** `gateway/src/__tests__/planner-response-validator.test.ts`
    - Test `validatePlannerResponse` returns valid for correct schema
    - Test `validatePlannerResponse` returns invalid for missing required fields
    - Test `validatePlannerResponse` returns invalid for wrong schemaVersion
    - Test `validatePlannerResponse` validates implementationPlan when `expectImplementationPlan=true`
    - Test `validatePlannerResponse` rejects non-null implementationPlan when `expectImplementationPlan=false`
    - Test `extractJson` handles markdown code blocks (```json ... ```)
    - Test `extractJson` handles bare JSON objects
    - Test `createFallbackPlannerResponse` returns correct structure with all fields
  - [x] 2.2 Create plannerResponseValidator.ts file
    - **File:** `gateway/src/services/plannerResponseValidator.ts` (NEW)
    - Add imports for types from `../types/chat`
    - Export module-level functions
  - [x] 2.3 Implement extractJson helper function
    - **File:** `gateway/src/services/plannerResponseValidator.ts`
    - Handle direct JSON (starts with `{`)
    - Handle markdown code blocks: ` ```json ... ``` ` and ` ``` ... ``` `
    - Handle bare JSON object extraction with regex
    - Return `null` if no JSON found
  - [x] 2.4 Implement validateImplementationPlan helper function
    - **File:** `gateway/src/services/plannerResponseValidator.ts`
    - Validate `planTitle` is non-empty string
    - Validate `increments` is non-empty array
    - Validate each increment has all required fields
    - Validate each increment `status` is `"NOT_STARTED"`
    - Return `PlannerValidationResult`
  - [x] 2.5 Implement validatePlannerResponse function
    - **File:** `gateway/src/services/plannerResponseValidator.ts`
    - Accept `content: string` and `expectImplementationPlan: boolean` parameters
    - Call `extractJson` to extract JSON from content
    - Parse JSON with try/catch
    - Validate `schemaVersion === "1.1"`
    - Validate required string fields: `message`, `featureUnderstanding`
    - Validate required array fields: `assumptions`, `acceptanceCriteria`, `openQuestions`
    - Validate `scope` object with `in` and `out` arrays
    - Validate `plannerReadyForSpec` is boolean
    - Conditionally validate `implementationPlan` based on `expectImplementationPlan`
    - Return `PlannerValidationResult`
  - [x] 2.6 Implement createFallbackPlannerResponse function
    - **File:** `gateway/src/services/plannerResponseValidator.ts`
    - Accept `rawMessage: string` parameter
    - Return valid `PlannerResponse` with:
      - `schemaVersion: '1.1'`
      - `message: rawMessage`
      - All other fields as empty defaults
      - `implementationPlan: null`
  - [x] 2.7 Export functions from services index
    - **File:** `gateway/src/services/index.ts`
    - Add export for `validatePlannerResponse`
    - Add export for `createFallbackPlannerResponse`
  - [x] 2.8 Ensure validator tests pass
    - Run ONLY the 6-8 tests written in 2.1
    - Verify all validation scenarios work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6-8 tests written in 2.1 pass
- `validatePlannerResponse` correctly validates schema v1.1
- JSON extraction handles markdown code blocks
- Fallback response has correct structure
- Functions are exported from services index

---

### System Prompts Layer

#### Task Group 3: Update System Prompts
**Dependencies:** Task Group 1

- [x] 3.0 Complete system prompts layer
  - [x] 3.1 Write 4-6 focused tests for prompt templates
    - **File:** `gateway/src/__tests__/planner-prompts.test.ts`
    - Test `IMPLEMENT_PLANNER_PROMPT_TEMPLATE` contains JSON schema example
    - Test `IMPLEMENT_PLANNER_PROMPT_TEMPLATE` requires schemaVersion "1.1"
    - Test `IMPLEMENT_PLANNING_PROMPT_TEMPLATE` contains implementationPlan structure
    - Test `IMPLEMENT_PLANNING_PROMPT_TEMPLATE` requires increments array
    - Test prompt templates have all required placeholder variables
    - Test `buildSystemPrompt` returns correct prompt for `implementation_planning` phase
  - [x] 3.2 Update IMPLEMENT_PLANNER_PROMPT_TEMPLATE for JSON output
    - **File:** `gateway/src/services/promptBuilder.ts`
    - Replace existing template with JSON-enforcing version
    - Include full JSON schema example in template
    - Add rules for JSON-only output
    - Specify `implementationPlan` must be `null` during refine
    - Include shaping progression guidance
  - [x] 3.3 Create implementationPlanningPrompt.ts file
    - **File:** `gateway/src/services/implementationPlanningPrompt.ts` (NEW)
    - Export `IMPLEMENT_PLANNING_PROMPT_TEMPLATE` constant
    - Include context placeholders: `{workItemTitle}`, `{workItemType}`, `{workItemDescription}`
    - Include architecture context placeholders: `{entityIds}`, `{diagramIds}`, `{resolvedContext}`
    - Include shaped feature placeholders: `{featureUnderstanding}`, `{scopeIn}`, `{scopeOut}`, `{assumptions}`, `{acceptanceCriteria}`
    - Include full JSON schema with `implementationPlan` required
    - Add rules for increment creation (1-5 increments)
  - [x] 3.4 Update buildSystemPrompt to support implementation_planning phase
    - **File:** `gateway/src/services/promptBuilder.ts`
    - Import `IMPLEMENT_PLANNING_PROMPT_TEMPLATE` from new file
    - Add case for `phase === 'implementation_planning'`
    - Use `IMPLEMENT_PLANNING_PROMPT_TEMPLATE` for this phase
    - Pass shaped feature data to template substitution
  - [x] 3.5 Export new prompt template from services index
    - **File:** `gateway/src/services/index.ts`
    - Add export for `IMPLEMENT_PLANNING_PROMPT_TEMPLATE`
  - [x] 3.6 Ensure prompt tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify prompt templates compile correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Refine phase prompt enforces JSON output
- Implementation planning prompt is created with correct structure
- `buildSystemPrompt` handles `implementation_planning` phase
- Prompts have all required placeholders

---

### Route Handler Layer

#### Task Group 4: Update Chat Route Handler
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete route handler layer
  - [x] 4.1 Write 6-8 focused tests for route handler updates
    - **File:** `gateway/src/__tests__/planner-chat-route.test.ts`
    - Test refine phase validates and returns structured `plannerResponse`
    - Test refine phase fallback on invalid JSON preserves raw message
    - Test `implementation_planning` phase validates with `expectImplementationPlan=true`
    - Test `implementation_planning` phase returns error message on invalid plan
    - Test response includes both `message` and `plannerResponse` fields
    - Test phase transition from refine to implementation_planning works
    - Test bootstrap phase remains unchanged (text response)
    - Test generate_specs phase remains unchanged
  - [x] 4.2 Import validator functions in chat route
    - **File:** `gateway/src/routes/chat.ts`
    - Add import: `import { validatePlannerResponse, createFallbackPlannerResponse } from '../services/plannerResponseValidator'`
  - [x] 4.3 Add refine phase handling with validation
    - **File:** `gateway/src/routes/chat.ts`
    - Check if `context?.mode === 'implement_feature'` and `phase === 'refine'`
    - Call `validatePlannerResponse(response.content, false)`
    - On valid: return response with `plannerResponse` field
    - On invalid: log warning, create fallback, return with raw message
  - [x] 4.4 Add implementation_planning phase handling
    - **File:** `gateway/src/routes/chat.ts`
    - Check if `phase === 'implementation_planning'`
    - Call `validatePlannerResponse(response.content, true)`
    - On valid: return response with `plannerResponse` including `implementationPlan`
    - On invalid: return fallback with error message
  - [x] 4.5 Ensure fallback behavior preserves chat flow
    - **File:** `gateway/src/routes/chat.ts`
    - Never throw HTTP errors due to invalid LLM JSON
    - Always return valid response structure
    - Log warnings with `console.warn` for diagnostics
    - Include `error` field in response when validation fails
  - [x] 4.6 Update response structure for backward compatibility
    - **File:** `gateway/src/routes/chat.ts`
    - Include `plannerResponse` in response
    - Keep existing `message` field at top level
    - Optionally include deprecated `handoffPlan` for transition period
  - [x] 4.7 Ensure route handler tests pass
    - Run ONLY the 6-8 tests written in 4.1
    - Verify all phase handling works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6-8 tests written in 4.1 pass
- Refine phase returns validated `plannerResponse`
- Implementation planning phase returns plan with increments
- Invalid JSON never breaks the chat flow
- Warnings logged for invalid JSON
- Response structure includes new fields

---

### Integration Testing

#### Task Group 5: Integration Testing and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4-6 tests from type definitions (Task 1.1)
    - Review the 6-8 tests from validator (Task 2.1)
    - Review the 4-6 tests from prompts (Task 3.1)
    - Review the 6-8 tests from route handler (Task 4.1)
    - Total existing tests: approximately 20-28 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - **File:** `gateway/src/__tests__/planner-response-integration.test.ts` (NEW)
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on PlannerResponse contract feature
    - Prioritize integration between validator, prompts, and route handler
  - [x] 5.3 Write up to 8 additional strategic integration tests
    - Test end-to-end refine phase: request -> prompt -> LLM -> validation -> response
    - Test end-to-end implementation_planning phase flow
    - Test phase transition: refine -> implementation_planning preserves context
    - Test malformed JSON from LLM triggers fallback correctly
    - Test schemaVersion mismatch handling
    - Test increments array validation (empty array rejection)
    - Test scope object validation (missing in/out arrays)
    - Test acceptance criteria accumulation across refine responses
  - [x] 5.4 Run feature-specific tests only
    - Run tests from: `planner-response-types.test.ts`
    - Run tests from: `planner-response-validator.test.ts`
    - Run tests from: `planner-prompts.test.ts`
    - Run tests from: `planner-chat-route.test.ts`
    - Run tests from: `planner-response-integration.test.ts`
    - Expected total: approximately 28-36 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 28-36 tests total)
- End-to-end workflows validated
- Fallback behavior tested in integration
- No more than 8 additional tests added
- Testing focused exclusively on this spec's feature

---

## Execution Order

Recommended implementation sequence:

1. **Type Definitions Layer (Task Group 1)** - Foundation types required by all other groups
2. **Validator Service Layer (Task Group 2)** - Depends on types, required by route handler
3. **System Prompts Layer (Task Group 3)** - Depends on types, required by route handler
4. **Route Handler Layer (Task Group 4)** - Depends on all previous groups
5. **Integration Testing (Task Group 5)** - Final validation of all components

---

## Files Summary

### New Files

| File | Purpose |
|------|---------|
| `gateway/src/services/plannerResponseValidator.ts` | Validate PlannerResponse, extract JSON, create fallback |
| `gateway/src/services/implementationPlanningPrompt.ts` | System prompt for implementation_planning phase |
| `gateway/src/__tests__/planner-response-types.test.ts` | Type definition tests |
| `gateway/src/__tests__/planner-response-validator.test.ts` | Validator unit tests |
| `gateway/src/__tests__/planner-prompts.test.ts` | Prompt template tests |
| `gateway/src/__tests__/planner-chat-route.test.ts` | Route handler tests |
| `gateway/src/__tests__/planner-response-integration.test.ts` | Integration tests |

### Modified Files

| File | Changes |
|------|---------|
| `gateway/src/types/chat.ts` | Add PlannerResponse types, update ChatResponse, deprecate old types, update phase enum |
| `gateway/src/types/index.ts` | Export new types |
| `gateway/src/services/promptBuilder.ts` | Update IMPLEMENT_PLANNER_PROMPT_TEMPLATE, add implementation_planning support |
| `gateway/src/services/index.ts` | Export new validator functions and prompt template |
| `gateway/src/routes/chat.ts` | Add refine/implementation_planning phase handling with validation |

---

## Risk Mitigation

1. **Backward Compatibility** - Keep deprecated types functional during transition
2. **Safe Fallbacks** - Never break chat flow due to malformed LLM output
3. **Incremental Rollout** - Gateway changes first, frontend migration separate
4. **Logging** - Add warnings for invalid JSON to aid debugging

---

## Out of Scope

- Frontend layout changes (separate spec)
- Software Architect (Implementation LLM) schema
- Execution pipeline
- Persistence model changes
- Allowed increment statuses beyond "NOT_STARTED"
