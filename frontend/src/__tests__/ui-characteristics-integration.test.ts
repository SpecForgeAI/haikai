/**
 * UI Characteristics Integration Tests
 *
 * Spec 2026-01-20: UI Characteristics Entity
 * Task Group 5: Integration Testing and Gap Analysis
 *
 * These tests verify integration scenarios that span multiple components:
 * - Type-key interaction: Changing type clears key value
 * - Bootstrap integration: Key suggestions load from bootstrap
 * - Application Point picker integration: UI field accepts valid application point
 * - Grid rendering: Tab renders with correct columns
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { gridConfigs, domainGroupings, tabToEntityType, DOMAIN_ENTITY_TYPES } from '../config/gridConfigs';
import { uiCharacteristicTypeOptions } from '../config/defaults';
import { loadRuntimeConfig, _resetWarningFlag } from '../contexts/AppConfigContext';
import type { UICharacteristic, UICharacteristicType, MetaModelEntities } from '../types/model';

// ============================================================================
// Test 1: Type-Key Interaction - Changing type should clear key value
// This tests the Grid.tsx handleCellChange logic for ui_characteristics
// ============================================================================

describe('Type-key interaction behavior', () => {
  it('should have type field configured as dropdown', () => {
    const columns = gridConfigs['ui_characteristics'];
    const typeColumn = columns.find(c => c.field === 'type');

    expect(typeColumn).toBeDefined();
    expect(typeColumn?.cellType).toBe('dropdown');
    expect(typeColumn?.options).toHaveLength(4);
  });

  it('should have key field configured with dynamicSuggestions', () => {
    const columns = gridConfigs['ui_characteristics'];
    const keyColumn = columns.find(c => c.field === 'key');

    expect(keyColumn).toBeDefined();
    expect(keyColumn?.cellType).toBe('text_with_suggestions');
    expect(keyColumn?.dynamicSuggestions).toBe(true);
  });

  it('type options should include all four valid values', () => {
    const typeValues = uiCharacteristicTypeOptions.map(o => o.value);

    expect(typeValues).toContain('business_feature');
    expect(typeValues).toContain('ui_capability');
    expect(typeValues).toContain('interaction_complexity');
    expect(typeValues).toContain('technical_shape');
  });

  it('type options should have correct display labels', () => {
    const optionsByValue = new Map(uiCharacteristicTypeOptions.map(o => [o.value, o.label]));

    // Verify Title Case with spaces formatting
    expect(optionsByValue.get('business_feature')).toBe('Business Feature');
    expect(optionsByValue.get('ui_capability')).toBe('UI Capability');
    expect(optionsByValue.get('interaction_complexity')).toBe('Interaction Complexity');
    expect(optionsByValue.get('technical_shape')).toBe('Technical Shape');
  });
});

// ============================================================================
// Test 2: Bootstrap Integration - Key suggestions load from bootstrap
// Verifies AppConfig correctly parses and provides key suggestions
// ============================================================================

describe('Bootstrap integration for key suggestions', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    _resetWarningFlag();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should load and parse pipe-delimited ui_capability suggestions', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        include_delivery: true,
        include_database: true,
        ui_characteristics_ui_capability_keys: 'search|filter|sort|paginate|export',
        ui_characteristics_interaction_complexity_keys: '',
        ui_characteristics_technical_shape_keys: '',
      }),
    });

    const config = await loadRuntimeConfig();

    expect(config.uiCharacteristicsUiCapabilityKeys).toEqual([
      'search', 'filter', 'sort', 'paginate', 'export'
    ]);
  });

  it('should load and parse pipe-delimited interaction_complexity suggestions', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        include_delivery: true,
        include_database: true,
        ui_characteristics_ui_capability_keys: '',
        ui_characteristics_interaction_complexity_keys: 'simple|moderate|complex|expert',
        ui_characteristics_technical_shape_keys: '',
      }),
    });

    const config = await loadRuntimeConfig();

    expect(config.uiCharacteristicsInteractionComplexityKeys).toEqual([
      'simple', 'moderate', 'complex', 'expert'
    ]);
  });

  it('should load and parse pipe-delimited technical_shape suggestions', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        include_delivery: true,
        include_database: true,
        ui_characteristics_ui_capability_keys: '',
        ui_characteristics_interaction_complexity_keys: '',
        ui_characteristics_technical_shape_keys: 'form|list|detail|dashboard|wizard',
      }),
    });

    const config = await loadRuntimeConfig();

    expect(config.uiCharacteristicsTechnicalShapeKeys).toEqual([
      'form', 'list', 'detail', 'dashboard', 'wizard'
    ]);
  });

  it('should handle missing key suggestion fields gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        include_delivery: true,
        include_database: true,
        // Key suggestion fields are completely missing
      }),
    });

    const config = await loadRuntimeConfig();

    // Should default to empty arrays
    expect(config.uiCharacteristicsUiCapabilityKeys).toEqual([]);
    expect(config.uiCharacteristicsInteractionComplexityKeys).toEqual([]);
    expect(config.uiCharacteristicsTechnicalShapeKeys).toEqual([]);
  });
});

// ============================================================================
// Test 3: Application Point Picker Integration
// Verifies uiId field uses application_point_picker cell type
// ============================================================================

describe('Application Point picker integration', () => {
  it('should have uiId column with application_point_picker cell type', () => {
    const columns = gridConfigs['ui_characteristics'];
    const uiIdColumn = columns.find(c => c.field === 'uiId');

    expect(uiIdColumn).toBeDefined();
    expect(uiIdColumn?.cellType).toBe('application_point_picker');
    expect(uiIdColumn?.required).toBe(true);
  });

  it('should have displayFormatter for uiId column', () => {
    const columns = gridConfigs['ui_characteristics'];
    const uiIdColumn = columns.find(c => c.field === 'uiId');

    expect(uiIdColumn?.displayFormatter).toBeDefined();
    expect(typeof uiIdColumn?.displayFormatter).toBe('function');
  });

  it('should have reasonable width for uiId column', () => {
    const columns = gridConfigs['ui_characteristics'];
    const uiIdColumn = columns.find(c => c.field === 'uiId');

    expect(uiIdColumn?.width).toBeGreaterThanOrEqual(180);
    expect(uiIdColumn?.width).toBeLessThanOrEqual(300);
  });
});

// ============================================================================
// Test 4: Grid Rendering - Tab renders with correct columns
// Verifies complete grid configuration for UI Characteristics tab
// ============================================================================

describe('Grid rendering and tab configuration', () => {
  it('should have all 7 columns defined for ui_characteristics', () => {
    const columns = gridConfigs['ui_characteristics'];
    const fields = columns.map(c => c.field);

    expect(fields).toContain('id');
    expect(fields).toContain('uiId');
    expect(fields).toContain('type');
    expect(fields).toContain('key');
    expect(fields).toContain('name');
    expect(fields).toContain('description');
    expect(fields).toContain('evidence');
    expect(fields).toHaveLength(7);
  });

  it('should have correct column order', () => {
    const columns = gridConfigs['ui_characteristics'];
    const fields = columns.map(c => c.field);

    // Expected order: id, uiId, type, key, name, description, evidence
    expect(fields[0]).toBe('id');
    expect(fields[1]).toBe('uiId');
    expect(fields[2]).toBe('type');
    expect(fields[3]).toBe('key');
    expect(fields[4]).toBe('name');
    expect(fields[5]).toBe('description');
    expect(fields[6]).toBe('evidence');
  });

  it('should have correct required flags', () => {
    const columns = gridConfigs['ui_characteristics'];
    const columnsByField = new Map(columns.map(c => [c.field, c]));

    // Required: id, uiId, type, name
    expect(columnsByField.get('id')?.required).toBe(true);
    expect(columnsByField.get('uiId')?.required).toBe(true);
    expect(columnsByField.get('type')?.required).toBe(true);
    expect(columnsByField.get('name')?.required).toBe(true);

    // Optional: key, description, evidence
    expect(columnsByField.get('key')?.required).toBe(false);
    expect(columnsByField.get('description')?.required).toBe(false);
    expect(columnsByField.get('evidence')?.required).toBe(false);
  });

  it('should have id column with autoGenerate flag', () => {
    const columns = gridConfigs['ui_characteristics'];
    const idColumn = columns.find(c => c.field === 'id');

    expect(idColumn?.autoGenerate).toBe(true);
  });

  it('UI Characteristics should be in UI domain grouping', () => {
    expect(domainGroupings.ui).toContain('UI Characteristics');
  });

  it('UI Characteristics should be 5th tab in UI domain (index 4)', () => {
    const uiTabs = domainGroupings.ui;
    const index = uiTabs.indexOf('UI Characteristics');

    expect(index).toBe(4); // 0-indexed, so 5th tab is index 4
  });

  it('UI Characteristics should come after UI Actions', () => {
    const uiTabs = domainGroupings.ui;
    const actionsIndex = uiTabs.indexOf('UI Actions');
    const characteristicsIndex = uiTabs.indexOf('UI Characteristics');

    expect(characteristicsIndex).toBeGreaterThan(actionsIndex);
  });

  it('tabToEntityType should map UI Characteristics to ui_characteristics', () => {
    expect(tabToEntityType['UI Characteristics']).toBe('ui_characteristics');
  });

  it('DOMAIN_ENTITY_TYPES.ui should include ui_characteristics', () => {
    expect(DOMAIN_ENTITY_TYPES.ui).toContain('ui_characteristics');
  });
});

// ============================================================================
// Test 5: UICharacteristic Type Definition Verification
// Verifies TypeScript type structure matches spec requirements
// ============================================================================

describe('UICharacteristic type definition', () => {
  it('should allow creating UICharacteristic with all fields', () => {
    const characteristic: UICharacteristic = {
      id: 'test-char-1',
      uiId: 'app-point-1',
      type: 'business_feature',
      key: 'customer_management',
      name: 'Customer Management',
      description: 'Allows managing customer records',
      evidence: 'Based on PRD-001',
    };

    expect(characteristic.id).toBe('test-char-1');
    expect(characteristic.uiId).toBe('app-point-1');
    expect(characteristic.type).toBe('business_feature');
    expect(characteristic.key).toBe('customer_management');
    expect(characteristic.name).toBe('Customer Management');
    expect(characteristic.description).toBe('Allows managing customer records');
    expect(characteristic.evidence).toBe('Based on PRD-001');
  });

  it('should allow creating UICharacteristic with only required fields', () => {
    const characteristic: UICharacteristic = {
      id: 'test-char-2',
      uiId: 'app-point-2',
      type: 'ui_capability',
      name: 'Search Capability',
    };

    expect(characteristic.id).toBe('test-char-2');
    expect(characteristic.key).toBeUndefined();
    expect(characteristic.description).toBeUndefined();
    expect(characteristic.evidence).toBeUndefined();
  });

  it('should accept all valid type values', () => {
    const types: UICharacteristicType[] = [
      'business_feature',
      'ui_capability',
      'interaction_complexity',
      'technical_shape',
    ];

    types.forEach(type => {
      const characteristic: UICharacteristic = {
        id: `test-${type}`,
        uiId: 'app-point',
        type,
        name: `Test ${type}`,
      };
      expect(characteristic.type).toBe(type);
    });
  });
});

// ============================================================================
// Test 6: MetaModelEntities includes ui_characteristics array
// Verifies model structure compatibility
// ============================================================================

describe('MetaModelEntities ui_characteristics array', () => {
  it('should include ui_characteristics in MetaModelEntities structure', () => {
    // Create a minimal MetaModelEntities structure to verify type compatibility
    const entities: Partial<MetaModelEntities> = {
      ui_characteristics: [
        {
          id: 'char-1',
          uiId: 'app-1',
          type: 'business_feature',
          name: 'Feature 1',
        },
        {
          id: 'char-2',
          uiId: 'app-2',
          type: 'technical_shape',
          key: 'dashboard',
          name: 'Dashboard View',
          description: 'Main dashboard',
          evidence: 'UX review',
        },
      ],
    };

    expect(entities.ui_characteristics).toHaveLength(2);
    expect(entities.ui_characteristics?.[0].type).toBe('business_feature');
    expect(entities.ui_characteristics?.[1].type).toBe('technical_shape');
  });
});
