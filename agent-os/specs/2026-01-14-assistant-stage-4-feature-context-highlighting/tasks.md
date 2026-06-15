# Task Breakdown: Implement Assistant Stage 4 - Feature-Specific Context Highlighting

## Overview
Total Tasks: 15

This spec is primarily about enhancing existing infrastructure with:
1. Verifying frontend already sends the correct data (minimal changes)
2. Adding a "HIGHLIGHTED FEATURE CONTEXT" section to the prompt template
3. Updating logging terminology to use "highlighted"
4. Backend DTO enhancement for referenced entity names in diagrams

Most infrastructure already exists from Stages 1-3. This is a refinement pass.

## Task List

### Frontend Verification

#### Task Group 1: Frontend Type Alignment and Verification
**Dependencies:** None

- [x] 1.0 Verify and document frontend highlighted selection handling
  - [x] 1.1 Write 3 focused verification tests for highlighted context passing
    - Test that `buildContext()` includes entityIds from `contextState.entity_refs`
    - Test that `buildContext()` includes diagramIds from `contextState.diagram_refs`
    - Test that cleared selections result in empty arrays `[]` (not undefined)
  - [x] 1.2 Verify `ArchitectureContextPayload` type alignment in `frontend/src/api/chatApi.ts`
    - Confirm `entityIds: string[]` matches Gateway's `ArchitectureContext` interface
    - Confirm `diagramIds: string[]` matches Gateway's `ArchitectureContext` interface
    - Document in code comment that these represent "highlighted" selections for Stage 4
  - [x] 1.3 Verify `buildContext()` in `ImplementationAssistantPanel.tsx` behavior
    - Confirm `contextState.entity_refs` maps to `architectureContext.entityIds`
    - Confirm `contextState.diagram_refs` maps to `architectureContext.diagramIds`
    - Verify empty arrays are sent when no selections exist (not undefined/null)
  - [x] 1.4 Add JSDoc comment clarification for semantic meaning
    - Update `ArchitectureContextPayload` interface comment to note these are "highlighted" selections
    - Update `buildContext()` function comment to clarify "highlighted" semantics
  - [x] 1.5 Run verification tests to confirm frontend behavior
    - Run only the 3 tests written in 1.1
    - Confirm all pass without code changes (existing behavior is correct)

**Acceptance Criteria:**
- Tests confirm frontend already sends entityIds/diagramIds correctly
- Type definitions align between frontend and gateway
- Documentation clarifies "highlighted" semantic meaning
- No functional code changes required (verification only)

### Gateway Layer

#### Task Group 2: Gateway Logging Terminology Updates
**Dependencies:** None (can run parallel to Task Group 1)

- [x] 2.0 Update logging to use "highlighted" terminology
  - [x] 2.1 Write 4 focused tests for gateway logging and resolution behavior
    - Test that `tryResolveImplementContext()` logs "highlighted" terminology
    - Test that resolution fires only when entityIds OR diagramIds are non-empty
    - Test that resolution skips when both arrays are empty
    - Test that resolution failures log warning with "highlighted" terminology
  - [x] 2.2 Update `tryResolveImplementContext()` in `gateway/src/routes/chat.ts`
    - Update debug log messages to use "highlighted entity IDs" and "highlighted diagram IDs"
    - Update variable comments to clarify "highlighted" semantics
    - Rename local references in comments from "entityIds/diagramIds" to "highlightedEntityIds/highlightedDiagramIds"
  - [x] 2.3 Update error handling logging terminology
    - Update warning log message to reference "highlighted context resolution"
    - Ensure requestId is included in all log messages
    - Verify existing try/catch gracefully handles failures
  - [x] 2.4 Run gateway logging tests
    - Run only the 4 tests written in 2.1
    - Verify logging terminology is consistent

**Acceptance Criteria:**
- All log messages use "highlighted" terminology
- Resolution logic unchanged (only terminology updates)
- Graceful failure handling preserved
- Tests pass with updated logging

#### Task Group 3: Prompt Template Enhancement for Highlighted Context
**Dependencies:** Task Group 2

- [x] 3.0 Add "HIGHLIGHTED FEATURE CONTEXT" section to prompt template
  - [x] 3.1 Write 5 focused tests for highlighted context prompt injection
    - Test that "HIGHLIGHTED FEATURE CONTEXT:" section appears in prompt for refine phase
    - Test that highlighted section is positioned after "RESOLVED ARCHITECTURE CONTEXT:"
    - Test that resolved entities include name, type, category, relevant_fields
    - Test that resolved diagrams include name, diagram_type, referenced entities
    - Test that empty highlighted context shows "No items highlighted by user."
  - [x] 3.2 Update `IMPLEMENT_PLANNER_PROMPT_TEMPLATE` in `gateway/src/services/promptBuilder.ts`
    - Add new placeholder `{highlightedContext}` after `{resolvedContext}` section
    - Add section header "HIGHLIGHTED FEATURE CONTEXT:"
    - Position after "RESOLVED ARCHITECTURE CONTEXT:" section
  - [x] 3.3 Add assistant guidance instructions to prompt template
    - Add instruction: highlighted items represent user-emphasized relevance
    - Add instruction: prioritize questions and reasoning around highlighted entities/diagrams
    - Reinforce rule: do not invent architecture not present in background + highlighted context
  - [x] 3.4 Create `formatHighlightedContext()` helper function
    - Accept `ResolvedImplementContextDto` parameter
    - Format entities with: name, type, category, relevant_fields
    - Format diagrams with: name, diagram_type, referenced_entity_names (when available)
    - Return "No items highlighted by user." when no items present
  - [x] 3.5 Update `buildImplementPlannerPrompt()` to inject highlighted context
    - Call `formatHighlightedContext()` with resolved context
    - Replace `{highlightedContext}` placeholder in template
    - Handle null/undefined resolved context gracefully
  - [x] 3.6 Run prompt template tests
    - Run only the 5 tests written in 3.1
    - Verify highlighted context injection works correctly

**Acceptance Criteria:**
- "HIGHLIGHTED FEATURE CONTEXT:" section appears in refine-phase prompts
- Section positioned correctly in prompt template
- Assistant guidance added for prioritizing highlighted items
- Empty state handled gracefully

### Backend Layer

#### Task Group 4: Backend DTO and Service Enhancement
**Dependencies:** None (can run parallel to Task Groups 1-3)

- [x] 4.0 Enhance diagram resolution with referenced entity names
  - [x] 4.1 Write 4 focused tests for backend entity name resolution
    - Test that `ResolvedDiagramSummary` includes `referencedEntityNames` field
    - Test that `resolveDiagram()` populates entity names from referenced IDs
    - Test partial resolution (some IDs resolve, some fail - include only successful)
    - Test graceful handling when no entity names can be resolved
  - [x] 4.2 Update `ResolvedDiagramSummary.java` DTO
    - Add `referencedEntityNames` field with `@JsonProperty("referenced_entity_names")`
    - Update record constructor to include new field
    - Ensure field is `List<String>` type (nullable/empty list when no names resolved)
  - [x] 4.3 Update `resolveDiagram()` in `ImplementContextResolutionService.java`
    - After collecting `referencedEntityIds`, resolve each to entity name
    - Use existing entity resolution methods to get names
    - Collect successfully resolved names into `referencedEntityNames` list
    - Include partial results (skip IDs that fail resolution)
  - [x] 4.4 Add helper method for entity name lookup
    - Create `resolveEntityName(String compositeId, String modelFileId)` method
    - Return entity name String or null if not found
    - Reuse existing `resolveEntity()` logic to extract name field
  - [x] 4.5 Run backend DTO and service tests
    - Run only the 4 tests written in 4.1
    - Verify entity name resolution works correctly

**Acceptance Criteria:**
- `ResolvedDiagramSummary` includes `referenced_entity_names` field
- Diagram resolution populates entity names where feasible
- Partial resolution handled gracefully
- Backend tests pass

#### Task Group 5: Gateway Type Updates for Backend DTO Changes
**Dependencies:** Task Group 4

- [x] 5.0 Update Gateway types for referenced entity names
  - [x] 5.1 Write 2 focused tests for gateway type handling
    - Test that `ResolvedDiagramSummary` type accepts `referenced_entity_names` field
    - Test that `formatHighlightedContext()` includes entity names in diagram output
  - [x] 5.2 Update `ResolvedDiagramSummary` interface in `gateway/src/types/chat.ts`
    - Add optional field `referenced_entity_names?: string[]`
    - Ensure field is optional for backward compatibility
  - [x] 5.3 Update `formatHighlightedContext()` to use entity names
    - When formatting diagrams, prefer `referenced_entity_names` over `referenced_entity_ids`
    - Fall back to IDs if names not available
    - Format as human-readable list for LLM context
  - [x] 5.4 Run gateway type tests
    - Run only the 2 tests written in 5.1
    - Verify type handling works correctly

**Acceptance Criteria:**
- Gateway type matches backend DTO
- Highlighted context formatter uses entity names when available
- Backward compatibility maintained (field is optional)

### Integration Testing

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review 3 tests from frontend verification (Task 1.1)
    - Review 4 tests from gateway logging (Task 2.1)
    - Review 5 tests from prompt template (Task 3.1)
    - Review 4 tests from backend DTO (Task 4.1)
    - Review 2 tests from gateway types (Task 5.1)
    - Total existing tests: 18 tests
  - [x] 6.2 Analyze test coverage gaps for Stage 4 feature
    - Identify any missing end-to-end workflow coverage
    - Focus ONLY on gaps related to highlighted context feature
    - Prioritize integration between layers over unit test gaps
  - [x] 6.3 Write up to 5 additional integration tests if needed
    - Test full flow: frontend selection -> gateway resolution -> prompt injection
    - Test empty selection handling across all layers
    - Test resolution failure graceful degradation
    - Skip edge cases unless business-critical
  - [x] 6.4 Run all Stage 4 feature tests
    - Run all tests related to highlighted context feature
    - Expected total: approximately 18-23 tests
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-23 tests total)
- Critical user workflows for highlighted context are covered
- No more than 5 additional tests added for gap filling
- Testing focused exclusively on Stage 4 feature requirements

## Execution Order

Recommended implementation sequence:

```
Phase 1 (Parallel):
  - Task Group 1: Frontend Verification
  - Task Group 2: Gateway Logging Terminology
  - Task Group 4: Backend DTO Enhancement

Phase 2:
  - Task Group 3: Prompt Template Enhancement (depends on Task Group 2)
  - Task Group 5: Gateway Type Updates (depends on Task Group 4)

Phase 3:
  - Task Group 6: Test Review and Gap Analysis (depends on all previous)
```

## File References

**Frontend:**
- `frontend/src/api/chatApi.ts` - `ArchitectureContextPayload` interface
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` - `buildContext()` function

**Gateway:**
- `gateway/src/routes/chat.ts` - `tryResolveImplementContext()` function
- `gateway/src/services/promptBuilder.ts` - `IMPLEMENT_PLANNER_PROMPT_TEMPLATE`, `formatResolvedContext()`
- `gateway/src/types/chat.ts` - `ResolvedDiagramSummary` interface

**Backend:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/ResolvedDiagramSummary.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ImplementContextResolutionService.java` - `resolveDiagram()` method

## Notes

- This is a refinement of existing Stage 1-3 infrastructure
- Most code paths already exist; changes are primarily additive
- Focus on terminology consistency ("highlighted") and enhanced LLM context
- Backend enhancement for entity names is the primary new functionality
- Frontend changes are verification/documentation only (no functional changes expected)
