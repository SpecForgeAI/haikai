# Task Breakdown: Method Parameters/Returns/Throws Type-Oriented Input

## Overview
Total Tasks: 4 Task Groups

This feature replaces the current JSON-based method fields (Parameters, Returns, Throws) with type-oriented inputs that reflect real method signatures. Parameters uses free-text entry, while Returns/Throws use a new FreeTextTypeaheadSingleToken editor with meta-model derived suggestions.

## Task List

### Frontend UI Layer

#### Task Group 1: Grid Configuration and Column Header Updates
**Dependencies:** None

- [x] 1.0 Complete grid configuration updates
  - [x] 1.1 Write 3-5 focused tests for grid config and column header changes
    - Test that methods grid columns have updated displayNames ("Parameters", "Returns", "Throws")
    - Test that field names remain unchanged (`parameters_json`, `returns_json`, `throws_json`)
    - Test that `parameters_json` cellType remains 'text' (free-text entry)
    - Test that `returns_json` and `throws_json` cellTypes are 'free_text_typeahead_single_token'
    - Test file: `frontend/src/__tests__/method-params-type-oriented.test.ts`
  - [x] 1.2 Update `frontend/src/config/gridConfigs.ts` methods config
    - Change displayName for `parameters_json` from "Parameters (JSON)" to "Parameters"
    - Change displayName for `returns_json` from "Returns (JSON)" to "Returns"
    - Change displayName for `throws_json` from "Throws (JSON)" to "Throws"
    - Keep field names unchanged for backward compatibility
  - [x] 1.3 Update cellTypes in methods config
    - Keep `parameters_json` cellType as 'text' (free-text editor accepting any string)
    - Change `returns_json` cellType to 'free_text_typeahead_single_token'
    - Change `throws_json` cellType to 'free_text_typeahead_single_token'
  - [x] 1.4 Add suggestion source configuration to column config
    - Add `suggestionSources` property to `returns_json` column specifying entity types: `['logical_data_entities', 'physical_data_entities']`
    - Add `suggestionSources` property to `throws_json` column specifying entity types: `['logical_data_entities', 'physical_data_entities']`
    - Add `staticSuggestions` property to `throws_json` column with common exceptions
  - [x] 1.5 Ensure grid config tests pass
    - Run ONLY the 3-5 tests written in 1.1
    - Verify column configuration is correct

**Acceptance Criteria:**
- The 3-5 tests written in 1.1 pass
- Methods grid displays simplified column headers without "(JSON)" suffix
- Column field names remain unchanged for backward compatibility
- cellTypes are correctly configured for each column

---

#### Task Group 2: FreeTextTypeaheadSingleToken Component
**Dependencies:** Task Group 1

- [x] 2.0 Complete FreeTextTypeaheadSingleToken component
  - [x] 2.1 Write 5-8 focused tests for FreeTextTypeaheadSingleToken functionality
    - Test single-token validation (accepts "String", rejects "String name")
    - Test rejection of values containing commas
    - Test rejection of empty strings
    - Test whitespace trimming before validation
    - Test typeahead dropdown shows suggestions while typing
    - Test user can commit values not in suggestions list
    - Test inline error display for invalid values
    - Test file: `frontend/src/__tests__/method-params-type-oriented.test.ts` (append to existing)
  - [x] 2.2 Create new component at `frontend/src/components/Grid/FreeTextTypeaheadSingleToken.tsx`
    - Follow patterns from `TypeaheadCell.tsx` for dropdown mechanics
    - Follow patterns from `TextWithSuggestionsCell` for free-text input with suggestions
    - Props: `value`, `suggestions`, `onChange`, `error`, `onLabelUpdate` (optional)
  - [x] 2.3 Implement typeahead dropdown behavior
    - Show dropdown suggestions while typing
    - Filter suggestions based on input text (case-insensitive)
    - Allow clicking suggestion to populate value
    - Position dropdown above/below based on cell position (reuse TypeaheadCell pattern)
  - [x] 2.4 Implement single-token validation on blur/commit
    - Trim whitespace from input
    - Reject empty strings with inline error
    - Reject values containing whitespace characters with inline error message
    - Reject values containing commas with inline error message
    - On valid input, call onChange with trimmed value
  - [x] 2.5 Implement free-text fallback
    - Allow user to type and commit any valid single-token value
    - Do not require value to be in suggestions list
    - Commit value on Enter key or blur (if valid)
    - Revert to previous value on Escape key
  - [x] 2.6 Add inline error styling
    - Show red border on input when error state
    - Show error message tooltip on hover
    - Follow existing error styling patterns from `Grid.module.css`
  - [x] 2.7 Create CSS module if needed
    - Add `FreeTextTypeaheadSingleToken.module.css` if styles differ from existing Grid styles
    - Reuse existing styles from `Grid.module.css` where possible
  - [x] 2.8 Ensure FreeTextTypeaheadSingleToken tests pass
    - Run ONLY the 5-8 tests written in 2.1
    - Verify all validation and dropdown behaviors work correctly

**Acceptance Criteria:**
- The 5-8 tests written in 2.1 pass
- Component renders with typeahead dropdown showing suggestions
- Single-token validation correctly rejects multi-token and empty values
- Free-text values not in suggestions can be committed
- Inline errors display correctly for invalid values

---

#### Task Group 3: GridCell Integration and Suggestion Derivation
**Dependencies:** Task Group 2

- [x] 3.0 Complete GridCell integration
  - [x] 3.1 Write 4-6 focused tests for GridCell integration and suggestion derivation
    - Test GridCell renders FreeTextTypeaheadSingleToken for 'free_text_typeahead_single_token' cellType
    - Test Returns column receives suggestions from logical_data_entities and physical_data_entities
    - Test Throws column receives suggestions from logical/physical entities plus hardcoded exceptions
    - Test suggestion derivation extracts 'name' field from entities
    - Test file: `frontend/src/__tests__/method-params-type-oriented.test.ts` (append to existing)
  - [x] 3.2 Update `frontend/src/components/Grid/GridCell.tsx` switch statement
    - Add case for 'free_text_typeahead_single_token' cellType
    - Import FreeTextTypeaheadSingleToken component
    - Pass column config including suggestionSources and staticSuggestions
  - [x] 3.3 Implement suggestion derivation logic
    - Read entity types from column.suggestionSources array
    - For each entity type, get entities from `model.metaModel.entities[entityType]`
    - Extract 'name' field from each entity
    - Combine with column.staticSuggestions if present
    - Deduplicate and sort suggestions alphabetically
  - [x] 3.4 Create static exception suggestions constant
    - Create `frontend/src/config/commonExceptionSuggestions.ts`
    - Export `COMMON_EXCEPTION_SUGGESTIONS` array with: ["RuntimeException", "IllegalArgumentException", "IllegalStateException", "NullPointerException", "Exception"]
    - Follow pattern from `businessLogicTypeSuggestions.ts`
  - [x] 3.5 Update GridColumnConfig type in `frontend/src/types/config.ts`
    - Add optional `suggestionSources?: string[]` property for entity-derived suggestions
    - Add optional `staticSuggestions?: string[]` property for hardcoded suggestions
  - [x] 3.6 Ensure GridCell integration tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify suggestions are correctly derived and passed to component

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- GridCell correctly routes to FreeTextTypeaheadSingleToken for new cellType
- Returns suggestions include names from logical and physical data entities
- Throws suggestions include entity names plus hardcoded common exceptions

---

#### Task Group 4: Legacy JSON Compatibility and Backend Verification
**Dependencies:** Task Groups 1-3

- [x] 4.0 Complete legacy compatibility and backend verification
  - [x] 4.1 Write 4-6 focused tests for legacy JSON compatibility
    - Test display rendering of legacy JSON strings (starting with "{" or "[") shows raw string
    - Test Parameters field auto-converts JSON array to "Type name, Type2 name2" format
    - Test Returns/Throws fields extract "type" or "name" field from JSON object
    - Test parse errors do not block rendering (graceful degradation)
    - Test file: `frontend/src/__tests__/method-params-type-oriented.test.ts` (append to existing)
  - [x] 4.2 Implement legacy JSON detection in display rendering
    - In FreeTextTypeaheadSingleToken and TextCell display mode
    - Detect if stored value starts with "{" or "["
    - If JSON-like, display raw string without crashing
  - [x] 4.3 Implement best-effort auto-convert on edit for Parameters
    - Detect if value is JSON array on edit initiation
    - Try to parse and extract type-name pairs
    - Join as "Type name, Type2 name2" format
    - On parse failure, fall back to raw string
  - [x] 4.4 Implement best-effort auto-convert on edit for Returns/Throws
    - Detect if value is JSON object on edit initiation
    - Try to parse and extract "type" or "name" field
    - Use extracted value as initial edit value
    - On parse failure, fall back to raw string
  - [x] 4.5 Verify backend DTO/Entity compatibility
    - Confirm `MethodDto` uses String types for parametersJson, returnsJson, throwsJson (already verified)
    - Confirm `MethodEntity` uses @Type(JsonType.class) for JSONB column mapping (already verified)
    - No backend changes needed since JSONB accepts quoted strings
  - [x] 4.6 Verify database schema compatibility
    - Confirm JSONB columns in `002-classes-methods.sql` can accept plain strings
    - JSONB accepts quoted strings as valid JSON values
    - No migration needed
  - [x] 4.7 Ensure legacy compatibility tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify legacy JSON values render and convert correctly

**Acceptance Criteria:**
- The 4-6 tests written in 4.1 pass
- Legacy JSON strings display without errors
- Best-effort auto-conversion works for common JSON formats
- Backend persists string values without modification
- No database migration required

---

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 3-5 tests from Task Group 1 (grid config)
    - Review the 5-8 tests from Task Group 2 (FreeTextTypeaheadSingleToken)
    - Review the 4-6 tests from Task Group 3 (GridCell integration)
    - Review the 4-6 tests from Task Group 4 (legacy compatibility)
    - Total existing tests: approximately 16-25 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to method params type-oriented input
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 5.3 Write up to 8 additional backend tests maximum
    - Test saveModel persists plain string values for parameters/returns/throws
    - Test snapshot export includes string values correctly
    - Test snapshot import accepts string values
    - Test legacy JSON object/array payloads are handled gracefully
    - Test file: `architecture-model-service/src/test/java/com/example/architecturemodel/service/MethodParamsTypeOrientedTest.java`
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Frontend: `npm test -- --testPathPattern="method-params-type-oriented"`
    - Backend: Run new MethodParamsTypeOrientedTest class
    - Expected total: approximately 24-33 tests maximum
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-33 tests total)
- Critical user workflows for this feature are covered
- No more than 8 additional backend tests added
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Grid Configuration** - Update column headers and cellTypes in gridConfigs.ts
2. **Task Group 2: FreeTextTypeaheadSingleToken** - Create new editor component with single-token validation
3. **Task Group 3: GridCell Integration** - Wire new component into GridCell and implement suggestion derivation
4. **Task Group 4: Legacy Compatibility** - Handle JSON backward compatibility and verify backend
5. **Task Group 5: Test Review** - Fill any critical test gaps and run final verification

## Files to Create/Modify

### New Files
- `frontend/src/components/Grid/FreeTextTypeaheadSingleToken.tsx`
- `frontend/src/config/commonExceptionSuggestions.ts`
- `frontend/src/__tests__/method-params-type-oriented.test.ts`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/MethodParamsTypeOrientedTest.java`

### Modified Files
- `frontend/src/config/gridConfigs.ts` (methods config updates)
- `frontend/src/components/Grid/GridCell.tsx` (add new cellType case)
- `frontend/src/types/config.ts` (add suggestionSources, staticSuggestions to GridColumnConfig)

### Files to Verify (No Changes Expected)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/MethodDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/MethodEntity.java`
- `architecture-model-service/src/main/resources/db/changelog/sql/002-classes-methods.sql`

## Key Reference Files

- `frontend/src/components/Grid/TypeaheadCell.tsx` - Dropdown typeahead pattern to follow
- `frontend/src/components/Grid/GridCell.tsx` - TextWithSuggestionsCell pattern (lines 327-429)
- `frontend/src/config/businessLogicTypeSuggestions.ts` - Static suggestions pattern to follow
- `frontend/src/types/config.ts` - GridColumnConfig type definition
