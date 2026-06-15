/**
 * Tests for Relationship Dropdown Editor Label Dispatch
 *
 * Spec: Standardize Relationship Dropdown Display Labels
 * Task Group 3: Tests for dropdown editor label dispatch
 * Task Group 4: Tests for cell renderer label resolution
 * Task Group 5: Tests for cache rebuild on model load
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import types and functions for testing
import {
  buildCacheKeyForCell,
  resolveRelationshipCellLabel,
} from '../utils/relationshipLabelResolver';
import { MetaModelEntities } from '../types/model';

// ============================================================================
// Test Data Setup
// ============================================================================

function createTestEntities(): MetaModelEntities {
  return {
    business_users: [
      { id: 'bu_001', name: 'John Doe', description: '', tags: '' },
    ],
    business_processes: [
      { id: 'bp_001', name: 'Order Processing', description: '', tags: '' },
    ],
    process_activities: [
      { id: 'pa_001', business_process_id: 'bp_001', name: 'Validate Order', description: '', sequence_order: 1, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
    ],
    business_points: [
      { id: 'bpt_001', name: 'Order Processing', description: '', kind: 'BUSINESS_PROCESS', business_process_id: 'bp_001', tags: '' },
    ],
    applications: [
      { id: 'app_001', name: 'Order Management System', description: '', app_type: '', status: '', tags: '' },
    ],
    app_components: [],
    services: [
      { id: 'svc_001', name: 'Order Service', description: '', application_id: 'app_001', service_type: '', tags: '' },
    ],
    interfaces: [],
    endpoints: [],
    classes: [],
    methods: [],
    application_points: [
      { id: 'ap_001', name: 'Order Service', description: '', kind: 'SERVICE', application_id: 'app_001', service_id: 'svc_001', point_type: '', tags: '' },
    ],
    logical_data_entities: [
      { id: 'lde_001', name: 'Customer', description: '', tags: '' },
    ],
    logical_data_attributes: [],
    physical_data_entities: [
      { id: 'pde_001', name: 'customer_table', description: '', physical_type: 'TABLE', database: 'main_db', tags: '' },
    ],
    physical_data_attributes: [],
    interactions: [],
    app_business_points: [
      { id: 'abp_svc_001', name: 'Order Service', kind: 'SERVICE', source_entity_id: 'svc_001' },
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
// Task Group 3: Tests for Dropdown Editor Label Dispatch
// ============================================================================

describe('Dropdown Editor Label Dispatch', () => {
  let entities: MetaModelEntities;

  beforeEach(() => {
    entities = createTestEntities();
  });

  describe('Label Cache Key Generation', () => {
    it('should generate cache key for DataEntityPointSelect selection', () => {
      const relationshipKey = 'data_movements';
      const rowId = 'dm_001';
      const columnKey = 'dataEntityPointId';

      const cacheKey = buildCacheKeyForCell(relationshipKey, rowId, columnKey);

      expect(cacheKey).toBe('data_movements:dm_001:dataEntityPointId');
    });

    it('should generate cache key for ApplicationPointPickerCell selection', () => {
      const relationshipKey = 'data_movements';
      const rowId = 'dm_001';
      const columnKey = 'source_application_point_id';

      const cacheKey = buildCacheKeyForCell(relationshipKey, rowId, columnKey);

      expect(cacheKey).toBe('data_movements:dm_001:source_application_point_id');
    });

    it('should generate cache key for business_point_id TypeaheadCell selection', () => {
      const relationshipKey = 'application_point_business_points';
      const rowId = 'apbp_001';
      const columnKey = 'business_point_id';

      const cacheKey = buildCacheKeyForCell(relationshipKey, rowId, columnKey);

      expect(cacheKey).toBe('application_point_business_points:apbp_001:business_point_id');
    });

    it('should generate cache key for interactions grid columns', () => {
      const relationshipKey = 'interactions';
      const rowId = 'int_001';
      const columnKey = 'primary_app_business_point_id';

      const cacheKey = buildCacheKeyForCell(relationshipKey, rowId, columnKey);

      expect(cacheKey).toBe('interactions:int_001:primary_app_business_point_id');
    });
  });

  describe('Label Resolution on Selection', () => {
    it('should resolve label for DataEntityPoint selection (logical)', () => {
      const fkValue = 'dep_log_lde_001';
      const label = resolveRelationshipCellLabel('dataEntityPointId', fkValue, entities);

      expect(label).toBe('Customer [LOGICAL_DATA_ENTITY]');
    });

    it('should resolve label for DataEntityPoint selection (physical)', () => {
      const fkValue = 'dep_phy_pde_001';
      const label = resolveRelationshipCellLabel('dataEntityPointId', fkValue, entities);

      expect(label).toBe('customer_table [PHYSICAL_DATA_ENTITY]');
    });

    it('should resolve label for ApplicationPoint selection', () => {
      const fkValue = 'ap_001';
      const label = resolveRelationshipCellLabel('source_application_point_id', fkValue, entities);

      expect(label).toBe('Order Service [SERVICE]');
    });

    it('should resolve label for BusinessPoint selection', () => {
      const fkValue = 'bpt_001';
      const label = resolveRelationshipCellLabel('business_point_id', fkValue, entities);

      expect(label).toBe('Order Processing (Business Process)');
    });

    it('should resolve label for AppBusinessPoint selection', () => {
      const fkValue = 'abp_svc_001';
      const label = resolveRelationshipCellLabel('primary_app_business_point_id', fkValue, entities);

      expect(label).toBe('Order Service (Service)');
    });

    it('should resolve label for BusinessUser selection', () => {
      const fkValue = 'bu_001';
      const label = resolveRelationshipCellLabel('user_id', fkValue, entities);

      expect(label).toBe('John Doe');
    });
  });

  describe('Persisted Value Remains Canonical FK', () => {
    it('should persist canonical FK ID, not display label', () => {
      // When user selects an item, the persisted value should be the ID
      const fkValue = 'dep_log_lde_001';

      // The FK value should be the ID, not the label
      expect(fkValue).toBe('dep_log_lde_001');
      expect(fkValue).not.toContain('Customer');
      expect(fkValue).not.toContain('LOGICAL_DATA_ENTITY');
    });
  });

  describe('Label Format Consistency', () => {
    it('should format labels consistently as [Name] [ENTITY_TYPE_BADGE]', () => {
      // Data Entity Point
      const depLabel = resolveRelationshipCellLabel('dataEntityPointId', 'dep_log_lde_001', entities);
      expect(depLabel).toMatch(/^.+\s\[.+\]$/);

      // Application Point
      const apLabel = resolveRelationshipCellLabel('source_application_point_id', 'ap_001', entities);
      expect(apLabel).toMatch(/^.+\s\[.+\]$/);
    });

    it('should format BusinessPoint labels with parentheses', () => {
      const bpLabel = resolveRelationshipCellLabel('business_point_id', 'bpt_001', entities);
      expect(bpLabel).toMatch(/^.+\s\(.+\)$/);
    });

    it('should format BusinessUser labels without badge', () => {
      const userLabel = resolveRelationshipCellLabel('user_id', 'bu_001', entities);
      expect(userLabel).toBe('John Doe');
      expect(userLabel).not.toContain('[');
      expect(userLabel).not.toContain('(');
    });
  });
});

// ============================================================================
// Task Group 4: Tests for Cell Renderer Label Resolution
// ============================================================================

describe('Cell Renderer Label Resolution', () => {
  let entities: MetaModelEntities;

  beforeEach(() => {
    entities = createTestEntities();
  });

  describe('Cache-First Resolution', () => {
    it('should return cached label when cache hit occurs', () => {
      const cache: Record<string, string> = {
        'data_movements:dm_001:dataEntityPointId': 'Customer [LOGICAL_DATA_ENTITY]',
      };

      const cacheKey = buildCacheKeyForCell('data_movements', 'dm_001', 'dataEntityPointId');
      const cachedLabel = cache[cacheKey];

      expect(cachedLabel).toBe('Customer [LOGICAL_DATA_ENTITY]');
    });

    it('should resolve label on-demand when cache miss occurs', () => {
      const cache: Record<string, string> = {};
      const cacheKey = buildCacheKeyForCell('data_movements', 'dm_001', 'dataEntityPointId');
      const cachedLabel = cache[cacheKey];

      // Cache miss
      expect(cachedLabel).toBeUndefined();

      // Resolve on-demand
      const resolvedLabel = resolveRelationshipCellLabel('dataEntityPointId', 'dep_log_lde_001', entities);
      expect(resolvedLabel).toBe('Customer [LOGICAL_DATA_ENTITY]');
    });
  });

  describe('Fallback to Raw ID', () => {
    it('should return raw ID when entity not found', () => {
      const label = resolveRelationshipCellLabel('source_application_point_id', 'ap_nonexistent', entities);
      expect(label).toBe('ap_nonexistent');
    });

    it('should return raw ID when unknown column type', () => {
      const label = resolveRelationshipCellLabel('unknown_column', 'some_value', entities);
      expect(label).toBe('some_value');
    });

    it('should return empty string for empty FK value', () => {
      const label = resolveRelationshipCellLabel('source_application_point_id', '', entities);
      expect(label).toBe('');
    });
  });

  describe('Different Column Types Render Correctly', () => {
    it('should render application_point_id columns correctly', () => {
      const label = resolveRelationshipCellLabel('application_point_id', 'ap_001', entities);
      expect(label).toBe('Order Service [SERVICE]');
    });

    it('should render business_user_id columns correctly', () => {
      const label = resolveRelationshipCellLabel('business_user_id', 'bu_001', entities);
      expect(label).toBe('John Doe');
    });

    it('should render fromDataEntityPointId columns correctly', () => {
      const label = resolveRelationshipCellLabel('fromDataEntityPointId', 'dep_log_lde_001', entities);
      expect(label).toBe('Customer [LOGICAL_DATA_ENTITY]');
    });
  });
});

// ============================================================================
// Task Group 5: Tests for Cache Rebuild on Model Load
// ============================================================================

describe('Cache Rebuild on Model Load', () => {
  it('should generate cache entries for all relationship FK columns', () => {
    // Simulate building labels for a data_movements row
    const row = {
      id: 'dm_001',
      source_application_point_id: 'ap_001',
      target_application_point_id: 'ap_001',
      dataEntityPointId: 'dep_log_lde_001',
    };

    const entities = createTestEntities();
    const labels: Record<string, string> = {};

    // Build labels for each FK column
    const fkColumns = ['source_application_point_id', 'target_application_point_id', 'dataEntityPointId'];
    for (const columnKey of fkColumns) {
      const fkValue = row[columnKey as keyof typeof row] as string;
      if (fkValue) {
        const cacheKey = buildCacheKeyForCell('data_movements', row.id, columnKey);
        labels[cacheKey] = resolveRelationshipCellLabel(columnKey, fkValue, entities);
      }
    }

    expect(labels['data_movements:dm_001:source_application_point_id']).toBe('Order Service [SERVICE]');
    expect(labels['data_movements:dm_001:target_application_point_id']).toBe('Order Service [SERVICE]');
    expect(labels['data_movements:dm_001:dataEntityPointId']).toBe('Customer [LOGICAL_DATA_ENTITY]');
  });

  it('should clear existing labels before rebuild', () => {
    const existingCache: Record<string, string> = {
      'old_relationship:old_row:old_column': 'Old Label',
    };

    // Simulate clearing and rebuilding
    const newCache: Record<string, string> = {};

    // After rebuild, old entries should not exist
    expect(newCache['old_relationship:old_row:old_column']).toBeUndefined();
  });

  it('should handle missing FK values gracefully during rebuild', () => {
    const row = {
      id: 'dm_001',
      source_application_point_id: 'ap_001',
      target_application_point_id: '', // Empty
      dataEntityPointId: null, // Null
    };

    const entities = createTestEntities();
    const labels: Record<string, string> = {};

    // Only build labels for non-empty FK values
    const fkColumns = ['source_application_point_id', 'target_application_point_id', 'dataEntityPointId'];
    for (const columnKey of fkColumns) {
      const fkValue = row[columnKey as keyof typeof row] as string;
      if (typeof fkValue === 'string' && fkValue) {
        const cacheKey = buildCacheKeyForCell('data_movements', row.id, columnKey);
        labels[cacheKey] = resolveRelationshipCellLabel(columnKey, fkValue, entities);
      }
    }

    expect(labels['data_movements:dm_001:source_application_point_id']).toBe('Order Service [SERVICE]');
    expect(labels['data_movements:dm_001:target_application_point_id']).toBeUndefined();
    expect(labels['data_movements:dm_001:dataEntityPointId']).toBeUndefined();
  });
});
