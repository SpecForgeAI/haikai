# Enable Endpoint Nodes in Diagram View

## Overview

The Endpoint meta-model entity was added in a previous spec, but it is not yet recognized by the Diagram view. This causes:
1. **Validation error**: "Node ... has unknown entity type ENDPOINT" when loading diagrams with Endpoint nodes
2. **Missing palette section**: No "Endpoints" section in the diagram palette

This spec wires the Endpoint entity into the diagram layer as a first-class node type.

---

## Current State Analysis

### Root Cause: Missing Entity Type Mappings

**File:** `frontend/src/utils/rendering.ts` (lines 10-22)

The `entityTypeMap` is missing the ENDPOINT entry:

```typescript
const entityTypeMap: Record<string, keyof MetaModelEntities> = {
  APPLICATION: 'applications',
  APP_COMPONENT: 'app_components',
  SERVICE: 'services',
  INTERFACE: 'interfaces',
  // MISSING: ENDPOINT: 'endpoints',
  BUSINESS_USER: 'business_users',
  // ... other entries
};
```

This map is used by:
1. `validateDiagramNodes()` (line 1068) - throws "unknown entity type" error
2. `getEntityLabel()` (line 63) - returns entity name for display
3. `getEntity()` (line 150) - retrieves entity from model

**File:** `frontend/src/utils/validation.ts` (lines 681-693)

Same missing entry in the validation module's `entityTypeMap`.

**File:** `frontend/src/utils/validation.ts` (lines 21-35)

`ENTITY_TYPE_DISPLAY_NAMES` is also missing the endpoint entry.

### Missing Palette Section

**File:** `frontend/src/utils/paletteData.ts` (lines 55-119)

The `getPaletteSections()` function defines entity sections but excludes Endpoints with a comment indicating they render as text rows inside Interface contracts:

```typescript
// Lines 101-103 - Endpoints excluded as "text rows inside Interface contract boxes"
```

For standalone Endpoint nodes to work, we need to add an Endpoints section.

### What Already Works

1. **ENTITY_TYPES.ENDPOINT** is defined in `model.ts` (line 486)
2. **MetaModelEntities.endpoints** array exists in `model.ts` (line 860)
3. **Endpoint interface** is fully defined with all fields
4. **Entity colors** include ENDPOINT in `defaults.ts`
5. **Grid configuration** for endpoints exists in `gridConfigs.ts`

---

## Specification

### 1. Add ENDPOINT to Entity Type Maps

#### 1.1 Update rendering.ts entityTypeMap

**File to modify:** `frontend/src/utils/rendering.ts` (lines 10-22)

Add ENDPOINT entry:

```typescript
const entityTypeMap: Record<string, keyof MetaModelEntities> = {
  APPLICATION: 'applications',
  APP_COMPONENT: 'app_components',
  SERVICE: 'services',
  INTERFACE: 'interfaces',
  ENDPOINT: 'endpoints',  // ADD THIS
  BUSINESS_USER: 'business_users',
  BUSINESS_PROCESS: 'business_processes',
  PROCESS_ACTIVITY: 'process_activities',
  BUSINESS_POINT: 'business_points',
  LOGICAL_DATA_ENTITY: 'logical_data_entities',
  PHYSICAL_DATA_ENTITY: 'physical_data_entities',
  APPLICATION_POINT: 'application_points',
};
```

#### 1.2 Update validation.ts entityTypeMap

**File to modify:** `frontend/src/utils/validation.ts` (lines 681-693)

Add ENDPOINT entry:

```typescript
const entityTypeMap: Record<string, keyof typeof syncedModel.metaModel.entities> = {
  APPLICATION: 'applications',
  APP_COMPONENT: 'app_components',
  SERVICE: 'services',
  INTERFACE: 'interfaces',
  ENDPOINT: 'endpoints',  // ADD THIS
  BUSINESS_USER: 'business_users',
  // ... rest unchanged
};
```

#### 1.3 Update ENTITY_TYPE_DISPLAY_NAMES

**File to modify:** `frontend/src/utils/validation.ts` (lines 21-35)

Add endpoints entry:

```typescript
export const ENTITY_TYPE_DISPLAY_NAMES: Record<EntityType, string> = {
  'application_points': 'APPLICATION_POINT',
  'applications': 'APPLICATION',
  'app_components': 'APP_COMPONENT',
  'services': 'SERVICE',
  'interfaces': 'INTERFACE',
  'endpoints': 'ENDPOINT',  // ADD THIS
  // ... rest unchanged
};
```

---

### 2. Add Endpoints Section to Palette

#### 2.1 Update getPaletteSections

**File to modify:** `frontend/src/utils/paletteData.ts`

Add Endpoints section after Interfaces (around line 100):

```typescript
// After Interfaces section (lines 96-100)
{
  id: 'endpoints',
  label: 'Endpoints',
  items: metaModel.entities.endpoints || [],
  type: 'entity' as const,
},
```

**New ordering:**
1. Business Users
2. Business Processes
3. Process Activities
4. Applications
5. App Components
6. Services
7. Interfaces
8. **Endpoints** (NEW)
9. Logical Entities
10. Physical Entities

#### 2.2 Update getEntityTypeConstant

**File to modify:** `frontend/src/utils/paletteData.ts` (lines 16-33)

Add endpoints mapping:

```typescript
const mapping: Record<string, string> = {
  // ... existing entries
  interfaces: ENTITY_TYPES.INTERFACE,
  endpoints: ENTITY_TYPES.ENDPOINT,  // ADD THIS
  // ... rest unchanged
};
```

---

### 3. Rendering Support

#### 3.1 Entity Colors (Already Done)

**File:** `frontend/src/config/defaults.ts`

ENDPOINT color is already defined:
```typescript
ENDPOINT: { background: '#E1F5FE', border: '#0288D1' },
```

#### 3.2 Node Rendering

**File:** `frontend/src/components/DiagramsView/Canvas.tsx`

The unified rendering pipeline (from z_index spec) should automatically handle Endpoint nodes since:
1. `getSortedRenderOrder()` includes all nodes regardless of entity_type
2. `renderElement()` dispatches to `renderNode()` for type='node'
3. `renderNode()` uses standard box rendering for non-special entity types

No changes needed if the standard box rendering path is used.

#### 3.3 getEntityLabel Support

**File:** `frontend/src/utils/rendering.ts`

The `getEntityLabel()` function (lines 58-139) uses `entityTypeMap` to look up entities. Once ENDPOINT is added to the map, it will correctly return endpoint names.

---

### 4. Validation Fix

#### 4.1 validateDiagramNodes

**File:** `frontend/src/utils/rendering.ts` (lines 1054-1084)

Once ENDPOINT is added to `entityTypeMap`, the validation will:
1. Find the target type: `'endpoints'`
2. Look up in `model.metaModel.entities.endpoints`
3. Verify the entity exists
4. No "unknown entity type" error

#### 4.2 Data Sync Validation

**File:** `frontend/src/utils/validation.ts` (lines 695-723)

Same fix applies - adding ENDPOINT to the map resolves the validation error.

---

### 5. Files Summary

| File | Changes |
|------|---------|
| `frontend/src/utils/rendering.ts` | Add `ENDPOINT: 'endpoints'` to entityTypeMap (line ~15) |
| `frontend/src/utils/validation.ts` | Add `ENDPOINT: 'endpoints'` to entityTypeMap (line ~687) |
| `frontend/src/utils/validation.ts` | Add `'endpoints': 'ENDPOINT'` to ENTITY_TYPE_DISPLAY_NAMES (line ~28) |
| `frontend/src/utils/paletteData.ts` | Add Endpoints section to getPaletteSections (after line 100) |
| `frontend/src/utils/paletteData.ts` | Add `endpoints: ENTITY_TYPES.ENDPOINT` to getEntityTypeConstant mapping |

---

### 6. Acceptance Criteria

1. **Palette section exists**
   - Diagram view palette shows "Endpoints" section under "Interfaces"
   - Section lists all Endpoint entities from the meta-model

2. **Node creation works**
   - Dragging/clicking an Endpoint from palette creates a diagram node
   - Node has `entity_type: 'ENDPOINT'` and `entity_id` pointing to the endpoint

3. **Node rendering works**
   - Endpoint nodes render as standard boxes with endpoint name
   - Uses ENDPOINT color scheme (light cyan with deep cyan border)

4. **Node interactions work**
   - Move, resize, z-index, auto-size all work as for other nodes
   - Context menu appears with standard options

5. **Load without error**
   - Diagrams containing Endpoint nodes load without "unknown entity type" error
   - Nodes are rendered on canvas

6. **Save preserves endpoints**
   - Saving and reloading a diagram with Endpoints preserves them

---

### 7. Implementation Notes

1. **Minimal changes**: This is primarily a registration/mapping fix. The rendering infrastructure already supports any node type.

2. **Testing strategy**:
   - Add Endpoint entries to entity type maps
   - Verify no validation errors on load
   - Verify palette section appears
   - Verify nodes can be created and rendered

3. **Backward compatibility**: Loading diagrams without Endpoint nodes is unaffected. Only diagrams with Endpoint nodes (previously broken) will now work.

4. **Advanced Add integration**: If Advanced Add creates Endpoint nodes via Interface → Endpoint relationship, they will now render correctly since the entity type is recognized.
