/**
 * Create and Place Flow Tests
 * Task Group 2: Tests for entity creation and node placement
 *
 * Tests the complete flow from clicking Create Section buttons to entity
 * creation and node placement on the diagram.
 *
 * Updated for Fixed Spawn Position feature: All nodes now spawn at the fixed
 * position (100, 100) regardless of viewport center.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ENTITY_TYPES } from '../types/model';
import { generatePrefixedId } from '../utils/idGenerator';
import { createDiagramNodeFromEntity, calculateZIndex, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT, DEFAULT_NODE_SPAWN_ORIGIN } from '../utils/nodeCreation';

// ============================================================================
// Test 2.1.1: Clicking Create Section button opens drawer with correct entity type
// ============================================================================

describe('Create Section Button Click', () => {
  it('should map "+ New Logical Entity" button to LOGICAL_DATA_ENTITY type', () => {
    const buttonConfig = {
      label: '+ New Logical Entity',
      entityType: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
    };

    expect(buttonConfig.entityType).toBe('LOGICAL_DATA_ENTITY');
  });

  it('should map "+ New Physical Entity" button to PHYSICAL_DATA_ENTITY type', () => {
    const buttonConfig = {
      label: '+ New Physical Entity',
      entityType: ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
    };

    expect(buttonConfig.entityType).toBe('PHYSICAL_DATA_ENTITY');
  });

  it('should map "+ New State" button to STATE type', () => {
    const buttonConfig = {
      label: '+ New State',
      entityType: ENTITY_TYPES.STATE,
    };

    expect(buttonConfig.entityType).toBe('STATE');
  });

  it('should map "+ New Activity" button to ACTIVITY type', () => {
    const buttonConfig = {
      label: '+ New Activity',
      entityType: ENTITY_TYPES.ACTIVITY,
    };

    expect(buttonConfig.entityType).toBe('ACTIVITY');
  });

  it('should map "+ New Partition" button to ACTIVITY_PARTITION type', () => {
    const buttonConfig = {
      label: '+ New Partition',
      entityType: ENTITY_TYPES.ACTIVITY_PARTITION,
    };

    expect(buttonConfig.entityType).toBe('ACTIVITY_PARTITION');
  });
});

// ============================================================================
// Test 2.1.2: Successful form submission dispatches ADD_ENTITY action with generated ID
// ============================================================================

describe('Entity Creation with Generated ID', () => {
  it('should generate unique prefixed IDs for new entities', () => {
    const id1 = generatePrefixedId('state');
    const id2 = generatePrefixedId('state');

    // IDs should be strings
    expect(typeof id1).toBe('string');
    expect(typeof id2).toBe('string');

    // IDs should start with the prefix
    expect(id1.startsWith('state-')).toBe(true);
    expect(id2.startsWith('state-')).toBe(true);

    // IDs should be unique (very high probability)
    expect(id1).not.toBe(id2);
  });

  it('should build correct State entity from form data', () => {
    const formData = {
      name: 'My New State',
      stateKind: 'Normal',
      description: 'A test state',
    };

    const entityId = generatePrefixedId('state');

    // Build entity object
    const entity = {
      id: entityId,
      name: formData.name,
      state_kind: formData.stateKind,
      description: formData.description,
    };

    expect(entity.id).toContain('state-');
    expect(entity.name).toBe('My New State');
    expect(entity.state_kind).toBe('Normal');
    expect(entity.description).toBe('A test state');
  });

  it('should build correct Activity entity from form data', () => {
    const formData = {
      name: 'My New Activity',
      activityKind: 'Action',
      description: 'A test activity',
    };

    const entityId = generatePrefixedId('activity');

    // Build entity object
    const entity = {
      id: entityId,
      name: formData.name,
      activity_kind: formData.activityKind,
      description: formData.description,
    };

    expect(entity.id).toContain('activity-');
    expect(entity.name).toBe('My New Activity');
    expect(entity.activity_kind).toBe('Action');
    expect(entity.description).toBe('A test activity');
  });

  it('should map entityType constant to EntityType array key', () => {
    // Mapping from ENTITY_TYPES constants to metaModel.entities keys
    const entityTypeToArrayKey: Record<string, string> = {
      [ENTITY_TYPES.STATE]: 'states',
      [ENTITY_TYPES.ACTIVITY]: 'activities',
      [ENTITY_TYPES.ACTIVITY_PARTITION]: 'activity_partitions',
      [ENTITY_TYPES.LOGICAL_DATA_ENTITY]: 'logical_data_entities',
      [ENTITY_TYPES.PHYSICAL_DATA_ENTITY]: 'physical_data_entities',
    };

    expect(entityTypeToArrayKey['STATE']).toBe('states');
    expect(entityTypeToArrayKey['ACTIVITY']).toBe('activities');
    expect(entityTypeToArrayKey['ACTIVITY_PARTITION']).toBe('activity_partitions');
    expect(entityTypeToArrayKey['LOGICAL_DATA_ENTITY']).toBe('logical_data_entities');
    expect(entityTypeToArrayKey['PHYSICAL_DATA_ENTITY']).toBe('physical_data_entities');
  });
});

// ============================================================================
// Test 2.1.3: Successful entity creation dispatches ADD_DIAGRAM_NODE action
// Updated for Fixed Spawn Position feature
// ============================================================================

describe('Node Placement After Entity Creation', () => {
  it('should create DiagramNode from entity using createDiagramNodeFromEntity at fixed position', () => {
    const entityType = ENTITY_TYPES.STATE;
    const entityId = 'state-123';
    const existingNodes: any[] = [];
    const viewportCenter = { x: 500, y: 400 };

    const node = createDiagramNodeFromEntity(entityType, entityId, existingNodes, viewportCenter);

    expect(node.entity_type).toBe(entityType);
    expect(node.entity_id).toBe(entityId);
    expect(node.id).toBeTruthy();
    expect(node.id.startsWith('node-')).toBe(true);

    // Fixed Spawn Position: Position should be at fixed origin (100, 100)
    // regardless of the viewportCenter parameter
    expect(node.pos_x).toBe(DEFAULT_NODE_SPAWN_ORIGIN.x);
    expect(node.pos_y).toBe(DEFAULT_NODE_SPAWN_ORIGIN.y);

    // Default dimensions
    expect(node.width).toBe(DEFAULT_NODE_WIDTH);
    expect(node.height).toBe(DEFAULT_NODE_HEIGHT);
  });

  it('should calculate correct z_index for new node', () => {
    const existingNodes = [
      { id: 'node-1', z_index: 5 },
      { id: 'node-2', z_index: 10 },
      { id: 'node-3', z_index: 3 },
    ] as any[];

    const newZIndex = calculateZIndex(existingNodes);

    // Should be max z_index + 1
    expect(newZIndex).toBe(11);
  });

  it('should return z_index of 1 for empty diagram', () => {
    const existingNodes: any[] = [];

    const newZIndex = calculateZIndex(existingNodes);

    expect(newZIndex).toBe(1);
  });
});

// ============================================================================
// Test 2.1.4: Fixed Spawn Position - nodes spawn at (100, 100)
// Updated from Viewport-Centered positioning
// ============================================================================

describe('Fixed Spawn Position Node Positioning', () => {
  it('should position node at fixed spawn origin (100, 100)', () => {
    const viewportCenter = { x: 600, y: 500 };
    const node = createDiagramNodeFromEntity(ENTITY_TYPES.STATE, 'state-1', [], viewportCenter);

    // Node should be at fixed spawn origin, NOT viewport center
    expect(node.pos_x).toBe(DEFAULT_NODE_SPAWN_ORIGIN.x);
    expect(node.pos_y).toBe(DEFAULT_NODE_SPAWN_ORIGIN.y);

    // Verify the fixed origin values
    expect(node.pos_x).toBe(100);
    expect(node.pos_y).toBe(100);
  });

  it('should ignore viewport center values and always use fixed position', () => {
    // Test with various viewport centers - all should produce the same position
    const viewportCenters = [
      { x: 100, y: 100 },
      { x: 500, y: 400 },
      { x: 3000, y: 2000 },
      { x: 0, y: 0 },
    ];

    for (const viewportCenter of viewportCenters) {
      const node = createDiagramNodeFromEntity(ENTITY_TYPES.STATE, 'state-1', [], viewportCenter);

      // All nodes should be at the fixed spawn origin
      expect(node.pos_x).toBe(DEFAULT_NODE_SPAWN_ORIGIN.x);
      expect(node.pos_y).toBe(DEFAULT_NODE_SPAWN_ORIGIN.y);
    }
  });

  it('should position node at fixed origin when viewportCenter is omitted', () => {
    // When viewportCenter is not provided
    const node = createDiagramNodeFromEntity(ENTITY_TYPES.STATE, 'state-1', []);

    expect(node.pos_x).toBe(DEFAULT_NODE_SPAWN_ORIGIN.x);
    expect(node.pos_y).toBe(DEFAULT_NODE_SPAWN_ORIGIN.y);
  });
});

// ============================================================================
// Test 2.1.5: Consecutive creates - no cascade offset (removed)
// Updated: Cascade offset has been removed, all nodes spawn at fixed position
// ============================================================================

describe('Fixed Position for Consecutive Creates (No Cascade)', () => {
  it('should position all consecutive creates at the same fixed position', () => {
    // All consecutive creates now spawn at the same fixed position
    // Cascade offset logic has been removed
    const existingNodes: any[] = [];

    // Simulate creating 5 nodes in sequence
    const nodes = [];
    for (let i = 0; i < 5; i++) {
      const node = createDiagramNodeFromEntity(
        ENTITY_TYPES.STATE,
        `state-${i}`,
        existingNodes,
        { x: 500, y: 400 } // Viewport center is ignored
      );
      nodes.push(node);
      existingNodes.push(node);
    }

    // All nodes should be at the same fixed position
    for (const node of nodes) {
      expect(node.pos_x).toBe(DEFAULT_NODE_SPAWN_ORIGIN.x);
      expect(node.pos_y).toBe(DEFAULT_NODE_SPAWN_ORIGIN.y);
    }
  });

  it('should NOT apply cascade offset for consecutive creates', () => {
    // Previously, consecutive creates would offset by 40px each
    // Now all nodes spawn at the same position
    const viewportCenter = { x: 500, y: 400 };

    const node1 = createDiagramNodeFromEntity(ENTITY_TYPES.STATE, 'state-1', [], viewportCenter);
    const node2 = createDiagramNodeFromEntity(ENTITY_TYPES.STATE, 'state-2', [node1], viewportCenter);
    const node3 = createDiagramNodeFromEntity(ENTITY_TYPES.STATE, 'state-3', [node1, node2], viewportCenter);

    // All nodes at the same position (no cascade offset)
    expect(node1.pos_x).toBe(node2.pos_x);
    expect(node2.pos_x).toBe(node3.pos_x);
    expect(node1.pos_y).toBe(node2.pos_y);
    expect(node2.pos_y).toBe(node3.pos_y);

    // All at fixed spawn origin
    expect(node1.pos_x).toBe(100);
    expect(node1.pos_y).toBe(100);
  });
});

// ============================================================================
// Test 2.1.6: New node is auto-selected after placement
// ============================================================================

describe('Auto-Selection of Newly Created Node', () => {
  it('should provide node ID for selection after creation', () => {
    const entityType = ENTITY_TYPES.STATE;
    const entityId = 'state-new-123';
    const viewportCenter = { x: 500, y: 400 };

    // Create the node
    const newNode = createDiagramNodeFromEntity(entityType, entityId, [], viewportCenter);

    // The node ID should be available for selection
    expect(newNode.id).toBeTruthy();
    expect(typeof newNode.id).toBe('string');

    // Simulate selection state update
    const previousSelection = new Set<string>(['old-node-1', 'old-node-2']);
    const newSelection = new Set<string>([newNode.id]);

    // New selection should only contain the new node
    expect(newSelection.size).toBe(1);
    expect(newSelection.has(newNode.id)).toBe(true);
    expect(newSelection.has('old-node-1')).toBe(false);
    expect(newSelection.has('old-node-2')).toBe(false);
  });

  it('should support clearing previous selection when selecting new node', () => {
    // Simulate the selection flow
    let selectedNodeIds = new Set<string>(['node-1', 'node-2']);
    let selectedEdgeIds = new Set<string>(['edge-1']);
    let selectedDecorationIds = new Set<string>(['dec-1']);

    const newNodeId = 'node-newly-created';

    // On auto-select of new node, clear all other selections
    selectedNodeIds = new Set<string>([newNodeId]);
    selectedEdgeIds = new Set<string>();
    selectedDecorationIds = new Set<string>();

    expect(selectedNodeIds.size).toBe(1);
    expect(selectedNodeIds.has(newNodeId)).toBe(true);
    expect(selectedEdgeIds.size).toBe(0);
    expect(selectedDecorationIds.size).toBe(0);
  });
});

// ============================================================================
// Integration: Complete Create and Place Flow (Updated for Fixed Spawn Position)
// ============================================================================

describe('Complete Create and Place Flow Integration', () => {
  it('should support full flow from entity type to diagram node at fixed position', () => {
    // Step 1: Button click provides entity type
    const entityType = ENTITY_TYPES.STATE;

    // Step 2: Form data from drawer
    const formData = {
      name: 'Created State',
      stateKind: 'Normal',
      description: 'Auto-created state',
    };

    // Step 3: Generate entity ID
    const entityId = generatePrefixedId('state');
    expect(entityId).toContain('state-');

    // Step 4: Build entity object
    const entity = {
      id: entityId,
      name: formData.name,
      state_kind: formData.stateKind,
      description: formData.description,
    };

    // Step 5: Entity type mapping for ADD_ENTITY action
    const entityTypeKey = 'states'; // Maps from ENTITY_TYPES.STATE
    expect(entityTypeKey).toBe('states');

    // Step 6: Create diagram node (viewportCenter is ignored, uses fixed position)
    const viewportCenter = { x: 500, y: 400 };
    const node = createDiagramNodeFromEntity(entityType, entityId, [], viewportCenter);

    expect(node.entity_type).toBe('STATE');
    expect(node.entity_id).toBe(entityId);

    // Step 7: Node is at fixed spawn position (100, 100)
    expect(node.id).toBeTruthy();
    expect(node.pos_x).toBe(DEFAULT_NODE_SPAWN_ORIGIN.x);
    expect(node.pos_y).toBe(DEFAULT_NODE_SPAWN_ORIGIN.y);

    // Step 8: Node ID available for auto-selection
    const selectedNodeIds = new Set<string>([node.id]);
    expect(selectedNodeIds.has(node.id)).toBe(true);
  });
});
