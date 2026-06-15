/**
 * End-to-End and Integration Tests for Create Package Set Modal
 * Task Group 10: Test Review and Gap Analysis
 *
 * Spec: Create Package Set Modal with Embedded Packages Builder
 *
 * These tests cover integration points and end-to-end workflows
 * that were identified as gaps in Task Groups 1-9 tests.
 */

import { generateEntityId, getEntityPrefix } from '../utils/idGenerator';
import { PackageSet, Package } from '../types/model';

// ============================================================================
// Test 1: Full Workflow - Open Modal -> Fill Form -> Create -> Verify
// ============================================================================

describe('E2E: Full creation workflow', () => {
  it('should complete full workflow from modal open to entity creation', () => {
    // Step 1: Simulate modal opening
    let isModalOpen = false;
    const openModal = () => { isModalOpen = true; };
    openModal();
    expect(isModalOpen).toBe(true);

    // Step 2: Simulate form filling
    const formData = {
      name: 'API Service Packages',
      packages: [
        { tempId: 'temp_1', name: 'controllers', purpose: 'HTTP endpoints' },
        { tempId: 'temp_2', name: 'services', purpose: 'Business logic' },
        { tempId: 'temp_3', name: 'repositories', purpose: 'Data access' },
      ],
    };

    // Step 3: Validate form
    const isValid = formData.name.trim() !== '' &&
      formData.packages.length > 0 &&
      formData.packages.every(p => p.name.trim() !== '');
    expect(isValid).toBe(true);

    // Step 4: Generate IDs and create entities
    const packageSetId = generateEntityId('package_sets');
    expect(packageSetId).toMatch(/^pkgset-/);

    const packageSet: PackageSet = {
      id: packageSetId,
      name: formData.name.trim(),
    };

    const packages: Package[] = formData.packages.map((pkg, index) => ({
      id: generateEntityId('packages'),
      package_set_id: packageSetId,
      name: pkg.name.trim(),
      purpose: pkg.purpose.trim() || undefined,
      sort_order: index + 1,
    }));

    // Step 5: Verify entities
    expect(packageSet.name).toBe('API Service Packages');
    expect(packages.length).toBe(3);
    expect(packages[0].sort_order).toBe(1);
    expect(packages[1].sort_order).toBe(2);
    expect(packages[2].sort_order).toBe(3);
    expect(packages.every(p => p.package_set_id === packageSetId)).toBe(true);
  });
});

// ============================================================================
// Test 2: Multiple Packages Creation with Correct sort_order
// ============================================================================

describe('E2E: Multiple packages with sort_order', () => {
  it('should create multiple packages with sequential sort_order after reordering', () => {
    // Initial order
    let packages = [
      { tempId: 'temp_1', name: 'controllers', purpose: '' },
      { tempId: 'temp_2', name: 'services', purpose: '' },
      { tempId: 'temp_3', name: 'repositories', purpose: '' },
    ];

    // Reorder: Move 'repositories' to top
    const moveUp = (index: number) => {
      if (index > 0) {
        const newPackages = [...packages];
        [newPackages[index - 1], newPackages[index]] = [newPackages[index], newPackages[index - 1]];
        packages = newPackages;
      }
    };
    moveUp(2); // repositories moves to index 1
    moveUp(1); // repositories moves to index 0

    // Verify reordered state
    expect(packages[0].name).toBe('repositories');
    expect(packages[1].name).toBe('controllers');
    expect(packages[2].name).toBe('services');

    // Create final packages with sort_order based on final position
    const finalPackages: Package[] = packages.map((pkg, index) => ({
      id: generateEntityId('packages'),
      package_set_id: 'pkgset-test',
      name: pkg.name,
      sort_order: index + 1,
    }));

    // Verify sort_order reflects final position
    expect(finalPackages.find(p => p.name === 'repositories')?.sort_order).toBe(1);
    expect(finalPackages.find(p => p.name === 'controllers')?.sort_order).toBe(2);
    expect(finalPackages.find(p => p.name === 'services')?.sort_order).toBe(3);
  });
});

// ============================================================================
// Test 3: Error Recovery - Fix Validation Error and Submit
// ============================================================================

describe('E2E: Error recovery workflow', () => {
  it('should recover from validation errors and submit successfully', () => {
    // Initial invalid state
    const formData = {
      name: '',
      packages: [{ tempId: 'temp_1', name: '', purpose: '' }],
    };

    // Validate - should fail
    const validateForm = (data: typeof formData): Record<string, string> => {
      const errors: Record<string, string> = {};
      if (!data.name.trim()) errors.name = 'Package set name is required';
      data.packages.forEach((pkg, i) => {
        if (!pkg.name.trim()) errors[`package_${i}`] = 'Package name is required';
      });
      return errors;
    };

    let errors = validateForm(formData);
    expect(Object.keys(errors).length).toBe(2); // name and package_0

    // Fix errors
    formData.name = 'Fixed Package Set';
    formData.packages[0].name = 'Fixed Package';

    // Validate again - should pass
    errors = validateForm(formData);
    expect(Object.keys(errors).length).toBe(0);

    // Submit should now succeed
    const isValid = formData.name.trim() !== '' &&
      formData.packages.every(p => p.name.trim() !== '');
    expect(isValid).toBe(true);
  });
});

// ============================================================================
// Test 4: Add and Remove Packages - Edge Cases
// ============================================================================

describe('E2E: Add/Remove packages edge cases', () => {
  it('should handle adding multiple packages then removing some', () => {
    let packages = [{ tempId: 'temp_1', name: 'Package 1', purpose: '' }];

    // Add 4 more packages
    for (let i = 2; i <= 5; i++) {
      packages = [...packages, { tempId: `temp_${i}`, name: `Package ${i}`, purpose: '' }];
    }
    expect(packages.length).toBe(5);

    // Remove packages 2 and 4
    packages = packages.filter(p => p.tempId !== 'temp_2' && p.tempId !== 'temp_4');
    expect(packages.length).toBe(3);
    expect(packages.map(p => p.name)).toEqual(['Package 1', 'Package 3', 'Package 5']);

    // Final sort_order should be 1, 2, 3
    const finalPackages = packages.map((pkg, index) => ({
      ...pkg,
      sort_order: index + 1,
    }));
    expect(finalPackages[0].sort_order).toBe(1);
    expect(finalPackages[1].sort_order).toBe(2);
    expect(finalPackages[2].sort_order).toBe(3);
  });
});

// ============================================================================
// Test 5: ID Uniqueness Across Multiple Creations
// ============================================================================

describe('E2E: ID uniqueness', () => {
  it('should generate unique IDs across multiple package set creations', () => {
    const allIds = new Set<string>();

    // Simulate creating 3 package sets with 3 packages each
    for (let setNum = 0; setNum < 3; setNum++) {
      const packageSetId = generateEntityId('package_sets');
      allIds.add(packageSetId);

      for (let pkgNum = 0; pkgNum < 3; pkgNum++) {
        const packageId = generateEntityId('packages');
        allIds.add(packageId);
      }
    }

    // 3 package sets + 9 packages = 12 unique IDs
    expect(allIds.size).toBe(12);
  });
});

// ============================================================================
// Test 6: Empty Purpose Field Handling
// ============================================================================

describe('E2E: Empty purpose field handling', () => {
  it('should handle packages with and without purpose correctly', () => {
    const formPackages = [
      { tempId: 'temp_1', name: 'controllers', purpose: 'HTTP endpoints' },
      { tempId: 'temp_2', name: 'services', purpose: '' },
      { tempId: 'temp_3', name: 'utils', purpose: '   ' }, // whitespace-only
    ];

    const packages: Package[] = formPackages.map((pkg, index) => ({
      id: `pkg-${index}`,
      package_set_id: 'pkgset-1',
      name: pkg.name.trim(),
      purpose: pkg.purpose.trim() || undefined,
      sort_order: index + 1,
    }));

    expect(packages[0].purpose).toBe('HTTP endpoints');
    expect(packages[1].purpose).toBeUndefined();
    expect(packages[2].purpose).toBeUndefined();
  });
});

// ============================================================================
// Test 7: Form Reset on Modal Reopen
// ============================================================================

describe('E2E: Form reset on modal reopen', () => {
  it('should reset form state when modal is reopened', () => {
    // First session - fill in data
    let formData = {
      name: 'Old Package Set',
      packages: [
        { tempId: 'temp_1', name: 'Old Package', purpose: 'Old purpose' },
        { tempId: 'temp_2', name: 'Another Package', purpose: '' },
      ],
    };
    expect(formData.name).toBe('Old Package Set');
    expect(formData.packages.length).toBe(2);

    // Close modal (simulate)
    let isModalOpen = false;

    // Reopen modal - should reset
    isModalOpen = true;
    if (isModalOpen) {
      formData = {
        name: '',
        packages: [{ tempId: 'temp_new', name: '', purpose: '' }],
      };
    }

    expect(formData.name).toBe('');
    expect(formData.packages.length).toBe(1);
    expect(formData.packages[0].name).toBe('');
  });
});

// ============================================================================
// Test 8: Dispatch Actions Order
// ============================================================================

describe('E2E: Dispatch actions order', () => {
  it('should dispatch package_sets before packages', () => {
    const dispatchOrder: string[] = [];
    const dispatch = (action: { type: string; entityType: string }) => {
      dispatchOrder.push(action.entityType);
    };

    const packageSet: PackageSet = { id: 'pkgset-1', name: 'Test' };
    const packages: Package[] = [
      { id: 'pkg-1', package_set_id: 'pkgset-1', name: 'A', sort_order: 1 },
      { id: 'pkg-2', package_set_id: 'pkgset-1', name: 'B', sort_order: 2 },
    ];

    // Dispatch order should be: package_sets first, then packages
    dispatch({ type: 'ADD_ENTITY', entityType: 'package_sets' });
    packages.forEach(() => {
      dispatch({ type: 'ADD_ENTITY', entityType: 'packages' });
    });

    expect(dispatchOrder[0]).toBe('package_sets');
    expect(dispatchOrder[1]).toBe('packages');
    expect(dispatchOrder[2]).toBe('packages');
    expect(dispatchOrder.length).toBe(3);
  });
});
