/**
 * Tests for DEP (Data Entity Point) Label Resolution
 *
 * Spec: Fix Context Picker DEP Labels and Add Select All
 * Task Group 1: DEP Label Resolution
 *
 * Tests for:
 * - parseDepId() function - parsing DEP IDs into type and entityId
 * - resolveDepEntityName() function - resolving DEP IDs to entity names
 * - Enhanced createEntityLookupFromMetaModel() with DEP ID handling
 * - computeRelationshipLabel() correctly uses resolved DEP labels
 */

import { describe, it, expect } from 'vitest';
import {
  parseDepId,
  resolveDepEntityName,
  DATA_ENTITY_POINT_PREFIXES,
  DATA_ENTITY_TYPE_BADGES,
} from '../utils/dataEntityPointOptions';
import { createEntityLookupFromMetaModel } from '../utils/contextPickListBuilders';
import { computeRelationshipLabel } from '../utils/contextRelationshipLabelUtils';
import type { MetaModelEntities, MetaModel } from '../types/model';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a minimal MetaModelEntities structure for testing
 */
function createMockEntities(
  logicalEntities: Array<{ id: string; name: string }> = [],
  physicalEntities: Array<{ id: string; name: string }> = []
): MetaModelEntities {
  return {
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
    logical_data_entities: logicalEntities.map((e) => ({
      id: e.id,
      name: e.name,
      description: '',
      tags: '',
    })),
    logical_data_attributes: [],
    physical_data_entities: physicalEntities.map((e) => ({
      id: e.id,
      name: e.name,
      description: '',
      physical_type: '',
      database: '',
      tags: '',
    })),
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
  };
}

/**
 * Create a minimal MetaModel structure for testing
 */
function createMockMetaModel(
  logicalEntities: Array<{ id: string; name: string }> = [],
  physicalEntities: Array<{ id: string; name: string }> = []
): MetaModel {
  return {
    entities: createMockEntities(logicalEntities, physicalEntities),
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      application_point_business_logics: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
      ui_workflow_transitions: [],
    },
  };
}

// ============================================================================
// parseDepId() Tests
// ============================================================================

describe('parseDepId', () => {
  it('should parse dep_log_<id> format and return logical type with entityId', () => {
    const result = parseDepId('dep_log_entity_123');

    expect(result).not.toBeNull();
    expect(result?.type).toBe('logical');
    expect(result?.entityId).toBe('entity_123');
  });

  it('should parse dep_phy_<id> format and return physical type with entityId', () => {
    const result = parseDepId('dep_phy_table_456');

    expect(result).not.toBeNull();
    expect(result?.type).toBe('physical');
    expect(result?.entityId).toBe('table_456');
  });

  it('should return null for non-DEP IDs (regular entity IDs)', () => {
    expect(parseDepId('entity_123')).toBeNull();
    expect(parseDepId('regular_id')).toBeNull();
    expect(parseDepId('application_point_abc')).toBeNull();
  });

  it('should return null for empty, null, or undefined input', () => {
    expect(parseDepId('')).toBeNull();
    expect(parseDepId(null as unknown as string)).toBeNull();
    expect(parseDepId(undefined as unknown as string)).toBeNull();
  });

  it('should handle DEP IDs with complex underlying entity IDs', () => {
    // UUID-style entity ID
    const uuidResult = parseDepId('dep_log_550e8400-e29b-41d4-a716-446655440000');
    expect(uuidResult).not.toBeNull();
    expect(uuidResult?.type).toBe('logical');
    expect(uuidResult?.entityId).toBe('550e8400-e29b-41d4-a716-446655440000');

    // Entity ID containing underscores
    const underscoreResult = parseDepId('dep_phy_my_physical_table_id');
    expect(underscoreResult).not.toBeNull();
    expect(underscoreResult?.type).toBe('physical');
    expect(underscoreResult?.entityId).toBe('my_physical_table_id');
  });
});

// ============================================================================
// resolveDepEntityName() Tests
// ============================================================================

describe('resolveDepEntityName', () => {
  it('should return correct entity name for dep_log_<id> format when entity exists', () => {
    const metaModel = createMockMetaModel(
      [{ id: 'log_1', name: 'Customer' }],
      []
    );

    const name = resolveDepEntityName('dep_log_log_1', metaModel);

    expect(name).toBe('Customer');
  });

  it('should return correct entity name for dep_phy_<id> format when entity exists', () => {
    const metaModel = createMockMetaModel(
      [],
      [{ id: 'phy_1', name: 'customers_table' }]
    );

    const name = resolveDepEntityName('dep_phy_phy_1', metaModel);

    expect(name).toBe('customers_table');
  });

  it('should return "Unknown" when underlying logical entity not found', () => {
    const metaModel = createMockMetaModel([], []);

    const name = resolveDepEntityName('dep_log_nonexistent', metaModel);

    expect(name).toBe('Unknown');
  });

  it('should return "Unknown" when underlying physical entity not found', () => {
    const metaModel = createMockMetaModel([], []);

    const name = resolveDepEntityName('dep_phy_nonexistent', metaModel);

    expect(name).toBe('Unknown');
  });

  it('should return null for non-DEP IDs', () => {
    const metaModel = createMockMetaModel(
      [{ id: 'regular_id', name: 'Regular Entity' }],
      []
    );

    const name = resolveDepEntityName('regular_id', metaModel);

    expect(name).toBeNull();
  });
});

// ============================================================================
// createEntityLookupFromMetaModel() with DEP ID handling Tests
// ============================================================================

describe('createEntityLookupFromMetaModel with DEP ID handling', () => {
  it('should resolve DEP-prefixed logical entity IDs to entity names', () => {
    const entities = createMockEntities(
      [{ id: 'log_1', name: 'Customer' }],
      []
    );

    const lookup = createEntityLookupFromMetaModel(entities);
    const name = lookup('dep_log_log_1');

    expect(name).toBe('Customer');
  });

  it('should resolve DEP-prefixed physical entity IDs to entity names', () => {
    const entities = createMockEntities(
      [],
      [{ id: 'phy_1', name: 'orders_table' }]
    );

    const lookup = createEntityLookupFromMetaModel(entities);
    const name = lookup('dep_phy_phy_1');

    expect(name).toBe('orders_table');
  });

  it('should still resolve regular (non-DEP) entity IDs as before', () => {
    const entities = createMockEntities([], []);
    // Add a regular entity that would be found via standard lookup
    entities.applications = [
      { id: 'app_1', name: 'MyApp', description: '', tags: '' },
    ];

    const lookup = createEntityLookupFromMetaModel(entities);
    const name = lookup('app_1');

    expect(name).toBe('MyApp');
  });

  it('should return null for DEP IDs when underlying entity not found', () => {
    const entities = createMockEntities([], []);

    const lookup = createEntityLookupFromMetaModel(entities);
    const name = lookup('dep_log_nonexistent');

    expect(name).toBeNull();
  });

  it('should return null for non-existent regular entity IDs', () => {
    const entities = createMockEntities([], []);

    const lookup = createEntityLookupFromMetaModel(entities);
    const name = lookup('nonexistent_entity');

    expect(name).toBeNull();
  });
});

// ============================================================================
// computeRelationshipLabel() with DEP resolution Tests
// ============================================================================

describe('computeRelationshipLabel with DEP resolution', () => {
  it('should render resolved DEP entity name with concrete type badge for logical_data_entity_relationships', () => {
    const entities = createMockEntities(
      [
        { id: 'log_1', name: 'Customer' },
        { id: 'log_2', name: 'Order' },
      ],
      []
    );
    const lookup = createEntityLookupFromMetaModel(entities);

    const relationship = {
      id: 'rel_1',
      fromDataEntityPointId: 'dep_log_log_1',
      toDataEntityPointId: 'dep_log_log_2',
    };

    const label = computeRelationshipLabel(
      relationship,
      'logical_data_entity_relationships',
      lookup
    );

    // Should show entity names with LOGICAL_DATA_ENTITY badge
    expect(label).toContain('Customer');
    expect(label).toContain('Order');
    expect(label).toContain('[LOGICAL_DATA_ENTITY]');
    expect(label).not.toContain('[DATA_ENTITY_POINT]');
  });

  it('should render resolved DEP entity name with concrete type badge for interface_logical_entities', () => {
    const entities = createMockEntities(
      [{ id: 'log_1', name: 'Product' }],
      []
    );
    entities.interfaces = [
      {
        id: 'iface_1',
        name: 'ProductAPI',
        description: '',
        tags: '',
      } as any,
    ];
    const lookup = createEntityLookupFromMetaModel(entities);

    const relationship = {
      id: 'rel_1',
      interface_id: 'iface_1',
      dataEntityPointId: 'dep_log_log_1',
    };

    const label = computeRelationshipLabel(
      relationship,
      'interface_logical_entities',
      lookup
    );

    expect(label).toContain('ProductAPI');
    expect(label).toContain('Product');
    expect(label).toContain('[LOGICAL_DATA_ENTITY]');
    expect(label).not.toContain('[DATA_ENTITY_POINT]');
  });

  it('should render physical entity with PHYSICAL_DATA_ENTITY badge in data_movements', () => {
    const entities = createMockEntities(
      [],
      [{ id: 'phy_1', name: 'orders_table' }]
    );
    entities.application_points = [
      { id: 'ap_1', name: 'OrderService.submit' } as any,
      { id: 'ap_2', name: 'InventoryService.check' } as any,
    ];
    const lookup = createEntityLookupFromMetaModel(entities);

    const relationship = {
      id: 'rel_1',
      source_application_point_id: 'ap_1',
      target_application_point_id: 'ap_2',
      dataEntityPointId: 'dep_phy_phy_1',
    };

    const label = computeRelationshipLabel(
      relationship,
      'data_movements',
      lookup
    );

    expect(label).toContain('orders_table');
    expect(label).toContain('[PHYSICAL_DATA_ENTITY]');
    expect(label).not.toContain('[DATA_ENTITY_POINT]');
  });

  it('should show "Unknown [LOGICAL_DATA_ENTITY]" when logical entity not found', () => {
    const entities = createMockEntities([], []);
    const lookup = createEntityLookupFromMetaModel(entities);

    const relationship = {
      id: 'rel_1',
      fromDataEntityPointId: 'dep_log_nonexistent',
      toDataEntityPointId: 'dep_log_also_nonexistent',
    };

    const label = computeRelationshipLabel(
      relationship,
      'logical_data_entity_relationships',
      lookup
    );

    expect(label).toContain('Unknown [LOGICAL_DATA_ENTITY]');
    expect(label).not.toContain('[DATA_ENTITY_POINT]');
  });

  it('should show "Unknown [PHYSICAL_DATA_ENTITY]" when physical entity not found', () => {
    const entities = createMockEntities([], []);
    entities.application_points = [
      { id: 'ap_1', name: 'SomePoint' } as any,
    ];
    const lookup = createEntityLookupFromMetaModel(entities);

    const relationship = {
      id: 'rel_1',
      source_application_point_id: 'ap_1',
      dataEntityPointId: 'dep_phy_nonexistent',
    };

    const label = computeRelationshipLabel(
      relationship,
      'data_movements',
      lookup
    );

    expect(label).toContain('Unknown [PHYSICAL_DATA_ENTITY]');
    expect(label).not.toContain('[DATA_ENTITY_POINT]');
  });

  it('should not affect non-DEP participants (no regression)', () => {
    const entities = createMockEntities([], []);
    entities.business_users = [
      { id: 'user_1', name: 'John Doe', description: '', tags: '' },
    ];
    entities.business_points = [
      { id: 'bp_1', name: 'Login Process' } as any,
    ];
    const lookup = createEntityLookupFromMetaModel(entities);

    const relationship = {
      id: 'rel_1',
      business_user_id: 'user_1',
      business_point_id: 'bp_1',
    };

    const label = computeRelationshipLabel(
      relationship,
      'business_user_business_points',
      lookup
    );

    // Should render normally without any DEP-related changes
    expect(label).toBe('John Doe [BUSINESS_USER] | Login Process [BUSINESS_POINT]');
    expect(label).not.toContain('Unknown');
    expect(label).not.toContain('DATA_ENTITY_POINT');
    expect(label).not.toContain('LOGICAL_DATA_ENTITY');
    expect(label).not.toContain('PHYSICAL_DATA_ENTITY');
  });
});
