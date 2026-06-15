/**
 * TargetArchitectureCompareView
 *
 * Spec: 2026-05-20 Target Architecture Authoring Flow -- Task Group 8 (8.4).
 * Spec: 2026-05-24 Target State Sub-tab + Deterministic Suggest -- Task Group 4
 *   (4.5: dropped the workspace-side per-element provenance overlay
 *   map; provenance is uniformly `'cloned-from'` server-side
 *   under the deterministic Suggest path, so the compare view no longer
 *   accepts an overlay map. The Provenance / Status columns remain in the
 *   table layout but render `--` until the AMS inventory DTOs surface
 *   provenance / decommissioning natively).
 * Spec: 2026-05-26 Compare View Decoration with Decision Codes -- Task Group 3
 *   (architecture-scope banner above the panel + element-scope chips inline
 *   within the Target cell; Q4 keeps the table at 5 columns).
 *
 * Stacked-rows comparison table contrasting the current architecture against
 * the selected target architecture. NO visual side-by-side diagrams -- the
 * spec is explicit ("Compare view has NO visual side-by-side diagrams
 * (deferred per Q6)"). The compare surface is table-only.
 *
 * Layout per spec.md "Frontend compare view":
 *   - Each row is a (current element, mapping, target element) triplet.
 *   - Rows grouped by element type (component / api / data-entity /
 *     infrastructure).
 *   - Provenance + decommissioning columns on the target side (placeholder
 *     `--` until AMS surfaces those fields on the inventory wire).
 *   - Rows where current has no target counterpart surface a
 *     "decommissioned in target" annotation chip (sourced from the
 *     `decommissioned-in-target-annotations` endpoint).
 *   - Rows where target has no current counterpart surface a "brand-new"
 *     chip (target-only row).
 *
 * Data sources passed in by the parent workspace (already fetched there):
 *   - `currentInventory`: ElementInventoryResponse for the current arch.
 *   - `targetInventory`: ElementInventoryResponse for the selected target
 *     draft.
 *   - `decommissionedAnnotations`: derived rows from AMS describing which
 *     current elements have no live target mapping or whose only mappings
 *     all point at decommissioned target elements.
 *   - `capturedDecisions`: latest-only captured decisions for the target
 *     architecture (workspace filters out supersededById !== null; chip is
 *     belt-and-braces defense-in-depth per spec 2026-05-26 Q11 test 3).
 *
 * Test-friendly data shape:
 *   The component is purely presentational -- all data is passed in via
 *   props.
 */

import React, { useMemo } from 'react';
import type { ElementInventoryResponse } from '../../api/architecturesApi';
import type { DecommissionedInTargetAnnotation } from '../../api/targetArchitecturesApi';
import type { CapturedDecisionDto } from '../../api/architectConversationApi';
import { CapturedDecisionChip } from './CapturedDecisionChip';
import styles from './TargetArchitectureWorkspace.module.css';

// ---------------------------------------------------------------------------
// Element-type buckets (kept in sync with TargetArchitectureWorkspace's
// `bucketise` helper).
// ---------------------------------------------------------------------------

export type CompareGroupKey =
  | 'component'
  | 'api'
  | 'dataEntity'
  | 'infrastructure';

const GROUP_LABEL: Record<CompareGroupKey, string> = {
  component: 'Components',
  api: 'APIs',
  dataEntity: 'Data entities',
  infrastructure: 'Infrastructure',
};

interface BucketRow {
  id: string;
  name: string;
  entityType: string;
}

function bucketise(
  inventory: ElementInventoryResponse | null,
): Record<CompareGroupKey, BucketRow[]> {
  const out: Record<CompareGroupKey, BucketRow[]> = {
    component: [],
    api: [],
    dataEntity: [],
    infrastructure: [],
  };
  if (!inventory) return out;

  for (const dom of inventory.domains) {
    const domName = dom.name.toLowerCase();
    for (const type of dom.types) {
      const typeName = type.name.toLowerCase();
      for (const inst of type.instances) {
        const row: BucketRow = {
          id: inst.id,
          name: inst.name,
          entityType: type.entityType ?? type.name,
        };
        if (
          domName === 'applications' ||
          domName === 'application'
        ) {
          if (
            typeName === 'services' ||
            typeName === 'interfaces' ||
            typeName === 'endpoints'
          ) {
            out.api.push(row);
          } else {
            out.component.push(row);
          }
        } else if (domName === 'data') {
          out.dataEntity.push(row);
        } else if (domName === 'infrastructure') {
          out.infrastructure.push(row);
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

/**
 * Mapping linking a current-arch element to a target-arch element. Provided
 * as input; the compare view does not compute mappings on its own.
 */
export interface CompareMapping {
  currentElementId: string;
  targetElementId: string;
  mappingType?: string;
}

export interface TargetArchitectureCompareViewProps {
  currentInventory: ElementInventoryResponse | null;
  targetInventory: ElementInventoryResponse | null;
  mappings: CompareMapping[];
  /** Derived "decommissioned in target" annotations keyed by current element id. */
  decommissionedAnnotations: DecommissionedInTargetAnnotation[];
  /**
   * Captured decisions for the target architecture (spec 2026-05-26).
   * Already filtered to `supersededById === null` at the workspace level;
   * the chip applies belt-and-braces defense-in-depth on render.
   * Defaults to empty array when omitted (progressive enhancement Q9).
   */
  capturedDecisions?: CapturedDecisionDto[];
  /**
   * Callback fired when the user clicks "View in conversation" inside a
   * decision chip's popover. The workspace flips its view-mode tab to
   * `'conversation'` and stashes the decisionId so the conversation pane
   * can scroll to the matching `decision-captured` turn. Per Q3 a callback
   * path is used instead of URL-hash navigation because the workspace's
   * viewMode is local React state, not URL-driven.
   */
  onOpenInConversation?: (decisionId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TargetArchitectureCompareView: React.FC<
  TargetArchitectureCompareViewProps
> = ({
  currentInventory,
  targetInventory,
  mappings,
  decommissionedAnnotations,
  capturedDecisions = [],
  onOpenInConversation,
}) => {
  const currentBuckets = useMemo(
    () => bucketise(currentInventory),
    [currentInventory],
  );
  const targetBuckets = useMemo(
    () => bucketise(targetInventory),
    [targetInventory],
  );

  // Build current -> target id index from mappings. A current element may
  // map to multiple target elements; we keep them all and surface one row
  // per matched pair.
  const targetIdsByCurrentId = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const m of mappings) {
      const list = out.get(m.currentElementId) ?? [];
      list.push(m.targetElementId);
      out.set(m.currentElementId, list);
    }
    return out;
  }, [mappings]);

  // Inverse: which target ids are mapped to at all (so we can detect the
  // "brand-new in target" rows).
  const mappedTargetIds = useMemo(() => {
    const s = new Set<string>();
    for (const m of mappings) s.add(m.targetElementId);
    return s;
  }, [mappings]);

  // Quick lookup for the decommissioned-in-target annotations.
  const decomByCurrentId = useMemo(() => {
    const out = new Map<string, DecommissionedInTargetAnnotation>();
    for (const ann of decommissionedAnnotations) {
      out.set(ann.elementId, ann);
    }
    return out;
  }, [decommissionedAnnotations]);

  // -------------------------------------------------------------------------
  // Captured-decision decoration (spec 2026-05-26).
  //
  // The architecture-wide decisions banner was REMOVED from the compare view
  // (2026-06-01): it duplicated the Architect Conversation and the layout made
  // it crowd the comparison table off the screen. Only the element-scope inline
  // chips remain. Defense-in-depth: filter supersededById === null even though
  // the workspace's fetch already does this.
  // -------------------------------------------------------------------------
  const elementScopeDecisionsByTargetId = useMemo(() => {
    const out = new Map<string, CapturedDecisionDto[]>();
    for (const d of capturedDecisions) {
      if (d.scopeKind !== 'element') continue;
      if (d.supersededById !== null) continue;
      if (!d.scopeRefId) continue;
      const list = out.get(d.scopeRefId) ?? [];
      list.push(d);
      out.set(d.scopeRefId, list);
    }
    return out;
  }, [capturedDecisions]);

  // Render one bucket at a time so rows can be grouped by element type per
  // the spec.
  const groupKeys: CompareGroupKey[] = [
    'component',
    'api',
    'dataEntity',
    'infrastructure',
  ];

  // Small helper to render the inline chip group inside a Target cell.
  // Returns null when no element-scope decisions match the targetId so the
  // Target cell stays clean (no `--` placeholder per spec).
  const renderTargetCellChips = (targetId: string | null): React.ReactNode => {
    if (!targetId) return null;
    const decisions = elementScopeDecisionsByTargetId.get(targetId);
    if (!decisions || decisions.length === 0) return null;
    return (
      <div
        className={styles.capturedDecisionChipGroup}
        data-testid={`target-arch-compare-decision-chips-${targetId}`}
      >
        {decisions.map(d => (
          <CapturedDecisionChip
            key={d.decisionId}
            decision={d}
            onOpenInConversation={onOpenInConversation}
          />
        ))}
      </div>
    );
  };

  return (
    <>
      <div
        className={styles.compareViewPanel}
        data-testid="target-arch-compare-view"
      >
        {groupKeys.map(groupKey => {
          const currentRows = currentBuckets[groupKey];
          const targetRows = targetBuckets[groupKey];
          const targetById = new Map(targetRows.map(r => [r.id, r]));

          // Brand-new rows are target rows with no incoming mapping.
          const brandNewTargets = targetRows.filter(
            tr => !mappedTargetIds.has(tr.id),
          );

          if (currentRows.length === 0 && targetRows.length === 0) {
            // Skip empty groups entirely so the compare view stays compact.
            return null;
          }

          return (
            <div
              key={groupKey}
              data-testid={`target-arch-compare-group-${groupKey}`}
              className={styles.compareGroup}
            >
              <h4 className={styles.groupHeader}>{GROUP_LABEL[groupKey]}</h4>
              <table className={styles.compareTable}>
                <thead>
                  <tr>
                    <th>Current element</th>
                    <th>Mapping</th>
                    <th>Target element</th>
                    <th>Provenance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {currentRows.map(cur => {
                    const targetIds = targetIdsByCurrentId.get(cur.id) ?? [];
                    if (targetIds.length === 0) {
                      // Unmapped current element -> render with the
                      // "decommissioned in target" annotation chip.
                      // Current-only rows have no target element to attach
                      // captured decisions to, so no chip group is rendered.
                      const annotation = decomByCurrentId.get(cur.id);
                      return (
                        <tr
                          key={`current-${cur.id}`}
                          data-testid={`target-arch-compare-row-${cur.id}`}
                          data-row-kind="current-only"
                        >
                          <td>
                            <div className={styles.compareRowName}>
                              {cur.name}
                            </div>
                            <div className={styles.compareRowType}>
                              {cur.entityType}
                            </div>
                          </td>
                          <td>{'\u2192'}</td>
                          <td>
                            <span
                              className={styles.decomInTargetChip}
                              data-testid={`target-arch-compare-decom-chip-${cur.id}`}
                            >
                              Decommissioned in target
                              {annotation && annotation.reason ? (
                                <span className={styles.decomChipReason}>
                                  {' '}
                                  ({annotation.reason})
                                </span>
                              ) : null}
                            </span>
                          </td>
                          <td>--</td>
                          <td>--</td>
                        </tr>
                      );
                    }
                    return targetIds.map(tid => {
                      const tgt = targetById.get(tid);
                      return (
                        <tr
                          key={`pair-${cur.id}-${tid}`}
                          data-testid={`target-arch-compare-row-${cur.id}-${tid}`}
                          data-row-kind="pair"
                        >
                          <td>
                            <div className={styles.compareRowName}>
                              {cur.name}
                            </div>
                            <div className={styles.compareRowType}>
                              {cur.entityType}
                            </div>
                          </td>
                          <td>{'\u2192'}</td>
                          <td>
                            {tgt ? (
                              <>
                                <div className={styles.compareRowName}>
                                  {tgt.name}
                                </div>
                                <div className={styles.compareRowType}>
                                  {tgt.entityType}
                                </div>
                              </>
                            ) : (
                              <span className={styles.compareRowType}>
                                (missing target id {tid})
                              </span>
                            )}
                            {/*
                             * Spec 2026-05-26 Q4: element-scope captured-
                             * decision chips render inline within the Target
                             * cell, stacked below the name/type lines. The
                             * table stays at 5 columns -- no new column is
                             * introduced.
                             */}
                            {renderTargetCellChips(tid)}
                          </td>
                          {/*
                           * Provenance + Status columns: placeholder `--` until
                           * AMS surfaces provenance / decommissioning on the
                           * inventory wire. The workspace-side overlay map was
                           * removed in spec 2026-05-24 (task 4.5).
                           */}
                          <td>--</td>
                          <td>--</td>
                        </tr>
                      );
                    });
                  })}
                  {brandNewTargets.map(tr => {
                    return (
                      <tr
                        key={`brand-new-${tr.id}`}
                        data-testid={`target-arch-compare-brand-new-row-${tr.id}`}
                        data-row-kind="target-only"
                      >
                        <td>--</td>
                        <td>{'\u2192'}</td>
                        <td>
                          <div className={styles.compareRowName}>{tr.name}</div>
                          <div className={styles.compareRowType}>
                            {tr.entityType}
                          </div>
                          {/*
                           * Brand-new target-only rows can also carry
                           * element-scope decisions -- the spec calls out
                           * that decisions can attach to brand-new target
                           * elements.
                           */}
                          {renderTargetCellChips(tr.id)}
                        </td>
                        <td>
                          <span
                            className={styles.brandNewChip}
                            data-testid={`target-arch-compare-brand-new-chip-${tr.id}`}
                          >
                            Brand-new
                          </span>
                        </td>
                        <td>--</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </>
  );
};

export default TargetArchitectureCompareView;
