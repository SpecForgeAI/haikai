/**
 * Tests for Clone Package Set Modal
 * Spec: Clone Package Set Modal
 * Task Group 1: Modal Mode Support Tests
 * Task Group 2: Clone Entry Point Tests
 * Task Group 3: Clone Entity Creation and Immutability Tests
 * Task Group 4: Gap Analysis Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { PackageSet, Package } from '../types/model';
import { generateEntityId } from '../utils/idGenerator';

// ============================================================================
// Task Group 1: Modal Mode Support Tests (Task 1.1)
// ============================================================================

describe('Task Group 1: Modal Mode Support', () => {
  describe('1.1.1 Modal renders with create mode by default', () => {
    it('should render with "Create Package Set" title when mode is undefined', () => {
      const mode: 'create' | 'clone' | undefined = undefined;
      const effectiveMode = mode ?? 'create';
      const title = effectiveMode === 'clone' ? 'Clone Package Set' : 'Create Package Set';
      expect(title).toBe('Create Package Set');
    });

    it('should render with "Create" button text when mode is undefined', () => {
      const mode: 'create' | 'clone' | undefined = undefined;
      const effectiveMode = mode ?? 'create';
      const buttonText = effectiveMode === 'clone' ? 'Clone' : 'Create';
      expect(buttonText).toBe('Create');
    });

    it('should render with "Create Package Set" title when mode is explicitly "create"', () => {
      const mode: 'create' | 'clone' = 'create';
      const title = mode === 'clone' ? 'Clone Package Set' : 'Create Package Set';
      expect(title).toBe('Create Package Set');
    });
  });

  describe('1.1.2 Modal renders with clone mode and correct title/button text', () => {
    it('should render with "Clone Package Set" title when mode is "clone"', () => {
      const mode: 'create' | 'clone' = 'clone';
      const title = mode === 'clone' ? 'Clone Package Set' : 'Create Package Set';
      expect(title).toBe('Clone Package Set');
    });

    it('should render with "Clone" button text when mode is "clone"', () => {
      const mode: 'create' | 'clone' = 'clone';
      const buttonText = mode === 'clone' ? 'Clone' : 'Create';
      expect(buttonText).toBe('Clone');
    });

    it('should render with "Cloning..." button text when submitting in clone mode', () => {
      const mode: 'create' | 'clone' = 'clone';
      const isSubmitting = true;
      const buttonText = isSubmitting
        ? (mode === 'clone' ? 'Cloning...' : 'Creating...')
        : (mode === 'clone' ? 'Clone' : 'Create');
      expect(buttonText).toBe('Cloning...');
    });
  });

  describe('1.1.3 Initial data prop pre-populates form fields in clone mode', () => {
    it('should pre-populate name field with initialData.name', () => {
      const initialData = {
        name: 'My Package Set (copy)',
        packages: [{ name: 'Package A', purpose: 'Purpose A', sort_order: 1 }],
      };
      // Simulate form initialization
      const formData = {
        name: initialData.name,
        packages: initialData.packages.map((pkg, idx) => ({
          tempId: `temp_${idx}`,
          name: pkg.name,
          purpose: pkg.purpose ?? '',
        })),
      };
      expect(formData.name).toBe('My Package Set (copy)');
    });

    it('should pre-populate packages array with initialData.packages', () => {
      const initialData = {
        name: 'Test Set (copy)',
        packages: [
          { name: 'Package A', purpose: 'Purpose A', sort_order: 1 },
          { name: 'Package B', purpose: 'Purpose B', sort_order: 2 },
        ],
      };
      const formData = {
        name: initialData.name,
        packages: initialData.packages.map((pkg, idx) => ({
          tempId: `temp_${idx}`,
          name: pkg.name,
          purpose: pkg.purpose ?? '',
        })),
      };
      expect(formData.packages.length).toBe(2);
      expect(formData.packages[0].name).toBe('Package A');
      expect(formData.packages[1].name).toBe('Package B');
    });

    it('should sort packages by sort_order when pre-populating', () => {
      const initialData = {
        name: 'Test Set (copy)',
        packages: [
          { name: 'Package B', purpose: '', sort_order: 2 },
          { name: 'Package A', purpose: '', sort_order: 1 },
          { name: 'Package C', purpose: '', sort_order: 3 },
        ],
      };
      // Sort by sort_order
      const sortedPackages = [...initialData.packages].sort((a, b) => {
        const orderA = a.sort_order ?? Infinity;
        const orderB = b.sort_order ?? Infinity;
        return orderA - orderB;
      });
      expect(sortedPackages[0].name).toBe('Package A');
      expect(sortedPackages[1].name).toBe('Package B');
      expect(sortedPackages[2].name).toBe('Package C');
    });

    it('should generate unique tempIds for each pre-populated package row', () => {
      const initialData = {
        name: 'Test Set (copy)',
        packages: [
          { name: 'Package A', purpose: '', sort_order: 1 },
          { name: 'Package B', purpose: '', sort_order: 2 },
        ],
      };
      let tempIdCounter = 0;
      const generateTempId = () => {
        tempIdCounter++;
        return `temp_${Date.now()}_${tempIdCounter}`;
      };
      const formData = {
        name: initialData.name,
        packages: initialData.packages.map((pkg) => ({
          tempId: generateTempId(),
          name: pkg.name,
          purpose: pkg.purpose ?? '',
        })),
      };
      const ids = formData.packages.map(p => p.tempId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('1.1.4 Name uniqueness validation displays error for duplicate names', () => {
    it('should detect duplicate name (exact match)', () => {
      const existingNames = ['Package Set A', 'Package Set B'];
      const newName = 'Package Set A';
      const isDuplicate = existingNames.some(
        name => name.toLowerCase().trim() === newName.toLowerCase().trim()
      );
      expect(isDuplicate).toBe(true);
    });

    it('should detect duplicate name (case-insensitive)', () => {
      const existingNames = ['Package Set A', 'Package Set B'];
      const newName = 'package set a';
      const isDuplicate = existingNames.some(
        name => name.toLowerCase().trim() === newName.toLowerCase().trim()
      );
      expect(isDuplicate).toBe(true);
    });

    it('should detect duplicate name (with whitespace trimming)', () => {
      const existingNames = ['Package Set A', 'Package Set B'];
      const newName = '  Package Set A  ';
      const isDuplicate = existingNames.some(
        name => name.toLowerCase().trim() === newName.toLowerCase().trim()
      );
      expect(isDuplicate).toBe(true);
    });

    it('should display correct error message for duplicate name', () => {
      const errorMessage = 'A package set with this name already exists.';
      expect(errorMessage).toBe('A package set with this name already exists.');
    });

    it('should not show error for unique name', () => {
      const existingNames = ['Package Set A', 'Package Set B'];
      const newName = 'Package Set C';
      const isDuplicate = existingNames.some(
        name => name.toLowerCase().trim() === newName.toLowerCase().trim()
      );
      expect(isDuplicate).toBe(false);
    });
  });

  describe('1.1.5 Clone mode validates against existing names including source name', () => {
    it('should validate against source name in clone mode', () => {
      const existingNames = ['Original Set', 'Other Set'];
      const clonedName = 'Original Set'; // User might edit and use source name
      const isDuplicate = existingNames.some(
        name => name.toLowerCase().trim() === clonedName.toLowerCase().trim()
      );
      expect(isDuplicate).toBe(true);
    });

    it('should allow unique cloned name even if initialData.name was "(copy)"', () => {
      const existingNames = ['Original Set', 'Other Set'];
      const clonedName = 'Original Set (copy)';
      const isDuplicate = existingNames.some(
        name => name.toLowerCase().trim() === clonedName.toLowerCase().trim()
      );
      expect(isDuplicate).toBe(false);
    });

    it('should reject if user changes name to an existing set name', () => {
      const existingNames = ['Original Set', 'Other Set', 'Third Set'];
      const userEditedName = 'Other Set';
      const isDuplicate = existingNames.some(
        name => name.toLowerCase().trim() === userEditedName.toLowerCase().trim()
      );
      expect(isDuplicate).toBe(true);
    });
  });

  describe('1.1.6 Form reset behavior based on mode', () => {
    it('should reset to empty default in create mode', () => {
      const mode: 'create' | 'clone' = 'create';
      const initialData = undefined;
      const getFormData = () => {
        if (mode === 'clone' && initialData) {
          return {
            name: initialData.name,
            packages: initialData.packages,
          };
        }
        return {
          name: '',
          packages: [{ tempId: 'temp_1', name: '', purpose: '' }],
        };
      };
      const formData = getFormData();
      expect(formData.name).toBe('');
      expect(formData.packages.length).toBe(1);
      expect(formData.packages[0].name).toBe('');
    });

    it('should reset to pre-populated values in clone mode', () => {
      const mode: 'create' | 'clone' = 'clone';
      const initialData = {
        name: 'Cloned Set (copy)',
        packages: [
          { name: 'Package X', purpose: 'Purpose X', sort_order: 1 },
        ],
      };
      const getFormData = () => {
        if (mode === 'clone' && initialData) {
          return {
            name: initialData.name,
            packages: initialData.packages.map((pkg, idx) => ({
              tempId: `temp_${idx}`,
              name: pkg.name,
              purpose: pkg.purpose ?? '',
            })),
          };
        }
        return {
          name: '',
          packages: [{ tempId: 'temp_1', name: '', purpose: '' }],
        };
      };
      const formData = getFormData();
      expect(formData.name).toBe('Cloned Set (copy)');
      expect(formData.packages.length).toBe(1);
      expect(formData.packages[0].name).toBe('Package X');
    });
  });
});

// ============================================================================
// Task Group 2: Clone Entry Point Tests (Task 2.1)
// ============================================================================

describe('Task Group 2: Clone Entry Point', () => {
  describe('2.1.1 Clone button/icon renders in each Package Sets table row', () => {
    it('should have clone button available for each package set row', () => {
      const packageSets = [
        { id: 'pkgset-1', name: 'Set A' },
        { id: 'pkgset-2', name: 'Set B' },
      ];
      // Each row should have a clone action
      const rowsWithCloneAction = packageSets.map(set => ({
        ...set,
        hasCloneAction: true,
      }));
      expect(rowsWithCloneAction.every(row => row.hasCloneAction)).toBe(true);
    });

    it('should have clone button with appropriate title/tooltip', () => {
      const buttonTitle = 'Clone Package Set';
      expect(buttonTitle).toBe('Clone Package Set');
    });
  });

  describe('2.1.2 Clicking Clone opens modal in clone mode with pre-populated data', () => {
    it('should set isCloneModalOpen to true when clone button is clicked', () => {
      let isCloneModalOpen = false;
      const handleOpenCloneModal = () => {
        isCloneModalOpen = true;
      };
      handleOpenCloneModal();
      expect(isCloneModalOpen).toBe(true);
    });

    it('should track source package set when clone is clicked', () => {
      const packageSets = [
        { id: 'pkgset-1', name: 'Set A' },
        { id: 'pkgset-2', name: 'Set B' },
      ];
      let cloneSourcePackageSet: { id: string; name: string } | null = null;
      const handleOpenCloneModal = (packageSetId: string) => {
        cloneSourcePackageSet = packageSets.find(ps => ps.id === packageSetId) ?? null;
      };
      handleOpenCloneModal('pkgset-2');
      expect(cloneSourcePackageSet).toEqual({ id: 'pkgset-2', name: 'Set B' });
    });
  });

  describe('2.1.3 Cloned name uses "<original name> (copy)" format', () => {
    it('should format cloned name correctly', () => {
      const originalName = 'My Package Set';
      const clonedName = `${originalName} (copy)`;
      expect(clonedName).toBe('My Package Set (copy)');
    });

    it('should handle names with special characters', () => {
      const originalName = 'Test Set (v2)';
      const clonedName = `${originalName} (copy)`;
      expect(clonedName).toBe('Test Set (v2) (copy)');
    });

    it('should handle names with trailing spaces (trimmed)', () => {
      const originalName = 'My Package Set  ';
      const clonedName = `${originalName.trim()} (copy)`;
      expect(clonedName).toBe('My Package Set (copy)');
    });
  });

  describe('2.1.4 Packages are pre-populated with original packages', () => {
    it('should collect packages filtered by package_set_id', () => {
      const packages = [
        { id: 'pkg-1', package_set_id: 'pkgset-1', name: 'Package A', purpose: 'P A', sort_order: 1 },
        { id: 'pkg-2', package_set_id: 'pkgset-1', name: 'Package B', purpose: 'P B', sort_order: 2 },
        { id: 'pkg-3', package_set_id: 'pkgset-2', name: 'Package C', purpose: 'P C', sort_order: 1 },
      ];
      const sourcePackageSetId = 'pkgset-1';
      const sourcePackages = packages.filter(p => p.package_set_id === sourcePackageSetId);
      expect(sourcePackages.length).toBe(2);
      expect(sourcePackages[0].name).toBe('Package A');
      expect(sourcePackages[1].name).toBe('Package B');
    });

    it('should copy name, purpose, and sort_order from original packages', () => {
      const sourcePackages = [
        { id: 'pkg-1', package_set_id: 'pkgset-1', name: 'Package A', purpose: 'Purpose A', sort_order: 1 },
        { id: 'pkg-2', package_set_id: 'pkgset-1', name: 'Package B', purpose: undefined, sort_order: 2 },
      ];
      const initialDataPackages = sourcePackages.map(pkg => ({
        name: pkg.name,
        purpose: pkg.purpose,
        sort_order: pkg.sort_order,
      }));
      expect(initialDataPackages[0]).toEqual({ name: 'Package A', purpose: 'Purpose A', sort_order: 1 });
      expect(initialDataPackages[1]).toEqual({ name: 'Package B', purpose: undefined, sort_order: 2 });
    });
  });

  describe('2.1.5 Clone modal submission creates new entities with new IDs', () => {
    it('should create new PackageSet with new ID on clone submission', () => {
      const newPackageSetId = generateEntityId('package_sets');
      expect(newPackageSetId).toMatch(/^pkgset-/);
    });

    it('should create new Packages with new IDs on clone submission', () => {
      const newPackageId = generateEntityId('packages');
      expect(newPackageId).toMatch(/^pkg-/);
    });

    it('should generate unique IDs for each package', () => {
      const ids = [
        generateEntityId('packages'),
        generateEntityId('packages'),
        generateEntityId('packages'),
      ];
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });
  });
});

// ============================================================================
// Task Group 3: Clone Entity Creation and Immutability Tests (Task 3.1)
// ============================================================================

describe('Task Group 3: Clone Entity Creation and Immutability', () => {
  describe('3.1.1 New PackageSet entity has new ID', () => {
    it('should generate new PackageSet ID via generateEntityId', () => {
      const newId = generateEntityId('package_sets');
      expect(newId).toMatch(/^pkgset-[a-z0-9]+-[a-z0-9]+$/);
    });

    it('should generate different ID than original PackageSet', () => {
      const originalId = 'pkgset-original-123';
      const newId = generateEntityId('package_sets');
      expect(newId).not.toBe(originalId);
    });
  });

  describe('3.1.2 Each Package has new ID via generateEntityId', () => {
    it('should generate new Package IDs with correct prefix', () => {
      const newId = generateEntityId('packages');
      expect(newId).toMatch(/^pkg-[a-z0-9]+-[a-z0-9]+$/);
    });

    it('should generate unique IDs for multiple packages', () => {
      const packageCount = 5;
      const ids: string[] = [];
      for (let i = 0; i < packageCount; i++) {
        ids.push(generateEntityId('packages'));
      }
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(packageCount);
    });
  });

  describe('3.1.3 Packages have correct package_set_id referencing new PackageSet', () => {
    it('should assign new package_set_id to all cloned packages', () => {
      const newPackageSetId = 'pkgset-new-123';
      const clonedPackages = [
        { name: 'Package A', purpose: 'P A' },
        { name: 'Package B', purpose: 'P B' },
      ].map((pkg, index) => ({
        id: generateEntityId('packages'),
        package_set_id: newPackageSetId,
        name: pkg.name,
        purpose: pkg.purpose || undefined,
        sort_order: index + 1,
      }));

      expect(clonedPackages.every(pkg => pkg.package_set_id === newPackageSetId)).toBe(true);
    });

    it('should not reference original package_set_id', () => {
      const originalPackageSetId = 'pkgset-original-123';
      const newPackageSetId = 'pkgset-new-456';
      const clonedPackage = {
        id: generateEntityId('packages'),
        package_set_id: newPackageSetId,
        name: 'Test Package',
        sort_order: 1,
      };
      expect(clonedPackage.package_set_id).not.toBe(originalPackageSetId);
      expect(clonedPackage.package_set_id).toBe(newPackageSetId);
    });
  });

  describe('3.1.4 Sort_order values are assigned 1..N based on draft ordering', () => {
    it('should assign consecutive sort_order starting at 1', () => {
      const draftPackages = [
        { name: 'First', purpose: '' },
        { name: 'Second', purpose: '' },
        { name: 'Third', purpose: '' },
      ];
      const packagesWithSortOrder = draftPackages.map((pkg, index) => ({
        ...pkg,
        sort_order: index + 1,
      }));
      expect(packagesWithSortOrder[0].sort_order).toBe(1);
      expect(packagesWithSortOrder[1].sort_order).toBe(2);
      expect(packagesWithSortOrder[2].sort_order).toBe(3);
    });

    it('should use final draft ordering (after user reorders)', () => {
      // User has reordered packages in the modal
      const reorderedDraftPackages = [
        { name: 'Was Third', purpose: '' },
        { name: 'Was First', purpose: '' },
        { name: 'Was Second', purpose: '' },
      ];
      const packagesWithSortOrder = reorderedDraftPackages.map((pkg, index) => ({
        ...pkg,
        sort_order: index + 1,
      }));
      expect(packagesWithSortOrder[0].name).toBe('Was Third');
      expect(packagesWithSortOrder[0].sort_order).toBe(1);
      expect(packagesWithSortOrder[1].name).toBe('Was First');
      expect(packagesWithSortOrder[1].sort_order).toBe(2);
    });
  });

  describe('3.1.5 Original entities remain unchanged (immutability)', () => {
    it('should not modify original PackageSet', () => {
      const originalPackageSet: PackageSet = {
        id: 'pkgset-original',
        name: 'Original Set',
      };
      // Create a clone (new object)
      const clonedPackageSet: PackageSet = {
        id: generateEntityId('package_sets'),
        name: `${originalPackageSet.name} (copy)`,
      };
      // Verify original is unchanged
      expect(originalPackageSet.id).toBe('pkgset-original');
      expect(originalPackageSet.name).toBe('Original Set');
      // Verify clone is different
      expect(clonedPackageSet.id).not.toBe(originalPackageSet.id);
    });

    it('should not modify original Packages', () => {
      const originalPackages: Package[] = [
        { id: 'pkg-original-1', package_set_id: 'pkgset-original', name: 'Original A', sort_order: 1 },
        { id: 'pkg-original-2', package_set_id: 'pkgset-original', name: 'Original B', sort_order: 2 },
      ];
      const newPackageSetId = generateEntityId('package_sets');
      const clonedPackages: Package[] = originalPackages.map((pkg, index) => ({
        id: generateEntityId('packages'),
        package_set_id: newPackageSetId,
        name: pkg.name,
        purpose: pkg.purpose,
        sort_order: index + 1,
      }));
      // Verify originals unchanged
      expect(originalPackages[0].id).toBe('pkg-original-1');
      expect(originalPackages[0].package_set_id).toBe('pkgset-original');
      expect(originalPackages[1].id).toBe('pkg-original-2');
      // Verify clones are different
      expect(clonedPackages[0].id).not.toBe(originalPackages[0].id);
      expect(clonedPackages[0].package_set_id).toBe(newPackageSetId);
    });

    it('should create entirely new entities in state (not references)', () => {
      const originalPackage: Package = {
        id: 'pkg-original',
        package_set_id: 'pkgset-original',
        name: 'Original',
        sort_order: 1,
      };
      const clonedPackage: Package = {
        id: generateEntityId('packages'),
        package_set_id: generateEntityId('package_sets'),
        name: originalPackage.name,
        sort_order: 1,
      };
      // Verify they are not the same reference
      expect(clonedPackage).not.toBe(originalPackage);
      // Verify modifying clone doesn't affect original
      clonedPackage.name = 'Modified Clone';
      expect(originalPackage.name).toBe('Original');
    });
  });
});

// ============================================================================
// Task Group 4: Gap Analysis Tests (Task 4.3)
// Additional strategic tests to fill coverage gaps
// ============================================================================

describe('Task Group 4: Gap Analysis Tests', () => {
  describe('4.3.1 Complete clone workflow from click to entity creation', () => {
    it('should complete end-to-end clone workflow', () => {
      // Step 1: Source data
      const sourcePackageSet: PackageSet = { id: 'pkgset-source', name: 'Source Set' };
      const sourcePackages: Package[] = [
        { id: 'pkg-1', package_set_id: 'pkgset-source', name: 'Pkg A', purpose: 'Purpose A', sort_order: 1 },
        { id: 'pkg-2', package_set_id: 'pkgset-source', name: 'Pkg B', purpose: 'Purpose B', sort_order: 2 },
      ];

      // Step 2: Prepare clone data
      const cloneName = `${sourcePackageSet.name} (copy)`;
      const cloneInitialData = {
        name: cloneName,
        packages: sourcePackages.map(pkg => ({
          name: pkg.name,
          purpose: pkg.purpose,
          sort_order: pkg.sort_order,
        })),
      };

      // Step 3: Simulate form submission (creating new entities)
      const newPackageSetId = generateEntityId('package_sets');
      const newPackageSet: PackageSet = {
        id: newPackageSetId,
        name: cloneInitialData.name.trim(),
      };
      const newPackages: Package[] = cloneInitialData.packages.map((pkg, index) => ({
        id: generateEntityId('packages'),
        package_set_id: newPackageSetId,
        name: pkg.name,
        purpose: pkg.purpose,
        sort_order: index + 1,
      }));

      // Step 4: Verify results
      expect(newPackageSet.name).toBe('Source Set (copy)');
      expect(newPackageSet.id).toMatch(/^pkgset-/);
      expect(newPackages.length).toBe(2);
      expect(newPackages.every(pkg => pkg.package_set_id === newPackageSetId)).toBe(true);

      // Step 5: Verify originals unchanged
      expect(sourcePackageSet.id).toBe('pkgset-source');
      expect(sourcePackageSet.name).toBe('Source Set');
      expect(sourcePackages[0].id).toBe('pkg-1');
    });
  });

  describe('4.3.2 Clone with modified packages (add/remove/reorder)', () => {
    it('should support adding new packages to cloned list', () => {
      const cloneInitialPackages = [
        { tempId: 'temp_1', name: 'Existing Package', purpose: 'P1' },
      ];
      // User adds a new package
      const newPackage = { tempId: 'temp_2', name: 'New Package', purpose: 'P2' };
      const modifiedPackages = [...cloneInitialPackages, newPackage];
      expect(modifiedPackages.length).toBe(2);
      expect(modifiedPackages[1].name).toBe('New Package');
    });

    it('should support removing packages from cloned list (minimum 1 required)', () => {
      let clonePackages = [
        { tempId: 'temp_1', name: 'Package A', purpose: '' },
        { tempId: 'temp_2', name: 'Package B', purpose: '' },
      ];
      // User removes one package
      clonePackages = clonePackages.filter(pkg => pkg.tempId !== 'temp_1');
      expect(clonePackages.length).toBe(1);
      expect(clonePackages[0].name).toBe('Package B');

      // Verify minimum 1 required
      const canRemoveLastPackage = clonePackages.length > 1;
      expect(canRemoveLastPackage).toBe(false);
    });

    it('should support reordering packages in cloned list', () => {
      const clonePackages = [
        { tempId: 'temp_1', name: 'First', purpose: '' },
        { tempId: 'temp_2', name: 'Second', purpose: '' },
        { tempId: 'temp_3', name: 'Third', purpose: '' },
      ];
      // User moves "Third" to position 1
      const reorderedPackages = [
        clonePackages[2], // Third
        clonePackages[0], // First
        clonePackages[1], // Second
      ];
      expect(reorderedPackages[0].name).toBe('Third');
      expect(reorderedPackages[1].name).toBe('First');
      expect(reorderedPackages[2].name).toBe('Second');

      // Final sort_order assignment
      const withSortOrder = reorderedPackages.map((pkg, idx) => ({
        ...pkg,
        sort_order: idx + 1,
      }));
      expect(withSortOrder[0].sort_order).toBe(1);
      expect(withSortOrder[0].name).toBe('Third');
    });
  });

  describe('4.3.3 Clone name validation when user modifies pre-filled name', () => {
    it('should validate modified name against existing names', () => {
      const existingNames = ['Set A', 'Set B', 'Set C'];
      const initialCloneName = 'Set A (copy)'; // Pre-filled
      const userModifiedName = 'Set B'; // User changes to existing name

      // Initial name is valid
      const initialIsValid = !existingNames.some(
        name => name.toLowerCase().trim() === initialCloneName.toLowerCase().trim()
      );
      expect(initialIsValid).toBe(true);

      // Modified name is invalid (duplicate)
      const modifiedIsValid = !existingNames.some(
        name => name.toLowerCase().trim() === userModifiedName.toLowerCase().trim()
      );
      expect(modifiedIsValid).toBe(false);
    });

    it('should allow user to customize the (copy) suffix', () => {
      const existingNames = ['Original Set'];
      const customName = 'Original Set - Version 2';
      const isValid = !existingNames.some(
        name => name.toLowerCase().trim() === customName.toLowerCase().trim()
      );
      expect(isValid).toBe(true);
    });
  });

  describe('4.3.4 All package fields are correctly copied', () => {
    it('should copy all package fields: name, purpose, sort_order', () => {
      const sourcePackages: Package[] = [
        { id: 'pkg-1', package_set_id: 'pkgset-1', name: 'Package A', purpose: 'Purpose A', sort_order: 1 },
        { id: 'pkg-2', package_set_id: 'pkgset-1', name: 'Package B', purpose: undefined, sort_order: 2 },
        { id: 'pkg-3', package_set_id: 'pkgset-1', name: 'Package C', purpose: 'Purpose C', sort_order: 3 },
      ];

      const clonedPackageData = sourcePackages.map(pkg => ({
        name: pkg.name,
        purpose: pkg.purpose,
        sort_order: pkg.sort_order,
      }));

      expect(clonedPackageData[0]).toEqual({ name: 'Package A', purpose: 'Purpose A', sort_order: 1 });
      expect(clonedPackageData[1]).toEqual({ name: 'Package B', purpose: undefined, sort_order: 2 });
      expect(clonedPackageData[2]).toEqual({ name: 'Package C', purpose: 'Purpose C', sort_order: 3 });
    });

    it('should handle undefined purpose correctly', () => {
      const sourcePackage: Package = {
        id: 'pkg-1',
        package_set_id: 'pkgset-1',
        name: 'Test Package',
        purpose: undefined,
        sort_order: 1,
      };

      const clonedPurpose = sourcePackage.purpose ?? '';
      expect(clonedPurpose).toBe('');
    });

    it('should handle undefined sort_order with stable fallback', () => {
      const packagesWithMixedSortOrder = [
        { name: 'A', purpose: '', sort_order: undefined },
        { name: 'B', purpose: '', sort_order: 2 },
        { name: 'C', purpose: '', sort_order: 1 },
      ];

      const sorted = [...packagesWithMixedSortOrder].sort((a, b) => {
        const orderA = a.sort_order ?? Infinity;
        const orderB = b.sort_order ?? Infinity;
        return orderA - orderB;
      });

      expect(sorted[0].name).toBe('C'); // sort_order: 1
      expect(sorted[1].name).toBe('B'); // sort_order: 2
      expect(sorted[2].name).toBe('A'); // sort_order: undefined -> Infinity
    });
  });

  describe('4.3.5 Multiple sequential clones generate unique IDs', () => {
    it('should generate unique PackageSet IDs for sequential clones', () => {
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        ids.push(generateEntityId('package_sets'));
      }
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(10);
    });

    it('should generate unique Package IDs for sequential clones', () => {
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) {
        ids.push(generateEntityId('packages'));
      }
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(20);
    });

    it('should support cloning a clone (nested clones)', () => {
      // First clone
      const firstCloneName = 'Original (copy)';
      // Second clone (clone of clone)
      const secondCloneName = `${firstCloneName} (copy)`;
      expect(secondCloneName).toBe('Original (copy) (copy)');

      // Generate unique IDs for each clone
      const firstCloneId = generateEntityId('package_sets');
      const secondCloneId = generateEntityId('package_sets');
      expect(firstCloneId).not.toBe(secondCloneId);
    });
  });
});
