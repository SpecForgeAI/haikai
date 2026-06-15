/**
 * Method Parameters/Returns/Throws Type-Oriented Input Tests
 *
 * Spec: Method Parameters/Returns/Throws Type-Oriented Input
 *
 * Tests cover:
 * - Task Group 1: Grid configuration and column header updates
 * - Task Group 2: FreeTextTypeaheadSingleToken component
 * - Task Group 3: GridCell integration and suggestion derivation
 * - Task Group 4: Legacy JSON compatibility
 */

import { gridConfigs } from '../config/gridConfigs';
import { COMMON_EXCEPTION_SUGGESTIONS } from '../config/commonExceptionSuggestions';
import {
  validateSingleToken,
  extractLegacyParametersJson,
  extractLegacyReturnsThrowsJson,
  isLegacyJsonValue,
  deriveSuggestionsFromModel,
} from '../components/Grid/FreeTextTypeaheadSingleToken';

// ============================================================================
// Task Group 1: Grid Configuration and Column Header Tests
// ============================================================================

describe('Task Group 1: Grid Configuration and Column Headers', () => {
  describe('Methods grid column displayNames', () => {
    const methodsConfig = gridConfigs.methods;

    test('parameters_json column has displayName "Parameters"', () => {
      const parametersColumn = methodsConfig.find(col => col.field === 'parameters_json');
      expect(parametersColumn).toBeDefined();
      expect(parametersColumn?.displayName).toBe('Parameters');
    });

    test('returns_json column has displayName "Returns"', () => {
      const returnsColumn = methodsConfig.find(col => col.field === 'returns_json');
      expect(returnsColumn).toBeDefined();
      expect(returnsColumn?.displayName).toBe('Returns');
    });

    test('throws_json column has displayName "Throws"', () => {
      const throwsColumn = methodsConfig.find(col => col.field === 'throws_json');
      expect(throwsColumn).toBeDefined();
      expect(throwsColumn?.displayName).toBe('Throws');
    });
  });

  describe('Methods grid column field names preserved', () => {
    const methodsConfig = gridConfigs.methods;

    test('field names remain unchanged for backward compatibility', () => {
      const fieldNames = methodsConfig.map(col => col.field);
      expect(fieldNames).toContain('parameters_json');
      expect(fieldNames).toContain('returns_json');
      expect(fieldNames).toContain('throws_json');
    });
  });

  describe('Methods grid column cellTypes', () => {
    const methodsConfig = gridConfigs.methods;

    test('parameters_json cellType is "text" (free-text entry)', () => {
      const parametersColumn = methodsConfig.find(col => col.field === 'parameters_json');
      expect(parametersColumn?.cellType).toBe('text');
    });

    test('returns_json cellType is "free_text_typeahead_single_token"', () => {
      const returnsColumn = methodsConfig.find(col => col.field === 'returns_json');
      expect(returnsColumn?.cellType).toBe('free_text_typeahead_single_token');
    });

    test('throws_json cellType is "free_text_typeahead_single_token"', () => {
      const throwsColumn = methodsConfig.find(col => col.field === 'throws_json');
      expect(throwsColumn?.cellType).toBe('free_text_typeahead_single_token');
    });
  });

  describe('Suggestion source configuration', () => {
    const methodsConfig = gridConfigs.methods;

    test('returns_json has suggestionSources for logical and physical data entities', () => {
      const returnsColumn = methodsConfig.find(col => col.field === 'returns_json');
      expect(returnsColumn?.suggestionSources).toEqual(['logical_data_entities', 'physical_data_entities']);
    });

    test('throws_json has suggestionSources for logical and physical data entities', () => {
      const throwsColumn = methodsConfig.find(col => col.field === 'throws_json');
      expect(throwsColumn?.suggestionSources).toEqual(['logical_data_entities', 'physical_data_entities']);
    });

    test('throws_json has staticSuggestions for common exceptions', () => {
      const throwsColumn = methodsConfig.find(col => col.field === 'throws_json');
      expect(throwsColumn?.staticSuggestions).toBeDefined();
      expect(throwsColumn?.staticSuggestions).toContain('RuntimeException');
      expect(throwsColumn?.staticSuggestions).toContain('IllegalArgumentException');
    });
  });
});

// ============================================================================
// Task Group 2: FreeTextTypeaheadSingleToken Component Tests
// ============================================================================

describe('Task Group 2: FreeTextTypeaheadSingleToken Component', () => {
  describe('Single-token validation', () => {
    test('accepts valid single token "String"', () => {
      const result = validateSingleToken('String');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('accepts valid single token "MyCustomType"', () => {
      const result = validateSingleToken('MyCustomType');
      expect(result.valid).toBe(true);
    });

    test('rejects value containing spaces "String name"', () => {
      const result = validateSingleToken('String name');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('single');
    });

    test('rejects value containing commas "String,Integer"', () => {
      const result = validateSingleToken('String,Integer');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('comma');
    });

    test('rejects empty string', () => {
      const result = validateSingleToken('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    test('rejects whitespace-only string', () => {
      const result = validateSingleToken('   ');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    test('trims whitespace before validation', () => {
      const result = validateSingleToken('  String  ');
      expect(result.valid).toBe(true);
      expect(result.trimmedValue).toBe('String');
    });

    test('rejects value with internal tabs', () => {
      const result = validateSingleToken('String\tvalue');
      expect(result.valid).toBe(false);
    });
  });

  describe('Free-text fallback', () => {
    test('accepts values not in suggestions list', () => {
      const result = validateSingleToken('CustomException');
      expect(result.valid).toBe(true);
    });

    test('accepts any valid single-token type name', () => {
      const testValues = [
        'int',
        'boolean',
        'void',
        'List',
        'Map',
        'CustomReturnType',
        'com.example.MyClass',
      ];
      testValues.forEach(value => {
        const result = validateSingleToken(value);
        expect(result.valid).toBe(true);
      });
    });
  });
});

// ============================================================================
// Task Group 3: GridCell Integration and Suggestion Derivation Tests
// ============================================================================

describe('Task Group 3: Suggestion Derivation', () => {
  const mockModel = {
    metaModel: {
      entities: {
        logical_data_entities: [
          { id: 'lde_001', name: 'Customer', description: '', tags: '' },
          { id: 'lde_002', name: 'Order', description: '', tags: '' },
          { id: 'lde_003', name: 'Product', description: '', tags: '' },
        ],
        physical_data_entities: [
          { id: 'pde_001', name: 'CustomerTable', description: '', physical_type: '', database: '', tags: '' },
          { id: 'pde_002', name: 'OrderRecord', description: '', physical_type: '', database: '', tags: '' },
        ],
      },
    },
  } as never;

  describe('Suggestion derivation from model entities', () => {
    test('extracts names from logical_data_entities', () => {
      const suggestions = deriveSuggestionsFromModel(
        mockModel,
        ['logical_data_entities'],
        []
      );
      expect(suggestions).toContain('Customer');
      expect(suggestions).toContain('Order');
      expect(suggestions).toContain('Product');
    });

    test('extracts names from physical_data_entities', () => {
      const suggestions = deriveSuggestionsFromModel(
        mockModel,
        ['physical_data_entities'],
        []
      );
      expect(suggestions).toContain('CustomerTable');
      expect(suggestions).toContain('OrderRecord');
    });

    test('combines suggestions from multiple entity types', () => {
      const suggestions = deriveSuggestionsFromModel(
        mockModel,
        ['logical_data_entities', 'physical_data_entities'],
        []
      );
      expect(suggestions).toContain('Customer');
      expect(suggestions).toContain('CustomerTable');
    });

    test('combines entity names with static suggestions', () => {
      const staticSuggestions = ['RuntimeException', 'IllegalArgumentException'];
      const suggestions = deriveSuggestionsFromModel(
        mockModel,
        ['logical_data_entities'],
        staticSuggestions
      );
      expect(suggestions).toContain('Customer');
      expect(suggestions).toContain('RuntimeException');
      expect(suggestions).toContain('IllegalArgumentException');
    });

    test('deduplicates suggestions', () => {
      const staticSuggestions = ['Customer', 'RuntimeException'];
      const suggestions = deriveSuggestionsFromModel(
        mockModel,
        ['logical_data_entities'],
        staticSuggestions
      );
      // Customer appears in both logical_data_entities and staticSuggestions
      const customerCount = suggestions.filter(s => s === 'Customer').length;
      expect(customerCount).toBe(1);
    });

    test('sorts suggestions alphabetically', () => {
      const suggestions = deriveSuggestionsFromModel(
        mockModel,
        ['logical_data_entities'],
        []
      );
      const sortedSuggestions = [...suggestions].sort();
      expect(suggestions).toEqual(sortedSuggestions);
    });
  });

  describe('Common exception suggestions', () => {
    test('COMMON_EXCEPTION_SUGGESTIONS contains expected exceptions', () => {
      expect(COMMON_EXCEPTION_SUGGESTIONS).toContain('RuntimeException');
      expect(COMMON_EXCEPTION_SUGGESTIONS).toContain('IllegalArgumentException');
      expect(COMMON_EXCEPTION_SUGGESTIONS).toContain('IllegalStateException');
      expect(COMMON_EXCEPTION_SUGGESTIONS).toContain('NullPointerException');
      expect(COMMON_EXCEPTION_SUGGESTIONS).toContain('Exception');
    });
  });
});

// ============================================================================
// Task Group 4: Legacy JSON Compatibility Tests
// ============================================================================

describe('Task Group 4: Legacy JSON Compatibility', () => {
  describe('Legacy JSON value detection', () => {
    test('detects JSON object starting with "{"', () => {
      expect(isLegacyJsonValue('{"type":"String"}')).toBe(true);
    });

    test('detects JSON array starting with "["', () => {
      expect(isLegacyJsonValue('[{"type":"String","name":"value"}]')).toBe(true);
    });

    test('does not flag plain string values', () => {
      expect(isLegacyJsonValue('String')).toBe(false);
    });

    test('does not flag empty string', () => {
      expect(isLegacyJsonValue('')).toBe(false);
    });

    test('does not flag null/undefined', () => {
      expect(isLegacyJsonValue(null as unknown as string)).toBe(false);
      expect(isLegacyJsonValue(undefined as unknown as string)).toBe(false);
    });
  });

  describe('Legacy parameters JSON extraction', () => {
    test('extracts type-name pairs from JSON array', () => {
      const legacyJson = '[{"type":"String","name":"name"},{"type":"int","name":"count"}]';
      const result = extractLegacyParametersJson(legacyJson);
      expect(result).toBe('String name, int count');
    });

    test('handles single parameter', () => {
      const legacyJson = '[{"type":"MyObject","name":"obj"}]';
      const result = extractLegacyParametersJson(legacyJson);
      expect(result).toBe('MyObject obj');
    });

    test('handles empty array', () => {
      const legacyJson = '[]';
      const result = extractLegacyParametersJson(legacyJson);
      expect(result).toBe('');
    });

    test('returns raw string on parse failure', () => {
      const invalidJson = '{"invalid": json';
      const result = extractLegacyParametersJson(invalidJson);
      expect(result).toBe(invalidJson);
    });

    test('returns raw string for non-array JSON', () => {
      const jsonObject = '{"type":"String"}';
      const result = extractLegacyParametersJson(jsonObject);
      expect(result).toBe(jsonObject);
    });
  });

  describe('Legacy returns/throws JSON extraction', () => {
    test('extracts "type" field from JSON object', () => {
      const legacyJson = '{"type":"String"}';
      const result = extractLegacyReturnsThrowsJson(legacyJson);
      expect(result).toBe('String');
    });

    test('extracts "name" field if "type" not present', () => {
      const legacyJson = '{"name":"Customer"}';
      const result = extractLegacyReturnsThrowsJson(legacyJson);
      expect(result).toBe('Customer');
    });

    test('prefers "type" over "name" when both present', () => {
      const legacyJson = '{"type":"ReturnType","name":"someName"}';
      const result = extractLegacyReturnsThrowsJson(legacyJson);
      expect(result).toBe('ReturnType');
    });

    test('returns raw string on parse failure', () => {
      const invalidJson = '{"invalid": json';
      const result = extractLegacyReturnsThrowsJson(invalidJson);
      expect(result).toBe(invalidJson);
    });

    test('returns raw string for array JSON', () => {
      const jsonArray = '[{"type":"String"}]';
      const result = extractLegacyReturnsThrowsJson(jsonArray);
      expect(result).toBe(jsonArray);
    });
  });

  describe('Display rendering of legacy values', () => {
    test('legacy JSON strings do not crash on detection', () => {
      const testCases = [
        '{"type":"String"}',
        '[{"type":"String","name":"value"}]',
        '{"invalid}',
        '',
        'PlainString',
      ];
      testCases.forEach(testCase => {
        expect(() => isLegacyJsonValue(testCase)).not.toThrow();
      });
    });

    test('extraction functions handle malformed JSON gracefully', () => {
      const malformedCases = [
        '{type: String}',
        '[{type: String}]',
        'not json at all',
        '{{nested}}',
      ];
      malformedCases.forEach(testCase => {
        expect(() => extractLegacyParametersJson(testCase)).not.toThrow();
        expect(() => extractLegacyReturnsThrowsJson(testCase)).not.toThrow();
      });
    });
  });
});
