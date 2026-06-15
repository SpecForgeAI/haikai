# Task Breakdown: Fix Rendering of USER_INTERACTION Edges in getEdgesForDiagram

## Overview
Total Tasks: 8
Estimated Complexity: Low-Medium

## Context

### Root Cause
USER_INTERACTION edges are being added to `diagram.diagram_edges` correctly, but `getEdgesForDiagram()` filters them out because:
1. `getRelationship("USER_INTERACTION", ...)` returns `undefined`
2. `relationshipTypeMap` doesn't include `USER_INTERACTION`
3. Even if it did, Interactions are in `metaModel.entities.interactions`, NOT `metaModel.relationships`

### Fix Required
Update `getRelationship()` in `rendering.ts` to handle USER_INTERACTION by looking up the Interaction from `metaModel.entities.interactions`.

## Task List

### Task Group 1: Fix getRelationship() for USER_INTERACTION
**Dependencies:** None

- [x] 1.0 Complete getRelationship() fix
  - [x] 1.1 Add special case for USER_INTERACTION in getRelationship()
    - Add conditional check at start of function
    - When `relationshipType === 'USER_INTERACTION'`:
      - Return `model.metaModel.entities.interactions?.find(i => i.id === relationshipId)`
    - File: `frontend/src/utils/rendering.ts` (lines 160-170)
    ```typescript
    export function getRelationship(
      relationshipType: string,
      relationshipId: string,
      model: ArchitectureModel
    ): AnyRelationship | undefined {
      // Special case: USER_INTERACTION is stored in entities, not relationships
      if (relationshipType === 'USER_INTERACTION') {
        return model.metaModel.entities.interactions?.find(i => i.id === relationshipId);
      }

      // Existing logic for standard relationships
      const arrayKey = relationshipTypeMap[relationshipType];
      if (!arrayKey) return undefined;

      const relationships = model.metaModel.relationships[arrayKey] as AnyRelationship[];
      return relationships.find((r) => r.id === relationshipId);
    }
    ```
  - [x] 1.2 Add USER_INTERACTION case to getRelationshipEndpointEntities()
    - Add case for 'USER_INTERACTION' in the switch statement
    - Return the User entity and underlying entities for Primary/Secondary ABPs
    - File: `frontend/src/utils/rendering.ts` (around line 184)
  - [x] 1.3 Add helper function getEntityForAbp() if needed
    - Resolve ABP kind to underlying entity
    - Used by getRelationshipEndpointEntities() for USER_INTERACTION
    - File: `frontend/src/utils/rendering.ts`

**Acceptance Criteria:**
- [x] `getRelationship("USER_INTERACTION", id, model)` returns the Interaction
- [x] `getRelationshipEndpointEntities("USER_INTERACTION", ...)` returns relevant entities
- [x] No changes to existing relationship type handling

**Files to Modify:**
- `frontend/src/utils/rendering.ts`

---

### Task Group 2: Write Tests
**Dependencies:** Task Group 1

- [x] 2.0 Complete test coverage
  - [x] 2.1 Write tests for getRelationship() with USER_INTERACTION
    - Test: Returns Interaction from entities.interactions
    - Test: Returns undefined when Interaction not found
    - File: `frontend/src/__tests__/user-interaction-edge-rendering.test.ts`
  - [x] 2.2 Write tests for getEdgesForDiagram() with USER_INTERACTION
    - Test: Includes USER_INTERACTION edges when Interaction exists
    - Test: Filters USER_INTERACTION edges when Interaction not found
    - Test: Filters USER_INTERACTION edges when temporally invalid
    - File: `frontend/src/__tests__/user-interaction-edge-rendering.test.ts`

**Acceptance Criteria:**
- [x] Tests verify USER_INTERACTION edge resolution
- [x] Tests verify edge filtering behavior
- [x] All tests pass (24 tests passing)

**Files Modified:**
- `frontend/src/__tests__/user-interaction-edge-rendering.test.ts` (added new test describe blocks)

---

### Task Group 3: Verify and Test
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Complete verification
  - [x] 3.1 Run all related tests
    - Run rendering tests - PASSED
    - Run user-interaction tests - PASSED (24/24)
    - Verify no regressions in existing relationship rendering - PASSED
  - [ ] 3.2 Manual verification (pending user testing)
    - Add User Interaction via palette
    - Verify dotted MAIN line appears between App nodes
    - Verify label appears at midpoint
    - Verify USER_LINK line appears (if User node present)
    - Delete interaction and verify lines disappear
    - Re-add and verify lines reappear

**Acceptance Criteria:**
- [x] All tests pass
- [ ] Visual verification confirms dotted lines render (pending user testing)
- [x] No console warnings about `relationship_not_found` for valid interactions

---

## Execution Order

```
1. Task Group 1 (Fix getRelationship)  <- Core fix
2. Task Group 2 (Write Tests)          <- Verify fix
3. Task Group 3 (Verify and Test)      <- Final validation
```

---

## File Summary

### Files to Modify
| File | Change Description |
|------|-------------------|
| `frontend/src/utils/rendering.ts` | Add USER_INTERACTION case to getRelationship() and getRelationshipEndpointEntities() |

### Files to Create
| File | Purpose |
|------|---------|
| `frontend/src/__tests__/user-interaction-edge-rendering.test.ts` | Tests for USER_INTERACTION edge resolution |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing relationships | Low | High | Change is additive, only adds new case |
| Type errors | Low | Low | Proper type casting |
| Missing endpoint validation | Low | Medium | Full implementation of endpoint entities |

---

## Technical Notes

### Key Insight
The fix is simple: `getRelationship()` needs ONE special case for `USER_INTERACTION` to look in `metaModel.entities.interactions` instead of `metaModel.relationships`.

### Code Change (Core Fix)
```typescript
// In getRelationship() - add at start of function:
if (relationshipType === 'USER_INTERACTION') {
  return model.metaModel.entities.interactions?.find(i => i.id === relationshipId);
}
```

### Why This Works
1. Edge is added to `diagram.diagram_edges` with `relationship_type: 'USER_INTERACTION'`
2. `getEdgesForDiagram()` calls `getRelationship('USER_INTERACTION', id, model)`
3. **With the fix:** Returns the Interaction from `entities.interactions`
4. Temporal checks pass (Interaction has `valid_from/valid_to`)
5. Edge is included in result array
6. Canvas renders the edge with its `line_dashes: '4,4'` (dotted)

---

## Success Criteria

The implementation is successful when:
1. Clicking "Add" on interaction row creates edges AND they render as dotted lines
2. Clicking "Delete" removes edges AND dotted lines disappear
3. All existing relationship types continue to render correctly
4. All tests pass
