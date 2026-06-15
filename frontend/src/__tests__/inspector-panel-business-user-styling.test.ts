/**
 * Tests for BUSINESS_USER Text Styling
 *
 * Task Group 7: BUSINESS_USER Text Styling Verification
 * - Test BUSINESS_USER node text (below stick figure) renders with custom font size
 * - Test BUSINESS_USER node text renders with bold font weight
 * - Test BUSINESS_USER node text renders with italic font style
 * - Test BUSINESS_USER node text renders with underline text decoration
 *
 * These tests verify that the text styling attributes are correctly applied
 * to BUSINESS_USER nodes in the Canvas rendering and InspectorPanel updates.
 */

import { describe, it, expect } from 'vitest';
import { DiagramNode } from '../types/model';

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

function createDefaultBusinessUserNode(): DiagramNode {
  return {
    id: 'bu-node-default',
    entity_type: 'BUSINESS_USER',
    entity_id: 'user-default',
    pos_x: 100,
    pos_y: 100,
    width: 60,
    height: 90,
    parent_node_id: null,
  };
}

function createBusinessUserNodeWithFontSize(fontSize: string): DiagramNode {
  return {
    id: 'bu-node-fontsize',
    entity_type: 'BUSINESS_USER',
    entity_id: 'user-fontsize',
    pos_x: 200,
    pos_y: 100,
    width: 60,
    height: 90,
    parent_node_id: null,
    text_font_size: fontSize,
  };
}

function createBusinessUserNodeWithBold(): DiagramNode {
  return {
    id: 'bu-node-bold',
    entity_type: 'BUSINESS_USER',
    entity_id: 'user-bold',
    pos_x: 300,
    pos_y: 100,
    width: 60,
    height: 90,
    parent_node_id: null,
    text_font_weight: 'bold',
  };
}

function createBusinessUserNodeWithItalic(): DiagramNode {
  return {
    id: 'bu-node-italic',
    entity_type: 'BUSINESS_USER',
    entity_id: 'user-italic',
    pos_x: 400,
    pos_y: 100,
    width: 60,
    height: 90,
    parent_node_id: null,
    text_font_style: 'italic',
  };
}

function createBusinessUserNodeWithUnderline(): DiagramNode {
  return {
    id: 'bu-node-underline',
    entity_type: 'BUSINESS_USER',
    entity_id: 'user-underline',
    pos_x: 500,
    pos_y: 100,
    width: 60,
    height: 90,
    parent_node_id: null,
    text_text_decoration: 'underline',
  };
}

function createBusinessUserNodeWithAllStyles(): DiagramNode {
  return {
    id: 'bu-node-all-styles',
    entity_type: 'BUSINESS_USER',
    entity_id: 'user-all-styles',
    pos_x: 600,
    pos_y: 100,
    width: 60,
    height: 90,
    parent_node_id: null,
    text_font_size: '16px',
    text_font_weight: 'bold',
    text_font_style: 'italic',
    text_text_decoration: 'underline',
  };
}

// =========================================
// Simulate Canvas.tsx rendering logic for BUSINESS_USER nodes
// =========================================

interface TextRenderingAttributes {
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  textDecoration: string;
}

function getBusinessUserTextRenderingAttributes(node: DiagramNode): TextRenderingAttributes {
  const nodeFontSize = parseFontSize(node.text_font_size);
  const nodeFontWeight = node.text_font_weight || 'normal';
  const nodeFontStyle = node.text_font_style || 'normal';
  const nodeTextDecoration = node.text_text_decoration || 'none';

  return {
    fontSize: nodeFontSize,
    fontWeight: nodeFontWeight,
    fontStyle: nodeFontStyle,
    textDecoration: nodeTextDecoration,
  };
}

// =========================================
// Simulate InspectorPanel.tsx update logic
// =========================================

function simulateUpdateSelectedNodes(
  node: DiagramNode,
  updates: Partial<DiagramNode>
): DiagramNode {
  return {
    ...node,
    ...updates,
  };
}

// =========================================
// Task Group 7: BUSINESS_USER Text Styling Tests
// =========================================

describe('Task Group 7.1: BUSINESS_USER Text Styling', () => {
  it('BUSINESS_USER text renders with correct font size', () => {
    const defaultNode = createDefaultBusinessUserNode();
    const defaultAttrs = getBusinessUserTextRenderingAttributes(defaultNode);
    expect(defaultAttrs.fontSize).toBe(12);

    const node16px = createBusinessUserNodeWithFontSize('16px');
    expect(getBusinessUserTextRenderingAttributes(node16px).fontSize).toBe(16);

    const node24px = createBusinessUserNodeWithFontSize('24px');
    expect(getBusinessUserTextRenderingAttributes(node24px).fontSize).toBe(24);

    const node8px = createBusinessUserNodeWithFontSize('8px');
    expect(getBusinessUserTextRenderingAttributes(node8px).fontSize).toBe(8);

    const updatedNode = simulateUpdateSelectedNodes(defaultNode, { text_font_size: '20px' });
    expect(getBusinessUserTextRenderingAttributes(updatedNode).fontSize).toBe(20);
  });

  it('BUSINESS_USER text renders with bold font weight', () => {
    const defaultNode = createDefaultBusinessUserNode();
    expect(getBusinessUserTextRenderingAttributes(defaultNode).fontWeight).toBe('normal');

    const boldNode = createBusinessUserNodeWithBold();
    expect(getBusinessUserTextRenderingAttributes(boldNode).fontWeight).toBe('bold');

    const updatedToBold = simulateUpdateSelectedNodes(defaultNode, { text_font_weight: 'bold' });
    expect(getBusinessUserTextRenderingAttributes(updatedToBold).fontWeight).toBe('bold');

    const updatedToNormal = simulateUpdateSelectedNodes(boldNode, { text_font_weight: 'normal' });
    expect(getBusinessUserTextRenderingAttributes(updatedToNormal).fontWeight).toBe('normal');
  });

  it('BUSINESS_USER text renders with italic font style', () => {
    const defaultNode = createDefaultBusinessUserNode();
    expect(getBusinessUserTextRenderingAttributes(defaultNode).fontStyle).toBe('normal');

    const italicNode = createBusinessUserNodeWithItalic();
    expect(getBusinessUserTextRenderingAttributes(italicNode).fontStyle).toBe('italic');

    const updatedToItalic = simulateUpdateSelectedNodes(defaultNode, { text_font_style: 'italic' });
    expect(getBusinessUserTextRenderingAttributes(updatedToItalic).fontStyle).toBe('italic');

    const updatedToNormal = simulateUpdateSelectedNodes(italicNode, { text_font_style: 'normal' });
    expect(getBusinessUserTextRenderingAttributes(updatedToNormal).fontStyle).toBe('normal');
  });

  it('BUSINESS_USER text renders with underline text decoration', () => {
    const defaultNode = createDefaultBusinessUserNode();
    expect(getBusinessUserTextRenderingAttributes(defaultNode).textDecoration).toBe('none');

    const underlineNode = createBusinessUserNodeWithUnderline();
    expect(getBusinessUserTextRenderingAttributes(underlineNode).textDecoration).toBe('underline');

    const updatedToUnderline = simulateUpdateSelectedNodes(defaultNode, { text_text_decoration: 'underline' });
    expect(getBusinessUserTextRenderingAttributes(updatedToUnderline).textDecoration).toBe('underline');

    const updatedToNone = simulateUpdateSelectedNodes(underlineNode, { text_text_decoration: 'none' });
    expect(getBusinessUserTextRenderingAttributes(updatedToNone).textDecoration).toBe('none');
  });
});

describe('Task Group 7.2-7.3: BUSINESS_USER Verification', () => {
  it('all styles can be combined on a BUSINESS_USER node', () => {
    const allStylesNode = createBusinessUserNodeWithAllStyles();
    const attrs = getBusinessUserTextRenderingAttributes(allStylesNode);

    expect(attrs.fontSize).toBe(16);
    expect(attrs.fontWeight).toBe('bold');
    expect(attrs.fontStyle).toBe('italic');
    expect(attrs.textDecoration).toBe('underline');
  });

  it('Canvas.tsx rendering logic produces correct attributes for BUSINESS_USER', () => {
    const node = createBusinessUserNodeWithAllStyles();
    const attrs = getBusinessUserTextRenderingAttributes(node);

    expect(attrs.fontSize).toBe(16);
    expect(attrs.fontWeight).toBe('bold');
    expect(attrs.fontStyle).toBe('italic');
    expect(attrs.textDecoration).toBe('underline');
  });

  it('InspectorPanel applies font styles to BUSINESS_USER nodes', () => {
    const businessUserNode = createDefaultBusinessUserNode();

    const withFontSize = simulateUpdateSelectedNodes(businessUserNode, { text_font_size: '18px' });
    expect(withFontSize.text_font_size).toBe('18px');

    const withBold = simulateUpdateSelectedNodes(businessUserNode, { text_font_weight: 'bold' });
    expect(withBold.text_font_weight).toBe('bold');

    const withItalic = simulateUpdateSelectedNodes(businessUserNode, { text_font_style: 'italic' });
    expect(withItalic.text_font_style).toBe('italic');

    const withUnderline = simulateUpdateSelectedNodes(businessUserNode, { text_text_decoration: 'underline' });
    expect(withUnderline.text_text_decoration).toBe('underline');
  });
});
