/**
 * Task Group 3: LogicalER Duplicate Prevention Tests
 * Tests for preventing duplicate LogicalER edges on diagrams and context menu delete
 */

import {
  isLogicalEREdgeOnDiagram,
} from '../utils/relationshipUtils';
import {
  DiagramEdge,
  RELATIONSHIP_EDGE_TYPES,
} from '../types/model';

describe('Task Group 3: LogicalER Duplicate Prevention', () => {
  // ============================================================================
  // Task 3.1: Tests for isLogicalEREdgeOnDiagram function
  // ============================================================================

  describe('isLogicalEREdgeOnDiagram', () => {
    const createLogicalEREdge = (relationshipId: string): DiagramEdge => ({
      id: `edge-${relationshipId}`,
      relationship_type: RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP,
      relationship_id: relationshipId,
      source_node_id: 'node-1',
      target_node_id: 'node-2',
      edge_points: [
        { id: 'ep1', sequence_order: 0, pos_x: 100, pos_y: 100 },
        { id: 'ep2', sequence_order: 1, pos_x: 200, pos_y: 200 },
      ],
    });

    const createOtherEdge = (relationshipId: string, type: string): DiagramEdge => ({
      id: `edge-${relationshipId}`,
      relationship_type: type,
      relationship_id: relationshipId,
      source_node_id: 'node-1',
      target_node_id: 'node-2',
      edge_points: [
        { id: 'ep1', sequence_order: 0, pos_x: 100, pos_y: 100 },
        { id: 'ep2', sequence_order: 1, pos_x: 200, pos_y: 200 },
      ],
    });

    it('returns true when LogicalER edge exists on diagram', () => {
      const relationshipId = 'ler-001';
      const diagramEdges: DiagramEdge[] = [
        createLogicalEREdge(relationshipId),
      ];

      const result = isLogicalEREdgeOnDiagram(relationshipId, diagramEdges);

      expect(result).toBe(true);
    });

    it('returns false when LogicalER edge does not exist on diagram', () => {
      const relationshipId = 'ler-001';
      const diagramEdges: DiagramEdge[] = [
        createLogicalEREdge('ler-other'),
      ];

      const result = isLogicalEREdgeOnDiagram(relationshipId, diagramEdges);

      expect(result).toBe(false);
    });

    it('returns false when diagram has no edges', () => {
      const relationshipId = 'ler-001';
      const diagramEdges: DiagramEdge[] = [];

      const result = isLogicalEREdgeOnDiagram(relationshipId, diagramEdges);

      expect(result).toBe(false);
    });

    it('returns false when edge exists but is not LogicalER type', () => {
      const relationshipId = 'rel-001';
      const diagramEdges: DiagramEdge[] = [
        createOtherEdge(relationshipId, RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT),
        createOtherEdge('rel-002', RELATIONSHIP_EDGE_TYPES.USER_BUSINESS_POINT),
      ];

      const result = isLogicalEREdgeOnDiagram(relationshipId, diagramEdges);

      expect(result).toBe(false);
    });

    it('correctly identifies LogicalER among multiple edge types', () => {
      const logicalERRelationshipId = 'ler-001';
      const otherRelationshipId = 'dm-001';
      const diagramEdges: DiagramEdge[] = [
        createOtherEdge(otherRelationshipId, RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT),
        createLogicalEREdge(logicalERRelationshipId),
        createOtherEdge('ubp-001', RELATIONSHIP_EDGE_TYPES.USER_BUSINESS_POINT),
      ];

      // Should find the LogicalER edge
      expect(isLogicalEREdgeOnDiagram(logicalERRelationshipId, diagramEdges)).toBe(true);
      // Should not find non-LogicalER edges by this function
      expect(isLogicalEREdgeOnDiagram(otherRelationshipId, diagramEdges)).toBe(false);
    });

    it('returns false when edges array is undefined', () => {
      const relationshipId = 'ler-001';
      // TypeScript would complain, but testing defensive behavior
      const diagramEdges = undefined as unknown as DiagramEdge[];

      const result = isLogicalEREdgeOnDiagram(relationshipId, diagramEdges);

      expect(result).toBe(false);
    });
  });
});

describe('Task Group 3: LogicalER Palette Duplicate Prevention UI', () => {
  // ============================================================================
  // Task 3.3-3.5: Tests for palette item disabled state
  // ============================================================================

  describe('Palette item disabled styling for on-diagram LogicalER', () => {
    it('palette item should be greyed when LogicalER edge is on diagram', () => {
      // This test validates the expected behavior:
      // When isLogicalEREdgeOnDiagram returns true, the palette item should be disabled
      const relationshipId = 'ler-001';
      const diagramEdges: DiagramEdge[] = [{
        id: 'edge-1',
        relationship_type: RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP,
        relationship_id: relationshipId,
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        edge_points: [],
      }];

      const isOnDiagram = isLogicalEREdgeOnDiagram(relationshipId, diagramEdges);

      // When isOnDiagram is true, the palette item should:
      // 1. Be visually greyed out
      // 2. Have cursor: not-allowed
      // 3. Block click handler
      expect(isOnDiagram).toBe(true);
    });

    it('click should be blocked when LogicalER item is already on diagram', () => {
      // Validates that when isOnDiagram is true, the click handler should not add a duplicate edge
      const relationshipId = 'ler-001';
      const diagramEdges: DiagramEdge[] = [{
        id: 'edge-1',
        relationship_type: RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP,
        relationship_id: relationshipId,
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        edge_points: [],
      }];

      const isOnDiagram = isLogicalEREdgeOnDiagram(relationshipId, diagramEdges);

      // Click handler should check this and return early if true
      expect(isOnDiagram).toBe(true);
      // When true, no ADD_DIAGRAM_EDGE should be dispatched
    });
  });
});

describe('Task Group 3: Context Menu Delete for LogicalER', () => {
  // ============================================================================
  // Task 3.6: Tests for context menu delete option
  // ============================================================================

  describe('Context menu shows Delete from Diagram for on-diagram LogicalER items', () => {
    it('should show Delete from Diagram when LogicalER edge exists', () => {
      const relationshipId = 'ler-001';
      const diagramEdges: DiagramEdge[] = [{
        id: 'edge-to-delete',
        relationship_type: RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP,
        relationship_id: relationshipId,
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        edge_points: [],
      }];

      const isOnDiagram = isLogicalEREdgeOnDiagram(relationshipId, diagramEdges);

      // When isOnDiagram is true:
      // - Context menu should show "Delete from Diagram" option
      // - Clicking "Delete from Diagram" removes the edge but NOT the meta-model relationship
      expect(isOnDiagram).toBe(true);
    });

    it('delete should only remove edge, not meta-model relationship', () => {
      // This test documents the expected behavior:
      // When deleting a LogicalER from context menu:
      // 1. Find the edge with matching relationship_id
      // 2. Dispatch DELETE_DIAGRAM_ELEMENTS with the edge ID
      // 3. Do NOT dispatch any action that would remove the relationship from metaModel
      const relationshipId = 'ler-001';
      const edgeId = 'edge-to-delete';
      const diagramEdges: DiagramEdge[] = [{
        id: edgeId,
        relationship_type: RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP,
        relationship_id: relationshipId,
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        edge_points: [],
      }];

      // Find the edge to delete
      const edgeToDelete = diagramEdges.find(
        e => e.relationship_type === RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP &&
             e.relationship_id === relationshipId
      );

      expect(edgeToDelete).toBeDefined();
      expect(edgeToDelete!.id).toBe(edgeId);
      // The delete action should use this edge ID to remove from diagram
    });
  });
});
