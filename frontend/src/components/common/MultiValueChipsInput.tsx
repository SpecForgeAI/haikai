/**
 * MultiValueChipsInput Component
 *
 * Spec 2026-01-31: Create Organisation Modal
 * Task Group 1: MultiValueChipsInput Component
 *
 * Spec 2026-01-31: Fix Create Organisation Standards Flow
 * Task Group 1: MultiValueChipsInput onBlur Commit + Imperative Handle
 *
 * A reusable input component that displays values as chips/bubbles inline
 * with an input field for adding new values.
 *
 * Features:
 * - Values displayed as chips inline before input caret
 * - Add values via: ENTER key, delimiters ("|", ",", ";"), paste, blur
 * - Normalization: trim whitespace, de-duplicate case-insensitively (keep first), preserve original casing
 * - Remove values via: x button click, Backspace when input empty
 * - Ignore empty or whitespace-only tokens
 * - Exposes flush() method via ref for parent components to force-commit pending values
 */

import React, { useState, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import styles from './MultiValueChipsInput.module.css';

/**
 * Props for MultiValueChipsInput component
 */
export interface MultiValueChipsInputProps {
  /** Current array of values to display as chips */
  values: string[];
  /** Callback when values change */
  onChange: (values: string[]) => void;
  /** Placeholder text for the input field */
  placeholder?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Label for the input field */
  label: string;
}

/**
 * Imperative handle interface for MultiValueChipsInput.
 *
 * Spec 2026-01-31: Fix Create Organisation Standards Flow
 * Task Group 1: Allows parent components to flush pending input values.
 */
export interface MultiValueChipsInputHandle {
  /** Commits any pending input value synchronously (calls commitValue) */
  flush: () => void;
}

/** Delimiter characters that trigger value addition */
const DELIMITERS = [',', ';', '|'];

/**
 * Splits a string by delimiter characters and returns trimmed, non-empty tokens.
 */
function splitByDelimiters(text: string): string[] {
  // Split by any delimiter character
  const regex = new RegExp(`[${DELIMITERS.map((d) => (d === '|' ? '\\|' : d)).join('')}]`);
  return text
    .split(regex)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * Checks if a value already exists in the array (case-insensitive).
 */
function isDuplicate(value: string, existingValues: string[]): boolean {
  const lowerValue = value.toLowerCase();
  return existingValues.some((existing) => existing.toLowerCase() === lowerValue);
}

/**
 * Adds new values to the existing array, de-duplicating case-insensitively.
 * Returns new array with unique values (keeps first occurrence with original casing).
 */
function addUniqueValues(existingValues: string[], newValues: string[]): string[] {
  const result = [...existingValues];

  for (const newValue of newValues) {
    if (!isDuplicate(newValue, result)) {
      result.push(newValue);
    }
  }

  return result;
}

/**
 * MultiValueChipsInput Component
 *
 * Renders chips inline before an input field within a styled container.
 *
 * Spec 2026-01-31: Fix Create Organisation Standards Flow
 * Task Group 1: Uses forwardRef pattern to expose flush() imperative handle.
 */
export const MultiValueChipsInput = forwardRef<MultiValueChipsInputHandle, MultiValueChipsInputProps>(
  function MultiValueChipsInput(
    { values, onChange, placeholder = '', disabled = false, label },
    ref
  ) {
    const [inputValue, setInputValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    /**
     * Adds the current input value as a chip (if valid).
     * Clears the input after adding.
     */
    const commitValue = useCallback(() => {
      const trimmed = inputValue.trim();
      if (trimmed.length === 0) {
        return false;
      }

      if (!isDuplicate(trimmed, values)) {
        onChange([...values, trimmed]);
      }

      setInputValue('');
      return true;
    }, [inputValue, values, onChange]);

    /**
     * Spec 2026-01-31: Fix Create Organisation Standards Flow
     * Task Group 1: Expose flush() method via useImperativeHandle.
     * flush() commits any pending input value synchronously.
     */
    useImperativeHandle(
      ref,
      () => ({
        flush: () => {
          commitValue();
        },
      }),
      [commitValue]
    );

    /**
     * Handles input change - checks for delimiter characters.
     */
    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;

        // Check if the last character is a delimiter
        const lastChar = newValue.slice(-1);
        if (DELIMITERS.includes(lastChar)) {
          // Extract value before delimiter and add it
          const valueToAdd = newValue.slice(0, -1).trim();
          if (valueToAdd.length > 0 && !isDuplicate(valueToAdd, values)) {
            onChange([...values, valueToAdd]);
          }
          setInputValue('');
        } else {
          setInputValue(newValue);
        }
      },
      [values, onChange]
    );

    /**
     * Handles key down events for Enter and Backspace.
     */
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitValue();
        } else if (e.key === 'Backspace' && inputValue === '' && values.length > 0) {
          // Remove last chip when backspace is pressed on empty input
          onChange(values.slice(0, -1));
        }
      },
      [inputValue, values, onChange, commitValue]
    );

    /**
     * Handles paste events - splits by delimiters and adds all values.
     */
    const handlePaste = useCallback(
      (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        const pastedText = e.clipboardData.getData('text');
        const tokens = splitByDelimiters(pastedText);

        if (tokens.length > 0) {
          const newValues = addUniqueValues(values, tokens);
          if (newValues.length !== values.length) {
            onChange(newValues);
          }
        }
      },
      [values, onChange]
    );

    /**
     * Removes a chip at the specified index.
     */
    const handleRemoveChip = useCallback(
      (indexToRemove: number) => {
        onChange(values.filter((_, index) => index !== indexToRemove));
      },
      [values, onChange]
    );

    /**
     * Focus the input when clicking anywhere in the container.
     */
    const handleContainerClick = useCallback(() => {
      if (!disabled) {
        inputRef.current?.focus();
      }
    }, [disabled]);

    return (
      <div className={styles.wrapper}>
        {label && <label className={styles.label}>{label}</label>}
        <div
          className={`${styles.container} ${disabled ? styles.disabled : ''}`}
          onClick={handleContainerClick}
          data-testid="chips-container"
        >
          {/* Render existing chips */}
          {values.map((value, index) => (
            <span key={`${value}-${index}`} className={styles.chip}>
              <span className={styles.chipText}>{value}</span>
              <button
                type="button"
                className={styles.chipRemove}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveChip(index);
                }}
                disabled={disabled}
                aria-label={`Remove ${value}`}
              >
                &times;
              </button>
            </span>
          ))}

          {/* Input field */}
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onBlur={commitValue}
            placeholder={values.length === 0 ? placeholder : ''}
            disabled={disabled}
          />
        </div>
      </div>
    );
  }
);

export default MultiValueChipsInput;
