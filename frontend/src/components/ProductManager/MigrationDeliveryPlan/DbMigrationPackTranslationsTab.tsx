/**
 * DbMigrationPackTranslationsTab
 *
 * Spec: 2026-06-11 LLM-Assisted DB Object Translation Drafts —
 * Task Group 5 (Tasks 5.3 object list + coverage chips, 5.4 actions).
 * Reworked into the translation WORKBENCH by the 2026-09-09 Stored Proc &
 * Function Behaviour Program, Spec 4.
 *
 * The fourth section tab on the Schema Migration surface
 * (`DbMigrationPackView` contents / decisions / drift / translations).
 *
 * Original surface (unchanged for non-routine objects — views, jobs, check
 * constraints keep the simple rendering):
 *
 *   - coverage-summary chips for the per-object buckets (drafted / approved /
 *     rewrite-in-app / dropped / failed / needs-manual);
 *   - object list table: object_ref, kind, body size, disposition, pipeline
 *     state, review status, judge confidence, fidelity warning indicators;
 *   - actions (product rule: never individual-only): per-object Translate /
 *     Re-translate / Retry AND bulk Translate-all;
 *   - per-object disposition control (translate / rewrite-in-app / drop with
 *     REQUIRED reason);
 *   - `needs_manual` rows are terminal;
 *   - the side-by-side reviewer opens per row beneath the table.
 *
 * WORKBENCH (routine rows the loop manages, marked by `routine_id` /
 * `loop_status` on the list response):
 *
 *   - header: target-build status (polled every 3s while a build is in
 *     flight) with the Build-target modal, pinned proc-baseline status, and
 *     the attempt cap;
 *   - actions: Translate & reconcile all (the AUTOMATIC loop: translate →
 *     apply → reconcile → re-translate with evidence until reconciled or the
 *     cap; the user is told LOUDLY on exhaustion), Reconcile all, Approve all
 *     reconciled, plus the Needs you / Reconciled / Blocked / Unverified /
 *     All filter;
 *   - routine table: routine, kind, scenarios, attempts, loop status,
 *     verdict, review state — every non-reconciled routine carries an honest
 *     named state and a recorded-reason path (waive with a reason,
 *     disposition), never a blank;
 *   - the reviewer gains the behaviour verdict, the failing scenarios, the
 *     attempt history with diff-vs-previous, and "Guidance & retry" — the
 *     ONLY human intervention (decision 16: NO direct draft editing, no
 *     manual-step loop).
 *
 * Target credentials are PER-INVOCATION: held in component state for the tab
 * session only (memory, never storage) and re-prompted when absent.
 *
 * Staleness is a signal, never a lock: buttons are disabled ONLY while a
 * build, the loop, or the action itself is in flight.
 *
 * Errors parse via the api module's `extractGatewayErrorMessage` pattern
 * (every call throws an `Error` with the parsed gateway message; the
 * evidence-gated approve route's 409 carries a readable reason surfaced
 * inline next to Approve rather than in the generic banner).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  approveAllDbMigrationPackTranslations,
  approveAllReconciledDbMigrationPackTranslations,
  DB_PACK_TRANSLATION_ATTEMPT_CAP,
  getDbMigrationPackLoopStatus,
  getDbMigrationPackProcBaselineStatus,
  getDbMigrationPackTargetBuildStatus,
  getDbMigrationPackTranslationParityReport,
  listDbMigrationPackTranslationAttempts,
  listDbMigrationPackTranslations,
  reconcileDbMigrationPackTranslation,
  retryDbMigrationPackTranslation,
  retryDbMigrationPackTranslationLoop,
  reviewDbMigrationPackTranslation,
  setDbMigrationPackTranslationDisposition,
  startDbMigrationPackTargetBuild,
  getDbMigrationPackTargetReconcileStatus,
  startDbMigrationPackTargetReconcile,
  supplyDbMigrationPackTranslationBody,
  translateAllDbMigrationPackTranslations,
  translateAndReconcileDbMigrationPack,
  translateDbMigrationPackTranslation,
  waiveDbMigrationPackTranslation,
  type DbMigrationPackDbCredentials,
  type DbMigrationPackLoopStatus,
  type DbMigrationPackParityReport,
  type DbMigrationPackProcBaselineStatus,
  type DbMigrationPackTargetBuildStatus,
  type DbMigrationPackTargetReconcileStatus,
  type DbMigrationPackTranslationAttempt,
  type DbMigrationPackTranslationCoverageSummary,
  type DbMigrationPackTranslationDisposition,
  type DbMigrationPackTranslationDto,
  type DbMigrationPackTranslationEmission,
  type DbMigrationPackTranslationOutcome,
  type DbMigrationPackTranslationReviewAction,
  type DbMigrationPackWaiverScope,
} from '../../../api/dbMigrationPackApi';
import DbMigrationPackTranslationReviewer from './DbMigrationPackTranslationReviewer';
import DbMigrationPackTargetBuildModal, {
  type DbMigrationPackTargetBuildSubmit,
  type DbMigrationPackTargetBuildVariant,
} from './DbMigrationPackTargetBuildModal';
import {
  attemptsLabel,
  isWorkbenchRow,
  loopStatusLabel,
  matchesWorkbenchFilter,
  REVIEW_STATE_LABEL,
  reviewState,
  routineKindLabel,
  scenariosLabel,
  verdictLabel,
  WORKBENCH_FILTERS,
  type DbMigrationPackWorkbenchFilter,
} from './dbMigrationPackWorkbench';
import styles from './DbMigrationPack.module.css';

/** Poll cadence for the target build and the loop while in flight. */
const POLL_MS = 3000;

export interface DbMigrationPackTranslationsTabProps {
  projectId: string;
  packId: string;
  /** Source engine key + display from the pack manifest (pair-per-project). */
  sourceEngine?: string | null;
  sourceEngineDisplay?: string | null;
  /**
   * Invoked after an action whose response reported a CHANGED approved-only
   * emission (approve / un-approve / disposition off an approved row) so the
   * parent can refresh the pack-contents file rows.
   */
  onEmissionChanged?: () => void;
}

/** An action that needs target credentials before it can run. */
type PendingCredentialedAction =
  | { kind: 'translate-reconcile' }
  | { kind: 'reconcile-all' }
  | { kind: 'reconcile-one'; translationId: string }
  | { kind: 'retry-loop'; translationId: string; guidance: string };

function formatBodySize(body: string | null): string {
  if (body === null || body.length === 0) return '—';
  if (body.length < 1024) return `${body.length} B`;
  return `${(body.length / 1024).toFixed(1)} KB`;
}

/** `14:02`-style clock for the build header; falls back to the raw value. */
function formatClock(iso: string | null): string {
  if (!iso) return 'an unknown time';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const hh = String(parsed.getHours()).padStart(2, '0');
  const mm = String(parsed.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function pipelineStateBadgeClass(state: string): string {
  switch (state) {
    case 'drafted':
      return styles.badgeTranslated;
    case 'failed':
      return styles.badgeMissing;
    case 'needs_manual':
      return styles.badgeFlagged;
    case 'translating':
      return styles.badgeFlagged;
    default:
      return styles.badge;
  }
}

function reviewStatusBadgeClass(status: string): string {
  switch (status) {
    case 'approved':
      return styles.badgeResolved;
    case 'rejected':
      return styles.badgeMissing;
    case 'needs_rework':
      return styles.badgeFlagged;
    default:
      return styles.badge;
  }
}

function loopStatusBadgeClass(status: string): string {
  switch (status) {
    case 'reconciled':
      return styles.badgeResolved;
    case 'exhausted':
    case 'apply_failed':
      return styles.badgeMissing;
    case 'unverified':
    case 'stale':
    case 'blocked_by_callee':
      return styles.badgeFlagged;
    default:
      return styles.badge;
  }
}

/** Human summary of per-object run outcomes (no polling-only behaviour). */
function summarizeOutcomes(outcomes: DbMigrationPackTranslationOutcome[]): string {
  if (outcomes.length === 0) {
    return 'No objects required translation (Translate-all targets pending + failed only).';
  }
  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    counts.set(outcome.new_state, (counts.get(outcome.new_state) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([state, n]) => `${n} ${state}`);
  const failures = outcomes
    .filter((o) => o.error)
    .map((o) => `${o.object_ref}: ${o.error}`);
  let text = `Translation run complete — ${parts.join(', ')}.`;
  if (failures.length > 0) {
    text += ` Failures: ${failures.join('; ')}`;
  }
  return text;
}

/** HTTP status carried by `DbMigrationPackHttpError` (structural read). */
function statusOf(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export const DbMigrationPackTranslationsTab: React.FC<
  DbMigrationPackTranslationsTabProps
> = ({ projectId, packId, sourceEngine, sourceEngineDisplay, onEmissionChanged }) => {
  const [rows, setRows] = useState<DbMigrationPackTranslationDto[]>([]);
  const [coverage, setCoverage] =
    useState<DbMigrationPackTranslationCoverageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Id of the row a translate/retry/disposition/review action is running on, or 'all'. */
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Rows currently in drop-reason entry mode (id -> draft reason text). */
  const [dropDrafts, setDropDrafts] = useState<Record<string, string>>({});
  /** Row whose side-by-side reviewer is open. */
  const [reviewerId, setReviewerId] = useState<string | null>(null);

  // --- workbench state (2026-09-09 Spec 4) -----------------------------------
  /** Per-invocation target credentials — MEMORY ONLY, never persisted. */
  const [targetDb, setTargetDb] = useState<DbMigrationPackDbCredentials | null>(
    null,
  );
  const [buildStatus, setBuildStatus] =
    useState<DbMigrationPackTargetBuildStatus | null>(null);
  // Workbench reconcile (2026-09-12): full data parity after Build target.
  const [reconcileStatus, setReconcileStatus] =
    useState<DbMigrationPackTargetReconcileStatus | null>(null);
  const [baseline, setBaseline] =
    useState<DbMigrationPackProcBaselineStatus | null>(null);
  const [loop, setLoop] = useState<DbMigrationPackLoopStatus | null>(null);
  const [headerNote, setHeaderNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<DbMigrationPackWorkbenchFilter>('all');
  const [modal, setModal] = useState<{
    variant: DbMigrationPackTargetBuildVariant;
    purpose: string | null;
    pending: PendingCredentialedAction | null;
  } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  /** Server 409 reasons from a blocked Approve, keyed by translation id. */
  const [approveReasons, setApproveReasons] = useState<Record<string, string>>(
    {},
  );
  const [attempts, setAttempts] = useState<DbMigrationPackTranslationAttempt[]>(
    [],
  );
  const [parityReport, setParityReport] =
    useState<DbMigrationPackParityReport | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  const loopWasInFlight = useRef(false);

  const loadTranslations = useCallback(async () => {
    const result = await listDbMigrationPackTranslations(projectId, packId);
    setRows(result.translations);
    setCoverage(result.coverage);
    return result;
  }, [projectId, packId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await listDbMigrationPackTranslations(projectId, packId);
        if (!cancelled) {
          setRows(result.translations);
          setCoverage(result.coverage);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load translations',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, packId]);

  const reviewerRow = useMemo(
    () => rows.find((r) => r.id === reviewerId) ?? null,
    [rows, reviewerId],
  );

  // --- workbench header + loop status -----------------------------------------

  const refreshBuildStatus = useCallback(async () => {
    const status = await getDbMigrationPackTargetBuildStatus(projectId, packId);
    setBuildStatus(status);
    return status;
  }, [projectId, packId]);

  const refreshReconcileStatus = useCallback(async () => {
    const status = await getDbMigrationPackTargetReconcileStatus(projectId, packId);
    setReconcileStatus(status);
    return status;
  }, [projectId, packId]);

  useEffect(() => {
    let cancelled = false;
    getDbMigrationPackTargetReconcileStatus(projectId, packId)
      .then((status) => {
        if (!cancelled) setReconcileStatus(status);
      })
      .catch(() => {
        /* the header simply shows "not reconciled" until a read succeeds */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, packId]);

  const refreshLoopStatus = useCallback(async () => {
    const status = await getDbMigrationPackLoopStatus(projectId, packId);
    setLoop(status);
    // The loop just finished: refresh the rows so every routine shows its
    // terminal state (and the exhausted ones surface loudly).
    if (loopWasInFlight.current && !status.inFlight) {
      await loadTranslations().catch(() => {
        /* the loop ledger is already on screen; row refresh is best-effort */
      });
    }
    loopWasInFlight.current = status.inFlight;
    return status;
  }, [projectId, packId, loadTranslations]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const problems: string[] = [];
      await Promise.all([
        getDbMigrationPackTargetBuildStatus(projectId, packId)
          .then((status) => {
            if (!cancelled) setBuildStatus(status);
          })
          .catch((err: unknown) => {
            problems.push(messageOf(err, 'target build status unavailable'));
          }),
        getDbMigrationPackProcBaselineStatus(projectId, packId)
          .then((status) => {
            if (!cancelled) setBaseline(status);
          })
          .catch((err: unknown) => {
            problems.push(messageOf(err, 'proc baseline status unavailable'));
          }),
        getDbMigrationPackLoopStatus(projectId, packId)
          .then((status) => {
            if (!cancelled) {
              setLoop(status);
              loopWasInFlight.current = status.inFlight;
            }
          })
          .catch((err: unknown) => {
            problems.push(messageOf(err, 'loop status unavailable'));
          }),
      ]);
      if (!cancelled && problems.length > 0) {
        setHeaderNote(
          `Workbench status could not be read: ${problems.join('; ')}`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, packId]);

  const buildInFlight = buildStatus?.inFlight != null;
  const reconcileInFlight = reconcileStatus?.inFlight != null;
  const loopInFlight = loop?.inFlight === true;

  useEffect(() => {
    if (!reconcileInFlight) return undefined;
    const handle = setInterval(() => {
      void refreshReconcileStatus().catch(() => {
        /* transient poll failure — the next tick retries */
      });
    }, POLL_MS);
    return () => clearInterval(handle);
  }, [reconcileInFlight, refreshReconcileStatus]);

  useEffect(() => {
    if (!buildInFlight) return undefined;
    const handle = setInterval(() => {
      void refreshBuildStatus().catch(() => {
        /* transient poll failure — the next tick retries */
      });
    }, POLL_MS);
    return () => clearInterval(handle);
  }, [buildInFlight, refreshBuildStatus]);

  useEffect(() => {
    if (!loopInFlight) return undefined;
    const handle = setInterval(() => {
      void refreshLoopStatus().catch(() => {
        /* transient poll failure — the next tick retries */
      });
    }, POLL_MS);
    return () => clearInterval(handle);
  }, [loopInFlight, refreshLoopStatus]);

  // --- reviewer evidence (attempts + parity report) ----------------------------

  const reviewerIsWorkbench = reviewerRow !== null && isWorkbenchRow(reviewerRow);

  const loadEvidence = useCallback(
    async (translationId: string) => {
      setEvidenceLoading(true);
      setEvidenceError(null);
      const problems: string[] = [];
      const [attemptRows, report] = await Promise.all([
        listDbMigrationPackTranslationAttempts(
          projectId,
          packId,
          translationId,
        ).catch((err: unknown) => {
          problems.push(messageOf(err, 'attempt history unavailable'));
          return [] as DbMigrationPackTranslationAttempt[];
        }),
        getDbMigrationPackTranslationParityReport(
          projectId,
          packId,
          translationId,
        ).catch((err: unknown) => {
          problems.push(messageOf(err, 'parity report unavailable'));
          return null;
        }),
      ]);
      setAttempts(attemptRows);
      setParityReport(report);
      setEvidenceError(problems.length > 0 ? problems.join('; ') : null);
      setEvidenceLoading(false);
    },
    [projectId, packId],
  );

  useEffect(() => {
    if (!reviewerId || !reviewerIsWorkbench) {
      setAttempts([]);
      setParityReport(null);
      setEvidenceError(null);
      return;
    }
    void loadEvidence(reviewerId);
  }, [reviewerId, reviewerIsWorkbench, loadEvidence]);

  // --- translate / retry / translate-all -------------------------------------

  const runTranslateAction = useCallback(
    async (
      kind: 'all' | 'translate' | 'retry',
      translationId?: string,
    ) => {
      if (busyId) return;
      setBusyId(kind === 'all' ? 'all' : translationId ?? null);
      setError(null);
      setNotice(null);
      try {
        const result =
          kind === 'all'
            ? await translateAllDbMigrationPackTranslations(projectId, packId)
            : kind === 'translate'
              ? await translateDbMigrationPackTranslation(
                  projectId,
                  packId,
                  translationId!,
                )
              : await retryDbMigrationPackTranslation(
                  projectId,
                  packId,
                  translationId!,
                );
        setNotice(summarizeOutcomes(result.outcomes));
        await loadTranslations();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Translation run failed');
      } finally {
        setBusyId(null);
      }
    },
    [busyId, projectId, packId, loadTranslations],
  );

  // --- disposition -------------------------------------------------------------

  const handleEmission = useCallback(
    (emission: DbMigrationPackTranslationEmission | null) => {
      if (emission) {
        const demoted = emission.demoted ?? [];
        const demotedNote =
          demoted.length > 0
            ? ` ${demoted.length} approval(s) were auto-demoted to needs-rework ` +
              `(unrunnable on the target — see the reviewer notes): ` +
              `${demoted.slice(0, 3).map((d) => d.object_ref).join(', ')}` +
              `${demoted.length > 3 ? ` (+${demoted.length - 3} more)` : ''}.`
            : '';
        setNotice(
          `Approved-only emission re-ran: ${emission.approved_count} approved ` +
            `translation(s) on the executable path` +
            `${emission.changed ? ' (pack files updated)' : ' (no change)'}.` +
            demotedNote,
        );
        if (emission.changed) onEmissionChanged?.();
      }
    },
    [onEmissionChanged],
  );

  const applyDisposition = useCallback(
    async (
      translationId: string,
      disposition: DbMigrationPackTranslationDisposition,
      dropReason?: string,
    ) => {
      if (busyId) return;
      setBusyId(translationId);
      setError(null);
      setNotice(null);
      try {
        const result = await setDbMigrationPackTranslationDisposition(
          projectId,
          packId,
          translationId,
          disposition,
          dropReason,
        );
        setDropDrafts((prev) => {
          const next = { ...prev };
          delete next[translationId];
          return next;
        });
        handleEmission(result.emission);
        await loadTranslations();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to set the disposition',
        );
      } finally {
        setBusyId(null);
      }
    },
    [busyId, projectId, packId, loadTranslations, handleEmission],
  );

  const handleDispositionChange = useCallback(
    (row: DbMigrationPackTranslationDto, value: string) => {
      if (value === 'drop') {
        // Drop REQUIRES a reason — open the inline reason entry; the API
        // call only fires from the explicit confirm with a non-empty reason.
        setError(null);
        setDropDrafts((prev) => ({ ...prev, [row.id]: prev[row.id] ?? '' }));
        return;
      }
      setDropDrafts((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      if (value !== row.disposition) {
        void applyDisposition(
          row.id,
          value as DbMigrationPackTranslationDisposition,
        );
      }
    },
    [applyDisposition],
  );

  const confirmDrop = useCallback(
    (row: DbMigrationPackTranslationDto) => {
      const reason = (dropDrafts[row.id] ?? '').trim();
      if (!reason) {
        setError(
          `An explicit reason is required to drop ${row.object_ref} — dropped objects always carry one.`,
        );
        return;
      }
      void applyDisposition(row.id, 'drop', reason);
    },
    [dropDrafts, applyDisposition],
  );

  // --- review -------------------------------------------------------------------

  const runReview = useCallback(
    async (
      translationId: string,
      action: DbMigrationPackTranslationReviewAction,
      notes: string,
    ) => {
      if (busyId) return;
      setBusyId(translationId);
      setError(null);
      setNotice(null);
      try {
        const result = await reviewDbMigrationPackTranslation(
          projectId,
          packId,
          translationId,
          action,
          notes,
        );
        setApproveReasons((prev) => {
          const next = { ...prev };
          delete next[translationId];
          return next;
        });
        setRows((prev) =>
          prev.map((r) => (r.id === result.translation.id ? result.translation : r)),
        );
        handleEmission(result.emission);
        // Re-fetch so the coverage chips track the new review status.
        await loadTranslations().catch(() => {
          /* chips refresh is best-effort; the row itself is already updated */
        });
      } catch (err) {
        // Evidence-gated approve (decision 17): 409 carries a READABLE reason
        // that belongs next to the button, not in the generic error banner.
        if (action === 'approve' && statusOf(err) === 409) {
          setApproveReasons((prev) => ({
            ...prev,
            [translationId]: messageOf(
              err,
              'not reconciled and no waiver covers the failing scenarios',
            ),
          }));
        } else {
          setError(messageOf(err, 'The review action failed'));
        }
      } finally {
        setBusyId(null);
      }
    },
    [busyId, projectId, packId, loadTranslations, handleEmission],
  );

  const handleReview = useCallback(
    async (action: DbMigrationPackTranslationReviewAction, notes: string) => {
      if (!reviewerRow) return;
      await runReview(reviewerRow.id, action, notes);
    },
    [reviewerRow, runReview],
  );

  // --- approve all (2026-08-08, server-side bulk) -------------------------------
  // ONE call: the gateway filters to the truly approvable rows (the exact
  // single-review approve gate — drafted + draft + JUDGE VERDICT; the first
  // client-side loop admitted verdict-less rows and ended in a wall of
  // 400s), approves them fail-soft, and runs ONE approved-only emission.
  // Rows the gate rejects come back in `not_approvable` and are summarised
  // honestly. The button count mirrors the same gate.
  const approveAllEligible = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.disposition === 'translate' &&
          r.review_status === 'unreviewed' &&
          r.pipeline_state === 'drafted' &&
          typeof r.draft_content === 'string' &&
          r.draft_content.length > 0 &&
          r.judge_verdict_json !== null,
      ),
    [rows],
  );
  const handleApproveAll = useCallback(async () => {
    if (busyId || approveAllEligible.length === 0) return;
    setBusyId('approve-all');
    setError(null);
    setNotice(null);
    try {
      const result = await approveAllDbMigrationPackTranslations(projectId, packId);
      // handleEmission FIRST (fires onEmissionChanged + its own notice), then
      // the composed summary overwrites the notice with the full picture.
      if (result.emission) handleEmission(result.emission);
      const parts: string[] = [`Approved ${result.approved_count} translation(s).`];
      if (result.emission?.changed) parts.push('Pack files updated on the executable path.');
      if (result.not_approvable.length > 0) {
        const preview = result.not_approvable
          .slice(0, 3)
          .map((n) => `${n.translation_key} (${n.reason})`)
          .join('; ');
        parts.push(
          `${result.not_approvable.length} unreviewed row(s) are not approvable: ` +
            `${preview}${result.not_approvable.length > 3 ? ` (+${result.not_approvable.length - 3} more)` : ''}.`,
        );
      }
      setNotice(parts.join(' '));
      if (result.failed.length > 0) {
        const preview = result.failed
          .slice(0, 3)
          .map((f) => `${f.translation_key}: ${f.reason}`)
          .join('; ');
        setError(
          `Approve all: ${result.failed.length} approval(s) failed — ` +
            `${preview}${result.failed.length > 3 ? ` (+${result.failed.length - 3} more)` : ''}`,
        );
      }
      await loadTranslations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve-all failed');
    } finally {
      setBusyId(null);
    }
  }, [busyId, approveAllEligible.length, projectId, packId, loadTranslations, handleEmission]);

  // --- supply full source body (2026-08-07: truncated is no longer terminal) ----

  const handleSupplyBody = useCallback(
    async (sourceBody: string) => {
      if (!reviewerRow || busyId) return;
      setBusyId(reviewerRow.id);
      setError(null);
      setNotice(null);
      try {
        const result = await supplyDbMigrationPackTranslationBody(
          projectId,
          packId,
          reviewerRow.id,
          sourceBody,
        );
        setRows((prev) =>
          prev.map((r) => (r.id === result.translation.id ? result.translation : r)),
        );
        handleEmission(result.emission);
        setNotice(
          'Full source body supplied — the row returned to pending; run Translate to draft it.',
        );
        await loadTranslations().catch(() => {
          /* chips refresh is best-effort; the row itself is already updated */
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Supplying the source body failed');
      } finally {
        setBusyId(null);
      }
    },
    [reviewerRow, busyId, projectId, packId, loadTranslations, handleEmission],
  );

  // --- workbench rows ----------------------------------------------------------

  const workbenchRows = useMemo(
    () => rows.filter((r) => isWorkbenchRow(r) && matchesWorkbenchFilter(r, filter)),
    [rows, filter],
  );
  const plainRows = useMemo(
    () => rows.filter((r) => !isWorkbenchRow(r) && matchesWorkbenchFilter(r, filter)),
    [rows, filter],
  );
  const reconciledCount = useMemo(
    () =>
      rows.filter(
        (r) => isWorkbenchRow(r) && r.loop_status === 'reconciled' &&
          r.review_status !== 'approved',
      ).length,
    [rows],
  );

  // --- workbench actions --------------------------------------------------------

  const runCredentialedAction = useCallback(
    async (
      action: PendingCredentialedAction,
      creds: DbMigrationPackDbCredentials,
    ) => {
      setError(null);
      setNotice(null);
      try {
        if (action.kind === 'translate-reconcile') {
          setBusyId('translate-reconcile');
          await translateAndReconcileDbMigrationPack(projectId, packId, {
            targetDb: creds,
          });
          setNotice(
            'Translate & reconcile started — the loop runs automatically ' +
              `(translate → apply → reconcile → re-translate with evidence, cap ${DB_PACK_TRANSLATION_ATTEMPT_CAP}).`,
          );
          loopWasInFlight.current = true;
          await refreshLoopStatus().catch(() => {
            /* the poller picks it up on the next tick */
          });
        } else if (action.kind === 'reconcile-all') {
          // No bulk reconcile route exists: the workbench reconciles each
          // routine in turn and reports the per-routine outcome honestly.
          setBusyId('reconcile-all');
          const targets = rows.filter(
            (r) => isWorkbenchRow(r) && r.loop_status !== 'dispositioned',
          );
          const summaries: string[] = [];
          const failures: string[] = [];
          for (const row of targets) {
            try {
              const result = await reconcileDbMigrationPackTranslation(
                projectId,
                packId,
                row.id,
                creds,
              );
              const summary = result.report?.summary;
              summaries.push(
                `${row.object_ref}: ${summary?.status ?? 'reported'}` +
                  (summary && summary.divergent > 0
                    ? ` (${summary.divergent} divergent)`
                    : ''),
              );
            } catch (err) {
              failures.push(`${row.object_ref}: ${messageOf(err, 'reconcile failed')}`);
            }
          }
          setNotice(
            targets.length === 0
              ? 'No routines to reconcile.'
              : `Reconciled ${summaries.length} of ${targets.length} routine(s): ${summaries.join('; ')}`,
          );
          if (failures.length > 0) {
            setError(`Reconcile failures — ${failures.join('; ')}`);
          }
          await loadTranslations();
        } else if (action.kind === 'reconcile-one') {
          setBusyId(action.translationId);
          const result = await reconcileDbMigrationPackTranslation(
            projectId,
            packId,
            action.translationId,
            creds,
          );
          const summary = result.report?.summary;
          setNotice(
            `Reconciled ${result.report?.routineName ?? 'the routine'}: ` +
              `${summary?.status ?? 'reported'}` +
              (summary
                ? ` — ${summary.divergent} divergent, ${summary.unverifiable} unverifiable of ${summary.scenarios} scenario(s).`
                : '.'),
          );
          await loadTranslations();
          if (reviewerId === action.translationId) {
            await loadEvidence(action.translationId);
          }
        } else {
          setBusyId(action.translationId);
          await retryDbMigrationPackTranslationLoop(
            projectId,
            packId,
            action.translationId,
            creds,
            action.guidance,
          );
          setNotice(
            'Guidance recorded — one more loop attempt is running with it in ' +
              'the prompt. The draft is never edited by hand.',
          );
          loopWasInFlight.current = true;
          await refreshLoopStatus().catch(() => {
            /* the poller picks it up on the next tick */
          });
        }
      } catch (err) {
        setError(messageOf(err, 'The workbench action failed'));
      } finally {
        setBusyId(null);
      }
    },
    [
      projectId,
      packId,
      rows,
      reviewerId,
      loadTranslations,
      loadEvidence,
      refreshLoopStatus,
    ],
  );

  /** Run now when credentials are held, otherwise prompt for them once. */
  const withTargetDb = useCallback(
    (purpose: string, action: PendingCredentialedAction) => {
      if (targetDb) {
        void runCredentialedAction(action, targetDb);
        return;
      }
      setModalError(null);
      setModal({ variant: 'connect', purpose, pending: action });
    },
    [targetDb, runCredentialedAction],
  );

  const handleModalSubmit = useCallback(
    async (payload: DbMigrationPackTargetBuildSubmit) => {
      const current = modal;
      if (!current) return;
      // The same target block feeds every later workbench action this session.
      setTargetDb(payload.targetDb);
      if (current.variant === 'connect') {
        setModal(null);
        if (current.pending) {
          void runCredentialedAction(current.pending, payload.targetDb);
        }
        return;
      }
      if (current.variant === 'reconcile') {
        setBusyId('target-reconcile');
        setModalError(null);
        try {
          await startDbMigrationPackTargetReconcile(projectId, packId, {
            targetDb: payload.targetDb,
            sourceDb: payload.sourceDb,
          });
          setModal(null);
          setNotice(
            'Reconcile started — every table in the pack manifest is compared ' +
              'between the source and the target. The header tracks it and ' +
              'shows the report when it lands.',
          );
          await refreshReconcileStatus().catch(() => {
            /* the poller picks it up on the next tick */
          });
        } catch (err) {
          setModalError(messageOf(err, 'Failed to start the reconcile'));
        } finally {
          setBusyId(null);
        }
        return;
      }
      setBusyId('target-build');
      setModalError(null);
      try {
        await startDbMigrationPackTargetBuild(projectId, packId, {
          targetDb: payload.targetDb,
          sourceDb: payload.sourceDb,
          rebuild: payload.rebuild,
        });
        setModal(null);
        setNotice(
          'Target build started — schema, then data, then the approved ' +
            'translations. The header tracks each phase.',
        );
        await refreshBuildStatus().catch(() => {
          /* the poller picks it up on the next tick */
        });
      } catch (err) {
        setModalError(messageOf(err, 'Failed to start the target build'));
      } finally {
        setBusyId(null);
      }
    },
    [modal, projectId, packId, runCredentialedAction, refreshBuildStatus, refreshReconcileStatus],
  );

  const handleApproveAllReconciled = useCallback(async () => {
    if (busyId) return;
    setBusyId('approve-all-reconciled');
    setError(null);
    setNotice(null);
    try {
      const result = await approveAllReconciledDbMigrationPackTranslations(
        projectId,
        packId,
      );
      if (result.emission) handleEmission(result.emission);
      const parts = [
        `Approved ${result.approvedCount} of ${result.eligibleCount} reconciled routine(s).`,
      ];
      if (result.failed.length > 0) {
        parts.push(
          `${result.failed.length} refused: ` +
            result.failed
              .slice(0, 3)
              .map((f) => `${f.routine} (${f.reason})`)
              .join('; ') +
            (result.failed.length > 3 ? ` (+${result.failed.length - 3} more)` : ''),
        );
      }
      setNotice(parts.join(' '));
      await loadTranslations();
    } catch (err) {
      setError(messageOf(err, 'Approve all reconciled failed'));
    } finally {
      setBusyId(null);
    }
  }, [busyId, projectId, packId, loadTranslations, handleEmission]);

  const handleWaive = useCallback(
    async (
      translationId: string,
      scope: DbMigrationPackWaiverScope,
      scenario: string | null,
      reason: string,
    ) => {
      if (busyId) return;
      setBusyId(translationId);
      setError(null);
      setNotice(null);
      try {
        const result = await waiveDbMigrationPackTranslation(
          projectId,
          packId,
          translationId,
          { scope, scenario, reason },
        );
        setNotice(
          `Waiver recorded for ${result.target ?? scope} — reason: ${reason}. ` +
            'The routine counts as reconciled WITH WAIVERS, never fully reconciled.',
        );
        await loadTranslations();
        if (reviewerId === translationId) {
          await loadEvidence(translationId);
        }
      } catch (err) {
        setError(messageOf(err, 'Failed to record the waiver'));
      } finally {
        setBusyId(null);
      }
    },
    [busyId, projectId, packId, reviewerId, loadTranslations, loadEvidence],
  );

  // --- header copy --------------------------------------------------------------

  const reconcileStatusText = useMemo(() => {
    if (reconcileStatus?.inFlight) {
      return `reconciling: ${reconcileStatus.inFlight.phase ?? 'starting'}`;
    }
    const last = reconcileStatus?.last;
    if (last?.status === 'failed') {
      return `last reconcile FAILED${last.error ? ` — ${last.error}` : ''}`;
    }
    const report = reconcileStatus?.latestReport;
    if (report) {
      const s = report.summary;
      const counts =
        s.tables !== null
          ? ` — ${s.divergent ?? 0} divergent / ${s.unverifiable ?? 0} unverifiable of ${s.tables} table(s)`
          : '';
      return `${report.status ?? 'unknown'}${counts} (report ${formatClock(report.createdAt)})${
        last?.error ? ` — ${last.error}` : ''
      }`;
    }
    if (reconcileStatus?.latestReportError) {
      return `unknown — ${reconcileStatus.latestReportError}`;
    }
    return 'not reconciled';
  }, [reconcileStatus]);

  const reconcileProblemRows = useMemo(
    () =>
      (reconcileStatus?.latestReport?.tables ?? [])
        .filter((row) => row.verdict === 'divergent' || row.verdict === 'unverifiable')
        .slice(0, 25),
    [reconcileStatus],
  );

  const targetStatusText = useMemo(() => {
    if (buildStatus?.inFlight) {
      return `building: ${buildStatus.inFlight.phase ?? 'starting'}`;
    }
    const latest = buildStatus?.latest;
    if (!latest || !latest.status) return 'not built';
    if (latest.status === 'succeeded') {
      return `built ${formatClock(latest.endedAt ?? latest.startedAt)} from pack ${
        latest.packVersion ? `v${latest.packVersion}` : '(version unknown)'
      }`;
    }
    if (latest.status === 'failed') {
      return `last build FAILED${latest.error ? ` — ${latest.error}` : ''}`;
    }
    return `last build ${latest.status}`;
  }, [buildStatus]);

  const baselineStatusText = useMemo(() => {
    if (!baseline) return 'reading…';
    if (!baseline.pinned) return 'no pinned proc baseline — capture first';
    return `pinned, ${baseline.scenarios} scenarios across ${baseline.routines} routines`;
  }, [baseline]);

  const exhaustedResults = useMemo(
    () => (loop?.results ?? []).filter((r) => r.finalStatus === 'exhausted'),
    [loop],
  );

  const actionsLocked = busyId !== null || buildInFlight || loopInFlight;

  // -------------------------------------------------------------------------------

  if (loading) {
    return (
      <div className={styles.emptyMessage} data-testid="db-pack-translations-loading">
        Loading translations…
      </div>
    );
  }

  const renderDispositionCell = (row: DbMigrationPackTranslationDto) => {
    const inDropEntry = Object.prototype.hasOwnProperty.call(dropDrafts, row.id);
    return (
      <>
        <select
          className={styles.filterSelect}
          value={inDropEntry ? 'drop' : row.disposition}
          onChange={(e) => handleDispositionChange(row, e.target.value)}
          disabled={busyId !== null}
          data-testid={`db-pack-translation-disposition-${row.id}`}
        >
          <option value="translate">translate</option>
          <option value="rewrite_in_app">rewrite in app</option>
          <option value="drop">drop</option>
        </select>
        {inDropEntry && (
          <div className={styles.inlineResolve}>
            <input
              type="text"
              className={styles.filterInput}
              placeholder="Reason (required)"
              value={dropDrafts[row.id]}
              onChange={(e) =>
                setDropDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))
              }
              data-testid={`db-pack-translation-drop-reason-${row.id}`}
            />
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => confirmDrop(row)}
              disabled={busyId !== null}
              data-testid={`db-pack-translation-drop-confirm-${row.id}`}
            >
              Drop
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() =>
                setDropDrafts((prev) => {
                  const next = { ...prev };
                  delete next[row.id];
                  return next;
                })
              }
              data-testid={`db-pack-translation-drop-cancel-${row.id}`}
            >
              Cancel
            </button>
          </div>
        )}
        {row.disposition === 'drop' && row.drop_reason && (
          <p className={styles.manifestNote}>{row.drop_reason}</p>
        )}
      </>
    );
  };

  return (
    <div className={styles.translationsTab} data-testid="db-pack-translations-tab">
      {/* Workbench header ------------------------------------------------------ */}
      <div className={styles.manifestSection} data-testid="db-pack-wb-header">
        <div className={styles.actionsBar}>
          <span
            className={styles.manifestNote}
            data-testid="db-pack-wb-target-status"
          >
            Target DB: {targetStatusText}
          </span>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => {
              setModalError(null);
              setModal({ variant: 'build', purpose: null, pending: null });
            }}
            disabled={busyId !== null || buildInFlight}
            title="Builds the target database from this pack: schema, data, then the approved translations"
            data-testid="db-pack-wb-build-target"
          >
            {buildInFlight ? 'Building…' : 'Build target…'}
          </button>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => {
              setModalError(null);
              setModal({ variant: 'reconcile', purpose: null, pending: null });
            }}
            disabled={busyId !== null || buildInFlight || reconcileInFlight}
            title="Compares every table in the pack manifest between the source and the built target (the DB plane's data-parity reconcile), before any plan run"
            data-testid="db-pack-wb-reconcile-target"
          >
            {reconcileInFlight ? 'Reconciling…' : 'Reconcile target…'}
          </button>
        </div>
        {buildStatus?.latest && (
          <p className={styles.manifestNote} data-testid="db-pack-wb-build-phases">
            {['schema', 'data', 'translations']
              .map((name) => {
                const phase = buildStatus.latest?.phases?.[name];
                const detail = phase?.error ?? phase?.detail ?? '';
                return `${name}: ${phase?.status ?? 'pending'}${
                  detail ? ` (${detail})` : ''
                }`;
              })
              .join(' · ')}
          </p>
        )}
        <p className={styles.manifestNote} data-testid="db-pack-wb-reconcile-status">
          Target parity: {reconcileStatusText}
        </p>
        {reconcileProblemRows.length > 0 && (
          <ul className={styles.manifestNote} data-testid="db-pack-wb-reconcile-tables">
            {reconcileProblemRows.map((row) => (
              <li key={`${row.schema ?? ''}.${row.table}`} data-testid={`db-pack-wb-reconcile-table-${row.table}`}>
                {row.schema ? `${row.schema}.` : ''}
                {row.table} — {row.verdict ?? 'unknown'}
                {row.divergenceClass ? ` (${row.divergenceClass})` : ''}
                {row.sourceCount !== null || row.targetCount !== null
                  ? ` · source ${row.sourceCount ?? '?'} / target ${row.targetCount ?? '?'} rows`
                  : ''}
                {row.cellDivergences ? ` · ${row.cellDivergences} cell divergence(s)` : ''}
                {row.reason ? ` — ${row.reason}` : ''}
              </li>
            ))}
          </ul>
        )}
        <p
          className={styles.manifestNote}
          data-testid="db-pack-wb-baseline-status"
        >
          Proc baseline: {baselineStatusText}
        </p>
        <p className={styles.manifestNote} data-testid="db-pack-wb-attempt-cap">
          Attempt cap: {DB_PACK_TRANSLATION_ATTEMPT_CAP}
        </p>
        {headerNote && (
          <p className={styles.manifestNote} data-testid="db-pack-wb-header-note">
            {headerNote}
          </p>
        )}
      </div>

      {/* Coverage-summary chips ------------------------------------------------ */}
      {coverage && (
        <div
          className={styles.coverageChips}
          data-testid="db-pack-translations-coverage"
        >
          <span
            className={`${styles.coverageChip} ${styles.coverageChipTranslated}`}
            data-testid="db-pack-translation-coverage-drafted"
          >
            {coverage.drafted} drafted
          </span>
          <span
            className={`${styles.coverageChip} ${styles.coverageChipTranslated}`}
            data-testid="db-pack-translation-coverage-approved"
          >
            {coverage.approved} approved
          </span>
          <span
            className={`${styles.coverageChip} ${styles.coverageChipSkipped}`}
            data-testid="db-pack-translation-coverage-rewrite-in-app"
          >
            {coverage.rewrite_in_app} rewrite in app
          </span>
          <span
            className={`${styles.coverageChip} ${styles.coverageChipSkipped}`}
            data-testid="db-pack-translation-coverage-dropped"
          >
            {coverage.dropped} dropped
          </span>
          <span
            className={`${styles.coverageChip} ${styles.coverageChipFlagged}`}
            data-testid="db-pack-translation-coverage-failed"
          >
            {coverage.failed} failed
          </span>
          <span
            className={`${styles.coverageChip} ${styles.coverageChipFlagged}`}
            data-testid="db-pack-translation-coverage-needs-manual"
          >
            {coverage.needs_manual} needs manual
          </span>
        </div>
      )}

      {error && (
        <div className={styles.errorBanner} data-testid="db-pack-translations-error">
          {error}
        </div>
      )}
      {notice && (
        <div className={styles.noticeBanner} data-testid="db-pack-translations-notice">
          {notice}
        </div>
      )}

      {/* Loop status ------------------------------------------------------------ */}
      {loop && (loop.inFlight || loop.results !== null || loop.error) && (
        <div
          className={loop.inFlight ? styles.noticeBanner : styles.manifestSection}
          data-testid="db-pack-wb-loop-status"
        >
          {loop.inFlight ? (
            <p className={styles.manifestNote}>
              Loop running{loop.phase ? ` — ${loop.phase}` : ''}: {loop.done} of{' '}
              {loop.routines} routine(s) done.
            </p>
          ) : (
            <p className={styles.manifestNote}>
              Loop finished — {(loop.results ?? []).length} routine(s) reached a
              terminal state.
            </p>
          )}
          {loop.error && (
            <div className={styles.errorBanner}>Loop error: {loop.error}</div>
          )}
          {exhaustedResults.length > 0 && (
            <div
              className={styles.errorBanner}
              data-testid="db-pack-wb-loop-exhausted"
            >
              {exhaustedResults.length} routine(s) hit the attempt cap of{' '}
              {DB_PACK_TRANSLATION_ATTEMPT_CAP} and are NOT reconciled:{' '}
              {exhaustedResults
                .map(
                  (r) =>
                    `${r.routine ?? r.translationId ?? 'unknown'}` +
                    (r.bestAttemptNo ? ` (best attempt ${r.bestAttemptNo})` : ''),
                )
                .join(', ')}
              . Open each one to read the surviving failure signatures, then
              use Guidance & retry or record a waiver with a reason.
            </div>
          )}
          {loop.events.length > 0 && (
            <ul className={styles.orderedList} data-testid="db-pack-wb-loop-events">
              {loop.events.slice(-6).map((event, index) => (
                <li key={`event-${index}`}>
                  {event.at ? `${event.at} · ` : ''}
                  {event.routine ?? '—'} · {event.phase ?? '—'}
                  {event.detail ? ` — ${event.detail}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Workbench actions + filter --------------------------------------------- */}
      <div className={styles.actionsBar}>
        <button
          type="button"
          className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
          onClick={() =>
            withTargetDb('Translate & reconcile all', {
              kind: 'translate-reconcile',
            })
          }
          disabled={actionsLocked}
          title="Runs the AUTOMATIC loop over every translate-dispositioned routine: translate, apply, reconcile, re-translate with evidence, until reconciled or the attempt cap"
          data-testid="db-pack-wb-translate-reconcile"
        >
          {busyId === 'translate-reconcile' || loopInFlight
            ? 'Loop running…'
            : 'Translate & reconcile all'}
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => withTargetDb('Reconcile all', { kind: 'reconcile-all' })}
          disabled={actionsLocked}
          title="Re-runs proc parity for every routine against the pinned baseline without re-translating"
          data-testid="db-pack-wb-reconcile-all"
        >
          {busyId === 'reconcile-all' ? 'Reconciling…' : 'Reconcile all'}
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => void handleApproveAllReconciled()}
          disabled={actionsLocked}
          title="Approves every routine the server accepts as reconciled (or waiver-covered) — approval is evidence-gated"
          data-testid="db-pack-wb-approve-all-reconciled"
        >
          {busyId === 'approve-all-reconciled'
            ? 'Approving…'
            : `Approve all reconciled (${reconciledCount})`}
        </button>
        <label className={styles.filterGroup}>
          <span className={styles.filterLabel}>Filter</span>
          <select
            className={styles.filterSelect}
            value={filter}
            onChange={(e) =>
              setFilter(e.target.value as DbMigrationPackWorkbenchFilter)
            }
            data-testid="db-pack-wb-filter"
          >
            {WORKBENCH_FILTERS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Bulk action (product rule: never individual-only actions). */}
      <div className={styles.actionsBar}>
        <button
          type="button"
          className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
          onClick={() => void runTranslateAction('all')}
          disabled={busyId !== null}
          title="Translates every pending + failed object (drafted, approved, dispositioned-away and needs-manual objects are skipped)"
          data-testid="db-pack-translate-all"
        >
          {busyId === 'all' ? 'Translating…' : 'Translate all'}
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => void handleApproveAll()}
          disabled={busyId !== null || approveAllEligible.length === 0}
          title="Approve every drafted, unreviewed translation — rejected / needs-rework rows are excluded (they carry reviewer notes); each approve re-runs the approved-only emission"
          data-testid="db-pack-approve-all"
        >
          {busyId === 'approve-all' ? 'Approving…' : `Approve all (${approveAllEligible.length})`}
        </button>
        <span className={styles.manifestNote}>
          Translate-all processes pending + failed objects only; Approve-all
          approves drafted unreviewed rows only.
        </span>
      </div>

      {/* Routine workbench table ------------------------------------------------ */}
      {workbenchRows.length > 0 && (
        <div className={styles.tableScroll} data-testid="db-pack-wb-table">
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>Routine</th>
                <th>Kind</th>
                <th>Scenarios</th>
                <th>Attempts</th>
                <th>Loop status</th>
                <th>Verdict</th>
                <th>Review</th>
                <th>Disposition</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workbenchRows.map((row) => {
                const state = reviewState(row);
                const reason = approveReasons[row.id];
                return (
                  <tr key={row.id} data-testid={`db-pack-wb-row-${row.id}`}>
                    <td>
                      <button
                        type="button"
                        className={styles.actionLink}
                        onClick={() => setReviewerId(row.id)}
                        data-testid={`db-pack-wb-open-${row.id}`}
                      >
                        {row.object_ref}
                      </button>
                    </td>
                    <td>
                      <span className={styles.badge}>{routineKindLabel(row)}</span>
                      {row.untranslatable_reason && (
                        <span
                          className={styles.badge}
                          title={`Not attempted: ${String(row.untranslatable_reason).replace(/_/g, ' ')}`}
                          data-testid="db-pack-translation-untranslatable-reason"
                        >
                          {' '}
                          not attempted · {String(row.untranslatable_reason).replace(/_/g, ' ')}
                        </span>
                      )}
                    </td>
                    <td>{scenariosLabel(row)}</td>
                    <td>{attemptsLabel(row)}</td>
                    <td>
                      <span
                        className={loopStatusBadgeClass(String(row.loop_status ?? ''))}
                      >
                        {loopStatusLabel(row)}
                      </span>
                    </td>
                    <td>{verdictLabel(row)}</td>
                    <td>
                      {state === 'approve' ? (
                        <button
                          type="button"
                          className={styles.actionButton}
                          onClick={() => void runReview(row.id, 'approve', '')}
                          disabled={busyId !== null}
                          data-testid={`db-pack-wb-approve-${row.id}`}
                        >
                          Approve
                        </button>
                      ) : (
                        <span
                          className={
                            state === 'approved'
                              ? styles.badgeResolved
                              : state === 'needs-you'
                                ? styles.badgeMissing
                                : styles.badge
                          }
                        >
                          {REVIEW_STATE_LABEL[state]}
                        </span>
                      )}
                      {reason && (
                        <p
                          className={styles.manifestNote}
                          data-testid={`db-pack-wb-approve-reason-${row.id}`}
                        >
                          Approve refused: {reason}
                        </p>
                      )}
                    </td>
                    <td>{renderDispositionCell(row)}</td>
                    <td>
                      <div className={styles.actionsBar}>
                        <button
                          type="button"
                          className={styles.actionButton}
                          onClick={() =>
                            withTargetDb('Reconcile', {
                              kind: 'reconcile-one',
                              translationId: row.id,
                            })
                          }
                          disabled={actionsLocked}
                          data-testid={`db-pack-wb-reconcile-${row.id}`}
                        >
                          Reconcile
                        </button>
                        <button
                          type="button"
                          className={styles.actionButton}
                          onClick={() => setReviewerId(row.id)}
                          data-testid={`db-pack-translation-review-${row.id}`}
                        >
                          Review
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Object list (views / jobs / check constraints — unchanged) ------------- */}
      {rows.length === 0 ? (
        <div className={styles.emptyMessage} data-testid="db-pack-translations-empty">
          No objects require translation in this pack.
        </div>
      ) : plainRows.length === 0 && workbenchRows.length === 0 ? (
        <div
          className={styles.emptyMessage}
          data-testid="db-pack-translations-filtered-empty"
        >
          No rows match the {WORKBENCH_FILTERS.find((f) => f.value === filter)?.label}{' '}
          filter. Nothing is hidden permanently — switch to All to see every row.
        </div>
      ) : plainRows.length === 0 ? null : (
        <div className={styles.tableScroll}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>Object</th>
                <th>Kind</th>
                <th>Body size</th>
                <th>Disposition</th>
                <th>Pipeline state</th>
                <th>Review status</th>
                <th>Judge confidence</th>
                <th>Fidelity</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {plainRows.map((row) => {
                const confidence = row.judge_verdict_json?.confidence;
                const translatable =
                  row.disposition === 'translate' &&
                  row.pipeline_state !== 'needs_manual';
                return (
                  <tr key={row.id} data-testid={`db-pack-translation-row-${row.id}`}>
                    <td>{row.object_ref}</td>
                    <td>
                      <span className={styles.badge}>{row.kind}</span>
                    </td>
                    <td>{formatBodySize(row.source_body)}</td>
                    <td>{renderDispositionCell(row)}</td>
                    <td>
                      <span className={pipelineStateBadgeClass(row.pipeline_state)}>
                        {row.pipeline_state === 'translating'
                          ? 'translating (retry if stuck)'
                          : row.pipeline_state}
                      </span>
                    </td>
                    <td>
                      <span className={reviewStatusBadgeClass(row.review_status)}>
                        {row.review_status}
                      </span>
                    </td>
                    <td>
                      {typeof confidence === 'number' ? confidence.toFixed(2) : '—'}
                    </td>
                    <td>
                      {row.truncated === true && (
                        <span
                          className={styles.badgeMissing}
                          title="Body truncated at capture (64KB cap) — needs manual translation"
                        >
                          truncated
                        </span>
                      )}{' '}
                      {row.legacy_redacted === true && (
                        <span
                          className={styles.badgeFlagged}
                          title="Literals collapsed at capture — re-scan recommended"
                        >
                          legacy literals
                        </span>
                      )}
                    </td>
                    <td>
                      <div className={styles.actionsBar}>
                        {translatable && row.pipeline_state === 'pending' && (
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() =>
                              void runTranslateAction('translate', row.id)
                            }
                            disabled={busyId !== null}
                            data-testid={`db-pack-translation-translate-${row.id}`}
                          >
                            {busyId === row.id ? 'Translating…' : 'Translate'}
                          </button>
                        )}
                        {translatable && row.pipeline_state === 'drafted' && (
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() =>
                              void runTranslateAction('translate', row.id)
                            }
                            disabled={busyId !== null}
                            title="Re-translate resets the review status to unreviewed with a fresh judge pass"
                            data-testid={`db-pack-translation-translate-${row.id}`}
                          >
                            {busyId === row.id ? 'Translating…' : 'Re-translate'}
                          </button>
                        )}
                        {translatable &&
                          (row.pipeline_state === 'failed' ||
                            row.pipeline_state === 'translating') && (
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => void runTranslateAction('retry', row.id)}
                              disabled={busyId !== null}
                              data-testid={`db-pack-translation-retry-${row.id}`}
                            >
                              {busyId === row.id ? 'Retrying…' : 'Retry'}
                            </button>
                          )}
                        <button
                          type="button"
                          className={styles.actionButton}
                          onClick={() => setReviewerId(row.id)}
                          data-testid={`db-pack-translation-review-${row.id}`}
                        >
                          Review
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Side-by-side draft reviewer -------------------------------------------- */}
      {reviewerRow && (
        <DbMigrationPackTranslationReviewer
          key={reviewerRow.id}
          translation={reviewerRow}
          sourceEngineDisplay={sourceEngineDisplay ?? null}
          busy={busyId !== null}
          onReview={(action, notes) => void handleReview(action, notes)}
          onClose={() => setReviewerId(null)}
          onSupplyBody={(sourceBody) => void handleSupplyBody(sourceBody)}
          workbench={
            isWorkbenchRow(reviewerRow)
              ? {
                  attempts,
                  parityReport,
                  evidenceLoading,
                  evidenceError,
                  approveReason: approveReasons[reviewerRow.id] ?? null,
                  onGuidanceRetry: (guidance) =>
                    withTargetDb('Guidance & retry', {
                      kind: 'retry-loop',
                      translationId: reviewerRow.id,
                      guidance,
                    }),
                  onWaive: (scope, scenario, reason) =>
                    void handleWaive(reviewerRow.id, scope, scenario, reason),
                }
              : undefined
          }
        />
      )}

      {/* Build target / target credentials modal -------------------------------- */}
      {modal && (
        <DbMigrationPackTargetBuildModal
          variant={modal.variant}
          sourceEngine={sourceEngine ?? null}
          sourceEngineDisplay={sourceEngineDisplay ?? null}
          busy={busyId === 'target-build' || busyId === 'target-reconcile'}
          error={modalError}
          purpose={modal.purpose}
          onSubmit={(payload) => void handleModalSubmit(payload)}
          onClose={() => {
            setModal(null);
            setModalError(null);
          }}
        />
      )}
    </div>
  );
};

export default DbMigrationPackTranslationsTab;
