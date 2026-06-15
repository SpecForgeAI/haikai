/**
 * MigrationBookOfWorkDraftListView
 *
 * Spec: 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work Generation
 *   agent-os/specs/2026-05-17-pm-migration-delivery-plan-book-of-work-draft/spec.md
 * Task Group 12 -- Migration Delivery Plans list surface.
 *
 * Design-point references:
 *   - Q-6: defaults to ACTIVE drafts only (`status != 'archived'`); the
 *     "Show archived" toggle re-fetches with `?includeArchived=true` so the
 *     user can see prior drafts that were auto-archived by the
 *     regenerate-on-same-tuple flow on the AMS side.
 *   - Q-18: this view is the sibling navigation entry "Migration Delivery
 *     Plans" alongside the other product-manager tasks. The PM menu opens
 *     this list directly (active drafts) and the user clicks a row to enter
 *     the G11 review workspace.
 *
 * Columns per spec.md:
 *   - Title
 *   - Current arch
 *   - Target arch
 *   - Status
 *   - Created date
 *   - Item counts (per type) -- mini chips
 *   - Confidence / readiness summary -- mini chips
 *   - Last-saved-to-backlog timestamp
 *
 * Clicking a row calls `onOpenDraft(bookId)` so the parent can route to the
 * G11 review workspace. Archived drafts open read-only; the parent is
 * responsible for honouring that.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  listMigrationBookOfWorks,
  type MigrationBookOfWorkDraft,
} from '../../../api/migrationBookOfWorkApi';
import { computeFindingsCoverage } from '../../../utils/findingsCoverage';
import styles from './MigrationBookOfWork.module.css';

export interface MigrationBookOfWorkDraftListViewProps {
  projectId: string;
  onOpenDraft: (bookId: string, draft: MigrationBookOfWorkDraft) => void;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function itemCountsForDraft(
  draft: MigrationBookOfWorkDraft,
): { initiative: number; epic: number; feature: number; story: number } {
  const out = { initiative: 0, epic: 0, feature: 0, story: 0 };
  const items = draft.bookOfWork?.items ?? [];
  for (const i of items) {
    if (i.type in out) {
      out[i.type] = (out[i.type] ?? 0) + 1;
    }
  }
  // Fall back to the generationSummary blob when bookOfWork is missing.
  const gen = draft.generationSummary;
  if (items.length === 0 && gen) {
    out.initiative = gen.initiativeCount ?? 0;
    out.epic = gen.epicCount ?? 0;
    out.feature = gen.featureCount ?? 0;
    out.story = gen.storyCount ?? 0;
  }
  return out;
}

/**
 * Aggregate per-draft expansion progress (Spec 2026-06-11 Two-Phase
 * generation, Task Group 5.8): counts epics carrying an `expansionState`
 * inside `book_of_work_json`. Legacy full-plan drafts track no epics, so
 * the indicator is omitted (total === 0).
 */
function expansionSummaryForDraft(
  draft: MigrationBookOfWorkDraft,
): { expanded: number; total: number } {
  const items = draft.bookOfWork?.items ?? [];
  let expanded = 0;
  let total = 0;
  for (const i of items) {
    if (i.type === 'epic' && i.expansionState !== undefined) {
      total += 1;
      if (i.expansionState === 'expanded') expanded += 1;
    }
  }
  return { expanded, total };
}

function confidenceReadinessSummary(
  draft: MigrationBookOfWorkDraft,
): { high: number; medium: number; low: number; ready: number; blocked: number } {
  const out = { high: 0, medium: 0, low: 0, ready: 0, blocked: 0 };
  const items = draft.bookOfWork?.items ?? [];
  for (const i of items) {
    if (i.confidence === 'high') out.high += 1;
    else if (i.confidence === 'medium') out.medium += 1;
    else if (i.confidence === 'low') out.low += 1;
    if (i.readiness === 'ready_for_spec') out.ready += 1;
    else if (i.readiness === 'blocked') out.blocked += 1;
  }
  return out;
}

export const MigrationBookOfWorkDraftListView: React.FC<
  MigrationBookOfWorkDraftListViewProps
> = ({ projectId, onOpenDraft }) => {
  const [drafts, setDrafts] = useState<MigrationBookOfWorkDraft[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listMigrationBookOfWorks(projectId, {
        includeArchived: showArchived,
      });
      setDrafts(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load drafts.');
    } finally {
      setLoading(false);
    }
  }, [projectId, showArchived]);

  useEffect(() => {
    void fetchDrafts();
  }, [fetchDrafts]);

  return (
    <div className={styles.listContainer} data-testid="draft-list-view">
      <div className={styles.listHeader}>
        <h1 className={styles.listTitle}>Migration Delivery Plans</h1>
        <label className={styles.filterToggle}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            data-testid="show-archived-toggle"
          />
          Show archived
        </label>
      </div>

      {loading && (
        <div className={styles.listEmpty} data-testid="draft-list-loading">
          Loading...
        </div>
      )}

      {error && !loading && (
        <div className={styles.listEmpty} data-testid="draft-list-error">
          {error}
        </div>
      )}

      {!loading && !error && drafts.length === 0 && (
        <div className={styles.listEmpty} data-testid="draft-list-empty">
          No migration delivery plans yet.
        </div>
      )}

      {!loading && !error && drafts.length > 0 && (
        <table className={styles.listTable}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Current arch</th>
              <th>Target arch</th>
              <th>Status</th>
              <th>Created</th>
              <th>Counts</th>
              <th>Confidence / readiness</th>
              <th>Last saved to backlog</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((d) => {
              const counts = itemCountsForDraft(d);
              const summary = confidenceReadinessSummary(d);
              const expansion = expansionSummaryForDraft(d);
              // Deterministic findings coverage (Spec 2026-06-11, Task
              // Group 4.4): the list API returns full drafts incl.
              // `book_of_work_json`, so the computed counts render per
              // row. Snapshot-less (legacy) rows show nothing (D8).
              const coverage = computeFindingsCoverage(
                d.generationSummary,
                d.bookOfWork?.items ?? [],
              );
              const archived = d.status === 'archived';
              const rowClass = [
                styles.listRow,
                archived ? styles.listRowArchived : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <tr
                  key={d.id}
                  className={rowClass}
                  onClick={() => onOpenDraft(d.id, d)}
                  data-testid={`draft-list-row-${d.id}`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenDraft(d.id, d);
                    }
                  }}
                >
                  <td>{d.title ?? '(untitled)'}</td>
                  <td>{d.currentArchitectureId}</td>
                  <td>{d.targetArchitectureId}</td>
                  <td data-testid={`draft-status-${d.id}`}>{d.status}</td>
                  <td>{formatDate(d.createdAt)}</td>
                  <td>
                    <span className={styles.miniChip}>
                      {counts.initiative} init
                    </span>
                    <span className={styles.miniChip}>{counts.epic} epic</span>
                    <span className={styles.miniChip}>
                      {counts.feature} feat
                    </span>
                    <span className={styles.miniChip}>
                      {counts.story} story
                    </span>
                    {expansion.total > 0 && (
                      <span
                        className={styles.miniChip}
                        data-testid={`draft-expansion-${d.id}`}
                      >
                        {expansion.expanded}/{expansion.total} epics expanded
                      </span>
                    )}
                    {coverage && (
                      <span
                        className={styles.miniChip}
                        data-testid={`draft-findings-coverage-${d.id}`}
                      >
                        {coverage.addressedCount}/{coverage.total} findings
                        addressed
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={styles.miniChip}>
                      {summary.high} high
                    </span>
                    <span className={styles.miniChip}>
                      {summary.medium} med
                    </span>
                    <span className={styles.miniChip}>{summary.low} low</span>
                    <span className={styles.miniChip}>
                      {summary.ready} ready
                    </span>
                    <span className={styles.miniChip}>
                      {summary.blocked} blocked
                    </span>
                  </td>
                  <td>{formatDate(d.savedToBacklogAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default MigrationBookOfWorkDraftListView;
