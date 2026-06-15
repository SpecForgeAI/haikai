# Task Breakdown: Advanced Add - Correct Child Node Height Using CHILD_NODE_HEIGHT and Spacing Presets

## Overview
Total Tasks: 15 sub-tasks across 4 task groups

This feature corrects the height calculation for leaf nodes in the Advanced Add hierarchical layout. It removes `minExtraHeight` from `SpacingConfig` and uses exact height calculations so that spacing presets visibly affect leaf node heights.

**Key Change**: Leaf node height changes from `Math.max(minNodeHeight, labelHeight + 2 * paddingY)` to simply `labelHeight + 2 * paddingY`.

## Task List

### Type Definitions Layer

#### Task Group 1: Update SpacingConfig Interface and SPACING_PRESETS
**Dependencies:** None

- [x] 1.0 Complete SpacingConfig interface update
  - [x] 1.1 Update tests for modified SpacingConfig interface
    - File: `frontend/src/__tests__/spacing-presets-types.test.ts`
    - Update test at line 37: "should have all required fields: paddingX, paddingY, childVerticalGap, minExtraHeight"
      - Remove minExtraHeight from the test config object
      - Remove assertion for `config.minExtraHeight`
    - Update test at line 55: "should contain all three presets with correct values"
      - Update expected values to NOT include minExtraHeight:
        - spacious: `{ paddingX: 20, paddingY: 20, childVerticalGap: 10 }`
        - normal: `{ paddingX: 10, paddingY: 10, childVerticalGap: 7 }`
        - tight: `{ paddingX: 5, paddingY: 5, childVerticalGap: 4 }`
  - [x] 1.2 Remove `minExtraHeight` from SpacingConfig interface
    - File: `frontend/src/types/advancedAdd.ts` (lines 142-151)
    - Remove line 150: `minExtraHeight: number;`
    - Update JSDoc comment to remove minExtraHeight description
    - Updated interface should be:
      ```typescript
      export interface SpacingConfig {
        paddingX: number;
        paddingY: number;
        childVerticalGap: number;
      }
      ```
  - [x] 1.3 Update SPACING_PRESETS constant values
    - File: `frontend/src/types/advancedAdd.ts` (lines 160-179)
    - Remove `minExtraHeight: 20` from spacious preset (line 165)
    - Remove `minExtraHeight: 10` from normal preset (line 171)
    - Remove `minExtraHeight: 5` from tight preset (line 177)
    - Keep paddingX, paddingY, childVerticalGap values unchanged
  - [x] 1.4 Ensure Task Group 1 tests pass
    - Run: `cd frontend && npm test -- spacing-presets-types.test.ts`
    - Verify all tests in spacing-presets-types.test.ts pass
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Files to Modify:**
- `frontend/src/types/advancedAdd.ts`
- `frontend/src/__tests__/spacing-presets-types.test.ts`

**Acceptance Criteria:**
- SpacingConfig interface has only paddingX, paddingY, childVerticalGap fields
- SPACING_PRESETS constant no longer includes minExtraHeight
- All spacing-presets-types tests pass (4 tests)
- TypeScript compilation succeeds

---

### Layout Algorithm Layer

#### Task Group 2: Update measure() Function for Leaf Node Heights
**Dependencies:** Task Group 1

- [x] 2.0 Complete measure() function update
  - [x] 2.1 Update tests for new leaf node height behavior
    - File: `frontend/src/__tests__/spacing-presets-layout.test.ts`
    - Add new test: "leaf nodes should use exact height (labelHeight + 2 * paddingY)"
      - Create a leaf node with short label
      - Measure with each preset
      - Assert height equals labelHeight + 2 * paddingY (not Math.max with minimum)
    - Add new test: "leaf node heights vary directly with paddingY for each preset"
      - For single-line label (labelHeight ~14px):
        - Spacious (paddingY=20): expect ~54px
        - Normal (paddingY=10): expect ~34px
        - Tight (paddingY=5): expect ~24px
    - Update test at line 163: "should respect minimum node dimensions regardless of spacing"
      - This test may need updating since we're removing minimum height for leaves
      - Keep minimum WIDTH check, update HEIGHT expectation
  - [x] 2.2 Remove minExtraHeight usage from measure() function
    - File: `frontend/src/utils/compoundLayout.ts` (lines 163-216)
    - Line 166: Change destructuring from `const { paddingX, paddingY, childVerticalGap, minExtraHeight } = config;`
      to `const { paddingX, paddingY, childVerticalGap } = config;`
    - Line 169: Remove `const minNodeHeight = LAYOUT_MIN_NODE_HEIGHT + minExtraHeight;`
  - [x] 2.3 Update leaf node height calculation to use exact height
    - File: `frontend/src/utils/compoundLayout.ts` (line 192)
    - Change from: `measuredHeight: Math.max(minNodeHeight, labelHeight + 2 * paddingY)`
    - To: `measuredHeight: labelHeight + 2 * paddingY`
    - This makes height exact, not a minimum bound
  - [x] 2.4 Verify container node height calculation remains correct
    - File: `frontend/src/utils/compoundLayout.ts` (line 214)
    - Container height should remain: `measuredHeight: contentHeight + 2 * paddingY`
    - Verify line 214 has no Math.max with minNodeHeight (it currently doesn't)
    - Container height = paddingY + labelHeight + LAYOUT_LABEL_PADDING + totalChildrenHeight + paddingY
  - [x] 2.5 Ensure Task Group 2 tests pass
    - Run: `cd frontend && npm test -- spacing-presets-layout.test.ts`
    - Verify all tests pass including new tests
    - Do NOT run the entire test suite at this stage

**Files to Modify:**
- `frontend/src/utils/compoundLayout.ts`
- `frontend/src/__tests__/spacing-presets-layout.test.ts`

**Acceptance Criteria:**
- measure() function no longer references minExtraHeight
- Leaf node height = labelHeight + 2 * paddingY (exact value)
- Spacious preset produces taller leaf nodes than Normal
- Tight preset produces shorter leaf nodes than Normal
- Container nodes continue to grow based on children
- All spacing-presets-layout tests pass

---

### Integration Layer

#### Task Group 3: Integration Testing and Verification
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Complete integration verification
  - [x] 3.1 Write integration tests for preset height differences
    - File: `frontend/src/__tests__/spacing-presets-layout.test.ts`
    - Add test: "switching presets should produce visibly different leaf node heights"
      - Use createSimpleTree() fixture (root with 2 leaf children)
      - Layout with all three presets
      - Assert: spaciousLayout.children[0].height > normalLayout.children[0].height > tightLayout.children[0].height
    - Add test: "Spacious preset produces tallest leaf nodes"
    - Add test: "Tight preset produces shortest leaf nodes"
  - [x] 3.2 Verify no node overlap with updated heights
    - File: `frontend/src/__tests__/spacing-presets-layout.test.ts`
    - Update existing test at line 252: "should ensure no node overlap with any spacing preset"
    - Verify test still passes with new height calculations
    - Add assertion: smaller leaf nodes do not cause sibling overlap
  - [x] 3.3 Test backward compatibility
    - File: `frontend/src/__tests__/spacing-presets-layout.test.ts`
    - Existing test at line 288: "should maintain backward compatibility: omitting preset equals normal"
    - Verify this test still passes (defaulting to 'normal' preset)
  - [x] 3.4 Run all spacing-presets tests
    - Run: `cd frontend && npm test -- spacing-presets`
    - Verify all spacing-presets related tests pass
    - Total expected: ~12-15 tests

**Files to Modify:**
- `frontend/src/__tests__/spacing-presets-layout.test.ts`

**Acceptance Criteria:**
- Leaf nodes visibly change height when switching presets
- Spacious produces tallest leaf nodes
- Tight produces shortest leaf nodes
- No node overlap regardless of preset
- Backward compatibility maintained (default = normal)
- All spacing-presets tests pass

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review tests in spacing-presets-types.test.ts (~4 tests)
    - Review tests in spacing-presets-layout.test.ts (~10-12 tests)
    - Total existing tests: approximately 14-16 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Check if multi-line label wrapping is tested (height should increase)
    - Check if empty/short labels work correctly
    - Check if container+leaf mixed trees work correctly
    - Focus ONLY on gaps related to this spec's feature requirements
  - [x] 4.3 Write up to 5 additional strategic tests if necessary
    - Maximum 5 new tests to fill identified critical gaps
    - Suggested gaps to fill:
      - Edge case: very long labels that wrap to multiple lines (height should be labelHeight + 2 * paddingY where labelHeight accounts for wrapped lines)
      - Edge case: empty or very short labels
      - Deep nesting: 3+ levels with leaf nodes at different depths
    - Do NOT write exhaustive coverage tests
  - [x] 4.4 Run all feature-specific tests
    - Run: `cd frontend && npm test -- spacing-presets`
    - Run: `cd frontend && npm test -- compoundLayout`
    - Verify all tests pass
    - Expected total: ~15-20 tests maximum

**Acceptance Criteria:**
- All feature-specific tests pass
- Critical user workflows for this feature are covered
- No more than 5 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Type Definitions** (No dependencies)
   - Remove minExtraHeight from SpacingConfig interface
   - Update SPACING_PRESETS constant
   - Must complete before Task Group 2

2. **Task Group 2: Layout Algorithm** (Depends on Task Group 1)
   - Update measure() function to use exact heights
   - Remove minExtraHeight calculation

3. **Task Group 3: Integration** (Depends on Task Groups 1-2)
   - Verify end-to-end behavior
   - Ensure no regressions

4. **Task Group 4: Test Review** (Depends on Task Groups 1-3)
   - Fill gaps and final verification
   - Ensure comprehensive coverage

---

## Files Summary

| File | Line Numbers | Changes |
|------|--------------|---------|
| `frontend/src/types/advancedAdd.ts` | 142-151, 160-179 | Remove `minExtraHeight` from SpacingConfig interface and SPACING_PRESETS constant |
| `frontend/src/utils/compoundLayout.ts` | 166, 169, 192 | Remove minExtraHeight usage, update leaf node height calculation |
| `frontend/src/__tests__/spacing-presets-types.test.ts` | 37-52, 55-79 | Update tests for simplified interface |
| `frontend/src/__tests__/spacing-presets-layout.test.ts` | Multiple | Update tests for new height calculations, add preset comparison tests |

---

## Key Implementation Notes

### 1. Exact vs Minimum Height
The key change is removing `Math.max()` from leaf node height calculation. Height should be exactly `labelHeight + 2 * paddingY`.

**Before (compoundLayout.ts line 192):**
```typescript
measuredHeight: Math.max(minNodeHeight, labelHeight + 2 * paddingY)
```

**After:**
```typescript
measuredHeight: labelHeight + 2 * paddingY
```

### 2. Simplified SpacingConfig Interface

**Before (advancedAdd.ts lines 142-151):**
```typescript
export interface SpacingConfig {
  paddingX: number;
  paddingY: number;
  childVerticalGap: number;
  minExtraHeight: number;
}
```

**After:**
```typescript
export interface SpacingConfig {
  paddingX: number;
  paddingY: number;
  childVerticalGap: number;
}
```

### 3. Updated SPACING_PRESETS

**Before (advancedAdd.ts lines 160-179):**
```typescript
export const SPACING_PRESETS: Record<SpacingPreset, SpacingConfig> = {
  spacious: { paddingX: 20, paddingY: 20, childVerticalGap: 10, minExtraHeight: 20 },
  normal: { paddingX: 10, paddingY: 10, childVerticalGap: 7, minExtraHeight: 10 },
  tight: { paddingX: 5, paddingY: 5, childVerticalGap: 4, minExtraHeight: 5 },
};
```

**After:**
```typescript
export const SPACING_PRESETS: Record<SpacingPreset, SpacingConfig> = {
  spacious: { paddingX: 20, paddingY: 20, childVerticalGap: 10 },
  normal: { paddingX: 10, paddingY: 10, childVerticalGap: 7 },
  tight: { paddingX: 5, paddingY: 5, childVerticalGap: 4 },
};
```

### 4. Expected Height Values
For a single-line label with labelHeight = 14px:

| Preset | paddingY | CHILD_NODE_HEIGHT | Calculation |
|--------|----------|-------------------|-------------|
| Spacious | 20 | **54px** | 14 + 2 x 20 |
| Normal | 10 | **34px** | 14 + 2 x 10 |
| Tight | 5 | **24px** | 14 + 2 x 5 |

This shows clear visual differentiation between presets.

### 5. Container Behavior
Container nodes still grow to fit their children. The change only affects leaf nodes. Container height remains:
```
containerHeight = paddingY + labelHeight + LAYOUT_LABEL_PADDING + totalChildrenHeight + paddingY
```

### 6. Backward Compatibility
The Normal preset will produce slightly different heights than before, but this is acceptable because the previous behavior was incorrect (heights didn't change with presets due to Math.max always selecting the minimum).

---

## Test Count Summary

| Task Group | Test Count | Focus Area |
|------------|------------|------------|
| TG1: Types | 6 tests | Interface changes, preset values |
| TG2: Layout | 19 tests | Height calculations, preset differences |
| TG3: Integration | 9 tests | End-to-end behavior, no overlap |
| TG4: Gap Fill | 5 tests | Edge cases (included in TG2 layout tests) |
| **Total** | **42 tests** | Feature coverage |

Note: This updates existing test files rather than creating new ones, since the spacing presets feature already has test coverage.
