/**
 * Tests for Data Entity Point Options Utility
 *
 * Spec: Switch Logical ER and Data Movements UI to Data Entity Point Dropdown
 * Task Group 1: Data Entity Point Options Utility
 *
 * Tests for:
 * - buildDataEntityPointOptions() function
 * - resolveDataEntityPointLabel() function
 * - DATA_ENTITY_POINT_GROUPS constant
 */

import { describe, it, expect } from 'vitest';
import {
  buildDataEntityPointOptions,
  resolveDataEntityPointLabel,
  DATA_ENTITY_POINT_GROUPS,
  DataEntityPointOption,
} from '../utils/dataEntityPointOptions';
import { MetaModelEntities } from '../types/model';

// Helper to create mock MetaModelEntities with specified data entities
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

describe('DATA_ENTITY_POINT_GROUPS constant', () => {
  it('should define LOGICAL and PHYSICAL group labels', () => {
    expect(DATA_ENTITY_POINT_GROUPS.LOGICAL).toBe('LOGICAL DATA ENTITIES');
    expect(DATA_ENTITY_POINT_GROUPS.PHYSICAL).toBe('PHYSICAL DATA ENTITIES');
  });
});

describe('buildDataEntityPointOptions', () => {
  it('should return options from both logical_data_entities and physical_data_entities', () => {
    const entities = createMockEntities(
      [{ id: 'log_1', name: 'Customer' }],
      [{ id: 'phy_1', name: 'customers_table' }]
    );

    const options = buildDataEntityPointOptions(entities);

    expect(options).toHaveLength(2);

    const logicalOption = options.find((o) => o.value === 'dep_log_log_1');
    const physicalOption = options.find((o) => o.value === 'dep_phy_phy_1');

    expect(logicalOption).toBeDefined();
    expect(physicalOption).toBeDefined();
  });

  it('should format option values with dep_log_ prefix for logical entities', () => {
    const entities = createMockEntities([{ id: 'entity_123', name: 'Order' }], []);

    const options = buildDataEntityPointOptions(entities);

    expect(options).toHaveLength(1);
    expect(options[0].value).toBe('dep_log_entity_123');
  });

  it('should format option values with dep_phy_ prefix for physical entities', () => {
    const entities = createMockEntities([], [{ id: 'table_456', name: 'orders' }]);

    const options = buildDataEntityPointOptions(entities);

    expect(options).toHaveLength(1);
    expect(options[0].value).toBe('dep_phy_table_456');
  });

  it('should format option labels as "[entityName] [TYPE]"', () => {
    const entities = createMockEntities(
      [{ id: 'log_1', name: 'Customer' }],
      [{ id: 'phy_1', name: 'customers_table' }]
    );

    const options = buildDataEntityPointOptions(entities);

    const logicalOption = options.find((o) => o.group === DATA_ENTITY_POINT_GROUPS.LOGICAL);
    const physicalOption = options.find((o) => o.group === DATA_ENTITY_POINT_GROUPS.PHYSICAL);

    expect(logicalOption?.label).toBe('Customer [LOGICAL_DATA_ENTITY]');
    expect(physicalOption?.label).toBe('customers_table [PHYSICAL_DATA_ENTITY]');
  });

  it('should sort options alphabetically by label within each group', () => {
    const entities = createMockEntities(
      [
        { id: 'log_3', name: 'Zebra' },
        { id: 'log_1', name: 'Apple' },
        { id: 'log_2', name: 'Mango' },
      ],
      [
        { id: 'phy_2', name: 'zebra_table' },
        { id: 'phy_1', name: 'apple_table' },
      ]
    );

    const options = buildDataEntityPointOptions(entities);

    const logicalOptions = options.filter((o) => o.group === DATA_ENTITY_POINT_GROUPS.LOGICAL);
    const physicalOptions = options.filter((o) => o.group === DATA_ENTITY_POINT_GROUPS.PHYSICAL);

    // Logical options should be sorted alphabetically
    expect(logicalOptions[0].label).toBe('Apple [LOGICAL_DATA_ENTITY]');
    expect(logicalOptions[1].label).toBe('Mango [LOGICAL_DATA_ENTITY]');
    expect(logicalOptions[2].label).toBe('Zebra [LOGICAL_DATA_ENTITY]');

    // Physical options should be sorted alphabetically
    expect(physicalOptions[0].label).toBe('apple_table [PHYSICAL_DATA_ENTITY]');
    expect(physicalOptions[1].label).toBe('zebra_table [PHYSICAL_DATA_ENTITY]');
  });

  it('should return empty array when no entities exist', () => {
    const entities = createMockEntities([], []);

    const options = buildDataEntityPointOptions(entities);

    expect(options).toEqual([]);
  });
});

describe('resolveDataEntityPointLabel', () => {
  it('should parse dep_log_ prefix and return formatted label for logical entity', () => {
    const entities = createMockEntities([{ id: 'log_1', name: 'Customer' }], []);

    const label = resolveDataEntityPointLabel('dep_log_log_1', entities);

    expect(label).toBe('Customer [LOGICAL_DATA_ENTITY]');
  });

  it('should parse dep_phy_ prefix and return formatted label for physical entity', () => {
    const entities = createMockEntities([], [{ id: 'phy_1', name: 'customers_table' }]);

    const label = resolveDataEntityPointLabel('dep_phy_phy_1', entities);

    expect(label).toBe('customers_table [PHYSICAL_DATA_ENTITY]');
  });

  it('should return raw pointId as fallback when entity not found', () => {
    const entities = createMockEntities([], []);

    const label = resolveDataEntityPointLabel('dep_log_nonexistent', entities);

    expect(label).toBe('dep_log_nonexistent');
  });

  it('should return raw pointId for unknown prefix format', () => {
    const entities = createMockEntities([{ id: 'log_1', name: 'Customer' }], []);

    const label = resolveDataEntityPointLabel('unknown_prefix_123', entities);

    expect(label).toBe('unknown_prefix_123');
  });

  it('should return empty string for empty or null pointId', () => {
    const entities = createMockEntities([], []);

    expect(resolveDataEntityPointLabel('', entities)).toBe('');
    expect(resolveDataEntityPointLabel(null as unknown as string, entities)).toBe('');
    expect(resolveDataEntityPointLabel(undefined as unknown as string, entities)).toBe('');
  });
});
