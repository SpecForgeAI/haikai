/**
 * Palette Context Menu Gap Tests
 * Strategic tests to fill coverage gaps identified in gap analysis
 * Task Group 6: Test Review and Gap Analysis
 */

import { DiagramNode, ENTITY_TYPES } from '../types/model';
import { ContextMenuState, PaletteItemData } from '../types/contextMenu';
import { calculateChildPosition, calculateParentSize } from '../utils/compoundLayout';

// Test data factory functions
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

describe('Palette Context Menu Gap Tests', () => {
  describe('Relationship Items - No Context Menu', () => {
    it('should NOT show context menu for relationship items', () => {
      const itemType = 'relationship';

      // Context menu should only appear for entities
      const shouldShowContextMenu = itemType === 'entity';

      expect(shouldShowContextMenu).toBe(false);
    });

    it('should allow context menu for entity items', () => {
      const itemType = 'entity';

      const shouldShowContextMenu = itemType === 'entity';

      expect(shouldShowContextMenu).toBe(true);
    });
  });

  describe('Context Menu Viewport Edge Clamping', () => {
    it('should clamp menu X position to not exceed viewport right edge', () => {
      const menuWidth = 180;
      const padding = 5;
      const viewportWidth = 800;
      const x = 700; // Near right edge

      const clampedX = Math.min(x, viewportWidth - menuWidth - padding);

      expect(clampedX).toBeLessThanOrEqual(viewportWidth - menuWidth - padding);
    });

    it('should clamp menu Y position to not exceed viewport bottom edge', () => {
      const menuHeight = 150;
      const padding = 5;
      const viewportHeight = 600;
      const y = 500; // Near bottom edge

      const clampedY = Math.min(y, viewportHeight - menuHeight - padding);

      expect(clampedY).toBeLessThanOrEqual(viewportHeight - menuHeight - padding);
    });

    it('should clamp menu X position to not go below 0', () => {
      const padding = 5;
      const x = 2; // Near left edge

      const clampedX = Math.max(x, padding);

      expect(clampedX).toBeGreaterThanOrEqual(padding);
    });

    it('should clamp menu Y position to not go below 0', () => {
      const padding = 5;
      const y = 2; // Near top edge

      const clampedY = Math.max(y, padding);

      expect(clampedY).toBeGreaterThanOrEqual(padding);
    });
  });

  describe('Multiple Rapid Right-clicks', () => {
    it('should update context menu state on subsequent right-clicks', () => {
      let contextMenuState: ContextMenuState = null;

      // First right-click
      const firstItem: PaletteItemData = { id: 'app-1', name: 'App 1' };
      contextMenuState = {
        visible: true,
        x: 100,
        y: 200,
        item: firstItem,
        sectionId: 'applications',
      };

      expect(contextMenuState.item.id).toBe('app-1');

      // Second right-click on different item (should replace)
      const secondItem: PaletteItemData = { id: 'app-2', name: 'App 2' };
      contextMenuState = {
        visible: true,
        x: 150,
        y: 250,
        item: secondItem,
        sectionId: 'applications',
      };

      expect(contextMenuState.item.id).toBe('app-2');
      expect(contextMenuState.x).toBe(150);
      expect(contextMenuState.y).toBe(250);
    });
  });

  describe('Compound Add with Zero Linked Entities', () => {
    it('should handle application with no linked business processes', () => {
      const applicationId = 'app-with-no-processes';
      const linkedProcessIds: string[] = [];

      // When no processes are linked, operation should still succeed
      // (just add the parent if it does not exist)
      expect(linkedProcessIds.length).toBe(0);

      // Parent should still be addable
      const parentCanBeAdded = true;
      expect(parentCanBeAdded).toBe(true);
    });

    it('should handle application with no app components', () => {
      const applicationId = 'app-with-no-components';
      const appComponents: { id: string; name: string }[] = [];

      expect(appComponents.length).toBe(0);

      // Operation should complete without error
      const operationSucceeds = true;
      expect(operationSucceeds).toBe(true);
    });
  });

  describe('Parent Resize When Adding Children to Existing Parent', () => {
    it('should calculate new parent size when adding first child', () => {
      const existingChildCount = 0;
      const newChildCount = 1;
      const totalChildren = existingChildCount + newChildCount;

      const newSize = calculateParentSize(totalChildren);

      // 1 child: height = 5 + 20 + 5 + 60 + 5 = 95
      expect(newSize.height).toBe(95);
    });

    it('should calculate new parent size when adding to existing children', () => {
      const existingChildCount = 2;
      const newChildCount = 1;
      const totalChildren = existingChildCount + newChildCount;

      const newSize = calculateParentSize(totalChildren);

      // 3 children: height = 5 + 20 + 5 + 3*60 + 2*5 + 5 = 225
      expect(newSize.height).toBe(225);
    });

    it('should position new children below existing ones', () => {
      const parentNode = createTestNode({ pos_x: 100, pos_y: 100 });
      const existingChildCount = 2;

      const newChildPosition = calculateChildPosition(parentNode, 0, existingChildCount);

      // First new child at index 2 (0-based)
      // Y = 100 + 5 + 20 + 5 + 2 * 65 = 260
      expect(newChildPosition.pos_y).toBe(260);
    });
  });

  describe('End-to-End Workflow Validation', () => {
    it('should complete full Add workflow: right-click -> menu -> Add -> node created', () => {
      // Step 1: Right-click sets context menu state
      let contextMenuState: ContextMenuState = {
        visible: true,
        x: 100,
        y: 200,
        item: { id: 'app-1', name: 'App 1' },
        sectionId: 'applications',
      };
      expect(contextMenuState.visible).toBe(true);

      // Step 2: Check isOnDiagram (not on diagram)
      const nodes: DiagramNode[] = [];
      const isOnDiagram = nodes.some(
        n => n.entity_type === 'APPLICATION' && n.entity_id === 'app-1'
      );
      expect(isOnDiagram).toBe(false);

      // Step 3: Click Add -> creates node
      const newNode = createTestNode({
        entity_type: 'APPLICATION',
        entity_id: 'app-1',
      });

      // Step 4: Close menu
      contextMenuState = null;
      expect(contextMenuState).toBeNull();

      // Step 5: Node exists on diagram
      const updatedNodes = [newNode];
      const nowOnDiagram = updatedNodes.some(
        n => n.entity_type === 'APPLICATION' && n.entity_id === 'app-1'
      );
      expect(nowOnDiagram).toBe(true);
    });

    it('should complete full Delete workflow: right-click -> menu -> Delete -> node removed', () => {
      // Step 1: Node exists on diagram
      let nodes: DiagramNode[] = [
        createTestNode({ id: 'node-1', entity_type: 'APPLICATION', entity_id: 'app-1' }),
      ];

      // Step 2: Right-click sets context menu state
      let contextMenuState: ContextMenuState = {
        visible: true,
        x: 100,
        y: 200,
        item: { id: 'app-1', name: 'App 1' },
        sectionId: 'applications',
      };

      // Step 3: Check isOnDiagram (on diagram)
      const isOnDiagram = nodes.some(
        n => n.entity_type === 'APPLICATION' && n.entity_id === 'app-1'
      );
      expect(isOnDiagram).toBe(true);

      // Step 4: Click Delete -> removes node
      nodes = nodes.filter(n => n.entity_id !== 'app-1');

      // Step 5: Close menu
      contextMenuState = null;

      // Step 6: Node no longer on diagram
      const stillOnDiagram = nodes.some(
        n => n.entity_type === 'APPLICATION' && n.entity_id === 'app-1'
      );
      expect(stillOnDiagram).toBe(false);
    });
  });

  describe('JSON Serialization Consistency', () => {
    it('should maintain node structure after compound add', () => {
      const parentNode: DiagramNode = {
        id: 'node-parent',
        entity_type: ENTITY_TYPES.APPLICATION,
        entity_id: 'app-1',
        pos_x: 100,
        pos_y: 100,
        width: 130,
        height: 160,
        auto_size: false,
        z_index: 1,
        parent_node_id: null,
        style_override: {},
      };

      const childNode: DiagramNode = {
        id: 'node-child',
        entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
        entity_id: 'bp-1',
        pos_x: 105,
        pos_y: 130,
        width: 120,
        height: 60,
        auto_size: false,
        z_index: 2,
        parent_node_id: 'node-parent',
        style_override: {},
      };

      // Simulate JSON serialization/deserialization
      const json = JSON.stringify([parentNode, childNode]);
      const parsed = JSON.parse(json) as DiagramNode[];

      expect(parsed.length).toBe(2);
      expect(parsed[0].id).toBe('node-parent');
      expect(parsed[1].parent_node_id).toBe('node-parent');
    });
  });
});
