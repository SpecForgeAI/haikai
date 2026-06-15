/**
 * TypeaheadCell Component
 *
 * A generic typeahead/autocomplete cell for FK relationships in grids.
 *
 * Spec: Standardize Relationship Dropdown Display Labels
 * Task Groups 3.4, 3.5: Updated to dispatch SET_RELATIONSHIP_CELL_LABEL
 * on selection for business_point_id, user_id, and app_business_point columns.
 */

import { useState, useRef, useEffect } from 'react';
import { AnyEntity, ArchitectureModel, EntityType } from '../../types/model';
import { GridColumnConfig, ValidationError } from '../../types/config';
import styles from './Grid.module.css';

interface TypeaheadCellProps {
  value: string;
  entity: AnyEntity;
  column: GridColumnConfig;
  entityType: EntityType;
  model: ArchitectureModel;
  onChange: (value: string) => void;
  error?: ValidationError;
  /**
   * Spec: Standardize Relationship Dropdown Display Labels
   * Relationship key for label cache (e.g., 'interactions')
   */
  relationshipKey?: string;
  /**
   * Spec: Standardize Relationship Dropdown Display Labels
   * Row ID for label cache (e.g., 'int_001')
   */
  rowId?: string;
  /**
   * Spec: Standardize Relationship Dropdown Display Labels
   * Callback to dispatch label cache update.
   * Called with (relationshipKey, rowId, columnKey, label) after selection.
   */
  onLabelUpdate?: (relationshipKey: string, rowId: string, columnKey: string, label: string) => void;
}

// Calculate dropdown position based on cell position relative to container
function getDropdownPosition(
  cellRect: DOMRect,
  containerRect: DOMRect
): 'below' | 'above' {
  // Calculate midpoint of visible rows area
  const containerMidY = containerRect.top + (containerRect.height / 2);

  // Cell center position
  const cellCenterY = cellRect.top + (cellRect.height / 2);

  // If cell is in top half, show dropdown below
  // If cell is in bottom half, show dropdown above
  return cellCenterY < containerMidY ? 'below' : 'above';
}

export function TypeaheadCell({
  value,
  entity,
  column,
  entityType,
  model,
  onChange,
  error,
  relationshipKey,
  rowId,
  onLabelUpdate,
}: TypeaheadCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<'below' | 'above'>('below');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get the target entities for this FK field
  const targetEntities = getTargetEntities(entity, column, entityType, model);

  // Check if column has a custom display formatter
  const hasCustomFormatter = Boolean(column.displayFormatter);

  // Get display text for an entity using custom formatter or default format
  const getEntityDisplayText = (e: AnyEntity): string => {
    if (column.displayFormatter) {
      return column.displayFormatter(e.id, targetEntities);
    }
    // Default format: "name (id)"
    const name = (e as { name?: string }).name;
    if (name) {
      return `${name} (${e.id})`;
    }
    return e.id;
  };

  // Filter entities based on search text
  // When custom formatter is present, search against formatted display string
  // Otherwise, search against name and id
  const filteredEntities = targetEntities
    .filter((e) => {
      const search = searchText.toLowerCase();

      if (hasCustomFormatter) {
        // Search against the formatted display string (excludes IDs when using custom formatter)
        const displayText = getEntityDisplayText(e).toLowerCase();
        return displayText.includes(search);
      } else {
        // Default behavior: search by name and id
        const name = ((e as { name?: string }).name || '').toLowerCase();
        const id = e.id.toLowerCase();
        return name.includes(search) || id.includes(search);
      }
    })
    .slice(0, 10);

  // Get display name for current value (shown when not editing)
  const getDisplayNameForValue = (): string => {
    if (!value) return '';

    const currentEntity = targetEntities.find((e) => e.id === value);
    if (currentEntity) {
      if (column.displayFormatter) {
        return column.displayFormatter(value, targetEntities);
      }
      return (currentEntity as { name?: string }).name || value;
    }
    return value;
  };

  const displayName = getDisplayNameForValue();

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();

      // Calculate dropdown position based on cell position
      if (containerRef.current) {
        const cellRect = containerRef.current.getBoundingClientRect();
        // Find the closest scrollable container (grid container)
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
   * Handle selection of an entity.
   *
   * Spec: Standardize Relationship Dropdown Display Labels
   * After setting the FK value, dispatch label cache update if the
   * necessary props are provided and the column is a relationship FK column.
   */
  const handleSelect = (selectedEntity: AnyEntity) => {
    onChange(selectedEntity.id);

    // Spec: Standardize Relationship Dropdown Display Labels
    // Dispatch label cache update if all required props are provided
    if (onLabelUpdate && relationshipKey && rowId && column.field) {
      const displayLabel = getEntityDisplayText(selectedEntity);
      onLabelUpdate(relationshipKey, rowId, column.field, displayLabel);
    }

    setIsEditing(false);
    setShowDropdown(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsEditing(false);
      setShowDropdown(false);
    } else if (e.key === 'Enter' && filteredEntities.length > 0) {
      handleSelect(filteredEntities[0]);
    }
  };

  // Get placeholder text based on whether custom formatter is used
  const getPlaceholderText = (): string => {
    if (hasCustomFormatter) {
      return 'Search by name or type...';
    }
    return 'Search by name or id...';
  };

  if (isEditing) {
    const dropdownClass = dropdownPosition === 'above'
      ? `${styles.typeaheadDropdown} ${styles.typeaheadDropdownAbove}`
      : `${styles.typeaheadDropdown} ${styles.typeaheadDropdownBelow}`;

    return (
      <div ref={containerRef} className={styles.typeaheadContainer}>
        <input
          ref={inputRef}
          type="text"
          value={searchText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={getPlaceholderText()}
          className={styles.cellInput}
        />
        {showDropdown && filteredEntities.length > 0 && (
          <div className={dropdownClass}>
            {filteredEntities.map((e) => (
              <div
                key={e.id}
                className={styles.typeaheadOption}
                onClick={() => handleSelect(e)}
              >
                {getEntityDisplayText(e)}
              </div>
            ))}
          </div>
        )}
        {showDropdown && filteredEntities.length === 0 && searchText && (
          <div className={dropdownClass}>
            <div className={styles.noResults}>No matching entities</div>
          </div>
        )}
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

/**
 * Get target entities for FK typeahead based on column configuration.
 * Supports dynamic FK target resolution when dynamicFkTargetField and dynamicFkTargetMap are specified.
 *
 * Spec: Expand Application Points to Reference Service/Class/Method
 * When target_type='SERVICE', fkTarget='services'
 * When target_type='CLASS', fkTarget='classes'
 * When target_type='METHOD', fkTarget='methods'
 */
function getTargetEntities(
  entity: AnyEntity,
  column: GridColumnConfig,
  _entityType: EntityType,
  model: ArchitectureModel
): AnyEntity[] {
  // Determine the effective fkTarget
  let effectiveFkTarget = column.fkTarget;

  // Check for dynamic FK target resolution
  // If dynamicFkTargetField and dynamicFkTargetMap are specified,
  // read the value from the entity and use the map to resolve the actual fkTarget
  if (column.dynamicFkTargetField && column.dynamicFkTargetMap) {
    const fieldValue = (entity as unknown as Record<string, unknown>)[column.dynamicFkTargetField];
    if (fieldValue && typeof fieldValue === 'string' && fieldValue in column.dynamicFkTargetMap) {
      effectiveFkTarget = column.dynamicFkTargetMap[fieldValue];
    }
    // If fieldValue is not set or not in the map, fall back to default fkTarget
  }

  // Get FK target from the nested metaModel.entities structure
  if (effectiveFkTarget && effectiveFkTarget in model.metaModel.entities) {
    return model.metaModel.entities[effectiveFkTarget as keyof typeof model.metaModel.entities] as AnyEntity[];
  }

  return [];
}
