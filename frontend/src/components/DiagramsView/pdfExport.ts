/**
 * PDF Export Utility
 *
 * Generates a multi-page PDF document from all saved User Journey diagrams
 * (USER_JOURNEY and USER_JOURNEY_OVERVIEW types) entirely client-side.
 *
 * PDF structure:
 * 1. Title page (project name, date, summary)
 * 2. Table of contents with clickable links and PDF bookmarks
 * 3. Diagram pages grouped alphabetically by business user
 *
 * Uses html2canvas for off-screen DOM capture and jsPDF for PDF assembly.
 *
 * Spec 2026-04-13: Save All Diagrams as PDF
 * Task Group 2: PDF Export Utility Module
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

import type { Diagram } from '../../types/model';
import type { UserJourneyDiagramDto } from '../../types/userJourneyDiagram';
import type { UserJourneyOverviewDiagramDto } from '../../types/userJourneyOverviewDiagram';

import {
  extractUserJourneyDiagram,
  extractUserJourneyOverviewDiagram,
} from './diagramExtractionUtils';
import { enrichJourneySteps } from './journeyEnrichment';
import { enrichOverviewFull } from './overviewEnrichment';
import type { OverviewEnrichmentMetaData } from './overviewEnrichment';
import UserJourneyDiagramRenderer from './UserJourneyDiagramRenderer';
import type { JourneyNavLink } from './UserJourneyDiagramRenderer';
import UserJourneyOverviewDiagramRenderer from './UserJourneyOverviewDiagramRenderer';

// ============================================================================
// Types
// ============================================================================

/**
 * Progress state for PDF generation.
 * Used to drive inline progress text in the UI.
 */
export interface PdfGenerationProgress {
  generating: boolean;
  current: number;
  total: number;
}

/**
 * A group of diagrams belonging to a single business user.
 * Groups are sorted alphabetically by businessUserName.
 */
export interface BusinessUserDiagramGroup {
  businessUserName: string;
  diagrams: Array<{
    diagram: Diagram;
    type: 'USER_JOURNEY' | 'USER_JOURNEY_OVERVIEW';
    name: string;
  }>;
}

/**
 * A clickable link region within a rendered diagram image.
 * Coordinates are in SVG pixel space (pre-scaling).
 * Also carries text data for jsPDF overlay drawing (to fix html2canvas style loss).
 */
export interface DiagramLinkRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Target diagram ID for internal links */
  targetDiagramId?: string;
  /** Target business user name for overview colleague links */
  targetBusinessUserName?: string;
  /** Text content for jsPDF text overlay */
  text?: string;
  /** Font size in SVG px */
  fontSize?: number;
  /** Whether text is center-aligned */
  centerAlign?: boolean;
}

/**
 * Data for redrawing the header block on top of the rasterized image.
 * html2canvas loses white text color on the purple header background;
 * this overlay covers the black text with the correct purple bg + white text.
 */
export interface PdfHeaderOverlay {
  x: number;
  y: number;
  width: number;
  height: number;
  bgColor: string;
  titleText: string;
  titleFontSize: number;
  summaryText?: string;
  summaryFontSize?: number;
}

/**
 * An entry in the table of contents.
 * Section headers (isSection=true) represent business user groups.
 * Non-section entries represent individual diagrams.
 */
export interface TocEntry {
  text: string;
  pageNumber: number;
  isSection: boolean;
  targetPageIndex: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Group diagrams by business user name.
 *
 * Filters to USER_JOURNEY and USER_JOURNEY_OVERVIEW types, extracts typed content,
 * groups by user_role_name (journey) or business_user_name (overview), sorts groups
 * alphabetically, and within each group places overviews first then journeys sorted
 * alphabetically by name.
 */
export function groupDiagramsByBusinessUser(diagrams: Diagram[]): BusinessUserDiagramGroup[] {
  const groupMap = new Map<string, BusinessUserDiagramGroup>();

  for (const diagram of diagrams) {
    if (diagram.diagram_type === 'USER_JOURNEY') {
      const journeyData = extractUserJourneyDiagram(diagram);
      if (!journeyData) continue;

      const businessUserName = journeyData.journey.user_role_name;
      if (!groupMap.has(businessUserName)) {
        groupMap.set(businessUserName, { businessUserName, diagrams: [] });
      }
      groupMap.get(businessUserName)!.diagrams.push({
        diagram,
        type: 'USER_JOURNEY',
        name: diagram.name,
      });
    } else if (diagram.diagram_type === 'USER_JOURNEY_OVERVIEW') {
      const overviewData = extractUserJourneyOverviewDiagram(diagram);
      if (!overviewData) continue;

      const businessUserName = overviewData.overview.business_user_name;
      if (!groupMap.has(businessUserName)) {
        groupMap.set(businessUserName, { businessUserName, diagrams: [] });
      }
      groupMap.get(businessUserName)!.diagrams.push({
        diagram,
        type: 'USER_JOURNEY_OVERVIEW',
        name: diagram.name,
      });
    }
  }

  // Sort groups alphabetically by business user name
  const groups = Array.from(groupMap.values()).sort((a, b) =>
    a.businessUserName.localeCompare(b.businessUserName)
  );

  // Within each group: overviews first, then journeys sorted alphabetically by name
  for (const group of groups) {
    group.diagrams.sort((a, b) => {
      // Overviews come before journeys
      if (a.type === 'USER_JOURNEY_OVERVIEW' && b.type !== 'USER_JOURNEY_OVERVIEW') return -1;
      if (a.type !== 'USER_JOURNEY_OVERVIEW' && b.type === 'USER_JOURNEY_OVERVIEW') return 1;
      // Within same type, sort alphabetically by name
      return a.name.localeCompare(b.name);
    });
  }

  return groups;
}

/**
 * Determine page orientation based on content dimensions.
 * Returns 'landscape' if width exceeds height by more than 1.3x, otherwise 'portrait'.
 */
export function determinePageOrientation(width: number, height: number): 'portrait' | 'landscape' {
  return width > height * 1.3 ? 'landscape' : 'portrait';
}

/**
 * Build the PDF output filename from the loaded file name.
 * Strips file extension and appends " - User Journey Diagrams.pdf".
 * Falls back to "User Journey Diagrams.pdf" when loadedFileName is null or empty.
 */
export function buildPdfFilename(loadedFileName: string | null): string {
  if (!loadedFileName || loadedFileName.trim() === '') {
    return 'User Journey Diagrams.pdf';
  }

  // Strip file extension (remove last .xxx)
  const dotIndex = loadedFileName.lastIndexOf('.');
  const baseName = dotIndex > 0 ? loadedFileName.substring(0, dotIndex) : loadedFileName;

  return `${baseName} - User Journey Diagrams.pdf`;
}

/**
 * Format a date as "DD Month YYYY" (e.g., "13 April 2026").
 * Single-digit days have no leading zero.
 */
export function formatTitleDate(date: Date): string {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

/**
 * Build table of contents entries from grouped diagrams.
 *
 * Page numbering starts at 3 (page 1 = title, page 2 = TOC).
 * Each business user group gets a section header entry, and each diagram
 * gets a sub-entry. The section header's targetPageIndex points to the
 * first diagram in that group.
 */
export function buildTocEntries(groups: BusinessUserDiagramGroup[]): TocEntry[] {
  const entries: TocEntry[] = [];
  let currentPage = 3; // First diagram page is page 3 (after title + TOC)

  for (const group of groups) {
    // Section header for this business user
    entries.push({
      text: group.businessUserName,
      pageNumber: currentPage,
      isSection: true,
      targetPageIndex: currentPage,
    });

    // Diagram entries within this group
    for (const diagramEntry of group.diagrams) {
      entries.push({
        text: diagramEntry.name,
        pageNumber: currentPage,
        isSection: false,
        targetPageIndex: currentPage,
      });
      currentPage++;
    }
  }

  return entries;
}

// ============================================================================
// PDF Link Data Helpers
// ============================================================================

/**
 * Build a map from user journey entity ID → saved diagram ID.
 * Used to resolve co-worker links and linked journey references.
 */
function buildJourneyDiagramMapFromDiagrams(diagrams: Diagram[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of diagrams) {
    if (d.diagram_type !== 'USER_JOURNEY') continue;
    const content = d.typedContent?.content as any;
    const entityId = content?.journey?.id;
    if (entityId) map.set(entityId, d.id);
  }
  return map;
}

/**
 * Compute parent overview and linked journey navigation links for a
 * specific journey diagram, given the full set of saved diagrams and meta model.
 */
function computeJourneyNavLinks(
  journeyEntityId: string,
  currentDiagramId: string,
  diagrams: Diagram[],
  metaModel: any,
): { parentOverview: JourneyNavLink | null; linkedJourneys: JourneyNavLink[] } {
  // Find parent overview: look for USER_JOURNEY_OVERVIEW diagrams that reference this journey
  let parentOverview: JourneyNavLink | null = null;
  for (const d of diagrams) {
    if (d.diagram_type !== 'USER_JOURNEY_OVERVIEW') continue;
    const overviewContent = d.typedContent?.content as any;
    const overviewNodes = overviewContent?.nodes ?? [];
    if (overviewNodes.some((n: any) => n.id === journeyEntityId)) {
      parentOverview = { id: d.id, name: d.name };
      break;
    }
  }

  // Find linked journeys from explicit links
  const links = metaModel?.relationships?.user_journey_links ?? [];
  const linkedEntityIds = new Set<string>();
  for (const link of links) {
    if (link.source_user_journey_id === journeyEntityId) {
      linkedEntityIds.add(link.target_user_journey_id);
    }
    if (link.target_user_journey_id === journeyEntityId) {
      linkedEntityIds.add(link.source_user_journey_id);
    }
  }

  // Also derive from shared process activities (co-workers)
  const journeyDiagram = diagrams.find(d => d.id === currentDiagramId);
  const journeyContent = journeyDiagram?.typedContent?.content as any;
  const steps = journeyContent?.steps ?? [];
  const paIds = new Set<string>(steps.map((s: any) => s.process_activity_id).filter(Boolean));
  const allActivitySteps = metaModel?.entities?.activity_steps ?? [];
  for (const as of allActivitySteps) {
    if (paIds.has(as.process_activity_id) && as.user_journey_id !== journeyEntityId) {
      linkedEntityIds.add(as.user_journey_id);
    }
  }

  // Map entity IDs to saved diagram links
  const linkedJourneys: JourneyNavLink[] = [];
  for (const d of diagrams) {
    if (d.diagram_type !== 'USER_JOURNEY' || d.id === currentDiagramId) continue;
    const content = d.typedContent?.content as any;
    const entityId = content?.journey?.id;
    if (entityId && linkedEntityIds.has(entityId)) {
      linkedJourneys.push({ id: d.id, name: d.name });
    }
  }

  return { parentOverview, linkedJourneys };
}

// ============================================================================
// Off-Screen Rendering
// ============================================================================

/**
 * Render a diagram off-screen using ReactDOM.createRoot and capture with html2canvas.
 *
 * Creates a temporary DOM container, renders the appropriate React renderer component
 * inside an SVG wrapper, waits for content bounds, captures with html2canvas at 2x scale,
 * then cleans up.
 *
 * Task 2.3: Off-screen rendering with ReactDOM.createRoot + html2canvas
 */
export async function renderDiagramOffScreen(
  diagramData: UserJourneyDiagramDto | UserJourneyOverviewDiagramDto,
  diagramType: 'USER_JOURNEY' | 'USER_JOURNEY_OVERVIEW',
  metaModel: any,
  currentDiagramId?: string,
  allDiagrams?: Diagram[],
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number; links: DiagramLinkRect[]; headerOverlay?: PdfHeaderOverlay }> {
  // Create off-screen container
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  document.body.appendChild(container);

  // Create the root for React rendering
  const root = ReactDOM.createRoot(container);

  // Wait for content bounds via a Promise
  const boundsPromise = new Promise<{ width: number; height: number }>((resolve) => {
    const onContentBounds = (bounds: { width: number; height: number }) => {
      resolve(bounds);
    };

    let element: React.ReactElement;

    if (diagramType === 'USER_JOURNEY') {
      // Enrich journey data
      const rawData = diagramData as UserJourneyDiagramDto;
      const enrichedData = enrichJourneySteps(
        rawData,
        metaModel?.entities?.process_activities ?? [],
        metaModel?.entities?.activity_steps ?? [],
        metaModel?.entities?.business_users ?? [],
      );

      // Compute link data for PDF rendering (parent overview, linked journeys, co-worker map)
      const diagrams = allDiagrams ?? [];
      const journeyDiagramMap = buildJourneyDiagramMapFromDiagrams(diagrams);
      const journeyEntityId = rawData.journey?.id;
      const navLinks = journeyEntityId && currentDiagramId
        ? computeJourneyNavLinks(journeyEntityId, currentDiagramId, diagrams, metaModel)
        : { parentOverview: null, linkedJourneys: [] };

      element = React.createElement(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          style: { backgroundColor: '#FFFFFF' },
        },
        React.createElement(UserJourneyDiagramRenderer, {
          diagram: enrichedData,
          zoom: 1,
          onContentBounds,
          parentOverview: navLinks.parentOverview,
          linkedJourneys: navLinks.linkedJourneys,
          journeyDiagramMap,
        })
      );
    } else {
      // Enrich overview data
      const rawData = diagramData as UserJourneyOverviewDiagramDto;
      const enrichMeta: OverviewEnrichmentMetaData = {
        activitySteps: metaModel?.entities?.activity_steps ?? [],
        applications: metaModel?.entities?.applications ?? [],
        businessUserBusinessPoints: metaModel?.relationships?.business_user_business_points ?? [],
        businessUsers: metaModel?.entities?.business_users ?? [],
        userJourneys: metaModel?.entities?.user_journeys ?? [],
      };
      const enrichedData = enrichOverviewFull(rawData, enrichMeta);

      element = React.createElement(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          style: { backgroundColor: '#FFFFFF' },
        },
        React.createElement(UserJourneyOverviewDiagramRenderer, {
          overviewData: enrichedData,
          onContentBounds,
        })
      );
    }

    root.render(element);
  });

  // Wait for bounds to be reported
  const bounds = await boundsPromise;

  // Update SVG dimensions to match content bounds
  const svgElement = container.querySelector('svg');
  if (svgElement) {
    svgElement.setAttribute('width', String(bounds.width));
    svgElement.setAttribute('height', String(bounds.height));
  }

  // Allow a brief moment for re-render with correct dimensions
  await new Promise(resolve => setTimeout(resolve, 50));

  // Collect link positions and text data before capture.
  // Links get both clickable jsPDF annotations AND blue text overlays drawn on top
  // of the rasterized image (to fix html2canvas losing foreignObject styles).
  const links: DiagramLinkRect[] = [];
  let headerOverlay: PdfHeaderOverlay | undefined;

  if (svgElement) {
    const svgRect = svgElement.getBoundingClientRect();

    // 1. Header overlay: collect position + text for white-on-purple redraw
    const headerFO = svgElement.querySelector(
      '[data-testid="journey-header-block"] foreignObject, [data-testid="overview-header-block"] foreignObject'
    );
    if (headerFO) {
      const hx = parseFloat(headerFO.getAttribute('x') || '0');
      const hy = parseFloat(headerFO.getAttribute('y') || '0');
      const hw = parseFloat(headerFO.getAttribute('width') || '0');
      const hh = parseFloat(headerFO.getAttribute('height') || '0');
      const headerRect = headerFO.parentElement?.querySelector('rect');
      const bgColor = headerRect?.getAttribute('fill') || '#5B3E96';
      const innerDiv = headerFO.querySelector('div');
      const childDivs = innerDiv ? Array.from(innerDiv.querySelectorAll(':scope > div')) : [];
      const titleDiv = childDivs[0] as HTMLElement | undefined;
      const summaryDiv = childDivs[1] as HTMLElement | undefined;

      headerOverlay = {
        x: hx, y: hy, width: hw, height: hh,
        bgColor,
        titleText: titleDiv?.textContent?.trim() || '',
        titleFontSize: titleDiv ? parseFloat(window.getComputedStyle(titleDiv).fontSize) || 18 : 18,
        summaryText: summaryDiv?.textContent?.trim() || undefined,
        summaryFontSize: summaryDiv ? parseFloat(window.getComputedStyle(summaryDiv).fontSize) || 13 : undefined,
      };
    }

    // 2. Links inside foreignObject (<a> tags with data-diagram-id or data-business-user-name)
    svgElement.querySelectorAll('foreignObject a[data-diagram-id], foreignObject a[data-business-user-name]').forEach(el => {
      const aRect = el.getBoundingClientRect();
      const diagramId = el.getAttribute('data-diagram-id') || undefined;
      const businessUserName = el.getAttribute('data-business-user-name') || undefined;
      if (diagramId || businessUserName) {
        const text = el.textContent?.trim() || '';
        const fontSize = parseFloat(window.getComputedStyle(el as Element).fontSize) || 13;
        links.push({
          x: aRect.left - svgRect.left,
          y: aRect.top - svgRect.top,
          width: aRect.width,
          height: aRect.height,
          targetDiagramId: diagramId,
          targetBusinessUserName: businessUserName,
          text,
          fontSize,
        });
      }
    });

    // 3. Overview node boxes (SVG <rect> with data-node-link and data-diagram-id) — click area
    svgElement.querySelectorAll('rect[data-node-link][data-diagram-id]').forEach(el => {
      const diagramId = el.getAttribute('data-diagram-id') || undefined;
      if (!diagramId) return;
      const x = parseFloat(el.getAttribute('x') || '0');
      const y = parseFloat(el.getAttribute('y') || '0');
      const w = parseFloat(el.getAttribute('width') || '0');
      const h = parseFloat(el.getAttribute('height') || '0');
      links.push({ x, y, width: w, height: h, targetDiagramId: diagramId });
    });

    // 4. Overview node name text (foreignObject with data-node-name) — blue text overlay
    svgElement.querySelectorAll('foreignObject[data-node-name][data-diagram-id]').forEach(fo => {
      const diagramId = fo.getAttribute('data-diagram-id') || undefined;
      if (!diagramId) return;
      const x = parseFloat(fo.getAttribute('x') || '0');
      const y = parseFloat(fo.getAttribute('y') || '0');
      const w = parseFloat(fo.getAttribute('width') || '0');
      const h = parseFloat(fo.getAttribute('height') || '0');
      const nameDiv = fo.querySelector('div') as HTMLElement | null;
      const text = nameDiv?.textContent?.trim() || '';
      const fontSize = nameDiv ? parseFloat(window.getComputedStyle(nameDiv).fontSize) || 14 : 14;
      links.push({ x, y, width: w, height: h, targetDiagramId: diagramId, text, fontSize, centerAlign: true });
    });
  }

  // Capture with html2canvas (unmodified SVG — correct layout, but black text for headers/links)
  const canvas = await html2canvas(container, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#FFFFFF',
  });

  // Clean up
  root.unmount();
  document.body.removeChild(container);

  return { canvas, width: bounds.width, height: bounds.height, links, headerOverlay };
}

// ============================================================================
// PDF Page Builders
// ============================================================================

/**
 * Add the title page to the PDF document.
 *
 * Portrait A4, centered content with project name, generation date, and summary line.
 *
 * Task 2.4: Title page with project name, date, summary
 */
export function addTitlePage(
  doc: jsPDF,
  projectName: string | null,
  groups: BusinessUserDiagramGroup[],
): void {
  const pageWidth = 210; // A4 width in mm

  // Project name
  const displayName = projectName || 'User Journey Diagrams';
  // Strip file extension from display name
  const dotIndex = displayName.lastIndexOf('.');
  const cleanName = dotIndex > 0 ? displayName.substring(0, dotIndex) : displayName;

  doc.setFontSize(24);
  doc.setTextColor('#000000');
  doc.text(cleanName, pageWidth / 2, 80, { align: 'center' });

  // Generation date
  doc.setFontSize(14);
  doc.setTextColor('#666666');
  doc.text(formatTitleDate(new Date()), pageWidth / 2, 100, { align: 'center' });

  // Summary line
  const totalBusinessUsers = groups.length;
  let totalJourneys = 0;
  let totalOverviews = 0;
  for (const group of groups) {
    for (const entry of group.diagrams) {
      if (entry.type === 'USER_JOURNEY') totalJourneys++;
      if (entry.type === 'USER_JOURNEY_OVERVIEW') totalOverviews++;
    }
  }

  const summary = `${totalBusinessUsers} Business Users, ${totalJourneys} User Journey Diagrams, ${totalOverviews} Overview Diagrams`;
  doc.setFontSize(12);
  doc.setTextColor('#000000');
  doc.text(summary, pageWidth / 2, 115, { align: 'center' });
}

/**
 * Add the table of contents page(s) to the PDF document.
 *
 * Portrait A4 with "Table of Contents" title, business user section headers,
 * indented diagram names with page numbers, clickable internal links, and
 * PDF outline bookmarks. Handles multi-page overflow.
 *
 * Task 2.5: Table of contents with clickable links, bookmarks, multi-page overflow
 */
export function addTableOfContents(
  doc: jsPDF,
  tocEntries: TocEntry[],
): number {
  doc.addPage('a4', 'portrait');

  const leftMargin = 20;
  const indentMargin = 30;
  const rightAlignX = 190;
  const bottomLimit = 270; // A4 height is 297mm, leave 27mm margin at bottom

  // Title
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor('#000000');
  doc.text('Table of Contents', leftMargin, 25);

  let yPosition = 35;
  let tocPagesAdded = 1;
  let currentParentBookmark: any = null;

  for (const entry of tocEntries) {
    // Check if we need a new page
    if (yPosition > bottomLimit) {
      doc.addPage('a4', 'portrait');
      tocPagesAdded++;
      yPosition = 20;
    }

    if (entry.isSection) {
      // Business user section header (blue link style)
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor('#1565C0');
      doc.text(entry.text, leftMargin, yPosition);

      // Blue underline beneath the text
      const sectionTextWidth = doc.getTextWidth(entry.text);
      doc.setDrawColor('#1565C0');
      doc.setLineWidth(0.3);
      doc.line(leftMargin, yPosition + 1, leftMargin + sectionTextWidth, yPosition + 1);

      // Clickable link over the section header text
      doc.link(leftMargin, yPosition - 5, sectionTextWidth, 7, { pageNumber: entry.targetPageIndex });

      // PDF outline bookmark (top-level)
      currentParentBookmark = doc.outline.add(null, entry.text, { pageNumber: entry.targetPageIndex });

      yPosition += 8;
    } else {
      // Diagram entry (indented, blue link style)
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor('#1565C0');

      // Diagram name on the left
      doc.text(entry.text, indentMargin, yPosition);

      // Blue underline beneath the diagram name
      const entryTextWidth = doc.getTextWidth(entry.text);
      doc.setDrawColor('#1565C0');
      doc.setLineWidth(0.3);
      doc.line(indentMargin, yPosition + 1, indentMargin + entryTextWidth, yPosition + 1);

      // Page number on the right (keep neutral color)
      doc.setTextColor('#333333');
      const pageNumStr = String(entry.pageNumber);
      doc.text(pageNumStr, rightAlignX, yPosition, { align: 'right' });

      // Clickable link over the full row area
      doc.link(indentMargin, yPosition - 4, entryTextWidth + (rightAlignX - indentMargin - entryTextWidth), 6, { pageNumber: entry.targetPageIndex });

      // PDF outline bookmark (nested under parent)
      if (currentParentBookmark) {
        doc.outline.add(currentParentBookmark, entry.text, { pageNumber: entry.targetPageIndex });
      }

      yPosition += 7;
    }
  }

  return tocPagesAdded;
}

/**
 * Add a diagram page to the PDF document.
 *
 * Determines portrait/landscape orientation based on content dimensions (1.3x threshold),
 * adds a page, renders the diagram title, and inserts the captured image scaled to fit
 * the printable area while maintaining aspect ratio.
 *
 * Task 2.6: Portrait/landscape auto-detection with scale to fit
 */
export function addDiagramPage(
  doc: jsPDF,
  canvasDataUrl: string,
  diagramName: string,
  contentWidth: number,
  contentHeight: number,
  links?: DiagramLinkRect[],
  pageNumberMap?: Map<string, number>,
  headerOverlay?: PdfHeaderOverlay,
): void {
  const orientation = determinePageOrientation(contentWidth, contentHeight);
  doc.addPage('a4', orientation);

  const leftMargin = 20;
  const topMargin = 15;
  const bottomMargin = 20;
  const rightMargin = 20;

  // Page dimensions depend on orientation
  const pageWidth = orientation === 'portrait' ? 210 : 297;
  const pageHeight = orientation === 'portrait' ? 297 : 210;

  // Diagram title at top
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor('#000000');
  doc.text(diagramName, leftMargin, topMargin);

  // Calculate printable area (below title, within margins)
  const titleHeight = 15; // Space for title text
  const printableWidth = pageWidth - leftMargin - rightMargin;
  const printableHeight = pageHeight - titleHeight - topMargin - bottomMargin;

  // Scale image to fit within printable area while maintaining aspect ratio
  const scaleFactor = Math.min(printableWidth / contentWidth, printableHeight / contentHeight);
  const scaledWidth = contentWidth * scaleFactor;
  const scaledHeight = contentHeight * scaleFactor;

  // Center image horizontally within printable area
  const imgX = leftMargin + (printableWidth - scaledWidth) / 2;
  const imgY = topMargin + titleHeight;

  doc.addImage(canvasDataUrl, 'PNG', imgX, imgY, scaledWidth, scaledHeight);

  // SVG px → PDF mm conversion factor (already computed as scaleFactor)
  // SVG px → jsPDF pt: fontSizePt = svgFontSizePx * scaleFactor / 0.3528
  const pxToMm = scaleFactor;
  const mmToPt = (mm: number) => mm / 0.3528;

  // ---- Header overlay: redraw purple bg + white text over the black-text raster ----
  if (headerOverlay) {
    const hx = imgX + headerOverlay.x * pxToMm;
    const hy = imgY + headerOverlay.y * pxToMm;
    const hw = headerOverlay.width * pxToMm;
    const hh = headerOverlay.height * pxToMm;

    // Purple background rectangle covering the header area
    doc.setFillColor(headerOverlay.bgColor);
    doc.rect(hx, hy, hw, hh, 'F');

    // Title text (white, bold)
    if (headerOverlay.titleText) {
      const titleFontPt = mmToPt(headerOverlay.titleFontSize * pxToMm);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(titleFontPt);
      doc.setTextColor('#FFFFFF');
      // Position: 16px padding from left, vertically centered in upper portion
      const padLeftMm = 16 * pxToMm;
      const padTopMm = 10 * pxToMm;
      const titleLineHeight = headerOverlay.titleFontSize * 1.3 * pxToMm;
      const titleY = hy + padTopMm + titleLineHeight;
      const maxTextWidth = hw - padLeftMm * 2;
      doc.text(headerOverlay.titleText, hx + padLeftMm, titleY, { maxWidth: maxTextWidth });

      // Summary text (white, normal, below title)
      if (headerOverlay.summaryText && headerOverlay.summaryFontSize) {
        const summaryFontPt = mmToPt(headerOverlay.summaryFontSize * pxToMm);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(summaryFontPt);
        doc.setTextColor('#FFFFFF');
        const summaryGap = 4 * pxToMm;
        const summaryY = titleY + summaryGap + headerOverlay.summaryFontSize * 1.3 * pxToMm;
        doc.text(headerOverlay.summaryText, hx + padLeftMm, summaryY, { maxWidth: maxTextWidth });
      }
    }
  }

  // ---- Link text overlays: redraw blue underlined text over black-text raster ----
  // ---- Clickable link annotations ----
  if (links && pageNumberMap) {
    for (const link of links) {
      let targetPage: number | undefined;
      if (link.targetDiagramId) {
        targetPage = pageNumberMap.get(link.targetDiagramId);
      }
      if (!targetPage && link.targetBusinessUserName) {
        targetPage = pageNumberMap.get(`overview:${link.targetBusinessUserName}`);
      }
      if (!targetPage) continue;

      const pdfX = imgX + link.x * pxToMm;
      const pdfY = imgY + link.y * pxToMm;
      const pdfW = link.width * pxToMm;
      const pdfH = link.height * pxToMm;

      // If this link has text data, draw a blue text overlay on top of the raster
      if (link.text) {
        const fontSize = link.fontSize || 13;
        const fontPt = mmToPt(fontSize * pxToMm);

        // White rectangle to cover the black raster text
        doc.setFillColor('#FFFFFF');
        doc.rect(pdfX, pdfY, pdfW, pdfH, 'F');

        // Blue text
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(fontPt);
        doc.setTextColor('#1976D2');

        // Vertical center: baseline at vertical midpoint + ~1/3 font height
        const textHeightMm = fontSize * pxToMm;
        const baselineY = pdfY + (pdfH + textHeightMm) / 2;

        if (link.centerAlign) {
          doc.text(link.text, pdfX + pdfW / 2, baselineY, { align: 'center', maxWidth: pdfW });
        } else {
          doc.text(link.text, pdfX, baselineY, { maxWidth: pdfW });
        }

        // Blue underline
        doc.setDrawColor('#1976D2');
        doc.setLineWidth(0.3);
        const underlineY = baselineY + 0.5;
        if (link.centerAlign) {
          const textW = Math.min(doc.getTextWidth(link.text), pdfW);
          const lineStartX = pdfX + (pdfW - textW) / 2;
          doc.line(lineStartX, underlineY, lineStartX + textW, underlineY);
        } else {
          const textW = Math.min(doc.getTextWidth(link.text), pdfW);
          doc.line(pdfX, underlineY, pdfX + textW, underlineY);
        }
      }

      // Clickable link annotation (invisible, covers the full link area)
      doc.link(pdfX, pdfY, pdfW, pdfH, { pageNumber: targetPage });
    }
  }
}

// ============================================================================
// Main Orchestrator
// ============================================================================

/**
 * Generate a multi-page PDF from all saved User Journey diagrams.
 *
 * Orchestrates the full pipeline: grouping, title page, TOC, sequential
 * off-screen rendering and capture, diagram pages, and file download.
 *
 * Task 2.7: Main generatePdf orchestrator function
 */
export async function generatePdf(
  diagrams: Diagram[],
  metaModel: any,
  loadedFileName: string | null,
  onProgress: (progress: PdfGenerationProgress) => void,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Step 1: Group diagrams
    const groups = groupDiagramsByBusinessUser(diagrams);

    // Step 2: Early return if no diagrams
    if (groups.length === 0) {
      console.warn('[PDF] No USER_JOURNEY or USER_JOURNEY_OVERVIEW diagrams found in the provided diagram list.');
      return { success: false, error: 'No User Journey diagrams found to export.' };
    }

    // Step 3: Count total diagrams and set initial progress
    const total = groups.reduce((sum, g) => sum + g.diagrams.length, 0);
    onProgress({ generating: true, current: 0, total });

    // Step 4: Create jsPDF document
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // Step 5: Add title page
    addTitlePage(doc, loadedFileName, groups);

    // Step 6: Build TOC entries and add TOC
    const tocEntries = buildTocEntries(groups);
    const tocPagesAdded = addTableOfContents(doc, tocEntries);

    // If TOC used more than 1 page, adjust all entry page targets
    if (tocPagesAdded > 1) {
      const extraPages = tocPagesAdded - 1;
      for (const entry of tocEntries) {
        entry.targetPageIndex += extraPages;
        entry.pageNumber += extraPages;
      }
    }

    // Step 7: Build diagram ID → PDF page number map for internal links.
    // Page numbering: title=1, TOC=2 (+ extra TOC pages), then diagram pages follow.
    const pageNumberMap = new Map<string, number>();
    let pageCounter = 1 + tocPagesAdded; // after title + TOC pages
    for (const group of groups) {
      for (const diagramEntry of group.diagrams) {
        pageCounter++;
        // Map by diagram ID
        pageNumberMap.set(diagramEntry.diagram.id, pageCounter);
        // For overview diagrams, also map by "overview:BusinessUserName" for colleague links
        if (diagramEntry.type === 'USER_JOURNEY_OVERVIEW') {
          const overviewData = extractUserJourneyOverviewDiagram(diagramEntry.diagram);
          if (overviewData?.overview?.business_user_name) {
            pageNumberMap.set(`overview:${overviewData.overview.business_user_name}`, pageCounter);
          }
        }
      }
    }

    // Step 8: Process diagrams sequentially
    let currentIndex = 0;
    for (const group of groups) {
      for (const diagramEntry of group.diagrams) {
        const { diagram, type } = diagramEntry;

        // Extract typed content
        let typedData: UserJourneyDiagramDto | UserJourneyOverviewDiagramDto | null = null;
        if (type === 'USER_JOURNEY') {
          typedData = extractUserJourneyDiagram(diagram);
        } else {
          typedData = extractUserJourneyOverviewDiagram(diagram);
        }

        if (typedData) {
          // Render off-screen and capture (pass diagram ID and full list for link resolution)
          const { canvas, width, height, links, headerOverlay } = await renderDiagramOffScreen(typedData, type, metaModel, diagram.id, diagrams);

          // Convert to data URL
          const dataUrl = canvas.toDataURL('image/png');

          // Add diagram page with clickable link annotations and text overlays
          addDiagramPage(doc, dataUrl, diagramEntry.name, width, height, links, pageNumberMap, headerOverlay);
        }

        // Update progress
        currentIndex++;
        onProgress({ generating: true, current: currentIndex, total });
      }
    }

    // Step 8: Save PDF
    doc.save(buildPdfFilename(loadedFileName));

    // Step 9: Reset progress
    onProgress({ generating: false, current: 0, total: 0 });
    return { success: true };
  } catch (error) {
    console.error('PDF generation failed:', error);
    // Reset progress even on error
    onProgress({ generating: false, current: 0, total: 0 });
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
