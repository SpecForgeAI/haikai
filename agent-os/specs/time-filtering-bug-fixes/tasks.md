# Task Breakdown: Time-Filtering Bug Fixes

## Overview
Total Tasks: 4 task groups
Focus: Fix two critical bugs causing objects to incorrectly appear/disappear during time-based filtering

### Bug 1: Objects with no temporal fields disappearing
Objects without valid_from/valid_to should always be visible (timeless)

### Bug 2: Objects with valid_to not disappearing at correct time
Objects with valid_to = "2026-q4" incorrectly remain visible when viewing "End of 2026" (2026-Q4) due to:
- Case-sensitive parsing (lowercase "q" not recognized)
- Valid_to comparison logic already correct but needs timeless check

## Task List

### Utility Functions Layer

#### Task Group 1: Fix parseQuarter Case-Sensitivity
**Dependencies:** None

- [x] 1.0 Make quarter parsing case-insensitive and robust
  - [x] 1.1 Write 2-4 focused tests for parseQuarter case-sensitivity
    - Test uppercase "Q" (e.g., "2026-Q4") - existing behavior
    - Test lowercase "q" (e.g., "2026-q4") - new behavior
    - Test invalid format returns null (e.g., "2026-X4")
    - Test that null result doesn't break visibility functions
  - [x] 1.2 Update parseQuarter regex pattern
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\quarterUtils.ts` (line 14)
    - Change FROM: `/^(\d{4})-Q([1-4])$/`
    - Change TO: `/^(\d{4})-[Qq]([1-4])$/`
  - [x] 1.3 Add optional warning logging for parse failures
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\quarterUtils.ts` (line 15)
    - When `match` is null, log: `console.warn('Invalid quarter format:', quarter);`
    - Warning should be non-blocking (parseQuarter still returns null)
  - [x] 1.4 Verify compareQuarters handles lowercase quarters
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\quarterUtils.ts` (lines 30-50)
    - Test that compareQuarters("2026-q4", "2026-Q3") works correctly
    - No code changes needed (delegates to parseQuarter)
  - [x] 1.5 Ensure parseQuarter tests pass
    - Run ONLY the 2-4 tests written in 1.1
    - Verify "2026-q4" and "2026-Q4" both parse successfully
    - Verify invalid formats return null with warning logged

**Before (line 14):**
```typescript
const match = quarter.match(/^(\d{4})-Q([1-4])$/);
```

**After (line 14-16):**
```typescript
const match = quarter.match(/^(\d{4})-[Qq]([1-4])$/);
if (!match) {
  console.warn('Invalid quarter format:', quarter);
  return null;
}
```

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass
- Both "2026-Q4" and "2026-q4" parse correctly
- Invalid formats return null with console warning
- compareQuarters works with case-insensitive input

---

#### Task Group 2: Fix Timeless Object Visibility
**Dependencies:** Task Group 1

- [x] 2.0 Ensure objects with no temporal fields are always visible
  - [x] 2.1 Write 2-4 focused tests for timeless visibility
    - Test entity with no valid_from/valid_to is always visible
    - Test relationship with no valid_from/valid_to is always visible
    - Test that null values are treated same as undefined
    - Test timeless objects visible across different viewQuarters
  - [x] 2.2 Add timeless check to isEntityVisibleInPeriod
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\quarterUtils.ts` (after line 68)
    - Add early-exit BEFORE any comparison logic:
    ```typescript
    // Timeless objects (no temporal fields) are always visible
    if (!valid_from && !valid_to) {
      return true;
    }
    ```
  - [x] 2.3 Add timeless check to isRelationshipVisibleInPeriod
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\quarterUtils.ts` (after line 115)
    - Add same early-exit check as 2.2:
    ```typescript
    // Timeless objects (no temporal fields) are always visible
    if (!valid_from && !valid_to) {
      return true;
    }
    ```
  - [x] 2.4 Verify valid_to comparison logic is correct
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\quarterUtils.ts` (lines 86, 133)
    - Current code: `if (compareQuarters(valid_to, viewQuarter) <= 0)`
    - This IS CORRECT for exclusive end semantics (object disappears when valid_to <= viewQuarter)
    - NO CHANGE NEEDED - just verify logic is working as intended
  - [x] 2.5 Ensure timeless visibility tests pass
    - Run ONLY the 2-4 tests written in 2.1
    - Verify objects with no temporal fields are always visible
    - Verify null and undefined are treated identically

**Before (isEntityVisibleInPeriod, line 68):**
```typescript
const { valid_from, valid_to } = temporalEntity;

// Check valid_from constraint (inclusive start)
if (valid_from !== undefined && valid_from !== null) {
```

**After (isEntityVisibleInPeriod, line 68-73):**
```typescript
const { valid_from, valid_to } = temporalEntity;

// Timeless objects (no temporal fields) are always visible
if (!valid_from && !valid_to) {
  return true;
}

// Check valid_from constraint (inclusive start)
if (valid_from !== undefined && valid_from !== null) {
```

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass
- Objects with both valid_from and valid_to as null/undefined return true immediately
- Timeless check happens before any quarter comparison logic
- Same logic applied to both entities and relationships

---

### Rendering Layer

#### Task Group 3: Fix Edge Visibility for Timeless Relationships
**Dependencies:** Task Group 2

- [x] 3.0 Handle missing relationships gracefully in edge rendering
  - [x] 3.1 Write 2-4 focused tests for edge visibility
    - Test edge with timeless relationship remains visible
    - Test edge with missing relationship is treated as timeless
    - Test edge hidden when relationship has expired valid_to
    - Test edge hidden when either endpoint node is not visible
  - [x] 3.2 Update getEdgesForDiagram to treat missing relationships as timeless
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\rendering.ts` (lines 546-550)
    - Change FROM: `if (!relationship) { return false; }`
    - Change TO: Treat as timeless (skip time filtering, only check node visibility)
  - [x] 3.3 Skip time filtering for relationships with no temporal fields
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\rendering.ts` (lines 552-556)
    - If relationship exists but has no valid_from/valid_to, skip isRelationshipVisibleInPeriod check
    - Still check node visibility (visibleNodeIds)
  - [x] 3.4 Ensure edge visibility tests pass
    - Run ONLY the 2-4 tests written in 3.1
    - Verify edges with timeless relationships render correctly
    - Verify edges still respect node visibility constraints

**Before (lines 546-550):**
```typescript
const relationship = getRelationship(edge.relationship_type, edge.relationship_id, model);
if (!relationship) {
  // If relationship not found, don't render the edge
  return false;
}
```

**After (lines 546-551):**
```typescript
const relationship = getRelationship(edge.relationship_type, edge.relationship_id, model);

// If relationship not found or has no temporal fields, treat as timeless
// (skip time filtering, but still check node visibility below)
const isTimeless = !relationship ||
  (!('valid_from' in relationship) && !('valid_to' in relationship));
```

**Before (lines 552-556):**
```typescript
// Check if relationship is visible in the given period
const relationshipVisible = isRelationshipVisibleInPeriod(relationship, viewQuarter);
if (!relationshipVisible) {
  return false;
}
```

**After (lines 552-557):**
```typescript
// Check if relationship is visible in the given period
if (!isTimeless) {
  const relationshipVisible = isRelationshipVisibleInPeriod(relationship, viewQuarter);
  if (!relationshipVisible) {
    return false;
  }
}
```

**Acceptance Criteria:**
- The 2-4 tests written in 3.1 pass
- Edges with missing relationships are treated as timeless
- Edges with relationships lacking temporal fields skip time filtering
- Node visibility constraints still enforced for all edges

---

### Testing & Verification

#### Task Group 4: Integration Testing for Bug Fixes
**Dependencies:** Task Groups 1-3

- [x] 4.0 Verify both reported bugs are fixed
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 2-4 tests written by utility-functions-engineer (Task 1.1)
    - Review the 2-4 tests written by utility-functions-engineer (Task 2.1)
    - Review the 2-4 tests written by rendering-engineer (Task 3.1)
    - Total existing tests: approximately 6-12 tests
  - [x] 4.2 Write integration tests for Bug 1 (timeless objects disappearing)
    - Test entity with no temporal fields visible across all quarters
    - Test relationship with no temporal fields visible across all quarters
    - Test edge with timeless relationship renders when nodes visible
    - Maximum 3 integration tests
  - [x] 4.3 Write integration tests for Bug 2 (valid_to not working)
    - Test entity with valid_to="2026-q4" NOT visible when viewQuarter="2026-Q4"
    - Test entity with valid_to="2026-q4" visible when viewQuarter="2026-Q3"
    - Test case-insensitive comparison works for both uppercase and lowercase
    - Maximum 3 integration tests
  - [x] 4.4 Run all feature-specific tests
    - Run ONLY tests related to time-filtering bug fixes
    - Expected total: approximately 12-18 tests maximum
    - Verify both Bug 1 and Bug 2 are resolved
    - Do NOT run the entire application test suite

**Integration Test Scenarios:**

**Bug 1 - Timeless Object Test:**
```typescript
// Entity with no temporal fields
const entity = { id: 'e1', type: 'Application', name: 'App' }; // no valid_from, no valid_to
expect(isEntityVisibleInPeriod(entity, '2026-Q1')).toBe(true);
expect(isEntityVisibleInPeriod(entity, '2026-Q4')).toBe(true);
expect(isEntityVisibleInPeriod(entity, '2030-Q1')).toBe(true);
```

**Bug 2 - Exclusive valid_to Test:**
```typescript
// Entity with valid_to (lowercase 'q')
const entity = {
  id: 'e1',
  type: 'Application',
  name: 'App',
  valid_from: '2025-Q1',
  valid_to: '2026-q4' // lowercase 'q'
};

// Should be visible before end date
expect(isEntityVisibleInPeriod(entity, '2026-Q3')).toBe(true);

// Should NOT be visible at end date (exclusive)
expect(isEntityVisibleInPeriod(entity, '2026-Q4')).toBe(false);

// Should NOT be visible after end date
expect(isEntityVisibleInPeriod(entity, '2027-Q1')).toBe(false);
```

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 12-18 tests total)
- Bug 1 verified fixed: Timeless objects always visible
- Bug 2 verified fixed: Objects with valid_to="2026-q4" disappear when viewing "2026-Q4"
- Case-insensitive quarter parsing works correctly
- No regressions in existing time-filtering behavior

---

## Execution Order

Recommended implementation sequence:
1. **Utility Functions - Parse Quarter** (Task Group 1) - Fix case-sensitivity in quarter parsing
2. **Utility Functions - Timeless Visibility** (Task Group 2) - Add timeless object checks
3. **Rendering Layer - Edge Visibility** (Task Group 3) - Handle timeless relationships in edges
4. **Integration Testing** (Task Group 4) - Verify both bugs are fixed end-to-end

## Summary

**Total Expected Tests:** 12-18 tests maximum
- Task Group 1: 2-4 tests (parseQuarter case-sensitivity)
- Task Group 2: 2-4 tests (timeless object visibility)
- Task Group 3: 2-4 tests (edge rendering with timeless relationships)
- Task Group 4: 6 integration tests maximum (Bug 1 and Bug 2 verification)

**Files Modified:**
1. `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\quarterUtils.ts`
   - parseQuarter(): Add case-insensitive regex and warning logging
   - isEntityVisibleInPeriod(): Add timeless check
   - isRelationshipVisibleInPeriod(): Add timeless check

2. `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\rendering.ts`
   - getEdgesForDiagram(): Treat missing/timeless relationships gracefully

**Key Changes:**
- Quarter parsing now accepts both "Q" and "q" (case-insensitive)
- Objects with no temporal fields always visible (early-exit optimization)
- Missing relationships treated as timeless instead of hidden
- Valid_to comparison logic already correct (no change needed)
