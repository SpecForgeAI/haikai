/**
 * Label Decoration Utilities Tests
 * Spec 2025-12-31 (A5): Tests for label decoration creation and manipulation utilities
 *
 * These tests verify:
 * - Task 5.6: Create label decorations on Activity node creation
 * - Task 5.7: Create label decorations on Activity Flow creation
 * - Task 5.9: Drag handler for label decorations
 * - Task 5.10: Resize handler for label decorations
 * - Task 5.11: Handle existing diagrams without label decorations
 */

import {
  shouldCreateNodeLabelDecoration,
  createNodeLabelDecoration,
  createEdgeLabelDecoration,
  startLabelDrag,
  calculateLabelDragPosition,
  endLabelDrag,
  startLabelResize,
  calculateLabelResizeBounds,
  endLabelResize,
  isClickOnVirtualLabel,
  persistVirtualLabel,
  findLabelDecoration,
  initialLabelDragState,
  initialLabelResizeState,
} from '../utils/labelDecorationUtils';
import { LabelDecoration, DiagramNode } from '../types/model';

describe('Label Decoration Utils', () => {
  // ========================================================================
  // Task 5.6: Node Label Decoration Tests
  // ========================================================================

  describe('shouldCreateNodeLabelDecoration', () => {
    it('returns true for Action activity kind', () => {
      expect(shouldCreateNodeLabelDecoration('Action')).toBe(true);
    });

    it('returns true for Decision activity kind', () => {
      expect(shouldCreateNodeLabelDecoration('Decision')).toBe(true);
    });

    it('returns false for Initial activity kind', () => {
      expect(shouldCreateNodeLabelDecoration('Initial')).toBe(false);
    });

    it('returns false for Merge activity kind', () => {
      expect(shouldCreateNodeLabelDecoration('Merge')).toBe(false);
    });

    it('returns false for Final activity kind', () => {
      expect(shouldCreateNodeLabelDecoration('Final')).toBe(false);
    });
  });

  describe('createNodeLabelDecoration', () => {
    const nodeBounds = { x: 100, y: 100, width: 140, height: 50 };

    it('creates label decoration for Action node', () => {
      const label = createNodeLabelDecoration('node_1', nodeBounds, 'Action', 'Test Action');
      expect(label).not.toBeNull();
      expect(label!.targetKind).toBe('NODE');
      expect(label!.targetId).toBe('node_1');
      expect(label!.text).toBe('Test Action');
    });

    it('creates label decoration for Decision node', () => {
      const label = createNodeLabelDecoration('node_2', nodeBounds, 'Decision', 'Test Decision');
      expect(label).not.toBeNull();
      expect(label!.targetKind).toBe('NODE');
      expect(label!.targetId).toBe('node_2');
    });

    it('returns null for Initial node', () => {
      const label = createNodeLabelDecoration('node_3', nodeBounds, 'Initial');
      expect(label).toBeNull();
    });

    it('returns null for Merge node', () => {
      const label = createNodeLabelDecoration('node_4', nodeBounds, 'Merge');
      expect(label).toBeNull();
    });

    it('returns null for Final node', () => {
      const label = createNodeLabelDecoration('node_5', nodeBounds, 'Final');
      expect(label).toBeNull();
    });

    it('creates label with correct position for Action (centered inside)', () => {
      const label = createNodeLabelDecoration('node_1', nodeBounds, 'Action');
      expect(label).not.toBeNull();
      // Action label should be centered - x should be around node center minus half label width
      const nodeCenterX = nodeBounds.x + nodeBounds.width / 2;
      const labelCenterX = label!.x + label!.width / 2;
      expect(Math.abs(nodeCenterX - labelCenterX)).toBeLessThan(5);
    });

    it('creates label with correct position for Decision (below diamond)', () => {
      const label = createNodeLabelDecoration('node_2', nodeBounds, 'Decision');
      expect(label).not.toBeNull();
      // Decision label should be below the node
      expect(label!.y).toBeGreaterThanOrEqual(nodeBounds.y + nodeBounds.height);
    });
  });

  // ========================================================================
  // Task 5.7: Edge Label Decoration Tests
  // ========================================================================

  describe('createEdgeLabelDecoration', () => {
    const sourceNode: DiagramNode = {
      id: 'source_node',
      entity_type: 'ACTIVITY',
      entity_id: 'activity_1',
      pos_x: 100,
      pos_y: 100,
      width: 140,
      height: 50,
      z_index: 100,
    };

    const targetNode: DiagramNode = {
      id: 'target_node',
      entity_type: 'ACTIVITY',
      entity_id: 'activity_2',
      pos_x: 300,
      pos_y: 200,
      width: 140,
      height: 50,
      z_index: 100,
    };

    it('creates edge label decoration with correct target', () => {
      const label = createEdgeLabelDecoration('edge_1', sourceNode, targetNode, 'Condition');
      expect(label.targetKind).toBe('EDGE');
      expect(label.targetId).toBe('edge_1');
      expect(label.text).toBe('Condition');
    });

    it('creates edge label near midpoint of edge', () => {
      const label = createEdgeLabelDecoration('edge_1', sourceNode, targetNode);

      // Calculate expected midpoint
      const sourceCenterX = sourceNode.pos_x + sourceNode.width / 2;
      const sourceCenterY = sourceNode.pos_y + sourceNode.height / 2;
      const targetCenterX = targetNode.pos_x + targetNode.width / 2;
      const targetCenterY = targetNode.pos_y + targetNode.height / 2;
      const midpointX = (sourceCenterX + targetCenterX) / 2;
      const midpointY = (sourceCenterY + targetCenterY) / 2;

      // Label center should be near midpoint (within reasonable tolerance)
      const labelCenterX = label.x + label.width / 2;
      expect(Math.abs(midpointX - labelCenterX)).toBeLessThan(50);
    });
  });

  // ========================================================================
  // Task 5.9: Drag Handler Tests
  // ========================================================================

  describe('Label Drag Handler', () => {
    const mockLabelDecoration: LabelDecoration = {
      id: 'label_1',
      targetKind: 'NODE',
      targetId: 'node_1',
      x: 100,
      y: 100,
      width: 80,
      height: 20,
    };

    it('starts drag with correct state', () => {
      const dragState = startLabelDrag(mockLabelDecoration, 150, 150);
      expect(dragState.isDragging).toBe(true);
      expect(dragState.labelDecorationId).toBe('label_1');
      expect(dragState.startX).toBe(100);
      expect(dragState.startY).toBe(100);
      expect(dragState.mouseStartX).toBe(150);
      expect(dragState.mouseStartY).toBe(150);
    });

    it('calculates drag position correctly', () => {
      const dragState = startLabelDrag(mockLabelDecoration, 150, 150);

      // Drag 50 pixels right and 30 pixels down
      const newPos = calculateLabelDragPosition(dragState, 200, 180);
      expect(newPos.x).toBe(150); // 100 + (200 - 150)
      expect(newPos.y).toBe(130); // 100 + (180 - 150)
    });

    it('ends drag and resets state', () => {
      const dragState = endLabelDrag();
      expect(dragState.isDragging).toBe(false);
      expect(dragState.labelDecorationId).toBeNull();
      expect(dragState).toEqual(initialLabelDragState);
    });
  });

  // ========================================================================
  // Task 5.10: Resize Handler Tests
  // ========================================================================

  describe('Label Resize Handler', () => {
    const mockLabelDecoration: LabelDecoration = {
      id: 'label_1',
      targetKind: 'NODE',
      targetId: 'node_1',
      x: 100,
      y: 100,
      width: 80,
      height: 20,
    };

    it('starts resize with correct state', () => {
      const resizeState = startLabelResize(mockLabelDecoration, 'se', 180, 120);
      expect(resizeState.isResizing).toBe(true);
      expect(resizeState.labelDecorationId).toBe('label_1');
      expect(resizeState.handle).toBe('se');
      expect(resizeState.startX).toBe(100);
      expect(resizeState.startY).toBe(100);
      expect(resizeState.startWidth).toBe(80);
      expect(resizeState.startHeight).toBe(20);
    });

    it('calculates resize bounds for SE handle correctly', () => {
      const resizeState = startLabelResize(mockLabelDecoration, 'se', 180, 120);

      // Resize by dragging SE corner 20 right and 10 down
      const newBounds = calculateLabelResizeBounds(resizeState, 200, 130);
      expect(newBounds.x).toBe(100); // Position unchanged for SE
      expect(newBounds.y).toBe(100); // Position unchanged for SE
      expect(newBounds.width).toBe(100); // 80 + 20
      expect(newBounds.height).toBe(30); // 20 + 10
    });

    it('calculates resize bounds for NW handle correctly', () => {
      const resizeState = startLabelResize(mockLabelDecoration, 'nw', 100, 100);

      // Resize by dragging NW corner 20 left and 10 up
      const newBounds = calculateLabelResizeBounds(resizeState, 80, 90);
      expect(newBounds.x).toBe(80); // 100 - 20
      expect(newBounds.y).toBe(90); // 100 - 10
      expect(newBounds.width).toBe(100); // 80 - (-20) = 100
      expect(newBounds.height).toBe(30); // 20 - (-10) = 30
    });

    it('enforces minimum width', () => {
      const resizeState = startLabelResize(mockLabelDecoration, 'se', 180, 120);

      // Try to shrink below minimum
      const newBounds = calculateLabelResizeBounds(resizeState, 100, 120); // dx = -80
      expect(newBounds.width).toBeGreaterThanOrEqual(20); // MIN_LABEL_WIDTH
    });

    it('enforces minimum height', () => {
      const resizeState = startLabelResize(mockLabelDecoration, 'se', 180, 120);

      // Try to shrink below minimum
      const newBounds = calculateLabelResizeBounds(resizeState, 180, 100); // dy = -20
      expect(newBounds.height).toBeGreaterThanOrEqual(14); // MIN_LABEL_HEIGHT
    });

    it('ends resize and resets state', () => {
      const resizeState = endLabelResize();
      expect(resizeState.isResizing).toBe(false);
      expect(resizeState.labelDecorationId).toBeNull();
      expect(resizeState).toEqual(initialLabelResizeState);
    });
  });

  // ========================================================================
  // Task 5.11: Virtual Mode Tests
  // ========================================================================

  describe('Virtual Label Handling', () => {
    const virtualBounds = { x: 100, y: 100, width: 80, height: 20 };

    it('detects click inside virtual label', () => {
      expect(isClickOnVirtualLabel(120, 110, virtualBounds)).toBe(true);
    });

    it('detects click outside virtual label', () => {
      expect(isClickOnVirtualLabel(50, 50, virtualBounds)).toBe(false);
    });

    it('detects click at virtual label boundary', () => {
      expect(isClickOnVirtualLabel(100, 100, virtualBounds)).toBe(true);
      expect(isClickOnVirtualLabel(180, 120, virtualBounds)).toBe(true);
    });

    it('persists virtual label to decoration', () => {
      const labelDec = persistVirtualLabel('NODE', 'node_1', virtualBounds, 'Test Label');
      expect(labelDec.targetKind).toBe('NODE');
      expect(labelDec.targetId).toBe('node_1');
      expect(labelDec.x).toBe(100);
      expect(labelDec.y).toBe(100);
      expect(labelDec.width).toBe(80);
      expect(labelDec.height).toBe(20);
      expect(labelDec.text).toBe('Test Label');
    });
  });

  // ========================================================================
  // Utility Function Tests
  // ========================================================================

  describe('findLabelDecoration', () => {
    const labelDecorations: LabelDecoration[] = [
      { id: 'label_1', targetKind: 'NODE', targetId: 'node_1', x: 0, y: 0, width: 80, height: 20 },
      { id: 'label_2', targetKind: 'EDGE', targetId: 'edge_1', x: 0, y: 0, width: 80, height: 20 },
      { id: 'label_3', targetKind: 'NODE', targetId: 'node_2', x: 0, y: 0, width: 80, height: 20 },
    ];

    it('finds label decoration by node target', () => {
      const found = findLabelDecoration(labelDecorations, 'NODE', 'node_1');
      expect(found).toBeDefined();
      expect(found!.id).toBe('label_1');
    });

    it('finds label decoration by edge target', () => {
      const found = findLabelDecoration(labelDecorations, 'EDGE', 'edge_1');
      expect(found).toBeDefined();
      expect(found!.id).toBe('label_2');
    });

    it('returns undefined for non-existent target', () => {
      const found = findLabelDecoration(labelDecorations, 'NODE', 'node_999');
      expect(found).toBeUndefined();
    });
  });
});
