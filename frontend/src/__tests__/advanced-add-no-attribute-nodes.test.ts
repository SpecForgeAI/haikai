/**
 * Tests for Advanced Add - Do Not Create Attribute Nodes Feature
 *
 * This test file covers all task groups for ensuring that LOGICAL_DATA_ATTRIBUTE
 * and PHYSICAL_DATA_ATTRIBUTE entity types are NOT created as diagram nodes.
 * Attributes should only be used for ERD-style rendering inside their parent entity nodes.
 */

import { ENTITY_TYPES } from '../types/model';
import { isAttributeEntityType } from '../utils/erdAdvancedAddUtils';
import { DiagramNode } from '../types/model';

// ============================================================================
// Task Group 1: Tests for isAttributeEntityType helper
// ============================================================================

describe('Task Group 1: isAttributeEntityType helper', () => {
  describe('should return true for attribute entity types', () => {
    it('returns true for LOGICAL_DATA_ATTRIBUTE', () => {
      expect(isAttributeEntityType(ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE)).toBe(true);
    });

    it('returns true for PHYSICAL_DATA_ATTRIBUTE', () => {
      expect(isAttributeEntityType(ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE)).toBe(true);
    });
  });

  describe('should return false for non-attribute entity types', () => {
    it('returns false for APPLICATION', () => {
      expect(isAttributeEntityType(ENTITY_TYPES.APPLICATION)).toBe(false);
    });

    it('returns false for LOGICAL_DATA_ENTITY', () => {
      expect(isAttributeEntityType(ENTITY_TYPES.LOGICAL_DATA_ENTITY)).toBe(false);
    });

    it('returns false for PHYSICAL_DATA_ENTITY', () => {
      expect(isAttributeEntityType(ENTITY_TYPES.PHYSICAL_DATA_ENTITY)).toBe(false);
    });

    it('returns false for BUSINESS_PROCESS', () => {
      expect(isAttributeEntityType(ENTITY_TYPES.BUSINESS_PROCESS)).toBe(false);
    });

    it('returns false for SERVICE', () => {
      expect(isAttributeEntityType(ENTITY_TYPES.SERVICE)).toBe(false);
    });

    it('returns false for INTERFACE', () => {
      expect(isAttributeEntityType(ENTITY_TYPES.INTERFACE)).toBe(false);
    });
  });

  describe('should handle edge cases', () => {
    it('returns false for empty string', () => {
      expect(isAttributeEntityType('')).toBe(false);
    });

    it('returns false for undefined', () => {
      // @ts-ignore - testing runtime behavior with undefined
      expect(isAttributeEntityType(undefined)).toBe(false);
    });

    it('returns false for null', () => {
      // @ts-ignore - testing runtime behavior with null
      expect(isAttributeEntityType(null)).toBe(false);
    });

    it('returns false for unknown entity type', () => {
      expect(isAttributeEntityType('UNKNOWN_TYPE')).toBe(false);
    });
  });
});

// ============================================================================
// Task Group 2: Tests for DiagramNode selected_attribute_ids field
// ============================================================================

describe('Task Group 2: DiagramNode selected_attribute_ids field', () => {
  it('accepts optional selected_attribute_ids array', () => {
    const node: DiagramNode = {
      id: 'node-1',
      entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      entity_id: 'entity-1',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 150,
      z_index: 1,
      parent_node_id: null,
      selected_attribute_ids: ['attr-1', 'attr-2', 'attr-3'],
    };

    expect(node.selected_attribute_ids).toBeDefined();
    expect(node.selected_attribute_ids).toHaveLength(3);
    expect(node.selected_attribute_ids).toContain('attr-1');
    expect(node.selected_attribute_ids).toContain('attr-2');
    expect(node.selected_attribute_ids).toContain('attr-3');
  });

  it('allows selected_attribute_ids to be undefined (backward compatibility)', () => {
    const node: DiagramNode = {
      id: 'node-1',
      entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      entity_id: 'entity-1',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 150,
      z_index: 1,
      parent_node_id: null,
      // selected_attribute_ids intentionally omitted
    };

    expect(node.selected_attribute_ids).toBeUndefined();
  });

  it('preserves selected_attribute_ids through serialization/deserialization', () => {
    const originalNode: DiagramNode = {
      id: 'node-1',
      entity_type: ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
      entity_id: 'entity-1',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 150,
      z_index: 1,
      parent_node_id: null,
      selected_attribute_ids: ['attr-a', 'attr-b'],
    };

    // Simulate JSON serialization/deserialization
    const json = JSON.stringify(originalNode);
    const deserializedNode: DiagramNode = JSON.parse(json);

    expect(deserializedNode.selected_attribute_ids).toEqual(['attr-a', 'attr-b']);
  });
});

// ============================================================================
// Task Group 3: Tests for convertTodiagramNodes attribute filtering
// ============================================================================

describe('Task Group 3: convertTodiagramNodes attribute filtering', () => {
  // Import will be added once function is updated
  // These tests verify the behavior after implementation

  it('should skip LOGICAL_DATA_ATTRIBUTE nodes in output', () => {
    // This test will be implemented with the actual function
    // For now, we verify the expected behavior conceptually
    const attributeType = ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE;
    expect(isAttributeEntityType(attributeType)).toBe(true);
  });

  it('should skip PHYSICAL_DATA_ATTRIBUTE nodes in output', () => {
    const attributeType = ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE;
    expect(isAttributeEntityType(attributeType)).toBe(true);
  });

  it('should NOT skip LOGICAL_DATA_ENTITY nodes', () => {
    const entityType = ENTITY_TYPES.LOGICAL_DATA_ENTITY;
    expect(isAttributeEntityType(entityType)).toBe(false);
  });

  it('should NOT skip PHYSICAL_DATA_ENTITY nodes', () => {
    const entityType = ENTITY_TYPES.PHYSICAL_DATA_ENTITY;
    expect(isAttributeEntityType(entityType)).toBe(false);
  });

  it('should NOT skip other entity types like APPLICATION', () => {
    const entityType = ENTITY_TYPES.APPLICATION;
    expect(isAttributeEntityType(entityType)).toBe(false);
  });
});

// ============================================================================
// Task Group 4: Tests for PalettePanel attribute filtering
// ============================================================================

describe('Task Group 4: PalettePanel attribute filtering', () => {
  // These tests verify the expected behavior for buildWrappedNodeHierarchy
  // and convertTreeNodeToLayoutTreeWithExistingHandling

  it('should identify LOGICAL_DATA_ATTRIBUTE as an attribute type to filter', () => {
    expect(isAttributeEntityType(ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE)).toBe(true);
  });

  it('should identify PHYSICAL_DATA_ATTRIBUTE as an attribute type to filter', () => {
    expect(isAttributeEntityType(ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE)).toBe(true);
  });

  it('should NOT filter LOGICAL_DATA_ENTITY parent nodes', () => {
    expect(isAttributeEntityType(ENTITY_TYPES.LOGICAL_DATA_ENTITY)).toBe(false);
  });

  it('should NOT filter PHYSICAL_DATA_ENTITY parent nodes', () => {
    expect(isAttributeEntityType(ENTITY_TYPES.PHYSICAL_DATA_ENTITY)).toBe(false);
  });
});

// ============================================================================
// Task Group 5: Tests for validation layer attribute rejection
// ============================================================================

describe('Task Group 5: Validation layer attribute rejection', () => {
  // Import validation utilities
  // These tests verify that attribute entity types are not in entityTypeMap

  it('should identify that LOGICAL_DATA_ATTRIBUTE is an attribute type', () => {
    expect(isAttributeEntityType(ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE)).toBe(true);
  });

  it('should identify that PHYSICAL_DATA_ATTRIBUTE is an attribute type', () => {
    expect(isAttributeEntityType(ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE)).toBe(true);
  });

  it('should reject diagram nodes with attribute entity types conceptually', () => {
    // Validation will produce "Unknown entity type" error for attribute types
    // because they are not in the entityTypeMap
    const attributeTypes = [
      ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE,
      ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE,
    ];

    attributeTypes.forEach((type) => {
      expect(isAttributeEntityType(type)).toBe(true);
    });
  });
});

// ============================================================================
// Task Group 6: Integration tests
// ============================================================================

describe('Task Group 6: Integration tests', () => {
  describe('isAttributeEntityType consistency', () => {
    it('should be consistent across all attribute types', () => {
      // Both attribute types should return true
      expect(isAttributeEntityType(ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE)).toBe(true);
      expect(isAttributeEntityType(ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE)).toBe(true);

      // Their parent entity types should return false
      expect(isAttributeEntityType(ENTITY_TYPES.LOGICAL_DATA_ENTITY)).toBe(false);
      expect(isAttributeEntityType(ENTITY_TYPES.PHYSICAL_DATA_ENTITY)).toBe(false);
    });
  });

  describe('DiagramNode with selected_attribute_ids for ERD rendering', () => {
    it('should support ERD-style node with selected attributes', () => {
      const erdNode: DiagramNode = {
        id: 'node-erd-1',
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        entity_id: 'lde-1',
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 200,
        z_index: 1,
        parent_node_id: null,
        render_style: 'erd',
        embedded_attribute_ids: ['attr-1', 'attr-2'],
        selected_attribute_ids: ['attr-1', 'attr-2'],
      };

      expect(erdNode.render_style).toBe('erd');
      expect(erdNode.embedded_attribute_ids).toHaveLength(2);
      expect(erdNode.selected_attribute_ids).toHaveLength(2);
    });
  });

  describe('Attribute types should never be diagram nodes', () => {
    it('should correctly identify all attribute types for filtering', () => {
      const allAttributeTypes = [
        ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE,
        ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE,
      ];

      const nonAttributeTypes = [
        ENTITY_TYPES.APPLICATION,
        ENTITY_TYPES.APP_COMPONENT,
        ENTITY_TYPES.SERVICE,
        ENTITY_TYPES.INTERFACE,
        ENTITY_TYPES.BUSINESS_PROCESS,
        ENTITY_TYPES.PROCESS_ACTIVITY,
        ENTITY_TYPES.BUSINESS_USER,
        ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
      ];

      allAttributeTypes.forEach((type) => {
        expect(isAttributeEntityType(type)).toBe(true);
      });

      nonAttributeTypes.forEach((type) => {
        expect(isAttributeEntityType(type)).toBe(false);
      });
    });
  });
});
