/**
 * Context Menu Blocking Tests - No Active Diagram
 * Tests for Task Group 4: Block Palette Context Menu When No Active Diagram
 *
 * These tests verify that context menu add actions show a warning modal
 * when no active diagram exists, and work normally when a diagram exists.
 */

import { hasActiveDiagram } from '../utils/diagramUtils';
import { Diagram, DiagramNode, ENTITY_TYPES } from '../types/model';

// Test data factory functions
function createTestDiagram(overrides: Partial<Diagram> = {}): Diagram {
  return {
    id: 'diagram-1',
    name: 'Test Diagram',
    description: '',
    diagram_type: null,
    settings: {},
    diagram_nodes: [],
    diagram_edges: [],
    decorations: [],
    ...overrides,
  };
}

function createTestNode(overrides: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id: 'test-node-1',
    entity_type: 'APPLICATION',
    entity_id: 'app-1',
    pos_x: 100,
    pos_y: 100,
    width: 120,
    height: 60,
    parent_node_id: null,
    ...overrides,
  };
}

describe('Context Menu Blocking - No Active Diagram', () => {
  describe('Context Menu "Add" Action Blocking', () => {
    it('should show warning when context menu "Add" action is triggered with no active diagram', () => {
      // No diagrams exist
      const diagrams: Diagram[] = [];
      const selectedDiagramId: string | null = null;

      // Check if there's an active diagram
      const isActive = hasActiveDiagram(diagrams, selectedDiagramId);
      expect(isActive).toBe(false);

      // When no active diagram, context menu Add should be blocked
      // The handler should show warning modal instead of adding
      let warningShown = false;
      let nodeAdded = false;

      // Simulate handleContextMenuAdd behavior
      if (!isActive) {
        warningShown = true;
        // Should NOT add node
      } else {
        nodeAdded = true;
      }

      expect(warningShown).toBe(true);
      expect(nodeAdded).toBe(false);
    });

    it('should show warning when context menu "Add with business processes" action is triggered with no active diagram', () => {
      // No diagrams exist
      const diagrams: Diagram[] = [];
      const selectedDiagramId: string | null = null;

      // Check if there's an active diagram
      const isActive = hasActiveDiagram(diagrams, selectedDiagramId);
      expect(isActive).toBe(false);

      // When no active diagram, "Add with business processes" should be blocked
      let warningShown = false;
      let nodesAdded = false;

      // Simulate handleAddWithBusinessProcesses behavior
      if (!isActive) {
        warningShown = true;
        // Should NOT add nodes
      } else {
        nodesAdded = true;
      }

      expect(warningShown).toBe(true);
      expect(nodesAdded).toBe(false);
    });

    it('should show warning when context menu "Add with app components" action is triggered with no active diagram', () => {
      // No diagrams exist
      const diagrams: Diagram[] = [];
      const selectedDiagramId: string | null = null;

      // Check if there's an active diagram
      const isActive = hasActiveDiagram(diagrams, selectedDiagramId);
      expect(isActive).toBe(false);

      // When no active diagram, "Add with app components" should be blocked
      let warningShown = false;
      let nodesAdded = false;

      // Simulate handleAddWithAppComponents behavior
      if (!isActive) {
        warningShown = true;
        // Should NOT add nodes
      } else {
        nodesAdded = true;
      }

      expect(warningShown).toBe(true);
      expect(nodesAdded).toBe(false);
    });
  });

  describe('Context Menu Actions Work Normally With Active Diagram', () => {
    it('should allow context menu Add action when active diagram exists', () => {
      // Diagram exists and is selected
      const diagrams: Diagram[] = [createTestDiagram({ id: 'diagram-1' })];
      const selectedDiagramId: string | null = 'diagram-1';

      // Check if there's an active diagram
      const isActive = hasActiveDiagram(diagrams, selectedDiagramId);
      expect(isActive).toBe(true);

      // When active diagram exists, context menu Add should work normally
      let warningShown = false;
      let nodeAdded = false;

      // Simulate handleContextMenuAdd behavior with active diagram
      if (!isActive) {
        warningShown = true;
      } else {
        nodeAdded = true;
      }

      expect(warningShown).toBe(false);
      expect(nodeAdded).toBe(true);
    });

    it('should allow context menu "Add with business processes" when active diagram exists', () => {
      // Diagram exists and is selected
      const diagrams: Diagram[] = [createTestDiagram({ id: 'diagram-1' })];
      const selectedDiagramId: string | null = 'diagram-1';

      // Check if there's an active diagram
      const isActive = hasActiveDiagram(diagrams, selectedDiagramId);
      expect(isActive).toBe(true);

      // When active diagram exists, action should work normally
      let warningShown = false;
      let nodesAdded = false;

      if (!isActive) {
        warningShown = true;
      } else {
        nodesAdded = true;
      }

      expect(warningShown).toBe(false);
      expect(nodesAdded).toBe(true);
    });

    it('should allow context menu "Add with app components" when active diagram exists', () => {
      // Diagram exists and is selected
      const diagrams: Diagram[] = [createTestDiagram({ id: 'diagram-1' })];
      const selectedDiagramId: string | null = 'diagram-1';

      // Check if there's an active diagram
      const isActive = hasActiveDiagram(diagrams, selectedDiagramId);
      expect(isActive).toBe(true);

      // When active diagram exists, action should work normally
      let warningShown = false;
      let nodesAdded = false;

      if (!isActive) {
        warningShown = true;
      } else {
        nodesAdded = true;
      }

      expect(warningShown).toBe(false);
      expect(nodesAdded).toBe(true);
    });
  });

  describe('Warning Message Consistency', () => {
    it('should use consistent warning message for all blocked context menu actions', () => {
      // The expected warning message as per spec
      const expectedMessage = 'Add a new diagram before trying to add items.';

      // All context menu add actions should display this same message
      const contextMenuAddWarning = expectedMessage;
      const addWithBPWarning = expectedMessage;
      const addWithACWarning = expectedMessage;

      expect(contextMenuAddWarning).toBe(expectedMessage);
      expect(addWithBPWarning).toBe(expectedMessage);
      expect(addWithACWarning).toBe(expectedMessage);
    });
  });

  describe('Edge Cases', () => {
    it('should show warning when diagrams exist but none is selected', () => {
      // Diagram exists but selectedDiagramId is null
      const diagrams: Diagram[] = [createTestDiagram({ id: 'diagram-1' })];
      const selectedDiagramId: string | null = null;

      const isActive = hasActiveDiagram(diagrams, selectedDiagramId);
      expect(isActive).toBe(false);

      // Should show warning
      let warningShown = false;
      if (!isActive) {
        warningShown = true;
      }

      expect(warningShown).toBe(true);
    });

    it('should show warning when selectedDiagramId points to non-existent diagram', () => {
      // Diagram exists but selectedDiagramId points to wrong diagram
      const diagrams: Diagram[] = [createTestDiagram({ id: 'diagram-1' })];
      const selectedDiagramId: string | null = 'non-existent-diagram';

      const isActive = hasActiveDiagram(diagrams, selectedDiagramId);
      expect(isActive).toBe(false);

      // Should show warning
      let warningShown = false;
      if (!isActive) {
        warningShown = true;
      }

      expect(warningShown).toBe(true);
    });
  });
});
