# Spec: Sequence Diagram Fragment Header Label Display

## Overview

**Spec Name**: sequence-diagram-fragment-header-label-display
**Scope**: frontend
**Type**: visual-rendering-enhancement

**Intent**: Improve the readability of Sequence Diagram fragments (Loop, Optional, Alternative) by displaying an optional user-defined label alongside the fragment kind in the fragment frame header.

## Current Behavior

The fragment frame header currently displays only the fragment kind abbreviation:
- `Loop` displays as "loop"
- `Optional` displays as "opt"
- `Alternative` displays as "alt"

The optional `label_text` field on `SequenceFragment`, if provided by the user, is stored in the data model but **not rendered** in the diagram.

### Current Code Flow

1. `SequenceFragment.label_text` is an optional field in `frontend/src/types/sequenceDiagram.ts` (line 191)
2. `FragmentLayout.labelText` carries this value in `frontend/src/utils/sequenceLayout.ts` (line 117)
3. `getFragmentLabel()` in `SequenceDiagramRenderer.tsx` (lines 625-629) converts fragment kind to display text
4. `FragmentFrame` component (lines 947-996) renders the label using only `getFragmentLabel(layout.fragmentKind)`

## Required Changes

### Change Summary

Modify the fragment header text rendering to optionally include the user-defined label:

| Condition | Header Text Format |
|-----------|-------------------|
| `fragment.label_text` is `null`, empty, or whitespace-only | `"[Fragment Kind]"` (e.g., "loop", "opt", "alt") |
| `fragment.label_text` has non-empty value | `"[Fragment Kind] - [Fragment Label]"` (e.g., "loop - Retry upload") |

### Examples

| Fragment Kind | label_text | Rendered Header |
|---------------|------------|-----------------|
| Loop | `""` | "loop" |
| Optional | `null` | "opt" |
| Loop | `"Retry upload"` | "loop - Retry upload" |
| Alternative | `"User type check"` | "alt - User type check" |
| Loop | `"   "` (whitespace) | "loop" |

## Implementation Details

### File to Modify

**File**: `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`

### Change 1: Update `getFragmentLabel()` Function

**Location**: Lines 625-629

**Current Implementation**:
```typescript
export function getFragmentLabel(fragmentKind: FragmentKind | string): string {
  if (fragmentKind === 'Optional') return 'opt';
  if (fragmentKind === 'Alternative') return 'alt';
  return fragmentKind.toLowerCase();
}
```

**New Implementation**:
```typescript
/**
 * Converts a FragmentKind to its display label, optionally appending user label.
 * Loop -> "loop" or "loop - [label]"
 * Optional -> "opt" or "opt - [label]"
 * Alternative -> "alt" or "alt - [label]"
 *
 * @param fragmentKind - The kind of fragment
 * @param labelText - Optional user-provided label text
 * @returns The display label string
 */
export function getFragmentLabel(
  fragmentKind: FragmentKind | string,
  labelText?: string | null
): string {
  // Determine fragment kind abbreviation
  let kindLabel: string;
  if (fragmentKind === 'Optional') {
    kindLabel = 'opt';
  } else if (fragmentKind === 'Alternative') {
    kindLabel = 'alt';
  } else {
    kindLabel = fragmentKind.toLowerCase();
  }

  // Append user label if present and non-empty
  const trimmedLabel = labelText?.trim();
  if (trimmedLabel) {
    return `${kindLabel} - ${trimmedLabel}`;
  }

  return kindLabel;
}
```

### Change 2: Update `FragmentFrame` Component

**Location**: Lines 947-996 (specifically line 948)

**Current Implementation**:
```typescript
const FragmentFrame: React.FC<FragmentFrameProps> = ({ layout }) => {
  const displayLabel = getFragmentLabel(layout.fragmentKind);
  // ... rest of component
```

**New Implementation**:
```typescript
const FragmentFrame: React.FC<FragmentFrameProps> = ({ layout }) => {
  const displayLabel = getFragmentLabel(layout.fragmentKind, layout.labelText);
  // ... rest of component (unchanged)
```

### No Other Changes Required

- The `FragmentFrameProps` interface already receives `FragmentLayout` which includes `labelText`
- The label width calculation at line 950-955 uses `measureTextWidth(displayLabel, ...)` and will automatically accommodate the longer text
- The label background rectangle width is computed from `labelWidth` and will expand accordingly
- No changes to frame borders, sizing, positioning, or other visual elements

## Constraints Verification

| Constraint | Verified |
|------------|----------|
| No changes to sequence diagram data model | Yes - `SequenceFragment` and `FragmentLayout` unchanged |
| No changes to fragment semantics, behavior, or layout dimensions | Yes - only header text content changes |
| No changes to how fragments are created, stored, or validated | Yes - rendering-only change |
| Applies only to visual rendering of fragment headers | Yes - changes isolated to `getFragmentLabel()` and `FragmentFrame` |

## Non-Goals Verification

| Non-Goal | Verified |
|----------|----------|
| Do not alter guard expression rendering | Yes - guard expressions rendered separately via operands |
| Do not change fragment borders, sizing, or positioning | Yes - frame dimensions computed from row extents, unchanged |
| Do not introduce truncation, wrapping, or tooltip behavior | Yes - label rendered as-is without length limits |
| Do not modify export/print behavior | Yes - SVG rendering logic unchanged |

## Acceptance Criteria

### AC1: Fragments Without Label Render Unchanged

**Test**: Render a fragment where `label_text` is `null`, `undefined`, empty string `""`, or whitespace-only `"   "`.

**Expected**: Header displays only the fragment kind abbreviation ("loop", "opt", or "alt").

### AC2: Fragments With Label Display Combined Header

**Test**: Render a fragment where `label_text` is `"Retry upload"` and `fragment_kind` is `"Loop"`.

**Expected**: Header displays `"loop - Retry upload"`.

### AC3: All Fragment Kinds Support Labels

**Test**: Verify label display works for Loop, Optional, and Alternative fragment kinds.

**Expected**:
- Loop + "For each item" -> "loop - For each item"
- Optional + "Has permission" -> "opt - Has permission"
- Alternative + "User type" -> "alt - User type"

### AC4: Existing Diagrams Render Without Migration

**Test**: Load an existing diagram that has fragments with and without labels.

**Expected**: Diagrams render correctly without any data migration or model changes.

## Test Plan

### Unit Tests

Add tests to `frontend/src/__tests__/SequenceDiagramFragmentRendering.test.ts`:

```typescript
describe('getFragmentLabel with user label', () => {
  it('should return only kind when labelText is null', () => {
    expect(getFragmentLabel('Loop', null)).toBe('loop');
    expect(getFragmentLabel('Optional', null)).toBe('opt');
    expect(getFragmentLabel('Alternative', null)).toBe('alt');
  });

  it('should return only kind when labelText is undefined', () => {
    expect(getFragmentLabel('Loop', undefined)).toBe('loop');
    expect(getFragmentLabel('Optional', undefined)).toBe('opt');
    expect(getFragmentLabel('Alternative', undefined)).toBe('alt');
  });

  it('should return only kind when labelText is empty string', () => {
    expect(getFragmentLabel('Loop', '')).toBe('loop');
    expect(getFragmentLabel('Optional', '')).toBe('opt');
    expect(getFragmentLabel('Alternative', '')).toBe('alt');
  });

  it('should return only kind when labelText is whitespace-only', () => {
    expect(getFragmentLabel('Loop', '   ')).toBe('loop');
    expect(getFragmentLabel('Optional', '  \t  ')).toBe('opt');
    expect(getFragmentLabel('Alternative', '\n')).toBe('alt');
  });

  it('should append trimmed label when labelText has content', () => {
    expect(getFragmentLabel('Loop', 'Retry upload')).toBe('loop - Retry upload');
    expect(getFragmentLabel('Optional', 'Has permission')).toBe('opt - Has permission');
    expect(getFragmentLabel('Alternative', 'User type')).toBe('alt - User type');
  });

  it('should trim leading/trailing whitespace from label', () => {
    expect(getFragmentLabel('Loop', '  Retry upload  ')).toBe('loop - Retry upload');
  });
});
```

### Integration Test

Verify the `FragmentFrame` component renders with combined label by checking SVG text content:

```typescript
describe('FragmentFrame label rendering', () => {
  it('should render combined label when labelText is provided', () => {
    // Create diagram with fragment that has labelText
    const diagram = createTestDiagram(
      [createParticipant('p1', 0), createParticipant('p2', 1)],
      [createMessage('m1', 'p1', 'p2')],
      [{ id: 'f1', fragment_kind: 'Loop', label_text: 'Retry upload' }],
      [createOperand('op1', 'f1', 0)],
      [
        createNode('n1', 'Fragment', 0, 'f1'),
        createNode('n2', 'Message', 0, 'm1', 'n1', 'op1'),
      ]
    );

    // Render and verify text content
    // SVG should contain text element with "loop - Retry upload"
  });
});
```

## Dependencies

None. This is a self-contained visual enhancement.

## Risk Assessment

**Risk Level**: Low

- Change is isolated to a single pure function and one call site
- No data model changes
- No behavioral changes
- Backward compatible (existing diagrams render unchanged)
- Easy to test and verify visually

## Estimated Effort

**Complexity**: Trivial
**Lines of Code Changed**: ~15 lines
**Files Modified**: 1 (`SequenceDiagramRenderer.tsx`)
**Test Files Modified**: 1 (`SequenceDiagramFragmentRendering.test.ts`)
