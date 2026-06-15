/**
 * Decoration Utility Functions
 * Utility functions for creating, manipulating, and hit-testing decorations
 * Extended for Task Group 1-2: Type Guards and Factory Functions for New Shapes
 */

import {
  BoxDecoration,
  LineDecoration,
  Decoration,
  ShapeDecoration,
  ShapeDecorationType,
  LineDecorationType,
  SHAPE_DECORATION_TYPES,
  LINE_DECORATION_TYPES,
  DecorationType,
} from '../types/model';
import {
  generateDecorationId as generateId,
  DECORATION_DEFAULTS,
} from '../config/defaults';
import { HandlePosition } from '../config/defaults';
import { measureTextWidth } from './rendering';

// Re-export generateDecorationId from defaults for convenience
export { generateDecorationId } from '../config/defaults';

// ============================================================================
// Type Guards (Task Group 1)
// ============================================================================

/**
 * Check if a decoration is a shape-based decoration (area-based)
 * Type guard for TypeScript type narrowing
 * @param d - The decoration to check
 * @returns True if the decoration is a ShapeDecoration
 */
export function isShapeDecoration(d: Decoration): d is ShapeDecoration {
  return SHAPE_DECORATION_TYPES.includes(d.type as ShapeDecorationType);
}

/**
 * Check if a decoration is a line-based decoration
 * Type guard for TypeScript type narrowing
 * @param d - The decoration to check
 * @returns True if the decoration is a LineDecoration
 */
export function isLineBasedDecoration(d: Decoration): d is LineDecoration {
  return LINE_DECORATION_TYPES.includes(d.type as LineDecorationType);
}

/**
 * Check if a decoration is a BOX type
 * Type guard for TypeScript type narrowing (backward compatible)
 * @param decoration - The decoration to check
 * @returns True if the decoration is a BoxDecoration
 */
export function isBoxDecoration(decoration: Decoration): decoration is BoxDecoration {
  return decoration.type === 'BOX';
}

/**
 * Check if a decoration is a LINE type (including ARROW_SINGLE, ARROW_DOUBLE)
 * Type guard for TypeScript type narrowing (backward compatible)
 * @param decoration - The decoration to check
 * @returns True if the decoration is a LineDecoration
 */
export function isLineDecoration(decoration: Decoration): decoration is LineDecoration {
  return LINE_DECORATION_TYPES.includes(decoration.type as LineDecorationType);
}

// ============================================================================
// Factory Functions (Task Group 2)
// ============================================================================

/**
 * Create a default BOX decoration with standard styling
 * @param pos_x - X coordinate of the box
 * @param pos_y - Y coordinate of the box
 * @param width - Width of the box
 * @param height - Height of the box
 * @returns A new BoxDecoration with default styling applied
 */
export function createDefaultBoxDecoration(
  pos_x: number,
  pos_y: number,
  width: number,
  height: number
): BoxDecoration {
  const defaults = DECORATION_DEFAULTS.BOX;

  return {
    id: generateId('BOX'),
    type: 'BOX',
    pos_x,
    pos_y,
    width,
    height,
    z_index: defaults.z_index,
    background_color: defaults.background_color,
    line_color: defaults.line_color,
    line_style: defaults.line_style,
    line_weight: defaults.line_weight,
    text_font_size: defaults.text_font_size,
    text_font_weight: defaults.text_font_weight,
    text_font_style: defaults.text_font_style,
    text_color: defaults.text_color,
    text_h_align: defaults.text_h_align,
    text_v_align: defaults.text_v_align,
    background_opacity: defaults.background_opacity,
    border_opacity: defaults.border_opacity,
    text: '', // Empty text by default
  };
}

/**
 * Create a TEXT decoration (transparent box for free-form text)
 * Identical to BOX but with background and border opacity set to 0
 */
export function createTextDecoration(
  pos_x: number,
  pos_y: number,
  width: number,
  height: number
): ShapeDecoration {
  const defaults = DECORATION_DEFAULTS.TEXT;

  return {
    id: generateId('TEXT'),
    type: 'TEXT',
    pos_x,
    pos_y,
    width,
    height,
    z_index: defaults.z_index,
    background_color: defaults.background_color,
    line_color: defaults.line_color,
    line_style: defaults.line_style,
    line_weight: defaults.line_weight,
    text_font_size: defaults.text_font_size,
    text_font_weight: defaults.text_font_weight,
    text_font_style: defaults.text_font_style,
    text_color: defaults.text_color,
    text_h_align: defaults.text_h_align,
    text_v_align: defaults.text_v_align,
    background_opacity: defaults.background_opacity,
    border_opacity: defaults.border_opacity,
    text: '', // Empty text by default
  };
}

/**
 * Create a default LINE decoration with standard styling
 * @param line_points - Array of points forming the polyline
 * @returns A new LineDecoration with default styling applied
 */
export function createDefaultLineDecoration(
  line_points: Array<{ x: number; y: number }>
): LineDecoration {
  const defaults = DECORATION_DEFAULTS.LINE;

  return {
    id: generateId('LINE'),
    type: 'LINE',
    line_points,
    z_index: defaults.z_index,
    line_color: defaults.line_color,
    line_style: defaults.line_style,
    line_weight: defaults.line_weight,
    text_font_size: defaults.text_font_size,
    text_font_weight: defaults.text_font_weight,
    text_font_style: defaults.text_font_style,
    text_color: defaults.text_color,
    arrow_start: defaults.arrow_start,
    arrow_end: defaults.arrow_end,
    text: '', // Empty text by default
  };
}

/**
 * Create an OVAL decoration (ellipse)
 * @param pos_x - X coordinate
 * @param pos_y - Y coordinate
 * @param width - Width of the bounding box
 * @param height - Height of the bounding box
 * @returns A new ShapeDecoration with type 'OVAL'
 */
export function createOvalDecoration(
  pos_x: number,
  pos_y: number,
  width: number,
  height: number
): ShapeDecoration {
  const defaults = DECORATION_DEFAULTS.OVAL;

  return {
    id: generateId('OVAL'),
    type: 'OVAL',
    pos_x,
    pos_y,
    width,
    height,
    z_index: defaults.z_index,
    background_color: defaults.background_color,
    line_color: defaults.line_color,
    line_style: defaults.line_style,
    line_weight: defaults.line_weight,
    text_font_size: defaults.text_font_size,
    text_font_weight: defaults.text_font_weight,
    text_font_style: defaults.text_font_style,
    text_color: defaults.text_color,
    text_h_align: defaults.text_h_align,
    text_v_align: defaults.text_v_align,
    background_opacity: defaults.background_opacity,
    border_opacity: defaults.border_opacity,
    text: '',
  };
}

/**
 * Create a DIAMOND decoration (rhombus)
 * @param pos_x - X coordinate
 * @param pos_y - Y coordinate
 * @param width - Width of the bounding box
 * @param height - Height of the bounding box
 * @returns A new ShapeDecoration with type 'DIAMOND'
 */
export function createDiamondDecoration(
  pos_x: number,
  pos_y: number,
  width: number,
  height: number
): ShapeDecoration {
  const defaults = DECORATION_DEFAULTS.DIAMOND;

  return {
    id: generateId('DIAMOND'),
    type: 'DIAMOND',
    pos_x,
    pos_y,
    width,
    height,
    z_index: defaults.z_index,
    background_color: defaults.background_color,
    line_color: defaults.line_color,
    line_style: defaults.line_style,
    line_weight: defaults.line_weight,
    text_font_size: defaults.text_font_size,
    text_font_weight: defaults.text_font_weight,
    text_font_style: defaults.text_font_style,
    text_color: defaults.text_color,
    text_h_align: defaults.text_h_align,
    text_v_align: defaults.text_v_align,
    background_opacity: defaults.background_opacity,
    border_opacity: defaults.border_opacity,
    text: '',
  };
}

/**
 * Create a PARALLELOGRAM decoration
 * @param pos_x - X coordinate
 * @param pos_y - Y coordinate
 * @param width - Width of the bounding box
 * @param height - Height of the bounding box
 * @returns A new ShapeDecoration with type 'PARALLELOGRAM'
 */
export function createParallelogramDecoration(
  pos_x: number,
  pos_y: number,
  width: number,
  height: number
): ShapeDecoration {
  const defaults = DECORATION_DEFAULTS.PARALLELOGRAM;

  return {
    id: generateId('PARALLELOGRAM'),
    type: 'PARALLELOGRAM',
    pos_x,
    pos_y,
    width,
    height,
    z_index: defaults.z_index,
    background_color: defaults.background_color,
    line_color: defaults.line_color,
    line_style: defaults.line_style,
    line_weight: defaults.line_weight,
    text_font_size: defaults.text_font_size,
    text_font_weight: defaults.text_font_weight,
    text_font_style: defaults.text_font_style,
    text_color: defaults.text_color,
    text_h_align: defaults.text_h_align,
    text_v_align: defaults.text_v_align,
    background_opacity: defaults.background_opacity,
    border_opacity: defaults.border_opacity,
    text: '',
  };
}

/**
 * Create a CIRCLE decoration (perfect circle)
 * Note: Uses min(width, height) as diameter for a perfect circle
 * @param pos_x - X coordinate
 * @param pos_y - Y coordinate
 * @param radius - Radius of the circle (width and height will be 2*radius)
 * @returns A new ShapeDecoration with type 'CIRCLE'
 */
export function createCircleDecoration(
  pos_x: number,
  pos_y: number,
  radius: number
): ShapeDecoration {
  const defaults = DECORATION_DEFAULTS.CIRCLE;
  const diameter = radius * 2;

  return {
    id: generateId('CIRCLE'),
    type: 'CIRCLE',
    pos_x,
    pos_y,
    width: diameter,
    height: diameter,
    z_index: defaults.z_index,
    background_color: defaults.background_color,
    line_color: defaults.line_color,
    line_style: defaults.line_style,
    line_weight: defaults.line_weight,
    text_font_size: defaults.text_font_size,
    text_font_weight: defaults.text_font_weight,
    text_font_style: defaults.text_font_style,
    text_color: defaults.text_color,
    text_h_align: defaults.text_h_align,
    text_v_align: defaults.text_v_align,
    background_opacity: defaults.background_opacity,
    border_opacity: defaults.border_opacity,
    text: '',
  };
}

/**
 * Create a CYLINDER decoration (database shape)
 * @param pos_x - X coordinate
 * @param pos_y - Y coordinate
 * @param width - Width of the cylinder
 * @param height - Height of the cylinder
 * @returns A new ShapeDecoration with type 'CYLINDER'
 */
export function createCylinderDecoration(
  pos_x: number,
  pos_y: number,
  width: number,
  height: number
): ShapeDecoration {
  const defaults = DECORATION_DEFAULTS.CYLINDER;

  return {
    id: generateId('CYLINDER'),
    type: 'CYLINDER',
    pos_x,
    pos_y,
    width,
    height,
    z_index: defaults.z_index,
    background_color: defaults.background_color,
    line_color: defaults.line_color,
    line_style: defaults.line_style,
    line_weight: defaults.line_weight,
    text_font_size: defaults.text_font_size,
    text_font_weight: defaults.text_font_weight,
    text_font_style: defaults.text_font_style,
    text_color: defaults.text_color,
    text_h_align: defaults.text_h_align,
    text_v_align: defaults.text_v_align,
    background_opacity: defaults.background_opacity,
    border_opacity: defaults.border_opacity,
    text: '',
  };
}

/**
 * Create a TRAPEZOID decoration
 * @param pos_x - X coordinate
 * @param pos_y - Y coordinate
 * @param width - Width of the bounding box
 * @param height - Height of the bounding box
 * @returns A new ShapeDecoration with type 'TRAPEZOID'
 */
export function createTrapezoidDecoration(
  pos_x: number,
  pos_y: number,
  width: number,
  height: number
): ShapeDecoration {
  const defaults = DECORATION_DEFAULTS.TRAPEZOID;

  return {
    id: generateId('TRAPEZOID'),
    type: 'TRAPEZOID',
    pos_x,
    pos_y,
    width,
    height,
    z_index: defaults.z_index,
    background_color: defaults.background_color,
    line_color: defaults.line_color,
    line_style: defaults.line_style,
    line_weight: defaults.line_weight,
    text_font_size: defaults.text_font_size,
    text_font_weight: defaults.text_font_weight,
    text_font_style: defaults.text_font_style,
    text_color: defaults.text_color,
    text_h_align: defaults.text_h_align,
    text_v_align: defaults.text_v_align,
    background_opacity: defaults.background_opacity,
    border_opacity: defaults.border_opacity,
    text: '',
  };
}

/**
 * Create a HEXAGON decoration
 * @param pos_x - X coordinate
 * @param pos_y - Y coordinate
 * @param width - Width of the bounding box
 * @param height - Height of the bounding box
 * @returns A new ShapeDecoration with type 'HEXAGON'
 */
export function createHexagonDecoration(
  pos_x: number,
  pos_y: number,
  width: number,
  height: number
): ShapeDecoration {
  const defaults = DECORATION_DEFAULTS.HEXAGON;

  return {
    id: generateId('HEXAGON'),
    type: 'HEXAGON',
    pos_x,
    pos_y,
    width,
    height,
    z_index: defaults.z_index,
    background_color: defaults.background_color,
    line_color: defaults.line_color,
    line_style: defaults.line_style,
    line_weight: defaults.line_weight,
    text_font_size: defaults.text_font_size,
    text_font_weight: defaults.text_font_weight,
    text_font_style: defaults.text_font_style,
    text_color: defaults.text_color,
    text_h_align: defaults.text_h_align,
    text_v_align: defaults.text_v_align,
    background_opacity: defaults.background_opacity,
    border_opacity: defaults.border_opacity,
    text: '',
  };
}

/**
 * Create an ARROW_SINGLE decoration (line with arrow at end)
 * @param line_points - Array of points forming the polyline
 * @returns A new LineDecoration with type 'ARROW_SINGLE'
 */
export function createArrowSingleDecoration(
  line_points: Array<{ x: number; y: number }>
): LineDecoration {
  const defaults = DECORATION_DEFAULTS.ARROW_SINGLE;

  return {
    id: generateId('ARROW_SINGLE'),
    type: 'ARROW_SINGLE',
    line_points,
    z_index: defaults.z_index,
    line_color: defaults.line_color,
    line_style: defaults.line_style,
    line_weight: defaults.line_weight,
    text_font_size: defaults.text_font_size,
    text_font_weight: defaults.text_font_weight,
    text_font_style: defaults.text_font_style,
    text_color: defaults.text_color,
    arrow_start: 'NONE',
    arrow_end: 'ARROW',
    text: '',
  };
}

/**
 * Create an ARROW_DOUBLE decoration (line with arrows at both ends)
 * @param line_points - Array of points forming the polyline
 * @returns A new LineDecoration with type 'ARROW_DOUBLE'
 */
export function createArrowDoubleDecoration(
  line_points: Array<{ x: number; y: number }>
): LineDecoration {
  const defaults = DECORATION_DEFAULTS.ARROW_DOUBLE;

  return {
    id: generateId('ARROW_DOUBLE'),
    type: 'ARROW_DOUBLE',
    line_points,
    z_index: defaults.z_index,
    line_color: defaults.line_color,
    line_style: defaults.line_style,
    line_weight: defaults.line_weight,
    text_font_size: defaults.text_font_size,
    text_font_weight: defaults.text_font_weight,
    text_font_style: defaults.text_font_style,
    text_color: defaults.text_color,
    arrow_start: 'ARROW',
    arrow_end: 'ARROW',
    text: '',
  };
}


/**
 * Create a NOTE decoration (post-it note with folded top-left corner)
 * @param pos_x - X coordinate
 * @param pos_y - Y coordinate
 * @param width - Width of the bounding box
 * @param height - Height of the bounding box
 * @returns A new ShapeDecoration with type 'NOTE'
 */
export function createNoteDecoration(
  pos_x: number,
  pos_y: number,
  width: number,
  height: number
): ShapeDecoration {
  const defaults = DECORATION_DEFAULTS.NOTE;

  return {
    id: generateId('NOTE'),
    type: 'NOTE',
    pos_x,
    pos_y,
    width,
    height,
    z_index: defaults.z_index,
    background_color: defaults.background_color,
    line_color: defaults.line_color,
    line_style: defaults.line_style,
    line_weight: defaults.line_weight,
    text_font_size: defaults.text_font_size,
    text_font_weight: defaults.text_font_weight,
    text_font_style: defaults.text_font_style,
    text_color: defaults.text_color,
    text_h_align: defaults.text_h_align,
    text_v_align: defaults.text_v_align,
    background_opacity: defaults.background_opacity,
    border_opacity: defaults.border_opacity,
    text: '',
  };
}

/**
 * Create a shape decoration of the specified type
 * Factory function that routes to the appropriate shape creator
 * @param type - The shape type to create
 * @param pos_x - X coordinate
 * @param pos_y - Y coordinate
 * @param width - Width of the bounding box
 * @param height - Height of the bounding box
 * @returns A new ShapeDecoration of the specified type
 */
export function createShapeDecoration(
  type: ShapeDecorationType,
  pos_x: number,
  pos_y: number,
  width: number,
  height: number
): ShapeDecoration {
  switch (type) {
    case 'TEXT':
      return createTextDecoration(pos_x, pos_y, width, height);
    case 'BOX':
      return createDefaultBoxDecoration(pos_x, pos_y, width, height);
    case 'OVAL':
      return createOvalDecoration(pos_x, pos_y, width, height);
    case 'DIAMOND':
      return createDiamondDecoration(pos_x, pos_y, width, height);
    case 'PARALLELOGRAM':
      return createParallelogramDecoration(pos_x, pos_y, width, height);
    case 'CIRCLE':
      // For CIRCLE, use the minimum dimension as radius
      return createCircleDecoration(pos_x, pos_y, Math.min(width, height) / 2);
    case 'CYLINDER':
      return createCylinderDecoration(pos_x, pos_y, width, height);
    case 'TRAPEZOID':
      return createTrapezoidDecoration(pos_x, pos_y, width, height);
    case 'HEXAGON':
      return createHexagonDecoration(pos_x, pos_y, width, height);
    case 'NOTE':
      return createNoteDecoration(pos_x, pos_y, width, height);
    default:
      // Default to BOX if unknown type
      return createDefaultBoxDecoration(pos_x, pos_y, width, height);
  }
}

/**
 * Create a line decoration of the specified type
 * Factory function that routes to the appropriate line creator
 * @param type - The line type to create
 * @param line_points - Array of points forming the polyline
 * @returns A new LineDecoration of the specified type
 */
export function createLineTypeDecoration(
  type: LineDecorationType,
  line_points: Array<{ x: number; y: number }>
): LineDecoration {
  switch (type) {
    case 'LINE':
      return createDefaultLineDecoration(line_points);
    case 'ARROW_SINGLE':
      return createArrowSingleDecoration(line_points);
    case 'ARROW_DOUBLE':
      return createArrowDoubleDecoration(line_points);
    default:
      return createDefaultLineDecoration(line_points);
  }
}

/**
 * Create a decoration of any type
 * Master factory function that determines shape vs line type
 * @param type - The decoration type to create
 * @param params - Parameters for creation (position/size for shapes, points for lines)
 * @returns A new Decoration of the specified type
 */
export function createDecoration(
  type: DecorationType,
  params: { pos_x: number; pos_y: number; width: number; height: number } |
         { line_points: Array<{ x: number; y: number }> }
): Decoration {
  if (SHAPE_DECORATION_TYPES.includes(type as ShapeDecorationType)) {
    const shapeParams = params as { pos_x: number; pos_y: number; width: number; height: number };
    return createShapeDecoration(
      type as ShapeDecorationType,
      shapeParams.pos_x,
      shapeParams.pos_y,
      shapeParams.width,
      shapeParams.height
    );
  } else {
    const lineParams = params as { line_points: Array<{ x: number; y: number }> };
    return createLineTypeDecoration(type as LineDecorationType, lineParams.line_points);
  }
}

// ============================================================================
// Hit Testing Utilities
// ============================================================================

/**
 * Calculate the label position for a LINE decoration
 * If explicit label_pos_x/label_pos_y are provided, returns those
 * Otherwise, calculates the midpoint (average of all points)
 * @param line - The LINE decoration
 * @returns The label position {x, y}
 */
export function calculateLineLabelPosition(line: LineDecoration): { x: number; y: number } {
  // If explicit position is provided, use it (manual positioning overrides auto-centering)
  if (line.label_pos_x !== undefined && line.label_pos_y !== undefined) {
    return { x: line.label_pos_x, y: line.label_pos_y };
  }

  // Calculate midpoint as average of ALL points (auto-centering)
  const points = line.line_points;
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }

  const sumX = points.reduce((sum, p) => sum + p.x, 0);
  const sumY = points.reduce((sum, p) => sum + p.y, 0);

  return {
    x: sumX / points.length,
    y: sumY / points.length,
  };
}

/**
 * Check if a point is inside a shape decoration (BOX or any shape type)
 * @param x - X coordinate to test
 * @param y - Y coordinate to test
 * @param shape - The shape decoration to test against
 * @returns True if the point is inside or on the edge of the shape
 */
export function isPointInsideShapeDecoration(
  x: number,
  y: number,
  shape: ShapeDecoration
): boolean {
  return (
    x >= shape.pos_x &&
    x <= shape.pos_x + shape.width &&
    y >= shape.pos_y &&
    y <= shape.pos_y + shape.height
  );
}

/**
 * Check if a point is inside a BOX decoration (backward compatible alias)
 * @param x - X coordinate to test
 * @param y - Y coordinate to test
 * @param box - The BOX decoration to test against
 * @returns True if the point is inside or on the edge of the box
 */
export function isPointInsideBoxDecoration(
  x: number,
  y: number,
  box: BoxDecoration
): boolean {
  return isPointInsideShapeDecoration(x, y, box);
}

/**
 * Calculate distance from a point to a line segment
 * @param px - Point X coordinate
 * @param py - Point Y coordinate
 * @param x1 - Line segment start X
 * @param y1 - Line segment start Y
 * @param x2 - Line segment end X
 * @param y2 - Line segment end Y
 * @returns Distance from point to nearest point on line segment
 */
function distanceToLineSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  // Handle zero-length segment (point at endpoint)
  if (lengthSq === 0) {
    return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  }

  // Calculate projection parameter t clamped to [0,1]
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  // Find nearest point on segment
  const nearestX = x1 + t * dx;
  const nearestY = y1 + t * dy;

  // Return Euclidean distance to nearest point
  return Math.sqrt((px - nearestX) ** 2 + (py - nearestY) ** 2);
}

/**
 * Check if a point is near a LINE decoration (within tolerance of any segment)
 * @param x - X coordinate to test
 * @param y - Y coordinate to test
 * @param line - The LINE decoration to test against
 * @param tolerance - Maximum distance from line to be considered "near" (default 5px)
 * @returns True if the point is within tolerance of any segment
 */
export function isPointNearLineDecoration(
  x: number,
  y: number,
  line: LineDecoration,
  tolerance: number = 5
): boolean {
  const points = line.line_points;

  // Need at least 2 points to form a line
  if (points.length < 2) return false;

  // Check each segment
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    if (distanceToLineSegment(x, y, p1.x, p1.y, p2.x, p2.y) <= tolerance) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a point is on a LINE decoration's label
 * Uses the label's bounding box for hit testing
 * Task Group 1: Decorative Line Label Selection and Dragging
 *
 * @param clickX - X coordinate of the click
 * @param clickY - Y coordinate of the click
 * @param line - The LINE decoration to test against
 * @returns True if the point is within the label's bounding box
 */
export function isPointOnDecorationLabel(
  clickX: number,
  clickY: number,
  line: LineDecoration
): boolean {
  // No label to hit test if text is empty
  if (!line.text || line.text.trim() === '') {
    return false;
  }

  // Get label position (either explicit or auto-centered)
  const labelPos = calculateLineLabelPosition(line);

  // Get font properties from decoration or defaults
  const fontSize = line.text_font_size || DECORATION_DEFAULTS.LINE.text_font_size;
  const fontWeight = line.text_font_weight || DECORATION_DEFAULTS.LINE.text_font_weight;
  const fontStyle = line.text_font_style || DECORATION_DEFAULTS.LINE.text_font_style;

  // Measure text width for accurate bounding box
  const textWidth = measureTextWidth(line.text, fontSize, fontWeight, fontStyle);
  const textHeight = fontSize;

  // Calculate bounding box (label is middle-anchored, so centered at labelPos.x)
  const halfWidth = textWidth / 2;

  // Check if click is within bounding box
  // Note: labelPos.y is the baseline, so text extends above it
  return (
    clickX >= labelPos.x - halfWidth &&
    clickX <= labelPos.x + halfWidth &&
    clickY >= labelPos.y - textHeight &&
    clickY <= labelPos.y
  );
}

/**
 * Find a LINE decoration's label at a given point
 * Used for label-specific hit testing (higher priority than line body)
 * Task Group 1: Decorative Line Label Selection and Dragging
 *
 * @param x - X coordinate to test
 * @param y - Y coordinate to test
 * @param decorations - Array of decorations to test against
 * @returns The LINE decoration if a label was hit, or null if none found
 */
export function findDecorationLabelAtPoint(
  x: number,
  y: number,
  decorations: Decoration[]
): LineDecoration | null {
  // Check in reverse z-index order (topmost first)
  const sortedByZIndex = [...decorations].sort((a, b) => {
    return getDecorationZIndex(b) - getDecorationZIndex(a);
  });

  for (const decoration of sortedByZIndex) {
    if (isLineBasedDecoration(decoration)) {
      if (isPointOnDecorationLabel(x, y, decoration)) {
        return decoration;
      }
    }
  }

  return null;
}

/**
 * Handle position interface for decoration resize handles
 */
export interface DecorationHandlePosition {
  position: HandlePosition;
  x: number;
  y: number;
}

/**
 * Get the 8 resize handle positions for a shape decoration
 * Returns positions for: TL, TC, TR, ML, MR, BL, BC, BR
 * @param shape - The shape decoration
 * @returns Array of 8 handle positions with coordinates
 */
export function getShapeHandlePositions(shape: ShapeDecoration): DecorationHandlePosition[] {
  const { pos_x, pos_y, width, height } = shape;

  return [
    { position: 'TL', x: pos_x, y: pos_y },
    { position: 'TC', x: pos_x + width / 2, y: pos_y },
    { position: 'TR', x: pos_x + width, y: pos_y },
    { position: 'ML', x: pos_x, y: pos_y + height / 2 },
    { position: 'MR', x: pos_x + width, y: pos_y + height / 2 },
    { position: 'BL', x: pos_x, y: pos_y + height },
    { position: 'BC', x: pos_x + width / 2, y: pos_y + height },
    { position: 'BR', x: pos_x + width, y: pos_y + height },
  ];
}

/**
 * Get the 8 resize handle positions for a BOX decoration (backward compatible alias)
 * Returns positions for: TL, TC, TR, ML, MR, BL, BC, BR
 * @param box - The BOX decoration
 * @returns Array of 8 handle positions with coordinates
 */
export function getBoxHandlePositions(box: BoxDecoration): DecorationHandlePosition[] {
  return getShapeHandlePositions(box);
}

/**
 * Get the resize handle at a given point for a shape decoration
 * @param x - X coordinate to test
 * @param y - Y coordinate to test
 * @param shape - The shape decoration
 * @param handleSize - Size of the handles
 * @returns The handle position if found, null otherwise
 */
export function getShapeHandleAtPoint(
  x: number,
  y: number,
  shape: ShapeDecoration,
  handleSize: number
): HandlePosition | null {
  const handles = getShapeHandlePositions(shape);
  const halfSize = handleSize / 2;

  for (const handle of handles) {
    if (
      x >= handle.x - halfSize &&
      x <= handle.x + halfSize &&
      y >= handle.y - halfSize &&
      y <= handle.y + halfSize
    ) {
      return handle.position;
    }
  }

  return null;
}

/**
 * Get the line point index at a given point for a line decoration
 * @param x - X coordinate to test
 * @param y - Y coordinate to test
 * @param line - The line decoration
 * @param handleSize - Size of the handles
 * @returns The point index if found, null otherwise
 */
export function getLinePointAtPoint(
  x: number,
  y: number,
  line: LineDecoration,
  handleSize: number
): number | null {
  const halfSize = handleSize / 2;

  for (let i = 0; i < line.line_points.length; i++) {
    const point = line.line_points[i];
    if (
      x >= point.x - halfSize &&
      x <= point.x + halfSize &&
      y >= point.y - halfSize &&
      y <= point.y + halfSize
    ) {
      return i;
    }
  }

  return null;
}

/**
 * Get the effective z-index for a decoration
 * Uses the decoration's z_index if specified, otherwise uses default based on type
 * @param decoration - The decoration
 * @returns The effective z-index value
 */
export function getDecorationZIndex(decoration: Decoration): number {
  if (decoration.z_index !== undefined) {
    return decoration.z_index;
  }
  // Shape decorations use BOX z-index, line decorations use LINE z-index
  if (isShapeDecoration(decoration)) {
    return DECORATION_DEFAULTS.BOX.z_index;
  }
  return DECORATION_DEFAULTS.LINE.z_index;
}

/**
 * Sort decorations by z-index for proper rendering order
 * Lower z-index decorations are rendered first (underneath)
 * @param decorations - Array of decorations to sort
 * @returns New sorted array (does not mutate input)
 */
export function sortDecorationsByZIndex(decorations: Decoration[]): Decoration[] {
  return [...decorations].sort((a, b) => {
    return getDecorationZIndex(a) - getDecorationZIndex(b);
  });
}

/**
 * Find a decoration at a given point
 * Checks shape decorations first (hit testing inside bounds)
 * Then checks LINE decorations (hit testing near segments)
 * @param x - X coordinate to test
 * @param y - Y coordinate to test
 * @param decorations - Array of decorations to test against
 * @param lineTolerance - Tolerance for LINE hit testing (default 5px)
 * @returns The decoration at the point, or null if none found
 */
export function findDecorationAtPoint(
  x: number,
  y: number,
  decorations: Decoration[],
  lineTolerance: number = 5
): Decoration | null {
  // Check in reverse order (topmost decorations first based on z-index)
  const sortedByZIndex = [...decorations].sort((a, b) => {
    return getDecorationZIndex(b) - getDecorationZIndex(a);
  });

  for (const decoration of sortedByZIndex) {
    if (isShapeDecoration(decoration)) {
      if (isPointInsideShapeDecoration(x, y, decoration)) {
        return decoration;
      }
    } else if (isLineBasedDecoration(decoration)) {
      if (isPointNearLineDecoration(x, y, decoration, lineTolerance)) {
        return decoration;
      }
    }
  }

  return null;
}

/**
 * Check if a shape decoration is fully inside a selection rectangle
 * @param shape - The shape decoration to check
 * @param rect - Selection rectangle with x1, y1, x2, y2 (may be inverted)
 * @returns True if the shape is fully inside the rectangle
 */
export function isShapeInsideRect(
  shape: ShapeDecoration,
  rect: { x1: number; y1: number; x2: number; y2: number }
): boolean {
  // Normalize rectangle coordinates
  const minX = Math.min(rect.x1, rect.x2);
  const minY = Math.min(rect.y1, rect.y2);
  const maxX = Math.max(rect.x1, rect.x2);
  const maxY = Math.max(rect.y1, rect.y2);

  // Shape must be fully inside rectangle
  return (
    shape.pos_x >= minX &&
    shape.pos_x + shape.width <= maxX &&
    shape.pos_y >= minY &&
    shape.pos_y + shape.height <= maxY
  );
}

/**
 * Check if a BOX decoration is fully inside a selection rectangle (backward compatible alias)
 * @param box - The BOX decoration to check
 * @param rect - Selection rectangle with x1, y1, x2, y2 (may be inverted)
 * @returns True if the box is fully inside the rectangle
 */
export function isBoxInsideRect(
  box: BoxDecoration,
  rect: { x1: number; y1: number; x2: number; y2: number }
): boolean {
  return isShapeInsideRect(box, rect);
}

/**
 * Check if a LINE decoration is fully inside a selection rectangle
 * All points must be inside the rectangle
 * @param line - The LINE decoration to check
 * @param rect - Selection rectangle with x1, y1, x2, y2 (may be inverted)
 * @returns True if all line points are inside the rectangle
 */
export function isLineInsideRect(
  line: LineDecoration,
  rect: { x1: number; y1: number; x2: number; y2: number }
): boolean {
  // Normalize rectangle coordinates
  const minX = Math.min(rect.x1, rect.x2);
  const minY = Math.min(rect.y1, rect.y2);
  const maxX = Math.max(rect.x1, rect.x2);
  const maxY = Math.max(rect.y1, rect.y2);

  // All points must be inside rectangle
  return line.line_points.every(
    p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY
  );
}

/**
 * Check if a decoration is fully inside a selection rectangle
 * @param decoration - The decoration to check
 * @param rect - Selection rectangle with x1, y1, x2, y2 (may be inverted)
 * @returns True if the decoration is fully inside the rectangle
 */
export function isDecorationInsideRect(
  decoration: Decoration,
  rect: { x1: number; y1: number; x2: number; y2: number }
): boolean {
  if (isShapeDecoration(decoration)) {
    return isShapeInsideRect(decoration, rect);
  } else if (isLineBasedDecoration(decoration)) {
    return isLineInsideRect(decoration, rect);
  }
  return false;
}

// ============================================================================
// Mid-Segment Handle Utilities
// Task Group 2: Mid-Segment Handle Rendering
// Task Group 3: Bend Point Insertion
// ============================================================================

/**
 * Interface for a mid-segment handle position
 * Used for rendering mid-segment squares between consecutive points
 */
export interface MidSegmentPosition {
  x: number;
  y: number;
  segmentIndex: number;  // Index of the segment (between point[i] and point[i+1])
}

/**
 * Calculate mid-segment positions for a polyline
 * Returns the midpoint of each segment between consecutive points
 * Used for rendering mid-segment handles that allow adding bend points
 *
 * Task Group 2: Mid-Segment Handle Rendering
 *
 * @param points - Array of points (either line_points or edge_points mapped to {x, y})
 * @returns Array of mid-segment positions with coordinates and segment index
 *
 * @example
 * // For points: [{x:100, y:100}, {x:200, y:100}, {x:200, y:200}]
 * // Returns: [{x:150, y:100, segmentIndex:0}, {x:200, y:150, segmentIndex:1}]
 */
export function calculateMidSegmentPositions(
  points: Array<{ x: number; y: number }>
): MidSegmentPosition[] {
  // Need at least 2 points to have a segment
  if (points.length < 2) {
    return [];
  }

  const midSegments: MidSegmentPosition[] = [];

  // Calculate midpoint for each segment
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    // Midpoint formula: ((P[i].x + P[i+1].x) / 2, (P[i].y + P[i+1].y) / 2)
    midSegments.push({
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2,
      segmentIndex: i,
    });
  }

  return midSegments;
}

/**
 * Get the mid-segment handle at a given point (if any)
 * Used for hit testing mid-segment handles for bend point insertion
 *
 * Task Group 3: Bend Point Insertion
 *
 * @param clickX - X coordinate of the click
 * @param clickY - Y coordinate of the click
 * @param midPositions - Array of mid-segment positions from calculateMidSegmentPositions()
 * @param handleSize - Size of the square handle (side length in pixels)
 * @returns Segment index if a handle was hit, or null if none
 *
 * @example
 * const midPositions = calculateMidSegmentPositions(line.line_points);
 * const segmentIndex = getMidSegmentHandleAtPoint(clickX, clickY, midPositions, 6);
 * if (segmentIndex !== null) {
 *   // User clicked on mid-segment handle for segment at index segmentIndex
 *   // Insert new point at index segmentIndex + 1
 * }
 */
export function getMidSegmentHandleAtPoint(
  clickX: number,
  clickY: number,
  midPositions: MidSegmentPosition[],
  handleSize: number
): number | null {
  const halfSize = handleSize / 2;

  for (const midPos of midPositions) {
    // Check if click is within the square handle bounds
    // Handle is centered at (midPos.x, midPos.y)
    if (
      clickX >= midPos.x - halfSize &&
      clickX <= midPos.x + halfSize &&
      clickY >= midPos.y - halfSize &&
      clickY <= midPos.y + halfSize
    ) {
      return midPos.segmentIndex;
    }
  }

  return null;
}
