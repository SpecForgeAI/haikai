/**
 * Z-Index Utilities
 *
 * Task Group 5: Z-Index Rendering and Persistence
 * Utility functions for managing z-index values of diagram elements
 */

import {
  DiagramNode,
  DiagramEdge,
  Decoration,
  ShapeDecoration,
  LineDecoration,
} from '../types/model';

// Z-index action types
export type ZIndexAction = 'bring-forward' | 'send-backward' | 'bring-to-front' | 'send-to-back';

// Element type for z-index operations
export type ZIndexElementType = 'node' | 'edge' | 'shape-decoration' | 'line-decoration';

/**
 * Default z-index values for different element types
 * Based on spec requirements:
 * - BOX_DECORATION: 50 (background)
 * - DIAGRAM_NODE: 100 (standard)
 * - DIAGRAM_EDGE: 110 (above nodes)
 * - LINE_DECORATION: 120 (foreground)
 */
export const Z_INDEX_DEFAULTS = {
  BOX_DECORATION: 50,
  DIAGRAM_NODE: 100,
  DIAGRAM_EDGE: 110,
  LINE_DECORATION: 120,
} as const;

/**
 * Get the default z-index for a diagram element type
 */
export function getDefaultZIndex(elementType: ZIndexElementType): number {
  switch (elementType) {
    case 'node':
      return Z_INDEX_DEFAULTS.DIAGRAM_NODE;
    case 'edge':
      return Z_INDEX_DEFAULTS.DIAGRAM_EDGE;
    case 'shape-decoration':
      return Z_INDEX_DEFAULTS.BOX_DECORATION;
    case 'line-decoration':
      return Z_INDEX_DEFAULTS.LINE_DECORATION;
    default:
      return Z_INDEX_DEFAULTS.DIAGRAM_NODE;
  }
}

/**
 * Get z-index bounds (min and max) across all diagram elements
 */
export function getZIndexBounds(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  decorations: Decoration[]
): { min: number; max: number } {
  const zIndices: number[] = [];

  // Collect z-indices from nodes
  for (const node of nodes) {
    zIndices.push(node.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_NODE);
  }

  // Collect z-indices from edges
  for (const edge of edges) {
    zIndices.push(edge.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_EDGE);
  }

  // Collect z-indices from decorations
  for (const dec of decorations) {
    if ('pos_x' in dec) {
      // Shape decoration
      zIndices.push(dec.z_index ?? Z_INDEX_DEFAULTS.BOX_DECORATION);
    } else {
      // Line decoration
      zIndices.push(dec.z_index ?? Z_INDEX_DEFAULTS.LINE_DECORATION);
    }
  }

  if (zIndices.length === 0) {
    return { min: 0, max: 0 };
  }

  return {
    min: Math.min(...zIndices),
    max: Math.max(...zIndices),
  };
}

/**
 * Calculate new z-index based on action and current bounds
 */
export function calculateNewZIndex(
  currentZIndex: number,
  action: ZIndexAction,
  bounds: { min: number; max: number }
): number {
  switch (action) {
    case 'bring-forward':
      return currentZIndex + 1;
    case 'send-backward':
      return Math.max(1, currentZIndex - 1);
    case 'bring-to-front':
      return bounds.max + 1;
    case 'send-to-back':
      return Math.max(1, bounds.min - 1);
    default:
      return currentZIndex;
  }
}

/**
 * Interface for a renderable element with z-index
 */
export interface RenderableElement {
  id: string;
  type: ZIndexElementType;
  zIndex: number;
  element: DiagramNode | DiagramEdge | Decoration;
}

/**
 * Collect all elements and sort by z-index for rendering
 * Elements are sorted from lowest z-index to highest (back to front)
 */
export function getSortedRenderOrder(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  decorations: Decoration[]
): RenderableElement[] {
  const elements: RenderableElement[] = [];

  // Add nodes
  for (const node of nodes) {
    elements.push({
      id: node.id,
      type: 'node',
      zIndex: node.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_NODE,
      element: node,
    });
  }

  // Add edges
  for (const edge of edges) {
    elements.push({
      id: edge.id,
      type: 'edge',
      zIndex: edge.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_EDGE,
      element: edge,
    });
  }

  // Add decorations
  for (const dec of decorations) {
    if ('pos_x' in dec) {
      elements.push({
        id: dec.id,
        type: 'shape-decoration',
        zIndex: dec.z_index ?? Z_INDEX_DEFAULTS.BOX_DECORATION,
        element: dec,
      });
    } else {
      elements.push({
        id: dec.id,
        type: 'line-decoration',
        zIndex: dec.z_index ?? Z_INDEX_DEFAULTS.LINE_DECORATION,
        element: dec,
      });
    }
  }

  // Sort by z-index (lowest first = rendered behind)
  return elements.sort((a, b) => a.zIndex - b.zIndex);
}

/**
 * Get the z-index of a specific element
 */
export function getElementZIndex(
  elementId: string,
  elementType: ZIndexElementType,
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  decorations: Decoration[]
): number {
  switch (elementType) {
    case 'node': {
      const node = nodes.find(n => n.id === elementId);
      return node?.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_NODE;
    }
    case 'edge': {
      const edge = edges.find(e => e.id === elementId);
      return edge?.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_EDGE;
    }
    case 'shape-decoration': {
      const dec = decorations.find(d => d.id === elementId);
      if (dec && 'pos_x' in dec) {
        return dec.z_index ?? Z_INDEX_DEFAULTS.BOX_DECORATION;
      }
      return Z_INDEX_DEFAULTS.BOX_DECORATION;
    }
    case 'line-decoration': {
      const dec = decorations.find(d => d.id === elementId);
      if (dec && !('pos_x' in dec)) {
        return dec.z_index ?? Z_INDEX_DEFAULTS.LINE_DECORATION;
      }
      return Z_INDEX_DEFAULTS.LINE_DECORATION;
    }
    default:
      return Z_INDEX_DEFAULTS.DIAGRAM_NODE;
  }
}

/**
 * Check if a decoration is a shape decoration
 */
export function isShapeDecoration(dec: Decoration): dec is ShapeDecoration {
  return 'pos_x' in dec;
}

/**
 * Check if a decoration is a line decoration
 */
export function isLineDecoration(dec: Decoration): dec is LineDecoration {
  return !('pos_x' in dec);
}
