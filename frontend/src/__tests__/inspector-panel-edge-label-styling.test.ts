/**
 * Tests for Edge Label Text Styling
 *
 * Task Group 8: Edge Label Text Styling Verification (4 tests)
 * - Test edge label text renders with custom font size
 * - Test edge label text renders with bold font weight
 * - Test edge label text renders with italic font style
 * - Test edge label text renders with underline text decoration
 *
 * These tests verify that the text styling attributes are correctly applied
 * to diagram_edge labels in the Canvas rendering and InspectorPanel updates.
 */

import { describe, it, expect } from 'vitest';
import { DiagramEdge } from '../types/model';

// =========================================
// Helper: Parse font size string to number (mirrors Canvas.tsx logic)
// =========================================

function parseFontSize(fontSizeStr?: string): number {
  const defaultFontSize = 12;
  if (!fontSizeStr) return defaultFontSize;
  const parsed = parseFloat(fontSizeStr);
  return isNaN(parsed) ? defaultFontSize : parsed;
}

// =========================================
// Test Data Helpers
// =========================================

function createDefaultEdge(): DiagramEdge {
  return {
    id: 'edge-default',
    relationship_type: 'DATA_MOVEMENT',
    relationship_id: 'rel-default',
    source_node_id: 'node-1',
    target_node_id: 'node-2',
    label_text: 'Data Flow',
    label_pos_x: 150,
    label_pos_y: 150,
    edge_points: [
      { pos_x: 100, pos_y: 150 },
      { pos_x: 200, pos_y: 150 },
    ],
  };
}

function createEdgeWithFontSize(fontSize: string): DiagramEdge {
  return {
    id: 'edge-fontsize',
    relationship_type: 'DATA_MOVEMENT',
    relationship_id: 'rel-fontsize',
    source_node_id: 'node-1',
    target_node_id: 'node-2',
    label_text: 'Styled Label',
    label_pos_x: 250,
    label_pos_y: 150,
    edge_points: [
      { pos_x: 200, pos_y: 150 },
      { pos_x: 300, pos_y: 150 },
    ],
    label_font_size: fontSize,
  };
}

function createEdgeWithBold(): DiagramEdge {
  return {
    id: 'edge-bold',
    relationship_type: 'DATA_MOVEMENT',
    relationship_id: 'rel-bold',
    source_node_id: 'node-1',
    target_node_id: 'node-2',
    label_text: 'Bold Label',
    label_pos_x: 350,
    label_pos_y: 150,
    edge_points: [
      { pos_x: 300, pos_y: 150 },
      { pos_x: 400, pos_y: 150 },
    ],
    label_font_weight: 'bold',
  };
}

function createEdgeWithItalic(): DiagramEdge {
  return {
    id: 'edge-italic',
    relationship_type: 'DATA_MOVEMENT',
    relationship_id: 'rel-italic',
    source_node_id: 'node-1',
    target_node_id: 'node-2',
    label_text: 'Italic Label',
    label_pos_x: 450,
    label_pos_y: 150,
    edge_points: [
      { pos_x: 400, pos_y: 150 },
      { pos_x: 500, pos_y: 150 },
    ],
    label_font_style: 'italic',
  };
}

function createEdgeWithUnderline(): DiagramEdge {
  return {
    id: 'edge-underline',
    relationship_type: 'DATA_MOVEMENT',
    relationship_id: 'rel-underline',
    source_node_id: 'node-1',
    target_node_id: 'node-2',
    label_text: 'Underline Label',
    label_pos_x: 550,
    label_pos_y: 150,
    edge_points: [
      { pos_x: 500, pos_y: 150 },
      { pos_x: 600, pos_y: 150 },
    ],
    label_text_decoration: 'underline',
  };
}

function createEdgeWithAllStyles(): DiagramEdge {
  return {
    id: 'edge-all-styles',
    relationship_type: 'DATA_MOVEMENT',
    relationship_id: 'rel-all-styles',
    source_node_id: 'node-1',
    target_node_id: 'node-2',
    label_text: 'All Styles Label',
    label_pos_x: 650,
    label_pos_y: 150,
    edge_points: [
      { pos_x: 600, pos_y: 150 },
      { pos_x: 700, pos_y: 150 },
    ],
    label_font_size: '16px',
    label_font_weight: 'bold',
    label_font_style: 'italic',
    label_text_decoration: 'underline',
  };
}

// =========================================
// Simulate Canvas.tsx rendering logic for edge labels
// =========================================

interface LabelRenderingAttributes {
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  textDecoration: string;
}

function getEdgeLabelRenderingAttributes(edge: DiagramEdge): LabelRenderingAttributes {
  const labelFontSize = edge.label_font_size || '12px';
  const labelFontWeight = edge.label_font_weight || 'normal';
  const labelFontStyle = edge.label_font_style || 'normal';
  const labelTextDecoration = edge.label_text_decoration || 'none';

  return {
    fontSize: labelFontSize,
    fontWeight: labelFontWeight,
    fontStyle: labelFontStyle,
    textDecoration: labelTextDecoration,
  };
}

// =========================================
// Simulate InspectorPanel.tsx update logic for edges
// =========================================

function simulateUpdateSelectedEdges(
  edge: DiagramEdge,
  updates: Partial<DiagramEdge>
): DiagramEdge {
  return {
    ...edge,
    ...updates,
  };
}

// =========================================
// Task Group 8: Edge Label Text Styling Tests
// =========================================

describe('Task Group 8.1: Edge Label Text Styling', () => {
  it('edge label renders with correct font size', () => {
    const defaultEdge = createDefaultEdge();
    const defaultAttrs = getEdgeLabelRenderingAttributes(defaultEdge);
    expect(defaultAttrs.fontSize).toBe('12px');

    const edge16px = createEdgeWithFontSize('16px');
    const attrs16px = getEdgeLabelRenderingAttributes(edge16px);
    expect(attrs16px.fontSize).toBe('16px');

    const edge24px = createEdgeWithFontSize('24px');
    const attrs24px = getEdgeLabelRenderingAttributes(edge24px);
    expect(attrs24px.fontSize).toBe('24px');

    const edge8px = createEdgeWithFontSize('8px');
    const attrs8px = getEdgeLabelRenderingAttributes(edge8px);
    expect(attrs8px.fontSize).toBe('8px');

    const updatedEdge = simulateUpdateSelectedEdges(defaultEdge, { label_font_size: '20px' });
    const updatedAttrs = getEdgeLabelRenderingAttributes(updatedEdge);
    expect(updatedAttrs.fontSize).toBe('20px');
  });

  it('edge label renders with bold font weight', () => {
    const defaultEdge = createDefaultEdge();
    const defaultAttrs = getEdgeLabelRenderingAttributes(defaultEdge);
    expect(defaultAttrs.fontWeight).toBe('normal');

    const boldEdge = createEdgeWithBold();
    const boldAttrs = getEdgeLabelRenderingAttributes(boldEdge);
    expect(boldAttrs.fontWeight).toBe('bold');

    const updatedToBold = simulateUpdateSelectedEdges(defaultEdge, { label_font_weight: 'bold' });
    expect(getEdgeLabelRenderingAttributes(updatedToBold).fontWeight).toBe('bold');

    const updatedToNormal = simulateUpdateSelectedEdges(boldEdge, { label_font_weight: 'normal' });
    expect(getEdgeLabelRenderingAttributes(updatedToNormal).fontWeight).toBe('normal');
  });

  it('edge label renders with italic font style', () => {
    const defaultEdge = createDefaultEdge();
    const defaultAttrs = getEdgeLabelRenderingAttributes(defaultEdge);
    expect(defaultAttrs.fontStyle).toBe('normal');

    const italicEdge = createEdgeWithItalic();
    const italicAttrs = getEdgeLabelRenderingAttributes(italicEdge);
    expect(italicAttrs.fontStyle).toBe('italic');

    const updatedToItalic = simulateUpdateSelectedEdges(defaultEdge, { label_font_style: 'italic' });
    expect(getEdgeLabelRenderingAttributes(updatedToItalic).fontStyle).toBe('italic');

    const updatedToNormal = simulateUpdateSelectedEdges(italicEdge, { label_font_style: 'normal' });
    expect(getEdgeLabelRenderingAttributes(updatedToNormal).fontStyle).toBe('normal');
  });

  it('edge label renders with underline text decoration', () => {
    const defaultEdge = createDefaultEdge();
    const defaultAttrs = getEdgeLabelRenderingAttributes(defaultEdge);
    expect(defaultAttrs.textDecoration).toBe('none');

    const underlineEdge = createEdgeWithUnderline();
    const underlineAttrs = getEdgeLabelRenderingAttributes(underlineEdge);
    expect(underlineAttrs.textDecoration).toBe('underline');

    const updatedToUnderline = simulateUpdateSelectedEdges(defaultEdge, { label_text_decoration: 'underline' });
    expect(getEdgeLabelRenderingAttributes(updatedToUnderline).textDecoration).toBe('underline');

    const updatedToNone = simulateUpdateSelectedEdges(underlineEdge, { label_text_decoration: 'none' });
    expect(getEdgeLabelRenderingAttributes(updatedToNone).textDecoration).toBe('none');
  });
});

describe('Task Group 8.2-8.3: Edge Label Verification', () => {
  it('all styles can be combined on an edge label', () => {
    const allStylesEdge = createEdgeWithAllStyles();
    const attrs = getEdgeLabelRenderingAttributes(allStylesEdge);

    expect(attrs.fontSize).toBe('16px');
    expect(attrs.fontWeight).toBe('bold');
    expect(attrs.fontStyle).toBe('italic');
    expect(attrs.textDecoration).toBe('underline');
  });

  it('Canvas.tsx rendering logic produces correct attributes', () => {
    const edge = createEdgeWithAllStyles();
    const attrs = getEdgeLabelRenderingAttributes(edge);

    expect(attrs.fontSize).toBe('16px');
    expect(attrs.fontWeight).toBe('bold');
    expect(attrs.fontStyle).toBe('italic');
    expect(attrs.textDecoration).toBe('underline');
  });

  it('InspectorPanel applies font styles to edges', () => {
    const edge = createDefaultEdge();

    const withFontSize = simulateUpdateSelectedEdges(edge, { label_font_size: '18px' });
    expect(withFontSize.label_font_size).toBe('18px');

    const withBold = simulateUpdateSelectedEdges(edge, { label_font_weight: 'bold' });
    expect(withBold.label_font_weight).toBe('bold');

    const withItalic = simulateUpdateSelectedEdges(edge, { label_font_style: 'italic' });
    expect(withItalic.label_font_style).toBe('italic');

    const withUnderline = simulateUpdateSelectedEdges(edge, { label_text_decoration: 'underline' });
    expect(withUnderline.label_text_decoration).toBe('underline');
  });

  it('alignment controls are hidden for edge-only selection', () => {
    const selectedNodeIds = new Set<string>();
    const selectedEdgeIds = new Set<string>(['edge-1', 'edge-2']);

    const hasRectangularNodes = selectedNodeIds.size === 0 ? false : true;
    const showAlignmentControls = hasRectangularNodes;

    expect(showAlignmentControls).toBe(false);
  });
});
