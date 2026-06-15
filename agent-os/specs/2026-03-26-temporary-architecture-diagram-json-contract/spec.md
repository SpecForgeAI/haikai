# Specification: Temporary Architecture Diagram JSON Contract (ER First)

## Goal
Define a generic, LLM-friendly temporary diagram JSON contract (`TemporaryArchitectureDiagram`) that can represent multiple architecture-derived diagram kinds, with ER diagrams as the first supported specialization, enabling deterministic future mapping into the tool's native diagram representation without requiring internal architecture IDs.

## User Stories
- As an LLM agent, I want a well-defined, name-based JSON contract so that I can reliably generate temporary diagram payloads from architecture context without needing internal entity IDs.
- As a developer building diagram import tooling, I want a generic contract with ER-specific constraints so that I can deterministically map temporary diagrams into native `Diagram`, `DiagramNode`, and `DiagramEdge` structures.

## Specific Requirements

**Top-level TemporaryArchitectureDiagram type**
- Define in `frontend/src/types/temporaryArchitectureDiagram.ts` as the single canonical source of truth
- Fields: `id` (string), `name` (string), `description` (optional string), `diagram_kind` (string literal, initially `"ER"`), `source_architecture_domain` (string literal, initially `"DATA"`), `view_mode` (string literal union, initially `"LOGICAL" | "PHYSICAL"`), `version` (number, starts at 1), `nodes` (array), `edges` (array), `groups` (optional array), `metadata` (optional object with `created_by_task?` and `notes?[]`)
- `version` starts at 1 and increments only for breaking contract changes; additive optional fields do not bump version
- `diagram_kind`, `source_architecture_domain`, and `view_mode` are typed as string literal unions to allow future extension without breaking the generic structure

**TemporaryArchitectureDiagramNode type**
- Fields: `id`, `node_kind` (initially `"ENTITY"`), `semantic_type` (string), `ref_name` (string -- exact entity name, no abbreviations), `display_name` (string), `pos_x`, `pos_y`, `width`, `height` (all numbers), `z_index` (optional number)
- Optional `compartments` array of `TemporaryArchitectureDiagramCompartment`
- Optional `style` object: `background_color?`, `line_color?`, `text_color?` (all hex strings)
- Optional `metadata` object: `is_primary?` (boolean), `is_reference?` (boolean), `tags?` (string array)

**TemporaryArchitectureDiagramCompartment and CompartmentItem types**
- Compartment fields: `id`, `compartment_kind` (initially `"ATTRIBUTES"`), `items` array
- CompartmentItem fields: `id`, `item_kind` (initially `"ATTRIBUTE"`), `ref_name` (exact attribute name), `display_name`, `semantic_type`
- CompartmentItem optional `metadata`: `is_primary_key?`, `is_foreign_key?`, `data_type?`, `is_nullable?`
- Compartments replace the native model's `embedded_attribute_ids` / `selected_attribute_ids` approach with a name-based, self-contained representation suitable for LLM generation

**TemporaryArchitectureDiagramEdge type**
- Fields: `id`, `edge_kind` (initially `"RELATIONSHIP"`), `semantic_type` (string), `source_node_id`, `target_node_id`, `source_ref_name`, `target_ref_name` (all strings), `edge_points` (array of Point)
- Optional `source_item_ref_name` and `target_item_ref_name` for attribute-level relationship endpoints
- Optional `relationship_type` field using string literal union aligned with existing `LogicalERRelationship`: `'GENERALIZATION' | 'REALIZATION' | 'COMPOSITION' | 'AGGREGATION' | 'ASSOCIATION' | 'DEPENDENCY'`
- Optional `cardinality` field using string literal union aligned with existing `LogicalERCardinality`: `'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_ONE' | 'MANY_TO_MANY'`
- Optional `relationship_hint` (freeform string for LLM context)
- Nested `source_label?` and `target_label?` objects each with `{ text: string, pos_x: number, pos_y: number }` -- do NOT use the native flat field pattern
- Optional `style` object: `line_color?`, `line_type?` (`"SOLID" | "DASHED"`), `line_weight?` (number)
- Optional `metadata` object: `optionality?` (`"OPTIONAL" | "REQUIRED" | "UNKNOWN"`), `notes?` (string array)

**TemporaryArchitectureDiagramPoint type**
- Fields: `sequence_order` (number), `pos_x` (number), `pos_y` (number)
- Deliberately omits the `id` field present on native `EdgePoint` since temporary diagrams use sequence ordering only

**TemporaryArchitectureDiagramGroup type**
- Fields: `id`, `group_kind` (string), `ref_name?`, `display_name?`, `pos_x`, `pos_y`, `width`, `height` (numbers), `child_node_ids` (string array)
- Optional `style` object: `background_color?`, `line_color?`, `text_color?`
- Groups enable future schema-grouping, swimlane, or container concepts

**ER-specific semantic type constraints**
- When `diagram_kind === "ER"` and `view_mode === "LOGICAL"`: nodes use `semantic_type = "LOGICAL_DATA_ENTITY"`, compartment items use `semantic_type = "LOGICAL_DATA_ATTRIBUTE"`
- When `diagram_kind === "ER"` and `view_mode === "PHYSICAL"`: nodes use `semantic_type = "PHYSICAL_DATA_ENTITY"`, compartment items use `semantic_type = "PHYSICAL_DATA_ATTRIBUTE"`
- Edge matching for future mapping will use `source_ref_name` + `source_item_ref_name` and `target_ref_name` + `target_item_ref_name` to resolve native entity/attribute IDs by exact name
- Document these constraints as JSDoc comments on the `semantic_type` fields

**Inline JSDoc documentation**
- Every field on every interface must have a JSDoc comment explaining its purpose, allowed values, and relationship to native types where applicable
- Include a file-level JSDoc block explaining the contract's purpose, its relationship to native diagram types, and that it is explicitly distinct from `ERContent` / `TypedContentEnvelope`

**Example JSON payload files**
- Create `frontend/src/types/examples/temporary-er-diagram-logical.json` with a realistic LOGICAL ER example (at least 3 entities with attributes, 2+ relationships with cardinality and relationship_type, edge points, and labels)
- Create `frontend/src/types/examples/temporary-er-diagram-physical.json` with a realistic PHYSICAL ER example following the same pattern
- Examples must be valid against the TypeScript interfaces and demonstrate all major features (compartments, edge labels, groups, metadata)
- Create the `frontend/src/types/examples/` directory if it does not exist

**Design principles enforced in the contract**
- No internal architecture IDs anywhere; all matching is by exact `ref_name`
- Layout must be explicit and complete: every node has position and dimensions, every edge has edge_points, every label has position
- Generic structure preserved: `diagram_kind`, `node_kind`, `edge_kind`, `compartment_kind`, `group_kind` are all typed as extensible string literals, not closed enums
- The contract is intentionally separate from `TypedContentEnvelope` and `ERContent` -- it is a pre-binding interchange format, not a persistence format

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**Native diagram types in `frontend/src/types/model.ts`**
- `Diagram`, `DiagramNode`, `DiagramEdge`, `EdgePoint` are the target native types that temporary diagrams will eventually map into
- The temporary contract's geometry fields (`pos_x`, `pos_y`, `width`, `height`, `edge_points`) mirror native field names for consistency
- `embedded_attribute_ids` and `selected_attribute_ids` on `DiagramNode` are the native equivalent of the temporary contract's compartments
- `NodeRenderStyle` (`'standard' | 'erd' | 'contract'`) is NOT included in the temporary contract; future mapping code derives render_style from `diagram_kind`

**ER relationship enums in `frontend/src/types/model.ts`**
- `LogicalERCardinality` (`'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_ONE' | 'MANY_TO_MANY'`) -- the temporary edge `cardinality` field must use the same literal values
- `LogicalERRelationship` (`'GENERALIZATION' | 'REALIZATION' | 'COMPOSITION' | 'AGGREGATION' | 'ASSOCIATION' | 'DEPENDENCY'`) -- the temporary edge `relationship_type` field must use the same literal values
- `LogicalDataEntityRelationship` shows how native relationships use `fromDataEntityPointId` / `toDataEntityPointId` (ID-based) which the temporary contract replaces with name-based `source_ref_name` / `target_ref_name`

**Data entity types in `frontend/src/types/model.ts`**
- `LogicalDataEntity` and `LogicalDataAttribute` define the native logical model fields that LOGICAL-mode temporary nodes/items correspond to
- `PhysicalDataEntity` and `PhysicalDataAttribute` define the native physical model fields that PHYSICAL-mode temporary nodes/items correspond to
- The temporary contract's `ref_name` fields must match the `name` field on these native entities exactly

**TypedContentEnvelope pattern in `frontend/src/types/typedContent.ts`**
- Demonstrates the existing envelope pattern (type + version + content) used for persisted diagram typed content
- The temporary contract is intentionally standalone and must NOT be forced into this pattern, but its `version` field follows a compatible convention
- `ERContent`, `EREntityRef`, `ERRelationshipRef` are native/persisted ER concepts distinct from the temporary interchange contract

**Gateway ResolvedRelationship in `gateway/src/types/chat.ts`**
- Shows how the gateway models relationships in context bundles with `from`/`to` endpoints carrying `entity_type`, `entity_id`, and `name`
- The temporary contract's edge structure is conceptually compatible (source/target with ref_names) but deliberately avoids IDs

## Out of Scope
- MCP tool integration or MCP server changes
- Saving, persistence, or finalization logic for temporary diagrams
- Rendering logic or React components for temporary diagrams
- Auto-mapping or resolution code that converts temporary diagrams to native `Diagram` / `DiagramNode` / `DiagramEdge`
- Confirmation modal or user approval UI flows
- Modifications to the native persisted diagram schema (`model.ts`, `typedContent.ts`)
- Implementation of any non-ER diagram kinds (Sequence, Activity, State, etc.)
- LLM prompt behavior, system prompts, or agent task definitions
- Shared types package between gateway and frontend (gateway consumers use the documented JSON shape directly)
- Forcing the contract into the existing `TypedContentEnvelope` envelope pattern
