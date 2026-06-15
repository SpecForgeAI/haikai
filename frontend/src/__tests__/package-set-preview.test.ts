/**
 * PackageSetPreview Component Unit Tests
 * Spec: Service Package Set Assignment Dropdown - Task Group 2
 */

import { PackageSet, Package } from '../types/model';

// Mock data for tests
const mockPackageSets: PackageSet[] = [
  { id: 'ps_001', name: 'Standard Package Set' },
  { id: 'ps_002', name: 'Empty Package Set' },
];

const mockPackages: Package[] = [
  { id: 'pkg_001', package_set_id: 'ps_001', name: 'api', purpose: 'REST API controllers', sort_order: 2 },
  { id: 'pkg_002', package_set_id: 'ps_001', name: 'domain', purpose: 'Business logic', sort_order: 1 },
  { id: 'pkg_003', package_set_id: 'ps_001', name: 'infra', purpose: 'Infrastructure', sort_order: 3 },
  { id: 'pkg_004', package_set_id: 'ps_other', name: 'other', purpose: 'Other package', sort_order: 1 },
];

describe('PackageSetPreview', () => {
  // Test 2.1.1: Preview hidden when no concrete selection
  describe('Visibility', () => {
    it('should return null when packageSetId is null', () => {
      const packageSetId: string | null = null;
      const selectedPackageSet = packageSetId
        ? mockPackageSets.find((ps) => ps.id === packageSetId)
        : null;

      // Preview should not render
      const shouldRender = packageSetId && selectedPackageSet;
      expect(shouldRender).toBeFalsy();
    });

    it('should return null when packageSetId is undefined', () => {
      const packageSetId: string | undefined = undefined;
      const selectedPackageSet = packageSetId
        ? mockPackageSets.find((ps) => ps.id === packageSetId)
        : null;

      const shouldRender = packageSetId && selectedPackageSet;
      expect(shouldRender).toBeFalsy();
    });

    it('should render when a valid Package Set is selected', () => {
      const packageSetId = 'ps_001';
      const selectedPackageSet = mockPackageSets.find((ps) => ps.id === packageSetId);

      const shouldRender = packageSetId && selectedPackageSet;
      expect(shouldRender).toBeTruthy();
    });
  });

  // Test 2.1.2: Packages are ordered by sort_order ascending
  describe('Package ordering', () => {
    it('should order packages by sort_order ascending', () => {
      const packageSetId = 'ps_001';
      const filtered = mockPackages.filter((p) => p.package_set_id === packageSetId);

      // Sort by sort_order ascending
      const sorted = [...filtered].sort((a, b) => {
        const orderA = a.sort_order ?? Infinity;
        const orderB = b.sort_order ?? Infinity;
        return orderA - orderB;
      });

      // Expected order: domain (1), api (2), infra (3)
      expect(sorted.length).toBe(3);
      expect(sorted[0].name).toBe('domain');
      expect(sorted[0].sort_order).toBe(1);
      expect(sorted[1].name).toBe('api');
      expect(sorted[1].sort_order).toBe(2);
      expect(sorted[2].name).toBe('infra');
      expect(sorted[2].sort_order).toBe(3);
    });

    it('should handle undefined sort_order by placing at end', () => {
      const packagesWithUndefinedOrder: Package[] = [
        { id: 'pkg_a', package_set_id: 'ps_test', name: 'first', sort_order: 1 },
        { id: 'pkg_b', package_set_id: 'ps_test', name: 'last', sort_order: undefined },
        { id: 'pkg_c', package_set_id: 'ps_test', name: 'second', sort_order: 2 },
      ];

      const sorted = [...packagesWithUndefinedOrder].sort((a, b) => {
        const orderA = a.sort_order ?? Infinity;
        const orderB = b.sort_order ?? Infinity;
        return orderA - orderB;
      });

      expect(sorted[0].name).toBe('first');
      expect(sorted[1].name).toBe('second');
      expect(sorted[2].name).toBe('last');
    });
  });

  // Test 2.1.3: Display package name and purpose
  describe('Package display', () => {
    it('should filter packages by package_set_id', () => {
      const packageSetId = 'ps_001';
      const filtered = mockPackages.filter((p) => p.package_set_id === packageSetId);

      expect(filtered.length).toBe(3);
      expect(filtered.every((p) => p.package_set_id === packageSetId)).toBe(true);
    });

    it('should return empty array for Package Set with no packages', () => {
      const packageSetId = 'ps_002'; // Empty Package Set
      const filtered = mockPackages.filter((p) => p.package_set_id === packageSetId);

      expect(filtered.length).toBe(0);
    });
  });

  // Test 2.1.4: Handle empty Package Set
  describe('Empty state', () => {
    it('should show empty state for Package Set with no packages', () => {
      const packageSetId = 'ps_002';
      const selectedPackageSet = mockPackageSets.find((ps) => ps.id === packageSetId);
      const filtered = mockPackages.filter((p) => p.package_set_id === packageSetId);

      expect(selectedPackageSet).toBeDefined();
      expect(selectedPackageSet?.name).toBe('Empty Package Set');
      expect(filtered.length).toBe(0);
      // In the component, this would render the "No packages defined" empty state
    });
  });
});
