/**
 * MappingConfirmationModal Component
 *
 * Spec: Mapping Confirmation Modal Framework (Increment 6)
 * Task Group 3: Standalone modal for confirming/resolving diagram mappings
 *
 * This modal auto-opens when deterministic auto-mapping produces a `partially_matched`
 * or `no_matches` result, allowing users to manually resolve unresolved mappings and
 * override auto-matched items via dropdown selects before producing a fully-resolved
 * `CompletedDiagramMapping` output.
 *
 * Three sections: Entities, Attributes, Relationships
 * - Entity changes cascade to attribute reset/revalidation and edge re-evaluation
 * - Confirm button disabled until all items resolved
 * - Footer shows resolved/total counter
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { MetaModel } from '../../types/model';
import {
  TemporaryArchitectureDiagram,
  TemporaryArchitectureDiagramNode,
} from '../../types/temporaryArchitectureDiagram';
import {
  DiagramMappingResult,
  AttributeMappingRecord,
} from '../../utils/temporaryDiagramMapping';
import {
  CompletedDiagramMapping,
  buildEntityCandidates,
  buildAttributeCandidates,
  buildRelationshipCandidates,
  initializeSelectionsFromMappingResult,
  cascadeEntityChange,
  computeValidationState,
  buildCompletedMapping,
  CARDINALITY_OPTIONS,
  CARDINALITY_LABELS,
  RELATIONSHIP_TYPE_OPTIONS,
  RELATIONSHIP_TYPE_LABELS,
  NEW_RELATIONSHIP_SENTINEL,
} from '../../utils/mappingConfirmationUtils';
import styles from './MappingConfirmationModal.module.css';

// ============================================================================
// PROPS
// ============================================================================

export interface MappingConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (completed: CompletedDiagramMapping) => void;
  mappingResult: DiagramMappingResult;
  temporaryDiagram: TemporaryArchitectureDiagram;
  metaModel: MetaModel;
}

// ============================================================================
// HELPER: Find node in temporary diagram by ID
// ============================================================================

function findNodeById(
  nodes: TemporaryArchitectureDiagramNode[],
  nodeId: string
): TemporaryArchitectureDiagramNode | undefined {
  return nodes.find((n) => n.id === nodeId);
}

/**
 * Find a compartment item's ref_name and display_name by its ID in the temporary diagram.
 */
function findCompartmentItem(
  nodes: TemporaryArchitectureDiagramNode[],
  itemId: string
): { ref_name: string; display_name: string } | undefined {
  for (const node of nodes) {
    for (const compartment of node.compartments || []) {
      for (const item of compartment.items || []) {
        if (item.id === itemId) {
          return { ref_name: item.ref_name, display_name: item.display_name };
        }
      }
    }
  }
  return undefined;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function MappingConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  mappingResult,
  temporaryDiagram,
  metaModel,
}: MappingConfirmationModalProps) {
  // ---- State: editable selections ----
  const [entitySelections, setEntitySelections] = useState<Record<string, string>>({});
  const [attributeSelections, setAttributeSelections] = useState<Record<string, string>>({});
  // Edge Box 1: existing relationship ID, NEW sentinel, or '' (no selection yet)
  const [edgeSelections, setEdgeSelections] = useState<Record<string, string>>({});
  // Edge Box 2: cardinality enum value (only meaningful when Box 1 = NEW)
  const [edgeCardinalitySelections, setEdgeCardinalitySelections] = useState<Record<string, string>>({});
  // Edge Box 3: relationship type enum value (only meaningful when Box 1 = NEW)
  const [edgeRelationshipTypeSelections, setEdgeRelationshipTypeSelections] = useState<Record<string, string>>({});

  // Lookup: existing relationship by ID (for auto-populating Boxes 2+3 when user picks existing)
  const relationshipById = useMemo(() => {
    const map = new Map<string, { cardinality?: string; relationship?: string }>();
    const rels = metaModel?.relationships?.logical_data_entity_relationships || [];
    for (const rel of rels) {
      map.set(rel.id, { cardinality: rel.cardinality, relationship: rel.relationship });
    }
    return map;
  }, [metaModel]);

  // ---- Initialize selections when modal opens ----
  useEffect(() => {
    if (isOpen) {
      const initial = initializeSelectionsFromMappingResult(mappingResult);
      setEntitySelections(initial.entitySelections);
      setAttributeSelections(initial.attributeSelections);

      // Initialize edge 3-box state using existing-match → use it; otherwise NEW
      const boxOne: Record<string, string> = {};
      const boxTwo: Record<string, string> = {};
      const boxThree: Record<string, string> = {};
      const tempEdgeById = new Map((temporaryDiagram.edges || []).map((e) => [e.id, e]));

      for (const edge of mappingResult.edges) {
        const existingRelId = edge.matchedRelationshipId;
        if (existingRelId) {
          boxOne[edge.temporaryEdgeId] = existingRelId;
          const rel = relationshipById.get(existingRelId);
          boxTwo[edge.temporaryEdgeId] = rel?.cardinality ?? '';
          boxThree[edge.temporaryEdgeId] = rel?.relationship ?? '';
        } else {
          boxOne[edge.temporaryEdgeId] = NEW_RELATIONSHIP_SENTINEL;
          const tempEdge = tempEdgeById.get(edge.temporaryEdgeId);
          boxTwo[edge.temporaryEdgeId] = tempEdge?.cardinality ?? '';
          boxThree[edge.temporaryEdgeId] = tempEdge?.relationship_type ?? '';
        }
      }
      setEdgeSelections(boxOne);
      setEdgeCardinalitySelections(boxTwo);
      setEdgeRelationshipTypeSelections(boxThree);
    }
  }, [isOpen, mappingResult, temporaryDiagram, relationshipById]);

  // ---- Escape key handler ----
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // ---- Derived: viewMode ----
  const viewMode = temporaryDiagram.view_mode;

  // ---- Entity candidates (same for all entity rows) ----
  const entityCandidates = useMemo(
    () => buildEntityCandidates(metaModel, viewMode),
    [metaModel, viewMode]
  );

  // ---- Validation ----
  const validation = useMemo(
    () =>
      computeValidationState(
        entitySelections,
        attributeSelections,
        edgeSelections,
        edgeCardinalitySelections,
        edgeRelationshipTypeSelections
      ),
    [entitySelections, attributeSelections, edgeSelections, edgeCardinalitySelections, edgeRelationshipTypeSelections]
  );

  // ---- Handler: entity selection change ----
  const handleEntityChange = useCallback(
    (nodeId: string, newEntityId: string) => {
      const updatedEntitySelections = { ...entitySelections, [nodeId]: newEntityId };
      setEntitySelections(updatedEntitySelections);

      // Cascade to attributes and edges
      const cascadeResult = cascadeEntityChange(
        nodeId,
        newEntityId,
        attributeSelections,
        edgeSelections,
        temporaryDiagram,
        metaModel,
        viewMode,
        mappingResult,
        updatedEntitySelections
      );

      setAttributeSelections(cascadeResult.attributeSelections);
      setEdgeSelections(cascadeResult.edgeSelections);
    },
    [entitySelections, attributeSelections, edgeSelections, temporaryDiagram, metaModel, viewMode, mappingResult]
  );

  // ---- Handler: attribute selection change ----
  const handleAttributeChange = useCallback(
    (itemId: string, newAttributeId: string) => {
      setAttributeSelections((prev) => ({ ...prev, [itemId]: newAttributeId }));
    },
    []
  );

  // ---- Handler: edge Box 1 (relationship) selection change ----
  const handleEdgeChange = useCallback(
    (edgeId: string, newValue: string) => {
      setEdgeSelections((prev) => ({ ...prev, [edgeId]: newValue }));

      if (newValue === NEW_RELATIONSHIP_SENTINEL) {
        // Switching to NEW: preserve current Box 2/3 values (they may already hold LLM proposals).
        return;
      }
      if (newValue === '') {
        // Cleared: also clear Box 2/3.
        setEdgeCardinalitySelections((prev) => ({ ...prev, [edgeId]: '' }));
        setEdgeRelationshipTypeSelections((prev) => ({ ...prev, [edgeId]: '' }));
        return;
      }
      // Picked an existing relationship: auto-populate Box 2/3 from it.
      const rel = relationshipById.get(newValue);
      setEdgeCardinalitySelections((prev) => ({ ...prev, [edgeId]: rel?.cardinality ?? '' }));
      setEdgeRelationshipTypeSelections((prev) => ({ ...prev, [edgeId]: rel?.relationship ?? '' }));
    },
    [relationshipById]
  );

  // ---- Handler: edge Box 2 (cardinality) change ----
  const handleEdgeCardinalityChange = useCallback((edgeId: string, value: string) => {
    setEdgeCardinalitySelections((prev) => ({ ...prev, [edgeId]: value }));
  }, []);

  // ---- Handler: edge Box 3 (relationship type) change ----
  const handleEdgeRelationshipTypeChange = useCallback((edgeId: string, value: string) => {
    setEdgeRelationshipTypeSelections((prev) => ({ ...prev, [edgeId]: value }));
  }, []);

  // ---- Handler: overlay click ----
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // ---- Handler: confirm (partial confirm allowed — unresolved items are skipped) ----
  const handleConfirm = useCallback(() => {
    const completed = buildCompletedMapping(
      entitySelections,
      attributeSelections,
      edgeSelections,
      edgeCardinalitySelections,
      edgeRelationshipTypeSelections,
      temporaryDiagram,
      viewMode,
      mappingResult
    );
    onConfirm(completed);
  }, [entitySelections, attributeSelections, edgeSelections, edgeCardinalitySelections, edgeRelationshipTypeSelections, temporaryDiagram, viewMode, mappingResult, onConfirm]);

  // ---- Guard: don't render when not open ----
  if (!isOpen) {
    return null;
  }

  // ---- Guard: metaModel null edge case ----
  if (!metaModel) {
    return (
      <div
        className={styles.overlay}
        onClick={handleOverlayClick}
        data-testid="mapping-confirmation-modal"
      >
        <div className={styles.modal}>
          <div className={styles.header}>
            <div className={styles.headerLeft}>
              <h2 className={styles.title}>Confirm Diagram Mappings</h2>
            </div>
            <button
              className={styles.closeButton}
              onClick={onClose}
              title="Close"
              data-testid="modal-close-button"
            >
              &times;
            </button>
          </div>
          <div className={styles.content}>
            <div className={styles.disabledMessage}>
              Meta-model not available. Cannot resolve mappings.
            </div>
          </div>
          <div className={styles.footer}>
            <div />
            <div className={styles.footerActions}>
              <button className={styles.secondaryButton} onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- Group attributes by parent node ID ----
  const attributesByNode: Record<string, AttributeMappingRecord[]> = {};
  for (const attr of mappingResult.attributes) {
    if (!attributesByNode[attr.parentTemporaryNodeId]) {
      attributesByNode[attr.parentTemporaryNodeId] = [];
    }
    attributesByNode[attr.parentTemporaryNodeId].push(attr);
  }

  // ---- Render ----
  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="mapping-confirmation-modal"
    >
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <h2 className={styles.title}>Confirm Diagram Mappings</h2>
          </div>
          <button
            className={styles.closeButton}
            onClick={onClose}
            title="Close"
            data-testid="modal-close-button"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {/* === Entities Section === */}
          <div className={styles.section} data-testid="entities-section">
            <div className={styles.sectionTitle}>Entities</div>
            {mappingResult.nodes.map((nodeRecord) => {
              const node = findNodeById(temporaryDiagram.nodes || [], nodeRecord.temporaryNodeId);
              const nodeName = node?.ref_name ?? node?.display_name ?? nodeRecord.temporaryNodeId;

              // mode_mismatch: render warning row
              if (nodeRecord.reasonCode === 'mode_mismatch') {
                return (
                  <div
                    key={nodeRecord.temporaryNodeId}
                    className={styles.warningRow}
                    data-testid={`entity-row-${nodeRecord.temporaryNodeId}`}
                  >
                    <span className={styles.mappingName}>{nodeName}</span>
                    <span className={styles.warningText}>
                      Mode mismatch: this entity type does not match the diagram view mode
                    </span>
                  </div>
                );
              }

              const isAutoMatched = nodeRecord.status === 'matched';
              const currentValue = entitySelections[nodeRecord.temporaryNodeId] ?? '';

              return (
                <div
                  key={nodeRecord.temporaryNodeId}
                  className={styles.mappingRow}
                  data-testid={`entity-row-${nodeRecord.temporaryNodeId}`}
                >
                  <span className={styles.mappingName}>{nodeName}</span>
                  <span
                    className={`${styles.statusBadge} ${isAutoMatched ? styles.auto : styles.unresolved}`}
                    data-testid={`entity-badge-${nodeRecord.temporaryNodeId}`}
                  >
                    {isAutoMatched ? 'Auto' : 'Unresolved'}
                  </span>
                  <select
                    className={styles.select}
                    value={currentValue}
                    onChange={(e) =>
                      handleEntityChange(nodeRecord.temporaryNodeId, e.target.value)
                    }
                    data-testid={`entity-select-${nodeRecord.temporaryNodeId}`}
                  >
                    <option value="">-- Select Entity --</option>
                    {entityCandidates.length === 0 ? (
                      <option value="" disabled>
                        No candidates available
                      </option>
                    ) : (
                      entityCandidates.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              );
            })}
          </div>

          {/* === Attributes Section === */}
          {mappingResult.attributes.length > 0 && (
            <div className={styles.section} data-testid="attributes-section">
              <div className={styles.sectionTitle}>Attributes</div>
              {mappingResult.nodes.map((nodeRecord) => {
                const nodeAttrs = attributesByNode[nodeRecord.temporaryNodeId];
                if (!nodeAttrs || nodeAttrs.length === 0) return null;

                const node = findNodeById(temporaryDiagram.nodes || [], nodeRecord.temporaryNodeId);
                const nodeLabel = node?.ref_name ?? nodeRecord.temporaryNodeId;
                const parentEntityId = entitySelections[nodeRecord.temporaryNodeId] ?? '';

                return (
                  <div key={nodeRecord.temporaryNodeId}>
                    <div className={styles.groupHeading}>{nodeLabel}</div>
                    {nodeAttrs.map((attrRecord) => {
                      const itemInfo = findCompartmentItem(
                        temporaryDiagram.nodes || [],
                        attrRecord.temporaryItemId
                      );
                      const attrName =
                        itemInfo?.ref_name ?? itemInfo?.display_name ?? attrRecord.temporaryItemId;
                      const isAutoMatched = attrRecord.status === 'matched';
                      const currentValue = attributeSelections[attrRecord.temporaryItemId] ?? '';

                      // Build attribute candidates for this parent entity
                      const attrCandidates = parentEntityId
                        ? buildAttributeCandidates(metaModel, viewMode, parentEntityId)
                        : [];

                      if (!parentEntityId) {
                        return (
                          <div
                            key={attrRecord.temporaryItemId}
                            className={styles.mappingRow}
                            data-testid={`attribute-row-${attrRecord.temporaryItemId}`}
                          >
                            <span className={styles.mappingName}>{attrName}</span>
                            <span
                              className={`${styles.statusBadge} ${isAutoMatched ? styles.auto : styles.unresolved}`}
                            >
                              {isAutoMatched ? 'Auto' : 'Unresolved'}
                            </span>
                            <span className={styles.disabledHint}>
                              Select parent entity first
                            </span>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={attrRecord.temporaryItemId}
                          className={styles.mappingRow}
                          data-testid={`attribute-row-${attrRecord.temporaryItemId}`}
                        >
                          <span className={styles.mappingName}>{attrName}</span>
                          <span
                            className={`${styles.statusBadge} ${isAutoMatched ? styles.auto : styles.unresolved}`}
                          >
                            {isAutoMatched ? 'Auto' : 'Unresolved'}
                          </span>
                          <select
                            className={styles.select}
                            value={currentValue}
                            onChange={(e) =>
                              handleAttributeChange(attrRecord.temporaryItemId, e.target.value)
                            }
                            data-testid={`attribute-select-${attrRecord.temporaryItemId}`}
                          >
                            <option value="">-- Select Attribute --</option>
                            {attrCandidates.length === 0 ? (
                              <option value="" disabled>
                                No candidates available
                              </option>
                            ) : (
                              attrCandidates.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.name}
                                </option>
                              ))
                            )}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {/* === Relationships Section === */}
          {mappingResult.edges.length > 0 && (
            <div className={styles.section} data-testid="relationships-section">
              <div className={styles.sectionTitle}>Relationships</div>
              {mappingResult.edges.map((edgeRecord) => {
                const edge = (temporaryDiagram.edges || []).find(
                  (e) => e.id === edgeRecord.temporaryEdgeId
                );
                const sourceRefName = edge?.source_ref_name ?? 'Unknown';
                const targetRefName = edge?.target_ref_name ?? 'Unknown';
                const sourceNodeId = edge?.source_node_id ?? '';
                const targetNodeId = edge?.target_node_id ?? '';

                const sourceEntityId = entitySelections[sourceNodeId] ?? '';
                const targetEntityId = entitySelections[targetNodeId] ?? '';
                const bothEndpointsSelected = sourceEntityId !== '' && targetEntityId !== '';

                const relCandidates = bothEndpointsSelected
                  ? buildRelationshipCandidates(metaModel, sourceEntityId, targetEntityId, viewMode)
                  : [];

                const isAutoMatched = edgeRecord.status === 'matched';
                const boxOneValue = edgeSelections[edgeRecord.temporaryEdgeId] ?? '';
                const boxTwoValue = edgeCardinalitySelections[edgeRecord.temporaryEdgeId] ?? '';
                const boxThreeValue = edgeRelationshipTypeSelections[edgeRecord.temporaryEdgeId] ?? '';
                const isNew = boxOneValue === NEW_RELATIONSHIP_SENTINEL;
                const box23Disabled = !isNew && boxOneValue !== '';

                return (
                  <div
                    key={edgeRecord.temporaryEdgeId}
                    className={styles.mappingRow}
                    data-testid={`edge-row-${edgeRecord.temporaryEdgeId}`}
                  >
                    <span className={styles.mappingName}>
                      <span className={styles.edgeLabel}>{sourceRefName}</span>
                      <span className={styles.edgeArrow}> &rarr; </span>
                      <span className={styles.edgeLabel}>{targetRefName}</span>
                    </span>
                    <span
                      className={`${styles.statusBadge} ${isAutoMatched ? styles.auto : styles.unresolved}`}
                    >
                      {isAutoMatched ? 'Auto' : 'Unresolved'}
                    </span>
                    {!bothEndpointsSelected ? (
                      <span className={styles.disabledHint}>
                        Select both endpoint entities first
                      </span>
                    ) : (
                      <div className={styles.edgeSelects}>
                        <select
                          className={styles.selectSmall}
                          value={boxOneValue}
                          onChange={(e) =>
                            handleEdgeChange(edgeRecord.temporaryEdgeId, e.target.value)
                          }
                          data-testid={`edge-select-${edgeRecord.temporaryEdgeId}`}
                        >
                          <option value="">-- Select Relationship --</option>
                          <option value={NEW_RELATIONSHIP_SENTINEL}>[NEW]</option>
                          {relCandidates.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.label}
                            </option>
                          ))}
                        </select>
                        <select
                          className={styles.selectSmall}
                          value={boxTwoValue}
                          disabled={box23Disabled}
                          onChange={(e) =>
                            handleEdgeCardinalityChange(edgeRecord.temporaryEdgeId, e.target.value)
                          }
                          data-testid={`edge-cardinality-${edgeRecord.temporaryEdgeId}`}
                        >
                          <option value="">-- Cardinality --</option>
                          {CARDINALITY_OPTIONS.map((c) => (
                            <option key={c} value={c}>
                              {CARDINALITY_LABELS[c]}
                            </option>
                          ))}
                        </select>
                        <select
                          className={styles.selectSmall}
                          value={boxThreeValue}
                          disabled={box23Disabled}
                          onChange={(e) =>
                            handleEdgeRelationshipTypeChange(edgeRecord.temporaryEdgeId, e.target.value)
                          }
                          data-testid={`edge-relationship-type-${edgeRecord.temporaryEdgeId}`}
                        >
                          <option value="">-- Relationship Type --</option>
                          {RELATIONSHIP_TYPE_OPTIONS.map((r) => (
                            <option key={r} value={r}>
                              {RELATIONSHIP_TYPE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.summaryBar} data-testid="summary-bar">
            <span
              className={`${styles.summaryCount} ${validation.isAllResolved ? styles.summaryAllResolved : ''}`}
            >
              {validation.resolvedCount}
            </span>
            <span>of</span>
            <span className={styles.summaryCount}>{validation.totalCount}</span>
            <span>resolved</span>
          </div>
          <div className={styles.footerActions}>
            <button
              className={styles.secondaryButton}
              onClick={onClose}
              data-testid="modal-cancel-button"
            >
              Cancel
            </button>
            <button
              className={styles.primaryButton}
              onClick={handleConfirm}
              disabled={validation.resolvedCount === 0}
              data-testid="modal-confirm-button"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
