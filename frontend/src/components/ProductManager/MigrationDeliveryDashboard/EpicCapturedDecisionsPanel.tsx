/**
 * EpicCapturedDecisionsPanel
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 8.2
 *
 * Dedicated edit panel for an epic's captured decisions. Renders as a modal /
 * drawer surface invoked from the Migration Delivery Dashboard's
 * `MigrationDeliveryEpicDecisionsSummary` ("Edit" link per row). The full
 * read-only collapsed summary stays on the dashboard; this panel owns CRUD.
 *
 * Surfaces:
 *  - List view with status filter (draft / confirmed / superseded).
 *  - Inline edit on each row (decisionKey / decisionText / status).
 *  - One-click "Confirm" affordance on draft rows (status -> confirmed).
 *  - "Add decision" affordance that creates a `user_added` row.
 *  - Source chip on auto-extracted rows ("auto-extracted from spec X, unedited"),
 *    which disappears after the row's source flips to `user_edited` post-save.
 *  - Delete action on each row.
 *
 * Wiring contract: the dashboard route owns whether this panel is open and
 * which epic is targeted. The panel itself is self-contained and fetches its
 * own data on mount.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EpicCapturedDecisionDto,
  EpicCapturedDecisionStatus,
  createEpicCapturedDecision,
  deleteEpicCapturedDecision,
  listEpicCapturedDecisions,
  updateEpicCapturedDecision,
} from '../../../api/epicCapturedDecisionsApi';

// ============================================================================
// Public types
// ============================================================================

export interface EpicCapturedDecisionsPanelProps {
  projectId: string;
  epicWorkItemId: string;
  epicTitle?: string;
  /** Invoked when the user closes the panel. */
  onClose: () => void;
  /** Test seam: override the list fetcher. */
  listFn?: typeof listEpicCapturedDecisions;
  /** Test seam: override the create call. */
  createFn?: typeof createEpicCapturedDecision;
  /** Test seam: override the update call. */
  updateFn?: typeof updateEpicCapturedDecision;
  /** Test seam: override the delete call. */
  deleteFn?: typeof deleteEpicCapturedDecision;
}

// ============================================================================
// Helpers
// ============================================================================

const STATUSES: ReadonlyArray<EpicCapturedDecisionStatus> = [
  'draft',
  'confirmed',
  'superseded',
];

type StatusFilter = 'all' | EpicCapturedDecisionStatus;

function filterByStatus(
  rows: ReadonlyArray<EpicCapturedDecisionDto>,
  filter: StatusFilter,
): EpicCapturedDecisionDto[] {
  if (filter === 'all') return rows.slice();
  return rows.filter((r) => r.status === filter);
}

// ============================================================================
// Inline editor for a single row
// ============================================================================

interface DecisionRowProps {
  row: EpicCapturedDecisionDto;
  isSaving: boolean;
  onSave: (
    id: string,
    updates: {
      decisionKey?: string;
      decisionText?: string;
      status?: EpicCapturedDecisionStatus;
    },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const DecisionRow: React.FC<DecisionRowProps> = ({
  row,
  isSaving,
  onSave,
  onDelete,
}) => {
  const [editing, setEditing] = useState(false);
  const [draftKey, setDraftKey] = useState(row.decisionKey);
  const [draftText, setDraftText] = useState(row.decisionText);
  const [draftStatus, setDraftStatus] = useState<EpicCapturedDecisionStatus>(
    row.status,
  );

  // Re-seed local draft state if the row changes underneath us (e.g. after a
  // PATCH the source flips and we get a fresh row from the parent).
  useEffect(() => {
    if (!editing) {
      setDraftKey(row.decisionKey);
      setDraftText(row.decisionText);
      setDraftStatus(row.status);
    }
  }, [row.decisionKey, row.decisionText, row.status, editing]);

  const isAutoExtracted = row.source === 'auto_extracted';

  const handleSave = async () => {
    await onSave(row.id, {
      decisionKey: draftKey,
      decisionText: draftText,
      status: draftStatus,
    });
    setEditing(false);
  };

  const handleConfirm = async () => {
    await onSave(row.id, { status: 'confirmed' });
  };

  return (
    <li
      data-testid={`epic-decision-row-${row.id}`}
      style={{
        listStyle: 'none',
        padding: '12px',
        borderBottom: '1px solid #e5e7eb',
        background: editing ? '#f9fafb' : 'transparent',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Source / status chip row */}
          <div
            style={{
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
              marginBottom: '6px',
            }}
          >
            <span
              data-testid={`epic-decision-row-${row.id}-status-chip`}
              style={{
                padding: '2px 8px',
                fontSize: '12px',
                borderRadius: '12px',
                background:
                  row.status === 'confirmed'
                    ? '#dcfce7'
                    : row.status === 'superseded'
                      ? '#e5e7eb'
                      : '#fef3c7',
                color:
                  row.status === 'confirmed'
                    ? '#166534'
                    : row.status === 'superseded'
                      ? '#374151'
                      : '#92400e',
              }}
            >
              {row.status}
            </span>
            {isAutoExtracted && (
              <span
                data-testid={`epic-decision-row-${row.id}-source-chip`}
                style={{
                  padding: '2px 8px',
                  fontSize: '12px',
                  borderRadius: '12px',
                  background: '#dbeafe',
                  color: '#1e40af',
                }}
              >
                {row.sourceSpecGenerationId
                  ? `auto-extracted from spec ${row.sourceSpecGenerationId.slice(0, 8)}, unedited`
                  : 'auto-extracted, unedited'}
              </span>
            )}
            {row.source === 'user_edited' && (
              <span
                data-testid={`epic-decision-row-${row.id}-user-edited-chip`}
                style={{
                  padding: '2px 8px',
                  fontSize: '12px',
                  borderRadius: '12px',
                  background: '#e0e7ff',
                  color: '#3730a3',
                }}
              >
                user-edited
              </span>
            )}
            {row.source === 'user_added' && (
              <span
                data-testid={`epic-decision-row-${row.id}-user-added-chip`}
                style={{
                  padding: '2px 8px',
                  fontSize: '12px',
                  borderRadius: '12px',
                  background: '#fce7f3',
                  color: '#9d174d',
                }}
              >
                user-added
              </span>
            )}
          </div>

          {/* View or edit form */}
          {!editing ? (
            <>
              <div
                data-testid={`epic-decision-row-${row.id}-key`}
                style={{ fontWeight: 600, fontSize: '14px' }}
              >
                {row.decisionKey}
              </div>
              <div
                data-testid={`epic-decision-row-${row.id}-text`}
                style={{
                  fontSize: '13px',
                  color: '#374151',
                  marginTop: '4px',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {row.decisionText}
              </div>
            </>
          ) : (
            <>
              <label
                htmlFor={`epic-decision-row-${row.id}-key-input`}
                style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}
              >
                Key
              </label>
              <input
                id={`epic-decision-row-${row.id}-key-input`}
                data-testid={`epic-decision-row-${row.id}-key-input`}
                type="text"
                value={draftKey}
                disabled={isSaving}
                onChange={(e) => setDraftKey(e.target.value)}
                style={{
                  width: '100%',
                  padding: '4px 6px',
                  fontSize: '13px',
                  marginBottom: '6px',
                }}
              />
              <label
                htmlFor={`epic-decision-row-${row.id}-text-input`}
                style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}
              >
                Decision text
              </label>
              <textarea
                id={`epic-decision-row-${row.id}-text-input`}
                data-testid={`epic-decision-row-${row.id}-text-input`}
                value={draftText}
                disabled={isSaving}
                onChange={(e) => setDraftText(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: '4px 6px',
                  fontSize: '13px',
                  marginBottom: '6px',
                  fontFamily: 'inherit',
                }}
              />
              <label
                htmlFor={`epic-decision-row-${row.id}-status-input`}
                style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}
              >
                Status
              </label>
              <select
                id={`epic-decision-row-${row.id}-status-input`}
                data-testid={`epic-decision-row-${row.id}-status-input`}
                value={draftStatus}
                disabled={isSaving}
                onChange={(e) =>
                  setDraftStatus(e.target.value as EpicCapturedDecisionStatus)
                }
                style={{ fontSize: '13px', padding: '4px' }}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        {/* Row actions */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            minWidth: '110px',
          }}
        >
          {!editing && row.status === 'draft' && (
            <button
              type="button"
              data-testid={`epic-decision-row-${row.id}-confirm`}
              onClick={() => void handleConfirm()}
              disabled={isSaving}
            >
              Confirm
            </button>
          )}
          {!editing && (
            <button
              type="button"
              data-testid={`epic-decision-row-${row.id}-edit`}
              onClick={() => setEditing(true)}
              disabled={isSaving}
            >
              Edit
            </button>
          )}
          {editing && (
            <button
              type="button"
              data-testid={`epic-decision-row-${row.id}-save`}
              onClick={() => void handleSave()}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          )}
          {editing && (
            <button
              type="button"
              data-testid={`epic-decision-row-${row.id}-cancel`}
              onClick={() => {
                setEditing(false);
                setDraftKey(row.decisionKey);
                setDraftText(row.decisionText);
                setDraftStatus(row.status);
              }}
              disabled={isSaving}
            >
              Cancel
            </button>
          )}
          {!editing && (
            <button
              type="button"
              data-testid={`epic-decision-row-${row.id}-delete`}
              onClick={() => void onDelete(row.id)}
              disabled={isSaving}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </li>
  );
};

// ============================================================================
// Panel
// ============================================================================

export const EpicCapturedDecisionsPanel: React.FC<
  EpicCapturedDecisionsPanelProps
> = ({
  projectId,
  epicWorkItemId,
  epicTitle,
  onClose,
  listFn = listEpicCapturedDecisions,
  createFn = createEpicCapturedDecision,
  updateFn = updateEpicCapturedDecision,
  deleteFn = deleteEpicCapturedDecision,
}) => {
  const [rows, setRows] = useState<EpicCapturedDecisionDto[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Per-row saving flag keyed by id so two rows can be edited without
  // collisions. The "Add decision" affordance uses a sentinel '__new__' key.
  const [savingId, setSavingId] = useState<string | null>(null);

  // Add-decision form state.
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [draftKey, setDraftKey] = useState<string>('');
  const [draftText, setDraftText] = useState<string>('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await listFn(projectId, epicWorkItemId);
      setRows(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load decisions');
    } finally {
      setLoading(false);
    }
  }, [projectId, epicWorkItemId, listFn]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filteredRows = useMemo(
    () => filterByStatus(rows, statusFilter),
    [rows, statusFilter],
  );

  const handleSaveRow = useCallback(
    async (
      id: string,
      updates: {
        decisionKey?: string;
        decisionText?: string;
        status?: EpicCapturedDecisionStatus;
      },
    ) => {
      setSavingId(id);
      setError(null);
      try {
        const updated = await updateFn(projectId, epicWorkItemId, id, updates);
        setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save decision');
      } finally {
        setSavingId(null);
      }
    },
    [projectId, epicWorkItemId, updateFn],
  );

  const handleDeleteRow = useCallback(
    async (id: string) => {
      setSavingId(id);
      setError(null);
      try {
        await deleteFn(projectId, epicWorkItemId, id);
        setRows((prev) => prev.filter((r) => r.id !== id));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to delete decision');
      } finally {
        setSavingId(null);
      }
    },
    [projectId, epicWorkItemId, deleteFn],
  );

  const handleAdd = useCallback(async () => {
    if (!draftKey.trim() || !draftText.trim()) {
      setError('Both key and decision text are required');
      return;
    }
    setSavingId('__new__');
    setError(null);
    try {
      await createFn(projectId, epicWorkItemId, {
        decisionKey: draftKey.trim(),
        decisionText: draftText.trim(),
        status: 'draft',
      });
      setDraftKey('');
      setDraftText('');
      setAddOpen(false);
      // Re-fetch the list so the new row appears with server-assigned id /
      // timestamps.
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add decision');
    } finally {
      setSavingId(null);
    }
  }, [projectId, epicWorkItemId, draftKey, draftText, createFn, reload]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="epic-captured-decisions-panel-title"
      data-testid="epic-captured-decisions-panel"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          padding: '20px 24px',
          borderRadius: '8px',
          minWidth: '560px',
          maxWidth: '780px',
          maxHeight: '88vh',
          overflowY: 'auto',
          width: '100%',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '12px',
          }}
        >
          <h2 id="epic-captured-decisions-panel-title" style={{ margin: 0 }}>
            Epic captured decisions{epicTitle ? `: ${epicTitle}` : ''}
          </h2>
          <button
            type="button"
            data-testid="epic-captured-decisions-panel-close"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        {/* Status filter */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '12px',
          }}
        >
          <label
            htmlFor="epic-captured-decisions-panel-status-filter"
            style={{ fontSize: '13px', fontWeight: 600 }}
          >
            Filter by status:
          </label>
          <select
            id="epic-captured-decisions-panel-status-filter"
            data-testid="epic-captured-decisions-panel-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            style={{ padding: '4px 6px', fontSize: '13px' }}
          >
            <option value="all">All</option>
            <option value="draft">draft</option>
            <option value="confirmed">confirmed</option>
            <option value="superseded">superseded</option>
          </select>
          <button
            type="button"
            data-testid="epic-captured-decisions-panel-add"
            onClick={() => setAddOpen((o) => !o)}
            style={{ marginLeft: 'auto' }}
          >
            {addOpen ? 'Cancel add' : 'Add decision'}
          </button>
        </div>

        {/* Add-decision inline form */}
        {addOpen && (
          <div
            data-testid="epic-captured-decisions-panel-add-form"
            style={{
              padding: '12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              marginBottom: '12px',
              background: '#f9fafb',
            }}
          >
            <label
              htmlFor="epic-captured-decisions-panel-new-key-input"
              style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}
            >
              Key
            </label>
            <input
              id="epic-captured-decisions-panel-new-key-input"
              data-testid="epic-captured-decisions-panel-new-key-input"
              type="text"
              value={draftKey}
              disabled={savingId === '__new__'}
              onChange={(e) => setDraftKey(e.target.value)}
              style={{
                width: '100%',
                padding: '4px 6px',
                fontSize: '13px',
                marginBottom: '8px',
              }}
            />
            <label
              htmlFor="epic-captured-decisions-panel-new-text-input"
              style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}
            >
              Decision text
            </label>
            <textarea
              id="epic-captured-decisions-panel-new-text-input"
              data-testid="epic-captured-decisions-panel-new-text-input"
              value={draftText}
              disabled={savingId === '__new__'}
              onChange={(e) => setDraftText(e.target.value)}
              rows={3}
              style={{
                width: '100%',
                padding: '4px 6px',
                fontSize: '13px',
                marginBottom: '8px',
                fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                data-testid="epic-captured-decisions-panel-new-save"
                onClick={() => void handleAdd()}
                disabled={savingId === '__new__'}
              >
                {savingId === '__new__' ? 'Adding...' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div
            data-testid="epic-captured-decisions-panel-error"
            role="alert"
            style={{
              padding: '8px 12px',
              background: '#fef2f2',
              color: '#991b1b',
              borderRadius: '6px',
              marginBottom: '12px',
              fontSize: '13px',
            }}
          >
            {error}
          </div>
        )}

        {/* Loading / empty / list */}
        {loading && (
          <p
            data-testid="epic-captured-decisions-panel-loading"
            style={{ fontSize: '13px', color: '#6b7280' }}
          >
            Loading decisions...
          </p>
        )}
        {!loading && filteredRows.length === 0 && (
          <p
            data-testid="epic-captured-decisions-panel-empty"
            style={{ fontSize: '13px', color: '#6b7280' }}
          >
            No decisions to display.
          </p>
        )}
        {!loading && filteredRows.length > 0 && (
          <ul
            data-testid="epic-captured-decisions-panel-list"
            style={{ padding: 0, margin: 0 }}
          >
            {filteredRows.map((row) => (
              <DecisionRow
                key={row.id}
                row={row}
                isSaving={savingId === row.id}
                onSave={handleSaveRow}
                onDelete={handleDeleteRow}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default EpicCapturedDecisionsPanel;
