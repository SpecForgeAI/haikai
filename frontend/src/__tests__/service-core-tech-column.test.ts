/**
 * Tests for Service core_tech column and service_type free-text changes.
 *
 * Spec: Add Service.Core Tech Column and Change Service Type to Free-Text
 * Task Group 3: Frontend TypeScript Model Updates (2 tests)
 * Task Group 4: Grid Configuration Updates (3 tests)
 * Task Group 5: Integration Testing (4 tests)
 */

import { gridConfigs } from '../config/gridConfigs';
import type { Service } from '../types/model';

// ============================================================================
// Task Group 3: Frontend TypeScript Model Tests (2 tests)
// ============================================================================

describe('Task Group 3: Service Interface Model Updates', () => {
  /**
   * Test 3.1: Verify Service interface accepts core_tech as optional string.
   */
  it('Test 3.1: Service interface accepts core_tech as optional string', () => {
    // Given: A Service object with core_tech populated
    const service: Service = {
      id: 'svc-001',
      name: 'Order Service',
      description: 'Handles order processing',
      application_id: 'app-001',
      service_type: 'Backend',
      core_tech: 'Java, Spring Boot, PostgreSQL',
      tags: 'backend,orders',
      valid_from: '2026-Q1',
    };

    // Then: The object should be valid with core_tech set
    expect(service.core_tech).toBe('Java, Spring Boot, PostgreSQL');
    expect(service.id).toBe('svc-001');
    expect(service.name).toBe('Order Service');
  });

  /**
   * Test 3.2: Verify Service interface allows core_tech to be undefined.
   */
  it('Test 3.2: Service interface allows core_tech to be undefined', () => {
    // Given: A Service object without core_tech (optional field)
    const service: Service = {
      id: 'svc-002',
      name: 'Legacy Service',
      description: 'A legacy service',
      application_id: 'app-001',
      service_type: 'Legacy',
      tags: 'legacy',
    };

    // Then: The object should be valid without core_tech
    expect(service.core_tech).toBeUndefined();
    expect(service.id).toBe('svc-002');
    expect(service.name).toBe('Legacy Service');
  });
});

// ============================================================================
// Task Group 4: Grid Configuration Tests (3 tests)
// ============================================================================

describe('Task Group 4: Services Grid Configuration Updates', () => {
  /**
   * Test 4.1: Verify service_type column uses cellType 'text' (not dropdown).
   */
  it('Test 4.1: service_type column is no longer rendered in the services grid', () => {
    // Given: The services grid configuration
    const servicesConfig = gridConfigs.services;

    // When: Finding the service_type column
    const serviceTypeColumn = servicesConfig.find(col => col.field === 'service_type');

    // Then: The column was removed from the grid (the field remains on the
    // Service model, but the grid surfaces repo/core-tech columns instead).
    expect(serviceTypeColumn).toBeUndefined();
  });

  /**
   * Test 4.2: Verify core_tech column exists with cellType 'text'.
   */
  it('Test 4.2: core_tech column exists with cellType tech_hints_cell', () => {
    // Given: The services grid configuration
    const servicesConfig = gridConfigs.services;

    // When: Finding the core_tech column
    const coreTechColumn = servicesConfig.find(col => col.field === 'core_tech');

    // Then: It should exist with proper configuration
    // Spec 2026-04-20 (Tech Hints LLM Resolution): core_tech now renders via
    // the custom tech_hints_cell (chips + confirmation sentence) instead of text.
    expect(coreTechColumn).toBeDefined();
    expect(coreTechColumn?.cellType).toBe('tech_hints_cell');
    expect(coreTechColumn?.displayName).toBe('Core Tech');
    expect(coreTechColumn?.required).toBe(false);
    expect(coreTechColumn?.width).toBeGreaterThan(0);
  });

  /**
   * Test 4.3: Verify serviceTypeOptions is NOT imported in gridConfigs.
   * This test checks that the dropdown options were removed.
   */
  it('Test 4.3: services grid does not use serviceTypeOptions dropdown', () => {
    // Given: The services grid configuration
    const servicesConfig = gridConfigs.services;

    // When: Checking all columns for dropdown options related to service type
    const columnsWithOptions = servicesConfig.filter(
      col => col.options !== undefined && col.field !== 'app_type' && col.field !== 'status'
    );

    // Then: service_type should not have options (was changed from dropdown to text)
    const serviceTypeWithOptions = columnsWithOptions.find(col => col.field === 'service_type');
    expect(serviceTypeWithOptions).toBeUndefined();
  });
});

// ============================================================================
// Task Group 5: Integration Tests (4 tests)
// ============================================================================

describe('Task Group 5: Integration Tests', () => {
  /**
   * Test 5.1: Verify services grid column order includes core_tech after service_type.
   */
  it('Test 5.1: services grid has core_tech column positioned after the repo columns', () => {
    // Given: The services grid configuration
    const servicesConfig = gridConfigs.services;

    // When: Finding the positions of repo_subfolder and core_tech
    // (Spec 2026-04-20: repo columns moved BEFORE core_tech so they are
    // available for the save-time LLM cross-check.)
    const repoSubfolderIndex = servicesConfig.findIndex(col => col.field === 'repo_subfolder');
    const coreTechIndex = servicesConfig.findIndex(col => col.field === 'core_tech');

    // Then: core_tech should come immediately after repo_subfolder
    expect(repoSubfolderIndex).toBeGreaterThan(-1);
    expect(coreTechIndex).toBeGreaterThan(-1);
    expect(coreTechIndex).toBe(repoSubfolderIndex + 1);
  });

  /**
   * Test 5.2: Verify services grid has all expected columns.
   */
  it('Test 5.2: services grid has all expected columns including core_tech', () => {
    // Given: The services grid configuration
    const servicesConfig = gridConfigs.services;

    // Then: All expected columns should be present
    const expectedFields = [
      'id',
      'name',
      'description',
      'application_id',
      'app_component_id',
      'repo_location',
      'repo_subfolder',
      'core_tech',
      'package_set_id',
      'is_internal',
      'tags',
      'valid_from',
      'valid_to',
    ];

    const actualFields = servicesConfig.map(col => col.field);
    expectedFields.forEach(field => {
      expect(actualFields).toContain(field);
    });
  });

  /**
   * Test 5.3: Verify Service interface properties match grid column fields.
   */
  it('Test 5.3: Service interface properties match grid column fields', () => {
    // Given: The services grid configuration and a Service object
    const servicesConfig = gridConfigs.services;
    const service: Service = {
      id: 'svc-test',
      name: 'Test Service',
      description: 'Test description',
      application_id: 'app-test',
      app_component_id: 'comp-test',
      service_type: 'Microservice',
      core_tech: 'TypeScript, Node.js',
      repo_location: 'https://example.com/repo.git',
      repo_subfolder: 'services/test-service',
      package_set_id: 'ps-test',
      is_internal: true,
      tags: 'test',
      valid_from: '2026-Q1',
      valid_to: '2026-Q4',
    };

    // Then: Each grid column field should exist as a property on Service
    servicesConfig.forEach(column => {
      expect(service).toHaveProperty(column.field);
    });
  });

  /**
   * Test 5.4: Verify core_tech and service_type are both free-text (no dropdown constraints).
   */
  it('Test 5.4: core_tech allows free-text entry (no dropdown constraints)', () => {
    // Given: The services grid configuration
    const servicesConfig = gridConfigs.services;

    // When: Finding the core_tech column (service_type is no longer a grid column)
    const coreTechColumn = servicesConfig.find(col => col.field === 'core_tech');

    // Then: core_tech renders via the tech_hints_cell with no constrained options
    expect(coreTechColumn?.cellType).toBe('tech_hints_cell');
    expect(coreTechColumn?.options).toBeUndefined();

    // Verify they can accept any string values
    const service: Service = {
      id: 'svc-free',
      name: 'Free Text Service',
      description: 'Test',
      application_id: 'app-001',
      service_type: 'Custom Service Type Value That Was Not Predefined',
      core_tech: 'Any arbitrary tech stack: Rust, WebAssembly, Edge Functions',
      tags: '',
    };

    expect(service.service_type).toBe('Custom Service Type Value That Was Not Predefined');
    expect(service.core_tech).toBe('Any arbitrary tech stack: Rust, WebAssembly, Edge Functions');
  });
});
