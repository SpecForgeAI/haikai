/**
 * DataEntityPointSelect Component
 *
 * Spec: Switch Logical ER and Data Movements UI to Data Entity Point Dropdown
 * Task Group 3: DataEntityPointSelect Editor Component
 *
 * A specialized typeahead cell that displays Data Entity Points and allows
 * selection from:
 * - Logical Data Entities (group 1)
 * - Physical Data Entities (group 2)
 *
 * Uses deterministic point IDs with prefixes:
 * - Logical: dep_log_<entityId>
 * - Physical: dep_phy_<entityId>
 *
 * Follows the pattern established by ApplicationPointPickerCell.
 *
 * Spec: Remove Legacy Data Entity Relationship Columns
 * Task 5.6: Added error handling for missing point-id fields.
 * Displays error state when point-id is missing (treats as data corruption).
 *
 * Spec: Standardize Relationship Dropdown Display Labels
 * Task Group 3: Dispatches SET_RELATIONSHIP_CELL_LABEL on selection
 * to populate the relationship cell label cache.
 */

import { useState, useRef, useEffect } from 'react';
import { ArchitectureModel } from '../../types/model';
import { ValidationError } from '../../types/config';
import {
  buildDataEntityPointOptions,
  resolveDataEntityPointLabel,
  DATA_ENTITY_POINT_GROUPS,
  DataEntityPointOption,
} from '../../utils/dataEntityPointOptions';
import styles from './Grid.module.css';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Props for the DataEntityPointSelect component
 *
 * Spec: Standardize Relationship Dropdown Display Labels
 * Added relationshipKey, rowId, columnKey for label cache dispatch.
 * Added onLabelUpdate callback for dispatching label updates.
 */
interface DataEntityPointSelectProps {
  /** Current value (Data Entity Point ID - e.g., dep_log_<id> or dep_phy_<id>) */
  value: string;
  /** Full architecture model for entity lookup */
  model: ArchitectureModel;
  /** Callback when selection changes */
  onChange: (value: string) => void;
  /** Validation error for this cell */
  error?: ValidationError;
  /**
   * Spec: Standardize Relationship Dropdown Display Labels
   * Relationship key for label cache (e.g., 'data_movements')
   */
  relationshipKey?: string;
  /**
   * Spec: Standardize Relationship Dropdown Display Labels
   * Row ID for label cache (e.g., 'dm_001')
   */
  rowId?: string;
  /**
   * Spec: Standardize Relationship Dropdown Display Labels
   * Column key for label cache (e.g., 'dataEntityPointId')
   */
  columnKey?: string;
  /**
   * Spec: Standardize Relationship Dropdown Display Labels
   * Callback to dispatch label cache update.
   * Called with (relationshipKey, rowId, columnKey, label) after selection.
   */
  onLabelUpdate?: (relationshipKey: string, rowId: string, columnKey: string, label: string) => void;
  /**
   * Hotfix 2026-05-13: whether the column treats a missing value as a
   * validation error. Defaults to true to preserve the original behaviour
   * for required relationship FK columns (e.g., interface_logical_entities'
   * `dataEntityPointId`). The endpoint grid's "Request Data" / "Response
   * Data" columns -- and any other column declared with `required: false`
   * on its grid config -- pass `false` so the cell no longer renders the
   * red "(Missing - Required)" placeholder for an optional empty value.
   */
  required?: boolean;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate dropdown position based on cell position relative to container
 */
function getDropdownPosition(
  cellRect: DOMRect,
  containerRect: DOMRect
): 'below' | 'above' {
  const containerMidY = containerRect.top + (containerRect.height / 2);
  const cellCenterY = cellRect.top + (cellRect.height / 2);
  return cellCenterY < containerMidY ? 'below' : 'above';
}

/**
 * Check if a point-id field is missing (null, undefined, or blank).
 *
 * Spec: Remove Legacy Data Entity Relationship Columns
 * Task 5.6: Error handling for missing point-id fields.
 *
 * @param value - The point-id value to check
 * @returns true if the value is considered missing
 */
function isPointIdMissing(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === '';
}

// ============================================================================
// COMPONENT
// ============================================================================

export function DataEntityPointSelect({
  value,
  model,
  onChange,
  error,
  relationshipKey,
  rowId,
  columnKey,
  onLabelUpdate,
  required = true,
}: DataEntityPointSelectProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<'below' | 'above'>('below');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { entities } = model.metaModel;

  // ============================================================================
  // ERROR HANDLING FOR MISSING POINT-ID FIELDS
  // Spec: Remove Legacy Data Entity Relationship Columns - Task 5.6
  // ============================================================================

  const isMissing = isPointIdMissing(value);

  // Hotfix 2026-05-13: only treat a missing value as a corruption signal
  // when the column is declared required. The "data corruption" framing
  // makes no sense for optional FK columns (e.g., endpoint Request /
  // Response Data) where the absence of a value is the legitimate default
  // for an endpoint that doesn't carry request/response payloads.
  const isRequiredMissing = required && isMissing;

  // Log warning to console for debugging when a REQUIRED point-id is missing
  useEffect(() => {
    if (isRequiredMissing) {
      console.warn(
        '[DataEntityPointSelect] Missing point-id field detected. ' +
        'This may indicate data corruption. The value should be set to a valid ' +
        'Data Entity Point ID (e.g., dep_log_<entityId> or dep_phy_<entityId>).'
      );
    }
  }, [isRequiredMissing]);

  // ============================================================================
  // BUILD OPTIONS
  // ============================================================================

  /**
   * Build filtered options based on search text
   */
  const buildFilteredOptions = (): DataEntityPointOption[] => {
    const allOptions = buildDataEntityPointOptions(entities);
    const search = searchText.toLowerCase();

    if (!search) {
      return allOptions;
    }

    return allOptions.filter(opt => opt.label.toLowerCase().includes(search));
  };

  const filteredOptions = buildFilteredOptions();

  // Group options by category for rendering with headers
  const optionsByGroup = filteredOptions.reduce((acc, opt) => {
    if (!acc[opt.group]) {
      acc[opt.group] = [];
    }
    acc[opt.group].push(opt);
    return acc;
  }, {} as Record<string, DataEntityPointOption[]>);

  // ============================================================================
  // GET DISPLAY NAME FOR CURRENT VALUE
  // ============================================================================

  const displayName = resolveDataEntityPointLabel(value, entities);

  // ============================================================================
  // EFFECTS
  // ============================================================================

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();

      // Calculate dropdown position
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
        setIsEditing(false);
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  const handleDoubleClick = () => {
    setSearchText('');
    setIsEditing(true);
    setShowDropdown(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(e.target.value);
    setShowDropdown(true);
  };

  /**
   * Handle selection of a Data Entity Point option.
   *
   * Spec: Standardize Relationship Dropdown Display Labels
   * After setting the FK value, dispatch label cache update if the
   * necessary props are provided.
   */
  const handleSelect = (option: DataEntityPointOption) => {
    // Persist the canonical FK value
    onChange(option.value);

    // Spec: Standardize Relationship Dropdown Display Labels
    // Dispatch label cache update if all required props are provided
    if (onLabelUpdate && relationshipKey && rowId && columnKey) {
      onLabelUpdate(relationshipKey, rowId, columnKey, option.label);
    }

    setIsEditing(false);
    setShowDropdown(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsEditing(false);
      setShowDropdown(false);
    } else if (e.key === 'Enter' && filteredOptions.length > 0) {
      handleSelect(filteredOptions[0]);
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  if (isEditing) {
    const dropdownClass = dropdownPosition === 'above'
      ? `${styles.typeaheadDropdown} ${styles.typeaheadDropdownAbove}`
      : `${styles.typeaheadDropdown} ${styles.typeaheadDropdownBelow}`;

    // Order of groups to render
    const groupOrder = [DATA_ENTITY_POINT_GROUPS.LOGICAL, DATA_ENTITY_POINT_GROUPS.PHYSICAL];

    return (
      <div ref={containerRef} className={styles.typeaheadContainer}>
        <input
          ref={inputRef}
          type="text"
          value={searchText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Search Logical or Physical Data Entities..."
          className={styles.cellInput}
        />
        {showDropdown && filteredOptions.length > 0 && (
          <div className={dropdownClass} style={{ maxHeight: '300px' }}>
            {groupOrder.map(group => {
              const options = optionsByGroup[group];
              if (!options || options.length === 0) return null;

              return (
                <div key={group}>
                  <div
                    style={{
                      padding: '6px 12px',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#666',
                      backgroundColor: '#f0f0f0',
                      borderBottom: '1px solid #ddd',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    {group}
                  </div>
                  {options.map(opt => (
                    <div
                      key={opt.value}
                      className={styles.typeaheadOption}
                      onClick={() => handleSelect(opt)}
                    >
                      {opt.label}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        {showDropdown && filteredOptions.length === 0 && searchText && (
          <div className={dropdownClass}>
            <div className={styles.noResults}>No matching data entities</div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // MISSING POINT-ID STATES
  // Spec: Remove Legacy Data Entity Relationship Columns - Task 5.6
  // Hotfix 2026-05-13: split into two branches:
  //   - required + missing -> red "(Missing - Required)" placeholder (the
  //     original corruption-signal behaviour for required FK columns).
  //   - optional + missing -> blank cell with a neutral double-click hint
  //     (no red text, no "Required" copy). Empty is a legitimate value for
  //     optional FK columns such as endpoint Request / Response Data.
  // ============================================================================

  if (isRequiredMissing) {
    return (
      <div
        className={`${styles.cellValue} ${styles.cellError}`}
        onDoubleClick={handleDoubleClick}
        title="Missing Data Entity Point ID - This field is required. Double-click to select a value."
        style={{
          color: '#dc3545',
          fontStyle: 'italic',
        }}
        data-testid="missing-point-id-error"
      >
        (Missing - Required)
      </div>
    );
  }

  if (isMissing) {
    return (
      <div
        className={styles.cellValue}
        onDoubleClick={handleDoubleClick}
        title="Double-click to select a Data Entity"
        data-testid="empty-point-id-optional"
      >
        &nbsp;
      </div>
    );
  }

  return (
    <div
      className={`${styles.cellValue} ${error ? styles.cellError : ''}`}
      onDoubleClick={handleDoubleClick}
      title={error?.message || displayName}
    >
      {displayName}
    </div>
  );
}
