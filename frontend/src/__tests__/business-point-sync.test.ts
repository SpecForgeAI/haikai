/**
 * Business Point Synchronization Tests
 *
 * Tests that verify Business Points are automatically created and synchronized
 * with their source entities (Business Processes, Process Activities).
 *
 * Business Process/Process Activity name is the canonical source for Business Point name.
 *
 * Note: These tests use Vitest for testing.
 */

import { describe, test, expect } from 'vitest';

import {
  generateBusinessPointId,
  createBusinessPointFromEntity,
  syncBusinessPointNames,
  syncBusinessPointNameForEntity,
  reconcileBusinessPoints,
  getOrphanedBusinessPoints,
  cascadeDeleteBusinessPoint,
  findBusinessPointForEntity,
  findSourceEntityForBusinessPoint,
} from '../utils/businessPointSync';

import {
  BusinessPoint,
  BusinessProcess,
  ProcessActivity,
  MetaModel,
  MetaModelEntities,
  MetaModelRelationships,
} from '../types/model';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create empty MetaModelRelationships for testing
 */
function createEmptyRelationships(): MetaModelRelationships {
  return {
    business_user_processes: [],
    application_point_business_processes: [],
    business_user_business_points: [],
    application_point_business_points: [],
    logical_data_entity_relationships: [],
    logical_data_entity_physical_data_entities: [],
    logical_data_attribute_physical_data_attributes: [],
    data_movements: [],
    interface_logical_entities: [],
  };
}

/**
 * Create empty MetaModelEntities for testing
 */
function createEmptyEntities(): MetaModelEntities {
  return {
    business_users: [],
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: [],
    app_components: [],
    services: [],
    interfaces: [],
    application_points: [],
    logical_data_entities: [],
    logical_data_attributes: [],
    physical_data_entities: [],
    physical_data_attributes: [],
  };
}

/**
 * Create a test Business Process
 */
function createTestBusinessProcess(overrides: Partial<BusinessProcess> = {}): BusinessProcess {
  return {
    id: 'bp-1',
    name: 'Test Business Process',
    description: 'A test business process',
    tags: '',
    ...overrides,
  };
}

/**
 * Create a test Process Activity
 */
function createTestProcessActivity(overrides: Partial<ProcessActivity> = {}): ProcessActivity {
  return {
    id: 'pa-1',
    business_process_id: 'bp-1',
    name: 'Test Process Activity',
    description: 'A test process activity',
    actor_hint: 'OTHER',
    user_interaction_level: 'AUTOMATED',
    tags: '',
    ...overrides,
  };
}

/**
 * Create a test Business Point
 */
function createTestBusinessPoint(overrides: Partial<BusinessPoint> = {}): BusinessPoint {
  return {
    id: 'bp_bp-1',
    name: 'Test Business Point',
    description: '',
    kind: 'BUSINESS_PROCESS',
    business_process_id: 'bp-1',
    tags: '',
    ...overrides,
  };
}

// ============================================================================
// Test Suite: generateBusinessPointId
// ============================================================================

describe('generateBusinessPointId', () => {
  test('returns correct format for Business Process ID', () => {
    const result = generateBusinessPointId('proc_001');
    expect(result).toBe('bp_proc_001');
  });

  test('returns correct format for Process Activity ID', () => {
    const result = generateBusinessPointId('act_123');
    expect(result).toBe('bp_act_123');
  });

  test('handles empty string input', () => {
    const result = generateBusinessPointId('');
    expect(result).toBe('bp_');
  });

  test('handles IDs with special characters', () => {
    const result = generateBusinessPointId('id-with-dashes_and_underscores');
    expect(result).toBe('bp_id-with-dashes_and_underscores');
  });

  test('is deterministic - same input produces same output', () => {
    const id1 = generateBusinessPointId('test-123');
    const id2 = generateBusinessPointId('test-123');
    expect(id1).toBe(id2);
  });
});

// ============================================================================
// Test Suite: createBusinessPointFromEntity - Business Process
// ============================================================================

describe('createBusinessPointFromEntity for Business Process', () => {
  test('creates Business Point with correct ID from Business Process', () => {
    const process = createTestBusinessProcess({ id: 'proc-001' });
    const bp = createBusinessPointFromEntity(process, 'business_processes');

    expect(bp.id).toBe('bp_proc-001');
  });

  test('copies name from Business Process', () => {
    const process = createTestBusinessProcess({
      id: 'proc-001',
      name: 'Order Processing Workflow',
    });
    const bp = createBusinessPointFromEntity(process, 'business_processes');

    expect(bp.name).toBe('Order Processing Workflow');
  });

  test('sets kind to BUSINESS_PROCESS', () => {
    const process = createTestBusinessProcess();
    const bp = createBusinessPointFromEntity(process, 'business_processes');

    expect(bp.kind).toBe('BUSINESS_PROCESS');
  });

  test('sets business_process_id correctly', () => {
    const process = createTestBusinessProcess({ id: 'proc-001' });
    const bp = createBusinessPointFromEntity(process, 'business_processes');

    expect(bp.business_process_id).toBe('proc-001');
  });

  test('process_activity_id is undefined for Business Process kind', () => {
    const process = createTestBusinessProcess();
    const bp = createBusinessPointFromEntity(process, 'business_processes');

    expect(bp.process_activity_id).toBeUndefined();
  });

  test('copies description from Business Process', () => {
    const process = createTestBusinessProcess({
      description: 'Handles order processing end-to-end',
    });
    const bp = createBusinessPointFromEntity(process, 'business_processes');

    expect(bp.description).toBe('Handles order processing end-to-end');
  });

  test('copies tags from Business Process', () => {
    const process = createTestBusinessProcess({ tags: 'critical,core' });
    const bp = createBusinessPointFromEntity(process, 'business_processes');

    expect(bp.tags).toBe('critical,core');
  });

  test('copies temporal fields from Business Process', () => {
    const process = createTestBusinessProcess({
      valid_from: '2024-Q1',
      valid_to: '2025-Q4',
    });
    const bp = createBusinessPointFromEntity(process, 'business_processes');

    expect(bp.valid_from).toBe('2024-Q1');
    expect(bp.valid_to).toBe('2025-Q4');
  });
});

// ============================================================================
// Test Suite: createBusinessPointFromEntity - Process Activity
// ============================================================================

describe('createBusinessPointFromEntity for Process Activity', () => {
  test('creates Business Point with correct ID from Process Activity', () => {
    const activity = createTestProcessActivity({ id: 'act-001' });
    const bp = createBusinessPointFromEntity(activity, 'process_activities');

    expect(bp.id).toBe('bp_act-001');
  });

  test('copies name from Process Activity', () => {
    const activity = createTestProcessActivity({
      id: 'act-001',
      name: 'Validate Order Details',
    });
    const bp = createBusinessPointFromEntity(activity, 'process_activities');

    expect(bp.name).toBe('Validate Order Details');
  });

  test('sets kind to PROCESS_ACTIVITY', () => {
    const activity = createTestProcessActivity();
    const bp = createBusinessPointFromEntity(activity, 'process_activities');

    expect(bp.kind).toBe('PROCESS_ACTIVITY');
  });

  test('sets business_process_id from parent process', () => {
    const activity = createTestProcessActivity({
      id: 'act-001',
      business_process_id: 'proc-parent',
    });
    const bp = createBusinessPointFromEntity(activity, 'process_activities');

    expect(bp.business_process_id).toBe('proc-parent');
  });

  test('sets process_activity_id correctly', () => {
    const activity = createTestProcessActivity({ id: 'act-001' });
    const bp = createBusinessPointFromEntity(activity, 'process_activities');

    expect(bp.process_activity_id).toBe('act-001');
  });

  test('copies description from Process Activity', () => {
    const activity = createTestProcessActivity({
      description: 'Validates order before processing',
    });
    const bp = createBusinessPointFromEntity(activity, 'process_activities');

    expect(bp.description).toBe('Validates order before processing');
  });

  test('copies temporal fields from Process Activity', () => {
    const activity = createTestProcessActivity({
      valid_from: '2024-Q2',
      valid_to: '2025-Q1',
    });
    const bp = createBusinessPointFromEntity(activity, 'process_activities');

    expect(bp.valid_from).toBe('2024-Q2');
    expect(bp.valid_to).toBe('2025-Q1');
  });
});

// ============================================================================
// Test Suite: syncBusinessPointNames
// ============================================================================

describe('syncBusinessPointNames', () => {
  test('updates Business Point name when it differs from source Business Process', () => {
    const processes = [
      createTestBusinessProcess({ id: 'proc-1', name: 'New Process Name' }),
    ];
    const activities: ProcessActivity[] = [];
    const businessPoints = [
      createTestBusinessPoint({
        id: 'bp_proc-1',
        name: 'Old Name',
        kind: 'BUSINESS_PROCESS',
        business_process_id: 'proc-1',
      }),
    ];

    const synced = syncBusinessPointNames(businessPoints, processes, activities);

    expect(synced[0].name).toBe('New Process Name');
  });

  test('updates Business Point name when it differs from source Process Activity', () => {
    const processes: BusinessProcess[] = [];
    const activities = [
      createTestProcessActivity({ id: 'act-1', name: 'New Activity Name' }),
    ];
    const businessPoints = [
      createTestBusinessPoint({
        id: 'bp_act-1',
        name: 'Old Activity Name',
        kind: 'PROCESS_ACTIVITY',
        business_process_id: 'bp-1',
        process_activity_id: 'act-1',
      }),
    ];

    const synced = syncBusinessPointNames(businessPoints, processes, activities);

    expect(synced[0].name).toBe('New Activity Name');
  });

  test('preserves Business Point name when source entity name is empty', () => {
    const processes = [
      createTestBusinessProcess({ id: 'proc-1', name: '' }),
    ];
    const activities: ProcessActivity[] = [];
    const businessPoints = [
      createTestBusinessPoint({
        id: 'bp_proc-1',
        name: 'Existing Name',
        kind: 'BUSINESS_PROCESS',
        business_process_id: 'proc-1',
      }),
    ];

    const synced = syncBusinessPointNames(businessPoints, processes, activities);

    expect(synced[0].name).toBe('Existing Name');
  });

  test('leaves Business Point unchanged when names already match', () => {
    const processes = [
      createTestBusinessProcess({ id: 'proc-1', name: 'Same Name' }),
    ];
    const activities: ProcessActivity[] = [];
    const businessPoints = [
      createTestBusinessPoint({
        id: 'bp_proc-1',
        name: 'Same Name',
        kind: 'BUSINESS_PROCESS',
        business_process_id: 'proc-1',
      }),
    ];

    const synced = syncBusinessPointNames(businessPoints, processes, activities);

    expect(synced[0].name).toBe('Same Name');
    // Verify it's the same object reference (no unnecessary update)
    expect(synced[0]).toBe(businessPoints[0]);
  });

  test('handles multiple Business Points correctly', () => {
    const processes = [
      createTestBusinessProcess({ id: 'proc-1', name: 'Process One Updated' }),
      createTestBusinessProcess({ id: 'proc-2', name: 'Process Two' }),
    ];
    const activities = [
      createTestProcessActivity({ id: 'act-1', name: 'Activity One Updated' }),
    ];
    const businessPoints = [
      createTestBusinessPoint({
        id: 'bp_proc-1',
        name: 'Process One',
        kind: 'BUSINESS_PROCESS',
        business_process_id: 'proc-1',
      }),
      createTestBusinessPoint({
        id: 'bp_proc-2',
        name: 'Process Two',
        kind: 'BUSINESS_PROCESS',
        business_process_id: 'proc-2',
      }),
      createTestBusinessPoint({
        id: 'bp_act-1',
        name: 'Activity One',
        kind: 'PROCESS_ACTIVITY',
        business_process_id: 'proc-1',
        process_activity_id: 'act-1',
      }),
    ];

    const synced = syncBusinessPointNames(businessPoints, processes, activities);

    expect(synced[0].name).toBe('Process One Updated');
    expect(synced[1].name).toBe('Process Two');
    expect(synced[2].name).toBe('Activity One Updated');
  });

  test('preserves orphaned Business Points unchanged', () => {
    const processes: BusinessProcess[] = [];
    const activities: ProcessActivity[] = [];
    const businessPoints = [
      createTestBusinessPoint({
        id: 'bp_orphan',
        name: 'Orphan Name',
        kind: 'BUSINESS_PROCESS',
        business_process_id: 'nonexistent',
      }),
    ];

    const synced = syncBusinessPointNames(businessPoints, processes, activities);

    expect(synced[0].name).toBe('Orphan Name');
    expect(synced[0]).toBe(businessPoints[0]);
  });
});

// ============================================================================
// Test Suite: reconcileBusinessPoints
// ============================================================================

describe('reconcileBusinessPoints', () => {
  test('creates missing Business Point for Business Process', () => {
    const metaModel: MetaModel = {
      entities: {
        ...createEmptyEntities(),
        business_processes: [
          createTestBusinessProcess({ id: 'proc-1', name: 'Order Processing' }),
        ],
        business_points: [],
      },
      relationships: createEmptyRelationships(),
    };

    const reconciled = reconcileBusinessPoints(metaModel);

    expect(reconciled.entities.business_points).toHaveLength(1);
    expect(reconciled.entities.business_points[0].id).toBe('bp_proc-1');
    expect(reconciled.entities.business_points[0].name).toBe('Order Processing');
    expect(reconciled.entities.business_points[0].kind).toBe('BUSINESS_PROCESS');
  });

  test('creates missing Business Point for Process Activity', () => {
    const metaModel: MetaModel = {
      entities: {
        ...createEmptyEntities(),
        process_activities: [
          createTestProcessActivity({ id: 'act-1', name: 'Validate Order' }),
        ],
        business_points: [],
      },
      relationships: createEmptyRelationships(),
    };

    const reconciled = reconcileBusinessPoints(metaModel);

    expect(reconciled.entities.business_points).toHaveLength(1);
    expect(reconciled.entities.business_points[0].id).toBe('bp_act-1');
    expect(reconciled.entities.business_points[0].name).toBe('Validate Order');
    expect(reconciled.entities.business_points[0].kind).toBe('PROCESS_ACTIVITY');
  });

  test('removes orphaned Business Points', () => {
    const metaModel: MetaModel = {
      entities: {
        ...createEmptyEntities(),
        business_processes: [],
        process_activities: [],
        business_points: [
          createTestBusinessPoint({
            id: 'bp_orphan',
            name: 'Orphan',
            kind: 'BUSINESS_PROCESS',
            business_process_id: 'nonexistent',
          }),
        ],
      },
      relationships: createEmptyRelationships(),
    };

    const reconciled = reconcileBusinessPoints(metaModel);

    expect(reconciled.entities.business_points).toHaveLength(0);
  });

  test('updates existing Business Point name from source entity', () => {
    const metaModel: MetaModel = {
      entities: {
        ...createEmptyEntities(),
        business_processes: [
          createTestBusinessProcess({ id: 'proc-1', name: 'Updated Name' }),
        ],
        business_points: [
          createTestBusinessPoint({
            id: 'bp_proc-1',
            name: 'Old Name',
            kind: 'BUSINESS_PROCESS',
            business_process_id: 'proc-1',
          }),
        ],
      },
      relationships: createEmptyRelationships(),
    };

    const reconciled = reconcileBusinessPoints(metaModel);

    expect(reconciled.entities.business_points).toHaveLength(1);
    expect(reconciled.entities.business_points[0].name).toBe('Updated Name');
  });

  test('cascade deletes relationships for orphaned Business Points', () => {
    const metaModel: MetaModel = {
      entities: {
        ...createEmptyEntities(),
        business_processes: [],
        business_points: [
          createTestBusinessPoint({
            id: 'bp_orphan',
            kind: 'BUSINESS_PROCESS',
            business_process_id: 'nonexistent',
          }),
        ],
      },
      relationships: {
        ...createEmptyRelationships(),
        business_user_business_points: [
          {
            id: 'bubp-1',
            business_user_id: 'user-1',
            business_point_id: 'bp_orphan',
            description: '',
            tags: '',
          },
        ],
        application_point_business_points: [
          {
            id: 'apbp-1',
            application_point_id: 'ap-1',
            business_point_id: 'bp_orphan',
            description: '',
            tags: '',
          },
        ],
      },
    };

    const reconciled = reconcileBusinessPoints(metaModel);

    expect(reconciled.entities.business_points).toHaveLength(0);
    expect(reconciled.relationships.business_user_business_points).toHaveLength(0);
    expect(reconciled.relationships.application_point_business_points).toHaveLength(0);
  });

  test('handles mixed Business Processes and Process Activities', () => {
    const metaModel: MetaModel = {
      entities: {
        ...createEmptyEntities(),
        business_processes: [
          createTestBusinessProcess({ id: 'proc-1', name: 'Process 1' }),
          createTestBusinessProcess({ id: 'proc-2', name: 'Process 2' }),
        ],
        process_activities: [
          createTestProcessActivity({
            id: 'act-1',
            name: 'Activity 1',
            business_process_id: 'proc-1',
          }),
        ],
        business_points: [],
      },
      relationships: createEmptyRelationships(),
    };

    const reconciled = reconcileBusinessPoints(metaModel);

    expect(reconciled.entities.business_points).toHaveLength(3);

    const bpIds = reconciled.entities.business_points.map(bp => bp.id);
    expect(bpIds).toContain('bp_proc-1');
    expect(bpIds).toContain('bp_proc-2');
    expect(bpIds).toContain('bp_act-1');
  });
});

// ============================================================================
// Test Suite: cascadeDeleteBusinessPoint
// ============================================================================

describe('cascadeDeleteBusinessPoint', () => {
  test('removes business_user_business_points referencing the Business Point', () => {
    const relationships: MetaModelRelationships = {
      ...createEmptyRelationships(),
      business_user_business_points: [
        {
          id: 'bubp-1',
          business_user_id: 'user-1',
          business_point_id: 'bp_proc-1',
          description: '',
          tags: '',
        },
        {
          id: 'bubp-2',
          business_user_id: 'user-2',
          business_point_id: 'bp_proc-1',
          description: '',
          tags: '',
        },
        {
          id: 'bubp-3',
          business_user_id: 'user-1',
          business_point_id: 'bp_proc-2',
          description: '',
          tags: '',
        },
      ],
    };

    const result = cascadeDeleteBusinessPoint('bp_proc-1', relationships);

    expect(result.business_user_business_points).toHaveLength(1);
    expect(result.business_user_business_points[0].id).toBe('bubp-3');
  });

  test('removes application_point_business_points referencing the Business Point', () => {
    const relationships: MetaModelRelationships = {
      ...createEmptyRelationships(),
      application_point_business_points: [
        {
          id: 'apbp-1',
          application_point_id: 'ap-1',
          business_point_id: 'bp_proc-1',
          description: '',
          tags: '',
        },
        {
          id: 'apbp-2',
          application_point_id: 'ap-2',
          business_point_id: 'bp_proc-2',
          description: '',
          tags: '',
        },
      ],
    };

    const result = cascadeDeleteBusinessPoint('bp_proc-1', relationships);

    expect(result.application_point_business_points).toHaveLength(1);
    expect(result.application_point_business_points[0].id).toBe('apbp-2');
  });

  test('preserves other relationship types', () => {
    const relationships: MetaModelRelationships = {
      ...createEmptyRelationships(),
      business_user_business_points: [
        {
          id: 'bubp-1',
          business_user_id: 'user-1',
          business_point_id: 'bp_proc-1',
          description: '',
          tags: '',
        },
      ],
      logical_data_entity_relationships: [
        {
          id: 'ler-1',
          source_entity_id: 'lde-1',
          target_entity_id: 'lde-2',
          relationship_type: 'ONE_TO_MANY',
          description: '',
          tags: '',
        },
      ],
      data_movements: [
        {
          id: 'dm-1',
          source_application_point_id: 'ap-1',
          target_application_point_id: 'ap-2',
          data_entity_id: 'lde-1',
          movement_type: 'SYNC',
          description: '',
          tags: '',
        },
      ],
    };

    const result = cascadeDeleteBusinessPoint('bp_proc-1', relationships);

    expect(result.business_user_business_points).toHaveLength(0);
    expect(result.logical_data_entity_relationships).toHaveLength(1);
    expect(result.data_movements).toHaveLength(1);
  });

  test('returns unchanged relationships when no matches found', () => {
    const relationships: MetaModelRelationships = {
      ...createEmptyRelationships(),
      business_user_business_points: [
        {
          id: 'bubp-1',
          business_user_id: 'user-1',
          business_point_id: 'bp_proc-1',
          description: '',
          tags: '',
        },
      ],
    };

    const result = cascadeDeleteBusinessPoint('bp_nonexistent', relationships);

    expect(result.business_user_business_points).toHaveLength(1);
  });
});

// ============================================================================
// Test Suite: getOrphanedBusinessPoints
// ============================================================================

describe('getOrphanedBusinessPoints', () => {
  test('identifies orphaned Business Process Business Points', () => {
    const businessPoints = [
      createTestBusinessPoint({
        id: 'bp_proc-1',
        kind: 'BUSINESS_PROCESS',
        business_process_id: 'nonexistent',
      }),
    ];
    const processes: BusinessProcess[] = [];
    const activities: ProcessActivity[] = [];

    const orphans = getOrphanedBusinessPoints(businessPoints, processes, activities);

    expect(orphans).toHaveLength(1);
    expect(orphans[0].id).toBe('bp_proc-1');
  });

  test('identifies orphaned Process Activity Business Points', () => {
    const businessPoints = [
      createTestBusinessPoint({
        id: 'bp_act-1',
        kind: 'PROCESS_ACTIVITY',
        business_process_id: 'proc-1',
        process_activity_id: 'nonexistent',
      }),
    ];
    const processes: BusinessProcess[] = [];
    const activities: ProcessActivity[] = [];

    const orphans = getOrphanedBusinessPoints(businessPoints, processes, activities);

    expect(orphans).toHaveLength(1);
    expect(orphans[0].id).toBe('bp_act-1');
  });

  test('does not identify valid Business Points as orphaned', () => {
    const businessPoints = [
      createTestBusinessPoint({
        id: 'bp_proc-1',
        kind: 'BUSINESS_PROCESS',
        business_process_id: 'proc-1',
      }),
      createTestBusinessPoint({
        id: 'bp_act-1',
        kind: 'PROCESS_ACTIVITY',
        business_process_id: 'proc-1',
        process_activity_id: 'act-1',
      }),
    ];
    const processes = [createTestBusinessProcess({ id: 'proc-1' })];
    const activities = [createTestProcessActivity({ id: 'act-1' })];

    const orphans = getOrphanedBusinessPoints(businessPoints, processes, activities);

    expect(orphans).toHaveLength(0);
  });
});

// ============================================================================
// Test Suite: findBusinessPointForEntity
// ============================================================================

describe('findBusinessPointForEntity', () => {
  test('finds Business Point for existing entity', () => {
    const businessPoints = [
      createTestBusinessPoint({ id: 'bp_proc-1' }),
      createTestBusinessPoint({ id: 'bp_proc-2' }),
    ];

    const found = findBusinessPointForEntity('proc-1', businessPoints);

    expect(found).toBeDefined();
    expect(found?.id).toBe('bp_proc-1');
  });

  test('returns undefined when Business Point not found', () => {
    const businessPoints = [
      createTestBusinessPoint({ id: 'bp_proc-1' }),
    ];

    const found = findBusinessPointForEntity('nonexistent', businessPoints);

    expect(found).toBeUndefined();
  });
});

// ============================================================================
// Test Suite: findSourceEntityForBusinessPoint
// ============================================================================

describe('findSourceEntityForBusinessPoint', () => {
  test('finds Business Process for BUSINESS_PROCESS kind', () => {
    const bp = createTestBusinessPoint({
      kind: 'BUSINESS_PROCESS',
      business_process_id: 'proc-1',
    });
    const entities: MetaModelEntities = {
      ...createEmptyEntities(),
      business_processes: [createTestBusinessProcess({ id: 'proc-1', name: 'Found Process' })],
    };

    const found = findSourceEntityForBusinessPoint(bp, entities);

    expect(found).toBeDefined();
    expect(found?.id).toBe('proc-1');
    expect(found?.name).toBe('Found Process');
  });

  test('finds Process Activity for PROCESS_ACTIVITY kind', () => {
    const bp = createTestBusinessPoint({
      kind: 'PROCESS_ACTIVITY',
      business_process_id: 'proc-1',
      process_activity_id: 'act-1',
    });
    const entities: MetaModelEntities = {
      ...createEmptyEntities(),
      process_activities: [createTestProcessActivity({ id: 'act-1', name: 'Found Activity' })],
    };

    const found = findSourceEntityForBusinessPoint(bp, entities);

    expect(found).toBeDefined();
    expect(found?.id).toBe('act-1');
    expect(found?.name).toBe('Found Activity');
  });

  test('returns undefined when source entity not found', () => {
    const bp = createTestBusinessPoint({
      kind: 'BUSINESS_PROCESS',
      business_process_id: 'nonexistent',
    });
    const entities = createEmptyEntities();

    const found = findSourceEntityForBusinessPoint(bp, entities);

    expect(found).toBeUndefined();
  });
});

// ============================================================================
// Test Suite: syncBusinessPointNameForEntity (Edit-time sync)
// ============================================================================

describe('syncBusinessPointNameForEntity', () => {
  test('updates existing Business Point name', () => {
    const entities: MetaModelEntities = {
      ...createEmptyEntities(),
      business_processes: [createTestBusinessProcess({ id: 'proc-1', name: 'Old Name' })],
      business_points: [
        createTestBusinessPoint({
          id: 'bp_proc-1',
          name: 'Old Name',
          kind: 'BUSINESS_PROCESS',
          business_process_id: 'proc-1',
        }),
      ],
    };

    const result = syncBusinessPointNameForEntity(
      entities,
      'business_processes',
      'proc-1',
      'New Name'
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('New Name');
  });

  test('creates Business Point if missing during edit', () => {
    const entities: MetaModelEntities = {
      ...createEmptyEntities(),
      business_processes: [createTestBusinessProcess({ id: 'proc-1', name: 'Process Name' })],
      business_points: [],
    };

    const result = syncBusinessPointNameForEntity(
      entities,
      'business_processes',
      'proc-1',
      'New Process Name'
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('bp_proc-1');
    expect(result[0].name).toBe('New Process Name');
    expect(result[0].kind).toBe('BUSINESS_PROCESS');
  });

  test('handles Process Activity edit-time sync', () => {
    const entities: MetaModelEntities = {
      ...createEmptyEntities(),
      process_activities: [
        createTestProcessActivity({ id: 'act-1', name: 'Old Activity' }),
      ],
      business_points: [
        createTestBusinessPoint({
          id: 'bp_act-1',
          name: 'Old Activity',
          kind: 'PROCESS_ACTIVITY',
          business_process_id: 'bp-1',
          process_activity_id: 'act-1',
        }),
      ],
    };

    const result = syncBusinessPointNameForEntity(
      entities,
      'process_activities',
      'act-1',
      'New Activity Name'
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('New Activity Name');
  });
});
