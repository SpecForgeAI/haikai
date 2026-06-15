# Task Breakdown: UX and Validation Refinements

## Overview
Total Tasks: 25 sub-tasks across 4 task groups

This feature implements four targeted UX refinements:
1. Application Point dropdown display fix (show name + entity type, not IDs)
2. Duplicate name validation per entity/relationship table
3. Palette item display simplification (name only, no IDs)
4. Palette sections collapsed by default

## Task List

### Frontend Configuration Layer

#### Task Group 1: Application Point Dropdown Display Fix
**Dependencies:** None

**Summary:** Update the FK typeahead dropdown for Application Point selection to display meaningful labels (`<Name> (<Entity Type>)`) instead of raw IDs, and ensure typeahead search works against the formatted display string.

- [x] 1.0 Complete Application Point dropdown display fix
  - [x] 1.1 Write 4-6 focused tests for dropdown display functionality
    - Test that `displayFormatter` property can be added to `GridColumnConfig`
    - Test that `formatApplicationPointDisplay()` returns correct format for each kind
    - Test that kind-to-label mapping works correctly (APPLICATION, APP_COMPONENT, SERVICE)
    - Test that typeahead filtering works against formatted display string
    - Test that IDs are not visible in dropdown options
  - [x] 1.2 Extend `GridColumnConfig` type to support display formatter
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\types\config.ts`
    - Add optional `displayFormatter?: (id: string, entities: unknown[]) => string` property to `GridColumnConfig` interface (line 42-51)
  - [x] 1.3 Create Application Point display formatter utility
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\formatters.ts` (new file)
    - Create `APPLICATION_POINT_KIND_LABELS` constant mapping:
      - `'APPLICATION'` -> `'Application'`
      - `'APP_COMPONENT'` -> `'Application Component'`
      - `'SERVICE'` -> `'Service'`
    - Create `formatApplicationPointDisplay(applicationPoint: ApplicationPoint): string`
    - Return format: `${applicationPoint.name} (${kindLabel})`
  - [x] 1.4 Update `application_point_business_processes` grid config
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\config\gridConfigs.ts`
    - Add `displayFormatter` property to `application_point_id` column (line 122)
    - Import and use the formatter from `formatters.ts`
  - [x] 1.5 Update FK typeahead component to use display formatter
    - Locate FK typeahead rendering logic (likely in grid cell component)
    - When rendering dropdown options, check for `displayFormatter` in column config
    - If present, use formatter output instead of raw ID for display
    - Update typeahead filter logic to search against formatted string, not ID
  - [x] 1.6 Ensure dropdown display tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify dropdown shows `<Name> (<Entity Type>)` format
    - Verify typeahead search works by name and entity type label
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Application Point dropdown shows options like "OMS System (Application)"
- No IDs visible in dropdown options
- Typeahead allows searching by name (e.g., "OMS") and entity type (e.g., "Service")
- FK value stored remains `application_point.id` unchanged

**Key Files:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\types\config.ts`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\config\gridConfigs.ts`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\formatters.ts` (new)

---

### Validation Layer

#### Task Group 2: Duplicate Name Validation
**Dependencies:** None (can run in parallel with Task Group 1)

**Summary:** Add per-table name uniqueness validation with case-insensitive checking, appropriate error messaging, and explicit exceptions for attribute and physical entity tables.

- [x] 2.0 Complete duplicate name validation
  - [x] 2.1 Write 4-6 focused tests for name validation functionality
    - Test case-insensitive duplicate detection ("Risk" vs "risk")
    - Test that validation returns error for duplicate names in same table
    - Test that cross-table duplicates are allowed (no error)
    - Test that exception tables (`logical_data_attributes`, `physical_data_attributes`, `physical_data_entities`) skip validation
    - Test error message is "Name must be unique within this table"
    - Test integration with `getCellValidationError()` for grid display
  - [x] 2.2 Add `'duplicate_name'` to `ValidationError` type
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\types\config.ts`
    - Update `type` field union on line 37 to include `'duplicate_name'`
    - New type union: `'required' | 'invalid_fk' | 'duplicate_id' | 'invalid_json' | 'missing_array' | 'consistency' | 'duplicate_name'`
  - [x] 2.3 Create `validateUniqueName()` function
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\validation.ts`
    - Add `DUPLICATE_NAME_EXCEPTION_TABLES` constant:
      ```typescript
      const DUPLICATE_NAME_EXCEPTION_TABLES = [
        'logical_data_attributes',
        'physical_data_attributes',
        'physical_data_entities',
      ];
      ```
    - Create function signature:
      ```typescript
      export function validateUniqueName(
        entities: AnyEntity[],
        entityType: EntityType,
        currentEntity: AnyEntity
      ): ValidationError | null
      ```
    - Implementation logic:
      1. Return `null` if `entityType` is in exception list
      2. Find all other entities with same name (case-insensitive using `.toLowerCase()`)
      3. If duplicate found, return ValidationError with:
         - `type: 'duplicate_name'`
         - `message: 'Name must be unique within this table'`
         - `field: 'name'`
      4. Return `null` if no duplicate
  - [x] 2.4 Integrate validation into entity add/update operations
    - Update grid cell editing to call `validateUniqueName()` on name field changes
    - Block save/commit when duplicate name error exists
    - Apply existing red underline/error tooltip styling pattern
  - [x] 2.5 Add duplicate name check to `validateModel()` function
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\validation.ts`
    - In `validateModel()` (line 164), after `validateUniqueIds()` call (line 188)
    - Add loop to check for duplicate names per entity type
    - Skip exception tables
  - [x] 2.6 Ensure validation tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify duplicate detection works correctly
    - Verify exception tables are properly excluded
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- Duplicate name in same table triggers validation error
- Error message reads "Name must be unique within this table"
- Save/commit blocked until duplicate resolved
- Cross-table duplicates allowed without warning
- Exception tables (`logical_data_attributes`, `physical_data_attributes`, `physical_data_entities`) allow duplicate names

**Key Files:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\types\config.ts`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\validation.ts`

---

### Frontend UI Components Layer

#### Task Group 3: Palette Item Display Simplification
**Dependencies:** None (can run in parallel with Task Groups 1 and 2)

**Summary:** Remove the ID display from palette items so only the name is shown on a single line, with ellipsis truncation for long names.

- [x] 3.0 Complete palette item display simplification
  - [x] 3.1 Write 3-4 focused tests for palette item display
    - Test that PaletteItem renders only the name, not the ID
    - Test that the ID element `<div className={styles.id}>` is not present in rendered output
    - Test that long names are truncated with ellipsis
    - Test that item remains on single line regardless of name length
  - [x] 3.2 Remove ID display from PaletteItem component
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PaletteItem.tsx`
    - Remove line 51: `<div className={styles.id}>({item.id})</div>`
    - Keep line 50: `<div className={styles.name}>{item.name}</div>`
  - [x] 3.3 Update PaletteItem CSS for single-line display with ellipsis
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PaletteItem.module.css`
    - Update `.name` class (lines 31-35) to add:
      ```css
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      ```
    - Remove `.id` class (lines 37-42) as it's no longer needed
  - [x] 3.4 Ensure palette item tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify name-only display works correctly
    - Verify ellipsis truncation for long names
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 3.1 pass
- Palette items display only name (e.g., "OMS System")
- No IDs visible below item names
- Long names truncate with ellipsis on single line

**Key Files:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PaletteItem.tsx`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PaletteItem.module.css`

---

#### Task Group 4: Palette Sections Collapsed by Default
**Dependencies:** None (can run in parallel with Task Groups 1, 2, and 3)

**Summary:** Change the default expand/collapse state for palette sections so all sections are collapsed when the diagram view first loads.

- [x] 4.0 Complete palette sections collapsed by default
  - [x] 4.1 Write 3-4 focused tests for section collapse behavior
    - Test that `isSectionExpanded()` returns `false` for unset sections
    - Test that sections are collapsed on initial diagram view load
    - Test that clicking section header toggles expand state
    - Test that expanded state persists within session after user interaction
  - [x] 4.2 Update `isSectionExpanded()` default return value
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PalettePanel.tsx`
    - Locate `isSectionExpanded()` function (lines 538-541)
    - Change from:
      ```typescript
      const isSectionExpanded = (sectionId: string): boolean => {
        return sectionExpandStates[sectionId] !== false;
      };
      ```
    - Change to:
      ```typescript
      const isSectionExpanded = (sectionId: string): boolean => {
        return sectionExpandStates[sectionId] === true;
      };
      ```
    - This ensures unset sections default to collapsed (`false`)
  - [x] 4.3 Verify TOGGLE_PALETTE_SECTION reducer works correctly
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\contexts\ArchitectureContext.tsx`
    - Verify reducer (lines 909-918) correctly toggles state:
      - When `sectionExpandStates[sectionId]` is `undefined`, toggling should set it to `true`
      - When `sectionExpandStates[sectionId]` is `false`, toggling should set it to `true`
      - When `sectionExpandStates[sectionId]` is `true`, toggling should set it to `false`
    - Current implementation: `[sectionId]: !state.sectionExpandStates[sectionId]`
    - Note: `!undefined` is `true`, so first click will expand. This is correct behavior.
  - [x] 4.4 Ensure section collapse tests pass
    - Run ONLY the 3-4 tests written in 4.1
    - Verify all sections collapsed on initial load
    - Verify toggle behavior works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 4.1 pass
- All palette sections collapsed when entering Diagram view
- Only section headers with expand/collapse triangles visible initially
- User can manually expand sections by clicking
- Expanded/collapsed state persists during session

**Key Files:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PalettePanel.tsx`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\contexts\ArchitectureContext.tsx`

---

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

**Summary:** Review tests from all task groups, identify critical gaps, and add up to 10 additional strategic tests to ensure feature completeness.

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4-6 tests written for dropdown display (Task 1.1)
    - Review the 4-6 tests written for name validation (Task 2.1)
    - Review the 3-4 tests written for palette item display (Task 3.1)
    - Review the 3-4 tests written for section collapse (Task 4.1)
    - Total existing tests: approximately 14-20 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identify any critical integration points lacking coverage
    - Focus on end-to-end user workflows for these 4 refinements
    - Do NOT assess entire application test coverage
    - Prioritize scenarios that cross component boundaries
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Potential gap areas to consider:
      - Integration test: Dropdown display + typeahead filtering working together
      - Integration test: Name validation error display in grid cell
      - Integration test: Palette section toggle persists across search filter changes
      - Edge case: Very long Application Point names with entity type label
      - Edge case: Empty state handling when no Application Points exist
    - Do NOT write exhaustive edge case coverage
    - Skip performance tests and accessibility tests unless business-critical
  - [x] 5.4 Run all feature-specific tests
    - Run ONLY tests related to this spec's four refinements
    - Expected total: approximately 20-30 tests maximum
    - Verify all critical workflows pass
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-30 tests total)
- Critical user workflows for all 4 refinements are covered
- No more than 10 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

**Phase 1: Parallel Implementation (Task Groups 1-4)**
All four task groups are independent and can be implemented in parallel by different engineers or worked on concurrently:
- Task Group 1: Application Point Dropdown Display Fix (Frontend Config)
- Task Group 2: Duplicate Name Validation (Validation Layer)
- Task Group 3: Palette Item Display Simplification (UI Component)
- Task Group 4: Palette Sections Collapsed by Default (UI Component)

**Phase 2: Test Review (Task Group 5)**
After all four task groups are complete:
- Task Group 5: Test Review and Gap Analysis

---

## Summary of Files to Modify

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/types/config.ts` | 1, 2 | Add `displayFormatter` to GridColumnConfig; add `'duplicate_name'` to ValidationError type |
| `frontend/src/config/gridConfigs.ts` | 1 | Add displayFormatter to application_point_id column |
| `frontend/src/utils/formatters.ts` | 1 | NEW FILE - Application Point display formatter |
| `frontend/src/utils/validation.ts` | 2 | Add `validateUniqueName()` function and integrate with `validateModel()` |
| `frontend/src/components/DiagramsView/PaletteItem.tsx` | 3 | Remove ID display element |
| `frontend/src/components/DiagramsView/PaletteItem.module.css` | 3 | Add ellipsis truncation; remove .id class |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | 4 | Update `isSectionExpanded()` default to false |

---

## Notes

- All changes are client-side only; no backend modifications required
- Existing styling patterns should be reused (error tooltips, section toggles)
- FK value storage remains unchanged (`application_point.id`)
- Session-only state persistence for palette expand/collapse (no localStorage)
