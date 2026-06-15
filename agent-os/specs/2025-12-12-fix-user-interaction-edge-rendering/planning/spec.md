# Specification: Fix Rendering of USER_INTERACTION Edges in getEdgesForDiagram

## 1. Overview

### 1.1 Problem Statement

User Interaction edges are being created correctly in the diagram state but are never rendered on the canvas. The bug is in the edge-filtering logic in `getEdgesForDiagram()`, which assumes all relationship-backed edges can be resolved via `relationshipTypeMap` → `metaModel.relationships`.

However, `USER_INTERACTION` is stored in `metaModel.entities.interactions`, NOT in `metaModel.relationships`, so the lookup fails and the edge is filtered out with reason `relationship_not_found`.

### 1.2 Current Behavior (Bug)

When a user adds a User Interaction:

1. User clicks an enabled interaction row in the palette
2. `handleAddUserInteraction()` calls `addUserInteractionToDiagram()`
3. Edge objects are created with:
   - `relationship_type: "USER_INTERACTION"`
   - `relationship_id: interaction.id`
   - `subType: "MAIN"` (and optionally `"USER_LINK"`)
   - `line_dashes: "4,4"` (dotted style)
   - Valid `source_node_id` and `target_node_id`
4. `onAddEdge()` dispatches `ADD_DIAGRAM_EDGE`
5. Reducer correctly adds edge(s) to `diagram.diagram_edges`
6. On render, `getEdgesForDiagram()`:
   - Calls `getRelationship("USER_INTERACTION", relationship_id, model)`
   - `getRelationship()` uses `relationshipTypeMap["USER_INTERACTION"]`
   - **USER_INTERACTION is NOT in `relationshipTypeMap`**
   - Returns `undefined`
   - Edge is filtered out with reason `relationship_not_found`
7. **Result:** Edge exists in state but is never passed to the canvas renderer

### 1.3 Code Location

**File:** `frontend/src/utils/rendering.ts`

**Current `relationshipTypeMap` (lines 27-37):**
```typescript
const relationshipTypeMap: Record<string, keyof ArchitectureModel['metaModel']['relationships']> = {
  USER_BUSINESS_POINT: 'business_user_business_points',
  APP_POINT_BUSINESS_POINT: 'application_point_business_points',
  LOGICAL_DATA_ENTITY_RELATIONSHIP: 'logical_data_entity_relationships',
  LOGICAL_DATA_ENTITY_PHYSICAL_DATA_ENTITY: 'logical_data_entity_physical_data_entities',
  LOGICAL_DATA_ATTRIBUTE_PHYSICAL_DATA_ATTRIBUTE: 'logical_data_attribute_physical_data_attributes',
  DATA_MOVEMENT: 'data_movements',
  INTERFACE_LOGICAL_ENTITY: 'interface_logical_entities',
};
```

**`getRelationship()` function (lines 160-170):**
```typescript
export function getRelationship(
  relationshipType: string,
  relationshipId: string,
  model: ArchitectureModel
): AnyRelationship | undefined {
  const arrayKey = relationshipTypeMap[relationshipType];
  if (!arrayKey) return undefined;  // <-- USER_INTERACTION fails here

  const relationships = model.metaModel.relationships[arrayKey] as AnyRelationship[];
  return relationships.find((r) => r.id === relationshipId);
}
```

### 1.4 Goals

1. Enable `getRelationship()` to resolve USER_INTERACTION from `metaModel.entities.interactions`
2. Ensure USER_INTERACTION edges are included in `getEdgesForDiagram()` results
3. Ensure dotted lines appear on the canvas when User Interactions are added
4. Maintain backward compatibility with all existing relationship types

### 1.5 Non-Goals

- Changing the storage location of Interactions (they remain in `entities`)
- Modifying edge creation logic (already works correctly)
- Changing the edge rendering logic (already handles dotted lines correctly)

## 2. Technical Design

### 2.1 Approach: Special-Case Handling (Minimal Change)

The simplest fix is to add special-case handling for `USER_INTERACTION` in `getRelationship()`:

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

### 2.2 Update getRelationshipEndpointEntities()

The `getRelationshipEndpointEntities()` function also needs a case for USER_INTERACTION to support temporal validation of endpoint entities:

```typescript
case 'USER_INTERACTION': {
  // USER_INTERACTION endpoints are:
  // - user_id -> BusinessUser (timeless)
  // - primary_app_business_point_id -> Resolved via ABP to underlying entity
  // - secondary_app_business_point_id -> Resolved via ABP to underlying entity (optional)
  const interaction = relationship as Interaction;

  // Add the user
  const user = metaModel.entities.business_users.find(u => u.id === interaction.user_id);
  if (user) endpoints.push(user);

  // For ABP resolution, we need the underlying Application/Service/etc.
  // The ABP itself is not temporal, but the underlying entity may be
  const primaryAbp = metaModel.entities.app_business_points?.find(
    abp => abp.id === interaction.primary_app_business_point_id
  );
  if (primaryAbp) {
    const primaryEntity = getEntityForAbp(primaryAbp, metaModel);
    if (primaryEntity) endpoints.push(primaryEntity);
  }

  if (interaction.secondary_app_business_point_id) {
    const secondaryAbp = metaModel.entities.app_business_points?.find(
      abp => abp.id === interaction.secondary_app_business_point_id
    );
    if (secondaryAbp) {
      const secondaryEntity = getEntityForAbp(secondaryAbp, metaModel);
      if (secondaryEntity) endpoints.push(secondaryEntity);
    }
  }

  break;
}
```

### 2.3 Helper Function for ABP Entity Resolution

Add a helper to resolve the underlying entity from an ABP:

```typescript
function getEntityForAbp(abp: AppBusinessPoint, metaModel: MetaModel): AnyEntity | undefined {
  switch (abp.kind) {
    case 'APPLICATION':
      return metaModel.entities.applications.find(e => e.id === abp.source_entity_id);
    case 'APP_COMPONENT':
      return metaModel.entities.app_components.find(e => e.id === abp.source_entity_id);
    case 'SERVICE':
      return metaModel.entities.services.find(e => e.id === abp.source_entity_id);
    case 'INTERFACE':
      return metaModel.entities.interfaces.find(e => e.id === abp.source_entity_id);
    case 'BUSINESS_PROCESS':
      return metaModel.entities.business_processes.find(e => e.id === abp.source_entity_id);
    case 'PROCESS_ACTIVITY':
      return metaModel.entities.process_activities.find(e => e.id === abp.source_entity_id);
    default:
      return undefined;
  }
}
```

### 2.4 Temporal Validity for USER_INTERACTION

`getEdgesForDiagram()` already applies temporal validity checks:
1. Edge-level validity (`edge.valid_from / valid_to`)
2. Relationship-level validity (`relationship.valid_from / valid_to`)
3. Endpoint entity validity

The same logic applies to USER_INTERACTION:
- After `getRelationship("USER_INTERACTION", ...)` returns the Interaction
- Check `isRelationshipVisibleInPeriod(interaction, viewQuarter)` (Interactions have `valid_from/valid_to`)
- Check endpoint entity visibility via `getRelationshipEndpointEntities()`

No special-case skipping needed - USER_INTERACTION participates in temporality like other relationships.

## 3. Acceptance Criteria

### AC1 - Relationship Resolution
- `getRelationship("USER_INTERACTION", interaction.id, model)` returns the correct Interaction object from `model.metaModel.entities.interactions`
- If the Interaction row is deleted from the meta-model, USER_INTERACTION edges are filtered out as `relationship_not_found`

### AC2 - Rendering
After adding a User Interaction via the palette:
- USER_INTERACTION edges are present in `diagram.diagram_edges` (already working)
- `getEdgesForDiagram()` includes these edges in its result list (subject to temporality)
- The canvas shows:
  - A dotted MAIN line between the two App nodes (Case A) or between User and Primary (Case B)
  - Optional dotted USER_LINK line for Case A (when User is on the diagram)
  - The label for the Interaction name at the midpoint

### AC3 - No Regression
- Existing relationship types (Logical ER, Data Movements, User <-> Business Point, etc.) continue to resolve via `relationshipTypeMap` → `model.metaModel.relationships`
- All existing tests pass

### AC4 - Diagnostics
- The reason `relationship_not_found` is no longer logged for USER_INTERACTION edges when the Interaction exists
- If the Interaction is removed or invalid for the current period, edges are correctly filtered

## 4. Test Plan

### 4.1 Unit Tests

```typescript
describe('getRelationship for USER_INTERACTION', () => {
  it('returns Interaction from entities.interactions', () => {
    const interaction = { id: 'int-1', name: 'Test', user_id: '...', ... };
    const model = { metaModel: { entities: { interactions: [interaction] }, relationships: {} } };

    const result = getRelationship('USER_INTERACTION', 'int-1', model);
    expect(result).toBe(interaction);
  });

  it('returns undefined when Interaction not found', () => {
    const model = { metaModel: { entities: { interactions: [] }, relationships: {} } };

    const result = getRelationship('USER_INTERACTION', 'nonexistent', model);
    expect(result).toBeUndefined();
  });
});

describe('getEdgesForDiagram with USER_INTERACTION', () => {
  it('includes USER_INTERACTION edges when Interaction exists', () => {
    // Setup: diagram with USER_INTERACTION edge, model with matching Interaction
    // Assert: edge is included in result
  });

  it('filters USER_INTERACTION edges when Interaction not found', () => {
    // Setup: diagram with USER_INTERACTION edge, model WITHOUT matching Interaction
    // Assert: edge is NOT included in result
  });
});
```

### 4.2 Integration Test

- Add User Interaction via palette
- Verify edges appear in `diagram.diagram_edges`
- Verify `getEdgesForDiagram()` returns those edges
- Verify dotted lines render on canvas

## 5. Files Summary

### Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/utils/rendering.ts` | Add USER_INTERACTION case to `getRelationship()`, add case to `getRelationshipEndpointEntities()`, add `getEntityForAbp()` helper |

### Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/__tests__/user-interaction-edge-rendering.test.ts` | Tests for USER_INTERACTION edge resolution and rendering |

## 6. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing relationship types | Low | High | Careful testing, change is additive |
| Missing endpoint validation | Low | Medium | Include ABP resolution in endpoint entities |
| Type errors with Interaction | Low | Low | Proper type casting |

## 7. Implementation Notes

### 7.1 Import Requirements

The `Interaction` type will need to be imported in `rendering.ts`:

```typescript
import { Interaction, AppBusinessPoint } from '../types/model';
```

### 7.2 Type Compatibility

The `AnyRelationship` type may need to be extended to include `Interaction`, or the return type of `getRelationship()` should be `AnyRelationship | Interaction | undefined`.

### 7.3 Console Warnings

The existing console.warn for `relationship_not_found` is helpful for debugging. After this fix, it should only appear when:
- The Interaction has been genuinely deleted from the model
- The relationship_id is invalid/corrupted
