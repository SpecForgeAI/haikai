/**
 * Data Movement Rendering Fix Tests
 *
 * Test Group 1: Tests for the DATA_MOVEMENT endpoint entity resolution fix.
 *
 * The bug: getRelationshipEndpointEntities() was incorrectly including the Logical Data Entity
 * in the returned endpoints array for DATA_MOVEMENT relationships. When time filtering checked
 * this array, it failed because the Logical Data Entity is not on the diagram (which is correct
 * behaviour - it should NOT need to be on the diagram).
 *
 * The fix: Remove the dataEntity push from the DATA_MOVEMENT case, so that only
 * sourceApp and targetApp are returned as endpoint entities.
 */

import { describe, test, expect } from 'vitest';
import { getRelationshipEndpointEntities, getEdgesForDiagram } from '../utils/rendering';
import { MetaModel, ArchitectureModel, DiagramEdge, Diagram } from '../types/model';

// Helper function to create a minimal MetaModel for testing
function createTestMetaModel(): MetaModel {
  return {
    entities: {
      applications: [
        { id: 'app-1', name: 'Source App', effective_from: '2020-Q1', effective_to: null },
        { id: 'app-2', name: 'Target App', effective_from: '2020-Q1', effective_to: null },
      ],
      app_components: [],
      services: [],
      business_users: [],
      business_processes: [],
      logical_data_entities: [
        { id: 'lde-1', name: 'Customer Data', effective_from: '2020-Q1', effective_to: null },
      ],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      application_points: [
        {
          id: 'ap-1',
          name: 'Source App Point',
          kind: 'APPLICATION',
          application_id: 'app-1',
          effective_from: '2020-Q1',
          effective_to: null
        },
        {
          id: 'ap-2',
          name: 'Target App Point',
          kind: 'APPLICATION',
          application_id: 'app-2',
          effective_from: '2020-Q1',
          effective_to: null
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
          id: 'dm-1',
          // DataMovement now references application POINTS and a data entity point
          source_application_point_id: 'ap-1',
          target_application_point_id: 'ap-2',
          dataEntityPointId: 'dep_log_lde-1',
          effective_from: '2020-Q1',
          effective_to: null,
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

describe('DATA_MOVEMENT Endpoint Entity Resolution', () => {
  describe('getRelationshipEndpointEntities', () => {
    test('returns exactly 2 entities for DATA_MOVEMENT (source and target apps only)', () => {
      const metaModel = createTestMetaModel();
      const dataMovementRelationship = metaModel.relationships.data_movements[0];

      const endpoints = getRelationshipEndpointEntities(
        'DATA_MOVEMENT',
        dataMovementRelationship as any,
        metaModel
      );

      // Should return exactly 2 entities: sourceApp and targetApp
      expect(endpoints).toHaveLength(2);

      // Verify the entities are the application POINTS (the data movement's
      // direct endpoints since the application-point refactor)
      const endpointIds = endpoints.map(e => e.id);
      expect(endpointIds).toContain('ap-1'); // Source application point
      expect(endpointIds).toContain('ap-2'); // Target application point
    });

    test('does NOT include logical data entity in returned endpoints', () => {
      const metaModel = createTestMetaModel();
      const dataMovementRelationship = metaModel.relationships.data_movements[0];

      const endpoints = getRelationshipEndpointEntities(
        'DATA_MOVEMENT',
        dataMovementRelationship as any,
        metaModel
      );

      // Verify logical data entity is NOT in the endpoints
      const endpointIds = endpoints.map(e => e.id);
      expect(endpointIds).not.toContain('lde-1'); // Logical data entity should NOT be included

      // Double-check by verifying none of the endpoints are from logical_data_entities
      const logicalEntityIds = metaModel.entities.logical_data_entities.map(e => e.id);
      for (const endpoint of endpoints) {
        expect(logicalEntityIds).not.toContain(endpoint.id);
      }
    });
  });

  describe('getEdgesForDiagram', () => {
    test('includes DATA_MOVEMENT edge when both app nodes are visible (logical entity NOT on diagram)', () => {
      const metaModel = createTestMetaModel();

      // Create a diagram with APPLICATION_POINT nodes for both apps
      // Note: The logical data entity is NOT on the diagram
      const diagram: Diagram = {
        id: 'diagram-1',
        name: 'Test Diagram',
        diagram_nodes: [
          {
            id: 'node-1',
            entity_type: 'APPLICATION_POINT',
            entity_id: 'ap-1', // Source app point
            pos_x: 100,
            pos_y: 100,
            width: 100,
            height: 50,
          },
          {
            id: 'node-2',
            entity_type: 'APPLICATION_POINT',
            entity_id: 'ap-2', // Target app point
            pos_x: 300,
            pos_y: 100,
            width: 100,
            height: 50,
          },
        ],
        diagram_edges: [
          {
            id: 'edge-1',
            relationship_type: 'DATA_MOVEMENT',
            relationship_id: 'dm-1',
            source_node_id: 'node-1',
            target_node_id: 'node-2',
            edge_points: [
              { id: 'ep-1', sequence_order: 0, pos_x: 200, pos_y: 100 },
              { id: 'ep-2', sequence_order: 1, pos_x: 300, pos_y: 100 },
            ],
          } as DiagramEdge,
        ],
        box_decorations: [],
        line_decorations: [],
      } as Diagram;

      const model = createTestArchitectureModel(metaModel, [diagram]);
      const visibleNodeIds = new Set(['node-1', 'node-2']);

      // Get edges with time filtering enabled
      const edges = getEdgesForDiagram('diagram-1', model, '2024-Q1', visibleNodeIds);

      // The DATA_MOVEMENT edge should be included because:
      // 1. Both app nodes (via app points) are visible
      // 2. The logical data entity is NOT required to be on the diagram
      expect(edges).toHaveLength(1);
      expect(edges[0].id).toBe('edge-1');
      expect(edges[0].relationship_type).toBe('DATA_MOVEMENT');
    });

    test('excludes DATA_MOVEMENT edge when source app node is not visible', () => {
      const metaModel = createTestMetaModel();

      // Create a diagram with only the target app node visible
      const diagram: Diagram = {
        id: 'diagram-1',
        name: 'Test Diagram',
        diagram_nodes: [
          {
            id: 'node-1',
            entity_type: 'APPLICATION_POINT',
            entity_id: 'ap-1', // Source app point
            pos_x: 100,
            pos_y: 100,
            width: 100,
            height: 50,
          },
          {
            id: 'node-2',
            entity_type: 'APPLICATION_POINT',
            entity_id: 'ap-2', // Target app point
            pos_x: 300,
            pos_y: 100,
            width: 100,
            height: 50,
          },
        ],
        diagram_edges: [
          {
            id: 'edge-1',
            relationship_type: 'DATA_MOVEMENT',
            relationship_id: 'dm-1',
            source_node_id: 'node-1',
            target_node_id: 'node-2',
            edge_points: [
              { id: 'ep-1', sequence_order: 0, pos_x: 200, pos_y: 100 },
              { id: 'ep-2', sequence_order: 1, pos_x: 300, pos_y: 100 },
            ],
          } as DiagramEdge,
        ],
        box_decorations: [],
        line_decorations: [],
      } as Diagram;

      const model = createTestArchitectureModel(metaModel, [diagram]);

      // Only target node is visible (source node is NOT in the set)
      const visibleNodeIds = new Set(['node-2']); // node-1 is missing

      // Get edges with time filtering enabled
      const edges = getEdgesForDiagram('diagram-1', model, '2024-Q1', visibleNodeIds);

      // The DATA_MOVEMENT edge should be EXCLUDED because source node is not visible
      expect(edges).toHaveLength(0);
    });
  });
});
