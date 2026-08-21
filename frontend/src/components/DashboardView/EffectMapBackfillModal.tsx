/**
 * EffectMapBackfillModal (2026-08-20).
 *
 * Runs the effect-map backfill for the architecture and shows the honest
 * three-way split:
 *   - DERIVED: deterministic corpus-derived endpoint->write-table mappings,
 *     ALREADY applied additively when the run returns (they cite real code);
 *   - PROPOSALS: guarded LLM drafts — reviewed here, applied only on the
 *     operator's explicit Apply (default-checked; every table already passed
 *     the committed-model vocabulary guard, and the apply re-checks it);
 *   - UNPROPOSED: endpoints neither path could map, with reasons — these
 *     remain refused (fail-closed) at capture time.
 *
 * After any apply: just start the capture again — the pre-start preflight
 * re-reads the model live.
 */

import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  EffectMapBackfillRunResponse,
  applyEffectMapProposals,
  runEffectMapBackfill,
} from '../../api/effectMapBackfillApi';
import styles from './ApiBaselinesListPage.module.css';

export interface EffectMapBackfillModalProps {
  projectId: string;
  architectureId: string;
  open: boolean;
  onClose: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1500,
};

const dialogStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: '16px 20px',
  width: 'min(860px, 92vw)',
  maxHeight: '84vh',
  overflowY: 'auto',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
};

export const EffectMapBackfillModal: React.FC<EffectMapBackfillModalProps> = ({
  projectId,
  architectureId,
  open,
  onClose,
}) => {
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<EffectMapBackfillRunResponse | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySummary, setApplySummary] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setRunError(null);
    setResult(null);
    setApplySummary(null);
    setApplyError(null);
    try {
      const response = await runEffectMapBackfill(projectId, architectureId);
      setResult(response);
      // Default-approve every guarded proposal; the operator unchecks.
      setApproved(new Set(response.proposals.map((p) => p.endpoint_id)));
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Backfill run failed');
    } finally {
      setRunning(false);
    }
  }, [projectId, architectureId]);

  useEffect(() => {
    if (open) void run();
  }, [open, run]);

  const handleApply = async () => {
    if (!result || applying) return;
    const effects = result.proposals
      .filter((p) => approved.has(p.endpoint_id))
      .flatMap((p) => p.tables.map((table) => ({ endpoint_id: p.endpoint_id, table_name: table })));
    if (effects.length === 0) return;
    setApplying(true);
    setApplyError(null);
    try {
      const response = await applyEffectMapProposals(projectId, architectureId, effects);
      setApplySummary(
        `${response.applied} effect edge(s) applied` +
          (response.skipped.length > 0 ? `, ${response.skipped.length} skipped` : '') +
          ' — start the capture again; the preflight re-checks automatically.',
      );
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  if (!open) return null;

  const approvedCount = result
    ? result.proposals.filter((p) => approved.has(p.endpoint_id)).length
    : 0;

  const modal = (
    <div style={overlayStyle} onClick={onClose} data-testid="effect-map-backfill-overlay">
      <div
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Backfill effect maps"
        data-testid="effect-map-backfill-modal"
      >
        <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>Backfill effect maps</h2>
        <p style={{ margin: '0 0 10px', color: '#555' }}>
          Derives endpoint → write-table maps from the structural corpus
          (applied immediately — they cite real code), then drafts guarded LLM
          proposals for the rest (applied only on your approval).
        </p>

        {running && <p data-testid="effect-map-backfill-running">Running the backfill…</p>}
        {runError && (
          <p style={{ color: '#c62828' }} data-testid="effect-map-backfill-error">
            {runError}
          </p>
        )}

        {result && (
          <>
            {/* Screenshot-friendly rollup FIRST (2026-08-20): one box that
                carries the whole diagnosis in a single capture. */}
            <div
              style={{
                border: '1px solid #ddd',
                borderRadius: 6,
                padding: '8px 10px',
                background: '#fafafa',
                fontSize: 13,
              }}
              data-testid="effect-map-summary"
            >
              <div>
                <strong>Summary:</strong> {result.derived_apply?.applied ?? 0} derived
                edge(s) applied · {result.summary?.proven_read_count ?? 0} proven
                read-only · {result.summary?.read_mapped_count ?? 0} already
                read-mapped · {result.proposals.length} LLM proposal(s) ·{' '}
                {result.unproposed.length} still unmapped
              </div>
              {Object.keys(result.summary?.by_stage ?? {}).length > 0 && (
                <div>
                  Stages:{' '}
                  {Object.entries(result.summary.by_stage)
                    .map(([stage, count]) => `${stage}: ${count}`)
                    .join(' · ')}
                </div>
              )}
              {(result.summary?.top_broken_targets ?? []).length > 0 && (
                <div>
                  Top unresolved call targets:{' '}
                  {result.summary.top_broken_targets.join('; ')}
                </div>
              )}
            </div>

            <h3 style={{ margin: '10px 0 4px', fontSize: 14 }}>
              Derived from the corpus — already applied (
              {result.derived_apply?.applied ?? 0} edge(s))
            </h3>
            {result.derived.length === 0 && (
              <p style={{ color: '#555' }}>None derivable — see proposals below.</p>
            )}
            {result.derived.map((d) => (
              <div key={d.endpoint_id} data-testid={`backfill-derived-${d.endpoint_id}`}>
                <code>
                  {d.method} {d.path}
                </code>{' '}
                → {d.tables.join(', ')}
                {d.unknown_tables.length > 0 && (
                  <span style={{ color: '#b26a00' }}>
                    {' '}
                    (also writes non-model objects: {d.unknown_tables.join(', ')})
                  </span>
                )}
              </div>
            ))}

            {(result.proven_read ?? []).length > 0 && (
              <>
                <h3 style={{ margin: '14px 0 4px', fontSize: 14, color: '#1b5e20' }}>
                  Proven read-only — read edges applied (
                  {result.proven_read_apply?.applied ?? 0} edge(s)); the
                  preflight no longer blocks these
                </h3>
                {result.proven_read.map((r) => (
                  <div key={r.endpoint_id} data-testid={`backfill-proven-read-${r.endpoint_id}`}>
                    <code>
                      {r.method} {r.path}
                    </code>{' '}
                    → reads {r.read_tables.join(', ')}
                  </div>
                ))}
              </>
            )}

            <h3 style={{ margin: '14px 0 4px', fontSize: 14 }}>
              LLM proposals — review, then apply ({approvedCount} of{' '}
              {result.proposals.length} approved)
            </h3>
            {result.proposals.length === 0 && (
              <p style={{ color: '#555' }}>No proposals.</p>
            )}
            {result.proposals.map((p) => (
              <label
                key={p.endpoint_id}
                style={{ display: 'block', margin: '4px 0' }}
                data-testid={`backfill-proposal-${p.endpoint_id}`}
              >
                <input
                  type="checkbox"
                  checked={approved.has(p.endpoint_id)}
                  onChange={(e) =>
                    setApproved((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(p.endpoint_id);
                      else next.delete(p.endpoint_id);
                      return next;
                    })
                  }
                />{' '}
                <code>
                  {p.method} {p.path}
                </code>{' '}
                → {p.tables.join(', ')}
                <span style={{ color: '#555' }}> — {p.rationale}</span>
                {p.guard_rejected.length > 0 && (
                  <span style={{ color: '#b26a00' }}>
                    {' '}
                    (guard rejected: {p.guard_rejected.join(', ')})
                  </span>
                )}
              </label>
            ))}

            {result.unproposed.length > 0 && (
              <>
                <h3 style={{ margin: '14px 0 4px', fontSize: 14, color: '#b26a00' }}>
                  Still unmapped ({result.unproposed.length}) — these stay
                  refused at capture time
                </h3>
                {result.unproposed.map((u) => {
                  const diagnosis = result.trace.find(
                    (t) => t.endpoint_id === u.endpoint_id,
                  );
                  return (
                    <div
                      key={u.endpoint_id}
                      style={{ color: '#b26a00', marginBottom: 6 }}
                      data-testid={`backfill-unmapped-${u.endpoint_id}`}
                    >
                      <code>
                        {u.method} {u.path}
                      </code>{' '}
                      — {u.reason}
                      {diagnosis && (
                        <div style={{ marginLeft: 16, color: '#555', fontSize: 12 }}>
                          <div>
                            Deterministic stage: <strong>{diagnosis.stage}</strong>
                          </div>
                          {diagnosis.matched_roots.length > 0 && (
                            <div>Matched roots: {diagnosis.matched_roots.join('; ')}</div>
                          )}
                          {diagnosis.broken_calls.length > 0 && (
                            <div>
                              Chain broke at: {diagnosis.broken_calls.join('; ')}
                            </div>
                          )}
                          {diagnosis.boundaries_reached.length > 0 && (
                            <div>
                              DAOs reached (no parseable write SQL):{' '}
                              {diagnosis.boundaries_reached.join(', ')}
                            </div>
                          )}
                          {diagnosis.same_verb_root_fragments.length > 0 && (
                            <div>
                              No root matched; same-verb fragments seen:{' '}
                              {diagnosis.same_verb_root_fragments.join(', ')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  className={styles.secondaryButton}
                  style={{ marginTop: 6 }}
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      JSON.stringify(
                        {
                          unmapped_count: result.unmapped_count,
                          unproposed: result.unproposed,
                          trace: result.trace,
                        },
                        null,
                        2,
                      ),
                    );
                  }}
                  data-testid="effect-map-copy-diagnosis"
                >
                  Copy diagnosis JSON
                </button>
              </>
            )}

            {applySummary && (
              <p style={{ color: '#1b5e20' }} data-testid="effect-map-apply-summary">
                {applySummary}
              </p>
            )}
            {applyError && (
              <p style={{ color: '#c62828' }} data-testid="effect-map-apply-error">
                Apply failed: {applyError}
              </p>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" className={styles.secondaryButton} onClick={onClose}>
            Close
          </button>
          {result && result.proposals.length > 0 && !applySummary && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleApply}
              disabled={applying || approvedCount === 0}
              data-testid="effect-map-apply-approved"
            >
              {applying ? 'Applying…' : `Apply ${approvedCount} approved proposal(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
};

export default EffectMapBackfillModal;
