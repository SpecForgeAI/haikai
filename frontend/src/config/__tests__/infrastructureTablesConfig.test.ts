/**
 * Tests for Infrastructure Domain Tables UI Configuration
 *
 * Spec: 2026-05-04 Infrastructure Domain Tables UI
 * Task Group 6: Verification - 4 focused tests on the wiring contracts
 *
 * Asserts that:
 *   1. All 16 gridConfigs entries exist with the documented required-field columns
 *      (12 visible entities + infrastructure_points hidden + 3 relationships).
 *   2. The 12 visible Infrastructure entity tabs are wired through tabToEntityType
 *      and listed in domainGroupings.infrastructure (and that the hidden
 *      'Infrastructure Points' tab is mapped but NOT in domainGroupings).
 *   3. The 3 Infrastructure relationship tabs are wired through relationshipTabToType,
 *      present in RELATIONSHIP_TAB_ORDER, and listed in relationshipTabNames.
 *   4. DOMAIN_ENTITY_TYPES.infrastructure is populated with all 13 entity-type strings.
 *
 * Modelled on userJourneyLinksConfig.test.ts (Vitest convention).
 */

import { describe, it, expect } from 'vitest';
import {
  gridConfigs,
  tabToEntityType,
  relationshipTabToType,
  relationshipTabNames,
  domainGroupings,
  DOMAIN_ENTITY_TYPES,
} from '../gridConfigs';
import { RELATIONSHIP_TAB_ORDER } from '../relationshipDefinitions';

describe('Infrastructure Domain Tables UI Configuration', () => {
  // Constants used across multiple tests
  const visibleEntityTypes: string[] = [
    'environments',
    'cloud_accounts',
    'locations',
    'networks',
    'subnets',
    'compute_clusters',
    'compute_resources',
    'deployment_units',
    'load_balancers',
    'listeners',
    'data_store_instances',
    'infrastructure_resources',
  ];

  const visibleEntityTabNames: string[] = [
    'Environments',
    'Cloud Accounts',
    'Locations',
    'Networks',
    'Subnets',
    'Compute Clusters',
    'Compute Resources',
    'Deployment Units',
    'Load Balancers',
    'Listeners',
    'Data Stores',
    'Infrastructure Resources',
  ];

  const tabNameToEntityType: Record<string, string> = {
    'Environments': 'environments',
    'Cloud Accounts': 'cloud_accounts',
    'Locations': 'locations',
    'Networks': 'networks',
    'Subnets': 'subnets',
    'Compute Clusters': 'compute_clusters',
    'Compute Resources': 'compute_resources',
    'Deployment Units': 'deployment_units',
    'Load Balancers': 'load_balancers',
    'Listeners': 'listeners',
    'Data Stores': 'data_store_instances',
    'Infrastructure Resources': 'infrastructure_resources',
  };

  const relationshipTabs: { displayName: string; relationshipKey: string; pickerField: string; allowedKinds: string[]; requiredFkFields: string[] }[] = [
    {
      displayName: 'Resource <-> Subnet',
      relationshipKey: 'resource_subnet_hostings',
      pickerField: 'infrastructure_point_id',
      allowedKinds: ['COMPUTE_RESOURCE', 'DATA_STORE_INSTANCE', 'LOAD_BALANCER', 'INFRASTRUCTURE_RESOURCE'],
      requiredFkFields: ['subnet_id', 'environment_id'],
    },
    {
      displayName: 'Deployment Unit <-> Compute',
      relationshipKey: 'deployment_unit_compute_resources',
      pickerField: 'compute_infrastructure_point_id',
      allowedKinds: ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER'],
      requiredFkFields: ['deployment_unit_id', 'environment_id'],
    },
    {
      displayName: 'Load Balancer Routes',
      relationshipKey: 'load_balancer_resource_routes',
      pickerField: 'target_infrastructure_point_id',
      allowedKinds: ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER', 'DATA_STORE_INSTANCE', 'INFRASTRUCTURE_RESOURCE'],
      requiredFkFields: ['load_balancer_id', 'environment_id'],
    },
  ];

  /**
   * Test 1: gridConfigs has all 16 keys with non-empty column arrays and the
   * documented required-field columns.
   *
   * - 12 visible entity keys + 'infrastructure_points' (hidden) + 3 relationship keys.
   * - Each visible entity has a `name` column with `required: true`.
   * - `infrastructure_points` additionally has `point_kind` with `required: true`.
   * - Each relationship has its polymorphic infrastructure_point_picker column
   *   with the expected allowedKinds and the documented required FK columns.
   */
  it('gridConfigs has all 16 Infrastructure keys with non-empty column arrays and required-field columns', () => {
    // 12 visible entity tables — each has a required `name` column.
    visibleEntityTypes.forEach(entityType => {
      const config = gridConfigs[entityType];
      expect(config, `gridConfigs.${entityType} must be defined`).toBeDefined();
      expect(Array.isArray(config), `gridConfigs.${entityType} must be an array`).toBe(true);
      expect(config.length, `gridConfigs.${entityType} must have non-empty columns`).toBeGreaterThan(0);

      const nameCol = config.find(col => col.field === 'name');
      expect(nameCol, `gridConfigs.${entityType}.name column must exist`).toBeDefined();
      expect(nameCol!.required, `gridConfigs.${entityType}.name must be required: true`).toBe(true);
      expect(nameCol!.cellType, `gridConfigs.${entityType}.name must be cellType 'text'`).toBe('text');
    });

    // Hidden infrastructure_points entity — name AND point_kind both required.
    const ipConfig = gridConfigs['infrastructure_points'];
    expect(ipConfig, 'gridConfigs.infrastructure_points must be defined').toBeDefined();
    expect(Array.isArray(ipConfig)).toBe(true);
    expect(ipConfig.length).toBeGreaterThan(0);

    const ipNameCol = ipConfig.find(col => col.field === 'name');
    expect(ipNameCol).toBeDefined();
    expect(ipNameCol!.required).toBe(true);

    const ipKindCol = ipConfig.find(col => col.field === 'point_kind');
    expect(ipKindCol, 'gridConfigs.infrastructure_points.point_kind column must exist').toBeDefined();
    expect(ipKindCol!.required, 'gridConfigs.infrastructure_points.point_kind must be required: true').toBe(true);
    expect(ipKindCol!.cellType, 'gridConfigs.infrastructure_points.point_kind must be cellType dropdown').toBe('dropdown');

    // 3 relationship tables — polymorphic picker + required concrete FK columns.
    relationshipTabs.forEach(({ relationshipKey, pickerField, allowedKinds, requiredFkFields }) => {
      const config = gridConfigs[relationshipKey];
      expect(config, `gridConfigs.${relationshipKey} must be defined`).toBeDefined();
      expect(Array.isArray(config)).toBe(true);
      expect(config.length).toBeGreaterThan(0);

      // Polymorphic picker column with allowedKinds.
      const pickerCol = config.find(col => col.field === pickerField);
      expect(pickerCol, `gridConfigs.${relationshipKey}.${pickerField} must exist`).toBeDefined();
      expect(pickerCol!.cellType, `${relationshipKey}.${pickerField} must be infrastructure_point_picker`).toBe('infrastructure_point_picker');
      expect(pickerCol!.required, `${relationshipKey}.${pickerField} must be required: true`).toBe(true);
      expect(pickerCol!.allowedKinds, `${relationshipKey}.${pickerField} must declare allowedKinds`).toEqual(allowedKinds);

      // Required concrete-FK columns (subnet_id, deployment_unit_id, load_balancer_id) +
      // environment_id are required: true (backend NOT NULL).
      requiredFkFields.forEach(fkField => {
        const fkCol = config.find(col => col.field === fkField);
        expect(fkCol, `${relationshipKey}.${fkField} column must exist`).toBeDefined();
        expect(fkCol!.required, `${relationshipKey}.${fkField} must be required: true`).toBe(true);
        expect(fkCol!.cellType, `${relationshipKey}.${fkField} must be fk_typeahead`).toBe('fk_typeahead');
      });
    });
  });

  /**
   * Test 2: 12 visible entity tabs are wired through tabToEntityType and listed
   * in domainGroupings.infrastructure. The hidden 'Infrastructure Points' tab
   * is mapped in tabToEntityType but is NOT listed in domainGroupings.
   */
  it('12 visible Infrastructure entity tabs are wired through tabToEntityType and listed in domainGroupings.infrastructure', () => {
    visibleEntityTabNames.forEach(tabName => {
      const expectedEntityType = tabNameToEntityType[tabName];
      expect(tabToEntityType[tabName], `tabToEntityType['${tabName}'] must resolve`).toBe(expectedEntityType);
      expect(domainGroupings.infrastructure, `domainGroupings.infrastructure must contain '${tabName}'`).toContain(tabName);
    });

    // Hidden 'Infrastructure Points' tab — registered for internal wiring but NOT
    // visible in domainGroupings (mirrors Application Points / Business Points).
    expect(tabToEntityType['Infrastructure Points']).toBe('infrastructure_points');
    expect(domainGroupings.infrastructure).not.toContain('Infrastructure Points');
  });

  /**
   * Test 3: 3 Infrastructure relationship tabs are wired through relationshipTabToType,
   * present in RELATIONSHIP_TAB_ORDER, and listed in relationshipTabNames.
   */
  it('3 Infrastructure relationship tabs are wired through relationshipTabToType and present in RELATIONSHIP_TAB_ORDER', () => {
    relationshipTabs.forEach(({ displayName, relationshipKey }) => {
      expect(relationshipTabToType[displayName], `relationshipTabToType['${displayName}'] must resolve`).toBe(relationshipKey);
      expect(RELATIONSHIP_TAB_ORDER, `RELATIONSHIP_TAB_ORDER must contain '${displayName}'`).toContain(displayName);
      expect(relationshipTabNames, `relationshipTabNames must contain '${displayName}'`).toContain(displayName);
    });
  });

  /**
   * Test 4: DOMAIN_ENTITY_TYPES.infrastructure is populated with all 14
   * entity-type strings (12 visible + 'infrastructure_points' hidden +
   * 'iac_sources' added by spec 2026-05-05 Infrastructure Terraform &
   * Discovery Readiness).
   */
  it('DOMAIN_ENTITY_TYPES.infrastructure has all 14 entity-type strings (12 visible + infrastructure_points hidden + iac_sources from spec 7)', () => {
    const infraEntityTypes = DOMAIN_ENTITY_TYPES.infrastructure;
    expect(infraEntityTypes).toHaveLength(14);

    visibleEntityTypes.forEach(entityType => {
      expect(infraEntityTypes, `DOMAIN_ENTITY_TYPES.infrastructure must contain '${entityType}'`).toContain(entityType);
    });

    expect(infraEntityTypes, 'DOMAIN_ENTITY_TYPES.infrastructure must contain hidden infrastructure_points').toContain('infrastructure_points');
  });
});
