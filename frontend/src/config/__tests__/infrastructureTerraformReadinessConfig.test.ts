/**
 * Tests for Infrastructure Terraform & Discovery Readiness Configuration
 *
 * Spec: 2026-05-05 Infrastructure Terraform & Discovery Readiness
 * Task Group 7: Frontend Vitest config test asserting all wiring is present.
 *
 * Asserts that:
 *   1. 2 new gridConfigs entries exist with required-field columns
 *      (iac_sources.name; iac_resource_bindings.infrastructure_point_id and
 *       iac_resource_bindings.iac_source_id).
 *   2. tabToEntityType / entityTabNames / relationshipTabToType /
 *      relationshipTabNames each include the 2 new entries with correct labels.
 *   3. RELATIONSHIP_DEFINITIONS has iac_resource_bindings with the documented
 *      endpoint entity types.
 *   4. ENTITY_TYPE_TO_DOMAIN.iac_sources === 'infrastructure'.
 *   5. DOMAIN_TO_ENTITY_TYPES.infrastructure includes 'iac_sources';
 *      DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure includes 'iac_resource_bindings'.
 *   6. 6 new picklist arrays exist with the expected verbatim values; the
 *      existing providerOptions array is UNCHANGED (does NOT include 'MULTI').
 *   7. emptyModel.entities.iac_sources and
 *      emptyModel.relationships.iac_resource_bindings are arrays.
 *
 * Modelled on infrastructureCrossDomainConfig.test.ts (spec 6 reference).
 */

import { describe, it, expect } from 'vitest';
import {
  gridConfigs,
  tabToEntityType,
  entityTabNames,
  relationshipTabToType,
  relationshipTabNames,
  domainGroupings,
  DOMAIN_ENTITY_TYPES,
} from '../gridConfigs';
import {
  RELATIONSHIP_DEFINITIONS,
  RELATIONSHIP_TAB_ORDER,
  ENTITY_TYPE_TO_DOMAIN,
} from '../relationshipDefinitions';
import {
  DOMAIN_TO_ENTITY_TYPES,
  DOMAIN_TO_RELATIONSHIP_TYPES,
} from '../../utils/contextPickerDomainMappings';
import {
  sourceOriginOptions,
  generationStatusOptions,
  iacSourceTypeOptions,
  repositoryProviderOptions,
  iacSourceProviderOptions,
  bindingStatusOptions,
  providerOptions,
  emptyModel,
} from '../defaults';

describe('Infrastructure Terraform & Discovery Readiness Configuration', () => {
  /**
   * Test 1: 2 new gridConfigs entries exist with their required-field columns.
   */
  it('gridConfigs has 2 new entries (iac_sources, iac_resource_bindings) with the documented required columns', () => {
    // iac_sources
    const iacSources = gridConfigs.iac_sources;
    expect(iacSources, 'gridConfigs.iac_sources must exist').toBeDefined();
    expect(Array.isArray(iacSources)).toBe(true);
    const nameCol = iacSources.find(c => c.field === 'name');
    expect(nameCol, 'gridConfigs.iac_sources.name must exist').toBeDefined();
    expect(nameCol?.required, 'gridConfigs.iac_sources.name must be required').toBe(true);

    // iac_resource_bindings
    const iacBindings = gridConfigs.iac_resource_bindings;
    expect(iacBindings, 'gridConfigs.iac_resource_bindings must exist').toBeDefined();
    expect(Array.isArray(iacBindings)).toBe(true);

    const ipCol = iacBindings.find(c => c.field === 'infrastructure_point_id');
    expect(ipCol, 'gridConfigs.iac_resource_bindings.infrastructure_point_id must exist').toBeDefined();
    expect(ipCol?.cellType, 'infrastructure_point_id must use infrastructure_point_picker').toBe('infrastructure_point_picker');
    expect(ipCol?.required, 'infrastructure_point_id must be required').toBe(true);
    // No allowedKinds restriction - bindings can target any of the 12 Infra entity kinds.
    expect(ipCol?.allowedKinds, 'infrastructure_point_id must NOT have allowedKinds restriction').toBeUndefined();

    const sourceCol = iacBindings.find(c => c.field === 'iac_source_id');
    expect(sourceCol, 'gridConfigs.iac_resource_bindings.iac_source_id must exist').toBeDefined();
    expect(sourceCol?.cellType, 'iac_source_id must use fk_typeahead').toBe('fk_typeahead');
    expect(sourceCol?.fkTarget, 'iac_source_id must target iac_sources').toBe('iac_sources');
    expect(sourceCol?.required, 'iac_source_id must be required').toBe(true);
  });

  /**
   * Test 2: Tab maps include the 2 new entries with the documented labels.
   */
  it('tabToEntityType / entityTabNames / relationshipTabToType / relationshipTabNames include the 2 new entries', () => {
    expect(tabToEntityType['IaC Sources']).toBe('iac_sources');
    expect(entityTabNames).toContain('IaC Sources');

    expect(relationshipTabToType['IaC Resource Bindings']).toBe('iac_resource_bindings');
    expect(relationshipTabNames).toContain('IaC Resource Bindings');

    // domainGroupings.infrastructure visible entry; DOMAIN_ENTITY_TYPES infrastructure list.
    expect(domainGroupings.infrastructure).toContain('IaC Sources');
    expect(DOMAIN_ENTITY_TYPES.infrastructure).toContain('iac_sources');
  });

  /**
   * Test 3: RELATIONSHIP_DEFINITIONS has iac_resource_bindings with the documented
   * endpoint entity types and RELATIONSHIP_TAB_ORDER includes the new tab label.
   */
  it('RELATIONSHIP_DEFINITIONS has iac_resource_bindings with documented endpoints; RELATIONSHIP_TAB_ORDER includes the new tab label', () => {
    const def = RELATIONSHIP_DEFINITIONS.find(d => d.relationshipKey === 'iac_resource_bindings');
    expect(def, 'RELATIONSHIP_DEFINITIONS must include iac_resource_bindings').toBeDefined();
    expect(def?.displayName).toBe('IaC Source <-> Infrastructure');
    // Must mix iac_sources with the polymorphic infrastructure_points anchor and the 12 Infra entity types.
    expect(def?.endpointEntityTypes).toContain('iac_sources');
    expect(def?.endpointEntityTypes).toContain('infrastructure_points');
    [
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
    ].forEach(et => {
      expect(def?.endpointEntityTypes, `endpointEntityTypes must contain '${et}'`).toContain(et);
    });

    expect(RELATIONSHIP_TAB_ORDER).toContain('IaC Source <-> Infrastructure');
    // Spec 6 landed 17 entries; spec 7 brings the total to 18.
    // Spec 2026-05-06 (Library Frontend Types & Tables) adds code_unit_dependencies (+1) -> 19.
    expect(RELATIONSHIP_DEFINITIONS).toHaveLength(19);
  });

  /**
   * Test 4: ENTITY_TYPE_TO_DOMAIN.iac_sources === 'infrastructure'.
   */
  it('ENTITY_TYPE_TO_DOMAIN.iac_sources is "infrastructure"', () => {
    expect(ENTITY_TYPE_TO_DOMAIN.iac_sources).toBe('infrastructure');
  });

  /**
   * Test 5: DOMAIN_TO_ENTITY_TYPES / DOMAIN_TO_RELATIONSHIP_TYPES include the 2 new types.
   */
  it('DOMAIN_TO_ENTITY_TYPES.infrastructure / DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure include the 2 new types', () => {
    expect(DOMAIN_TO_ENTITY_TYPES.infrastructure).toContain('iac_sources');
    expect(DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure).toContain('iac_resource_bindings');
  });

  /**
   * Test 6: 6 new picklist arrays exist with verbatim values; existing providerOptions UNCHANGED.
   */
  it('6 new picklist arrays exist with the expected verbatim values; existing providerOptions is unchanged', () => {
    expect(sourceOriginOptions).toEqual(['MANUAL', 'DISCOVERED', 'IMPORTED', 'GENERATED', 'SUGGESTED', 'OTHER']);
    expect(generationStatusOptions).toEqual(['NOT_READY', 'READY', 'GENERATED', 'BLOCKED', 'NOT_APPLICABLE', 'UNKNOWN']);
    expect(iacSourceTypeOptions).toEqual(['TERRAFORM', 'OPENTOFU', 'CLOUDFORMATION', 'BICEP', 'PULUMI', 'KUBERNETES', 'HELM', 'OTHER']);
    expect(repositoryProviderOptions).toEqual(['GITHUB', 'GITLAB', 'BITBUCKET', 'AZURE_DEVOPS', 'OTHER']);
    expect(iacSourceProviderOptions).toEqual(['GCP', 'AWS', 'AZURE', 'ON_PREM', 'MULTI', 'OTHER']);
    expect(bindingStatusOptions).toEqual(['PLANNED', 'SUGGESTED', 'CONFIRMED', 'STALE', 'REMOVED', 'UNKNOWN']);

    // providerOptions (spec 4) MUST remain untouched: no MULTI value (per Q6).
    expect(providerOptions).toEqual(['GCP', 'AWS', 'AZURE', 'ON_PREM', 'OTHER']);
    expect(providerOptions).not.toContain('MULTI');
  });

  /**
   * Test 7: emptyModel carries the 2 new array fields, both default to [].
   */
  it('emptyModel.entities.iac_sources and emptyModel.relationships.iac_resource_bindings are present and default to []', () => {
    expect(Array.isArray(emptyModel.metaModel.entities.iac_sources)).toBe(true);
    expect(emptyModel.metaModel.entities.iac_sources).toEqual([]);

    expect(Array.isArray(emptyModel.metaModel.relationships.iac_resource_bindings)).toBe(true);
    expect(emptyModel.metaModel.relationships.iac_resource_bindings).toEqual([]);
  });
});
