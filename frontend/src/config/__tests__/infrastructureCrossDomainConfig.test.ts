/**
 * Tests for Infrastructure Cross-Domain Integration Configuration
 *
 * Spec: 2026-05-05 Infrastructure Cross-Domain Integration
 * Task Group 8: Frontend Vitest config test asserting all wiring is present.
 *
 * Asserts that:
 *   1. 4 new gridConfigs entries exist with required-field columns
 *      (application_point_id / data_entity_point_id source-side required, primary
 *      target FK column required).
 *   2. 4 new tab names appended to relationshipTabNames and 4 new keys appended
 *      to relationshipTabToType mapping.
 *   3. RELATIONSHIP_DEFINITIONS has the 4 new entries with correct endpoint types,
 *      and RELATIONSHIP_TAB_ORDER contains the 4 new display names.
 *   4. DOMAIN_TO_RELATIONSHIP_TYPES.application / .data / .infrastructure are
 *      updated correctly; .behavioural and .ui are NOT extended.
 *   5. 4 new picklist arrays (deploymentRoleOptions, hostingRoleOptions,
 *      dependencyTypeOptions, accessModeOptions) exist with the expected values.
 *   6. 4 new RELATIONSHIP_EDGE_TYPES constants exist.
 *
 * Modelled on infrastructureDiagramConfig.test.ts (spec 5 reference).
 */

import { describe, it, expect } from 'vitest';
import {
  gridConfigs,
  relationshipTabToType,
  relationshipTabNames,
} from '../gridConfigs';
import {
  RELATIONSHIP_DEFINITIONS,
  RELATIONSHIP_TAB_ORDER,
} from '../relationshipDefinitions';
import { DOMAIN_TO_RELATIONSHIP_TYPES } from '../../utils/contextPickerDomainMappings';
import {
  deploymentRoleOptions,
  hostingRoleOptions,
  dependencyTypeOptions,
  accessModeOptions,
} from '../defaults';
import { RELATIONSHIP_EDGE_TYPES } from '../../types/model';

describe('Infrastructure Cross-Domain Integration Configuration', () => {
  // The 4 cross-domain relationship table keys.
  const crossDomainRelKeys: string[] = [
    'application_compute_deployments',
    'data_entity_data_store_hostings',
    'application_infrastructure_resource_uses',
    'application_load_balancer_exposures',
  ];

  // The 4 tab labels in canonical order (matches RELATIONSHIP_TAB_ORDER append order).
  const crossDomainTabLabels: string[] = [
    'App <-> Compute',
    'Data Entity <-> Data Store',
    'App <-> Infrastructure Resource',
    'App <-> Load Balancer',
  ];

  // For each relationship: source-side required field key + primary target FK key.
  const requiredFieldsByRel: Record<string, { source: string; target: string }> = {
    application_compute_deployments: { source: 'application_point_id', target: 'compute_resource_id' },
    data_entity_data_store_hostings: { source: 'data_entity_point_id', target: 'data_store_instance_id' },
    application_infrastructure_resource_uses: { source: 'application_point_id', target: 'infrastructure_resource_id' },
    application_load_balancer_exposures: { source: 'application_point_id', target: 'load_balancer_id' },
  };

  /**
   * Test 1: The 4 new gridConfigs entries exist with required-field source and target columns.
   */
  it('gridConfigs has 4 new cross-domain entries with required source-side and primary target FK columns', () => {
    crossDomainRelKeys.forEach(key => {
      const config = gridConfigs[key];
      expect(config, `gridConfigs.${key} must exist`).toBeDefined();
      expect(Array.isArray(config), `gridConfigs.${key} must be an array`).toBe(true);

      const expectedSource = requiredFieldsByRel[key].source;
      const sourceCol = config.find(c => c.field === expectedSource);
      expect(sourceCol, `gridConfigs.${key} must contain '${expectedSource}' column`).toBeDefined();
      expect(sourceCol?.required, `gridConfigs.${key}.${expectedSource} must be required: true`).toBe(true);

      const expectedTarget = requiredFieldsByRel[key].target;
      const targetCol = config.find(c => c.field === expectedTarget);
      expect(targetCol, `gridConfigs.${key} must contain '${expectedTarget}' column`).toBeDefined();
      expect(targetCol?.required, `gridConfigs.${key}.${expectedTarget} must be required: true`).toBe(true);
    });
  });

  /**
   * Test 2: The 4 new keys exist in relationshipTabToType mapping AND the 4 new tab names
   * are appended to relationshipTabNames.
   */
  it('relationshipTabToType maps 4 new tab labels to table keys; relationshipTabNames includes all 4 labels', () => {
    crossDomainTabLabels.forEach((label, idx) => {
      expect(relationshipTabToType[label], `relationshipTabToType['${label}'] must be defined`).toBe(crossDomainRelKeys[idx]);
      expect(relationshipTabNames, `relationshipTabNames must include '${label}'`).toContain(label);
    });
  });

  /**
   * Test 3: RELATIONSHIP_DEFINITIONS has the 4 new entries with correct endpoint entity types,
   * and RELATIONSHIP_TAB_ORDER contains the 4 new display names.
   */
  it('RELATIONSHIP_DEFINITIONS has 4 new cross-domain entries with correct endpointEntityTypes; RELATIONSHIP_TAB_ORDER includes the 4 new display names', () => {
    const expectedEndpoints: Record<string, string[]> = {
      application_compute_deployments: ['application_points', 'compute_resources'],
      data_entity_data_store_hostings: ['data_entity_points', 'data_store_instances'],
      application_infrastructure_resource_uses: ['application_points', 'infrastructure_resources'],
      application_load_balancer_exposures: ['application_points', 'load_balancers'],
    };

    crossDomainRelKeys.forEach((key, idx) => {
      const def = RELATIONSHIP_DEFINITIONS.find(d => d.relationshipKey === key);
      expect(def, `RELATIONSHIP_DEFINITIONS must contain '${key}'`).toBeDefined();
      expect(def?.displayName, `RELATIONSHIP_DEFINITIONS.${key}.displayName`).toBe(crossDomainTabLabels[idx]);
      // Each expected endpoint entity type must appear in the definition's endpointEntityTypes.
      expectedEndpoints[key].forEach(et => {
        expect(def?.endpointEntityTypes, `RELATIONSHIP_DEFINITIONS.${key}.endpointEntityTypes must include '${et}'`).toContain(et);
      });
    });

    crossDomainTabLabels.forEach(label => {
      expect(RELATIONSHIP_TAB_ORDER, `RELATIONSHIP_TAB_ORDER must include '${label}'`).toContain(label);
    });
  });

  /**
   * Test 4: DOMAIN_TO_RELATIONSHIP_TYPES is updated correctly per Q12.
   * Application gets Rels 1, 3, 4. Data gets Rel 2. Infrastructure gets all 4.
   * Behavioural and UI are NOT extended.
   */
  it('DOMAIN_TO_RELATIONSHIP_TYPES.application/.data/.infrastructure include the new cross-domain rels; .behavioural and .ui do not', () => {
    expect(DOMAIN_TO_RELATIONSHIP_TYPES.application).toContain('application_compute_deployments');
    expect(DOMAIN_TO_RELATIONSHIP_TYPES.application).toContain('application_infrastructure_resource_uses');
    expect(DOMAIN_TO_RELATIONSHIP_TYPES.application).toContain('application_load_balancer_exposures');
    expect(DOMAIN_TO_RELATIONSHIP_TYPES.application).not.toContain('data_entity_data_store_hostings');

    expect(DOMAIN_TO_RELATIONSHIP_TYPES.data).toContain('data_entity_data_store_hostings');
    expect(DOMAIN_TO_RELATIONSHIP_TYPES.data).not.toContain('application_compute_deployments');

    crossDomainRelKeys.forEach(key => {
      expect(DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure, `DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure must include '${key}'`).toContain(key);
    });

    // Behavioural and UI are NOT extended (Q12 - deferred to spec 7).
    crossDomainRelKeys.forEach(key => {
      expect(DOMAIN_TO_RELATIONSHIP_TYPES.behavioural, `DOMAIN_TO_RELATIONSHIP_TYPES.behavioural must NOT include '${key}'`).not.toContain(key);
      expect(DOMAIN_TO_RELATIONSHIP_TYPES.ui, `DOMAIN_TO_RELATIONSHIP_TYPES.ui must NOT include '${key}'`).not.toContain(key);
    });
  });

  /**
   * Test 5: The 4 new picklist arrays exist with the expected values.
   */
  it('4 new picklist arrays exist with expected values', () => {
    expect(deploymentRoleOptions).toEqual(['PRIMARY', 'SECONDARY', 'WORKER', 'BATCH', 'ADMIN', 'OTHER']);
    expect(hostingRoleOptions).toEqual(['PRIMARY', 'REPLICA', 'CACHE', 'ARCHIVE', 'ANALYTICS', 'OTHER']);
    expect(dependencyTypeOptions).toEqual(['READS_FROM', 'WRITES_TO', 'PUBLISHES_TO', 'SUBSCRIBES_TO', 'USES', 'STORES_IN', 'RETRIEVES_FROM', 'OTHER']);
    expect(accessModeOptions).toEqual(['READ', 'WRITE', 'READ_WRITE', 'EXECUTE', 'ADMIN', 'OTHER']);
  });

  /**
   * Test 6: The 4 new RELATIONSHIP_EDGE_TYPES constants exist.
   */
  it('RELATIONSHIP_EDGE_TYPES has APPLICATION_COMPUTE_DEPLOYMENT, DATA_ENTITY_DATA_STORE_HOSTING, APPLICATION_INFRASTRUCTURE_RESOURCE_USE, and APPLICATION_LOAD_BALANCER_EXPOSURE constants', () => {
    expect(RELATIONSHIP_EDGE_TYPES.APPLICATION_COMPUTE_DEPLOYMENT).toBe('APPLICATION_COMPUTE_DEPLOYMENT');
    expect(RELATIONSHIP_EDGE_TYPES.DATA_ENTITY_DATA_STORE_HOSTING).toBe('DATA_ENTITY_DATA_STORE_HOSTING');
    expect(RELATIONSHIP_EDGE_TYPES.APPLICATION_INFRASTRUCTURE_RESOURCE_USE).toBe('APPLICATION_INFRASTRUCTURE_RESOURCE_USE');
    expect(RELATIONSHIP_EDGE_TYPES.APPLICATION_LOAD_BALANCER_EXPOSURE).toBe('APPLICATION_LOAD_BALANCER_EXPOSURE');
  });
});
