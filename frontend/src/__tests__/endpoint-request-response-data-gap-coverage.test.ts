/**
 * Additional gap-coverage tests for Endpoint Request/Response Data Fields
 * Spec: Metamodel Interface Endpoint - Add Request/Response Data and Simplify Endpoints Table
 * Task Group 4: Test Review and End-to-End Verification (Task 4.3)
 */

import { gridConfigs } from '../config/gridConfigs';

describe('Endpoint grid data_entity_point_picker cell type verification', () => {
  it('both Request Data and Response Data columns use data_entity_point_picker cellType consistently', () => {
    const endpointsConfig = gridConfigs.endpoints;

    const pickerColumns = endpointsConfig.filter(
      (col) => col.cellType === 'data_entity_point_picker'
    );

    // Exactly two columns should use data_entity_point_picker
    expect(pickerColumns).toHaveLength(2);
    expect(pickerColumns.map((c) => c.field)).toEqual([
      'request_data_entity_point_id',
      'response_data_entity_point_id',
    ]);

    // Both should be optional (not required)
    pickerColumns.forEach((col) => {
      expect(col.required).toBe(false);
      expect(col.width).toBe(200);
    });
  });
});
