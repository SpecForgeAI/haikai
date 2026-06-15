/**
 * InfrastructurePointPickerCell Component
 *
 * Spec 2026-05-04: Infrastructure Domain Tables UI
 *
 * A specialised typeahead cell that displays raw Infrastructure entities grouped
 * by their InfrastructurePointKind and allows selection from any of:
 * - Environments (kind=ENVIRONMENT)
 * - Cloud Accounts (kind=CLOUD_ACCOUNT)
 * - Locations (kind=LOCATION)
 * - Networks (kind=NETWORK)
 * - Subnets (kind=SUBNET)
 * - Compute Clusters (kind=COMPUTE_CLUSTER)
 * - Compute Resources (kind=COMPUTE_RESOURCE)
 * - Deployment Units (kind=DEPLOYMENT_UNIT)
 * - Load Balancers (kind=LOAD_BALANCER)
 * - Listeners (kind=LISTENER)
 * - Data Stores (kind=DATA_STORE_INSTANCE)
 * - Infrastructure Resources (kind=INFRASTRUCTURE_RESOURCE)
 *
 * On selection of a raw entity, calls `ensureDerivedInfrastructurePoint` to find
 * or create a matching InfrastructurePoint row (typed-FK-aligned), and writes
 * the InfrastructurePoint id back into the grid cell. New InfrastructurePoint
 * rows are persisted via the `onAddEntity('infrastructure_points', ip)` callback.
 *
 * Honours `column.allowedKinds: string[]` to filter the visible groups, mirroring
 * the existing `ApplicationPointPickerCell` convention.
 */

import { useState, useRef, useEffect } from 'react';
import {
  AnyEntity,
  ArchitectureModel,
  InfrastructurePoint,
  InfrastructurePointKind,
} from '../../types/model';
import { GridColumnConfig, ValidationError } from '../../types/config';
import {
  ensureDerivedInfrastructurePoint,
  DerivedInfrastructureSourceEntityType,
  DerivedInfrastructureSourceEntity,
  POINT_KIND_TO_ENTITY_TYPE,
  ENTITY_TYPE_TO_POINT_KIND,
  getInfrastructurePointTargetInfo,
} from '../../utils/infrastructurePointDerivation';
import { INFRASTRUCTURE_POINT_KIND_LABELS } from '../../utils/formatters';
import styles from './Grid.module.css';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Option group key — one per InfrastructurePointKind, mirroring the raw entity
 * collection key on MetaModelEntities.
 */
type OptionGroup = DerivedInfrastructureSourceEntityType;

/**
 * Grouped option for display in the dropdown.
 * Each option always represents a raw infrastructure entity (the picker is the
 * single channel through which InfrastructurePoint rows are created/looked up).
 */
interface GroupedOption {
  group: OptionGroup;
  entity: AnyEntity;
  displayText: string;
  /** Existing InfrastructurePoint matching this entity (typed-FK match), if any */
  existingPoint?: InfrastructurePoint;
}

/**
 * Props for the InfrastructurePointPickerCell component
 */
interface InfrastructurePointPickerCellProps {
  /** Current value (InfrastructurePoint ID) */
  value: string;
  /** The row entity being edited */
  entity: AnyEntity;
  /** Column configuration */
  column: GridColumnConfig;
  /** Full architecture model */
  model: ArchitectureModel;
  /** Callback when selection changes */
  onChange: (value: string) => void;
  /** Callback to add a new entity (for newly-derived InfrastructurePoints) */
  onAddEntity?: (entityType: string, entity: AnyEntity) => void;
  /** Validation error for this cell */
  error?: ValidationError;
  /**
   * Spec: Standardize Relationship Dropdown Display Labels
   * Relationship key for label cache (e.g., 'resource_subnet_hostings')
   */
  relationshipKey?: string;
  /**
   * Spec: Standardize Relationship Dropdown Display Labels
   * Row ID for label cache
   */
  rowId?: string;
  /**
   * Spec: Standardize Relationship Dropdown Display Labels
   * Column key for label cache
   */
  columnKey?: string;
  /**
   * Spec: Standardize Relationship Dropdown Display Labels
   * Callback to dispatch label cache update.
   */
  onLabelUpdate?: (relationshipKey: string, rowId: string, columnKey: string, label: string) => void;
  /**
   * Optional array of InfrastructurePointKind values to show in the picker.
   * When set, only groups whose kind is in this list are displayed.
   * Example: ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER']
   */
  allowedKinds?: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Group ordering for the dropdown — containment-driven, mirroring the entity
 * tab order locked in spec 3 / spec 4.
 */
const GROUP_ORDER: OptionGroup[] = [
  'environments',
  'cloud_accounts',
  'locations',
  'networks',
  'subnets',
  'compute_clusters',
  'compute_resources',
  'deployment_units',
  'load_balancers',
  'listeners',
  'data_store_instances',
  'infrastructure_resources',
];

/**
 * Group display labels — match the entityTabNames strings for visual continuity
 * with the entity tabs.
 */
const GROUP_LABELS: Record<OptionGroup, string> = {
  environments: 'Environments',
  cloud_accounts: 'Cloud Accounts',
  locations: 'Locations',
  networks: 'Networks',
  subnets: 'Subnets',
  compute_clusters: 'Compute Clusters',
  compute_resources: 'Compute Resources',
  deployment_units: 'Deployment Units',
  load_balancers: 'Load Balancers',
  listeners: 'Listeners',
  data_store_instances: 'Data Stores',
  infrastructure_resources: 'Infrastructure Resources',
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate dropdown position based on cell position relative to container.
 */
function getDropdownPosition(
  cellRect: DOMRect,
  containerRect: DOMRect
): 'below' | 'above' {
  const containerMidY = containerRect.top + containerRect.height / 2;
  const cellCenterY = cellRect.top + cellRect.height / 2;
  return cellCenterY < containerMidY ? 'below' : 'above';
}

/**
 * Get the display text for a raw entity, prefixed with the kind label.
 */
function getEntityDisplayText(
  entity: { name: string },
  group: OptionGroup
): string {
  const kindLabel = INFRASTRUCTURE_POINT_KIND_LABELS[ENTITY_TYPE_TO_POINT_KIND[group]];
  return `${entity.name} (${kindLabel})`;
}

/**
 * Find an existing InfrastructurePoint row for a raw entity by typed-FK match.
 * Used both to display "(already linked)" hints and to short-circuit derivation.
 */
function findExistingPointByTypedFk(
  group: OptionGroup,
  rawEntityId: string,
  infrastructurePoints: InfrastructurePoint[]
): InfrastructurePoint | undefined {
  const pointKind = ENTITY_TYPE_TO_POINT_KIND[group];
  return infrastructurePoints.find(ip => {
    if (ip.point_kind !== pointKind) return false;
    const fkValueRecord = ip as unknown as Record<string, unknown>;
    // Probe the matching typed FK column (e.g. compute_resource_id) without
    // re-importing the FK-field map; this mirrors what findDerivedInfrastructurePoint
    // does internally and keeps the picker self-contained.
    const fkField = pointKindToFkField(pointKind);
    return fkValueRecord[fkField] === rawEntityId;
  });
}

/**
 * Mapping from InfrastructurePointKind to the typed FK column.
 * Local copy to avoid importing the helper from infrastructurePointDerivation
 * (which keeps it as `keyof InfrastructurePoint`).
 */
function pointKindToFkField(kind: InfrastructurePointKind): string {
  switch (kind) {
    case 'ENVIRONMENT':
      return 'environment_id';
    case 'CLOUD_ACCOUNT':
      return 'cloud_account_id';
    case 'LOCATION':
      return 'location_id';
    case 'NETWORK':
      return 'network_id';
    case 'SUBNET':
      return 'subnet_id';
    case 'COMPUTE_CLUSTER':
      return 'compute_cluster_id';
    case 'COMPUTE_RESOURCE':
      return 'compute_resource_id';
    case 'DEPLOYMENT_UNIT':
      return 'deployment_unit_id';
    case 'LOAD_BALANCER':
      return 'load_balancer_id';
    case 'LISTENER':
      return 'listener_id';
    case 'DATA_STORE_INSTANCE':
      return 'data_store_instance_id';
    case 'INFRASTRUCTURE_RESOURCE':
      return 'infrastructure_resource_id';
  }
}

// ============================================================================
// COMPONENT
// ============================================================================

export function InfrastructurePointPickerCell({
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
}: InfrastructurePointPickerCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<'below' | 'above'>('below');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { entities } = model.metaModel;

  // ============================================================================
  // BUILD GROUPED OPTIONS
  // ============================================================================

  /**
   * Determine whether a particular group is allowed by the column's
   * `allowedKinds` filter. When `allowedKinds` is undefined or empty, all
   * groups are allowed.
   */
  const isGroupAllowed = (group: OptionGroup): boolean => {
    if (!allowedKinds || allowedKinds.length === 0) return true;
    return allowedKinds.includes(ENTITY_TYPE_TO_POINT_KIND[group]);
  };

  const buildGroupedOptions = (): GroupedOption[] => {
    const options: GroupedOption[] = [];
    const search = searchText.toLowerCase();

    for (const group of GROUP_ORDER) {
      if (!isGroupAllowed(group)) continue;

      const collection = entities[group] as Array<{ id: string; name: string }> | undefined;
      if (!collection) continue;

      collection
        .filter(e => {
          const displayText = getEntityDisplayText(e, group).toLowerCase();
          return displayText.includes(search);
        })
        .slice(0, 5)
        .forEach(e => {
          const existingPoint = findExistingPointByTypedFk(
            group,
            e.id,
            entities.infrastructure_points
          );
          options.push({
            group,
            entity: e as unknown as AnyEntity,
            displayText: getEntityDisplayText(e, group),
            existingPoint,
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

    const ip = entities.infrastructure_points.find(p => p.id === value);
    if (!ip) {
      return '(missing)';
    }

    const targetInfo = getInfrastructurePointTargetInfo(ip, entities);
    if (targetInfo) {
      const groupKey = POINT_KIND_TO_ENTITY_TYPE[ip.point_kind];
      const sourceEntity = targetInfo.sourceEntity as DerivedInfrastructureSourceEntity & {
        name: string;
      };
      return getEntityDisplayText(sourceEntity, groupKey);
    }

    // Fallback to the InfrastructurePoint's own name if the typed FK target
    // is missing — degrade gracefully rather than crash.
    const kindLabel = INFRASTRUCTURE_POINT_KIND_LABELS[ip.point_kind] || ip.point_kind;
    return `${ip.name} (${kindLabel})`;
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
   * Handle selection of an option. Always invokes the find-or-create derivation
   * helper so that downstream callers see a consistent InfrastructurePoint id.
   */
  const handleSelect = (option: GroupedOption) => {
    let selectedIpId: string;
    let displayLabel: string;

    try {
      const result = ensureDerivedInfrastructurePoint(
        option.group,
        option.entity.id,
        entities
      );

      // If a new InfrastructurePoint was created, dispatch ADD_ENTITY
      if (result.isNew && onAddEntity) {
        onAddEntity('infrastructure_points', result.infrastructurePoint);
      }

      selectedIpId = result.infrastructurePoint.id;
      displayLabel = option.displayText;
      onChange(selectedIpId);
    } catch (err) {
      console.error('Failed to derive InfrastructurePoint:', err);
      setIsEditing(false);
      setShowDropdown(false);
      return;
    }

    // Spec: Standardize Relationship Dropdown Display Labels
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
    const dropdownClass =
      dropdownPosition === 'above'
        ? `${styles.typeaheadDropdown} ${styles.typeaheadDropdownAbove}`
        : `${styles.typeaheadDropdown} ${styles.typeaheadDropdownBelow}`;

    const visibleGroups = GROUP_ORDER.filter(g => isGroupAllowed(g));

    return (
      <div ref={containerRef} className={styles.typeaheadContainer}>
        <input
          ref={inputRef}
          type="text"
          value={searchText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Search infrastructure entities..."
          className={styles.cellInput}
        />
        {showDropdown && groupedOptions.length > 0 && (
          <div className={dropdownClass} style={{ maxHeight: '300px' }}>
            {visibleGroups.map(group => {
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
