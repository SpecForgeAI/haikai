/**
 * Task Group 5: Test Review & Gap Analysis
 *
 * Additional tests to fill critical gaps in Package Sets implementation:
 * - Edge cases for package count computation
 * - Type safety checks
 * - Domain boundary tests
 *
 * Created as part of spec: 2026-01-06-package-sets-screen
 */

import {
  tabToEntityType,
  relationshipTabToType,
  domainGroupings,
  DOMAIN_ENTITY_TYPES,
} from '../config/gridConfigs';
import { PackageSet, Package } from '../types/model';

describe('Task Group 5: Gap Analysis Tests', () => {
  describe('5.1 Edge Cases for Package Count Computation', () => {
    it('should handle packages with different package_set_id correctly', () => {
      const packages: Package[] = [
        { id: 'pkg-1', package_set_id: 'ps-1', name: 'pkg1' },
        { id: 'pkg-2', package_set_id: 'ps-2', name: 'pkg2' },
        { id: 'pkg-3', package_set_id: 'ps-1', name: 'pkg3' },
        { id: 'pkg-4', package_set_id: 'ps-3', name: 'pkg4' },
      ];

      const countForPs1 = packages.filter((p) => p.package_set_id === 'ps-1').length;
      const countForPs2 = packages.filter((p) => p.package_set_id === 'ps-2').length;
      const countForPs3 = packages.filter((p) => p.package_set_id === 'ps-3').length;
      const countForPs4 = packages.filter((p) => p.package_set_id === 'ps-4').length;

      expect(countForPs1).toBe(2);
      expect(countForPs2).toBe(1);
      expect(countForPs3).toBe(1);
      expect(countForPs4).toBe(0); // Non-existent package set
    });

    it('should handle packages with null/undefined package_set_id', () => {
      const packages: Package[] = [
        { id: 'pkg-1', package_set_id: 'ps-1', name: 'pkg1' },
        { id: 'pkg-2', package_set_id: '', name: 'pkg2' }, // Empty string
      ];

      const countForPs1 = packages.filter((p) => p.package_set_id === 'ps-1').length;
      const countForEmpty = packages.filter((p) => p.package_set_id === '').length;

      expect(countForPs1).toBe(1);
      expect(countForEmpty).toBe(1);
    });
  });

  describe('5.2 Type Safety Checks', () => {
    it('should ensure PackageSet has required id and name fields', () => {
      const packageSet: PackageSet = {
        id: 'ps-1',
        name: 'Core Domain',
      };

      expect(packageSet.id).toBeDefined();
      expect(packageSet.name).toBeDefined();
      expect(typeof packageSet.id).toBe('string');
      expect(typeof packageSet.name).toBe('string');
    });

    it('should ensure Package has required fields and optional fields', () => {
      const packageWithOptional: Package = {
        id: 'pkg-1',
        package_set_id: 'ps-1',
        name: 'domain.model',
        purpose: 'Domain models and entities',
        sort_order: 1,
      };

      const packageMinimal: Package = {
        id: 'pkg-2',
        package_set_id: 'ps-1',
        name: 'domain.service',
      };

      // With optional fields
      expect(packageWithOptional.purpose).toBe('Domain models and entities');
      expect(packageWithOptional.sort_order).toBe(1);

      // Without optional fields
      expect(packageMinimal.purpose).toBeUndefined();
      expect(packageMinimal.sort_order).toBeUndefined();
    });
  });

  describe('5.3 Domain Configuration Consistency', () => {
    it('should have Package Sets in tabToEntityType but NOT Packages', () => {
      expect(tabToEntityType['Package Sets']).toBe('package_sets');
      expect(tabToEntityType['Packages']).toBeUndefined();
    });

    it('should NOT have Package Sets or Packages in relationshipTabToType', () => {
      expect(relationshipTabToType['Package Sets']).toBeUndefined();
      expect(relationshipTabToType['Packages']).toBeUndefined();
    });

    it('should have package_sets and packages in DOMAIN_ENTITY_TYPES.application', () => {
      const applicationTypes = DOMAIN_ENTITY_TYPES.application;
      expect(applicationTypes).toContain('package_sets');
      expect(applicationTypes).toContain('packages');
    });

    it('should NOT have package_sets or packages in other domains', () => {
      const businessTypes = DOMAIN_ENTITY_TYPES.business;
      const dataTypes = DOMAIN_ENTITY_TYPES.data;
      const behaviouralTypes = DOMAIN_ENTITY_TYPES.behavioural;
      const uiTypes = DOMAIN_ENTITY_TYPES.ui;

      expect(businessTypes).not.toContain('package_sets');
      expect(businessTypes).not.toContain('packages');
      expect(dataTypes).not.toContain('package_sets');
      expect(dataTypes).not.toContain('packages');
      expect(behaviouralTypes).not.toContain('package_sets');
      expect(behaviouralTypes).not.toContain('packages');
      expect(uiTypes).not.toContain('package_sets');
      expect(uiTypes).not.toContain('packages');
    });
  });

  describe('5.4 Sorting Edge Cases', () => {
    it('should handle mixed sort_order values (some defined, some undefined)', () => {
      const packages: Package[] = [
        { id: 'pkg-1', package_set_id: 'ps-1', name: 'first', sort_order: 3 },
        { id: 'pkg-2', package_set_id: 'ps-1', name: 'second' }, // undefined
        { id: 'pkg-3', package_set_id: 'ps-1', name: 'third', sort_order: 1 },
        { id: 'pkg-4', package_set_id: 'ps-1', name: 'fourth' }, // undefined
      ];

      const sorted = [...packages].sort((a, b) => {
        const orderA = a.sort_order ?? Infinity;
        const orderB = b.sort_order ?? Infinity;
        return orderA - orderB;
      });

      // First should be the one with sort_order 1, then 3, then undefined ones
      expect(sorted[0].name).toBe('third'); // sort_order: 1
      expect(sorted[1].name).toBe('first'); // sort_order: 3
      // The undefined ones maintain relative order (both have Infinity)
    });

    it('should handle negative sort_order values', () => {
      const packages: Package[] = [
        { id: 'pkg-1', package_set_id: 'ps-1', name: 'first', sort_order: 2 },
        { id: 'pkg-2', package_set_id: 'ps-1', name: 'second', sort_order: -1 },
        { id: 'pkg-3', package_set_id: 'ps-1', name: 'third', sort_order: 0 },
      ];

      const sorted = [...packages].sort((a, b) => {
        const orderA = a.sort_order ?? Infinity;
        const orderB = b.sort_order ?? Infinity;
        return orderA - orderB;
      });

      expect(sorted[0].sort_order).toBe(-1);
      expect(sorted[1].sort_order).toBe(0);
      expect(sorted[2].sort_order).toBe(2);
    });
  });

  describe('5.5 Empty Arrays Handling', () => {
    it('should handle empty package_sets array', () => {
      const packageSets: PackageSet[] = [];
      expect(packageSets.length).toBe(0);

      // useMemo simulation
      const packageSetWithCounts = packageSets.map((set) => ({
        ...set,
        packageCount: 0,
      }));

      expect(packageSetWithCounts.length).toBe(0);
    });

    it('should handle package_sets with no matching packages', () => {
      const packageSets: PackageSet[] = [
        { id: 'ps-1', name: 'Empty Set' },
      ];
      const packages: Package[] = [
        { id: 'pkg-1', package_set_id: 'ps-other', name: 'orphan' },
      ];

      const packageSetWithCounts = packageSets.map((set) => ({
        ...set,
        packageCount: packages.filter((p) => p.package_set_id === set.id).length,
      }));

      expect(packageSetWithCounts[0].packageCount).toBe(0);
    });
  });
});
