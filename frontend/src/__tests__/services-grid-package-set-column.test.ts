/**
 * Services Grid Package Set Column Tests
 * Spec: Service Package Set Assignment Dropdown - Task Group 3
 */

import { gridConfigs } from '../config/gridConfigs';

describe('Services Grid Package Set Column Configuration', () => {
  // Test 3.1.1: Package Set column exists in services grid config
  it('should have package_set_id column in services grid config', () => {
    const servicesConfig = gridConfigs.services;
    expect(servicesConfig).toBeDefined();

    const packageSetColumn = servicesConfig.find((col) => col.field === 'package_set_id');
    expect(packageSetColumn).toBeDefined();
  });

  // Test 3.1.2: Package Set column has correct configuration
  it('should have correct Package Set column configuration', () => {
    const servicesConfig = gridConfigs.services;
    const packageSetColumn = servicesConfig.find((col) => col.field === 'package_set_id');

    expect(packageSetColumn).toMatchObject({
      field: 'package_set_id',
      displayName: 'Package Set',
      cellType: 'package_set_dropdown',
      required: false,
    });
  });

  // Test 3.1.3: Package Set column is positioned after core_tech
  it('should position Package Set column after core_tech', () => {
    const servicesConfig = gridConfigs.services;
    const coreTechIndex = servicesConfig.findIndex((col) => col.field === 'core_tech');
    const packageSetIndex = servicesConfig.findIndex((col) => col.field === 'package_set_id');

    expect(coreTechIndex).toBeGreaterThanOrEqual(0);
    expect(packageSetIndex).toBeGreaterThanOrEqual(0);
    expect(packageSetIndex).toBe(coreTechIndex + 1);
  });

  // Test 3.1.4: All expected services columns are present
  it('should have all expected columns in services grid', () => {
    const servicesConfig = gridConfigs.services;
    const expectedFields = [
      'id',
      'name',
      'description',
      'application_id',
      'app_component_id',
      // service_type was removed from the grid; repo columns added
      // (Spec 2026-04-16 Service-Scoped Discovery / 2026-04-20 Tech Hints)
      'repo_location',
      'repo_subfolder',
      'core_tech',
      'package_set_id', // New column
      'tags',
      'valid_from',
      'valid_to',
    ];

    const actualFields = servicesConfig.map((col) => col.field);
    expectedFields.forEach((field) => {
      expect(actualFields).toContain(field);
    });
  });
});
