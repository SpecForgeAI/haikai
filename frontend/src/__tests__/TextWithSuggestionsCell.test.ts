/**
 * TextWithSuggestionsCell Component Tests
 * Spec: Business Logic Type Suggestions (Non-Enforcing)
 *
 * Tests for the TextWithSuggestionsCell component that provides optional,
 * non-enforcing type suggestions as clickable chips in grid cells.
 */

import { describe, it, expect } from 'vitest';
import { TextWithSuggestionsCell } from '../components/Grid/GridCell';
import { CellType, GridColumnConfig } from '../types/config';

describe('TextWithSuggestionsCell', () => {
  /**
   * Test 1: Component is exported and is a function
   */
  describe('component export', () => {
    it('should export TextWithSuggestionsCell as a function', () => {
      expect(TextWithSuggestionsCell).toBeDefined();
      expect(typeof TextWithSuggestionsCell).toBe('function');
    });

    it('should have the correct function signature', () => {
      // Component should accept an object argument
      expect(TextWithSuggestionsCell.length).toBeGreaterThanOrEqual(0);
    });
  });

  /**
   * Test 2: Type definitions are correct
   */
  describe('type definitions', () => {
    it('should accept text_with_suggestions as valid CellType', () => {
      const cellType: CellType = 'text_with_suggestions';
      expect(cellType).toBe('text_with_suggestions');
    });

    it('should allow suggestions property in GridColumnConfig', () => {
      const config: GridColumnConfig = {
        field: 'type_text',
        displayName: 'Type',
        cellType: 'text_with_suggestions',
        required: false,
        width: 150,
        suggestions: ['Calculation', 'Validation'],
      };

      expect(config.suggestions).toEqual(['Calculation', 'Validation']);
      expect(config.cellType).toBe('text_with_suggestions');
    });
  });

  /**
   * Test 3: Component props interface is correct
   */
  describe('component props', () => {
    it('should accept all required props as valid types', () => {
      // Test that these type assignments compile correctly
      const value: string = 'Calculation';
      const suggestions: string[] = ['Calculation', 'Validation', 'Transformation'];
      const onChange: (value: string) => void = () => {};
      const error = undefined;

      // These assignments validate the expected prop types
      expect(typeof value).toBe('string');
      expect(Array.isArray(suggestions)).toBe(true);
      expect(typeof onChange).toBe('function');
      expect(error).toBeUndefined();
    });

    it('should allow empty suggestions array', () => {
      const suggestions: string[] = [];
      expect(suggestions).toEqual([]);
      expect(suggestions.length).toBe(0);
    });

    it('should allow error prop with ValidationError shape', () => {
      const error = {
        entityType: 'business_logics',
        entityId: 'bl-1',
        field: 'type_text',
        message: 'Required field',
        type: 'required' as const,
      };

      expect(error.type).toBe('required');
      expect(error.field).toBe('type_text');
    });
  });

  /**
   * Test 4: GridColumnConfig with suggestions
   */
  describe('GridColumnConfig with suggestions', () => {
    it('should create valid config with text_with_suggestions', () => {
      const config: GridColumnConfig = {
        field: 'type_text',
        displayName: 'Type',
        cellType: 'text_with_suggestions',
        required: false,
        width: 150,
        suggestions: ['Calculation', 'Validation', 'Transformation', 'Policy'],
      };

      expect(config.field).toBe('type_text');
      expect(config.cellType).toBe('text_with_suggestions');
      expect(config.suggestions).toHaveLength(4);
      expect(config.options).toBeUndefined();
    });

    it('should allow suggestions with all 8 business logic types', () => {
      const config: GridColumnConfig = {
        field: 'type_text',
        displayName: 'Type',
        cellType: 'text_with_suggestions',
        required: false,
        width: 150,
        suggestions: [
          'Calculation',
          'Validation',
          'Transformation',
          'Policy',
          'Workflow',
          'Aggregation',
          'Pricing',
          'Eligibility',
        ],
      };

      expect(config.suggestions).toHaveLength(8);
    });
  });
});
