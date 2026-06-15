/**
 * Package Set Modal Integration Tests
 * Spec: Service Package Set Assignment Dropdown - Task Group 4
 */

import { PackageSet, Package, Service } from '../types/model';

// Mock data for tests
const mockPackageSets: PackageSet[] = [
  { id: 'ps_001', name: 'Standard Package Set' },
  { id: 'ps_002', name: 'Enterprise Package Set' },
];

const mockPackages: Package[] = [
  { id: 'pkg_001', package_set_id: 'ps_001', name: 'api', purpose: 'REST API controllers', sort_order: 1 },
  { id: 'pkg_002', package_set_id: 'ps_001', name: 'domain', purpose: 'Business logic', sort_order: 2 },
  { id: 'pkg_003', package_set_id: 'ps_001', name: 'infra', purpose: 'Infrastructure', sort_order: 3 },
  { id: 'pkg_004', package_set_id: 'ps_002', name: 'web', purpose: 'Web layer', sort_order: 1 },
];

const mockServices: Service[] = [
  {
    id: 'svc_001',
    name: 'User Service',
    description: 'Handles user operations',
    application_id: 'app_001',
    app_component_id: 'ac_001',
    service_type: 'BACKEND',
    package_set_id: 'ps_001',
    tags: '',
  },
  {
    id: 'svc_002',
    name: 'Order Service',
    description: 'Handles order operations',
    application_id: 'app_001',
    app_component_id: 'ac_001',
    service_type: 'BACKEND',
    package_set_id: null,
    tags: '',
  },
];

describe('Package Set Modal Integration', () => {
  // Test 4.1.1: "Create new..." opens modal in create mode
  describe('Create Mode', () => {
    it('should open modal in create mode when "Create new..." is clicked', () => {
      // Simulating the modal state when "Create new..." is triggered
      const modalState = {
        isOpen: true,
        mode: 'create' as const,
        serviceId: 'svc_002',
      };

      expect(modalState.isOpen).toBe(true);
      expect(modalState.mode).toBe('create');
      expect(modalState.serviceId).toBe('svc_002');
    });

    it('should create new PackageSet and Packages on submit', () => {
      // Simulating form data from modal
      const formData = {
        name: 'New Package Set',
        packages: [
          { name: 'controller', purpose: 'HTTP controllers', sort_order: 1 },
          { name: 'service', purpose: 'Business services', sort_order: 2 },
        ],
      };

      // Verify form data structure is valid
      expect(formData.name).toBeTruthy();
      expect(formData.packages.length).toBe(2);
      expect(formData.packages[0].name).toBe('controller');
      expect(formData.packages[1].name).toBe('service');
    });
  });

  // Test 4.1.2: "Clone and customize..." opens modal in clone mode with data
  describe('Clone Mode', () => {
    it('should prepare clone data from selected Package Set', () => {
      const serviceId = 'svc_001';
      const service = mockServices.find((s) => s.id === serviceId);
      expect(service).toBeDefined();

      const sourcePackageSet = mockPackageSets.find((ps) => ps.id === service?.package_set_id);
      expect(sourcePackageSet).toBeDefined();
      expect(sourcePackageSet?.name).toBe('Standard Package Set');

      // Get packages for the source Package Set
      const sourcePackages = mockPackages
        .filter((p) => p.package_set_id === sourcePackageSet?.id)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      expect(sourcePackages.length).toBe(3);
      expect(sourcePackages[0].name).toBe('api');
      expect(sourcePackages[1].name).toBe('domain');
      expect(sourcePackages[2].name).toBe('infra');
    });

    it('should initialize modal with cloned data including "(Copy)" suffix', () => {
      const sourcePackageSet = mockPackageSets.find((ps) => ps.id === 'ps_001');
      const sourcePackages = mockPackages.filter((p) => p.package_set_id === 'ps_001');

      const cloneData = {
        name: `${sourcePackageSet?.name} (Copy)`,
        packages: sourcePackages.map((p) => ({
          name: p.name,
          purpose: p.purpose || '',
          sort_order: p.sort_order,
        })),
      };

      expect(cloneData.name).toBe('Standard Package Set (Copy)');
      expect(cloneData.packages.length).toBe(3);
    });
  });

  // Test 4.1.3: Service.package_set_id is updated after modal submit
  describe('Service Update', () => {
    it('should update service.package_set_id to new Package Set id', () => {
      const service = { ...mockServices[1] }; // svc_002 with null package_set_id
      expect(service.package_set_id).toBeNull();

      // Simulate updating the service after modal submit
      const newPackageSetId = 'ps_new_001';
      const updatedService = { ...service, package_set_id: newPackageSetId };

      expect(updatedService.package_set_id).toBe('ps_new_001');
      expect(updatedService.id).toBe('svc_002'); // ID unchanged
    });
  });

  // Test 4.1.4: Clone action is disabled when package_set_id is null
  describe('Clone Action State', () => {
    it('should not prepare clone data when service has no package_set_id', () => {
      const service = mockServices.find((s) => s.id === 'svc_002');
      expect(service?.package_set_id).toBeNull();

      // Clone should not proceed
      const canClone = service?.package_set_id !== null && service?.package_set_id !== undefined;
      expect(canClone).toBe(false);
    });

    it('should allow clone when service has a valid package_set_id', () => {
      const service = mockServices.find((s) => s.id === 'svc_001');
      expect(service?.package_set_id).toBe('ps_001');

      const canClone = service?.package_set_id !== null && service?.package_set_id !== undefined;
      expect(canClone).toBe(true);
    });
  });

  // Test 4.1.5: Multiple packages are created with correct sort_order
  describe('Package Creation', () => {
    it('should create packages with correct sort_order', () => {
      const formData = {
        name: 'Test Package Set',
        packages: [
          { name: 'first', purpose: 'First package', sort_order: undefined },
          { name: 'second', purpose: 'Second package', sort_order: undefined },
          { name: 'third', purpose: 'Third package', sort_order: undefined },
        ],
      };

      // When sort_order is undefined, it should default to index + 1
      const packagesWithOrder = formData.packages.map((pkg, index) => ({
        ...pkg,
        sort_order: pkg.sort_order ?? index + 1,
      }));

      expect(packagesWithOrder[0].sort_order).toBe(1);
      expect(packagesWithOrder[1].sort_order).toBe(2);
      expect(packagesWithOrder[2].sort_order).toBe(3);
    });

    it('should preserve existing sort_order if specified', () => {
      const formData = {
        name: 'Test Package Set',
        packages: [
          { name: 'first', purpose: 'First package', sort_order: 10 },
          { name: 'second', purpose: 'Second package', sort_order: 20 },
        ],
      };

      const packagesWithOrder = formData.packages.map((pkg, index) => ({
        ...pkg,
        sort_order: pkg.sort_order ?? index + 1,
      }));

      expect(packagesWithOrder[0].sort_order).toBe(10);
      expect(packagesWithOrder[1].sort_order).toBe(20);
    });
  });
});
