/**
 * MigrationDeliveryMigratePanel
 *
 * Spec: 2026-06-14 Migrate Button + Migration Execution Driver + External
 * Shape-Spec Auto-Answerer (Spec 3 of 4) -- Task Group 5.
 *
 * The book-of-work-scoped "Migrate" surface on the Migration Delivery
 * Dashboard, modelled on `MigrationDeliveryGenerateAllDialog` (confirm gate +
 * run-progress surface) and the Spec-2 define-tests result-banner idiom.
 *
 * Responsibilities:
 *   1. The "Migrate" button that kicks off the whole big-bang book of work
 *      (`triggerMigrate`). A confirm step gates the launch (the run is
 *      irreversible once dispatched).
 *   2. The HARD-BLOCK gate (CD-7). The button is DISABLED until the client-side
 *      predicate passes: every IN-SCOPE (non-deferred) story is spec-ready
 *      (`workItemId` present / `backlogStatus = saved` AND
 *      `specGenerationStatus in {generated, generated_with_warnings}` AND
 *      `staleReason = null`) AND an active `kind='current'` baseline exists.
 *      When blocked, a CLEAR list of exactly what is blocking is rendered
 *      (per-story reason + the missing-baseline reason) so the user knows to
 *      generate those specs or DEFER them. The server re-validates regardless
 *      (the gateway driver owns the authoritative gate); a `blocked` trigger
 *      response is surfaced verbatim too.
 *   3. The run-progress view, driven from the run-state read API
 *      (`getLatestMigrationExecutionRun`): per-spec dispatched / implemented /
 *      failed / deployed status, the current position, halted/deployed run
 *      status, and the per-spec auto-answer decision log (the inline JSONB from
 *      CD-4).
 *
 * Presentational: every fetch is a test-seam prop (defaults to the real api
 * client) so the dashboard test renders deterministically + offline. The panel
 * owns no routing and never imports a context hook.
 *
 * Spec 4 (Migration Reconciliation + Bug Loop) -- Task Group 5: the panel now
 * also surfaces the loaded run to its parent via the optional `onRunLoaded`
 * callback so the dashboard can mount the reconciliation review panel
 * (`MigrationDeliveryReconciliationPanel`) for the same run without a duplicate
 * fetch. The callback is best-effort and never affects this panel's own render.
 *
 * Spec 2026-06-14 D4 (Carry-over Completeness Gate) -- the panel surfaces a
 * server-side `carry_over_not_accounted` block with a CLICKABLE deep-link (when
 * the dashboard supplies `onReviewCarryOver`) to the book-scoped completeness
 * review surface, and re-checks the gate when the parent bumps `refreshToken`
 * (after the cite/dismiss pass closes) so the stale block clears and the loop
 * closes in-app.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  triggerMigrate as defaultTriggerMigrate,
  triggerMigrateSelected as defaultTriggerMigrateSelected,
  getLatestMigrationExecutionRun as defaultGetLatestRun,
  type MigrationDeliveryHierarchyNodeDto,
  type MigrationExecutionRunDto,
  type MigrationExecutionRunItemDto,
  type MigrateBlockReason,
  type TriggerMigrateResult,
} from '../../../api/migrationDeliveryDashboardApi';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Client-side hard-block predicate (CD-7) -- mirrors the gateway driver
// ============================================================================

const READY_SPEC_STATUSES = new Set(['generated', 'generated_with_warnings']);

/** A story node is spec-ready iff saved-to-backlog + generated + not stale. */
function isStorySpecReady(node: MigrationDeliveryHierarchyNodeDto): boolean {
  if (!node.workItemId) return false;
  const savedToBacklog =
    node.backlogStatus === 'saved' ||
    node.backlogStatus === 'saved_to_backlog';
  if (!savedToBacklog) return false;
  if (!READY_SPEC_STATUSES.has(node.specGenerationStatus ?? '')) return false;
  if (node.staleReason) return false;
  return true;
}

/** Flatten the hierarchy into the list of STORY nodes (leaf work items). */
function collectStoryNodes(
  hierarchy: ReadonlyArray<MigrationDeliveryHierarchyNodeDto>,
): MigrationDeliveryHierarchyNodeDto[] {
  const out: MigrationDeliveryHierarchyNodeDto[] = [];
  const walk = (nodes: ReadonlyArray<MigrationDeliveryHierarchyNodeDto>) => {
    for (const node of nodes) {
      if (node.type === 'story') out.push(node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(hierarchy);
  return out;
}

/** A branch-safe default batch name to prefill the "migrate selected" field. */
function defaultBatchNameFor(bookId: string): string {
  const short = (bookId || 'book').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase();
  const d = new Date();
  const stamp =
    `${d.getFullYear()}` +
    `${String(d.getMonth() + 1).padStart(2, '0')}` +
    `${String(d.getDate()).padStart(2, '0')}`;
  return `migration-${short || 'book'}-${stamp}`;
}

/**
 * Compute the hard-block reason list (CD-7). Every IN-SCOPE (non-deferred)
 * story that is not spec-ready contributes one `story_not_spec_ready` reason;
 * a missing `kind='current'` baseline contributes one `missing_current_baseline`
 * reason. Never short-circuits, so the UI can list exactly what is blocking.
 */
export function computeHardBlockReasons(params: {
  hierarchy: ReadonlyArray<MigrationDeliveryHierarchyNodeDto>;
  deferredWorkItemIds: ReadonlySet<string>;
  hasActiveCurrentBaseline: boolean;
}): MigrateBlockReason[] {
  const reasons: MigrateBlockReason[] = [];
  for (const node of collectStoryNodes(params.hierarchy)) {
    if (!node.workItemId) continue; // not a gateable story
    if (params.deferredWorkItemIds.has(node.workItemId)) continue; // deferred drops out
    if (!isStorySpecReady(node)) {
      reasons.push({
        code: 'story_not_spec_ready',
        message:
          `Story "${node.title || node.workItemId}" is not spec-ready ` +
          `(must be saved to backlog, generated/generated_with_warnings, and not stale). ` +
          `Generate its spec or defer the story.`,
        workItemId: node.workItemId,
      });
    }
  }
  if (!params.hasActiveCurrentBaseline) {
    reasons.push({
      code: 'missing_current_baseline',
      message:
        'No active current-state API-behaviour baseline exists for the workspace. ' +
        'You cannot reconcile without an oracle, so Migrate is blocked until one is captured.',
    });
  }
  return reasons;
}

// ============================================================================
// Run-progress helpers
// ============================================================================

/** Map a run-item outcome / status to a compact human label + state class. */
function itemStatusLabel(item: MigrationExecutionRunItemDto): string {
  // Outcome is the terminal signal; fall back to the in-flight status.
  if (item.outcome) return item.outcome;
  if (item.dispatched) return item.status ?? 'dispatched';
  return item.status ?? 'pending';
}

function itemStatusClass(item: MigrationExecutionRunItemDto): string {
  const v = (item.outcome ?? item.status ?? '').toLowerCase();
  switch (v) {
    case 'deployed':
      return styles.badgeSpecGenerated ?? styles.badge;
    case 'implemented':
      return styles.badgeSaved ?? styles.badge;
    case 'failed':
    case 'rejected':
      return styles.badgeSpecFailed ?? styles.badge;
    default:
      return styles.badge;
  }
}

// ============================================================================
// Props
// ============================================================================

export interface MigrationDeliveryMigratePanelProps {
  projectId: string;
  bookId: string;
  /** The full hierarchy (drives the client-side hard-block predicate). */
  hierarchy: ReadonlyArray<MigrationDeliveryHierarchyNodeDto>;
  /** The set of `workItemId`s currently deferred (drop out of the gate). */
  deferredWorkItemIds: ReadonlySet<string>;
  /**
   * Whether an active `kind='current'` API-behaviour baseline exists for the
   * workspace (the oracle precondition -- CD-7). When false, Migrate is
   * hard-blocked regardless of story readiness.
   */
  hasActiveCurrentBaseline: boolean;
  /** Orchestration scope: organisation name. */
  company: string;
  /** Orchestration scope: product name. */
  project: string;
  /** Test seam: override the Migrate trigger. Defaults to the real client. */
  triggerMigrateFn?: typeof defaultTriggerMigrate;
  /**
   * Test seam: override the batch (migrate-selected) trigger. Defaults to the
   * real client. Used by the additive "Migrate selected (one branch)" surface.
   */
  triggerMigrateSelectedFn?: typeof defaultTriggerMigrateSelected;
  /** Test seam: override the run-state read. Defaults to the real client. */
  fetchLatestRunFn?: typeof defaultGetLatestRun;
  /**
   * Spec 4 (reconciliation): notified whenever the latest run is (re)loaded so
   * the dashboard can mount the reconciliation review panel for the same run
   * without a duplicate fetch. Best-effort; optional.
   */
  onRunLoaded?: (run: MigrationExecutionRunDto | null) => void;
  /**
   * Spec 2026-06-14 D4 -- Carry-over Completeness Gate. Optional deep-link to the
   * completeness review surface (the extended Capabilities-in-Findings view).
   * When a server-side block carries a `carry_over_not_accounted` reason, the
   * panel surfaces THAT there is un-accounted carry_over work and -- if this is
   * provided -- renders a button taking the user to cite / dismiss it (the
   * actual accounting pass happens on the Capabilities view, not here). When
   * absent, a plain text pointer is shown instead.
   */
  onReviewCarryOver?: () => void;
  /**
   * Spec 2026-06-14 D4 -- Carry-over Completeness Gate (closing wiring pass). A
   * monotonically-bumped token the parent changes to ask the panel to re-check
   * the gate -- e.g. after the user cites / dismisses on the book-scoped
   * completeness review surface and closes it. On change the panel reloads the
   * latest run AND drops any STALE server-side block (`serverBlockReasons`) so a
   * now-resolved `carry_over_not_accounted` banner disappears and the user can
   * retry Migrate (the gateway re-validates the gate server-side regardless).
   * Undefined / unchanged is a no-op, so existing callers are unaffected.
   */
  refreshToken?: number | string;
}

// ============================================================================
// Component
// ============================================================================

export const MigrationDeliveryMigratePanel: React.FC<
  MigrationDeliveryMigratePanelProps
> = ({
  projectId,
  bookId,
  hierarchy,
  deferredWorkItemIds,
  hasActiveCurrentBaseline,
  company,
  project,
  triggerMigrateFn = defaultTriggerMigrate,
  triggerMigrateSelectedFn = defaultTriggerMigrateSelected,
  fetchLatestRunFn = defaultGetLatestRun,
  onRunLoaded,
  onReviewCarryOver,
  refreshToken,
}) => {
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [launching, setLaunching] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // The blocking-reason list surfaced when a trigger attempt is refused
  // server-side (authoritative); null until an attempt returns `blocked`.
  const [serverBlockReasons, setServerBlockReasons] = useState<
    MigrateBlockReason[] | null
  >(null);
  const [run, setRun] = useState<MigrationExecutionRunDto | null>(null);

  // ----- Client-side hard-block predicate (CD-7) --------------------------
  const blockReasons = useMemo(
    () =>
      computeHardBlockReasons({
        hierarchy,
        deferredWorkItemIds,
        hasActiveCurrentBaseline,
      }),
    [hierarchy, deferredWorkItemIds, hasActiveCurrentBaseline],
  );
  const isBlocked = blockReasons.length > 0;

  // ----- D4: is the server-side block (partly) a carry_over_not_accounted? ---
  // Surfaced as its own deep-link affordance so the user can jump to the
  // completeness review surface (the Capabilities-in-Findings view) to cite /
  // dismiss the un-accounted behaviour-bearing work.
  const hasCarryOverBlock = useMemo(
    () =>
      (serverBlockReasons ?? []).some(
        (r) => r.code === 'carry_over_not_accounted',
      ),
    [serverBlockReasons],
  );

  // ----- Run-progress fetch (the latest run for this book) ----------------
  const loadRun = useCallback(async () => {
    try {
      const latest = await fetchLatestRunFn(projectId, bookId);
      setRun(latest);
      onRunLoaded?.(latest);
    } catch {
      // The run-progress view is best-effort; a transient read failure leaves
      // the previously-loaded run visible and never blanks the panel.
    }
  }, [fetchLatestRunFn, projectId, bookId, onRunLoaded]);

  useEffect(() => {
    void loadRun();
  }, [loadRun]);

  // ----- D4: re-check the gate when the parent bumps refreshToken ----------
  // The carry_over completeness review surface (mounted by the dashboard) does
  // its cite/dismiss pass out-of-band; on close the dashboard bumps this token.
  // We then DROP the stale server-side block (so a resolved
  // `carry_over_not_accounted` banner disappears) and re-read the run. We skip
  // the first render (mount already loads the run) so this only fires on an
  // actual change. The gateway re-validates the gate on the user's retry, so a
  // partially-resolved set simply re-blocks server-side on the next attempt.
  const lastRefreshTokenRef = useRef<number | string | undefined>(refreshToken);
  useEffect(() => {
    if (lastRefreshTokenRef.current === refreshToken) return;
    lastRefreshTokenRef.current = refreshToken;
    setServerBlockReasons(null);
    void loadRun();
  }, [refreshToken, loadRun]);

  // ----- Migrate trigger --------------------------------------------------
  const handleConfirmMigrate = useCallback(async () => {
    setConfirmOpen(false);
    setLaunching(true);
    setError(null);
    setServerBlockReasons(null);
    try {
      const result: TriggerMigrateResult = await triggerMigrateFn(
        projectId,
        bookId,
        { company, project },
      );
      if (result.status === 'started') {
        // Surface the freshly-created run immediately.
        await loadRun();
      } else if (result.status === 'blocked') {
        // The server re-validated and refused; surface its authoritative list.
        setServerBlockReasons(result.reasons);
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to start the migration run',
      );
    } finally {
      setLaunching(false);
    }
  }, [triggerMigrateFn, projectId, bookId, company, project, loadRun]);

  // ----- Migrate selected (batch -> one branch) ---------------------------
  // The selectable set is the spec-ready, non-deferred stories (exactly the ones
  // the gateway would dispatch). The user picks a subset; the chosen specs go to
  // the implement-verify-service as ONE job -> one `feature/<batchName>` branch.
  const selectableStories = useMemo(
    () =>
      collectStoryNodes(hierarchy).filter(
        (n) =>
          !!n.workItemId &&
          !deferredWorkItemIds.has(n.workItemId) &&
          isStorySpecReady(n),
      ),
    [hierarchy, deferredWorkItemIds],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchName, setBatchName] = useState<string>(() => defaultBatchNameFor(bookId));
  const [confirmBatchOpen, setConfirmBatchOpen] = useState<boolean>(false);

  const toggleStory = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected =
    selectableStories.length > 0 &&
    selectableStories.every((n) => selectedIds.has(n.workItemId as string));

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const everySelected =
        selectableStories.length > 0 &&
        selectableStories.every((n) => prev.has(n.workItemId as string));
      return everySelected
        ? new Set<string>()
        : new Set(selectableStories.map((n) => n.workItemId as string));
    });
  }, [selectableStories]);

  const handleConfirmMigrateSelected = useCallback(async () => {
    setConfirmBatchOpen(false);
    setLaunching(true);
    setError(null);
    setServerBlockReasons(null);
    try {
      const result: TriggerMigrateResult = await triggerMigrateSelectedFn(
        projectId,
        bookId,
        {
          company,
          project,
          selectedWorkItemIds: Array.from(selectedIds),
          batchName: batchName.trim() || undefined,
        },
      );
      if (result.status === 'started') {
        setSelectedIds(new Set());
        await loadRun();
      } else if (result.status === 'blocked') {
        setServerBlockReasons(result.reasons);
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to start the batch migration run',
      );
    } finally {
      setLaunching(false);
    }
  }, [
    triggerMigrateSelectedFn,
    projectId,
    bookId,
    company,
    project,
    selectedIds,
    batchName,
    loadRun,
  ]);

  const items = run?.items ?? [];

  return (
    <section
      className={styles.hierarchySection}
      data-testid="mdd-migrate-panel"
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h2 className={styles.sectionTitle}>Migrate</h2>
        <button
          type="button"
          className={styles.bulkButton}
          data-testid="mdd-migrate-button"
          disabled={isBlocked || launching}
          onClick={() => setConfirmOpen(true)}
          title={
            isBlocked
              ? 'Migrate is blocked until every in-scope story is spec-ready and a current-state baseline exists.'
              : 'Kick off the whole book of work (big-bang).'
          }
        >
          {launching ? 'Starting…' : 'Migrate'}
        </button>
      </div>

      {/* ----- Migrate selected (batch -> one branch). Additive to the whole-book
          Migrate above: pick a subset of spec-ready stories and send them to the
          implement-verify-service as ONE job -> one feature branch + one MR. ----- */}
      <div data-testid="mdd-migrate-selected" style={{ marginTop: '0.75rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h3 className={styles.sectionTitle}>Migrate selected (one branch)</h3>
          <button
            type="button"
            className={styles.bulkButton}
            data-testid="mdd-migrate-selected-button"
            disabled={selectedIds.size === 0 || launching}
            onClick={() => setConfirmBatchOpen(true)}
            title={
              selectedIds.size === 0
                ? 'Select one or more spec-ready stories to batch into a single branch.'
                : `Send ${selectedIds.size} spec(s) as one feature branch.`
            }
          >
            {launching ? 'Starting…' : `Migrate selected (${selectedIds.size})`}
          </button>
        </div>

        {selectableStories.length === 0 ? (
          <p data-testid="mdd-migrate-selected-empty">
            No spec-ready, non-deferred stories are available to batch yet.
          </p>
        ) : (
          <>
            <label style={{ display: 'block' }}>
              Branch name (feature/&lt;name&gt;):{' '}
              <input
                type="text"
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
                data-testid="mdd-migrate-batch-name-input"
                aria-label="Batch branch name"
              />
            </label>
            <label style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                data-testid="mdd-migrate-select-all"
              />{' '}
              Select all ({selectableStories.length})
            </label>
            <ul
              className={styles.defineTestsBannerList}
              data-testid="mdd-migrate-selectable-list"
            >
              {selectableStories.map((node) => {
                const id = node.workItemId as string;
                return (
                  <li key={id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(id)}
                        onChange={() => toggleStory(id)}
                        data-testid={`mdd-migrate-select-${id}`}
                      />{' '}
                      {node.title || id}
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {confirmBatchOpen && (
          <div
            className={styles.summaryBanner}
            role="status"
            data-testid="mdd-migrate-batch-confirm"
          >
            <span>
              Migrate {selectedIds.size} selected spec(s) as ONE batch onto a
              single branch <code>feature/{batchName.trim() || '(auto)'}</code>{' '}
              (one merge request), deploying once built?
            </span>
            <button
              type="button"
              className={styles.dialogPrimaryButton}
              data-testid="mdd-migrate-batch-confirm-yes"
              onClick={() => void handleConfirmMigrateSelected()}
            >
              Start batch migration
            </button>
            <button
              type="button"
              className={styles.headerNavLink}
              data-testid="mdd-migrate-batch-confirm-cancel"
              onClick={() => setConfirmBatchOpen(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* ----- Hard-block reason list (CD-7). Rendered whenever the client-side
          predicate blocks. Lists exactly what is blocking so the user can
          resolve it (generate the offending specs or defer them). ----- */}
      {isBlocked && (
        <div
          className={styles.warningBanner}
          role="alert"
          data-testid="mdd-migrate-blocked"
        >
          <span>
            Migrate is blocked. Resolve each item below (generate the spec, or
            defer the story to exclude it from this run):
          </span>
          <ul className={styles.defineTestsBannerList}>
            {blockReasons.map((r, i) => (
              <li
                key={r.workItemId ?? `${r.code}-${i}`}
                data-testid={`mdd-migrate-blocked-reason-${r.workItemId ?? r.code}`}
              >
                {r.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ----- Server-side blocked response (authoritative re-validation).
          Shown when a launch attempt is refused by the gateway driver. ----- */}
      {serverBlockReasons && serverBlockReasons.length > 0 && (
        <div
          className={styles.warningBanner}
          role="alert"
          data-testid="mdd-migrate-server-blocked"
        >
          <span>The server refused the run. Resolve each item below:</span>
          <ul className={styles.defineTestsBannerList}>
            {serverBlockReasons.map((r, i) => (
              <li key={r.workItemId ?? `${r.code}-${i}`}>{r.message}</li>
            ))}
          </ul>
          {hasCarryOverBlock &&
            (onReviewCarryOver ? (
              <button
                type="button"
                className={styles.headerNavLink}
                data-testid="mdd-migrate-carry-over-link"
                onClick={() => onReviewCarryOver()}
              >
                Review carry-over coverage (cite or dismiss)
              </button>
            ) : (
              <span data-testid="mdd-migrate-carry-over-link">
                Account for the un-accounted carry-over work on the Capabilities
                review (cite a story or dismiss with a reason), then retry.
              </span>
            ))}
        </div>
      )}

      {/* ----- Error banner ----- */}
      {error && (
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="mdd-migrate-error"
        >
          {error}
        </div>
      )}

      {/* ----- Confirm dialog ----- */}
      {confirmOpen && (
        <div
          className={styles.summaryBanner}
          role="status"
          data-testid="mdd-migrate-confirm"
        >
          <span>
            Kick off the whole book of work now? This dispatches every in-scope
            story (and its TEST siblings) for implementation, deploying once
            everything is built. Deferred stories are excluded from this run.
          </span>
          <button
            type="button"
            className={styles.dialogPrimaryButton}
            data-testid="mdd-migrate-confirm-yes"
            onClick={() => void handleConfirmMigrate()}
          >
            Start migration
          </button>
          <button
            type="button"
            className={styles.headerNavLink}
            data-testid="mdd-migrate-confirm-cancel"
            onClick={() => setConfirmOpen(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* ----- Run-progress view (driven from the run-state read API) ----- */}
      {run && (
        <div
          className={styles.summaryBanner}
          role="status"
          data-testid="mdd-migrate-run-progress"
        >
          <div data-testid="mdd-migrate-run-status">
            Run status: <strong>{run.status ?? 'unknown'}</strong>
            {typeof run.current_sequence_position === 'number' && (
              <span>
                {' '}
                (at spec {run.current_sequence_position + 1} of {items.length})
              </span>
            )}
            {run.target_base_url && (
              <span data-testid="mdd-migrate-run-target-base-url">
                {' '}
                — deployed to {run.target_base_url}
              </span>
            )}
            <button
              type="button"
              className={styles.headerNavLink}
              data-testid="mdd-migrate-run-refresh"
              onClick={() => void loadRun()}
            >
              Refresh
            </button>
          </div>
          <ul
            className={styles.defineTestsBannerList}
            data-testid="mdd-migrate-run-items"
          >
            {items.map((item, idx) => {
              const log = item.auto_answer_decision_log_json ?? [];
              return (
                <li
                  key={item.id ?? `${item.spec_name}-${idx}`}
                  data-testid={`mdd-migrate-run-item-${item.work_item_id ?? idx}`}
                >
                  <span>{item.spec_name || `Spec ${idx + 1}`}</span>{' '}
                  <span
                    className={`${styles.badge} ${itemStatusClass(item)}`}
                    data-testid={`mdd-migrate-run-item-status-${item.work_item_id ?? idx}`}
                  >
                    {itemStatusLabel(item)}
                  </span>
                  {item.deploy_on_complete && (
                    <span
                      className={styles.badge}
                      data-testid={`mdd-migrate-run-item-deploy-${item.work_item_id ?? idx}`}
                    >
                      deploys on complete
                    </span>
                  )}
                  {item.pr_url && (
                    <a
                      href={item.pr_url}
                      target="_blank"
                      rel="noreferrer"
                      data-testid={`mdd-migrate-run-item-pr-${item.work_item_id ?? idx}`}
                    >
                      PR
                    </a>
                  )}
                  {log.length > 0 && (
                    <span
                      data-testid={`mdd-migrate-run-item-decisions-${item.work_item_id ?? idx}`}
                    >
                      {' '}
                      ({log.length} auto-answer{log.length === 1 ? '' : 's'})
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
};

export default MigrationDeliveryMigratePanel;
