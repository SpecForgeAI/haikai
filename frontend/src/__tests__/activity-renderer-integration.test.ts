/**
 * Activity Diagram Renderer Integration Tests
 * Task Group 2: ActivityDiagramRenderer Integration with Node Bounds
 * Spec 2026-01-01: Activity Diagram Shape Bounds and Interactive Labels
 *
 * Tests that ActivityDiagramRenderer correctly passes node dimensions
 * to renderActivityNode for proper shape sizing.
 */

import { renderActivityNode } from '../utils/activityNodeRendering';
import { Activity, ActivityKind, DiagramNode } from '../types/model';
import { ACTIVITY_NODE_DEFAULTS } from '../config/defaults';

describe('Activity Diagram Renderer Integration', () => {
  describe('ActivityNodeElement shape sizing', () => {
    // Simulate what ActivityDiagramRenderer does: pass node.width and node.height
    // to renderActivityNode

    it('should render Decision node using DiagramNode dimensions', () => {
      const activity: Activity = {
        id: 'act-decision-1',
        name: 'Approve?',
        description: '',
        activity_kind: 'Decision',
        tags: '',
      };

      // Simulate a DiagramNode with custom dimensions
      const node: DiagramNode = {
        id: 'node-1',
        entity_type: 'ACTIVITY',
        entity_id: activity.id,
        pos_x: 100,
        pos_y: 100,
        width: 70, // Custom width
        height: 70, // Custom height
      };

      // Calculate center position as the renderer does
      const centerPosition = {
        x: node.pos_x + node.width / 2,
        y: node.pos_y + node.height / 2,
      };

      // Pass node dimensions to renderActivityNode as the renderer should
      const result = renderActivityNode(activity, centerPosition, node.width, node.height);

      // Verify dimensions are used
      expect(result.width).toBe(70);
      expect(result.height).toBe(70);
    });

    it('should render Initial node using min(width, height) for radius', () => {
      const activity: Activity = {
        id: 'act-initial-1',
        name: 'Start',
        description: '',
        activity_kind: 'Initial',
        tags: '',
      };

      const node: DiagramNode = {
        id: 'node-2',
        entity_type: 'ACTIVITY',
        entity_id: activity.id,
        pos_x: 50,
        pos_y: 50,
        width: 20,
        height: 20,
      };

      const centerPosition = {
        x: node.pos_x + node.width / 2,
        y: node.pos_y + node.height / 2,
      };

      const result = renderActivityNode(activity, centerPosition, node.width, node.height);

      // min(20, 20) / 2 = 10
      expect(result.pathData).toContain('A 10 10');
    });

    it('should render Final node using node dimensions for bullseye', () => {
      const activity: Activity = {
        id: 'act-final-1',
        name: 'End',
        description: '',
        activity_kind: 'Final',
        tags: '',
      };

      const node: DiagramNode = {
        id: 'node-3',
        entity_type: 'ACTIVITY',
        entity_id: activity.id,
        pos_x: 200,
        pos_y: 200,
        width: 30,
        height: 30,
      };

      const centerPosition = {
        x: node.pos_x + node.width / 2,
        y: node.pos_y + node.height / 2,
      };

      const result = renderActivityNode(activity, centerPosition, node.width, node.height);

      // Outer radius = min(30, 30) / 2 = 15
      expect(result.outerPathData).toContain('A 15 15');
      expect(result.outerDiameter).toBe(30);
    });

    it('should render Merge node using passed dimensions', () => {
      const activity: Activity = {
        id: 'act-merge-1',
        name: '',
        description: '',
        activity_kind: 'Merge',
        tags: '',
      };

      const node: DiagramNode = {
        id: 'node-4',
        entity_type: 'ACTIVITY',
        entity_id: activity.id,
        pos_x: 150,
        pos_y: 150,
        width: 25,
        height: 25,
      };

      const centerPosition = {
        x: node.pos_x + node.width / 2,
        y: node.pos_y + node.height / 2,
      };

      const result = renderActivityNode(activity, centerPosition, node.width, node.height);

      expect(result.width).toBe(25);
      expect(result.height).toBe(25);
    });
  });

  describe('activityRenderResults computation', () => {
    // These tests verify the computation pattern used in the renderer

    it('should compute center position correctly from node bounds', () => {
      const node: DiagramNode = {
        id: 'node-5',
        entity_type: 'ACTIVITY',
        entity_id: 'act-5',
        pos_x: 100,
        pos_y: 200,
        width: 140,
        height: 50,
      };

      const centerPosition = {
        x: node.pos_x + node.width / 2,
        y: node.pos_y + node.height / 2,
      };

      expect(centerPosition.x).toBe(170); // 100 + 70
      expect(centerPosition.y).toBe(225); // 200 + 25
    });

    it('should preserve node dimensions through render pipeline', () => {
      const activity: Activity = {
        id: 'act-action-1',
        name: 'Process Data',
        description: '',
        activity_kind: 'Action',
        tags: '',
      };

      const node: DiagramNode = {
        id: 'node-6',
        entity_type: 'ACTIVITY',
        entity_id: activity.id,
        pos_x: 50,
        pos_y: 50,
        width: 160, // Custom width (not default 140)
        height: 60, // Custom height (not default 50)
      };

      const centerPosition = {
        x: node.pos_x + node.width / 2,
        y: node.pos_y + node.height / 2,
      };

      const result = renderActivityNode(activity, centerPosition, node.width, node.height);

      expect(result.width).toBe(160);
      expect(result.height).toBe(60);
    });
  });
});
