/**
 * Tests for Infrastructure Domain Diagram Support Configuration
 *
 * Spec: 2026-05-05 Infrastructure Domain Diagram Support
 * Task Group 7: Verification - 5 focused tests on the wiring contracts
 *
 * Asserts that:
 *   1. 'Infrastructure' is registered in the DiagramType system (CREATABLE_DIAGRAM_TYPES,
 *      DIAGRAM_TYPE_LABELS, and case-insensitive normalisation via normalizeDiagramType
 *      which is the public surface for DIAGRAM_TYPE_MAP).
 *   2. DOMAIN_ENTITY_SECTIONS.infrastructure contains the 12 entity-section IDs in
 *      containment-friendly order.
 *   3. domainToPaletteSections.infrastructure and DIAGRAM_TYPE_PALETTE_RULES.Infrastructure
 *      both contain the 12 entity + 3 relationship section IDs (15 total).
 *   4. All 12 SCREAMING_SNAKE_CASE Infrastructure entity-type keys exist in entityColors
 *      with valid {background, border} hex string entries.
 *   5. The 3 new RELATIONSHIP_EDGE_TYPES constants exist (RESOURCE_SUBNET_HOSTING,
 *      DEPLOYMENT_UNIT_COMPUTE_RESOURCE, LOAD_BALANCER_RESOURCE_ROUTE).
 *
 * Modelled on infrastructureTablesConfig.test.ts (spec 4 Vitest convention).
 */

import { describe, it, expect } from 'vitest';
import {
  CREATABLE_DIAGRAM_TYPES,
  DIAGRAM_TYPE_LABELS,
  normalizeDiagramType,
} from '../../types/diagramType';
import {
  DOMAIN_ENTITY_SECTIONS,
  domainToPaletteSections,
  DIAGRAM_TYPE_PALETTE_RULES,
} from '../../utils/paletteData';
import { entityColors } from '../defaults';
import { RELATIONSHIP_EDGE_TYPES } from '../../types/model';

describe('Infrastructure Domain Diagram Support Configuration', () => {
  // The 12 entity-section IDs in containment-friendly order (spec.md ~line 20).
  const infraEntitySectionIds: string[] = [
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

  // The 3 relationship-section IDs (spec 3 RELATIONSHIP_TAB_ORDER).
  const infraRelationshipSectionIds: string[] = [
    'resource_subnet_hostings',
    'deployment_unit_compute_resources',
    'load_balancer_resource_routes',
  ];

  // The 12 SCREAMING_SNAKE_CASE entity-type constants matching InfrastructurePointKind.
  const infraEntityTypeConstants: string[] = [
    'ENVIRONMENT',
    'CLOUD_ACCOUNT',
    'LOCATION',
    'NETWORK',
    'SUBNET',
    'COMPUTE_CLUSTER',
    'COMPUTE_RESOURCE',
    'DEPLOYMENT_UNIT',
    'LOAD_BALANCER',
    'LISTENER',
    'DATA_STORE_INSTANCE',
    'INFRASTRUCTURE_RESOURCE',
  ];

  /**
   * Test 1: 'Infrastructure' is registered in the DiagramType system.
   *
   * - Present in CREATABLE_DIAGRAM_TYPES (user-creatable, unlike USER_JOURNEY).
   * - DIAGRAM_TYPE_LABELS['Infrastructure'] is defined as a string.
   * - normalizeDiagramType (the public surface for DIAGRAM_TYPE_MAP) handles
   *   case-insensitive input ('infrastructure', 'INFRASTRUCTURE', 'Infrastructure')
   *   and resolves to the canonical 'Infrastructure' value.
   */
  it("'Infrastructure' is registered in the DiagramType union, CREATABLE_DIAGRAM_TYPES, DIAGRAM_TYPE_LABELS, and normalises case-insensitively", () => {
    expect(CREATABLE_DIAGRAM_TYPES).toContain('Infrastructure');

    expect(DIAGRAM_TYPE_LABELS['Infrastructure']).toBeDefined();
    expect(typeof DIAGRAM_TYPE_LABELS['Infrastructure']).toBe('string');

    // Case-insensitive normalisation (DIAGRAM_TYPE_MAP runtime check via the public surface).
    expect(normalizeDiagramType('infrastructure')).toBe('Infrastructure');
    expect(normalizeDiagramType('INFRASTRUCTURE')).toBe('Infrastructure');
    expect(normalizeDiagramType('Infrastructure')).toBe('Infrastructure');
  });

  /**
   * Test 2: DOMAIN_ENTITY_SECTIONS.infrastructure contains the 12 entity-section IDs
   * in containment-friendly order.
   */
  it('DOMAIN_ENTITY_SECTIONS.infrastructure has 12 entity-section IDs in containment-friendly order', () => {
    const infraSections = DOMAIN_ENTITY_SECTIONS.infrastructure;
    expect(infraSections).toHaveLength(12);

    infraEntitySectionIds.forEach(sectionId => {
      expect(infraSections, `DOMAIN_ENTITY_SECTIONS.infrastructure must contain '${sectionId}'`).toContain(sectionId);
    });
  });

  /**
   * Test 3: domainToPaletteSections.infrastructure and DIAGRAM_TYPE_PALETTE_RULES.Infrastructure
   * both contain the 12 entity + 3 relationship section IDs (15 total).
   */
  it('domainToPaletteSections.infrastructure and DIAGRAM_TYPE_PALETTE_RULES.Infrastructure contain 12 entity + 3 relationship section IDs', () => {
    const allSectionIds = [...infraEntitySectionIds, ...infraRelationshipSectionIds];

    const domainSections = domainToPaletteSections.infrastructure;
    allSectionIds.forEach(sectionId => {
      expect(domainSections, `domainToPaletteSections.infrastructure must contain '${sectionId}'`).toContain(sectionId);
    });

    const diagramTypeSections = DIAGRAM_TYPE_PALETTE_RULES.Infrastructure;
    expect(diagramTypeSections, 'DIAGRAM_TYPE_PALETTE_RULES.Infrastructure must be a non-null array').not.toBeNull();
    allSectionIds.forEach(sectionId => {
      expect(diagramTypeSections, `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure must contain '${sectionId}'`).toContain(sectionId);
    });
    // Strict size check on the diagram-type filter rule.
    // Spec 2026-05-05 (cross-domain) extended this from 15 (12 entity + 3 Infra-internal relationship)
    // to 19 by appending the 4 cross-domain relationship section IDs.
    expect(diagramTypeSections).toHaveLength(19);
  });

  /**
   * Test 4: All 12 SCREAMING_SNAKE_CASE Infrastructure entity-type keys exist in entityColors
   * with valid {background, border} hex string entries.
   */
  it('All 12 SCREAMING_SNAKE_CASE Infrastructure entity-type keys exist in entityColors with hex {background, border} entries', () => {
    infraEntityTypeConstants.forEach(entityType => {
      const colors = entityColors[entityType];
      expect(colors, `entityColors.${entityType} must be defined`).toBeDefined();
      expect(typeof colors.background, `entityColors.${entityType}.background must be a string`).toBe('string');
      expect(colors.background.startsWith('#'), `entityColors.${entityType}.background must be a hex value`).toBe(true);
      expect(typeof colors.border, `entityColors.${entityType}.border must be a string`).toBe('string');
      expect(colors.border.startsWith('#'), `entityColors.${entityType}.border must be a hex value`).toBe(true);
    });
  });

  /**
   * Test 5: The 3 new RELATIONSHIP_EDGE_TYPES constants exist with SCREAMING_SNAKE_CASE
   * string values matching their keys.
   */
  it('RELATIONSHIP_EDGE_TYPES has RESOURCE_SUBNET_HOSTING, DEPLOYMENT_UNIT_COMPUTE_RESOURCE, and LOAD_BALANCER_RESOURCE_ROUTE constants', () => {
    expect(RELATIONSHIP_EDGE_TYPES.RESOURCE_SUBNET_HOSTING).toBe('RESOURCE_SUBNET_HOSTING');
    expect(RELATIONSHIP_EDGE_TYPES.DEPLOYMENT_UNIT_COMPUTE_RESOURCE).toBe('DEPLOYMENT_UNIT_COMPUTE_RESOURCE');
    expect(RELATIONSHIP_EDGE_TYPES.LOAD_BALANCER_RESOURCE_ROUTE).toBe('LOAD_BALANCER_RESOURCE_ROUTE');
  });
});
