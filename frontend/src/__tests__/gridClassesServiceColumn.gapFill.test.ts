/**
 * Gap-Fill Test: Grid renders classes table with Service column
 *
 * Spec: Extension Pack Framework & LLM File-Level Analysis
 * Task Group 13: Test Review and Gap Analysis
 *
 * Verifies that the classes grid configuration:
 * - Has a 'service_id' column with displayName 'Service'
 * - Uses fk_typeahead cellType targeting the 'services' entity list
 * - Does NOT have an 'application_point_id' column
 * - Has the correct column order (id, name, description, namespace, service_id)
 */

import { describe, test, expect } from 'vitest';
import { gridConfigs } from '../config/gridConfigs';

describe('Grid: Classes table Service column (TG13 gap-fill)', () => {

  test('classes grid has Service column with service_id field and fk_typeahead cellType', () => {
    const classesColumns = gridConfigs['classes'];
    expect(classesColumns).toBeDefined();
    expect(Array.isArray(classesColumns)).toBe(true);

    // Find the Service column
    const serviceColumn = classesColumns.find(col => col.field === 'service_id');
    expect(serviceColumn).toBeDefined();
    expect(serviceColumn!.displayName).toBe('Service');
    expect(serviceColumn!.cellType).toBe('fk_typeahead');
    expect(serviceColumn!.fkTarget).toBe('services');

    // Verify no Application Point column
    const apColumn = classesColumns.find(
      col => col.field === 'application_point_id'
    );
    expect(apColumn).toBeUndefined();

    // Verify no "Application Point" displayName
    const apNameColumn = classesColumns.find(
      col => col.displayName === 'Application Point'
    );
    expect(apNameColumn).toBeUndefined();
  });

  test('classes grid column order includes expected fields', () => {
    const classesColumns = gridConfigs['classes'];
    const fields = classesColumns.map(col => col.field);

    // Expected fields in order
    expect(fields).toContain('id');
    expect(fields).toContain('name');
    expect(fields).toContain('description');
    expect(fields).toContain('namespace');
    expect(fields).toContain('service_id');

    // service_id should be the last column
    expect(fields[fields.length - 1]).toBe('service_id');

    // Verify total column count
    expect(classesColumns).toHaveLength(5);
  });
});
