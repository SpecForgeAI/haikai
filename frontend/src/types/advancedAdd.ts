/**
 * TypeScript interfaces for Advanced Add feature
 *
 * These types support the Advanced Add dialog and API integration
 * for flexible graph expansion.
 */

import { RelationshipDirection } from '../utils/advancedAddRelationships';

// ============================================================================
// Selection Types (Frontend to Backend)
// ============================================================================

/**
 * Describes a selection in the Advanced Add tree.
 * Sent to the backend to specify what should be expanded.
 */
export interface SelectionDescriptor {
  /** The type of relationship to traverse */
  relationshipType: string;
  /** Direction of traversal */
  direction: RelationshipDirection;
  /** Depth of traversal (1 = immediate children only) */
  depth: number;
  /** Target entity IDs that were selected (if specific entities chosen) */
  selectedEntityIds?: string[];
}

/**
 * Request body for the advanced-add-expansion API endpoint.
 */
export interface AdvancedAddRequest {
  /** Type of the root entity (e.g., 'APPLICATION') */
  rootEntityType: string;
  /** ID of the root entity */
  rootEntityId: string;
  /** ID of the target diagram */
  diagramId: string;
  /** List of selected relationship paths to expand */
  selections: SelectionDescriptor[];
}

// ============================================================================
// Response Types (Backend to Frontend)
// ============================================================================

/**
 * Describes a node to be added to the diagram.
 */
export interface NodeDescriptor {
  /** Entity type (e.g., 'APPLICATION', 'APP_COMPONENT') */
  entityType: string;
  /** Entity ID in the meta-model */
  entityId: string;
  /** Entity name for display */
  entityName: string;
  /** Whether this entity already has a node on the diagram */
  alreadyOnDiagram: boolean;
  /** Parent entity ID for containment relationships (optional) */
  parentEntityId?: string;
}

/**
 * Describes an edge to be added to the diagram.
 */
export interface EdgeDescriptor {
  /** Relationship type (e.g., 'APPLICATION_POINT_BUSINESS_PROCESS') */
  relationshipType: string;
  /** Relationship ID in the meta-model */
  relationshipId: string;
  /** Source entity ID */
  sourceEntityId: string;
  /** Target entity ID */
  targetEntityId: string;
  /** Whether this relationship already has an edge on the diagram */
  alreadyOnDiagram: boolean;
}

/**
 * Response from the advanced-add-expansion API endpoint.
 */
export interface AdvancedAddResponse {
  /** Nodes to be added to the diagram */
  nodes: NodeDescriptor[];
  /** Edges to be added to the diagram */
  edges: EdgeDescriptor[];
}

// ============================================================================
// Tree View Types (Frontend UI)
// ============================================================================

/**
 * Represents a node in the Advanced Add tree view.
 */
export interface TreeNodeData {
  /** Unique key for the tree node */
  key: string;
  /** Display label */
  label: string;
  /** Entity type */
  entityType: string;
  /** Entity ID */
  entityId: string;
  /** Entity name */
  entityName: string;
  /** Whether this is the root node */
  isRoot: boolean;
  /** Relationship kind (for display) */
  relationshipKind?: 'PARENT_CHILD' | 'ASSOCIATION';
  /** Parent node key (for tree structure) */
  parentKey?: string;
  /** Child nodes */
  children: TreeNodeData[];
  /** Whether this node is expanded in the UI */
  isExpanded?: boolean;
}

/**
 * Selection state for tree nodes.
 * Maps node keys to their selection state.
 */
export interface TreeSelectionState {
  /** Map of node key to selection state */
  [key: string]: 'selected' | 'unselected' | 'indeterminate';
}

// ============================================================================
// Spacing Presets Types (Spacing Presets Feature)
// ============================================================================

/**
 * Spacing preset identifier.
 * Controls the layout density of nodes in the Advanced Add dialog.
 */
export type SpacingPreset = 'spacious' | 'normal' | 'tight';

/**
 * Configuration values for a spacing preset.
 * These values control padding and gaps in the layout algorithm.
 */
export interface SpacingConfig {
  /** Horizontal padding inside containers */
  paddingX: number;
  /** Vertical padding inside containers */
  paddingY: number;
  /** Vertical gap between sibling nodes */
  childVerticalGap: number;
}

/**
 * Predefined spacing presets with their configuration values.
 *
 * - spacious: Large padding and gaps for maximum readability
 * - normal: Default balanced spacing (matches current behavior)
 * - tight: Minimal padding and gaps for compact layouts
 */
export const SPACING_PRESETS: Record<SpacingPreset, SpacingConfig> = {
  spacious: {
    paddingX: 20,
    paddingY: 20,
    childVerticalGap: 10,
  },
  normal: {
    paddingX: 10,
    paddingY: 10,
    childVerticalGap: 7,
  },
  tight: {
    paddingX: 5,
    paddingY: 5,
    childVerticalGap: 4,
  },
};

/**
 * Default spacing preset.
 * Used when no preset is explicitly specified.
 */
export const DEFAULT_SPACING_PRESET: SpacingPreset = 'normal';

// ============================================================================
// Layout Configuration Types (Child Layout Controls Feature)
// ============================================================================

/**
 * Extended layout configuration for Advanced Add.
 * Extends SpacingConfig with grid layout controls.
 */
export interface LayoutConfig extends SpacingConfig {
  /** Number of columns for child node grid (1-10) */
  childColumns: number;
  /** Target width for child nodes in pixels (10-1000) */
  childNodeWidth: number;
}

/**
 * Default layout configuration values.
 * Used when layout config is not explicitly specified.
 */
export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  paddingX: 10,
  paddingY: 10,
  childVerticalGap: 7,
  childColumns: 1,
  childNodeWidth: 160,
};

/**
 * Layout control constraints.
 * Defines min/max bounds for layout configuration values.
 */
export const LAYOUT_CONSTRAINTS = {
  childColumns: { min: 1, max: 10 },
  childNodeWidth: { min: 10, max: 1000 },
};

// ============================================================================
// Advanced Add Result Types
// ============================================================================

/**
 * Task Group 5: Result from the Advanced Add dialog containing
 * tree structure and selected keys for recursive wrapping.
 */
export interface AdvancedAddResult {
  /** The tree data structure built from the root entity */
  treeData: TreeNodeData;
  /** Set of keys for selected nodes (including root) */
  selectedKeys: Set<string>;
  /** Selection descriptors for API/backend use */
  selections: SelectionDescriptor[];
  /** Spacing preset for layout (defaults to 'normal' if not specified) */
  spacingPreset?: SpacingPreset;
  /** Number of columns for child layout (1-10) */
  childColumns?: number;
  /** Target width for child nodes (10-1000 px) */
  childNodeWidth?: number;
}

/**
 * Props for the AdvancedAddDialog component.
 */
export interface AdvancedAddDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Callback when user confirms the add operation - receives full result for recursive wrapping */
  onAdd: (result: AdvancedAddResult) => void;
  /** Root entity information */
  rootEntity: {
    id: string;
    name: string;
    type: string;
  };
  /** Meta-model for looking up related entities */
  metaModel: import('../types/model').MetaModel;
}

/**
 * Props for the TreeNode sub-component.
 */
export interface TreeNodeProps {
  /** Node data */
  node: TreeNodeData;
  /** Current selection state for all nodes */
  selectionState: TreeSelectionState;
  /** Callback when a node's selection is toggled */
  onToggle: (nodeKey: string) => void;
  /** Callback when a node is expanded/collapsed */
  onExpandToggle: (nodeKey: string) => void;
  /** Current depth level (for indentation) */
  depth: number;
}

// ============================================================================
// Hierarchical Layout Types (Task Group 1)
// ============================================================================

/**
 * Input structure for the layout algorithm.
 * Represents a node in the hierarchy to be laid out.
 *
 * Interface Parent Wrapping Fix: Added optional precomputedWidth and precomputedHeight
 * fields to allow Interface composite dimensions to be passed through the layout tree
 * before the measure phase. This ensures parent nodes (Service, Component, Application)
 * correctly size themselves to wrap Interface composites with embedded endpoints and entities.
 */
export interface LayoutTreeNode {
  /** Unique entity ID (e.g., "app-123") */
  id: string;
  /** Entity type (APPLICATION, SERVICE, etc.) */
  type: string;
  /** Display text for the box */
  label: string;
  /** Child nodes in the hierarchy */
  children: LayoutTreeNode[];
  /**
   * Optional pre-computed width in pixels.
   * Used for Interface composites where dimensions are calculated from
   * embedded endpoints and entity boxes before the measure phase.
   * When present, measure() will use this instead of calculating from label.
   */
  precomputedWidth?: number;
  /**
   * Optional pre-computed height in pixels.
   * Used for Interface composites where dimensions are calculated from
   * embedded endpoints and entity boxes before the measure phase.
   * When present, measure() will use this instead of calculating from label.
   */
  precomputedHeight?: number;
}

/**
 * Node with computed dimensions from the measure pass.
 * Result of bottom-up dimension calculation.
 */
export interface MeasuredNode {
  /** Unique entity ID */
  id: string;
  /** Entity type */
  type: string;
  /** Display text for the box */
  label: string;
  /** Child nodes (also measured) */
  children: MeasuredNode[];
  /** Computed width in pixels */
  measuredWidth: number;
  /** Computed height in pixels */
  measuredHeight: number;
}

/**
 * Node with final position and size from the layout pass.
 * Result of top-down position assignment.
 */
export interface LayoutNode {
  /** Unique entity ID */
  id: string;
  /** Entity type */
  type: string;
  /** Display text for the box */
  label: string;
  /** X coordinate (top-left corner) */
  x: number;
  /** Y coordinate (top-left corner) */
  y: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Child nodes (also positioned) */
  children: LayoutNode[];
}
