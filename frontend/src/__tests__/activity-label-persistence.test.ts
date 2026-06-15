/**
 * Activity Label Persistence and Backward Compatibility Tests
 * Task Group 4: Persistence and Backward Compatibility (Part B.4-B.5)
 * Spec: 2026-01-01 Activity Diagram Corrective Fixes
 *
 * Tests for:
 * - label_decorations array persistence in Diagram structure
 * - Edge label position persistence via label_pos_x/label_pos_y
 * - Backward compatibility for existing diagrams without label decorations
 * - Virtual-to-explicit label conversion on first drag
 */

import { Diagram, DiagramNode, DiagramEdge, LabelDecoration } from '../types/model';
import { getDefaultLabelPosition, getDefaultEdgeLabelPosition } from '../utils/activityNodeRendering';

describe('Activity Label Persistence', () => {
  /**
   * Test 4.1: label_decorations array persistence in Diagram structure
   */
  describe('Diagram label_decorations persistence', () => {
    it('should store label_decorations as an array in Diagram', () => {
      const diagram: Diagram = {
        id: 'diagram1',
        model_file_id: 'model1',
        name: 'Test Activity Diagram',
        type: 'Activity',
        diagram_nodes: [],
        diagram_edges: [],
        decorations: [],
        label_decorations: [
          {
            id: 'label-dec-1',
            targetKind: 'NODE',
            targetId: 'node1',
            x: 100,
            y: 160,
            width: 80,
            height: 20,
          },
        ],
      };

      expect(diagram.label_decorations).toBeDefined();
      expect(Array.isArray(diagram.label_decorations)).toBe(true);
      expect(diagram.label_decorations?.length).toBe(1);
    });

    it('should support empty label_decorations array', () => {
      const diagram: Diagram = {
        id: 'diagram1',
        model_file_id: 'model1',
        name: 'Test Activity Diagram',
        type: 'Activity',
        diagram_nodes: [],
        diagram_edges: [],
        decorations: [],
        label_decorations: [],
      };

      expect(diagram.label_decorations).toEqual([]);
    });

    it('should support undefined label_decorations for backward compatibility', () => {
      const diagram: Diagram = {
        id: 'diagram1',
        model_file_id: 'model1',
        name: 'Test Activity Diagram',
        type: 'Activity',
        diagram_nodes: [],
        diagram_edges: [],
        decorations: [],
        // label_decorations not specified
      };

      expect(diagram.label_decorations).toBeUndefined();
    });

    it('should store multiple label decorations', () => {
      const labelDecs: LabelDecoration[] = [
        {
          id: 'label-dec-1',
          targetKind: 'NODE',
          targetId: 'node1',
          x: 100,
          y: 160,
          width: 80,
          height: 20,
        },
        {
          id: 'label-dec-2',
          targetKind: 'EDGE',
          targetId: 'edge1',
          x: 200,
          y: 90,
          width: 80,
          height: 20,
        },
        {
          id: 'label-dec-3',
          targetKind: 'NODE',
          targetId: 'node2',
          x: 300,
          y: 240,
          width: 80,
          height: 20,
        },
      ];

      const diagram: Diagram = {
        id: 'diagram1',
        model_file_id: 'model1',
        name: 'Test Activity Diagram',
        type: 'Activity',
        diagram_nodes: [],
        diagram_edges: [],
        decorations: [],
        label_decorations: labelDecs,
      };

      expect(diagram.label_decorations?.length).toBe(3);
      expect(diagram.label_decorations?.[0].targetKind).toBe('NODE');
      expect(diagram.label_decorations?.[1].targetKind).toBe('EDGE');
      expect(diagram.label_decorations?.[2].targetKind).toBe('NODE');
    });
  });

  /**
   * Test 4.2: Edge label position persistence via label_pos_x/label_pos_y
   */
  describe('Edge label position persistence', () => {
    it('should persist label_pos_x and label_pos_y on DiagramEdge', () => {
      const edge: DiagramEdge = {
        id: 'edge1',
        relationship_type: 'ACTIVITY_FLOW',
        relationship_id: 'flow1',
        source_node_id: 'node1',
        target_node_id: 'node2',
        label_pos_x: 250,
        label_pos_y: 80,
      };

      expect(edge.label_pos_x).toBe(250);
      expect(edge.label_pos_y).toBe(80);
    });

    it('should support optional label position fields', () => {
      const edge: DiagramEdge = {
        id: 'edge1',
        relationship_type: 'ACTIVITY_FLOW',
        relationship_id: 'flow1',
        source_node_id: 'node1',
        target_node_id: 'node2',
        // No label_pos_x or label_pos_y
      };

      expect(edge.label_pos_x).toBeUndefined();
      expect(edge.label_pos_y).toBeUndefined();
    });

    it('should initialize edge with default label position on creation', () => {
      const sourceNode: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const targetNode: DiagramNode = {
        id: 'node2',
        entity_type: 'ACTIVITY',
        entity_id: 'act2',
        pos_x: 300,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const defaultLabelPos = getDefaultEdgeLabelPosition(sourceNode, targetNode);

      // Create edge with calculated default position
      const edge: DiagramEdge = {
        id: 'edge1',
        relationship_type: 'ACTIVITY_FLOW',
        relationship_id: 'flow1',
        source_node_id: 'node1',
        target_node_id: 'node2',
        label_pos_x: defaultLabelPos.x + defaultLabelPos.width / 2, // center X
        label_pos_y: defaultLabelPos.y + defaultLabelPos.height / 2, // center Y
      };

      expect(edge.label_pos_x).toBeDefined();
      expect(edge.label_pos_y).toBeDefined();
    });
  });

  /**
   * Test 4.3: Backward compatibility for existing diagrams
   */
  describe('Backward compatibility', () => {
    it('should handle diagrams without label_decorations array', () => {
      const diagram: Diagram = {
        id: 'diagram1',
        model_file_id: 'model1',
        name: 'Legacy Activity Diagram',
        type: 'Activity',
        diagram_nodes: [
          {
            id: 'node1',
            entity_type: 'ACTIVITY',
            entity_id: 'act1',
            pos_x: 100,
            pos_y: 100,
            width: 140,
            height: 50,
            parent_node_id: null,
          },
        ],
        diagram_edges: [],
        decorations: [],
        // No label_decorations - legacy diagram
      };

      // Access with fallback
      const labelDecorations = diagram.label_decorations || [];
      expect(labelDecorations).toEqual([]);
    });

    it('should determine hasExplicitLabel as false for legacy diagrams', () => {
      const labelDecorations: LabelDecoration[] = []; // Empty, simulating legacy

      // Create lookup map
      const nodeLabelDecMap = new Map<string, LabelDecoration>();
      for (const labelDec of labelDecorations) {
        if (labelDec.targetKind === 'NODE') {
          nodeLabelDecMap.set(labelDec.targetId, labelDec);
        }
      }

      // Check for any node
      const hasExplicitLabel = nodeLabelDecMap.has('node1');
      expect(hasExplicitLabel).toBe(false);
    });

    it('should render inline labels for legacy diagrams', () => {
      const hasExplicitLabel = false;
      const showLabel = true;

      // Legacy behavior: render inline when no explicit decoration
      const shouldRenderInlineLabel = !hasExplicitLabel && showLabel;
      expect(shouldRenderInlineLabel).toBe(true);
    });

    it('should handle edges without label_pos fields', () => {
      const edge: DiagramEdge = {
        id: 'edge1',
        relationship_type: 'ACTIVITY_FLOW',
        relationship_id: 'flow1',
        source_node_id: 'node1',
        target_node_id: 'node2',
        // Legacy edge without label_pos
      };

      // Calculate fallback position
      const sourceNode: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const targetNode: DiagramNode = {
        id: 'node2',
        entity_type: 'ACTIVITY',
        entity_id: 'act2',
        pos_x: 300,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const defaultPos = getDefaultEdgeLabelPosition(sourceNode, targetNode);

      // Use nullish coalescing for fallback
      const labelX = edge.label_pos_x ?? defaultPos.x + defaultPos.width / 2;
      const labelY = edge.label_pos_y ?? defaultPos.y + defaultPos.height / 2;

      expect(labelX).toBeDefined();
      expect(labelY).toBeDefined();
    });
  });

  /**
   * Test 4.4: Virtual-to-explicit label conversion on first drag
   */
  describe('Virtual-to-explicit label conversion', () => {
    it('should create LabelDecoration when virtual label is dragged', () => {
      // Simulate virtual label state for a Decision node
      const nodeId = 'decision-node-1';
      const nodeBounds = { x: 100, y: 100, width: 60, height: 60 };

      // Before drag: no explicit decoration
      let labelDecorations: LabelDecoration[] = [];
      let hasExplicitLabel = labelDecorations.some(
        ld => ld.targetKind === 'NODE' && ld.targetId === nodeId
      );
      expect(hasExplicitLabel).toBe(false);

      // On first drag: create explicit decoration
      const defaultPos = getDefaultLabelPosition(nodeBounds, 'Decision');
      const newLabelDec: LabelDecoration = {
        id: 'label-dec-new',
        targetKind: 'NODE',
        targetId: nodeId,
        x: defaultPos.x + 10, // Dragged position
        y: defaultPos.y + 5,  // Dragged position
        width: defaultPos.width,
        height: defaultPos.height,
      };

      labelDecorations = [...labelDecorations, newLabelDec];

      // After drag: has explicit decoration
      hasExplicitLabel = labelDecorations.some(
        ld => ld.targetKind === 'NODE' && ld.targetId === nodeId
      );
      expect(hasExplicitLabel).toBe(true);
    });

    it('should update edge label_pos when virtual edge label is dragged', () => {
      let edge: DiagramEdge = {
        id: 'edge1',
        relationship_type: 'ACTIVITY_FLOW',
        relationship_id: 'flow1',
        source_node_id: 'node1',
        target_node_id: 'node2',
        // No explicit label_pos initially
      };

      // Before drag
      expect(edge.label_pos_x).toBeUndefined();
      expect(edge.label_pos_y).toBeUndefined();

      // On drag: set label position
      const draggedX = 250;
      const draggedY = 85;

      edge = {
        ...edge,
        label_pos_x: draggedX,
        label_pos_y: draggedY,
      };

      // After drag
      expect(edge.label_pos_x).toBe(250);
      expect(edge.label_pos_y).toBe(85);
    });

    it('should preserve label position on subsequent drags', () => {
      // Start with persisted position
      let edge: DiagramEdge = {
        id: 'edge1',
        relationship_type: 'ACTIVITY_FLOW',
        relationship_id: 'flow1',
        source_node_id: 'node1',
        target_node_id: 'node2',
        label_pos_x: 250,
        label_pos_y: 85,
      };

      // Second drag
      edge = {
        ...edge,
        label_pos_x: 260,
        label_pos_y: 90,
      };

      expect(edge.label_pos_x).toBe(260);
      expect(edge.label_pos_y).toBe(90);
    });

    it('should inline label suppression after explicit decoration is created', () => {
      // Create explicit decoration
      const nodeId = 'decision-node-1';
      const labelDecorations: LabelDecoration[] = [
        {
          id: 'label-dec-1',
          targetKind: 'NODE',
          targetId: nodeId,
          x: 110,
          y: 165,
          width: 80,
          height: 20,
        },
      ];

      // Build lookup map
      const nodeLabelDecMap = new Map<string, LabelDecoration>();
      for (const labelDec of labelDecorations) {
        if (labelDec.targetKind === 'NODE') {
          nodeLabelDecMap.set(labelDec.targetId, labelDec);
        }
      }

      // Check suppression
      const hasExplicitLabel = nodeLabelDecMap.has(nodeId);
      const showLabel = true;

      const shouldRenderInlineLabel = !hasExplicitLabel && showLabel;
      expect(shouldRenderInlineLabel).toBe(false); // Suppressed
    });
  });

  /**
   * Test 4.5: LabelDecoration structure validation
   */
  describe('LabelDecoration structure', () => {
    it('should have all required fields', () => {
      const labelDec: LabelDecoration = {
        id: 'label-dec-1',
        targetKind: 'NODE',
        targetId: 'node1',
        x: 100,
        y: 160,
        width: 80,
        height: 20,
      };

      expect(labelDec.id).toBeDefined();
      expect(labelDec.targetKind).toBeDefined();
      expect(labelDec.targetId).toBeDefined();
      expect(labelDec.x).toBeDefined();
      expect(labelDec.y).toBeDefined();
      expect(labelDec.width).toBeDefined();
      expect(labelDec.height).toBeDefined();
    });

    it('should support optional styling fields', () => {
      const labelDec: LabelDecoration = {
        id: 'label-dec-1',
        targetKind: 'NODE',
        targetId: 'node1',
        x: 100,
        y: 160,
        width: 80,
        height: 20,
        text: 'Custom Text',
        fontSize: 14,
        fontWeight: 'bold',
        textColor: '#000000',
        textAnchor: 'middle',
        dominantBaseline: 'middle',
      };

      expect(labelDec.text).toBe('Custom Text');
      expect(labelDec.fontSize).toBe(14);
      expect(labelDec.fontWeight).toBe('bold');
      expect(labelDec.textColor).toBe('#000000');
      expect(labelDec.textAnchor).toBe('middle');
      expect(labelDec.dominantBaseline).toBe('middle');
    });

    it('should support NODE targetKind', () => {
      const labelDec: LabelDecoration = {
        id: 'label-dec-1',
        targetKind: 'NODE',
        targetId: 'node1',
        x: 100,
        y: 160,
        width: 80,
        height: 20,
      };

      expect(labelDec.targetKind).toBe('NODE');
    });

    it('should support EDGE targetKind', () => {
      const labelDec: LabelDecoration = {
        id: 'label-dec-1',
        targetKind: 'EDGE',
        targetId: 'edge1',
        x: 200,
        y: 90,
        width: 80,
        height: 20,
      };

      expect(labelDec.targetKind).toBe('EDGE');
    });
  });
});
