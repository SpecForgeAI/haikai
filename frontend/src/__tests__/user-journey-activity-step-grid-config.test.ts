/**
 * Task Group 1 Tests: Grid Column Configs and Tab Registration
 * for User Journeys and Activity Steps entity types.
 *
 * Spec: 2026-04-01-user-journey-business-architecture-table-ui
 * FR1: User Journeys Grid Column Configuration
 * FR2: Activity Steps Grid Column Configuration
 * FR3: Tab Strip Registration
 */

import {
  gridConfigs,
  tabToEntityType,
  entityTabNames,
  domainGroupings,
  DOMAIN_ENTITY_TYPES,
} from '../config/gridConfigs';

describe('Task Group 1: User Journey & Activity Step Grid Config and Tab Registration', () => {

  // Test 1: user_journeys grid config has 6 columns with correct field names in order
  it('gridConfigs.user_journeys has 6 columns with correct field names in order', () => {
    const config = gridConfigs.user_journeys;
    expect(config).toBeDefined();
    expect(config).toHaveLength(6);

    const fieldNames = config.map((col) => col.field);
    expect(fieldNames).toEqual([
      'id',
      'name',
      'description',
      'primary_business_user_id',
      'parent_business_process_id',
      'tags',
    ]);
  });

  // Test 2: activity_steps grid config has 10 columns with correct field names in order
  it('gridConfigs.activity_steps has 10 columns with correct field names in order', () => {
    const config = gridConfigs.activity_steps;
    expect(config).toBeDefined();
    expect(config).toHaveLength(10);

    const fieldNames = config.map((col) => col.field);
    expect(fieldNames).toEqual([
      'id',
      'user_journey_id',
      'name',
      'diagram_label',
      'sequence_order',
      'process_activity_id',
      'business_user_id',
      'application_id',
      'activity_issues',
      'ui_issues',
    ]);
  });

  // Test 3: Verify FK columns on user_journeys
  it('user_journeys FK columns have correct cellType, fkTarget, and required flags', () => {
    const config = gridConfigs.user_journeys;

    const primaryBusinessUserId = config.find((col) => col.field === 'primary_business_user_id');
    expect(primaryBusinessUserId).toBeDefined();
    expect(primaryBusinessUserId!.cellType).toBe('fk_typeahead');
    expect(primaryBusinessUserId!.fkTarget).toBe('business_users');
    expect(primaryBusinessUserId!.required).toBe(false);

    const parentBusinessProcessId = config.find((col) => col.field === 'parent_business_process_id');
    expect(parentBusinessProcessId).toBeDefined();
    expect(parentBusinessProcessId!.cellType).toBe('fk_typeahead');
    expect(parentBusinessProcessId!.fkTarget).toBe('business_processes');
    expect(parentBusinessProcessId!.required).toBe(false);
  });

  // Test 4: Verify all four FK columns on activity_steps have correct config
  it('activity_steps FK columns have cellType fk_typeahead, required true, and correct fkTarget', () => {
    const config = gridConfigs.activity_steps;

    const fkColumns = [
      { field: 'user_journey_id', fkTarget: 'user_journeys' },
      { field: 'process_activity_id', fkTarget: 'process_activities' },
      { field: 'business_user_id', fkTarget: 'business_users' },
      { field: 'application_id', fkTarget: 'applications' },
    ];

    for (const expected of fkColumns) {
      const col = config.find((c) => c.field === expected.field);
      expect(col).toBeDefined();
      expect(col!.cellType).toBe('fk_typeahead');
      expect(col!.required).toBe(true);
      expect(col!.fkTarget).toBe(expected.fkTarget);
    }
  });

  // Test 5: Tab registration entries
  it('tabToEntityType, entityTabNames, and domainGroupings.business contain both new entities', () => {
    // tabToEntityType
    expect(tabToEntityType['User Journeys']).toBe('user_journeys');
    expect(tabToEntityType['Activity Steps']).toBe('activity_steps');

    // entityTabNames
    expect(entityTabNames).toContain('User Journeys');
    expect(entityTabNames).toContain('Activity Steps');

    // domainGroupings.business
    expect(domainGroupings.business).toEqual([
      'Users',
      'Processes',
      'Activities',
      'User Journeys',
      'Activity Steps',
    ]);
  });

  // Test 6: DOMAIN_ENTITY_TYPES.business contains both new entity types
  it('DOMAIN_ENTITY_TYPES.business contains user_journeys and activity_steps', () => {
    expect(DOMAIN_ENTITY_TYPES.business).toContain('user_journeys');
    expect(DOMAIN_ENTITY_TYPES.business).toContain('activity_steps');
    // Also verify existing ones are still there
    expect(DOMAIN_ENTITY_TYPES.business).toContain('business_users');
    expect(DOMAIN_ENTITY_TYPES.business).toContain('business_processes');
    expect(DOMAIN_ENTITY_TYPES.business).toContain('process_activities');
    expect(DOMAIN_ENTITY_TYPES.business).toContain('business_points');
  });
});
