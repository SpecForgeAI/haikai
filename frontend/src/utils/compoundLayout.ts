/**
 * Compound Layout Utilities
 * Functions for calculating parent-child node layouts for compound add operations
 *
 * Spec: Fix Interface Composite Rendering (Task Group 2)
 * - Fixed buildInterfaceCompositeNodes call to pass DataEntityIdsForInterface object
 * - Import DataEntityIdsForInterface type from interfaceCompositeBuilder.ts
 */

import { DiagramNode, MetaModel, ApplicationComponent, ApplicationPointBusinessPoint, ProcessActivity, ENTITY_TYPES } from '../types/model';
import { LayoutTreeNode, MeasuredNode, LayoutNode, SpacingPreset, SpacingConfig, SPACING_PRESETS, LayoutConfig } from '../types/advancedAdd';
import { wrapText, calculateTextBlockHeight, measureTextWidth } from './rendering';
import { generatePrefixedId } from './idGenerator';
import { isAttributeEntityType, InterfaceCustomCandidate } from './erdAdvancedAddUtils';
import { buildInterfaceCompositeNodes, DataEntityIdsForInterface } from './interfaceCompositeBuilder';

// =============================================================================
// Legacy Layout Constants (for backward compatibility)
// =============================================================================
const PADDING = 5;
const LABEL_HEIGHT = 20;
const DEFAULT_CHILD_HEIGHT = 60;
const DEFAULT_CHILD_WIDTH = 120;

// =============================================================================
// Fixed Spawn Position Constants
// =============================================================================

/**
 * Fixed spawn position for root nodes in layoutAdvancedAddSelection.
 * All root nodes spawn at this position (100,100) regardless of viewport.
 */
const FIXED_ROOT_ORIGIN_X = 100;
const FIXED_ROOT_ORIGIN_Y = 100;

// =============================================================================
// Hierarchical Layout Constants (Task Group 1)
// =============================================================================

/** Horizontal padding inside containers */
export const LAYOUT_PADDING_X = 20;

/** Vertical padding inside containers */
export const LAYOUT_PADDING_Y = 20;

/** Vertical gap between siblings */
export const LAYOUT_CHILD_VERTICAL_GAP = 10;

/** Space below parent label before children start */
export const LAYOUT_LABEL_PADDING = 10;

/** Minimum width for any node */
export const LAYOUT_MIN_NODE_WIDTH = 120;

/** Minimum height for leaf nodes */
export const LAYOUT_MIN_NODE_HEIGHT = 40;

/** Default font size for text measurement */
export const LAYOUT_DEFAULT_FONT_SIZE = 12;

/** Font weight for container labels */
export const LAYOUT_CONTAINER_FONT_WEIGHT = 'bold';

/** Horizontal gap between columns in grid layout */
export const LAYOUT_COLUMN_GAP = 10;

// =============================================================================
// Task Group 1: Text Measurement Helper Functions
// =============================================================================

/**
 * Calculate the height for a Business Process node based on its text content
 *
 * @param processName - The name of the business process
 * @param nodeWidth - Width of the node (default 120)
 * @param fontSize - Font size in pixels (default 12)
 * @returns Height in pixels: 5 (top padding) + text_height + 5 (bottom padding)
 */
export function calculateProcessNodeHeight(
  processName: string,
  nodeWidth: number = DEFAULT_CHILD_WIDTH,
  fontSize: number = 12
): number {
  if (!processName) {
    // Empty string: return minimum height (padding only)
    return PADDING + 0 + PADDING;
  }

  // Calculate available text width (nodeWidth - 2 * 5px padding)
  const textWidth = nodeWidth - (PADDING * 2);

  // Wrap text into lines
  const lines = wrapText(processName, textWidth, fontSize, 'normal', 'normal');

  // Calculate text block height
  const textHeight = calculateTextBlockHeight(lines.length, fontSize);

  // Return: 5px top padding + text height + 5px bottom padding
  return PADDING + textHeight + PADDING;
}

/**
 * Calculate the height for an Application label (header area)
 *
 * @param appName - The name of the application
 * @param nodeWidth - Width of the parent node
 * @param fontSize - Font size in pixels (default 12)
 * @param fontWeight - Font weight (default 'bold')
 * @returns Height of the label text block (without padding)
 */
export function calculateApplicationLabelHeight(
  appName: string,
  nodeWidth: number,
  fontSize: number = 12,
  fontWeight: string = 'bold'
): number {
  if (!appName) {
    return 0;
  }

  // Calculate available text width (nodeWidth - 2 * 5px padding)
  const textWidth = nodeWidth - (PADDING * 2);

  // Wrap text into lines using bold font weight
  const lines = wrapText(appName, textWidth, fontSize, fontWeight, 'normal');

  // Return text block height
  return calculateTextBlockHeight(lines.length, fontSize);
}

// =============================================================================
// Hierarchical Layout: Text Measurement Helpers
// =============================================================================

/**
 * Estimate the width of text when rendered
 * @param text - The text to measure
 * @param fontSize - Font size in pixels
 * @param fontWeight - Font weight (normal or bold)
 * @returns Width in pixels
 */
export function estimateLabelWidth(
  text: string,
  fontSize: number = LAYOUT_DEFAULT_FONT_SIZE,
  fontWeight: string = 'normal'
): number {
  return measureTextWidth(text, fontSize, fontWeight);
}

/**
 * Estimate the height of text when wrapped to fit a given width
 * @param text - The text to measure
 * @param maxWidth - Maximum width before wrapping
 * @param fontSize - Font size in pixels
 * @param fontWeight - Font weight (normal or bold)
 * @returns Height in pixels
 */
export function estimateLabelHeight(
  text: string,
  maxWidth: number,
  fontSize: number = LAYOUT_DEFAULT_FONT_SIZE,
  fontWeight: string = 'normal'
): number {
  if (!text) return 0;
  const lines = wrapText(text, maxWidth, fontSize, fontWeight, 'normal');
  return calculateTextBlockHeight(lines.length, fontSize);
}

// =============================================================================
// Hierarchical Layout: Core Algorithm (Task Group 1 + Spacing Presets)
// =============================================================================

/**
 * Pass 1: Measure - Bottom-up calculation of required dimensions
 *
 * Computes the required width and height for each node, starting from leaves
 * and working up to the root.
 *
 * For leaf nodes, height is calculated as exact value: labelHeight + 2 * paddingY
 * For container nodes, height grows to fit children.
 *
 * Interface Parent Wrapping Fix: If a node has precomputedWidth and/or precomputedHeight,
 * those values are used instead of calculating from label text. This allows Interface
 * composite dimensions (calculated from embedded endpoints and entity boxes) to flow
 * through the layout tree, ensuring parent nodes correctly size to wrap their children.
 *
 * @param node - The tree node to measure
 * @param spacingConfig - Optional spacing configuration (defaults to 'normal' preset values)
 * @returns MeasuredNode with computed dimensions
 */
export function measure(node: LayoutTreeNode, spacingConfig?: SpacingConfig): MeasuredNode {
  // Use provided config or default to 'normal' preset
  const config = spacingConfig || SPACING_PRESETS.normal;
  const { paddingX, paddingY, childVerticalGap } = config;

  // Determine font weight based on whether this is a container
  const isContainer = node.children.length > 0;
  const fontWeight = isContainer ? LAYOUT_CONTAINER_FONT_WEIGHT : 'normal';

  // Calculate label dimensions
  // For initial width estimation, use MIN_NODE_WIDTH minus padding as the wrap width
  const wrapWidth = LAYOUT_MIN_NODE_WIDTH - 2 * paddingX;
  const labelWidth = estimateLabelWidth(node.label, LAYOUT_DEFAULT_FONT_SIZE, fontWeight);
  const labelHeight = estimateLabelHeight(node.label, Math.max(wrapWidth, labelWidth), LAYOUT_DEFAULT_FONT_SIZE, fontWeight);

  // Recursively measure children first (bottom-up), passing the config
  const measuredChildren: MeasuredNode[] = node.children.map(child => measure(child, config));

  // Leaf node: size based on label only, OR precomputed dimensions if available
  // Interface Parent Wrapping Fix: Check for precomputed dimensions first
  if (measuredChildren.length === 0) {
    // If precomputed dimensions are available, use them (e.g., for Interface composites)
    if (node.precomputedWidth !== undefined && node.precomputedHeight !== undefined) {
      return {
        id: node.id,
        type: node.type,
        label: node.label,
        children: [],
        measuredWidth: node.precomputedWidth,
        measuredHeight: node.precomputedHeight,
      };
    }

    // Otherwise, calculate from label
    return {
      id: node.id,
      type: node.type,
      label: node.label,
      children: [],
      measuredWidth: Math.max(LAYOUT_MIN_NODE_WIDTH, labelWidth + 2 * paddingX),
      measuredHeight: labelHeight + 2 * paddingY,  // EXACT height, not minimum
    };
  }

  // Container node: size based on label + children
  const childWidths = measuredChildren.map(c => c.measuredWidth);
  const childHeights = measuredChildren.map(c => c.measuredHeight);

  const maxChildWidth = Math.max(...childWidths);
  const totalChildrenHeight = childHeights.reduce((sum, h) => sum + h, 0) +
    childVerticalGap * (measuredChildren.length - 1);

  // Content area is the larger of label or children
  const contentWidth = Math.max(labelWidth, maxChildWidth);
  const contentHeight = labelHeight + LAYOUT_LABEL_PADDING + totalChildrenHeight;

  return {
    id: node.id,
    type: node.type,
    label: node.label,
    children: measuredChildren,
    measuredWidth: Math.max(LAYOUT_MIN_NODE_WIDTH, contentWidth + 2 * paddingX),
    measuredHeight: contentHeight + 2 * paddingY,  // Container grows to fit content
  };
}

/**
 * Pass 2: Assign Positions - Top-down assignment of coordinates
 *
 * Assigns absolute (x, y) coordinates to each node, starting from the root
 * and working down to leaves.
 *
 * @param node - The measured node to position
 * @param originX - X coordinate for this node's top-left corner
 * @param originY - Y coordinate for this node's top-left corner
 * @param spacingConfig - Optional spacing configuration (defaults to 'normal' preset values)
 * @returns LayoutNode with absolute coordinates
 */
export function assignPositions(
  node: MeasuredNode,
  originX: number,
  originY: number,
  spacingConfig?: SpacingConfig
): LayoutNode {
  // Use provided config or default to 'normal' preset
  const config = spacingConfig || SPACING_PRESETS.normal;
  const { paddingX, paddingY, childVerticalGap } = config;

  const width = node.measuredWidth;
  const height = node.measuredHeight;

  const layoutNode: LayoutNode = {
    id: node.id,
    type: node.type,
    label: node.label,
    x: originX,
    y: originY,
    width,
    height,
    children: [],
  };

  // Leaf node: no children to position
  if (node.children.length === 0) {
    return layoutNode;
  }

  // Determine font weight for label height calculation
  const fontWeight = LAYOUT_CONTAINER_FONT_WEIGHT;

  // Calculate label height for this container
  const innerWidth = width - 2 * paddingX;
  const labelHeight = estimateLabelHeight(node.label, innerWidth, LAYOUT_DEFAULT_FONT_SIZE, fontWeight);

  // Start Y for first child: below label with padding
  let currentY = originY + paddingY + labelHeight + LAYOUT_LABEL_PADDING;

  // Position each child
  for (const child of node.children) {
    const childWidth = child.measuredWidth;
    const childHeight = child.measuredHeight;

    // Center child horizontally within inner area
    const childX = originX + paddingX + (innerWidth - childWidth) / 2;

    // Recursively position this child and its descendants, passing the config
    const childLayout = assignPositions(child, childX, currentY, config);
    layoutNode.children.push(childLayout);

    // Move Y down for next sibling
    currentY += childHeight + childVerticalGap;
  }

  return layoutNode;
}

// =============================================================================
// Task Group 2: Grid Layout Algorithm
// =============================================================================

/**
 * Pass 1: Measure with Grid - Bottom-up calculation with grid layout support
 *
 * Computes the required width and height for each node, starting from leaves
 * and working up to the root. Supports multi-column grid layouts for children.
 *
 * Interface Parent Wrapping Fix: If a node has precomputedWidth and/or precomputedHeight,
 * those values are used instead of calculating from label text.
 *
 * @param node - The tree node to measure
 * @param layoutConfig - Layout configuration including grid settings
 * @returns MeasuredNode with computed dimensions
 */
export function measureWithGrid(node: LayoutTreeNode, layoutConfig: LayoutConfig): MeasuredNode {
  const { paddingX, paddingY, childVerticalGap, childColumns, childNodeWidth } = layoutConfig;

  // Determine font weight based on whether this is a container
  const isContainer = node.children.length > 0;
  const fontWeight = isContainer ? LAYOUT_CONTAINER_FONT_WEIGHT : 'normal';

  // Calculate label dimensions
  const wrapWidth = Math.max(LAYOUT_MIN_NODE_WIDTH, childNodeWidth) - 2 * paddingX;
  const labelWidth = estimateLabelWidth(node.label, LAYOUT_DEFAULT_FONT_SIZE, fontWeight);
  const labelHeight = estimateLabelHeight(node.label, Math.max(wrapWidth, labelWidth), LAYOUT_DEFAULT_FONT_SIZE, fontWeight);

  // Recursively measure children first (bottom-up)
  const measuredChildren: MeasuredNode[] = node.children.map(child => measureWithGrid(child, layoutConfig));

  // Leaf node: size based on label and childNodeWidth, OR precomputed dimensions
  if (measuredChildren.length === 0) {
    // Interface Parent Wrapping Fix: Check for precomputed dimensions first
    if (node.precomputedWidth !== undefined && node.precomputedHeight !== undefined) {
      return {
        id: node.id,
        type: node.type,
        label: node.label,
        children: [],
        measuredWidth: node.precomputedWidth,
        measuredHeight: node.precomputedHeight,
      };
    }

    const nodeWidth = Math.max(LAYOUT_MIN_NODE_WIDTH, childNodeWidth, labelWidth + 2 * paddingX);
    return {
      id: node.id,
      type: node.type,
      label: node.label,
      children: [],
      measuredWidth: nodeWidth,
      measuredHeight: labelHeight + 2 * paddingY,
    };
  }

  // Container node: calculate grid layout dimensions
  const numChildren = measuredChildren.length;
  const numRows = Math.ceil(numChildren / childColumns);

  // Calculate row heights (max height in each row)
  const rowHeights: number[] = [];
  for (let row = 0; row < numRows; row++) {
    const startIdx = row * childColumns;
    const endIdx = Math.min(startIdx + childColumns, numChildren);
    const rowChildren = measuredChildren.slice(startIdx, endIdx);
    const maxRowHeight = Math.max(...rowChildren.map(c => c.measuredHeight));
    rowHeights.push(maxRowHeight);
  }

  // Total children height with gaps between rows
  const totalChildrenHeight = rowHeights.reduce((sum, h) => sum + h, 0) +
    childVerticalGap * (numRows - 1);

  // Calculate required width for grid
  // Width = paddingX + (childNodeWidth * columns) + (columnGap * (columns - 1)) + paddingX
  const effectiveColumns = Math.min(childColumns, numChildren);
  const gridWidth = effectiveColumns * childNodeWidth + LAYOUT_COLUMN_GAP * (effectiveColumns - 1);
  const contentWidth = Math.max(labelWidth, gridWidth);

  // Content height = label + gap + children
  const contentHeight = labelHeight + LAYOUT_LABEL_PADDING + totalChildrenHeight;

  return {
    id: node.id,
    type: node.type,
    label: node.label,
    children: measuredChildren,
    measuredWidth: Math.max(LAYOUT_MIN_NODE_WIDTH, contentWidth + 2 * paddingX),
    measuredHeight: contentHeight + 2 * paddingY,
  };
}

/**
 * Pass 2: Assign Positions with Grid - Top-down assignment with grid layout
 *
 * Assigns absolute (x, y) coordinates to each node using grid layout for children.
 *
 * @param node - The measured node to position
 * @param originX - X coordinate for this node's top-left corner
 * @param originY - Y coordinate for this node's top-left corner
 * @param layoutConfig - Layout configuration including grid settings
 * @returns LayoutNode with absolute coordinates
 */
export function assignPositionsWithGrid(
  node: MeasuredNode,
  originX: number,
  originY: number,
  layoutConfig: LayoutConfig
): LayoutNode {
  const { paddingX, paddingY, childVerticalGap, childColumns, childNodeWidth } = layoutConfig;

  const width = node.measuredWidth;
  const height = node.measuredHeight;

  const layoutNode: LayoutNode = {
    id: node.id,
    type: node.type,
    label: node.label,
    x: originX,
    y: originY,
    width,
    height,
    children: [],
  };

  // Leaf node: no children to position
  if (node.children.length === 0) {
    return layoutNode;
  }

  // Calculate label height for this container
  const fontWeight = LAYOUT_CONTAINER_FONT_WEIGHT;
  const innerWidth = width - 2 * paddingX;
  const labelHeight = estimateLabelHeight(node.label, innerWidth, LAYOUT_DEFAULT_FONT_SIZE, fontWeight);

  // Grid layout parameters
  const numChildren = node.children.length;
  const numRows = Math.ceil(numChildren / childColumns);
  const effectiveColumns = Math.min(childColumns, numChildren);

  // Calculate row heights (max height in each row)
  const rowHeights: number[] = [];
  for (let row = 0; row < numRows; row++) {
    const startIdx = row * childColumns;
    const endIdx = Math.min(startIdx + childColumns, numChildren);
    const rowChildren = node.children.slice(startIdx, endIdx);
    const maxRowHeight = Math.max(...rowChildren.map(c => c.measuredHeight));
    rowHeights.push(maxRowHeight);
  }

  // Calculate grid total width for centering
  const gridWidth = effectiveColumns * childNodeWidth + LAYOUT_COLUMN_GAP * (effectiveColumns - 1);
  const gridStartX = originX + paddingX + (innerWidth - gridWidth) / 2;

  // Start Y for first row: below label with padding
  // Start Y for first row: below label with padding

  // Position each child in grid
  for (let i = 0; i < numChildren; i++) {
    const row = Math.floor(i / childColumns);
    const col = i % childColumns;
    const child = node.children[i];

    // Calculate cell position
    const cellX = gridStartX + col * (childNodeWidth + LAYOUT_COLUMN_GAP);

    // Calculate row start Y
    let rowY = originY + paddingY + labelHeight + LAYOUT_LABEL_PADDING;
    for (let r = 0; r < row; r++) {
      rowY += rowHeights[r] + childVerticalGap;
    }

    // Center child within cell (horizontally and vertically)
    const childWidth = child.measuredWidth;
    const childHeight = child.measuredHeight;
    const rowHeight = rowHeights[row];

    const childX = cellX + (childNodeWidth - childWidth) / 2;
    const childY = rowY + (rowHeight - childHeight) / 2;

    // Recursively position this child and its descendants
    const childLayout = assignPositionsWithGrid(child, childX, childY, layoutConfig);
    layoutNode.children.push(childLayout);
  }

  return layoutNode;
}

/**
 * Complete layout process for Advanced Add selection
 *
 * Executes the two-pass layout algorithm:
 * 1. Measure all nodes bottom-up
 * 2. Assign positions top-down, with root anchored at fixed position (100,100)
 *
 * Note: The viewportCenter parameter is kept for API compatibility but is ignored.
 * All root nodes are now placed at the fixed spawn position (100,100).
 *
 * @param rootTreeNode - The root of the tree to layout
 * @param _viewportCenter - (Ignored) The center point of the viewport - kept for API compatibility
 * @param spacingPreset - Optional spacing preset (defaults to 'normal')
 * @param layoutConfig - Optional layout configuration for grid layout
 * @returns Complete LayoutNode tree with positions
 */
export function layoutAdvancedAddSelection(
  rootTreeNode: LayoutTreeNode,
  _viewportCenter: { x: number; y: number },
  spacingPreset: SpacingPreset = 'normal',
  layoutConfig?: LayoutConfig
): LayoutNode {
  // If layoutConfig is provided and has childColumns > 1, use grid layout
  if (layoutConfig && layoutConfig.childColumns > 1) {
    // Use grid layout algorithm
    const measuredRoot = measureWithGrid(rootTreeNode, layoutConfig);

    // Fixed root origin at (100, 100)
    const rootX = FIXED_ROOT_ORIGIN_X;
    const rootY = FIXED_ROOT_ORIGIN_Y;

    // Assign positions with grid
    return assignPositionsWithGrid(measuredRoot, rootX, rootY, layoutConfig);
  }

  // Use standard single-column layout
  // Look up the spacing configuration for the preset
  const spacingConfig = SPACING_PRESETS[spacingPreset];

  // If layoutConfig provided with childColumns=1, merge with spacing config
  const effectiveConfig: SpacingConfig = layoutConfig
    ? { paddingX: layoutConfig.paddingX, paddingY: layoutConfig.paddingY, childVerticalGap: layoutConfig.childVerticalGap }
    : spacingConfig;

  // Pass 1: Measure all nodes bottom-up with spacing config
  const measuredRoot = measure(rootTreeNode, effectiveConfig);

  // Fixed root origin at (100, 100)
  const rootX = FIXED_ROOT_ORIGIN_X;
  const rootY = FIXED_ROOT_ORIGIN_Y;

  // Pass 2: Assign positions top-down with spacing config
  const layoutRoot = assignPositions(measuredRoot, rootX, rootY, effectiveConfig);

  return layoutRoot;
}

// =============================================================================
// Task Group 2: Convert LayoutNode tree to DiagramNode array
// Task Group 3: Filter out attribute entity types
// Task Group 4 (Interface Parity): Handle Interface custom candidates
// Spec: Fix Interface Composite Rendering (Task Group 2) - Fixed data shape
// =============================================================================

/**
 * Convert a LayoutNode tree to a flat array of DiagramNodes.
 *
 * This function traverses the layout tree depth-first and creates DiagramNode
 * objects for each LayoutNode. It handles:
 * - Generating unique node IDs using generatePrefixedId('node')
 * - Setting parent_node_id references for containment
 * - Assigning z_index values (parents have lower z_index than children)
 * - Applying container styling (text_v_align='TOP', text_font_weight='bold') to nodes with children
 * - Skipping attribute entity types (LOGICAL_DATA_ATTRIBUTE, PHYSICAL_DATA_ATTRIBUTE)
 * - Converting Interface custom candidates to contract-style nodes with embedded endpoints/entities
 *
 * Task Group 3: Updated to skip attribute entity types. These types should never
 * be created as diagram nodes - they should only be used for ERD-style rendering
 * inside their parent entity nodes.
 *
 * Task Group 4 (Interface Parity): Updated to handle Interface custom candidates.
 * When an Interface is a custom candidate, it uses buildInterfaceCompositeNodes to
 * create the Interface with render_style: 'contract', embedded_endpoint_ids,
 * embedded_entity_ids, and child entity nodes positioned inside.
 *
 * Spec: Fix Interface Composite Rendering (Task Group 2.2)
 * - Fixed to pass DataEntityIdsForInterface object instead of string[] to buildInterfaceCompositeNodes
 * - Includes both logical and physical entity IDs from the candidate
 *
 * @param layoutNode - The root of the LayoutNode tree to convert
 * @param zIndexBase - The starting z_index value (first node will get zIndexBase + 1)
 * @param erdCandidateMap - Optional map of entityId -> selectedAttributeIds for ERD rendering
 * @param metaModel - Optional MetaModel for Interface custom candidate processing
 * @param interfaceCandidateMap - Optional map of entityId -> InterfaceCustomCandidate
 * @returns Flat array of DiagramNodes ready to add to the diagram
 */
export function convertTodiagramNodes(
  layoutNode: LayoutNode,
  zIndexBase: number,
  erdCandidateMap?: Map<string, string[]>,
  metaModel?: MetaModel,
  interfaceCandidateMap?: Map<string, InterfaceCustomCandidate>
): DiagramNode[] {
  const nodes: DiagramNode[] = [];
  let currentZIndex = zIndexBase;

  /**
   * Recursive traversal function
   * @param node - Current LayoutNode to process
   * @param parentDiagramNodeId - The diagram node ID of the parent (null for root)
   */
  function traverse(node: LayoutNode, parentDiagramNodeId: string | null): void {
    // Task Group 3: Skip attribute entity types - they should not become diagram nodes
    // Attribute types are only used for ERD-style rendering inside entity boxes
    if (isAttributeEntityType(node.type)) {
      // Still process children in case of nested structure (shouldn't happen, but safe)
      for (const child of node.children) {
        traverse(child, parentDiagramNodeId);
      }
      return;
    }

    // Task Group 4 (Interface Parity): Check if this is an Interface custom candidate
    if (
      node.type === ENTITY_TYPES.INTERFACE &&
      metaModel &&
      interfaceCandidateMap &&
      interfaceCandidateMap.has(node.id)
    ) {
      const candidate = interfaceCandidateMap.get(node.id)!;

      // Get endpoint IDs from the candidate
      const selectedEndpointIds = candidate.endpoints.map(ep => ep.entityId);

      // Spec: Fix Interface Composite Rendering (Task Group 2.2)
      // Build DataEntityIdsForInterface object with both logical and physical entity IDs
      // Previously this was incorrectly passing selectedLogicalEntityIds (string[]) directly
      const selectedDataEntityIds: DataEntityIdsForInterface = {
        logicalEntityIds: candidate.logicalEntities.map(le => le.entityId),
        physicalEntityIds: candidate.physicalEntities?.map(pe => pe.entityId) || [],
      };

      // Build attribute map for the logical entities (use all attributes)
      // In Advanced Add, we include all attributes for selected logical entities
      const selectedAttributeIdsByEntity = new Map<string, string[]>();

      // Increment z-index for the Interface
      currentZIndex++;

      // Use buildInterfaceCompositeNodes to create the Interface composite
      // Interface Parent Wrapping Fix: Use the layout-computed position (top-left)
      // by passing the center of the layout bounds to buildInterfaceCompositeNodes
      const { interfaceNode, entityNodes } = buildInterfaceCompositeNodes(
        node.id,
        selectedEndpointIds,
        selectedDataEntityIds, // Now correctly passing DataEntityIdsForInterface object
        selectedAttributeIdsByEntity, // Empty map means all attributes
        metaModel,
        { x: node.x + node.width / 2, y: node.y + node.height / 2 }, // Center position
        currentZIndex,
        parentDiagramNodeId
      );

      // Add the Interface node
      nodes.push(interfaceNode);

      // Update z-index to account for entity nodes
      currentZIndex += entityNodes.length;

      // Add all entity nodes
      for (const entityNode of entityNodes) {
        nodes.push(entityNode);
      }

      // Process any remaining children that are not embedded
      // (In theory, there shouldn't be any since endpoints and entities are filtered)
      for (const child of node.children) {
        traverse(child, interfaceNode.id);
      }

      return;
    }

    currentZIndex++;

    const hasChildren = node.children.length > 0;

    // Create the DiagramNode
    const diagramNode: DiagramNode = {
      id: generatePrefixedId('node'),
      entity_type: node.type,
      entity_id: node.id,
      pos_x: node.x,
      pos_y: node.y,
      width: node.width,
      height: node.height,
      auto_size: false,
      z_index: currentZIndex,
      parent_node_id: parentDiagramNodeId,
      style_override: {},
      // Apply container styling only to nodes with children
      ...(hasChildren ? {
        text_v_align: 'TOP' as const,
        text_font_weight: 'bold' as const,
      } : {}),
    };

    // Task Group 3: If this entity has selected attributes (ERD candidate), add them
    if (erdCandidateMap) {
      const selectedAttributes = erdCandidateMap.get(node.id);
      if (selectedAttributes && selectedAttributes.length > 0) {
        diagramNode.selected_attribute_ids = selectedAttributes;
      }
    }

    nodes.push(diagramNode);

    // Recursively process children, passing this node's ID as parent
    for (const child of node.children) {
      traverse(child, diagramNode.id);
    }
  }

  // Start traversal from root with no parent
  traverse(layoutNode, null);

  return nodes;
}

// =============================================================================
// Task Group 2: Layout Algorithm Updates (Legacy)
// =============================================================================

/**
 * Calculate the position for a child node within a parent container
 * (Original version for backward compatibility)
 *
 * @param parentNode - The parent node containing the children
 * @param childIndex - Zero-based index of this child
 * @param existingChildCount - Number of children that already exist (for stacking)
 * @returns Position { pos_x, pos_y } for the child node
 */
export function calculateChildPosition(
  parentNode: DiagramNode,
  childIndex: number,
  existingChildCount: number = 0
): { pos_x: number; pos_y: number } {
  const actualIndex = existingChildCount + childIndex;

  // X position: parent.pos_x + left padding
  const pos_x = parentNode.pos_x + PADDING;

  // Y position: parent.pos_y + top padding + label height + gap + (index * (child height + gap))
  const pos_y = parentNode.pos_y + PADDING + LABEL_HEIGHT + PADDING + (actualIndex * (DEFAULT_CHILD_HEIGHT + PADDING));

  return { pos_x, pos_y };
}

/**
 * Calculate the position for a child node with variable child heights
 *
 * @param parentNode - The parent node containing the children
 * @param childIndex - Zero-based index of this child (among NEW children being added)
 * @param existingChildCount - Number of children that already exist
 * @param childHeights - Array of heights for the NEW children being added
 * @param labelHeight - Height of the parent label (dynamically calculated)
 * @returns Position { pos_x, pos_y } for the child node
 */
export function calculateChildPositionWithHeights(
  parentNode: DiagramNode,
  childIndex: number,
  existingChildCount: number,
  childHeights: number[],
  labelHeight: number
): { pos_x: number; pos_y: number } {
  // X position: parent.pos_x + left padding
  const pos_x = parentNode.pos_x + PADDING;

  // Start Y: parent.pos_y + top padding + label height + gap below label
  let pos_y = parentNode.pos_y + PADDING + labelHeight + PADDING;

  // Add space for existing children (using default height for backward compatibility)
  pos_y += existingChildCount * (DEFAULT_CHILD_HEIGHT + PADDING);

  // Add heights of preceding new children
  for (let i = 0; i < childIndex; i++) {
    pos_y += childHeights[i] + PADDING;
  }

  return { pos_x, pos_y };
}

/**
 * Calculate the required size for a parent node based on its children
 * (Original version for backward compatibility)
 *
 * @param childCount - Total number of children
 * @param maxChildWidth - Maximum width of any child (default 120)
 * @returns Size { width, height } for the parent node
 */
export function calculateParentSize(
  childCount: number,
  maxChildWidth: number = DEFAULT_CHILD_WIDTH
): { width: number; height: number } {
  if (childCount === 0) {
    // Minimum parent size with no children
    return {
      width: PADDING + maxChildWidth + PADDING,
      height: PADDING + LABEL_HEIGHT + PADDING,
    };
  }

  // Width: left padding + max child width + right padding
  const width = PADDING + Math.max(maxChildWidth, DEFAULT_CHILD_WIDTH) + PADDING;

  // Height: top padding + label + gap + (childCount * child height) + ((childCount - 1) * gaps) + bottom padding
  const height = PADDING + LABEL_HEIGHT + PADDING +
    (childCount * DEFAULT_CHILD_HEIGHT) +
    ((childCount - 1) * PADDING) +
    PADDING;

  return { width, height };
}

/**
 * Calculate the required size for a parent node with variable child heights
 *
 * Formula: PADDING + labelHeight + PADDING + sum(childHeights) + (PADDING * childCount)
 *
 * @param childHeights - Array of heights for all children
 * @param maxChildWidth - Maximum width of any child (default 120)
 * @param labelHeight - Height of the parent label (dynamically calculated)
 * @returns Size { width, height } for the parent node
 */
export function calculateParentSizeWithHeights(
  childHeights: number[],
  maxChildWidth: number = DEFAULT_CHILD_WIDTH,
  labelHeight: number = LABEL_HEIGHT
): { width: number; height: number } {
  // Width: left padding + max child width + right padding
  const width = PADDING + Math.max(maxChildWidth, DEFAULT_CHILD_WIDTH) + PADDING;

  if (childHeights.length === 0) {
    // Minimum parent size with no children
    return {
      width,
      height: PADDING + labelHeight + PADDING,
    };
  }

  // Sum of all child heights
  const totalChildHeight = childHeights.reduce((sum, h) => sum + h, 0);

  // Height: PADDING + labelHeight + PADDING + sum(childHeights) + (PADDING * childCount)
  // The last term accounts for one gap after each child
  const height = PADDING + labelHeight + PADDING + totalChildHeight + (PADDING * childHeights.length);

  return { width, height };
}

// =============================================================================
// Existing Helper Functions
// =============================================================================

/**
 * Find all application points that belong to a given application
 *
 * @param metaModel - The meta model
 * @param applicationId - The application ID
 * @returns Array of application point IDs
 */
function findApplicationPointsForApplication(
  metaModel: MetaModel,
  applicationId: string
): string[] {
  const appPoints = metaModel.entities.application_points || [];
  return appPoints
    .filter(ap => ap.application_id === applicationId)
    .map(ap => ap.id);
}

/**
 * Find all business points linked to an application via application_point_business_points
 *
 * @param metaModel - The meta model containing relationships
 * @param applicationId - The application ID to find business points for
 * @returns Array of business point IDs
 */
export function findLinkedBusinessProcesses(
  metaModel: MetaModel,
  applicationId: string
): string[] {
  // First, find all application points for this application
  const appPointIds = findApplicationPointsForApplication(metaModel, applicationId);

  if (appPointIds.length === 0) {
    return [];
  }

  // Query application_point_business_points for matching application_point_ids
  const relationships = metaModel.relationships.application_point_business_points || [];

  const businessPointIds: string[] = relationships
    .filter((rel: ApplicationPointBusinessPoint) => appPointIds.includes(rel.application_point_id))
    .map((rel: ApplicationPointBusinessPoint) => rel.business_point_id);

  // Return unique business point IDs
  return [...new Set(businessPointIds)];
}

/**
 * Find all app components that belong to an application
 *
 * @param metaModel - The meta model
 * @param applicationId - The application ID
 * @returns Array of ApplicationComponent objects
 */
export function findAppComponents(
  metaModel: MetaModel,
  applicationId: string
): ApplicationComponent[] {
  const appComponents = metaModel.entities.app_components || [];
  return appComponents.filter(ac => ac.application_id === applicationId);
}

/**
 * Find all process activities that belong to a business process
 *
 * @param metaModel - The meta model
 * @param businessProcessId - The business process ID
 * @returns Array of ProcessActivity objects
 */
export function findProcessActivities(
  metaModel: MetaModel,
  businessProcessId: string
): ProcessActivity[] {
  const processActivities = metaModel.entities.process_activities || [];
  return processActivities.filter(pa => pa.business_process_id === businessProcessId);
}

/**
 * Get the maximum width among a set of nodes
 * For now, this returns the default width since we use fixed-size nodes
 *
 * @param nodes - Array of diagram nodes
 * @returns Maximum width
 */
export function getMaxNodeWidth(nodes: DiagramNode[]): number {
  if (nodes.length === 0) {
    return DEFAULT_CHILD_WIDTH;
  }
  return Math.max(...nodes.map(n => n.width || DEFAULT_CHILD_WIDTH));
}

/**
 * Count existing children of a parent node
 *
 * @param parentNodeId - The parent node ID
 * @param allNodes - All diagram nodes
 * @returns Number of child nodes
 */
export function countExistingChildren(
  parentNodeId: string,
  allNodes: DiagramNode[]
): number {
  return allNodes.filter(n => n.parent_node_id === parentNodeId).length;
}

// Export constants for use in other modules
export { PADDING, LABEL_HEIGHT, DEFAULT_CHILD_HEIGHT, DEFAULT_CHILD_WIDTH };
