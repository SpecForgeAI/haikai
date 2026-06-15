/**
 * Temporary Architecture Diagram JSON Contract
 *
 * This file defines the canonical TypeScript interfaces for the Temporary Architecture
 * Diagram contract -- a pre-binding interchange format designed for LLM-generated
 * diagram payloads that can be deterministically mapped into the tool's native
 * diagram representation.
 *
 * **Purpose:**
 * The contract provides a generic, name-based JSON structure that an LLM agent can
 * reliably produce from architecture context alone, without needing internal entity
 * IDs. Future mapping code will resolve `ref_name` fields to native entity/attribute
 * IDs and convert these temporary structures into native `Diagram`, `DiagramNode`,
 * and `DiagramEdge` instances (defined in `model.ts`).
 *
 * **Relationship to native types in `model.ts`:**
 * - `TemporaryArchitectureDiagramNode` is the pre-binding equivalent of `DiagramNode`.
 *   Native `DiagramNode` uses `entity_id` (an internal ID); this contract uses `ref_name`
 *   (an exact entity name) for future name-based resolution.
 * - `TemporaryArchitectureDiagramEdge` is the pre-binding equivalent of `DiagramEdge`.
 *   Native `DiagramEdge` uses `relationship_id` and flat label fields; this contract uses
 *   `source_ref_name`/`target_ref_name` for name-based matching and nested label objects.
 * - `TemporaryArchitectureDiagramPoint` corresponds to `EdgePoint` but omits the `id` field,
 *   relying on `sequence_order` for ordering instead.
 * - Compartments replace the native `embedded_attribute_ids`/`selected_attribute_ids`
 *   approach with a self-contained, name-based representation.
 *
 * **Distinction from `ERContent` / `TypedContentEnvelope` in `typedContent.ts`:**
 * This contract is explicitly distinct from the `TypedContentEnvelope` and `ERContent`
 * types defined in `typedContent.ts`. Those types are native/persisted ER content
 * structures that use internal entity IDs. This contract is a pre-binding interchange
 * format that uses exact names for matching and is NOT intended to be stored in the
 * `TypedContentEnvelope` envelope pattern.
 *
 * **No internal architecture IDs:**
 * No internal architecture entity IDs, attribute IDs, relationship IDs, or any other
 * system-generated identifiers appear anywhere in this contract. All cross-referencing
 * is performed by exact name matching via `ref_name` fields. The `id` fields on nodes,
 * edges, compartments, and items are local identifiers within the temporary diagram
 * payload only and carry no meaning outside of it.
 *
 * @module temporaryArchitectureDiagram
 */

// ============================================================================
// Point
// ============================================================================

/**
 * A point along an edge path in a temporary architecture diagram.
 *
 * Deliberately omits the `id` field present on native `EdgePoint` (from `model.ts`).
 * Temporary diagrams use `sequence_order` for ordering points along an edge path
 * rather than relying on database-generated IDs.
 */
export interface TemporaryArchitectureDiagramPoint {
  /**
   * The ordinal position of this point in the edge path.
   * Points are rendered in ascending `sequence_order` to form the edge polyline.
   */
  sequence_order: number;

  /**
   * The X coordinate of this point on the diagram canvas.
   * Mirrors the `pos_x` field on native `EdgePoint`.
   */
  pos_x: number;

  /**
   * The Y coordinate of this point on the diagram canvas.
   * Mirrors the `pos_y` field on native `EdgePoint`.
   */
  pos_y: number;
}

// ============================================================================
// Compartment Item
// ============================================================================

/**
 * A single item within a compartment of a temporary architecture diagram node.
 *
 * For ER diagrams, compartment items represent data attributes displayed inside
 * an entity node. The `ref_name` field must exactly match the `name` field on
 * the corresponding native entity type for future name-based resolution.
 */
export interface TemporaryArchitectureDiagramCompartmentItem {
  /**
   * Local identifier for this compartment item within the temporary diagram payload.
   * This ID has no meaning outside of the temporary diagram and is NOT an internal
   * architecture attribute ID.
   */
  id: string;

  /**
   * The kind of compartment item. Typed as an extensible string literal to allow
   * future item kinds beyond attributes.
   *
   * Currently supported values:
   * - `'ATTRIBUTE'`: Represents a data attribute within an entity compartment.
   */
  item_kind: 'ATTRIBUTE' | (string & {});

  /**
   * The exact name of the attribute this item represents, used for future name-based
   * resolution to native attribute IDs.
   *
   * **ER constraint:** Must match the `name` field on `LogicalDataAttribute` (for LOGICAL
   * view mode) or `PhysicalDataAttribute` (for PHYSICAL view mode) from `model.ts` exactly.
   * No abbreviations, truncations, or transformations are permitted.
   */
  ref_name: string;

  /**
   * The human-readable display label for this item.
   * May differ from `ref_name` for presentation purposes (e.g., formatted with spaces).
   */
  display_name: string;

  /**
   * The semantic type of this compartment item, indicating which architecture domain
   * concept it represents.
   *
   * **ER constraints:**
   * - When the parent diagram's `view_mode` is `'LOGICAL'`, this must be `"LOGICAL_DATA_ATTRIBUTE"`.
   * - When the parent diagram's `view_mode` is `'PHYSICAL'`, this must be `"PHYSICAL_DATA_ATTRIBUTE"`.
   */
  semantic_type: string;

  /**
   * Optional metadata providing additional attribute-level information.
   * All fields are optional to support varying levels of detail from LLM generation.
   */
  metadata?: {
    /**
     * Whether this attribute is a primary key in the entity.
     */
    is_primary_key?: boolean;

    /**
     * Whether this attribute is a foreign key referencing another entity.
     */
    is_foreign_key?: boolean;

    /**
     * The data type of this attribute (e.g., `"VARCHAR(255)"`, `"BIGINT"`, `"String"`).
     * For LOGICAL mode, this may be an abstract/domain type.
     * For PHYSICAL mode, this should be a concrete storage type.
     */
    data_type?: string;

    /**
     * Whether this attribute allows null values.
     */
    is_nullable?: boolean;
  };
}

// ============================================================================
// Compartment
// ============================================================================

/**
 * A compartment within a temporary architecture diagram node.
 *
 * Compartments replace the native `DiagramNode` approach of using
 * `embedded_attribute_ids` / `selected_attribute_ids` (arrays of internal architecture
 * entity IDs) with a name-based, self-contained representation that an LLM can generate
 * without access to internal IDs. Each compartment contains structured items with
 * `ref_name` fields for future name-based resolution.
 */
export interface TemporaryArchitectureDiagramCompartment {
  /**
   * Local identifier for this compartment within the temporary diagram payload.
   * This ID has no meaning outside of the temporary diagram.
   */
  id: string;

  /**
   * The kind of compartment. Typed as an extensible string literal to allow
   * future compartment kinds beyond attributes.
   *
   * Currently supported values:
   * - `'ATTRIBUTES'`: Contains data attribute items for an entity node.
   */
  compartment_kind: 'ATTRIBUTES' | (string & {});

  /**
   * The ordered list of items within this compartment.
   * For `'ATTRIBUTES'` compartments, each item represents a data attribute.
   */
  items: TemporaryArchitectureDiagramCompartmentItem[];
}

// ============================================================================
// Node
// ============================================================================

/**
 * A node in a temporary architecture diagram.
 *
 * Represents a visual element on the diagram canvas with explicit position and
 * dimensions. For ER diagrams, nodes represent data entities (logical or physical).
 *
 * Layout is explicit and complete: every node must have `pos_x`, `pos_y`, `width`,
 * and `height` values representing a plausible layout on the diagram canvas.
 */
export interface TemporaryArchitectureDiagramNode {
  /**
   * Local identifier for this node within the temporary diagram payload.
   * Used for internal cross-referencing (e.g., by edge `source_node_id`/`target_node_id`
   * and group `child_node_ids`). This ID has no meaning outside of the temporary diagram
   * and is NOT an internal architecture entity ID.
   */
  id: string;

  /**
   * The kind of node. Typed as an extensible string literal to allow future
   * node kinds beyond entities.
   *
   * Currently supported values:
   * - `'ENTITY'`: Represents a data entity in an ER diagram.
   */
  node_kind: 'ENTITY' | (string & {});

  /**
   * The semantic type of this node, indicating which architecture domain concept
   * it represents.
   *
   * **ER constraints:**
   * - When the diagram's `view_mode` is `'LOGICAL'`, this must be `"LOGICAL_DATA_ENTITY"`.
   * - When the diagram's `view_mode` is `'PHYSICAL'`, this must be `"PHYSICAL_DATA_ENTITY"`.
   *
   * Corresponds to `entity_type` on native `DiagramNode` from `model.ts`.
   */
  semantic_type: string;

  /**
   * The exact name of the architecture entity this node represents, used for future
   * name-based resolution to native entity IDs.
   *
   * **ER constraint:** Must match the `name` field on `LogicalDataEntity` (for LOGICAL
   * view mode) or `PhysicalDataEntity` (for PHYSICAL view mode) from `model.ts` exactly.
   * No abbreviations, truncations, or transformations are permitted.
   */
  ref_name: string;

  /**
   * The human-readable display label for this node.
   * May differ from `ref_name` for presentation purposes.
   */
  display_name: string;

  /**
   * The X coordinate of the top-left corner of this node on the diagram canvas.
   * Mirrors the `pos_x` field on native `DiagramNode`.
   */
  pos_x: number;

  /**
   * The Y coordinate of the top-left corner of this node on the diagram canvas.
   * Mirrors the `pos_y` field on native `DiagramNode`.
   */
  pos_y: number;

  /**
   * The width of this node on the diagram canvas in pixels.
   * Mirrors the `width` field on native `DiagramNode`.
   */
  width: number;

  /**
   * The height of this node on the diagram canvas in pixels.
   * Mirrors the `height` field on native `DiagramNode`.
   */
  height: number;

  /**
   * Optional Z-index controlling the draw order of this node relative to other
   * diagram elements. Higher values are drawn on top.
   * Mirrors the `z_index` field on native `DiagramNode`.
   */
  z_index?: number;

  /**
   * Optional list of compartments within this node.
   * For ER entity nodes, compartments contain attribute items that are rendered
   * inside the entity box (replacing the native `embedded_attribute_ids` approach).
   */
  compartments?: TemporaryArchitectureDiagramCompartment[];

  /**
   * Optional visual style overrides for this node.
   * All color values should be hex strings (e.g., `"#FFFFFF"`).
   */
  style?: {
    /**
     * Background fill color for the node (hex string).
     */
    background_color?: string;

    /**
     * Border/stroke color for the node (hex string).
     */
    line_color?: string;

    /**
     * Text color for the node label (hex string).
     */
    text_color?: string;
  };

  /**
   * Optional metadata providing additional node-level information.
   */
  metadata?: {
    /**
     * Whether this entity is the primary/central entity in the diagram.
     */
    is_primary?: boolean;

    /**
     * Whether this entity is a reference/lookup entity.
     */
    is_reference?: boolean;

    /**
     * Freeform tags for categorization or filtering.
     */
    tags?: string[];
  };
}

// ============================================================================
// Edge
// ============================================================================

/**
 * An edge (relationship) in a temporary architecture diagram.
 *
 * Represents a visual connection between two nodes on the diagram canvas.
 * For ER diagrams, edges represent data entity relationships with optional
 * cardinality and UML relationship type information.
 *
 * Layout is explicit and complete: every edge must have `edge_points` defining
 * its path on the canvas.
 */
export interface TemporaryArchitectureDiagramEdge {
  /**
   * Local identifier for this edge within the temporary diagram payload.
   * This ID has no meaning outside of the temporary diagram and is NOT an
   * internal architecture relationship ID.
   */
  id: string;

  /**
   * The kind of edge. Typed as an extensible string literal to allow future
   * edge kinds beyond relationships.
   *
   * Currently supported values:
   * - `'RELATIONSHIP'`: Represents a data entity relationship in an ER diagram.
   */
  edge_kind: 'RELATIONSHIP' | (string & {});

  /**
   * The semantic type of this edge, indicating which architecture domain concept
   * it represents.
   *
   * For ER diagrams, this is typically `"DATA_ENTITY_RELATIONSHIP"` but may vary
   * for future diagram kinds.
   */
  semantic_type: string;

  /**
   * Local ID of the source node within this temporary diagram.
   * Must reference an existing `TemporaryArchitectureDiagramNode.id` in the same diagram.
   */
  source_node_id: string;

  /**
   * Local ID of the target node within this temporary diagram.
   * Must reference an existing `TemporaryArchitectureDiagramNode.id` in the same diagram.
   */
  target_node_id: string;

  /**
   * The exact name of the source entity, used for future name-based matching to
   * resolve native entity IDs. Must match a node's `ref_name` in this diagram.
   *
   * Future mapping code will use this field (along with `source_item_ref_name` when
   * present) to resolve the native entity/attribute IDs needed for `DiagramEdge`
   * and `LogicalDataEntityRelationship` in `model.ts`.
   */
  source_ref_name: string;

  /**
   * The exact name of the target entity, used for future name-based matching to
   * resolve native entity IDs. Must match a node's `ref_name` in this diagram.
   *
   * Future mapping code will use this field (along with `target_item_ref_name` when
   * present) to resolve the native entity/attribute IDs needed for `DiagramEdge`
   * and `LogicalDataEntityRelationship` in `model.ts`.
   */
  target_ref_name: string;

  /**
   * The ordered list of points defining the visual path of this edge on the canvas.
   * Points are rendered in ascending `sequence_order` to form the edge polyline.
   */
  edge_points: TemporaryArchitectureDiagramPoint[];

  /**
   * Optional exact name of the source attribute for attribute-level relationship endpoints.
   * When present, the relationship connects at the attribute level rather than the entity level.
   * Must match a compartment item's `ref_name` on the source node.
   */
  source_item_ref_name?: string;

  /**
   * Optional exact name of the target attribute for attribute-level relationship endpoints.
   * When present, the relationship connects at the attribute level rather than the entity level.
   * Must match a compartment item's `ref_name` on the target node.
   */
  target_item_ref_name?: string;

  /**
   * Optional UML relationship type for ER edges.
   *
   * Uses the same string literal values as `LogicalERRelationship` from `model.ts`:
   * - `'GENERALIZATION'`: "is-a" relationship (inheritance)
   * - `'REALIZATION'`: Implementation of an interface
   * - `'COMPOSITION'`: Strong "has-a" relationship (lifecycle-dependent)
   * - `'AGGREGATION'`: Weak "has-a" relationship (independent lifecycle)
   * - `'ASSOCIATION'`: General relationship between entities
   * - `'DEPENDENCY'`: One entity depends on another
   *
   * @see LogicalERRelationship in `model.ts`
   */
  relationship_type?: 'GENERALIZATION' | 'REALIZATION' | 'COMPOSITION' | 'AGGREGATION' | 'ASSOCIATION' | 'DEPENDENCY';

  /**
   * Optional cardinality of the relationship for ER edges.
   *
   * Uses the same string literal values as `LogicalERCardinality` from `model.ts`:
   * - `'ONE_TO_ONE'`: One instance of source maps to one instance of target
   * - `'ONE_TO_MANY'`: One instance of source maps to many instances of target
   * - `'MANY_TO_ONE'`: Many instances of source map to one instance of target
   * - `'MANY_TO_MANY'`: Many instances of source map to many instances of target
   *
   * @see LogicalERCardinality in `model.ts`
   */
  cardinality?: 'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_ONE' | 'MANY_TO_MANY';

  /**
   * Optional freeform hint string for LLM context about the relationship.
   * May contain natural-language descriptions of the relationship semantics
   * that do not fit neatly into `relationship_type` or `cardinality`.
   */
  relationship_hint?: string;

  /**
   * Optional label rendered near the source endpoint of the edge.
   * Uses a nested object structure (NOT the native flat field pattern from `DiagramEdge`)
   * for coherence and LLM-friendliness.
   */
  source_label?: {
    /** The text content of the source label (e.g., "1", "0..*"). */
    text: string;
    /** The X coordinate of the label on the diagram canvas. */
    pos_x: number;
    /** The Y coordinate of the label on the diagram canvas. */
    pos_y: number;
  };

  /**
   * Optional label rendered near the target endpoint of the edge.
   * Uses a nested object structure (NOT the native flat field pattern from `DiagramEdge`)
   * for coherence and LLM-friendliness.
   */
  target_label?: {
    /** The text content of the target label (e.g., "*", "1..1"). */
    text: string;
    /** The X coordinate of the label on the diagram canvas. */
    pos_x: number;
    /** The Y coordinate of the label on the diagram canvas. */
    pos_y: number;
  };

  /**
   * Optional visual style overrides for this edge.
   */
  style?: {
    /**
     * Line color for the edge stroke (hex string).
     */
    line_color?: string;

    /**
     * Line type for the edge rendering.
     * - `'SOLID'`: Continuous line
     * - `'DASHED'`: Dashed/dotted line
     */
    line_type?: 'SOLID' | 'DASHED';

    /**
     * Line weight/thickness for the edge stroke in pixels.
     */
    line_weight?: number;
  };

  /**
   * Optional metadata providing additional edge-level information.
   */
  metadata?: {
    /**
     * Whether the relationship is optional, required, or unknown.
     * - `'OPTIONAL'`: The relationship is not mandatory
     * - `'REQUIRED'`: The relationship is mandatory
     * - `'UNKNOWN'`: Optionality has not been determined
     */
    optionality?: 'OPTIONAL' | 'REQUIRED' | 'UNKNOWN';

    /**
     * Freeform notes about this edge/relationship.
     */
    notes?: string[];
  };
}

// ============================================================================
// Group
// ============================================================================

/**
 * A visual group in a temporary architecture diagram.
 *
 * Groups enable future schema-grouping, swimlane, or container concepts.
 * They visually contain a set of child nodes and can carry optional display
 * metadata. For ER diagrams, groups can represent database schemas or
 * logical groupings of related entities.
 */
export interface TemporaryArchitectureDiagramGroup {
  /**
   * Local identifier for this group within the temporary diagram payload.
   * This ID has no meaning outside of the temporary diagram.
   */
  id: string;

  /**
   * The kind of group. Typed as an extensible string to allow future group
   * kinds such as schemas, swimlanes, packages, or containers.
   */
  group_kind: string;

  /**
   * The X coordinate of the top-left corner of this group on the diagram canvas.
   */
  pos_x: number;

  /**
   * The Y coordinate of the top-left corner of this group on the diagram canvas.
   */
  pos_y: number;

  /**
   * The width of this group on the diagram canvas in pixels.
   */
  width: number;

  /**
   * The height of this group on the diagram canvas in pixels.
   */
  height: number;

  /**
   * Array of node IDs that are visually contained within this group.
   * All IDs must reference existing `TemporaryArchitectureDiagramNode.id` values
   * in the same diagram.
   */
  child_node_ids: string[];

  /**
   * Optional exact name of the group for future name-based resolution.
   * For ER diagrams, this could be a schema name (e.g., `"public"`, `"inventory"`).
   */
  ref_name?: string;

  /**
   * Optional human-readable display label for the group.
   */
  display_name?: string;

  /**
   * Optional visual style overrides for this group.
   * All color values should be hex strings (e.g., `"#F0F0F0"`).
   */
  style?: {
    /**
     * Background fill color for the group region (hex string).
     */
    background_color?: string;

    /**
     * Border/stroke color for the group boundary (hex string).
     */
    line_color?: string;

    /**
     * Text color for the group label (hex string).
     */
    text_color?: string;
  };
}

// ============================================================================
// Top-Level Diagram
// ============================================================================

/**
 * The top-level temporary architecture diagram contract.
 *
 * This is the root structure that an LLM agent generates and that future mapping
 * code consumes. It contains all nodes, edges, and optional groups needed to
 * fully represent a diagram layout with explicit positions and dimensions.
 *
 * The contract is generic: `diagram_kind`, `source_architecture_domain`, and `view_mode`
 * are typed as string literal unions to allow future extension to non-ER diagram kinds
 * (e.g., Sequence, Activity, State) without breaking the generic structure.
 */
export interface TemporaryArchitectureDiagram {
  /**
   * Local identifier for this temporary diagram.
   * This ID has no meaning outside of the temporary diagram payload.
   */
  id: string;

  /**
   * The display name of this diagram.
   */
  name: string;

  /**
   * The kind of diagram represented by this payload.
   * Typed as a string literal union to allow future extension.
   *
   * Currently supported values:
   * - `'ER'`: Entity-Relationship diagram.
   *
   * Future values may include `'SEQUENCE'`, `'ACTIVITY'`, `'STATE'`, etc.
   */
  diagram_kind: 'ER' | (string & {});

  /**
   * The source architecture domain that this diagram draws from.
   * Typed as a string literal union to allow future extension.
   *
   * Currently supported values:
   * - `'DATA'`: The Data architecture domain (logical and physical data entities).
   *
   * Future values may include `'BUSINESS'`, `'APPLICATION'`, `'TECHNOLOGY'`, etc.
   */
  source_architecture_domain: 'DATA' | (string & {});

  /**
   * The view mode determining which architecture layer is represented.
   * Typed as a string literal union to allow future extension.
   *
   * Currently supported values:
   * - `'LOGICAL'`: Logical-level view (e.g., `LogicalDataEntity` / `LogicalDataAttribute`).
   * - `'PHYSICAL'`: Physical-level view (e.g., `PhysicalDataEntity` / `PhysicalDataAttribute`).
   */
  view_mode: 'LOGICAL' | 'PHYSICAL' | (string & {});

  /**
   * The contract version number.
   * Starts at 1 and increments only for breaking contract changes.
   * Additive optional fields do not require a version bump.
   *
   * Current version: 1
   */
  version: number;

  /**
   * The list of nodes in this diagram.
   * Every node must have explicit position (`pos_x`, `pos_y`) and dimensions
   * (`width`, `height`) for a complete layout.
   */
  nodes: TemporaryArchitectureDiagramNode[];

  /**
   * The list of edges (relationships) in this diagram.
   * Every edge must have `edge_points` defining its visual path on the canvas.
   */
  edges: TemporaryArchitectureDiagramEdge[];

  /**
   * Optional description of the diagram's purpose or content.
   */
  description?: string;

  /**
   * Optional list of visual groups containing child nodes.
   * Groups enable schema-grouping, swimlane, or container concepts.
   */
  groups?: TemporaryArchitectureDiagramGroup[];

  /**
   * Optional metadata providing additional diagram-level information.
   */
  metadata?: {
    /**
     * The name or identifier of the task that created this temporary diagram.
     * Useful for traceability and debugging.
     */
    created_by_task?: string;

    /**
     * Freeform notes about this diagram.
     */
    notes?: string[];
  };
}

// ============================================================================
// Default Version Constant
// ============================================================================

/**
 * The current contract version for `TemporaryArchitectureDiagram`.
 * Starts at 1 and increments only for breaking contract changes.
 */
export const TEMPORARY_ARCHITECTURE_DIAGRAM_VERSION = 1;
