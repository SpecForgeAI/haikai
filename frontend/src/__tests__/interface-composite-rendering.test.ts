/**
 * Interface Composite Rendering Bug Fix Tests
 *
 * Spec: Fix Interface Composite Rendering
 * This test file covers all 3 task groups for the interface composite rendering bugfix:
 * - Task Group 1: Type and Utility Layer (erdAdvancedAddUtils.ts)
 * - Task Group 2: Call Site Fixes (compoundLayout.ts, PalettePanel.tsx)
 * - Task Group 3: Legacy Normalization (ArchitectureContext.tsx)
 *
 * Runtime Error Fixed: `selectedDataEntityIds.logicalEntityIds is not iterable`
 */

import { describe, it, expect } from 'vitest';
import { ENTITY_TYPES, MetaModel } from '../types/model';
import { TreeNodeData } from '../types/advancedAdd';
import {
  InterfaceCustomCandidate,
  isInterfaceCustomLayoutCandidate,
  findInterfaceCustomCandidates,
  isEmbeddedInterfaceChild,
} from '../utils/erdAdvancedAddUtils';
import { DataEntityIdsForInterface, buildInterfaceCompositeNodes } from '../utils/interfaceCompositeBuilder';
import { normalizeInterfaceLogicalEntities } from '../contexts/ArchitectureContext';

// ============================================================================
// TEST DATA HELPERS
// ============================================================================

/**
 * Create a minimal TreeNodeData for testing
 */
function createTreeNode(
  key: string,
  entityId: string,
  entityType: string,
  children: TreeNodeData[] = []
): TreeNodeData {
  return {
    key,
    entityId,
    entityType,
    title: `Test ${entityType}`,
    children,
    isLeaf: children.length === 0,
  };
}

/**
 * Create a minimal MetaModel for testing
 */
function createMinimalMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      applications: [],
      app_components: [],
      services: [],
      interfaces: [
        { id: 'interface_1', name: 'Test Interface', service_id: 'service_1', description: '', tags: '' },
      ],
      endpoints: [
        { id: 'endpoint_1', name: 'GET Users', interface_id: 'interface_1', operation_verb: 'GET', path_or_address: '/users', description: '', tags: '' },
      ],
      logical_data_entities: [
        { id: 'lde_1', name: 'User', description: '', tags: '' },
        { id: 'lde_2', name: 'Order', description: '', tags: '' },
      ],
      physical_data_entities: [
        { id: 'pde_1', name: 'users_table', technology: 'PostgreSQL', description: '', tags: '' },
        { id: 'pde_2', name: 'orders_table', technology: 'PostgreSQL', description: '', tags: '' },
      ],
      logical_data_attributes: [],
      physical_data_attributes: [],
      application_points: [],
      business_points: [],
      app_business_points: [],
      interactions: [],
    },
    relationships: {
      application_technologies: [],
      application_capabilities: [],
      application_point_business_points: [],
      business_user_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      data_movements: [],
      interface_logical_entities: [],
      user_interactions: [],
    },
  };
}

// ============================================================================
// TASK GROUP 1: TYPE AND UTILITY LAYER TESTS
// ============================================================================

describe('Task Group 1: Type and Utility Layer', () => {
  describe('isInterfaceCustomLayoutCandidate', () => {
    it('should return true for Interface with PHYSICAL_DATA_ENTITY child', () => {
      const physicalEntityChild = createTreeNode(
        'pde_1',
        'pde_1',
        ENTITY_TYPES.PHYSICAL_DATA_ENTITY
      );
      const interfaceNode = createTreeNode(
        'interface_1',
        'interface_1',
        ENTITY_TYPES.INTERFACE,
        [physicalEntityChild]
      );

      const selectedKeys = new Set(['interface_1', 'pde_1']);
      const metaModel = createMinimalMetaModel();

      const result = isInterfaceCustomLayoutCandidate(interfaceNode, selectedKeys, metaModel);
      expect(result).toBe(true);
    });

    it('should return true for Interface with LOGICAL_DATA_ENTITY child', () => {
      const logicalEntityChild = createTreeNode(
        'lde_1',
        'lde_1',
        ENTITY_TYPES.LOGICAL_DATA_ENTITY
      );
      const interfaceNode = createTreeNode(
        'interface_1',
        'interface_1',
        ENTITY_TYPES.INTERFACE,
        [logicalEntityChild]
      );

      const selectedKeys = new Set(['interface_1', 'lde_1']);
      const metaModel = createMinimalMetaModel();

      const result = isInterfaceCustomLayoutCandidate(interfaceNode, selectedKeys, metaModel);
      expect(result).toBe(true);
    });

    it('should return true for Interface with ENDPOINT child', () => {
      const endpointChild = createTreeNode(
        'endpoint_1',
        'endpoint_1',
        ENTITY_TYPES.ENDPOINT
      );
      const interfaceNode = createTreeNode(
        'interface_1',
        'interface_1',
        ENTITY_TYPES.INTERFACE,
        [endpointChild]
      );

      const selectedKeys = new Set(['interface_1', 'endpoint_1']);
      const metaModel = createMinimalMetaModel();

      const result = isInterfaceCustomLayoutCandidate(interfaceNode, selectedKeys, metaModel);
      expect(result).toBe(true);
    });

    it('should return false for Interface without selected children', () => {
      const logicalEntityChild = createTreeNode(
        'lde_1',
        'lde_1',
        ENTITY_TYPES.LOGICAL_DATA_ENTITY
      );
      const interfaceNode = createTreeNode(
        'interface_1',
        'interface_1',
        ENTITY_TYPES.INTERFACE,
        [logicalEntityChild]
      );

      // Only interface is selected, not its children
      const selectedKeys = new Set(['interface_1']);
      const metaModel = createMinimalMetaModel();

      const result = isInterfaceCustomLayoutCandidate(interfaceNode, selectedKeys, metaModel);
      expect(result).toBe(false);
    });
  });

  describe('findInterfaceCustomCandidates', () => {
    it('should return candidates with both logicalEntities and physicalEntities', () => {
      const logicalEntityChild = createTreeNode(
        'lde_1',
        'lde_1',
        ENTITY_TYPES.LOGICAL_DATA_ENTITY
      );
      const physicalEntityChild = createTreeNode(
        'pde_1',
        'pde_1',
        ENTITY_TYPES.PHYSICAL_DATA_ENTITY
      );
      const endpointChild = createTreeNode(
        'endpoint_1',
        'endpoint_1',
        ENTITY_TYPES.ENDPOINT
      );
      const interfaceNode = createTreeNode(
        'interface_1',
        'interface_1',
        ENTITY_TYPES.INTERFACE,
        [endpointChild, logicalEntityChild, physicalEntityChild]
      );

      const selectedKeys = new Set(['interface_1', 'endpoint_1', 'lde_1', 'pde_1']);
      const metaModel = createMinimalMetaModel();

      const candidates = findInterfaceCustomCandidates([interfaceNode], selectedKeys, metaModel);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].interface.entityId).toBe('interface_1');
      expect(candidates[0].endpoints).toHaveLength(1);
      expect(candidates[0].logicalEntities).toHaveLength(1);
      expect(candidates[0].physicalEntities).toHaveLength(1);
      expect(candidates[0].physicalEntities[0].entityId).toBe('pde_1');
    });

    it('should return candidate with only physical entities (no logical entities)', () => {
      const physicalEntityChild = createTreeNode(
        'pde_1',
        'pde_1',
        ENTITY_TYPES.PHYSICAL_DATA_ENTITY
      );
      const interfaceNode = createTreeNode(
        'interface_1',
        'interface_1',
        ENTITY_TYPES.INTERFACE,
        [physicalEntityChild]
      );

      const selectedKeys = new Set(['interface_1', 'pde_1']);
      const metaModel = createMinimalMetaModel();

      const candidates = findInterfaceCustomCandidates([interfaceNode], selectedKeys, metaModel);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].logicalEntities).toHaveLength(0);
      expect(candidates[0].physicalEntities).toHaveLength(1);
    });

    it('should return candidate with mixed endpoint, logical, and physical children', () => {
      const endpoint1 = createTreeNode('ep_1', 'ep_1', ENTITY_TYPES.ENDPOINT);
      const endpoint2 = createTreeNode('ep_2', 'ep_2', ENTITY_TYPES.ENDPOINT);
      const lde1 = createTreeNode('lde_1', 'lde_1', ENTITY_TYPES.LOGICAL_DATA_ENTITY);
      const pde1 = createTreeNode('pde_1', 'pde_1', ENTITY_TYPES.PHYSICAL_DATA_ENTITY);
      const pde2 = createTreeNode('pde_2', 'pde_2', ENTITY_TYPES.PHYSICAL_DATA_ENTITY);

      const interfaceNode = createTreeNode(
        'interface_1',
        'interface_1',
        ENTITY_TYPES.INTERFACE,
        [endpoint1, endpoint2, lde1, pde1, pde2]
      );

      const selectedKeys = new Set(['interface_1', 'ep_1', 'ep_2', 'lde_1', 'pde_1', 'pde_2']);
      const metaModel = createMinimalMetaModel();

      const candidates = findInterfaceCustomCandidates([interfaceNode], selectedKeys, metaModel);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].endpoints).toHaveLength(2);
      expect(candidates[0].logicalEntities).toHaveLength(1);
      expect(candidates[0].physicalEntities).toHaveLength(2);
    });
  });

  describe('isEmbeddedInterfaceChild', () => {
    it('should return true for physical entity in candidate.physicalEntities', () => {
      const physicalEntityChild = createTreeNode(
        'pde_1',
        'pde_1',
        ENTITY_TYPES.PHYSICAL_DATA_ENTITY
      );

      const candidate: InterfaceCustomCandidate = {
        interface: createTreeNode('interface_1', 'interface_1', ENTITY_TYPES.INTERFACE),
        endpoints: [],
        logicalEntities: [],
        physicalEntities: [physicalEntityChild],
      };

      const result = isEmbeddedInterfaceChild(physicalEntityChild, [candidate]);
      expect(result).toBe(true);
    });
  });
});

// ============================================================================
// TASK GROUP 2: CALL SITE FIXES TESTS
// ============================================================================

describe('Task Group 2: Call Site Fixes', () => {
  describe('buildInterfaceCompositeNodes', () => {
    it('should not throw when given valid DataEntityIdsForInterface with both logical and physical entity IDs', () => {
      const metaModel = createMinimalMetaModel();
      const selectedEndpointIds = ['endpoint_1'];
      const selectedDataEntityIds: DataEntityIdsForInterface = {
        logicalEntityIds: ['lde_1'],
        physicalEntityIds: ['pde_1'],
      };
      const selectedAttributeIdsByEntity = new Map<string, string[]>();

      expect(() => {
        buildInterfaceCompositeNodes(
          'interface_1',
          selectedEndpointIds,
          selectedDataEntityIds,
          selectedAttributeIdsByEntity,
          metaModel,
          { x: 100, y: 100 },
          1,
          null
        );
      }).not.toThrow();
    });

    it('should handle empty physicalEntityIds array without error', () => {
      const metaModel = createMinimalMetaModel();
      const selectedEndpointIds = ['endpoint_1'];
      const selectedDataEntityIds: DataEntityIdsForInterface = {
        logicalEntityIds: ['lde_1'],
        physicalEntityIds: [], // Empty physical entities
      };
      const selectedAttributeIdsByEntity = new Map<string, string[]>();

      expect(() => {
        const result = buildInterfaceCompositeNodes(
          'interface_1',
          selectedEndpointIds,
          selectedDataEntityIds,
          selectedAttributeIdsByEntity,
          metaModel,
          { x: 100, y: 100 },
          1,
          null
        );
        expect(result.interfaceNode).toBeDefined();
        expect(result.entityNodes.length).toBe(1); // Only logical entity
      }).not.toThrow();
    });

    it('should handle empty logicalEntityIds array without error', () => {
      const metaModel = createMinimalMetaModel();
      const selectedEndpointIds = ['endpoint_1'];
      const selectedDataEntityIds: DataEntityIdsForInterface = {
        logicalEntityIds: [], // Empty logical entities
        physicalEntityIds: ['pde_1'],
      };
      const selectedAttributeIdsByEntity = new Map<string, string[]>();

      expect(() => {
        const result = buildInterfaceCompositeNodes(
          'interface_1',
          selectedEndpointIds,
          selectedDataEntityIds,
          selectedAttributeIdsByEntity,
          metaModel,
          { x: 100, y: 100 },
          1,
          null
        );
        expect(result.interfaceNode).toBeDefined();
        expect(result.entityNodes.length).toBe(1); // Only physical entity
      }).not.toThrow();
    });

    it('should create entity nodes for both logical and physical entities', () => {
      const metaModel = createMinimalMetaModel();
      const selectedEndpointIds = ['endpoint_1'];
      const selectedDataEntityIds: DataEntityIdsForInterface = {
        logicalEntityIds: ['lde_1', 'lde_2'],
        physicalEntityIds: ['pde_1'],
      };
      const selectedAttributeIdsByEntity = new Map<string, string[]>();

      const result = buildInterfaceCompositeNodes(
        'interface_1',
        selectedEndpointIds,
        selectedDataEntityIds,
        selectedAttributeIdsByEntity,
        metaModel,
        { x: 100, y: 100 },
        1,
        null
      );

      expect(result.entityNodes.length).toBe(3); // 2 logical + 1 physical

      // Verify entity types
      const entityTypes = result.entityNodes.map(n => n.entity_type);
      expect(entityTypes.filter(t => t === ENTITY_TYPES.LOGICAL_DATA_ENTITY)).toHaveLength(2);
      expect(entityTypes.filter(t => t === ENTITY_TYPES.PHYSICAL_DATA_ENTITY)).toHaveLength(1);
    });
  });

  describe('DataEntityIdsForInterface object shape', () => {
    it('should be constructed correctly from InterfaceCustomCandidate', () => {
      // This tests the pattern used in compoundLayout.ts
      const candidate: InterfaceCustomCandidate = {
        interface: createTreeNode('interface_1', 'interface_1', ENTITY_TYPES.INTERFACE),
        endpoints: [createTreeNode('ep_1', 'ep_1', ENTITY_TYPES.ENDPOINT)],
        logicalEntities: [
          createTreeNode('lde_1', 'lde_1', ENTITY_TYPES.LOGICAL_DATA_ENTITY),
        ],
        physicalEntities: [
          createTreeNode('pde_1', 'pde_1', ENTITY_TYPES.PHYSICAL_DATA_ENTITY),
        ],
      };

      // Build the DataEntityIdsForInterface object (same pattern as in compoundLayout.ts)
      const selectedDataEntityIds: DataEntityIdsForInterface = {
        logicalEntityIds: candidate.logicalEntities.map(le => le.entityId),
        physicalEntityIds: candidate.physicalEntities?.map(pe => pe.entityId) || [],
      };

      expect(selectedDataEntityIds.logicalEntityIds).toEqual(['lde_1']);
      expect(selectedDataEntityIds.physicalEntityIds).toEqual(['pde_1']);

      // Verify it's iterable
      expect(() => {
        for (const id of selectedDataEntityIds.logicalEntityIds) {
          expect(typeof id).toBe('string');
        }
        for (const id of selectedDataEntityIds.physicalEntityIds) {
          expect(typeof id).toBe('string');
        }
      }).not.toThrow();
    });
  });
});

// ============================================================================
// TASK GROUP 3: LEGACY NORMALIZATION TESTS
// ============================================================================

describe('Task Group 3: Legacy Normalization', () => {
  describe('normalizeInterfaceLogicalEntities', () => {
    it('should fill dataEntityPointId from logical_entity_id when missing', () => {
      const interfaceLogicalEntities = [
        {
          id: 'ile_1',
          interface_id: 'interface_1',
          dataEntityPointId: '', // Missing
          description: '',
          tags: '',
          // Legacy field
          logical_entity_id: 'lde_1',
        } as any,
      ];

      const result = normalizeInterfaceLogicalEntities(interfaceLogicalEntities);

      expect(result[0].dataEntityPointId).toBe('dep_log_lde_1');
    });

    it('should fill dataEntityPointId from physical_entity_id when missing', () => {
      const interfaceLogicalEntities = [
        {
          id: 'ile_1',
          interface_id: 'interface_1',
          dataEntityPointId: '', // Missing
          description: '',
          tags: '',
          // Legacy field
          physical_entity_id: 'pde_1',
        } as any,
      ];

      const result = normalizeInterfaceLogicalEntities(interfaceLogicalEntities);

      expect(result[0].dataEntityPointId).toBe('dep_phy_pde_1');
    });

    it('should preserve existing dataEntityPointId values (no overwrite)', () => {
      const interfaceLogicalEntities = [
        {
          id: 'ile_1',
          interface_id: 'interface_1',
          dataEntityPointId: 'dep_log_existing',
          description: '',
          tags: '',
          // Legacy field should be ignored
          logical_entity_id: 'lde_different',
        } as any,
      ];

      const result = normalizeInterfaceLogicalEntities(interfaceLogicalEntities);

      expect(result[0].dataEntityPointId).toBe('dep_log_existing');
    });

    it('should handle rows with no legacy fields gracefully', () => {
      const interfaceLogicalEntities = [
        {
          id: 'ile_1',
          interface_id: 'interface_1',
          dataEntityPointId: '', // Missing, but no legacy fields either
          description: '',
          tags: '',
        },
      ];

      const result = normalizeInterfaceLogicalEntities(interfaceLogicalEntities);

      // Should remain empty since no legacy fields to migrate from
      expect(result[0].dataEntityPointId).toBe('');
    });

    it('should handle undefined dataEntityPointId', () => {
      const interfaceLogicalEntities = [
        {
          id: 'ile_1',
          interface_id: 'interface_1',
          // dataEntityPointId is undefined
          description: '',
          tags: '',
          logical_entity_id: 'lde_1',
        } as any,
      ];

      const result = normalizeInterfaceLogicalEntities(interfaceLogicalEntities);

      expect(result[0].dataEntityPointId).toBe('dep_log_lde_1');
    });

    it('should prioritize logical_entity_id over physical_entity_id when both present', () => {
      const interfaceLogicalEntities = [
        {
          id: 'ile_1',
          interface_id: 'interface_1',
          dataEntityPointId: '',
          description: '',
          tags: '',
          // Both legacy fields present (edge case)
          logical_entity_id: 'lde_1',
          physical_entity_id: 'pde_1',
        } as any,
      ];

      const result = normalizeInterfaceLogicalEntities(interfaceLogicalEntities);

      // Should use logical_entity_id first
      expect(result[0].dataEntityPointId).toBe('dep_log_lde_1');
    });
  });

  describe('Integration: Interface Composite Rendering', () => {
    it('should render Interface composite without runtime errors after normalization', () => {
      const metaModel = createMinimalMetaModel();

      // Simulate legacy data that has been normalized
      const normalizedRelationships = normalizeInterfaceLogicalEntities([
        {
          id: 'ile_1',
          interface_id: 'interface_1',
          dataEntityPointId: '',
          description: '',
          tags: '',
          logical_entity_id: 'lde_1',
        } as any,
      ]);

      // Update metaModel with normalized relationships
      metaModel.relationships.interface_logical_entities = normalizedRelationships;

      // Now build the composite - this should not throw
      const selectedDataEntityIds: DataEntityIdsForInterface = {
        logicalEntityIds: ['lde_1'],
        physicalEntityIds: [],
      };

      expect(() => {
        const result = buildInterfaceCompositeNodes(
          'interface_1',
          ['endpoint_1'],
          selectedDataEntityIds,
          new Map(),
          metaModel,
          { x: 100, y: 100 },
          1,
          null
        );
        expect(result.interfaceNode).toBeDefined();
      }).not.toThrow();
    });

    it('should correctly use raw entity IDs as attribute map keys (not point IDs)', () => {
      const metaModel = createMinimalMetaModel();

      // Add attributes to the logical data entity
      metaModel.entities.logical_data_attributes = [
        { id: 'attr_1', name: 'id', logical_data_entity_id: 'lde_1', data_type: 'integer', description: '', tags: '' },
        { id: 'attr_2', name: 'name', logical_data_entity_id: 'lde_1', data_type: 'string', description: '', tags: '' },
      ];

      const selectedDataEntityIds: DataEntityIdsForInterface = {
        logicalEntityIds: ['lde_1'],
        physicalEntityIds: [],
      };

      // Attribute map uses raw entity IDs (lde_1), not point IDs (dep_log_lde_1)
      const selectedAttributeIdsByEntity = new Map<string, string[]>();
      selectedAttributeIdsByEntity.set('lde_1', ['attr_1']); // Only include 'id' attribute

      const result = buildInterfaceCompositeNodes(
        'interface_1',
        ['endpoint_1'],
        selectedDataEntityIds,
        selectedAttributeIdsByEntity,
        metaModel,
        { x: 100, y: 100 },
        1,
        null
      );

      // Should have created the entity node with specific attributes
      expect(result.entityNodes.length).toBe(1);
      expect(result.entityNodes[0].embedded_attribute_ids).toContain('attr_1');
      expect(result.entityNodes[0].embedded_attribute_ids).not.toContain('attr_2');
    });
  });
});
