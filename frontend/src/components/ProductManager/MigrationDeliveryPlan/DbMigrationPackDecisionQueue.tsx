/**
 * DbMigrationPackDecisionQueue
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack —
 * Task Group 6 (Task 6.5 decision queue).
 *
 * Pack-scoped needs_decision queue modeled on the
 * `Discovery/FindingsTab.tsx` LIST + BULK-ACTION pattern (NOT a
 * conversational agenda):
 *
 *   - flat table of decisions with category/status filters (client-side,
 *     like FindingsTab's filter strip),
 *   - per-row resolve: pick one of the generator's concrete options
 *     (`options_json`) + an option-specific detail value where the
 *     resolution shape requires one (e.g. `specify_target_type` ->
 *     `resolution_json.target_type`),
 *   - bulk resolve: row checkboxes + a shared option applied to every
 *     selected OPEN decision in one atomic `resolve-bulk` call.
 *
 * Resolving (single or bulk) persists to the pack-scoped decision table and
 * marks the pack STALE AMS-side; the parent is notified via `onResolved` so
 * it can refetch the pack and light up the EXPLICIT Regenerate action.
 * Nothing here ever triggers regeneration.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  bulkResolveDbMigrationPackDecisions,
  listDbMigrationPackDecisions,
  resolveDbMigrationPackDecision,
  type DbMigrationPackDecisionDto,
} from '../../../api/dbMigrationPackApi';
import styles from './DbMigrationPack.module.css';

export interface DbMigrationPackDecisionQueueProps {
  projectId: string;
  packId: string;
  /**
   * Fired after any successful resolve (single or bulk) so the parent can
   * refetch the pack — the resolve marks the pack stale and enables the
   * explicit Regenerate action.
   */
  onResolved: () => void;
}

const CATEGORY_OPTIONS = [
  'type_mapping',
  'computed_column',
  'collation',
  'delta_key',
  'other',
] as const;

/**
 * Option-specific detail field of the resolution payload, exactly matching
 * what the generator reads back from `resolution_json` on regeneration
 * (`dbMigrationPackHandler.ts` / `dataScripts.ts` resolution shapes).
 */
function detailFieldForOption(option: string): { key: string; label: string } | null {
  switch (option) {
    case 'specify_target_type':
      return { key: 'target_type', label: 'Target type' };
    case 'provide_target_expression':
    case 'use_expression':
      return { key: 'expression', label: 'Expression' };
    case 'provide_restart_value':
      return { key: 'restart_with', label: 'Restart value' };
    case 'manually_specified_key':
      return { key: 'column', label: 'Delta key column' };
    default:
      return null;
  }
}

function optionStrings(decision: DbMigrationPackDecisionDto): string[] {
  return (decision.options_json ?? []).filter(
    (o): o is string => typeof o === 'string',
  );
}

function statusBadgeClass(status: string): string {
  return status === 'resolved' ? styles.badgeResolved : styles.badgeOpen;
}

export const DbMigrationPackDecisionQueue: React.FC<
  DbMigrationPackDecisionQueueProps
> = ({ projectId, packId, onResolved }) => {
  const [decisions, setDecisions] = useState<DbMigrationPackDecisionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters (FindingsTab-style strip; client-side over the loaded list).
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Per-row resolve state.
  const [rowOption, setRowOption] = useState<Record<string, string>>({});
  const [rowDetail, setRowDetail] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Bulk state.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOption, setBulkOption] = useState<string>('');
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listDbMigrationPackDecisions(projectId, packId);
      setDecisions(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load decisions');
    } finally {
      setLoading(false);
    }
  }, [projectId, packId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () =>
      decisions.filter(
        (d) =>
          (categoryFilter === 'all' || d.category === categoryFilter) &&
          (statusFilter === 'all' || d.status === statusFilter),
      ),
    [decisions, categoryFilter, statusFilter],
  );

  const visibleOpen = useMemo(
    () => visible.filter((d) => d.status === 'open'),
    [visible],
  );

  /** Union of options across the SELECTED open decisions (bulk select). */
  const bulkOptions = useMemo(() => {
    const out: string[] = [];
    for (const d of visibleOpen) {
      if (!selectedIds.has(d.id)) continue;
      for (const o of optionStrings(d)) {
        if (!out.includes(o)) out.push(o);
      }
    }
    return out;
  }, [visibleOpen, selectedIds]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (prev.size === visibleOpen.length && visibleOpen.length > 0) {
        return new Set();
      }
      return new Set(visibleOpen.map((d) => d.id));
    });
  };

  const buildResolution = (
    option: string,
    detail: string,
  ): Record<string, unknown> => {
    const resolution: Record<string, unknown> = { option };
    const detailField = detailFieldForOption(option);
    if (detailField && detail.trim()) {
      resolution[detailField.key] = detail.trim();
    }
    return resolution;
  };

  const handleResolveRow = async (decision: DbMigrationPackDecisionDto) => {
    const option = rowOption[decision.id] ?? '';
    if (!option || resolvingId) return;
    setResolvingId(decision.id);
    setError(null);
    try {
      await resolveDbMigrationPackDecision(
        projectId,
        packId,
        decision.id,
        buildResolution(option, rowDetail[decision.id] ?? ''),
      );
      await load();
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve decision');
    } finally {
      setResolvingId(null);
    }
  };

  const handleBulkResolve = async () => {
    const ids = visibleOpen.filter((d) => selectedIds.has(d.id)).map((d) => d.id);
    if (ids.length === 0 || !bulkOption || bulkBusy) return;
    setBulkBusy(true);
    setError(null);
    try {
      await bulkResolveDbMigrationPackDecisions(
        projectId,
        packId,
        ids,
        buildResolution(bulkOption, ''),
      );
      setSelectedIds(new Set());
      setBulkOption('');
      await load();
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to bulk-resolve decisions');
    } finally {
      setBulkBusy(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.emptyMessage} data-testid="db-pack-decisions-loading">
        Loading decisions…
      </div>
    );
  }

  return (
    <div data-testid="db-pack-decision-queue">
      <div className={styles.queueToolbar}>
        <label className={styles.filterGroup}>
          <span className={styles.filterLabel}>Category</span>
          <select
            className={styles.filterSelect}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            data-testid="db-pack-decisions-category-filter"
          >
            <option value="all">All categories</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterGroup}>
          <span className={styles.filterLabel}>Status</span>
          <select
            className={styles.filterSelect}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            data-testid="db-pack-decisions-status-filter"
          >
            <option value="all">All statuses</option>
            <option value="open">open</option>
            <option value="resolved">resolved</option>
          </select>
        </label>
      </div>

      {error && (
        <div className={styles.errorBanner} data-testid="db-pack-decisions-error">
          {error}
        </div>
      )}

      {visibleOpen.length > 0 && (
        <div className={styles.bulkBar} data-testid="db-pack-decisions-bulk-bar">
          <label className={styles.filterToggle}>
            <input
              type="checkbox"
              checked={
                selectedIds.size === visibleOpen.length && visibleOpen.length > 0
              }
              onChange={toggleSelectAll}
              data-testid="db-pack-decisions-select-all"
            />{' '}
            Select all open ({visibleOpen.length})
          </label>
          <span data-testid="db-pack-decisions-selected-count">
            {selectedIds.size} selected
          </span>
          <select
            className={styles.filterSelect}
            value={bulkOption}
            onChange={(e) => setBulkOption(e.target.value)}
            data-testid="db-pack-decisions-bulk-option"
          >
            <option value="">Choose resolution option…</option>
            {bulkOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
            onClick={() => void handleBulkResolve()}
            disabled={bulkBusy || selectedIds.size === 0 || !bulkOption}
            data-testid="db-pack-decisions-bulk-resolve"
          >
            {bulkBusy ? 'Resolving…' : `Resolve ${selectedIds.size} with same option`}
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <div className={styles.emptyMessage} data-testid="db-pack-decisions-empty">
          No decisions match the current filters.
        </div>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.dataTable} data-testid="db-pack-decisions-table">
            <thead>
              <tr>
                <th />
                <th>Object</th>
                <th>Category</th>
                <th>Question</th>
                <th>Status</th>
                <th>Resolution</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => {
                const opts = optionStrings(d);
                const chosen = rowOption[d.id] ?? '';
                const detailField = chosen ? detailFieldForOption(chosen) : null;
                return (
                  <tr
                    key={d.id}
                    data-testid={`db-pack-decision-row-${d.id}`}
                    data-decision-status={d.status}
                  >
                    <td>
                      {d.status === 'open' && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(d.id)}
                          onChange={() => toggleSelected(d.id)}
                          data-testid={`db-pack-decision-select-${d.id}`}
                        />
                      )}
                    </td>
                    <td>
                      <span className={styles.refChip} title={d.object_ref}>
                        {d.object_ref}
                      </span>
                    </td>
                    <td>
                      <span className={styles.badge}>{d.category}</span>
                    </td>
                    <td>{d.question}</td>
                    <td>
                      <span className={statusBadgeClass(d.status)}>{d.status}</span>
                    </td>
                    <td>
                      {d.status === 'resolved' ? (
                        <span data-testid={`db-pack-decision-resolution-${d.id}`}>
                          {typeof d.resolution_json?.option === 'string'
                            ? (d.resolution_json.option as string)
                            : '—'}
                        </span>
                      ) : (
                        <div className={styles.inlineResolve}>
                          <select
                            className={styles.filterSelect}
                            value={chosen}
                            onChange={(e) =>
                              setRowOption((prev) => ({
                                ...prev,
                                [d.id]: e.target.value,
                              }))
                            }
                            data-testid={`db-pack-decision-option-${d.id}`}
                          >
                            <option value="">Choose option…</option>
                            {opts.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                          {detailField && (
                            <input
                              className={styles.filterInput}
                              placeholder={detailField.label}
                              value={rowDetail[d.id] ?? ''}
                              onChange={(e) =>
                                setRowDetail((prev) => ({
                                  ...prev,
                                  [d.id]: e.target.value,
                                }))
                              }
                              data-testid={`db-pack-decision-detail-${d.id}`}
                            />
                          )}
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() => void handleResolveRow(d)}
                            disabled={!chosen || resolvingId !== null}
                            data-testid={`db-pack-decision-resolve-${d.id}`}
                          >
                            {resolvingId === d.id ? 'Resolving…' : 'Resolve'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default DbMigrationPackDecisionQueue;
