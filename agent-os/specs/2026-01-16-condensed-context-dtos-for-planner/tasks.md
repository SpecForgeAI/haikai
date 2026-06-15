# Task Breakdown: Condensed Context DTOs for Planner LLM

## Overview
Total Tasks: 32

This spec transforms expanded/resolved architecture context into compact, LLM-shaped DTOs for the Planner LLM during the refine phase of implement_feature mode. The implementation involves TypeScript type definitions, DTO builder functions, truncation/de-duplication logic, prompt formatting, and integration into the chat route.

## Task List

### Type Definitions Layer

#### Task Group 1: Condensed DTO Type Definitions
**Dependencies:** None

- [x] 1.0 Complete condensed DTO type definitions
  - [x] 1.1 Write 4-6 focused tests for DTO type shapes and validation
    - Test EntityAndAttributesDto has required fields (kind, id, entity_type, name, attributes, relationships)
    - Test InterfaceContractDto has required fields (kind, id, name, endpoints, schemas, key_relationships)
    - Test ServiceSliceDto has required fields (kind, id, application, component, service, interfaces, endpoints, key_entities, dependencies)
    - Test DiagramSummaryDto has required fields (kind, id, name, diagram_type, referenced_entities)
    - Test CondensedContextDto union discriminates correctly on 'kind' field
    - Test stable id format validation (entityType::entityId pattern)
  - [x] 1.2 Create EntityAndAttributesDto interface in gateway/src/types/chat.ts
    - Fields: kind (literal "entity_and_attributes"), id, entity_type, name, attributes array, relationships array
    - Add AttributeInfo type for attributes (name, type, pk, nullable)
    - Add EntityRelationshipInfo type for relationships (type, target_entity, cardinality)
  - [x] 1.3 Create InterfaceContractDto interface in gateway/src/types/chat.ts
    - Fields: kind (literal "interface_contract"), id, name, endpoints array, schemas array, key_relationships array
    - Add EndpointInfo type for endpoints (name, input_schema, output_schema, notes)
  - [x] 1.4 Create ServiceSliceDto interface in gateway/src/types/chat.ts
    - Fields: kind (literal "service_slice"), id, application, component, service, interfaces array, endpoints array, key_entities array, dependencies array
  - [x] 1.5 Create DiagramSummaryDto interface in gateway/src/types/chat.ts
    - Fields: kind (literal "diagram_summary"), id, name, diagram_type, referenced_entities array
  - [x] 1.6 Create CondensedContextDto union type in gateway/src/types/chat.ts
    - Union of EntityAndAttributesDto | InterfaceContractDto | ServiceSliceDto | DiagramSummaryDto
    - Export all new types
  - [x] 1.7 Ensure type definition tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify type compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- All 4 DTO interfaces are exported from gateway/src/types/chat.ts
- CondensedContextDto union type discriminates on 'kind' field
- Stable id format follows "entityType::entityId" pattern
- Helper types (AttributeInfo, EndpointInfo, EntityRelationshipInfo) are defined

### Configuration Layer

#### Task Group 2: Condensed Context Configuration
**Dependencies:** Task Group 1

- [x] 2.0 Complete condensed context configuration
  - [x] 2.1 Write 2-4 focused tests for configuration
    - Test default maxDtoCount is 50
    - Test default maxJsonChars is 40000
    - Test environment variable overrides work (CONDENSED_CONTEXT_MAX_DTO_COUNT, CONDENSED_CONTEXT_MAX_JSON_CHARS)
  - [x] 2.2 Add CondensedContextConfig interface to gateway/src/config.ts
    - Fields: maxDtoCount (number), maxJsonChars (number)
  - [x] 2.3 Add condensedContext property to Config interface
    - Type: CondensedContextConfig
  - [x] 2.4 Add condensedContext configuration loading in loadConfig()
    - Parse CONDENSED_CONTEXT_MAX_DTO_COUNT env var (default 50)
    - Parse CONDENSED_CONTEXT_MAX_JSON_CHARS env var (default 40000)
  - [x] 2.5 Ensure configuration tests pass
    - Run ONLY the 2-4 tests written in 2.1
    - Verify defaults and env overrides work
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- condensedContext.maxDtoCount defaults to 50
- condensedContext.maxJsonChars defaults to 40000
- Environment variable overrides function correctly

### DTO Builder Layer

#### Task Group 3: Entity and Attributes DTO Builder
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Complete entity_and_attributes DTO builder
  - [x] 3.1 Write 3-5 focused tests for buildEntityAndAttributesDtos()
    - Test physical data entity extraction with attributes from relevant_fields
    - Test logical data entity extraction with attributes
    - Test relationship extraction (fk, association) with cardinality from summary_fields
    - Test stable id format generation (entityType::entityId)
    - Test empty input returns empty array
  - [x] 3.2 Create buildEntityAndAttributesDtos() in gateway/src/services/promptBuilder.ts
    - Input: ExpandResolveResponseDto
    - Output: EntityAndAttributesDto[]
    - Filter resolved_entities by entity_type (physicalDataEntities, logicalDataEntities)
    - Extract attributes from relevant_fields (name, type, pk, nullable)
    - Match relationships from resolved_relationships where entity is from or to endpoint
  - [x] 3.3 Implement stable id generation helper
    - Format: "entityType::entityId"
    - Handle edge cases (missing type, missing id)
  - [x] 3.4 Ensure entity DTO builder tests pass
    - Run ONLY the 3-5 tests written in 3.1
    - Verify DTO shape matches spec
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Builds correct DTOs for physical and logical data entities
- Extracts attributes from relevant_fields
- Includes relationships with cardinality

#### Task Group 4: Interface Contract DTO Builder
**Dependencies:** Task Groups 1, 2

- [x] 4.0 Complete interface_contract DTO builder
  - [x] 4.1 Write 3-5 focused tests for buildInterfaceContractDtos()
    - Test interface extraction with name and id
    - Test endpoints population from resolved_entities where entity_type="endpoints"
    - Test schemas extraction from resolved_relationships where type="schema_ref"
    - Test endpoint details include input/output schema names from relevant_fields
    - Test empty interface returns empty endpoints/schemas arrays
  - [x] 4.2 Create buildInterfaceContractDtos() in gateway/src/services/promptBuilder.ts
    - Input: ExpandResolveResponseDto
    - Output: InterfaceContractDto[]
    - Filter resolved_entities by entity_type="interfaces"
    - Populate endpoints by matching resolved_entities where parent interface matches
    - Populate schemas from resolved_relationships where type="schema_ref" and from=interface
  - [x] 4.3 Implement endpoint extraction helper
    - Match endpoints to parent interface via relationship or naming convention
    - Extract name, input_schema, output_schema from relevant_fields
  - [x] 4.4 Ensure interface DTO builder tests pass
    - Run ONLY the 3-5 tests written in 4.1
    - Verify DTO shape matches spec
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Builds correct DTOs for interfaces
- Populates endpoints array from resolved_entities
- Extracts schema names from schema_ref relationships

#### Task Group 5: Service Slice DTO Builder
**Dependencies:** Task Groups 1, 2

- [x] 5.0 Complete service_slice DTO builder
  - [x] 5.1 Write 3-5 focused tests for buildServiceSliceDtos()
    - Test service extraction with name and id
    - Test application/component extraction from "contains" relationships
    - Test interfaces extraction from "exposes" relationships
    - Test key_entities populated from schema_ref relationships of child interfaces
    - Test dependencies extraction from resolved_relationships
  - [x] 5.2 Create buildServiceSliceDtos() in gateway/src/services/promptBuilder.ts
    - Input: ExpandResolveResponseDto
    - Output: ServiceSliceDto[]
    - Filter resolved_entities by entity_type="services"
    - Extract application/component from "contains" relationships where to=service
    - Extract interfaces from "exposes" relationships where from=service
  - [x] 5.3 Implement parent hierarchy extraction helper
    - Traverse "contains" relationships to find application and component
    - Handle missing parent relationships gracefully
  - [x] 5.4 Ensure service DTO builder tests pass
    - Run ONLY the 3-5 tests written in 5.1
    - Verify DTO shape matches spec
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Builds correct DTOs for services
- Extracts application/component from containment hierarchy
- Populates interfaces and key_entities arrays

#### Task Group 6: Diagram Summary DTO Builder
**Dependencies:** Task Groups 1, 2

- [x] 6.0 Complete diagram_summary DTO builder
  - [x] 6.1 Write 2-3 focused tests for buildDiagramSummaryDtos()
    - Test diagram extraction with name, diagram_type
    - Test referenced_entities uses referenced_entity_names when available
    - Test fallback to referenced_entity_ids when names not available
  - [x] 6.2 Create buildDiagramSummaryDtos() in gateway/src/services/promptBuilder.ts
    - Input: ExpandResolveResponseDto
    - Output: DiagramSummaryDto[]
    - Use resolved_diagrams array
    - Prefer referenced_entity_names over referenced_entity_ids
  - [x] 6.3 Ensure diagram DTO builder tests pass
    - Run ONLY the 2-3 tests written in 6.1
    - Verify DTO shape matches spec
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Builds correct DTOs for diagrams
- Uses entity names when available, IDs as fallback
- Includes diagram_type field

### Aggregation and Truncation Layer

#### Task Group 7: DTO Aggregation and De-duplication
**Dependencies:** Task Groups 3, 4, 5, 6

- [x] 7.0 Complete DTO aggregation and de-duplication
  - [x] 7.1 Write 3-5 focused tests for buildCondensedContextDtos()
    - Test aggregation calls all 4 builder functions
    - Test de-duplication by stable id within each kind
    - Test merging of duplicate entities (combines attributes/relationships)
    - Test deterministic ordering (same input produces same output order)
    - Test empty ExpandResolveResponseDto returns empty array
  - [x] 7.2 Create buildCondensedContextDtos() in gateway/src/services/promptBuilder.ts
    - Input: ExpandResolveResponseDto
    - Output: CondensedContextDto[]
    - Call buildEntityAndAttributesDtos(), buildInterfaceContractDtos(), buildServiceSliceDtos(), buildDiagramSummaryDtos()
    - De-duplicate by stable id within each kind
    - Sort deterministically by kind then by id
  - [x] 7.3 Implement de-duplication helper
    - Group DTOs by kind, then by id
    - Merge duplicate entries (combine arrays, prefer non-null values)
  - [x] 7.4 Ensure aggregation tests pass
    - Run ONLY the 3-5 tests written in 7.1
    - Verify de-duplication works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Aggregates all 4 DTO types
- De-duplicates by stable id within each kind
- Output is deterministically ordered

#### Task Group 8: Truncation Logic
**Dependencies:** Task Group 7

- [x] 8.0 Complete truncation logic
  - [x] 8.1 Write 4-6 focused tests for truncation
    - Test maxDtoCount enforcement (50 default)
    - Test maxJsonChars enforcement (40000 default)
    - Test priority order: interface_contract > referenced entity_and_attributes > service_slice > unreferenced entity_and_attributes > diagram_summary
    - Test truncation is deterministic (same input produces same truncated output)
    - Test truncated flag returned correctly when limits exceeded
    - Test no truncation when under limits
  - [x] 8.2 Create applyTruncation() helper in gateway/src/services/promptBuilder.ts
    - Input: CondensedContextDto[], maxDtoCount, maxJsonChars
    - Output: { dtos: CondensedContextDto[], truncated: boolean }
    - Implement priority-based truncation
    - Identify interface-referenced entities for priority tier 2
  - [x] 8.3 Implement priority tier assignment
    - Priority 1: interface_contract DTOs
    - Priority 2: entity_and_attributes referenced by interface schemas
    - Priority 3: service_slice DTOs
    - Priority 4: unreferenced entity_and_attributes DTOs
    - Priority 5: diagram_summary DTOs
  - [x] 8.4 Implement truncation within priority tiers
    - Remove from end of sorted list when truncating within a tier
    - Track JSON character count during truncation
  - [x] 8.5 Ensure truncation tests pass
    - Run ONLY the 4-6 tests written in 8.1
    - Verify priority ordering
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Respects maxDtoCount limit (default 50)
- Respects maxJsonChars limit (default 40000)
- Truncation follows priority order from spec
- Deterministic truncation (same input = same output)

### Prompt Formatting Layer

#### Task Group 9: Condensed Context Section Formatter
**Dependencies:** Task Groups 7, 8

- [x] 9.0 Complete condensed context section formatter
  - [x] 9.1 Write 3-5 focused tests for formatCondensedContextSection()
    - Test instruction header is included
    - Test DTOs are pretty-printed JSON (2-space indent)
    - Test "[TRUNCATED]" marker appears when truncated=true
    - Test empty DTOs returns "No items highlighted by user."
    - Test output character count is within maxJsonChars
  - [x] 9.2 Create formatCondensedContextSection() in gateway/src/services/promptBuilder.ts
    - Input: CondensedContextDto[], truncated boolean
    - Output: string
    - Include instruction header per spec
    - JSON.stringify(dtos, null, 2) for pretty-printing
    - Add truncation warning if truncated=true
  - [x] 9.3 Define instruction header constant
    - "The following DTOs summarize the architecture context highlighted for this feature. Use these as the source of truth for entity names, attributes, endpoints, and relationships. Do not invent entities or relationships not present in these DTOs."
  - [x] 9.4 Ensure formatter tests pass
    - Run ONLY the 3-5 tests written in 9.1
    - Verify header and formatting
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Includes instruction header from spec
- Pretty-prints DTOs as JSON with 2-space indent
- Shows truncation marker when truncated=true
- Falls back gracefully for empty input

### Integration Layer

#### Task Group 10: Chat Route Integration
**Dependencies:** Task Groups 8, 9

- [x] 10.0 Complete chat route integration
  - [x] 10.1 Write 4-6 focused tests for integration
    - Test condensed DTOs used when mode=implement_feature, phase=refine, and resolvedContext exists
    - Test bootstrap phase uses existing formatting (no condensed DTOs)
    - Test handoff phase uses existing formatting (no condensed DTOs)
    - Test mode=oas_assistant unaffected
    - Test fallback to "No items highlighted by user" when no resolvedContext
    - Test condensed section replaces verbose "HIGHLIGHTED FEATURE CONTEXT" section
  - [x] 10.2 Update buildImplementPlannerPrompt() in gateway/src/services/promptBuilder.ts
    - Check if resolvedContext is ExpandResolveResponseDto with resolved_relationships
    - Call buildCondensedContextDtos() and applyTruncation() when conditions met
    - Call formatCondensedContextSection() to generate the context string
    - Replace {resolvedContext} placeholder with condensed section
  - [x] 10.3 Add shouldUseCondensedContext() helper function
    - Return true when phase=refine and resolvedContext has resolved_relationships
    - Return false for bootstrap, handoff, or missing context
  - [x] 10.4 Wire up config for truncation limits
    - Pass config.condensedContext.maxDtoCount to applyTruncation()
    - Pass config.condensedContext.maxJsonChars to applyTruncation()
  - [x] 10.5 Update IMPLEMENT_PLANNER_PROMPT_TEMPLATE if needed
    - Change section header from "RESOLVED ARCHITECTURE CONTEXT" to "HIGHLIGHTED FEATURE CONTEXT (CONDENSED)" when using condensed DTOs
  - [x] 10.6 Ensure integration tests pass
    - Run ONLY the 4-6 tests written in 10.1
    - Verify phase-based routing
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Condensed DTOs used for mode=implement_feature, phase=refine
- Bootstrap and handoff phases unchanged
- oas_assistant mode unchanged
- Config values control truncation limits

### Testing

#### Task Group 11: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-10

- [x] 11.0 Review existing tests and fill critical gaps only
  - [x] 11.1 Review tests from Task Groups 1-10
    - Review the 4-6 type definition tests (Task 1.1)
    - Review the 2-4 configuration tests (Task 2.1)
    - Review the 3-5 entity builder tests (Task 3.1)
    - Review the 3-5 interface builder tests (Task 4.1)
    - Review the 3-5 service builder tests (Task 5.1)
    - Review the 2-3 diagram builder tests (Task 6.1)
    - Review the 3-5 aggregation tests (Task 7.1)
    - Review the 4-6 truncation tests (Task 8.1)
    - Review the 3-5 formatter tests (Task 9.1)
    - Review the 4-6 integration tests (Task 10.1)
    - Total existing tests: approximately 30-50 tests
  - [x] 11.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus on edge cases in DTO transformation
    - Verify de-duplication edge cases (same entity from multiple bundles)
    - Verify truncation priority edge cases
  - [x] 11.3 Write up to 8 additional strategic tests maximum
    - Add end-to-end test: full ExpandResolveResponseDto to condensed prompt section
    - Add edge case test: entity referenced by multiple interfaces
    - Add edge case test: maxDtoCount exactly at limit
    - Add edge case test: maxJsonChars boundary
    - Add regression test: existing formatHighlightedContext() still works for non-refine phases
    - Skip exhaustive edge case coverage for all scenarios
  - [x] 11.4 Run feature-specific tests only
    - Run ONLY tests related to condensed context DTOs
    - Expected total: approximately 38-58 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (69 tests passing)
- Critical user workflows for condensed context DTOs are covered
- No more than 8 additional tests added when filling gaps
- Existing formatHighlightedContext() behavior preserved for bootstrap/handoff

## Execution Order

Recommended implementation sequence:

1. **Type Definitions Layer** (Task Group 1)
   - Define all DTO interfaces first as foundation for builders

2. **Configuration Layer** (Task Group 2)
   - Add config before builders need to reference limits

3. **DTO Builder Layer** (Task Groups 3, 4, 5, 6 - can be parallelized)
   - Build individual DTO builders independently
   - Each builder has clear input/output contract

4. **Aggregation and Truncation Layer** (Task Groups 7, 8)
   - Task Group 7 depends on all builders
   - Task Group 8 depends on aggregation

5. **Prompt Formatting Layer** (Task Group 9)
   - Depends on truncation to know if truncated flag is set

6. **Integration Layer** (Task Group 10)
   - Final wiring into chat route
   - Depends on all previous groups

7. **Test Review and Gap Analysis** (Task Group 11)
   - Final validation after all implementation complete

## Files to Modify

| File | Changes |
|------|---------|
| `gateway/src/types/chat.ts` | Add 4 DTO interfaces, union type, helper types |
| `gateway/src/types/index.ts` | Export new DTO types |
| `gateway/src/config.ts` | Add CondensedContextConfig interface and loading |
| `gateway/src/services/promptBuilder.ts` | Add 6+ new functions for building, truncating, formatting DTOs |
| `gateway/src/__tests__/condensed-context-dtos.test.ts` | New test file for all condensed DTO tests |

## Key Technical Decisions

1. **Stable ID Format**: Use "entityType::entityId" for de-duplication
2. **Truncation Priority**: interface_contract > referenced entities > service_slice > unreferenced entities > diagrams
3. **De-duplication Strategy**: Group by (kind, id), merge arrays, prefer non-null values
4. **Determinism**: Sort by kind then id before truncation for reproducible results
5. **Backward Compatibility**: formatHighlightedContext() preserved for bootstrap/handoff phases

## Implementation Summary

All 11 task groups have been implemented:

- **Task Group 1**: Added `EntityAndAttributesDto`, `InterfaceContractDto`, `ServiceSliceDto`, `DiagramSummaryDto` interfaces with helper types (`AttributeInfo`, `EndpointInfo`, `EntityRelationshipInfo`, `ServiceDependencyInfo`) and `CondensedContextDto` union type to `gateway/src/types/chat.ts`
- **Task Group 2**: Added `CondensedContextConfig` interface to `gateway/src/config.ts` with `maxDtoCount` (default 50) and `maxJsonChars` (default 40000) settings, supporting env var overrides
- **Task Group 3**: Implemented `buildEntityAndAttributesDtos()` function to extract data entities with attributes and relationships
- **Task Group 4**: Implemented `buildInterfaceContractDtos()` function to extract interfaces with endpoints and schema references
- **Task Group 5**: Implemented `buildServiceSliceDtos()` function to extract services with containment hierarchy and exposed interfaces
- **Task Group 6**: Implemented `buildDiagramSummaryDtos()` function to extract diagram summaries with referenced entity names
- **Task Group 7**: Implemented `buildCondensedContextDtos()` aggregator with de-duplication and deterministic sorting
- **Task Group 8**: Implemented `applyTruncation()` with priority-based truncation respecting both count and character limits
- **Task Group 9**: Implemented `formatCondensedContextSection()` with instruction header and truncation marker
- **Task Group 10**: Integrated condensed DTOs into `buildImplementPlannerPrompt()` for phase=refine, added `shouldUseCondensedContext()` helper
- **Task Group 11**: Created comprehensive test suite with 69 passing tests in `gateway/src/__tests__/condensed-context-dtos.test.ts`
