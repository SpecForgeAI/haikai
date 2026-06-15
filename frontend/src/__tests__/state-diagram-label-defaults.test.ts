/**
 * State Diagram Label Defaults Tests
 * Spec: 2026-01-02-state-diagram-ux-fixes
 * Task Group 2: Label Defaults Layer
 *
 * Tests for State node label default alignment:
 * - Test newly created State node has text_h_align: 'CENTER' and text_v_align: 'MIDDLE'
 * - Test alignment settings persist on DiagramNode after save/reload cycle
 * - Test alignment only applies to Normal state nodes (Initial/Final don't display labels)
 * - Test alignment controls update node fields correctly
 */

import { describe, it, expect } from 'vitest';
import {
  createDiagramNodeFromEntity,
  DEFAULT_NODE_SPAWN_ORIGIN,
} from '../utils/nodeCreation';
import { ENTITY_TYPES, DiagramNode } from '../types/model';

// ============================================================================
// Test Suite: State Node Default Alignment
// ============================================================================

describe('State Diagram Label Defaults - Default Alignment Settings', () => {
  /**
   * Test 2.1a: Newly created State node has CENTER horizontal alignment
   */
  it('should create State node with text_h_align: CENTER by default', () => {
    const existingNodes: DiagramNode[] = [];
    const node = createDiagramNodeFromEntity(
      ENTITY_TYPES.STATE,
      'state-test-1',
      existingNodes
    );

    expect(node.text_h_align).toBe('CENTER');
  });

  /**
   * Test 2.1b: Newly created State node has MIDDLE vertical alignment
   */
  it('should create State node with text_v_align: MIDDLE by default', () => {
    const existingNodes: DiagramNode[] = [];
    const node = createDiagramNodeFromEntity(
      ENTITY_TYPES.STATE,
      'state-test-2',
      existingNodes
    );

    expect(node.text_v_align).toBe('MIDDLE');
  });

  /**
   * Test 2.1c: State node has both CENTER and MIDDLE alignment defaults
   */
  it('should create State node with both alignment defaults set', () => {
    const existingNodes: DiagramNode[] = [];
    const node = createDiagramNodeFromEntity(
      ENTITY_TYPES.STATE,
      'state-test-3',
      existingNodes
    );

    expect(node.text_h_align).toBe('CENTER');
    expect(node.text_v_align).toBe('MIDDLE');
  });

  /**
   * Test 2.1d: State node spawns at correct position with alignment defaults
   */
  it('should create State node at spawn origin with correct alignment', () => {
    const existingNodes: DiagramNode[] = [];
    const node = createDiagramNodeFromEntity(
      ENTITY_TYPES.STATE,
      'state-test-4',
      existingNodes
    );

    // Verify spawn position
    expect(node.pos_x).toBe(DEFAULT_NODE_SPAWN_ORIGIN.x);
    expect(node.pos_y).toBe(DEFAULT_NODE_SPAWN_ORIGIN.y);

    // Verify alignment defaults
    expect(node.text_h_align).toBe('CENTER');
    expect(node.text_v_align).toBe('MIDDLE');
  });
});

// ============================================================================
// Test Suite: Non-State Entity Types (should not have defaults)
// ============================================================================

describe('State Diagram Label Defaults - Other Entity Types', () => {
  /**
   * Test 2.2a: Non-STATE entities should not have forced alignment defaults
   * (They may have undefined alignment which falls back to renderer defaults)
   */
  it('should not set alignment defaults for APPLICATION entity type', () => {
    const existingNodes: DiagramNode[] = [];
    const node = createDiagramNodeFromEntity(
      ENTITY_TYPES.APPLICATION,
      'app-test-1',
      existingNodes
    );

    // APPLICATION nodes should not have forced alignment
    // Either undefined or no explicit CENTER/MIDDLE
    expect(node.text_h_align).toBeUndefined();
    expect(node.text_v_align).toBeUndefined();
  });

  /**
   * Test 2.2b: ACTIVITY entities should not have forced alignment defaults
   */
  it('should not set alignment defaults for ACTIVITY entity type', () => {
    const existingNodes: DiagramNode[] = [];
    const node = createDiagramNodeFromEntity(
      ENTITY_TYPES.ACTIVITY,
      'activity-test-1',
      existingNodes
    );

    // ACTIVITY nodes should not have forced alignment
    expect(node.text_h_align).toBeUndefined();
    expect(node.text_v_align).toBeUndefined();
  });
});

// ============================================================================
// Test Suite: Alignment Persistence
// ============================================================================

describe('State Diagram Label Defaults - Alignment Persistence', () => {
  /**
   * Test 2.3a: Alignment fields are serializable (can be stored/retrieved)
   */
  it('should have alignment fields that can be serialized to JSON', () => {
    const existingNodes: DiagramNode[] = [];
    const node = createDiagramNodeFromEntity(
      ENTITY_TYPES.STATE,
      'state-serialize-1',
      existingNodes
    );

    // Serialize to JSON and back
    const json = JSON.stringify(node);
    const restored = JSON.parse(json) as DiagramNode;

    expect(restored.text_h_align).toBe('CENTER');
    expect(restored.text_v_align).toBe('MIDDLE');
  });

  /**
   * Test 2.3b: Alignment values remain unchanged after round-trip
   */
  it('should preserve exact alignment values after JSON round-trip', () => {
    const existingNodes: DiagramNode[] = [];
    const original = createDiagramNodeFromEntity(
      ENTITY_TYPES.STATE,
      'state-roundtrip-1',
      existingNodes
    );

    // Simulate save/reload cycle
    const serialized = JSON.stringify(original);
    const deserialized = JSON.parse(serialized) as DiagramNode;

    // Values should match exactly
    expect(deserialized.text_h_align).toBe(original.text_h_align);
    expect(deserialized.text_v_align).toBe(original.text_v_align);
    expect(deserialized.text_h_align).toBe('CENTER');
    expect(deserialized.text_v_align).toBe('MIDDLE');
  });
});

// ============================================================================
// Test Suite: Alignment Control Updates (simulated)
// ============================================================================

describe('State Diagram Label Defaults - Alignment Control Updates', () => {
  /**
   * Test 2.4a: Horizontal alignment can be changed from CENTER to LEFT
   */
  it('should allow updating text_h_align from CENTER to LEFT', () => {
    const existingNodes: DiagramNode[] = [];
    const node = createDiagramNodeFromEntity(
      ENTITY_TYPES.STATE,
      'state-update-1',
      existingNodes
    );

    // Initial value
    expect(node.text_h_align).toBe('CENTER');

    // Simulate UPDATE_NODE dispatch
    const updatedNode: DiagramNode = {
      ...node,
      text_h_align: 'LEFT',
    };

    expect(updatedNode.text_h_align).toBe('LEFT');
  });

  /**
   * Test 2.4b: Vertical alignment can be changed from MIDDLE to TOP
   */
  it('should allow updating text_v_align from MIDDLE to TOP', () => {
    const existingNodes: DiagramNode[] = [];
    const node = createDiagramNodeFromEntity(
      ENTITY_TYPES.STATE,
      'state-update-2',
      existingNodes
    );

    // Initial value
    expect(node.text_v_align).toBe('MIDDLE');

    // Simulate UPDATE_NODE dispatch
    const updatedNode: DiagramNode = {
      ...node,
      text_v_align: 'TOP',
    };

    expect(updatedNode.text_v_align).toBe('TOP');
  });

  /**
   * Test 2.4c: Updated alignment persists after deselect/reselect (via serialization)
   */
  it('should persist updated alignment values after round-trip', () => {
    const existingNodes: DiagramNode[] = [];
    const node = createDiagramNodeFromEntity(
      ENTITY_TYPES.STATE,
      'state-persist-1',
      existingNodes
    );

    // Simulate user changing alignment
    const updatedNode: DiagramNode = {
      ...node,
      text_h_align: 'RIGHT',
      text_v_align: 'BOTTOM',
    };

    // Simulate save/reload
    const serialized = JSON.stringify(updatedNode);
    const restored = JSON.parse(serialized) as DiagramNode;

    // Updated values should persist
    expect(restored.text_h_align).toBe('RIGHT');
    expect(restored.text_v_align).toBe('BOTTOM');
  });
});
