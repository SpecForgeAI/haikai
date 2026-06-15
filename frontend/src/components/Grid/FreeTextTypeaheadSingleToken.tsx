/**
 * FreeTextTypeaheadSingleToken Component
 * Spec: Method Parameters/Returns/Throws Type-Oriented Input
 *
 * A text input cell that shows typeahead suggestions while typing,
 * allows free-text entry of values not in the suggestion list,
 * and enforces single-token validation (no spaces, no commas).
 *
 * Used for Returns and Throws fields in the Methods grid.
 */

import { useState, useRef, useEffect } from 'react';
import { ArchitectureModel } from '../../types/model';
import { ValidationError } from '../../types/config';
import styles from './Grid.module.css';

// ============================================================================
// Validation Types and Functions
// ============================================================================

export interface SingleTokenValidationResult {
  valid: boolean;
  error?: string;
  trimmedValue?: string;
}

/**
 * Validates that a value is a single token (no whitespace, no commas, not empty).
 * @param value - The value to validate
 * @returns Validation result with valid flag, optional error message, and trimmed value
 */
export function validateSingleToken(value: string): SingleTokenValidationResult {
  // Trim whitespace
  const trimmedValue = (value || '').trim();

  // Reject empty strings
  if (trimmedValue === '') {
    return { valid: false, error: 'Value cannot be empty' };
  }

  // Reject values containing commas
  if (trimmedValue.includes(',')) {
    return { valid: false, error: 'Value cannot contain comma characters' };
  }

  // Reject values containing whitespace (spaces, tabs, newlines)
  if (/\s/.test(trimmedValue)) {
    return { valid: false, error: 'Value must be a single token (no spaces allowed)' };
  }

  return { valid: true, trimmedValue };
}

// ============================================================================
// Legacy JSON Compatibility Functions
// ============================================================================

/**
 * Detects if a stored value is legacy JSON (starts with { or [).
 * @param value - The value to check
 * @returns true if the value appears to be JSON
 */
export function isLegacyJsonValue(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/**
 * Best-effort extraction of parameters from legacy JSON array format.
 * Converts [{"type":"String","name":"name"}] to "String name, ..."
 * @param value - The JSON string to parse
 * @returns Extracted parameter string or original value on failure
 */
export function extractLegacyParametersJson(value: string): string {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return value; // Not an array, return raw string
    }
    const params = parsed
      .filter((p: unknown) => typeof p === 'object' && p !== null)
      .map((p: { type?: string; name?: string }) => {
        const type = p.type || '';
        const name = p.name || '';
        return type && name ? `${type} ${name}` : (type || name);
      })
      .filter((s: string) => s);
    return params.join(', ');
  } catch {
    return value; // Parse failure, return raw string
  }
}

/**
 * Best-effort extraction of type from legacy JSON object format.
 * Extracts "type" or "name" field from {"type":"String"}.
 * @param value - The JSON string to parse
 * @returns Extracted type string or original value on failure
 */
export function extractLegacyReturnsThrowsJson(value: string): string {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) || typeof parsed !== 'object' || parsed === null) {
      return value; // Not an object, return raw string
    }
    const obj = parsed as { type?: string; name?: string };
    return obj.type || obj.name || value;
  } catch {
    return value; // Parse failure, return raw string
  }
}

// ============================================================================
// Suggestion Derivation
// ============================================================================

/**
 * Derives suggestions from model entities based on suggestionSources configuration.
 * Extracts 'name' field from specified entity types and combines with static suggestions.
 * @param model - The architecture model
 * @param suggestionSources - Array of entity type keys to extract names from
 * @param staticSuggestions - Array of static suggestion strings
 * @returns Deduplicated, sorted array of suggestions
 */
export function deriveSuggestionsFromModel(
  model: ArchitectureModel,
  suggestionSources: string[],
  staticSuggestions: string[]
): string[] {
  const suggestions: Set<string> = new Set(staticSuggestions || []);

  // Extract names from each entity type in suggestionSources
  for (const source of suggestionSources || []) {
    const entities = model?.metaModel?.entities?.[source as keyof typeof model.metaModel.entities];
    if (Array.isArray(entities)) {
      for (const entity of entities) {
        const name = (entity as { name?: string }).name;
        if (name) {
          suggestions.add(name);
        }
      }
    }
  }

  // Convert to array, sort alphabetically
  return Array.from(suggestions).sort();
}

// ============================================================================
// Component Props and Implementation
// ============================================================================

interface FreeTextTypeaheadSingleTokenProps {
  value: string;
  suggestions: string[];
  onChange: (value: string) => void;
  error?: ValidationError;
  /**
   * Spec: Standardize Relationship Dropdown Display Labels
   * Callback to dispatch label cache update (optional).
   */
  onLabelUpdate?: (relationshipKey: string, rowId: string, columnKey: string, label: string) => void;
}

/**
 * Calculate dropdown position based on cell position relative to container.
 * Reuses pattern from TypeaheadCell.
 */
function getDropdownPosition(
  cellRect: DOMRect,
  containerRect: DOMRect
): 'below' | 'above' {
  const containerMidY = containerRect.top + (containerRect.height / 2);
  const cellCenterY = cellRect.top + (cellRect.height / 2);
  return cellCenterY < containerMidY ? 'below' : 'above';
}

export function FreeTextTypeaheadSingleToken({
  value,
  suggestions,
  onChange,
  error,
}: FreeTextTypeaheadSingleTokenProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<'below' | 'above'>('below');
  const [validationError, setValidationError] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter suggestions based on input text (case-insensitive)
  const filteredSuggestions = suggestions.filter((s) =>
    s.toLowerCase().includes(editValue.toLowerCase())
  ).slice(0, 10);

  // Get display value - handle legacy JSON for display mode
  const getDisplayValue = (): string => {
    if (!value) return '';
    // For display, show the raw value (even if JSON-like)
    // The best-effort conversion happens when entering edit mode
    return value;
  };

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();

      // Calculate dropdown position based on cell position
      if (containerRef.current) {
        const cellRect = containerRef.current.getBoundingClientRect();
        const gridContainer = containerRef.current.closest('[class*="gridContainer"]');
        if (gridContainer) {
          const containerRect = gridContainer.getBoundingClientRect();
          const position = getDropdownPosition(cellRect, containerRect);
          setDropdownPosition(position);
        }
      }
    }
  }, [isEditing]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        handleCommit();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editValue]);

  const handleDoubleClick = () => {
    // Best-effort auto-convert legacy JSON on edit
    let initialValue = value || '';
    if (isLegacyJsonValue(initialValue)) {
      // For returns/throws, try to extract type from JSON object
      initialValue = extractLegacyReturnsThrowsJson(initialValue);
    }
    setEditValue(initialValue);
    setValidationError(undefined);
    setIsEditing(true);
    setShowDropdown(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setEditValue(newValue);
    setShowDropdown(true);
    // Clear validation error while typing
    setValidationError(undefined);
  };

  const handleCommit = () => {
    // Validate the value
    const validation = validateSingleToken(editValue);
    if (!validation.valid) {
      setValidationError(validation.error);
      // Keep editing mode active to allow correction
      return;
    }

    // Commit the validated, trimmed value
    onChange(validation.trimmedValue || '');
    setIsEditing(false);
    setShowDropdown(false);
    setValidationError(undefined);
  };

  const handleSelect = (suggestion: string) => {
    // Suggestions are pre-validated as single tokens
    onChange(suggestion);
    setIsEditing(false);
    setShowDropdown(false);
    setValidationError(undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Revert to original value
      setEditValue(value || '');
      setIsEditing(false);
      setShowDropdown(false);
      setValidationError(undefined);
    } else if (e.key === 'Enter') {
      if (filteredSuggestions.length > 0 && editValue) {
        // If there's a matching suggestion and it matches exactly, select it
        const exactMatch = filteredSuggestions.find(
          (s) => s.toLowerCase() === editValue.toLowerCase()
        );
        if (exactMatch) {
          handleSelect(exactMatch);
          return;
        }
      }
      // Otherwise, try to commit the free-text value
      handleCommit();
    } else if (e.key === 'Tab') {
      handleCommit();
    }
  };

  if (isEditing) {
    const dropdownClass = dropdownPosition === 'above'
      ? `${styles.typeaheadDropdown} ${styles.typeaheadDropdownAbove}`
      : `${styles.typeaheadDropdown} ${styles.typeaheadDropdownBelow}`;

    const hasError = validationError !== undefined;

    return (
      <div ref={containerRef} className={styles.typeaheadContainer}>
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Type or select..."
          className={`${styles.cellInput} ${hasError ? styles.cellError : ''}`}
          title={validationError}
        />
        {showDropdown && filteredSuggestions.length > 0 && (
          <div className={dropdownClass}>
            {filteredSuggestions.map((s) => (
              <div
                key={s}
                className={styles.typeaheadOption}
                onClick={() => handleSelect(s)}
              >
                {s}
              </div>
            ))}
          </div>
        )}
        {hasError && (
          <div className={styles.inlineError}>
            {validationError}
          </div>
        )}
      </div>
    );
  }

  const displayValue = getDisplayValue();

  return (
    <div
      className={`${styles.cellValue} ${error ? styles.cellError : ''}`}
      onDoubleClick={handleDoubleClick}
      title={error?.message || displayValue}
    >
      {displayValue}
    </div>
  );
}
