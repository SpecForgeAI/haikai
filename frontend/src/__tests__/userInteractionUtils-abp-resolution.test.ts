/**
 * Task Group 2 Tests: ABP to Concrete Node Resolution
 *
 * Tests for getAppBusinessPointNodeId function that resolves AppBusinessPoint IDs
 * to their underlying concrete entity nodes on the diagram.
 *
 * Created as part of spec: 2025-12-09-fix-interactions-double-rendering-and-abp-mapping
 */

import { getAppBusinessPointNodeId } from '../utils/userInteractionUtils';
import { findNodeForEntity } from '../utils/relationshipUtils';
import { ENTITY_TYPES, type DiagramNode, type MetaModel, type AppBusinessPoint } from '../types/model';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockABP(
  sourceEntityId: string,
  kind: AppBusinessPoint['kind'],
  name?: string
): AppBusinessPoint {
  return {
    id: `abp_${sourceEntityId}`,
    name: name || `ABP for ${sourceEntityId}`,
    kind,
    source_entity_id: sourceEntityId,
  };
}

function createMockNode(
  entityType: string,
  entityId: string,
  nodeId?: string
): DiagramNode {
  return {
    id: nodeId || `node_${entityId}`,
    entity_type: entityType,
    entity_id: entityId,
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    label: entityId,
    children: [],
  };
}

function createMockMetaModel(abps: AppBusinessPoint[]): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      interactions: [],
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      application_points: [],
      business_points: [],
      app_business_points: abps,
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

// ============================================================================
// Tests
// ============================================================================

describe('Task Group 2: ABP to Concrete Node Resolution', () => {
  describe('2.1.1 getAppBusinessPointNodeId for APPLICATION kind', () => {
    it('should return node ID when ABP kind is APPLICATION and node exists', () => {
      const abp = createMockABP('app_001', 'APPLICATION', 'My App');
      const node = createMockNode(ENTITY_TYPES.APPLICATION, 'app_001', 'node_app_001');
      const metaModel = createMockMetaModel([abp]);

      const result = getAppBusinessPointNodeId(abp.id, [node], metaModel);

      expect(result).toBe('node_app_001');
    });

    it('should return null when ABP kind is APPLICATION but node does not exist', () => {
      const abp = createMockABP('app_001', 'APPLICATION', 'My App');
      const metaModel = createMockMetaModel([abp]);

      const result = getAppBusinessPointNodeId(abp.id, [], metaModel);

      expect(result).toBeNull();
    });
  });

  describe('2.1.2 getAppBusinessPointNodeId for APP_COMPONENT kind', () => {
    it('should return node ID when ABP kind is APP_COMPONENT and node exists', () => {
      const abp = createMockABP('comp_001', 'APP_COMPONENT', 'My Component');
      const node = createMockNode(ENTITY_TYPES.APP_COMPONENT, 'comp_001', 'node_comp_001');
      const metaModel = createMockMetaModel([abp]);

      const result = getAppBusinessPointNodeId(abp.id, [node], metaModel);

      expect(result).toBe('node_comp_001');
    });
  });

  describe('2.1.3 getAppBusinessPointNodeId for SERVICE kind', () => {
    it('should return node ID when ABP kind is SERVICE and node exists', () => {
      const abp = createMockABP('svc_001', 'SERVICE', 'My Service');
      const node = createMockNode(ENTITY_TYPES.SERVICE, 'svc_001', 'node_svc_001');
      const metaModel = createMockMetaModel([abp]);

      const result = getAppBusinessPointNodeId(abp.id, [node], metaModel);

      expect(result).toBe('node_svc_001');
    });
  });

  describe('2.1.4 getAppBusinessPointNodeId for BUSINESS_PROCESS kind', () => {
    it('should return node ID when ABP kind is BUSINESS_PROCESS and node exists', () => {
      const abp = createMockABP('proc_001', 'BUSINESS_PROCESS', 'My Process');
      const node = createMockNode(ENTITY_TYPES.BUSINESS_PROCESS, 'proc_001', 'node_proc_001');
      const metaModel = createMockMetaModel([abp]);

      const result = getAppBusinessPointNodeId(abp.id, [node], metaModel);

      expect(result).toBe('node_proc_001');
    });
  });

  describe('2.1.5 getAppBusinessPointNodeId for PROCESS_ACTIVITY kind', () => {
    it('should return node ID when ABP kind is PROCESS_ACTIVITY and node exists', () => {
      const abp = createMockABP('act_001', 'PROCESS_ACTIVITY', 'My Activity');
      const node = createMockNode(ENTITY_TYPES.PROCESS_ACTIVITY, 'act_001', 'node_act_001');
      const metaModel = createMockMetaModel([abp]);

      const result = getAppBusinessPointNodeId(abp.id, [node], metaModel);

      expect(result).toBe('node_act_001');
    });
  });

  describe('2.1.6 getAppBusinessPointNodeId for INTERFACE kind', () => {
    it('should return node ID when ABP kind is INTERFACE and node exists', () => {
      const abp = createMockABP('iface_001', 'INTERFACE', 'My Interface');
      const node = createMockNode(ENTITY_TYPES.INTERFACE, 'iface_001', 'node_iface_001');
      const metaModel = createMockMetaModel([abp]);

      const result = getAppBusinessPointNodeId(abp.id, [node], metaModel);

      expect(result).toBe('node_iface_001');
    });
  });

  describe('2.1.7 Error cases', () => {
    it('should return null when ABP not found in metaModel', () => {
      const metaModel = createMockMetaModel([]);
      const node = createMockNode(ENTITY_TYPES.APPLICATION, 'app_001');

      const result = getAppBusinessPointNodeId('abp_nonexistent', [node], metaModel);

      expect(result).toBeNull();
    });

    it('should return null when app_business_points array is undefined', () => {
      const metaModel = {
        entities: {
          business_users: [],
          business_processes: [],
          process_activities: [],
          interactions: [],
          applications: [],
          app_components: [],
          services: [],
          interfaces: [],
          endpoints: [],
          logical_data_entities: [],
          logical_data_attributes: [],
          physical_data_entities: [],
          physical_data_attributes: [],
          application_points: [],
          business_points: [],
          // app_business_points intentionally missing
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
      } as MetaModel;

      const node = createMockNode(ENTITY_TYPES.APPLICATION, 'app_001');

      const result = getAppBusinessPointNodeId('abp_app_001', [node], metaModel);

      expect(result).toBeNull();
    });

    it('should return null when node entity_id does not match ABP source_entity_id', () => {
      const abp = createMockABP('app_001', 'APPLICATION', 'My App');
      // Node has different entity_id
      const node = createMockNode(ENTITY_TYPES.APPLICATION, 'app_002', 'node_different');
      const metaModel = createMockMetaModel([abp]);

      const result = getAppBusinessPointNodeId(abp.id, [node], metaModel);

      expect(result).toBeNull();
    });

    it('should return null when node entity_type does not match ABP kind', () => {
      const abp = createMockABP('app_001', 'APPLICATION', 'My App');
      // Node has different entity_type (SERVICE instead of APPLICATION)
      const node = createMockNode(ENTITY_TYPES.SERVICE, 'app_001', 'node_wrong_type');
      const metaModel = createMockMetaModel([abp]);

      const result = getAppBusinessPointNodeId(abp.id, [node], metaModel);

      expect(result).toBeNull();
    });
  });

  describe('2.2 kindToEntityType mapping verification', () => {
    it('should map all 6 ABP kinds to correct ENTITY_TYPES', () => {
      // This test verifies the kindToEntityType map inside getAppBusinessPointNodeId
      const testCases = [
        { kind: 'APPLICATION' as const, expectedEntityType: ENTITY_TYPES.APPLICATION },
        { kind: 'APP_COMPONENT' as const, expectedEntityType: ENTITY_TYPES.APP_COMPONENT },
        { kind: 'SERVICE' as const, expectedEntityType: ENTITY_TYPES.SERVICE },
        { kind: 'INTERFACE' as const, expectedEntityType: ENTITY_TYPES.INTERFACE },
        { kind: 'BUSINESS_PROCESS' as const, expectedEntityType: ENTITY_TYPES.BUSINESS_PROCESS },
        { kind: 'PROCESS_ACTIVITY' as const, expectedEntityType: ENTITY_TYPES.PROCESS_ACTIVITY },
      ];

      for (const { kind, expectedEntityType } of testCases) {
        const abp = createMockABP(`${kind.toLowerCase()}_001`, kind, `Test ${kind}`);
        const node = createMockNode(expectedEntityType, `${kind.toLowerCase()}_001`, `node_${kind.toLowerCase()}`);
        const metaModel = createMockMetaModel([abp]);

        const result = getAppBusinessPointNodeId(abp.id, [node], metaModel);

        expect(result).toBe(`node_${kind.toLowerCase()}`);
      }
    });
  });

  describe('2.3 findNodeForEntity verification', () => {
    it('should find node by entity_type and entity_id', () => {
      const nodes: DiagramNode[] = [
        createMockNode(ENTITY_TYPES.APPLICATION, 'app_001', 'node_1'),
        createMockNode(ENTITY_TYPES.SERVICE, 'svc_001', 'node_2'),
        createMockNode(ENTITY_TYPES.APPLICATION, 'app_002', 'node_3'),
      ];

      const result = findNodeForEntity(nodes, ENTITY_TYPES.APPLICATION, 'app_001');

      expect(result).toBeDefined();
      expect(result?.id).toBe('node_1');
    });

    it('should return undefined when no matching node', () => {
      const nodes: DiagramNode[] = [
        createMockNode(ENTITY_TYPES.APPLICATION, 'app_001', 'node_1'),
      ];

      const result = findNodeForEntity(nodes, ENTITY_TYPES.SERVICE, 'svc_001');

      expect(result).toBeUndefined();
    });

    it('should match on both entity_type AND entity_id', () => {
      const nodes: DiagramNode[] = [
        createMockNode(ENTITY_TYPES.APPLICATION, 'app_001', 'node_1'),
        createMockNode(ENTITY_TYPES.SERVICE, 'app_001', 'node_2'), // Same entity_id, different type
      ];

      // Should find APPLICATION, not SERVICE
      const result = findNodeForEntity(nodes, ENTITY_TYPES.APPLICATION, 'app_001');

      expect(result?.id).toBe('node_1');
      expect(result?.entity_type).toBe(ENTITY_TYPES.APPLICATION);
    });
  });

  describe('2.4 Real-world scenario: Two Applications on diagram', () => {
    it('should resolve both ABPs when both Application nodes exist', () => {
      // This mimics the exact scenario from the bug report:
      // - "My App" and "Your App" are on the diagram
      // - ABPs exist for both
      // - Interaction references both ABPs

      // Create ABPs for both apps
      const abpMyApp = createMockABP('app_my_app', 'APPLICATION', 'My App');
      const abpYourApp = createMockABP('app_your_app', 'APPLICATION', 'Your App');

      // Create nodes for both apps (as they appear on the diagram)
      const nodeMyApp = createMockNode(ENTITY_TYPES.APPLICATION, 'app_my_app', 'node_my_app');
      const nodeYourApp = createMockNode(ENTITY_TYPES.APPLICATION, 'app_your_app', 'node_your_app');

      const metaModel = createMockMetaModel([abpMyApp, abpYourApp]);
      const nodes = [nodeMyApp, nodeYourApp];

      // Resolve primary ABP (My App)
      const primaryNodeId = getAppBusinessPointNodeId(abpMyApp.id, nodes, metaModel);
      expect(primaryNodeId).toBe('node_my_app');

      // Resolve secondary ABP (Your App)
      const secondaryNodeId = getAppBusinessPointNodeId(abpYourApp.id, nodes, metaModel);
      expect(secondaryNodeId).toBe('node_your_app');

      // Both should be found
      expect(primaryNodeId).not.toBeNull();
      expect(secondaryNodeId).not.toBeNull();
    });

    it('should return null when one app is missing from diagram', () => {
      const abpMyApp = createMockABP('app_my_app', 'APPLICATION', 'My App');
      const abpYourApp = createMockABP('app_your_app', 'APPLICATION', 'Your App');

      // Only My App is on the diagram
      const nodeMyApp = createMockNode(ENTITY_TYPES.APPLICATION, 'app_my_app', 'node_my_app');

      const metaModel = createMockMetaModel([abpMyApp, abpYourApp]);
      const nodes = [nodeMyApp]; // Your App is NOT on diagram

      // Primary should be found
      const primaryNodeId = getAppBusinessPointNodeId(abpMyApp.id, nodes, metaModel);
      expect(primaryNodeId).toBe('node_my_app');

      // Secondary should NOT be found (not on diagram)
      const secondaryNodeId = getAppBusinessPointNodeId(abpYourApp.id, nodes, metaModel);
      expect(secondaryNodeId).toBeNull();
    });
  });
});
