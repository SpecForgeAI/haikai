# Specification: Make Advanced Add use Interface Custom Visualisation

## Overview

This specification fixes Advanced Add to produce the same Interface custom visualisation as "Add with all children". Currently:

- **"Add with all children"** (context menu): Produces correct custom layout with Interface wrapping endpoints (as text lines) and ERD-style entity boxes inside.
- **Advanced Add**: Creates separate nodes for Interface, Endpoints, and Logical Entities as generic stacked children.

The fix ensures both paths produce identical results.

## Current Implementation Analysis

### What Works: "Add with all children"

**File**: `frontend/src/components/DiagramsView/PalettePanel.tsx` (lines 1739-1900)

The `handleAddWithAllChildren` function:
1. Gets all endpoints for the interface
2. Gets all logical entities via `interface_logical_entities` relationship
3. Calculates Interface size to wrap all content
4. Creates Interface node with:
   - `render_style: 'contract'`
   - `embedded_endpoint_ids: [...]`
   - `embedded_entity_ids: [...]`
5. Creates child entity nodes positioned INSIDE the Interface with `parent_node_id` set

### What's Missing: Advanced Add

**File**: `frontend/src/components/DiagramsView/PalettePanel.tsx` (lines 187-350)

The `buildWrappedNodeHierarchy` function:
1. Uses `findERDCandidates` for data entities with attributes ✓
2. Filters out attribute types from node creation ✓
3. **Does NOT use** `findInterfaceCustomCandidates` ✗
4. **Does NOT filter out** endpoints when Interface is a custom candidate ✗
5. **Does NOT create** Interface composite nodes ✗

### Detection Functions Exist But Are Unused

**File**: `frontend/src/utils/erdAdvancedAddUtils.ts` (lines 243-350)

The following functions were created but never integrated:
- `isInterfaceCustomLayoutCandidate(node, selectedKeys, metaModel)` - detects if Interface qualifies
- `findInterfaceCustomCandidates(orderedNodes, selectedKeys, metaModel)` - finds all candidates
- `getInterfaceCustomCandidateEndpointIds(candidate)` - extracts endpoint IDs
- `getInterfaceCustomCandidateLogicalEntityIds(candidate)` - extracts entity IDs

## Required Changes

### 1. Create Shared Helper: `buildInterfaceCompositeNodes`

**File**: `frontend/src/utils/interfaceCompositeBuilder.ts` (NEW FILE)

Create a shared helper function that both paths can use:

```typescript
export interface InterfaceCompositeResult {
  interfaceNode: DiagramNode;
  entityNodes: DiagramNode[];
}

export function buildInterfaceCompositeNodes(
  interfaceId: string,
  selectedEndpointIds: string[],
  selectedLogicalEntityIds: string[],
  selectedAttributeIdsByEntity: Map<string, string[]>,
  metaModel: MetaModel,
  basePosition: { x: number; y: number },
  baseZIndex: number,
  parentNodeId: string | null
): InterfaceCompositeResult
```

This function:
- Creates the Interface node with `render_style: 'contract'`
- Calculates correct dimensions to wrap all content
- Creates child entity nodes positioned inside
- Returns both the Interface and entity nodes

### 2. Refactor handleAddWithAllChildren

**File**: `frontend/src/components/DiagramsView/PalettePanel.tsx`

Refactor `handleAddWithAllChildren` to call `buildInterfaceCompositeNodes`:

```typescript
const handleAddWithAllChildren = useCallback((item: PaletteItemData, _sectionId: string) => {
  // ... validation ...

  const endpoints = metaModel.entities.endpoints.filter(ep => ep.interface_id === interfaceId);
  const logicalEntityIds = getLogicalEntityIdsForInterface(interfaceId, metaModel);

  // Use shared helper
  const { interfaceNode, entityNodes } = buildInterfaceCompositeNodes(
    interfaceId,
    endpoints.map(ep => ep.id),
    logicalEntityIds,
    new Map(), // All attributes selected
    metaModel,
    viewportCenter,
    baseZIndex,
    null
  );

  onAddNodes([interfaceNode, ...entityNodes]);
}, [...]);
```

### 3. Update buildWrappedNodeHierarchy

**File**: `frontend/src/components/DiagramsView/PalettePanel.tsx`

Add Interface custom candidate detection and handling:

```typescript
export function buildWrappedNodeHierarchy(...): WrappedNodeResult {
  // ... existing code ...

  // NEW: Find Interface custom layout candidates
  const interfaceCandidates = findInterfaceCustomCandidates(
    orderedNodes,
    selectedKeys,
    metaModel
  );

  // Build map of Interface ID -> candidate for quick lookup
  const interfaceCandidateMap = new Map<string, InterfaceCustomCandidate>();
  for (const candidate of interfaceCandidates) {
    interfaceCandidateMap.set(candidate.interface.entityId, candidate);
  }

  // NEW: Filter out endpoints and entities that belong to Interface custom candidates
  // These will be handled by the composite builder, not created as separate nodes
  const filteredOrderedNodes = orderedNodes.filter(node => {
    // Skip attribute entity types (existing)
    if (isAttributeEntityType(node.entityType)) {
      return false;
    }

    // Skip endpoints that belong to an Interface custom candidate
    if (node.entityType === ENTITY_TYPES.ENDPOINT) {
      const parentInterface = findParentInterfaceForEndpoint(node, orderedNodes);
      if (parentInterface && interfaceCandidateMap.has(parentInterface.entityId)) {
        return false; // Endpoint is embedded in Interface composite
      }
    }

    // Skip logical entities that belong to an Interface custom candidate
    if (node.entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY) {
      const parentInterface = findParentInterfaceForLogicalEntity(node, orderedNodes);
      if (parentInterface && interfaceCandidateMap.has(parentInterface.entityId)) {
        return false; // Entity is embedded in Interface composite
      }
    }

    return true;
  });

  // ... rest of existing code using filteredOrderedNodes ...
}
```

### 4. Update layoutAdvancedAddSelection

**File**: `frontend/src/utils/compoundLayout.ts`

Pass Interface candidate information to the layout algorithm so it can:
1. Use `buildInterfaceCompositeNodes` for Interface candidates
2. Calculate correct dimensions for the composite
3. Ensure parent containers wrap correctly

```typescript
export function layoutAdvancedAddSelection(
  treeData: LayoutTreeNode,
  spacingConfig: SpacingConfig,
  layoutConfig?: LayoutConfig,
  interfaceCandidateMap?: Map<string, InterfaceCustomCandidate>  // NEW
): LayoutNode
```

### 5. Update convertTodiagramNodes

**File**: `frontend/src/utils/compoundLayout.ts`

When processing Interface nodes, check if they're custom candidates:

```typescript
export function convertTodiagramNodes(
  layoutNode: LayoutNode,
  zIndexBase: number,
  erdCandidateMap?: Map<string, string[]>,
  interfaceCandidateMap?: Map<string, InterfaceCustomCandidate>  // NEW
): DiagramNode[]
```

For Interface custom candidates:
- Add `render_style: 'contract'`
- Add `embedded_endpoint_ids` from candidate
- Add `embedded_entity_ids` from candidate
- Create child entity nodes with proper positioning

## Data Flow

### Current Flow (Broken)
```
Advanced Add Selection
       ↓
buildWrappedNodeHierarchy
       ↓
layoutAdvancedAddSelection (no Interface handling)
       ↓
convertTodiagramNodes (creates separate endpoint/entity boxes)
       ↓
Generic stacked layout
```

### Fixed Flow
```
Advanced Add Selection
       ↓
buildWrappedNodeHierarchy
       ↓
findInterfaceCustomCandidates  ←  NEW
       ↓
Filter out endpoint/entity children of Interface candidates  ←  NEW
       ↓
layoutAdvancedAddSelection (with interfaceCandidateMap)
       ↓
convertTodiagramNodes (uses buildInterfaceCompositeNodes for candidates)  ←  NEW
       ↓
Custom Interface layout (same as "Add with all children")
```

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/utils/interfaceCompositeBuilder.ts` | NEW: Shared helper for Interface composite creation |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Refactor handleAddWithAllChildren, update buildWrappedNodeHierarchy |
| `frontend/src/utils/compoundLayout.ts` | Update layoutAdvancedAddSelection and convertTodiagramNodes |
| `frontend/src/utils/erdAdvancedAddUtils.ts` | Add helper functions for parent Interface detection |

## Acceptance Criteria

### AC1: "Add with all children" unchanged
- Existing context menu behaviour for Interface remains as-is
- No regression in existing functionality

### AC2: Advanced Add full chain
- When Application → Component → Service → Interface → Entities + Attributes + Endpoints is selected:
  - Application wraps Component
  - Component wraps Service
  - Service wraps custom Interface node that:
    - Has header + numbered endpoints list
    - Contains ER-style entity boxes with attributes inside its border
  - No separate endpoint boxes or entity boxes outside Interface

### AC3: Visual parity
- "Add with all children" and Advanced Add produce identical Interface JSON
- Visually indistinguishable diagrams

### AC4: Partial selection
- If only some endpoints/entities are selected in Advanced Add:
  - Custom Interface layout includes only selected children
  - No unexpected plain child boxes

### AC5: Interface-only selection
- If Interface is selected but NO endpoints or entities:
  - Falls back to plain Interface node (no custom layout)

## Test Coverage

### Unit Tests
- Test `buildInterfaceCompositeNodes` produces correct node structure
- Test filtering removes endpoints/entities for Interface candidates
- Test parent Interface detection for endpoints and entities

### Integration Tests
- Test Advanced Add with full chain produces same JSON as "Add with all children"
- Test partial selection produces correct subset
- Test nested hierarchy (App → Component → Service → Interface) wraps correctly
- Test z-index ordering is correct

## Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| Breaking existing Advanced Add behaviour | Medium | Comprehensive test coverage before/after |
| Performance impact from additional filtering | Low | Filtering is O(n) and selection sets are small |
| Backward compatibility with saved diagrams | None | No change to diagram JSON format |

## Implementation Order

1. **Phase 1**: Create `buildInterfaceCompositeNodes` helper
2. **Phase 2**: Refactor `handleAddWithAllChildren` to use helper
3. **Phase 3**: Add detection and filtering in `buildWrappedNodeHierarchy`
4. **Phase 4**: Update `convertTodiagramNodes` to use helper for Interface candidates
5. **Phase 5**: Integration testing and verification
