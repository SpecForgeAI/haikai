/**
 * Data Movement Palette State Tests
 *
 * Test Group 3: Tests for palette enabled/disabled state synchronisation.
 *
 * These tests verify that the palette correctly enables/disables Data Movement
 * rows based on which Application Points (derived from Applications) are on the diagram.
 *
 * Verification Notes:
 * - isDataMovementEnabledWithSets in relationshipUtils.ts (lines ~497-504) correctly
 *   checks applicationPointsOnDiagram Set only - no logical data entity check
 * - PaletteSection.tsx correctly recomputes entitiesOnDiagram on every render (lines 43-45)
 * - PaletteItem.tsx correctly displays tooltip text for disabled relationships
 */

import { describe, test, expect } from 'vitest';
import {
  getEntitiesOnDiagram,
  getRelationshipEligibility,
} from '../utils/relationshipUtils';
import { MetaModel, DiagramNode, DataMovement } from '../types/model';

// Helper function to create a minimal MetaModel for testing
function createTestMetaModel(): MetaModel {
  return {
    entities: {
      applications: [
        { id: 'app-1', name: 'Source App', effective_from: '2020-Q1', effective_to: null },
        { id: 'app-2', name: 'Target App', effective_from: '2020-Q1', effective_to: null },
        { id: 'app-3', name: 'Other App', effective_from: '2020-Q1', effective_to: null },
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
        {
          id: 'ap-3',
          name: 'Other App Point',
          kind: 'APPLICATION',
          application_id: 'app-3',
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

// Helper function to create a test diagram with specific nodes
function createTestDiagram(nodes: DiagramNode[]) {
  return {
    diagram_nodes: nodes,
  };
}

describe('Data Movement Palette State Synchronisation', () => {
  test('Data Movement row is ENABLED when both source and target app nodes on diagram', () => {
    const metaModel = createTestMetaModel();
    const dataMovement = metaModel.relationships.data_movements[0] as DataMovement;

    // Create diagram with BOTH source and target Application Points
    const diagramNodes: DiagramNode[] = [
      {
        id: 'node-1',
        entity_type: 'APPLICATION_POINT',
        entity_id: 'ap-1', // Source app point (app-1)
        pos_x: 100,
        pos_y: 100,
        width: 100,
        height: 50,
      },
      {
        id: 'node-2',
        entity_type: 'APPLICATION_POINT',
        entity_id: 'ap-2', // Target app point (app-2)
        pos_x: 300,
        pos_y: 100,
        width: 100,
        height: 50,
      },
    ];

    const diagram = createTestDiagram(diagramNodes);
    const entitiesOnDiagram = getEntitiesOnDiagram(metaModel, diagram);

    // Verify application points are on diagram
    expect(entitiesOnDiagram.applicationPointsOnDiagram.has('ap-1')).toBe(true);
    expect(entitiesOnDiagram.applicationPointsOnDiagram.has('ap-2')).toBe(true);

    // Check eligibility
    const eligibility = getRelationshipEligibility(
      dataMovement,
      'data_movements',
      diagramNodes,
      metaModel,
      entitiesOnDiagram
    );

    // Should be ENABLED because both endpoints are on diagram
    expect(eligibility.enabled).toBe(true);
    expect(eligibility.disabledReason).toBeNull();
  });

  test('Data Movement row is DISABLED when only source app node on diagram', () => {
    const metaModel = createTestMetaModel();
    const dataMovement = metaModel.relationships.data_movements[0] as DataMovement;

    // Create diagram with ONLY source Application Point (target is missing)
    const diagramNodes: DiagramNode[] = [
      {
        id: 'node-1',
        entity_type: 'APPLICATION_POINT',
        entity_id: 'ap-1', // Source app point (app-1)
        pos_x: 100,
        pos_y: 100,
        width: 100,
        height: 50,
      },
      // Node for ap-2 (target) is missing
    ];

    const diagram = createTestDiagram(diagramNodes);
    const entitiesOnDiagram = getEntitiesOnDiagram(metaModel, diagram);

    // Verify only source app point is on diagram
    expect(entitiesOnDiagram.applicationPointsOnDiagram.has('ap-1')).toBe(true);
    expect(entitiesOnDiagram.applicationPointsOnDiagram.has('ap-2')).toBe(false);

    // Check eligibility
    const eligibility = getRelationshipEligibility(
      dataMovement,
      'data_movements',
      diagramNodes,
      metaModel,
      entitiesOnDiagram
    );

    // Should be DISABLED because target endpoint is missing
    expect(eligibility.enabled).toBe(false);
    expect(eligibility.disabledReason).toBe('endpoints_missing');
  });

  test('Data Movement row becomes ENABLED after adding missing target app node', () => {
    const metaModel = createTestMetaModel();
    const dataMovement = metaModel.relationships.data_movements[0] as DataMovement;

    // Initial state: Only source app point on diagram
    const initialNodes: DiagramNode[] = [
      {
        id: 'node-1',
        entity_type: 'APPLICATION_POINT',
        entity_id: 'ap-1',
        pos_x: 100,
        pos_y: 100,
        width: 100,
        height: 50,
      },
    ];

    const initialDiagram = createTestDiagram(initialNodes);
    const initialEntities = getEntitiesOnDiagram(metaModel, initialDiagram);

    // Initial eligibility should be DISABLED
    const initialEligibility = getRelationshipEligibility(
      dataMovement,
      'data_movements',
      initialNodes,
      metaModel,
      initialEntities
    );
    expect(initialEligibility.enabled).toBe(false);

    // After adding target app point
    const updatedNodes: DiagramNode[] = [
      ...initialNodes,
      {
        id: 'node-2',
        entity_type: 'APPLICATION_POINT',
        entity_id: 'ap-2', // Adding the missing target
        pos_x: 300,
        pos_y: 100,
        width: 100,
        height: 50,
      },
    ];

    const updatedDiagram = createTestDiagram(updatedNodes);
    const updatedEntities = getEntitiesOnDiagram(metaModel, updatedDiagram);

    // Updated eligibility should be ENABLED
    const updatedEligibility = getRelationshipEligibility(
      dataMovement,
      'data_movements',
      updatedNodes,
      metaModel,
      updatedEntities
    );
    expect(updatedEligibility.enabled).toBe(true);
    expect(updatedEligibility.disabledReason).toBeNull();
  });

  test('Data Movement row becomes DISABLED after removing source app node', () => {
    const metaModel = createTestMetaModel();
    const dataMovement = metaModel.relationships.data_movements[0] as DataMovement;

    // Initial state: Both source and target app points on diagram
    const initialNodes: DiagramNode[] = [
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
    ];

    const initialDiagram = createTestDiagram(initialNodes);
    const initialEntities = getEntitiesOnDiagram(metaModel, initialDiagram);

    // Initial eligibility should be ENABLED
    const initialEligibility = getRelationshipEligibility(
      dataMovement,
      'data_movements',
      initialNodes,
      metaModel,
      initialEntities
    );
    expect(initialEligibility.enabled).toBe(true);

    // After removing source app point (simulating node deletion)
    const updatedNodes: DiagramNode[] = [
      // node-1 (source) removed
      {
        id: 'node-2',
        entity_type: 'APPLICATION_POINT',
        entity_id: 'ap-2',
        pos_x: 300,
        pos_y: 100,
        width: 100,
        height: 50,
      },
    ];

    const updatedDiagram = createTestDiagram(updatedNodes);
    const updatedEntities = getEntitiesOnDiagram(metaModel, updatedDiagram);

    // Updated eligibility should be DISABLED
    const updatedEligibility = getRelationshipEligibility(
      dataMovement,
      'data_movements',
      updatedNodes,
      metaModel,
      updatedEntities
    );
    expect(updatedEligibility.enabled).toBe(false);
    expect(updatedEligibility.disabledReason).toBe('endpoints_missing');
  });

  // Additional verification: Logical Data Entity presence does NOT affect eligibility
  test('Data Movement eligibility does NOT check for logical data entity presence', () => {
    const metaModel = createTestMetaModel();
    const dataMovement = metaModel.relationships.data_movements[0] as DataMovement;

    // Create diagram with both app points but WITHOUT the logical data entity
    const diagramNodes: DiagramNode[] = [
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
      // NO LOGICAL_DATA_ENTITY node - this should NOT matter for eligibility
    ];

    const diagram = createTestDiagram(diagramNodes);
    const entitiesOnDiagram = getEntitiesOnDiagram(metaModel, diagram);

    // Verify logical data entity is NOT on diagram
    expect(entitiesOnDiagram.logicalDataEntitiesOnDiagram.has('lde-1')).toBe(false);

    // Check eligibility
    const eligibility = getRelationshipEligibility(
      dataMovement,
      'data_movements',
      diagramNodes,
      metaModel,
      entitiesOnDiagram
    );

    // Should STILL be enabled - LDE presence is NOT required
    expect(eligibility.enabled).toBe(true);
    expect(eligibility.disabledReason).toBeNull();
  });
});
