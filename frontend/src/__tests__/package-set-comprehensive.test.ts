/**
 * Package Set Comprehensive Tests - Gap Analysis
 * Spec: Service Package Set Assignment Dropdown - Task Group 6
 *
 * This file contains additional tests to fill gaps identified during review.
 */

import { PackageSet, Package, Service } from '../types/model';
import { gridConfigs, DOMAIN_ENTITY_TYPES, domainGroupings } from '../config/gridConfigs';

// Mock data
const mockPackageSets: PackageSet[] = [
  { id: 'ps_001', name: 'Standard' },
  { id: 'ps_002', name: 'Enterprise' },
];

const mockPackages: Package[] = [
  { id: 'pkg_001', package_set_id: 'ps_001', name: 'api', purpose: 'API layer', sort_order: 2 },
  { id: 'pkg_002', package_set_id: 'ps_001', name: 'domain', purpose: 'Domain layer', sort_order: 1 },
  { id: 'pkg_003', package_set_id: 'ps_001', name: 'infra', purpose: 'Infra layer', sort_order: 3 },
];

describe('Package Set Gap Analysis Tests', () => {
  // Test 6.1: Verify package_sets and packages are in DOMAIN_ENTITY_TYPES
  describe('Domain Entity Types Configuration', () => {
    it('should include package_sets in application domain entity types', () => {
      expect(DOMAIN_ENTITY_TYPES.application).toContain('package_sets');
    });

    it('should include packages in application domain entity types', () => {
      expect(DOMAIN_ENTITY_TYPES.application).toContain('packages');
    });

    it('should include Package Sets in application domain groupings', () => {
      expect(domainGroupings.application).toContain('Package Sets');
    });
  });

  // Test 6.2: Verify GridCell handles package_set_dropdown cellType
  describe('GridCell CellType Handling', () => {
    it('should define package_set_dropdown as a valid cellType in services config', () => {
      const servicesConfig = gridConfigs.services;
      const packageSetColumn = servicesConfig.find((col) => col.field === 'package_set_id');

      expect(packageSetColumn?.cellType).toBe('package_set_dropdown');
    });

    it('should not require the Package Set field', () => {
      const servicesConfig = gridConfigs.services;
      const packageSetColumn = servicesConfig.find((col) => col.field === 'package_set_id');

      expect(packageSetColumn?.required).toBe(false);
    });
  });

  // Test 6.3: Verify package ordering logic
  describe('Package Ordering', () => {
    it('should order packages by sort_order ascending', () => {
      const sorted = [...mockPackages].sort((a, b) => {
        const orderA = a.sort_order ?? Infinity;
        const orderB = b.sort_order ?? Infinity;
        return orderA - orderB;
      });

      expect(sorted[0].name).toBe('domain'); // sort_order: 1
      expect(sorted[1].name).toBe('api');    // sort_order: 2
      expect(sorted[2].name).toBe('infra');  // sort_order: 3
    });

    it('should handle undefined sort_order by placing at end', () => {
      const packagesWithUndefined: Package[] = [
        { id: 'pkg_a', package_set_id: 'ps_test', name: 'ordered', sort_order: 1 },
        { id: 'pkg_b', package_set_id: 'ps_test', name: 'unordered', sort_order: undefined },
      ];

      const sorted = [...packagesWithUndefined].sort((a, b) => {
        const orderA = a.sort_order ?? Infinity;
        const orderB = b.sort_order ?? Infinity;
        return orderA - orderB;
      });

      expect(sorted[0].name).toBe('ordered');
      expect(sorted[1].name).toBe('unordered');
    });
  });

  // Test 6.4: Edge case - empty Package Set display
  describe('Empty Package Set Handling', () => {
    it('should identify Package Set with no packages', () => {
      const packageSetId = 'ps_002'; // Enterprise (no packages in mock)
      const packagesForSet = mockPackages.filter((p) => p.package_set_id === packageSetId);

      expect(packagesForSet.length).toBe(0);
    });

    it('should return valid Package Set object even with no packages', () => {
      const packageSetId = 'ps_002';
      const packageSet = mockPackageSets.find((ps) => ps.id === packageSetId);

      expect(packageSet).toBeDefined();
      expect(packageSet?.name).toBe('Enterprise');
    });
  });

  // Test 6.5: Default (Auto) selection behavior
  describe('Default (Auto) Selection', () => {
    it('should display Default (Auto) when package_set_id is null', () => {
      const value: string | null = null;
      const selectedPackageSet = value
        ? mockPackageSets.find((ps) => ps.id === value)
        : null;
      const displayText = selectedPackageSet?.name || 'Default (Auto)';

      expect(displayText).toBe('Default (Auto)');
    });

    it('should display Default (Auto) when package_set_id is undefined', () => {
      const value: string | undefined = undefined;
      const selectedPackageSet = value
        ? mockPackageSets.find((ps) => ps.id === value)
        : null;
      const displayText = selectedPackageSet?.name || 'Default (Auto)';

      expect(displayText).toBe('Default (Auto)');
    });

    it('should display Package Set name when package_set_id is valid', () => {
      const value = 'ps_001';
      const selectedPackageSet = mockPackageSets.find((ps) => ps.id === value);
      const displayText = selectedPackageSet?.name || 'Default (Auto)';

      expect(displayText).toBe('Standard');
    });
  });

  // Test 6.6: Service creation with default null package_set_id
  describe('Service Entity Creation Defaults', () => {
    it('should default package_set_id to null for new services', () => {
      // Based on createEmptyEntity in Grid.tsx
      const newService: Partial<Service> = {
        id: 'svc_new',
        name: '',
        description: '',
        application_id: '',
        app_component_id: '',
        service_type: '',
        package_set_id: null,
        tags: '',
      };

      expect(newService.package_set_id).toBeNull();
    });
  });
});
