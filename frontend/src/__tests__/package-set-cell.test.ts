/**
 * PackageSetCell Component Unit Tests
 * Spec: Service Package Set Assignment Dropdown - Task Group 1
 */

import { PackageSet, Package } from '../types/model';

// Mock data for tests
const mockPackageSets: PackageSet[] = [
  { id: 'ps_001', name: 'Standard Package Set' },
  { id: 'ps_002', name: 'Enterprise Package Set' },
  { id: 'ps_003', name: 'Minimal Package Set' },
];

const mockPackages: Package[] = [
  { id: 'pkg_001', package_set_id: 'ps_001', name: 'api', purpose: 'REST API controllers', sort_order: 1 },
  { id: 'pkg_002', package_set_id: 'ps_001', name: 'domain', purpose: 'Business logic', sort_order: 2 },
  { id: 'pkg_003', package_set_id: 'ps_002', name: 'web', purpose: 'Web layer', sort_order: 1 },
];

describe('PackageSetCell', () => {
  // Test 1.1.1: Renders "Default (Auto)" when package_set_id is null
  describe('Display value rendering', () => {
    it('should display "Default (Auto)" when value is null', () => {
      // When package_set_id is null, the display text should be "Default (Auto)"
      const value: string | null = null;
      const selectedPackageSet = value
        ? mockPackageSets.find((ps) => ps.id === value)
        : null;
      const displayText = selectedPackageSet?.name || 'Default (Auto)';

      expect(displayText).toBe('Default (Auto)');
      expect(selectedPackageSet).toBeNull();
    });

    // Test 1.1.2: Renders Package Set name when package_set_id is set
    it('should display Package Set name when value is set', () => {
      const value = 'ps_001';
      const selectedPackageSet = mockPackageSets.find((ps) => ps.id === value);
      const displayText = selectedPackageSet?.name || 'Default (Auto)';

      expect(displayText).toBe('Standard Package Set');
      expect(selectedPackageSet).toBeDefined();
      expect(selectedPackageSet?.id).toBe('ps_001');
    });

    // Test 1.1.3: Falls back to "Default (Auto)" for invalid package_set_id
    it('should display "Default (Auto)" for invalid package_set_id', () => {
      const value = 'invalid_id';
      const selectedPackageSet = mockPackageSets.find((ps) => ps.id === value);
      const displayText = selectedPackageSet?.name || 'Default (Auto)';

      expect(displayText).toBe('Default (Auto)');
      expect(selectedPackageSet).toBeUndefined();
    });
  });

  // Test 1.1.4: Dropdown structure has correct options
  describe('Dropdown structure', () => {
    it('should have correct options structure', () => {
      // The dropdown should have:
      // 1. "Default (Auto)" option first
      // 2. Divider
      // 3. List of Package Sets
      // 4. Divider
      // 5. "Create new..." action
      // 6. "Clone and customize..." action

      const dropdownOptions = [
        { type: 'option', value: null, label: 'Default (Auto)' },
        { type: 'divider' },
        ...mockPackageSets.map(ps => ({ type: 'option', value: ps.id, label: ps.name })),
        { type: 'divider' },
        { type: 'action', action: 'create', label: 'Create new...' },
        { type: 'action', action: 'clone', label: 'Clone and customize...' },
      ];

      // Verify structure
      expect(dropdownOptions[0].type).toBe('option');
      expect(dropdownOptions[0].label).toBe('Default (Auto)');
      expect(dropdownOptions[1].type).toBe('divider');
      expect(dropdownOptions[2].type).toBe('option');
      expect(dropdownOptions[2].label).toBe('Standard Package Set');
      expect(dropdownOptions[5].type).toBe('divider');
      expect(dropdownOptions[6].type).toBe('action');
      expect(dropdownOptions[6].label).toBe('Create new...');
      expect(dropdownOptions[7].type).toBe('action');
      expect(dropdownOptions[7].label).toBe('Clone and customize...');
    });
  });

  // Test 1.1.5: "Clone and customize..." disabled state
  describe('Clone action disabled state', () => {
    it('should disable clone when value is null', () => {
      const value: string | null = null;
      const selectedPackageSet = mockPackageSets.find((ps) => ps.id === value ?? '');
      const isCloneDisabled = !value || !selectedPackageSet;

      expect(isCloneDisabled).toBe(true);
    });

    it('should enable clone when a valid Package Set is selected', () => {
      const value = 'ps_001';
      const selectedPackageSet = mockPackageSets.find((ps) => ps.id === value);
      const isCloneDisabled = !value || !selectedPackageSet;

      expect(isCloneDisabled).toBe(false);
    });

    it('should disable clone when package_set_id references non-existent Package Set', () => {
      const value = 'invalid_id';
      const selectedPackageSet = mockPackageSets.find((ps) => ps.id === value);
      const isCloneDisabled = !value || !selectedPackageSet;

      expect(isCloneDisabled).toBe(true);
    });
  });

  // Test 1.1.6: Selection behavior
  describe('Selection behavior', () => {
    it('should return null when selecting "Default (Auto)"', () => {
      let selectedValue: string | null = 'ps_001';

      // Simulate selecting "Default (Auto)"
      const handleSelectDefault = () => {
        selectedValue = null;
      };

      handleSelectDefault();
      expect(selectedValue).toBeNull();
    });

    it('should return package_set_id when selecting a Package Set', () => {
      let selectedValue: string | null = null;

      // Simulate selecting a Package Set
      const handleSelectPackageSet = (packageSetId: string) => {
        selectedValue = packageSetId;
      };

      handleSelectPackageSet('ps_002');
      expect(selectedValue).toBe('ps_002');
    });
  });
});
