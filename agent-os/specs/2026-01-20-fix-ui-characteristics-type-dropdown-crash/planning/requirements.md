# Spec Requirements: Fix UI Characteristics Type Dropdown Crash

## Initial Description

Fix the runtime crash when clicking "Add Row" in the UI Characteristics grid, plus add pretty label display for dropdown options.

**Goals:**
1. Fix the runtime crash when clicking "Add Row" in the UI Characteristics grid.
2. Optional improvement: Keep dropdown option values as strings, but display human-friendly labels in the dropdown UI (e.g. "Business Feature" instead of "business_feature"), without changing the stored value.

**Root Cause:**
DropdownCell expects `options: string[]` and renders `<option>{option}</option>`.
UI Characteristics passed `options` as `{value,label}[]`, so React attempted to render objects, causing:
- "Objects are not valid as a React child (found: object with keys {value, label})"
- duplicate key warnings (key becomes "[object Object]")

**Scope:** Frontend only (no backend changes).

## Requirements Discussion

### First Round Questions

**Q1: Fix Approach** - For Part A (the bug fix), I assume we should follow the established pattern for dropdown options. Looking at the existing code, other dropdowns use `.map(o => o.value)` to convert option objects to string arrays. Should we:
a) Follow this pattern to convert `uiCharacteristicTypeOptions` to `string[]` in gridConfigs.ts?
b) A different approach?

**Answer:** Yes - follow the established pattern using `.map(o => o.value)` to convert uiCharacteristicTypeOptions to string[] in gridConfigs.ts

**Q2: Part B (Pretty Labels)** - For Part B (optional improvement to show human-friendly labels), I have two options:
a) Skip Part B entirely - just fix the crash and display raw values like "business_feature"
b) Include Part B - implement backward-compatible changes to DropdownCell to support a `formatOptionLabel` prop that converts snake_case to Title Case (e.g., "business_feature" -> "Business Feature")

Which approach?

**Answer:** B - Include Part B with backward-compatible changes to DropdownCell. Implement a formatOptionLabel helper that converts snake_case strings to human-friendly Title Case labels (e.g., "business_feature" -> "Business Feature")

**Q3: Test Coverage** - For testing, should we:
a) Verify existing tests still pass (the test expects length 4 which should remain valid)
b) Add specific new tests for the formatOptionLabel helper
c) Both

**Answer:** a - Verify existing tests need no changes (the test expects length 4, which will still pass)

**Q4: Out of Scope** - Is there anything else you want to explicitly exclude from this fix (e.g., changes to other grids, changes to how options are defined in uiCharacteristicTypes.ts)?

**Answer:** Nothing else - the scope as defined is complete

### Existing Code to Reference

No similar existing features identified for reference. The fix will follow established patterns already present in gridConfigs.ts for other dropdown columns.

### Follow-up Questions

None required - user provided clear, complete answers.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
Not applicable - this is a bug fix with clear technical requirements.

## Requirements Summary

### Functional Requirements

- Fix the runtime crash in UI Characteristics grid when clicking "Add Row"
- Convert `uiCharacteristicTypeOptions` from `{value, label}[]` to `string[]` using `.map(o => o.value)` pattern
- Implement a `formatOptionLabel` helper function to convert snake_case strings to Title Case
- Make DropdownCell backward-compatible by accepting an optional `formatOptionLabel` prop
- Display human-friendly labels in the dropdown UI (e.g., "business_feature" displays as "Business Feature")
- Store the raw string value (snake_case) unchanged in the data model

### Reusability Opportunities

- The `formatOptionLabel` helper can be reused by other dropdowns that have snake_case values
- The backward-compatible DropdownCell enhancement pattern can be applied to other cell types if needed

### Scope Boundaries

**In Scope:**
- Part A: Bug fix in gridConfigs.ts for UI Characteristics Type dropdown
- Part B: Backward-compatible DropdownCell enhancement with formatOptionLabel prop
- Part B: Helper function to convert snake_case to Title Case labels
- Verification that existing tests continue to pass

**Out of Scope:**
- Backend changes (frontend-only fix)
- Changes to other grids or dropdown columns
- Changes to how options are defined in uiCharacteristicTypes.ts
- Adding new tests for the formatOptionLabel helper (existing tests sufficient)

### Technical Considerations

- Must maintain backward compatibility with existing DropdownCell usage
- The formatOptionLabel prop should be optional, defaulting to identity function (display value as-is)
- Snake_case to Title Case conversion: split on underscore, capitalize each word, join with space
- No changes to the stored data format - only the display label changes
- Existing test expects 4 UI characteristic type options - this count should remain unchanged
