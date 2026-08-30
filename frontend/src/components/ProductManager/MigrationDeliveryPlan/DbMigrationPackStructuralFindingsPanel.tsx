/**
 * DbMigrationPackStructuralFindingsPanel
 *
 * Spec 2026-08-04-2 — Structural findings dispositions (frontend surface).
 *
 * Renders the pack's structured structural findings (suspicious zeros like
 * "no primary keys captured") on the Schema Migration surface, above the
 * section tabs so the blocking state is always visible. Every finding must
 * be dispositioned by a human BEFORE plan generation / Migrate:
 *
 *   - Accept (note REQUIRED — the call never fires without one): the zero is
 *     genuinely true; closes the finding.
 *   - Fix upstream (no note): re-capture / fix at source; the finding STAYS
 *     OPEN until a regenerated pack no longer emits it — resolution is never
 *     a manual flag.
 *   - Known gap (note REQUIRED): accepted debt; closes the finding AND
 *     materialises a known-gap item in the migration plan.
 *   - Clear disposition: removes it — the finding re-opens.
 *
 * Zero findings renders NOTHING (the section only exists when there is
 * something to disposition). Any open finding shows the blocking banner.
 * Every action refetches the merged list (dispositions persist per PROJECT
 * in AMS, so they survive regeneration).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  clearDbMigrationPackStructuralFindingDisposition,
  listDbMigrationPackStructuralFindings,
  setDbMigrationPackStructuralFindingDisposition,
  suggestFindingNextStep,
  type DbFindingAdvice,
  type DbMigrationPackStructuralFinding,
  type DbMigrationPackStructuralFindingDisposition,
  type RunDbStructuralHarvestResponse,
} from '../../../api/dbMigrationPackApi';
import DbMigrationPackHarvestModal from './DbMigrationPackHarvestModal';
import DbGapProposalsSection from './DbGapProposalsSection';
import styles from './DbMigrationPack.module.css';

/**
 * Finding kinds the LLM gap-proposal queue (Spec 4) offers "Draft proposals
 * with AI" for. constraints_metadata_absent is included deliberately: the
 * generate route answers it honestly with supported: false +
 * unsupportedReason (harvest / accept instead), rendered inline.
 */
const GAP_PROPOSAL_FINDING_KINDS = new Set([
  'relationships_without_fk_columns',
  'no_primary_keys',
  'constraints_metadata_absent',
]);

export interface DbMigrationPackStructuralFindingsPanelProps {
  projectId: string;
  packId: string;
  /** The pack's architecture — rides as the harvest's `architecture_id`. */
  architectureId: string;
  /** Optional target architecture for the harvest (when the context has one). */
  targetArchitectureId?: string | null;
  /** Invoked after any successful disposition change (parents may refresh gates). */
  onChanged?: () => void;
  /**
   * Invoked when a gap-proposal approval WROTE to the committed model
   * (2026-08-09): the pack's generation inputs changed, so the parent should
   * re-read the pack — AMS recomputes staleness on GET and the banner
   * appears without a manual reload.
   */
  onModelChanged?: () => void;
  /**
   * Invoked when a harvest completed (stage 'completed'): the pack was
   * REGENERATED server-side, so the parent should re-read the pack + files
   * (the same refetch it does after an explicit Regenerate).
   */
  onPackRegenerated?: () => void;
}

function statusChip(
  finding: DbMigrationPackStructuralFinding,
): { label: string; className: string } {
  switch (finding.disposition) {
    case 'accepted':
      return { label: 'Accepted', className: styles.badgeResolved };
    case 'known_gap':
      return { label: 'Known gap', className: styles.badgeSkipped };
    case 'fix_upstream':
      return { label: 'Fix upstream pending', className: styles.badgeFlagged };
    default:
      return { label: 'Open', className: styles.badgeMissing };
  }
}

/** Dispositions whose note entry is REQUIRED before the PUT fires. */
type NoteEntryKind = Extract<
  DbMigrationPackStructuralFindingDisposition,
  'accepted' | 'known_gap'
>;

export const DbMigrationPackStructuralFindingsPanel: React.FC<
  DbMigrationPackStructuralFindingsPanelProps
> = ({
  projectId,
  packId,
  architectureId,
  targetArchitectureId,
  onChanged,
  onModelChanged,
  onPackRegenerated,
}) => {
  const [findings, setFindings] = useState<DbMigrationPackStructuralFinding[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Finding key an action is in flight for. */
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /** Per-finding expander for the itemised affected list (details[]). */
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  /** Harvest-from-source-DB modal visibility (credentials live IN the modal). */
  const [harvestOpen, setHarvestOpen] = useState(false);
  /** "Suggest next step" advice per finding key (2026-08-30). Ephemeral —
   *  the suggested note persists via the disposition note when applied. */
  const [adviceByKey, setAdviceByKey] = useState<
    Record<string, { loading: boolean; advice: DbFindingAdvice | null; error: string | null }>
  >({});
  /** Rows in note-entry mode: key -> { kind of disposition, draft note }. */
  const [noteDrafts, setNoteDrafts] = useState<
    Record<string, { disposition: NoteEntryKind; note: string }>
  >({});
  /**
   * Gap-proposal sections (Spec 4), keyed by finding key. `generateSeq`
   * counts "Draft proposals with AI" clicks — the section runs ONE generate
   * per bump; the toggle button only flips `open` (list-only, no generate).
   */
  const [gapSections, setGapSections] = useState<
    Record<string, { open: boolean; generateSeq: number }>
  >({});

  const loadFindings = useCallback(async () => {
    const result = await listDbMigrationPackStructuralFindings(projectId, packId);
    setFindings(result.findings);
    return result;
  }, [projectId, packId]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    void (async () => {
      try {
        const result = await listDbMigrationPackStructuralFindings(projectId, packId);
        if (!cancelled) setFindings(result.findings);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load structural findings',
          );
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, packId]);

  const applyDisposition = useCallback(
    async (
      finding: DbMigrationPackStructuralFinding,
      disposition: DbMigrationPackStructuralFindingDisposition,
      note?: string,
    ) => {
      if (busyKey) return;
      setBusyKey(finding.key);
      setError(null);
      try {
        await setDbMigrationPackStructuralFindingDisposition(
          projectId,
          packId,
          finding,
          disposition,
          note,
        );
        setNoteDrafts((prev) => {
          const next = { ...prev };
          delete next[finding.key];
          return next;
        });
        await loadFindings();
        onChanged?.();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to set the disposition',
        );
      } finally {
        setBusyKey(null);
      }
    },
    [busyKey, projectId, packId, loadFindings, onChanged],
  );

  const clearDisposition = useCallback(
    async (finding: DbMigrationPackStructuralFinding) => {
      if (busyKey) return;
      setBusyKey(finding.key);
      setError(null);
      try {
        await clearDbMigrationPackStructuralFindingDisposition(
          projectId,
          packId,
          finding.key,
        );
        await loadFindings();
        onChanged?.();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to clear the disposition',
        );
      } finally {
        setBusyKey(null);
      }
    },
    [busyKey, projectId, packId, loadFindings, onChanged],
  );

  const confirmNoteEntry = useCallback(
    (finding: DbMigrationPackStructuralFinding) => {
      const draft = noteDrafts[finding.key];
      if (!draft) return;
      const note = draft.note.trim();
      if (!note) {
        setError(
          draft.disposition === 'accepted'
            ? `A reason is required to accept "${finding.key}" — accepted findings always carry one.`
            : `A note is required to record "${finding.key}" as a known gap.`,
        );
        return;
      }
      void applyDisposition(finding, draft.disposition, note);
    },
    [noteDrafts, applyDisposition],
  );

  /**
   * Harvest completed (stage 'completed' ONLY — failed stages stay IN the
   * modal): close it, show the regenerated pack's findings immediately, then
   * refetch the merged list and tell the parent the pack was regenerated.
   */
  const handleHarvestCompleted = useCallback(
    (result: RunDbStructuralHarvestResponse) => {
      setHarvestOpen(false);
      setError(null);
      setFindings(result.findings);
      void loadFindings().catch(() => {
        /* the response already carried the fresh findings; refetch is best-effort */
      });
      onChanged?.();
      onPackRegenerated?.();
    },
    [loadFindings, onChanged, onPackRegenerated],
  );

  /** "Draft proposals with AI": open the section AND bump the generate seq. */
  const draftGapProposals = useCallback((findingKey: string) => {
    setError(null);
    setGapSections((prev) => ({
      ...prev,
      [findingKey]: {
        open: true,
        generateSeq: (prev[findingKey]?.generateSeq ?? 0) + 1,
      },
    }));
  }, []);

  /** "Suggest next step" (2026-08-30): fetch advisory disposition advice
   *  for one finding. Advisory ONLY — rendering a recommendation; every
   *  state change still goes through the human's disposition click. */
  const suggestNextStep = useCallback(
    async (finding: DbMigrationPackStructuralFinding) => {
      setAdviceByKey((prev) => ({
        ...prev,
        [finding.key]: { loading: true, advice: null, error: null },
      }));
      try {
        const result = await suggestFindingNextStep(projectId, {
          architecture_id: architectureId,
          finding_kind: finding.kind,
          finding_key: finding.key,
          message: finding.message,
        });
        setAdviceByKey((prev) => ({
          ...prev,
          [finding.key]: { loading: false, advice: result.advice, error: null },
        }));
      } catch (err) {
        setAdviceByKey((prev) => ({
          ...prev,
          [finding.key]: {
            loading: false,
            advice: null,
            error: err instanceof Error ? err.message : 'Next-step suggestion failed',
          },
        }));
      }
    },
    [projectId, architectureId],
  );

  /** Show/hide an already-materialised proposals section (never generates). */
  const toggleGapSection = useCallback((findingKey: string) => {
    setGapSections((prev) => {
      const current = prev[findingKey];
      if (!current) return prev;
      return { ...prev, [findingKey]: { ...current, open: !current.open } };
    });
  }, []);

  // The section renders whenever loaded (2026-08-12): it used to vanish on
  // zero findings, which HID the harvest button — but harvesting the live
  // catalog (widths / nullability / keys) is exactly what a clean-looking
  // pack may need when the committed attributes drifted from source truth
  // (the live char(1)/NOT-NULL load-failure classes).
  if (!loaded) return null;

  const openCount = findings.filter((f) => f.open).length;

  return (
    <div
      className={styles.manifestSection}
      data-testid="db-pack-structural-findings"
    >
      <div className={styles.surfaceHeader}>
        <h4 className={styles.manifestSectionTitle}>Structural findings</h4>
        {/* ALWAYS enabled (2026-08-12, staleness-is-a-signal ruling): the
            old `disabled={openCount === 0}` treated "no open findings" as a
            lock, but the harvest is a general live-catalog fidelity re-read
            (widths / nullability / keys) — dispositioned or zero findings
            are exactly when an operator may still need it. The modal owns
            its own in-flight state. */}
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => setHarvestOpen(true)}
          title="Read the real schema from the live source database and regenerate the pack"
          data-testid="db-pack-harvest-open-button"
        >
          Harvest from source DB
        </button>
      </div>
      <p className={styles.manifestNote}>
        Suspicious zeros the pack generator flagged. Disposition each: Accept
        (with a reason), Fix upstream (fix at source + Regenerate), or Known
        gap (accepted debt — becomes a plan item).
      </p>

      {openCount > 0 && (
        <div
          className={styles.errorBanner}
          data-testid="db-pack-structural-findings-open-banner"
        >
          Open findings block plan generation and Migrate.
        </div>
      )}

      {error && (
        <div
          className={styles.errorBanner}
          data-testid="db-pack-structural-findings-error"
        >
          {error}
        </div>
      )}

      {findings.length === 0 && !error && (
        <p className={styles.manifestNote} data-testid="db-pack-structural-findings-empty">
          No structural findings on this pack — the harvest stays available for a
          live-catalog fidelity re-read (column widths, nullability, keys).
        </p>
      )}

      {findings.length > 0 && (
        <div className={styles.tableScroll}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>Finding</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((finding) => {
                const chip = statusChip(finding);
                const draft = noteDrafts[finding.key] ?? null;
                // Spec 4 + 2026-08-08: AI drafting stays offered on
                // known_gap rows too — accepted debt is exactly the row an
                // operator comes back to fix intelligently, and hiding the
                // affordance behind "Clear disposition" buried it. Only
                // `accepted` (the zero is genuinely true) drops the action.
                const gapEligible =
                  GAP_PROPOSAL_FINDING_KINDS.has(finding.kind) &&
                  finding.disposition !== 'accepted';
                const gapSection = gapSections[finding.key] ?? null;
                const adviceState = adviceByKey[finding.key] ?? null;
                // Advisor gating (2026-08-30): when the deterministic
                // pre-check proved FK drafting unapplicable, the Fix-with-AI
                // button is disabled WITH the reason — never a silent trap.
                const fixWithAiBlocked =
                  adviceState?.advice?.fix_with_ai_applicable === false;
                return (
                  <React.Fragment key={finding.key}>
                  <tr
                    data-testid={`db-pack-structural-finding-${finding.key}`}
                  >
                    <td>
                      {finding.message}
                      {finding.details && finding.details.length > 0 && (
                        <>
                          {' '}
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() =>
                              setExpandedDetails((prev) => ({
                                ...prev,
                                [finding.key]: !prev[finding.key],
                              }))
                            }
                            data-testid={`db-pack-structural-finding-details-toggle-${finding.key}`}
                          >
                            {expandedDetails[finding.key]
                              ? 'Hide affected'
                              : `Show ${finding.details.length} affected`}
                          </button>
                          {expandedDetails[finding.key] && (
                            <ul
                              className={styles.manifestNote}
                              data-testid={`db-pack-structural-finding-details-${finding.key}`}
                            >
                              {finding.details.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          )}
                        </>
                      )}
                      {finding.note && (
                        <p
                          className={styles.manifestNote}
                          data-testid={`db-pack-structural-finding-note-${finding.key}`}
                        >
                          {finding.note}
                        </p>
                      )}
                    </td>
                    <td>
                      <span
                        className={chip.className}
                        data-testid={`db-pack-structural-finding-status-${finding.key}`}
                      >
                        {chip.label}
                      </span>
                    </td>
                    <td>
                      {draft ? (
                        <div className={styles.inlineResolve}>
                          <input
                            type="text"
                            className={styles.filterInput}
                            placeholder={
                              draft.disposition === 'accepted'
                                ? 'Reason (required)'
                                : 'Note (required)'
                            }
                            value={draft.note}
                            onChange={(e) =>
                              setNoteDrafts((prev) => ({
                                ...prev,
                                [finding.key]: {
                                  ...draft,
                                  note: e.target.value,
                                },
                              }))
                            }
                            data-testid={`db-pack-structural-finding-note-input-${finding.key}`}
                          />
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() => confirmNoteEntry(finding)}
                            disabled={busyKey !== null}
                            data-testid={`db-pack-structural-finding-note-confirm-${finding.key}`}
                          >
                            {draft.disposition === 'accepted'
                              ? 'Accept'
                              : 'Known gap'}
                          </button>
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() =>
                              setNoteDrafts((prev) => {
                                const next = { ...prev };
                                delete next[finding.key];
                                return next;
                              })
                            }
                            data-testid={`db-pack-structural-finding-note-cancel-${finding.key}`}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className={styles.actionsBar}>
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() => {
                              setError(null);
                              setNoteDrafts((prev) => ({
                                ...prev,
                                [finding.key]: {
                                  disposition: 'accepted',
                                  note: '',
                                },
                              }));
                            }}
                            disabled={busyKey !== null}
                            title="The zero is genuinely true — requires a reason"
                            data-testid={`db-pack-structural-finding-accept-${finding.key}`}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() =>
                              void applyDisposition(finding, 'fix_upstream')
                            }
                            disabled={busyKey !== null}
                            title="Stays open until a regenerated pack no longer emits it"
                            data-testid={`db-pack-structural-finding-fix-upstream-${finding.key}`}
                          >
                            Fix upstream
                          </button>
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() => {
                              setError(null);
                              setNoteDrafts((prev) => ({
                                ...prev,
                                [finding.key]: {
                                  disposition: 'known_gap',
                                  note: '',
                                },
                              }));
                            }}
                            disabled={busyKey !== null}
                            title="Accepted debt — becomes a known-gap item in the migration plan (requires a note)"
                            data-testid={`db-pack-structural-finding-known-gap-${finding.key}`}
                          >
                            Known gap
                          </button>
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() => void suggestNextStep(finding)}
                            disabled={busyKey !== null || adviceState?.loading === true}
                            title="Review this finding against the committed schema facts and recommend a disposition — advisory only, nothing is applied"
                            data-testid={`db-finding-advice-${finding.key}`}
                          >
                            {adviceState?.loading ? 'Suggesting…' : 'Suggest next step'}
                          </button>
                          {gapEligible && (
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => draftGapProposals(finding.key)}
                              disabled={busyKey !== null || fixWithAiBlocked}
                              title={
                                fixWithAiBlocked
                                  ? adviceState?.advice?.deterministic_constraint ??
                                    'Unapplicable for this finding'
                                  : 'AI drafts the missing PK/FK metadata from the committed model into a review queue — nothing is applied without your approval'
                              }
                              data-testid={`db-gap-proposals-draft-${finding.key}`}
                            >
                              Fix with AI
                            </button>
                          )}
                          {gapEligible && gapSection && (
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => toggleGapSection(finding.key)}
                              data-testid={`db-gap-proposals-toggle-${finding.key}`}
                            >
                              {gapSection.open
                                ? 'Hide proposals'
                                : 'Show proposals'}
                            </button>
                          )}
                          {finding.disposition !== null && (
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => void clearDisposition(finding)}
                              disabled={busyKey !== null}
                              title="Remove the disposition — the finding re-opens"
                              data-testid={`db-pack-structural-finding-clear-${finding.key}`}
                            >
                              Clear disposition
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  {(adviceState?.advice || adviceState?.error) && (
                    <tr data-testid={`db-finding-advice-row-${finding.key}`}>
                      <td colSpan={3}>
                        {adviceState.error ? (
                          <p className={styles.errorBanner}>{adviceState.error}</p>
                        ) : (
                          <div className={styles.manifestNote}>
                            <p>
                              <strong>
                                Suggested: {adviceState.advice!.recommended_disposition.replace('_', ' ')}
                              </strong>{' '}
                              ({adviceState.advice!.confidence} confidence — advisory
                              only, you decide)
                            </p>
                            <p data-testid={`db-finding-advice-rationale-${finding.key}`}>
                              {adviceState.advice!.rationale}
                            </p>
                            {adviceState.advice!.deterministic_constraint && (
                              <p>
                                <strong>Schema constraint:</strong>{' '}
                                {adviceState.advice!.deterministic_constraint}
                              </p>
                            )}
                            {adviceState.advice!.caveats.length > 0 && (
                              <ul>
                                {adviceState.advice!.caveats.map((c, i) => (
                                  <li key={`caveat-${finding.key}-${i}`}>{c}</li>
                                ))}
                              </ul>
                            )}
                            {adviceState.advice!.recommended_disposition ===
                            'fix_upstream' ? (
                              <button
                                type="button"
                                className={styles.actionButton}
                                onClick={() =>
                                  void applyDisposition(finding, 'fix_upstream')
                                }
                                disabled={busyKey !== null}
                                data-testid={`db-finding-advice-apply-${finding.key}`}
                              >
                                Apply Fix upstream
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={styles.actionButton}
                                onClick={() => {
                                  setError(null);
                                  setNoteDrafts((prev) => ({
                                    ...prev,
                                    [finding.key]: {
                                      disposition: adviceState.advice!
                                        .recommended_disposition as NoteEntryKind,
                                      note: adviceState.advice!.suggested_note ?? '',
                                    },
                                  }));
                                }}
                                disabled={busyKey !== null}
                                title="Prefills the disposition note with the suggestion — you still confirm"
                                data-testid={`db-finding-advice-use-${finding.key}`}
                              >
                                Use suggestion (review note)
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  {/* Spec 4: inline (collapsible) gap-proposal queue for this
                      finding. Approvals write to the MODEL — the finding
                      itself only clears when a regenerated pack stops
                      emitting it (never fake-cleared client-side). */}
                  {gapEligible && gapSection?.open && (
                    <tr data-testid={`db-gap-proposals-section-row-${finding.key}`}>
                      <td colSpan={3}>
                        <DbGapProposalsSection
                          projectId={projectId}
                          architectureId={architectureId}
                          findingKey={finding.key}
                          findingKind={finding.kind}
                          generateSeq={gapSection.generateSeq}
                          onModelChanged={onModelChanged}
                        />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.manifestNote}>
        Fix-upstream findings stay open until a regenerated pack no longer
        emits them — resolution is never a manual flag.
      </p>

      {/* Harvest-from-source-DB modal (Spec 3). Credentials live ONLY inside
          the modal instance and are discarded when it unmounts on close. */}
      {harvestOpen && (
        <DbMigrationPackHarvestModal
          projectId={projectId}
          architectureId={architectureId}
          targetArchitectureId={targetArchitectureId}
          onCompleted={handleHarvestCompleted}
          onClose={() => setHarvestOpen(false)}
        />
      )}
    </div>
  );
};

export default DbMigrationPackStructuralFindingsPanel;
