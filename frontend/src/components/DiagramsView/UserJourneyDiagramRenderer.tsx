/**
 * UserJourneyDiagramRenderer.tsx
 *
 * Spec 2026-04-03: User Journey Temporary Diagram Selection and Review Flow
 * Task Group 3: SVG swim-lane renderer for UserJourneyDiagramDto data.
 *
 * Spec 2026-04-03: User Journey Native Diagram Type and Renderer
 * Task Group 2: Extended with computeContentBounds, onContentBounds callback,
 * and render_hints defaults for Canvas.tsx integration.
 *
 * Renders a UserJourneyDiagramDto as an SVG swim-lane diagram. Follows the same
 * SVG-in-canvas-container pattern as TemporaryDiagramRenderer (inline <svg> with
 * grid background <pattern>), but produces swim-lane layout with lanes, steps,
 * and edges instead of ER class-box layout.
 *
 * Step positions are computed deterministically from order and laneId since
 * the DTO does not include explicit pixel coordinates.
 */

import React, { useEffect, useMemo } from 'react';
import type {
  UserJourneyDiagramDto,
  UserJourneyDiagramLaneDto,
  UserJourneyDiagramStepDto,
  UserJourneyDiagramEdgeDto,
} from '../../types/userJourneyDiagram';

// ============================================================================
// Props Interface
// ============================================================================

/** Navigation link data for the journey header */
export interface JourneyNavLink {
  id: string;
  name: string;
}

export interface UserJourneyDiagramRendererProps {
  /** The user journey diagram data to render */
  diagram: UserJourneyDiagramDto;
  /** Current zoom level (used by parent SVG container) */
  zoom: number;
  /** Optional callback to report computed content dimensions to the parent for auto-sizing */
  onContentBounds?: (bounds: { width: number; height: number }) => void;
  /** Optional parent overview diagram link (shown in navigation box) */
  parentOverview?: JourneyNavLink | null;
  /** Optional linked sibling journey diagram links (shown in navigation box) */
  linkedJourneys?: JourneyNavLink[];
  /** Callback when parent overview link is clicked */
  onParentOverviewClick?: (diagramId: string) => void;
  /** Callback when a linked journey link is clicked */
  onLinkedJourneyClick?: (diagramId: string) => void;
  /** Map from user journey entity ID to saved diagram ID (for co-worker link navigation) */
  journeyDiagramMap?: Map<string, string>;
  /** Callback when a co-worker abbreviation link is clicked */
  onCoWorkerClick?: (diagramId: string) => void;
}

// ============================================================================
// Layout Constants
// ============================================================================

/** Padding at the top of the canvas */
const CANVAS_PADDING_TOP = 40;

/** Padding at the left of the canvas */
const CANVAS_PADDING_LEFT = 40;

/** Height of the lane header area (label band) */
const LANE_HEADER_HEIGHT = 40;

/** Width of each lane (for VERTICAL lane_axis) */
const LANE_WIDTH = 380;

/** Height of each lane (for HORIZONTAL lane_axis) */
const LANE_HEIGHT = 200;

/** Step node width */
const STEP_NODE_WIDTH = 320;

/** Step node minimum height (no issues) */
const STEP_NODE_HEIGHT = 60;

/** Padding inside step box for issue text */
const STEP_INNER_PADDING = 10;

/** Line height for issue text */
const ISSUE_LINE_HEIGHT = 16;

/** Approximate character width at issue font size (system-ui proportional font, ~6px avg) */
const ISSUE_CHAR_WIDTH = 6.0;

/** Width reserved for warning icon */
const ISSUE_ICON_WIDTH = 18;

/** Horizontal spacing between step nodes within a lane */
const STEP_SPACING_X = 50;

/** Vertical spacing between step nodes within a lane */
const STEP_SPACING_Y = 36;

/** Padding inside the lane for the first step */
const LANE_CONTENT_PADDING = 20;

/** Font size for the title text */
const TITLE_FONT_SIZE = 20;

/** Font size for lane header labels */
const LANE_HEADER_FONT_SIZE = 15;

/** Font size for step name (primary label) */
const STEP_NAME_FONT_SIZE = 14;

/** Font size for step secondary label (issues) */
const STEP_SECONDARY_FONT_SIZE = 13;

/** Warning icon color */
const WARNING_COLOR = '#E65100';

/** Corner radius for step nodes */
const STEP_BORDER_RADIUS = 6;

/** Alternating lane background colors */
const LANE_COLORS = ['#F5F7FA', '#EEF1F5'];

/** Lane header background color (purple, matching styled header block) */
const LANE_HEADER_BG = '#5B3E96';

/** Lane header text color (white, matching styled header block) */
const LANE_HEADER_TEXT_COLOR = '#FFFFFF';

/** Step node fill color */
const STEP_FILL = '#FFFFFF';

/** Step node border color */
const STEP_STROKE = '#90A4AE';

/** Edge stroke color (within-lane) */
const EDGE_COLOR = '#616161';

/** Edge stroke color (cross-lane) */
const CROSS_LANE_EDGE_COLOR = '#D84315';

/** Edge stroke width */
const EDGE_STROKE_WIDTH = 1.5;

/** Cross-lane edge dash array */
const CROSS_LANE_DASH = '6,3';

/** Padding margin added to content bounds for auto-sizing */
const CONTENT_BOUNDS_PADDING = 40;

/** Minimum fallback content dimensions for empty diagrams */
const MIN_CONTENT_WIDTH = 200;
const MIN_CONTENT_HEIGHT = 200;

// ============================================================================
// Styled Header Block Constants
// ============================================================================

/** Height of the styled header block (title + summary on colored background) */
const HEADER_BLOCK_HEIGHT = 72;

/** Height of the navigation box below the header block (2 lines: parent + linked) */
const NAV_BOX_HEIGHT = 52;

/** Gap between header block and navigation box */
const HEADER_NAV_GAP = 0;

/** Gap between navigation box and lane headers */
const NAV_LANE_GAP = 12;

/** Header block background color (purple) */
const HEADER_BG_COLOR = '#5B3E96';

/** Header block border color */
const HEADER_BORDER_COLOR = '#3D2A6A';

/** Font size for the summary sentence in the header block */
const SUMMARY_FONT_SIZE = 15;

/** Font size for navigation box text */
const NAV_FONT_SIZE = 13;

// ============================================================================
// Step Header Color Map (by User Interaction Level)
// ============================================================================

/** Minimum height of the colored step header cell (single line) */
const STEP_HEADER_HEIGHT_MIN = 28;

/** Vertical padding inside the header cell (top + bottom) */
const STEP_HEADER_PADDING = 8;

/** Line height for header label text */
const STEP_HEADER_LINE_HEIGHT = 18;

/** Approximate character width for header label (14px semi-bold system-ui) */
const STEP_LABEL_CHAR_WIDTH = 7.0;

/** Font size for step detail lines (frequency, co-workers) */
const STEP_DETAIL_FONT_SIZE = 12;

/** Height reserved for a dashed separator line between content items (4px margin-top + 1px border + 4px margin-bottom) */
const STEP_SEPARATOR_HEIGHT = 9;

/** Step header background by user interaction level */
const INTERACTION_LEVEL_COLORS: Record<string, string> = {
  SIGNIFICANT: '#FFCDD2',  // light red
  MODERATE: '#FFE0B2',     // light orange
  MINIMAL: '#C8E6C9',      // light green
  AUTOMATED: '#7CB342',    // darker green (readable with black text)
};

/** Default step header color when interaction level is unknown */
const DEFAULT_STEP_HEADER_COLOR = '#E0E0E0';

// ============================================================================
// Position Computation
// ============================================================================

interface StepPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LaneRect {
  lane: UserJourneyDiagramLaneDto;
  x: number;
  y: number;
  width: number;
  height: number;
  headerX: number;
  headerY: number;
  headerWidth: number;
  headerHeight: number;
}

/**
 * Estimate wrapped line count for a text string within a given pixel width.
 * Simulates word-boundary wrapping to match browser behavior with proportional fonts.
 */
function estimateLineCount(text: string, availableWidth: number, charWidth: number = ISSUE_CHAR_WIDTH): number {
  if (!text || text.trim().length === 0) return 0;
  const words = text.split(/\s+/);
  let lines = 1;
  let currentLineWidth = 0;

  for (const word of words) {
    const wordWidth = word.length * charWidth;
    const spaceWidth = currentLineWidth > 0 ? charWidth : 0;

    if (currentLineWidth > 0 && currentLineWidth + spaceWidth + wordWidth > availableWidth) {
      lines++;
      currentLineWidth = wordWidth;
    } else {
      currentLineWidth += spaceWidth + wordWidth;
    }
  }

  return lines;
}

/**
 * Compute the header height for a step based on its label text.
 * Returns the minimum header height for short labels, or taller for wrapping labels.
 */
function computeStepHeaderHeight(step: UserJourneyDiagramStepDto): number {
  const label = step.diagram_label || step.name;
  if (!label) return STEP_HEADER_HEIGHT_MIN;
  const availableWidth = STEP_NODE_WIDTH - 2 * STEP_INNER_PADDING;
  const lineCount = estimateLineCount(label, availableWidth, STEP_LABEL_CHAR_WIDTH);
  if (lineCount <= 1) return STEP_HEADER_HEIGHT_MIN;
  return Math.max(STEP_HEADER_HEIGHT_MIN, STEP_HEADER_PADDING + lineCount * STEP_HEADER_LINE_HEIGHT);
}

/**
 * Compute the height needed for a step box based on its content.
 * Layout: colored header cell + frequency line + co-workers line + warnings.
 */
function computeStepHeight(step: UserJourneyDiagramStepDto): number {
  const hasActivityIssues = step.activity_issues && step.activity_issues.trim().length > 0;
  const hasUiIssues = step.ui_issues && step.ui_issues.trim().length > 0;
  const hasFrequency = step.frequency && step.frequency.trim().length > 0;
  const hasCoWorkers = step.co_worker_abbreviations && step.co_worker_abbreviations.length > 0;

  // Colored header cell with label (dynamic height for wrapping labels)
  const headerHeight = computeStepHeaderHeight(step);
  let height = headerHeight;

  // Content area below header
  let contentHeight = 4; // top padding

  // Count content sections to determine separator count
  let sectionCount = 0;

  if (hasFrequency) {
    contentHeight += STEP_DETAIL_FONT_SIZE + 4;
    sectionCount++;
  }
  if (hasCoWorkers) {
    const coWorkerCount = step.co_worker_links?.length || step.co_worker_abbreviations?.length || 1;
    contentHeight += coWorkerCount * (STEP_DETAIL_FONT_SIZE + 4);
    sectionCount++;
  }

  // Available width for issue text (box width minus padding and icon)
  const textWidth = STEP_NODE_WIDTH - 2 * STEP_INNER_PADDING - ISSUE_ICON_WIDTH;

  // Issues (activity + ui) count as one section for separator purposes
  const hasAnyIssues = hasActivityIssues || hasUiIssues;
  if (hasActivityIssues) {
    const lines = estimateLineCount(step.activity_issues, textWidth);
    // Only add inter-issue margin (+4) when ui_issues follows
    contentHeight += lines * ISSUE_LINE_HEIGHT + (hasUiIssues ? 4 : 0);
  }
  if (hasUiIssues) {
    const lines = estimateLineCount(step.ui_issues, textWidth);
    contentHeight += lines * ISSUE_LINE_HEIGHT;
  }
  if (hasAnyIssues) {
    sectionCount++;
  }

  // Add separator height between sections (n-1 separators for n sections)
  if (sectionCount > 1) {
    contentHeight += (sectionCount - 1) * STEP_SEPARATOR_HEIGHT;
  }

  contentHeight += 10; // bottom padding (extra room for font descenders like g, y, p)

  return Math.max(STEP_NODE_HEIGHT, height + contentHeight);
}

/**
 * Compute deterministic positions for all lanes and steps.
 *
 * For VERTICAL lane_axis with LEFT_TO_RIGHT flow:
 *   - Lanes are horizontal rows (each lane is a horizontal band)
 *   - Steps flow left-to-right within their lane
 *
 * For HORIZONTAL lane_axis (or default):
 *   - Lanes are vertical columns
 *   - Steps flow top-to-bottom within their lane
 */
function computeLayout(
  lanes: UserJourneyDiagramLaneDto[],
  steps: UserJourneyDiagramStepDto[],
  laneAxis: string,
  showTitle: boolean,
  hasNavLinks: boolean = false,
) {
  const sortedLanes = [...lanes].sort((a, b) => a.order - b.order);
  const laneIndexMap = new Map<string, number>();
  sortedLanes.forEach((lane, i) => laneIndexMap.set(lane.id, i));

  // Group steps by laneId and sort by order
  const stepsByLane = new Map<string, UserJourneyDiagramStepDto[]>();
  for (const step of steps) {
    const existing = stepsByLane.get(step.lane_id) || [];
    existing.push(step);
    stepsByLane.set(step.lane_id, existing);
  }
  for (const [key, arr] of stepsByLane) {
    stepsByLane.set(key, arr.sort((a, b) => a.order - b.order));
  }

  // Compute vertical offsets for styled header block layout
  const headerBlockY = CANVAS_PADDING_TOP;
  const showHeader = showTitle;
  const headerHeight = showHeader ? HEADER_BLOCK_HEIGHT : 0;
  const navHeight = (showHeader && hasNavLinks) ? NAV_BOX_HEIGHT + HEADER_NAV_GAP : 0;
  const totalHeaderArea = headerHeight + navHeight + (showHeader ? NAV_LANE_GAP : 0);

  const baseY = CANVAS_PADDING_TOP + totalHeaderArea;
  const baseX = CANVAS_PADDING_LEFT;

  const stepPositions = new Map<string, StepPosition>();

  // Compute the max number of steps in any lane (for sizing)
  let maxStepsInLane = 0;
  for (const arr of stepsByLane.values()) {
    maxStepsInLane = Math.max(maxStepsInLane, arr.length);
  }

  const isVerticalLanes = laneAxis === 'VERTICAL';

  // Lane dimensions for rendering
  const laneRects: LaneRect[] = [];

  // Pre-compute per-step heights
  const stepHeightMap = new Map<string, number>();
  for (const step of steps) {
    stepHeightMap.set(step.id, computeStepHeight(step));
  }

  if (isVerticalLanes) {
    // VERTICAL lane_axis: lanes are vertical columns, steps flow top-to-bottom.
    // Steps sharing the same process_activity_id are aligned at the same Y (row-based layout).

    // Build global row order from process activities, preserving per-lane step order.
    // Each unique process_activity_id defines a row. Row order is determined by the
    // minimum step order across all lanes for that activity.
    const activityRowOrder = new Map<string, number>(); // process_activity_id → min order
    for (const step of steps) {
      const existing = activityRowOrder.get(step.process_activity_id);
      if (existing === undefined || step.order < existing) {
        activityRowOrder.set(step.process_activity_id, step.order);
      }
    }
    const sortedRows = [...activityRowOrder.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([paId]) => paId);

    // Compute row heights: max step height across all lanes for each process_activity row
    const rowHeights = new Map<string, number>();
    for (const paId of sortedRows) {
      let maxH = STEP_NODE_HEIGHT;
      for (const step of steps) {
        if (step.process_activity_id === paId) {
          maxH = Math.max(maxH, stepHeightMap.get(step.id) || STEP_NODE_HEIGHT);
        }
      }
      rowHeights.set(paId, maxH);
    }

    // Compute cumulative Y position for each row
    const rowYPositions = new Map<string, number>();
    let cumulativeRowY = baseY + LANE_HEADER_HEIGHT + LANE_CONTENT_PADDING;
    for (const paId of sortedRows) {
      rowYPositions.set(paId, cumulativeRowY);
      cumulativeRowY += (rowHeights.get(paId) || STEP_NODE_HEIGHT) + STEP_SPACING_Y;
    }

    const maxLaneContentHeight = cumulativeRowY - (baseY + LANE_HEADER_HEIGHT);

    sortedLanes.forEach((lane, laneIdx) => {
      const laneX = baseX + laneIdx * LANE_WIDTH;
      const laneY = baseY;
      const laneH = LANE_HEADER_HEIGHT + maxLaneContentHeight;

      laneRects.push({
        lane,
        x: laneX,
        y: laneY,
        width: LANE_WIDTH,
        height: laneH,
        headerX: laneX,
        headerY: laneY,
        headerWidth: LANE_WIDTH,
        headerHeight: LANE_HEADER_HEIGHT,
      });

      const laneSteps = stepsByLane.get(lane.id) || [];
      laneSteps.forEach((step) => {
        const stepH = stepHeightMap.get(step.id) || STEP_NODE_HEIGHT;
        const sx = laneX + (LANE_WIDTH - STEP_NODE_WIDTH) / 2;
        const rowY = rowYPositions.get(step.process_activity_id) || cumulativeRowY;
        stepPositions.set(step.id, {
          x: sx,
          y: rowY,
          width: STEP_NODE_WIDTH,
          height: stepH,
        });
      });
    });
  } else {
    // HORIZONTAL lane_axis (or default): lanes are horizontal rows, steps flow left-to-right
    const laneContentWidth = Math.max(1, maxStepsInLane) * (STEP_NODE_WIDTH + STEP_SPACING_X) + LANE_CONTENT_PADDING;

    // Compute per-lane height based on tallest step in that lane
    let cumulativeLaneY = baseY;
    sortedLanes.forEach((lane) => {
      const laneX = baseX;
      const laneSteps = stepsByLane.get(lane.id) || [];
      let maxStepH = STEP_NODE_HEIGHT;
      for (const step of laneSteps) {
        maxStepH = Math.max(maxStepH, stepHeightMap.get(step.id) || STEP_NODE_HEIGHT);
      }
      const laneH = Math.max(LANE_HEIGHT, maxStepH + 2 * LANE_CONTENT_PADDING);
      const laneW = LANE_HEADER_HEIGHT + laneContentWidth; // header on left, content on right

      laneRects.push({
        lane,
        x: laneX,
        y: cumulativeLaneY,
        width: laneW,
        height: laneH,
        headerX: laneX,
        headerY: cumulativeLaneY,
        headerWidth: LANE_HEADER_HEIGHT,
        headerHeight: laneH,
      });

      laneSteps.forEach((step, stepIdx) => {
        const stepH = stepHeightMap.get(step.id) || STEP_NODE_HEIGHT;
        const sx = laneX + LANE_HEADER_HEIGHT + LANE_CONTENT_PADDING + stepIdx * (STEP_NODE_WIDTH + STEP_SPACING_X);
        const sy = cumulativeLaneY + (laneH - stepH) / 2;
        stepPositions.set(step.id, {
          x: sx,
          y: sy,
          width: STEP_NODE_WIDTH,
          height: stepH,
        });
      });

      cumulativeLaneY += laneH;
    });
  }

  // Handle orphan steps (referencing non-existent laneId) -- place in a fallback position
  for (const step of steps) {
    if (!stepPositions.has(step.id)) {
      const fallbackIdx = stepPositions.size;
      stepPositions.set(step.id, {
        x: baseX + 20,
        y: baseY + 200 + fallbackIdx * (STEP_NODE_HEIGHT + STEP_SPACING_Y),
        width: STEP_NODE_WIDTH,
        height: STEP_NODE_HEIGHT,
      });
    }
  }

  // Compute header block width as 3× single lane width
  const singleLaneWidth = laneRects.length > 0 ? laneRects[0].width : 500;
  let totalLanesWidth = 0;
  for (const lr of laneRects) {
    totalLanesWidth = Math.max(totalLanesWidth, lr.x + lr.width - baseX);
  }
  const headerBlockWidth = Math.max(singleLaneWidth * 3, totalLanesWidth, 500);
  const navBoxY = headerBlockY + HEADER_BLOCK_HEIGHT + HEADER_NAV_GAP;

  return { sortedLanes, laneRects, stepPositions, baseY, baseX, headerBlockY, headerBlockWidth, navBoxY, navBoxWidth: headerBlockWidth };
}

// ============================================================================
// Content Bounds Computation
// ============================================================================

/**
 * Compute the total content bounds from layout results.
 *
 * Finds the maximum extent (x + width, y + height) across all lane rects
 * and step positions, then adds a padding margin.
 *
 * Returns a minimum fallback size for empty diagrams (0 lanes, 0 steps).
 */
export function computeContentBounds(
  laneRects: LaneRect[],
  stepPositions: Map<string, StepPosition>,
  padding: number = CONTENT_BOUNDS_PADDING,
  headerBlockWidth: number = 0
): { width: number; height: number } {
  let maxX = 0;
  let maxY = 0;

  // Include the header area width (header block + nav box)
  if (headerBlockWidth > 0) {
    maxX = Math.max(maxX, CANVAS_PADDING_LEFT + headerBlockWidth);
  }

  for (const lr of laneRects) {
    maxX = Math.max(maxX, lr.x + lr.width);
    maxY = Math.max(maxY, lr.y + lr.height);
  }

  for (const pos of stepPositions.values()) {
    maxX = Math.max(maxX, pos.x + pos.width);
    maxY = Math.max(maxY, pos.y + pos.height);
  }

  // If nothing was computed (empty diagram), return minimum fallback
  if (maxX === 0 && maxY === 0) {
    return { width: MIN_CONTENT_WIDTH, height: MIN_CONTENT_HEIGHT };
  }

  return {
    width: maxX + padding,
    height: maxY + padding,
  };
}

// ============================================================================
// Sub-renderers
// ============================================================================

/**
 * Render the styled header block with title and summary on a colored background.
 */
function renderHeaderBlock(
  title: string,
  summaryText: string,
  x: number,
  y: number,
  width: number,
): React.ReactElement {
  return (
    <g key="journey-header-block" data-testid="journey-header-block">
      <rect
        x={x}
        y={y}
        width={width}
        height={HEADER_BLOCK_HEIGHT}
        fill={HEADER_BG_COLOR}
        stroke="none"
        rx={0}
      />
      <foreignObject x={x} y={y} width={width} height={HEADER_BLOCK_HEIGHT}>
        <div
          // @ts-ignore xmlns required for foreignObject
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            padding: '10px 16px',
            color: '#FFFFFF',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            boxSizing: 'border-box' as const,
            height: '100%',
            display: 'flex',
            flexDirection: 'column' as const,
            justifyContent: 'center',
          }}
        >
          <div style={{ fontSize: `${TITLE_FONT_SIZE}px`, fontWeight: 600, lineHeight: 1.3, color: '#FFFFFF' }}>
            {title}
          </div>
          {summaryText && (
            <div style={{ fontSize: `${SUMMARY_FONT_SIZE}px`, marginTop: '4px', lineHeight: 1.3, opacity: 0.95, color: '#FFFFFF' }}>
              {summaryText}
            </div>
          )}
        </div>
      </foreignObject>
    </g>
  );
}

/**
 * Render the navigation box below the header block with parent overview and linked journey links.
 */
function renderNavBox(
  parentOverview: JourneyNavLink | null | undefined,
  linkedJourneys: JourneyNavLink[] | undefined,
  x: number,
  y: number,
  width: number,
  onParentOverviewClick?: (diagramId: string) => void,
  onLinkedJourneyClick?: (diagramId: string) => void,
): React.ReactElement {
  const links = linkedJourneys ?? [];

  return (
    <g key="journey-nav-box" data-testid="journey-nav-box">
      <rect
        x={x}
        y={y}
        width={width}
        height={NAV_BOX_HEIGHT}
        fill="#FFFFFF"
        stroke="none"
        rx={0}
      />
      <foreignObject x={x} y={y} width={width} height={NAV_BOX_HEIGHT}>
        <div
          // @ts-ignore xmlns required for foreignObject
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            padding: '6px 16px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: `${NAV_FONT_SIZE}px`,
            lineHeight: 1.5,
            color: '#333',
          }}
        >
          {/* Parent Overview link (line 1) */}
          <div>
            <strong>Parent Overview: </strong>
            {parentOverview ? (
              <a
                href="#"
                data-diagram-id={parentOverview.id}
                style={{ color: '#1976D2', textDecoration: 'underline', cursor: 'pointer' }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onParentOverviewClick?.(parentOverview.id);
                }}
              >
                {parentOverview.name}
              </a>
            ) : (
              <span style={{ color: '#888', fontStyle: 'italic' }}>None</span>
            )}
          </div>
          {/* Linked Journeys (line 2) */}
          <div>
            <strong>Linked Journeys: </strong>
            {links.length > 0 ? (
              links.map((link, idx) => (
                <span key={link.id}>
                  <a
                    href="#"
                    data-diagram-id={link.id}
                    style={{ color: '#1976D2', textDecoration: 'underline', cursor: 'pointer' }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onLinkedJourneyClick?.(link.id);
                    }}
                  >
                    {link.name}
                  </a>
                  {idx < links.length - 1 ? ', ' : ''}
                </span>
              ))
            ) : (
              <span style={{ color: '#888', fontStyle: 'italic' }}>None</span>
            )}
          </div>
        </div>
      </foreignObject>
    </g>
  );
}

function renderLane(
  laneRect: LaneRect,
  laneIdx: number,
  isVertical: boolean
): React.ReactElement {
  const bgColor = LANE_COLORS[laneIdx % LANE_COLORS.length];

  return (
    <g key={`lane-${laneRect.lane.id}`} data-testid={`journey-lane-${laneRect.lane.id}`}>
      {/* Lane background band */}
      <rect
        x={laneRect.x}
        y={laneRect.y}
        width={laneRect.width}
        height={laneRect.height}
        fill={bgColor}
        stroke="#D0D5DD"
        strokeWidth={0.5}
      />
      {/* Lane header (purple bg, white text - matching styled header block) */}
      <rect
        x={laneRect.headerX}
        y={laneRect.headerY}
        width={laneRect.headerWidth}
        height={laneRect.headerHeight}
        fill={LANE_HEADER_BG}
        stroke={HEADER_BORDER_COLOR}
        strokeWidth={0.5}
      />
      {/* Lane name label */}
      {isVertical ? (
        <text
          x={laneRect.headerX + laneRect.headerWidth / 2}
          y={laneRect.headerY + laneRect.headerHeight / 2 + LANE_HEADER_FONT_SIZE / 3}
          textAnchor="middle"
          fontSize={LANE_HEADER_FONT_SIZE}
          fontWeight={600}
          fill={LANE_HEADER_TEXT_COLOR}
        >
          {laneRect.lane.name}
        </text>
      ) : (
        <text
          x={laneRect.headerX + laneRect.headerWidth / 2}
          y={laneRect.headerY + laneRect.headerHeight / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={LANE_HEADER_FONT_SIZE}
          fontWeight={600}
          fill={LANE_HEADER_TEXT_COLOR}
          transform={`rotate(-90, ${laneRect.headerX + laneRect.headerWidth / 2}, ${laneRect.headerY + laneRect.headerHeight / 2})`}
        >
          {laneRect.lane.name}
        </text>
      )}
    </g>
  );
}

function renderStep(
  step: UserJourneyDiagramStepDto,
  pos: StepPosition,
  journeyDiagramMap?: Map<string, string>,
  onCoWorkerClick?: (diagramId: string) => void,
): React.ReactElement {
  const label = step.diagram_label || step.name;
  const hasActivityIssues = step.activity_issues && step.activity_issues.trim().length > 0;
  const hasUiIssues = step.ui_issues && step.ui_issues.trim().length > 0;
  const hasFrequency = step.frequency && step.frequency.trim().length > 0;
  const hasCoWorkers = step.co_worker_abbreviations && step.co_worker_abbreviations.length > 0;

  // Determine header color from user interaction level
  const headerColor = step.user_interaction_level
    ? (INTERACTION_LEVEL_COLORS[step.user_interaction_level] || DEFAULT_STEP_HEADER_COLOR)
    : DEFAULT_STEP_HEADER_COLOR;

  // Dynamic header height for wrapping labels
  const headerHeight = computeStepHeaderHeight(step);

  // Content area starts below the colored header cell
  const contentTopY = pos.y + headerHeight;
  const contentWidth = pos.width - 2 * STEP_INNER_PADDING;
  const contentHeight = pos.height - headerHeight;

  return (
    <g key={`step-${step.id}`} data-testid={`journey-step-${step.id}`}>
      {/* Outer box */}
      <rect
        x={pos.x}
        y={pos.y}
        width={pos.width}
        height={pos.height}
        fill={STEP_FILL}
        stroke={STEP_STROKE}
        strokeWidth={1}
        rx={STEP_BORDER_RADIUS}
      />
      {/* Colored header cell with label */}
      <rect
        x={pos.x}
        y={pos.y}
        width={pos.width}
        height={headerHeight}
        fill={headerColor}
        stroke={STEP_STROKE}
        strokeWidth={1}
        rx={STEP_BORDER_RADIUS}
      />
      {/* Square off bottom corners of header (overlap with body) */}
      <rect
        x={pos.x}
        y={pos.y + headerHeight - STEP_BORDER_RADIUS}
        width={pos.width}
        height={STEP_BORDER_RADIUS}
        fill={headerColor}
        stroke="none"
      />
      {/* Re-draw left+right border for the overlap zone */}
      <line x1={pos.x} y1={pos.y + headerHeight - STEP_BORDER_RADIUS} x2={pos.x} y2={pos.y + headerHeight} stroke={STEP_STROKE} strokeWidth={1} />
      <line x1={pos.x + pos.width} y1={pos.y + headerHeight - STEP_BORDER_RADIUS} x2={pos.x + pos.width} y2={pos.y + headerHeight} stroke={STEP_STROKE} strokeWidth={1} />
      {/* Header divider line */}
      <line
        x1={pos.x}
        y1={pos.y + headerHeight}
        x2={pos.x + pos.width}
        y2={pos.y + headerHeight}
        stroke={STEP_STROKE}
        strokeWidth={1}
      />
      {/* Label text in header cell (foreignObject for word wrapping) */}
      <foreignObject
        x={pos.x}
        y={pos.y}
        width={pos.width}
        height={headerHeight}
      >
        <div
          // @ts-ignore xmlns required for foreignObject
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center' as const,
            padding: `0 ${STEP_INNER_PADDING}px`,
            boxSizing: 'border-box' as const,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: `${STEP_NAME_FONT_SIZE}px`,
            fontWeight: 600,
            color: '#333',
            lineHeight: `${STEP_HEADER_LINE_HEIGHT}px`,
            overflow: 'hidden',
          }}
        >
          {label}
        </div>
      </foreignObject>
      {/* Content area below header: frequency, co-workers, warnings */}
      <foreignObject
        x={pos.x + STEP_INNER_PADDING}
        y={contentTopY + 4}
        width={contentWidth}
        height={contentHeight - 4}
      >
        <div
          // @ts-ignore xmlns required for foreignObject
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            fontFamily: 'system-ui, -apple-system, sans-serif',
            overflow: 'hidden',
          }}
        >
          {(() => {
            const dashedSep = (key: string) => (
              <hr key={key} style={{ border: 'none', borderTop: '1px dashed #C0C0C0', margin: '4px 0' }} />
            );
            const sections: React.ReactNode[] = [];
            // Section 1: Frequency
            if (hasFrequency) {
              sections.push(
                <div key="freq" style={{ fontSize: `${STEP_DETAIL_FONT_SIZE}px`, color: '#333', fontWeight: 600, marginBottom: '2px' }}>
                  Frequency: {step.frequency!.charAt(0) + step.frequency!.slice(1).toLowerCase().replace(/_/g, ' ')}
                </div>
              );
            }
            // Section 2: Co-workers (each as a full-sentence link to their journey diagram)
            if (hasCoWorkers) {
              if (sections.length > 0) sections.push(dashedSep('sep-coworkers'));
              const cwLinks = step.co_worker_links;
              if (cwLinks && cwLinks.length > 0) {
                cwLinks.forEach((link) => {
                  const diagramId = journeyDiagramMap?.get(link.user_journey_id);
                  const sentence = `Works on activity with ${link.abbreviation}`;
                  sections.push(
                    <div key={`coworker-${link.user_journey_id}`} style={{ fontSize: `${STEP_DETAIL_FONT_SIZE}px`, marginBottom: '2px' }}>
                      {diagramId ? (
                        <a
                          href="#"
                          data-diagram-id={diagramId}
                          style={{ color: '#1976D2', textDecoration: 'underline', cursor: onCoWorkerClick ? 'pointer' : 'default' }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onCoWorkerClick?.(diagramId);
                          }}
                        >
                          {sentence}
                        </a>
                      ) : (
                        <span style={{ color: '#333' }}>{sentence}</span>
                      )}
                    </div>
                  );
                });
              } else {
                sections.push(
                  <div key="coworkers" style={{ fontSize: `${STEP_DETAIL_FONT_SIZE}px`, color: '#333', marginBottom: '2px' }}>
                    Works on activity with {step.co_worker_abbreviations!.join(', ')}
                  </div>
                );
              }
            }
            // Section 3: Issues (activity + ui grouped together)
            if (hasActivityIssues || hasUiIssues) {
              if (sections.length > 0) sections.push(dashedSep('sep-issues'));
              if (hasActivityIssues) {
                sections.push(
                  <div key="activity-issues" style={{ display: 'flex', gap: '4px', fontSize: `${STEP_SECONDARY_FONT_SIZE}px`, color: WARNING_COLOR, lineHeight: `${ISSUE_LINE_HEIGHT}px`, marginBottom: hasUiIssues ? '4px' : '0' }}>
                    <span style={{ flexShrink: 0 }}>⚠</span>
                    <span style={{ wordWrap: 'break-word', overflowWrap: 'break-word' }}>{step.activity_issues}</span>
                  </div>
                );
              }
              if (hasUiIssues) {
                sections.push(
                  <div key="ui-issues" style={{ display: 'flex', gap: '4px', fontSize: `${STEP_SECONDARY_FONT_SIZE}px`, color: WARNING_COLOR, lineHeight: `${ISSUE_LINE_HEIGHT}px` }}>
                    <span style={{ flexShrink: 0 }}>⚠</span>
                    <span style={{ wordWrap: 'break-word', overflowWrap: 'break-word' }}>{step.ui_issues}</span>
                  </div>
                );
              }
            }
            return sections;
          })()}
        </div>
      </foreignObject>
    </g>
  );
}

function renderEdge(
  edge: UserJourneyDiagramEdgeDto,
  stepPositions: Map<string, StepPosition>
): React.ReactElement | null {
  const fromPos = stepPositions.get(edge.from_step_id);
  const toPos = stepPositions.get(edge.to_step_id);

  if (!fromPos || !toPos) return null;

  // Compute edge endpoints (center of right side -> center of left side for L-to-R flow)
  const fromCx = fromPos.x + fromPos.width / 2;
  const fromCy = fromPos.y + fromPos.height / 2;
  const toCx = toPos.x + toPos.width / 2;
  const toCy = toPos.y + toPos.height / 2;

  // Determine connection points on node borders
  const dx = toCx - fromCx;
  const dy = toCy - fromCy;

  let x1: number, y1: number, x2: number, y2: number;

  if (Math.abs(dx) >= Math.abs(dy)) {
    // Horizontal connection
    if (dx >= 0) {
      x1 = fromPos.x + fromPos.width;
      y1 = fromCy;
      x2 = toPos.x;
      y2 = toCy;
    } else {
      x1 = fromPos.x;
      y1 = fromCy;
      x2 = toPos.x + toPos.width;
      y2 = toCy;
    }
  } else {
    // Vertical connection
    if (dy >= 0) {
      x1 = fromCx;
      y1 = fromPos.y + fromPos.height;
      x2 = toCx;
      y2 = toPos.y;
    } else {
      x1 = fromCx;
      y1 = fromPos.y;
      x2 = toCx;
      y2 = toPos.y + toPos.height;
    }
  }

  const isCrossLane = edge.is_cross_lane;
  const strokeColor = isCrossLane ? CROSS_LANE_EDGE_COLOR : EDGE_COLOR;
  const dashArray = isCrossLane ? CROSS_LANE_DASH : undefined;
  const markerId = isCrossLane ? 'arrow-cross-lane' : 'arrow-normal';

  return (
    <line
      key={`edge-${edge.id}`}
      data-testid={`journey-edge-${edge.id}`}
      data-cross-lane={isCrossLane ? 'true' : 'false'}
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={strokeColor}
      strokeWidth={EDGE_STROKE_WIDTH}
      strokeDasharray={dashArray}
      markerEnd={`url(#${markerId})`}
    />
  );
}

// ============================================================================
// Main Component
// ============================================================================

const UserJourneyDiagramRenderer: React.FC<UserJourneyDiagramRendererProps> = ({
  diagram,
  onContentBounds,
  parentOverview,
  linkedJourneys,
  onParentOverviewClick,
  onLinkedJourneyClick,
  journeyDiagramMap,
  onCoWorkerClick,
}) => {
  const { journey, lanes, steps, edges, render_hints } = diagram;

  // Apply default render_hints values for missing or malformed fields
  const showTitle = render_hints?.show_title ?? true;
  const laneAxis = render_hints?.lane_axis || 'HORIZONTAL';

  const isEmpty = lanes.length === 0 && steps.length === 0;

  // Always show the navigation box (Parent Overview + Linked Journeys) below the header
  const hasNavLinks = true;

  // Build summary sentence: "{User} is involved in [x] activity steps involving [y] applications"
  const summaryText = useMemo(() => {
    if (!journey) return '';
    const stepCount = steps.length;
    const uniqueAppCount = new Set(steps.map(s => s.lane_id)).size;
    return `${journey.user_role_name} is involved in ${stepCount} activity step${stepCount !== 1 ? 's' : ''} involving ${uniqueAppCount} application${uniqueAppCount !== 1 ? 's' : ''}`;
  }, [journey, steps]);

  // Compute layout (returns empty results for empty diagrams, used for bounds)
  const layoutResult = useMemo(() => {
    if (isEmpty) {
      return null;
    }
    return computeLayout(lanes, steps, laneAxis, showTitle, hasNavLinks);
  }, [isEmpty, lanes, steps, laneAxis, showTitle, hasNavLinks]);

  // Compute content bounds
  const bounds = useMemo(() => {
    if (!layoutResult) {
      return { width: MIN_CONTENT_WIDTH, height: MIN_CONTENT_HEIGHT };
    }
    return computeContentBounds(layoutResult.laneRects, layoutResult.stepPositions, CONTENT_BOUNDS_PADDING, layoutResult.headerBlockWidth);
  }, [layoutResult]);

  // Report content bounds to parent via callback (when provided).
  // Use width/height as deps (not the bounds object) to avoid infinite re-render loops
  // when the parent is not memoizing the diagram prop (e.g., enrichJourneySteps inline).
  useEffect(() => {
    if (onContentBounds) {
      onContentBounds(bounds);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds.width, bounds.height]);

  // Handle empty lanes/steps gracefully
  if (isEmpty) {
    return (
      <g data-testid="journey-diagram-renderer">
        <text x={60} y={80} fontSize={14} fill="#666666">
          This journey has no lanes or steps to display.
        </text>
      </g>
    );
  }

  const { laneRects, stepPositions, headerBlockY, headerBlockWidth, navBoxY, navBoxWidth } = layoutResult!;
  const isVertical = laneAxis === 'VERTICAL';

  // Sort edges by order
  const sortedEdges = [...edges].sort((a, b) => a.order - b.order);

  return (
    <g data-testid="journey-diagram-renderer">
      {/* Arrowhead marker definitions */}
      <defs>
        <marker
          id="arrow-normal"
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={EDGE_COLOR} />
        </marker>
        <marker
          id="arrow-cross-lane"
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={CROSS_LANE_EDGE_COLOR} />
        </marker>
      </defs>

      {/* Dark purple border around the entire header area (header block + nav box) */}
      {showTitle && (
        <rect
          x={CANVAS_PADDING_LEFT}
          y={headerBlockY}
          width={headerBlockWidth}
          height={HEADER_BLOCK_HEIGHT + NAV_BOX_HEIGHT}
          fill="none"
          stroke={HEADER_BORDER_COLOR}
          strokeWidth={2}
          rx={0}
        />
      )}

      {/* Styled header block (title + summary on colored background) */}
      {showTitle && renderHeaderBlock(
        journey.name,
        summaryText,
        CANVAS_PADDING_LEFT,
        headerBlockY,
        headerBlockWidth,
      )}

      {/* Navigation box with parent overview and linked journey links — always shown */}
      {showTitle && renderNavBox(
        parentOverview,
        linkedJourneys,
        CANVAS_PADDING_LEFT,
        navBoxY,
        navBoxWidth,
        onParentOverviewClick,
        onLinkedJourneyClick,
      )}

      {/* Lanes */}
      {laneRects.map((lr, idx) => renderLane(lr, idx, isVertical))}

      {/* Edges (rendered below steps for visual layering) */}
      {sortedEdges.map((edge) => renderEdge(edge, stepPositions))}

      {/* Steps */}
      {steps.map((step) => {
        const pos = stepPositions.get(step.id);
        if (!pos) return null;
        return renderStep(step, pos, journeyDiagramMap, onCoWorkerClick);
      })}
    </g>
  );
};

export default UserJourneyDiagramRenderer;
