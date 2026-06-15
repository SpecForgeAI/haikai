/**
 * MigrationDeliveryHierarchyTree
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * Task Group 9 -- Hierarchy tree.
 *
 * Renders the initiative -> epic -> feature -> story hierarchy built by AMS
 * from `book_of_work_json` (NEVER from WorkItem-derived structure). Each node
 * carries seven badge fields (AC 4 + AC 5 + AC 14 + Addition B + Addition C):
 *
 *   - Backlog saved / unsaved (from `backlogStatus`, driven by stored
 *     `workItemId` presence + AMS-computed status -- Addition B)
 *   - Spec generation status (from `specGenerationStatus`)
 *   - Spec confidence (from `specGenerationConfidence`)
 *   - Implementation status (from `implementationStatus`)
 *   - Evidence status (from `evidenceStatus`)
 *   - Needs-attention count (from `needsAttentionCount`)
 *   - Missing-inputs count (from `missingInputsCount`) for
 *     insufficient-context stories only -- Addition C.
 *
 * Clicking a story node calls `onStorySelected(workItemId)`; the parent wires
 * this to the story detail drawer in Task Group 11. Clicking a non-story
 * node (initiative / epic / feature) is a no-op affordance that only toggles
 * the subtree expansion.
 *
 * Spec: 2026-05-20 Missing Input Resolver Flow -- Task Group 7.3.
 *
 * Optional `filterStoryWorkItemIds` prop: when supplied, prunes the tree to
 * subtrees that contain at least one story whose `workItemId` is in the set.
 * Non-story nodes survive only as path-preserving ancestors of surviving
 * story leaves. This drives the "View ready stories" filter on the
 * dashboard. Pass `null` to disable filtering.
 *
 * Wire-shape note: nodes are mapped to camelCase at the API client boundary
 * (`migrationDeliveryDashboardApi.ts`, follow-up #10); the tree reads
 * idiomatic camelCase fields throughout.
 *
 * Spec: 2026-05-20 Spec Quality Scoring -- Task Group 6.3.
 * Each story row also renders a `QualityGradeChip` driven by the new
 * `qualityGrade` field on the hierarchy node DTO. Stories with no spec row
 * OR with `insufficient_context`/`failed` rows render the muted "--" N/A
 * chip per spec.md.
 *
 * Spec: 2026-06-14 Holistic Integration/E2E TEST Work Items (Spec 2 of 4)
 * -- Task Group 4 adds three things to the tree:
 *   - A distinct TEST chip on `type === 'TEST'` nodes (the free-text `"TEST"`
 *     type arrives from `book_of_work_json` once the holistic action has
 *     created the sibling). It is visually distinct from the story/feature/
 *     epic type chip so a TEST sibling is immediately recognisable.
 *   - A per-node "Define Integration/E2E Tests" action button shown ONLY on
 *     FEATURE and EPIC nodes. Clicking it calls `onDefineIntegrationTests`
 *     with the node; the parent runs the new headless gateway route and
 *     surfaces the allow-with-warning / empty-plan result.
 *   - A `hideTestItems` toggle: when true, `TEST` nodes are pruned from the
 *     tree (show/hide filter), modelled on the existing `pruneHierarchy`
 *     story-filter pattern.
 *
 * Spec: 2026-06-14 Migrate Button + Migration Execution Driver (Spec 3 of 4)
 * -- Task Group 5 adds the per-story "defer this story" action + a "Deferred"
 * state:
 *   - On STORY nodes, a "Defer this story" action button (shown only when
 *     `onDeferStory` is provided and the story is NOT already deferred). It is
 *     the deliberate, visible way to launch a Migrate run without an
 *     un-generated story -- deferring EXCLUDES the story from IMPLEMENTATION in
 *     this run ONLY; it stays in reconciliation scope (Spec 4) and will surface
 *     as a break if not migrated (CD-7). The button title spells this out.
 *   - A distinct "Deferred" badge on any story whose `workItemId` is in
 *     `deferredWorkItemIds`, replacing the defer action with an "Un-defer"
 *     toggle so the state is reversible and never silent.
 *
 * Precedents:
 *   - frontend/src/components/ProductManager/MigrationDeliveryPlan/
 *     MigrationBookOfWorkHierarchyTree.tsx (expansion + node rendering)
 *   - frontend/src/components/ProductManager/MigrationShapeSpecGeneration/
 *     BatchResultsTable.tsx (per-row badges + clickable rows)
 */

import React, { useCallback, useMemo, useState } from 'react';
import type { MigrationDeliveryHierarchyNodeDto } from '../../../api/migrationDeliveryDashboardApi';
import QualityGradeChip, {
  type QualityGrade,
  type LlmConfidence,
} from './QualityGradeChip';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Type helpers
// ============================================================================

/**
 * The node `type` is free-text on the wire (built from `book_of_work_json`).
 * TEST siblings arrive as the literal uppercase `"TEST"`; match
 * case-insensitively so a `"test"` blob does not slip through.
 */
function isTestNode(node: MigrationDeliveryHierarchyNodeDto): boolean {
  return (node.type ?? '').toUpperCase() === 'TEST';
}

/** The holistic "Define Integration/E2E Tests" action targets FEATURE/EPIC. */
function isHolisticTarget(node: MigrationDeliveryHierarchyNodeDto): boolean {
  const t = (node.type ?? '').toLowerCase();
  return t === 'feature' || t === 'epic';
}

// ============================================================================
// Badge helpers
// ============================================================================

function backlogBadgeClass(status: string): string {
  switch (status) {
    case 'saved':
    case 'saved_to_backlog':
      return styles.badgeSaved;
    case 'not_saved_to_backlog':
    default:
      return styles.badgeNotSaved;
  }
}

function specBadgeClass(status: string | null): string {
  switch (status) {
    case 'generated':
      return styles.badgeSpecGenerated;
    case 'generated_with_warnings':
      return styles.badgeSpecWarning;
    case 'insufficient_context':
      return styles.badgeSpecInsufficient;
    case 'failed':
      return styles.badgeSpecFailed;
    default:
      return styles.badge;
  }
}

function confidenceBadgeClass(confidence: string | null): string {
  switch (confidence) {
    case 'high':
      return styles.badgeConfidenceHigh;
    case 'medium':
      return styles.badgeConfidenceMedium;
    case 'low':
      return styles.badgeConfidenceLow;
    default:
      return styles.badge;
  }
}

// Coerce a raw wire string into the literal grade union, returning null for
// any value outside {'A','B','C','D','F'}.
function coerceGrade(value: string | null | undefined): QualityGrade | null {
  if (value === 'A' || value === 'B' || value === 'C' || value === 'D' || value === 'F') {
    return value;
  }
  return null;
}

function coerceConfidence(value: string | null | undefined): LlmConfidence | null {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return null;
}

// ============================================================================
// Filter helper -- prune to subtrees containing matching story workItemIds.
// ============================================================================

function pruneHierarchy(
  hierarchy: ReadonlyArray<MigrationDeliveryHierarchyNodeDto>,
  allowed: Set<string>,
): MigrationDeliveryHierarchyNodeDto[] {
  const out: MigrationDeliveryHierarchyNodeDto[] = [];
  for (const node of hierarchy) {
    if (node.type === 'story') {
      if (node.workItemId && allowed.has(node.workItemId)) {
        out.push(node);
      }
      continue;
    }
    const prunedChildren = pruneHierarchy(node.children ?? [], allowed);
    if (prunedChildren.length > 0) {
      out.push({ ...node, children: prunedChildren });
    }
  }
  return out;
}

// ============================================================================
// Filter helper -- drop TEST nodes (show/hide TEST filter, D5(a)).
// ============================================================================

/**
 * Return a copy of `hierarchy` with every `type === 'TEST'` node removed.
 * Modelled on `pruneHierarchy` (recursive, structure-preserving). Non-TEST
 * nodes are kept; their children are recursively filtered so a TEST sibling
 * nested under a feature/epic is pruned while its non-TEST siblings survive.
 */
function pruneTestNodes(
  hierarchy: ReadonlyArray<MigrationDeliveryHierarchyNodeDto>,
): MigrationDeliveryHierarchyNodeDto[] {
  const out: MigrationDeliveryHierarchyNodeDto[] = [];
  for (const node of hierarchy) {
    if (isTestNode(node)) continue;
    out.push({ ...node, children: pruneTestNodes(node.children ?? []) });
  }
  return out;
}

// ============================================================================
// Props + component
// ============================================================================

export interface MigrationDeliveryHierarchyTreeProps {
  hierarchy: MigrationDeliveryHierarchyNodeDto[];
  /** Called when a STORY node is clicked. Parent wires to the drawer (Group 11). */
  onStorySelected: (workItemId: string | null, nodeId: string) => void;
  /**
   * Task Group 7.3 (Missing Input Resolver Flow): when non-null, prune the
   * tree to subtrees containing at least one story whose `workItemId` is in
   * the set. Use `null` (default) to render the full tree.
   */
  filterStoryWorkItemIds?: ReadonlySet<string> | null;
  /**
   * Holistic Integration/E2E TEST Work Items (2026-06-14, Task Group 4):
   * called when the per-node "Define Integration/E2E Tests" button is clicked
   * on a FEATURE or EPIC node. The parent runs the headless gateway route.
   * When omitted, the action button is not rendered.
   */
  onDefineIntegrationTests?: (node: MigrationDeliveryHierarchyNodeDto) => void;
  /**
   * Holistic Integration/E2E TEST Work Items (2026-06-14, Task Group 4):
   * the blob-item id (`node.id`) of the node whose define-tests call is
   * currently in flight, or null. The matching node's action button renders a
   * "Defining..." disabled state so the user can't double-fire.
   */
  defineTestsInFlightNodeId?: string | null;
  /**
   * Holistic Integration/E2E TEST Work Items (2026-06-14, Task Group 4):
   * when true, `type === 'TEST'` nodes are pruned from the rendered tree
   * (show/hide TEST filter). Defaults to false (TEST siblings visible).
   */
  hideTestItems?: boolean;
  /**
   * Migrate Button + Migration Execution Driver (2026-06-14, Task Group 5):
   * called when the per-story "Defer this story" / "Un-defer" toggle is
   * clicked on a STORY node, with the story's `workItemId` and the next
   * desired deferred value. Defer EXCLUDES the story from the Migrate
   * implementation run only -- it stays in reconciliation scope (CD-7). When
   * omitted, no defer action is rendered.
   */
  onDeferStory?: (workItemId: string, nextDeferred: boolean) => void;
  /**
   * Migrate Button + Migration Execution Driver (2026-06-14, Task Group 5):
   * the `workItemId` of the story whose defer toggle is currently in flight,
   * or null. The matching story's action renders a disabled "Deferring..."
   * state so the user can't double-fire.
   */
  deferInFlightWorkItemId?: string | null;
  /**
   * Migrate Button + Migration Execution Driver (2026-06-14, Task Group 5):
   * the set of `workItemId`s currently marked deferred. A story in this set
   * shows the distinct "Deferred" badge + an "Un-defer" toggle (instead of the
   * "Defer this story" action), and is excluded from the hard-block in-scope
   * set the Migrate gate checks.
   */
  deferredWorkItemIds?: ReadonlySet<string> | null;
}

export const MigrationDeliveryHierarchyTree: React.FC<
  MigrationDeliveryHierarchyTreeProps
> = ({
  hierarchy,
  onStorySelected,
  filterStoryWorkItemIds = null,
  onDefineIntegrationTests,
  defineTestsInFlightNodeId = null,
  hideTestItems = false,
  onDeferStory,
  deferInFlightWorkItemId = null,
  deferredWorkItemIds = null,
}) => {
  // Default: roots (initiatives) start expanded; descendants start expanded
  // too -- the tree is sized for ~500 stories per Q-2 and is fully
  // client-side rendered.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const renderedHierarchy = useMemo(() => {
    let next: ReadonlyArray<MigrationDeliveryHierarchyNodeDto> = hierarchy;
    if (filterStoryWorkItemIds) {
      next = pruneHierarchy(
        next,
        filterStoryWorkItemIds instanceof Set
          ? filterStoryWorkItemIds
          : new Set(filterStoryWorkItemIds as Iterable<string>),
      );
    }
    if (hideTestItems) {
      next = pruneTestNodes(next);
    }
    return next;
  }, [hierarchy, filterStoryWorkItemIds, hideTestItems]);

  const isDeferred = useCallback(
    (workItemId: string | null): boolean =>
      !!workItemId && !!deferredWorkItemIds && deferredWorkItemIds.has(workItemId),
    [deferredWorkItemIds],
  );

  if (renderedHierarchy.length === 0) {
    return (
      <div
        className={styles.placeholder}
        data-testid="mdd-hierarchy-empty"
      >
        {filterStoryWorkItemIds
          ? 'No stories match the current filter.'
          : 'No initiatives in this book of work.'}
      </div>
    );
  }

  const renderNode = (
    node: MigrationDeliveryHierarchyNodeDto,
  ): React.ReactElement => {
    const children = node.children ?? [];
    const isCollapsed = collapsed.has(node.id);
    const isStory = node.type === 'story';
    const isTest = isTestNode(node);
    const storyDeferred = isStory && isDeferred(node.workItemId);
    const handleClick = () => {
      if (isStory) {
        onStorySelected(node.workItemId, node.id);
      } else {
        toggle(node.id);
      }
    };

    return (
      <div
        key={node.id}
        className={styles.treeNode}
        data-testid={`mdd-hierarchy-node-${node.id}`}
        data-node-type={node.type}
      >
        <div
          className={styles.nodeRow}
          data-testid={`mdd-hierarchy-node-row-${node.id}`}
          onClick={handleClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleClick();
            }
          }}
        >
          {children.length > 0 ? (
            <button
              type="button"
              className={styles.nodeToggle}
              onClick={(e) => {
                e.stopPropagation();
                toggle(node.id);
              }}
              data-testid={`mdd-hierarchy-toggle-${node.id}`}
              aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            >
              {isCollapsed ? '+' : '-'}
            </button>
          ) : (
            <span className={styles.nodeToggle} />
          )}
          <span
            className={styles.nodeType}
            data-testid={`mdd-hierarchy-node-type-${node.id}`}
          >
            {node.type}
          </span>
          <span
            className={styles.nodeTitle}
            data-testid={`mdd-hierarchy-node-title-${node.id}`}
            title={node.title}
          >
            {node.title}
          </span>
          <span className={styles.badgeRow}>
            {/* TEST chip (Holistic Integration/E2E TEST Work Items 2026-06-14,
                Task Group 4). Distinct from the muted node-type label so a
                TEST sibling reads clearly as an integration/E2E test item.
                Rendered for any `type === 'TEST'` node (free-text from
                `book_of_work_json`). */}
            {isTest && (
              <span
                className={`${styles.badge} ${styles.badgeTest}`}
                data-testid={`mdd-badge-test-${node.id}`}
                title="Integration/E2E test work item"
              >
                TEST
              </span>
            )}
            {/* Deferred badge (Migrate Button + Migration Execution Driver
                2026-06-14, Task Group 5). A deferred story is EXCLUDED from the
                Migrate implementation run only; it stays in reconciliation
                scope and will surface as a break if not migrated (CD-7). */}
            {storyDeferred && (
              <span
                className={`${styles.badge} ${styles.badgeDeferred}`}
                data-testid={`mdd-badge-deferred-${node.id}`}
                title="Excluded from this Migrate run (implementation only). Still in reconciliation scope -- will surface as a break if not migrated."
              >
                Deferred
              </span>
            )}
            {/* Backlog status badge (Addition B). Render only on story nodes
                so initiatives/epics/features remain visually quiet. */}
            {isStory && (
              <span
                className={`${styles.badge} ${backlogBadgeClass(
                  node.backlogStatus,
                )}`}
                data-testid={`mdd-badge-backlog-${node.id}`}
              >
                {node.backlogStatus === 'saved' ||
                node.backlogStatus === 'saved_to_backlog'
                  ? 'saved'
                  : 'not saved'}
              </span>
            )}
            {/* Spec status */}
            {isStory && node.specGenerationStatus && (
              <span
                className={`${styles.badge} ${specBadgeClass(
                  node.specGenerationStatus,
                )}`}
                data-testid={`mdd-badge-spec-${node.id}`}
              >
                {node.specGenerationStatus}
              </span>
            )}
            {/* Confidence */}
            {isStory && node.specGenerationConfidence && (
              <span
                className={`${styles.badge} ${confidenceBadgeClass(
                  node.specGenerationConfidence,
                )}`}
                data-testid={`mdd-badge-confidence-${node.id}`}
              >
                {node.specGenerationConfidence}
              </span>
            )}
            {/* Quality grade (Spec Quality Scoring 2026-05-20, Group 6.3) */}
            {isStory && (
              <QualityGradeChip
                qualityGrade={coerceGrade(node.qualityGrade ?? null)}
                qualityScore={null}
                qualityDimensions={null}
                llmConfidence={coerceConfidence(
                  node.specGenerationConfidence ?? null,
                )}
                compact
                testId={`mdd-badge-quality-${node.id}`}
              />
            )}
            {/* Manually-edited indicator (In-Product Spec Editor 2026-05-20,
                Task Group 8). Subtle outline chip rendered next to the
                quality-grade chip when the latest spec row was hand-edited.
                Click on the chip bubbles up to the row's onClick which opens
                the drawer (same target as the rest of the row). */}
            {isStory && node.manuallyEdited === true && (
              <span
                className={`${styles.badge} ${styles.badgeManuallyEdited}`}
                data-testid={`mdd-badge-manually-edited-${node.id}`}
                title="This spec was manually edited"
              >
                Edited
              </span>
            )}
            {/* Provenance badge (Net-new backlog items + provenance 2026-06-14,
                D5). Rendered on story nodes alongside the Edited/Quality chips.
                A null/absent wire value normalises to `carry_over` (the AMS
                column default), so discovered + legacy rows read carry_over with
                no backfill; only a `net_new` value flips the chip. */}
            {isStory &&
              (() => {
                const isNetNew = node.provenance === 'net_new';
                return (
                  <span
                    className={`${styles.badge} ${
                      isNetNew ? styles.badgeNetNew : styles.badgeCarryOver
                    }`}
                    data-testid={`mdd-badge-provenance-${node.id}`}
                    data-provenance={isNetNew ? 'net_new' : 'carry_over'}
                    title={
                      isNetNew
                        ? 'Additive work, deliberately outside the like-for-like envelope'
                        : 'Like-for-like work (must match current-state)'
                    }
                  >
                    {isNetNew ? 'net_new' : 'carry_over'}
                  </span>
                );
              })()}
            {/* Implementation */}
            {isStory && node.implementationStatus && (
              <span
                className={styles.badge}
                data-testid={`mdd-badge-impl-${node.id}`}
              >
                {node.implementationStatus}
              </span>
            )}
            {/* Evidence */}
            {isStory && (
              <span
                className={styles.badge}
                data-testid={`mdd-badge-evidence-${node.id}`}
              >
                evidence: {node.evidenceStatus}
              </span>
            )}
            {/* Needs attention */}
            {node.needsAttentionCount > 0 && (
              <span
                className={`${styles.badge} ${styles.badgeNeedsAttention}`}
                data-testid={`mdd-badge-attention-${node.id}`}
              >
                attention: {node.needsAttentionCount}
              </span>
            )}
            {/* Missing inputs (Addition C) -- ONLY for insufficient-context
                stories. */}
            {node.specGenerationStatus === 'insufficient_context' &&
              node.missingInputsCount !== null &&
              node.missingInputsCount !== undefined &&
              node.missingInputsCount > 0 && (
                <span
                  className={`${styles.badge} ${styles.badgeMissingInputs}`}
                  data-testid={`mdd-badge-missing-inputs-${node.id}`}
                >
                  missing inputs: {node.missingInputsCount}
                </span>
              )}
            {/* Per-node "Define Integration/E2E Tests" action (Holistic
                Integration/E2E TEST Work Items 2026-06-14, Task Group 4).
                Shown ONLY on FEATURE/EPIC nodes; runs the headless holistic
                review over the node's spec-complete children and creates the
                cross-cutting TEST siblings. stopPropagation so the click does
                not also toggle the subtree. */}
            {onDefineIntegrationTests && isHolisticTarget(node) && (
              <button
                type="button"
                className={styles.nodeActionButton}
                data-testid={`mdd-define-tests-${node.id}`}
                disabled={defineTestsInFlightNodeId === node.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onDefineIntegrationTests(node);
                }}
                title="Review this node's children and define cross-cutting integration/E2E tests"
              >
                {defineTestsInFlightNodeId === node.id
                  ? 'Defining…'
                  : 'Define Integration/E2E Tests'}
              </button>
            )}
            {/* Per-story "Defer this story" / "Un-defer" toggle (Migrate Button
                + Migration Execution Driver 2026-06-14, Task Group 5). Shown
                ONLY on STORY nodes when `onDeferStory` is supplied. Deferring
                EXCLUDES the story from the Migrate implementation run only --
                it stays in reconciliation scope (CD-7) and will surface as a
                break if not migrated. stopPropagation so the click does not
                open the drawer. The state is reversible (Un-defer) and never
                silent. */}
            {onDeferStory && isStory && node.workItemId && (
              <button
                type="button"
                className={styles.nodeActionButton}
                data-testid={`mdd-defer-story-${node.id}`}
                disabled={deferInFlightWorkItemId === node.workItemId}
                onClick={(e) => {
                  e.stopPropagation();
                  if (node.workItemId) {
                    onDeferStory(node.workItemId, !storyDeferred);
                  }
                }}
                title={
                  storyDeferred
                    ? 'Re-include this story in the Migrate run.'
                    : 'Exclude this story from this Migrate run (implementation only). It stays in reconciliation scope and will surface as a break if not migrated.'
                }
              >
                {deferInFlightWorkItemId === node.workItemId
                  ? 'Deferring…'
                  : storyDeferred
                    ? 'Un-defer'
                    : 'Defer this story'}
              </button>
            )}
          </span>
        </div>
        {children.length > 0 && !isCollapsed && (
          <div className={styles.treeChildren}>
            {children.map(renderNode)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={styles.treeContainer}
      data-testid="mdd-hierarchy-tree"
    >
      {renderedHierarchy.map(renderNode)}
    </div>
  );
};

export default MigrationDeliveryHierarchyTree;
