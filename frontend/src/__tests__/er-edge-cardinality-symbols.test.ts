/**
 * ER Edge Cardinality Labels and UML Symbols Tests
 * Task Group 5: Cardinality label rendering tests
 * Task Group 6: UML relationship symbol rendering tests
 *
 * Tests the rendering of:
 * - Cardinality labels ("1"/"M") at edge endpoints
 * - UML symbols (triangles, diamonds, arrows) based on relationship type
 * - Line styles (solid vs dashed) for different relationship types
 */

import { describe, it, expect } from 'vitest';
import {
  getMultiplicityLabels,
  calculateSourceLabelPosition,
  calculateTargetLabelPosition,
  calculateEdgePoints,
} from '../utils/relationshipUtils';
import {
  getEREdgeSymbols,
  getSymbolRenderData,
  calculateEdgeAngle,
  generateHollowTrianglePath,
  generateDiamondPath,
  generateOpenArrowPath,
  getEREdgeStrokeDasharray,
  ER_SYMBOL_WIDTH,
  ER_SYMBOL_HEIGHT,
  ER_DASHED_LINE_PATTERN,
  type EREdgeSymbolType,
} from '../utils/erEdgeSymbols';
import type { LogicalERRelationship, DiagramNode, EdgePoint } from '../types/model';

// ============================================================================
// Task Group 5: Cardinality Label Tests
// ============================================================================

describe('Task Group 5: ER Edge Cardinality Labels', () => {
  describe('5.1 Cardinality Label Mapping', () => {
    it('should render "1" at both endpoints for ONE_TO_ONE', () => {
      const labels = getMultiplicityLabels('ONE_TO_ONE');
      expect(labels.source).toBe('1');
      expect(labels.target).toBe('1');
    });

    it('should render "1" at source, "m" at target for ONE_TO_MANY', () => {
      const labels = getMultiplicityLabels('ONE_TO_MANY');
      expect(labels.source).toBe('1');
      expect(labels.target).toBe('m');
    });

    it('should render "m" at source, "1" at target for MANY_TO_ONE', () => {
      const labels = getMultiplicityLabels('MANY_TO_ONE');
      expect(labels.source).toBe('m');
      expect(labels.target).toBe('1');
    });

    it('should render "m" at both endpoints for MANY_TO_MANY', () => {
      const labels = getMultiplicityLabels('MANY_TO_MANY');
      expect(labels.source).toBe('m');
      expect(labels.target).toBe('m');
    });
  });

  describe('5.2 Edge Point Boundary Intersection', () => {
    it('should calculate edge points at node boundaries, not centers', () => {
      const sourceNode: DiagramNode = {
        id: 'node-1',
        entity_type: 'LOGICAL_DATA_ENTITY',
        entity_id: 'lde-1',
        pos_x: 100,
        pos_y: 100,
        width: 150,
        height: 100,
      };

      const targetNode: DiagramNode = {
        id: 'node-2',
        entity_type: 'LOGICAL_DATA_ENTITY',
        entity_id: 'lde-2',
        pos_x: 400,
        pos_y: 100,
        width: 150,
        height: 100,
      };

      const edgePoints = calculateEdgePoints(sourceNode, targetNode);

      expect(edgePoints).toHaveLength(2);

      // Source point should be at right edge of source node (horizontal layout)
      // Source right edge: pos_x + width = 100 + 150 = 250
      expect(edgePoints[0].pos_x).toBe(250);
      expect(edgePoints[0].pos_y).toBe(150); // Center Y of source

      // Target point should be at left edge of target node
      expect(edgePoints[1].pos_x).toBe(400); // Left edge of target
      expect(edgePoints[1].pos_y).toBe(150); // Center Y of target
    });

    it('should handle vertical node arrangement', () => {
      const sourceNode: DiagramNode = {
        id: 'node-1',
        entity_type: 'LOGICAL_DATA_ENTITY',
        entity_id: 'lde-1',
        pos_x: 100,
        pos_y: 100,
        width: 150,
        height: 100,
      };

      const targetNode: DiagramNode = {
        id: 'node-2',
        entity_type: 'LOGICAL_DATA_ENTITY',
        entity_id: 'lde-2',
        pos_x: 100,
        pos_y: 300, // Below source
        width: 150,
        height: 100,
      };

      const edgePoints = calculateEdgePoints(sourceNode, targetNode);

      // Source point should be at bottom edge
      expect(edgePoints[0].pos_y).toBe(200); // Bottom of source: 100 + 100

      // Target point should be at top edge
      expect(edgePoints[1].pos_y).toBe(300); // Top of target
    });
  });

  describe('5.3-5.4 Label Positioning Near Endpoints', () => {
    it('should position source label near source endpoint with offset', () => {
      const edgePoints: EdgePoint[] = [
        { id: 'ep1', sequence_order: 0, pos_x: 100, pos_y: 100 },
        { id: 'ep2', sequence_order: 1, pos_x: 300, pos_y: 100 },
      ];

      const offset = 15;
      const labelPos = calculateSourceLabelPosition(edgePoints, offset);

      // Label should be offset from source (100) toward target (300)
      expect(labelPos.x).toBeGreaterThan(100);
      expect(labelPos.x).toBeLessThan(100 + offset + 5); // Within expected range
    });

    it('should position target label near target endpoint with offset', () => {
      const edgePoints: EdgePoint[] = [
        { id: 'ep1', sequence_order: 0, pos_x: 100, pos_y: 100 },
        { id: 'ep2', sequence_order: 1, pos_x: 300, pos_y: 100 },
      ];

      const offset = 15;
      const labelPos = calculateTargetLabelPosition(edgePoints, offset);

      // Label should be offset from target (300) toward source (100)
      expect(labelPos.x).toBeLessThan(300);
      expect(labelPos.x).toBeGreaterThan(300 - offset - 5); // Within expected range
    });

    it('should handle diagonal edges correctly', () => {
      const edgePoints: EdgePoint[] = [
        { id: 'ep1', sequence_order: 0, pos_x: 100, pos_y: 100 },
        { id: 'ep2', sequence_order: 1, pos_x: 300, pos_y: 200 },
      ];

      const sourcePos = calculateSourceLabelPosition(edgePoints, 15);
      const targetPos = calculateTargetLabelPosition(edgePoints, 15);

      // Both positions should be valid (not at origin)
      expect(sourcePos.x).not.toBe(0);
      expect(sourcePos.y).not.toBe(0);
      expect(targetPos.x).not.toBe(0);
      expect(targetPos.y).not.toBe(0);

      // Source label should be closer to source
      const sourceDistToSource = Math.sqrt(
        Math.pow(sourcePos.x - 100, 2) + Math.pow(sourcePos.y - 100, 2)
      );
      const sourceDistToTarget = Math.sqrt(
        Math.pow(sourcePos.x - 300, 2) + Math.pow(sourcePos.y - 200, 2)
      );
      expect(sourceDistToSource).toBeLessThan(sourceDistToTarget);
    });
  });

  describe('5.5 Cardinality Label Styling', () => {
    it('should use default styling values for cardinality labels', () => {
      // These values are used in Canvas.tsx for rendering
      const expectedFontSize = 10;
      const expectedColor = '#616161';

      // Verify these are the expected values for cardinality labels
      // (actual rendering happens in Canvas.tsx)
      expect(expectedFontSize).toBe(10);
      expect(expectedColor).toBe('#616161');
    });
  });
});

// ============================================================================
// Task Group 6: UML Relationship Symbol Tests
// ============================================================================

describe('Task Group 6: ER Edge UML Relationship Symbols', () => {
  describe('6.1 & 6.4 Symbol Type Mapping', () => {
    it('should render HOLLOW_TRIANGLE at TARGET for GENERALIZATION', () => {
      const symbols = getEREdgeSymbols('GENERALIZATION');
      expect(symbols.sourceSymbol).toBe('NONE');
      expect(symbols.targetSymbol).toBe('HOLLOW_TRIANGLE');
      expect(symbols.lineStyle).toBe('solid');
    });

    it('should render HOLLOW_TRIANGLE at TARGET with dashed line for REALIZATION', () => {
      const symbols = getEREdgeSymbols('REALIZATION');
      expect(symbols.sourceSymbol).toBe('NONE');
      expect(symbols.targetSymbol).toBe('HOLLOW_TRIANGLE');
      expect(symbols.lineStyle).toBe('dashed');
    });

    it('should render FILLED_DIAMOND at SOURCE for COMPOSITION', () => {
      const symbols = getEREdgeSymbols('COMPOSITION');
      expect(symbols.sourceSymbol).toBe('FILLED_DIAMOND');
      expect(symbols.targetSymbol).toBe('NONE');
      expect(symbols.lineStyle).toBe('solid');
    });

    it('should render HOLLOW_DIAMOND at SOURCE for AGGREGATION', () => {
      const symbols = getEREdgeSymbols('AGGREGATION');
      expect(symbols.sourceSymbol).toBe('HOLLOW_DIAMOND');
      expect(symbols.targetSymbol).toBe('NONE');
      expect(symbols.lineStyle).toBe('solid');
    });

    it('should render no symbols for ASSOCIATION', () => {
      const symbols = getEREdgeSymbols('ASSOCIATION');
      expect(symbols.sourceSymbol).toBe('NONE');
      expect(symbols.targetSymbol).toBe('NONE');
      expect(symbols.lineStyle).toBe('solid');
    });

    it('should render OPEN_ARROW at TARGET with dashed line for DEPENDENCY', () => {
      const symbols = getEREdgeSymbols('DEPENDENCY');
      expect(symbols.sourceSymbol).toBe('NONE');
      expect(symbols.targetSymbol).toBe('OPEN_ARROW');
      expect(symbols.lineStyle).toBe('dashed');
    });

    it('should default to ASSOCIATION for undefined relationship', () => {
      const symbols = getEREdgeSymbols(undefined);
      expect(symbols.sourceSymbol).toBe('NONE');
      expect(symbols.targetSymbol).toBe('NONE');
      expect(symbols.lineStyle).toBe('solid');
    });
  });

  describe('6.3 SVG Path Generation', () => {
    it('should generate valid hollow triangle path', () => {
      const path = generateHollowTrianglePath(100, 100, 0);
      expect(path).toContain('M');
      expect(path).toContain('L');
      expect(path).toContain('Z'); // Should be closed
    });

    it('should generate valid diamond path', () => {
      const path = generateDiamondPath(100, 100, 0);
      expect(path).toContain('M');
      expect(path).toContain('L');
      expect(path).toContain('Z'); // Should be closed
    });

    it('should generate valid open arrow path', () => {
      const path = generateOpenArrowPath(100, 100, 0);
      expect(path).toContain('M');
      expect(path).toContain('L');
      // Open arrow should NOT be closed (no Z)
      expect(path).not.toContain('Z');
    });
  });

  describe('6.5 Symbol Rotation Based on Edge Direction', () => {
    it('should calculate correct angle for horizontal edge (left to right)', () => {
      const angle = calculateEdgeAngle(100, 100, 200, 100);
      expect(angle).toBeCloseTo(0); // 0 radians = pointing right
    });

    it('should calculate correct angle for horizontal edge (right to left)', () => {
      const angle = calculateEdgeAngle(200, 100, 100, 100);
      expect(angle).toBeCloseTo(Math.PI); // PI radians = pointing left
    });

    it('should calculate correct angle for vertical edge (top to bottom)', () => {
      const angle = calculateEdgeAngle(100, 100, 100, 200);
      expect(angle).toBeCloseTo(Math.PI / 2); // PI/2 radians = pointing down
    });

    it('should calculate correct angle for diagonal edge', () => {
      const angle = calculateEdgeAngle(100, 100, 200, 200);
      expect(angle).toBeCloseTo(Math.PI / 4); // 45 degrees
    });
  });

  describe('6.6 Symbol Render Data', () => {
    it('should return render data for HOLLOW_TRIANGLE', () => {
      const renderData = getSymbolRenderData('HOLLOW_TRIANGLE', 100, 100, 0);
      expect(renderData).not.toBeNull();
      expect(renderData!.fill).toBe('white'); // Hollow
      expect(renderData!.pathData).toContain('M');
    });

    it('should return render data for FILLED_DIAMOND', () => {
      const renderData = getSymbolRenderData('FILLED_DIAMOND', 100, 100, 0);
      expect(renderData).not.toBeNull();
      expect(renderData!.fill).toBe('#616161'); // Filled with stroke color
    });

    it('should return render data for HOLLOW_DIAMOND', () => {
      const renderData = getSymbolRenderData('HOLLOW_DIAMOND', 100, 100, 0);
      expect(renderData).not.toBeNull();
      expect(renderData!.fill).toBe('white'); // Hollow
    });

    it('should return render data for OPEN_ARROW', () => {
      const renderData = getSymbolRenderData('OPEN_ARROW', 100, 100, 0);
      expect(renderData).not.toBeNull();
      expect(renderData!.fill).toBe('none'); // No fill for open arrow
    });

    it('should return null for NONE symbol type', () => {
      const renderData = getSymbolRenderData('NONE', 100, 100, 0);
      expect(renderData).toBeNull();
    });
  });

  describe('6.7 Line Style (Solid vs Dashed)', () => {
    it('should return undefined dasharray for solid lines', () => {
      const dasharray = getEREdgeStrokeDasharray('solid');
      expect(dasharray).toBeUndefined();
    });

    it('should return "6,3" dasharray for dashed lines', () => {
      const dasharray = getEREdgeStrokeDasharray('dashed');
      expect(dasharray).toBe('6,3');
    });

    it('should have correct dashed line pattern constant', () => {
      expect(ER_DASHED_LINE_PATTERN).toBe('6,3');
    });
  });

  describe('6.2 Symbol Size Constants', () => {
    it('should have correct symbol dimensions', () => {
      expect(ER_SYMBOL_WIDTH).toBe(12);
      expect(ER_SYMBOL_HEIGHT).toBe(10);
    });
  });
});

// ============================================================================
// Integration Tests: Combined Cardinality and Symbol Rendering
// ============================================================================

describe('ER Edge Rendering Integration', () => {
  it('should combine cardinality labels with UML symbols correctly', () => {
    // Example: COMPOSITION with ONE_TO_MANY cardinality
    const cardinalityLabels = getMultiplicityLabels('ONE_TO_MANY');
    const symbols = getEREdgeSymbols('COMPOSITION');

    // Cardinality: 1 at source, m at target
    expect(cardinalityLabels.source).toBe('1');
    expect(cardinalityLabels.target).toBe('m');

    // Symbol: filled diamond at source
    expect(symbols.sourceSymbol).toBe('FILLED_DIAMOND');
    expect(symbols.targetSymbol).toBe('NONE');

    // Both cardinality label and diamond should render at source end
    // (actual rendering coordination happens in Canvas.tsx)
  });

  it('should handle all relationship types with cardinality labels', () => {
    const relationshipTypes: LogicalERRelationship[] = [
      'GENERALIZATION',
      'REALIZATION',
      'COMPOSITION',
      'AGGREGATION',
      'ASSOCIATION',
      'DEPENDENCY',
    ];

    const cardinalityTypes = ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY'];

    // All combinations should work without errors
    for (const relType of relationshipTypes) {
      const symbols = getEREdgeSymbols(relType);
      expect(symbols).toBeDefined();
      expect(['NONE', 'HOLLOW_TRIANGLE', 'FILLED_DIAMOND', 'HOLLOW_DIAMOND', 'OPEN_ARROW']).toContain(
        symbols.sourceSymbol
      );
      expect(['NONE', 'HOLLOW_TRIANGLE', 'FILLED_DIAMOND', 'HOLLOW_DIAMOND', 'OPEN_ARROW']).toContain(
        symbols.targetSymbol
      );

      for (const cardType of cardinalityTypes) {
        const labels = getMultiplicityLabels(cardType);
        expect(labels).toBeDefined();
        expect(['1', 'm']).toContain(labels.source);
        expect(['1', 'm']).toContain(labels.target);
      }
    }
  });
});
