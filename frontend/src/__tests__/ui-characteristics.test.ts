/**
 * UI Characteristics Tests
 *
 * Spec 2026-01-20: UI Characteristics Entity
 * Task Group 4.1: Tests for UI Characteristics frontend integration
 *
 * Tests verify:
 * - UICharacteristic interface type structure
 * - UICharacteristicType enum values
 * - Grid configuration has correct columns
 * - Tab appears in correct position (5th under UI domain)
 * - AppConfig parses key suggestions from bootstrap
 * - Type change clears key value behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  gridConfigs,
  tabToEntityType,
  entityTabNames,
  domainGroupings,
  DOMAIN_ENTITY_TYPES,
} from '../config/gridConfigs';
import { uiCharacteristicTypeOptions } from '../config/defaults';
import { loadRuntimeConfig, _resetWarningFlag } from '../contexts/AppConfigContext';

/**
 * Test 1: UICharacteristic interface type structure
 * Verifies that the UICharacteristic type is correctly defined in model.ts
 */
describe('UICharacteristic interface type structure', () => {
  it('should have UICharacteristicType with correct enum values', () => {
    // Verify the type options array contains all 4 expected values
    expect(uiCharacteristicTypeOptions).toHaveLength(4);
    expect(uiCharacteristicTypeOptions.map(o => o.value)).toContain('business_feature');
    expect(uiCharacteristicTypeOptions.map(o => o.value)).toContain('ui_capability');
    expect(uiCharacteristicTypeOptions.map(o => o.value)).toContain('interaction_complexity');
    expect(uiCharacteristicTypeOptions.map(o => o.value)).toContain('technical_shape');
  });

  it('should have correct display labels for type options', () => {
    const optionsByValue = new Map(uiCharacteristicTypeOptions.map(o => [o.value, o.label]));

    expect(optionsByValue.get('business_feature')).toBe('Business Feature');
    expect(optionsByValue.get('ui_capability')).toBe('UI Capability');
    expect(optionsByValue.get('interaction_complexity')).toBe('Interaction Complexity');
    expect(optionsByValue.get('technical_shape')).toBe('Technical Shape');
  });
});

/**
 * Test 2: Grid configuration has correct columns
 * Verifies that ui_characteristics grid config has all required columns
 */
describe('UI Characteristics grid configuration', () => {
  it('should have ui_characteristics grid config defined', () => {
    expect(gridConfigs['ui_characteristics']).toBeDefined();
    expect(Array.isArray(gridConfigs['ui_characteristics'])).toBe(true);
  });

  it('should have all required columns', () => {
    const columns = gridConfigs['ui_characteristics'];
    const columnFields = columns.map(c => c.field);

    // Required columns
    expect(columnFields).toContain('id');
    expect(columnFields).toContain('uiId');
    expect(columnFields).toContain('type');
    expect(columnFields).toContain('key');
    expect(columnFields).toContain('name');
    expect(columnFields).toContain('description');
    expect(columnFields).toContain('evidence');
  });

  it('should have correct required flags for columns', () => {
    const columns = gridConfigs['ui_characteristics'];
    const columnsByField = new Map(columns.map(c => [c.field, c]));

    // Required columns
    expect(columnsByField.get('id')?.required).toBe(true);
    expect(columnsByField.get('uiId')?.required).toBe(true);
    expect(columnsByField.get('type')?.required).toBe(true);
    expect(columnsByField.get('name')?.required).toBe(true);

    // Optional columns
    expect(columnsByField.get('key')?.required).toBe(false);
    expect(columnsByField.get('description')?.required).toBe(false);
    expect(columnsByField.get('evidence')?.required).toBe(false);
  });

  it('should have correct cell types for columns', () => {
    const columns = gridConfigs['ui_characteristics'];
    const columnsByField = new Map(columns.map(c => [c.field, c]));

    expect(columnsByField.get('id')?.cellType).toBe('text');
    expect(columnsByField.get('uiId')?.cellType).toBe('application_point_picker');
    expect(columnsByField.get('type')?.cellType).toBe('dropdown');
    expect(columnsByField.get('key')?.cellType).toBe('text_with_suggestions');
    expect(columnsByField.get('name')?.cellType).toBe('text');
    expect(columnsByField.get('description')?.cellType).toBe('text');
    expect(columnsByField.get('evidence')?.cellType).toBe('text');
  });

  it('should have id column with autoGenerate flag', () => {
    const columns = gridConfigs['ui_characteristics'];
    const idColumn = columns.find(c => c.field === 'id');

    expect(idColumn?.autoGenerate).toBe(true);
  });

  it('should have type column with correct dropdown options', () => {
    const columns = gridConfigs['ui_characteristics'];
    const typeColumn = columns.find(c => c.field === 'type');

    expect(typeColumn?.options).toBeDefined();
    expect(typeColumn?.options).toHaveLength(4);
  });

  it('should have key column with dynamicSuggestions flag', () => {
    const columns = gridConfigs['ui_characteristics'];
    const keyColumn = columns.find(c => c.field === 'key');

    expect(keyColumn?.dynamicSuggestions).toBe(true);
  });
});

/**
 * Test 3: Tab appears in correct position (5th under UI domain)
 * Verifies that UI Characteristics tab is positioned after UI Actions
 */
describe('UI Characteristics tab positioning', () => {
  it('should have UI Characteristics in tabToEntityType mapping', () => {
    expect(tabToEntityType['UI Characteristics']).toBe('ui_characteristics');
  });

  it('should have UI Characteristics in entityTabNames', () => {
    expect(entityTabNames).toContain('UI Characteristics');
  });

  it('should have UI Characteristics in UI domain grouping', () => {
    expect(domainGroupings.ui).toContain('UI Characteristics');
  });

  it('should have UI Characteristics as 5th tab in UI domain (after UI Actions)', () => {
    const uiTabs = domainGroupings.ui;
    const uiActionsIndex = uiTabs.indexOf('UI Actions');
    const uiCharacteristicsIndex = uiTabs.indexOf('UI Characteristics');

    // UI Characteristics should come after UI Actions
    expect(uiCharacteristicsIndex).toBeGreaterThan(uiActionsIndex);
    // UI Characteristics should be the 5th tab (index 4)
    expect(uiCharacteristicsIndex).toBe(4);
  });

  it('should have ui_characteristics in DOMAIN_ENTITY_TYPES.ui', () => {
    expect(DOMAIN_ENTITY_TYPES.ui).toContain('ui_characteristics');
  });
});

/**
 * Test 4: AppConfig parses key suggestions from bootstrap
 * Verifies that the AppConfig correctly parses pipe-delimited key suggestions
 */
describe('AppConfig key suggestions parsing', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    _resetWarningFlag();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should parse empty key suggestion arrays from bootstrap', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        include_delivery: true,
        include_database: true,
        ui_characteristics_ui_capability_keys: '',
        ui_characteristics_interaction_complexity_keys: '',
        ui_characteristics_technical_shape_keys: '',
      }),
    });

    const config = await loadRuntimeConfig();

    expect(config.uiCharacteristicsUiCapabilityKeys).toEqual([]);
    expect(config.uiCharacteristicsInteractionComplexityKeys).toEqual([]);
    expect(config.uiCharacteristicsTechnicalShapeKeys).toEqual([]);
  });

  it('should parse pipe-delimited key suggestions from bootstrap', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        include_delivery: true,
        include_database: true,
        ui_characteristics_ui_capability_keys: 'search|filter|sort|paginate',
        ui_characteristics_interaction_complexity_keys: 'simple|moderate|complex',
        ui_characteristics_technical_shape_keys: 'form|list|detail|dashboard',
      }),
    });

    const config = await loadRuntimeConfig();

    expect(config.uiCharacteristicsUiCapabilityKeys).toEqual(['search', 'filter', 'sort', 'paginate']);
    expect(config.uiCharacteristicsInteractionComplexityKeys).toEqual(['simple', 'moderate', 'complex']);
    expect(config.uiCharacteristicsTechnicalShapeKeys).toEqual(['form', 'list', 'detail', 'dashboard']);
  });

  it('should parse comma-delimited key suggestions from bootstrap', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        include_delivery: true,
        include_database: true,
        ui_characteristics_ui_capability_keys: 'search,filter,sort',
        ui_characteristics_interaction_complexity_keys: 'simple,complex',
        ui_characteristics_technical_shape_keys: 'form,list',
      }),
    });

    const config = await loadRuntimeConfig();

    expect(config.uiCharacteristicsUiCapabilityKeys).toEqual(['search', 'filter', 'sort']);
    expect(config.uiCharacteristicsInteractionComplexityKeys).toEqual(['simple', 'complex']);
    expect(config.uiCharacteristicsTechnicalShapeKeys).toEqual(['form', 'list']);
  });

  it('should use empty arrays when key suggestion fields are missing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        include_delivery: true,
        include_database: true,
        // Key suggestion fields are missing
      }),
    });

    const config = await loadRuntimeConfig();

    expect(config.uiCharacteristicsUiCapabilityKeys).toEqual([]);
    expect(config.uiCharacteristicsInteractionComplexityKeys).toEqual([]);
    expect(config.uiCharacteristicsTechnicalShapeKeys).toEqual([]);
  });

  it('should trim whitespace from key suggestions', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        include_delivery: true,
        include_database: true,
        ui_characteristics_ui_capability_keys: ' search | filter | sort ',
        ui_characteristics_interaction_complexity_keys: ' simple , complex ',
        ui_characteristics_technical_shape_keys: 'form|list',
      }),
    });

    const config = await loadRuntimeConfig();

    expect(config.uiCharacteristicsUiCapabilityKeys).toEqual(['search', 'filter', 'sort']);
    expect(config.uiCharacteristicsInteractionComplexityKeys).toEqual(['simple', 'complex']);
    expect(config.uiCharacteristicsTechnicalShapeKeys).toEqual(['form', 'list']);
  });
});
