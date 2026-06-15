/**
 * Tests for User Interaction Edge Type Definitions
 *
 * Task Group 1: Type Definitions and DiagramEdge Updates
 * Tests for the User Interaction Visualisation feature type definitions.
 *
 * These tests verify:
 * - DiagramEdge accepts subType field with 'MAIN' | 'USER_LINK' values
 * - USER_INTERACTION edges have correct relationship_type
 * - Edge with dotted line_style is correctly typed
 * - UserInteractionEdgeSubType type is properly defined
 * - LINE_DASHES_DOTTED constant is available for dotted styling
 */

import {
  DiagramEdge,
  RELATIONSHIP_EDGE_TYPES,
  UserInteractionEdgeSubType,
  LINE_DASHES_DOTTED,
} from '../types/model';

describe('User Interaction Edge Type Definitions', () => {
  // Test 1: DiagramEdge accepts subType field with 'MAIN' | 'USER_LINK' values
  describe('DiagramEdge subType field', () => {
    it('should accept subType field with MAIN value', () => {
      const edge: DiagramEdge = {
        id: 'edge-1',
        relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
        relationship_id: 'interaction-1',
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        edge_points: [],
        subType: 'MAIN',
      };

      expect(edge.subType).toBe('MAIN');
      expect(edge.relationship_type).toBe('USER_INTERACTION');
    });

    it('should accept subType field with USER_LINK value', () => {
      const edge: DiagramEdge = {
        id: 'edge-2',
        relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
        relationship_id: 'interaction-1',
        source_node_id: 'node-user',
        target_node_id: 'node-midpoint',
        edge_points: [],
        subType: 'USER_LINK',
      };

      expect(edge.subType).toBe('USER_LINK');
      expect(edge.relationship_type).toBe('USER_INTERACTION');
    });

    it('should allow subType to be undefined for non-USER_INTERACTION edges', () => {
      const edge: DiagramEdge = {
        id: 'edge-3',
        relationship_type: RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT,
        relationship_id: 'dm-1',
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        edge_points: [],
        // subType is intentionally not set
      };

      expect(edge.subType).toBeUndefined();
    });
  });

  // Test 2: USER_INTERACTION edges have correct relationship_type
  describe('USER_INTERACTION relationship_type', () => {
    it('should have USER_INTERACTION in RELATIONSHIP_EDGE_TYPES', () => {
      expect(RELATIONSHIP_EDGE_TYPES.USER_INTERACTION).toBe('USER_INTERACTION');
    });

    it('should create valid USER_INTERACTION edge with proper relationship_type', () => {
      const edge: DiagramEdge = {
        id: 'ui-edge-1',
        relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
        relationship_id: 'interaction-abc',
        source_node_id: 'primary-abp-node',
        target_node_id: 'secondary-abp-node',
        edge_points: [],
        subType: 'MAIN',
        label_text: 'User login flow',
      };

      expect(edge.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.USER_INTERACTION);
      expect(edge.label_text).toBe('User login flow');
    });
  });

  // Test 3: Edge with dotted line styling is correctly typed
  describe('Dotted line styling for USER_INTERACTION edges', () => {
    it('should correctly type edge with dotted line_dashes styling', () => {
      const edge: DiagramEdge = {
        id: 'dotted-edge-1',
        relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
        relationship_id: 'interaction-1',
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        edge_points: [],
        subType: 'MAIN',
        line_dashes: LINE_DASHES_DOTTED,
      };

      expect(edge.line_dashes).toBe(LINE_DASHES_DOTTED);
      expect(edge.line_dashes).toBe('4,4');
    });

    it('should use LINE_DASHES_DOTTED constant for consistent dotted styling', () => {
      // Verify the constant value is correct
      expect(LINE_DASHES_DOTTED).toBe('4,4');

      // Verify it can be used in edge definition
      const mainEdge: DiagramEdge = {
        id: 'main-edge',
        relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
        relationship_id: 'int-1',
        source_node_id: 'abp-1',
        target_node_id: 'abp-2',
        edge_points: [],
        subType: 'MAIN',
        line_dashes: LINE_DASHES_DOTTED,
      };

      const userLinkEdge: DiagramEdge = {
        id: 'user-link-edge',
        relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
        relationship_id: 'int-1',
        source_node_id: 'user-node',
        target_node_id: 'midpoint-virtual',
        edge_points: [],
        subType: 'USER_LINK',
        line_dashes: LINE_DASHES_DOTTED,
      };

      expect(mainEdge.line_dashes).toBe(userLinkEdge.line_dashes);
    });
  });

  // Test 4: UserInteractionEdgeSubType type validation
  describe('UserInteractionEdgeSubType type', () => {
    it('should allow assignment of MAIN value', () => {
      const subType: UserInteractionEdgeSubType = 'MAIN';
      expect(subType).toBe('MAIN');
    });

    it('should allow assignment of USER_LINK value', () => {
      const subType: UserInteractionEdgeSubType = 'USER_LINK';
      expect(subType).toBe('USER_LINK');
    });

    it('should work with DiagramEdge subType field', () => {
      const getSubType = (edge: DiagramEdge): UserInteractionEdgeSubType | undefined => {
        return edge.subType;
      };

      const edge: DiagramEdge = {
        id: 'test-edge',
        relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
        relationship_id: 'int-1',
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        edge_points: [],
        subType: 'MAIN',
      };

      const result = getSubType(edge);
      expect(result).toBe('MAIN');
    });
  });

  // Test 5: Complete USER_INTERACTION edge with all fields
  describe('Complete USER_INTERACTION edge structure', () => {
    it('should support all relevant fields for USER_INTERACTION MAIN edge', () => {
      const edge: DiagramEdge = {
        id: 'complete-main-edge',
        relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
        relationship_id: 'interaction-complete',
        source_node_id: 'primary-abp-node',
        target_node_id: 'secondary-abp-node',
        edge_points: [
          { id: 'ep-1', sequence_order: 0, pos_x: 100, pos_y: 100 },
          { id: 'ep-2', sequence_order: 1, pos_x: 300, pos_y: 100 },
        ],
        subType: 'MAIN',
        line_dashes: LINE_DASHES_DOTTED,
        label_text: 'Submit order',
        label_pos_x: 200,
        label_pos_y: 80,
      };

      expect(edge.subType).toBe('MAIN');
      expect(edge.relationship_type).toBe('USER_INTERACTION');
      expect(edge.line_dashes).toBe('4,4');
      expect(edge.label_text).toBe('Submit order');
      expect(edge.label_pos_x).toBe(200);
      expect(edge.label_pos_y).toBe(80);
      expect(edge.edge_points).toHaveLength(2);
    });

    it('should support all relevant fields for USER_INTERACTION USER_LINK edge', () => {
      const edge: DiagramEdge = {
        id: 'complete-user-link-edge',
        relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
        relationship_id: 'interaction-complete',
        source_node_id: 'user-node',
        target_node_id: 'midpoint-target',
        edge_points: [
          { id: 'ep-ul-1', sequence_order: 0, pos_x: 50, pos_y: 200 },
          { id: 'ep-ul-2', sequence_order: 1, pos_x: 200, pos_y: 100 },
        ],
        subType: 'USER_LINK',
        line_dashes: LINE_DASHES_DOTTED,
        // USER_LINK edges typically don't have labels
      };

      expect(edge.subType).toBe('USER_LINK');
      expect(edge.relationship_type).toBe('USER_INTERACTION');
      expect(edge.line_dashes).toBe('4,4');
      expect(edge.label_text).toBeUndefined();
    });
  });
});
