/**
 * Data Movement Console Warnings Tests
 *
 * Test Group 2: Tests for console warning behaviour when edges are filtered.
 *
 * These tests verify that appropriate console warnings are logged when edges
 * are filtered out during rendering, providing debugging information.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { getEdgesForDiagram } from '../utils/rendering';
import { MetaModel, ArchitectureModel, DiagramEdge, Diagram } from '../types/model';

// Helper function to create a minimal MetaModel for testing
// Note: Uses valid_from/valid_to which is what isRelationshipVisibleInPeriod checks
function createTestMetaModel(): MetaModel {
  return {
    entities: {
      applications: [
        { id: 'app-1', name: 'Source App', valid_from: '2020-Q1', valid_to: null },
        { id: 'app-2', name: 'Target App', valid_from: '2020-Q1', valid_to: null },
      ],
      app_components: [],
      services: [],
      business_users: [],
      business_processes: [],
      logical_data_entities: [
        { id: 'lde-1', name: 'Customer Data', valid_from: '2020-Q1', valid_to: null },
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
          valid_from: '2020-Q1',
          valid_to: null
        },
        {
          id: 'ap-2',
          name: 'Target App Point',
          kind: 'APPLICATION',
          application_id: 'app-2',
          valid_from: '2020-Q1',
          valid_to: null
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
          source_application_id: 'app-1',
          target_application_id: 'app-2',
          data_entity_id: 'lde-1',
          valid_from: '2020-Q1',
          valid_to: null,
        },
        {
          // Data movement that is NOT visible in the current period
          id: 'dm-expired',
          source_application_id: 'app-1',
          target_application_id: 'app-2',
          data_entity_id: 'lde-1',
          valid_from: '2018-Q1',
          valid_to: '2019-Q4', // Expired before current period (exclusive end)
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

describe('Console Warnings for Filtered Edges', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Mock console.warn to capture warnings
    consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('logs warning when edge filtered due to missing source node', () => {
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
    const visibleNodeIds = new Set(['node-2']); // node-1 (source) is missing

    // Get edges with time filtering enabled
    getEdgesForDiagram('diagram-1', model, '2024-Q1', visibleNodeIds);

    // Verify warning was logged with correct reason
    expect(consoleSpy).toHaveBeenCalledWith(
      'Filtered out edge',
      expect.objectContaining({
        edgeId: 'edge-1',
        relationshipType: 'DATA_MOVEMENT',
        reason: 'source_node_not_on_diagram',
      })
    );
  });

  test('logs warning when edge filtered due to relationship not visible in period', () => {
    const metaModel = createTestMetaModel();

    // Create a diagram with both app nodes visible
    const diagram: Diagram = {
      id: 'diagram-1',
      name: 'Test Diagram',
      diagram_nodes: [
        {
          id: 'node-1',
          entity_type: 'APPLICATION_POINT',
          entity_id: 'ap-1',
          pos_x: 100,
          pos_y: 100,
          width: 100,
          height: 50,
        },
        {
          id: 'node-2',
          entity_type: 'APPLICATION_POINT',
          entity_id: 'ap-2',
          pos_x: 300,
          pos_y: 100,
          width: 100,
          height: 50,
        },
      ],
      diagram_edges: [
        {
          // Edge referencing an EXPIRED data movement
          id: 'edge-expired',
          relationship_type: 'DATA_MOVEMENT',
          relationship_id: 'dm-expired', // This relationship is expired
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

    // Get edges with time filtering for a period AFTER the relationship expired
    getEdgesForDiagram('diagram-1', model, '2024-Q1', visibleNodeIds);

    // Verify warning was logged with correct reason
    expect(consoleSpy).toHaveBeenCalledWith(
      'Filtered out edge',
      expect.objectContaining({
        edgeId: 'edge-expired',
        relationshipType: 'DATA_MOVEMENT',
        reason: 'relationship_not_visible',
      })
    );
  });

  test('warning includes edge ID, relationship type, and specific reason', () => {
    const metaModel = createTestMetaModel();

    // Create a diagram with an edge referencing a non-existent relationship
    const diagram: Diagram = {
      id: 'diagram-1',
      name: 'Test Diagram',
      diagram_nodes: [
        {
          id: 'node-1',
          entity_type: 'APPLICATION_POINT',
          entity_id: 'ap-1',
          pos_x: 100,
          pos_y: 100,
          width: 100,
          height: 50,
        },
        {
          id: 'node-2',
          entity_type: 'APPLICATION_POINT',
          entity_id: 'ap-2',
          pos_x: 300,
          pos_y: 100,
          width: 100,
          height: 50,
        },
      ],
      diagram_edges: [
        {
          // Edge referencing a NON-EXISTENT relationship
          id: 'edge-orphan',
          relationship_type: 'DATA_MOVEMENT',
          relationship_id: 'dm-nonexistent', // This relationship doesn't exist
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

    // Get edges with time filtering
    getEdgesForDiagram('diagram-1', model, '2024-Q1', visibleNodeIds);

    // Verify warning was logged with all required fields
    expect(consoleSpy).toHaveBeenCalledWith(
      'Filtered out edge',
      expect.objectContaining({
        edgeId: 'edge-orphan',
        relationshipType: 'DATA_MOVEMENT',
        reason: 'relationship_not_found',
      })
    );

    // Verify the structure of the warning call
    const warningCall = consoleSpy.mock.calls[0];
    expect(warningCall).toHaveLength(2);
    expect(warningCall[0]).toBe('Filtered out edge');
    expect(warningCall[1]).toHaveProperty('edgeId');
    expect(warningCall[1]).toHaveProperty('relationshipType');
    expect(warningCall[1]).toHaveProperty('reason');
  });
});
