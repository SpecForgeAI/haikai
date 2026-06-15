/**
 * Tests for grid configuration with separate data type options
 * Task Group 2: Update Grid Configuration for Separate Type Options
 */

import { gridConfigs } from '../config/gridConfigs';
import { OAS_DATA_TYPE_OPTIONS, SQL_DATA_TYPE_OPTIONS } from '../config/defaults';

describe('Grid Configuration Data Type Options', () => {
  describe('logical_data_attributes configuration', () => {
    const logicalConfig = gridConfigs.logical_data_attributes;
    const dataTypeColumn = logicalConfig.find((col) => col.field === 'data_type');

    it('should have data_type column configured', () => {
      expect(dataTypeColumn).toBeDefined();
    });

    it('should use OAS_DATA_TYPE_OPTIONS for dropdown options', () => {
      expect(dataTypeColumn?.options).toEqual([...OAS_DATA_TYPE_OPTIONS]);
    });

    it('should have dropdown cellType', () => {
      expect(dataTypeColumn?.cellType).toBe('dropdown');
    });

    it('should have appropriate width for longer OAS type names', () => {
      // OAS types like "string_date-time" are longer, so width should be >= 120
      expect(dataTypeColumn?.width).toBeGreaterThanOrEqual(120);
    });

    it('should contain all 16 OAS types in options', () => {
      expect(dataTypeColumn?.options).toHaveLength(16);
    });
  });

  describe('physical_data_attributes configuration', () => {
    const physicalConfig = gridConfigs.physical_data_attributes;
    const dataTypeColumn = physicalConfig.find((col) => col.field === 'data_type');

    it('should have data_type column configured', () => {
      expect(dataTypeColumn).toBeDefined();
    });

    it('should use SQL_DATA_TYPE_OPTIONS for dropdown options', () => {
      expect(dataTypeColumn?.options).toEqual([...SQL_DATA_TYPE_OPTIONS]);
    });

    it('should have dropdown cellType', () => {
      expect(dataTypeColumn?.cellType).toBe('dropdown');
    });

    it('should have appropriate width for SQL type names', () => {
      // SQL types are shorter, width of 100 is sufficient
      expect(dataTypeColumn?.width).toBeGreaterThanOrEqual(100);
    });

    it('should contain all 16 SQL types in options', () => {
      expect(dataTypeColumn?.options).toHaveLength(16);
    });
  });

  describe('Logical vs Physical differentiation', () => {
    const logicalDataTypeCol = gridConfigs.logical_data_attributes.find(
      (col) => col.field === 'data_type'
    );
    const physicalDataTypeCol = gridConfigs.physical_data_attributes.find(
      (col) => col.field === 'data_type'
    );

    it('should have different options for logical and physical attributes', () => {
      expect(logicalDataTypeCol?.options).not.toEqual(physicalDataTypeCol?.options);
    });

    it('should have OAS types for logical (lowercase base types)', () => {
      const options = logicalDataTypeCol?.options || [];
      expect(options).toContain('string');
      expect(options).toContain('integer');
      expect(options).toContain('boolean');
    });

    it('should have SQL types for physical (uppercase types)', () => {
      const options = physicalDataTypeCol?.options || [];
      expect(options).toContain('VARCHAR');
      expect(options).toContain('INTEGER');
      expect(options).toContain('BOOLEAN');
    });
  });

  describe('Import statements', () => {
    it('should have OAS_DATA_TYPE_OPTIONS available', () => {
      expect(OAS_DATA_TYPE_OPTIONS).toBeDefined();
      expect(Array.isArray(OAS_DATA_TYPE_OPTIONS)).toBe(true);
    });

    it('should have SQL_DATA_TYPE_OPTIONS available', () => {
      expect(SQL_DATA_TYPE_OPTIONS).toBeDefined();
      expect(Array.isArray(SQL_DATA_TYPE_OPTIONS)).toBe(true);
    });
  });
});
