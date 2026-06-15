# Task Breakdown: Fix UI Characteristics Type Dropdown Crash

## Overview
Total Tasks: 8 (2 main task groups with sub-tasks)

This is a small frontend-only bug fix with an optional improvement. Part A fixes the crash, Part B adds human-friendly label display.

## Files to Modify

| File | Purpose |
|------|---------|
| `frontend/src/config/gridConfigs.ts` | Part A: Fix options format on line 390 |
| `frontend/src/types/config.ts` | Part B: Add `formatOptionLabel` to GridColumnConfig |
| `frontend/src/components/Grid/GridCell.tsx` | Part B: Add `formatOptionLabel` prop to DropdownCell |

## Task List

### Part A: Bug Fix

#### Task Group 1: Fix Dropdown Options Format
**Dependencies:** None

- [x] 1.0 Complete Part A bug fix
  - [x] 1.1 Verify existing test baseline
    - Run existing UI characteristics test to confirm current failure state
    - Test file: `frontend/src/__tests__/ui-characteristics.test.ts`
    - Expected: Test may pass (checks option count) but runtime crashes when adding row
  - [x] 1.2 Fix options format in gridConfigs.ts
    - File: `frontend/src/config/gridConfigs.ts`
    - Line 390: Change `options: uiCharacteristicTypeOptions` to `options: uiCharacteristicTypeOptions.map(o => o.value)`
    - This matches the established pattern used on lines 132, 136-137 (endpointTypeOptions, endpointDirectionOptions, endpointLifecycleStatusOptions)
  - [x] 1.3 Verify Part A fix
    - Run UI characteristics tests to confirm they still pass
    - Manually verify "Add Row" no longer crashes (if dev server available)
    - Options should now be: `['business_feature', 'ui_capability', 'interaction_complexity', 'technical_shape']`

**Acceptance Criteria:**
- "Add Row" in UI Characteristics grid no longer throws "Objects are not valid as a React child" error
- Type dropdown displays 4 options (as snake_case strings)
- Existing tests continue to pass
- Selected values are stored correctly as snake_case strings

---

### Part B: Pretty Label Display

#### Task Group 2: Implement formatOptionLabel Enhancement
**Dependencies:** Task Group 1

- [x] 2.0 Complete Part B enhancement
  - [x] 2.1 Add formatOptionLabel to GridColumnConfig type
    - File: `frontend/src/types/config.ts`
    - Add to `GridColumnConfig` interface (after line 154):
      ```typescript
      /**
       * Spec 2026-01-20: Fix UI Characteristics Type Dropdown Crash
       * Optional formatter to convert option values to display labels.
       * Used with 'dropdown' cellType to show human-friendly labels
       * while storing the original value.
       * Example: (value) => value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
       */
      formatOptionLabel?: (value: string) => string;
      ```
  - [x] 2.2 Create snakeCaseToTitleCase helper function
    - File: `frontend/src/components/Grid/GridCell.tsx`
    - Add helper function near top of file (before component definitions):
      ```typescript
      /**
       * Spec 2026-01-20: Fix UI Characteristics Type Dropdown Crash
       * Converts snake_case strings to Title Case for display.
       * Example: "business_feature" -> "Business Feature"
       */
      export function snakeCaseToTitleCase(value: string): string {
        return value
          .split('_')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      }
      ```
  - [x] 2.3 Update DropdownCellProps interface
    - File: `frontend/src/components/Grid/GridCell.tsx`
    - Line 377-382: Add optional `formatOptionLabel` prop:
      ```typescript
      interface DropdownCellProps {
        value: string;
        options: string[];
        onChange: (value: string) => void;
        error?: ValidationError;
        formatOptionLabel?: (value: string) => string;
      }
      ```
  - [x] 2.4 Update DropdownCell component implementation
    - File: `frontend/src/components/Grid/GridCell.tsx`
    - Line 384: Add `formatOptionLabel` to destructured props with default identity function
    - Line 394-396: Apply formatOptionLabel to displayed text while keeping value unchanged:
      ```typescript
      <option key={option} value={option}>
        {formatOptionLabel ? formatOptionLabel(option) : option}
      </option>
      ```
  - [x] 2.5 Pass formatOptionLabel from GridCell to DropdownCell
    - File: `frontend/src/components/Grid/GridCell.tsx`
    - Line 165-173: In the `case 'dropdown':` branch, pass `column.formatOptionLabel`:
      ```typescript
      case 'dropdown':
        return (
          <DropdownCell
            value={value as string}
            options={column.options || []}
            onChange={onChange}
            error={error}
            formatOptionLabel={column.formatOptionLabel}
          />
        );
      ```
  - [x] 2.6 Apply formatOptionLabel to UI Characteristics Type column
    - File: `frontend/src/config/gridConfigs.ts`
    - Import snakeCaseToTitleCase at top of file
    - Line 390: Add `formatOptionLabel: snakeCaseToTitleCase` to the Type column config:
      ```typescript
      { field: 'type', displayName: 'Type', cellType: 'dropdown', required: true, width: 180, options: uiCharacteristicTypeOptions.map(o => o.value), formatOptionLabel: snakeCaseToTitleCase },
      ```
  - [x] 2.7 Verify Part B implementation
    - Run all UI characteristics tests to confirm they pass
    - Verify Type dropdown displays "Business Feature", "UI Capability", "Interaction Complexity", "Technical Shape"
    - Verify selected value is stored as snake_case (e.g., "business_feature")
    - Verify other dropdowns (without formatOptionLabel) continue to work unchanged

**Acceptance Criteria:**
- `formatOptionLabel` prop is optional and backward-compatible
- UI Characteristics Type dropdown displays human-friendly labels:
  - "business_feature" displays as "Business Feature"
  - "ui_capability" displays as "UI Capability"
  - "interaction_complexity" displays as "Interaction Complexity"
  - "technical_shape" displays as "Technical Shape"
- Stored values remain as snake_case strings (no data format change)
- Existing dropdowns without `formatOptionLabel` continue to display raw values
- All existing tests pass

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1** (Part A: Bug Fix) - Must be completed first
   - This fixes the crash and unblocks testing of Part B

2. **Task Group 2** (Part B: Pretty Labels) - Enhancement
   - Builds on Part A fix
   - Can be skipped if time-constrained (Part A alone fixes the crash)

## Testing Notes

- Existing test file: `frontend/src/__tests__/ui-characteristics.test.ts`
- Test on line 111-117 expects `typeColumn?.options` to have length 4
- After Part A: Options will be `['business_feature', 'ui_capability', 'interaction_complexity', 'technical_shape']` (length 4 - test passes)
- After Part B: Display changes but stored values unchanged - test continues to pass
- No new tests required per requirements (existing tests are sufficient)

## Code Reference Summary

### Existing Pattern (lines 132, 136-137 in gridConfigs.ts)
```typescript
options: endpointTypeOptions.map(o => o.value)
options: endpointDirectionOptions.map(o => o.value)
options: endpointLifecycleStatusOptions.map(o => o.value)
```

### Current Broken Code (line 390 in gridConfigs.ts)
```typescript
options: uiCharacteristicTypeOptions  // WRONG: passes {value, label}[] instead of string[]
```

### Fixed Code (line 390 after Part A)
```typescript
options: uiCharacteristicTypeOptions.map(o => o.value)  // CORRECT: passes string[]
```

### Enhanced Code (line 390 after Part B)
```typescript
options: uiCharacteristicTypeOptions.map(o => o.value), formatOptionLabel: snakeCaseToTitleCase
```
