/**
 * DbGapProposalsSection
 *
 * Spec 4 (2026-08-04) — LLM gap-proposal queue (frontend surface).
 *
 * Rendered inline UNDER a structural-finding row (an expandable full-width
 * table row in the findings panel). Lists the AMS review-queue rows for that
 * finding's `finding_key` and carries the whole review loop:
 *
 *   - Generate ("Draft proposals with AI" in the parent row) bumps
 *     `generateSeq`; this component runs the generate call, renders the
 *     honest per-drop warnings + `unsupportedReason` (supported: false =
 *     this finding kind has no LLM resolution path), then refetches the
 *     queue (valid drafts are persisted server-side by the generate route).
 *   - Approve fires the review action WITH `architecture_id`; the additive
 *     model apply's skip notes / `apply_error` come back as data and are
 *     surfaced verbatim. After ANY approve a reminder renders: findings only
 *     clear on pack REGENERATION — nothing is fake-cleared client-side.
 *   - Reject REQUIRES a short reason (reviewer_notes); Needs rework takes an
 *     optional note (server-side it returns the row to the unreviewed pool
 *     carrying the note).
 *   - "Add manually" is a compact one-row form (kind selector + per-kind
 *     inputs); a 400 (hallucinated table/column names) renders the
 *     validation warnings inline.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  addManualGapProposal,
  DbGapProposalValidationError,
  generateGapProposals,
  listGapProposals,
  reviewGapProposal,
  type DbGapProposalKind,
  type DbGapProposalReviewAction,
  type DbGapProposalRow,
} from '../../../api/dbMigrationPackApi';
import styles from './DbMigrationPack.module.css';

export interface DbGapProposalsSectionProps {
  projectId: string;
  /** Rides on generate / review(approve) / manual-add calls. */
  architectureId: string;
  /** The owning structural finding's stable `kind:subject` key. */
  findingKey: string;
  /** The owning finding's kind — sent as `finding_kind` on generate. */
  findingKind: string;
  /**
   * Bumped by the parent on every "Draft proposals with AI" click; 0 means
   * "list only, never generated from here". Each bump runs ONE generate.
   */
  generateSeq: number;
}

/** "orders.customer_id" / "orders.(a, b)" — one side of the fk summary. */
function tableCols(table: string, cols: string[]): string {
  if (cols.length === 1) return `${table}.${cols[0]}`;
  return `${table}.(${cols.join(', ')})`;
}

/** Human summary of `payload_json` — fk: "orders.customer_id → customers.id"; pk: "orders: PK(order_id)". */
export function summarizeGapProposalPayload(
  kind: string,
  payload: unknown,
): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (kind === 'fk_join') {
    const join = Array.isArray(p.join_columns) ? p.join_columns.map(String) : [];
    const referenced = Array.isArray(p.referenced_columns)
      ? p.referenced_columns.map(String)
      : [];
    const from =
      typeof p.from_table === 'string' && p.from_table
        ? p.from_table
        : String(p.relationship_id ?? '?');
    const to = typeof p.to_table === 'string' && p.to_table ? p.to_table : '?';
    return `${tableCols(from, join)} → ${tableCols(to, referenced)}`;
  }
  if (kind === 'primary_key') {
    const table = typeof p.table === 'string' && p.table ? p.table : '?';
    const cols = Array.isArray(p.columns) ? p.columns.map(String) : [];
    return `${table}: PK(${cols.join(', ')})`;
  }
  return JSON.stringify(p);
}

function kindChipLabel(kind: string): string {
  if (kind === 'fk_join') return 'FK join';
  if (kind === 'primary_key') return 'Primary key';
  return kind;
}

function confidenceChipClass(confidence: string): string {
  switch (confidence) {
    case 'high':
      return styles.badgeResolved;
    case 'medium':
      return styles.badgeFlagged;
    default:
      return styles.badgeMissing;
  }
}

function reviewStatusChip(status: string): { label: string; className: string } {
  switch (status) {
    case 'approved':
      return { label: 'Approved', className: styles.badgeResolved };
    case 'rejected':
      return { label: 'Rejected', className: styles.badgeMissing };
    case 'needs_rework':
      return { label: 'Needs rework', className: styles.badgeFlagged };
    default:
      return { label: 'Unreviewed', className: styles.badgeOpen };
  }
}

function splitCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Rows a reviewer can still act on. */
function isReviewable(row: DbGapProposalRow): boolean {
  return row.review_status === 'unreviewed' || row.review_status === 'needs_rework';
}

interface ReviewNoteDraft {
  action: Extract<DbGapProposalReviewAction, 'reject' | 'needs_rework'>;
  note: string;
}

interface ManualDraft {
  kind: DbGapProposalKind;
  relationshipId: string;
  joinColumns: string;
  referencedColumns: string;
  table: string;
  columns: string;
}

function emptyManualDraft(findingKind: string): ManualDraft {
  return {
    kind: findingKind === 'no_primary_keys' ? 'primary_key' : 'fk_join',
    relationshipId: '',
    joinColumns: '',
    referencedColumns: '',
    table: '',
    columns: '',
  };
}

export const DbGapProposalsSection: React.FC<DbGapProposalsSectionProps> = ({
  projectId,
  architectureId,
  findingKey,
  findingKind,
  generateSeq,
}) => {
  const [rows, setRows] = useState<DbGapProposalRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateWarnings, setGenerateWarnings] = useState<string[]>([]);
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Proposal id an action is in flight for. */
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Rows in reject/needs-rework note-entry mode: id -> draft. */
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewNoteDraft>>({});
  /** Rendered after ANY approve — findings only clear on pack regeneration. */
  const [approveReminder, setApproveReminder] = useState(false);
  /** Honest apply outcomes: skip notes and/or apply_error, verbatim. */
  const [applyNotices, setApplyNotices] = useState<string[]>([]);
  // Manual-add form.
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState<ManualDraft>(() => emptyManualDraft(findingKind));
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualWarnings, setManualWarnings] = useState<string[]>([]);

  const loadRows = useCallback(async () => {
    const result = await listGapProposals(projectId, findingKey);
    setRows(result);
  }, [projectId, findingKey]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void (async () => {
      try {
        const result = await listGapProposals(projectId, findingKey);
        if (!cancelled) setRows(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load gap proposals');
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, findingKey]);

  const runGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setUnsupportedReason(null);
    setGenerateWarnings([]);
    try {
      const result = await generateGapProposals(projectId, {
        architecture_id: architectureId,
        finding_kind: findingKind,
        finding_key: findingKey,
      });
      setGenerateWarnings(result.warnings ?? []);
      if (!result.supported) {
        setUnsupportedReason(
          result.unsupportedReason ??
            'AI drafting is not supported for this finding kind.',
        );
      }
      // Valid drafts were persisted server-side — the queue is the truth.
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gap-proposal generation failed');
    } finally {
      setGenerating(false);
    }
  }, [projectId, architectureId, findingKind, findingKey, loadRows]);

  // One generate per parent bump (the seq is monotonic; a ref survives
  // re-renders without retriggering the effect spuriously).
  const seenSeqRef = useRef(0);
  useEffect(() => {
    if (generateSeq > seenSeqRef.current) {
      seenSeqRef.current = generateSeq;
      void runGenerate();
    }
  }, [generateSeq, runGenerate]);

  const fireReview = useCallback(
    async (row: DbGapProposalRow, action: DbGapProposalReviewAction, note?: string) => {
      if (busyId) return;
      setBusyId(row.id);
      setError(null);
      try {
        const response = await reviewGapProposal(projectId, row.id, {
          action,
          architecture_id: architectureId,
          ...(note ? { reviewer_notes: note } : {}),
        });
        if (action === 'approve') {
          setApproveReminder(true);
          const notices: string[] = [];
          if (response.apply_error) notices.push(response.apply_error);
          for (const skip of response.apply?.skipped ?? []) {
            notices.push(`Apply skipped: ${skip.reason}`);
          }
          setApplyNotices(notices);
        }
        setReviewDrafts((prev) => {
          const next = { ...prev };
          delete next[row.id];
          return next;
        });
        await loadRows();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Review action failed');
      } finally {
        setBusyId(null);
      }
    },
    [busyId, projectId, architectureId, loadRows],
  );

  const confirmReviewDraft = useCallback(
    (row: DbGapProposalRow) => {
      const draft = reviewDrafts[row.id];
      if (!draft) return;
      const note = draft.note.trim();
      if (draft.action === 'reject' && !note) {
        setError('A short reason is required to reject a proposal.');
        return;
      }
      void fireReview(row, draft.action, note || undefined);
    },
    [reviewDrafts, fireReview],
  );

  const submitManual = useCallback(async () => {
    setManualError(null);
    setManualWarnings([]);
    let payload: Record<string, unknown>;
    if (manual.kind === 'fk_join') {
      const relationshipId = manual.relationshipId.trim();
      const joinColumns = splitCsv(manual.joinColumns);
      const referencedColumns = splitCsv(manual.referencedColumns);
      if (!relationshipId || joinColumns.length === 0 || referencedColumns.length === 0) {
        setManualError(
          'Relationship id, join columns and referenced columns are all required.',
        );
        return;
      }
      payload = {
        relationship_id: relationshipId,
        join_columns: joinColumns,
        referenced_columns: referencedColumns,
      };
    } else {
      const table = manual.table.trim();
      const columns = splitCsv(manual.columns);
      if (!table || columns.length === 0) {
        setManualError('Table and columns are both required.');
        return;
      }
      payload = { table, columns };
    }
    setManualBusy(true);
    try {
      await addManualGapProposal(projectId, {
        architecture_id: architectureId,
        finding_key: findingKey,
        kind: manual.kind,
        payload_json: payload,
      });
      setManualOpen(false);
      setManual(emptyManualDraft(findingKind));
      await loadRows();
    } catch (err) {
      if (err instanceof DbGapProposalValidationError) {
        setManualError(err.message);
        setManualWarnings(err.warnings);
      } else {
        setManualError(
          err instanceof Error ? err.message : 'Failed to add the manual proposal',
        );
      }
    } finally {
      setManualBusy(false);
    }
  }, [manual, projectId, architectureId, findingKey, findingKind, loadRows]);

  return (
    <div
      className={styles.manifestSection}
      data-testid={`db-gap-proposals-${findingKey}`}
    >
      <h5 className={styles.manifestSectionTitle}>Gap proposals</h5>
      <p className={styles.manifestNote}>
        Drafted from the committed model. Nothing touches the model until a
        proposal is approved; approval writes additively (populated slots are
        never overwritten).
      </p>

      {generating && (
        <p
          className={styles.manifestNote}
          data-testid={`db-gap-proposals-generating-${findingKey}`}
        >
          Drafting proposals with AI&hellip;
        </p>
      )}

      {unsupportedReason && (
        <div
          className={styles.noticeBanner}
          data-testid={`db-gap-proposals-unsupported-${findingKey}`}
        >
          {unsupportedReason}
        </div>
      )}

      {generateWarnings.length > 0 && (
        <div data-testid={`db-gap-proposals-warnings-${findingKey}`}>
          <p className={styles.manifestNote}>
            Dropped drafts (failed validation against the committed model):
          </p>
          <ul className={styles.orderedList}>
            {generateWarnings.map((warning, index) => (
              <li key={index} className={styles.manifestNote}>
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div
          className={styles.errorBanner}
          data-testid={`db-gap-proposals-error-${findingKey}`}
        >
          {error}
        </div>
      )}

      {approveReminder && (
        <div
          className={styles.noticeBanner}
          data-testid={`db-gap-proposals-regenerate-reminder-${findingKey}`}
        >
          Approved metadata is written to the model &mdash; Regenerate the pack
          to clear the finding.
        </div>
      )}

      {applyNotices.map((notice, index) => (
        <div
          key={index}
          className={styles.noticeBanner}
          data-testid={`db-gap-proposals-apply-note-${findingKey}`}
        >
          {notice}
        </div>
      ))}

      {loaded && rows.length === 0 && !generating && !unsupportedReason && (
        <p
          className={styles.emptyMessage}
          data-testid={`db-gap-proposals-empty-${findingKey}`}
        >
          No proposals queued for this finding yet.
        </p>
      )}

      {rows.length > 0 && (
        <div className={styles.tableScroll}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Proposal</th>
                <th>Rationale</th>
                <th>Confidence</th>
                <th>Origin</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = reviewStatusChip(String(row.review_status));
                const draft = reviewDrafts[row.id] ?? null;
                return (
                  <tr key={row.id} data-testid={`db-gap-proposal-${row.id}`}>
                    <td>
                      <span className={styles.badge}>
                        {kindChipLabel(String(row.kind))}
                      </span>
                    </td>
                    <td data-testid={`db-gap-proposal-summary-${row.id}`}>
                      {summarizeGapProposalPayload(String(row.kind), row.payload_json)}
                    </td>
                    <td>
                      {row.rationale}
                      {row.reviewer_notes && (
                        <p
                          className={styles.manifestNote}
                          data-testid={`db-gap-proposal-reviewer-notes-${row.id}`}
                        >
                          Reviewer: {row.reviewer_notes}
                        </p>
                      )}
                    </td>
                    <td>
                      <span className={confidenceChipClass(String(row.confidence))}>
                        {String(row.confidence)}
                      </span>
                    </td>
                    <td>
                      <span
                        className={styles.badge}
                        data-testid={`db-gap-proposal-origin-${row.id}`}
                      >
                        {row.origin === 'llm' ? 'AI' : 'Manual'}
                      </span>
                    </td>
                    <td>
                      <span
                        className={status.className}
                        data-testid={`db-gap-proposal-status-${row.id}`}
                      >
                        {status.label}
                      </span>{' '}
                      {row.applied_at && (
                        <span
                          className={styles.badgeResolved}
                          title={`Applied ${row.applied_at}`}
                          data-testid={`db-gap-proposal-applied-${row.id}`}
                        >
                          {'✓'} applied
                        </span>
                      )}
                    </td>
                    <td>
                      {isReviewable(row) &&
                        (draft ? (
                          <div className={styles.inlineResolve}>
                            <input
                              type="text"
                              className={styles.filterInput}
                              placeholder={
                                draft.action === 'reject'
                                  ? 'Reason (required)'
                                  : 'Note (optional)'
                              }
                              value={draft.note}
                              onChange={(e) =>
                                setReviewDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: { ...draft, note: e.target.value },
                                }))
                              }
                              data-testid={`db-gap-proposal-note-input-${row.id}`}
                            />
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => confirmReviewDraft(row)}
                              disabled={busyId !== null}
                              data-testid={`db-gap-proposal-note-confirm-${row.id}`}
                            >
                              {draft.action === 'reject' ? 'Reject' : 'Needs rework'}
                            </button>
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() =>
                                setReviewDrafts((prev) => {
                                  const next = { ...prev };
                                  delete next[row.id];
                                  return next;
                                })
                              }
                              data-testid={`db-gap-proposal-note-cancel-${row.id}`}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className={styles.actionsBar}>
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => void fireReview(row, 'approve')}
                              disabled={busyId !== null}
                              title="Write this metadata into the model additively"
                              data-testid={`db-gap-proposal-approve-${row.id}`}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => {
                                setError(null);
                                setReviewDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: { action: 'reject', note: '' },
                                }));
                              }}
                              disabled={busyId !== null}
                              title="Requires a short reason"
                              data-testid={`db-gap-proposal-reject-${row.id}`}
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => {
                                setError(null);
                                setReviewDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: { action: 'needs_rework', note: '' },
                                }));
                              }}
                              disabled={busyId !== null}
                              title="Return to the unreviewed pool with a note"
                              data-testid={`db-gap-proposal-needs-rework-${row.id}`}
                            >
                              Needs rework
                            </button>
                          </div>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Compact manual-add affordance: one kind selector + per-kind inputs. */}
      {!manualOpen ? (
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => {
            setManualError(null);
            setManualWarnings([]);
            setManualOpen(true);
          }}
          data-testid={`db-gap-proposals-manual-open-${findingKey}`}
        >
          Add manually
        </button>
      ) : (
        <div
          className={styles.inlineResolve}
          data-testid={`db-gap-proposals-manual-form-${findingKey}`}
        >
          <select
            className={styles.filterSelect}
            value={manual.kind}
            onChange={(e) =>
              setManual((prev) => ({
                ...prev,
                kind: e.target.value as DbGapProposalKind,
              }))
            }
            data-testid={`db-gap-proposals-manual-kind-${findingKey}`}
          >
            <option value="fk_join">FK join</option>
            <option value="primary_key">Primary key</option>
          </select>
          {manual.kind === 'fk_join' ? (
            <>
              <input
                type="text"
                className={styles.filterInput}
                placeholder="Relationship id"
                value={manual.relationshipId}
                onChange={(e) =>
                  setManual((prev) => ({ ...prev, relationshipId: e.target.value }))
                }
                data-testid={`db-gap-proposals-manual-relationship-${findingKey}`}
              />
              <input
                type="text"
                className={styles.filterInput}
                placeholder="Join columns (comma-sep)"
                value={manual.joinColumns}
                onChange={(e) =>
                  setManual((prev) => ({ ...prev, joinColumns: e.target.value }))
                }
                data-testid={`db-gap-proposals-manual-join-columns-${findingKey}`}
              />
              <input
                type="text"
                className={styles.filterInput}
                placeholder="Referenced columns (comma-sep)"
                value={manual.referencedColumns}
                onChange={(e) =>
                  setManual((prev) => ({
                    ...prev,
                    referencedColumns: e.target.value,
                  }))
                }
                data-testid={`db-gap-proposals-manual-referenced-columns-${findingKey}`}
              />
            </>
          ) : (
            <>
              <input
                type="text"
                className={styles.filterInput}
                placeholder="Table"
                value={manual.table}
                onChange={(e) =>
                  setManual((prev) => ({ ...prev, table: e.target.value }))
                }
                data-testid={`db-gap-proposals-manual-table-${findingKey}`}
              />
              <input
                type="text"
                className={styles.filterInput}
                placeholder="Columns (comma-sep)"
                value={manual.columns}
                onChange={(e) =>
                  setManual((prev) => ({ ...prev, columns: e.target.value }))
                }
                data-testid={`db-gap-proposals-manual-columns-${findingKey}`}
              />
            </>
          )}
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => void submitManual()}
            disabled={manualBusy}
            data-testid={`db-gap-proposals-manual-add-${findingKey}`}
          >
            Add
          </button>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => {
              setManualOpen(false);
              setManualError(null);
              setManualWarnings([]);
            }}
            data-testid={`db-gap-proposals-manual-cancel-${findingKey}`}
          >
            Cancel
          </button>
        </div>
      )}
      {manualError && (
        <div
          className={styles.errorBanner}
          data-testid={`db-gap-proposals-manual-error-${findingKey}`}
        >
          {manualError}
        </div>
      )}
      {manualWarnings.length > 0 && (
        <ul
          className={styles.orderedList}
          data-testid={`db-gap-proposals-manual-warnings-${findingKey}`}
        >
          {manualWarnings.map((warning, index) => (
            <li key={index} className={styles.manifestNote}>
              {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default DbGapProposalsSection;
