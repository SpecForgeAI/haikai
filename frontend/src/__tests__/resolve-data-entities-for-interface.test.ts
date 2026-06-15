/**
 * Tests for resolveDataEntitiesForInterface utility function
 *
 * Spec: Fix Advanced Add Interface Schema Entities
 * Task Group 1.1: Tests for shared resolver utility
 *
 * These tests verify that the utility correctly parses dataEntityPointId values
 * from interface_logical_entities relationship rows and returns grouped entity IDs.
 */

import { resolveDataEntitiesForInterface } from '../utils/dataEntityPointOptions';
import { MetaModel } from '../types/model';

describe('resolveDataEntitiesForInterface', () => {
  // Helper to create a minimal MetaModel fixture
  function createMetaModel(
    interfaceLogicalEntities: Array<{
      id: string;
      interface_id: string;
      dataEntityPointId: string;
      description: string;
      tags: string;
    }> = []
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
        interfaces: [],
        endpoints: [],
        classes: [],
        methods: [],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
        interactions: [],
        app_business_points: [],
        events: [],
        states: [],
        state_transitions: [],
        activities: [],
        activity_flows: [],
        activity_partitions: [],
        business_logics: [],
        ui_screens: [],
        ui_components: [],
        ui_actions: [],
        package_sets: [],
        packages: [],
      },
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [],
        application_point_business_logics: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: interfaceLogicalEntities,
        ui_workflow_transitions: [],
      },
    };
  }

  it('should return empty arrays when no relationships exist', () => {
    const metaModel = createMetaModel([]);
    const result = resolveDataEntitiesForInterface(metaModel, 'interface-1');

    expect(result.logicalEntityIds).toEqual([]);
    expect(result.physicalEntityIds).toEqual([]);
  });

  it('should return empty arrays when no relationships match the interface ID', () => {
    const metaModel = createMetaModel([
      {
        id: 'rel-1',
        interface_id: 'interface-other',
        dataEntityPointId: 'dep_log_entity-1',
        description: '',
        tags: '',
      },
    ]);
    const result = resolveDataEntitiesForInterface(metaModel, 'interface-1');

    expect(result.logicalEntityIds).toEqual([]);
    expect(result.physicalEntityIds).toEqual([]);
  });

  it('should parse dep_log_ format and return correct logicalEntityIds', () => {
    const metaModel = createMetaModel([
      {
        id: 'rel-1',
        interface_id: 'interface-1',
        dataEntityPointId: 'dep_log_logical-entity-abc123',
        description: '',
        tags: '',
      },
      {
        id: 'rel-2',
        interface_id: 'interface-1',
        dataEntityPointId: 'dep_log_logical-entity-def456',
        description: '',
        tags: '',
      },
    ]);
    const result = resolveDataEntitiesForInterface(metaModel, 'interface-1');

    expect(result.logicalEntityIds).toEqual(['logical-entity-abc123', 'logical-entity-def456']);
    expect(result.physicalEntityIds).toEqual([]);
  });

  it('should parse dep_phy_ format and return correct physicalEntityIds', () => {
    const metaModel = createMetaModel([
      {
        id: 'rel-1',
        interface_id: 'interface-1',
        dataEntityPointId: 'dep_phy_physical-entity-xyz789',
        description: '',
        tags: '',
      },
    ]);
    const result = resolveDataEntitiesForInterface(metaModel, 'interface-1');

    expect(result.logicalEntityIds).toEqual([]);
    expect(result.physicalEntityIds).toEqual(['physical-entity-xyz789']);
  });

  it('should correctly handle mixed relationships with both logical and physical entities', () => {
    const metaModel = createMetaModel([
      {
        id: 'rel-1',
        interface_id: 'interface-1',
        dataEntityPointId: 'dep_log_logical-entity-1',
        description: '',
        tags: '',
      },
      {
        id: 'rel-2',
        interface_id: 'interface-1',
        dataEntityPointId: 'dep_phy_physical-entity-1',
        description: '',
        tags: '',
      },
      {
        id: 'rel-3',
        interface_id: 'interface-1',
        dataEntityPointId: 'dep_log_logical-entity-2',
        description: '',
        tags: '',
      },
      {
        id: 'rel-4',
        interface_id: 'interface-1',
        dataEntityPointId: 'dep_phy_physical-entity-2',
        description: '',
        tags: '',
      },
      // This one is for a different interface - should be excluded
      {
        id: 'rel-5',
        interface_id: 'interface-other',
        dataEntityPointId: 'dep_log_excluded-entity',
        description: '',
        tags: '',
      },
    ]);
    const result = resolveDataEntitiesForInterface(metaModel, 'interface-1');

    expect(result.logicalEntityIds).toEqual(['logical-entity-1', 'logical-entity-2']);
    expect(result.physicalEntityIds).toEqual(['physical-entity-1', 'physical-entity-2']);
  });

  it('should handle invalid dataEntityPointId values gracefully by excluding them', () => {
    const metaModel = createMetaModel([
      {
        id: 'rel-1',
        interface_id: 'interface-1',
        dataEntityPointId: 'dep_log_valid-entity',
        description: '',
        tags: '',
      },
      {
        id: 'rel-2',
        interface_id: 'interface-1',
        dataEntityPointId: 'invalid_format_entity',
        description: '',
        tags: '',
      },
      {
        id: 'rel-3',
        interface_id: 'interface-1',
        dataEntityPointId: '',
        description: '',
        tags: '',
      },
    ]);
    const result = resolveDataEntitiesForInterface(metaModel, 'interface-1');

    // Should only include the valid one, ignoring invalid formats
    expect(result.logicalEntityIds).toEqual(['valid-entity']);
    expect(result.physicalEntityIds).toEqual([]);
  });

  it('should deduplicate entity IDs when the same entity appears multiple times', () => {
    const metaModel = createMetaModel([
      {
        id: 'rel-1',
        interface_id: 'interface-1',
        dataEntityPointId: 'dep_log_duplicate-entity',
        description: 'First reference',
        tags: '',
      },
      {
        id: 'rel-2',
        interface_id: 'interface-1',
        dataEntityPointId: 'dep_log_duplicate-entity',
        description: 'Second reference',
        tags: '',
      },
    ]);
    const result = resolveDataEntitiesForInterface(metaModel, 'interface-1');

    expect(result.logicalEntityIds).toEqual(['duplicate-entity']);
    expect(result.physicalEntityIds).toEqual([]);
  });
});
