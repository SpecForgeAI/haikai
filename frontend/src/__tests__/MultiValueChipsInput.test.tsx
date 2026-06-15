/**
 * Tests for MultiValueChipsInput Component
 *
 * Spec 2026-01-31: Create Organisation Modal
 * Task Group 1: MultiValueChipsInput Component
 *
 * Tests:
 * - Chip addition via Enter key press
 * - Chip addition via delimiter input (comma, semicolon, pipe)
 * - Chip removal via x button click
 * - Chip removal via Backspace when input empty
 * - De-duplication (case-insensitive, keep first occurrence)
 * - Paste handling with multiple values
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MultiValueChipsInput } from '../components/common/MultiValueChipsInput';

describe('MultiValueChipsInput', () => {
  /**
   * Helper to get the input element within the chips container.
   * The input won't have a placeholder when there are existing values.
   */
  function getInput(): HTMLInputElement {
    const container = screen.getByTestId('chips-container');
    const input = container.querySelector('input');
    if (!input) {
      throw new Error('Could not find input element in chips container');
    }
    return input;
  }

  describe('Chip Addition', () => {
    it('adds chip via Enter key press', async () => {
      const onChange = vi.fn();
      render(
        <MultiValueChipsInput
          values={[]}
          onChange={onChange}
          placeholder="Enter values..."
          label="Test"
        />
      );

      const input = screen.getByPlaceholderText('Enter values...');
      await userEvent.type(input, 'test-value');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onChange).toHaveBeenCalledWith(['test-value']);
    });

    it('adds chip via comma delimiter', async () => {
      const onChange = vi.fn();
      render(
        <MultiValueChipsInput
          values={[]}
          onChange={onChange}
          placeholder="Enter values..."
          label="Test"
        />
      );

      const input = screen.getByPlaceholderText('Enter values...');
      await userEvent.type(input, 'value1,');

      expect(onChange).toHaveBeenCalledWith(['value1']);
    });

    it('adds chip via semicolon delimiter', async () => {
      const onChange = vi.fn();
      render(
        <MultiValueChipsInput
          values={[]}
          onChange={onChange}
          placeholder="Enter values..."
          label="Test"
        />
      );

      const input = screen.getByPlaceholderText('Enter values...');
      await userEvent.type(input, 'value1;');

      expect(onChange).toHaveBeenCalledWith(['value1']);
    });

    it('adds chip via pipe delimiter', async () => {
      const onChange = vi.fn();
      render(
        <MultiValueChipsInput
          values={[]}
          onChange={onChange}
          placeholder="Enter values..."
          label="Test"
        />
      );

      const input = screen.getByPlaceholderText('Enter values...');
      await userEvent.type(input, 'value1|');

      expect(onChange).toHaveBeenCalledWith(['value1']);
    });
  });

  describe('Chip Removal', () => {
    it('removes chip via x button click', async () => {
      const onChange = vi.fn();
      render(
        <MultiValueChipsInput
          values={['chip1', 'chip2', 'chip3']}
          onChange={onChange}
          placeholder="Enter values..."
          label="Test"
        />
      );

      // Find and click the remove button for chip2
      const removeButtons = screen.getAllByRole('button', { name: /remove/i });
      await userEvent.click(removeButtons[1]); // Click second remove button

      expect(onChange).toHaveBeenCalledWith(['chip1', 'chip3']);
    });

    it('removes last chip via Backspace when input is empty', async () => {
      const onChange = vi.fn();
      render(
        <MultiValueChipsInput
          values={['chip1', 'chip2']}
          onChange={onChange}
          placeholder="Enter values..."
          label="Test"
        />
      );

      // Use helper to get input when there are existing values
      const input = getInput();
      // Ensure input is empty
      expect(input).toHaveValue('');

      // Press backspace
      fireEvent.keyDown(input, { key: 'Backspace' });

      expect(onChange).toHaveBeenCalledWith(['chip1']);
    });
  });

  describe('De-duplication', () => {
    it('de-duplicates case-insensitively while keeping first occurrence with original casing', async () => {
      const onChange = vi.fn();
      render(
        <MultiValueChipsInput
          values={['FirstValue']}
          onChange={onChange}
          placeholder="Enter values..."
          label="Test"
        />
      );

      // Use helper to get input when there are existing values
      const input = getInput();
      await userEvent.type(input, 'FIRSTVALUE');
      fireEvent.keyDown(input, { key: 'Enter' });

      // Should not add duplicate - onChange should NOT be called with the new value
      // The component should keep the first occurrence with original casing
      expect(onChange).not.toHaveBeenCalled();
    });

    it('preserves original casing of first occurrence', async () => {
      const onChange = vi.fn();
      render(
        <MultiValueChipsInput
          values={[]}
          onChange={onChange}
          placeholder="Enter values..."
          label="Test"
        />
      );

      const input = screen.getByPlaceholderText('Enter values...');
      await userEvent.type(input, 'MyValue');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onChange).toHaveBeenCalledWith(['MyValue']);
    });
  });

  describe('Paste Handling', () => {
    it('handles paste with multiple values separated by delimiters', async () => {
      const onChange = vi.fn();
      render(
        <MultiValueChipsInput
          values={[]}
          onChange={onChange}
          placeholder="Enter values..."
          label="Test"
        />
      );

      const input = screen.getByPlaceholderText('Enter values...');

      // Simulate paste event
      const pasteData = 'value1,value2;value3|value4';
      fireEvent.paste(input, {
        clipboardData: {
          getData: () => pasteData,
        },
      });

      expect(onChange).toHaveBeenCalledWith(['value1', 'value2', 'value3', 'value4']);
    });

    it('trims whitespace and ignores empty tokens on paste', async () => {
      const onChange = vi.fn();
      render(
        <MultiValueChipsInput
          values={[]}
          onChange={onChange}
          placeholder="Enter values..."
          label="Test"
        />
      );

      const input = screen.getByPlaceholderText('Enter values...');

      // Simulate paste with whitespace and empty tokens
      const pasteData = '  value1  ,  , value2 ;  ;value3  ';
      fireEvent.paste(input, {
        clipboardData: {
          getData: () => pasteData,
        },
      });

      expect(onChange).toHaveBeenCalledWith(['value1', 'value2', 'value3']);
    });
  });

  describe('Disabled State', () => {
    it('does not allow input when disabled', () => {
      const onChange = vi.fn();
      render(
        <MultiValueChipsInput
          values={['existing']}
          onChange={onChange}
          placeholder="Enter values..."
          label="Test"
          disabled={true}
        />
      );

      // Use helper to get input when there are existing values
      const input = getInput();
      expect(input).toBeDisabled();
    });
  });

  describe('Empty and Whitespace Handling', () => {
    it('ignores empty input on Enter', async () => {
      const onChange = vi.fn();
      render(
        <MultiValueChipsInput
          values={[]}
          onChange={onChange}
          placeholder="Enter values..."
          label="Test"
        />
      );

      const input = screen.getByPlaceholderText('Enter values...');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onChange).not.toHaveBeenCalled();
    });

    it('ignores whitespace-only input on Enter', async () => {
      const onChange = vi.fn();
      render(
        <MultiValueChipsInput
          values={[]}
          onChange={onChange}
          placeholder="Enter values..."
          label="Test"
        />
      );

      const input = screen.getByPlaceholderText('Enter values...');
      await userEvent.type(input, '   ');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
