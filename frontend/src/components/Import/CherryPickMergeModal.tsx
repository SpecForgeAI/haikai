/**
 * CherryPickMergeModal Component
 *
 * Spec 2026-03-05: Import Product Snapshot Redesign
 * Task Group 5: Cherry-Pick Merge Modal (Domain-Tab UI)
 *
 * A modal that uses the same domain-tab layout as ContextPickerModal
 * (6 tabs: Business, Application, Data, Behavioural, UI, Diagrams) with
 * Select All checkboxes per category and individual entity checkboxes.
 *
 * Features:
 * - Six-tab layout matching ContextPickerModal domain tabs
 * - Entity and relationship category groups with three-state Select All checkboxes
 * - Individual entity/relationship checkboxes per category
 * - Diagrams tab with flat checkbox list
 * - Diagram dependency auto-selection (auto-checks referenced entities)
 * - Merge execution with ID conflict resolution
 * - "Merge Selected" disabled when zero items are checked
 *
 * Follows patterns from ContextPickerModal.tsx and ImportDecisionModal.tsx
 *
 * Task Group 7: Cleanup and Test Review
 * - Removed unused 'allTabs' variable in DomainTabStrip (TS6133)
 * - Removed unused 'getEntityIdsFromCheckedDiagrams' function (TS6133)
 */

import React, { useState, useCallback, useMemo } from 'react';
import { ChartNetwork } from 'lucide-react';
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
import { deriveCheckboxState } from '../../utils/selectionUtils';
import {
  resolveIdConflicts,
  buildMergeSummary,
  type CherryPickData,
  type MergeableData,
  type NamedItem,
} from '../../utils/importMergeUtils';
import type { ArchitectureModel, Diagram } from '../../types/model';
import styles from './CherryPickMergeModal.module.css';

// ============================================================================
// Types
// ============================================================================

export interface CherryPickMergeModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Cherry-pickable data extracted from the imported snapshot */
  cherryPickData: CherryPickData;
  /** Current architecture model for ID conflict detection */
  currentModel: ArchitectureModel;
  /** Callback when merge is complete; receives resolved data and summary */
  onMergeComplete: (resolvedData: MergeableData, summary: string) => void;
  /** Whether database persistence is active */
  includeDatabase: boolean;
}

type ActiveTab = ArchitectureDomain | 'diagrams';

// ============================================================================
// Constants: Human-readable labels for collection keys
// ============================================================================

const COLLECTION_LABELS: Record<string, string> = {
  // Entity types
  business_users: 'Business Users',
  business_processes: 'Business Processes',
  process_activities: 'Process Activities',
  applications: 'Applications',
  app_components: 'Application Components',
  services: 'Services',
  interfaces: 'Interfaces',
  endpoints: 'Endpoints',
  logical_data_entities: 'Logical Data Entities',
  physical_data_entities: 'Physical Data Entities',
  events: 'Events',
  states: 'States',
  activities: 'Activities',
  interactions: 'Interactions',
  ui_screens: 'UI Screens',
  ui_components: 'UI Components',
  ui_actions: 'UI Actions',
  // Relationship types
  business_user_business_points: 'Business User Business Points',
  application_point_business_points: 'Application Point Business Points',
  application_point_business_logics: 'Application Point Business Logics',
  logical_data_entity_relationships: 'Logical Data Entity Relationships',
  logical_data_entity_physical_data_entities: 'Logical-Physical Entity Mappings',
  logical_data_attribute_physical_data_attributes: 'Logical-Physical Attribute Mappings',
  data_movements: 'Data Movements',
  interface_logical_entities: 'Interface Entities',
  ui_workflow_transitions: 'UI Workflow Transitions',
};

function getCollectionLabel(key: string): string {
  return COLLECTION_LABELS[key] || key;
}

// ============================================================================
// DomainTabStrip Component
// ============================================================================

interface DomainTabStripProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  hasDiagrams: boolean;
}

/**
 * Icon-based domain tab strip with 6 tabs (5 domains + Diagrams)
 */
function DomainTabStrip({ activeTab, onTabChange, hasDiagrams }: DomainTabStripProps) {
  return (
    <div
      className={styles.domainTabStrip}
      data-testid="domain-tab-strip"
      role="tablist"
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
      {/* Diagrams tab - only shown if there are diagrams */}
      {hasDiagrams && (
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
      )}
    </div>
  );
}

// ============================================================================
// CategoryGroup Component
// ============================================================================

interface CategoryGroupProps {
  collectionKey: string;
  items: NamedItem[];
  selectedIds: Set<string>;
  autoSelectedIds: Set<string>;
  onToggle: (itemId: string) => void;
  onSelectAll: (collectionKey: string, items: NamedItem[], select: boolean) => void;
}

/**
 * Entity or relationship category group with Select All checkbox and individual checkboxes.
 */
function CategoryGroup({
  collectionKey,
  items,
  selectedIds,
  autoSelectedIds,
  onToggle,
  onSelectAll,
}: CategoryGroupProps) {
  const label = getCollectionLabel(collectionKey);

  const selectedCount = useMemo(() => {
    return items.filter((item) => selectedIds.has(item.id)).length;
  }, [items, selectedIds]);

  const selectAllState = deriveCheckboxState(selectedCount, items.length);

  const handleSelectAllChange = useCallback(() => {
    const shouldSelect = selectAllState !== 'checked';
    onSelectAll(collectionKey, items, shouldSelect);
  }, [selectAllState, collectionKey, items, onSelectAll]);

  return (
    <div className={styles.group} data-testid={`category-group-${collectionKey}`}>
      <div className={styles.groupHeader}>
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
          data-testid={`select-all-${collectionKey}`}
        />
        <span className={styles.groupTitle}>{label}</span>
        <span className={styles.groupCount}>({items.length})</span>
      </div>
      <div className={styles.groupContent} data-testid={`group-content-${collectionKey}`}>
        {items.map((item) => {
          const isSelected = selectedIds.has(item.id);
          const isAutoSelected = autoSelectedIds.has(item.id);

          return (
            <div
              key={item.id}
              className={`${styles.optionRow} ${isAutoSelected ? styles.autoSelected : ''}`}
            >
              <label className={styles.optionItem}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={isSelected}
                  onChange={() => onToggle(item.id)}
                  data-testid={`checkbox-${item.id}`}
                />
                <span className={styles.optionLabel}>{item.name}</span>
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function CherryPickMergeModal({
  isOpen,
  onClose,
  cherryPickData,
  currentModel,
  onMergeComplete,
}: CherryPickMergeModalProps) {
  // Tab state - defaults to 'business'
  const [activeTab, setActiveTab] = useState<ActiveTab>('business');

  // ============================================================================
  // Selection State Management (Task 5.3)
  // ============================================================================

  // Entity selection: Map<collectionKey, Set<itemId>>
  const [entitySelections, setEntitySelections] = useState<Map<string, Set<string>>>(new Map());

  // Relationship selection: Map<collectionKey, Set<itemId>>
  const [relationshipSelections, setRelationshipSelections] = useState<Map<string, Set<string>>>(new Map());

  // Diagram selection: Set<diagramId>
  const [diagramSelections, setDiagramSelections] = useState<Set<string>>(new Set());

  // Auto-selected entity IDs (from diagram dependencies) - tracked separately for visual distinction
  const [autoSelectedEntityIds, setAutoSelectedEntityIds] = useState<Set<string>>(new Set());

  // Track which entity IDs were manually selected by the user (not via diagram auto-selection)
  const [manuallySelectedEntityIds, setManuallySelectedEntityIds] = useState<Set<string>>(new Set());

  // Total selected count for enabling/disabling "Merge Selected" button
  const totalSelectedCount = useMemo(() => {
    let count = 0;
    for (const set of entitySelections.values()) count += set.size;
    for (const set of relationshipSelections.values()) count += set.size;
    count += diagramSelections.size;
    return count;
  }, [entitySelections, relationshipSelections, diagramSelections]);

  // Whether the import has diagrams
  const hasDiagrams = cherryPickData.diagrams.length > 0;

  // ============================================================================
  // Entity Toggle Handler
  // ============================================================================

  const handleEntityToggle = useCallback((itemId: string) => {
    // Find which collection this item belongs to
    for (const [collectionKey, items] of Object.entries(cherryPickData.entities)) {
      if (items.some((item) => item.id === itemId)) {
        setEntitySelections((prev) => {
          const newMap = new Map(prev);
          const currentSet = new Set(newMap.get(collectionKey) || []);
          if (currentSet.has(itemId)) {
            currentSet.delete(itemId);
            // Also remove from manual tracking
            setManuallySelectedEntityIds((prevManual) => {
              const newManual = new Set(prevManual);
              newManual.delete(itemId);
              return newManual;
            });
          } else {
            currentSet.add(itemId);
            // Track as manually selected
            setManuallySelectedEntityIds((prevManual) => {
              const newManual = new Set(prevManual);
              newManual.add(itemId);
              return newManual;
            });
          }
          if (currentSet.size === 0) {
            newMap.delete(collectionKey);
          } else {
            newMap.set(collectionKey, currentSet);
          }
          return newMap;
        });
        break;
      }
    }
  }, [cherryPickData.entities]);

  // ============================================================================
  // Entity Select All Handler
  // ============================================================================

  const handleEntitySelectAll = useCallback(
    (collectionKey: string, items: NamedItem[], select: boolean) => {
      setEntitySelections((prev) => {
        const newMap = new Map(prev);
        if (select) {
          const newSet = new Set(items.map((item) => item.id));
          newMap.set(collectionKey, newSet);
          // Track all as manually selected
          setManuallySelectedEntityIds((prevManual) => {
            const newManual = new Set(prevManual);
            for (const item of items) {
              newManual.add(item.id);
            }
            return newManual;
          });
        } else {
          newMap.delete(collectionKey);
          // Remove from manual tracking
          setManuallySelectedEntityIds((prevManual) => {
            const newManual = new Set(prevManual);
            for (const item of items) {
              newManual.delete(item.id);
            }
            return newManual;
          });
        }
        return newMap;
      });
    },
    []
  );

  // ============================================================================
  // Relationship Toggle Handler
  // ============================================================================

  const handleRelationshipToggle = useCallback((itemId: string) => {
    for (const [collectionKey, items] of Object.entries(cherryPickData.relationships)) {
      if (items.some((item) => item.id === itemId)) {
        setRelationshipSelections((prev) => {
          const newMap = new Map(prev);
          const currentSet = new Set(newMap.get(collectionKey) || []);
          if (currentSet.has(itemId)) {
            currentSet.delete(itemId);
          } else {
            currentSet.add(itemId);
          }
          if (currentSet.size === 0) {
            newMap.delete(collectionKey);
          } else {
            newMap.set(collectionKey, currentSet);
          }
          return newMap;
        });
        break;
      }
    }
  }, [cherryPickData.relationships]);

  // ============================================================================
  // Relationship Select All Handler
  // ============================================================================

  const handleRelationshipSelectAll = useCallback(
    (collectionKey: string, items: NamedItem[], select: boolean) => {
      setRelationshipSelections((prev) => {
        const newMap = new Map(prev);
        if (select) {
          const newSet = new Set(items.map((item) => item.id));
          newMap.set(collectionKey, newSet);
        } else {
          newMap.delete(collectionKey);
        }
        return newMap;
      });
    },
    []
  );

  // ============================================================================
  // Build entity ID to collection key lookup for diagram dependency resolution
  // ============================================================================

  const entityIdToCollectionKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const [collectionKey, items] of Object.entries(cherryPickData.entities)) {
      for (const item of items) {
        map.set(item.id, collectionKey);
      }
    }
    return map;
  }, [cherryPickData.entities]);

  // ============================================================================
  // Diagram Dependency Auto-Selection (Task 5.6)
  // ============================================================================

  /**
   * Get all entity IDs referenced by a diagram's diagram_nodes.
   */
  const getDiagramEntityIds = useCallback(
    (diagramItem: NamedItem): string[] => {
      const diagram = diagramItem as unknown as Diagram;
      if (!diagram.diagram_nodes || !Array.isArray(diagram.diagram_nodes)) {
        return [];
      }
      return diagram.diagram_nodes
        .map((node) => node.entity_id)
        .filter((id): id is string => typeof id === 'string');
    },
    []
  );

  // ============================================================================
  // Diagram Toggle Handler
  // ============================================================================

  const handleDiagramToggle = useCallback(
    (diagramId: string) => {
      const diagramItem = cherryPickData.diagrams.find((d) => d.id === diagramId);
      if (!diagramItem) return;

      setDiagramSelections((prev) => {
        const newSet = new Set(prev);
        const isChecking = !newSet.has(diagramId);

        if (isChecking) {
          // Checking this diagram
          newSet.add(diagramId);

          // Auto-select referenced entities
          const referencedEntityIds = getDiagramEntityIds(diagramItem);
          for (const entityId of referencedEntityIds) {
            const collectionKey = entityIdToCollectionKey.get(entityId);
            if (collectionKey) {
              // Add to entity selections
              setEntitySelections((prevSelections) => {
                const newMap = new Map(prevSelections);
                const currentSet = new Set(newMap.get(collectionKey) || []);
                currentSet.add(entityId);
                newMap.set(collectionKey, currentSet);
                return newMap;
              });

              // Track as auto-selected
              setAutoSelectedEntityIds((prevAuto) => {
                const newAuto = new Set(prevAuto);
                newAuto.add(entityId);
                return newAuto;
              });
            }
          }
        } else {
          // Unchecking this diagram
          newSet.delete(diagramId);

          // Determine which entities are still referenced by other checked diagrams
          // We need to calculate using the updated set (with this diagram removed)
          const stillReferencedEntityIds = new Set<string>();
          for (const otherId of newSet) {
            const otherDiagram = cherryPickData.diagrams.find((d) => d.id === otherId);
            if (otherDiagram) {
              for (const entityId of getDiagramEntityIds(otherDiagram)) {
                if (entityIdToCollectionKey.has(entityId)) {
                  stillReferencedEntityIds.add(entityId);
                }
              }
            }
          }

          // For entities that were auto-selected by this diagram but NOT referenced by other
          // checked diagrams and NOT manually selected: uncheck and remove from auto-selected
          const referencedEntityIds = getDiagramEntityIds(diagramItem);
          for (const entityId of referencedEntityIds) {
            const collectionKey = entityIdToCollectionKey.get(entityId);
            if (!collectionKey) continue;

            // Skip if still referenced by another checked diagram
            if (stillReferencedEntityIds.has(entityId)) continue;

            // Skip if manually selected by the user
            if (manuallySelectedEntityIds.has(entityId)) continue;

            // Remove from auto-selected tracking
            setAutoSelectedEntityIds((prevAuto) => {
              const newAuto = new Set(prevAuto);
              newAuto.delete(entityId);
              return newAuto;
            });

            // Remove from entity selections
            setEntitySelections((prevSelections) => {
              const newMap = new Map(prevSelections);
              const currentSet = new Set(newMap.get(collectionKey) || []);
              currentSet.delete(entityId);
              if (currentSet.size === 0) {
                newMap.delete(collectionKey);
              } else {
                newMap.set(collectionKey, currentSet);
              }
              return newMap;
            });
          }
        }

        return newSet;
      });
    },
    [
      cherryPickData.diagrams,
      getDiagramEntityIds,
      entityIdToCollectionKey,
      manuallySelectedEntityIds,
    ]
  );

  // ============================================================================
  // Merge Execution Flow (Task 5.7)
  // ============================================================================

  const handleMergeSelected = useCallback(() => {
    // 1. Build MergeableData from selected items
    const selectedEntities: Record<string, unknown[]> = {};
    for (const [collectionKey, selectedIds] of entitySelections.entries()) {
      const items = cherryPickData.entities[collectionKey] || [];
      const selectedItems = items.filter((item) => selectedIds.has(item.id));
      if (selectedItems.length > 0) {
        selectedEntities[collectionKey] = selectedItems;
      }
    }

    const selectedRelationships: Record<string, unknown[]> = {};
    for (const [collectionKey, selectedIds] of relationshipSelections.entries()) {
      const items = cherryPickData.relationships[collectionKey] || [];
      const selectedItems = items.filter((item) => selectedIds.has(item.id));
      if (selectedItems.length > 0) {
        selectedRelationships[collectionKey] = selectedItems;
      }
    }

    const selectedDiagrams: Diagram[] = [];
    for (const diagramId of diagramSelections) {
      const diagramItem = cherryPickData.diagrams.find((d) => d.id === diagramId);
      if (diagramItem) {
        selectedDiagrams.push(diagramItem as unknown as Diagram);
      }
    }

    const selectedData: MergeableData = {
      entities: selectedEntities,
      relationships: selectedRelationships,
      diagrams: selectedDiagrams,
    };

    // 2. Resolve ID conflicts
    const resolvedData = resolveIdConflicts(selectedData, currentModel);

    // 3. Build summary
    const summary = buildMergeSummary(resolvedData);

    // 4. Notify parent with resolved data and summary
    onMergeComplete(resolvedData, summary);

    // 5. Close modal
    onClose();
  }, [
    entitySelections,
    relationshipSelections,
    diagramSelections,
    cherryPickData,
    currentModel,
    onMergeComplete,
    onClose,
  ]);

  // ============================================================================
  // Helper: get selected entity IDs as a flat set (for CategoryGroup)
  // ============================================================================

  const allSelectedEntityIds = useMemo(() => {
    const set = new Set<string>();
    for (const ids of entitySelections.values()) {
      for (const id of ids) {
        set.add(id);
      }
    }
    return set;
  }, [entitySelections]);

  const allSelectedRelationshipIds = useMemo(() => {
    const set = new Set<string>();
    for (const ids of relationshipSelections.values()) {
      for (const id of ids) {
        set.add(id);
      }
    }
    return set;
  }, [relationshipSelections]);

  // ============================================================================
  // Handle overlay click and keyboard
  // ============================================================================

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  // ============================================================================
  // Render
  // ============================================================================

  if (!isOpen) {
    return null;
  }

  const isDomainTab = activeTab !== 'diagrams';

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      data-testid="cherry-pick-merge-modal"
    >
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Cherry-Pick Merge</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            title="Close"
            data-testid="modal-close-button"
          >
            &times;
          </button>
        </div>

        {/* Domain Tab Strip */}
        <DomainTabStrip
          activeTab={activeTab}
          onTabChange={setActiveTab}
          hasDiagrams={hasDiagrams}
        />

        {/* Content */}
        <div className={styles.content}>
          {/* Domain tab content (5 architecture domains) */}
          {isDomainTab && (
            <div data-testid="domain-content">
              {/* Entity groups for this domain */}
              {(DOMAIN_TO_ENTITY_TYPES[activeTab as ArchitectureDomain] || []).map(
                (collectionKey) => {
                  const items = cherryPickData.entities[collectionKey];
                  if (!items || items.length === 0) return null;

                  return (
                    <CategoryGroup
                      key={collectionKey}
                      collectionKey={collectionKey}
                      items={items}
                      selectedIds={allSelectedEntityIds}
                      autoSelectedIds={autoSelectedEntityIds}
                      onToggle={handleEntityToggle}
                      onSelectAll={handleEntitySelectAll}
                    />
                  );
                }
              )}

              {/* Relationship groups for this domain */}
              {(DOMAIN_TO_RELATIONSHIP_TYPES[activeTab as ArchitectureDomain] || []).map(
                (collectionKey) => {
                  const items = cherryPickData.relationships[collectionKey];
                  if (!items || items.length === 0) return null;

                  return (
                    <CategoryGroup
                      key={collectionKey}
                      collectionKey={collectionKey}
                      items={items}
                      selectedIds={allSelectedRelationshipIds}
                      autoSelectedIds={new Set()}
                      onToggle={handleRelationshipToggle}
                      onSelectAll={handleRelationshipSelectAll}
                    />
                  );
                }
              )}

              {/* Empty state when no entity or relationship data for this domain */}
              {(DOMAIN_TO_ENTITY_TYPES[activeTab as ArchitectureDomain] || []).every(
                (key) => !cherryPickData.entities[key] || cherryPickData.entities[key].length === 0
              ) &&
                (DOMAIN_TO_RELATIONSHIP_TYPES[activeTab as ArchitectureDomain] || []).every(
                  (key) =>
                    !cherryPickData.relationships[key] ||
                    cherryPickData.relationships[key].length === 0
                ) && (
                  <div className={styles.emptyState}>
                    No items available in this domain.
                  </div>
                )}
            </div>
          )}

          {/* Diagrams tab content */}
          {activeTab === 'diagrams' && hasDiagrams && (
            <div data-testid="diagrams-content">
              {cherryPickData.diagrams.map((diagram) => (
                <div key={diagram.id} className={styles.optionRow}>
                  <label className={styles.optionItem}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={diagramSelections.has(diagram.id)}
                      onChange={() => handleDiagramToggle(diagram.id)}
                      data-testid={`checkbox-diagram-${diagram.id}`}
                    />
                    <span className={styles.optionLabel}>{diagram.name}</span>
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            className={styles.secondaryButton}
            onClick={onClose}
            data-testid="modal-cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleMergeSelected}
            disabled={totalSelectedCount === 0}
            data-testid="merge-selected-button"
          >
            Merge Selected
          </button>
        </div>
      </div>
    </div>
  );
}
