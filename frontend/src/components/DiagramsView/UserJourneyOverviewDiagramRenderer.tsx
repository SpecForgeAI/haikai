/**
 * UserJourneyOverviewDiagramRenderer.tsx
 *
 * Spec 2026-04-07: User Journey Overview Parent Diagram Generation
 * Task Group 6: Native SVG renderer for UserJourneyOverviewDiagramDto data.
 *
 * Renders a UserJourneyOverviewDiagramDto as an SVG swim-lane diagram. Follows
 * the same SVG structure pattern as UserJourneyDiagramRenderer (inline <svg>
 * group with lanes, nodes, edges, defs for arrowhead markers).
 *
 * Layout: Horizontal swimlane bands stacked vertically (one per Business Process
 * lane), with journey nodes flowing left-to-right within each lane, sorted
 * topologically by link direction (sources before targets), with alphabetical
 * tie-breaking. Lane headers are rendered on the left side using rotated text.
 *
 * Positions are computed deterministically from the DTO (computeLayout function)
 * with no manual positioning.
 *
 * Spec 2026-04-07: User Journey Overview Parent-Child Diagram Linking
 * Task Group 4: Added onNodeClick callback prop, click handlers, and visual cues
 * (blue text, underline, pointer cursor) for linked nodes.
 *
 * Spec 2026-04-10: User Journey Overview Diagram Enhancements
 * Task Group 4: Added summary sentence, related colleagues navigation line,
 * and onColleagueClick callback for colleague overview navigation.
 */

import React, { useEffect, useMemo } from 'react';
import type {
  UserJourneyOverviewDiagramDto,
  UserJourneyOverviewLaneDto,
  UserJourneyOverviewNodeDto,
  UserJourneyOverviewEdgeDto,
  RelatedColleagueDto,
  OverviewSummaryCountsDto,
} from '../../types/userJourneyOverviewDiagram';

// ============================================================================
// Props Interface
// ============================================================================

export interface UserJourneyOverviewDiagramRendererProps {
  /** The overview diagram data to render */
  overviewData: UserJourneyOverviewDiagramDto;
  /** Optional callback to report computed content dimensions to the parent for auto-sizing */
  onContentBounds?: (bounds: { width: number; height: number }) => void;
  /**
   * Optional callback invoked when a journey node is clicked.
   * Receives the full node DTO so the parent can inspect link status and navigate accordingly.
   *
   * Spec 2026-04-07: User Journey Overview Parent-Child Diagram Linking
   * Task Group 4, Task 4.2
   */
  onNodeClick?: (node: UserJourneyOverviewNodeDto) => void;
  /**
   * Optional callback invoked when a related colleague name is clicked.
   * Receives the colleague's business_user_id so the parent can fetch and
   * display the colleague's overview diagram.
   *
   * Spec 2026-04-10: User Journey Overview Diagram Enhancements
   * Task Group 2, Task 2.3 (type definition) / Task Group 4, Task 4.6 (wiring)
   */
  onColleagueClick?: (businessUserId: string) => void;
}

// ============================================================================
// Layout Constants (reused from UserJourneyDiagramRenderer visual language)
// ============================================================================

/** Padding at the top of the canvas */
const CANVAS_PADDING_TOP = 40;

/** Padding at the left of the canvas */
const CANVAS_PADDING_LEFT = 40;

/** Height of the column header row at the top of each lane */
const LANE_HEADER_HEIGHT = 36;

/** Minimum lane (column) width for a single node */
const MIN_LANE_WIDTH = 360;

/** Journey node width */
const NODE_WIDTH = 320;

/** Vertical spacing between journey nodes within a column */
const NODE_SPACING_Y = 24;

/** Padding inside the lane for the first node */
const LANE_CONTENT_PADDING = 20;

/** Font size for the title text */
const TITLE_FONT_SIZE = 20;

/** Font size for lane header labels */
const LANE_HEADER_FONT_SIZE = 15;

/** Font size for node name (primary label) */
const NODE_NAME_FONT_SIZE = 14;

/** Font size for node description (secondary label) */
const NODE_DESC_FONT_SIZE = 11;

/** Font size for metadata badges */
const BADGE_FONT_SIZE = 10;

/** Corner radius for journey nodes */
const NODE_BORDER_RADIUS = 6;

/** Alternating lane background colors */
const LANE_COLORS = ['#F5F7FA', '#EEF1F5'];

/** Lane header background color (purple, matching styled header block) */
const LANE_HEADER_BG = '#5B3E96';

/** Lane header text color (white, matching styled header block) */
const LANE_HEADER_TEXT_COLOR = '#FFFFFF';

/** Journey node fill color */
const STEP_FILL = '#FFFFFF';

/** Journey node border color */
const STEP_STROKE = '#90A4AE';

/** Edge stroke color */
const EDGE_COLOR = '#616161';

/** Edge stroke width */
const EDGE_STROKE_WIDTH = 1.5;

/** Edge label font size */
const EDGE_LABEL_FONT_SIZE = 10;

/** Padding margin added to content bounds for auto-sizing */
const CONTENT_BOUNDS_PADDING = 40;

/** Minimum fallback content dimensions for empty diagrams */
const MIN_CONTENT_WIDTH = 200;
const MIN_CONTENT_HEIGHT = 200;

/** Badge background color */
const BADGE_BG = '#E8EDF2';

/** Badge text color */
const BADGE_TEXT_COLOR = '#546E7A';

/** Maximum description characters before truncation */
const MAX_DESC_CHARS = 50;

/** Number of application boxes per row in the app grid */
const APPS_PER_ROW = 4;

/** Width of each application box in the app grid */
const APP_BOX_WIDTH = 60;

/** Height of each application box in the app grid */
const APP_BOX_HEIGHT = 40;

/** Horizontal gap between application boxes */
const APP_BOX_GAP_X = 8;

/** Vertical gap between application box rows */
const APP_BOX_GAP_Y = 8;

// ============================================================================
// Styled Header Block Constants
// ============================================================================

/** Height of the styled header block (title + summary on colored background) */
const HEADER_BLOCK_HEIGHT = 72;

/** Height of the navigation box below the header block (colleagues links) */
const NAV_BOX_HEIGHT = 36;

/** Gap between header block and navigation box */
const HEADER_NAV_GAP = 0;

/** Gap between navigation box and lane headers */
const NAV_LANE_GAP = 12;

/** Header block background color (purple/teal) */
const HEADER_BG_COLOR = '#5B3E96';

/** Header block border color */
const HEADER_BORDER_COLOR = '#3D2A6A';

/** Font size for the summary sentence in the header block */
const SUMMARY_FONT_SIZE = 15;

/** Font size for the related colleagues line text */
const COLLEAGUES_FONT_SIZE = 13;

// ============================================================================
// Position Computation Types
// ============================================================================

interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LaneRect {
  lane: UserJourneyOverviewLaneDto;
  x: number;
  y: number;
  width: number;
  height: number;
  headerX: number;
  headerY: number;
  headerWidth: number;
  headerHeight: number;
}

interface EdgeWaypoint {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface OverviewLayout {
  sortedLanes: UserJourneyOverviewLaneDto[];
  laneRects: LaneRect[];
  nodePositions: Map<string, NodePosition>;
  edgeWaypoints: Map<string, EdgeWaypoint>;
  baseY: number;
  baseX: number;
  /** Y and dimensions for the styled header block */
  headerBlockY: number;
  headerBlockWidth: number;
  /** Y position for the navigation box below the header */
  navBoxY: number;
  navBoxWidth: number;
}

// ============================================================================
// Layout Computation
// ============================================================================

/**
 * Truncate description text to a maximum length.
 */
function truncateDescription(desc: string, maxLen: number = MAX_DESC_CHARS): string {
  if (!desc || desc.length <= maxLen) return desc || '';
  return desc.substring(0, maxLen - 3) + '...';
}

/**
 * Compute the height for a single node based on its application count.
 * - Base height: 64px (name area + activity steps summary text + gap)
 * - App grid row height: 48px (40px box + 8px gap)
 * - Apps per row: 4
 * - Bottom padding: 8px
 */
function computeNodeHeight(node: UserJourneyOverviewNodeDto): number {
  const appCount = node.metadata.applications?.length ?? 0;
  if (appCount === 0) return 90; // fallback for no app data (backward compat)
  const gridRows = Math.ceil(appCount / APPS_PER_ROW);
  return 64 + gridRows * (APP_BOX_HEIGHT + APP_BOX_GAP_Y) + APP_BOX_GAP_Y;
}

/**
 * Order nodes within a lane so that link sources appear before (left of) targets.
 * Uses a simplified topological sort; falls back to alphabetical for cycles/ties.
 */
function decideJourneyOrder(
  laneNodes: UserJourneyOverviewNodeDto[],
  edges: UserJourneyOverviewEdgeDto[]
): UserJourneyOverviewNodeDto[] {
  if (laneNodes.length <= 1) return laneNodes;

  const nodeIds = new Set(laneNodes.map(n => n.id));
  // Build adjacency for nodes within this lane only
  const outDegree = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  for (const n of laneNodes) {
    outDegree.set(n.id, new Set());
    inDegree.set(n.id, 0);
  }
  for (const edge of edges) {
    if (nodeIds.has(edge.source_node_id) && nodeIds.has(edge.target_node_id)) {
      outDegree.get(edge.source_node_id)!.add(edge.target_node_id);
      inDegree.set(edge.target_node_id, (inDegree.get(edge.target_node_id) || 0) + 1);
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const n of laneNodes) {
    if ((inDegree.get(n.id) || 0) === 0) queue.push(n.id);
  }
  // Sort queue alphabetically for deterministic tie-breaking
  queue.sort((a, b) => {
    const na = laneNodes.find(n => n.id === a)!.name;
    const nb = laneNodes.find(n => n.id === b)!.name;
    return na.localeCompare(nb);
  });

  const ordered: string[] = [];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    ordered.push(current);
    for (const target of outDegree.get(current) || []) {
      inDegree.set(target, (inDegree.get(target) || 0) - 1);
      if ((inDegree.get(target) || 0) <= 0 && !visited.has(target)) {
        queue.push(target);
        queue.sort((a, b) => {
          const na = laneNodes.find(n => n.id === a)!.name;
          const nb = laneNodes.find(n => n.id === b)!.name;
          return na.localeCompare(nb);
        });
      }
    }
  }

  // Add any unvisited nodes (cycles) alphabetically
  for (const n of [...laneNodes].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!visited.has(n.id)) {
      ordered.push(n.id);
    }
  }

  const nodeMap = new Map(laneNodes.map(n => [n.id, n]));
  return ordered.map(id => nodeMap.get(id)!);
}

/**
 * Order lanes (columns) so that lanes containing link sources appear before
 * lanes containing link targets. Uses topological sort on cross-lane edges
 * with lane.order as the tie-breaker.
 */
function decideLaneOrder(
  lanes: UserJourneyOverviewLaneDto[],
  nodes: UserJourneyOverviewNodeDto[],
  edges: UserJourneyOverviewEdgeDto[]
): UserJourneyOverviewLaneDto[] {
  if (lanes.length <= 1) return [...lanes].sort((a, b) => a.order - b.order);

  // Map node ID -> lane ID
  const nodeLane = new Map<string, string>();
  for (const node of nodes) {
    nodeLane.set(node.id, node.lane_id);
  }

  const laneIds = new Set(lanes.map(l => l.id));
  const laneOutEdges = new Map<string, Set<string>>();
  const laneInDegree = new Map<string, number>();
  for (const l of lanes) {
    laneOutEdges.set(l.id, new Set());
    laneInDegree.set(l.id, 0);
  }

  // Build cross-lane adjacency from edges
  for (const edge of edges) {
    const srcLane = nodeLane.get(edge.source_node_id);
    const tgtLane = nodeLane.get(edge.target_node_id);
    if (srcLane && tgtLane && srcLane !== tgtLane && laneIds.has(srcLane) && laneIds.has(tgtLane)) {
      if (!laneOutEdges.get(srcLane)!.has(tgtLane)) {
        laneOutEdges.get(srcLane)!.add(tgtLane);
        laneInDegree.set(tgtLane, (laneInDegree.get(tgtLane) || 0) + 1);
      }
    }
  }

  // Kahn's algorithm with lane.order as tie-breaker
  const laneMap = new Map(lanes.map(l => [l.id, l]));
  const queue = lanes
    .filter(l => (laneInDegree.get(l.id) || 0) === 0)
    .sort((a, b) => a.order - b.order)
    .map(l => l.id);

  const ordered: string[] = [];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    ordered.push(current);
    for (const target of laneOutEdges.get(current) || []) {
      laneInDegree.set(target, (laneInDegree.get(target) || 0) - 1);
      if ((laneInDegree.get(target) || 0) <= 0 && !visited.has(target)) {
        queue.push(target);
        queue.sort((a, b) => laneMap.get(a)!.order - laneMap.get(b)!.order);
      }
    }
  }

  // Add any unvisited lanes (cycles) by original order
  for (const l of [...lanes].sort((a, b) => a.order - b.order)) {
    if (!visited.has(l.id)) ordered.push(l.id);
  }

  return ordered.map(id => laneMap.get(id)!);
}

/**
 * Compute deterministic positions for all lanes, nodes, and edges.
 *
 * Layout: Vertical columns side by side (one per Business Process), with
 * column headers at the top. Journey nodes flow top-to-bottom within each
 * column, ordered topologically by link direction with alphabetical fallback.
 * Lanes are also ordered topologically so source lanes appear left of target lanes.
 *
 * Spec 2026-04-10: Extended to account for summary and colleagues vertical space.
 * Vertical spacing order:
 *   CANVAS_PADDING_TOP -> colleagues line -> 8px gap -> title -> 4px gap -> summary sentence -> 8px gap -> lane headers
 */
function computeLayout(
  lanes: UserJourneyOverviewLaneDto[],
  nodes: UserJourneyOverviewNodeDto[],
  edges: UserJourneyOverviewEdgeDto[],
  showTitle: boolean,
  hasColleagues: boolean = false,
): OverviewLayout {
  const sortedLanes = decideLaneOrder(lanes, nodes, edges);

  // Group nodes by laneId, ordered topologically within each lane
  const nodesByLane = new Map<string, UserJourneyOverviewNodeDto[]>();
  for (const node of nodes) {
    const existing = nodesByLane.get(node.lane_id) || [];
    existing.push(node);
    nodesByLane.set(node.lane_id, existing);
  }
  for (const [key, arr] of nodesByLane) {
    nodesByLane.set(key, decideJourneyOrder(arr, edges));
  }

  // Compute vertical offsets for styled header block layout:
  //   CANVAS_PADDING_TOP -> header block (title + summary) -> nav box (colleagues) -> gap -> lane headers
  const headerBlockY = CANVAS_PADDING_TOP;
  const showHeader = showTitle;
  const headerHeight = showHeader ? HEADER_BLOCK_HEIGHT : 0;
  const navHeight = (showHeader && hasColleagues) ? NAV_BOX_HEIGHT + HEADER_NAV_GAP : 0;
  const totalHeaderArea = headerHeight + navHeight + (showHeader ? NAV_LANE_GAP : 0);

  const baseY = CANVAS_PADDING_TOP + totalHeaderArea;
  const baseX = CANVAS_PADDING_LEFT;

  const nodePositions = new Map<string, NodePosition>();
  const laneRects: LaneRect[] = [];

  // Column width: enough to fit a node with padding on both sides
  const columnWidth = Math.max(MIN_LANE_WIDTH, NODE_WIDTH + 2 * LANE_CONTENT_PADDING);

  // Compute the maximum column content height across all lanes, accounting for
  // dynamic per-node heights
  let maxColumnContentHeight = 0;
  for (const arr of nodesByLane.values()) {
    let laneContentHeight = LANE_CONTENT_PADDING;
    for (const node of arr) {
      laneContentHeight += computeNodeHeight(node) + NODE_SPACING_Y;
    }
    maxColumnContentHeight = Math.max(maxColumnContentHeight, laneContentHeight);
  }
  // Ensure minimum height for lanes with no nodes
  if (maxColumnContentHeight === 0) {
    maxColumnContentHeight = 90 + NODE_SPACING_Y + LANE_CONTENT_PADDING;
  }

  const totalColumnHeight = LANE_HEADER_HEIGHT + maxColumnContentHeight;

  // Place columns side by side (left-to-right)
  let cumulativeLaneX = baseX;
  for (let laneIdx = 0; laneIdx < sortedLanes.length; laneIdx++) {
    const lane = sortedLanes[laneIdx];
    const laneY = baseY;
    const laneNodes = nodesByLane.get(lane.id) || [];

    laneRects.push({
      lane,
      x: cumulativeLaneX,
      y: laneY,
      width: columnWidth,
      height: totalColumnHeight,
      headerX: cumulativeLaneX,
      headerY: laneY,
      headerWidth: columnWidth,
      headerHeight: LANE_HEADER_HEIGHT,
    });

    // Position nodes top-to-bottom within the column, using dynamic node heights
    let currentNodeY = laneY + LANE_HEADER_HEIGHT + LANE_CONTENT_PADDING;
    for (const node of laneNodes) {
      const nodeHeight = computeNodeHeight(node);
      const nx = cumulativeLaneX + (columnWidth - NODE_WIDTH) / 2;
      nodePositions.set(node.id, {
        x: nx,
        y: currentNodeY,
        width: NODE_WIDTH,
        height: nodeHeight,
      });
      currentNodeY += nodeHeight + NODE_SPACING_Y;
    }

    cumulativeLaneX += columnWidth;
  }

  // Handle orphan nodes (referencing non-existent laneId)
  for (const node of nodes) {
    if (!nodePositions.has(node.id)) {
      const fallbackIdx = nodePositions.size;
      const nodeHeight = computeNodeHeight(node);
      nodePositions.set(node.id, {
        x: baseX + 20,
        y: baseY + 200 + fallbackIdx * (nodeHeight + 20),
        width: NODE_WIDTH,
        height: nodeHeight,
      });
    }
  }

  // Compute edge waypoints -- prefer horizontal connections (left/right) for
  // cross-column edges and vertical connections for within-column edges
  const edgeWaypoints = new Map<string, EdgeWaypoint>();
  for (const edge of edges) {
    const fromPos = nodePositions.get(edge.source_node_id);
    const toPos = nodePositions.get(edge.target_node_id);
    if (!fromPos || !toPos) continue;

    const fromCx = fromPos.x + fromPos.width / 2;
    const fromCy = fromPos.y + fromPos.height / 2;
    const toCx = toPos.x + toPos.width / 2;
    const toCy = toPos.y + toPos.height / 2;

    const dx = toCx - fromCx;
    const dy = toCy - fromCy;

    let x1: number, y1: number, x2: number, y2: number;

    if (Math.abs(dx) >= Math.abs(dy)) {
      // Horizontal connection (cross-column)
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
      // Vertical connection (within column)
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

    edgeWaypoints.set(edge.id, { x1, y1, x2, y2 });
  }

  // Compute header block width as 3× single column width to avoid line overflow
  const singleColumnWidth = Math.max(MIN_LANE_WIDTH, NODE_WIDTH + 2 * LANE_CONTENT_PADDING);
  const totalLanesWidth = sortedLanes.length * singleColumnWidth;
  const headerBlockWidth = Math.max(singleColumnWidth * 3, totalLanesWidth, 500);
  const navBoxY = headerBlockY + HEADER_BLOCK_HEIGHT + HEADER_NAV_GAP;

  return {
    sortedLanes,
    laneRects,
    nodePositions,
    edgeWaypoints,
    baseY,
    baseX,
    headerBlockY,
    headerBlockWidth,
    navBoxY,
    navBoxWidth: headerBlockWidth,
  };
}

// ============================================================================
// Content Bounds Computation
// ============================================================================

/**
 * Compute the total content bounds from layout results.
 *
 * Finds the maximum extent (x + width, y + height) across all lane rects
 * and node positions, then adds a padding margin.
 *
 * Returns a minimum fallback size for empty diagrams (0 lanes, 0 nodes).
 */
export function computeOverviewContentBounds(
  laneRects: LaneRect[],
  nodePositions: Map<string, NodePosition>,
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

  for (const pos of nodePositions.values()) {
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
// Link Status Helpers
// ============================================================================

/**
 * Determine whether a node is considered "linked" for visual cue and cursor purposes.
 * A node is linked if its link sub-record has link_status of LINKED or AMBIGUOUS_RESOLVED.
 * Nodes without a link field (backward compat with pre-increment-14 saved overviews)
 * or with UNLINKED status are treated as unlinked.
 *
 * Spec 2026-04-07: User Journey Overview Parent-Child Diagram Linking
 * Task Group 4, Tasks 4.3 and 4.4
 */
function isNodeLinked(node: UserJourneyOverviewNodeDto): boolean {
  const status = node.link?.link_status;
  return status === 'LINKED' || status === 'AMBIGUOUS_RESOLVED';
}

// ============================================================================
// Sub-renderers
// ============================================================================

/**
 * Render the styled header block with title and summary on a colored background.
 */
function renderHeaderBlock(
  title: string,
  businessUserName: string,
  summaryCounts: OverviewSummaryCountsDto | undefined,
  x: number,
  y: number,
  width: number,
): React.ReactElement {
  let summaryText = '';
  if (summaryCounts) {
    const { journey_count, business_process_count, activity_step_count, application_count } = summaryCounts;
    summaryText = `${businessUserName} is involved in ${journey_count} User Journeys across ${business_process_count} Business Processes, ${activity_step_count} Activity Steps and ${application_count} Applications`;
  }

  return (
    <g key="overview-header-block" data-testid="overview-header-block">
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
 * Render the navigation box below the header block with colleague links.
 */
function renderNavBox(
  colleagues: RelatedColleagueDto[] | undefined,
  x: number,
  y: number,
  width: number,
  onColleagueClick?: (businessUserId: string) => void,
): React.ReactElement {
  const colleagueList = colleagues ?? [];

  return (
    <g key="overview-nav-box" data-testid="overview-colleagues-line">
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
            padding: '8px 16px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: `${COLLEAGUES_FONT_SIZE}px`,
            lineHeight: 1.4,
            color: '#333',
          }}
        >
          <strong>Related User Journey Overviews: </strong>
          {colleagueList.length === 0 ? (
            <span style={{ color: '#888', fontStyle: 'italic' }}>No related colleagues defined yet</span>
          ) : (
            colleagueList.map((colleague, idx) => (
              <span key={colleague.business_user_id}>
                {colleague.has_overview ? (
                  <a
                    href="#"
                    data-colleague-id={colleague.business_user_id}
                    data-business-user-name={colleague.business_user_name}
                    style={{ color: '#1976D2', textDecoration: 'underline', cursor: 'pointer' }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onColleagueClick?.(colleague.business_user_id);
                    }}
                  >
                    {colleague.business_user_name}
                  </a>
                ) : (
                  <span style={{ color: '#888' }}>{colleague.business_user_name}</span>
                )}
                {idx < colleagueList.length - 1 ? ', ' : ''}
              </span>
            ))
          )}
        </div>
      </foreignObject>
    </g>
  );
}

function renderLane(laneRect: LaneRect, laneIdx: number): React.ReactElement {
  const bgColor = LANE_COLORS[laneIdx % LANE_COLORS.length];

  return (
    <g key={`lane-${laneRect.lane.id}`} data-testid={`overview-lane-${laneRect.lane.id}`}>
      {/* Column background */}
      <rect
        x={laneRect.x}
        y={laneRect.y}
        width={laneRect.width}
        height={laneRect.height}
        fill={bgColor}
        stroke="#D0D5DD"
        strokeWidth={0.5}
      />
      {/* Column header (purple bg, white text - matching styled header block) */}
      <rect
        x={laneRect.headerX}
        y={laneRect.headerY}
        width={laneRect.headerWidth}
        height={laneRect.headerHeight}
        fill={LANE_HEADER_BG}
        stroke={HEADER_BORDER_COLOR}
        strokeWidth={0.5}
      />
      {/* Column header label (horizontal text, centered) */}
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
    </g>
  );
}

/**
 * Render a single journey node as an SVG group.
 *
 * Spec 2026-04-07: User Journey Overview Parent-Child Diagram Linking
 * Task Group 4, Tasks 4.3-4.5:
 * - Accepts optional onNodeClick callback; attaches onClick handler to the <g> element
 * - Sets cursor: 'pointer' for LINKED/AMBIGUOUS_RESOLVED nodes, 'default' otherwise
 * - Applies blue text (#1976D2) and underline on the name <text> for linked nodes
 * - Retains default styling (fill="#333", no underline) for UNLINKED or missing-link nodes
 *
 * When metadata.applications is populated, renders an app grid instead of badges.
 * Falls back to badge display for backward compatibility when applications is absent.
 */
function renderNode(
  node: UserJourneyOverviewNodeDto,
  pos: NodePosition,
  showDescription: boolean,
  onNodeClick?: (node: UserJourneyOverviewNodeDto) => void
): React.ReactElement {
  const descText = showDescription ? truncateDescription(node.description) : '';

  // Determine linked status for visual cues and cursor (Task 4.3, 4.4)
  const linked = isNodeLinked(node);
  const cursorStyle = linked ? 'pointer' : 'default';
  const nameTextFill = linked ? '#1976D2' : '#333';
  const nameTextDecoration = linked ? 'underline' : undefined;

  const hasApps = node.metadata.applications && node.metadata.applications.length > 0;

  const linkedDiagramId = linked ? node.link?.linked_diagram_id : undefined;

  return (
    <g
      key={`node-${node.id}`}
      data-testid={`overview-node-${node.id}`}
      style={{ cursor: cursorStyle }}
      onClick={onNodeClick ? () => onNodeClick(node) : undefined}
    >
      {/* Node rectangle — carries data-diagram-id for PDF link annotation */}
      <rect
        x={pos.x}
        y={pos.y}
        width={pos.width}
        height={pos.height}
        fill={STEP_FILL}
        stroke={STEP_STROKE}
        strokeWidth={1}
        rx={NODE_BORDER_RADIUS}
        data-diagram-id={linkedDiagramId || undefined}
        data-node-link="true"
      />
      {/* Primary label: journey name (foreignObject with word wrapping) */}
      <foreignObject
        x={pos.x + 8}
        y={pos.y + 6}
        width={pos.width - 16}
        height={40}
        data-node-name="true"
        data-diagram-id={linkedDiagramId || undefined}
      >
        <div
          style={{
            fontSize: `${NODE_NAME_FONT_SIZE}px`,
            fontWeight: 500,
            color: nameTextFill,
            textDecoration: nameTextDecoration,
            textAlign: 'center',
            lineHeight: '1.3',
            overflow: 'hidden',
            wordWrap: 'break-word' as any,
          }}
        >
          {node.name}
        </div>
      </foreignObject>
      {/* Secondary label: description (truncated) */}
      {descText && (
        <text
          x={pos.x + pos.width / 2}
          y={pos.y + 38}
          textAnchor="middle"
          fontSize={NODE_DESC_FONT_SIZE}
          fill="#666"
        >
          {descText}
        </text>
      )}
      {/* App grid (when metadata.applications is populated) */}
      {hasApps ? (
        <g>
          {/* Activity steps summary */}
          <text
            x={pos.x + 10}
            y={pos.y + 50}
            fontSize={13}
            fill="#666"
          >
            {node.metadata.step_count} activity step{node.metadata.step_count !== 1 ? 's' : ''} across {node.metadata.application_count} app{node.metadata.application_count !== 1 ? 's' : ''}:
          </text>
          {/* Application boxes grid */}
          {(node.metadata.applications || []).map((app, appIdx) => {
            const col = appIdx % APPS_PER_ROW;
            const row = Math.floor(appIdx / APPS_PER_ROW);
            const appX = pos.x + 10 + col * (APP_BOX_WIDTH + APP_BOX_GAP_X);
            const appY = pos.y + 68 + row * (APP_BOX_HEIGHT + APP_BOX_GAP_Y);
            return (
              <g key={`app-${appIdx}`}>
                <rect
                  x={appX}
                  y={appY}
                  width={APP_BOX_WIDTH}
                  height={APP_BOX_HEIGHT}
                  rx={4}
                  fill="#E3F2FD"
                  stroke="#90CAF9"
                  strokeWidth={1}
                />
                <text
                  x={appX + APP_BOX_WIDTH / 2}
                  y={appY + 24}
                  textAnchor="middle"
                  fontSize={12}
                  fill="#1565C0"
                  fontWeight={500}
                >
                  {app.abbreviation}
                </text>
              </g>
            );
          })}
        </g>
      ) : (
        /* Fallback: metadata badges (backward compat when applications not populated) */
        <g>
          {/* Steps badge */}
          <rect
            x={pos.x + 10}
            y={pos.y + pos.height - 20}
            width={60}
            height={16}
            rx={3}
            fill={BADGE_BG}
          />
          <text
            x={pos.x + 40}
            y={pos.y + pos.height - 20 + 16 / 2 + BADGE_FONT_SIZE / 3}
            textAnchor="middle"
            fontSize={BADGE_FONT_SIZE}
            fill={BADGE_TEXT_COLOR}
          >
            {node.metadata.step_count} steps
          </text>
          {/* Applications badge */}
          <rect
            x={pos.x + 78}
            y={pos.y + pos.height - 20}
            width={56}
            height={16}
            rx={3}
            fill={BADGE_BG}
          />
          <text
            x={pos.x + 106}
            y={pos.y + pos.height - 20 + 16 / 2 + BADGE_FONT_SIZE / 3}
            textAnchor="middle"
            fontSize={BADGE_FONT_SIZE}
            fill={BADGE_TEXT_COLOR}
          >
            {node.metadata.application_count} apps
          </text>
        </g>
      )}
    </g>
  );
}

function renderEdge(
  edge: UserJourneyOverviewEdgeDto,
  waypoint: EdgeWaypoint,
  showLabels: boolean
): React.ReactElement {
  const midX = (waypoint.x1 + waypoint.x2) / 2;
  const midY = (waypoint.y1 + waypoint.y2) / 2;

  return (
    <g key={`edge-${edge.id}`}>
      <line
        data-testid={`overview-edge-${edge.id}`}
        x1={waypoint.x1}
        y1={waypoint.y1}
        x2={waypoint.x2}
        y2={waypoint.y2}
        stroke={EDGE_COLOR}
        strokeWidth={EDGE_STROKE_WIDTH}
        markerEnd="url(#overview-arrow)"
      />
      {/* Edge label */}
      {showLabels && edge.label && (
        <text
          data-testid={`overview-edge-label-${edge.id}`}
          x={midX}
          y={midY - 6}
          textAnchor="middle"
          fontSize={EDGE_LABEL_FONT_SIZE}
          fill={EDGE_COLOR}
          fontStyle="italic"
        >
          {edge.label}
        </text>
      )}
    </g>
  );
}

// ============================================================================
// Main Component
// ============================================================================

const UserJourneyOverviewDiagramRenderer: React.FC<UserJourneyOverviewDiagramRendererProps> = ({
  overviewData,
  onContentBounds,
  onNodeClick,
  onColleagueClick,
}) => {
  const { overview, lanes, nodes, edges, render_hints, summary_counts, related_colleagues } = overviewData;

  // Apply default render_hints values for missing or malformed fields
  const showTitle = render_hints?.show_title ?? true;
  const showLaneHeaders = render_hints?.show_lane_headers ?? true;
  const showNodeDescription = render_hints?.show_node_description ?? true;
  const showRelationshipLabels = render_hints?.show_relationship_labels ?? true;

  // Determine whether colleagues section should reserve vertical space
  const hasColleagues = related_colleagues !== undefined;

  const isEmpty = lanes.length === 0 && nodes.length === 0;

  // Compute layout (deterministic positions for lanes, nodes, edges)
  const layoutResult = useMemo(() => {
    if (isEmpty) return null;
    return computeLayout(lanes, nodes, edges, showTitle, hasColleagues);
  }, [isEmpty, lanes, nodes, edges, showTitle, hasColleagues]);

  // Compute content bounds
  const bounds = useMemo(() => {
    if (!layoutResult) {
      return { width: MIN_CONTENT_WIDTH, height: MIN_CONTENT_HEIGHT };
    }
    return computeOverviewContentBounds(layoutResult.laneRects, layoutResult.nodePositions, CONTENT_BOUNDS_PADDING, layoutResult.headerBlockWidth);
  }, [layoutResult]);

  // Report content bounds to parent via callback (when provided)
  useEffect(() => {
    if (onContentBounds) {
      onContentBounds(bounds);
    }
  }, [onContentBounds, bounds]);

  // Handle empty lanes/nodes gracefully
  if (isEmpty) {
    return (
      <g data-testid="overview-diagram-renderer">
        <text x={60} y={80} fontSize={14} fill="#666666">
          This overview has no lanes or journeys to display.
        </text>
      </g>
    );
  }

  const { laneRects, nodePositions, edgeWaypoints, headerBlockY, headerBlockWidth, navBoxY, navBoxWidth } = layoutResult!;

  return (
    <g data-testid="overview-diagram-renderer">
      {/* Arrowhead marker definitions */}
      <defs>
        <marker
          id="overview-arrow"
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={EDGE_COLOR} />
        </marker>
      </defs>

      {/* Dark purple border around the entire header area (header block + nav box) */}
      {showTitle && (
        <rect
          x={CANVAS_PADDING_LEFT}
          y={headerBlockY}
          width={headerBlockWidth}
          height={HEADER_BLOCK_HEIGHT + (hasColleagues ? NAV_BOX_HEIGHT : 0)}
          fill="none"
          stroke={HEADER_BORDER_COLOR}
          strokeWidth={2}
          rx={0}
        />
      )}

      {/* Styled header block (title + summary on colored background) */}
      {showTitle && renderHeaderBlock(
        overview.title,
        overview.business_user_name,
        summary_counts,
        CANVAS_PADDING_LEFT,
        headerBlockY,
        headerBlockWidth,
      )}

      {/* Navigation box with colleague links (below header block) */}
      {showTitle && hasColleagues && renderNavBox(
        related_colleagues,
        CANVAS_PADDING_LEFT,
        navBoxY,
        navBoxWidth,
        onColleagueClick,
      )}

      {/* Lanes */}
      {showLaneHeaders && laneRects.map((lr, idx) => renderLane(lr, idx))}

      {/* Edges (rendered below nodes for visual layering) */}
      {edges.map((edge) => {
        const wp = edgeWaypoints.get(edge.id);
        if (!wp) return null;
        return renderEdge(edge, wp, showRelationshipLabels);
      })}

      {/* Nodes */}
      {nodes.map((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return null;
        return renderNode(node, pos, showNodeDescription, onNodeClick);
      })}
    </g>
  );
};

export default UserJourneyOverviewDiagramRenderer;
