/**
 * Shape Rendering Functions
 * Task Group 3: Canvas Rendering for New Shapes
 *
 * Provides rendering functions for all decoration shape types:
 * - OVAL (ellipse)
 * - DIAMOND (rhombus)
 * - PARALLELOGRAM (skewed rectangle)
 * - CIRCLE (perfect circle)
 * - CYLINDER (database shape)
 * - TRAPEZOID (manual operation)
 * - HEXAGON (preparation shape)
 * - NOTE (post-it note with folded top-left corner)
 */

import { ShapeDecoration } from '../types/model';
import { DECORATION_DEFAULTS } from '../config/defaults';

/**
 * Interface for shape rendering output
 * Contains SVG path data and style information
 */
export interface ShapeRenderResult {
  pathData: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeDasharray: string;
  textPosition: { x: number; y: number };
  /** Optional additional path for decorative elements (e.g. NOTE fold) */
  foldPath?: string;
  foldFill?: string;
}

/**
 * Apply opacity to a color string, returning an rgba color.
 * Handles hex (#RGB, #RRGGBB), rgb(), and rgba() inputs.
 * Opacity is 0-100 where 100 = fully opaque.
 */
export function applyOpacity(color: string, opacity: number): string {
  const alpha = Math.max(0, Math.min(1, opacity / 100));
  if (alpha >= 1) return color;

  // Parse hex
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    let r: number, g: number, b: number;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Parse rgba/rgb
  const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (match) {
    const existingAlpha = match[4] ? parseFloat(match[4]) : 1;
    return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${existingAlpha * alpha})`;
  }

  return color;
}

/**
 * Get stroke dasharray pattern from line style
 */
function getStrokeDasharray(lineStyle?: string): string {
  switch (lineStyle) {
    case 'DASHED':
      return '6 4';
    case 'DOTTED':
      return '2 4';
    default:
      return '';
  }
}

/**
 * Parse line weight from CSS string to number
 */
function parseLineWeight(weight?: string): number {
  if (!weight) return 2;
  const match = weight.match(/^(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 2;
}

/**
 * Render an OVAL (ellipse) inscribed in bounding box
 * Uses SVG ellipse parameters for the path
 */
export function renderOval(shape: ShapeDecoration): ShapeRenderResult {
  const { pos_x, pos_y, width, height } = shape;
  const defaults = DECORATION_DEFAULTS.OVAL;

  // Calculate center and radii
  const cx = pos_x + width / 2;
  const cy = pos_y + height / 2;
  const rx = width / 2;
  const ry = height / 2;

  // Create ellipse path using arc commands
  // M (start left), A (arc to right), A (arc back to start)
  const pathData = `M ${pos_x} ${cy} ` +
    `A ${rx} ${ry} 0 1 1 ${pos_x + width} ${cy} ` +
    `A ${rx} ${ry} 0 1 1 ${pos_x} ${cy} Z`;

  return {
    pathData,
    fill: shape.background_color || defaults.background_color,
    stroke: shape.line_color || defaults.line_color,
    strokeWidth: parseLineWeight(shape.line_weight || defaults.line_weight),
    strokeDasharray: getStrokeDasharray(shape.line_style || defaults.line_style),
    textPosition: { x: cx, y: cy },
  };
}

/**
 * Render a DIAMOND (rhombus) with vertices at edge midpoints
 * 4-point path: top, right, bottom, left
 */
export function renderDiamond(shape: ShapeDecoration): ShapeRenderResult {
  const { pos_x, pos_y, width, height } = shape;
  const defaults = DECORATION_DEFAULTS.DIAMOND;

  // Calculate vertex positions (midpoints of each edge)
  const top = { x: pos_x + width / 2, y: pos_y };
  const right = { x: pos_x + width, y: pos_y + height / 2 };
  const bottom = { x: pos_x + width / 2, y: pos_y + height };
  const left = { x: pos_x, y: pos_y + height / 2 };

  // Create diamond path
  const pathData = `M ${top.x} ${top.y} ` +
    `L ${right.x} ${right.y} ` +
    `L ${bottom.x} ${bottom.y} ` +
    `L ${left.x} ${left.y} Z`;

  return {
    pathData,
    fill: shape.background_color || defaults.background_color,
    stroke: shape.line_color || defaults.line_color,
    strokeWidth: parseLineWeight(shape.line_weight || defaults.line_weight),
    strokeDasharray: getStrokeDasharray(shape.line_style || defaults.line_style),
    textPosition: { x: pos_x + width / 2, y: pos_y + height / 2 },
  };
}

/**
 * Render a PARALLELOGRAM with ~15 degree horizontal skew
 * 4-point path with top edge offset to the right
 */
export function renderParallelogram(shape: ShapeDecoration): ShapeRenderResult {
  const { pos_x, pos_y, width, height } = shape;
  const defaults = DECORATION_DEFAULTS.PARALLELOGRAM;

  // Calculate skew offset (approximately 15 degrees = tan(15) * height)
  // For simplicity, use 20% of height as offset
  const skewOffset = height * 0.2;

  // Define vertices (clockwise from top-left)
  const topLeft = { x: pos_x + skewOffset, y: pos_y };
  const topRight = { x: pos_x + width, y: pos_y };
  const bottomRight = { x: pos_x + width - skewOffset, y: pos_y + height };
  const bottomLeft = { x: pos_x, y: pos_y + height };

  // Create parallelogram path
  const pathData = `M ${topLeft.x} ${topLeft.y} ` +
    `L ${topRight.x} ${topRight.y} ` +
    `L ${bottomRight.x} ${bottomRight.y} ` +
    `L ${bottomLeft.x} ${bottomLeft.y} Z`;

  return {
    pathData,
    fill: shape.background_color || defaults.background_color,
    stroke: shape.line_color || defaults.line_color,
    strokeWidth: parseLineWeight(shape.line_weight || defaults.line_weight),
    strokeDasharray: getStrokeDasharray(shape.line_style || defaults.line_style),
    textPosition: { x: pos_x + width / 2, y: pos_y + height / 2 },
  };
}

/**
 * Render a CIRCLE using min(width, height) as diameter
 * Perfect circle regardless of bounding box aspect ratio
 */
export function renderCircle(shape: ShapeDecoration): ShapeRenderResult {
  const { pos_x, pos_y, width, height } = shape;
  const defaults = DECORATION_DEFAULTS.CIRCLE;

  // Use minimum dimension as diameter for a perfect circle
  const diameter = Math.min(width, height);
  const radius = diameter / 2;

  // Center the circle in the bounding box
  const cx = pos_x + width / 2;
  const cy = pos_y + height / 2;

  // Create circle path using arc commands
  const pathData = `M ${cx - radius} ${cy} ` +
    `A ${radius} ${radius} 0 1 1 ${cx + radius} ${cy} ` +
    `A ${radius} ${radius} 0 1 1 ${cx - radius} ${cy} Z`;

  return {
    pathData,
    fill: shape.background_color || defaults.background_color,
    stroke: shape.line_color || defaults.line_color,
    strokeWidth: parseLineWeight(shape.line_weight || defaults.line_weight),
    strokeDasharray: getStrokeDasharray(shape.line_style || defaults.line_style),
    textPosition: { x: cx, y: cy },
  };
}

/**
 * Render a CYLINDER (database shape)
 * Body rectangle with ellipse top and curved bottom
 * Ellipse height is ~20% of total height
 */
export function renderCylinder(shape: ShapeDecoration): ShapeRenderResult {
  const { pos_x, pos_y, width, height } = shape;
  const defaults = DECORATION_DEFAULTS.CYLINDER;

  // Calculate ellipse dimensions (top cap)
  const ellipseHeight = height * 0.15; // 15% of height for top ellipse
  const rx = width / 2;
  const ry = ellipseHeight / 2;
  const cx = pos_x + width / 2;
  const topEllipseY = pos_y + ry;
  const bottomEllipseY = pos_y + height - ry;

  // Create cylinder path:
  // 1. Top ellipse (full)
  // 2. Right side down
  // 3. Bottom arc (visible part only)
  // 4. Left side up
  const pathData =
    // Start at left of top ellipse
    `M ${pos_x} ${topEllipseY} ` +
    // Top ellipse arc (clockwise, top half)
    `A ${rx} ${ry} 0 1 1 ${pos_x + width} ${topEllipseY} ` +
    // Right side down to bottom ellipse
    `L ${pos_x + width} ${bottomEllipseY} ` +
    // Bottom ellipse arc (only visible bottom half)
    `A ${rx} ${ry} 0 0 1 ${pos_x} ${bottomEllipseY} ` +
    // Left side up
    `L ${pos_x} ${topEllipseY} Z`;

  // Add separate path for top ellipse interior line
  const topEllipsePath = `M ${pos_x} ${topEllipseY} ` +
    `A ${rx} ${ry} 0 0 0 ${pos_x + width} ${topEllipseY}`;

  return {
    pathData: pathData + ' ' + topEllipsePath,
    fill: shape.background_color || defaults.background_color,
    stroke: shape.line_color || defaults.line_color,
    strokeWidth: parseLineWeight(shape.line_weight || defaults.line_weight),
    strokeDasharray: getStrokeDasharray(shape.line_style || defaults.line_style),
    textPosition: { x: cx, y: pos_y + height / 2 + ellipseHeight / 4 },
  };
}

/**
 * Render a TRAPEZOID with top edge ~60% of bottom edge width
 * Top edge is centered horizontally
 */
export function renderTrapezoid(shape: ShapeDecoration): ShapeRenderResult {
  const { pos_x, pos_y, width, height } = shape;
  const defaults = DECORATION_DEFAULTS.TRAPEZOID;

  // Top edge is 60% of bottom edge width
  const topWidth = width * 0.6;
  const topInset = (width - topWidth) / 2;

  // Define vertices (clockwise from top-left)
  const topLeft = { x: pos_x + topInset, y: pos_y };
  const topRight = { x: pos_x + width - topInset, y: pos_y };
  const bottomRight = { x: pos_x + width, y: pos_y + height };
  const bottomLeft = { x: pos_x, y: pos_y + height };

  // Create trapezoid path
  const pathData = `M ${topLeft.x} ${topLeft.y} ` +
    `L ${topRight.x} ${topRight.y} ` +
    `L ${bottomRight.x} ${bottomRight.y} ` +
    `L ${bottomLeft.x} ${bottomLeft.y} Z`;

  return {
    pathData,
    fill: shape.background_color || defaults.background_color,
    stroke: shape.line_color || defaults.line_color,
    strokeWidth: parseLineWeight(shape.line_weight || defaults.line_weight),
    strokeDasharray: getStrokeDasharray(shape.line_style || defaults.line_style),
    textPosition: { x: pos_x + width / 2, y: pos_y + height / 2 },
  };
}

/**
 * Render a HEXAGON inscribed in bounding box
 * 6 vertices at regular intervals (flat-top orientation)
 */
export function renderHexagon(shape: ShapeDecoration): ShapeRenderResult {
  const { pos_x, pos_y, width, height } = shape;
  const defaults = DECORATION_DEFAULTS.HEXAGON;

  // Calculate center
  const cx = pos_x + width / 2;
  const cy = pos_y + height / 2;

  // For a flat-top hexagon:
  // - Horizontal edges at top and bottom
  // - Vertices at 0, 60, 120, 180, 240, 300 degrees
  // Scale to fit bounding box
  const rx = width / 2;
  const ry = height / 2;

  // Generate 6 vertices
  const vertices = [];
  for (let i = 0; i < 6; i++) {
    // Flat-top hexagon: start at 0 degrees (right side)
    const angle = (i * 60 - 30) * (Math.PI / 180); // -30 to start at top-right
    vertices.push({
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    });
  }

  // Create hexagon path
  const pathData = vertices
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${v.x} ${v.y}`)
    .join(' ') + ' Z';

  return {
    pathData,
    fill: shape.background_color || defaults.background_color,
    stroke: shape.line_color || defaults.line_color,
    strokeWidth: parseLineWeight(shape.line_weight || defaults.line_weight),
    strokeDasharray: getStrokeDasharray(shape.line_style || defaults.line_style),
    textPosition: { x: cx, y: cy },
  };
}

/**
 * Render a BOX (rectangle) - default/fallback shape
 */
export function renderBox(shape: ShapeDecoration): ShapeRenderResult {
  const { pos_x, pos_y, width, height } = shape;
  const defaults = DECORATION_DEFAULTS.BOX;

  // Simple rectangle path
  const pathData = `M ${pos_x} ${pos_y} ` +
    `L ${pos_x + width} ${pos_y} ` +
    `L ${pos_x + width} ${pos_y + height} ` +
    `L ${pos_x} ${pos_y + height} Z`;

  return {
    pathData,
    fill: shape.background_color || defaults.background_color,
    stroke: shape.line_color || defaults.line_color,
    strokeWidth: parseLineWeight(shape.line_weight || defaults.line_weight),
    strokeDasharray: getStrokeDasharray(shape.line_style || defaults.line_style),
    textPosition: { x: pos_x + width / 2, y: pos_y + height / 2 },
  };
}

/**
 * Render a NOTE (post-it note with folded top-left corner)
 * Rectangle body with a triangular fold at the top-left corner
 * Fold size: 15px
 */
export function renderNote(shape: ShapeDecoration): ShapeRenderResult {
  const { pos_x, pos_y, width, height } = shape;
  const defaults = DECORATION_DEFAULTS.NOTE;
  const fold = 15;

  // Path: start at fold point on left edge, diagonal to fold point on top edge,
  // then across top, down right side, across bottom, back up left side to start
  const pathData = `M ${pos_x} ${pos_y + fold} ` +
    `L ${pos_x + fold} ${pos_y} ` +
    `L ${pos_x + width} ${pos_y} ` +
    `L ${pos_x + width} ${pos_y + height} ` +
    `L ${pos_x} ${pos_y + height} Z`;

  // Fold triangle: small triangle at top-left showing the folded-over corner
  // Goes from the corner cut point on the left edge, across to the top edge cut point,
  // then down to form a small triangular flap
  const foldPath = `M ${pos_x} ${pos_y + fold} ` +
    `L ${pos_x + fold} ${pos_y + fold} ` +
    `L ${pos_x + fold} ${pos_y} Z`;

  return {
    pathData,
    fill: shape.background_color || defaults.background_color,
    stroke: shape.line_color || defaults.line_color,
    strokeWidth: parseLineWeight(shape.line_weight || defaults.line_weight),
    strokeDasharray: getStrokeDasharray(shape.line_style || defaults.line_style),
    // Text centered in full bounding box (same as BOX, ignoring fold)
    textPosition: { x: pos_x + width / 2, y: pos_y + height / 2 },
    foldPath,
    foldFill: '#E6D535', // Slightly darker shade of post-it yellow for fold shadow
  };
}

/**
 * Apply background and border opacity to a ShapeRenderResult.
 * Uses the decoration's background_opacity and border_opacity fields (0-100).
 * Missing/undefined opacity defaults to the shape's defaults (100 for most shapes).
 */
function applyShapeOpacity(result: ShapeRenderResult, shape: ShapeDecoration): ShapeRenderResult {
  const defaults = DECORATION_DEFAULTS[shape.type] || DECORATION_DEFAULTS.BOX;
  const bgOpacity = shape.background_opacity ?? defaults.background_opacity;
  const borderOpacity = shape.border_opacity ?? defaults.border_opacity;

  return {
    ...result,
    fill: applyOpacity(result.fill, bgOpacity),
    stroke: applyOpacity(result.stroke, borderOpacity),
  };
}

/**
 * Main dispatch function to render any shape type
 * Routes to appropriate rendering function based on shape.type
 */
export function renderShape(shape: ShapeDecoration): ShapeRenderResult {
  let result: ShapeRenderResult;
  switch (shape.type) {
    case 'OVAL':
      result = renderOval(shape);
      break;
    case 'DIAMOND':
      result = renderDiamond(shape);
      break;
    case 'PARALLELOGRAM':
      result = renderParallelogram(shape);
      break;
    case 'CIRCLE':
      result = renderCircle(shape);
      break;
    case 'CYLINDER':
      result = renderCylinder(shape);
      break;
    case 'TRAPEZOID':
      result = renderTrapezoid(shape);
      break;
    case 'HEXAGON':
      result = renderHexagon(shape);
      break;
    case 'NOTE':
      result = renderNote(shape);
      break;
    case 'TEXT':
    case 'BOX':
    default:
      result = renderBox(shape);
      break;
  }
  return applyShapeOpacity(result, shape);
}

/**
 * Interface for complete shape render output (including text)
 */
export interface ShapeDecorationRenderResult {
  shape: ShapeRenderResult;
  textElement?: {
    content: string;
    lines: string[];
    lineHeight: number;
    x: number;
    y: number;
    textAnchor: 'start' | 'middle' | 'end';
    fontSize: number;
    fontWeight: string;
    fontStyle: string;
    textDecoration: string;
    fill: string;
  };
  isSelected: boolean;
}

/**
 * Render a complete shape decoration with text
 */
export function renderShapeDecoration(
  shape: ShapeDecoration,
  isSelected: boolean
): ShapeDecorationRenderResult {
  const shapeResult = renderShape(shape);
  const defaults = DECORATION_DEFAULTS[shape.type] || DECORATION_DEFAULTS.BOX;

  // Build text element if text is provided
  let textElement: ShapeDecorationRenderResult['textElement'];
  if (shape.text && shape.text.trim() !== '') {
    const fontSize = shape.text_font_size || defaults.text_font_size;
    const lines = shape.text.split('\n');
    const lineHeight = fontSize * 1.3;
    const textBlockHeight = (lines.length - 1) * lineHeight;

    // Get text anchor from alignment
    let textAnchor: 'start' | 'middle' | 'end' = 'middle';
    if (shape.text_h_align === 'LEFT') textAnchor = 'start';
    if (shape.text_h_align === 'RIGHT') textAnchor = 'end';

    // Adjust Y position based on vertical alignment (multi-line aware)
    let textY = shapeResult.textPosition.y;
    if (shape.text_v_align === 'TOP') {
      textY = shape.pos_y + fontSize + 5;
    } else if (shape.text_v_align === 'BOTTOM') {
      textY = shape.pos_y + shape.height - 5 - textBlockHeight;
    } else {
      // Middle - center the text block vertically
      textY = shapeResult.textPosition.y + fontSize / 3 - textBlockHeight / 2;
    }

    // Adjust X position based on horizontal alignment
    let textX = shapeResult.textPosition.x;
    if (shape.text_h_align === 'LEFT') {
      textX = shape.pos_x + 5;
    } else if (shape.text_h_align === 'RIGHT') {
      textX = shape.pos_x + shape.width - 5;
    }

    textElement = {
      content: shape.text,
      lines,
      lineHeight,
      x: textX,
      y: textY,
      textAnchor,
      fontSize,
      fontWeight: shape.text_font_weight || defaults.text_font_weight,
      fontStyle: shape.text_font_style || defaults.text_font_style,
      textDecoration: shape.text_text_decoration || 'none',
      fill: shape.text_color || defaults.text_color,
    };
  }

  return {
    shape: shapeResult,
    textElement,
    isSelected,
  };
}
