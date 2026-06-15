/**
 * TextWithSuggestionsCell Pretty Labels Tests
 * Spec: 2026-01-20 Fix UI Characteristics Picker Grouping and Key Suggestions
 * Task Group 3: Modify TextWithSuggestionsCell for Pretty Labels
 *
 * Tests that suggestion chips display human-friendly Title Case labels
 * while clicking them inserts the raw snake_case value.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextWithSuggestionsCell, snakeCaseToTitleCase } from '../components/Grid/GridCell';

// Mock CSS module to avoid import errors
vi.mock('../components/Grid/Grid.module.css', () => ({
  default: {
    cellValue: 'cellValue',
    cellError: 'cellError',
    cellInput: 'cellInput',
    textWithSuggestionsContainer: 'textWithSuggestionsContainer',
    suggestionChipsContainer: 'suggestionChipsContainer',
    suggestionChip: 'suggestionChip',
  },
}));

describe('TextWithSuggestionsCell Pretty Labels', () => {
  /**
   * Test 3.1.1: Verify snakeCaseToTitleCase helper works correctly
   */
  describe('snakeCaseToTitleCase helper', () => {
    it('converts multi-word snake_case to Title Case', () => {
      expect(snakeCaseToTitleCase('bulk_action')).toBe('Bulk Action');
    });

    it('converts single-word value to Title Case (capitalize first letter)', () => {
      expect(snakeCaseToTitleCase('search')).toBe('Search');
    });

    it('handles multiple underscores correctly', () => {
      expect(snakeCaseToTitleCase('very_long_snake_case_value')).toBe('Very Long Snake Case Value');
    });

    it('handles already capitalized single word', () => {
      // Edge case: single word with no underscores
      expect(snakeCaseToTitleCase('export')).toBe('Export');
    });
  });

  /**
   * Test 3.1.2: Suggestion chips display snakeCaseToTitleCase(suggestion) as visible text
   */
  describe('chip display labels', () => {
    it('displays "Bulk Action" for "bulk_action" suggestion', () => {
      const onChange = vi.fn();
      render(
        <TextWithSuggestionsCell
          value=""
          suggestions={['bulk_action']}
          onChange={onChange}
        />
      );

      // Double-click to enter edit mode
      const cellValue = screen.getByText('', { selector: '.cellValue' }) || screen.getByRole('textbox').closest('.textWithSuggestionsContainer')?.previousElementSibling;
      const displayDiv = document.querySelector('.cellValue');
      if (displayDiv) {
        fireEvent.doubleClick(displayDiv);
      }

      // Check that the chip shows "Bulk Action" not "bulk_action"
      const chip = screen.getByRole('button', { name: 'Bulk Action' });
      expect(chip).toBeDefined();
      expect(chip.textContent).toBe('Bulk Action');
    });

    it('displays "Search" for "search" suggestion (single word)', () => {
      const onChange = vi.fn();
      render(
        <TextWithSuggestionsCell
          value=""
          suggestions={['search']}
          onChange={onChange}
        />
      );

      // Double-click to enter edit mode
      const displayDiv = document.querySelector('.cellValue');
      if (displayDiv) {
        fireEvent.doubleClick(displayDiv);
      }

      // Check that the chip shows "Search" (capitalized)
      const chip = screen.getByRole('button', { name: 'Search' });
      expect(chip).toBeDefined();
      expect(chip.textContent).toBe('Search');
    });

    it('displays pretty labels for all suggestions in a list', () => {
      const onChange = vi.fn();
      const suggestions = ['bulk_action', 'export', 'simple', 'interaction_complexity'];

      render(
        <TextWithSuggestionsCell
          value=""
          suggestions={suggestions}
          onChange={onChange}
        />
      );

      // Double-click to enter edit mode
      const displayDiv = document.querySelector('.cellValue');
      if (displayDiv) {
        fireEvent.doubleClick(displayDiv);
      }

      // Verify each suggestion is displayed with pretty label
      expect(screen.getByRole('button', { name: 'Bulk Action' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Export' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Simple' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Interaction Complexity' })).toBeDefined();
    });
  });

  /**
   * Test 3.1.3: Clicking a chip sets the input value to the raw snake_case suggestion
   */
  describe('chip click inserts raw value', () => {
    it('inserts "bulk_action" when clicking "Bulk Action" chip', () => {
      const onChange = vi.fn();
      render(
        <TextWithSuggestionsCell
          value=""
          suggestions={['bulk_action']}
          onChange={onChange}
        />
      );

      // Double-click to enter edit mode
      const displayDiv = document.querySelector('.cellValue');
      if (displayDiv) {
        fireEvent.doubleClick(displayDiv);
      }

      // Click the chip (displayed as "Bulk Action")
      const chip = screen.getByRole('button', { name: 'Bulk Action' });
      fireEvent.click(chip);

      // The input should now have the raw value "bulk_action"
      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input.value).toBe('bulk_action');
    });

    it('inserts "search" when clicking "Search" chip (single word)', () => {
      const onChange = vi.fn();
      render(
        <TextWithSuggestionsCell
          value=""
          suggestions={['search']}
          onChange={onChange}
        />
      );

      // Double-click to enter edit mode
      const displayDiv = document.querySelector('.cellValue');
      if (displayDiv) {
        fireEvent.doubleClick(displayDiv);
      }

      // Click the chip
      const chip = screen.getByRole('button', { name: 'Search' });
      fireEvent.click(chip);

      // The input should have the raw value "search"
      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input.value).toBe('search');
    });
  });

  /**
   * Test 3.1.4: Multi-word snake_case values display as Title Case and insert raw value
   */
  describe('multi-word snake_case handling', () => {
    it('"interaction_complexity" displays as "Interaction Complexity" and inserts raw value', () => {
      const onChange = vi.fn();
      render(
        <TextWithSuggestionsCell
          value=""
          suggestions={['interaction_complexity']}
          onChange={onChange}
        />
      );

      // Double-click to enter edit mode
      const displayDiv = document.querySelector('.cellValue');
      if (displayDiv) {
        fireEvent.doubleClick(displayDiv);
      }

      // Verify display label
      const chip = screen.getByRole('button', { name: 'Interaction Complexity' });
      expect(chip.textContent).toBe('Interaction Complexity');

      // Click and verify raw value is inserted
      fireEvent.click(chip);
      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input.value).toBe('interaction_complexity');
    });

    it('"technical_shape" displays as "Technical Shape" and inserts raw value', () => {
      const onChange = vi.fn();
      render(
        <TextWithSuggestionsCell
          value=""
          suggestions={['technical_shape']}
          onChange={onChange}
        />
      );

      // Double-click to enter edit mode
      const displayDiv = document.querySelector('.cellValue');
      if (displayDiv) {
        fireEvent.doubleClick(displayDiv);
      }

      // Verify display label
      const chip = screen.getByRole('button', { name: 'Technical Shape' });
      expect(chip.textContent).toBe('Technical Shape');

      // Click and verify raw value is inserted
      fireEvent.click(chip);
      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input.value).toBe('technical_shape');
    });
  });
});
