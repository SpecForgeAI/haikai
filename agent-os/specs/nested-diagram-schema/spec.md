# Nested Diagram Schema - Specification

## Overview

Change the diagram schema from a flat structure to a nested structure where:
- `diagram_nodes[]` and `diagram_edges[]` are nested inside each diagram
- `edge_points[]` are nested inside each diagram_edge
- Position fields use `pos_x`/`pos_y` naming
- Entity type values use SCREAMING_SNAKE_CASE (e.g., `APPLICATION_POINT`)

## Problem Statement

The current implementation uses a flat structure with:
- `diagram_nodes[]`, `diagram_edges[]`, `edge_points[]` at root level
- Position fields as `x`/`y`
- Entity types as PascalCase (e.g., `ApplicationPoint`)

This doesn't match the original v0.1 spec schema and is less intuitive for users.

## Requirements

### Target JSON Structure

```json
{
  "metaModel": {
    "entities": { ... },
    "relationships": { ... }
  },
  "diagrams": [
    {
      "id": "d1",
      "name": "Diagram Name",
      "description": "Description",
      "diagram_type": "DATA_MOVEMENTS",
      "settings": {},
      "diagram_nodes": [
        {
          "id": "n1",
          "entity_type": "APPLICATION_POINT",
          "entity_id": "ap_oms",
          "pos_x": 100,
          "pos_y": 200,
          "width": 180,
          "height": 80,
          "auto_size": false,
          "z_index": 1,
          "parent_node_id": null,
          "style_override": {}
        }
      ],
      "diagram_edges": [
        {
          "id": "e1",
          "relationship_type": "DATA_MOVEMENT",
          "relationship_id": "dm_trade_oms_to_risk",
          "source_node_id": "n1",
          "target_node_id": "n2",
          "label_text": "Daily Batch",
          "label_pos_x": 290,
          "label_pos_y": 180,
          "line_weight": "MEDIUM",
          "line_type": "SOLID",
          "arrow_start": "NONE",
          "arrow_end": "ARROW",
          "style_override": {},
          "edge_points": [
            {
              "id": "p1",
              "sequence_order": 0,
              "pos_x": 280,
              "pos_y": 240
            }
          ]
        }
      ]
    }
  ]
}
```

### Key Changes

1. **Nested Structure**
   - Remove root-level `diagram_nodes[]`, `diagram_edges[]`, `edge_points[]`
   - Each diagram contains its own `diagram_nodes[]` and `diagram_edges[]`
   - Each diagram_edge contains its own `edge_points[]`

2. **Field Names**
   - Change `x` → `pos_x`
   - Change `y` → `pos_y`
   - Remove `diagram_id` from nodes/edges (implicit from parent)
   - Remove `edge_id` from edge_points (implicit from parent)
   - Change `sequence` → `sequence_order`

3. **Entity Type Values**
   - Use SCREAMING_SNAKE_CASE: `APPLICATION_POINT`, `BUSINESS_USER`, `BUSINESS_PROCESS`, `APPLICATION`, `APP_COMPONENT`, `SERVICE`, `LOGICAL_DATA_ENTITY`, `PHYSICAL_DATA_ENTITY`

4. **Additional Diagram Fields**
   - Add `diagram_type` field
   - Add `settings` object

5. **Additional Node Fields**
   - Add `auto_size` boolean
   - Add `z_index` number
   - Add `style_override` object

6. **Additional Edge Fields**
   - Add `relationship_type` field
   - Add `label_text`, `label_pos_x`, `label_pos_y`
   - Add `line_weight`, `line_type`
   - Add `arrow_start`, `arrow_end`
   - Add `style_override` object

## Implementation Changes

### Files to Modify

1. **`frontend/src/types/model.ts`**
   - Update `Diagram` interface to include `diagram_nodes[]` and `diagram_edges[]`
   - Update `DiagramNode` interface: remove `diagram_id`, rename `x`/`y` to `pos_x`/`pos_y`, add new fields
   - Update `DiagramEdge` interface: remove `diagram_id`, add `edge_points[]` and new fields
   - Update `EdgePoint` interface: remove `edge_id`, rename fields
   - Remove root-level `diagram_nodes`, `diagram_edges`, `edge_points` from `ArchitectureModel`
   - Create entity type enum/constant with SCREAMING_SNAKE_CASE values

2. **`frontend/src/utils/fileOperations.ts`**
   - Update load to parse nested diagram structure
   - Update save to serialize nested structure
   - Default missing `diagram_nodes`/`diagram_edges` to empty arrays

3. **`frontend/src/utils/rendering.ts`**
   - Update `getNodesInRenderOrder` to access nodes from diagram object
   - Update `getEdgesForDiagram` to access edges from diagram object
   - Update `getEdgePoints` to access points from edge object
   - Update `getEntityLabel` to handle SCREAMING_SNAKE_CASE entity types
   - Update all position field access to use `pos_x`/`pos_y`

4. **`frontend/src/utils/validation.ts`**
   - Update diagram validation to use nested structure
   - Update entity type mapping for SCREAMING_SNAKE_CASE

5. **`frontend/src/components/DiagramsView/Canvas.tsx`**
   - Update node rendering to use `pos_x`/`pos_y`
   - Update to access nodes/edges from selected diagram object
   - Handle additional node/edge properties (z_index, styles, etc.)

6. **`frontend/src/config/defaults.ts`**
   - Update entity type mappings for SCREAMING_SNAKE_CASE
   - Update `emptyModel` to remove root-level diagram arrays

7. **`frontend/src/contexts/ArchitectureContext.tsx`**
   - Remove diagram_nodes, diagram_edges, edge_points from state structure

8. **`frontend/public/sample-architecture.json`**
   - Update to use nested diagram structure

### Type Definitions

```typescript
// Entity type values (SCREAMING_SNAKE_CASE)
export const ENTITY_TYPES = {
  APPLICATION: 'APPLICATION',
  APP_COMPONENT: 'APP_COMPONENT',
  SERVICE: 'SERVICE',
  APPLICATION_POINT: 'APPLICATION_POINT',
  BUSINESS_USER: 'BUSINESS_USER',
  BUSINESS_PROCESS: 'BUSINESS_PROCESS',
  LOGICAL_DATA_ENTITY: 'LOGICAL_DATA_ENTITY',
  PHYSICAL_DATA_ENTITY: 'PHYSICAL_DATA_ENTITY',
} as const;

export type DiagramEntityType = typeof ENTITY_TYPES[keyof typeof ENTITY_TYPES];

export interface EdgePoint {
  id: string;
  sequence_order: number;
  pos_x: number;
  pos_y: number;
}

export interface DiagramEdge {
  id: string;
  relationship_type: string;
  relationship_id: string;
  source_node_id: string;
  target_node_id: string;
  label_text?: string;
  label_pos_x?: number;
  label_pos_y?: number;
  line_weight?: string;
  line_type?: string;
  arrow_start?: string;
  arrow_end?: string;
  style_override?: Record<string, unknown>;
  edge_points: EdgePoint[];
}

export interface DiagramNode {
  id: string;
  entity_type: DiagramEntityType;
  entity_id: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  auto_size?: boolean;
  z_index?: number;
  parent_node_id: string | null;
  style_override?: Record<string, unknown>;
}

export interface Diagram {
  id: string;
  name: string;
  description: string;
  diagram_type?: string;
  settings?: Record<string, unknown>;
  diagram_nodes: DiagramNode[];
  diagram_edges: DiagramEdge[];
}

export interface ArchitectureModel {
  metaModel: MetaModel;
  diagrams: Diagram[];
  // Remove: diagram_nodes, diagram_edges, edge_points
}
```

## Acceptance Criteria

1. **Example JSON loads successfully**
   - The provided example JSON loads without errors
   - Diagram nodes display on canvas at correct positions
   - Diagram edges render between nodes

2. **Save produces correct structure**
   - Saved JSON uses nested diagram structure
   - All fields use correct names (`pos_x`, `pos_y`, `sequence_order`)
   - Entity types use SCREAMING_SNAKE_CASE

3. **Round-trip preserves data**
   - Load → Save → Load preserves all diagram data
   - Node positions, edge points, styles all maintained

4. **Entity type mapping works**
   - SCREAMING_SNAKE_CASE entity types map to correct colors
   - Labels display correctly for all entity types

5. **Validation works**
   - Invalid entity references in diagram nodes are detected
   - Missing diagrams array defaults to empty

## Out of Scope

- Interactive diagram editing (v0.1 is read-only)
- Auto-layout algorithms
- Style override rendering (just store the data)

## Testing

1. Load the provided example JSON
2. Verify "OMS to Risk Flow" diagram displays
3. Verify two ApplicationPoint nodes at positions (100,200) and (400,200)
4. Verify edge connects the nodes with arrowhead
5. Save the model and verify JSON structure matches expected format
6. Reload saved file and verify display is unchanged
