# Task Breakdown: Fix Implement Assistant Context Injection

## Overview
Total Tasks: 14 (across 3 task groups)

This spec addresses two defects preventing the Implement Assistant from providing correct business and technical context to the Planner LLM:
1. Bootstrap phase not fetching product/architecture summaries
2. Highlighted entities sent without type prefixes preventing resolution

The changes are minimal since most infrastructure already exists and works correctly.

## Task List

### Gateway Layer

#### Task Group 1: Bootstrap Phase Summary Fetching
**Dependencies:** None

- [x] 1.0 Complete gateway bootstrap phase fix
  - [x] 1.1 Write 4 focused tests for bootstrap summary fetching
    - Test: bootstrap phase calls fetchProductSummary and fetchMetaModelSummary
    - Test: summaries are passed to buildSystemPrompt as 4th and 5th parameters
    - Test: null productSummary logs warning but proceeds with chat (graceful handling)
    - Test: null metaModelSummary logs warning but proceeds with chat (graceful handling)
  - [x] 1.2 Add bootstrap phase detection in POST /api/chat handler
    - Location: `gateway/src/routes/chat.ts` around line 272 (after tryResolveImplementContext)
    - Condition: `context?.mode === 'implement_feature' && context?.phase === 'bootstrap'`
    - Pattern reference: See existing `tryResolveImplementContext` call structure
  - [x] 1.3 Implement parallel summary fetching with Promise.all
    - Use `context.filename` as projectId parameter for both fetch calls
    - Call `fetchProductSummary(context.filename)` and `fetchMetaModelSummary(context.filename)` in parallel
    - Store results in `productSummary` and `metaModelSummary` variables
    - Reference: `architectureModelClient.ts` lines 90-134 and 147-194 for function signatures
  - [x] 1.4 Add graceful error handling for fetch failures
    - If fetchProductSummary returns null: log warning with projectId, set productSummary to null
    - If fetchMetaModelSummary returns null: log warning with projectId, set metaModelSummary to null
    - Never fail the chat request due to summary fetch failures
    - Reference: Existing logger pattern in chat.ts for warning logs
  - [x] 1.5 Pass summaries to buildSystemPrompt
    - Modify call: `buildSystemPrompt(session, context, resolvedContext, productSummary, metaModelSummary)`
    - Reference: `promptBuilder.ts` lines 246-252 for existing signature
    - Note: For non-bootstrap phases, pass undefined/null for 4th and 5th parameters
  - [x] 1.6 Ensure gateway bootstrap tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify bootstrap requests now include summary data in prompts
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- Bootstrap phase fetches both summaries in parallel
- Summaries are correctly passed to buildSystemPrompt
- Null summaries are handled gracefully with warning logs
- Non-bootstrap phases continue to work unchanged

### Frontend Layer

#### Task Group 2: Typed Entity ID Construction
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete frontend typed entity ID fix
  - [x] 2.1 Write 3 focused tests for typed entity ID construction
    - Test: buildContext constructs entityIds in format `"<entity_type>::<entity_id>"`
    - Test: entity_type values match backend switch statement keys (services, physicalDataEntities, etc.)
    - Test: empty entity_refs array results in empty entityIds array
  - [x] 2.2 Modify buildContext to construct typed entity IDs
    - Location: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` line 284
    - Current code: `const entityIds = contextState.entity_refs.map((ref) => ref.entity_id);`
    - New code: `const entityIds = contextState.entity_refs.map((ref) => \`\${ref.entity_type}::\${ref.entity_id}\`);`
    - Reference: EntityRef interface in `contextStorage.ts` lines 20-29 for entity_type field
  - [x] 2.3 Verify entity_type values match backend expectations
    - Confirm entity_type values in EntityRef match ImplementContextResolutionService switch cases
    - Expected values: "services", "classes", "methods", "interfaces", "applications", "appComponents", "endpoints", "businessProcesses", "businessPoints", "logicalDataEntities", "physicalDataEntities", "uiScreens"
    - Reference: `ImplementContextResolutionService.java` lines 158-176
  - [x] 2.4 Ensure frontend typed ID tests pass
    - Run ONLY the 3 tests written in 2.1
    - Verify typed IDs are correctly constructed
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3 tests written in 2.1 pass
- Entity IDs sent to gateway are in format `"<entity_type>::<entity_id>"`
- All entity_type values are valid and match backend expectations
- Diagram IDs continue to be sent as plain IDs (no change needed)

### Integration Testing

#### Task Group 3: End-to-End Verification
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Verify end-to-end context injection
  - [x] 3.1 Write 3 integration tests for context flow
    - Test: Bootstrap greeting includes product backlog acknowledgment when data exists
    - Test: Bootstrap greeting includes architecture context acknowledgment when data exists
    - Test: Highlighted entities resolve to names when user sends message with highlighted context
  - [x] 3.2 Review tests from Task Groups 1 and 2
    - Review the 4 gateway tests from Task 1.1
    - Review the 3 frontend tests from Task 2.1
    - Total existing tests: 7 tests
  - [x] 3.3 Analyze test coverage gaps for this fix only
    - Identify any critical user workflows that lack test coverage
    - Focus ONLY on the two defects being fixed
    - Do NOT assess entire application test coverage
  - [x] 3.4 Write up to 3 additional strategic tests if needed
    - Add maximum of 3 new tests to fill identified critical gaps
    - Focus on integration points between frontend, gateway, and backend
    - Skip edge cases and error scenarios already covered
  - [x] 3.5 Run all feature-specific tests
    - Run tests from 1.1 (4 tests)
    - Run tests from 2.1 (3 tests)
    - Run tests from 3.1 and 3.4 (up to 6 tests)
    - Expected total: approximately 10-13 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 10-13 tests total)
- Bootstrap phase shows product and architecture context in greeting
- Highlighted entities are resolved by name in refine phase
- No regressions in existing implement_feature functionality

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Gateway Bootstrap Fix** - Can start immediately
2. **Task Group 2: Frontend Typed IDs** - Can run in parallel with Task Group 1
3. **Task Group 3: Integration Testing** - Depends on Task Groups 1 and 2

### Parallel Execution Notes
- Task Groups 1 and 2 are independent and can be developed in parallel
- Task Group 3 must wait for both Task Groups 1 and 2 to complete

## Files to Modify

| File | Task Group | Change Summary |
|------|------------|----------------|
| `gateway/src/routes/chat.ts` | 1 | Add bootstrap summary fetching logic |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | 2 | Construct typed entity IDs |

## Files Explicitly NOT Modified (per spec)

The following files already work correctly and require no changes:
- `gateway/src/services/architectureModelClient.ts` - fetchProductSummary and fetchMetaModelSummary already implemented
- `gateway/src/services/promptBuilder.ts` - buildBootstrapPrompt already handles null summaries
- `architecture-model-service/*` - All backend endpoints and parsing logic work correctly

## Verification Checklist

Before marking complete, verify:
- [x] Bootstrap greeting mentions "product backlog" or "architecture" when summaries exist
- [x] Bootstrap greeting shows "No product backlog available" when productSummary is null
- [x] Bootstrap greeting shows "No architecture context available" when metaModelSummary is null
- [x] Highlighted physicalDataEntities resolve to table names in assistant responses
- [x] Highlighted services resolve to service names in assistant responses
- [x] No errors logged when summaries fail to fetch (only warnings)
- [x] Existing refine and handoff phases continue to work unchanged

## Implementation Summary

### Completed Implementation (2026-01-16)

**Test Files Created:**
- `gateway/src/__tests__/bootstrap-summary-fetching.test.ts` - 11 tests for bootstrap phase summary fetching
- `gateway/src/__tests__/context-injection-e2e.test.ts` - 12 tests for end-to-end context injection flow
- `frontend/src/__tests__/typed-entity-id-construction.test.ts` - 19 tests for typed entity ID construction

**Code Changes:**
1. `gateway/src/routes/chat.ts`:
   - Added `tryFetchBootstrapSummaries()` function to fetch product and meta-model summaries
   - Added bootstrap phase detection: `context?.mode === 'implement_feature' && context?.phase === 'bootstrap'`
   - Implemented parallel fetching with `Promise.all([fetchProductSummary(), fetchMetaModelSummary()])`
   - Added graceful error handling with warning logs
   - Updated `buildSystemPrompt()` call to pass summaries as 4th and 5th parameters

2. `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`:
   - Modified `buildContext()` to construct typed entity IDs in format `"<entity_type>::<entity_id>"`
   - Changed from: `contextState.entity_refs.map((ref) => ref.entity_id)`
   - Changed to: `contextState.entity_refs.map((ref) => \`\${ref.entity_type}::\${ref.entity_id}\`)`

**Test Results:**
- Gateway tests: 23 tests passed
- Frontend tests: 19 tests passed
- Total: 42 tests passed
