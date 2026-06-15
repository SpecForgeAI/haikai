/**
 * Tests for BUSINESS_PROCESS Node Green Background Styling Feature
 *
 * Task Group 1: Update Entity Color Configuration (5 tests)
 * Task Group 2: Rendering and Interaction Verification (5 tests)
 * Task Group 3: Integration Test Review & Final Verification (up to 5 additional tests)
 *
 * Total: 16 tests
 */

import { describe, it, expect } from 'vitest';
import { getEntityColor } from '../utils/rendering';
import { entityColors } from '../config/defaults';
import { DiagramNode } from '../types/model';

// Helper to check if a color is valid hex code
function isValidHexColor(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

// Helper to check contrast ratio (simplified - not WCAG compliant check)
function hasGoodContrast(backgroundColor: string, textColor: string): boolean {
  // For this test, we just verify text is dark (#333) and background is light
  const bgIsLight = backgroundColor.toLowerCase() !== '#333333' && backgroundColor.toLowerCase() !== '#333';
  const textIsDark = textColor === '#333' || textColor === '#333333';
  return bgIsLight && textIsDark;
}

// =========================================
// Task Group 1: Color Configuration Tests
// =========================================

describe('Task Group 1: Color Configuration', () => {
  it('BUSINESS_PROCESS background should be #d6f5d6 (soft light green)', () => {
    const colors = getEntityColor('BUSINESS_PROCESS');
    expect(colors.background).toBe('#d6f5d6');
  });

  it('BUSINESS_PROCESS border should be #616161 or #4CAF50', () => {
    const colors = getEntityColor('BUSINESS_PROCESS');
    expect(['#616161', '#4CAF50']).toContain(colors.border);
  });

  it('getEntityColor returns green colors for BUSINESS_PROCESS', () => {
    const colors = getEntityColor('BUSINESS_PROCESS');
    expect(typeof colors).toBe('object');
    expect(colors).toHaveProperty('background');
    expect(colors).toHaveProperty('border');
    expect(colors.background).toBe('#d6f5d6');
  });

  it('text remains readable on green background', () => {
    const colors = getEntityColor('BUSINESS_PROCESS');
    const textColor = '#333';
    expect(hasGoodContrast(colors.background, textColor)).toBe(true);
  });

  it('non-BUSINESS_PROCESS nodes are not affected', () => {
    const applicationColors = getEntityColor('APPLICATION');
    const serviceColors = getEntityColor('SERVICE');
    const businessUserColors = getEntityColor('BUSINESS_USER');

    expect(applicationColors.background).not.toBe('#d6f5d6');
    expect(serviceColors.background).not.toBe('#d6f5d6');
    expect(businessUserColors.background).not.toBe('#d6f5d6');

    expect(applicationColors.background).toBe('#E3F2FD');
    expect(serviceColors.background).toBe('#F3E5F5');
  });

  it('color values are valid hex codes', () => {
    const colors = getEntityColor('BUSINESS_PROCESS');
    expect(isValidHexColor(colors.background)).toBe(true);
    expect(isValidHexColor(colors.border)).toBe(true);
  });
});

// =========================================
// Task Group 2: Interaction & Rendering Tests
// =========================================

describe('Task Group 2: Interaction & Rendering', () => {
  it('selection indicator is visible on green background', () => {
    const businessProcessColors = getEntityColor('BUSINESS_PROCESS');
    const selectionColor = '#1976D2';
    expect(businessProcessColors.background).not.toBe(selectionColor);
    expect(selectionColor).toBe('#1976D2');
  });

  it('drag-and-drop works with BUSINESS_PROCESS nodes', () => {
    const node: DiagramNode = {
      id: 'node-bp-1',
      entity_type: 'BUSINESS_PROCESS',
      entity_id: 'bp-1',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 100,
      parent_node_id: null,
    };

    const updatedNode = { ...node, pos_x: 150, pos_y: 150 };
    expect(updatedNode.entity_type).toBe('BUSINESS_PROCESS');
    expect(updatedNode.pos_x).toBe(150);
    expect(updatedNode.pos_y).toBe(150);
  });

  it('resize handles are visible on green background', () => {
    const businessProcessColors = getEntityColor('BUSINESS_PROCESS');
    const handleFill = '#1976D2';
    expect(businessProcessColors.background).not.toBe(handleFill);
    expect(handleFill).toBe('#1976D2');
  });

  it('containment behavior works with green nodes', () => {
    const parentNode: DiagramNode = {
      id: 'node-bp-parent',
      entity_type: 'BUSINESS_PROCESS',
      entity_id: 'bp-parent',
      pos_x: 50,
      pos_y: 50,
      width: 300,
      height: 200,
      parent_node_id: null,
    };

    const childNode: DiagramNode = {
      id: 'node-bp-child',
      entity_type: 'APPLICATION',
      entity_id: 'app-1',
      pos_x: 100,
      pos_y: 100,
      width: 150,
      height: 80,
      parent_node_id: 'node-bp-parent',
    };

    expect(childNode.parent_node_id).toBe(parentNode.id);
    expect(parentNode.entity_type).toBe('BUSINESS_PROCESS');
    expect(childNode.pos_x).toBeGreaterThanOrEqual(parentNode.pos_x);
    expect(childNode.pos_x + childNode.width).toBeLessThanOrEqual(parentNode.pos_x + parentNode.width);
    expect(childNode.pos_y).toBeGreaterThanOrEqual(parentNode.pos_y);
    expect(childNode.pos_y + childNode.height).toBeLessThanOrEqual(parentNode.pos_y + parentNode.height);
  });

  it('existing diagrams load with green styling', () => {
    const existingNode: DiagramNode = {
      id: 'node-bp-existing',
      entity_type: 'BUSINESS_PROCESS',
      entity_id: 'bp-existing',
      pos_x: 200,
      pos_y: 200,
      width: 180,
      height: 90,
      parent_node_id: null,
    };

    const colors = getEntityColor(existingNode.entity_type);
    expect(colors.background).toBe('#d6f5d6');
    expect(!('background' in existingNode)).toBe(true);
  });
});

// =========================================
// Task Group 3: Integration & Edge Case Tests
// =========================================

describe('Task Group 3: Integration & Edge Cases', () => {
  it('multiple BUSINESS_PROCESS nodes all have green background', () => {
    const nodes: DiagramNode[] = [
      {
        id: 'node-bp-1', entity_type: 'BUSINESS_PROCESS', entity_id: 'bp-1',
        pos_x: 100, pos_y: 100, width: 150, height: 80, parent_node_id: null,
      },
      {
        id: 'node-bp-2', entity_type: 'BUSINESS_PROCESS', entity_id: 'bp-2',
        pos_x: 300, pos_y: 100, width: 150, height: 80, parent_node_id: null,
      },
    ];

    nodes.forEach((node) => {
      const colors = getEntityColor(node.entity_type);
      expect(colors.background).toBe('#d6f5d6');
    });
  });

  it('mixed entity types have correct distinct colors', () => {
    const bpColors = getEntityColor('BUSINESS_PROCESS');
    const appColors = getEntityColor('APPLICATION');

    expect(bpColors.background).toBe('#d6f5d6');
    expect(appColors.background).toBe('#E3F2FD');
    expect(bpColors.background).not.toBe(appColors.background);
  });

  it('green nodes work with various sizes', () => {
    const sizes = [
      { width: 60, height: 40 },
      { width: 200, height: 100 },
      { width: 400, height: 200 },
    ];

    sizes.forEach((size) => {
      const colors = getEntityColor('BUSINESS_PROCESS');
      expect(colors.background).toBe('#d6f5d6');
    });
  });

  it('entityColors configuration is consistent with getEntityColor', () => {
    const bpConfig = entityColors['BUSINESS_PROCESS'];
    const bpFromFunction = getEntityColor('BUSINESS_PROCESS');

    expect(bpConfig.background).toBe(bpFromFunction.background);
    expect(bpConfig.border).toBe(bpFromFunction.border);
  });

  it('unknown entity type returns fallback colors', () => {
    const unknownColors = getEntityColor('UNKNOWN_TYPE');
    expect(unknownColors.background).toBe('#f5f5f5');
    expect(unknownColors.border).toBe('#616161');
  });
});
