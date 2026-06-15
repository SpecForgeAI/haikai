/**
 * StateTransition 2-Click Creation Mode Tests
 * Task Group 4: State Diagram UX Fixes
 *
 * Tests for:
 * - Transition creation mode state management
 * - Source state selection on first click
 * - Transition creation on second click
 * - Non-STATE nodes are ignored
 * - Escape cancels mode
 */

import {
  TransitionCreationMode,
  initialTransitionCreationMode,
  enterTransitionCreationMode,
  exitTransitionCreationMode,
  setTransitionSourceState,
  isReadyForTargetState,
  getTransitionModeHintText,
  createStateTransitionEntity,
  createTransitionDiagramEdge,
} from '../utils/stateTransitionCreation';
import { DiagramNode, StateTransition, DiagramEdge } from '../types/model';

describe('StateTransition 2-Click Creation Mode', () => {
  describe('Mode State Management', () => {
    it('initialTransitionCreationMode has correct default values', () => {
      expect(initialTransitionCreationMode.active).toBe(false);
      expect(initialTransitionCreationMode.sourceStateNodeId).toBeNull();
    });

    it('enterTransitionCreationMode sets active=true and clears source', () => {
      const mode = enterTransitionCreationMode();

      expect(mode.active).toBe(true);
      expect(mode.sourceStateNodeId).toBeNull();
    });

    it('exitTransitionCreationMode resets to initial state', () => {
      const mode = exitTransitionCreationMode();

      expect(mode.active).toBe(false);
      expect(mode.sourceStateNodeId).toBeNull();
    });
  });

  describe('Source State Selection', () => {
    it('setTransitionSourceState sets sourceStateNodeId when in active mode', () => {
      const currentMode = enterTransitionCreationMode();

      const newMode = setTransitionSourceState(currentMode, 'node-state-1');

      expect(newMode.active).toBe(true);
      expect(newMode.sourceStateNodeId).toBe('node-state-1');
    });

    it('setTransitionSourceState returns unchanged if not active', () => {
      const currentMode = initialTransitionCreationMode;

      const newMode = setTransitionSourceState(currentMode, 'node-state-1');

      expect(newMode).toEqual(currentMode);
      expect(newMode.sourceStateNodeId).toBeNull();
    });

    it('setTransitionSourceState returns unchanged if source already set', () => {
      const currentMode: TransitionCreationMode = {
        active: true,
        sourceStateNodeId: 'existing-source',
      };

      const newMode = setTransitionSourceState(currentMode, 'new-source');

      expect(newMode.sourceStateNodeId).toBe('existing-source');
    });
  });

  describe('Target State Readiness', () => {
    it('isReadyForTargetState returns true when active with source set', () => {
      const mode: TransitionCreationMode = {
        active: true,
        sourceStateNodeId: 'node-state-1',
      };

      expect(isReadyForTargetState(mode)).toBe(true);
    });

    it('isReadyForTargetState returns false when not active', () => {
      const mode: TransitionCreationMode = {
        active: false,
        sourceStateNodeId: 'node-state-1',
      };

      expect(isReadyForTargetState(mode)).toBe(false);
    });

    it('isReadyForTargetState returns false when source not set', () => {
      const mode: TransitionCreationMode = {
        active: true,
        sourceStateNodeId: null,
      };

      expect(isReadyForTargetState(mode)).toBe(false);
    });
  });

  describe('Hint Text', () => {
    it('returns empty string when not active', () => {
      expect(getTransitionModeHintText(initialTransitionCreationMode)).toBe('');
    });

    it('returns source selection hint when active without source', () => {
      const mode = enterTransitionCreationMode();
      const hint = getTransitionModeHintText(mode);

      expect(hint).toContain('source');
      expect(hint).toContain('Escape');
    });

    it('returns target selection hint when source is set', () => {
      const mode: TransitionCreationMode = {
        active: true,
        sourceStateNodeId: 'node-state-1',
      };
      const hint = getTransitionModeHintText(mode);

      expect(hint).toContain('another state');
      expect(hint).toContain('Escape');
    });
  });

  describe('Entity and Edge Creation', () => {
    it('createStateTransitionEntity creates valid transition', () => {
      const transition = createStateTransitionEntity('from-state-id', 'to-state-id');

      expect(transition.id).toBeDefined();
      expect(transition.id.startsWith('transition')).toBe(true);
      expect(transition.from_state_id).toBe('from-state-id');
      expect(transition.to_state_id).toBe('to-state-id');
    });

    it('createTransitionDiagramEdge creates valid edge', () => {
      const sourceNode: DiagramNode = {
        id: 'node-1',
        entity_type: 'STATE',
        entity_id: 'state-1',
        pos_x: 100,
        pos_y: 100,
        width: 50,
        height: 50,
        auto_size: false,
        z_index: 1,
        parent_node_id: null,
        style_override: {},
      };
      const targetNode: DiagramNode = {
        id: 'node-2',
        entity_type: 'STATE',
        entity_id: 'state-2',
        pos_x: 300,
        pos_y: 200,
        width: 50,
        height: 50,
        auto_size: false,
        z_index: 1,
        parent_node_id: null,
        style_override: {},
      };

      const edge = createTransitionDiagramEdge(
        'transition-1',
        'node-1',
        'node-2',
        sourceNode,
        targetNode
      );

      expect(edge.id).toBeDefined();
      expect(edge.relationship_type).toBe('STATE_TRANSITION');
      expect(edge.relationship_id).toBe('transition-1');
      expect(edge.source_node_id).toBe('node-1');
      expect(edge.target_node_id).toBe('node-2');
      expect(edge.edge_points).toHaveLength(2);
    });
  });
});

describe('Canvas Click Integration (mock behavior)', () => {
  // These tests describe the expected behavior when integrated with Canvas
  // The actual implementation is in DiagramsView.tsx handleNodeSelect

  const mockNodes: DiagramNode[] = [
    {
      id: 'state-node-1',
      entity_type: 'STATE',
      entity_id: 'state-1',
      pos_x: 100,
      pos_y: 100,
      width: 50,
      height: 50,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    },
    {
      id: 'state-node-2',
      entity_type: 'STATE',
      entity_id: 'state-2',
      pos_x: 300,
      pos_y: 200,
      width: 50,
      height: 50,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    },
    {
      id: 'app-node-1',
      entity_type: 'APPLICATION',
      entity_id: 'app-1',
      pos_x: 500,
      pos_y: 300,
      width: 120,
      height: 60,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    },
  ];

  // Helper to simulate handleNodeSelect behavior
  function simulateNodeClick(
    mode: TransitionCreationMode,
    nodeId: string,
    nodes: DiagramNode[]
  ): { handled: boolean; newMode: TransitionCreationMode; transition?: StateTransition; edge?: DiagramEdge } {
    if (!mode.active) {
      return { handled: false, newMode: mode };
    }

    const clickedNode = nodes.find(n => n.id === nodeId);
    if (!clickedNode) {
      return { handled: false, newMode: mode };
    }

    // Only accept STATE nodes
    if (clickedNode.entity_type !== 'STATE') {
      return { handled: true, newMode: mode }; // Ignored, but handled (doesn't bubble)
    }

    // First click: set source
    if (mode.sourceStateNodeId === null) {
      return {
        handled: true,
        newMode: setTransitionSourceState(mode, nodeId),
      };
    }

    // Second click: create transition
    const sourceNodeId = mode.sourceStateNodeId;
    const targetNodeId = nodeId;

    // Prevent self-loops
    if (sourceNodeId === targetNodeId) {
      return { handled: true, newMode: mode };
    }

    const sourceNode = nodes.find(n => n.id === sourceNodeId)!;
    const targetNode = clickedNode;

    const transition = createStateTransitionEntity(
      sourceNode.entity_id,
      targetNode.entity_id
    );
    const edge = createTransitionDiagramEdge(
      transition.id,
      sourceNodeId,
      targetNodeId,
      sourceNode,
      targetNode
    );

    return {
      handled: true,
      newMode: exitTransitionCreationMode(),
      transition,
      edge,
    };
  }

  it('first STATE node click sets source', () => {
    const mode = enterTransitionCreationMode();
    const result = simulateNodeClick(mode, 'state-node-1', mockNodes);

    expect(result.handled).toBe(true);
    expect(result.newMode.active).toBe(true);
    expect(result.newMode.sourceStateNodeId).toBe('state-node-1');
    expect(result.transition).toBeUndefined();
  });

  it('second STATE node click creates transition and exits mode', () => {
    const modeWithSource: TransitionCreationMode = {
      active: true,
      sourceStateNodeId: 'state-node-1',
    };
    const result = simulateNodeClick(modeWithSource, 'state-node-2', mockNodes);

    expect(result.handled).toBe(true);
    expect(result.newMode.active).toBe(false);
    expect(result.transition).toBeDefined();
    expect(result.transition?.from_state_id).toBe('state-1');
    expect(result.transition?.to_state_id).toBe('state-2');
    expect(result.edge).toBeDefined();
  });

  it('clicking non-STATE node is ignored but handled', () => {
    const mode = enterTransitionCreationMode();
    const result = simulateNodeClick(mode, 'app-node-1', mockNodes);

    expect(result.handled).toBe(true);
    expect(result.newMode.sourceStateNodeId).toBeNull(); // Not changed
    expect(result.transition).toBeUndefined();
  });

  it('clicking same node twice does not create self-loop', () => {
    const modeWithSource: TransitionCreationMode = {
      active: true,
      sourceStateNodeId: 'state-node-1',
    };
    const result = simulateNodeClick(modeWithSource, 'state-node-1', mockNodes);

    expect(result.handled).toBe(true);
    expect(result.newMode.active).toBe(true); // Still active
    expect(result.newMode.sourceStateNodeId).toBe('state-node-1');
    expect(result.transition).toBeUndefined();
  });

  it('does not handle clicks when mode is not active', () => {
    const mode = initialTransitionCreationMode;
    const result = simulateNodeClick(mode, 'state-node-1', mockNodes);

    expect(result.handled).toBe(false);
    expect(result.newMode).toEqual(mode);
  });
});
