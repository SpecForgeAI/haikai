/**
 * ER Edge Symbols Utility
 * Task Group 6: UML-style relationship symbols for ER diagram edges
 *
 * Provides SVG path definitions and rendering utilities for UML relationship symbols:
 * - HOLLOW_TRIANGLE: Generalization and Realization (at TARGET end)
 * - FILLED_DIAMOND: Composition (at SOURCE end)
 * - HOLLOW_DIAMOND: Aggregation (at SOURCE end)
 * - OPEN_ARROW: Dependency (at TARGET end)
 * - NONE: Association (no symbol)
 *
 * Line styles:
 * - Solid: Generalization, Composition, Aggregation, Association
 * - Dashed: Realization, Dependency (stroke-dasharray: 6,3)
 */

import type { LogicalERRelationship } from '../types/model';

// ============================================================================
// Symbol Type Definitions
// ============================================================================

/**
 * UML relationship symbol types
 */
export type EREdgeSymbolType =
  | 'HOLLOW_TRIANGLE'
  | 'FILLED_DIAMOND'
  | 'HOLLOW_DIAMOND'
  | 'OPEN_ARROW'
  | 'NONE';

/**
 * Line style for the edge
 */
export type EREdgeLineStyle = 'solid' | 'dashed';

/**
 * Result of getEREdgeSymbols function
 */
export interface EREdgeSymbols {
  sourceSymbol: EREdgeSymbolType;
  targetSymbol: EREdgeSymbolType;
  lineStyle: EREdgeLineStyle;
}

/**
 * SVG path data for rendering a symbol at a specific position
 */
export interface ERSymbolRenderData {
  pathData: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Symbol width in pixels */
export const ER_SYMBOL_WIDTH = 12;

/** Symbol height in pixels */
export const ER_SYMBOL_HEIGHT = 10;

/** Stroke dasharray for dashed lines */
export const ER_DASHED_LINE_PATTERN = '6,3';

/** Default stroke color for ER edge symbols */
export const ER_SYMBOL_STROKE_COLOR = '#616161';

/** Default stroke width for ER edge symbols */
export const ER_SYMBOL_STROKE_WIDTH = 1.5;

// ============================================================================
// Symbol Path Generation Functions
// ============================================================================

/**
 * Generate SVG path for a hollow triangle pointing in a direction.
 * Used for GENERALIZATION and REALIZATION symbols.
 *
 * The triangle points along the edge direction, with the tip at the endpoint.
 *
 * @param tipX - X coordinate of the triangle tip (at edge endpoint)
 * @param tipY - Y coordinate of the triangle tip
 * @param angle - Angle in radians (direction the edge is pointing)
 * @param width - Width of the triangle base
 * @param height - Height of the triangle (from base to tip)
 * @returns SVG path data string
 */
export function generateHollowTrianglePath(
  tipX: number,
  tipY: number,
  angle: number,
  width: number = ER_SYMBOL_WIDTH,
  height: number = ER_SYMBOL_HEIGHT
): string {
  // Calculate base points (perpendicular to direction, offset from tip)
  const halfWidth = width / 2;

  // Base center is offset from tip by height along the incoming direction
  const baseCenterX = tipX - Math.cos(angle) * height;
  const baseCenterY = tipY - Math.sin(angle) * height;

  // Perpendicular direction for base width
  const perpX = -Math.sin(angle);
  const perpY = Math.cos(angle);

  // Calculate the two base corners
  const baseLeftX = baseCenterX + perpX * halfWidth;
  const baseLeftY = baseCenterY + perpY * halfWidth;
  const baseRightX = baseCenterX - perpX * halfWidth;
  const baseRightY = baseCenterY - perpY * halfWidth;

  return `M ${tipX} ${tipY} L ${baseLeftX} ${baseLeftY} L ${baseRightX} ${baseRightY} Z`;
}

/**
 * Generate SVG path for a diamond shape.
 * Used for COMPOSITION (filled) and AGGREGATION (hollow) symbols.
 *
 * The diamond is positioned with one vertex at the edge endpoint.
 *
 * @param vertexX - X coordinate of the diamond vertex at edge endpoint
 * @param vertexY - Y coordinate of the vertex
 * @param angle - Angle in radians (direction from source toward target)
 * @param width - Width of the diamond (perpendicular to edge)
 * @param height - Height of the diamond (along edge direction)
 * @returns SVG path data string
 */
export function generateDiamondPath(
  vertexX: number,
  vertexY: number,
  angle: number,
  width: number = ER_SYMBOL_WIDTH,
  height: number = ER_SYMBOL_HEIGHT
): string {
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  // Direction vectors
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const perpX = -Math.sin(angle);
  const perpY = Math.cos(angle);

  // Calculate diamond points
  // - nearVertex: at edge endpoint (source side)
  // - farVertex: opposite end of diamond (toward center of edge)
  // - leftVertex: left side of diamond
  // - rightVertex: right side of diamond
  const centerX = vertexX + dirX * halfHeight;
  const centerY = vertexY + dirY * halfHeight;

  const farX = vertexX + dirX * height;
  const farY = vertexY + dirY * height;

  const leftX = centerX + perpX * halfWidth;
  const leftY = centerY + perpY * halfWidth;

  const rightX = centerX - perpX * halfWidth;
  const rightY = centerY - perpY * halfWidth;

  return `M ${vertexX} ${vertexY} L ${leftX} ${leftY} L ${farX} ${farY} L ${rightX} ${rightY} Z`;
}

/**
 * Generate SVG path for an open arrow (V-shape).
 * Used for DEPENDENCY symbol.
 *
 * @param tipX - X coordinate of the arrow tip
 * @param tipY - Y coordinate of the arrow tip
 * @param angle - Angle in radians (direction the arrow points)
 * @param width - Width of the arrowhead
 * @param height - Height of the arrowhead
 * @returns SVG path data string
 */
export function generateOpenArrowPath(
  tipX: number,
  tipY: number,
  angle: number,
  width: number = 10,
  height: number = 8
): string {
  const halfWidth = width / 2;

  // Base center offset from tip
  const baseCenterX = tipX - Math.cos(angle) * height;
  const baseCenterY = tipY - Math.sin(angle) * height;

  // Perpendicular direction
  const perpX = -Math.sin(angle);
  const perpY = Math.cos(angle);

  // Calculate wing endpoints
  const leftX = baseCenterX + perpX * halfWidth;
  const leftY = baseCenterY + perpY * halfWidth;
  const rightX = baseCenterX - perpX * halfWidth;
  const rightY = baseCenterY - perpY * halfWidth;

  // V-shape: left wing -> tip -> right wing (no closing)
  return `M ${leftX} ${leftY} L ${tipX} ${tipY} L ${rightX} ${rightY}`;
}

// ============================================================================
// Symbol Mapping Function
// ============================================================================

/**
 * Get the UML symbols and line style for a LogicalER relationship type.
 *
 * UML Relationship Symbol Mapping:
 * - GENERALIZATION: hollow triangle at TARGET, solid line
 * - REALIZATION: hollow triangle at TARGET, dashed line
 * - COMPOSITION: filled diamond at SOURCE, solid line
 * - AGGREGATION: hollow diamond at SOURCE, solid line
 * - ASSOCIATION: no symbols, solid line
 * - DEPENDENCY: open arrow at TARGET, dashed line
 *
 * @param relationshipType - The LogicalERRelationship type
 * @returns Object with sourceSymbol, targetSymbol, and lineStyle
 */
export function getEREdgeSymbols(relationshipType: LogicalERRelationship | undefined): EREdgeSymbols {
  switch (relationshipType) {
    case 'GENERALIZATION':
      return {
        sourceSymbol: 'NONE',
        targetSymbol: 'HOLLOW_TRIANGLE',
        lineStyle: 'solid',
      };

    case 'REALIZATION':
      return {
        sourceSymbol: 'NONE',
        targetSymbol: 'HOLLOW_TRIANGLE',
        lineStyle: 'dashed',
      };

    case 'COMPOSITION':
      return {
        sourceSymbol: 'FILLED_DIAMOND',
        targetSymbol: 'NONE',
        lineStyle: 'solid',
      };

    case 'AGGREGATION':
      return {
        sourceSymbol: 'HOLLOW_DIAMOND',
        targetSymbol: 'NONE',
        lineStyle: 'solid',
      };

    case 'ASSOCIATION':
      return {
        sourceSymbol: 'NONE',
        targetSymbol: 'NONE',
        lineStyle: 'solid',
      };

    case 'DEPENDENCY':
      return {
        sourceSymbol: 'NONE',
        targetSymbol: 'OPEN_ARROW',
        lineStyle: 'dashed',
      };

    default:
      // Default to ASSOCIATION (no symbols, solid line)
      return {
        sourceSymbol: 'NONE',
        targetSymbol: 'NONE',
        lineStyle: 'solid',
      };
  }
}

// ============================================================================
// Angle Calculation
// ============================================================================

/**
 * Calculate the angle (in radians) from point1 to point2.
 *
 * @param x1 - X coordinate of point 1
 * @param y1 - Y coordinate of point 1
 * @param x2 - X coordinate of point 2
 * @param y2 - Y coordinate of point 2
 * @returns Angle in radians
 */
export function calculateEdgeAngle(x1: number, y1: number, x2: number, y2: number): number {
  return Math.atan2(y2 - y1, x2 - x1);
}

// ============================================================================
// Symbol Rendering Helper
// ============================================================================

/**
 * Get render data for a symbol at a specific position.
 *
 * @param symbolType - The type of symbol to render
 * @param x - X coordinate of the symbol position (at edge endpoint)
 * @param y - Y coordinate of the symbol position
 * @param angle - Angle in radians (direction along edge)
 * @param strokeColor - Stroke color (default: #616161)
 * @returns Render data with pathData, fill, stroke, and strokeWidth
 */
export function getSymbolRenderData(
  symbolType: EREdgeSymbolType,
  x: number,
  y: number,
  angle: number,
  strokeColor: string = ER_SYMBOL_STROKE_COLOR
): ERSymbolRenderData | null {
  switch (symbolType) {
    case 'HOLLOW_TRIANGLE':
      return {
        pathData: generateHollowTrianglePath(x, y, angle),
        fill: 'white', // Hollow = white fill
        stroke: strokeColor,
        strokeWidth: ER_SYMBOL_STROKE_WIDTH,
      };

    case 'FILLED_DIAMOND':
      return {
        pathData: generateDiamondPath(x, y, angle),
        fill: strokeColor, // Filled = same as stroke
        stroke: strokeColor,
        strokeWidth: ER_SYMBOL_STROKE_WIDTH,
      };

    case 'HOLLOW_DIAMOND':
      return {
        pathData: generateDiamondPath(x, y, angle),
        fill: 'white', // Hollow = white fill
        stroke: strokeColor,
        strokeWidth: ER_SYMBOL_STROKE_WIDTH,
      };

    case 'OPEN_ARROW':
      return {
        pathData: generateOpenArrowPath(x, y, angle),
        fill: 'none', // Open arrow has no fill
        stroke: strokeColor,
        strokeWidth: ER_SYMBOL_STROKE_WIDTH,
      };

    case 'NONE':
    default:
      return null;
  }
}

/**
 * Get the stroke-dasharray value for the line style.
 *
 * @param lineStyle - 'solid' or 'dashed'
 * @returns SVG stroke-dasharray value or undefined for solid
 */
export function getEREdgeStrokeDasharray(lineStyle: EREdgeLineStyle): string | undefined {
  return lineStyle === 'dashed' ? ER_DASHED_LINE_PATTERN : undefined;
}
