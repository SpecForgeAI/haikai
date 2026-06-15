/**
 * pdfCapturePoc.ts
 *
 * Proof-of-concept: test whether the browser's native SVG renderer (via Blob URL)
 * preserves foreignObject inline styles (white header text, blue link text, underlines)
 * when drawn onto a <canvas>.
 *
 * Usage: call testSvgBlobCapture(diagrams, metaModel) from the browser console or
 * wire it to a temp button. It picks the first USER_JOURNEY diagram, renders it
 * off-screen via React, then tests TWO capture approaches:
 *
 *   A) html2canvas (current approach — known to lose foreignObject styles)
 *   B) SVG → XMLSerializer → Blob URL → Image → Canvas (native SVG renderer)
 *
 * Both results are downloaded as PNGs so you can compare side-by-side.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import html2canvas from 'html2canvas';

import type { Diagram } from '../../types/model';
// UserJourneyDiagramDto used implicitly via extractUserJourneyDiagram return type
import { extractUserJourneyDiagram } from './diagramExtractionUtils';
import { enrichJourneySteps } from './journeyEnrichment';
import UserJourneyDiagramRenderer from './UserJourneyDiagramRenderer';

function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

export async function testSvgBlobCapture(diagrams: Diagram[], metaModel: any): Promise<void> {
  // Find first USER_JOURNEY diagram
  const journeyDiagram = diagrams.find(d => d.diagram_type === 'USER_JOURNEY');
  if (!journeyDiagram) {
    console.error('[POC] No USER_JOURNEY diagram found');
    return;
  }

  const rawData = extractUserJourneyDiagram(journeyDiagram);
  if (!rawData) {
    console.error('[POC] Failed to extract journey data');
    return;
  }

  console.log('[POC] Using diagram:', journeyDiagram.name);

  // Enrich
  const enrichedData = enrichJourneySteps(
    rawData,
    metaModel?.entities?.process_activities ?? [],
    metaModel?.entities?.activity_steps ?? [],
    metaModel?.entities?.business_users ?? [],
  );

  // Build journeyDiagramMap for co-worker links
  const journeyDiagramMap = new Map<string, string>();
  for (const d of diagrams) {
    if (d.diagram_type !== 'USER_JOURNEY') continue;
    const content = d.typedContent?.content as any;
    const entityId = content?.journey?.id;
    if (entityId) journeyDiagramMap.set(entityId, d.id);
  }

  // Find parent overview + linked journeys (simplified for POC)
  const journeyEntityId = rawData.journey?.id;
  let parentOverview = null;
  const linkedJourneys: Array<{ id: string; name: string }> = [];

  for (const d of diagrams) {
    if (d.diagram_type === 'USER_JOURNEY_OVERVIEW') {
      const overviewContent = d.typedContent?.content as any;
      const nodes = overviewContent?.nodes ?? [];
      if (nodes.some((n: any) => n.id === journeyEntityId)) {
        parentOverview = { id: d.id, name: d.name };
        break;
      }
    }
  }

  const allActivitySteps = metaModel?.entities?.activity_steps ?? [];
  const steps = (rawData as any).steps ?? [];
  const paIds = new Set<string>(steps.map((s: any) => s.process_activity_id).filter(Boolean));
  const linkedEntityIds = new Set<string>();
  for (const as of allActivitySteps) {
    if (paIds.has(as.process_activity_id) && as.user_journey_id !== journeyEntityId) {
      linkedEntityIds.add(as.user_journey_id);
    }
  }
  for (const d of diagrams) {
    if (d.diagram_type !== 'USER_JOURNEY' || d.id === journeyDiagram.id) continue;
    const content = d.typedContent?.content as any;
    const entityId = content?.journey?.id;
    if (entityId && linkedEntityIds.has(entityId)) {
      linkedJourneys.push({ id: d.id, name: d.name });
    }
  }

  // Render off-screen
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  document.body.appendChild(container);

  const root = ReactDOM.createRoot(container);

  const bounds = await new Promise<{ width: number; height: number }>((resolve) => {
    const element = React.createElement(
      'svg',
      { xmlns: 'http://www.w3.org/2000/svg', style: { backgroundColor: '#FFFFFF' } },
      React.createElement(UserJourneyDiagramRenderer, {
        diagram: enrichedData,
        zoom: 1,
        onContentBounds: resolve,
        parentOverview,
        linkedJourneys,
        journeyDiagramMap,
      })
    );
    root.render(element);
  });

  const svgElement = container.querySelector('svg');
  if (!svgElement) {
    console.error('[POC] No SVG element found');
    root.unmount();
    document.body.removeChild(container);
    return;
  }

  svgElement.setAttribute('width', String(bounds.width));
  svgElement.setAttribute('height', String(bounds.height));

  // Wait for re-render
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('[POC] SVG dimensions:', bounds.width, 'x', bounds.height);

  // =========================================================================
  // APPROACH A: html2canvas (current approach)
  // =========================================================================
  try {
    console.log('[POC] Capturing with html2canvas...');
    const canvasA = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#FFFFFF',
    });
    console.log('[POC] html2canvas result:', canvasA.width, 'x', canvasA.height);
    downloadCanvas(canvasA, 'POC-A-html2canvas.png');
  } catch (err) {
    console.error('[POC] html2canvas failed:', err);
  }

  // =========================================================================
  // APPROACH B: SVG → Blob URL → Image → Canvas (native SVG renderer)
  // =========================================================================
  try {
    console.log('[POC] Capturing with SVG Blob URL...');

    // Ensure the SVG has the correct xmlns
    if (!svgElement.getAttribute('xmlns')) {
      svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    // Ensure foreignObject children have xhtml namespace
    svgElement.querySelectorAll('foreignObject > div').forEach(div => {
      if (!div.getAttribute('xmlns')) {
        div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      }
    });

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgElement);

    console.log('[POC] Serialized SVG length:', svgString.length);
    console.log('[POC] SVG snippet (first 500 chars):', svgString.substring(0, 500));

    // Check if styles are in the serialized string
    const hasWhiteColor = svgString.includes('rgb(255, 255, 255)') || svgString.includes('#FFFFFF') || svgString.includes('#ffffff') || svgString.includes('color: white');
    const hasBlueColor = svgString.includes('#1976D2') || svgString.includes('rgb(25, 118, 210)') || svgString.includes('#1976d2');
    console.log('[POC] Serialized SVG contains white color?', hasWhiteColor);
    console.log('[POC] Serialized SVG contains blue color?', hasBlueColor);

    // Test B1: Open the raw SVG in a new browser tab.
    // If the browser renders foreignObject styles correctly here (white header, blue links),
    // the native SVG renderer works — we just can't extract pixels due to taint.
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const svgTabUrl = URL.createObjectURL(blob);
    console.log('[POC] Opening SVG in new tab — check if header is white text, links are blue...');
    window.open(svgTabUrl, '_blank');

    // Test B2: Draw SVG onto a visible canvas (tainted, can't export, but you can SEE it).
    const img = new Image();
    img.width = bounds.width;
    img.height = bounds.height;

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(new Error(`Image load failed: ${e}`));
      img.src = svgTabUrl;
    });

    console.log('[POC] Image loaded:', img.naturalWidth, 'x', img.naturalHeight);

    const scale = 2;
    const canvasB = document.createElement('canvas');
    canvasB.width = bounds.width * scale;
    canvasB.height = bounds.height * scale;
    canvasB.style.border = '2px solid red';
    canvasB.style.position = 'fixed';
    canvasB.style.top = '10px';
    canvasB.style.right = '10px';
    canvasB.style.zIndex = '99999';
    canvasB.style.maxWidth = '600px';
    canvasB.style.maxHeight = '400px';
    const ctx = canvasB.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvasB.width, canvasB.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, bounds.width, bounds.height);

    // Append canvas to page body so you can visually inspect it (tainted = can't export)
    document.body.appendChild(canvasB);
    console.log('[POC] Tainted canvas appended to page (red border, top-right). Inspect visually.');
    console.log('[POC] Canvas is tainted so we cannot export it, but you CAN see it.');
    console.log('[POC] Remove it manually: document.querySelector("canvas[style*=red]").remove()');
  } catch (err) {
    console.error('[POC] SVG Blob approach failed:', err);
  }

  // Clean up
  root.unmount();
  document.body.removeChild(container);

  console.log('[POC] Done — check your downloads for POC-A-html2canvas.png and POC-B-svg-blob.png');
}
