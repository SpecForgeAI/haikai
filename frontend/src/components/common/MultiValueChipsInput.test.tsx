/**
 * Tests for MultiValueChipsInput Component - Flush/Blur Behavior
 *
 * Spec 2026-01-31: Fix Create Organisation Standards Flow
 * Task Group 1: MultiValueChipsInput onBlur Commit + Imperative Handle
 */

import React, { createRef } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MultiValueChipsInput, MultiValueChipsInputHandle } from './MultiValueChipsInput';

describe('MultiValueChipsInput - Flush/Blur Behavior', () => {
  describe('onBlur commits pending value', () => {
    it('onBlur commits pending input value to chips array', () => {
      const onChange = vi.fn();
      render(
        <MultiValueChipsInput
          values={[]}
          onChange={onChange}
          label="Test Input"
          placeholder="Type value..."
        />
      );

      const input = screen.getByRole('textbox');

      // Type a value
      fireEvent.change(input, { target: { value: 'new value' } });

      // Blur the input
      fireEvent.blur(input);

      // Should have called onChange with the new value
      expect(onChange).toHaveBeenCalledWith(['new value']);
    });

    it('onBlur with empty input does not add empty chip', () => {
      const onChange = vi.fn();
      render(
        <MultiValueChipsInput
          values={['existing']}
          onChange={onChange}
          label="Test Input"
        />
      );

      const input = screen.getByRole('textbox');

      // Type whitespace only
      fireEvent.change(input, { target: { value: '   ' } });

      // Blur the input
      fireEvent.blur(input);

      // Should NOT have called onChange (empty/whitespace value)
      expect(onChange).not.toHaveBeenCalled();
    });

    it('onBlur trims whitespace from value', () => {
      const onChange = vi.fn();
      render(
        <MultiValueChipsInput
          values={[]}
          onChange={onChange}
          label="Test Input"
        />
      );

      const input = screen.getByRole('textbox');

      // Type a value with whitespace
      fireEvent.change(input, { target: { value: '  trimmed value  ' } });

      // Blur the input
      fireEvent.blur(input);

      // Should have called onChange with trimmed value
      expect(onChange).toHaveBeenCalledWith(['trimmed value']);
    });
  });

  describe('flush() via imperative handle', () => {
    it('flush() via ref commits pending value synchronously', () => {
      const onChange = vi.fn();
      const ref = createRef<MultiValueChipsInputHandle>();

      render(
        <MultiValueChipsInput
          ref={ref}
          values={['existing']}
          onChange={onChange}
          label="Test Input"
        />
      );

      const input = screen.getByRole('textbox');

      // Type a value
      fireEvent.change(input, { target: { value: 'flushed value' } });

      // Call flush via ref wrapped in act()
      act(() => {
        ref.current?.flush();
      });

      // Should have called onChange with new value added
      expect(onChange).toHaveBeenCalledWith(['existing', 'flushed value']);
    });

    it('flush() with duplicate value (case-insensitive) does not add', () => {
      const onChange = vi.fn();
      const ref = createRef<MultiValueChipsInputHandle>();

      render(
        <MultiValueChipsInput
          ref={ref}
          values={['Existing Value']}
          onChange={onChange}
          label="Test Input"
        />
      );

      const input = screen.getByRole('textbox');

      // Type a duplicate (different case)
      fireEvent.change(input, { target: { value: 'EXISTING VALUE' } });

      // Call flush via ref wrapped in act()
      act(() => {
        ref.current?.flush();
      });

      // Should NOT have called onChange (duplicate)
      expect(onChange).not.toHaveBeenCalled();
    });

    it('flush() with empty input does nothing', () => {
      const onChange = vi.fn();
      const ref = createRef<MultiValueChipsInputHandle>();

      render(
        <MultiValueChipsInput
          ref={ref}
          values={['existing']}
          onChange={onChange}
          label="Test Input"
        />
      );

      // No input typed - input is empty

      // Call flush via ref wrapped in act()
      act(() => {
        ref.current?.flush();
      });

      // Should NOT have called onChange (nothing to commit)
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('forwardRef wrapper - no regression', () => {
    it('component still works with forwardRef wrapper (Enter key)', () => {
      const onChange = vi.fn();
      const ref = createRef<MultiValueChipsInputHandle>();

      render(
        <MultiValueChipsInput
          ref={ref}
          values={[]}
          onChange={onChange}
          label="Test Input"
        />
      );

      const input = screen.getByRole('textbox');

      // Type and press Enter (existing behavior)
      fireEvent.change(input, { target: { value: 'enter value' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      // Should have called onChange
      expect(onChange).toHaveBeenCalledWith(['enter value']);
    });

    it('component still works with forwardRef wrapper (delimiter)', () => {
      const onChange = vi.fn();
      const ref = createRef<MultiValueChipsInputHandle>();

      render(
        <MultiValueChipsInput
          ref={ref}
          values={[]}
          onChange={onChange}
          label="Test Input"
        />
      );

      const input = screen.getByRole('textbox');

      // Type with delimiter (existing behavior)
      fireEvent.change(input, { target: { value: 'delimiter value,' } });

      // Should have called onChange
      expect(onChange).toHaveBeenCalledWith(['delimiter value']);
    });
  });
});
