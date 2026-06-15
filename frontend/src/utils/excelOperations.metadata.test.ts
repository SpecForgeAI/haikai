/**
 * XLSX Metadata Worksheet Tests
 *
 * Spec 2026-01-19: Export Project Name Prompt
 * Task Group 4: XLSX Metadata Worksheet
 *
 * Tests for the _metadata worksheet functionality in XLSX export/import.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

// Mock the xlsx library to capture workbook creation
vi.mock('xlsx', async () => {
  const actual = await vi.importActual<typeof XLSX>('xlsx');
  return {
    ...actual,
    writeFile: vi.fn(),
  };
});

// Import after mocking
import {
  exportMetaModelToExcel,
  importMetaModelFromExcel,
  ImportResult,
} from './excelOperations';
import { ArchitectureModel } from '../types/model';

/**
 * Create a minimal test model
 */
function createTestModel(): ArchitectureModel {
  return {
    metaModel: {
      entities: {
        business_users: [],
        business_processes: [],
        business_services: [],
        business_functions: [],
        products: [],
        applications: [],
        logical_data_entities: [],
        physical_data_entities: [],
        logical_data_attributes: [],
        physical_data_attributes: [],
        component_services: [],
        integrations: [],
        interfaces: [],
        technology_platforms: [],
        technology_zones: [],
        application_points: [],
        business_points: [],
        app_business_points: [],
        business_logics: [],
      },
      relationships: {
        business_user_business_functions: [],
        business_user_business_services: [],
        business_function_business_services: [],
        business_service_business_processes: [],
        business_service_products: [],
        business_user_products: [],
        application_business_services: [],
        application_component_services: [],
        integration_component_services: [],
        interface_integrations: [],
        technology_platform_applications: [],
        technology_zone_technology_platforms: [],
        logical_data_entity_applications: [],
        logical_data_attribute_logical_data_entities: [],
        physical_data_entity_logical_data_entities: [],
        physical_data_attribute_physical_data_entities: [],
        physical_data_entity_applications: [],
        interface_logical_entities: [],
        application_point_business_points: [],
        logical_data_entity_relationships: [],
        application_point_business_logics: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
      },
    },
    diagrams: [],
  };
}

describe('XLSX Metadata Worksheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 4.1a: Export creates _metadata worksheet as first sheet
  it('export creates _metadata worksheet as first sheet', () => {
    const model = createTestModel();
    let capturedWorkbook: XLSX.WorkBook | null = null;

    // Capture the workbook when writeFile is called
    vi.mocked(XLSX.writeFile).mockImplementation((wb) => {
      capturedWorkbook = wb as XLSX.WorkBook;
    });

    exportMetaModelToExcel(model, 'Test Project');

    expect(capturedWorkbook).not.toBeNull();
    expect(capturedWorkbook!.SheetNames[0]).toBe('_metadata');
  });

  // Test 4.1b: _metadata contains project_name and export_date columns
  it('_metadata worksheet contains project_name and export_date columns', () => {
    const model = createTestModel();
    let capturedWorkbook: XLSX.WorkBook | null = null;

    vi.mocked(XLSX.writeFile).mockImplementation((wb) => {
      capturedWorkbook = wb as XLSX.WorkBook;
    });

    exportMetaModelToExcel(model, 'Test Project');

    expect(capturedWorkbook).not.toBeNull();
    const metadataSheet = capturedWorkbook!.Sheets['_metadata'];
    expect(metadataSheet).toBeDefined();

    // Read the sheet as JSON to verify contents
    const data = XLSX.utils.sheet_to_json(metadataSheet, { header: 1 }) as unknown[][];

    // First row should be headers
    expect(data[0]).toContain('project_name');
    expect(data[0]).toContain('export_date');

    // Second row should contain the project name
    expect(data[1][0]).toBe('Test Project');
    // export_date should be an ISO timestamp
    expect(typeof data[1][1]).toBe('string');
    // Verify it looks like an ISO date
    expect(data[1][1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // Test 4.1c: Import reads project_name from _metadata worksheet
  it('import reads project_name from _metadata worksheet', async () => {
    // Create a mock XLSX file with _metadata worksheet
    const workbook = XLSX.utils.book_new();

    // Add _metadata worksheet
    const metadataData = [
      ['project_name', 'export_date'],
      ['Imported Project', '2026-01-19T12:00:00.000Z'],
    ];
    const metadataSheet = XLSX.utils.aoa_to_sheet(metadataData);
    XLSX.utils.book_append_sheet(workbook, metadataSheet, '_metadata');

    // Add an empty entity worksheet to make it a valid file
    const entityData = [['ID', 'Name']];
    const entitySheet = XLSX.utils.aoa_to_sheet(entityData);
    XLSX.utils.book_append_sheet(workbook, entitySheet, 'business_users');

    // Write to buffer and create a File object
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const file = new File([buffer], 'test.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const model = createTestModel();
    const result = await importMetaModelFromExcel(file, model, 'overwrite');

    expect(result.success).toBe(true);
    expect(result.projectName).toBe('Imported Project');
  });

  // Test 4.1d: Import handles missing _metadata worksheet (backward compatibility)
  it('import handles missing _metadata worksheet gracefully', async () => {
    // Create a mock XLSX file WITHOUT _metadata worksheet
    const workbook = XLSX.utils.book_new();

    // Add only entity worksheet (no _metadata)
    const entityData = [['ID', 'Name']];
    const entitySheet = XLSX.utils.aoa_to_sheet(entityData);
    XLSX.utils.book_append_sheet(workbook, entitySheet, 'business_users');

    // Write to buffer and create a File object
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const file = new File([buffer], 'test.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const model = createTestModel();
    const result = await importMetaModelFromExcel(file, model, 'overwrite');

    expect(result.success).toBe(true);
    // projectName should be undefined when _metadata is missing
    expect(result.projectName).toBeUndefined();
  });

  // Test 4.1e: ImportResult includes optional projectName field
  it('ImportResult type includes projectName field', async () => {
    // Create a mock XLSX file with _metadata
    const workbook = XLSX.utils.book_new();
    const metadataData = [
      ['project_name', 'export_date'],
      ['My Project', '2026-01-19T12:00:00.000Z'],
    ];
    const metadataSheet = XLSX.utils.aoa_to_sheet(metadataData);
    XLSX.utils.book_append_sheet(workbook, metadataSheet, '_metadata');

    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const file = new File([buffer], 'test.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const model = createTestModel();
    const result: ImportResult = await importMetaModelFromExcel(file, model, 'overwrite');

    // TypeScript should recognize projectName as a valid property
    const projectName: string | undefined = result.projectName;
    expect(projectName).toBe('My Project');
  });
});
