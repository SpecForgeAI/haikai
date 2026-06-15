/**
 * User Interaction Palette Enablement Diagnostic Tests
 *
 * These tests diagnose the exact scenario described in the spec:
 * - Interaction "Interaction A" with User="My User", Primary="My App" ABP, Secondary="Your App" ABP
 * - Diagram has nodes for: Business User "My User", Application "My App", Application "Your App"
 * - Expected: Row should be ENABLED
 *
 * Created as part of spec: 2025-12-09-final-user-interaction-palette-fix
 */

import { describe, it, expect } from 'vitest';
import {
  isUserInteractionRowEnabled,
  isUserInteractionCase,
  getAppBusinessPointNodeId,
} from '../utils/userInteractionUtils';
import { findNodeForEntity } from '../utils/relationshipUtils';
import { ENTITY_TYPES, type DiagramNode, type Diagram } from '../types/model';
import type { Interaction, MetaModel, AppBusinessPoint, Application, BusinessUser } from '../types/model';

// ============================================================================
// Test Helpers - Exact scenario from spec
// ============================================================================

function createMyUserBusinessUser(): BusinessUser {
  return {
    id: 'user-my-user',
    name: 'My User',
    description: '',
    tags: '',
  };
}

function createMyAppApplication(): Application {
  return {
    id: 'app-my-app',
    name: 'My App',
    description: '',
    app_type: '',
    status: '',
    tags: '',
  };
}

function createYourAppApplication(): Application {
  return {
    id: 'app-your-app',
    name: 'Your App',
    description: '',
    app_type: '',
    status: '',
    tags: '',
  };
}

function createMyAppABP(): AppBusinessPoint {
  return {
    id: 'abp_app-my-app',
    name: 'My App',
    kind: 'APPLICATION',
    source_entity_id: 'app-my-app',
  };
}

function createYourAppABP(): AppBusinessPoint {
  return {
    id: 'abp_app-your-app',
    name: 'Your App',
    kind: 'APPLICATION',
    source_entity_id: 'app-your-app',
  };
}

function createInteractionA(): Interaction {
  return {
    id: 'int-interaction-a',
    name: 'Interaction A',
    description: '',
    tags: '',
    user_id: 'user-my-user',
    primary_app_business_point_id: 'abp_app-my-app',
    secondary_app_business_point_id: 'abp_app-your-app',
  };
}

function createUserNode(): DiagramNode {
  return {
    id: 'node-user-my-user',
    entity_type: ENTITY_TYPES.BUSINESS_USER,
    entity_id: 'user-my-user',
    pos_x: 100,
    pos_y: 100,
    width: 120,
    height: 60,
    z_index: 1,
    parent_node_id: null,
  };
}

function createMyAppNode(): DiagramNode {
  return {
    id: 'node-app-my-app',
    entity_type: ENTITY_TYPES.APPLICATION,
    entity_id: 'app-my-app',
    pos_x: 300,
    pos_y: 100,
    width: 150,
    height: 80,
    z_index: 1,
    parent_node_id: null,
  };
}

function createYourAppNode(): DiagramNode {
  return {
    id: 'node-app-your-app',
    entity_type: ENTITY_TYPES.APPLICATION,
    entity_id: 'app-your-app',
    pos_x: 500,
    pos_y: 100,
    width: 150,
    height: 80,
    z_index: 1,
    parent_node_id: null,
  };
}

function createMetaModel(
  users: BusinessUser[],
  apps: Application[],
  abps: AppBusinessPoint[],
  interactions: Interaction[]
): MetaModel {
  return {
    entities: {
      business_users: users,
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: apps,
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      application_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      interactions: interactions,
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

function createDiagram(nodes: DiagramNode[]): Diagram {
  return {
    id: 'diagram-1',
    name: 'Test Diagram',
    description: '',
    diagram_nodes: nodes,
    diagram_edges: [],
    view_quarter: '2024-Q4',
  };
}

// ============================================================================
// Diagnostic Test: Exact Scenario from Spec
// ============================================================================

describe('User Interaction Palette Enablement - Exact Spec Scenario', () => {
  describe('Scenario: Interaction A with My User, My App (P), Your App (S)', () => {
    // Setup the exact scenario from the spec
    const myUser = createMyUserBusinessUser();
    const myApp = createMyAppApplication();
    const yourApp = createYourAppApplication();
    const myAppABP = createMyAppABP();
    const yourAppABP = createYourAppABP();
    const interactionA = createInteractionA();

    const userNode = createUserNode();
    const myAppNode = createMyAppNode();
    const yourAppNode = createYourAppNode();

    const metaModel = createMetaModel(
      [myUser],
      [myApp, yourApp],
      [myAppABP, yourAppABP],
      [interactionA]
    );

    const diagram = createDiagram([userNode, myAppNode, yourAppNode]);

    it('should identify Interaction A as Case A (has both P and S)', () => {
      const caseType = isUserInteractionCase(interactionA);
      expect(caseType).toBe('A');
    });

    it('should have ABPs correctly stored in metaModel', () => {
      expect(metaModel.entities.app_business_points).toHaveLength(2);
      expect(metaModel.entities.app_business_points).toContainEqual(myAppABP);
      expect(metaModel.entities.app_business_points).toContainEqual(yourAppABP);
    });

    it('should have correct ABP structure for My App', () => {
      expect(myAppABP.id).toBe('abp_app-my-app');
      expect(myAppABP.kind).toBe('APPLICATION');
      expect(myAppABP.source_entity_id).toBe('app-my-app');
    });

    it('should have correct ABP structure for Your App', () => {
      expect(yourAppABP.id).toBe('abp_app-your-app');
      expect(yourAppABP.kind).toBe('APPLICATION');
      expect(yourAppABP.source_entity_id).toBe('app-your-app');
    });

    it('should have correct diagram nodes', () => {
      expect(diagram.diagram_nodes).toHaveLength(3);

      const nodeTypes = diagram.diagram_nodes.map(n => ({
        entity_type: n.entity_type,
        entity_id: n.entity_id,
      }));

      expect(nodeTypes).toContainEqual({
        entity_type: ENTITY_TYPES.BUSINESS_USER,
        entity_id: 'user-my-user',
      });
      expect(nodeTypes).toContainEqual({
        entity_type: ENTITY_TYPES.APPLICATION,
        entity_id: 'app-my-app',
      });
      expect(nodeTypes).toContainEqual({
        entity_type: ENTITY_TYPES.APPLICATION,
        entity_id: 'app-your-app',
      });
    });

    it('should resolve My App ABP to its diagram node', () => {
      const nodeId = getAppBusinessPointNodeId(
        'abp_app-my-app',
        diagram.diagram_nodes,
        metaModel
      );

      expect(nodeId).toBe('node-app-my-app');
    });

    it('should resolve Your App ABP to its diagram node', () => {
      const nodeId = getAppBusinessPointNodeId(
        'abp_app-your-app',
        diagram.diagram_nodes,
        metaModel
      );

      expect(nodeId).toBe('node-app-your-app');
    });

    it('should find My App node via findNodeForEntity', () => {
      const node = findNodeForEntity(
        diagram.diagram_nodes,
        ENTITY_TYPES.APPLICATION,
        'app-my-app'
      );

      expect(node).toBeDefined();
      expect(node?.id).toBe('node-app-my-app');
    });

    it('should find Your App node via findNodeForEntity', () => {
      const node = findNodeForEntity(
        diagram.diagram_nodes,
        ENTITY_TYPES.APPLICATION,
        'app-your-app'
      );

      expect(node).toBeDefined();
      expect(node?.id).toBe('node-app-your-app');
    });

    it('CRITICAL: should ENABLE Interaction A row (Case A with P and S on diagram)', () => {
      const isEnabled = isUserInteractionRowEnabled(interactionA, diagram, metaModel);

      // This is the critical test - Interaction A should be ENABLED
      // because both "My App" (P) and "Your App" (S) nodes are on the diagram
      expect(isEnabled).toBe(true);
    });

    it('should STILL enable Interaction A even without User node (Case A)', () => {
      // Case A does NOT require User node
      const diagramWithoutUser = createDiagram([myAppNode, yourAppNode]);

      const isEnabled = isUserInteractionRowEnabled(
        interactionA,
        diagramWithoutUser,
        metaModel
      );

      expect(isEnabled).toBe(true);
    });
  });

  describe('ABP Resolution Edge Cases', () => {
    it('should return null when ABP not found in metaModel', () => {
      const metaModel = createMetaModel([], [], [], []);
      const diagram = createDiagram([createMyAppNode()]);

      const nodeId = getAppBusinessPointNodeId(
        'abp_nonexistent',
        diagram.diagram_nodes,
        metaModel
      );

      expect(nodeId).toBeNull();
    });

    it('should return null when ABP exists but node not on diagram', () => {
      const metaModel = createMetaModel(
        [],
        [createMyAppApplication()],
        [createMyAppABP()],
        []
      );
      const emptyDiagram = createDiagram([]);

      const nodeId = getAppBusinessPointNodeId(
        'abp_app-my-app',
        emptyDiagram.diagram_nodes,
        metaModel
      );

      expect(nodeId).toBeNull();
    });

    it('should return null when node entity_id does not match ABP source_entity_id', () => {
      const metaModel = createMetaModel(
        [],
        [createMyAppApplication()],
        [createMyAppABP()],
        []
      );

      // Create a node with WRONG entity_id
      const wrongNode: DiagramNode = {
        id: 'node-wrong',
        entity_type: ENTITY_TYPES.APPLICATION,
        entity_id: 'app-wrong-id', // Does not match ABP source_entity_id
        pos_x: 100,
        pos_y: 100,
        width: 150,
        height: 80,
        z_index: 1,
        parent_node_id: null,
      };

      const diagram = createDiagram([wrongNode]);

      const nodeId = getAppBusinessPointNodeId(
        'abp_app-my-app',
        diagram.diagram_nodes,
        metaModel
      );

      expect(nodeId).toBeNull();
    });
  });

  describe('Disabled Row Scenarios', () => {
    const myUser = createMyUserBusinessUser();
    const myApp = createMyAppApplication();
    const yourApp = createYourAppApplication();
    const myAppABP = createMyAppABP();
    const yourAppABP = createYourAppABP();
    const interactionA = createInteractionA();

    const metaModel = createMetaModel(
      [myUser],
      [myApp, yourApp],
      [myAppABP, yourAppABP],
      [interactionA]
    );

    it('should DISABLE when only P node on diagram (S missing)', () => {
      const diagram = createDiagram([createMyAppNode()]); // Only P

      const isEnabled = isUserInteractionRowEnabled(interactionA, diagram, metaModel);

      expect(isEnabled).toBe(false);
    });

    it('should DISABLE when only S node on diagram (P missing)', () => {
      const diagram = createDiagram([createYourAppNode()]); // Only S

      const isEnabled = isUserInteractionRowEnabled(interactionA, diagram, metaModel);

      expect(isEnabled).toBe(false);
    });

    it('should DISABLE when edges already exist', () => {
      const diagram = createDiagram([createMyAppNode(), createYourAppNode()]);
      diagram.diagram_edges = [
        {
          id: 'edge-1',
          relationship_type: 'USER_INTERACTION',
          relationship_id: 'int-interaction-a',
          source_node_id: 'node-app-my-app',
          target_node_id: 'node-app-your-app',
          subType: 'MAIN',
        },
      ];

      const isEnabled = isUserInteractionRowEnabled(interactionA, diagram, metaModel);

      expect(isEnabled).toBe(false);
    });
  });

  describe('Case B Scenarios', () => {
    it('should ENABLE Case B when P and User nodes on diagram', () => {
      const myUser = createMyUserBusinessUser();
      const myApp = createMyAppApplication();
      const myAppABP = createMyAppABP();

      // Case B: Only primary, no secondary
      const interactionB: Interaction = {
        id: 'int-interaction-b',
        name: 'Interaction B',
        description: '',
        tags: '',
        user_id: 'user-my-user',
        primary_app_business_point_id: 'abp_app-my-app',
        // No secondary_app_business_point_id
      };

      const metaModel = createMetaModel(
        [myUser],
        [myApp],
        [myAppABP],
        [interactionB]
      );

      const diagram = createDiagram([createUserNode(), createMyAppNode()]);

      const caseType = isUserInteractionCase(interactionB);
      expect(caseType).toBe('B');

      const isEnabled = isUserInteractionRowEnabled(interactionB, diagram, metaModel);
      expect(isEnabled).toBe(true);
    });

    it('should DISABLE Case B when User node is missing', () => {
      const myUser = createMyUserBusinessUser();
      const myApp = createMyAppApplication();
      const myAppABP = createMyAppABP();

      const interactionB: Interaction = {
        id: 'int-interaction-b',
        name: 'Interaction B',
        description: '',
        tags: '',
        user_id: 'user-my-user',
        primary_app_business_point_id: 'abp_app-my-app',
      };

      const metaModel = createMetaModel(
        [myUser],
        [myApp],
        [myAppABP],
        [interactionB]
      );

      // Only P node, no User node
      const diagram = createDiagram([createMyAppNode()]);

      const isEnabled = isUserInteractionRowEnabled(interactionB, diagram, metaModel);
      expect(isEnabled).toBe(false);
    });
  });
});
