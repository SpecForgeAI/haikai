/**
 * Tests for Interface Custom Layout Detection
 *
 * Task Group 3: Custom Layout Detection and Integration
 * Tests for isInterfaceCustomLayoutCandidate and findInterfaceCustomCandidates functions.
 */

import { describe, it, expect } from 'vitest';
import { ENTITY_TYPES, MetaModel, Endpoint, EndpointType, LogicalDataEntity } from '../types/model';
import { TreeNodeData } from '../types/advancedAdd';
import {
  isInterfaceCustomLayoutCandidate,
  findInterfaceCustomCandidates,
  InterfaceCustomCandidate,
} from '../utils/erdAdvancedAddUtils';

// Test factory for creating a minimal MetaModel with interfaces and endpoints
function createTestMetaModel(
  interfaces: { id: string; name: string }[] = [],
  endpoints: Endpoint[] = [],
  logicalEntities: LogicalDataEntity[] = []
): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [],
      app_components: [],
      services: [],
      interfaces: interfaces.map(i => ({
        id: i.id,
        name: i.name,
        description: '',
        tags: '',
        interface_type: 'REST_API' as const,
      })),
      endpoints: endpoints,
      application_points: [],
      logical_data_entities: logicalEntities,
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
    },
  };
}

// Test factory for creating TreeNodeData
function createTestTreeNode(
  entityType: string,
  entityId: string,
  children: TreeNodeData[] = []
): TreeNodeData {
  return {
    key: `${entityType}:${entityId}`,
    entityType,
    entityId,
    children,
    label: entityId,
  };
}

// Helper to create an Endpoint
function createTestEndpoint(id: string, interfaceId: string, name: string): Endpoint {
  return {
    id,
    name,
    description: '',
    interface_id: interfaceId,
    endpoint_type: EndpointType.HTTP_REST,
    path_or_address: '/api/test',
    operation_verb: 'GET',
    tags: '',
  };
}

describe('Interface Custom Layout Detection - Task Group 3', () => {
  // Test 3.1a: isInterfaceCustomLayoutCandidate returns true for Interface + Endpoints selection
  describe('isInterfaceCustomLayoutCandidate with Endpoints', () => {
    it('should return true for Interface with selected Endpoint children', () => {
      const metaModel = createTestMetaModel(
        [{ id: 'if-1', name: 'Customer API' }],
        [
          createTestEndpoint('ep-1', 'if-1', 'Get Customer'),
          createTestEndpoint('ep-2', 'if-1', 'Create Customer'),
        ]
      );

      const interfaceNode = createTestTreeNode(ENTITY_TYPES.INTERFACE, 'if-1', [
        createTestTreeNode(ENTITY_TYPES.ENDPOINT, 'ep-1'),
        createTestTreeNode(ENTITY_TYPES.ENDPOINT, 'ep-2'),
      ]);

      const selectedKeys = new Set([
        interfaceNode.key,
        interfaceNode.children[0].key,
        interfaceNode.children[1].key,
      ]);

      const result = isInterfaceCustomLayoutCandidate(interfaceNode, selectedKeys, metaModel);

      expect(result).toBe(true);
    });

    it('should return true for Interface with only some Endpoints selected', () => {
      const metaModel = createTestMetaModel(
        [{ id: 'if-1', name: 'Customer API' }],
        [
          createTestEndpoint('ep-1', 'if-1', 'Get Customer'),
          createTestEndpoint('ep-2', 'if-1', 'Create Customer'),
        ]
      );

      const interfaceNode = createTestTreeNode(ENTITY_TYPES.INTERFACE, 'if-1', [
        createTestTreeNode(ENTITY_TYPES.ENDPOINT, 'ep-1'),
        createTestTreeNode(ENTITY_TYPES.ENDPOINT, 'ep-2'),
      ]);

      // Only select interface and one endpoint
      const selectedKeys = new Set([
        interfaceNode.key,
        interfaceNode.children[0].key,
      ]);

      const result = isInterfaceCustomLayoutCandidate(interfaceNode, selectedKeys, metaModel);

      expect(result).toBe(true);
    });
  });

  // Test 3.1b: isInterfaceCustomLayoutCandidate returns true for Interface + Logical Entities selection
  describe('isInterfaceCustomLayoutCandidate with Logical Entities', () => {
    it('should return true for Interface with selected Logical Entity children', () => {
      const metaModel = createTestMetaModel(
        [{ id: 'if-1', name: 'Customer API' }],
        [],
        [
          { id: 'lde-1', name: 'Customer', description: '', tags: '' },
          { id: 'lde-2', name: 'Order', description: '', tags: '' },
        ]
      );

      const interfaceNode = createTestTreeNode(ENTITY_TYPES.INTERFACE, 'if-1', [
        createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1'),
        createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-2'),
      ]);

      const selectedKeys = new Set([
        interfaceNode.key,
        interfaceNode.children[0].key,
        interfaceNode.children[1].key,
      ]);

      const result = isInterfaceCustomLayoutCandidate(interfaceNode, selectedKeys, metaModel);

      expect(result).toBe(true);
    });

    it('should return true for Interface with both Endpoints and Logical Entities selected', () => {
      const metaModel = createTestMetaModel(
        [{ id: 'if-1', name: 'Customer API' }],
        [createTestEndpoint('ep-1', 'if-1', 'Get Customer')],
        [{ id: 'lde-1', name: 'Customer', description: '', tags: '' }]
      );

      const interfaceNode = createTestTreeNode(ENTITY_TYPES.INTERFACE, 'if-1', [
        createTestTreeNode(ENTITY_TYPES.ENDPOINT, 'ep-1'),
        createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1'),
      ]);

      const selectedKeys = new Set([
        interfaceNode.key,
        interfaceNode.children[0].key,
        interfaceNode.children[1].key,
      ]);

      const result = isInterfaceCustomLayoutCandidate(interfaceNode, selectedKeys, metaModel);

      expect(result).toBe(true);
    });
  });

  // Test 3.1c: isInterfaceCustomLayoutCandidate returns false for Interface only (no children)
  describe('isInterfaceCustomLayoutCandidate without children', () => {
    it('should return false for Interface without selected children', () => {
      const metaModel = createTestMetaModel(
        [{ id: 'if-1', name: 'Customer API' }],
        [createTestEndpoint('ep-1', 'if-1', 'Get Customer')]
      );

      const interfaceNode = createTestTreeNode(ENTITY_TYPES.INTERFACE, 'if-1', [
        createTestTreeNode(ENTITY_TYPES.ENDPOINT, 'ep-1'),
      ]);

      // Only select the interface, not its children
      const selectedKeys = new Set([interfaceNode.key]);

      const result = isInterfaceCustomLayoutCandidate(interfaceNode, selectedKeys, metaModel);

      expect(result).toBe(false);
    });

    it('should return false for Interface without any children', () => {
      const metaModel = createTestMetaModel([{ id: 'if-1', name: 'Empty API' }]);

      const interfaceNode = createTestTreeNode(ENTITY_TYPES.INTERFACE, 'if-1', []);

      const selectedKeys = new Set([interfaceNode.key]);

      const result = isInterfaceCustomLayoutCandidate(interfaceNode, selectedKeys, metaModel);

      expect(result).toBe(false);
    });

    it('should return false for non-Interface entity types', () => {
      const metaModel = createTestMetaModel();

      const serviceNode = createTestTreeNode(ENTITY_TYPES.SERVICE, 'svc-1', [
        createTestTreeNode(ENTITY_TYPES.INTERFACE, 'if-1'),
      ]);

      const selectedKeys = new Set([
        serviceNode.key,
        serviceNode.children[0].key,
      ]);

      const result = isInterfaceCustomLayoutCandidate(serviceNode, selectedKeys, metaModel);

      expect(result).toBe(false);
    });
  });

  // Test 3.1d: Detection works for Interface nested in full hierarchy
  describe('findInterfaceCustomCandidates in hierarchy', () => {
    it('should detect Interface custom candidate in App > Component > Service > Interface hierarchy', () => {
      const metaModel = createTestMetaModel(
        [{ id: 'if-1', name: 'Customer API' }],
        [createTestEndpoint('ep-1', 'if-1', 'Get Customer')]
      );

      const interfaceNode = createTestTreeNode(ENTITY_TYPES.INTERFACE, 'if-1', [
        createTestTreeNode(ENTITY_TYPES.ENDPOINT, 'ep-1'),
      ]);

      const serviceNode = createTestTreeNode(ENTITY_TYPES.SERVICE, 'svc-1', [interfaceNode]);
      const componentNode = createTestTreeNode(ENTITY_TYPES.APP_COMPONENT, 'comp-1', [serviceNode]);
      const appNode = createTestTreeNode(ENTITY_TYPES.APPLICATION, 'app-1', [componentNode]);

      const selectedKeys = new Set([
        appNode.key,
        componentNode.key,
        serviceNode.key,
        interfaceNode.key,
        interfaceNode.children[0].key,
      ]);

      const candidates = findInterfaceCustomCandidates([appNode], selectedKeys, metaModel);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].interface.entityId).toBe('if-1');
      expect(candidates[0].endpoints).toHaveLength(1);
    });

    it('should detect multiple Interface custom candidates in hierarchy', () => {
      const metaModel = createTestMetaModel(
        [
          { id: 'if-1', name: 'Customer API' },
          { id: 'if-2', name: 'Order API' },
        ],
        [
          createTestEndpoint('ep-1', 'if-1', 'Get Customer'),
          createTestEndpoint('ep-2', 'if-2', 'Get Order'),
        ]
      );

      const interface1Node = createTestTreeNode(ENTITY_TYPES.INTERFACE, 'if-1', [
        createTestTreeNode(ENTITY_TYPES.ENDPOINT, 'ep-1'),
      ]);
      const interface2Node = createTestTreeNode(ENTITY_TYPES.INTERFACE, 'if-2', [
        createTestTreeNode(ENTITY_TYPES.ENDPOINT, 'ep-2'),
      ]);

      const serviceNode = createTestTreeNode(ENTITY_TYPES.SERVICE, 'svc-1', [interface1Node, interface2Node]);

      const selectedKeys = new Set([
        serviceNode.key,
        interface1Node.key,
        interface1Node.children[0].key,
        interface2Node.key,
        interface2Node.children[0].key,
      ]);

      const candidates = findInterfaceCustomCandidates([serviceNode], selectedKeys, metaModel);

      expect(candidates).toHaveLength(2);
    });

    it('should not detect Interface without selected endpoints or entities', () => {
      const metaModel = createTestMetaModel(
        [{ id: 'if-1', name: 'Customer API' }],
        [createTestEndpoint('ep-1', 'if-1', 'Get Customer')]
      );

      const interfaceNode = createTestTreeNode(ENTITY_TYPES.INTERFACE, 'if-1', [
        createTestTreeNode(ENTITY_TYPES.ENDPOINT, 'ep-1'),
      ]);

      const serviceNode = createTestTreeNode(ENTITY_TYPES.SERVICE, 'svc-1', [interfaceNode]);

      // Select service and interface, but NOT the endpoint
      const selectedKeys = new Set([
        serviceNode.key,
        interfaceNode.key,
      ]);

      const candidates = findInterfaceCustomCandidates([serviceNode], selectedKeys, metaModel);

      expect(candidates).toHaveLength(0);
    });
  });

  // Test: InterfaceCustomCandidate structure
  describe('InterfaceCustomCandidate structure', () => {
    it('should have correct structure for Interface custom candidate', () => {
      const metaModel = createTestMetaModel(
        [{ id: 'if-1', name: 'Customer API' }],
        [createTestEndpoint('ep-1', 'if-1', 'Get Customer')],
        [{ id: 'lde-1', name: 'Customer', description: '', tags: '' }]
      );

      const interfaceNode = createTestTreeNode(ENTITY_TYPES.INTERFACE, 'if-1', [
        createTestTreeNode(ENTITY_TYPES.ENDPOINT, 'ep-1'),
        createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1'),
      ]);

      const selectedKeys = new Set([
        interfaceNode.key,
        interfaceNode.children[0].key,
        interfaceNode.children[1].key,
      ]);

      const candidates = findInterfaceCustomCandidates([interfaceNode], selectedKeys, metaModel);
      const candidate = candidates[0];

      // Verify structure
      expect(candidate).toHaveProperty('interface');
      expect(candidate).toHaveProperty('endpoints');
      expect(candidate).toHaveProperty('logicalEntities');
      expect(candidate.interface.entityType).toBe(ENTITY_TYPES.INTERFACE);
      expect(candidate.endpoints).toHaveLength(1);
      expect(candidate.logicalEntities).toHaveLength(1);
    });
  });
});
