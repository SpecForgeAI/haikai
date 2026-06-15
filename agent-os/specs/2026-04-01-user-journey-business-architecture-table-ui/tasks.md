# Task Breakdown: User Journey & Activity Step Business Architecture Table UI

## Overview
Total Tasks: 22 (across 4 task groups)

This is a frontend-only, configuration-driven spec. The backend entities, TypeScript interfaces, EntityType union values, MetaModelEntities arrays, defaults, sanitization, and validation display-name mappings are all already in place. The work focuses on grid column configs, tab registration, domain groupings, createEmptyEntity cases, and validation wiring.

## Key Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/config/gridConfigs.ts` | Grid column configs, tab registration, domain groupings |
| `frontend/src/components/Grid/Grid.tsx` | `createEmptyEntity` switch cases |
| `frontend/src/utils/validation.ts` | Add entity types to `validateModel` entityTypes array, sequence_order validation |

## Task List

### Grid Configuration & Tab Registration

#### Task Group 1: Grid Column Configs and Tab Wiring
**Dependencies:** None
**Spec References:** FR1, FR2, FR3, FR7

This group covers all changes to `frontend/src/config/gridConfigs.ts` -- the grid column definitions for both new entity types plus the four registration points that wire them into the Business domain tab strip.

- [x] 1.0 Complete grid configuration and tab registration
  - [x] 1.1 Write 6 focused tests for grid config and tab registration
    - Test file: `frontend/src/__tests__/user-journey-activity-step-grid-config.test.ts`
    - Import `gridConfigs`, `tabToEntityType`, `entityTabNames`, `domainGroupings`, `DOMAIN_ENTITY_TYPES` from `../config/gridConfigs`
    - Test 1: `gridConfigs.user_journeys` is defined and has 6 columns with correct field names in order: `['id', 'name', 'description', 'primary_business_user_id', 'parent_business_process_id', 'tags']`
    - Test 2: `gridConfigs.activity_steps` is defined and has 9 columns with correct field names in order: `['id', 'user_journey_id', 'name', 'description', 'sequence_order', 'process_activity_id', 'business_user_id', 'application_id', 'tags']`
    - Test 3: Verify FK columns on `user_journeys` -- `primary_business_user_id` has `cellType: 'fk_typeahead'`, `fkTarget: 'business_users'`, `required: false`; `parent_business_process_id` has `cellType: 'fk_typeahead'`, `fkTarget: 'business_processes'`, `required: false`
    - Test 4: Verify all four FK columns on `activity_steps` have `cellType: 'fk_typeahead'`, `required: true`, and correct `fkTarget` values (`user_journeys`, `process_activities`, `business_users`, `applications` respectively)
    - Test 5: `tabToEntityType` contains `'User Journeys': 'user_journeys'` and `'Activity Steps': 'activity_steps'`; `entityTabNames` contains both; `domainGroupings.business` equals `['Users', 'Processes', 'Activities', 'User Journeys', 'Activity Steps']`
    - Test 6: `DOMAIN_ENTITY_TYPES.business` contains `'user_journeys'` and `'activity_steps'` (alongside existing `business_users`, `business_processes`, `process_activities`, `business_points`)
    - Follow the existing test pattern from `frontend/src/__tests__/gridConfigs-interactions-tab.test.ts`
  - [x] 1.2 Add `user_journeys` grid column config to `gridConfigs` in `frontend/src/config/gridConfigs.ts`
    - Insert after `business_processes` config (or alongside other Business domain configs)
    - 6 columns: `id` (text, required, width 120, autoGenerate), `name` (text, required, width 200), `description` (text, optional, width 250), `primary_business_user_id` (fk_typeahead, optional, width 180, fkTarget `business_users`), `parent_business_process_id` (fk_typeahead, optional, width 180, fkTarget `business_processes`), `tags` (tags, optional, width 150)
    - Use `process_activities` config (line 58) as the template for FK column structure
  - [x] 1.3 Add `activity_steps` grid column config to `gridConfigs` in `frontend/src/config/gridConfigs.ts`
    - Insert after `user_journeys` config
    - 9 columns: `id` (text, required, width 120, autoGenerate), `user_journey_id` (fk_typeahead, required, width 180, fkTarget `user_journeys`), `name` (text, required, width 200), `description` (text, optional, width 250), `sequence_order` (text, optional, width 100), `process_activity_id` (fk_typeahead, required, width 180, fkTarget `process_activities`), `business_user_id` (fk_typeahead, required, width 180, fkTarget `business_users`), `application_id` (fk_typeahead, required, width 180, fkTarget `applications`), `tags` (tags, optional, width 150)
    - Note: `sequence_order` uses `cellType: 'text'` with `required: false`, matching `process_activities` pattern (line 64)
    - Note: `application_id` is a cross-domain FK referencing Application domain; `TypeaheadCell` already supports this
  - [x] 1.4 Add tab registration entries in `frontend/src/config/gridConfigs.ts`
    - In `tabToEntityType` (~line 560): add `'User Journeys': 'user_journeys'` and `'Activity Steps': 'activity_steps'`
    - In `entityTabNames` (~line 613): append `'User Journeys'` and `'Activity Steps'`
    - In `domainGroupings.business` (~line 652): change from `['Users', 'Processes', 'Activities']` to `['Users', 'Processes', 'Activities', 'User Journeys', 'Activity Steps']`
    - In `DOMAIN_ENTITY_TYPES.business` (~line 673): add `'user_journeys'` and `'activity_steps'` to the array
  - [x] 1.5 Verify `ENTITY_TYPE_DISPLAY_NAMES` (FR7 -- verification only, no code change)
    - Confirm that `frontend/src/utils/validation.ts` lines 64-65 already contain `'user_journeys': 'USER_JOURNEY'` and `'activity_steps': 'ACTIVITY_STEP'`
    - This is a read-only verification step; no changes should be made
  - [x] 1.6 Run Task Group 1 tests
    - Run ONLY: `frontend/src/__tests__/user-journey-activity-step-grid-config.test.ts`
    - All 6 tests must pass
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- `gridConfigs.user_journeys` has 6 columns with correct field names, cell types, required flags, and fkTarget values
- `gridConfigs.activity_steps` has 9 columns with correct field names, cell types, required flags, and fkTarget values
- Both entity types appear in `tabToEntityType`, `entityTabNames`, `domainGroupings.business`, and `DOMAIN_ENTITY_TYPES.business`
- `ENTITY_TYPE_DISPLAY_NAMES` already contains both entity type mappings (verified, not changed)
- All 6 tests in Task 1.1 pass

---

### Empty Entity Creation

#### Task Group 2: createEmptyEntity Switch Cases
**Dependencies:** Task Group 1 (grid configs must exist for context, though technically independent)
**Spec References:** FR4

This group adds the two new cases to the `createEmptyEntity` function in `Grid.tsx`. This is the only change needed in Grid.tsx; the main rendering logic, DnD, search, Add Row, and Delete Row are fully generic and require no modifications.

- [x] 2.0 Complete empty entity creation
  - [x] 2.1 Write 4 focused tests for createEmptyEntity
    - Test file: `frontend/src/__tests__/user-journey-activity-step-create-entity.test.ts`
    - Since `createEmptyEntity` is a module-level function in `Grid.tsx`, either: (a) export it for testing, or (b) test indirectly. The preferred approach is to extract and export `createEmptyEntity` if it is not already exported, or test via the grid component behavior. If direct import is impractical, write the tests as behavioral assertions on the Grid component's Add Row output.
    - Test 1: `createEmptyEntity('user_journeys')` returns an object with keys `id`, `name`, `description`, `tags`, `primary_business_user_id`, `parent_business_process_id`; `name`, `description`, `tags` are `''`; FK fields are `''`; `id` is a non-empty string
    - Test 2: `createEmptyEntity('activity_steps')` returns an object with keys `id`, `user_journey_id`, `name`, `description`, `tags`, `sequence_order`, `process_activity_id`, `business_user_id`, `application_id`; string fields are `''`; `sequence_order` is `undefined`; `id` is a non-empty string
    - Test 3: `createEmptyEntity('user_journeys')` does NOT include unexpected extra fields (no `sequence_order`, no `application_id`, etc.)
    - Test 4: `createEmptyEntity('activity_steps')` has exactly 9 keys (no missing, no extra)
  - [x] 2.2 Add `'user_journeys'` case to `createEmptyEntity` in `frontend/src/components/Grid/Grid.tsx` (~line 820)
    - Return: `{ ...baseEntity, primary_business_user_id: '', parent_business_process_id: '' }`
    - `baseEntity` already provides `id`, `name: ''`, `description: ''`, `tags: ''`
    - Follow the pattern of simple cases like `business_users` / `business_processes` (line 821-824)
  - [x] 2.3 Add `'activity_steps'` case to `createEmptyEntity` in `frontend/src/components/Grid/Grid.tsx`
    - Return: `{ ...baseEntity, user_journey_id: '', sequence_order: undefined, process_activity_id: '', business_user_id: '', application_id: '' }`
    - FK string fields default to `''`, optional numeric field `sequence_order` defaults to `undefined`
    - Follow the pattern of `process_activities` case (line 912-918) for FK + optional field defaults
  - [x] 2.4 Run Task Group 2 tests
    - Run ONLY: `frontend/src/__tests__/user-journey-activity-step-create-entity.test.ts`
    - All 4 tests must pass
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- `createEmptyEntity('user_journeys')` produces correct default entity with all 6 fields
- `createEmptyEntity('activity_steps')` produces correct default entity with all 9 fields, `sequence_order` is `undefined`
- Both cases generate a non-empty `id` via `generateEntityId`
- All 4 tests in Task 2.1 pass

---

### Validation Wiring

#### Task Group 3: Validation Registration and sequence_order Check
**Dependencies:** Task Group 1 (grid configs must exist since the validation loop reads column definitions from `gridConfigs`)
**Spec References:** FR5, FR6

This group wires both entity types into the generic validation loop and adds the `sequence_order` positive-integer check for activity steps.

- [x] 3.0 Complete validation wiring
  - [x] 3.1 Write 6 focused tests for validation behavior
    - Test file: `frontend/src/__tests__/user-journey-activity-step-validation.test.ts`
    - Import `validateModel` from `../utils/validation` and construct minimal `ArchitectureModel` fixtures
    - Test 1: A `user_journeys` entity with empty `name` produces a validation error (required field)
    - Test 2: A `user_journeys` entity with valid `name` and optional FK fields left empty produces NO validation errors
    - Test 3: An `activity_steps` entity missing required FK `user_journey_id` produces a validation error
    - Test 4: An `activity_steps` entity missing required FK `application_id` produces a validation error
    - Test 5: An `activity_steps` entity with `sequence_order` set to `'abc'` (non-numeric) produces a validation error
    - Test 6: An `activity_steps` entity with `sequence_order` set to `'3'` (valid positive integer) produces no sequence_order validation error
    - Use the existing validation test patterns from `frontend/src/__tests__/validation-error-messages.test.ts`
  - [x] 3.2 Add `'user_journeys'` and `'activity_steps'` to the `entityTypes` array in `validateModel` in `frontend/src/utils/validation.ts` (~line 1094)
    - Append both after the existing entries (e.g., after `'ui_characteristics'` on line 1119)
    - The generic validation loop already handles `validateRequiredFields` and `validateFKReferences` for any entity type with a `gridConfigs` entry; no additional wiring needed for those
  - [x] 3.3 Add `sequence_order` positive-integer validation for `activity_steps`
    - After the generic `entityTypes.forEach` loop (~line 1148), add a post-loop block for `activity_steps` similar to the existing `ProcessActivity-specific validations` block (line 1150)
    - For each `activity_steps` entity: if `sequence_order` is provided and non-empty, validate it parses to a positive integer (`Number.isInteger(parsed) && parsed > 0`)
    - On failure, emit a `ValidationError` with `entityType: 'activity_steps'`, `field: 'sequence_order'`, and a descriptive message (e.g., `'Sequence order must be a positive integer'`)
    - Use an existing error type that makes sense (e.g., `type: 'required'` or `type: 'invalid'` if available)
  - [x] 3.4 Run Task Group 3 tests
    - Run ONLY: `frontend/src/__tests__/user-journey-activity-step-validation.test.ts`
    - All 6 tests must pass
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- Both entity types are included in the `validateModel` entityTypes array
- Required-field validation fires for `user_journeys.name` and all required `activity_steps` fields
- FK referential integrity validation fires for all FK columns on both entity types
- `sequence_order` with a non-numeric or non-positive value produces a validation error
- `sequence_order` with a valid positive integer or empty/undefined produces no error
- All 6 tests in Task 3.1 pass

---

### Test Review & Integration Verification

#### Task Group 4: Test Review, Gap Analysis, and End-to-End Verification
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 6 tests from Task Group 1 (grid config and tab registration)
    - Review the 4 tests from Task Group 2 (createEmptyEntity)
    - Review the 6 tests from Task Group 3 (validation)
    - Total existing tests: 16 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify any critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Key areas to evaluate: cross-domain FK resolution for `application_id`, sequence_order edge cases (0, negative, float), domainGroupings rendering flow
  - [x] 4.3 Write up to 6 additional strategic tests maximum
    - Test file: `frontend/src/__tests__/user-journey-activity-step-integration.test.ts`
    - Potential gap-fill tests (write only if gaps are identified in 4.2):
      - `activity_steps` grid config `sequence_order` column has `cellType: 'text'` and `required: false` (matches process_activities pattern)
      - `activity_steps` grid config `application_id` column has `fkTarget: 'applications'` (cross-domain FK verification)
      - `domainGroupings.business` has exactly 5 entries in the correct order
      - `sequence_order` validation: value of `'0'` (zero, not positive) produces error
      - `sequence_order` validation: value of `'-1'` (negative) produces error
      - `sequence_order` validation: value of `'2.5'` (float) produces error
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases that are already covered by Task Groups 1-3
  - [x] 4.4 Run all feature-specific tests
    - Run ALL four test files together:
      - `frontend/src/__tests__/user-journey-activity-step-grid-config.test.ts`
      - `frontend/src/__tests__/user-journey-activity-step-create-entity.test.ts`
      - `frontend/src/__tests__/user-journey-activity-step-validation.test.ts`
      - `frontend/src/__tests__/user-journey-activity-step-integration.test.ts`
    - Expected total: approximately 22 tests (16 from groups 1-3 + up to 6 from 4.3)
    - All tests must pass
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 22 tests total)
- Critical user workflows for User Journey and Activity Step table UI are covered
- No more than 6 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Grid Column Configs and Tab Wiring** -- foundational configuration that all other groups depend on
2. **Task Group 2: createEmptyEntity Switch Cases** -- depends on grid configs for context but modifies a separate file (Grid.tsx)
3. **Task Group 3: Validation Registration and sequence_order Check** -- depends on grid configs being present (validation loop reads `gridConfigs[entityType]`)
4. **Task Group 4: Test Review & Integration Verification** -- depends on all implementation groups being complete

Task Groups 2 and 3 could technically be implemented in parallel since they modify different files, but Group 3 requires Group 1's grid configs to be in place for the validation loop to function correctly.

## Notes

- **No new components needed**: All UI is rendered through the existing `Grid` -> `GridCell` -> `TypeaheadCell` component hierarchy
- **No MetaModelView changes needed**: It reads `domainGroupings` dynamically and renders `<Grid entityType={...} />` for the selected tab
- **No ArchitectureContext changes needed**: `ADD_ENTITY`, `UPDATE_ENTITY`, `DELETE_ENTITY`, `REORDER_ENTITIES` actions are generic
- **FR6 (Standard Grid Interactions)** requires zero code changes -- all behaviors (Add Row, Delete Row, inline editing, search, drag-reorder, FK typeahead) are inherited from existing `Grid` infrastructure
- **Cross-domain FK**: `activity_steps.application_id` references Application domain entities; the existing `TypeaheadCell.getTargetEntities` function resolves `model.metaModel.entities[fkTarget]` regardless of domain, so this works automatically
