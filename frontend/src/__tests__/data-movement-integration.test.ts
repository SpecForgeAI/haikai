/**
 * Data Movement Integration Tests
 *
 * Test Group 4: End-to-end scenario testing for Data Movement feature.
 *
 * These tests verify the complete workflow of Data Movement functionality,
 * including edge rendering, palette state, and time filtering integration.
 */

import { describe, test, expect, vi } from 'vitest';
import { getEdgesForDiagram, getRelationshipEndpointEntities } from '../utils/rendering';
import {
  getEntitiesOnDiagram,
  getRelationshipEligibility,
  createRelationshipEdge,
  getDataMovementNodes,
  getDataMovementEntityName,
} from '../utils/relationshipUtils';
import { MetaModel, ArchitectureModel, DiagramNode, DiagramEdge, Diagram, DataMovement, RELATIONSHIP_EDGE_TYPES } from '../types/model';

// Helper function to create a comprehensive MetaModel for integration testing
// Note: Uses valid_from/valid_to which is what isRelationshipVisibleInPeriod checks
function createIntegrationTestMetaModel(): MetaModel {
  return {
    entities: {
      applications: [
        { id: 'app-source', name: 'Source Application', valid_from: '2020-Q1', valid_to: null },
        { id: 'app-target', name: 'Target Application', valid_from: '2020-Q1', valid_to: null },
        { id: 'app-expired', name: 'Expired Application', valid_from: '2018-Q1', valid_to: '2019-Q4' },
      ],
      app_components: [],
      services: [],
      business_users: [],
      business_processes: [],
      logical_data_entities: [
        { id: 'lde-customer', name: 'Customer', valid_from: '2020-Q1', valid_to: null },
        { id: 'lde-order', name: 'Order', valid_from: '2020-Q1', valid_to: null },
      ],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      application_points: [
        {
          id: 'ap-source',
          name: 'Source App Point',
          kind: 'APPLICATION',
          application_id: 'app-source',
          valid_from: '2020-Q1',
          valid_to: null
        },
        {
          id: 'ap-target',
          name: 'Target App Point',
          kind: 'APPLICATION',
          application_id: 'app-target',
          valid_from: '2020-Q1',
          valid_to: null
        },
        {
          id: 'ap-expired',
          name: 'Expired App Point',
          kind: 'APPLICATION',
          application_id: 'app-expired',
          valid_from: '2018-Q1',
          valid_to: '2019-Q4'
        },
      ],
    },
    relationships: {
      business_user_processes: [],
      application_point_business_processes: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [
        {
          id: 'dm-active',
          source_application_point_id: 'ap-source',
          target_application_point_id: 'ap-target',
          dataEntityPointId: 'dep_log_lde-customer',
          valid_from: '2020-Q1',
          valid_to: null,
        },
        {
          id: 'dm-expired',
          source_application_point_id: 'ap-source',
          target_application_point_id: 'ap-target',
          dataEntityPointId: 'dep_log_lde-order',
          valid_from: '2018-Q1',
          valid_to: '2019-Q4', // Expired - valid_to is exclusive end
        },
      ],
    },
  } as unknown as MetaModel;
}

// Helper function to create a test ArchitectureModel
function createTestArchitectureModel(metaModel: MetaModel, diagrams: Diagram[]): ArchitectureModel {
  return {
    metaModel,
    diagrams,
  } as ArchitectureModel;
}

describe('Data Movement Integration Tests', () => {
  describe('Full workflow - Add Data Movement via palette, verify edge renders', () => {
    test('complete workflow from palette eligibility to edge rendering', () => {
      const metaModel = createIntegrationTestMetaModel();
      const dataMovement = metaModel.relationships.data_movements[0] as DataMovement;

      // Step 1: Create diagram with both app points
      const diagramNodes: DiagramNode[] = [
        {
          id: 'node-source',
          entity_type: 'APPLICATION_POINT',
          entity_id: 'ap-source',
          pos_x: 100,
          pos_y: 100,
          width: 120,
          height: 60,
        },
        {
          id: 'node-target',
          entity_type: 'APPLICATION_POINT',
          entity_id: 'ap-target',
          pos_x: 400,
          pos_y: 100,
          width: 120,
          height: 60,
        },
      ];

      // Step 2: Verify palette shows Data Movement as ENABLED
      const entitiesOnDiagram = getEntitiesOnDiagram(metaModel, { diagram_nodes: diagramNodes });
      const eligibility = getRelationshipEligibility(
        dataMovement,
        'data_movements',
        diagramNodes,
        metaModel,
        entitiesOnDiagram
      );

      expect(eligibility.enabled).toBe(true);

      // Step 3: Get nodes for creating the edge
      const endpointNodes = getDataMovementNodes(dataMovement, diagramNodes, metaModel);
      expect(endpointNodes).not.toBeNull();
      expect(endpointNodes!.sourceNode.id).toBe('node-source');
      expect(endpointNodes!.targetNode.id).toBe('node-target');

      // Step 4: Get entity name for label
      const labelText = getDataMovementEntityName(dataMovement, metaModel);
      expect(labelText).toBe('Customer');

      // Step 5: Create the edge (simulating what PalettePanel does)
      const newEdge = createRelationshipEdge(
        dataMovement,
        RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT,
        endpointNodes!.sourceNode,
        endpointNodes!.targetNode,
        { labelText }
      );

      // Verify edge properties
      expect(newEdge.relationship_type).toBe('DATA_MOVEMENT');
      expect(newEdge.relationship_id).toBe('dm-active');
      expect(newEdge.source_node_id).toBe('node-source');
      expect(newEdge.target_node_id).toBe('node-target');
      expect(newEdge.label_text).toBe('Customer');
      expect(newEdge.line_type).toBe('SOLID');
      expect(newEdge.arrow_end).toBe('ARROW');

      // Step 6: Add edge to diagram and verify it renders
      const diagram: Diagram = {
        id: 'diagram-1',
        name: 'Integration Test Diagram',
        diagram_nodes: diagramNodes,
        diagram_edges: [newEdge],
        box_decorations: [],
        line_decorations: [],
      } as Diagram;

      const model = createTestArchitectureModel(metaModel, [diagram]);
      const visibleNodeIds = new Set(['node-source', 'node-target']);

      const edges = getEdgesForDiagram('diagram-1', model, '2024-Q1', visibleNodeIds);
      expect(edges).toHaveLength(1);
      expect(edges[0].relationship_type).toBe('DATA_MOVEMENT');
    });
  });

  describe('Switch diagrams - Data Movement disabled on empty diagram', () => {
    test('Data Movement disabled when no app points on diagram', () => {
      const metaModel = createIntegrationTestMetaModel();
      const dataMovement = metaModel.relationships.data_movements[0] as DataMovement;

      // Empty diagram (no nodes)
      const emptyDiagramNodes: DiagramNode[] = [];
      const entitiesOnDiagram = getEntitiesOnDiagram(metaModel, { diagram_nodes: emptyDiagramNodes });

      const eligibility = getRelationshipEligibility(
        dataMovement,
        'data_movements',
        emptyDiagramNodes,
        metaModel,
        entitiesOnDiagram
      );

      expect(eligibility.enabled).toBe(false);
      expect(eligibility.disabledReason).toBe('endpoints_missing');
    });

    test('Data Movement enabled on diagram with both app points, disabled on diagram with only one', () => {
      const metaModel = createIntegrationTestMetaModel();
      const dataMovement = metaModel.relationships.data_movements[0] as DataMovement;

      // Diagram 1: Both app points present
      const diagram1Nodes: DiagramNode[] = [
        { id: 'n1', entity_type: 'APPLICATION_POINT', entity_id: 'ap-source', pos_x: 0, pos_y: 0, width: 100, height: 50 },
        { id: 'n2', entity_type: 'APPLICATION_POINT', entity_id: 'ap-target', pos_x: 200, pos_y: 0, width: 100, height: 50 },
      ];

      // Diagram 2: Only source app point
      const diagram2Nodes: DiagramNode[] = [
        { id: 'n1', entity_type: 'APPLICATION_POINT', entity_id: 'ap-source', pos_x: 0, pos_y: 0, width: 100, height: 50 },
      ];

      const entities1 = getEntitiesOnDiagram(metaModel, { diagram_nodes: diagram1Nodes });
      const entities2 = getEntitiesOnDiagram(metaModel, { diagram_nodes: diagram2Nodes });

      const eligibility1 = getRelationshipEligibility(dataMovement, 'data_movements', diagram1Nodes, metaModel, entities1);
      const eligibility2 = getRelationshipEligibility(dataMovement, 'data_movements', diagram2Nodes, metaModel, entities2);

      // Diagram 1: ENABLED
      expect(eligibility1.enabled).toBe(true);

      // Diagram 2: DISABLED
      expect(eligibility2.enabled).toBe(false);
      expect(eligibility2.disabledReason).toBe('endpoints_missing');
    });
  });

  describe('Time filtering - Data Movement visible when relationship and apps effective', () => {
    test('active Data Movement edge visible in current period', () => {
      const metaModel = createIntegrationTestMetaModel();

      const diagram: Diagram = {
        id: 'diagram-1',
        name: 'Time Filter Test Diagram',
        diagram_nodes: [
          { id: 'n1', entity_type: 'APPLICATION_POINT', entity_id: 'ap-source', pos_x: 0, pos_y: 0, width: 100, height: 50 },
          { id: 'n2', entity_type: 'APPLICATION_POINT', entity_id: 'ap-target', pos_x: 200, pos_y: 0, width: 100, height: 50 },
        ],
        diagram_edges: [
          {
            id: 'edge-active',
            relationship_type: 'DATA_MOVEMENT',
            relationship_id: 'dm-active',
            source_node_id: 'n1',
            target_node_id: 'n2',
            edge_points: [
              { id: 'ep1', sequence_order: 0, pos_x: 100, pos_y: 25 },
              { id: 'ep2', sequence_order: 1, pos_x: 200, pos_y: 25 },
            ],
          } as DiagramEdge,
        ],
        box_decorations: [],
        line_decorations: [],
      } as Diagram;

      const model = createTestArchitectureModel(metaModel, [diagram]);
      const visibleNodeIds = new Set(['n1', 'n2']);

      // Current period (2024-Q1) - should see active edge
      const edges = getEdgesForDiagram('diagram-1', model, '2024-Q1', visibleNodeIds);
      expect(edges).toHaveLength(1);
      expect(edges[0].id).toBe('edge-active');
    });

    test('expired Data Movement edge NOT visible in current period', () => {
      const metaModel = createIntegrationTestMetaModel();

      const diagram: Diagram = {
        id: 'diagram-1',
        name: 'Time Filter Test Diagram',
        diagram_nodes: [
          { id: 'n1', entity_type: 'APPLICATION_POINT', entity_id: 'ap-source', pos_x: 0, pos_y: 0, width: 100, height: 50 },
          { id: 'n2', entity_type: 'APPLICATION_POINT', entity_id: 'ap-target', pos_x: 200, pos_y: 0, width: 100, height: 50 },
        ],
        diagram_edges: [
          {
            id: 'edge-expired',
            relationship_type: 'DATA_MOVEMENT',
            relationship_id: 'dm-expired', // This relationship is expired (valid_to: 2019-Q4)
            source_node_id: 'n1',
            target_node_id: 'n2',
            edge_points: [
              { id: 'ep1', sequence_order: 0, pos_x: 100, pos_y: 25 },
              { id: 'ep2', sequence_order: 1, pos_x: 200, pos_y: 25 },
            ],
          } as DiagramEdge,
        ],
        box_decorations: [],
        line_decorations: [],
      } as Diagram;

      const model = createTestArchitectureModel(metaModel, [diagram]);
      const visibleNodeIds = new Set(['n1', 'n2']);

      // Mock console.warn to suppress test output
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Current period (2024-Q1) - should NOT see expired edge
      const edges = getEdgesForDiagram('diagram-1', model, '2024-Q1', visibleNodeIds);
      expect(edges).toHaveLength(0);

      consoleSpy.mockRestore();
    });

    test('Data Movement endpoint entities exclude logical data entity for time filtering', () => {
      const metaModel = createIntegrationTestMetaModel();
      const dataMovement = metaModel.relationships.data_movements[0];

      const endpoints = getRelationshipEndpointEntities(
        'DATA_MOVEMENT',
        dataMovement as any,
        metaModel
      );

      // Should only have 2 endpoints (source and target apps)
      expect(endpoints).toHaveLength(2);

      // Verify they are the application points, not logical data entities
      const endpointIds = endpoints.map(e => e.id);
      expect(endpointIds).toContain('ap-source');
      expect(endpointIds).toContain('ap-target');
      expect(endpointIds).not.toContain('lde-customer');
    });
  });

  describe('Delete node - Edge disappears and palette disables', () => {
    test('edge filtered out when source node removed from visibleNodeIds', () => {
      const metaModel = createIntegrationTestMetaModel();

      const diagram: Diagram = {
        id: 'diagram-1',
        name: 'Delete Node Test Diagram',
        diagram_nodes: [
          { id: 'n1', entity_type: 'APPLICATION_POINT', entity_id: 'ap-source', pos_x: 0, pos_y: 0, width: 100, height: 50 },
          { id: 'n2', entity_type: 'APPLICATION_POINT', entity_id: 'ap-target', pos_x: 200, pos_y: 0, width: 100, height: 50 },
        ],
        diagram_edges: [
          {
            id: 'edge-1',
            relationship_type: 'DATA_MOVEMENT',
            relationship_id: 'dm-active',
            source_node_id: 'n1',
            target_node_id: 'n2',
            edge_points: [
              { id: 'ep1', sequence_order: 0, pos_x: 100, pos_y: 25 },
              { id: 'ep2', sequence_order: 1, pos_x: 200, pos_y: 25 },
            ],
          } as DiagramEdge,
        ],
        box_decorations: [],
        line_decorations: [],
      } as Diagram;

      const model = createTestArchitectureModel(metaModel, [diagram]);

      // Mock console.warn to suppress test output
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Before deletion: both nodes visible
      const beforeDeletion = getEdgesForDiagram('diagram-1', model, '2024-Q1', new Set(['n1', 'n2']));
      expect(beforeDeletion).toHaveLength(1);

      // After deletion: source node removed
      const afterDeletion = getEdgesForDiagram('diagram-1', model, '2024-Q1', new Set(['n2']));
      expect(afterDeletion).toHaveLength(0);

      consoleSpy.mockRestore();
    });

    test('palette disables after node removal', () => {
      const metaModel = createIntegrationTestMetaModel();
      const dataMovement = metaModel.relationships.data_movements[0] as DataMovement;

      // Before deletion: both nodes on diagram
      const nodesBeforeDeletion: DiagramNode[] = [
        { id: 'n1', entity_type: 'APPLICATION_POINT', entity_id: 'ap-source', pos_x: 0, pos_y: 0, width: 100, height: 50 },
        { id: 'n2', entity_type: 'APPLICATION_POINT', entity_id: 'ap-target', pos_x: 200, pos_y: 0, width: 100, height: 50 },
      ];

      const entitiesBefore = getEntitiesOnDiagram(metaModel, { diagram_nodes: nodesBeforeDeletion });
      const eligibilityBefore = getRelationshipEligibility(dataMovement, 'data_movements', nodesBeforeDeletion, metaModel, entitiesBefore);
      expect(eligibilityBefore.enabled).toBe(true);

      // After deletion: source node removed
      const nodesAfterDeletion: DiagramNode[] = [
        { id: 'n2', entity_type: 'APPLICATION_POINT', entity_id: 'ap-target', pos_x: 200, pos_y: 0, width: 100, height: 50 },
      ];

      const entitiesAfter = getEntitiesOnDiagram(metaModel, { diagram_nodes: nodesAfterDeletion });
      const eligibilityAfter = getRelationshipEligibility(dataMovement, 'data_movements', nodesAfterDeletion, metaModel, entitiesAfter);
      expect(eligibilityAfter.enabled).toBe(false);
      expect(eligibilityAfter.disabledReason).toBe('endpoints_missing');
    });
  });
});
