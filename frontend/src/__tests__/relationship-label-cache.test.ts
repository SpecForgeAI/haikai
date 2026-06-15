/**
 * Tests for Relationship Cell Label Cache State Management
 *
 * Spec: Standardize Relationship Dropdown Display Labels
 * Task Group 1: Tests for label cache state and actions
 * Task Group 2: Tests for label resolution functions
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Import types and functions for testing
import {
  buildCacheKeyForCell,
  resolveRelationshipCellLabel,
  resolveApplicationPointLabel,
  resolveBusinessPointLabel,
  resolveAppBusinessPointLabel,
  resolveBusinessUserLabel,
  RELATIONSHIP_COLUMN_RESOLVERS,
  RELATIONSHIP_FK_COLUMNS,
  buildLabelsForRelationshipRow,
} from '../utils/relationshipLabelResolver';
import { resolveDataEntityPointLabel } from '../utils/dataEntityPointOptions';
import { MetaModelEntities } from '../types/model';

// ============================================================================
// Test Data Setup
// ============================================================================

function createTestEntities(): MetaModelEntities {
  return {
    business_users: [
      { id: 'bu_001', name: 'John Doe', description: '', tags: '' },
      { id: 'bu_002', name: 'Jane Smith', description: '', tags: '' },
    ],
    business_processes: [
      { id: 'bp_001', name: 'Order Processing', description: '', tags: '' },
    ],
    process_activities: [
      { id: 'pa_001', business_process_id: 'bp_001', name: 'Validate Order', description: '', sequence_order: 1, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
    ],
    business_points: [
      { id: 'bpt_001', name: 'Order Processing', description: '', kind: 'BUSINESS_PROCESS', business_process_id: 'bp_001', tags: '' },
      { id: 'bpt_002', name: 'Validate Order', description: '', kind: 'PROCESS_ACTIVITY', process_activity_id: 'pa_001', tags: '' },
    ],
    applications: [
      { id: 'app_001', name: 'Order Management System', description: '', app_type: '', status: '', tags: '' },
    ],
    app_components: [],
    services: [
      { id: 'svc_001', name: 'Order Service', description: '', application_id: 'app_001', service_type: '', tags: '' },
    ],
    interfaces: [
      { id: 'int_001', name: 'Order API', description: '', service_id: 'svc_001', interface_type: 'REST_API', tags: '' },
    ],
    endpoints: [],
    classes: [
      { id: 'cls_001', name: 'OrderController', description: '', namespace: 'com.example' },
    ],
    methods: [
      { id: 'mth_001', name: 'processOrder', class_id: 'cls_001', description: '' },
    ],
    application_points: [
      { id: 'ap_001', name: 'Order Service', description: '', kind: 'SERVICE', application_id: 'app_001', service_id: 'svc_001', point_type: '', tags: '' },
      { id: 'ap_002', name: 'Order Controller', description: '', kind: 'CLASS', application_id: 'app_001', point_type: '', tags: '', target_type: 'CLASS', target_ref_id: 'cls_001' },
      { id: 'ap_003', name: 'Process Order Method', description: '', kind: 'METHOD', application_id: 'app_001', point_type: '', tags: '', target_type: 'METHOD', target_ref_id: 'mth_001' },
    ],
    logical_data_entities: [
      { id: 'lde_001', name: 'Customer', description: '', tags: '' },
      { id: 'lde_002', name: 'Order', description: '', tags: '' },
    ],
    logical_data_attributes: [],
    physical_data_entities: [
      { id: 'pde_001', name: 'customer_table', description: '', physical_type: 'TABLE', database: 'main_db', tags: '' },
    ],
    physical_data_attributes: [],
    interactions: [],
    app_business_points: [
      { id: 'abp_svc_001', name: 'Order Service', kind: 'SERVICE', source_entity_id: 'svc_001' },
      { id: 'abp_int_001', name: 'Order API', kind: 'INTERFACE', source_entity_id: 'int_001' },
      { id: 'abp_bp_001', name: 'Order Processing', kind: 'BUSINESS_PROCESS', source_entity_id: 'bp_001' },
    ],
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

// ============================================================================
// Test Suite: Cache Key Building (Task Group 1)
// ============================================================================

describe('buildCacheKeyForCell', () => {
  it('should generate correct cache key format', () => {
    const key = buildCacheKeyForCell('data_movements', 'row_123', 'source_application_point_id');
    expect(key).toBe('data_movements:row_123:source_application_point_id');
  });

  it('should handle different relationship keys', () => {
    const key1 = buildCacheKeyForCell('logical_data_entity_relationships', 'row_456', 'fromDataEntityPointId');
    expect(key1).toBe('logical_data_entity_relationships:row_456:fromDataEntityPointId');

    const key2 = buildCacheKeyForCell('interactions', 'row_789', 'user_id');
    expect(key2).toBe('interactions:row_789:user_id');
  });

  it('should handle empty strings in parameters', () => {
    const key = buildCacheKeyForCell('', '', '');
    expect(key).toBe('::');
  });
});

// ============================================================================
// Test Suite: Column to Resolver Mapping (Task Group 1)
// ============================================================================

describe('RELATIONSHIP_COLUMN_RESOLVERS', () => {
  it('should map application_point_id columns to resolveApplicationPointLabel', () => {
    expect(RELATIONSHIP_COLUMN_RESOLVERS['application_point_id']).toBeDefined();
    expect(RELATIONSHIP_COLUMN_RESOLVERS['source_application_point_id']).toBeDefined();
    expect(RELATIONSHIP_COLUMN_RESOLVERS['target_application_point_id']).toBeDefined();
  });

  it('should map business_point_id column to resolveBusinessPointLabel', () => {
    expect(RELATIONSHIP_COLUMN_RESOLVERS['business_point_id']).toBeDefined();
  });

  it('should map data entity point columns to resolveDataEntityPointLabel', () => {
    expect(RELATIONSHIP_COLUMN_RESOLVERS['fromDataEntityPointId']).toBeDefined();
    expect(RELATIONSHIP_COLUMN_RESOLVERS['toDataEntityPointId']).toBeDefined();
    expect(RELATIONSHIP_COLUMN_RESOLVERS['dataEntityPointId']).toBeDefined();
  });

  it('should map user_id columns to resolveBusinessUserLabel', () => {
    expect(RELATIONSHIP_COLUMN_RESOLVERS['user_id']).toBeDefined();
    expect(RELATIONSHIP_COLUMN_RESOLVERS['business_user_id']).toBeDefined();
  });

  it('should map app_business_point columns to resolveAppBusinessPointLabel', () => {
    expect(RELATIONSHIP_COLUMN_RESOLVERS['primary_app_business_point_id']).toBeDefined();
    expect(RELATIONSHIP_COLUMN_RESOLVERS['secondary_app_business_point_id']).toBeDefined();
  });
});

// ============================================================================
// Test Suite: Label Resolution Dispatch (Task Group 1)
// ============================================================================

describe('resolveRelationshipCellLabel', () => {
  let entities: MetaModelEntities;

  beforeEach(() => {
    entities = createTestEntities();
  });

  it('should return empty string for empty fkValue', () => {
    const label = resolveRelationshipCellLabel('application_point_id', '', entities);
    expect(label).toBe('');
  });

  it('should return raw ID as fallback for unknown column', () => {
    const label = resolveRelationshipCellLabel('unknown_column', 'some_id', entities);
    expect(label).toBe('some_id');
  });

  it('should resolve business user label correctly', () => {
    const label = resolveRelationshipCellLabel('user_id', 'bu_001', entities);
    expect(label).toBe('John Doe');
  });

  it('should resolve business user label with business_user_id column', () => {
    const label = resolveRelationshipCellLabel('business_user_id', 'bu_002', entities);
    expect(label).toBe('Jane Smith');
  });

  it('should return raw ID for missing business user', () => {
    const label = resolveRelationshipCellLabel('user_id', 'bu_nonexistent', entities);
    expect(label).toBe('bu_nonexistent');
  });
});

// ============================================================================
// Test Suite: Application Point Label Resolution (Task Group 2)
// ============================================================================

describe('resolveApplicationPointLabel', () => {
  let entities: MetaModelEntities;

  beforeEach(() => {
    entities = createTestEntities();
  });

  it('should return empty string for empty apId', () => {
    const label = resolveApplicationPointLabel('', entities);
    expect(label).toBe('');
  });

  it('should return raw ID for non-existent application point', () => {
    const label = resolveApplicationPointLabel('ap_nonexistent', entities);
    expect(label).toBe('ap_nonexistent');
  });

  it('should return label with kind badge for standard AP', () => {
    const label = resolveApplicationPointLabel('ap_001', entities);
    expect(label).toBe('Order Service [SERVICE]');
  });

  it('should handle derived AP with CLASS target', () => {
    const label = resolveApplicationPointLabel('ap_002', entities);
    expect(label).toBe('OrderController [CLASS]');
  });

  it('should handle derived AP with METHOD target including class name', () => {
    const label = resolveApplicationPointLabel('ap_003', entities);
    expect(label).toBe('OrderController.processOrder [METHOD]');
  });
});

// ============================================================================
// Test Suite: Business Point Label Resolution (Task Group 2)
// ============================================================================

describe('resolveBusinessPointLabel', () => {
  let entities: MetaModelEntities;

  beforeEach(() => {
    entities = createTestEntities();
  });

  it('should return empty string for empty bpId', () => {
    const label = resolveBusinessPointLabel('', entities);
    expect(label).toBe('');
  });

  it('should return raw ID for non-existent business point', () => {
    const label = resolveBusinessPointLabel('bpt_nonexistent', entities);
    expect(label).toBe('bpt_nonexistent');
  });

  it('should return formatted label for BUSINESS_PROCESS kind', () => {
    const label = resolveBusinessPointLabel('bpt_001', entities);
    expect(label).toBe('Order Processing (Business Process)');
  });

  it('should return formatted label for PROCESS_ACTIVITY kind', () => {
    const label = resolveBusinessPointLabel('bpt_002', entities);
    expect(label).toBe('Validate Order (Process Activity)');
  });
});

// ============================================================================
// Test Suite: App Business Point Label Resolution (Task Group 2)
// ============================================================================

describe('resolveAppBusinessPointLabel', () => {
  let entities: MetaModelEntities;

  beforeEach(() => {
    entities = createTestEntities();
  });

  it('should return empty string for empty abpId', () => {
    const label = resolveAppBusinessPointLabel('', entities);
    expect(label).toBe('');
  });

  it('should return raw ID for non-existent app business point', () => {
    const label = resolveAppBusinessPointLabel('abp_nonexistent', entities);
    expect(label).toBe('abp_nonexistent');
  });

  it('should return formatted label for SERVICE kind', () => {
    const label = resolveAppBusinessPointLabel('abp_svc_001', entities);
    expect(label).toBe('Order Service (Service)');
  });

  it('should return formatted label for INTERFACE kind', () => {
    const label = resolveAppBusinessPointLabel('abp_int_001', entities);
    expect(label).toBe('Order API (Interface)');
  });

  it('should return formatted label for BUSINESS_PROCESS kind', () => {
    const label = resolveAppBusinessPointLabel('abp_bp_001', entities);
    expect(label).toBe('Order Processing (Business Process)');
  });
});

// ============================================================================
// Test Suite: Business User Label Resolution (Task Group 2)
// ============================================================================

describe('resolveBusinessUserLabel', () => {
  let entities: MetaModelEntities;

  beforeEach(() => {
    entities = createTestEntities();
  });

  it('should return empty string for empty userId', () => {
    const label = resolveBusinessUserLabel('', entities);
    expect(label).toBe('');
  });

  it('should return raw ID for non-existent user', () => {
    const label = resolveBusinessUserLabel('bu_nonexistent', entities);
    expect(label).toBe('bu_nonexistent');
  });

  it('should return user name without badge', () => {
    const label = resolveBusinessUserLabel('bu_001', entities);
    expect(label).toBe('John Doe');
  });
});

// ============================================================================
// Test Suite: Data Entity Point Label Resolution (Task Group 2)
// ============================================================================

describe('resolveDataEntityPointLabel', () => {
  let entities: MetaModelEntities;

  beforeEach(() => {
    entities = createTestEntities();
  });

  it('should return empty string for empty pointId', () => {
    const label = resolveDataEntityPointLabel('', entities);
    expect(label).toBe('');
  });

  it('should return raw ID for unrecognized point ID format', () => {
    const label = resolveDataEntityPointLabel('invalid_point_id', entities);
    expect(label).toBe('invalid_point_id');
  });

  it('should return formatted label for logical data entity point', () => {
    const label = resolveDataEntityPointLabel('dep_log_lde_001', entities);
    expect(label).toBe('Customer [LOGICAL_DATA_ENTITY]');
  });

  it('should return formatted label for physical data entity point', () => {
    const label = resolveDataEntityPointLabel('dep_phy_pde_001', entities);
    expect(label).toBe('customer_table [PHYSICAL_DATA_ENTITY]');
  });

  it('should return raw ID for logical entity not found', () => {
    const label = resolveDataEntityPointLabel('dep_log_nonexistent', entities);
    expect(label).toBe('dep_log_nonexistent');
  });
});

// ============================================================================
// Test Suite: RELATIONSHIP_FK_COLUMNS Mapping (Task Group 2)
// ============================================================================

describe('RELATIONSHIP_FK_COLUMNS', () => {
  it('should define FK columns for data_movements', () => {
    expect(RELATIONSHIP_FK_COLUMNS['data_movements']).toEqual([
      'source_application_point_id',
      'target_application_point_id',
      'dataEntityPointId',
    ]);
  });

  it('should define FK columns for logical_data_entity_relationships', () => {
    expect(RELATIONSHIP_FK_COLUMNS['logical_data_entity_relationships']).toEqual([
      'fromDataEntityPointId',
      'toDataEntityPointId',
    ]);
  });

  it('should define FK columns for application_point_business_points', () => {
    expect(RELATIONSHIP_FK_COLUMNS['application_point_business_points']).toEqual([
      'application_point_id',
      'business_point_id',
    ]);
  });

  it('should define FK columns for business_user_business_points', () => {
    expect(RELATIONSHIP_FK_COLUMNS['business_user_business_points']).toEqual([
      'business_user_id',
      'business_point_id',
    ]);
  });

  it('should define FK columns for interactions', () => {
    expect(RELATIONSHIP_FK_COLUMNS['interactions']).toEqual([
      'user_id',
      'primary_app_business_point_id',
      'secondary_app_business_point_id',
    ]);
  });

  it('should define FK columns for application_point_business_logics', () => {
    expect(RELATIONSHIP_FK_COLUMNS['application_point_business_logics']).toEqual([
      'application_point_id',
    ]);
  });
});

// ============================================================================
// Test Suite: Build Labels for Relationship Row (Task Group 2)
// ============================================================================

describe('buildLabelsForRelationshipRow', () => {
  let entities: MetaModelEntities;

  beforeEach(() => {
    entities = createTestEntities();
  });

  it('should build labels for data_movements row', () => {
    const row = {
      id: 'dm_001',
      source_application_point_id: 'ap_001',
      target_application_point_id: 'ap_002',
      dataEntityPointId: 'dep_log_lde_001',
    };

    const labels = buildLabelsForRelationshipRow('data_movements', row, entities);

    expect(labels.source_application_point_id).toBe('Order Service [SERVICE]');
    expect(labels.target_application_point_id).toBe('OrderController [CLASS]');
    expect(labels.dataEntityPointId).toBe('Customer [LOGICAL_DATA_ENTITY]');
  });

  it('should build labels for interactions row', () => {
    const row = {
      id: 'int_001',
      user_id: 'bu_001',
      primary_app_business_point_id: 'abp_svc_001',
      secondary_app_business_point_id: 'abp_int_001',
    };

    const labels = buildLabelsForRelationshipRow('interactions', row, entities);

    expect(labels.user_id).toBe('John Doe');
    expect(labels.primary_app_business_point_id).toBe('Order Service (Service)');
    expect(labels.secondary_app_business_point_id).toBe('Order API (Interface)');
  });

  it('should skip empty FK values', () => {
    const row = {
      id: 'dm_001',
      source_application_point_id: 'ap_001',
      target_application_point_id: '', // empty
      dataEntityPointId: null, // null
    };

    const labels = buildLabelsForRelationshipRow('data_movements', row, entities);

    expect(labels.source_application_point_id).toBe('Order Service [SERVICE]');
    expect(labels.target_application_point_id).toBeUndefined();
    expect(labels.dataEntityPointId).toBeUndefined();
  });

  it('should return empty object for unknown relationship type', () => {
    const row = { id: 'row_001', some_field: 'some_value' };
    const labels = buildLabelsForRelationshipRow('unknown_relationship', row, entities);
    expect(labels).toEqual({});
  });
});
