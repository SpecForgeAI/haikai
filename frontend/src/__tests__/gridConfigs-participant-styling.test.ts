/**
 * Grid Configuration Tests for Participant Styling Fields
 * Spec: Sequence Diagram Participant Colour and Icons - Task Group 4
 *
 * Tests that grid configurations include the new is_internal and tech_type columns
 * for Applications, App Components, and Services entities.
 */

import { gridConfigs } from '../config/gridConfigs';
import { techTypeOptions } from '../config/defaults';

describe('Applications Grid Configuration - Participant Styling', () => {
  // Test 4.1.1: Applications grid config includes is_internal boolean column
  it('should have is_internal boolean column in applications grid config', () => {
    const applicationsConfig = gridConfigs.applications;
    expect(applicationsConfig).toBeDefined();

    const isInternalColumn = applicationsConfig.find((col) => col.field === 'is_internal');
    expect(isInternalColumn).toBeDefined();
    expect(isInternalColumn).toMatchObject({
      field: 'is_internal',
      displayName: 'Is Internal?',
      cellType: 'boolean',
      required: false,
      width: 100,
    });
  });

  // Test: is_internal column is positioned after status column
  it('should position is_internal column after status', () => {
    const applicationsConfig = gridConfigs.applications;
    const statusIndex = applicationsConfig.findIndex((col) => col.field === 'status');
    const isInternalIndex = applicationsConfig.findIndex((col) => col.field === 'is_internal');

    expect(statusIndex).toBeGreaterThanOrEqual(0);
    expect(isInternalIndex).toBeGreaterThanOrEqual(0);
    expect(isInternalIndex).toBe(statusIndex + 1);
  });
});

describe('App Components Grid Configuration - Participant Styling', () => {
  // Test 4.1.2: App Components grid config includes is_internal boolean and tech_type dropdown columns
  it('should have is_internal boolean column in app_components grid config', () => {
    const appComponentsConfig = gridConfigs.app_components;
    expect(appComponentsConfig).toBeDefined();

    const isInternalColumn = appComponentsConfig.find((col) => col.field === 'is_internal');
    expect(isInternalColumn).toBeDefined();
    expect(isInternalColumn).toMatchObject({
      field: 'is_internal',
      displayName: 'Is Internal?',
      cellType: 'boolean',
      required: false,
      width: 100,
    });
  });

  it('should have tech_type dropdown column in app_components grid config', () => {
    const appComponentsConfig = gridConfigs.app_components;
    expect(appComponentsConfig).toBeDefined();

    const techTypeColumn = appComponentsConfig.find((col) => col.field === 'tech_type');
    expect(techTypeColumn).toBeDefined();
    expect(techTypeColumn).toMatchObject({
      field: 'tech_type',
      displayName: 'Tech Type',
      cellType: 'dropdown',
      required: false,
      width: 120,
    });
    expect(techTypeColumn?.options).toEqual(techTypeOptions);
  });

  // Test: tech_type dropdown has all four options
  it('should have all four tech_type options', () => {
    expect(techTypeOptions).toEqual(['UI Tier', 'Service Tier', 'Persistence Tier', 'Other']);
  });

  // Test: is_internal column is positioned after application_id column
  it('should position is_internal column after application_id', () => {
    const appComponentsConfig = gridConfigs.app_components;
    const applicationIdIndex = appComponentsConfig.findIndex((col) => col.field === 'application_id');
    const isInternalIndex = appComponentsConfig.findIndex((col) => col.field === 'is_internal');

    expect(applicationIdIndex).toBeGreaterThanOrEqual(0);
    expect(isInternalIndex).toBeGreaterThanOrEqual(0);
    expect(isInternalIndex).toBe(applicationIdIndex + 1);
  });

  // Test: tech_type column is positioned after is_internal column
  it('should position tech_type column after is_internal', () => {
    const appComponentsConfig = gridConfigs.app_components;
    const isInternalIndex = appComponentsConfig.findIndex((col) => col.field === 'is_internal');
    const techTypeIndex = appComponentsConfig.findIndex((col) => col.field === 'tech_type');

    expect(isInternalIndex).toBeGreaterThanOrEqual(0);
    expect(techTypeIndex).toBeGreaterThanOrEqual(0);
    expect(techTypeIndex).toBe(isInternalIndex + 1);
  });
});

describe('Services Grid Configuration - Participant Styling', () => {
  // Test 4.1.3: Services grid config includes is_internal boolean column
  it('should have is_internal boolean column in services grid config', () => {
    const servicesConfig = gridConfigs.services;
    expect(servicesConfig).toBeDefined();

    const isInternalColumn = servicesConfig.find((col) => col.field === 'is_internal');
    expect(isInternalColumn).toBeDefined();
    expect(isInternalColumn).toMatchObject({
      field: 'is_internal',
      displayName: 'Is Internal?',
      cellType: 'boolean',
      required: false,
      width: 100,
    });
  });

  // Test: is_internal column is positioned after package_set_id column
  it('should position is_internal column after package_set_id', () => {
    const servicesConfig = gridConfigs.services;
    const packageSetIdIndex = servicesConfig.findIndex((col) => col.field === 'package_set_id');
    const isInternalIndex = servicesConfig.findIndex((col) => col.field === 'is_internal');

    expect(packageSetIdIndex).toBeGreaterThanOrEqual(0);
    expect(isInternalIndex).toBeGreaterThanOrEqual(0);
    expect(isInternalIndex).toBe(packageSetIdIndex + 1);
  });

  // Test: All expected services columns are present including is_internal
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
      'package_set_id',
      'is_internal', // New column
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
