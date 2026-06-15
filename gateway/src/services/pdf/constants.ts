/**
 * PDF Generation Constants
 *
 * Layout constants ported from the frontend UserJourneyDiagramRenderer and
 * UserJourneyOverviewDiagramRenderer. Values match the frontend for visual
 * consistency. Where the frontend uses SVG pixels, we use the same numeric
 * values as "virtual units" and scale them to fit the PDF page.
 */

// ============================================================================
// PDF Page Constants (points, 72pt = 1 inch)
// ============================================================================

export const A4_W = 595.28;
export const A4_H = 841.89;
export const PAGE_MARGIN = 40;

// ============================================================================
// Shared Colors
// ============================================================================

export const HEADER_BG_COLOR = '#5B3E96';
export const HEADER_BORDER_COLOR = '#3D2A6A';
export const LANE_HEADER_BG = '#5B3E96';
export const LANE_HEADER_TEXT_COLOR = '#FFFFFF';
export const LANE_COLORS = ['#F5F7FA', '#EEF1F5'];
export const STEP_FILL = '#FFFFFF';
export const STEP_STROKE = '#90A4AE';
export const EDGE_COLOR = '#616161';
export const CROSS_LANE_EDGE_COLOR = '#D84315';
export const LINK_TEXT_COLOR = '#1976D2';
export const TOC_LINK_COLOR = '#1565C0';
export const WARNING_COLOR = '#E65100';

export const INTERACTION_LEVEL_COLORS: Record<string, string> = {
  SIGNIFICANT: '#FFCDD2',
  MODERATE: '#FFE0B2',
  MINIMAL: '#C8E6C9',
  AUTOMATED: '#7CB342',
  DEFAULT: '#E0E0E0',
};

// ============================================================================
// USER_JOURNEY Diagram Constants (from UserJourneyDiagramRenderer.tsx)
// ============================================================================

export const J_CANVAS_PADDING_TOP = 40;
export const J_CANVAS_PADDING_LEFT = 40;
export const J_LANE_HEADER_HEIGHT = 40;
export const J_LANE_WIDTH = 380;
export const J_LANE_HEIGHT = 200;
export const J_LANE_CONTENT_PADDING = 20;
export const J_STEP_NODE_WIDTH = 320;
export const J_STEP_NODE_HEIGHT = 60;
export const J_STEP_INNER_PADDING = 10;
export const J_STEP_SPACING_X = 50;
export const J_STEP_SPACING_Y = 36;
export const J_STEP_BORDER_RADIUS = 6;
export const J_TITLE_FONT_SIZE = 20;
export const J_LANE_HEADER_FONT_SIZE = 15;
export const J_STEP_NAME_FONT_SIZE = 14;
export const J_STEP_SECONDARY_FONT_SIZE = 13;
export const J_STEP_DETAIL_FONT_SIZE = 12;
export const J_STEP_HEADER_HEIGHT_MIN = 28;
export const J_STEP_HEADER_PADDING = 8;
export const J_STEP_HEADER_LINE_HEIGHT = 18;
export const J_STEP_SEPARATOR_HEIGHT = 9;
export const J_ISSUE_LINE_HEIGHT = 16;
export const J_ISSUE_ICON_WIDTH = 18;
export const J_SUMMARY_FONT_SIZE = 15;
export const J_NAV_FONT_SIZE = 13;
export const J_HEADER_BLOCK_HEIGHT = 72;
export const J_NAV_BOX_HEIGHT = 52;
export const J_HEADER_NAV_GAP = 0;
export const J_NAV_LANE_GAP = 12;
export const J_EDGE_STROKE_WIDTH = 1.5;
export const J_CROSS_LANE_DASH = [6, 3];
export const J_CONTENT_BOUNDS_PADDING = 40;

// ============================================================================
// USER_JOURNEY_OVERVIEW Diagram Constants (from UserJourneyOverviewDiagramRenderer.tsx)
// ============================================================================

export const O_CANVAS_PADDING_TOP = 40;
export const O_CANVAS_PADDING_LEFT = 40;
export const O_LANE_HEADER_HEIGHT = 36;
export const O_MIN_LANE_WIDTH = 360;
export const O_NODE_WIDTH = 320;
export const O_NODE_SPACING_Y = 24;
export const O_LANE_CONTENT_PADDING = 20;
export const O_TITLE_FONT_SIZE = 20;
export const O_LANE_HEADER_FONT_SIZE = 15;
export const O_NODE_NAME_FONT_SIZE = 14;
export const O_NODE_DESC_FONT_SIZE = 11;
export const O_BADGE_FONT_SIZE = 10;
export const O_EDGE_LABEL_FONT_SIZE = 10;
export const O_SUMMARY_FONT_SIZE = 15;
export const O_COLLEAGUES_FONT_SIZE = 13;
export const O_NODE_BORDER_RADIUS = 6;
export const O_HEADER_BLOCK_HEIGHT = 72;
export const O_NAV_BOX_HEIGHT = 36;
export const O_HEADER_NAV_GAP = 0;
export const O_NAV_LANE_GAP = 12;
export const O_EDGE_STROKE_WIDTH = 1.5;
export const O_CONTENT_BOUNDS_PADDING = 40;
export const O_APPS_PER_ROW = 4;
export const O_APP_BOX_WIDTH = 60;
export const O_APP_BOX_HEIGHT = 40;
export const O_APP_BOX_GAP_X = 8;
export const O_APP_BOX_GAP_Y = 8;
export const O_MAX_DESC_CHARS = 50;
export const O_BADGE_BG = '#E8EDF2';
export const O_BADGE_TEXT_COLOR = '#546E7A';
