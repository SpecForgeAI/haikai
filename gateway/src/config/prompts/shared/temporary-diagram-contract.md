# TemporaryArchitectureDiagram Contract Summary

This is the JSON contract for temporary architecture diagrams. The output must be valid JSON conforming to this structure.

## Important Rules

- **No architecture IDs:** All `id` fields are local payload-only identifiers (e.g., `"node-1"`, `"edge-1"`). No internal architecture entity IDs, attribute IDs, or relationship IDs may appear anywhere in the payload.
- **Name-based cross-referencing:** All cross-referencing uses `ref_name` fields with exact name matching against the architecture model.
- **Fixed values for ER diagrams:** `version: 1`, `source_architecture_domain: "DATA"`, `diagram_kind: "ER"`

## Top-Level Structure: `TemporaryArchitectureDiagram`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Local diagram identifier |
| `name` | string | Yes | Display name of the diagram |
| `diagram_kind` | string | Yes | `"ER"` for ER diagrams |
| `source_architecture_domain` | string | Yes | `"DATA"` for data-domain diagrams |
| `view_mode` | string | Yes | `"LOGICAL"` or `"PHYSICAL"` |
| `version` | number | Yes | Always `1` |
| `nodes` | array | Yes | List of diagram nodes |
| `edges` | array | Yes | List of diagram edges |
| `description` | string | No | Diagram purpose description |
| `groups` | array | No | Visual groupings of nodes |
| `metadata` | object | No | `{ created_by_task?: string, notes?: string[] }` |

## Node Structure: `TemporaryArchitectureDiagramNode`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Local node identifier (e.g., `"node-1"`) |
| `node_kind` | string | Yes | `"ENTITY"` for ER diagrams |
| `semantic_type` | string | Yes | `"LOGICAL_DATA_ENTITY"` (LOGICAL view) or `"PHYSICAL_DATA_ENTITY"` (PHYSICAL view) |
| `ref_name` | string | Yes | Exact entity name from the architecture model |
| `display_name` | string | Yes | Human-readable display label |
| `pos_x` | number | Yes | X coordinate of node top-left corner |
| `pos_y` | number | Yes | Y coordinate of node top-left corner |
| `width` | number | Yes | Node width in pixels |
| `height` | number | Yes | Node height in pixels |
| `z_index` | number | No | Draw order (higher = on top) |
| `compartments` | array | No | List of compartments for attribute display |
| `style` | object | No | `{ background_color?: string, line_color?: string, text_color?: string }` (hex) |
| `metadata` | object | No | `{ is_primary?: boolean, is_reference?: boolean, tags?: string[] }` |

## Compartment Structure: `TemporaryArchitectureDiagramCompartment`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Local compartment identifier |
| `compartment_kind` | string | Yes | `"ATTRIBUTES"` for attribute compartments |
| `items` | array | Yes | List of compartment items |

## Compartment Item Structure: `TemporaryArchitectureDiagramCompartmentItem`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Local item identifier |
| `item_kind` | string | Yes | `"ATTRIBUTE"` for data attributes |
| `ref_name` | string | Yes | Exact attribute name from the architecture model |
| `display_name` | string | Yes | Human-readable display label |
| `semantic_type` | string | Yes | `"LOGICAL_DATA_ATTRIBUTE"` (LOGICAL view) or `"PHYSICAL_DATA_ATTRIBUTE"` (PHYSICAL view) |
| `metadata` | object | No | `{ is_primary_key?: boolean, is_foreign_key?: boolean, data_type?: string, is_nullable?: boolean }` |

## Edge Structure: `TemporaryArchitectureDiagramEdge`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Local edge identifier (e.g., `"edge-1"`) |
| `edge_kind` | string | Yes | `"RELATIONSHIP"` for ER diagrams |
| `semantic_type` | string | Yes | `"DATA_ENTITY_RELATIONSHIP"` for ER edges |
| `source_node_id` | string | Yes | Local ID of the source node in this diagram |
| `target_node_id` | string | Yes | Local ID of the target node in this diagram |
| `source_ref_name` | string | Yes | Exact name of the source entity |
| `target_ref_name` | string | Yes | Exact name of the target entity |
| `edge_points` | array | Yes | Ordered list of points defining the edge path |
| `source_item_ref_name` | string | No | Exact source attribute name (for attribute-level edges) |
| `target_item_ref_name` | string | No | Exact target attribute name (for attribute-level edges) |
| `relationship_type` | string | No | One of: `"GENERALIZATION"`, `"REALIZATION"`, `"COMPOSITION"`, `"AGGREGATION"`, `"ASSOCIATION"`, `"DEPENDENCY"` |
| `cardinality` | string | No | One of: `"ONE_TO_ONE"`, `"ONE_TO_MANY"`, `"MANY_TO_ONE"`, `"MANY_TO_MANY"` |
| `relationship_hint` | string | No | Freeform description of the relationship |
| `source_label` | object | No | `{ text: string, pos_x: number, pos_y: number }` |
| `target_label` | object | No | `{ text: string, pos_x: number, pos_y: number }` |
| `style` | object | No | `{ line_color?: string, line_type?: "SOLID" | "DASHED", line_weight?: number }` |
| `metadata` | object | No | `{ optionality?: "OPTIONAL" | "REQUIRED" | "UNKNOWN", notes?: string[] }` |

## Point Structure: `TemporaryArchitectureDiagramPoint`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sequence_order` | number | Yes | Ordinal position in the edge path |
| `pos_x` | number | Yes | X coordinate |
| `pos_y` | number | Yes | Y coordinate |

## Group Structure: `TemporaryArchitectureDiagramGroup`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Local group identifier |
| `group_kind` | string | Yes | Kind of group (e.g., `"SCHEMA"`) |
| `pos_x` | number | Yes | X coordinate of group top-left corner |
| `pos_y` | number | Yes | Y coordinate of group top-left corner |
| `width` | number | Yes | Group width in pixels |
| `height` | number | Yes | Group height in pixels |
| `child_node_ids` | array | Yes | Local IDs of contained nodes |
| `ref_name` | string | No | Group name for resolution |
| `display_name` | string | No | Human-readable group label |
| `style` | object | No | `{ background_color?: string, line_color?: string, text_color?: string }` (hex) |

## ER-Specific Semantic Type Constraints

- **LOGICAL view mode:**
  - Node `semantic_type`: `"LOGICAL_DATA_ENTITY"`
  - Compartment item `semantic_type`: `"LOGICAL_DATA_ATTRIBUTE"`
- **PHYSICAL view mode:**
  - Node `semantic_type`: `"PHYSICAL_DATA_ENTITY"`
  - Compartment item `semantic_type`: `"PHYSICAL_DATA_ATTRIBUTE"`
