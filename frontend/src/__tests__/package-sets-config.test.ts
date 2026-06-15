/**
 * Task Group 1 Tests: Package Sets Configuration
 *
 * Tests to verify the Package Sets configuration is correctly set up:
 * - tabToEntityType mapping includes 'Package Sets' -> 'package_sets'
 * - domainGroupings.application includes 'Package Sets' after Methods
 * - DOMAIN_ENTITY_TYPES.application includes 'package_sets' and 'packages'
 * - 'Packages' is NOT added as a separate tab entry
 *
 * Created as part of spec: 2026-01-06-package-sets-screen
 */

import {
  tabToEntityType,
  domainGroupings,
  DOMAIN_ENTITY_TYPES,
  entityTabNames,
} from '../config/gridConfigs';

describe('Task Group 1: Package Sets Configuration', () => {
  describe('1.1 tabToEntityType mapping', () => {
    it('should have "Package Sets" key mapping to "package_sets"', () => {
      expect(tabToEntityType['Package Sets']).toBe('package_sets');
    });

    it('should NOT have "Packages" as a separate tab entry', () => {
      expect(tabToEntityType['Packages']).toBeUndefined();
    });
  });

  describe('1.2 domainGroupings.application', () => {
    it('should include "Package Sets" in application domain', () => {
      expect(domainGroupings.application).toContain('Package Sets');
    });

    it('should have "Package Sets" positioned after "Methods"', () => {
      const methodsIndex = domainGroupings.application.indexOf('Methods');
      const packageSetsIndex = domainGroupings.application.indexOf('Package Sets');

      expect(methodsIndex).toBeGreaterThanOrEqual(0);
      expect(packageSetsIndex).toBeGreaterThanOrEqual(0);
      expect(packageSetsIndex).toBeGreaterThan(methodsIndex);
    });

    it('should NOT include "Packages" as a separate navigation tab', () => {
      expect(domainGroupings.application).not.toContain('Packages');
    });
  });

  describe('1.3 DOMAIN_ENTITY_TYPES.application', () => {
    it('should include "package_sets" in application domain entity types', () => {
      expect(DOMAIN_ENTITY_TYPES.application).toContain('package_sets');
    });

    it('should include "packages" in application domain entity types', () => {
      expect(DOMAIN_ENTITY_TYPES.application).toContain('packages');
    });
  });

  describe('1.4 entityTabNames', () => {
    it('should NOT include "Packages" in entityTabNames', () => {
      expect(entityTabNames).not.toContain('Packages');
    });
  });
});
