/**
 * ContextPickerModal Component
 *
 * Spec 2026-01-04: Product Implement Context Picker v1
 * Task Group 3: Modal for selecting architecture entities and diagrams as context
 *
 * Spec 2026-01-16: Context Picker Bundles - UI and Selection Contract
 * Task Group 3: Bundle selection state management
 * Task Group 4: Bundle dropdown UI in ContextPickerModal
 *
 * Spec 2026-01-16: Context Picker Smart Defaults and Heuristic Suggestions
 * Task Group 4: Depth selector for entity bundles
 * Task Group 5: Suggestions UI section
 * Task Group 6: Suggestion action handlers
 * Task Group 7: Depth passthrough to Apply
 *
 * Spec 2026-01-17: Context Picker Modal UI Improvements
 * Task Group 6: Domain tab strip component with 6 icon tabs
 * Task Group 7: Domain section components (Entities/Relationships)
 * Task Group 8: Main component refactoring with relationship selection
 *
 * Spec 2026-01-25: Fix Context Picker DEP Labels and Add Select All
 * Task Group 2: Section-level Select All checkboxes for Entities and Relationships
 * Task Group 3: Group-level Select All checkboxes for entity type and relationship type groups
 *
 * Features:
 * - Six-tab layout: Business, Application, Data, Behavioural, UI, Diagrams
 * - Search input filtering by label substring (case-insensitive)
 * - Domain tabs: Entities and Relationships sections
 * - Diagrams tab: flat list with checkboxes
 * - Apply/Cancel flow with deduplication logic
 * - Empty state handling
 * - Bundle selection state tracking per entity
 * - Bundle dropdown UI for selected entities that support bundles
 * - Depth selector for entity_with_attributes_and_relationships bundle
 * - Suggestions section with heuristic-driven recommendations
 * - Relationship selection with relationship_refs in Apply payload
 * - Section-level Select All checkboxes with indeterminate state support
 * - Group-level Select All checkboxes with indeterminate state support
 *
 * Follows patterns from WorkItemCreateModal.tsx and PaletteDomainSelector.tsx
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChartNetwork } from 'lucide-react';
import type { ContextState, EntityRef, DiagramRef, RelationshipRef } from '../../utils/contextStorage';
import type { PickOption, RelationshipPickOption } from '../../utils/contextPickListBuilders';
import {
  getDefaultBundleType,
  getBundleOptionsForEntityType,
  BUNDLE_TYPE_LABELS,
  DEPTH_OPTIONS,
  DEPTH_LABELS,
  DEPTH_WARNING,
} from '../../utils/contextBundleTypes';
import {
  computeSuggestions,
  type Suggestion,
  type DiagramPickOption,
} from '../../utils/contextHeuristics';
import {
  ALL_DOMAINS,
  DOMAIN_LABELS,
  DOMAIN_ICONS,
  type ArchitectureDomain,
} from '../../types/architectureDomain';
import {
  DOMAIN_TO_ENTITY_TYPES,
  DOMAIN_TO_RELATIONSHIP_TYPES,
} from '../../utils/contextPickerDomainMappings';
import { deriveCheckboxState, type CheckboxState } from '../../utils/selectionUtils';
import styles from './ContextPickerModal.module.css';

// ============================================================================
// Types
// ============================================================================

export interface ContextPickerModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Initial selected context state */
  initialSelected: ContextState;
  /** Architecture entity options grouped by collection key */
  architectureOptions: Record<string, PickOption[]>;
  /** Diagram options as flat list */
  diagramOptions: PickOption[];
  /** Relationship options grouped by collection key */
  relationshipOptions?: Record<string, RelationshipPickOption[]>;
  /** Callback when Apply is clicked with the new context state */
  onApply: (newState: ContextState) => void;
  /** Optional callback when Send is clicked (Apply + auto-send context message) */
  onSend?: () => void;
}

type ActiveTab = ArchitectureDomain | 'diagrams';

// ============================================================================
// BundleSelector Component
// ============================================================================

interface BundleSelectorProps {
  entityId: string;
  entityType: string;
  currentValue: string | undefined;
  onChange: (entityId: string, bundleType: string) => void;
}

/**
 * Inline bundle selector dropdown for entity rows
 * Only renders if the entity type has bundle options available
 */
function BundleSelector({ entityId, entityType, currentValue, onChange }: BundleSelectorProps) {
  const options = getBundleOptionsForEntityType(entityType);

  // Don't render if no bundle options for this entity type
  if (options.length === 0) {
    return null;
  }

  return (
    <select
      className={styles.bundleSelect}
      value={currentValue || ''}
      onChange={(e) => onChange(entityId, e.target.value)}
      onClick={(e) => e.stopPropagation()} // Prevent row click from toggling checkbox
      data-testid={`bundle-select-${entityId}`}
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {BUNDLE_TYPE_LABELS[opt] || opt}
        </option>
      ))}
    </select>
  );
}

// ============================================================================
// DepthSelector Component
// ============================================================================

interface DepthSelectorProps {
  entityId: string;
  currentDepth: 1 | 2;
  onChange: (entityId: string, depth: 1 | 2) => void;
}

/**
 * Inline depth selector dropdown for entity rows with entity_with_attributes_and_relationships bundle
 * Displays warning when depth 2 is selected
 */
function DepthSelector({ entityId, currentDepth, onChange }: DepthSelectorProps) {
  return (
    <div className={styles.depthSelectContainer}>
      <select
        className={styles.depthSelect}
        value={currentDepth}
        onChange={(e) => onChange(entityId, parseInt(e.target.value, 10) as 1 | 2)}
        onClick={(e) => e.stopPropagation()} // Prevent row click from toggling checkbox
        data-testid={`depth-select-${entityId}`}
      >
        {DEPTH_OPTIONS.map((depth) => (
          <option key={depth} value={depth}>
            {DEPTH_LABELS[depth]}
          </option>
        ))}
      </select>
      {currentDepth === 2 && (
        <span className={styles.depthWarning} data-testid={`depth-warning-${entityId}`}>
          {DEPTH_WARNING}
        </span>
      )}
    </div>
  );
}

// ============================================================================
// SuggestionCard Component
// ============================================================================

interface SuggestionCardProps {
  suggestion: Suggestion;
  onAdd: (suggestion: Suggestion) => void;
  onDismiss: (suggestion: Suggestion) => void;
}

/**
 * Individual suggestion card with title, rationale, Add and Dismiss buttons
 */
function SuggestionCard({ suggestion, onAdd, onDismiss }: SuggestionCardProps) {
  return (
    <div className={styles.suggestionCard} data-testid={`suggestion-card-${suggestion.id}`}>
      <div className={styles.suggestionContent}>
        <span className={styles.suggestionTitle}>{suggestion.title}</span>
        <span className={styles.suggestionRationale}>{suggestion.rationale}</span>
      </div>
      <div className={styles.suggestionActions}>
        <button
          className={styles.addButton}
          onClick={() => onAdd(suggestion)}
          data-testid={`suggestion-add-${suggestion.id}`}
        >
          Add
        </button>
        <button
          className={styles.dismissButton}
          onClick={() => onDismiss(suggestion)}
          data-testid={`suggestion-dismiss-${suggestion.id}`}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// SuggestionsSection Component
// ============================================================================

interface SuggestionsSectionProps {
  suggestions: Suggestion[];
  onAddSuggestion: (suggestion: Suggestion) => void;
  onDismissSuggestion: (suggestion: Suggestion) => void;
}

/**
 * Section displaying heuristic suggestions
 * Returns null when no suggestions to display
 */
function SuggestionsSection({
  suggestions,
  onAddSuggestion,
  onDismissSuggestion,
}: SuggestionsSectionProps) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className={styles.suggestionsSection} data-testid="suggestions-section">
      <div className={styles.suggestionsSectionHeader}>Suggested Context</div>
      {suggestions.map((suggestion) => (
        <SuggestionCard
          key={suggestion.id}
          suggestion={suggestion}
          onAdd={onAddSuggestion}
          onDismiss={onDismissSuggestion}
        />
      ))}
    </div>
  );
}

// ============================================================================
// DomainTabStrip Component
// Spec 2026-01-17: Task Group 6
// ============================================================================

interface DomainTabStripProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
}

/**
 * Icon-based domain tab strip with 6 tabs (5 domains + Diagrams)
 * Supports keyboard navigation with arrow keys
 */
function DomainTabStrip({ activeTab, onTabChange }: DomainTabStripProps) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const allTabs: ActiveTab[] = [...ALL_DOMAINS, 'diagrams'];

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentIndex = allTabs.indexOf(activeTab);
      let newIndex = currentIndex;

      if (e.key === 'ArrowRight') {
        newIndex = (currentIndex + 1) % allTabs.length;
        e.preventDefault();
      } else if (e.key === 'ArrowLeft') {
        newIndex = currentIndex === 0 ? allTabs.length - 1 : currentIndex - 1;
        e.preventDefault();
      } else if (e.key === 'Enter' || e.key === ' ') {
        // Already on the tab, do nothing extra
        e.preventDefault();
        return;
      } else {
        return;
      }

      onTabChange(allTabs[newIndex]);
    },
    [activeTab, onTabChange, allTabs]
  );

  return (
    <div
      className={styles.domainTabStrip}
      data-testid="domain-tab-strip"
      role="tablist"
      onKeyDown={handleKeyDown}
      ref={tabsRef}
    >
      {ALL_DOMAINS.map((domain) => {
        const Icon = DOMAIN_ICONS[domain];
        const isSelected = activeTab === domain;
        return (
          <button
            key={domain}
            className={`${styles.domainTab} ${isSelected ? styles.selected : ''}`}
            onClick={() => onTabChange(domain)}
            title={DOMAIN_LABELS[domain]}
            aria-label={DOMAIN_LABELS[domain]}
            aria-selected={isSelected}
            role="tab"
            tabIndex={isSelected ? 0 : -1}
            data-testid={`domain-tab-${domain}`}
          >
            <Icon className={styles.domainTabIcon} size={16} />
          </button>
        );
      })}
      {/* Diagrams tab with ChartNetwork icon */}
      <button
        className={`${styles.domainTab} ${activeTab === 'diagrams' ? styles.selected : ''}`}
        onClick={() => onTabChange('diagrams')}
        title="Diagrams"
        aria-label="Diagrams"
        aria-selected={activeTab === 'diagrams'}
        role="tab"
        tabIndex={activeTab === 'diagrams' ? 0 : -1}
        data-testid="domain-tab-diagrams"
      >
        <ChartNetwork className={styles.domainTabIcon} size={16} />
      </button>
    </div>
  );
}

// ============================================================================
// EntityTypeGroup Component
// Spec 2026-01-25: Task Group 3 - Group-level Select All for entity types
// ============================================================================

interface EntityTypeGroupProps {
  entityType: string;
  options: PickOption[];
  selectedEntityIds: Set<string>;
  entityBundleSelections: Record<string, string>;
  entityDepthSelections: Record<string, 1 | 2>;
  onEntityToggle: (entityId: string) => void;
  onBundleChange: (entityId: string, bundleType: string) => void;
  onDepthChange: (entityId: string, depth: 1 | 2) => void;
  onBulkEntitySelection: (entityIds: string[], entities: PickOption[], select: boolean) => void;
}

/**
 * Entity type group with Select All checkbox in header
 * Spec 2026-01-25: Task Group 3 - Group-level Select All
 */
function EntityTypeGroup({
  entityType,
  options,
  selectedEntityIds,
  entityBundleSelections,
  entityDepthSelections,
  onEntityToggle,
  onBundleChange,
  onDepthChange,
  onBulkEntitySelection,
}: EntityTypeGroupProps) {
  // Count selected entities in this group
  const selectedCount = useMemo(() => {
    return options.filter((entity) => selectedEntityIds.has(entity.value)).length;
  }, [options, selectedEntityIds]);

  // Derive checkbox state for group Select All
  const groupSelectAllState: CheckboxState = deriveCheckboxState(selectedCount, options.length);

  // Handle group Select All checkbox click - prevent propagation to avoid expand/collapse
  const handleGroupSelectAllClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  // Handle group Select All change
  const handleGroupSelectAllChange = useCallback(() => {
    const shouldSelect = groupSelectAllState !== 'checked';
    const entityIds = options.map((entity) => entity.value);
    onBulkEntitySelection(entityIds, options, shouldSelect);
  }, [groupSelectAllState, options, onBulkEntitySelection]);

  return (
    <div className={styles.group}>
      <div className={styles.groupHeader}>
        {/* Group-level Select All checkbox */}
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={groupSelectAllState === 'checked'}
          ref={(input) => {
            if (input) {
              input.indeterminate = groupSelectAllState === 'indeterminate';
            }
          }}
          onChange={handleGroupSelectAllChange}
          onClick={handleGroupSelectAllClick}
          data-testid={`group-select-all-${entityType}`}
        />
        <span className={styles.groupTitle}>{entityType}</span>
        <span className={styles.groupCount}>({options.length})</span>
      </div>
      <div className={styles.groupContent} data-testid={`group-content-${entityType}`}>
        {options.map((option) => {
          const isSelected = selectedEntityIds.has(option.value);
          const bundleType = entityBundleSelections[option.value];
          const showDepthSelector =
            isSelected &&
            bundleType === 'entity_with_attributes_and_relationships';

          return (
            <div key={option.value} className={styles.optionRow}>
              <label className={styles.optionItem}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={isSelected}
                  onChange={() => onEntityToggle(option.value)}
                  data-testid={`checkbox-${option.value}`}
                />
                <span className={styles.optionLabel}>{option.label}</span>
              </label>
              {isSelected && option.entity_type && (
                <BundleSelector
                  entityId={option.value}
                  entityType={option.entity_type}
                  currentValue={bundleType}
                  onChange={onBundleChange}
                />
              )}
              {showDepthSelector && (
                <DepthSelector
                  entityId={option.value}
                  currentDepth={entityDepthSelections[option.value] ?? 1}
                  onChange={onDepthChange}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// RelationshipTypeGroup Component
// Spec 2026-01-25: Task Group 3 - Group-level Select All for relationship types
// ============================================================================

interface RelationshipTypeGroupProps {
  relationshipType: string;
  options: RelationshipPickOption[];
  selectedRelationshipIds: Set<string>;
  onRelationshipToggle: (relationshipId: string, relationshipType: string, label: string) => void;
  onBulkRelationshipSelection: (relationshipIds: string[], relationships: RelationshipPickOption[], select: boolean) => void;
}

/**
 * Relationship type group with Select All checkbox in header
 * Spec 2026-01-25: Task Group 3 - Group-level Select All
 */
function RelationshipTypeGroup({
  relationshipType,
  options,
  selectedRelationshipIds,
  onRelationshipToggle,
  onBulkRelationshipSelection,
}: RelationshipTypeGroupProps) {
  // Count selected relationships in this group
  const selectedCount = useMemo(() => {
    return options.filter((rel) => selectedRelationshipIds.has(rel.value)).length;
  }, [options, selectedRelationshipIds]);

  // Derive checkbox state for group Select All
  const groupSelectAllState: CheckboxState = deriveCheckboxState(selectedCount, options.length);

  // Handle group Select All checkbox click - prevent propagation to avoid expand/collapse
  const handleGroupSelectAllClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  // Handle group Select All change
  const handleGroupSelectAllChange = useCallback(() => {
    const shouldSelect = groupSelectAllState !== 'checked';
    const relationshipIds = options.map((rel) => rel.value);
    onBulkRelationshipSelection(relationshipIds, options, shouldSelect);
  }, [groupSelectAllState, options, onBulkRelationshipSelection]);

  return (
    <div className={styles.group}>
      <div className={styles.groupHeader}>
        {/* Group-level Select All checkbox */}
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={groupSelectAllState === 'checked'}
          ref={(input) => {
            if (input) {
              input.indeterminate = groupSelectAllState === 'indeterminate';
            }
          }}
          onChange={handleGroupSelectAllChange}
          onClick={handleGroupSelectAllClick}
          data-testid={`group-select-all-${relationshipType}`}
        />
        <span className={styles.groupTitle}>{relationshipType}</span>
        <span className={styles.groupCount}>({options.length})</span>
      </div>
      <div className={styles.groupContent} data-testid={`group-content-${relationshipType}`}>
        {options.map((option) => {
          const isSelected = selectedRelationshipIds.has(option.value);

          return (
            <div key={option.value} className={styles.optionRow}>
              <label className={styles.optionItem}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={isSelected}
                  onChange={() =>
                    onRelationshipToggle(option.value, option.relationship_type, option.label)
                  }
                  data-testid={`checkbox-rel-${option.value}`}
                />
                <span className={styles.optionLabel}>{option.label}</span>
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// DomainEntitiesSection Component
// Spec 2026-01-17: Task Group 7
// Spec 2026-01-25: Task Group 2 - Added Select All checkbox
// Spec 2026-01-25: Task Group 3 - Refactored to use EntityTypeGroup for group-level Select All
// ============================================================================

interface DomainEntitiesSectionProps {
  domain: ArchitectureDomain;
  architectureOptions: Record<string, PickOption[]>;
  selectedEntityIds: Set<string>;
  entityBundleSelections: Record<string, string>;
  entityDepthSelections: Record<string, 1 | 2>;
  onEntityToggle: (entityId: string) => void;
  onBundleChange: (entityId: string, bundleType: string) => void;
  onDepthChange: (entityId: string, depth: 1 | 2) => void;
  onBulkEntitySelection: (entityIds: string[], entities: PickOption[], select: boolean) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

/**
 * Entities section for a domain tab
 * Filters entities by domain and renders as grouped checkbox tree
 * Includes Select All checkbox in section header
 * Spec 2026-01-25: Task Group 3 - Now uses EntityTypeGroup for group-level Select All
 */
function DomainEntitiesSection({
  domain,
  architectureOptions,
  selectedEntityIds,
  entityBundleSelections,
  entityDepthSelections,
  onEntityToggle,
  onBundleChange,
  onDepthChange,
  onBulkEntitySelection,
  isExpanded,
  onToggleExpand,
}: DomainEntitiesSectionProps) {
  // Filter entity types for this domain
  const domainEntityTypes = DOMAIN_TO_ENTITY_TYPES[domain] || [];

  // Collect all entities for this domain
  const domainEntities = useMemo(() => {
    const entities: PickOption[] = [];
    for (const entityType of domainEntityTypes) {
      const options = architectureOptions[entityType] || [];
      entities.push(...options);
    }
    return entities;
  }, [domainEntityTypes, architectureOptions]);

  // Count total entities for this domain
  const totalCount = domainEntities.length;

  // Count selected entities in this domain
  const selectedCount = useMemo(() => {
    return domainEntities.filter((entity) => selectedEntityIds.has(entity.value)).length;
  }, [domainEntities, selectedEntityIds]);

  // Derive checkbox state for Select All
  const selectAllState: CheckboxState = deriveCheckboxState(selectedCount, totalCount);

  // Handle Select All checkbox click
  const handleSelectAllClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation(); // Prevent section expand/collapse
    },
    []
  );

  const handleSelectAllChange = useCallback(() => {
    // If checked or indeterminate, select all; if already all selected, deselect all
    const shouldSelect = selectAllState !== 'checked';
    const entityIds = domainEntities.map((entity) => entity.value);
    onBulkEntitySelection(entityIds, domainEntities, shouldSelect);
  }, [selectAllState, domainEntities, onBulkEntitySelection]);

  return (
    <div className={styles.domainSection}>
      <div
        className={styles.domainSectionHeader}
        onClick={onToggleExpand}
        data-testid="domain-section-entities-header"
      >
        {/* Select All checkbox - before triangle and label */}
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={selectAllState === 'checked'}
          ref={(input) => {
            if (input) {
              input.indeterminate = selectAllState === 'indeterminate';
            }
          }}
          onChange={handleSelectAllChange}
          onClick={handleSelectAllClick}
          data-testid="entities-select-all-checkbox"
        />
        <span
          className={`${styles.domainSectionTriangle} ${isExpanded ? styles.expanded : ''}`}
        >
          {isExpanded ? '\u25BC' : '\u25B6'}
        </span>
        <span className={styles.domainSectionLabel}>Entities</span>
        <span className={styles.domainSectionCount}>{totalCount}</span>
      </div>
      {isExpanded && (
        <div className={styles.domainSectionBody} data-testid="domain-section-entities-body">
          {totalCount === 0 ? (
            <div className={styles.emptyState}>No entities in this domain.</div>
          ) : (
            domainEntityTypes.map((entityType) => {
              const options = architectureOptions[entityType] || [];
              if (options.length === 0) return null;

              return (
                <EntityTypeGroup
                  key={entityType}
                  entityType={entityType}
                  options={options}
                  selectedEntityIds={selectedEntityIds}
                  entityBundleSelections={entityBundleSelections}
                  entityDepthSelections={entityDepthSelections}
                  onEntityToggle={onEntityToggle}
                  onBundleChange={onBundleChange}
                  onDepthChange={onDepthChange}
                  onBulkEntitySelection={onBulkEntitySelection}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// DomainRelationshipsSection Component
// Spec 2026-01-17: Task Group 7
// Spec 2026-01-25: Task Group 2 - Added Select All checkbox
// Spec 2026-01-25: Task Group 3 - Refactored to use RelationshipTypeGroup for group-level Select All
// ============================================================================

interface DomainRelationshipsSectionProps {
  domain: ArchitectureDomain;
  relationshipOptions: Record<string, RelationshipPickOption[]>;
  selectedRelationshipIds: Set<string>;
  onRelationshipToggle: (relationshipId: string, relationshipType: string, label: string) => void;
  onBulkRelationshipSelection: (relationshipIds: string[], relationships: RelationshipPickOption[], select: boolean) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

/**
 * Relationships section for a domain tab
 * Filters relationships by domain and renders as flat checkbox list
 * Includes Select All checkbox in section header
 * Spec 2026-01-25: Task Group 3 - Now uses RelationshipTypeGroup for group-level Select All
 */
function DomainRelationshipsSection({
  domain,
  relationshipOptions,
  selectedRelationshipIds,
  onRelationshipToggle,
  onBulkRelationshipSelection,
  isExpanded,
  onToggleExpand,
}: DomainRelationshipsSectionProps) {
  // Filter relationship types for this domain
  const domainRelationshipTypes = DOMAIN_TO_RELATIONSHIP_TYPES[domain] || [];

  // Collect all relationships for this domain
  const domainRelationships = useMemo(() => {
    const relationships: RelationshipPickOption[] = [];
    for (const relType of domainRelationshipTypes) {
      const options = relationshipOptions[relType] || [];
      relationships.push(...options);
    }
    return relationships;
  }, [domainRelationshipTypes, relationshipOptions]);

  // Count total relationships for this domain
  const totalCount = domainRelationships.length;

  // Count selected relationships in this domain
  const selectedCount = useMemo(() => {
    return domainRelationships.filter((rel) => selectedRelationshipIds.has(rel.value)).length;
  }, [domainRelationships, selectedRelationshipIds]);

  // Derive checkbox state for Select All
  const selectAllState: CheckboxState = deriveCheckboxState(selectedCount, totalCount);

  // Handle Select All checkbox click
  const handleSelectAllClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation(); // Prevent section expand/collapse
    },
    []
  );

  const handleSelectAllChange = useCallback(() => {
    // If checked or indeterminate, select all; if already all selected, deselect all
    const shouldSelect = selectAllState !== 'checked';
    const relationshipIds = domainRelationships.map((rel) => rel.value);
    onBulkRelationshipSelection(relationshipIds, domainRelationships, shouldSelect);
  }, [selectAllState, domainRelationships, onBulkRelationshipSelection]);

  return (
    <div className={styles.domainSection}>
      <div
        className={styles.domainSectionHeader}
        onClick={onToggleExpand}
        data-testid="domain-section-relationships-header"
      >
        {/* Select All checkbox - before triangle and label */}
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={selectAllState === 'checked'}
          ref={(input) => {
            if (input) {
              input.indeterminate = selectAllState === 'indeterminate';
            }
          }}
          onChange={handleSelectAllChange}
          onClick={handleSelectAllClick}
          data-testid="relationships-select-all-checkbox"
        />
        <span
          className={`${styles.domainSectionTriangle} ${isExpanded ? styles.expanded : ''}`}
        >
          {isExpanded ? '\u25BC' : '\u25B6'}
        </span>
        <span className={styles.domainSectionLabel}>Relationships</span>
        <span className={styles.domainSectionCount}>{totalCount}</span>
      </div>
      {isExpanded && (
        <div className={styles.domainSectionBody} data-testid="domain-section-relationships-body">
          {totalCount === 0 ? (
            <div className={styles.emptyState}>No relationships in this domain.</div>
          ) : (
            domainRelationshipTypes.map((relType) => {
              const options = relationshipOptions[relType] || [];
              if (options.length === 0) return null;

              return (
                <RelationshipTypeGroup
                  key={relType}
                  relationshipType={relType}
                  options={options}
                  selectedRelationshipIds={selectedRelationshipIds}
                  onRelationshipToggle={onRelationshipToggle}
                  onBulkRelationshipSelection={onBulkRelationshipSelection}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Component
// ============================================================================

export function ContextPickerModal({
  isOpen,
  onClose,
  initialSelected,
  architectureOptions,
  diagramOptions,
  relationshipOptions = {},
  onApply,
  onSend,
}: ContextPickerModalProps) {
  // Tab state - defaults to 'business'
  const [activeTab, setActiveTab] = useState<ActiveTab>('business');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Selection state - track selected entity IDs, diagram IDs, and relationship IDs
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());
  const [selectedDiagramIds, setSelectedDiagramIds] = useState<Set<string>>(new Set());
  const [selectedRelationshipIds, setSelectedRelationshipIds] = useState<Set<string>>(new Set());

  // Relationship metadata for building refs (tracks type and label for each selected relationship)
  const [relationshipMetadata, setRelationshipMetadata] = useState<
    Record<string, { relationship_type: string; label: string }>
  >({});

  // Section expand states (entities and relationships sections per domain)
  const [entitiesSectionExpanded, setEntitiesSectionExpanded] = useState(true);
  const [relationshipsSectionExpanded, setRelationshipsSectionExpanded] = useState(true);

  // Bundle selection state - tracks bundle_type per entity_id
  const [entityBundleSelections, setEntityBundleSelections] = useState<Record<string, string>>({});

  // Depth selection state - tracks depth per entity_id
  const [entityDepthSelections, setEntityDepthSelections] = useState<Record<string, 1 | 2>>({});

  // Dismissed suggestions state
  const [dismissedSuggestionIds, setDismissedSuggestionIds] = useState<Set<string>>(new Set());

  // Initialize selection from initialSelected when modal opens
  useEffect(() => {
    if (isOpen) {
      // Initialize entity selections
      const entityIds = new Set(
        initialSelected.entity_refs.map((ref) => ref.entity_id)
      );
      setSelectedEntityIds(entityIds);

      // Initialize diagram selections
      const diagramIds = new Set(
        initialSelected.diagram_refs.map((ref) => ref.diagram_id)
      );
      setSelectedDiagramIds(diagramIds);

      // Initialize relationship selections
      const relationshipIds = new Set(
        (initialSelected.relationship_refs || []).map((ref) => ref.relationship_id)
      );
      setSelectedRelationshipIds(relationshipIds);

      // Initialize relationship metadata from initialSelected
      const relMetadata: Record<string, { relationship_type: string; label: string }> = {};
      for (const ref of initialSelected.relationship_refs || []) {
        relMetadata[ref.relationship_id] = {
          relationship_type: ref.relationship_type,
          label: ref.label,
        };
      }
      setRelationshipMetadata(relMetadata);

      // Initialize bundle selections and depth selections from initialSelected.entity_refs
      const bundleSelections: Record<string, string> = {};
      const depthSelections: Record<string, 1 | 2> = {};
      for (const entityRef of initialSelected.entity_refs) {
        if (entityRef.bundle_type) {
          bundleSelections[entityRef.entity_id] = entityRef.bundle_type;

          if (
            entityRef.bundle_type === 'entity_with_attributes_and_relationships' &&
            entityRef.depth !== undefined
          ) {
            depthSelections[entityRef.entity_id] = entityRef.depth;
          } else if (entityRef.bundle_type === 'entity_with_attributes_and_relationships') {
            depthSelections[entityRef.entity_id] = 1;
          }
        } else {
          const defaultBundle = getDefaultBundleType(entityRef.entity_type);
          if (defaultBundle) {
            bundleSelections[entityRef.entity_id] = defaultBundle;
            if (defaultBundle === 'entity_with_attributes_and_relationships') {
              depthSelections[entityRef.entity_id] = 1;
            }
          }
        }
      }
      setEntityBundleSelections(bundleSelections);
      setEntityDepthSelections(depthSelections);

      // Reset section expand states
      setEntitiesSectionExpanded(true);
      setRelationshipsSectionExpanded(true);

      // Reset search
      setSearchQuery('');

      // Reset dismissed suggestions
      setDismissedSuggestionIds(new Set());

      // Default to business tab
      setActiveTab('business');
    }
  }, [isOpen, initialSelected]);

  // Build the map from entity_id to PickOption for label lookup
  const entityOptionMap = useMemo(() => {
    const map = new Map<string, PickOption>();
    for (const options of Object.values(architectureOptions)) {
      for (const opt of options) {
        map.set(opt.value, opt);
      }
    }
    return map;
  }, [architectureOptions]);

  // Convert diagram options to DiagramPickOption format for heuristics
  const diagramPickOptions = useMemo((): DiagramPickOption[] => {
    return diagramOptions.map((opt) => ({
      ...opt,
      referenced_entity_ids: [],
    }));
  }, [diagramOptions]);

  // Compute suggestions based on current selection state
  const suggestions = useMemo(() => {
    const allSuggestions = computeSuggestions({
      selectedEntityIds,
      entityBundleSelections,
      entityOptionMap,
      diagramOptions: diagramPickOptions,
      selectedDiagramIds,
    });

    return allSuggestions.filter((s) => !dismissedSuggestionIds.has(s.id));
  }, [
    selectedEntityIds,
    entityBundleSelections,
    entityOptionMap,
    diagramPickOptions,
    selectedDiagramIds,
    dismissedSuggestionIds,
  ]);

  // Handle entity checkbox toggle
  const handleEntityToggle = useCallback((entityId: string) => {
    setSelectedEntityIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(entityId)) {
        newSet.delete(entityId);
        setEntityBundleSelections((prevBundles) => {
          const { [entityId]: _, ...rest } = prevBundles;
          return rest;
        });
        setEntityDepthSelections((prevDepths) => {
          const { [entityId]: _, ...rest } = prevDepths;
          return rest;
        });
      } else {
        newSet.add(entityId);
        const option = entityOptionMap.get(entityId);
        if (option && option.entity_type) {
          const defaultBundle = getDefaultBundleType(option.entity_type);
          if (defaultBundle) {
            setEntityBundleSelections((prevBundles) => ({
              ...prevBundles,
              [entityId]: defaultBundle,
            }));
            if (defaultBundle === 'entity_with_attributes_and_relationships') {
              setEntityDepthSelections((prevDepths) => ({
                ...prevDepths,
                [entityId]: 1,
              }));
            }
          }
        }
      }
      return newSet;
    });
  }, [entityOptionMap]);

  // ============================================================================
  // Bulk Entity Selection Handler
  // Spec 2026-01-25: Task Group 2, Task 2.3
  // ============================================================================
  /**
   * Handle bulk entity selection for Select All functionality.
   * When selecting: add all entityIds to selectedEntityIds, populate entityBundleSelections
   * with default bundle types, populate entityDepthSelections for entities with
   * entity_with_attributes_and_relationships bundle.
   * When deselecting: remove all entityIds from selectedEntityIds, remove entries
   * from entityBundleSelections and entityDepthSelections.
   */
  const handleBulkEntitySelection = useCallback(
    (entityIds: string[], entities: PickOption[], select: boolean) => {
      if (select) {
        // Select all entities
        setSelectedEntityIds((prev) => {
          const newSet = new Set(prev);
          for (const entityId of entityIds) {
            newSet.add(entityId);
          }
          return newSet;
        });

        // Populate bundle selections with defaults
        const newBundleSelections: Record<string, string> = {};
        const newDepthSelections: Record<string, 1 | 2> = {};

        for (const entity of entities) {
          if (entity.entity_type) {
            const defaultBundle = getDefaultBundleType(entity.entity_type);
            if (defaultBundle) {
              newBundleSelections[entity.value] = defaultBundle;
              if (defaultBundle === 'entity_with_attributes_and_relationships') {
                newDepthSelections[entity.value] = 1;
              }
            }
          }
        }

        setEntityBundleSelections((prev) => ({
          ...prev,
          ...newBundleSelections,
        }));

        setEntityDepthSelections((prev) => ({
          ...prev,
          ...newDepthSelections,
        }));
      } else {
        // Deselect all entities
        setSelectedEntityIds((prev) => {
          const newSet = new Set(prev);
          for (const entityId of entityIds) {
            newSet.delete(entityId);
          }
          return newSet;
        });

        // Remove bundle and depth selections
        setEntityBundleSelections((prev) => {
          const newSelections = { ...prev };
          for (const entityId of entityIds) {
            delete newSelections[entityId];
          }
          return newSelections;
        });

        setEntityDepthSelections((prev) => {
          const newSelections = { ...prev };
          for (const entityId of entityIds) {
            delete newSelections[entityId];
          }
          return newSelections;
        });
      }
    },
    []
  );

  // Handle diagram checkbox toggle
  const handleDiagramToggle = useCallback((diagramId: string) => {
    setSelectedDiagramIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(diagramId)) {
        newSet.delete(diagramId);
      } else {
        newSet.add(diagramId);
      }
      return newSet;
    });
  }, []);

  // Handle relationship checkbox toggle
  const handleRelationshipToggle = useCallback(
    (relationshipId: string, relationshipType: string, label: string) => {
      setSelectedRelationshipIds((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(relationshipId)) {
          newSet.delete(relationshipId);
          setRelationshipMetadata((prevMeta) => {
            const { [relationshipId]: _, ...rest } = prevMeta;
            return rest;
          });
        } else {
          newSet.add(relationshipId);
          setRelationshipMetadata((prevMeta) => ({
            ...prevMeta,
            [relationshipId]: { relationship_type: relationshipType, label },
          }));
        }
        return newSet;
      });
    },
    []
  );

  // ============================================================================
  // Bulk Relationship Selection Handler
  // Spec 2026-01-25: Task Group 2, Task 2.4
  // ============================================================================
  /**
   * Handle bulk relationship selection for Select All functionality.
   * When selecting: add all relationshipIds to selectedRelationshipIds, pre-compute
   * and populate relationshipMetadata with { relationship_type, label } for each.
   * When deselecting: remove all relationshipIds from selectedRelationshipIds,
   * remove entries from relationshipMetadata.
   * Metadata is computed at selection time (not lazily).
   */
  const handleBulkRelationshipSelection = useCallback(
    (relationshipIds: string[], relationships: RelationshipPickOption[], select: boolean) => {
      if (select) {
        // Select all relationships
        setSelectedRelationshipIds((prev) => {
          const newSet = new Set(prev);
          for (const relationshipId of relationshipIds) {
            newSet.add(relationshipId);
          }
          return newSet;
        });

        // Pre-compute and populate relationship metadata
        const newMetadata: Record<string, { relationship_type: string; label: string }> = {};
        for (const relationship of relationships) {
          newMetadata[relationship.value] = {
            relationship_type: relationship.relationship_type,
            label: relationship.label,
          };
        }

        setRelationshipMetadata((prev) => ({
          ...prev,
          ...newMetadata,
        }));
      } else {
        // Deselect all relationships
        setSelectedRelationshipIds((prev) => {
          const newSet = new Set(prev);
          for (const relationshipId of relationshipIds) {
            newSet.delete(relationshipId);
          }
          return newSet;
        });

        // Remove relationship metadata
        setRelationshipMetadata((prev) => {
          const newMetadata = { ...prev };
          for (const relationshipId of relationshipIds) {
            delete newMetadata[relationshipId];
          }
          return newMetadata;
        });
      }
    },
    []
  );

  // Handle bundle dropdown change
  const handleBundleChange = useCallback((entityId: string, bundleType: string) => {
    setEntityBundleSelections((prev) => ({
      ...prev,
      [entityId]: bundleType,
    }));

    if (bundleType === 'entity_with_attributes_and_relationships') {
      setEntityDepthSelections((prev) => ({
        ...prev,
        [entityId]: prev[entityId] ?? 1,
      }));
    } else {
      setEntityDepthSelections((prev) => {
        const { [entityId]: _, ...rest } = prev;
        return rest;
      });
    }
  }, []);

  // Handle depth dropdown change
  const handleDepthChange = useCallback((entityId: string, depth: 1 | 2) => {
    setEntityDepthSelections((prev) => ({
      ...prev,
      [entityId]: depth,
    }));
  }, []);

  // Handle adding a suggestion
  const handleAddSuggestion = useCallback((suggestion: Suggestion) => {
    if (suggestion.action === 'upgrade_bundle' && suggestion.targetBundleType) {
      setEntityBundleSelections((prev) => ({
        ...prev,
        [suggestion.targetEntityId]: suggestion.targetBundleType!,
      }));

      if (suggestion.targetBundleType === 'entity_with_attributes_and_relationships') {
        setEntityDepthSelections((prev) => ({
          ...prev,
          [suggestion.targetEntityId]: prev[suggestion.targetEntityId] ?? 1,
        }));
      }
    } else if (suggestion.action === 'add_entity') {
      if (suggestion.targetEntityType === 'diagrams') {
        setSelectedDiagramIds((prev) => new Set([...prev, suggestion.targetEntityId]));
      } else {
        setSelectedEntityIds((prev) => new Set([...prev, suggestion.targetEntityId]));

        if (suggestion.targetBundleType) {
          setEntityBundleSelections((prev) => ({
            ...prev,
            [suggestion.targetEntityId]: suggestion.targetBundleType!,
          }));

          if (suggestion.targetBundleType === 'entity_with_attributes_and_relationships') {
            setEntityDepthSelections((prev) => ({
              ...prev,
              [suggestion.targetEntityId]: 1,
            }));
          }
        }
      }
    }

    setDismissedSuggestionIds((prev) => new Set([...prev, suggestion.id]));
  }, []);

  // Handle dismissing a suggestion
  const handleDismissSuggestion = useCallback((suggestion: Suggestion) => {
    setDismissedSuggestionIds((prev) => new Set([...prev, suggestion.id]));
  }, []);

  // Filter diagram options by search query (search only applies to diagrams tab)
  const filteredDiagramOptions = useMemo(() => {
    if (!searchQuery.trim()) {
      return diagramOptions;
    }

    const query = searchQuery.toLowerCase().trim();
    return diagramOptions.filter((opt) =>
      opt.label.toLowerCase().includes(query)
    );
  }, [diagramOptions, searchQuery]);

  // Build the map from diagram_id to PickOption for label lookup
  const diagramOptionMap = useMemo(() => {
    const map = new Map<string, PickOption>();
    for (const opt of diagramOptions) {
      map.set(opt.value, opt);
    }
    return map;
  }, [diagramOptions]);

  // Build the ContextState from current selections (shared by Apply and Send)
  const buildNewContextState = useCallback((): ContextState => {
    // Build entity refs from selections with bundle_type and depth
    const entityRefs: EntityRef[] = [];
    for (const entityId of selectedEntityIds) {
      const option = entityOptionMap.get(entityId);
      if (option && option.entity_type) {
        const bundleType = entityBundleSelections[entityId];
        const depth = entityDepthSelections[entityId];

        const entityRef: EntityRef = {
          kind: 'ENTITY',
          entity_type: option.entity_type,
          entity_id: entityId,
          label: option.label,
          bundle_type: bundleType,
        };

        if (depth === 2) {
          entityRef.depth = depth;
        }

        entityRefs.push(entityRef);
      }
    }

    // Build diagram refs from selections
    const diagramRefs: DiagramRef[] = [];
    for (const diagramId of selectedDiagramIds) {
      const option = diagramOptionMap.get(diagramId);
      if (option) {
        diagramRefs.push({
          kind: 'DIAGRAM',
          diagram_id: diagramId,
          label: option.label,
          bundle_type: 'diagram_only',
        });
      }
    }

    // Build relationship refs from selections
    const relationshipRefs: RelationshipRef[] = [];
    for (const relationshipId of selectedRelationshipIds) {
      const metadata = relationshipMetadata[relationshipId];
      if (metadata) {
        relationshipRefs.push({
          kind: 'RELATIONSHIP',
          relationship_type: metadata.relationship_type,
          relationship_id: relationshipId,
          label: metadata.label,
        });
      }
    }

    return {
      version: 1,
      entity_refs: entityRefs,
      diagram_refs: diagramRefs,
      relationship_refs: relationshipRefs.length > 0 ? relationshipRefs : undefined,
    };
  }, [
    selectedEntityIds,
    selectedDiagramIds,
    selectedRelationshipIds,
    entityOptionMap,
    diagramOptionMap,
    entityBundleSelections,
    entityDepthSelections,
    relationshipMetadata,
  ]);

  // Handle Apply click
  const handleApply = useCallback(() => {
    const newState = buildNewContextState();
    onApply(newState);
    onClose();
  }, [buildNewContextState, onApply, onClose]);

  // Handle Send click (Apply + auto-send context message)
  const handleSend = useCallback(() => {
    const newState = buildNewContextState();
    onApply(newState);
    if (onSend) onSend();
    onClose();
  }, [buildNewContextState, onApply, onSend, onClose]);

  // Handle Cancel click
  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  // Handle overlay click (close on click outside)
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  // Check if there are any options available
  const hasArchitectureOptions = Object.values(architectureOptions).some(
    (opts) => opts.length > 0
  );
  const hasDiagramOptions = diagramOptions.length > 0;

  // Determine if current tab is a domain tab (not diagrams)
  const isDomainTab = activeTab !== 'diagrams';

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      data-testid="context-picker-modal"
    >
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Add Context</h2>
          <button
            className={styles.closeButton}
            onClick={handleCancel}
            title="Close"
            data-testid="modal-close-button"
          >
            &times;
          </button>
        </div>

        {/* Domain Tab Strip */}
        <DomainTabStrip activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Content */}
        <div className={styles.content}>
          {/* Search input - only shown for diagrams tab */}
          {activeTab === 'diagrams' && (
            <div className={styles.searchContainer}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search diagrams..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="search-input"
              />
            </div>
          )}

          {/* Suggestions section */}
          <SuggestionsSection
            suggestions={suggestions}
            onAddSuggestion={handleAddSuggestion}
            onDismissSuggestion={handleDismissSuggestion}
          />

          {/* Domain tab content (5 architecture domains) */}
          {isDomainTab && (
            <div data-testid="domain-content">
              {!hasArchitectureOptions ? (
                <div className={styles.emptyState}>
                  No architecture entities available in this project.
                </div>
              ) : (
                <>
                  {/* Entities Section */}
                  <DomainEntitiesSection
                    domain={activeTab as ArchitectureDomain}
                    architectureOptions={architectureOptions}
                    selectedEntityIds={selectedEntityIds}
                    entityBundleSelections={entityBundleSelections}
                    entityDepthSelections={entityDepthSelections}
                    onEntityToggle={handleEntityToggle}
                    onBundleChange={handleBundleChange}
                    onDepthChange={handleDepthChange}
                    onBulkEntitySelection={handleBulkEntitySelection}
                    isExpanded={entitiesSectionExpanded}
                    onToggleExpand={() => setEntitiesSectionExpanded(!entitiesSectionExpanded)}
                  />

                  {/* Relationships Section */}
                  <DomainRelationshipsSection
                    domain={activeTab as ArchitectureDomain}
                    relationshipOptions={relationshipOptions}
                    selectedRelationshipIds={selectedRelationshipIds}
                    onRelationshipToggle={handleRelationshipToggle}
                    onBulkRelationshipSelection={handleBulkRelationshipSelection}
                    isExpanded={relationshipsSectionExpanded}
                    onToggleExpand={() => setRelationshipsSectionExpanded(!relationshipsSectionExpanded)}
                  />
                </>
              )}
            </div>
          )}

          {/* Diagrams tab content */}
          {activeTab === 'diagrams' && (
            <div data-testid="diagrams-content">
              {!hasDiagramOptions ? (
                <div className={styles.emptyState}>
                  No diagrams available in this project.
                </div>
              ) : filteredDiagramOptions.length === 0 ? (
                <div className={styles.noResults}>
                  No matching diagrams found.
                </div>
              ) : (
                filteredDiagramOptions.map((option) => (
                  <label key={option.value} className={styles.optionItem}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={selectedDiagramIds.has(option.value)}
                      onChange={() => handleDiagramToggle(option.value)}
                      data-testid={`checkbox-${option.value}`}
                    />
                    <span className={styles.optionLabel}>{option.label}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            className={styles.secondaryButton}
            onClick={handleCancel}
            data-testid="modal-cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleApply}
            data-testid="modal-apply-button"
          >
            Apply
          </button>
          {onSend && (
            <button
              className={styles.primaryButton}
              onClick={handleSend}
              data-testid="modal-send-button"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
