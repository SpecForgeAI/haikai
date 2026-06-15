/**
 * Tests for Library Frontend Types & Tables Configuration
 *
 * Spec: 2026-05-06 Library Frontend Types & Tables
 * Task Group 6: Frontend Vitest config test asserting all wiring is present.
 *
 * Asserts that:
 *   1. gridConfigs.libraries exists with required-field columns (name, description, tags).
 *   2. gridConfigs.code_unit_dependencies exists with picker columns
 *      (source_application_point_id required + allowedKinds; target same).
 *   3. tabToEntityType / entityTabNames / relationshipTabToType / relationshipTabNames
 *      include the new entries.
 *   4. RELATIONSHIP_DEFINITIONS has the code_unit_dependencies entry with the
 *      polymorphic anchor + concrete endpoint types.
 *   5. Domain registration (ENTITY_TYPE_TO_DOMAIN, DOMAIN_TO_ENTITY_TYPES,
 *      DOMAIN_TO_RELATIONSHIP_TYPES, domainGroupings, DOMAIN_ENTITY_TYPES) is wired.
 *   6. New picklists (ecosystemOptions, dependencyScopeOptions) exist with expected
 *      values; reused spec-7 picklists (sourceOriginOptions, generationStatusOptions)
 *      are unchanged from spec 7.
 *   7. ApplicationPointTargetType.LIBRARY enum + ApplicationPointKind extension
 *      are present.
 *   8. emptyModel defaults include libraries: [] and code_unit_dependencies: [].
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
  ENTITY_TYPE_TO_DOMAIN,
} from '../relationshipDefinitions';
import {
  DOMAIN_TO_ENTITY_TYPES,
  DOMAIN_TO_RELATIONSHIP_TYPES,
} from '../../utils/contextPickerDomainMappings';
import {
  ecosystemOptions,
  dependencyScopeOptions,
  sourceOriginOptions,
  generationStatusOptions,
  emptyModel,
} from '../defaults';
import { ApplicationPointTargetType } from '../../types/model';
import type { ApplicationPointKind } from '../../types/model';

describe('Library Frontend Types & Tables Configuration', () => {
  /**
   * Test 1: gridConfigs.libraries exists with required-field columns.
   */
  it('gridConfigs.libraries exists with name (required), description (required), and tags columns', () => {
    const config = gridConfigs.libraries;
    expect(config, 'gridConfigs.libraries must exist').toBeDefined();
    expect(Array.isArray(config), 'gridConfigs.libraries must be an array').toBe(true);

    const nameCol = config.find(c => c.field === 'name');
    expect(nameCol, 'gridConfigs.libraries must contain name column').toBeDefined();
    expect(nameCol?.required, 'gridConfigs.libraries.name must be required: true').toBe(true);

    const descCol = config.find(c => c.field === 'description');
    expect(descCol, 'gridConfigs.libraries must contain description column').toBeDefined();
    expect(descCol?.required, 'gridConfigs.libraries.description must be required: true').toBe(true);

    const tagsCol = config.find(c => c.field === 'tags');
    expect(tagsCol, 'gridConfigs.libraries must contain tags column').toBeDefined();
    expect(tagsCol?.cellType).toBe('tags');
  });

  /**
   * Test 2: gridConfigs.code_unit_dependencies exists with picker columns + allowedKinds.
   */
  it('gridConfigs.code_unit_dependencies exists with source/target application_point_picker columns (required) with correct allowedKinds', () => {
    const config = gridConfigs.code_unit_dependencies;
    expect(config, 'gridConfigs.code_unit_dependencies must exist').toBeDefined();
    expect(Array.isArray(config), 'gridConfigs.code_unit_dependencies must be an array').toBe(true);

    const sourceCol = config.find(c => c.field === 'source_application_point_id');
    expect(sourceCol, 'must contain source_application_point_id column').toBeDefined();
    expect(sourceCol?.required, 'source_application_point_id must be required: true').toBe(true);
    expect(sourceCol?.cellType).toBe('application_point_picker');
    expect(sourceCol?.allowedKinds).toEqual(['SERVICE', 'LIBRARY']);

    const targetCol = config.find(c => c.field === 'target_application_point_id');
    expect(targetCol, 'must contain target_application_point_id column').toBeDefined();
    expect(targetCol?.required, 'target_application_point_id must be required: true').toBe(true);
    expect(targetCol?.cellType).toBe('application_point_picker');
    expect(targetCol?.allowedKinds).toEqual(['LIBRARY']);
  });

  /**
   * Test 3: Tab maps include the new entries.
   */
  it('tab maps include Libraries entity tab and Library Dependency relationship tab', () => {
    expect(tabToEntityType['Libraries']).toBe('libraries');
    expect(entityTabNames).toContain('Libraries');

    expect(relationshipTabToType['Library Dependency']).toBe('code_unit_dependencies');
    expect(relationshipTabNames).toContain('Library Dependency');
  });

  /**
   * Test 4: RELATIONSHIP_DEFINITIONS has the code_unit_dependencies entry with
   * polymorphic anchor + concrete endpoint types.
   */
  it('RELATIONSHIP_DEFINITIONS contains code_unit_dependencies entry with correct displayName and endpointEntityTypes', () => {
    const def = RELATIONSHIP_DEFINITIONS.find(d => d.relationshipKey === 'code_unit_dependencies');
    expect(def, 'RELATIONSHIP_DEFINITIONS must contain code_unit_dependencies').toBeDefined();
    expect(def?.displayName).toBe('Library Dependency');
    expect(def?.endpointEntityTypes).toEqual(['application_points', 'services', 'libraries']);
  });

  /**
   * Test 5: Domain registration is wired across all 5 maps.
   */
  it('domain registration places libraries and code_unit_dependencies in the application domain', () => {
    expect(ENTITY_TYPE_TO_DOMAIN.libraries).toBe('application');
    expect(DOMAIN_TO_ENTITY_TYPES.application).toContain('libraries');
    expect(DOMAIN_TO_RELATIONSHIP_TYPES.application).toContain('code_unit_dependencies');
    expect(DOMAIN_ENTITY_TYPES.application).toContain('libraries');

    // Q3: domainGroupings.application includes 'Libraries' directly after 'Services'.
    expect(domainGroupings.application).toContain('Libraries');
    const servicesIdx = domainGroupings.application.indexOf('Services');
    const librariesIdx = domainGroupings.application.indexOf('Libraries');
    expect(servicesIdx).toBeGreaterThanOrEqual(0);
    expect(librariesIdx).toBe(servicesIdx + 1);
  });

  /**
   * Test 6: Picklists - new arrays exist with expected values; reused arrays unchanged.
   */
  it('new picklists exist with expected values; reused spec-7 picklists are unchanged', () => {
    expect(ecosystemOptions).toEqual(['MAVEN', 'NPM', 'PYPI', 'NUGET', 'GO', 'OTHER']);
    expect(dependencyScopeOptions).toEqual(['COMPILE', 'RUNTIME', 'TEST', 'PROVIDED', 'OPTIONAL', 'DEV', 'PEER']);

    // Smoke check: spec 7 picklists are NOT redeclared by spec 2.
    expect(sourceOriginOptions).toEqual(['MANUAL', 'DISCOVERED', 'IMPORTED', 'GENERATED', 'SUGGESTED', 'OTHER']);
    expect(generationStatusOptions).toEqual(['NOT_READY', 'READY', 'GENERATED', 'BLOCKED', 'NOT_APPLICABLE', 'UNKNOWN']);
  });

  /**
   * Test 7: ApplicationPointTargetType / ApplicationPointKind extensions present.
   */
  it('ApplicationPointTargetType.LIBRARY enum exists; LIBRARY is a valid ApplicationPointKind', () => {
    expect(ApplicationPointTargetType.LIBRARY).toBe('LIBRARY');
    // Compile-time assertion - if 'LIBRARY' is not assignable to ApplicationPointKind,
    // tsc --noEmit will fail.
    const kind: ApplicationPointKind = 'LIBRARY';
    expect(kind).toBe('LIBRARY');
  });

  /**
   * Test 8: emptyModel defaults include libraries / code_unit_dependencies arrays.
   */
  it('emptyModel.metaModel.entities.libraries and emptyModel.metaModel.relationships.code_unit_dependencies are []', () => {
    expect(emptyModel.metaModel.entities.libraries).toEqual([]);
    expect(emptyModel.metaModel.relationships.code_unit_dependencies).toEqual([]);
  });
});
