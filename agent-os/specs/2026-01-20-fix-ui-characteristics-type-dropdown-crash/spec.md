# Specification: Fix UI Characteristics Type Dropdown Crash

## Goal
Fix the runtime crash when clicking "Add Row" in the UI Characteristics grid by correcting the Type dropdown options format, and implement human-friendly label display using a formatOptionLabel helper.

## User Stories
- As a user, I want to add new rows to the UI Characteristics grid without encountering a crash so that I can define UI characteristics for my application points.
- As a user, I want to see human-friendly labels in the Type dropdown (e.g., "Business Feature" instead of "business_feature") so that the options are easier to understand.

## Specific Requirements

**Part A: Bug Fix - Convert options to string array**
- The `ui_characteristics` grid config in `gridConfigs.ts` passes `uiCharacteristicTypeOptions` directly to the Type dropdown
- `uiCharacteristicTypeOptions` is defined as `Array<{ value: string; label: string }>` in `defaults.ts`
- `DropdownCell` expects `options: string[]` and renders `<option>{option}</option>`
- When objects are passed, React throws: "Objects are not valid as a React child (found: object with keys {value, label})"
- Fix by using `.map(o => o.value)` pattern: `options: uiCharacteristicTypeOptions.map(o => o.value)`
- This matches the established pattern used by `endpointTypeOptions`, `endpointDirectionOptions`, `endpointLifecycleStatusOptions`, `triggerRefKindOptions`, `guardRefKindOptions`, and `effectRefKindOptions`

**Part B: Pretty Labels - Add formatOptionLabel helper**
- Add an optional `formatOptionLabel` prop to `DropdownCell` component interface
- The prop should have type `(value: string) => string` with a default that returns the value unchanged
- Create a helper function `snakeCaseToTitleCase` that converts snake_case to Title Case
- Algorithm: split on underscore, capitalize first letter of each word, join with space
- Example transformations: "business_feature" -> "Business Feature", "ui_capability" -> "UI Capability"
- Apply `formatOptionLabel` to the displayed text inside `<option>` elements while keeping `value={option}` unchanged

**Part B: Apply formatOptionLabel to UI Characteristics Type dropdown**
- In `gridConfigs.ts`, add `formatOptionLabel: snakeCaseToTitleCase` to the Type column config
- The `GridCell` component must pass `column.formatOptionLabel` to `DropdownCell`
- This ensures the dropdown displays "Business Feature" while storing "business_feature"

**Backward Compatibility**
- The `formatOptionLabel` prop must be optional to avoid breaking existing dropdown usage
- If `formatOptionLabel` is not provided, the dropdown displays the raw string value (current behavior)
- No changes to stored data format - only the display label changes

**DropdownCell Interface Update**
- Current interface: `{ value: string; options: string[]; onChange: (value: string) => void; error?: ValidationError }`
- Updated interface adds: `formatOptionLabel?: (value: string) => string`
- Default behavior when not provided: identity function `(v) => v`

**GridColumnConfig Type Update**
- Add optional `formatOptionLabel?: (value: string) => string` to `GridColumnConfig` interface in `types/config.ts`
- This allows grid configs to specify label formatting per dropdown column

**GridCell Component Update**
- In the `case 'dropdown':` branch, pass `column.formatOptionLabel` to `DropdownCell`
- The prop is optional, so existing dropdowns continue to work without modification

## Visual Design
No visual assets provided - this is a bug fix with clear technical requirements.

## Existing Code to Leverage

**gridConfigs.ts - Established .map(o => o.value) pattern (lines 132, 136-137, 279, 282, 285, 308, 311)**
- Multiple dropdowns already convert `{value, label}[]` to `string[]` using `.map(o => o.value)`
- Examples: `endpointTypeOptions.map(o => o.value)`, `triggerRefKindOptions.map(o => o.value)`
- Apply the same pattern to `uiCharacteristicTypeOptions` on line 390

**DropdownCell component (GridCell.tsx lines 377-399)**
- Current implementation expects `options: string[]` and renders directly
- Add optional `formatOptionLabel` prop and apply it to displayed text in `<option>` elements
- Keep `value={option}` unchanged to preserve stored values

**uiCharacteristicTypeOptions (defaults.ts lines 1041-1046)**
- Defined as `Array<{ value: UICharacteristicType; label: string }>`
- Contains 4 options with snake_case values and Title Case labels
- Do NOT modify this definition - use `.map(o => o.value)` in grid config

**Existing tests (ui-characteristics.test.ts lines 111-117)**
- Test expects `typeColumn?.options` to have length 4
- After fix, options will be `['business_feature', 'ui_capability', 'interaction_complexity', 'technical_shape']`
- Test should continue to pass as count remains 4

## Out of Scope
- Backend changes (this is a frontend-only fix)
- Changes to other grids or dropdown columns beyond UI Characteristics Type
- Changes to how options are defined in `defaults.ts` - the `uiCharacteristicTypeOptions` structure stays the same
- Adding new tests for the `formatOptionLabel` helper (existing tests are sufficient per requirements)
- Modifying the stored data format - only display labels change
- Changes to the `uiId` column or other UI Characteristics columns
- Applying `formatOptionLabel` to any dropdown other than UI Characteristics Type
