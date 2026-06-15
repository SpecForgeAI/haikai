/**
 * MigrationDeliveryPlanProgressSummary
 *
 * Spec: 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work Generation
 * Task Group 10 — Generation Progress + Draft Summary Surface.
 *
 * Renders two related surfaces:
 *
 *   1. ProgressOverlay — scripted client-side stage markers driven by
 *      lifecycle phases the wizard emits (`loading_context`,
 *      `calling_generator`, `validating_schema`, `saving_draft`, `complete`).
 *      Q-15 says we never stream LLM tokens; markers flip in response to
 *      explicit phase events OR a time-bucket fallback when the parent
 *      surface only supplies start + end signals. Both modes are supported
 *      here (preferred path: explicit `phase` prop; fallback: internal timer
 *      keyed on `startedAt`).
 *
 *   2. DraftSummary — once generation completes, surfaces the generated
 *      `generationSummary` + `qualityAssessment` blobs to the reviewer:
 *      counts by type, confidence breakdown, readiness breakdown, coverage
 *      stats, major gaps, blocking issues, and an "Open hierarchy" button
 *      that routes onward to the Group 11 review workspace.
 *
 * The component is intentionally agnostic about how the wizard supplies
 * inputs — the parent surface (e.g. an MDP page route) wires `phase` from
 * the wizard's progress callback and `draft` from the post-generation fetch.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  fetchMigrationDeliveryPlanDraft,
  MigrationBookOfWorkDraft,
  MigrationBookOfWorkGenerationSummary,
  MigrationBookOfWorkItem,
} from '../../../api/migrationDeliveryPlanApi';
import { computeFindingsCoverage } from '../../../utils/findingsCoverage';
import styles from './MigrationDeliveryPlanProgressSummary.module.css';

// ============================================================================
// Phase enumeration (Q-15)
// ============================================================================

/**
 * Scripted stage marker keys. These mirror the gateway handler's diagnostic
 * log line stages so the parent surface can flip them as the request
 * progresses.
 */
export type ProgressPhase =
  | 'idle'
  | 'loading_context'
  | 'calling_generator'
  | 'validating_schema'
  | 'saving_draft'
  | 'complete'
  | 'error';

/** Ordered phase list for marker rendering + comparison. */
export const PROGRESS_PHASES: ReadonlyArray<{
  key: Exclude<ProgressPhase, 'idle' | 'error'>;
  label: string;
}> = [
  { key: 'loading_context', label: 'Loading context...' },
  { key: 'calling_generator', label: 'Calling generator...' },
  { key: 'validating_schema', label: 'Validating schema...' },
  { key: 'saving_draft', label: 'Saving draft...' },
  { key: 'complete', label: 'Complete' },
] as const;

/**
 * Time-bucket fallback when the parent does not supply explicit `phase`
 * transitions. Values are in milliseconds since `startedAt`.
 */
export const PHASE_TIME_BUCKETS: ReadonlyArray<{
  phase: Exclude<ProgressPhase, 'idle' | 'error' | 'complete'>;
  thresholdMs: number;
}> = [
  { phase: 'loading_context', thresholdMs: 0 },
  { phase: 'calling_generator', thresholdMs: 1500 },
  { phase: 'validating_schema', thresholdMs: 12000 },
  { phase: 'saving_draft', thresholdMs: 16000 },
] as const;

// ============================================================================
// ProgressOverlay
// ============================================================================

export interface ProgressOverlayProps {
  /**
   * Explicit phase signal from the parent. When provided, the overlay marker
   * flips deterministically to this phase. When omitted, the overlay uses
   * `startedAt` + time buckets to derive the current marker.
   */
  phase?: ProgressPhase;
  /** Used by the time-bucket fallback to derive an implied phase. */
  startedAt?: number;
  /** Optional error message shown in the overlay when phase === 'error'. */
  error?: string | null;
  /** Optional test-seam clock — defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Pure helper: given the explicit phase OR a startedAt timestamp, derive the
 * currently-active phase marker. Exported so unit tests can exercise the
 * time-bucket math without rendering React.
 */
export function deriveCurrentPhase(opts: {
  phase?: ProgressPhase;
  startedAt?: number;
  now?: () => number;
}): Exclude<ProgressPhase, 'idle'> {
  const { phase, startedAt } = opts;
  const now = opts.now ?? Date.now;
  if (phase && phase !== 'idle') return phase;
  if (!startedAt) return 'loading_context';
  const elapsed = now() - startedAt;
  let current: ProgressPhase = 'loading_context';
  for (const bucket of PHASE_TIME_BUCKETS) {
    if (elapsed >= bucket.thresholdMs) current = bucket.phase;
  }
  return current as Exclude<ProgressPhase, 'idle'>;
}

export function ProgressOverlay({
  phase,
  startedAt,
  error,
  now,
}: ProgressOverlayProps) {
  // Re-render on a tick so the time-bucket fallback can flip markers without
  // an explicit phase prop. We schedule a tick at the next un-reached bucket
  // boundary; cheap and bounded (max 4 ticks per generation).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (phase || !startedAt) return;
    const clock = now ?? Date.now;
    const handles: ReturnType<typeof setTimeout>[] = [];
    for (const bucket of PHASE_TIME_BUCKETS) {
      const elapsed = clock() - startedAt;
      const remaining = bucket.thresholdMs - elapsed;
      if (remaining > 0) {
        handles.push(setTimeout(() => setTick((t) => t + 1), remaining + 10));
      }
    }
    return () => {
      for (const h of handles) clearTimeout(h);
    };
  }, [phase, startedAt, now]);

  const current = deriveCurrentPhase({ phase, startedAt, now });

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mdp-progress-title"
      data-testid="mdp-progress-overlay"
      data-current-phase={current}
    >
      <div className={styles.progressCard}>
        <h3 className={styles.progressTitle} id="mdp-progress-title">
          Generating Migration Delivery Plan skeleton
        </h3>
        <p className={styles.progressNote} data-testid="mdp-progress-skeleton-note">
          The skeleton (initiatives, epics, features) generates quickly because
          no detailed stories are produced yet &mdash; you expand epics into
          stories afterwards in the review workspace.
        </p>
        {error && phase === 'error' && (
          <div className={styles.errorBanner} data-testid="mdp-progress-error">
            {error}
          </div>
        )}
        <div className={styles.progressStageList}>
          {PROGRESS_PHASES.map((p) => {
            const phaseIndex = PROGRESS_PHASES.findIndex((x) => x.key === p.key);
            const currentIndex = PROGRESS_PHASES.findIndex(
              (x) => x.key === current
            );
            const isActive = p.key === current;
            const isDone =
              currentIndex >= 0 && phaseIndex < currentIndex && current !== 'error';
            return (
              <div
                key={p.key}
                className={styles.progressStageRow}
                data-testid={`mdp-progress-stage-${p.key}`}
                data-state={isActive ? 'active' : isDone ? 'done' : 'pending'}
              >
                <span
                  className={`${styles.progressStageMarker} ${
                    isActive
                      ? styles.progressStageMarkerActive
                      : isDone
                      ? styles.progressStageMarkerDone
                      : ''
                  }`}
                  aria-hidden="true"
                >
                  {isDone ? '\u2713' : isActive ? '\u2026' : ''}
                </span>
                <span
                  className={`${styles.progressStageLabel} ${
                    isActive ? styles.progressStageLabelActive : ''
                  }`}
                >
                  {p.label}
                </span>
                {isActive && current !== 'complete' && (
                  <span className={styles.spinner} aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// DraftSummary helpers
// ============================================================================

/**
 * Aggregate counts + breakdowns from the raw item list. Used when the LLM
 * does not emit a generationSummary blob (a defensive fallback so the
 * summary surface always renders meaningful numbers even with partial
 * payloads).
 */
export function aggregateItemMetrics(
  items: MigrationBookOfWorkItem[]
): Required<
  Pick<
    MigrationBookOfWorkGenerationSummary,
    | 'initiativeCount'
    | 'epicCount'
    | 'featureCount'
    | 'storyCount'
    | 'totalItemCount'
  >
> & {
  confidenceBreakdown: { high: number; medium: number; low: number };
  readinessBreakdown: {
    ready_for_spec: number;
    needs_focused_context: number;
    needs_user_decision: number;
    blocked: number;
  };
} {
  const result = {
    initiativeCount: 0,
    epicCount: 0,
    featureCount: 0,
    storyCount: 0,
    totalItemCount: 0,
    confidenceBreakdown: { high: 0, medium: 0, low: 0 },
    readinessBreakdown: {
      ready_for_spec: 0,
      needs_focused_context: 0,
      needs_user_decision: 0,
      blocked: 0,
    },
  };
  for (const item of items) {
    result.totalItemCount += 1;
    if (item.type === 'initiative') result.initiativeCount += 1;
    else if (item.type === 'epic') result.epicCount += 1;
    else if (item.type === 'feature') result.featureCount += 1;
    else if (item.type === 'story') result.storyCount += 1;
    if (item.confidence === 'high') result.confidenceBreakdown.high += 1;
    else if (item.confidence === 'medium') result.confidenceBreakdown.medium += 1;
    else if (item.confidence === 'low') result.confidenceBreakdown.low += 1;
    if (item.readiness === 'ready_for_spec')
      result.readinessBreakdown.ready_for_spec += 1;
    else if (item.readiness === 'needs_focused_context')
      result.readinessBreakdown.needs_focused_context += 1;
    else if (item.readiness === 'needs_user_decision')
      result.readinessBreakdown.needs_user_decision += 1;
    else if (item.readiness === 'blocked')
      result.readinessBreakdown.blocked += 1;
  }
  return result;
}

function safeNumber(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

// ============================================================================
// DraftSummary
// ============================================================================

export interface DraftSummaryProps {
  draft: MigrationBookOfWorkDraft;
  /** Invoked when the user clicks "Open hierarchy" (Group 11 review surface). */
  onOpenHierarchy: (draftId: string) => void;
}

export function DraftSummary({ draft, onOpenHierarchy }: DraftSummaryProps) {
  const items = draft.bookOfWork?.items ?? [];
  const fallback = useMemo(() => aggregateItemMetrics(items), [items]);
  // Per-epic expansion progress (Spec 2026-06-11 Two-Phase generation,
  // Task Group 5.7): derived from the `expansionState` each epic carries
  // inside `book_of_work_json`. Legacy full-plan drafts have no tracked
  // epics, so the line is omitted for them.
  const epicExpansion = useMemo(() => {
    const tracked = items.filter(
      (i) => i.type === 'epic' && i.expansionState !== undefined
    );
    return {
      total: tracked.length,
      expanded: tracked.filter((i) => i.expansionState === 'expanded').length,
    };
  }, [items]);
  const gen = draft.generationSummary ?? null;
  const qa = draft.qualityAssessment ?? null;

  const initiativeCount = safeNumber(gen?.initiativeCount, fallback.initiativeCount);
  const epicCount = safeNumber(gen?.epicCount, fallback.epicCount);
  const featureCount = safeNumber(gen?.featureCount, fallback.featureCount);
  const storyCount = safeNumber(gen?.storyCount, fallback.storyCount);
  const totalItemCount = safeNumber(gen?.totalItemCount, fallback.totalItemCount);

  const confidence = {
    high: safeNumber(gen?.confidenceBreakdown?.high, fallback.confidenceBreakdown.high),
    medium: safeNumber(
      gen?.confidenceBreakdown?.medium,
      fallback.confidenceBreakdown.medium
    ),
    low: safeNumber(gen?.confidenceBreakdown?.low, fallback.confidenceBreakdown.low),
  };

  const readiness = {
    ready_for_spec: safeNumber(
      gen?.readinessBreakdown?.ready_for_spec,
      fallback.readinessBreakdown.ready_for_spec
    ),
    needs_focused_context: safeNumber(
      gen?.readinessBreakdown?.needs_focused_context,
      fallback.readinessBreakdown.needs_focused_context
    ),
    needs_user_decision: safeNumber(
      gen?.readinessBreakdown?.needs_user_decision,
      fallback.readinessBreakdown.needs_user_decision
    ),
    blocked: safeNumber(
      gen?.readinessBreakdown?.blocked,
      fallback.readinessBreakdown.blocked
    ),
  };

  const totalConfidence = confidence.high + confidence.medium + confidence.low;
  const highPct = totalConfidence ? (confidence.high / totalConfidence) * 100 : 0;
  const mediumPct = totalConfidence
    ? (confidence.medium / totalConfidence) * 100
    : 0;
  const lowPct = totalConfidence ? (confidence.low / totalConfidence) * 100 : 0;

  // Deterministic findings coverage (Spec 2026-06-11, Task Group 4.4):
  // computed ON READ from the create-time snapshot + the draft's items.
  // Replaces the broken LLM-asserted `gen.findingsAddressed` /
  // `gen.findingsNotAddressed` reads; `null` (legacy / fail-softed
  // drafts) hides BOTH lines entirely (D8 -- hide, don't approximate).
  const findingsCoverage = useMemo(
    () => computeFindingsCoverage(gen, items),
    [gen, items],
  );
  const contractsCovered = safeNumber(gen?.contractsCovered, 0);
  const baselinesCovered = safeNumber(gen?.baselinesCovered, 0);
  const dataEntitiesCovered = safeNumber(gen?.dataEntitiesCovered, 0);
  const infrastructureCovered = safeNumber(gen?.infrastructureCovered, 0);
  const mappingsUsed = safeNumber(gen?.mappingsUsed, 0);

  const majorGaps = (gen?.majorGaps ?? gen?.unresolvedGaps ?? []).slice(0, 5);
  const blockingIssues = gen?.blockingIssues ?? [];

  return (
    <section
      className={styles.summaryRoot}
      data-testid="mdp-draft-summary"
      aria-labelledby="mdp-draft-summary-title"
    >
      <div className={styles.summaryHeader}>
        <h2 className={styles.summaryTitle} id="mdp-draft-summary-title">
          {draft.title || 'Migration Delivery Plan draft'}
        </h2>
        <p className={styles.summarySubtitle}>{draft.summary}</p>
      </div>

      <div className={styles.section} data-testid="mdp-draft-summary-counts">
        <h3 className={styles.sectionTitle}>Item counts</h3>
        <div className={styles.counts}>
          <span className={styles.countBadge}>
            <strong data-testid="mdp-summary-count-initiative">{initiativeCount}</strong>
            Initiatives
          </span>
          <span className={styles.countBadge}>
            <strong data-testid="mdp-summary-count-epic">{epicCount}</strong>
            Epics
          </span>
          <span className={styles.countBadge}>
            <strong data-testid="mdp-summary-count-feature">{featureCount}</strong>
            Features
          </span>
          <span className={styles.countBadge}>
            <strong data-testid="mdp-summary-count-story">{storyCount}</strong>
            Stories
          </span>
          <span className={styles.countBadge}>
            <strong data-testid="mdp-summary-count-total">{totalItemCount}</strong>
            Total
          </span>
        </div>
        {epicExpansion.total > 0 && (
          <p className={styles.subtle} data-testid="mdp-summary-epics-expanded">
            {epicExpansion.expanded} of {epicExpansion.total} epics expanded
            into detailed stories
          </p>
        )}
      </div>

      <div className={styles.section} data-testid="mdp-draft-summary-confidence">
        <h3 className={styles.sectionTitle}>Confidence</h3>
        <div className={styles.breakdownRow}>
          <span
            className={`${styles.breakdownChip} ${styles.confidenceHigh}`}
            data-testid="mdp-summary-confidence-high"
          >
            High: {confidence.high}
          </span>
          <span
            className={`${styles.breakdownChip} ${styles.confidenceMedium}`}
            data-testid="mdp-summary-confidence-medium"
          >
            Medium: {confidence.medium}
          </span>
          <span
            className={`${styles.breakdownChip} ${styles.confidenceLow}`}
            data-testid="mdp-summary-confidence-low"
          >
            Low: {confidence.low}
          </span>
        </div>
        {totalConfidence > 0 && (
          <div className={styles.confidenceBar} aria-hidden="true">
            <span
              className={`${styles.confidenceBarSegment} ${styles.confidenceBarHigh}`}
              style={{ width: `${highPct}%` }}
            />
            <span
              className={`${styles.confidenceBarSegment} ${styles.confidenceBarMedium}`}
              style={{ width: `${mediumPct}%` }}
            />
            <span
              className={`${styles.confidenceBarSegment} ${styles.confidenceBarLow}`}
              style={{ width: `${lowPct}%` }}
            />
          </div>
        )}
      </div>

      <div className={styles.section} data-testid="mdp-draft-summary-readiness">
        <h3 className={styles.sectionTitle}>Readiness</h3>
        <div className={styles.breakdownRow}>
          <span
            className={`${styles.breakdownChip} ${styles.readinessReady}`}
            data-testid="mdp-summary-readiness-ready_for_spec"
          >
            Ready for spec: {readiness.ready_for_spec}
          </span>
          <span
            className={`${styles.breakdownChip} ${styles.readinessFocused}`}
            data-testid="mdp-summary-readiness-needs_focused_context"
          >
            Needs focused context: {readiness.needs_focused_context}
          </span>
          <span
            className={`${styles.breakdownChip} ${styles.readinessDecision}`}
            data-testid="mdp-summary-readiness-needs_user_decision"
          >
            Needs user decision: {readiness.needs_user_decision}
          </span>
          <span
            className={`${styles.breakdownChip} ${styles.readinessBlocked}`}
            data-testid="mdp-summary-readiness-blocked"
          >
            Blocked: {readiness.blocked}
          </span>
        </div>
      </div>

      <div className={styles.section} data-testid="mdp-draft-summary-coverage">
        <h3 className={styles.sectionTitle}>Coverage</h3>
        <div className={styles.breakdownRow}>
          {findingsCoverage && (
            <span
              className={styles.breakdownChip}
              data-testid="mdp-summary-findings-addressed"
            >
              Findings addressed: {findingsCoverage.addressedCount}
            </span>
          )}
          {findingsCoverage && (
            <span
              className={styles.breakdownChip}
              data-testid="mdp-summary-findings-unaddressed"
            >
              Findings unaddressed: {findingsCoverage.notAddressedCount}
            </span>
          )}
          <span className={styles.breakdownChip}>
            Contracts: {contractsCovered}
          </span>
          <span className={styles.breakdownChip}>
            Baselines: {baselinesCovered}
          </span>
          <span className={styles.breakdownChip}>
            Data entities: {dataEntitiesCovered}
          </span>
          <span className={styles.breakdownChip}>
            Infrastructure: {infrastructureCovered}
          </span>
          <span className={styles.breakdownChip}>
            Mappings used: {mappingsUsed}
          </span>
        </div>
      </div>

      {majorGaps.length > 0 && (
        <div className={styles.section} data-testid="mdp-draft-summary-major-gaps">
          <h3 className={styles.sectionTitle}>Major gaps</h3>
          <ul className={styles.gapList}>
            {majorGaps.map((gap, idx) => (
              <li key={`${gap}-${idx}`} data-testid={`mdp-summary-major-gap-${idx}`}>
                {gap}
              </li>
            ))}
          </ul>
        </div>
      )}

      {blockingIssues.length > 0 && (
        <div
          className={styles.blockingCallout}
          data-testid="mdp-draft-summary-blocking-issues"
          role="alert"
        >
          <strong>Blocking issues</strong>
          <ul className={styles.gapList}>
            {blockingIssues.map((issue, idx) => (
              <li
                key={`${issue}-${idx}`}
                data-testid={`mdp-summary-blocking-issue-${idx}`}
              >
                {issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      {qa && (
        <div className={styles.section} data-testid="mdp-draft-summary-quality">
          <h3 className={styles.sectionTitle}>Quality assessment</h3>
          <div className={styles.breakdownRow}>
            {qa.overall && (
              <span className={styles.breakdownChip}>
                Overall: {String(qa.overall.score ?? 'n/a')}
              </span>
            )}
            {qa.initiativeLevel && (
              <span className={styles.breakdownChip}>
                Initiative: {String(qa.initiativeLevel.score ?? 'n/a')}
              </span>
            )}
            {qa.epicLevel && (
              <span className={styles.breakdownChip}>
                Epic: {String(qa.epicLevel.score ?? 'n/a')}
              </span>
            )}
            {qa.featureLevel && (
              <span className={styles.breakdownChip}>
                Feature: {String(qa.featureLevel.score ?? 'n/a')}
              </span>
            )}
            {qa.storyLevel && (
              <span className={styles.breakdownChip}>
                Story: {String(qa.storyLevel.score ?? 'n/a')}
              </span>
            )}
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary}`}
          onClick={() => onOpenHierarchy(draft.id)}
          data-testid="mdp-summary-open-hierarchy"
        >
          Open hierarchy
        </button>
      </div>
    </section>
  );
}

// ============================================================================
// Combined parent surface (progress overlay + summary, glued together)
// ============================================================================

export interface MigrationDeliveryPlanProgressSummaryProps {
  projectId: string;
  /** Wizard-emitted explicit phase (preferred). */
  phase?: ProgressPhase;
  /**
   * Optional timestamp at which generation started; required for the
   * time-bucket fallback and as a guard that we should show the progress
   * overlay at all.
   */
  startedAt?: number;
  /** Optional generation error message. */
  error?: string | null;
  /**
   * Draft id returned by the gateway generate call. When set + phase ===
   * 'complete', the component fetches the draft and renders the summary.
   */
  draftId?: string | null;
  /**
   * Test seam: when provided, the component uses this pre-fetched draft
   * instead of calling the API. This is the path Vitest tests exercise
   * because it removes the fetch race.
   */
  draft?: MigrationBookOfWorkDraft | null;
  /** Test seam: override the draft fetcher. */
  fetchDraft?: typeof fetchMigrationDeliveryPlanDraft;
  /** Routes to the Group 11 hierarchy / review workspace. */
  onOpenHierarchy: (draftId: string) => void;
}

export function MigrationDeliveryPlanProgressSummary({
  projectId,
  phase,
  startedAt,
  error,
  draftId,
  draft: draftProp,
  fetchDraft = fetchMigrationDeliveryPlanDraft,
  onOpenHierarchy,
}: MigrationDeliveryPlanProgressSummaryProps) {
  const [draft, setDraft] = useState<MigrationBookOfWorkDraft | null>(
    draftProp ?? null
  );
  const [draftError, setDraftError] = useState<string | null>(null);

  // Keep the draft state in sync if the parent passes one explicitly (test
  // path / pre-fetched path).
  useEffect(() => {
    if (draftProp) setDraft(draftProp);
  }, [draftProp]);

  // Fetch the draft when generation completes and we have a draftId but no
  // pre-supplied draft. This is the production path.
  useEffect(() => {
    if (draftProp) return;
    if (phase !== 'complete') return;
    if (!draftId) return;
    let cancelled = false;
    (async () => {
      try {
        const fetched = await fetchDraft(projectId, draftId);
        if (cancelled) return;
        setDraft(fetched);
        setDraftError(null);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Failed to load draft';
        setDraftError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, draftId, projectId, fetchDraft, draftProp]);

  // Idle: render nothing (parent decides whether to surface the wizard).
  if (!phase || phase === 'idle') return null;

  // Active generation OR error: show the progress overlay.
  if (phase !== 'complete' || !draft) {
    return (
      <>
        <ProgressOverlay phase={phase} startedAt={startedAt} error={error} />
        {phase === 'complete' && draftError && (
          <div
            className={styles.errorBanner}
            data-testid="mdp-summary-draft-error"
            role="alert"
          >
            Draft loaded but rendering failed: {draftError}
          </div>
        )}
      </>
    );
  }

  // Complete + draft loaded: render the summary surface.
  return <DraftSummary draft={draft} onOpenHierarchy={onOpenHierarchy} />;
}
