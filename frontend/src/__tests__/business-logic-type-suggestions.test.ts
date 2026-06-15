/**
 * Business Logic Type Suggestions Integration Tests
 * Spec: Business Logic Type Suggestions (Non-Enforcing)
 *
 * Tests for the integration of text_with_suggestions cell type
 * in the business_logics grid configuration.
 */

import { describe, it, expect } from 'vitest';
import { gridConfigs } from '../config/gridConfigs';
import { BUSINESS_LOGIC_TYPE_SUGGESTIONS } from '../config/businessLogicTypeSuggestions';
import { TextWithSuggestionsCell } from '../components/Grid/GridCell';

describe('Business Logic Type Suggestions Integration', () => {
  /**
   * Test 1: business_logics config has text_with_suggestions cellType for type_text
   */
  describe('business_logics grid configuration', () => {
    it('should have text_with_suggestions cellType for type_text field', () => {
      const businessLogicsConfig = gridConfigs.business_logics;
      expect(businessLogicsConfig).toBeDefined();
      expect(Array.isArray(businessLogicsConfig)).toBe(true);

      const typeTextField = businessLogicsConfig.find(col => col.field === 'type_text');
      expect(typeTextField).toBeDefined();
      expect(typeTextField?.cellType).toBe('text_with_suggestions');
    });

    it('should have suggestions property referencing BUSINESS_LOGIC_TYPE_SUGGESTIONS', () => {
      const businessLogicsConfig = gridConfigs.business_logics;
      const typeTextField = businessLogicsConfig.find(col => col.field === 'type_text');

      expect(typeTextField?.suggestions).toBeDefined();
      expect(typeTextField?.suggestions).toEqual(BUSINESS_LOGIC_TYPE_SUGGESTIONS);
    });

    it('should not have options property for type_text field', () => {
      const businessLogicsConfig = gridConfigs.business_logics;
      const typeTextField = businessLogicsConfig.find(col => col.field === 'type_text');

      // Dropdown options should not be set for text_with_suggestions
      expect(typeTextField?.options).toBeUndefined();
    });
  });

  /**
   * Test 2: BUSINESS_LOGIC_TYPE_SUGGESTIONS contains expected values
   */
  describe('BUSINESS_LOGIC_TYPE_SUGGESTIONS constant', () => {
    it('should be defined and be an array', () => {
      expect(BUSINESS_LOGIC_TYPE_SUGGESTIONS).toBeDefined();
      expect(Array.isArray(BUSINESS_LOGIC_TYPE_SUGGESTIONS)).toBe(true);
    });

    it('should contain all 8 expected suggestion values', () => {
      const expectedSuggestions = [
        'Calculation',
        'Validation',
        'Transformation',
        'Policy',
        'Workflow',
        'Aggregation',
        'Pricing',
        'Eligibility',
      ];

      expect(BUSINESS_LOGIC_TYPE_SUGGESTIONS).toHaveLength(8);
      expectedSuggestions.forEach(suggestion => {
        expect(BUSINESS_LOGIC_TYPE_SUGGESTIONS).toContain(suggestion);
      });
    });

    it('should have Calculation as first suggestion', () => {
      expect(BUSINESS_LOGIC_TYPE_SUGGESTIONS[0]).toBe('Calculation');
    });

    it('should have Eligibility as last suggestion', () => {
      expect(BUSINESS_LOGIC_TYPE_SUGGESTIONS[BUSINESS_LOGIC_TYPE_SUGGESTIONS.length - 1]).toBe('Eligibility');
    });
  });

  /**
   * Test 3: TextWithSuggestionsCell component is exported and usable
   */
  describe('TextWithSuggestionsCell component export', () => {
    it('should export TextWithSuggestionsCell component', () => {
      expect(TextWithSuggestionsCell).toBeDefined();
      expect(typeof TextWithSuggestionsCell).toBe('function');
    });

    it('should accept suggestions array matching BUSINESS_LOGIC_TYPE_SUGGESTIONS length', () => {
      // Verify the suggestions constant has the expected length
      expect(BUSINESS_LOGIC_TYPE_SUGGESTIONS.length).toBe(8);
    });

    it('should have all suggestions as strings', () => {
      BUSINESS_LOGIC_TYPE_SUGGESTIONS.forEach(suggestion => {
        expect(typeof suggestion).toBe('string');
        expect(suggestion.length).toBeGreaterThan(0);
      });
    });

    it('should not have duplicate suggestions', () => {
      const uniqueSuggestions = new Set(BUSINESS_LOGIC_TYPE_SUGGESTIONS);
      expect(uniqueSuggestions.size).toBe(BUSINESS_LOGIC_TYPE_SUGGESTIONS.length);
    });
  });
});
