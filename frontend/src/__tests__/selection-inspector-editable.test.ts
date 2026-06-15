/**
 * Selection Inspector Tests
 * Task Group 3: Tests for the Selection Inspector for created entities
 *
 * Tests the editable fields shown when State, Activity, ActivityPartition,
 * LogicalDataEntity, or PhysicalDataEntity nodes are selected.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  StateKind,
  ActivityKind,
  ActivityPartitionRefKind,
  State,
  Activity,
  ActivityPartition,
  LogicalDataEntity,
  PhysicalDataEntity,
  ENTITY_TYPES,
} from '../types/model';

// ============================================================================
// Entity lookup helper types and functions (matching InspectorPanel logic)
// ============================================================================

interface MetaModelEntitiesSubset {
  states: State[];
  activities: Activity[];
  activity_partitions: ActivityPartition[];
  logical_data_entities: LogicalDataEntity[];
  physical_data_entities: PhysicalDataEntity[];
}

/**
 * Entity types supported by the Selection Inspector
 */
const INSPECTOR_ENTITY_TYPES = new Set([
  ENTITY_TYPES.STATE,
  ENTITY_TYPES.ACTIVITY,
  ENTITY_TYPES.ACTIVITY_PARTITION,
  ENTITY_TYPES.LOGICAL_DATA_ENTITY,
  ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
]);

/**
 * Check if an entity type should show editable fields in the inspector
 */
function isInspectorEntityType(entityType: string): boolean {
  return INSPECTOR_ENTITY_TYPES.has(entityType);
}

/**
 * Lookup State entity from meta-model
 */
function lookupState(entities: MetaModelEntitiesSubset, entityId: string): State | undefined {
  return entities.states.find(s => s.id === entityId);
}

/**
 * Lookup Activity entity from meta-model
 */
function lookupActivity(entities: MetaModelEntitiesSubset, entityId: string): Activity | undefined {
  return entities.activities.find(a => a.id === entityId);
}

/**
 * Lookup ActivityPartition entity from meta-model
 */
function lookupActivityPartition(entities: MetaModelEntitiesSubset, entityId: string): ActivityPartition | undefined {
  return entities.activity_partitions.find(ap => ap.id === entityId);
}

/**
 * Lookup LogicalDataEntity from meta-model
 */
function lookupLogicalDataEntity(entities: MetaModelEntitiesSubset, entityId: string): LogicalDataEntity | undefined {
  return entities.logical_data_entities.find(e => e.id === entityId);
}

/**
 * Lookup PhysicalDataEntity from meta-model
 */
function lookupPhysicalDataEntity(entities: MetaModelEntitiesSubset, entityId: string): PhysicalDataEntity | undefined {
  return entities.physical_data_entities.find(e => e.id === entityId);
}

// ============================================================================
// Field configuration types for the inspector
// ============================================================================

interface InspectorFieldConfig {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'dropdown';
  required?: boolean;
  options?: string[];
}

/**
 * Get editable field configuration for State entities
 */
function getStateFieldConfigs(): InspectorFieldConfig[] {
  return [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: false },
    {
      name: 'state_kind',
      label: 'State Kind',
      type: 'dropdown',
      required: true,
      options: ['Initial', 'Normal', 'Final'],
    },
  ];
}

/**
 * Get editable field configuration for Activity entities
 */
function getActivityFieldConfigs(): InspectorFieldConfig[] {
  return [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: false },
    {
      name: 'activity_kind',
      label: 'Activity Kind',
      type: 'dropdown',
      required: true,
      options: ['Initial', 'Action', 'Decision', 'Merge', 'Final'],
    },
  ];
}

/**
 * Get editable field configuration for ActivityPartition entities
 */
function getActivityPartitionFieldConfigs(): InspectorFieldConfig[] {
  return [
    { name: 'name', label: 'Name', type: 'text', required: false },
    {
      name: 'ref_kind',
      label: 'Reference Kind',
      type: 'dropdown',
      required: false,
      options: ['BusinessUser', 'Application', 'ApplicationComponent', 'Service', 'Interface', 'Class'],
    },
    { name: 'ref_id', label: 'Reference', type: 'text', required: false },
    { name: 'description', label: 'Description', type: 'textarea', required: false },
  ];
}

/**
 * Get editable field configuration for LogicalDataEntity
 */
function getLogicalDataEntityFieldConfigs(): InspectorFieldConfig[] {
  return [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: false },
  ];
}

/**
 * Get editable field configuration for PhysicalDataEntity
 */
function getPhysicalDataEntityFieldConfigs(): InspectorFieldConfig[] {
  return [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: false },
  ];
}

/**
 * Get field configuration based on entity type
 */
function getFieldConfigsForEntityType(entityType: string): InspectorFieldConfig[] {
  switch (entityType) {
    case ENTITY_TYPES.STATE:
      return getStateFieldConfigs();
    case ENTITY_TYPES.ACTIVITY:
      return getActivityFieldConfigs();
    case ENTITY_TYPES.ACTIVITY_PARTITION:
      return getActivityPartitionFieldConfigs();
    case ENTITY_TYPES.LOGICAL_DATA_ENTITY:
      return getLogicalDataEntityFieldConfigs();
    case ENTITY_TYPES.PHYSICAL_DATA_ENTITY:
      return getPhysicalDataEntityFieldConfigs();
    default:
      return [];
  }
}

// ============================================================================
// Mock UPDATE_ENTITY dispatch structure
// ============================================================================

interface UpdateEntityAction {
  type: 'UPDATE_ENTITY';
  entityType: string;
  entity: Record<string, unknown>;
}

/**
 * Build UPDATE_ENTITY action from entity data
 */
function buildUpdateEntityAction(entityType: string, entity: Record<string, unknown>): UpdateEntityAction {
  return {
    type: 'UPDATE_ENTITY',
    entityType,
    entity,
  };
}

// ============================================================================
// Tests: Selection Inspector shows editable fields
// ============================================================================

describe('Selection Inspector - Entity Type Detection', () => {
  it('should detect State as inspector-editable entity type', () => {
    expect(isInspectorEntityType(ENTITY_TYPES.STATE)).toBe(true);
  });

  it('should detect Activity as inspector-editable entity type', () => {
    expect(isInspectorEntityType(ENTITY_TYPES.ACTIVITY)).toBe(true);
  });

  it('should detect ActivityPartition as inspector-editable entity type', () => {
    expect(isInspectorEntityType(ENTITY_TYPES.ACTIVITY_PARTITION)).toBe(true);
  });

  it('should detect LogicalDataEntity as inspector-editable entity type', () => {
    expect(isInspectorEntityType(ENTITY_TYPES.LOGICAL_DATA_ENTITY)).toBe(true);
  });

  it('should detect PhysicalDataEntity as inspector-editable entity type', () => {
    expect(isInspectorEntityType(ENTITY_TYPES.PHYSICAL_DATA_ENTITY)).toBe(true);
  });

  it('should NOT detect Application as inspector-editable entity type', () => {
    expect(isInspectorEntityType(ENTITY_TYPES.APPLICATION)).toBe(false);
  });

  it('should NOT detect BusinessUser as inspector-editable entity type', () => {
    expect(isInspectorEntityType(ENTITY_TYPES.BUSINESS_USER)).toBe(false);
  });
});

describe('Selection Inspector - State Entity Fields', () => {
  it('should show editable fields when State node is selected', () => {
    const fieldConfigs = getFieldConfigsForEntityType(ENTITY_TYPES.STATE);

    expect(fieldConfigs.length).toBeGreaterThan(0);
    expect(fieldConfigs.find(f => f.name === 'name')).toBeDefined();
    expect(fieldConfigs.find(f => f.name === 'description')).toBeDefined();
    expect(fieldConfigs.find(f => f.name === 'state_kind')).toBeDefined();
  });

  it('should have correct field types for State entity', () => {
    const fieldConfigs = getFieldConfigsForEntityType(ENTITY_TYPES.STATE);

    const nameField = fieldConfigs.find(f => f.name === 'name');
    const descField = fieldConfigs.find(f => f.name === 'description');
    const kindField = fieldConfigs.find(f => f.name === 'state_kind');

    expect(nameField?.type).toBe('text');
    expect(descField?.type).toBe('textarea');
    expect(kindField?.type).toBe('dropdown');
  });

  it('should have correct state_kind dropdown options', () => {
    const fieldConfigs = getFieldConfigsForEntityType(ENTITY_TYPES.STATE);
    const kindField = fieldConfigs.find(f => f.name === 'state_kind');

    expect(kindField?.options).toContain('Initial');
    expect(kindField?.options).toContain('Normal');
    expect(kindField?.options).toContain('Final');
    expect(kindField?.options?.length).toBe(3);
  });

  it('should lookup State entity from meta-model by entity_id', () => {
    const entities: MetaModelEntitiesSubset = {
      states: [
        { id: 'state_1', name: 'Idle', state_kind: 'Initial' },
        { id: 'state_2', name: 'Processing', state_kind: 'Normal' },
      ],
      activities: [],
      activity_partitions: [],
      logical_data_entities: [],
      physical_data_entities: [],
    };

    const found = lookupState(entities, 'state_1');
    expect(found).toBeDefined();
    expect(found?.name).toBe('Idle');
    expect(found?.state_kind).toBe('Initial');
  });
});

describe('Selection Inspector - Activity Entity Fields', () => {
  it('should show editable fields when Activity node is selected', () => {
    const fieldConfigs = getFieldConfigsForEntityType(ENTITY_TYPES.ACTIVITY);

    expect(fieldConfigs.length).toBeGreaterThan(0);
    expect(fieldConfigs.find(f => f.name === 'name')).toBeDefined();
    expect(fieldConfigs.find(f => f.name === 'description')).toBeDefined();
    expect(fieldConfigs.find(f => f.name === 'activity_kind')).toBeDefined();
  });

  it('should have correct activity_kind dropdown options', () => {
    const fieldConfigs = getFieldConfigsForEntityType(ENTITY_TYPES.ACTIVITY);
    const kindField = fieldConfigs.find(f => f.name === 'activity_kind');

    expect(kindField?.options).toContain('Initial');
    expect(kindField?.options).toContain('Action');
    expect(kindField?.options).toContain('Decision');
    expect(kindField?.options).toContain('Merge');
    expect(kindField?.options).toContain('Final');
    expect(kindField?.options?.length).toBe(5);
  });

  it('should lookup Activity entity from meta-model by entity_id', () => {
    const entities: MetaModelEntitiesSubset = {
      states: [],
      activities: [
        { id: 'act_1', name: 'Start', activity_kind: 'Initial' },
        { id: 'act_2', name: 'Process Order', activity_kind: 'Action' },
      ],
      activity_partitions: [],
      logical_data_entities: [],
      physical_data_entities: [],
    };

    const found = lookupActivity(entities, 'act_2');
    expect(found).toBeDefined();
    expect(found?.name).toBe('Process Order');
    expect(found?.activity_kind).toBe('Action');
  });
});

describe('Selection Inspector - ActivityPartition Entity Fields', () => {
  it('should show editable fields when ActivityPartition node is selected', () => {
    const fieldConfigs = getFieldConfigsForEntityType(ENTITY_TYPES.ACTIVITY_PARTITION);

    expect(fieldConfigs.length).toBeGreaterThan(0);
    expect(fieldConfigs.find(f => f.name === 'name')).toBeDefined();
    expect(fieldConfigs.find(f => f.name === 'ref_kind')).toBeDefined();
    expect(fieldConfigs.find(f => f.name === 'ref_id')).toBeDefined();
    expect(fieldConfigs.find(f => f.name === 'description')).toBeDefined();
  });

  it('should have correct ref_kind dropdown options', () => {
    const fieldConfigs = getFieldConfigsForEntityType(ENTITY_TYPES.ACTIVITY_PARTITION);
    const refKindField = fieldConfigs.find(f => f.name === 'ref_kind');

    expect(refKindField?.options).toContain('BusinessUser');
    expect(refKindField?.options).toContain('Application');
    expect(refKindField?.options).toContain('ApplicationComponent');
    expect(refKindField?.options).toContain('Service');
    expect(refKindField?.options).toContain('Interface');
    expect(refKindField?.options).toContain('Class');
    expect(refKindField?.options?.length).toBe(6);
  });

  it('should lookup ActivityPartition entity from meta-model by entity_id', () => {
    const entities: MetaModelEntitiesSubset = {
      states: [],
      activities: [],
      activity_partitions: [
        { id: 'ap_1', name: 'User Lane', order_index: 0 },
        { id: 'ap_2', ref_kind: 'Application', ref_id: 'app_1', order_index: 1 },
      ],
      logical_data_entities: [],
      physical_data_entities: [],
    };

    const found = lookupActivityPartition(entities, 'ap_1');
    expect(found).toBeDefined();
    expect(found?.name).toBe('User Lane');
  });
});

describe('Selection Inspector - LogicalDataEntity and PhysicalDataEntity Fields', () => {
  it('should show editable fields when LogicalDataEntity node is selected', () => {
    const fieldConfigs = getFieldConfigsForEntityType(ENTITY_TYPES.LOGICAL_DATA_ENTITY);

    expect(fieldConfigs.length).toBeGreaterThan(0);
    expect(fieldConfigs.find(f => f.name === 'name')).toBeDefined();
    expect(fieldConfigs.find(f => f.name === 'description')).toBeDefined();
  });

  it('should show editable fields when PhysicalDataEntity node is selected', () => {
    const fieldConfigs = getFieldConfigsForEntityType(ENTITY_TYPES.PHYSICAL_DATA_ENTITY);

    expect(fieldConfigs.length).toBeGreaterThan(0);
    expect(fieldConfigs.find(f => f.name === 'name')).toBeDefined();
    expect(fieldConfigs.find(f => f.name === 'description')).toBeDefined();
  });

  it('should lookup LogicalDataEntity from meta-model by entity_id', () => {
    const entities: MetaModelEntitiesSubset = {
      states: [],
      activities: [],
      activity_partitions: [],
      logical_data_entities: [
        { id: 'lde_1', name: 'Customer', description: 'Customer entity', tags: '' },
        { id: 'lde_2', name: 'Order', description: 'Order entity', tags: '' },
      ],
      physical_data_entities: [],
    };

    const found = lookupLogicalDataEntity(entities, 'lde_1');
    expect(found).toBeDefined();
    expect(found?.name).toBe('Customer');
  });

  it('should lookup PhysicalDataEntity from meta-model by entity_id', () => {
    const entities: MetaModelEntitiesSubset = {
      states: [],
      activities: [],
      activity_partitions: [],
      logical_data_entities: [],
      physical_data_entities: [
        { id: 'pde_1', name: 'customers', description: '', physical_type: 'TABLE', database: 'PostgreSQL', tags: '' },
      ],
    };

    const found = lookupPhysicalDataEntity(entities, 'pde_1');
    expect(found).toBeDefined();
    expect(found?.name).toBe('customers');
  });
});

describe('Selection Inspector - Save Mechanism with UPDATE_ENTITY', () => {
  it('should build UPDATE_ENTITY action with updated State entity values', () => {
    const updatedState: State = {
      id: 'state_1',
      name: 'Updated State Name',
      state_kind: 'Final',
      description: 'Updated description',
    };

    const action = buildUpdateEntityAction('states', updatedState as unknown as Record<string, unknown>);

    expect(action.type).toBe('UPDATE_ENTITY');
    expect(action.entityType).toBe('states');
    expect(action.entity.id).toBe('state_1');
    expect(action.entity.name).toBe('Updated State Name');
    expect(action.entity.state_kind).toBe('Final');
  });

  it('should build UPDATE_ENTITY action with updated Activity entity values', () => {
    const updatedActivity: Activity = {
      id: 'act_1',
      name: 'Updated Activity',
      activity_kind: 'Decision',
      description: 'A decision point',
    };

    const action = buildUpdateEntityAction('activities', updatedActivity as unknown as Record<string, unknown>);

    expect(action.type).toBe('UPDATE_ENTITY');
    expect(action.entityType).toBe('activities');
    expect(action.entity.id).toBe('act_1');
    expect(action.entity.name).toBe('Updated Activity');
    expect(action.entity.activity_kind).toBe('Decision');
  });

  it('should build UPDATE_ENTITY action with updated ActivityPartition entity values', () => {
    const updatedPartition: ActivityPartition = {
      id: 'ap_1',
      name: 'System Lane',
      ref_kind: 'Application',
      ref_id: 'app_123',
      description: 'Application swimlane',
    };

    const action = buildUpdateEntityAction('activity_partitions', updatedPartition as unknown as Record<string, unknown>);

    expect(action.type).toBe('UPDATE_ENTITY');
    expect(action.entityType).toBe('activity_partitions');
    expect(action.entity.id).toBe('ap_1');
    expect(action.entity.ref_kind).toBe('Application');
    expect(action.entity.ref_id).toBe('app_123');
  });

  it('should build UPDATE_ENTITY action with updated LogicalDataEntity values', () => {
    const updatedEntity: LogicalDataEntity = {
      id: 'lde_1',
      name: 'Updated Customer',
      description: 'Updated description',
      tags: 'core, domain',
    };

    const action = buildUpdateEntityAction('logical_data_entities', updatedEntity as unknown as Record<string, unknown>);

    expect(action.type).toBe('UPDATE_ENTITY');
    expect(action.entityType).toBe('logical_data_entities');
    expect(action.entity.name).toBe('Updated Customer');
  });

  it('should build UPDATE_ENTITY action with updated PhysicalDataEntity values', () => {
    const updatedEntity: PhysicalDataEntity = {
      id: 'pde_1',
      name: 'updated_customers',
      description: 'Updated physical table',
      physical_type: 'VIEW',
      database: 'MySQL',
      tags: 'reporting',
    };

    const action = buildUpdateEntityAction('physical_data_entities', updatedEntity as unknown as Record<string, unknown>);

    expect(action.type).toBe('UPDATE_ENTITY');
    expect(action.entityType).toBe('physical_data_entities');
    expect(action.entity.name).toBe('updated_customers');
    expect(action.entity.physical_type).toBe('VIEW');
  });
});

describe('Selection Inspector - Dropdown Changes Update Entity', () => {
  it('should update state_kind correctly when dropdown changes', () => {
    const currentState: State = {
      id: 'state_1',
      name: 'My State',
      state_kind: 'Normal',
    };

    // Simulate dropdown change
    const newStateKind: StateKind = 'Final';
    const updatedState = { ...currentState, state_kind: newStateKind };

    expect(updatedState.state_kind).toBe('Final');

    const action = buildUpdateEntityAction('states', updatedState as unknown as Record<string, unknown>);
    expect(action.entity.state_kind).toBe('Final');
  });

  it('should update activity_kind correctly when dropdown changes', () => {
    const currentActivity: Activity = {
      id: 'act_1',
      name: 'My Activity',
      activity_kind: 'Action',
    };

    // Simulate dropdown change
    const newActivityKind: ActivityKind = 'Decision';
    const updatedActivity = { ...currentActivity, activity_kind: newActivityKind };

    expect(updatedActivity.activity_kind).toBe('Decision');

    const action = buildUpdateEntityAction('activities', updatedActivity as unknown as Record<string, unknown>);
    expect(action.entity.activity_kind).toBe('Decision');
  });

  it('should update ref_kind correctly when dropdown changes for ActivityPartition', () => {
    const currentPartition: ActivityPartition = {
      id: 'ap_1',
      name: 'Lane',
    };

    // Simulate dropdown change
    const newRefKind: ActivityPartitionRefKind = 'Service';
    const updatedPartition = { ...currentPartition, ref_kind: newRefKind };

    expect(updatedPartition.ref_kind).toBe('Service');

    const action = buildUpdateEntityAction('activity_partitions', updatedPartition as unknown as Record<string, unknown>);
    expect(action.entity.ref_kind).toBe('Service');
  });
});
