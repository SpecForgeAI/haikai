# Task Breakdown: Sequence Diagram Fragment Header Label Display

## Overview
Total Tasks: 8

This is a simple frontend-only visual enhancement that modifies a single file (`SequenceDiagramRenderer.tsx`) to display optional user-defined labels in fragment headers.

## Task List

### Frontend Components

#### Task Group 1: Fragment Label Display Enhancement
**Dependencies:** None

- [x] 1.0 Complete fragment label display enhancement
  - [x] 1.1 Write 6 focused unit tests for `getFragmentLabel()` function
    - Test returns only kind when labelText is null (Loop, Optional, Alternative)
    - Test returns only kind when labelText is undefined
    - Test returns only kind when labelText is empty string
    - Test returns only kind when labelText is whitespace-only
    - Test appends trimmed label when labelText has content for all fragment kinds
    - Test trims leading/trailing whitespace from label
  - [x] 1.2 Update `getFragmentLabel()` function signature and implementation
    - Add optional `labelText?: string | null` parameter
    - Compute fragment kind abbreviation (opt, alt, or lowercase kind)
    - Check if trimmed labelText is non-empty
    - If non-empty: return `"[kindLabel] - [trimmedLabel]"` format
    - If empty/null/whitespace: return only kindLabel (current behavior)
    - Add JSDoc comment documenting the function
  - [x] 1.3 Update `FragmentFrame` component to pass labelText
    - Locate the `getFragmentLabel(layout.fragmentKind)` call (line ~948)
    - Change to `getFragmentLabel(layout.fragmentKind, layout.labelText)`
    - No other changes needed - label width calculation uses displayLabel automatically
  - [x] 1.4 Write 2 focused integration tests for FragmentFrame rendering
    - Test FragmentFrame renders combined label when labelText is provided
    - Test FragmentFrame renders only kind abbreviation when labelText is empty/null
  - [x] 1.5 Ensure all feature tests pass
    - Run the 6 unit tests from 1.1
    - Run the 2 integration tests from 1.4
    - Verify no regressions in existing fragment rendering

**Acceptance Criteria:**
- All 8 tests pass (6 unit + 2 integration)
- Fragments without label_text render unchanged (only kind abbreviation)
- Fragments with label_text render as "[kind] - [label]"
- All fragment kinds (Loop, Optional, Alternative) support labels
- Existing diagrams render without migration or data changes

### Testing

#### Task Group 2: Test Review & Verification
**Dependencies:** Task Group 1

- [x] 2.0 Review and verify test coverage
  - [x] 2.1 Review tests from Task Group 1
    - Review the 6 unit tests for `getFragmentLabel()` function
    - Review the 2 integration tests for FragmentFrame rendering
    - Confirm all acceptance criteria from spec are covered
  - [x] 2.2 Analyze test coverage gaps
    - Verify all edge cases from spec are tested (null, undefined, empty, whitespace)
    - Verify all fragment kinds are tested (Loop, Optional, Alternative)
    - Verify combined format is tested for multiple fragment kinds
  - [x] 2.3 Run feature-specific tests
    - Run all 8 tests related to this feature
    - Verify all tests pass
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All 8 feature-specific tests pass
- All acceptance criteria from spec are verified
- No additional tests needed for this simple enhancement

## Execution Order

Recommended implementation sequence:
1. Frontend Components (Task Group 1) - Single file modification with tests
2. Test Review & Verification (Task Group 2) - Confirm coverage and passing tests

## File References

**File to Modify:**
- `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`

**Test File to Create/Update:**
- `frontend/src/__tests__/SequenceDiagramFragmentRendering.test.ts`

## Implementation Notes

- This is a low-risk, isolated change (~15 lines of code)
- No data model changes required
- Backward compatible - existing diagrams render unchanged
- Label width calculation automatically accommodates longer text
- No truncation, wrapping, or tooltip behavior needed
