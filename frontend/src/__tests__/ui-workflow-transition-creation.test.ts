/**
 * UI Workflow Transition Creation Tests
 *
 * Task Group 10: Integration tests for UIWorkflowTransition creation flow.
 * Tests the 2-click source/target selection flow for creating transitions.
 */

import {
  createInitialWorkflowTransitionMode,
  advanceToTargetSelection,
  isValidUIScreenNode,
  getWorkflowTransitionCursor,
  getWorkflowTransitionStatusMessage,
  createUIWorkflowTransition,
  createUIWorkflowTransitionEdge,
  completeWorkflowTransitionCreation,
  getTransitionsReferencingScreen,
  getEdgesForScreenTransitions,
  WorkflowTransitionCreationMode,
} from '../utils/uiWorkflowTransitionCreation';
import { DiagramNode, UIWorkflowTransition, DiagramEdge, ENTITY_TYPES, RELATIONSHIP_EDGE_TYPES } from '../types/model';

describe('UI Workflow Transition Creation', () => {
  // ============================================================================
  // Creation Mode State Tests
  // ============================================================================

  describe('Creation Mode State', () => {
    it('creates initial mode in selecting-source step', () => {
      const mode = createInitialWorkflowTransitionMode();
      expect(mode.step).toBe('selecting-source');
      expect(mode.sourceNodeId).toBeUndefined();
      expect(mode.sourceScreenId).toBeUndefined();
    });

    it('advances to target selection with source node info', () => {
      const initialMode = createInitialWorkflowTransitionMode();
      const advancedMode = advanceToTargetSelection(initialMode, 'node-1', 'screen-1');

      expect(advancedMode.step).toBe('selecting-target');
      expect(advancedMode.sourceNodeId).toBe('node-1');
      expect(advancedMode.sourceScreenId).toBe('screen-1');
    });
  });

  // ============================================================================
  // Node Validation Tests
  // ============================================================================

  describe('Node Validation', () => {
    it('returns true for UI_SCREEN entity type nodes', () => {
      const uiScreenNode: DiagramNode = {
        id: 'node-1',
        entity_type: ENTITY_TYPES.UI_SCREEN,
        entity_id: 'screen-1',
        pos_x: 100,
        pos_y: 100,
        width: 120,
        height: 60,
        parent_node_id: null,
      };

      expect(isValidUIScreenNode(uiScreenNode)).toBe(true);
    });

    it('returns false for non-UI_SCREEN entity type nodes', () => {
      const applicationNode: DiagramNode = {
        id: 'node-1',
        entity_type: ENTITY_TYPES.APPLICATION,
        entity_id: 'app-1',
        pos_x: 100,
        pos_y: 100,
        width: 120,
        height: 60,
        parent_node_id: null,
      };

      expect(isValidUIScreenNode(applicationNode)).toBe(false);
    });

    it('returns false for STATE entity type nodes', () => {
      const stateNode: DiagramNode = {
        id: 'node-1',
        entity_type: ENTITY_TYPES.STATE,
        entity_id: 'state-1',
        pos_x: 100,
        pos_y: 100,
        width: 120,
        height: 60,
        parent_node_id: null,
      };

      expect(isValidUIScreenNode(stateNode)).toBe(false);
    });
  });

  // ============================================================================
  // Cursor and Status Message Tests
  // ============================================================================

  describe('Cursor and Status Messages', () => {
    it('returns crosshair cursor for selecting-source step', () => {
      expect(getWorkflowTransitionCursor('selecting-source')).toBe('crosshair');
    });

    it('returns crosshair cursor for selecting-target step', () => {
      expect(getWorkflowTransitionCursor('selecting-target')).toBe('crosshair');
    });

    it('returns source selection message for selecting-source step', () => {
      const message = getWorkflowTransitionStatusMessage('selecting-source');
      expect(message).toContain('source');
    });

    it('returns target selection message for selecting-target step', () => {
      const message = getWorkflowTransitionStatusMessage('selecting-target');
      expect(message).toContain('target');
    });
  });

  // ============================================================================
  // Entity Creation Tests
  // ============================================================================

  describe('UIWorkflowTransition Entity Creation', () => {
    it('creates transition with required fields', () => {
      const transition = createUIWorkflowTransition('screen-1', 'screen-2');

      expect(transition.id).toBeDefined();
      expect(transition.id).toContain('transition-');
      expect(transition.source_screen_id).toBe('screen-1');
      expect(transition.target_screen_id).toBe('screen-2');
      expect(transition.name).toBeDefined();
    });

    it('creates transition with optional fields', () => {
      const transition = createUIWorkflowTransition(
        'screen-1',
        'screen-2',
        'Login Flow',
        'Submit Login',
        'isValid'
      );

      expect(transition.name).toBe('Login Flow');
      expect(transition.trigger).toBe('Submit Login');
      expect(transition.guard).toBe('isValid');
    });
  });

  // ============================================================================
  // Edge Creation Tests
  // ============================================================================

  describe('DiagramEdge Creation', () => {
    const sourceNode: DiagramNode = {
      id: 'node-1',
      entity_type: ENTITY_TYPES.UI_SCREEN,
      entity_id: 'screen-1',
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      parent_node_id: null,
    };

    const targetNode: DiagramNode = {
      id: 'node-2',
      entity_type: ENTITY_TYPES.UI_SCREEN,
      entity_id: 'screen-2',
      pos_x: 400,
      pos_y: 100,
      width: 120,
      height: 60,
      parent_node_id: null,
    };

    it('creates edge with correct relationship type', () => {
      const transition = createUIWorkflowTransition('screen-1', 'screen-2');
      const edge = createUIWorkflowTransitionEdge(
        transition,
        'node-1',
        'node-2',
        sourceNode,
        targetNode
      );

      expect(edge.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.UI_WORKFLOW_TRANSITION);
      expect(edge.relationship_id).toBe(transition.id);
    });

    it('creates edge with source and target node IDs', () => {
      const transition = createUIWorkflowTransition('screen-1', 'screen-2');
      const edge = createUIWorkflowTransitionEdge(
        transition,
        'node-1',
        'node-2',
        sourceNode,
        targetNode
      );

      expect(edge.source_node_id).toBe('node-1');
      expect(edge.target_node_id).toBe('node-2');
    });

    it('creates edge with edge points for border-to-border anchoring', () => {
      const transition = createUIWorkflowTransition('screen-1', 'screen-2');
      const edge = createUIWorkflowTransitionEdge(
        transition,
        'node-1',
        'node-2',
        sourceNode,
        targetNode
      );

      expect(edge.edge_points).toBeDefined();
      expect(edge.edge_points.length).toBeGreaterThanOrEqual(2);

      // Verify edge points are at node boundaries (not centers)
      const firstPoint = edge.edge_points[0];
      const lastPoint = edge.edge_points[edge.edge_points.length - 1];

      // First point should be at source node border (right side since target is to the right)
      expect(firstPoint.pos_x).toBe(sourceNode.pos_x + sourceNode.width); // Right border
      expect(firstPoint.pos_y).toBe(sourceNode.pos_y + sourceNode.height / 2); // Center Y

      // Last point should be at target node border (left side since source is to the left)
      expect(lastPoint.pos_x).toBe(targetNode.pos_x); // Left border
      expect(lastPoint.pos_y).toBe(targetNode.pos_y + targetNode.height / 2); // Center Y
    });

    it('creates edge with trigger as label text', () => {
      const transition = createUIWorkflowTransition(
        'screen-1',
        'screen-2',
        'My Transition',
        'Click Button'
      );
      const edge = createUIWorkflowTransitionEdge(
        transition,
        'node-1',
        'node-2',
        sourceNode,
        targetNode
      );

      expect(edge.label_text).toBe('Click Button');
    });

    it('creates edge with arrow at end', () => {
      const transition = createUIWorkflowTransition('screen-1', 'screen-2');
      const edge = createUIWorkflowTransitionEdge(
        transition,
        'node-1',
        'node-2',
        sourceNode,
        targetNode
      );

      expect(edge.arrow_end).toBe('ARROW');
    });
  });

  // ============================================================================
  // Complete Creation Flow Tests
  // ============================================================================

  describe('Complete Creation Flow', () => {
    const sourceNode: DiagramNode = {
      id: 'node-1',
      entity_type: ENTITY_TYPES.UI_SCREEN,
      entity_id: 'screen-1',
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      parent_node_id: null,
    };

    const targetNode: DiagramNode = {
      id: 'node-2',
      entity_type: ENTITY_TYPES.UI_SCREEN,
      entity_id: 'screen-2',
      pos_x: 400,
      pos_y: 100,
      width: 120,
      height: 60,
      parent_node_id: null,
    };

    it('completes creation flow and returns transition and edge', () => {
      const mode: WorkflowTransitionCreationMode = {
        step: 'selecting-target',
        sourceNodeId: 'node-1',
        sourceScreenId: 'screen-1',
      };

      const result = completeWorkflowTransitionCreation(
        mode,
        'node-2',
        'screen-2',
        sourceNode,
        targetNode
      );

      expect(result.transition).toBeDefined();
      expect(result.transition.source_screen_id).toBe('screen-1');
      expect(result.transition.target_screen_id).toBe('screen-2');

      expect(result.edge).toBeDefined();
      expect(result.edge.source_node_id).toBe('node-1');
      expect(result.edge.target_node_id).toBe('node-2');
      expect(result.edge.relationship_id).toBe(result.transition.id);
    });

    it('throws error if mode is in selecting-source step', () => {
      const mode: WorkflowTransitionCreationMode = {
        step: 'selecting-source',
      };

      expect(() => {
        completeWorkflowTransitionCreation(
          mode,
          'node-2',
          'screen-2',
          sourceNode,
          targetNode
        );
      }).toThrow();
    });

    it('throws error if source node ID is missing', () => {
      const mode: WorkflowTransitionCreationMode = {
        step: 'selecting-target',
        sourceScreenId: 'screen-1',
        // sourceNodeId is missing
      };

      expect(() => {
        completeWorkflowTransitionCreation(
          mode,
          'node-2',
          'screen-2',
          sourceNode,
          targetNode
        );
      }).toThrow();
    });
  });

  // ============================================================================
  // Cascading Delete Tests
  // ============================================================================

  describe('Cascading Delete Helpers', () => {
    const transitions: UIWorkflowTransition[] = [
      {
        id: 'transition-1',
        name: 'Login to Dashboard',
        source_screen_id: 'screen-1',
        target_screen_id: 'screen-2',
      },
      {
        id: 'transition-2',
        name: 'Dashboard to Profile',
        source_screen_id: 'screen-2',
        target_screen_id: 'screen-3',
      },
      {
        id: 'transition-3',
        name: 'Profile to Settings',
        source_screen_id: 'screen-3',
        target_screen_id: 'screen-4',
      },
    ];

    it('finds transitions referencing screen as source', () => {
      const referencingIds = getTransitionsReferencingScreen('screen-1', transitions);
      expect(referencingIds).toContain('transition-1');
      expect(referencingIds).not.toContain('transition-2');
      expect(referencingIds).not.toContain('transition-3');
    });

    it('finds transitions referencing screen as target', () => {
      const referencingIds = getTransitionsReferencingScreen('screen-2', transitions);
      expect(referencingIds).toContain('transition-1'); // screen-2 is target
      expect(referencingIds).toContain('transition-2'); // screen-2 is source
    });

    it('finds all transitions referencing screen in either direction', () => {
      const referencingIds = getTransitionsReferencingScreen('screen-3', transitions);
      expect(referencingIds).toContain('transition-2'); // screen-3 is target
      expect(referencingIds).toContain('transition-3'); // screen-3 is source
    });

    it('returns empty array for unreferenced screen', () => {
      const referencingIds = getTransitionsReferencingScreen('screen-99', transitions);
      expect(referencingIds).toEqual([]);
    });

    it('finds edges for transitions referencing screen', () => {
      const edges: DiagramEdge[] = [
        {
          id: 'edge-1',
          relationship_type: RELATIONSHIP_EDGE_TYPES.UI_WORKFLOW_TRANSITION,
          relationship_id: 'transition-1',
          source_node_id: 'node-1',
          target_node_id: 'node-2',
          edge_points: [],
        },
        {
          id: 'edge-2',
          relationship_type: RELATIONSHIP_EDGE_TYPES.UI_WORKFLOW_TRANSITION,
          relationship_id: 'transition-2',
          source_node_id: 'node-2',
          target_node_id: 'node-3',
          edge_points: [],
        },
        {
          id: 'edge-3',
          relationship_type: 'OTHER_TYPE',
          relationship_id: 'other-1',
          source_node_id: 'node-1',
          target_node_id: 'node-2',
          edge_points: [],
        },
      ];

      const edgeIds = getEdgesForScreenTransitions('screen-2', transitions, edges);
      expect(edgeIds).toContain('edge-1'); // transition-1 references screen-2
      expect(edgeIds).toContain('edge-2'); // transition-2 references screen-2
      expect(edgeIds).not.toContain('edge-3'); // Not a UI_WORKFLOW_TRANSITION
    });
  });
});
