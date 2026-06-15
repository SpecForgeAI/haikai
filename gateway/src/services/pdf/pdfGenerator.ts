/**
 * Server-Side PDF Generator
 *
 * Generates a multi-page PDF document from User Journey diagram data using pdfkit.
 * Produces vector output (crisp text, sharp shapes) without browser limitations.
 *
 * Layout algorithms are ported from the frontend renderers:
 *   - UserJourneyDiagramRenderer.tsx
 *   - UserJourneyOverviewDiagramRenderer.tsx
 *
 * The same constants and positioning logic are used so diagrams look consistent
 * with the canvas view, while taking advantage of pdfkit's native text
 * measurement for accurate sizing.
 */

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

import type {
  PdfGenerationRequest,
  PdfDiagramGroup,
  PdfDiagramEntry,
  PdfGenerationResult,
  LaneRect,
  EdgeWaypoint,
  TocEntry,
} from './types';

import {
  A4_W, A4_H, PAGE_MARGIN,
  HEADER_BG_COLOR, HEADER_BORDER_COLOR,
  LANE_HEADER_BG, LANE_HEADER_TEXT_COLOR, LANE_COLORS,
  STEP_FILL, STEP_STROKE, EDGE_COLOR, CROSS_LANE_EDGE_COLOR,
  LINK_TEXT_COLOR, TOC_LINK_COLOR, WARNING_COLOR,
  INTERACTION_LEVEL_COLORS,
  // Journey constants
  J_CANVAS_PADDING_TOP, J_CANVAS_PADDING_LEFT,
  J_LANE_HEADER_HEIGHT, J_LANE_WIDTH, J_LANE_HEIGHT, J_LANE_CONTENT_PADDING,
  J_STEP_NODE_WIDTH, J_STEP_NODE_HEIGHT, J_STEP_INNER_PADDING,
  J_STEP_SPACING_X, J_STEP_SPACING_Y, J_STEP_BORDER_RADIUS,
  J_TITLE_FONT_SIZE, J_LANE_HEADER_FONT_SIZE,
  J_STEP_NAME_FONT_SIZE, J_STEP_DETAIL_FONT_SIZE,
  J_STEP_HEADER_HEIGHT_MIN, J_STEP_HEADER_PADDING, J_STEP_HEADER_LINE_HEIGHT,
  J_STEP_SEPARATOR_HEIGHT, J_ISSUE_LINE_HEIGHT, J_ISSUE_ICON_WIDTH,
  J_SUMMARY_FONT_SIZE, J_NAV_FONT_SIZE,
  J_HEADER_BLOCK_HEIGHT, J_NAV_BOX_HEIGHT, J_HEADER_NAV_GAP, J_NAV_LANE_GAP,
  J_EDGE_STROKE_WIDTH, J_CROSS_LANE_DASH, J_CONTENT_BOUNDS_PADDING,
  // Overview constants
  O_CANVAS_PADDING_TOP, O_CANVAS_PADDING_LEFT,
  O_LANE_HEADER_HEIGHT, O_MIN_LANE_WIDTH, O_NODE_WIDTH, O_NODE_SPACING_Y,
  O_LANE_CONTENT_PADDING,
  O_TITLE_FONT_SIZE, O_LANE_HEADER_FONT_SIZE,
  O_NODE_NAME_FONT_SIZE, O_NODE_DESC_FONT_SIZE,
  O_SUMMARY_FONT_SIZE, O_COLLEAGUES_FONT_SIZE,
  O_NODE_BORDER_RADIUS,
  O_HEADER_BLOCK_HEIGHT, O_NAV_BOX_HEIGHT, O_HEADER_NAV_GAP, O_NAV_LANE_GAP,
  O_EDGE_STROKE_WIDTH, O_CONTENT_BOUNDS_PADDING,
  O_APPS_PER_ROW, O_APP_BOX_WIDTH, O_APP_BOX_HEIGHT, O_APP_BOX_GAP_X, O_APP_BOX_GAP_Y,
  O_MAX_DESC_CHARS, O_BADGE_BG, O_BADGE_TEXT_COLOR, O_BADGE_FONT_SIZE,
  O_EDGE_LABEL_FONT_SIZE,
} from './constants';

import { logger } from '../logger';

// ============================================================================
// Text Measurement Helpers
// ============================================================================

function measureTextHeight(doc: PDFKit.PDFDocument, text: string, fontSize: number, maxWidth: number, font = 'Helvetica'): number {
  doc.font(font).fontSize(fontSize);
  return doc.heightOfString(text, { width: maxWidth });
}

function measureTextWidth(doc: PDFKit.PDFDocument, text: string, fontSize: number, font = 'Helvetica'): number {
  doc.font(font).fontSize(fontSize);
  return doc.widthOfString(text);
}

// ============================================================================
// Drawing Helpers
// ============================================================================

function drawArrowhead(doc: PDFKit.PDFDocument, x2: number, y2: number, x1: number, y1: number, size: number, color: string): void {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const a1 = angle + Math.PI * 0.8;
  const a2 = angle - Math.PI * 0.8;
  doc.save();
  doc.fillColor(color);
  doc.path(`M ${x2} ${y2} L ${x2 + Math.cos(a1) * size} ${y2 + Math.sin(a1) * size} L ${x2 + Math.cos(a2) * size} ${y2 + Math.sin(a2) * size} Z`).fill();
  doc.restore();
}

function drawRoundedRect(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string, strokeWidth?: number): void {
  doc.save();
  doc.roundedRect(x, y, w, h, r);
  if (fill && stroke) {
    doc.fillColor(fill).strokeColor(stroke).lineWidth(strokeWidth || 1).fillAndStroke();
  } else if (fill) {
    doc.fillColor(fill).fill();
  } else if (stroke) {
    doc.strokeColor(stroke).lineWidth(strokeWidth || 1).stroke();
  }
  doc.restore();
}

// ============================================================================
// USER_JOURNEY: Step Height Computation
// ============================================================================

function computeStepHeaderHeight(doc: PDFKit.PDFDocument, step: any, scale: number): number {
  const label = step.diagram_label || step.name || '';
  if (!label) return J_STEP_HEADER_HEIGHT_MIN * scale;
  const availWidth = (J_STEP_NODE_WIDTH - 2 * J_STEP_INNER_PADDING) * scale;
  const h = measureTextHeight(doc, label, J_STEP_NAME_FONT_SIZE * scale, availWidth, 'Helvetica-Bold');
  const singleLine = J_STEP_HEADER_HEIGHT_MIN * scale;
  return Math.max(singleLine, J_STEP_HEADER_PADDING * scale + h + J_STEP_HEADER_PADDING * scale);
}

function computeStepHeight(doc: PDFKit.PDFDocument, step: any, scale: number): number {
  const headerH = computeStepHeaderHeight(doc, step, scale);
  let contentH = 4 * scale;
  let sectionCount = 0;

  // Frequency
  if (step.frequency?.trim()) {
    contentH += (J_STEP_DETAIL_FONT_SIZE + 4) * scale;
    sectionCount++;
  }

  // Co-workers
  const coWorkerCount = step.co_worker_links?.length || step.co_worker_abbreviations?.length || 0;
  if (coWorkerCount > 0) {
    contentH += coWorkerCount * (J_STEP_DETAIL_FONT_SIZE + 4) * scale;
    sectionCount++;
  }

  // Issues
  const hasActivityIssues = !!step.activity_issues?.trim();
  const hasUiIssues = !!step.ui_issues?.trim();
  const issueWidth = (J_STEP_NODE_WIDTH - 2 * J_STEP_INNER_PADDING - J_ISSUE_ICON_WIDTH) * scale;
  if (hasActivityIssues) {
    const h = measureTextHeight(doc, step.activity_issues.trim(), J_STEP_DETAIL_FONT_SIZE * scale, issueWidth);
    contentH += h + (hasUiIssues ? 4 * scale : 0);
  }
  if (hasUiIssues) {
    const h = measureTextHeight(doc, step.ui_issues.trim(), J_STEP_DETAIL_FONT_SIZE * scale, issueWidth);
    contentH += h;
  }
  if (hasActivityIssues || hasUiIssues) sectionCount++;

  // Separators
  if (sectionCount > 1) {
    contentH += (sectionCount - 1) * J_STEP_SEPARATOR_HEIGHT * scale;
  }

  contentH += 10 * scale;
  return Math.max(J_STEP_NODE_HEIGHT * scale, headerH + contentH);
}

// ============================================================================
// USER_JOURNEY: Layout Computation
// ============================================================================

interface JourneyLayout {
  laneRects: LaneRect[];
  stepPositions: Map<string, { x: number; y: number; width: number; height: number }>;
  edges: Array<{ edge: any; waypoint: EdgeWaypoint }>;
  headerBlockY: number;
  headerBlockWidth: number;
  navBoxY: number;
  contentWidth: number;
  contentHeight: number;
}

function computeJourneyLayout(doc: PDFKit.PDFDocument, dto: any, scale: number): JourneyLayout {
  const lanes = [...(dto.lanes || [])].sort((a: any, b: any) => a.order - b.order);
  const steps = dto.steps || [];
  const edges = dto.edges || [];
  const showTitle = dto.render_hints?.show_title !== false;
  const laneAxis = dto.render_hints?.lane_axis || 'HORIZONTAL';
  const hasNavLinks = true; // always show nav box area

  // Group steps by lane
  const stepsByLane = new Map<string, any[]>();
  for (const step of steps) {
    const arr = stepsByLane.get(step.lane_id) || [];
    arr.push(step);
    stepsByLane.set(step.lane_id, arr);
  }
  for (const [key, arr] of stepsByLane) {
    stepsByLane.set(key, arr.sort((a: any, b: any) => a.order - b.order));
  }

  // Header area
  const headerBlockY = J_CANVAS_PADDING_TOP * scale;
  const headerHeight = showTitle ? J_HEADER_BLOCK_HEIGHT * scale : 0;
  const navHeight = showTitle ? (J_NAV_BOX_HEIGHT + J_HEADER_NAV_GAP) * scale : 0;
  const totalHeaderArea = headerHeight + navHeight + (showTitle ? J_NAV_LANE_GAP * scale : 0);
  const baseY = J_CANVAS_PADDING_TOP * scale + totalHeaderArea;
  const baseX = J_CANVAS_PADDING_LEFT * scale;

  // Pre-compute step heights
  const stepHeightMap = new Map<string, number>();
  for (const step of steps) {
    stepHeightMap.set(step.id, computeStepHeight(doc, step, scale));
  }

  const laneRects: LaneRect[] = [];
  const stepPositions = new Map<string, { x: number; y: number; width: number; height: number }>();

  if (laneAxis === 'VERTICAL') {
    // Vertical: lanes as columns, steps flow top-to-bottom, aligned by process_activity
    const activityRowOrder = new Map<string, number>();
    for (const step of steps) {
      const existing = activityRowOrder.get(step.process_activity_id);
      if (existing === undefined || step.order < existing) {
        activityRowOrder.set(step.process_activity_id, step.order);
      }
    }
    const sortedActivities = [...activityRowOrder.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);

    // Row heights = max step height per activity across all lanes
    const rowHeights = new Map<string, number>();
    for (const actId of sortedActivities) {
      let maxH = J_STEP_NODE_HEIGHT * scale;
      for (const step of steps) {
        if (step.process_activity_id === actId) {
          maxH = Math.max(maxH, stepHeightMap.get(step.id) || maxH);
        }
      }
      rowHeights.set(actId, maxH);
    }

    // Row Y positions
    const rowYPositions = new Map<string, number>();
    let cumY = baseY + J_LANE_HEADER_HEIGHT * scale + J_LANE_CONTENT_PADDING * scale;
    for (const actId of sortedActivities) {
      rowYPositions.set(actId, cumY);
      cumY += (rowHeights.get(actId) || J_STEP_NODE_HEIGHT * scale) + J_STEP_SPACING_Y * scale;
    }
    const maxLaneContentH = cumY - (baseY + J_LANE_HEADER_HEIGHT * scale);

    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i];
      const lx = baseX + i * J_LANE_WIDTH * scale;
      const ly = baseY;
      const lw = J_LANE_WIDTH * scale;
      const lh = J_LANE_HEADER_HEIGHT * scale + maxLaneContentH;
      laneRects.push({
        x: lx, y: ly, width: lw, height: lh, name: lane.name,
        headerRect: { x: lx, y: ly, width: lw, height: J_LANE_HEADER_HEIGHT * scale },
      });

      const laneSteps = stepsByLane.get(lane.id) || [];
      for (const step of laneSteps) {
        const sx = lx + (lw - J_STEP_NODE_WIDTH * scale) / 2;
        const sy = rowYPositions.get(step.process_activity_id) || cumY;
        const sh = stepHeightMap.get(step.id) || J_STEP_NODE_HEIGHT * scale;
        stepPositions.set(step.id, { x: sx, y: sy, width: J_STEP_NODE_WIDTH * scale, height: sh });
      }
    }
  } else {
    // Horizontal (default): lanes as rows, steps flow left-to-right
    const maxStepsInLane = Math.max(1, ...lanes.map((l: any) => (stepsByLane.get(l.id) || []).length));
    const laneContentWidth = maxStepsInLane * (J_STEP_NODE_WIDTH + J_STEP_SPACING_X) * scale + J_LANE_CONTENT_PADDING * scale;
    let cumLaneY = baseY;

    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i];
      const laneSteps = stepsByLane.get(lane.id) || [];
      const maxStepH = Math.max(J_STEP_NODE_HEIGHT * scale, ...(laneSteps.map((s: any) => stepHeightMap.get(s.id) || J_STEP_NODE_HEIGHT * scale)));
      const laneH = Math.max(J_LANE_HEIGHT * scale, maxStepH + 2 * J_LANE_CONTENT_PADDING * scale);
      const laneW = J_LANE_HEADER_HEIGHT * scale + laneContentWidth;

      laneRects.push({
        x: baseX, y: cumLaneY, width: laneW, height: laneH, name: lane.name,
        headerRect: { x: baseX, y: cumLaneY, width: J_LANE_HEADER_HEIGHT * scale, height: laneH },
      });

      for (let si = 0; si < laneSteps.length; si++) {
        const step = laneSteps[si];
        const sh = stepHeightMap.get(step.id) || J_STEP_NODE_HEIGHT * scale;
        const sx = baseX + J_LANE_HEADER_HEIGHT * scale + J_LANE_CONTENT_PADDING * scale + si * (J_STEP_NODE_WIDTH + J_STEP_SPACING_X) * scale;
        const sy = cumLaneY + (laneH - sh) / 2;
        stepPositions.set(step.id, { x: sx, y: sy, width: J_STEP_NODE_WIDTH * scale, height: sh });
      }

      cumLaneY += laneH;
    }
  }

  // Edge waypoints
  const edgeWaypoints: Array<{ edge: any; waypoint: EdgeWaypoint }> = [];
  for (const edge of edges) {
    const from = stepPositions.get(edge.from_step_id);
    const to = stepPositions.get(edge.to_step_id);
    if (!from || !to) continue;
    const fcx = from.x + from.width / 2, fcy = from.y + from.height / 2;
    const tcx = to.x + to.width / 2, tcy = to.y + to.height / 2;
    const dx = tcx - fcx, dy = tcy - fcy;
    let x1: number, y1: number, x2: number, y2: number;
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx >= 0) { x1 = from.x + from.width; y1 = fcy; x2 = to.x; y2 = tcy; }
      else { x1 = from.x; y1 = fcy; x2 = to.x + to.width; y2 = tcy; }
    } else {
      if (dy >= 0) { x1 = fcx; y1 = from.y + from.height; x2 = tcx; y2 = to.y; }
      else { x1 = fcx; y1 = from.y; x2 = tcx; y2 = to.y + to.height; }
    }
    edgeWaypoints.push({ edge, waypoint: { x1, y1, x2, y2 } });
  }

  // Content bounds
  let maxX = 0, maxY = 0;
  for (const lr of laneRects) { maxX = Math.max(maxX, lr.x + lr.width); maxY = Math.max(maxY, lr.y + lr.height); }
  for (const sp of stepPositions.values()) { maxX = Math.max(maxX, sp.x + sp.width); maxY = Math.max(maxY, sp.y + sp.height); }

  // Header block width
  const singleLaneW = laneRects.length > 0 ? laneRects[0].width : 500 * scale;
  const totalLanesW = laneRects.length > 0 ? Math.max(...laneRects.map(lr => lr.x + lr.width)) - baseX : singleLaneW;
  const headerBlockWidth = Math.max(singleLaneW * 3, totalLanesW, 500 * scale);
  maxX = Math.max(maxX, baseX + headerBlockWidth);

  const contentWidth = maxX + J_CONTENT_BOUNDS_PADDING * scale;
  const contentHeight = maxY + J_CONTENT_BOUNDS_PADDING * scale;
  const navBoxY = headerBlockY + J_HEADER_BLOCK_HEIGHT * scale + J_HEADER_NAV_GAP * scale;

  return { laneRects, stepPositions, edges: edgeWaypoints, headerBlockY, headerBlockWidth, navBoxY, contentWidth, contentHeight };
}

// ============================================================================
// USER_JOURNEY: Drawing
// ============================================================================

function drawJourneyDiagram(
  doc: PDFKit.PDFDocument,
  entry: PdfDiagramEntry,
  pageNumberMap: Map<string, number>,
  scale: number,
  offsetX: number,
  offsetY: number,
): void {
  const dto = entry.content;
  const layout = computeJourneyLayout(doc, dto, scale);
  const showTitle = dto.render_hints?.show_title !== false;
  const navLinks = entry.navLinks;

  // Helper to transform coordinates
  const tx = (x: number) => offsetX + x;
  const ty = (y: number) => offsetY + y;

  // --- Header block ---
  if (showTitle) {
    const hx = tx(J_CANVAS_PADDING_LEFT * scale);
    const hy = ty(layout.headerBlockY);
    const hw = layout.headerBlockWidth;
    const hh = J_HEADER_BLOCK_HEIGHT * scale;

    // Border around header + nav
    doc.save();
    doc.rect(hx, hy, hw, hh + (J_NAV_BOX_HEIGHT + J_HEADER_NAV_GAP) * scale);
    doc.strokeColor(HEADER_BORDER_COLOR).lineWidth(2 * scale).stroke();
    doc.restore();

    // Purple background
    doc.save();
    doc.rect(hx, hy, hw, hh).fillColor(HEADER_BG_COLOR).fill();
    doc.restore();

    // Title text
    const titleText = `${dto.journey?.name || 'User Journey'}`;
    const padL = 16 * scale;
    const padT = 10 * scale;
    doc.font('Helvetica-Bold').fontSize(J_TITLE_FONT_SIZE * scale).fillColor('#FFFFFF');
    doc.text(titleText, hx + padL, hy + padT, { width: hw - padL * 2 });

    // Summary text
    const bpName = dto.journey?.parent_business_process_name || '';
    const userName = dto.journey?.user_role_name || '';
    if (bpName || userName) {
      const summaryText = `${userName} — ${bpName}`;
      doc.font('Helvetica').fontSize(J_SUMMARY_FONT_SIZE * scale).fillColor('#FFFFFF');
      doc.text(summaryText, hx + padL, hy + padT + J_TITLE_FONT_SIZE * scale * 1.3 + 4 * scale, { width: hw - padL * 2 });
    }

    // Navigation box (white background)
    const navY = ty(layout.navBoxY);
    const navH = J_NAV_BOX_HEIGHT * scale;
    doc.save();
    doc.rect(hx, navY, hw, navH).fillColor('#FFFFFF').fill();
    doc.restore();

    // Nav links text
    let navTextY = navY + 8 * scale;
    const navPadL = hx + padL;
    const navMaxW = hw - padL * 2;
    doc.font('Helvetica-Bold').fontSize(J_NAV_FONT_SIZE * scale).fillColor('#333333');

    // Parent Overview link
    doc.text('Parent Overview: ', navPadL, navTextY, { width: navMaxW, continued: true });
    if (navLinks?.parentOverview) {
      const targetPage = pageNumberMap.get(navLinks.parentOverview.id);
      doc.font('Helvetica').fillColor(LINK_TEXT_COLOR);
      const linkText = navLinks.parentOverview.name;
      doc.text(linkText, { underline: true, continued: false });
      if (targetPage) {
        const linkW = measureTextWidth(doc, linkText, J_NAV_FONT_SIZE * scale);
        const labelW = measureTextWidth(doc, 'Parent Overview: ', J_NAV_FONT_SIZE * scale, 'Helvetica-Bold');
        doc.goTo(navPadL + labelW, navTextY, linkW, J_NAV_FONT_SIZE * scale * 1.3, `dest_${navLinks.parentOverview.id}`);
      }
    } else {
      doc.font('Helvetica').fillColor('#888888').text('None', { continued: false });
    }

    navTextY += (J_NAV_FONT_SIZE + 6) * scale;

    // Linked Journeys
    doc.font('Helvetica-Bold').fontSize(J_NAV_FONT_SIZE * scale).fillColor('#333333');
    doc.text('Linked Journeys: ', navPadL, navTextY, { width: navMaxW, continued: true });
    if (navLinks?.linkedJourneys && navLinks.linkedJourneys.length > 0) {
      for (let li = 0; li < navLinks.linkedJourneys.length; li++) {
        const lj = navLinks.linkedJourneys[li];
        const targetPage = pageNumberMap.get(lj.id);
        doc.font('Helvetica').fillColor(LINK_TEXT_COLOR);
        const isLast = li === navLinks.linkedJourneys.length - 1;
        doc.text(lj.name + (isLast ? '' : ', '), { underline: true, continued: !isLast });
        // Link annotation — approximate position
        if (targetPage) {
          doc.goTo(navPadL, navTextY, navMaxW, J_NAV_FONT_SIZE * scale * 1.3, `dest_${lj.id}`);
        }
      }
    } else {
      doc.font('Helvetica').fillColor('#888888').text('None', { continued: false });
    }
  }

  // --- Lanes ---
  for (let i = 0; i < layout.laneRects.length; i++) {
    const lr = layout.laneRects[i];
    const bgColor = LANE_COLORS[i % LANE_COLORS.length];

    // Lane background
    doc.save();
    doc.rect(tx(lr.x), ty(lr.y), lr.width, lr.height).fillColor(bgColor).fill();
    doc.restore();

    // Lane header
    const hr = lr.headerRect;
    doc.save();
    doc.rect(tx(hr.x), ty(hr.y), hr.width, hr.height).fillColor(LANE_HEADER_BG).fill();
    doc.restore();

    // Lane header text (rotated for horizontal layout, horizontal for vertical)
    const laneAxis = dto.render_hints?.lane_axis || 'HORIZONTAL';
    if (laneAxis === 'HORIZONTAL') {
      // Rotated text in narrow left header
      doc.save();
      doc.translate(tx(hr.x + hr.width / 2), ty(hr.y + hr.height / 2));
      doc.rotate(-90);
      doc.font('Helvetica-Bold').fontSize(J_LANE_HEADER_FONT_SIZE * scale).fillColor(LANE_HEADER_TEXT_COLOR);
      doc.text(lr.name, -hr.height / 2, -J_LANE_HEADER_FONT_SIZE * scale / 2, { width: hr.height, align: 'center' });
      doc.restore();
    } else {
      // Centered horizontal text
      doc.font('Helvetica-Bold').fontSize(J_LANE_HEADER_FONT_SIZE * scale).fillColor(LANE_HEADER_TEXT_COLOR);
      doc.text(lr.name, tx(hr.x), ty(hr.y + hr.height / 2 - J_LANE_HEADER_FONT_SIZE * scale / 2), { width: hr.width, align: 'center' });
    }
  }

  // --- Edges ---
  for (const { edge, waypoint } of layout.edges) {
    const isCross = edge.is_cross_lane;
    const color = isCross ? CROSS_LANE_EDGE_COLOR : EDGE_COLOR;
    doc.save();
    doc.strokeColor(color).lineWidth(J_EDGE_STROKE_WIDTH * scale);
    if (isCross) doc.dash(J_CROSS_LANE_DASH[0] * scale, { space: J_CROSS_LANE_DASH[1] * scale });
    doc.moveTo(tx(waypoint.x1), ty(waypoint.y1)).lineTo(tx(waypoint.x2), ty(waypoint.y2)).stroke();
    doc.undash();
    doc.restore();
    drawArrowhead(doc, tx(waypoint.x2), ty(waypoint.y2), tx(waypoint.x1), ty(waypoint.y1), 6 * scale, color);
  }

  // --- Steps ---
  const steps = dto.steps || [];
  for (const step of steps) {
    const pos = layout.stepPositions.get(step.id);
    if (!pos) continue;
    const sx = tx(pos.x), sy = ty(pos.y), sw = pos.width, sh = pos.height;

    // Step outline
    drawRoundedRect(doc, sx, sy, sw, sh, J_STEP_BORDER_RADIUS * scale, STEP_FILL, STEP_STROKE, scale);

    // Colored header
    const interactionLevel = step.user_interaction_level || 'DEFAULT';
    const headerColor = INTERACTION_LEVEL_COLORS[interactionLevel] || INTERACTION_LEVEL_COLORS.DEFAULT;
    const headerH = computeStepHeaderHeight(doc, step, scale);
    drawRoundedRect(doc, sx, sy, sw, headerH, J_STEP_BORDER_RADIUS * scale, headerColor);
    // Clip bottom corners of header (draw over with white if header is shorter than full box)
    if (headerH < sh) {
      doc.save();
      doc.rect(sx, sy + headerH - J_STEP_BORDER_RADIUS * scale, sw, J_STEP_BORDER_RADIUS * scale).fillColor(headerColor).fill();
      doc.restore();
    }

    // Header label
    const label = step.diagram_label || step.name || '';
    const textPad = J_STEP_INNER_PADDING * scale;
    doc.font('Helvetica-Bold').fontSize(J_STEP_NAME_FONT_SIZE * scale).fillColor('#333333');
    doc.text(label, sx + textPad, sy + J_STEP_HEADER_PADDING * scale / 2, { width: sw - textPad * 2 });

    // Content below header — vertically centered in available space
    const totalContentH = computeStepContentHeight(doc, step, scale);
    const availableContentH = sh - headerH;
    const contentOffset = Math.max(4 * scale, (availableContentH - totalContentH) / 2);
    let contentY = sy + headerH + contentOffset;
    let sectionsDrawn = 0;

    // Frequency
    if (step.frequency?.trim()) {
      if (sectionsDrawn > 0) { drawSeparator(doc, sx + textPad, contentY, sw - textPad * 2, scale); contentY += J_STEP_SEPARATOR_HEIGHT * scale; }
      doc.font('Helvetica').fontSize(J_STEP_DETAIL_FONT_SIZE * scale).fillColor('#555555');
      doc.text(`Frequency: ${step.frequency.trim()}`, sx + textPad, contentY, { width: sw - textPad * 2 });
      contentY += (J_STEP_DETAIL_FONT_SIZE + 4) * scale;
      sectionsDrawn++;
    }

    // Co-workers
    const coWorkerLinks = step.co_worker_links || [];
    if (coWorkerLinks.length > 0) {
      if (sectionsDrawn > 0) { drawSeparator(doc, sx + textPad, contentY, sw - textPad * 2, scale); contentY += J_STEP_SEPARATOR_HEIGHT * scale; }
      for (const cw of coWorkerLinks) {
        const sentence = `Works on activity with ${cw.abbreviation}`;
        const diagramId = entry.navLinks?.coWorkerDiagramMap?.[cw.user_journey_id];
        if (diagramId) {
          const targetPage = pageNumberMap.get(diagramId);
          doc.font('Helvetica').fontSize(J_STEP_DETAIL_FONT_SIZE * scale).fillColor(LINK_TEXT_COLOR);
          doc.text(sentence, sx + textPad, contentY, { width: sw - textPad * 2, underline: true });
          if (targetPage) {
            doc.goTo(sx + textPad, contentY, sw - textPad * 2, (J_STEP_DETAIL_FONT_SIZE + 4) * scale, `dest_${diagramId}`);
          }
        } else {
          doc.font('Helvetica').fontSize(J_STEP_DETAIL_FONT_SIZE * scale).fillColor('#333333');
          doc.text(sentence, sx + textPad, contentY, { width: sw - textPad * 2 });
        }
        contentY += (J_STEP_DETAIL_FONT_SIZE + 4) * scale;
      }
      sectionsDrawn++;
    } else if (step.co_worker_abbreviations?.length > 0) {
      if (sectionsDrawn > 0) { drawSeparator(doc, sx + textPad, contentY, sw - textPad * 2, scale); contentY += J_STEP_SEPARATOR_HEIGHT * scale; }
      for (const abbr of step.co_worker_abbreviations) {
        doc.font('Helvetica').fontSize(J_STEP_DETAIL_FONT_SIZE * scale).fillColor('#333333');
        doc.text(`Works on activity with ${abbr}`, sx + textPad, contentY, { width: sw - textPad * 2 });
        contentY += (J_STEP_DETAIL_FONT_SIZE + 4) * scale;
      }
      sectionsDrawn++;
    }

    // Issues
    if (step.activity_issues?.trim() || step.ui_issues?.trim()) {
      if (sectionsDrawn > 0) { drawSeparator(doc, sx + textPad, contentY, sw - textPad * 2, scale); contentY += J_STEP_SEPARATOR_HEIGHT * scale; }
      const issueTextX = sx + textPad + J_ISSUE_ICON_WIDTH * scale;
      const issueW = sw - textPad * 2 - J_ISSUE_ICON_WIDTH * scale;
      if (step.activity_issues?.trim()) {
        // Warning triangle icon
        const iconSize = J_STEP_DETAIL_FONT_SIZE * scale;
        drawWarningTriangle(doc, sx + textPad, contentY + 1 * scale, iconSize, WARNING_COLOR);
        doc.font('Helvetica').fontSize(J_STEP_DETAIL_FONT_SIZE * scale).fillColor(WARNING_COLOR);
        const h = measureTextHeight(doc, step.activity_issues.trim(), J_STEP_DETAIL_FONT_SIZE * scale, issueW);
        doc.text(step.activity_issues.trim(), issueTextX, contentY, { width: issueW });
        contentY += h + 4 * scale;
      }
      if (step.ui_issues?.trim()) {
        // Warning triangle icon
        const iconSize = J_STEP_DETAIL_FONT_SIZE * scale;
        drawWarningTriangle(doc, sx + textPad, contentY + 1 * scale, iconSize, WARNING_COLOR);
        doc.font('Helvetica').fontSize(J_STEP_DETAIL_FONT_SIZE * scale).fillColor(WARNING_COLOR);
        doc.text(step.ui_issues.trim(), issueTextX, contentY, { width: issueW });
      }
    }
  }
}

function drawWarningTriangle(doc: PDFKit.PDFDocument, x: number, y: number, size: number, color: string): void {
  doc.save();
  const h = size * 0.9;
  const cx = x + size / 2;
  // Triangle
  doc.moveTo(cx, y).lineTo(x + size, y + h).lineTo(x, y + h).closePath().fillColor(color).fill();
  // Exclamation bar (white)
  const barW = size * 0.14;
  const barX = cx - barW / 2;
  doc.fillColor('#FFFFFF');
  doc.rect(barX, y + h * 0.28, barW, h * 0.36).fill();
  // Exclamation dot (white)
  doc.circle(cx, y + h * 0.78, barW * 0.7).fill();
  doc.restore();
}

function computeStepContentHeight(doc: PDFKit.PDFDocument, step: any, scale: number): number {
  let contentH = 0;
  let sectionCount = 0;

  if (step.frequency?.trim()) {
    contentH += (J_STEP_DETAIL_FONT_SIZE + 4) * scale;
    sectionCount++;
  }

  const coWorkerCount = (step.co_worker_links?.length || 0) || (step.co_worker_abbreviations?.length || 0);
  if (coWorkerCount > 0) {
    contentH += coWorkerCount * (J_STEP_DETAIL_FONT_SIZE + 4) * scale;
    sectionCount++;
  }

  const hasActivityIssues = !!step.activity_issues?.trim();
  const hasUiIssues = !!step.ui_issues?.trim();
  const issueWidth = (J_STEP_NODE_WIDTH - 2 * J_STEP_INNER_PADDING - J_ISSUE_ICON_WIDTH) * scale;
  if (hasActivityIssues) {
    const h = measureTextHeight(doc, step.activity_issues.trim(), J_STEP_DETAIL_FONT_SIZE * scale, issueWidth);
    contentH += h + (hasUiIssues ? 4 * scale : 0);
  }
  if (hasUiIssues) {
    contentH += measureTextHeight(doc, step.ui_issues.trim(), J_STEP_DETAIL_FONT_SIZE * scale, issueWidth);
  }
  if (hasActivityIssues || hasUiIssues) sectionCount++;

  if (sectionCount > 1) {
    contentH += (sectionCount - 1) * J_STEP_SEPARATOR_HEIGHT * scale;
  }

  return contentH;
}

function drawSeparator(doc: PDFKit.PDFDocument, x: number, y: number, width: number, scale: number): void {
  doc.save();
  doc.strokeColor('#CCCCCC').lineWidth(0.5 * scale);
  doc.dash(3 * scale, { space: 2 * scale });
  doc.moveTo(x, y + 4 * scale).lineTo(x + width, y + 4 * scale).stroke();
  doc.undash();
  doc.restore();
}

// ============================================================================
// USER_JOURNEY_OVERVIEW: Layout Computation
// ============================================================================

function decideLaneOrder(lanes: any[], nodes: any[], edges: any[]): any[] {
  if (lanes.length <= 1) return [...lanes].sort((a, b) => a.order - b.order);
  const nodeLane = new Map<string, string>();
  for (const node of nodes) nodeLane.set(node.id, node.lane_id);

  const laneIds = new Set(lanes.map((l: any) => l.id));
  const laneOut = new Map<string, Set<string>>();
  const laneIn = new Map<string, number>();
  for (const l of lanes) { laneOut.set(l.id, new Set()); laneIn.set(l.id, 0); }

  for (const edge of edges) {
    const src = nodeLane.get(edge.source_node_id);
    const tgt = nodeLane.get(edge.target_node_id);
    if (src && tgt && src !== tgt && laneIds.has(src) && laneIds.has(tgt) && !laneOut.get(src)!.has(tgt)) {
      laneOut.get(src)!.add(tgt);
      laneIn.set(tgt, (laneIn.get(tgt) || 0) + 1);
    }
  }

  const laneMap = new Map(lanes.map((l: any) => [l.id, l]));
  const queue = lanes.filter((l: any) => (laneIn.get(l.id) || 0) === 0).sort((a: any, b: any) => a.order - b.order).map((l: any) => l.id);
  const ordered: string[] = [];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    ordered.push(cur);
    for (const tgt of laneOut.get(cur) || []) {
      laneIn.set(tgt, (laneIn.get(tgt) || 0) - 1);
      if ((laneIn.get(tgt) || 0) <= 0 && !visited.has(tgt)) {
        queue.push(tgt);
        queue.sort((a, b) => laneMap.get(a)!.order - laneMap.get(b)!.order);
      }
    }
  }
  for (const l of [...lanes].sort((a: any, b: any) => a.order - b.order)) { if (!visited.has(l.id)) ordered.push(l.id); }
  return ordered.map(id => laneMap.get(id)!);
}

function decideNodeOrder(laneNodes: any[], edges: any[]): any[] {
  if (laneNodes.length <= 1) return laneNodes;
  const nodeIds = new Set(laneNodes.map((n: any) => n.id));
  const outD = new Map<string, Set<string>>();
  const inD = new Map<string, number>();
  for (const n of laneNodes) { outD.set(n.id, new Set()); inD.set(n.id, 0); }
  for (const edge of edges) {
    if (nodeIds.has(edge.source_node_id) && nodeIds.has(edge.target_node_id)) {
      outD.get(edge.source_node_id)!.add(edge.target_node_id);
      inD.set(edge.target_node_id, (inD.get(edge.target_node_id) || 0) + 1);
    }
  }
  const queue = laneNodes.filter((n: any) => (inD.get(n.id) || 0) === 0).sort((a: any, b: any) => a.name.localeCompare(b.name)).map((n: any) => n.id);
  const ordered: string[] = [];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    ordered.push(cur);
    for (const tgt of outD.get(cur) || []) {
      inD.set(tgt, (inD.get(tgt) || 0) - 1);
      if ((inD.get(tgt) || 0) <= 0 && !visited.has(tgt)) {
        queue.push(tgt);
        queue.sort((a, b) => { const na = laneNodes.find((n: any) => n.id === a)!; const nb = laneNodes.find((n: any) => n.id === b)!; return na.name.localeCompare(nb.name); });
      }
    }
  }
  for (const n of [...laneNodes].sort((a: any, b: any) => a.name.localeCompare(b.name))) { if (!visited.has(n.id)) ordered.push(n.id); }
  const nMap = new Map(laneNodes.map((n: any) => [n.id, n]));
  return ordered.map(id => nMap.get(id)!);
}

function computeOverviewNodeHeight(node: any, scale: number): number {
  const appCount = node.metadata?.applications?.length ?? 0;
  if (appCount === 0) return 90 * scale;
  const gridRows = Math.ceil(appCount / O_APPS_PER_ROW);
  return (64 + gridRows * (O_APP_BOX_HEIGHT + O_APP_BOX_GAP_Y) + O_APP_BOX_GAP_Y) * scale;
}

interface OverviewLayout {
  sortedLanes: any[];
  laneRects: LaneRect[];
  nodePositions: Map<string, { x: number; y: number; width: number; height: number }>;
  edges: Array<{ edge: any; waypoint: EdgeWaypoint }>;
  headerBlockY: number;
  headerBlockWidth: number;
  navBoxY: number;
  contentWidth: number;
  contentHeight: number;
}

function computeOverviewLayout(dto: any, scale: number): OverviewLayout {
  const lanes = dto.lanes || [];
  const nodes = dto.nodes || [];
  const edges = dto.edges || [];
  const showTitle = dto.render_hints?.show_title !== false;
  const hasColleagues = dto.related_colleagues !== undefined;

  const sortedLanes = decideLaneOrder(lanes, nodes, edges);

  // Group and order nodes by lane
  const nodesByLane = new Map<string, any[]>();
  for (const node of nodes) {
    const arr = nodesByLane.get(node.lane_id) || [];
    arr.push(node);
    nodesByLane.set(node.lane_id, arr);
  }
  for (const [key, arr] of nodesByLane) {
    nodesByLane.set(key, decideNodeOrder(arr, edges));
  }

  // Header area
  const headerBlockY = O_CANVAS_PADDING_TOP * scale;
  const headerHeight = showTitle ? O_HEADER_BLOCK_HEIGHT * scale : 0;
  const navHeight = (showTitle && hasColleagues) ? (O_NAV_BOX_HEIGHT + O_HEADER_NAV_GAP) * scale : 0;
  const totalHeaderArea = headerHeight + navHeight + (showTitle ? O_NAV_LANE_GAP * scale : 0);
  const baseY = O_CANVAS_PADDING_TOP * scale + totalHeaderArea;
  const baseX = O_CANVAS_PADDING_LEFT * scale;

  const columnWidth = Math.max(O_MIN_LANE_WIDTH, O_NODE_WIDTH + 2 * O_LANE_CONTENT_PADDING) * scale;

  // Max column content height
  let maxColContentH = 0;
  for (const arr of nodesByLane.values()) {
    let h = O_LANE_CONTENT_PADDING * scale;
    for (const node of arr) { h += computeOverviewNodeHeight(node, scale) + O_NODE_SPACING_Y * scale; }
    maxColContentH = Math.max(maxColContentH, h);
  }
  if (maxColContentH === 0) maxColContentH = (90 + O_NODE_SPACING_Y + O_LANE_CONTENT_PADDING) * scale;
  const totalColH = O_LANE_HEADER_HEIGHT * scale + maxColContentH;

  const laneRects: LaneRect[] = [];
  const nodePositions = new Map<string, { x: number; y: number; width: number; height: number }>();

  let cumLaneX = baseX;
  for (const lane of sortedLanes) {
    laneRects.push({
      x: cumLaneX, y: baseY, width: columnWidth, height: totalColH, name: lane.name,
      headerRect: { x: cumLaneX, y: baseY, width: columnWidth, height: O_LANE_HEADER_HEIGHT * scale },
    });

    const laneNodes = nodesByLane.get(lane.id) || [];
    let curNodeY = baseY + O_LANE_HEADER_HEIGHT * scale + O_LANE_CONTENT_PADDING * scale;
    for (const node of laneNodes) {
      const nh = computeOverviewNodeHeight(node, scale);
      const nx = cumLaneX + (columnWidth - O_NODE_WIDTH * scale) / 2;
      nodePositions.set(node.id, { x: nx, y: curNodeY, width: O_NODE_WIDTH * scale, height: nh });
      curNodeY += nh + O_NODE_SPACING_Y * scale;
    }

    cumLaneX += columnWidth;
  }

  // Edge waypoints
  const edgeWaypoints: Array<{ edge: any; waypoint: EdgeWaypoint }> = [];
  for (const edge of edges) {
    const from = nodePositions.get(edge.source_node_id);
    const to = nodePositions.get(edge.target_node_id);
    if (!from || !to) continue;
    const fcx = from.x + from.width / 2, fcy = from.y + from.height / 2;
    const tcx = to.x + to.width / 2, tcy = to.y + to.height / 2;
    const dx = tcx - fcx, dy = tcy - fcy;
    let x1: number, y1: number, x2: number, y2: number;
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx >= 0) { x1 = from.x + from.width; y1 = fcy; x2 = to.x; y2 = tcy; }
      else { x1 = from.x; y1 = fcy; x2 = to.x + to.width; y2 = tcy; }
    } else {
      if (dy >= 0) { x1 = fcx; y1 = from.y + from.height; x2 = tcx; y2 = to.y; }
      else { x1 = fcx; y1 = from.y; x2 = tcx; y2 = to.y + to.height; }
    }
    edgeWaypoints.push({ edge, waypoint: { x1, y1, x2, y2 } });
  }

  // Content bounds
  let maxX = 0, maxY = 0;
  const singleColW = Math.max(O_MIN_LANE_WIDTH, O_NODE_WIDTH + 2 * O_LANE_CONTENT_PADDING) * scale;
  const totalLanesW = sortedLanes.length * singleColW;
  const headerBlockWidth = Math.max(singleColW * 3, totalLanesW, 500 * scale);
  maxX = Math.max(baseX + headerBlockWidth);
  for (const lr of laneRects) { maxX = Math.max(maxX, lr.x + lr.width); maxY = Math.max(maxY, lr.y + lr.height); }
  for (const np of nodePositions.values()) { maxX = Math.max(maxX, np.x + np.width); maxY = Math.max(maxY, np.y + np.height); }

  const contentWidth = maxX + O_CONTENT_BOUNDS_PADDING * scale;
  const contentHeight = maxY + O_CONTENT_BOUNDS_PADDING * scale;
  const navBoxY = headerBlockY + O_HEADER_BLOCK_HEIGHT * scale + O_HEADER_NAV_GAP * scale;

  return { sortedLanes, laneRects, nodePositions, edges: edgeWaypoints, headerBlockY, headerBlockWidth, navBoxY, contentWidth, contentHeight };
}

// ============================================================================
// USER_JOURNEY_OVERVIEW: Drawing
// ============================================================================

function drawOverviewDiagram(
  doc: PDFKit.PDFDocument,
  entry: PdfDiagramEntry,
  pageNumberMap: Map<string, number>,
  scale: number,
  offsetX: number,
  offsetY: number,
): void {
  const dto = entry.content;
  const layout = computeOverviewLayout(dto, scale);
  const showTitle = dto.render_hints?.show_title !== false;
  const showLaneHeaders = dto.render_hints?.show_lane_headers !== false;
  const showNodeDesc = dto.render_hints?.show_node_description !== false;
  const showEdgeLabels = dto.render_hints?.show_relationship_labels !== false;
  const hasColleagues = dto.related_colleagues !== undefined;

  const tx = (x: number) => offsetX + x;
  const ty = (y: number) => offsetY + y;

  // --- Header block ---
  if (showTitle) {
    const hx = tx(O_CANVAS_PADDING_LEFT * scale);
    const hy = ty(layout.headerBlockY);
    const hw = layout.headerBlockWidth;
    const hh = O_HEADER_BLOCK_HEIGHT * scale;

    // Border
    const totalBorderH = hh + (hasColleagues ? O_NAV_BOX_HEIGHT * scale : 0);
    doc.save().rect(hx, hy, hw, totalBorderH).strokeColor(HEADER_BORDER_COLOR).lineWidth(2 * scale).stroke().restore();

    // Purple background
    doc.save().rect(hx, hy, hw, hh).fillColor(HEADER_BG_COLOR).fill().restore();

    // Title text
    const padL = 16 * scale;
    const padT = 10 * scale;
    doc.font('Helvetica-Bold').fontSize(O_TITLE_FONT_SIZE * scale).fillColor('#FFFFFF');
    doc.text(dto.overview?.title || 'User Journey Overview', hx + padL, hy + padT, { width: hw - padL * 2 });

    // Summary sentence
    const sc = dto.summary_counts;
    if (sc) {
      const buName = dto.overview?.business_user_name || '';
      const summaryText = `${buName} is involved in ${sc.journey_count} User Journeys across ${sc.business_process_count} Business Processes, ${sc.activity_step_count} Activity Steps and ${sc.application_count} Applications`;
      doc.font('Helvetica').fontSize(O_SUMMARY_FONT_SIZE * scale).fillColor('#FFFFFF');
      doc.text(summaryText, hx + padL, hy + padT + O_TITLE_FONT_SIZE * scale * 1.3 + 4 * scale, { width: hw - padL * 2 });
    }

    // Colleagues nav box
    if (hasColleagues) {
      const navY = ty(layout.navBoxY);
      const navH = O_NAV_BOX_HEIGHT * scale;
      doc.save().rect(hx, navY, hw, navH).fillColor('#FFFFFF').fill().restore();

      const navTextY = navY + 8 * scale;
      const fontSize = O_COLLEAGUES_FONT_SIZE * scale;

      // Draw label
      doc.font('Helvetica-Bold').fontSize(fontSize).fillColor('#333333');
      const labelText = 'Related User Journey Overviews: ';
      const labelWidth = doc.widthOfString(labelText);
      doc.text(labelText, hx + padL, navTextY);
      let cursorX = hx + padL + labelWidth;

      const colleagues = dto.related_colleagues || [];
      if (colleagues.length === 0) {
        doc.font('Helvetica').fontSize(fontSize).fillColor('#888888');
        doc.text('No related colleagues defined yet', cursorX, navTextY);
      } else {
        for (let ci = 0; ci < colleagues.length; ci++) {
          const col = colleagues[ci];
          const isLast = ci === colleagues.length - 1;
          const nameText = col.business_user_name;
          const suffix = isLast ? '' : ', ';

          if (col.has_overview) {
            // Draw underlined link name
            doc.font('Helvetica').fontSize(fontSize).fillColor(LINK_TEXT_COLOR);
            const nameW = doc.widthOfString(nameText);
            doc.text(nameText, cursorX, navTextY, { underline: true });

            // Position goTo precisely on this name
            const targetPage = pageNumberMap.get(`overview:${col.business_user_name}`);
            if (targetPage) {
              doc.goTo(cursorX, navTextY, nameW, fontSize + 4 * scale, `dest_overview_${col.business_user_name}`);
            }
            cursorX += nameW;

            // Draw comma separator without underline
            if (suffix) {
              doc.fillColor('#333333');
              doc.text(suffix, cursorX, navTextY, { underline: false });
              cursorX += doc.widthOfString(suffix);
            }
          } else {
            doc.font('Helvetica').fontSize(fontSize).fillColor('#888888');
            const fullText = nameText + suffix;
            doc.text(fullText, cursorX, navTextY);
            cursorX += doc.widthOfString(fullText);
          }
        }
      }
    }
  }

  // --- Lanes ---
  if (showLaneHeaders) {
    for (let i = 0; i < layout.laneRects.length; i++) {
      const lr = layout.laneRects[i];
      const bgColor = LANE_COLORS[i % LANE_COLORS.length];

      // Background
      doc.save().rect(tx(lr.x), ty(lr.y), lr.width, lr.height).fillColor(bgColor).fill().restore();
      doc.save().rect(tx(lr.x), ty(lr.y), lr.width, lr.height).strokeColor('#D0D5DD').lineWidth(0.5 * scale).stroke().restore();

      // Header
      const hr = lr.headerRect;
      doc.save().rect(tx(hr.x), ty(hr.y), hr.width, hr.height).fillColor(LANE_HEADER_BG).fill().restore();
      doc.save().rect(tx(hr.x), ty(hr.y), hr.width, hr.height).strokeColor(HEADER_BORDER_COLOR).lineWidth(0.5 * scale).stroke().restore();

      // Header text (centered)
      doc.font('Helvetica-Bold').fontSize(O_LANE_HEADER_FONT_SIZE * scale).fillColor(LANE_HEADER_TEXT_COLOR);
      doc.text(lr.name, tx(hr.x), ty(hr.y + hr.height / 2 - O_LANE_HEADER_FONT_SIZE * scale / 2), { width: hr.width, align: 'center' });
    }
  }

  // --- Edges ---
  for (const { edge, waypoint } of layout.edges) {
    doc.save();
    doc.strokeColor(EDGE_COLOR).lineWidth(O_EDGE_STROKE_WIDTH * scale);
    doc.moveTo(tx(waypoint.x1), ty(waypoint.y1)).lineTo(tx(waypoint.x2), ty(waypoint.y2)).stroke();
    doc.restore();
    drawArrowhead(doc, tx(waypoint.x2), ty(waypoint.y2), tx(waypoint.x1), ty(waypoint.y1), 6 * scale, EDGE_COLOR);

    // Edge label
    if (showEdgeLabels && edge.label) {
      const midX = (waypoint.x1 + waypoint.x2) / 2;
      const midY = (waypoint.y1 + waypoint.y2) / 2;
      doc.font('Helvetica-Oblique').fontSize(O_EDGE_LABEL_FONT_SIZE * scale).fillColor(EDGE_COLOR);
      doc.text(edge.label, tx(midX) - 40 * scale, ty(midY) - 8 * scale, { width: 80 * scale, align: 'center' });
    }
  }

  // --- Nodes ---
  const allNodes = dto.nodes || [];
  for (const node of allNodes) {
    const pos = layout.nodePositions.get(node.id);
    if (!pos) continue;
    const nx = tx(pos.x), ny = ty(pos.y), nw = pos.width, nh = pos.height;

    // Node background
    drawRoundedRect(doc, nx, ny, nw, nh, O_NODE_BORDER_RADIUS * scale, STEP_FILL, STEP_STROKE, scale);

    // Determine if linked
    const linked = node.link?.link_status === 'LINKED' || node.link?.link_status === 'AMBIGUOUS_RESOLVED';
    const linkedDiagramId = linked ? node.link?.linked_diagram_id : undefined;
    const nameColor = linked ? LINK_TEXT_COLOR : '#333333';
    const nameUnderline = linked;

    // Node name (centered, with word wrap)
    doc.font('Helvetica-Bold').fontSize(O_NODE_NAME_FONT_SIZE * scale).fillColor(nameColor);
    doc.text(node.name, nx + 8 * scale, ny + 6 * scale, { width: nw - 16 * scale, align: 'center', underline: nameUnderline });

    // Clickable link on the whole node box
    if (linkedDiagramId) {
      const targetPage = pageNumberMap.get(linkedDiagramId);
      if (targetPage) {
        doc.goTo(nx, ny, nw, nh, `dest_${linkedDiagramId}`);
      }
    }

    // Description
    if (showNodeDesc && node.description) {
      const descText = node.description.length > O_MAX_DESC_CHARS ? node.description.substring(0, O_MAX_DESC_CHARS - 3) + '...' : node.description;
      doc.font('Helvetica').fontSize(O_NODE_DESC_FONT_SIZE * scale).fillColor('#666666');
      doc.text(descText, nx + 8 * scale, ny + 34 * scale, { width: nw - 16 * scale, align: 'center' });
    }

    // App grid
    const apps = node.metadata?.applications || [];
    if (apps.length > 0) {
      // Activity steps summary (larger font, with gap before app boxes)
      const summaryFontSize = 13 * scale;
      doc.font('Helvetica').fontSize(summaryFontSize).fillColor('#666666');
      const summaryText = `${node.metadata.step_count} activity step${node.metadata.step_count !== 1 ? 's' : ''} across ${node.metadata.application_count} app${node.metadata.application_count !== 1 ? 's' : ''}:`;
      doc.text(summaryText, nx + 10 * scale, ny + 48 * scale, { width: nw - 20 * scale });
      const summaryBottom = ny + 48 * scale + summaryFontSize + 2 * scale;
      const appGridY = summaryBottom + 6 * scale; // at least 6px gap below text

      for (let ai = 0; ai < apps.length; ai++) {
        const col = ai % O_APPS_PER_ROW;
        const row = Math.floor(ai / O_APPS_PER_ROW);
        const ax = nx + 10 * scale + col * (O_APP_BOX_WIDTH + O_APP_BOX_GAP_X) * scale;
        const ay = appGridY + row * (O_APP_BOX_HEIGHT + O_APP_BOX_GAP_Y) * scale;
        const aw = O_APP_BOX_WIDTH * scale;
        const ah = O_APP_BOX_HEIGHT * scale;

        drawRoundedRect(doc, ax, ay, aw, ah, 4 * scale, '#E3F2FD', '#90CAF9', scale);
        doc.font('Helvetica-Bold').fontSize(12 * scale).fillColor('#1565C0');
        doc.text(apps[ai].abbreviation, ax, ay + ah / 2 - 6 * scale, { width: aw, align: 'center' });
      }
    } else {
      // Fallback badges
      const badgeY = ny + nh - 20 * scale;
      drawRoundedRect(doc, nx + 10 * scale, badgeY, 60 * scale, 16 * scale, 3 * scale, O_BADGE_BG);
      doc.font('Helvetica').fontSize(O_BADGE_FONT_SIZE * scale).fillColor(O_BADGE_TEXT_COLOR);
      doc.text(`${node.metadata?.step_count || 0} steps`, nx + 10 * scale, badgeY + 3 * scale, { width: 60 * scale, align: 'center' });

      drawRoundedRect(doc, nx + 78 * scale, badgeY, 56 * scale, 16 * scale, 3 * scale, O_BADGE_BG);
      doc.text(`${node.metadata?.application_count || 0} apps`, nx + 78 * scale, badgeY + 3 * scale, { width: 56 * scale, align: 'center' });
    }
  }
}

// ============================================================================
// Title Page
// ============================================================================

function drawTitlePage(doc: PDFKit.PDFDocument, projectName: string, groups: PdfDiagramGroup[]): void {
  // Strip file extension
  const dotIdx = projectName.lastIndexOf('.');
  const cleanName = dotIdx > 0 ? projectName.substring(0, dotIdx) : projectName;

  doc.font('Helvetica-Bold').fontSize(24).fillColor('#000000');
  doc.text(cleanName, 0, 200, { width: A4_W, align: 'center' });

  // Date
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const d = new Date();
  const dateStr = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  doc.font('Helvetica').fontSize(14).fillColor('#666666');
  doc.text(dateStr, 0, 240, { width: A4_W, align: 'center' });

  // Summary
  let totalJ = 0, totalO = 0;
  for (const g of groups) {
    for (const e of g.diagrams) {
      if (e.type === 'USER_JOURNEY') totalJ++;
      if (e.type === 'USER_JOURNEY_OVERVIEW') totalO++;
    }
  }
  const summary = `${groups.length} Business Users, ${totalJ} User Journey Diagrams, ${totalO} Overview Diagrams`;
  doc.font('Helvetica').fontSize(12).fillColor('#000000');
  doc.text(summary, 0, 270, { width: A4_W, align: 'center' });
}

// ============================================================================
// Table of Contents
// ============================================================================

function drawTableOfContents(doc: PDFKit.PDFDocument, tocEntries: TocEntry[], pageNumberMap: Map<string, number>): number {
  doc.addPage({ size: 'A4', layout: 'portrait' });

  const leftMargin = 50;
  const indentMargin = 65;
  const rightAlignX = A4_W - 50;
  const bottomLimit = A4_H - 60;

  doc.font('Helvetica-Bold').fontSize(18).fillColor('#000000');
  doc.text('Table of Contents', leftMargin, 50);

  let yPos = 75;
  let tocPagesAdded = 1;

  for (const entry of tocEntries) {
    if (yPos > bottomLimit) {
      doc.addPage({ size: 'A4', layout: 'portrait' });
      tocPagesAdded++;
      yPos = 50;
    }

    if (entry.isSection) {
      doc.font('Helvetica-Bold').fontSize(14).fillColor(TOC_LINK_COLOR);
      doc.text(entry.text, leftMargin, yPos);

      // Underline
      const tw = doc.widthOfString(entry.text);
      doc.save().strokeColor(TOC_LINK_COLOR).lineWidth(0.5).moveTo(leftMargin, yPos + 16).lineTo(leftMargin + tw, yPos + 16).stroke().restore();

      // Click target (use destination name for the first diagram in this group)
      if (entry.targetBusinessUserName) {
        const destName = pageNumberMap.has(`overview:${entry.targetBusinessUserName}`)
          ? `dest_overview_${entry.targetBusinessUserName}`
          : entry.targetDiagramId ? `dest_${entry.targetDiagramId}` : null;
        if (destName) doc.goTo(leftMargin, yPos - 2, tw, 18, destName);
      } else if (entry.targetDiagramId) {
        doc.goTo(leftMargin, yPos - 2, tw, 18, `dest_${entry.targetDiagramId}`);
      }

      yPos += 22;
    } else {
      // Diagram entry
      doc.font('Helvetica').fontSize(12).fillColor(TOC_LINK_COLOR);
      doc.text(entry.text, indentMargin, yPos, { width: rightAlignX - indentMargin - 40 });

      const tw = doc.widthOfString(entry.text);
      doc.save().strokeColor(TOC_LINK_COLOR).lineWidth(0.3).moveTo(indentMargin, yPos + 14).lineTo(indentMargin + Math.min(tw, rightAlignX - indentMargin - 40), yPos + 14).stroke().restore();

      // Page number
      doc.fillColor('#333333');
      doc.text(String(entry.pageNumber), rightAlignX - 30, yPos, { width: 30, align: 'right' });

      // Click target
      if (entry.targetDiagramId) {
        doc.goTo(indentMargin, yPos - 2, rightAlignX - indentMargin, 16, `dest_${entry.targetDiagramId}`);
      }

      yPos += 18;
    }
  }

  return tocPagesAdded;
}

// ============================================================================
// Main Orchestrator
// ============================================================================

export async function generatePdf(request: PdfGenerationRequest, outputDir: string): Promise<PdfGenerationResult> {
  const { projectName, groups } = request;

  if (groups.length === 0) {
    return { success: false, error: 'No diagram groups provided.' };
  }

  try {
    // Ensure output directory exists
    await fs.promises.mkdir(outputDir, { recursive: true });

    // Build output filename
    const dotIdx = projectName.lastIndexOf('.');
    const baseName = dotIdx > 0 ? projectName.substring(0, dotIdx) : projectName;
    const filename = `${baseName} - User Journey Diagrams.pdf`;
    const outputPath = path.join(outputDir, filename);

    // Pre-compute page numbers
    // Page 1: title, page 2+: TOC, then diagram pages
    const pageNumberMap = new Map<string, number>();
    let pageCounter = 2; // after title page (page 1), TOC starts at page 2

    // Estimate TOC pages (1 page for up to ~35 entries)
    const totalEntries = groups.reduce((sum, g) => sum + 1 + g.diagrams.length, 0);
    const estimatedTocPages = Math.max(1, Math.ceil(totalEntries / 35));
    pageCounter += estimatedTocPages;

    for (const group of groups) {
      for (const diagramEntry of group.diagrams) {
        pageCounter++;
        pageNumberMap.set(diagramEntry.id, pageCounter);
        if (diagramEntry.type === 'USER_JOURNEY_OVERVIEW') {
          const buName = diagramEntry.content?.overview?.business_user_name;
          if (buName) pageNumberMap.set(`overview:${buName}`, pageCounter);
        }
      }
    }

    // Build TOC entries
    const tocEntries: TocEntry[] = [];
    let tocPageNum = 2 + estimatedTocPages; // first diagram page number
    for (const group of groups) {
      const firstDiagramId = group.diagrams[0]?.id;
      tocEntries.push({
        text: group.businessUserName,
        pageNumber: tocPageNum + 1,
        isSection: true,
        targetBusinessUserName: group.businessUserName,
        targetDiagramId: firstDiagramId,
      });
      for (const de of group.diagrams) {
        tocPageNum++;
        tocEntries.push({
          text: de.name,
          pageNumber: tocPageNum,
          isSection: false,
          targetDiagramId: de.id,
        });
      }
    }

    // Create PDF document
    const doc = new PDFDocument({ size: 'A4', layout: 'portrait', autoFirstPage: true, bufferPages: true });
    const writeStream = fs.createWriteStream(outputPath);
    doc.pipe(writeStream);

    // Page 1: Title page
    drawTitlePage(doc, projectName, groups);

    // Page 2+: Table of Contents
    const actualTocPages = drawTableOfContents(doc, tocEntries, pageNumberMap);

    // Adjust page numbers if TOC took more pages than estimated
    if (actualTocPages !== estimatedTocPages) {
      const diff = actualTocPages - estimatedTocPages;
      if (diff !== 0) {
        // Rebuild pageNumberMap with corrected offsets
        pageNumberMap.clear();
        let pc = 1 + actualTocPages;
        for (const group of groups) {
          for (const de of group.diagrams) {
            pc++;
            pageNumberMap.set(de.id, pc);
            if (de.type === 'USER_JOURNEY_OVERVIEW') {
              const buName = de.content?.overview?.business_user_name;
              if (buName) pageNumberMap.set(`overview:${buName}`, pc);
            }
          }
        }
      }
    }

    // Diagram pages
    for (const group of groups) {
      for (const entry of group.diagrams) {
        // First pass: compute layout to get content bounds (at scale=1)
        let contentWidth: number, contentHeight: number;
        if (entry.type === 'USER_JOURNEY') {
          const layout = computeJourneyLayout(doc, entry.content, 1);
          contentWidth = layout.contentWidth;
          contentHeight = layout.contentHeight;
        } else {
          const layout = computeOverviewLayout(entry.content, 1);
          contentWidth = layout.contentWidth;
          contentHeight = layout.contentHeight;
        }

        // Determine orientation
        const isLandscape = contentWidth > contentHeight * 1.3;
        const pageLayout = isLandscape ? 'landscape' : 'portrait';
        doc.addPage({ size: 'A4', layout: pageLayout });

        // Register named destinations for internal links
        doc.addNamedDestination(`dest_${entry.id}`);
        if (entry.type === 'USER_JOURNEY_OVERVIEW') {
          const buName = entry.content?.overview?.business_user_name;
          if (buName) doc.addNamedDestination(`dest_overview_${buName}`);
        }

        const pw = isLandscape ? A4_H : A4_W;
        const ph = isLandscape ? A4_W : A4_H;

        // Diagram title at top of page
        const titleBarH = 25;
        doc.font('Helvetica').fontSize(11).fillColor('#000000');
        doc.text(entry.name, PAGE_MARGIN, 20, { width: pw - PAGE_MARGIN * 2 });

        // Printable area below title
        const printableW = pw - PAGE_MARGIN * 2;
        const printableH = ph - PAGE_MARGIN - titleBarH - 20;

        // Scale to fit
        const scale = Math.min(printableW / contentWidth, printableH / contentHeight);
        const scaledW = contentWidth * scale;
        const scaledH = contentHeight * scale;

        // Center horizontally
        const offsetX = PAGE_MARGIN + (printableW - scaledW) / 2;
        const offsetY = titleBarH + 10;

        // Draw diagram
        if (entry.type === 'USER_JOURNEY') {
          drawJourneyDiagram(doc, entry, pageNumberMap, scale, offsetX, offsetY);
        } else {
          drawOverviewDiagram(doc, entry, pageNumberMap, scale, offsetX, offsetY);
        }
      }
    }

    // Finalize PDF
    doc.end();

    // Wait for write to finish
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    logger.info('PDF generated successfully', { outputPath, diagramCount: pageCounter - 2 - actualTocPages });

    return { success: true, filePath: outputPath };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('PDF generation failed', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}
