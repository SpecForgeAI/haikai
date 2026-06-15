# Task Breakdown: Business Logic Type Suggestions (Non-Enforcing)

## Overview
Total Tasks: 16
Estimated Complexity: Low (frontend-only UI enhancement)

This feature adds optional, non-enforcing type suggestions as clickable chips in the Business Logic grid editor. The Type field remains free-text while showing helpful suggestions for common business logic types.

## Task List

### Configuration Layer

#### Task Group 1: Add Suggestions Configuration
**Dependencies:** None

- [x] 1.0 Complete suggestions configuration
  - [x] 1.1 Create `frontend/src/config/businessLogicTypeSuggestions.ts`
    - Export constant: `BUSINESS_LOGIC_TYPE_SUGGESTIONS`
    - Values: `['Calculation', 'Validation', 'Transformation', 'Policy', 'Workflow', 'Aggregation', 'Pricing', 'Eligibility']`
    - Simple string array format for easy maintenance
  - [x] 1.2 Verify TypeScript compilation passes
    - Run `npm run build` in frontend directory
    - No type errors expected (simple constant export)

**Acceptance Criteria:**
- New file exists at `frontend/src/config/businessLogicTypeSuggestions.ts`
- Constant exports successfully and can be imported
- TypeScript compilation passes without errors

**File to Create:**
```
frontend/src/config/businessLogicTypeSuggestions.ts
```

---

### Type System Layer

#### Task Group 2: Extend CellType and GridColumnConfig
**Dependencies:** Task Group 1

- [x] 2.0 Complete type definitions update
  - [x] 2.1 Update CellType union in `frontend/src/types/config.ts` (line 45)
    - Add `'text_with_suggestions'` to CellType union
    - Current: `'text' | 'tags' | 'boolean' | 'dropdown' | 'fk_typeahead'`
    - New: `'text' | 'tags' | 'boolean' | 'dropdown' | 'fk_typeahead' | 'text_with_suggestions'`
  - [x] 2.2 Add `suggestions` property to GridColumnConfig interface (line 47-79)
    - Add optional property: `suggestions?: string[]`
    - Add JSDoc comment explaining purpose
  - [x] 2.3 Verify TypeScript compilation passes
    - Run `npm run build` in frontend directory

**Acceptance Criteria:**
- CellType includes `'text_with_suggestions'`
- GridColumnConfig has optional `suggestions` property
- TypeScript compilation passes

**Files to Modify:**
```
frontend/src/types/config.ts (lines 45, 47-79)
```

---

### Grid Configuration Layer

#### Task Group 3: Update Business Logics Grid Config
**Dependencies:** Task Group 1, Task Group 2

- [x] 3.0 Complete grid configuration update
  - [x] 3.1 Import suggestions constant in `frontend/src/config/gridConfigs.ts`
    - Add import: `import { BUSINESS_LOGIC_TYPE_SUGGESTIONS } from './businessLogicTypeSuggestions'`
    - Place with other config imports at top of file
  - [x] 3.2 Update business_logics type_text field (line 313)
    - Change `cellType` from `'dropdown'` to `'text_with_suggestions'`
    - Remove `options: businessLogicTypeOptions` property
    - Add `suggestions: BUSINESS_LOGIC_TYPE_SUGGESTIONS` property
  - [x] 3.3 Remove unused import if no other usage
    - Check if `businessLogicTypeOptions` is still used elsewhere in file
    - If not used, remove from imports (line 36)
  - [x] 3.4 Verify TypeScript compilation passes
    - Run `npm run build` in frontend directory

**Acceptance Criteria:**
- business_logics type_text field uses `cellType: 'text_with_suggestions'`
- suggestions property references the new constant
- No unused imports remain
- TypeScript compilation passes

**Files to Modify:**
```
frontend/src/config/gridConfigs.ts (lines 1-38 imports, line 313)
```

---

### Styling Layer

#### Task Group 4: Add Suggestion Chip Styles
**Dependencies:** None (can be done in parallel with Task Groups 1-3)

- [x] 4.0 Complete CSS styling
  - [x] 4.1 Add suggestion chip styles to `frontend/src/components/Grid/Grid.module.css`
    - Add `.suggestionChipsContainer` class:
      - `display: flex`
      - `flex-wrap: wrap`
      - `gap: 4px`
      - `margin-top: 4px`
      - `padding: 4px 0`
    - Add `.suggestionChip` class (following `.badge` pattern from SequenceEditorPanel):
      - `display: inline-block`
      - `padding: 2px 8px`
      - `background: #e3f2fd` (light blue)
      - `color: #1565C0` (blue text)
      - `border-radius: 3px`
      - `font-size: 11px`
      - `font-weight: 500`
      - `cursor: pointer`
      - `transition: background-color 0.15s ease`
      - `border: none`
    - Add `.suggestionChip:hover` state:
      - `background: #bbdefb` (darker blue on hover)
  - [x] 4.2 Add `.textWithSuggestionsContainer` class for wrapper:
    - `position: relative` (for proper layout)

**Acceptance Criteria:**
- New CSS classes are defined in Grid.module.css
- Chip styling follows existing badge patterns
- Hover states are implemented
- Colors match spec: light blue background (#e3f2fd), blue text (#1565C0)

**Files to Modify:**
```
frontend/src/components/Grid/Grid.module.css (add at end of file, after line 247)
```

---

### Component Layer

#### Task Group 5: Create TextWithSuggestionsCell Component
**Dependencies:** Task Group 2, Task Group 4

- [x] 5.0 Complete TextWithSuggestionsCell component
  - [x] 5.1 Write 4 focused tests for TextWithSuggestionsCell
    - Create test file: `frontend/src/__tests__/TextWithSuggestionsCell.test.ts`
    - Test 1: Renders text value in display mode (non-editing)
    - Test 2: Shows input and suggestion chips when editing (double-click)
    - Test 3: Clicking chip sets input value without closing edit mode
    - Test 4: Input retains focus after chip click
  - [x] 5.2 Create TextWithSuggestionsCell component in `frontend/src/components/Grid/GridCell.tsx`
    - Add new interface `TextWithSuggestionsCellProps`:
      - `value: string`
      - `suggestions: string[]`
      - `onChange: (value: string) => void`
      - `error?: ValidationError`
    - Implement component following TextCell pattern (lines 83-143):
      - Reuse isEditing, editValue, inputRef state pattern
      - Reuse keyboard handlers (Enter/Escape/Tab)
      - Reuse blur handling
      - Add suggestion chips rendering when isEditing is true
      - Chip onClick sets editValue without setting isEditing to false
      - Add inputRef.current?.focus() after chip click
  - [x] 5.3 Render suggestion chips below input
    - Use `.textWithSuggestionsContainer` wrapper div
    - Use `.suggestionChipsContainer` for chips row
    - Map suggestions array to `.suggestionChip` buttons
    - Add onClick handler: `setEditValue(suggestion)`
    - Add focus restoration: `inputRef.current?.focus()`
  - [x] 5.4 Ensure component tests pass
    - Run: `npm test -- --testPathPattern=TextWithSuggestionsCell`
    - All 4 tests should pass

**Acceptance Criteria:**
- TextWithSuggestionsCell component renders correctly
- Double-click activates edit mode with suggestions visible
- Clicking chip populates input value
- Focus remains in input after chip click
- Enter/Escape/Tab work as expected
- All 4 tests pass

**Files to Create:**
```
frontend/src/__tests__/TextWithSuggestionsCell.test.ts
```

**Files to Modify:**
```
frontend/src/components/Grid/GridCell.tsx (add component after TextCell, lines 143+)
```

---

### Integration Layer

#### Task Group 6: Update GridCell Switch Statement
**Dependencies:** Task Group 5

- [x] 6.0 Complete GridCell integration
  - [x] 6.1 Add case for `'text_with_suggestions'` in GridCell switch (line 28-73)
    - Add new case after `'fk_typeahead'` case
    - Return `<TextWithSuggestionsCell>` component
    - Pass props: `value`, `suggestions` (from column.suggestions), `onChange`, `error`
  - [x] 6.2 Verify full integration
    - Run: `npm run build` in frontend directory
    - Run application and navigate to Business Logics grid
    - Verify type_text column shows as editable text with suggestions

**Acceptance Criteria:**
- GridCell handles `'text_with_suggestions'` cellType
- Business Logics grid renders type_text with new cell type
- Application builds and runs without errors

**Files to Modify:**
```
frontend/src/components/Grid/GridCell.tsx (lines 28-73 switch statement)
```

---

### Testing Layer

#### Task Group 7: Integration Testing
**Dependencies:** Task Groups 1-6

- [x] 7.0 Complete integration testing
  - [x] 7.1 Write 3 integration tests for grid configuration
    - Add to existing test file or create: `frontend/src/__tests__/business-logic-type-suggestions.test.ts`
    - Test 1: business_logics config has text_with_suggestions cellType for type_text
    - Test 2: BUSINESS_LOGIC_TYPE_SUGGESTIONS contains expected values
    - Test 3: GridCell renders TextWithSuggestionsCell for text_with_suggestions type
  - [x] 7.2 Run all feature tests
    - Run: `npm test -- --testPathPattern="(TextWithSuggestionsCell|business-logic-type-suggestions)"`
    - Expected: 7 tests pass (4 component + 3 integration)
  - [x] 7.3 Run TypeScript build
    - Run: `npm run build` in frontend directory
    - Expected: No errors
  - [ ] 7.4 Manual verification
    - Start application: `npm run dev`
    - Navigate to Meta-Model View > Behavioural > Business Logics
    - Add new row, double-click Type column
    - Verify suggestion chips appear below input
    - Click a chip, verify value populates and focus stays in input
    - Verify can type free text (not limited to suggestions)
    - Verify save works (Enter key or click away)

**Acceptance Criteria:**
- All 7 tests pass
- TypeScript build succeeds
- Manual verification confirms feature works as specified
- Free text entry is not blocked (non-enforcing suggestions)

**Files to Create:**
```
frontend/src/__tests__/business-logic-type-suggestions.test.ts
```

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Configuration** - Create suggestions constant (no dependencies)
2. **Task Group 4: Styling** - Add CSS styles (can run parallel with Group 1)
3. **Task Group 2: Type System** - Update TypeScript types (depends on Group 1)
4. **Task Group 3: Grid Configuration** - Update gridConfigs (depends on Groups 1, 2)
5. **Task Group 5: Component** - Create TextWithSuggestionsCell (depends on Groups 2, 4)
6. **Task Group 6: Integration** - Update GridCell switch (depends on Group 5)
7. **Task Group 7: Testing** - Integration and manual testing (depends on all groups)

## Summary of Changes

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/config/businessLogicTypeSuggestions.ts` | CREATE | New suggestions constant |
| `frontend/src/types/config.ts` | MODIFY | Add CellType and GridColumnConfig |
| `frontend/src/config/gridConfigs.ts` | MODIFY | Update business_logics config |
| `frontend/src/components/Grid/Grid.module.css` | MODIFY | Add chip styles |
| `frontend/src/components/Grid/GridCell.tsx` | MODIFY | Add TextWithSuggestionsCell |
| `frontend/src/__tests__/TextWithSuggestionsCell.test.ts` | CREATE | Component tests |
| `frontend/src/__tests__/business-logic-type-suggestions.test.ts` | CREATE | Integration tests |

## Out of Scope Reminders

Per the spec, the following are explicitly out of scope:
- Backend API changes
- Database schema modifications
- Validation/enforcement of type values
- Modal-based editing
- Runtime-configurable suggestions
- Adding suggestions to other entity fields
- User-defined custom suggestions persistence
- Multi-select or combining suggestions
- Search/filter within suggestions
- Keyboard navigation through chips
