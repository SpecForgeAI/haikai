/**
 * DiagramAutocomplete Component
 *
 * Grouped autocomplete selector that replaces the flat <select> dropdown
 * for diagram selection. Follows the typeahead pattern from
 * ApplicationPointPickerCell (lines 207-509).
 *
 * Diagrams are grouped by DiagramType (7 categories) with group headers
 * rendered using DIAGRAM_TYPE_LABELS for human-readable display.
 *
 * Spec: Diagrams Toolbar UX Refresh
 * Task Group 2: DiagramAutocomplete Component
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Diagram } from '../../types/model';
import {
  DiagramType,
  ALL_DIAGRAM_TYPES,
  DIAGRAM_TYPE_LABELS,
  getDiagramType,
} from '../../types/diagramType';
import styles from './DiagramAutocomplete.module.css';

// ============================================================================
// Props
// ============================================================================

interface DiagramAutocompleteProps {
  diagrams: Diagram[];
  selectedDiagramId: string | null;
  onSelect: (diagramId: string) => void;
}

// ============================================================================
// Component
// ============================================================================

export function DiagramAutocomplete({
  diagrams,
  selectedDiagramId,
  onSelect,
}: DiagramAutocompleteProps) {
  // --------------------------------------------------------------------------
  // Local State
  // --------------------------------------------------------------------------

  const [searchText, setSearchText] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --------------------------------------------------------------------------
  // Derived Values
  // --------------------------------------------------------------------------

  const selectedDiagram = diagrams.find(d => d.id === selectedDiagramId) || null;
  const isDisabled = diagrams.length === 0;

  // --------------------------------------------------------------------------
  // Grouping and Filtering Logic
  // --------------------------------------------------------------------------

  /**
   * Build grouped and filtered diagram options.
   * Groups diagrams by DiagramType using getDiagramType() for safe normalization.
   * Filters by case-insensitive substring match on diagram name.
   * Same pattern as ApplicationPointPickerCell line 225.
   */
  const { groupedDiagrams, flatFilteredDiagrams } = useMemo(() => {
    const search = searchText.toLowerCase();

    const grouped: Record<DiagramType, Diagram[]> = {} as Record<DiagramType, Diagram[]>;
    const flat: Diagram[] = [];

    // Initialize all groups
    for (const type of ALL_DIAGRAM_TYPES) {
      grouped[type] = [];
    }

    // Group diagrams by type, applying search filter
    for (const diagram of diagrams) {
      if (search && !diagram.name.toLowerCase().includes(search)) {
        continue;
      }
      const type = getDiagramType(diagram);
      grouped[type].push(diagram);
      flat.push(diagram);
    }

    return { groupedDiagrams: grouped, flatFilteredDiagrams: flat };
  }, [diagrams, searchText]);

  // --------------------------------------------------------------------------
  // Click-Outside Detection
  // Follow ApplicationPointPickerCell lines 412-422
  // --------------------------------------------------------------------------

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
        // Restore display text when closing
        setSearchText('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // --------------------------------------------------------------------------
  // Event Handlers
  // --------------------------------------------------------------------------

  /** Single click on input opens dropdown (not double-click like ApplicationPointPickerCell) */
  const handleClick = () => {
    if (isDisabled) return;
    setSearchText('');
    setShowDropdown(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(e.target.value);
    setShowDropdown(true);
  };

  /** Selection behavior: calls onSelect, closes dropdown, clears search */
  const handleSelect = (diagram: Diagram) => {
    onSelect(diagram.id);
    setShowDropdown(false);
    setSearchText('');
  };

  /**
   * Keyboard handling:
   * - Escape closes dropdown
   * - Enter selects the first visible result
   * Follow ApplicationPointPickerCell lines 502-508
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowDropdown(false);
      setSearchText('');
    } else if (e.key === 'Enter' && flatFilteredDiagrams.length > 0) {
      handleSelect(flatFilteredDiagrams[0]);
    }
  };

  // --------------------------------------------------------------------------
  // Display Text
  // When not searching, input shows the name of the currently selected diagram
  // --------------------------------------------------------------------------

  const displayValue = showDropdown ? searchText : (selectedDiagram?.name || '');

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <div ref={containerRef} className={styles.container}>
      <input
        ref={inputRef}
        type="text"
        value={displayValue}
        onClick={handleClick}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder={isDisabled ? 'No diagrams defined' : 'Search diagrams...'}
        disabled={isDisabled}
        className={`${styles.input} ${isDisabled ? styles.inputDisabled : ''}`}
        data-testid="diagram-autocomplete-input"
      />
      {showDropdown && flatFilteredDiagrams.length > 0 && (
        <div className={styles.dropdown} data-testid="diagram-autocomplete-dropdown">
          {ALL_DIAGRAM_TYPES.map(type => {
            const diagramsInGroup = groupedDiagrams[type];
            if (!diagramsInGroup || diagramsInGroup.length === 0) return null;

            return (
              <div key={type}>
                <div className={styles.groupHeader}>
                  {DIAGRAM_TYPE_LABELS[type]}
                </div>
                {diagramsInGroup.map(diagram => (
                  <div
                    key={diagram.id}
                    className={styles.option}
                    onClick={() => handleSelect(diagram)}
                    data-testid={`diagram-option-${diagram.id}`}
                  >
                    {diagram.name}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {showDropdown && flatFilteredDiagrams.length === 0 && searchText && (
        <div className={styles.dropdown} data-testid="diagram-autocomplete-dropdown">
          <div className={styles.noResults}>No matching diagrams</div>
        </div>
      )}
    </div>
  );
}
