/**
 * productImplementPageRelationshipLabels.test.ts
 *
 * Spec 2026-01-18: Fix Add Context Relationship Labels
 * Task Group 1: Tests for the buildRelationshipPickList call fix in ProductImplementPage
 *
 * Tests:
 * - relationshipOptions contains properly formatted labels when entities are available
 * - Labels use the pipe-separated format: "<name> [<TYPE>] | <name> [<TYPE>]"
 * - Labels no longer show "Unknown Relationship" when entities exist
 */

import { describe, it, expect } from 'vitest';
import {
  buildRelationshipPickList,
} from '../utils/contextPickListBuilders';
import type { MetaModelRelationships, MetaModelEntities } from '../types/model';

describe('ProductImplementPage relationshipOptions fix (Task Group 1)', () => {
  // Mock entities that would be available in model.metaModel.entities
  const mockEntities: MetaModelEntities = {
    business_users: [
      { id: 'user-1', name: 'Alice Admin', description: '', tags: '' },
    ],
    business_points: [
      {
        id: 'bp-1',
        name: 'Order Submission',
        description: '',
        kind: 'BUSINESS_PROCESS',
        business_process_id: 'proc-1',
        tags: '',
      },
    ],
    application_points: [
      {
        id: 'ap-1',
        name: 'Payment Gateway',
        description: '',
        kind: 'SERVICE',
        application_id: 'app-1',
        point_type: '',
        tags: '',
      },
    ],
    interfaces: [
      { id: 'iface-1', name: 'REST API', description: '', tags: '' },
    ],
    logical_data_entities: [
      { id: 'lde-1', name: 'Customer', description: '', tags: '' },
    ],
    physical_data_entities: [
      { id: 'pde-1', name: 'customers_table', description: '', tags: '' },
    ],
    // Empty arrays for other required types
    business_processes: [],
    process_activities: [],
    applications: [],
    app_components: [],
    services: [],
    endpoints: [],
    classes: [],
    methods: [],
    logical_data_attributes: [],
    physical_data_attributes: [],
    interactions: [],
    app_business_points: [],
    business_logics: [],
    events: [],
    states: [],
    state_transitions: [],
    activities: [],
    activity_flows: [],
    activity_partitions: [],
    ui_screens: [],
    ui_components: [],
    ui_actions: [],
    package_sets: [],
    packages: [],
  };

  const mockRelationships: MetaModelRelationships = {
    business_user_business_points: [
      {
        id: 'rel-1',
        business_user_id: 'user-1',
        business_point_id: 'bp-1',
        description: '',
        tags: '',
      },
    ],
    // Use logical_data_entity_physical_data_entities which has required participants
    logical_data_entity_physical_data_entities: [
      {
        id: 'rel-2',
        logical_entity_id: 'lde-1',
        physical_entity_id: 'pde-1',
        tags: '',
      },
    ],
    interface_logical_entities: [],
    application_point_business_points: [],
    application_point_business_logics: [],
    logical_data_entity_relationships: [],
    logical_data_attribute_physical_data_attributes: [],
    data_movements: [],
    ui_workflow_transitions: [],
  };

  it('should contain properly formatted labels when entities are passed to buildRelationshipPickList', () => {
    // This test verifies the fix: passing entities as the second argument
    const result = buildRelationshipPickList(mockRelationships, mockEntities);

    // business_user_business_points should have resolved entity names
    const bubpOptions = result.business_user_business_points;
    expect(bubpOptions).toHaveLength(1);
    expect(bubpOptions[0].label).toContain('Alice Admin');
    expect(bubpOptions[0].label).toContain('Order Submission');
  });

  it('should use pipe-separated format: "<name> [<TYPE>] | <name> [<TYPE>]"', () => {
    // This test verifies the pipe-separated format with entity types
    const result = buildRelationshipPickList(mockRelationships, mockEntities);

    const bubpOptions = result.business_user_business_points;
    expect(bubpOptions[0].label).toContain('[BUSINESS_USER]');
    expect(bubpOptions[0].label).toContain('[BUSINESS_POINT]');
    expect(bubpOptions[0].label).toMatch(/\|/); // Contains pipe separator

    // Check the label is in the expected format
    const label = bubpOptions[0].label;
    const parts = label.split('|');
    expect(parts).toHaveLength(2);
    expect(parts[0].trim()).toContain('Alice Admin');
    expect(parts[1].trim()).toContain('Order Submission');
  });

  it('should NOT show "Unknown Relationship" when entities exist in the model', () => {
    // This test verifies the bug is fixed: no more "Unknown Relationship" labels
    const result = buildRelationshipPickList(mockRelationships, mockEntities);

    // Check all relationship options - none should show "Unknown Relationship"
    for (const key of Object.keys(result) as (keyof typeof result)[]) {
      const options = result[key];
      for (const option of options) {
        expect(option.label).not.toBe('Unknown Relationship');
        // Labels should contain actual entity names
        expect(option.label.length).toBeGreaterThan(0);
      }
    }

    // Specifically check that our test relationships have proper labels with resolved names
    const bubpLabel = result.business_user_business_points[0].label;
    expect(bubpLabel).toContain('Alice Admin');
    expect(bubpLabel).toContain('Order Submission');
    expect(bubpLabel).not.toBe('Unknown Relationship');

    // Also check logical_data_entity_physical_data_entities
    const ldepeLabel = result.logical_data_entity_physical_data_entities[0].label;
    expect(ldepeLabel).toContain('Customer');
    expect(ldepeLabel).toContain('customers_table');
    expect(ldepeLabel).not.toBe('Unknown Relationship');
  });
});
