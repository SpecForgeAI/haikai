/**
 * ApplicationPointPickerCell Component
 *
 * Spec: Global Application Point Picker with Derived ApplicationPoints
 *
 * A specialized typeahead cell that displays Application Points grouped by kind
 * and allows selection from:
 * - Applications (kind=APPLICATION)
 * - Application Components (kind=APP_COMPONENT)
 * - Services (kind=SERVICE)
 * - Classes (kind=CLASS) - for derived APs
 * - Methods (kind=METHOD) - for derived APs
 *
 * Spec: Fix UI Characteristics Picker Grouping and Key Suggestions
 * Task Group 1: Updated to group Application Points by kind instead of a
 * single "Application Points" group. This provides better UX for finding
 * the right entity type quickly.
 *
 * When a Service/Class/Method entity is selected (not an existing AP),
 * creates a derived ApplicationPoint via ensureDerivedApplicationPoint
 * and dispatches ADD_ENTITY if needed.
 *
 * Spec: Standardize Relationship Dropdown Display Labels
 * Task Group 3: Dispatches SET_RELATIONSHIP_CELL_LABEL on selection
 * to populate the relationship cell label cache.
 */

import { useState, useRef, useEffect } from 'react';
import {
  AnyEntity,
  ArchitectureModel,
  ApplicationPoint,
  Service,
  Class,
  Method,
  Library,
} from '../../types/model';
import { GridColumnConfig, ValidationError } from '../../types/config';
import {
  ensureDerivedApplicationPoint,
  DerivedTargetType,
  isDerivedApplicationPoint,
  getTargetEntityInfo,
} from '../../utils/applicationPointDerivation';
import styles from './Grid.module.css';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Option group type for the picker dropdown
 *
 * Spec: Fix UI Characteristics Picker Grouping and Key Suggestions
 * Task 1.2: Updated from generic 'application_points' to kind-based groups
 */
type OptionGroup = 'applications' | 'app_components' | 'services' | 'classes' | 'methods' | 'libraries';

/**
 * Grouped option for display in the dropdown
 */
interface GroupedOption {
  group: OptionGroup;
  entity: AnyEntity;
  displayText: string;
  /** Flag to indicate this is a raw entity (Service/Class/Method) for derived AP creation */
  isRawEntity?: boolean;
}

/**
 * Props for the ApplicationPointPickerCell component
 *
 * Spec: Standardize Relationship Dropdown Display Labels
 * Added relationshipKey, rowId, columnKey for label cache dispatch.
 * Added onLabelUpdate callback for dispatching label updates.
 */
interface ApplicationPointPickerCellProps {
  /** Current value (ApplicationPoint ID) */
  value: string;
  /** The row entity being edited */
  entity: AnyEntity;
  /** Column configuration */
  column: GridColumnConfig;
  /** Full architecture model */
  model: ArchitectureModel;
  /** Callback when selection changes */
  onChange: (value: string) => void;
  /** Callback to add a new entity (for derived APs) */
  onAddEntity?: (entityType: string, entity: AnyEntity) => void;
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
   * Column key for label cache (e.g., 'source_application_point_id')
   */
  columnKey?: string;
  /**
   * Spec: Standardize Relationship Dropdown Display Labels
   * Callback to dispatch label cache update.
   * Called with (relationshipKey, rowId, columnKey, label) after selection.
   */
  onLabelUpdate?: (relationshipKey: string, rowId: string, columnKey: string, label: string) => void;
  /**
   * Optional array of Application Point kinds to show in the picker.
   * When set, only groups whose kind is in this list are displayed.
   * Example: ['APPLICATION', 'APP_COMPONENT', 'SERVICE']
   */
  allowedKinds?: string[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get display text for an Application Point
 */
export function getApplicationPointDisplayText(
  ap: ApplicationPoint,
  entities: ArchitectureModel['metaModel']['entities']
): string {
  // For derived APs, show target info
  if (isDerivedApplicationPoint(ap)) {
    const targetInfo = getTargetEntityInfo(ap, entities);
    if (targetInfo) {
      return targetInfo.displayName;
    }
  }

  // For standard APs, show name with kind badge
  const kindLabel = ap.kind || 'AP';
  return `${ap.name} [${kindLabel}]`;
}

/**
 * Get display text for a Service (for derived AP creation)
 */
function getServiceDisplayText(service: Service): string {
  return `${service.name} (Service)`;
}

/**
 * Get display text for a Class (for derived AP creation)
 */
function getClassDisplayText(classEntity: Class): string {
  return `${classEntity.name} (Class)`;
}

/**
 * Get display text for a Method (for derived AP creation)
 */
function getMethodDisplayText(
  method: Method,
  classes: Class[]
): string {
  const owningClass = classes.find(c => c.id === method.class_id);
  const className = owningClass?.name || 'Unknown';
  return `${className}.${method.name} (Method)`;
}

/**
 * Get display text for a Library (for derived AP creation)
 *
 * Spec 2026-05-06: Library Frontend Types & Tables
 * Library APs are always derived (no existing-AP path).
 */
function getLibraryDisplayText(library: Library): string {
  return `${library.name ?? library.id} (Library)`;
}

/**
 * Group header labels
 *
 * Spec: Fix UI Characteristics Picker Grouping and Key Suggestions
 * Task 1.3: Updated with kind-based group labels
 */
const GROUP_LABELS: Record<OptionGroup, string> = {
  applications: 'Applications',
  app_components: 'Application Components',
  services: 'Services',
  classes: 'Classes',
  methods: 'Methods',
  // Spec 2026-05-06: Library Frontend Types & Tables
  libraries: 'Libraries',
};

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

// ============================================================================
// COMPONENT
// ============================================================================

export function ApplicationPointPickerCell({
  value,
  entity: _entity,
  column: _column,
  model,
  onChange,
  onAddEntity,
  error,
  relationshipKey,
  rowId,
  columnKey,
  onLabelUpdate,
  allowedKinds,
}: ApplicationPointPickerCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<'below' | 'above'>('below');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { entities } = model.metaModel;

  // ============================================================================
  // BUILD GROUPED OPTIONS
  //
  // Spec: Fix UI Characteristics Picker Grouping and Key Suggestions
  // Task 1.4: Refactored to group Application Points by kind field
  // ============================================================================

  // Mapping from AP kind to OptionGroup for allowedKinds filtering
  const kindToGroup: Record<string, OptionGroup> = {
    APPLICATION: 'applications',
    APP_COMPONENT: 'app_components',
    SERVICE: 'services',
    CLASS: 'classes',
    METHOD: 'methods',
    // Spec 2026-05-06: Library Frontend Types & Tables
    LIBRARY: 'libraries',
  };

  const isGroupAllowed = (group: OptionGroup): boolean => {
    if (!allowedKinds) return true;
    return allowedKinds.some(kind => kindToGroup[kind] === group);
  };

  const buildGroupedOptions = (): GroupedOption[] => {
    const options: GroupedOption[] = [];
    const search = searchText.toLowerCase();

    // Group 1: Applications (kind=APPLICATION)
    if (isGroupAllowed('applications')) {
      entities.application_points
        .filter(ap => ap.kind === 'APPLICATION')
        .filter(ap => {
          const displayText = getApplicationPointDisplayText(ap, entities).toLowerCase();
          return displayText.includes(search);
        })
        .slice(0, 5)
        .forEach(ap => {
          options.push({
            group: 'applications',
            entity: ap,
            displayText: getApplicationPointDisplayText(ap, entities),
          });
        });
    }

    // Group 2: Application Components (kind=APP_COMPONENT)
    if (isGroupAllowed('app_components')) {
      entities.application_points
        .filter(ap => ap.kind === 'APP_COMPONENT')
        .filter(ap => {
          const displayText = getApplicationPointDisplayText(ap, entities).toLowerCase();
          return displayText.includes(search);
        })
        .slice(0, 5)
        .forEach(ap => {
          options.push({
            group: 'app_components',
            entity: ap,
            displayText: getApplicationPointDisplayText(ap, entities),
          });
        });
    }

    // Group 3: Services - includes both existing SERVICE kind APs and raw Service entities
    if (isGroupAllowed('services')) {
      // First, add existing SERVICE kind Application Points
      entities.application_points
        .filter(ap => ap.kind === 'SERVICE')
        .filter(ap => {
          const displayText = getApplicationPointDisplayText(ap, entities).toLowerCase();
          return displayText.includes(search);
        })
        .slice(0, 5)
        .forEach(ap => {
          options.push({
            group: 'services',
            entity: ap,
            displayText: getApplicationPointDisplayText(ap, entities),
          });
        });

      // Also add raw Service entities for derived AP creation
      entities.services
        .filter(s => {
          const displayText = getServiceDisplayText(s).toLowerCase();
          return displayText.includes(search);
        })
        .slice(0, 5)
        .forEach(s => {
          options.push({
            group: 'services',
            entity: s,
            displayText: getServiceDisplayText(s),
            isRawEntity: true,
          });
        });
    }

    // Group 4: Classes - includes both existing CLASS kind APs and raw Class entities
    if (isGroupAllowed('classes')) {
      // First, add existing CLASS kind Application Points
      entities.application_points
        .filter(ap => ap.kind === 'CLASS')
        .filter(ap => {
          const displayText = getApplicationPointDisplayText(ap, entities).toLowerCase();
          return displayText.includes(search);
        })
        .slice(0, 5)
        .forEach(ap => {
          options.push({
            group: 'classes',
            entity: ap,
            displayText: getApplicationPointDisplayText(ap, entities),
          });
        });

      // Also add raw Class entities for derived AP creation
      entities.classes
        .filter(c => {
          const displayText = getClassDisplayText(c).toLowerCase();
          return displayText.includes(search);
        })
        .slice(0, 5)
        .forEach(c => {
          options.push({
            group: 'classes',
            entity: c,
            displayText: getClassDisplayText(c),
            isRawEntity: true,
          });
        });
    }

    // Group 5: Methods - includes both existing METHOD kind APs and raw Method entities
    if (isGroupAllowed('methods')) {
      // First, add existing METHOD kind Application Points
      entities.application_points
        .filter(ap => ap.kind === 'METHOD')
        .filter(ap => {
          const displayText = getApplicationPointDisplayText(ap, entities).toLowerCase();
          return displayText.includes(search);
        })
        .slice(0, 5)
        .forEach(ap => {
          options.push({
            group: 'methods',
            entity: ap,
            displayText: getApplicationPointDisplayText(ap, entities),
          });
        });

      // Also add raw Method entities for derived AP creation
      entities.methods
        .filter(m => {
          const displayText = getMethodDisplayText(m, entities.classes).toLowerCase();
          return displayText.includes(search);
        })
        .slice(0, 5)
        .forEach(m => {
          options.push({
            group: 'methods',
            entity: m,
            displayText: getMethodDisplayText(m, entities.classes),
            isRawEntity: true,
          });
        });
    }

    // Group 6: Libraries (raw entity only - Library APs are always derived)
    // Spec 2026-05-06: Library Frontend Types & Tables
    if (isGroupAllowed('libraries')) {
      entities.libraries
        .filter(l => {
          const displayText = getLibraryDisplayText(l).toLowerCase();
          return displayText.includes(search);
        })
        .slice(0, 5)
        .forEach(l => {
          options.push({
            group: 'libraries',
            entity: l,
            displayText: getLibraryDisplayText(l),
            isRawEntity: true,
          });
        });
    }

    return options;
  };

  const groupedOptions = buildGroupedOptions();

  // Group options by category for rendering with headers
  const optionsByGroup = groupedOptions.reduce((acc, opt) => {
    if (!acc[opt.group]) {
      acc[opt.group] = [];
    }
    acc[opt.group].push(opt);
    return acc;
  }, {} as Record<OptionGroup, GroupedOption[]>);

  // ============================================================================
  // GET DISPLAY NAME FOR CURRENT VALUE
  // ============================================================================

  const getDisplayNameForValue = (): string => {
    if (!value) return '';

    // Find in application_points
    const ap = entities.application_points.find(p => p.id === value);
    if (ap) {
      return getApplicationPointDisplayText(ap, entities);
    }

    // Value might be a derived AP that hasn't been created yet
    return value;
  };

  const displayName = getDisplayNameForValue();

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
   * Handle selection of an option.
   *
   * Spec: Standardize Relationship Dropdown Display Labels
   * After setting the FK value, dispatch label cache update if the
   * necessary props are provided.
   */
  const handleSelect = (option: GroupedOption) => {
    let selectedApId: string;
    let displayLabel: string;

    // Check if this is an existing ApplicationPoint or a raw entity
    if (!option.isRawEntity) {
      // Direct selection of existing AP
      selectedApId = option.entity.id;
      displayLabel = option.displayText;
      onChange(selectedApId);
    } else {
      // Raw Service/Class/Method selection - create derived AP
      const targetTypeMap: Record<OptionGroup, DerivedTargetType> = {
        applications: 'SERVICE', // Won't be used for applications
        app_components: 'SERVICE', // Won't be used for app_components
        services: 'SERVICE',
        classes: 'CLASS',
        methods: 'METHOD',
        // Spec 2026-05-06: Library Frontend Types & Tables
        libraries: 'LIBRARY',
      };

      const targetType = targetTypeMap[option.group];

      try {
        const result = ensureDerivedApplicationPoint(
          targetType,
          option.entity.id,
          entities
        );

        // If new AP was created, dispatch ADD_ENTITY
        if (result.isNew && onAddEntity) {
          onAddEntity('application_points', result.applicationPoint);
        }

        // Set the cell value to the derived AP's ID
        selectedApId = result.applicationPoint.id;
        displayLabel = getApplicationPointDisplayText(result.applicationPoint, entities);
        onChange(selectedApId);
      } catch (err) {
        console.error('Failed to create derived ApplicationPoint:', err);
        setIsEditing(false);
        setShowDropdown(false);
        return;
      }
    }

    // Spec: Standardize Relationship Dropdown Display Labels
    // Dispatch label cache update if all required props are provided
    if (onLabelUpdate && relationshipKey && rowId && columnKey && displayLabel) {
      onLabelUpdate(relationshipKey, rowId, columnKey, displayLabel);
    }

    setIsEditing(false);
    setShowDropdown(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsEditing(false);
      setShowDropdown(false);
    } else if (e.key === 'Enter' && groupedOptions.length > 0) {
      handleSelect(groupedOptions[0]);
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
    // Spec: Fix UI Characteristics Picker Grouping and Key Suggestions
    // Task 1.5: Updated groupOrder to kind-based groups
    const allGroups: OptionGroup[] = ['applications', 'app_components', 'services', 'classes', 'methods', 'libraries'];
    const groupOrder = allGroups.filter(g => isGroupAllowed(g));

    return (
      <div ref={containerRef} className={styles.typeaheadContainer}>
        <input
          ref={inputRef}
          type="text"
          value={searchText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Search Applications, Components, Services..."
          className={styles.cellInput}
        />
        {showDropdown && groupedOptions.length > 0 && (
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
                    {GROUP_LABELS[group]}
                  </div>
                  {options.map(opt => (
                    <div
                      key={`${opt.group}-${opt.entity.id}`}
                      className={styles.typeaheadOption}
                      onClick={() => handleSelect(opt)}
                    >
                      {opt.displayText}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        {showDropdown && groupedOptions.length === 0 && searchText && (
          <div className={dropdownClass}>
            <div className={styles.noResults}>No matching items</div>
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
