/**
 * Task Group 4 Tests: Case A Enablement Logic
 *
 * Tests for verifying Case A User Interaction palette row enablement.
 * Case A: Interaction has both primary AND secondary app_business_point_id.
 * Row should be enabled when both P and S nodes are on diagram (User node NOT required).
 *
 * Created as part of spec: 2025-12-09-fix-interactions-placement-and-enable-rules
 */

import {
  isUserInteractionRowEnabled,
  isUserInteractionCase,
  getAppBusinessPointNodeId,
  getInteractionEdgesOnDiagram,
} from '../utils/userInteractionUtils';
import { findNodeForEntity } from '../utils/relationshipUtils';
import { ENTITY_TYPES, RELATIONSHIP_EDGE_TYPES, type DiagramNode, type DiagramEdge } from '../types/model';
import type { Interaction, MetaModel, AppBusinessPoint, Diagram } from '../types/model';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockApplication(id: string, name: string) {
  return { id, name, description: '', app_type: 'Web', status: 'Active', tags: '' };
}

function createMockService(id: string, name: string, appId: string) {
  return { id, name, description: '', application_id: appId, tags: '' };
}

function createMockABP(entityId: string, kind: string): AppBusinessPoint {
  return {
    id: `abp_${entityId}`,
    name: `ABP for ${entityId}`,
    kind: kind as AppBusinessPoint['kind'],
    source_entity_id: entityId,
  };
}

function createMockNode(entityType: string, entityId: string, nodeId?: string): DiagramNode {
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

function createMockInteraction(
  id: string,
  userId: string,
  primaryABPId: string,
  secondaryABPId?: string
): Interaction {
  return {
    id,
    name: `Interaction ${id}`,
    description: '',
    user_id: userId,
    primary_app_business_point_id: primaryABPId,
    secondary_app_business_point_id: secondaryABPId,
  };
}

function createMockMetaModel(
  apps: ReturnType<typeof createMockApplication>[],
  services: ReturnType<typeof createMockService>[],
  abps: AppBusinessPoint[],
  interactions: Interaction[]
): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      interactions,
      applications: apps,
      app_components: [],
      services,
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

function createMockDiagram(nodes: DiagramNode[], edges: DiagramEdge[] = []): Diagram {
  return {
    id: 'diagram_1',
    name: 'Test Diagram',
    view_quarter: '2025Q1',
    diagram_nodes: nodes,
    diagram_edges: edges,
  };
}

// ============================================================================
// Task 4.1.1: Case A identification
// ============================================================================

describe('Task Group 4: Case A Enablement Logic', () => {
  describe('4.1.1 Case identification', () => {
    it('should identify Case A when both primary and secondary ABP IDs exist', () => {
      const interactionCaseA = createMockInteraction(
        'int_1',
        'user_1',
        'abp_app_001',
        'abp_svc_001' // Secondary exists
      );

      const interactionCase = isUserInteractionCase(interactionCaseA);
      expect(interactionCase).toBe('A');
    });

    it('should identify Case B when only primary ABP ID exists', () => {
      const interactionCaseB = createMockInteraction(
        'int_2',
        'user_1',
        'abp_app_001'
        // No secondary
      );

      const interactionCase = isUserInteractionCase(interactionCaseB);
      expect(interactionCase).toBe('B');
    });
  });

  // ============================================================================
  // Task 4.1.2: Case A enablement - P and S on diagram, User NOT required
  // ============================================================================

  describe('4.1.2 Case A enabled: P and S nodes on diagram, User NOT required', () => {
    it('should enable Case A when P and S nodes on diagram (no User node)', () => {
      // Setup: Application (P) and Service (S) on diagram, NO User
      const app = createMockApplication('app_001', 'Primary App');
      const svc = createMockService('svc_001', 'Secondary Service', 'app_001');

      const abpP = createMockABP('app_001', 'APPLICATION');
      const abpS = createMockABP('svc_001', 'SERVICE');

      const interaction = createMockInteraction('int_1', 'user_1', abpP.id, abpS.id);

      // Nodes on diagram: P and S only, NO User
      const nodeP = createMockNode(ENTITY_TYPES.APPLICATION, 'app_001');
      const nodeS = createMockNode(ENTITY_TYPES.SERVICE, 'svc_001');

      const metaModel = createMockMetaModel([app], [svc], [abpP, abpS], [interaction]);
      const diagram = createMockDiagram([nodeP, nodeS]);

      const isEnabled = isUserInteractionRowEnabled(interaction, diagram, metaModel);

      // Case A should be ENABLED even without User node
      expect(isEnabled).toBe(true);
    });

    it('should enable Case A when P, S, AND User nodes all on diagram', () => {
      // Setup: All three nodes on diagram
      const app = createMockApplication('app_001', 'Primary App');
      const svc = createMockService('svc_001', 'Secondary Service', 'app_001');

      const abpP = createMockABP('app_001', 'APPLICATION');
      const abpS = createMockABP('svc_001', 'SERVICE');

      const interaction = createMockInteraction('int_1', 'user_1', abpP.id, abpS.id);

      // All nodes on diagram: P, S, AND User
      const nodeP = createMockNode(ENTITY_TYPES.APPLICATION, 'app_001');
      const nodeS = createMockNode(ENTITY_TYPES.SERVICE, 'svc_001');
      const nodeU = createMockNode(ENTITY_TYPES.BUSINESS_USER, 'user_1');

      const metaModel = createMockMetaModel([app], [svc], [abpP, abpS], [interaction]);
      const diagram = createMockDiagram([nodeP, nodeS, nodeU]);

      const isEnabled = isUserInteractionRowEnabled(interaction, diagram, metaModel);

      // Case A should still be enabled with User node present (optional)
      expect(isEnabled).toBe(true);
    });
  });

  // ============================================================================
  // Task 4.1.3: Case A disabled when P missing
  // ============================================================================

  describe('4.1.3 Case A disabled: P on diagram but S missing', () => {
    it('should disable Case A when only P node is on diagram (S missing)', () => {
      const app = createMockApplication('app_001', 'Primary App');
      const svc = createMockService('svc_001', 'Secondary Service', 'app_001');

      const abpP = createMockABP('app_001', 'APPLICATION');
      const abpS = createMockABP('svc_001', 'SERVICE');

      const interaction = createMockInteraction('int_1', 'user_1', abpP.id, abpS.id);

      // Only P on diagram, S is missing
      const nodeP = createMockNode(ENTITY_TYPES.APPLICATION, 'app_001');

      const metaModel = createMockMetaModel([app], [svc], [abpP, abpS], [interaction]);
      const diagram = createMockDiagram([nodeP]); // Only P

      const isEnabled = isUserInteractionRowEnabled(interaction, diagram, metaModel);

      // Should be DISABLED - S missing
      expect(isEnabled).toBe(false);
    });
  });

  // ============================================================================
  // Task 4.1.4: Case A disabled when S missing
  // ============================================================================

  describe('4.1.4 Case A disabled: S on diagram but P missing', () => {
    it('should disable Case A when only S node is on diagram (P missing)', () => {
      const app = createMockApplication('app_001', 'Primary App');
      const svc = createMockService('svc_001', 'Secondary Service', 'app_001');

      const abpP = createMockABP('app_001', 'APPLICATION');
      const abpS = createMockABP('svc_001', 'SERVICE');

      const interaction = createMockInteraction('int_1', 'user_1', abpP.id, abpS.id);

      // Only S on diagram, P is missing
      const nodeS = createMockNode(ENTITY_TYPES.SERVICE, 'svc_001');

      const metaModel = createMockMetaModel([app], [svc], [abpP, abpS], [interaction]);
      const diagram = createMockDiagram([nodeS]); // Only S

      const isEnabled = isUserInteractionRowEnabled(interaction, diagram, metaModel);

      // Should be DISABLED - P missing
      expect(isEnabled).toBe(false);
    });
  });

  // ============================================================================
  // Task 4.1.5: Case A disabled when MAIN edge exists
  // ============================================================================

  describe('4.1.5 Case A disabled: P and S on diagram but MAIN edge exists', () => {
    it('should disable Case A when MAIN edge already exists', () => {
      const app = createMockApplication('app_001', 'Primary App');
      const svc = createMockService('svc_001', 'Secondary Service', 'app_001');

      const abpP = createMockABP('app_001', 'APPLICATION');
      const abpS = createMockABP('svc_001', 'SERVICE');

      const interaction = createMockInteraction('int_1', 'user_1', abpP.id, abpS.id);

      const nodeP = createMockNode(ENTITY_TYPES.APPLICATION, 'app_001');
      const nodeS = createMockNode(ENTITY_TYPES.SERVICE, 'svc_001');

      // Existing MAIN edge for this interaction
      const mainEdge: DiagramEdge = {
        id: 'edge_1',
        relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
        relationship_id: 'int_1', // Same interaction
        subType: 'MAIN',
        source_node_id: nodeP.id,
        target_node_id: nodeS.id,
        line_type: 'straight',
        line_dashes: '4,4',
        edge_points: [],
      };

      const metaModel = createMockMetaModel([app], [svc], [abpP, abpS], [interaction]);
      const diagram = createMockDiagram([nodeP, nodeS], [mainEdge]);

      const isEnabled = isUserInteractionRowEnabled(interaction, diagram, metaModel);

      // Should be DISABLED - edge already exists
      expect(isEnabled).toBe(false);
    });
  });

  // ============================================================================
  // Task 4.1.6: getAppBusinessPointNodeId returns node ID correctly
  // ============================================================================

  describe('4.1.6 getAppBusinessPointNodeId resolution', () => {
    it('should return node ID when ABP exists and node is on diagram', () => {
      const abp = createMockABP('app_001', 'APPLICATION');
      const node = createMockNode(ENTITY_TYPES.APPLICATION, 'app_001', 'node_app_001');

      const metaModel = createMockMetaModel(
        [createMockApplication('app_001', 'Test App')],
        [],
        [abp],
        []
      );

      const nodeId = getAppBusinessPointNodeId(abp.id, [node], metaModel);

      expect(nodeId).toBe('node_app_001');
    });

    it('should return null when ABP exists but node is NOT on diagram', () => {
      const abp = createMockABP('app_001', 'APPLICATION');
      // Node NOT on diagram

      const metaModel = createMockMetaModel(
        [createMockApplication('app_001', 'Test App')],
        [],
        [abp],
        []
      );

      const nodeId = getAppBusinessPointNodeId(abp.id, [], metaModel);

      expect(nodeId).toBeNull();
    });

    it('should return null when ABP does NOT exist in meta-model', () => {
      const node = createMockNode(ENTITY_TYPES.APPLICATION, 'app_001');

      const metaModel = createMockMetaModel(
        [createMockApplication('app_001', 'Test App')],
        [],
        [], // No ABPs
        []
      );

      const nodeId = getAppBusinessPointNodeId('abp_app_001', [node], metaModel);

      expect(nodeId).toBeNull();
    });

    it('should correctly resolve ABP kind to entity type', () => {
      // Test different ABP kinds
      const testCases = [
        { kind: 'APPLICATION', entityType: ENTITY_TYPES.APPLICATION },
        { kind: 'APP_COMPONENT', entityType: ENTITY_TYPES.APP_COMPONENT },
        { kind: 'SERVICE', entityType: ENTITY_TYPES.SERVICE },
        { kind: 'INTERFACE', entityType: ENTITY_TYPES.INTERFACE },
        { kind: 'BUSINESS_PROCESS', entityType: ENTITY_TYPES.BUSINESS_PROCESS },
        { kind: 'PROCESS_ACTIVITY', entityType: ENTITY_TYPES.PROCESS_ACTIVITY },
      ];

      for (const { kind, entityType } of testCases) {
        const abp = createMockABP('entity_001', kind);
        const node = createMockNode(entityType, 'entity_001', `node_${kind.toLowerCase()}`);

        const metaModel = createMockMetaModel([], [], [abp], []);

        const nodeId = getAppBusinessPointNodeId(abp.id, [node], metaModel);

        expect(nodeId).toBe(`node_${kind.toLowerCase()}`);
      }
    });
  });

  // ============================================================================
  // Task 4.1.7: getInteractionEdgesOnDiagram helper
  // ============================================================================

  describe('4.1.7 getInteractionEdgesOnDiagram helper', () => {
    it('should find all edges for an interaction', () => {
      const mainEdge: DiagramEdge = {
        id: 'edge_main',
        relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
        relationship_id: 'int_1',
        subType: 'MAIN',
        source_node_id: 'node_1',
        target_node_id: 'node_2',
        line_type: 'straight',
        line_dashes: '4,4',
        edge_points: [],
      };

      const userLinkEdge: DiagramEdge = {
        id: 'edge_userlink',
        relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
        relationship_id: 'int_1',
        subType: 'USER_LINK',
        source_node_id: 'node_user',
        target_node_id: 'virtual_midpoint',
        line_type: 'straight',
        line_dashes: '4,4',
        edge_points: [],
      };

      const otherEdge: DiagramEdge = {
        id: 'edge_other',
        relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
        relationship_id: 'int_2', // Different interaction
        subType: 'MAIN',
        source_node_id: 'node_3',
        target_node_id: 'node_4',
        line_type: 'straight',
        line_dashes: '4,4',
        edge_points: [],
      };

      const edges = [mainEdge, userLinkEdge, otherEdge];

      const result = getInteractionEdgesOnDiagram('int_1', edges);

      expect(result).toHaveLength(2);
      expect(result).toContain(mainEdge);
      expect(result).toContain(userLinkEdge);
      expect(result).not.toContain(otherEdge);
    });

    it('should return empty array when no edges for interaction', () => {
      const otherEdge: DiagramEdge = {
        id: 'edge_other',
        relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
        relationship_id: 'int_2',
        subType: 'MAIN',
        source_node_id: 'node_1',
        target_node_id: 'node_2',
        line_type: 'straight',
        line_dashes: '4,4',
        edge_points: [],
      };

      const result = getInteractionEdgesOnDiagram('int_1', [otherEdge]);

      expect(result).toHaveLength(0);
    });
  });

  // ============================================================================
  // Task 4.1.8: findNodeForEntity helper
  // ============================================================================

  describe('4.1.8 findNodeForEntity helper', () => {
    it('should find node matching entity_type and entity_id', () => {
      const nodes: DiagramNode[] = [
        createMockNode(ENTITY_TYPES.APPLICATION, 'app_001', 'node_app'),
        createMockNode(ENTITY_TYPES.SERVICE, 'svc_001', 'node_svc'),
        createMockNode(ENTITY_TYPES.BUSINESS_USER, 'user_001', 'node_user'),
      ];

      const found = findNodeForEntity(nodes, ENTITY_TYPES.SERVICE, 'svc_001');

      expect(found).toBeDefined();
      expect(found?.id).toBe('node_svc');
      expect(found?.entity_id).toBe('svc_001');
    });

    it('should return undefined when no matching node', () => {
      const nodes: DiagramNode[] = [
        createMockNode(ENTITY_TYPES.APPLICATION, 'app_001', 'node_app'),
      ];

      const found = findNodeForEntity(nodes, ENTITY_TYPES.SERVICE, 'svc_001');

      expect(found).toBeUndefined();
    });
  });

  // ============================================================================
  // Regression test: Case B should still work
  // ============================================================================

  describe('Regression: Case B should still work', () => {
    it('should enable Case B when P and U nodes on diagram', () => {
      const app = createMockApplication('app_001', 'Primary App');
      const abpP = createMockABP('app_001', 'APPLICATION');

      // Case B: Only primary ABP (no secondary)
      const interaction = createMockInteraction('int_1', 'user_1', abpP.id);

      const nodeP = createMockNode(ENTITY_TYPES.APPLICATION, 'app_001');
      const nodeU = createMockNode(ENTITY_TYPES.BUSINESS_USER, 'user_1');

      const metaModel = createMockMetaModel([app], [], [abpP], [interaction]);
      const diagram = createMockDiagram([nodeP, nodeU]);

      const isEnabled = isUserInteractionRowEnabled(interaction, diagram, metaModel);

      expect(isEnabled).toBe(true);
    });

    it('should disable Case B when U node is missing', () => {
      const app = createMockApplication('app_001', 'Primary App');
      const abpP = createMockABP('app_001', 'APPLICATION');

      const interaction = createMockInteraction('int_1', 'user_1', abpP.id);

      // Only P on diagram, no User
      const nodeP = createMockNode(ENTITY_TYPES.APPLICATION, 'app_001');

      const metaModel = createMockMetaModel([app], [], [abpP], [interaction]);
      const diagram = createMockDiagram([nodeP]);

      const isEnabled = isUserInteractionRowEnabled(interaction, diagram, metaModel);

      // Case B requires User node -> disabled
      expect(isEnabled).toBe(false);
    });
  });
});
