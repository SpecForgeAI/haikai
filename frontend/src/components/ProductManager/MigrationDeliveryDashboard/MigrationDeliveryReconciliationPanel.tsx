/**
 * MigrationDeliveryReconciliationPanel
 *
 * Spec: 2026-06-14 Migration Reconciliation + Bug Loop (Spec 4 of 4) --
 * Task Group 5. Extended 2026-06-14 Non-Reconciling Work at Reconcile Time
 * (D6) -- Task Group 5: the `expected_net_new` recognised badge + matched
 * work-item reference. Extended 2026-06-16 Reconcile-Time Determinism &
 * Volatile-Value Handling -- Task Group 5: the volatile JSON-Pointer path list
 * + `volatility_source` badge on the break detail, the `info` down-rank marker,
 * the in-UI declare-volatile control, and the `expected_volatile` run-summary
 * count alongside `expected_net_new`.
 *
 * The run-scoped reconciliation REVIEW surface on the Migration Delivery
 * Dashboard, sitting directly below the Spec-3 Migrate / run-progress panel
 * (`MigrationDeliveryMigratePanel`) once a run exists. Modelled on the existing
 * breaks UI (`DriftReportTab` -- the break == drifting `api_behaviour_diff_item`
 * table) and the Spec-2/3 result-banner idioms.
 *
 * Responsibilities:
 *   1. LIST the run's breaks (`getReconciliationBreaks`): per break the source
 *      operation/area (method/path/summary from `detail_json` +
 *      `source_baseline_item_id`), the disposition status, the attempt/round
 *      counter, and the circuit-breaker / needs-human ESCALATED badge. The
 *      break == drifting `api_behaviour_diff_item` equivalence is made explicit
 *      in the copy (UI keeps the "drift" wording per the existing convention).
 *   2. The HUMAN GATE: the user SELECTS breaks (checkboxes) and either
 *      (a) "Send as bugs" (`sendReconciliationBreaksAsBugs`) -- creates a bug for
 *      the external implementation/verification service to fix -- or (b) assigns
 *      a terminal disposition (`disposeReconciliationBreaks`:
 *      accepted | wont_report | intentional_deviation) -- records an
 *      intentional / accepted / deferred deviation that will NOT be sent. The
 *      current-state oracle is UNCHANGED either way (CD-A). Nothing auto-sends.
 *      After either action the list refreshes.
 *   3. Re-reconcile OUTCOMES: `fixed_confirmed` (resolved), `still_broken`
 *      (looped, with attempt count), `circuit_broken_escalated` (terminal
 *      needs-human) render with distinct visual states; escalated breaks also
 *      collect into a needs-review queue.
 *   4. The `needs_target_credentials` PAUSE state (CD-2): when the run is waiting
 *      on creds (restart / long-running run), surface it with a register action
 *      (`registerTargetCredentials`; `type:'none'` for a like-for-like
 *      unauthenticated target) so the run can re-enter. Creds are held in-memory
 *      for the run only -- NEVER persisted, NEVER logged.
 *   5. (D6) An auto-dispositioned `expected_net_new` break -- the gateway
 *      post-diff pass recognised a `target_only` diff as an ADDITIVE net_new
 *      endpoint -- renders VISIBLY RECOGNISED ("Expected -- net_new endpoint"
 *      badge + the matched work-item reference read from
 *      `detail_json.net_new_match`), NOT hidden, while staying overridable so a
 *      human can re-classify a wrongly-matched endpoint via the existing
 *      disposition path (D7).
 *   6. (2026-06-16) A break carrying volatility metadata -- the validation
 *      service tagged tolerated value/order diff entries with a `volatilitySource`
 *      and the gateway auto-dispositioned it to `expected_volatile` (terminal,
 *      overridable) or down-ranked it to `info` (a heuristic-only guess; stays
 *      open) -- shows its full normalised JSON-Pointer path list (collapsible if
 *      large) plus a plain `volatility_source` label/badge in the break detail,
 *      reusing the existing metadata styling. A reviewer can DECLARE further
 *      volatile paths on the operation inline (`declareVolatilePaths`); the
 *      declaration applies retroactively to the run and the list refreshes so the
 *      re-disposition shows. The reconcile run summary DISPLAYS the
 *      `expected_volatile` count alongside `expected_net_new` (displayed count
 *      only -- no threshold / alert).
 *
 * Presentational: every client is a test-seam prop (defaults to the real api
 * client) so the dashboard test renders deterministically + offline. The panel
 * owns no routing and never imports a context hook.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getReconciliationBreaks as defaultGetBreaks,
  sendReconciliationBreaksAsBugs as defaultSendBreaks,
  disposeReconciliationBreaks as defaultDisposeBreaks,
  declareVolatilePaths as defaultDeclareVolatile,
  registerTargetCredentials as defaultRegisterCreds,
  BREAK_DISPOSITION,
  TERMINAL_BREAK_STATES,
  BREAK_TYPE_ORDER,
  type BreakType,
  type MigrationReconciliationBreakDto,
  type ReconciliationDisposition,
} from '../../../api/migrationReconciliationApi';
import styles from './MigrationDeliveryDashboard.module.css';

/** Above this path count the volatile-path list collapses behind a toggle. */
const VOLATILE_PATHS_COLLAPSE_THRESHOLD = 8;

// ============================================================================
// Helpers
// ============================================================================

/** Pull the source operation + summary off a break's inline `detail_json`. */
function breakDetail(b: MigrationReconciliationBreakDto): {
  method: string;
  path: string;
  summary: string;
  /** The canonical `<METHOD> <path>` operation key the gateway matches on. */
  operation: string;
} {
  const d = (b.detail_json ?? {}) as Record<string, unknown>;
  const method = typeof d.method === 'string' ? d.method : '';
  const path = typeof d.path === 'string' ? d.path : '';
  // Prefer the canonical operation key the gateway wrote (`<METHOD> <path>`);
  // fall back to a reconstruction from method/path. The gateway matches the
  // declare operation case-insensitively, so either form is accepted.
  const operation =
    typeof d.operation === 'string' && d.operation.trim().length > 0
      ? d.operation
      : `${method} ${path}`.trim();
  return {
    method,
    path,
    operation,
    summary:
      typeof d.summary === 'string'
        ? d.summary
        : typeof d.diff === 'string'
          ? d.diff
          : '',
  };
}

/**
 * The matched work-item reference (D6) written by the gateway auto-disposition
 * pass onto `detail_json.net_new_match` when a `target_only` diff was uniquely
 * recognised as an additive net_new endpoint. Returns null unless the break was
 * auto-recognised (`outcome === 'auto_recognised'`).
 */
function netNewMatch(b: MigrationReconciliationBreakDto): {
  title: string;
  workItemId: string;
  operation: string;
} | null {
  const d = (b.detail_json ?? {}) as Record<string, unknown>;
  const m = d.net_new_match;
  if (!m || typeof m !== 'object') return null;
  const match = m as Record<string, unknown>;
  if (match.outcome !== 'auto_recognised') return null;
  return {
    title:
      typeof match.matched_work_item_title === 'string'
        ? match.matched_work_item_title
        : '',
    workItemId:
      typeof match.matched_work_item_id === 'string'
        ? match.matched_work_item_id
        : '',
    operation:
      typeof match.matched_operation === 'string'
        ? match.matched_operation
        : '',
  };
}

/**
 * Read the volatility metadata off a break's `detail_json` (2026-06-16). The
 * gateway copies the validation-service diff_item's
 * `body_diff_json = { entries, volatility_sources? }` verbatim onto
 * `detail_json.body_diff_json` at break-creation; the per-entry tag is
 * `entries[].volatilitySource` (present only on TOLERATED value/order entries)
 * and the volatile JSON-Pointer paths are those entries' `path` values. The
 * DISTINCT trust tags are surfaced on `body_diff_json.volatility_sources`.
 *
 * Returns the volatile path list (de-duplicated, normalised JSON-Pointers) plus
 * the distinct `volatility_source` tags. Tolerates both the nested
 * `body_diff_json` shape and snake/camel field names (belt-and-braces for the
 * snake_case AMS wire vs the gateway-native camel). Empty arrays mean the break
 * carries no volatility metadata (strict / `null` envelope) -- nothing renders.
 */
function readBreakVolatility(b: MigrationReconciliationBreakDto): {
  paths: string[];
  sources: string[];
} {
  const d = (b.detail_json ?? {}) as Record<string, unknown>;
  const bodyDiff = (d.body_diff_json ?? d.bodyDiffJson ?? null) as
    | Record<string, unknown>
    | null;

  const rawSources =
    (bodyDiff?.volatility_sources as unknown) ??
    (bodyDiff?.volatilitySources as unknown) ??
    (d.volatility_sources as unknown) ??
    (d.volatilitySources as unknown) ??
    null;
  const sources: string[] = Array.isArray(rawSources)
    ? (rawSources.filter((s) => typeof s === 'string') as string[])
    : [];

  // The volatile paths == the `path` of any entry carrying a volatilitySource
  // tag (the comparator only tags tolerated VALUE/ORDER entries). De-duplicate
  // while preserving first-seen order.
  const seen = new Set<string>();
  const paths: string[] = [];
  const entries = (bodyDiff?.entries as unknown) ?? null;
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (!e || typeof e !== 'object') continue;
      const entry = e as Record<string, unknown>;
      const tag = entry.volatilitySource ?? entry.volatility_source ?? null;
      const path = entry.path;
      if (typeof tag === 'string' && typeof path === 'string' && !seen.has(path)) {
        seen.add(path);
        paths.push(path);
      }
    }
  }

  return { paths, sources };
}

/** The valid per-dimension break types (in canonical display order). */
const VALID_BREAK_TYPES = new Set<BreakType>(BREAK_TYPE_ORDER);

/**
 * Read the derived per-dimension break_type SET off a break's `detail_json`
 * (Spec 2026-06-17 Reconcile Full-Response Fidelity -- R1 + R2). The gateway
 * writes `detail_json.break_types` (a list of `status` / `headers` /
 * `body-shape` / `body-value` / `ordering`) plus the per-dimension
 * `header_classification`. A single diff_item still yields ONE break; this set
 * just tags WHICH dimensions diverged so we can render distinct badges.
 *
 * GRACEFUL DEGRADE: a legacy break (pre-2026-06-17), or a source_only /
 * target_only diff, carries no `break_types`. We return an EMPTY array and the
 * caller falls back to the existing drift-summary rendering -- never a crash.
 * Unknown / malformed entries are filtered out; the order follows
 * `BREAK_TYPE_ORDER` so the badges render deterministically regardless of the
 * wire order.
 */
function readBreakTypes(b: MigrationReconciliationBreakDto): BreakType[] {
  const d = (b.detail_json ?? {}) as Record<string, unknown>;
  const raw = (d.break_types ?? d.breakTypes ?? null) as unknown;
  if (!Array.isArray(raw)) return [];
  const present = new Set<BreakType>();
  for (const t of raw) {
    if (typeof t === 'string' && VALID_BREAK_TYPES.has(t as BreakType)) {
      present.add(t as BreakType);
    }
  }
  return BREAK_TYPE_ORDER.filter((t) => present.has(t));
}

/** Short human label for a per-dimension break type. */
function breakTypeLabel(t: BreakType): string {
  switch (t) {
    case 'status':
      return 'Status';
    case 'headers':
      return 'Headers';
    case 'body-shape':
      return 'Body shape';
    case 'body-value':
      return 'Body value';
    case 'ordering':
      return 'Ordering';
    default:
      return t;
  }
}

/**
 * Read the tolerated allowlisted header NAMES the gateway's `expected_volatile`
 * auto-disposition pass recorded on `detail_json.volatility_match`
 * (`tolerated_header_names`). Surfaced in the volatility detail the same way the
 * volatile body paths are -- so the reviewer sees exactly which header VALUES
 * were tolerated as volatile. Empty array when the break carries none. Tolerates
 * both snake_case (AMS wire) and camelCase (gateway-native) field names.
 */
function readToleratedHeaderNames(b: MigrationReconciliationBreakDto): string[] {
  const d = (b.detail_json ?? {}) as Record<string, unknown>;
  const vm = (d.volatility_match ?? d.volatilityMatch ?? null) as
    | Record<string, unknown>
    | null;
  const raw =
    (vm?.tolerated_header_names as unknown) ??
    (vm?.toleratedHeaderNames as unknown) ??
    null;
  return Array.isArray(raw)
    ? (raw.filter((n) => typeof n === 'string') as string[])
    : [];
}

/**
 * The stateful-sequence diagnostic types the reconcile sub-runner emits
 * (Spec 2026-06-18 Stateful Sequence Scenarios -- Spec D, Task Group 3).
 */
const SEQUENCE_DIAGNOSTIC_TYPES = new Set<string>([
  'sequence_skipped',
  'sequence_setup_failed',
  'sequence_cleanup_failed',
  'sequence_residual_pollution',
]);

/** Short human label for a sequence diagnostic type. */
function sequenceDiagnosticLabel(type: string): string {
  switch (type) {
    case 'sequence_skipped':
      return 'Sequence skipped (no mutating confirmation)';
    case 'sequence_setup_failed':
      return 'Sequence setup failed';
    case 'sequence_cleanup_failed':
      return 'Sequence cleanup failed';
    case 'sequence_residual_pollution':
      return 'Residual pollution';
    default:
      return type;
  }
}

/**
 * Read the stateful-sequence signals off a break's `detail_json` (Spec D,
 * Task Group 4). A sequence break is the sequence's ACT step fully diffed, so
 * it pairs + classifies exactly like a single-shot break; this reader surfaces
 * (a) WHETHER the break came from a sequence act step and (b) the sequence
 * diagnostics (skipped / setup-failed / cleanup-failed / residual-pollution)
 * plus the cleanup / residual-pollution flags so the panel can render them
 * distinctly. Read DEFENSIVELY, tolerating snake/camel field names and both
 * a `{ diagnostic_type, message }` list and a bare string list. A break with
 * NO sequence fields (every single-shot break + legacy break) returns the
 * empty/false shape and nothing extra renders -- graceful degrade, no crash.
 */
function readSequenceDetail(b: MigrationReconciliationBreakDto): {
  fromSequence: boolean;
  cleanupFailed: boolean;
  residualPollution: boolean;
  diagnostics: { type: string; message: string }[];
} {
  const d = (b.detail_json ?? {}) as Record<string, unknown>;
  const fromSequence =
    d.from_sequence === true ||
    d.fromSequence === true ||
    d.is_sequence === true ||
    d.isSequence === true ||
    d.sequence_act === true ||
    d.sequenceAct === true;
  const cleanupFailed =
    d.sequence_cleanup_failed === true || d.sequenceCleanupFailed === true;
  const residualPollution =
    d.sequence_residual_pollution === true ||
    d.sequenceResidualPollution === true;

  const rawDiags =
    (d.sequence_diagnostics as unknown) ??
    (d.sequenceDiagnostics as unknown) ??
    null;
  const diagnostics: { type: string; message: string }[] = [];
  if (Array.isArray(rawDiags)) {
    for (const entry of rawDiags) {
      if (typeof entry === 'string') {
        if (SEQUENCE_DIAGNOSTIC_TYPES.has(entry)) {
          diagnostics.push({ type: entry, message: '' });
        }
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      const type =
        typeof obj.diagnostic_type === 'string'
          ? obj.diagnostic_type
          : typeof obj.diagnosticType === 'string'
            ? obj.diagnosticType
            : typeof obj.type === 'string'
              ? obj.type
              : '';
      if (!type) continue;
      const message =
        typeof obj.message === 'string' ? obj.message : '';
      diagnostics.push({ type, message });
    }
  }
  return { fromSequence, cleanupFailed, residualPollution, diagnostics };
}

/** Human label for a disposition status. */
function dispositionLabel(status: string | null | undefined): string {
  switch (status) {
    case BREAK_DISPOSITION.OPEN:
      return 'Open';
    case BREAK_DISPOSITION.SENT_AS_BUG:
      return 'Sent as bug';
    case BREAK_DISPOSITION.FIXED_CONFIRMED:
      return 'Fixed (confirmed)';
    case BREAK_DISPOSITION.STILL_BROKEN:
      return 'Still broken';
    case BREAK_DISPOSITION.CIRCUIT_BROKEN_ESCALATED:
      return 'Escalated — needs review';
    case BREAK_DISPOSITION.ACCEPTED:
      return 'Accepted';
    case BREAK_DISPOSITION.WONT_REPORT:
      return "Won't report";
    case BREAK_DISPOSITION.INTENTIONAL_DEVIATION:
      return 'Intentional deviation';
    case BREAK_DISPOSITION.EXPECTED_NET_NEW:
      return 'Expected — net_new endpoint';
    case BREAK_DISPOSITION.EXPECTED_VOLATILE:
      return 'Expected — volatile';
    case BREAK_DISPOSITION.INFO:
      return 'Info — heuristic (open)';
    default:
      return status ?? 'unknown';
  }
}

/**
 * Map a disposition status to a distinct badge class. The three re-reconcile
 * outcomes get their own purpose-built classes (resolved-green /
 * still-looping-amber / escalated-red); the D6 auto-recognised additive
 * net_new endpoint gets its own recognised-state class; the 2026-06-16
 * `expected_volatile` reuses the same recognised-state palette (machine-set,
 * overridable) and `info` reuses the neutral chip; the other states reuse the
 * dashboard's existing chip palette. No NEW colour system is introduced.
 */
function dispositionBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case BREAK_DISPOSITION.FIXED_CONFIRMED:
      return styles.badgeFixedConfirmed ?? styles.badgeSaved ?? styles.badge;
    case BREAK_DISPOSITION.STILL_BROKEN:
      return styles.badgeStillBroken ?? styles.badgeSpecWarning ?? styles.badge;
    case BREAK_DISPOSITION.CIRCUIT_BROKEN_ESCALATED:
      return styles.badgeCircuitBroken ?? styles.badgeSpecFailed ?? styles.badge;
    case BREAK_DISPOSITION.EXPECTED_NET_NEW:
      return styles.badgeExpectedNetNew ?? styles.badgeNetNew ?? styles.badge;
    case BREAK_DISPOSITION.EXPECTED_VOLATILE:
      return styles.badgeExpectedNetNew ?? styles.badgeNetNew ?? styles.badge;
    case BREAK_DISPOSITION.SENT_AS_BUG:
      return styles.badgeSpecGenerated ?? styles.badge;
    case BREAK_DISPOSITION.ACCEPTED:
    case BREAK_DISPOSITION.WONT_REPORT:
    case BREAK_DISPOSITION.INTENTIONAL_DEVIATION:
      return styles.badgeNotSaved ?? styles.badge;
    case BREAK_DISPOSITION.INFO:
    default:
      return styles.badge;
  }
}

/** A break is terminal (not sent, not re-run) iff in a terminal state. */
function isTerminal(b: MigrationReconciliationBreakDto): boolean {
  return TERMINAL_BREAK_STATES.includes(b.disposition_status ?? '');
}

/**
 * A break is auto-recognised additive net_new (D6) iff the gateway set its
 * disposition to `expected_net_new`. It is terminal in the gateway/idempotent
 * sense, but MACHINE-set, so the review surface keeps it overridable (D7).
 */
function isAutoRecognisedNetNew(b: MigrationReconciliationBreakDto): boolean {
  return b.disposition_status === BREAK_DISPOSITION.EXPECTED_NET_NEW;
}

/**
 * A break is auto-recognised volatile (2026-06-16) iff the gateway set its
 * disposition to `expected_volatile`. Terminal in the gateway/idempotent sense
 * but MACHINE-set, so the review surface keeps it overridable -- a human can
 * re-classify a wrongly-tolerated value back to `open` via the existing
 * disposition path.
 */
function isAutoRecognisedVolatile(b: MigrationReconciliationBreakDto): boolean {
  return b.disposition_status === BREAK_DISPOSITION.EXPECTED_VOLATILE;
}

/**
 * A break is SELECTABLE for the human gate iff it is not terminal, OR it is a
 * machine-set auto-recognised state (`expected_net_new` / `expected_volatile`)
 * -- the latter stay selectable so a human may re-classify a wrong recognition
 * via the existing disposition path. `info` is non-terminal so it is selectable
 * already.
 */
function isSelectable(b: MigrationReconciliationBreakDto): boolean {
  return (
    !isTerminal(b) || isAutoRecognisedNetNew(b) || isAutoRecognisedVolatile(b)
  );
}

/** A break is escalated (needs human) iff circuit-broken or flagged. */
function isEscalated(b: MigrationReconciliationBreakDto): boolean {
  return (
    Boolean(b.circuit_broken) ||
    Boolean(b.needs_human) ||
    b.disposition_status === BREAK_DISPOSITION.CIRCUIT_BROKEN_ESCALATED
  );
}

// ============================================================================
// Props
// ============================================================================

export interface MigrationDeliveryReconciliationPanelProps {
  projectId: string;
  /** The migration-execution run whose breaks this surface reviews. */
  runId: string;
  /**
   * The run's current status. When `needs_target_credentials`, the panel
   * surfaces the creds-pause (CD-2) with a register action.
   */
  runStatus?: string | null;
  /** Orchestration scope: organisation name (threaded on the bug send). */
  company: string;
  /** Orchestration scope: product name (threaded on the bug send). */
  project: string;
  /** Test seam: override the breaks read. Defaults to the real client. */
  fetchBreaksFn?: typeof defaultGetBreaks;
  /** Test seam: override the bug send. Defaults to the real client. */
  sendBreaksFn?: typeof defaultSendBreaks;
  /** Test seam: override the dispose. Defaults to the real client. */
  disposeBreaksFn?: typeof defaultDisposeBreaks;
  /** Test seam: override the declare-volatile. Defaults to the real client. */
  declareVolatileFn?: typeof defaultDeclareVolatile;
  /** Test seam: override the target-credentials register. */
  registerCredsFn?: typeof defaultRegisterCreds;
}

// ============================================================================
// Volatility detail sub-component (the volatile-path list + source badge)
// ============================================================================

/**
 * Render a break's volatile JSON-Pointer path list + plain `volatility_source`
 * badge(s) plus the inline declare-volatile control, reusing the existing
 * metadata styling. Collapses the path list behind a toggle above the threshold.
 *
 * The path list + source badge render only when the break already carries
 * volatility metadata (or is the `info` down-rank). The DECLARE control renders
 * whenever the break is `declarable` (a non-human-terminal break a reviewer can
 * still act on) -- a reviewer needs to be able to declare a path that is NOT yet
 * tolerated. When the break has neither volatility metadata nor is declarable,
 * nothing renders.
 */
const BreakVolatilityDetail: React.FC<{
  breakRow: MigrationReconciliationBreakDto;
  /** Whether the inline declare-volatile control should be offered. */
  declarable: boolean;
  busy: boolean;
  onDeclare: (operation: string, paths: string[]) => void;
}> = ({ breakRow, declarable, busy, onDeclare }) => {
  const id = breakRow.id ?? '';
  const { paths, sources } = useMemo(
    () => readBreakVolatility(breakRow),
    [breakRow],
  );
  // Spec 2026-06-17 (R-volatile audit): the allowlisted header NAMES whose VALUE
  // changes the gateway tolerated as volatile, recorded on
  // detail_json.volatility_match. Surfaced alongside the volatile body paths.
  const toleratedHeaderNames = useMemo(
    () => readToleratedHeaderNames(breakRow),
    [breakRow],
  );
  const { operation } = breakDetail(breakRow);
  const isInfo = breakRow.disposition_status === BREAK_DISPOSITION.INFO;

  const [expanded, setExpanded] = useState(false);
  const [declareInput, setDeclareInput] = useState('');

  const collapsible = paths.length > VOLATILE_PATHS_COLLAPSE_THRESHOLD;
  const visiblePaths =
    collapsible && !expanded
      ? paths.slice(0, VOLATILE_PATHS_COLLAPSE_THRESHOLD)
      : paths;

  // The volatility METADATA block (path list + source badge + the info marker)
  // shows when the break actually carries volatility info or is down-ranked.
  const hasVolatility =
    paths.length > 0 ||
    sources.length > 0 ||
    toleratedHeaderNames.length > 0 ||
    isInfo;
  // The DECLARE control shows whenever the reviewer can still act AND there is a
  // concrete operation to declare against.
  const showDeclare = declarable && operation.length > 0;

  const handleDeclareSubmit = useCallback(() => {
    const declared = declareInput
      .split(/[\n,]/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (declared.length === 0 || !operation) return;
    onDeclare(operation, declared);
    setDeclareInput('');
  }, [declareInput, operation, onDeclare]);

  if (!hasVolatility && !showDeclare) return null;

  return (
    <div
      className={styles.needsAttentionReason}
      data-testid={`mdd-recon-break-volatility-${id}`}
    >
      {hasVolatility && (
        <div>
          {isInfo
            ? 'Down-ranked to info — justified only by a conservative heuristic (stays open for review).'
            : 'Tolerated as expected non-determinism on the volatile path(s) below — the oracle is unchanged.'}
        </div>
      )}

      {/* The plain volatility_source label/badge(s) -- no new colour system. */}
      {sources.length > 0 && (
        <div data-testid={`mdd-recon-break-volatility-sources-${id}`}>
          {sources.map((src) => (
            <span
              key={src}
              className={styles.badge}
              data-testid={`mdd-recon-break-volatility-source-${id}-${src}`}
              data-volatility-source={src}
            >
              {src}
            </span>
          ))}
        </div>
      )}

      {/* The full normalised JSON-Pointer volatile-path list (collapsible). */}
      {paths.length > 0 && (
        <ul
          className={styles.defineTestsBannerList}
          data-testid={`mdd-recon-break-volatility-paths-${id}`}
        >
          {visiblePaths.map((p) => (
            <li
              key={p}
              data-testid={`mdd-recon-break-volatility-path-${id}-${p}`}
            >
              <code>{p}</code>
            </li>
          ))}
        </ul>
      )}
      {/* Spec 2026-06-17 (R-volatile): the tolerated allowlisted header NAMES
          whose VALUE changes were auto-tolerated as volatile -- shown the same
          way as the volatile body paths so the reviewer sees exactly which
          header values were tolerated (header presence/absence is NEVER
          tolerated and would have kept the break open). */}
      {toleratedHeaderNames.length > 0 && (
        <div data-testid={`mdd-recon-break-tolerated-headers-${id}`}>
          <div>Tolerated volatile header value(s):</div>
          <ul className={styles.defineTestsBannerList}>
            {toleratedHeaderNames.map((h) => (
              <li
                key={h}
                data-testid={`mdd-recon-break-tolerated-header-${id}-${h}`}
              >
                <code>{h}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {collapsible && (
        <button
          type="button"
          className={styles.headerNavLink}
          data-testid={`mdd-recon-break-volatility-toggle-${id}`}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? 'Show fewer paths'
            : `Show all ${paths.length} volatile paths`}
        </button>
      )}

      {/* The in-UI declare-volatile control (same surface as the override). */}
      {showDeclare && (
        <div
          className={styles.needsAttentionActions}
          data-testid={`mdd-recon-break-declare-${id}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <input
            type="text"
            className={styles.testFilterToggle}
            data-testid={`mdd-recon-break-declare-input-${id}`}
            placeholder="/path/to/declare, /another"
            value={declareInput}
            disabled={busy}
            onChange={(e) => setDeclareInput(e.target.value)}
            aria-label={`Declare volatile JSON-Pointer paths on ${operation}`}
          />
          <button
            type="button"
            className={styles.bulkButton}
            data-testid={`mdd-recon-break-declare-button-${id}`}
            disabled={busy || declareInput.trim().length === 0}
            onClick={handleDeclareSubmit}
            title="Declare these JSON-Pointer paths volatile on this operation. Applied retroactively to this run; the oracle is unchanged."
          >
            Declare volatile
          </button>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Sequence detail sub-component (Spec D, Task Group 4)
// ============================================================================

/**
 * Render a sequence break's distinct signals, reusing the existing metadata
 * styling: a "from sequence act step" badge, a residual-pollution / cleanup
 * warning, and the list of sequence diagnostics (skipped / setup-failed /
 * cleanup-failed / residual-pollution) read off the break detail. Renders
 * nothing when the break carries no sequence signals (every single-shot
 * break) -- graceful degrade, NO new colour system, NO charting widget.
 */
const BreakSequenceDetail: React.FC<{
  breakRow: MigrationReconciliationBreakDto;
}> = ({ breakRow }) => {
  const id = breakRow.id ?? '';
  const { fromSequence, cleanupFailed, residualPollution, diagnostics } =
    useMemo(() => readSequenceDetail(breakRow), [breakRow]);

  // Nothing sequence-related on this break -> render exactly as a single-shot
  // break (no extra rows).
  if (
    !fromSequence &&
    !cleanupFailed &&
    !residualPollution &&
    diagnostics.length === 0
  ) {
    return null;
  }

  const hasPollution = residualPollution || cleanupFailed;

  return (
    <div
      className={styles.needsAttentionReason}
      data-testid={`mdd-recon-break-sequence-${id}`}
      data-from-sequence={fromSequence ? 'true' : 'false'}
    >
      {fromSequence && (
        <div>
          <span
            className={styles.badge}
            data-testid={`mdd-recon-break-sequence-badge-${id}`}
          >
            From sequence act step
          </span>{' '}
          This break is the ACT step of a pinned stateful sequence (setup -&gt;
          act -&gt; cleanup); the setup steps were asserted and the act response
          fully diffed.
        </div>
      )}

      {hasPollution && (
        <div
          className={styles.badgeRow}
          data-testid={`mdd-recon-break-sequence-pollution-${id}`}
          style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}
        >
          {cleanupFailed && (
            <span
              className={`${styles.badge} ${styles.badgeSpecWarning ?? styles.badge}`}
              data-testid={`mdd-recon-break-sequence-cleanup-failed-${id}`}
              title="A cleanup step failed (best-effort); the created resource may be left in place."
            >
              Cleanup failed
            </span>
          )}
          {residualPollution && (
            <span
              className={`${styles.badge} ${styles.badgeSpecWarning ?? styles.badge}`}
              data-testid={`mdd-recon-break-sequence-residual-pollution-${id}`}
              title="A created resource was left on the target (bounded, flagged residual pollution -- never pretended clean)."
            >
              Residual pollution
            </span>
          )}
        </div>
      )}

      {diagnostics.length > 0 && (
        <ul
          className={styles.defineTestsBannerList}
          data-testid={`mdd-recon-break-sequence-diagnostics-${id}`}
        >
          {diagnostics.map((diag, di) => (
            <li
              key={`${diag.type}-${di}`}
              data-testid={`mdd-recon-break-sequence-diagnostic-${id}-${diag.type}`}
              data-diagnostic-type={diag.type}
            >
              <strong>{sequenceDiagnosticLabel(diag.type)}</strong>
              {diag.message ? `: ${diag.message}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ============================================================================
// Component
// ============================================================================

export const MigrationDeliveryReconciliationPanel: React.FC<
  MigrationDeliveryReconciliationPanelProps
> = ({
  projectId,
  runId,
  runStatus,
  company,
  project,
  fetchBreaksFn = defaultGetBreaks,
  sendBreaksFn = defaultSendBreaks,
  disposeBreaksFn = defaultDisposeBreaks,
  declareVolatileFn = defaultDeclareVolatile,
  registerCredsFn = defaultRegisterCreds,
}) => {
  const [breaks, setBreaks] = useState<MigrationReconciliationBreakDto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [disposition, setDisposition] = useState<ReconciliationDisposition>(
    BREAK_DISPOSITION.ACCEPTED,
  );
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credsRegistered, setCredsRegistered] = useState<boolean>(false);

  const needsCredentials =
    (runStatus ?? '') === 'needs_target_credentials' && !credsRegistered;

  // ----- Breaks read ------------------------------------------------------
  const loadBreaks = useCallback(async () => {
    try {
      const rows = await fetchBreaksFn(projectId, runId);
      setBreaks(rows);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to read reconciliation breaks',
      );
    }
  }, [fetchBreaksFn, projectId, runId]);

  useEffect(() => {
    void loadBreaks();
  }, [loadBreaks]);

  // Drop any now-unselectable ids from the selection whenever breaks change
  // (an auto-recognised net_new / volatile break stays selectable for override).
  useEffect(() => {
    setSelected((prev) => {
      const stillSelectable = new Set(
        breaks.filter((b) => b.id && isSelectable(b)).map((b) => b.id as string),
      );
      const next = new Set<string>();
      for (const id of prev) if (stillSelectable.has(id)) next.add(id);
      return next;
    });
  }, [breaks]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const hasSelection = selectedIds.length > 0;

  // ----- Run-summary disposition counts (displayed only -- no threshold) ----
  const expectedNetNewCount = useMemo(
    () =>
      breaks.filter(
        (b) => b.disposition_status === BREAK_DISPOSITION.EXPECTED_NET_NEW,
      ).length,
    [breaks],
  );
  const expectedVolatileCount = useMemo(
    () =>
      breaks.filter(
        (b) => b.disposition_status === BREAK_DISPOSITION.EXPECTED_VOLATILE,
      ).length,
    [breaks],
  );

  // ----- The human gate: Send selected breaks as ONE bug report -----------
  const handleSend = useCallback(async () => {
    if (!hasSelection || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await sendBreaksFn(projectId, runId, {
        company,
        project,
        breakIds: selectedIds,
      });
      if (result.status === 'sent') {
        setNotice(
          `Sent ${result.breakCount} break${result.breakCount === 1 ? '' : 's'} as bug ${result.bugId}. ` +
            'The external service will investigate and redeploy; the oracle is unchanged.',
        );
        setSelected(new Set());
        await loadBreaks();
      } else if (result.status === 'no_breaks') {
        setError('None of the selected breaks could be sent (already terminal).');
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send the bug report');
    } finally {
      setBusy(false);
    }
  }, [
    hasSelection,
    busy,
    sendBreaksFn,
    projectId,
    runId,
    company,
    project,
    selectedIds,
    loadBreaks,
  ]);

  // ----- Dispose selected breaks (terminal; oracle unchanged -- CD-A) ------
  const handleDispose = useCallback(async () => {
    if (!hasSelection || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await disposeBreaksFn(projectId, runId, {
        breakIds: selectedIds,
        disposition,
      });
      setNotice(
        `Disposed ${result.count} break${result.count === 1 ? '' : 's'} as "${dispositionLabel(disposition)}". ` +
          'This records an intentional / accepted deviation — it is NOT sent as a bug and the oracle is unchanged.',
      );
      setSelected(new Set());
      await loadBreaks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dispose the breaks');
    } finally {
      setBusy(false);
    }
  }, [
    hasSelection,
    busy,
    disposeBreaksFn,
    projectId,
    runId,
    selectedIds,
    disposition,
    loadBreaks,
  ]);

  // ----- Declare volatile paths (in-UI, retroactive -- 2026-06-16, Q3) ------
  const handleDeclareVolatile = useCallback(
    async (operation: string, paths: string[]) => {
      if (busy || !operation || paths.length === 0) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await declareVolatileFn(projectId, runId, {
          operation,
          declaredPaths: paths,
        });
        setNotice(
          `Declared ${paths.length} volatile path${paths.length === 1 ? '' : 's'} on "${operation}". ` +
            `Re-evaluated ${result.reEvaluated} open break${result.reEvaluated === 1 ? '' : 's'}: ` +
            `${result.expectedVolatile} now expected (volatile), ${result.info} down-ranked to info. ` +
            'Applied retroactively to this run; the oracle is unchanged.',
        );
        await loadBreaks();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to declare the volatile paths',
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, declareVolatileFn, projectId, runId, loadBreaks],
  );

  // ----- Register target credentials (CD-2 pause re-entry) ----------------
  const handleRegisterCreds = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // type:'none' -- the common like-for-like unauthenticated target. The
      // creds bundle is held in-memory for the run only, never persisted.
      await registerCredsFn(projectId, runId, { type: 'none' });
      setCredsRegistered(true);
      setNotice(
        'Target credentials registered for this run. Reconciliation can re-enter ' +
          'on the next deploy callback.',
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to register target credentials',
      );
    } finally {
      setBusy(false);
    }
  }, [busy, registerCredsFn, projectId, runId]);

  // ----- Derived views ----------------------------------------------------
  const needsReviewBreaks = useMemo(
    () => breaks.filter((b) => isEscalated(b)),
    [breaks],
  );

  return (
    <section className={styles.hierarchySection} data-testid="mdd-recon-panel">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h2 className={styles.sectionTitle}>Reconciliation review</h2>
        <button
          type="button"
          className={styles.headerNavLink}
          data-testid="mdd-recon-refresh"
          onClick={() => void loadBreaks()}
        >
          Refresh
        </button>
      </div>

      <p className={styles.needsAttentionReason} data-testid="mdd-recon-intro">
        Each break is a drifting operation: the migrated target diverged from the
        pinned current-state baseline (the oracle) for the same request. Select
        breaks and either send them as a bug for the external service to fix, or
        dispose them as an intentional / accepted deviation (not sent — the oracle
        is never changed). A break recognised as a deliberately-added net_new
        endpoint is auto-marked "Expected — net_new endpoint"; a break that
        diverged only on legitimately-volatile paths is auto-marked "Expected —
        volatile". You can still re-classify either if the recognition was wrong.
      </p>

      {/* ----- Run summary: displayed disposition counts (no threshold) ----- */}
      <div
        className={styles.needsAttentionReason}
        data-testid="mdd-recon-run-summary"
      >
        <span data-testid="mdd-recon-summary-expected-net-new">
          Expected — net_new: {expectedNetNewCount}
        </span>{' '}
        <span data-testid="mdd-recon-summary-expected-volatile">
          Expected — volatile: {expectedVolatileCount}
        </span>
      </div>

      {/* ----- needs_target_credentials pause (CD-2) ----- */}
      {needsCredentials && (
        <div
          className={styles.warningBanner}
          role="alert"
          data-testid="mdd-recon-needs-creds"
        >
          <span>
            This run is paused: it needs target credentials before it can
            reconcile against the deployed target. Credentials are held in memory
            for the run only and are never stored.
          </span>
          <button
            type="button"
            className={styles.bulkButton}
            data-testid="mdd-recon-register-creds-button"
            disabled={busy}
            onClick={() => void handleRegisterCreds()}
          >
            Register target credentials (no auth)
          </button>
        </div>
      )}

      {/* ----- Error / notice banners ----- */}
      {error && (
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="mdd-recon-error"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          className={styles.bulkInFlightBanner}
          role="status"
          data-testid="mdd-recon-notice"
        >
          {notice}
        </div>
      )}

      {/* ----- The human gate: select -> Send / Dispose ----- */}
      <div
        className={styles.needsAttentionActions}
        data-testid="mdd-recon-actions"
        style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
      >
        <span data-testid="mdd-recon-selected-count">
          {selectedIds.length} selected
        </span>
        <button
          type="button"
          className={styles.bulkButton}
          data-testid="mdd-recon-send-button"
          disabled={!hasSelection || busy}
          onClick={() => void handleSend()}
          title="Send the selected breaks as one bug report for the external service to fix. Nothing auto-sends."
        >
          Send as bugs
        </button>
        <label className={styles.testFilterToggle}>
          Disposition:{' '}
          <select
            data-testid="mdd-recon-disposition-select"
            value={disposition}
            onChange={(e) =>
              setDisposition(e.target.value as ReconciliationDisposition)
            }
          >
            <option value={BREAK_DISPOSITION.ACCEPTED}>Accepted</option>
            <option value={BREAK_DISPOSITION.WONT_REPORT}>Won&apos;t report</option>
            <option value={BREAK_DISPOSITION.INTENTIONAL_DEVIATION}>
              Intentional deviation
            </option>
          </select>
        </label>
        <button
          type="button"
          className={styles.bulkButton}
          data-testid="mdd-recon-dispose-button"
          disabled={!hasSelection || busy}
          onClick={() => void handleDispose()}
          title="Record the selected breaks as an intentional / accepted deviation. NOT sent as a bug; the oracle is unchanged."
        >
          Dispose (won&apos;t send)
        </button>
      </div>

      {/* ----- Breaks table (break == drifting api_behaviour_diff_item) ----- */}
      {breaks.length === 0 ? (
        <div className={styles.needsAttentionReason} data-testid="mdd-recon-empty">
          No reconciliation breaks recorded for this run.
        </div>
      ) : (
        <table
          className={styles.reconBreaksTable}
          data-testid="mdd-recon-breaks-table"
        >
          <thead>
            <tr>
              <th />
              <th>Source operation</th>
              <th>Drift summary</th>
              <th>Disposition</th>
              <th>Attempts</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {breaks.map((b) => {
              const id = b.id ?? '';
              const { method, path, summary } = breakDetail(b);
              const terminal = isTerminal(b);
              const escalated = isEscalated(b);
              const match = netNewMatch(b);
              // Spec 2026-06-17 (R1 + R2): the derived per-dimension break_type
              // set off detail_json. Empty for a legacy break / source_only /
              // target_only diff -> the badges row is omitted and only the
              // existing drift summary renders (graceful degrade, no crash).
              const breakTypes = readBreakTypes(b);
              return (
                <tr key={id} data-testid={`mdd-recon-break-row-${id}`}>
                  <td>
                    <input
                      type="checkbox"
                      data-testid={`mdd-recon-select-${id}`}
                      checked={selected.has(id)}
                      disabled={!isSelectable(b) || busy}
                      onChange={() => toggleSelect(id)}
                      aria-label={`Select break ${method} ${path}`}
                    />
                  </td>
                  <td data-testid={`mdd-recon-break-op-${id}`}>
                    <strong>{method}</strong> {path}
                  </td>
                  <td>
                    {/* Spec 2026-06-17 (R1 + R2): one small badge per drifted
                        response dimension (status / headers / body-shape /
                        body-value / ordering) read off detail_json.break_types,
                        reusing the existing chip palette -- NO new colour system,
                        NO charting widget. Omitted entirely when the set is empty
                        (legacy break / source_only / target_only) so the existing
                        drift summary stands alone. */}
                    {breakTypes.length > 0 && (
                      <div
                        className={styles.badgeRow}
                        data-testid={`mdd-recon-break-types-${id}`}
                        style={{
                          display: 'flex',
                          gap: 4,
                          flexWrap: 'wrap',
                          marginBottom: 4,
                        }}
                      >
                        {breakTypes.map((t) => (
                          <span
                            key={t}
                            className={styles.badge}
                            data-testid={`mdd-recon-break-type-${id}-${t}`}
                            data-break-type={t}
                            title={`This break diverged on the ${breakTypeLabel(
                              t,
                            )} dimension.`}
                          >
                            {breakTypeLabel(t)}
                          </span>
                        ))}
                      </div>
                    )}
                    {summary || '—'}
                    {/* D6: the matched work-item reference for an auto-recognised
                        additive net_new endpoint -- surfaced inline, NOT hidden. */}
                    {match && (
                      <div
                        className={styles.needsAttentionReason}
                        data-testid={`mdd-recon-break-net-new-match-${id}`}
                      >
                        Recognised as net_new — matched work item{' '}
                        <strong>{match.title || match.workItemId}</strong>
                        {match.workItemId ? ` (${match.workItemId})` : ''}
                        {match.operation ? ` via ${match.operation}` : ''}.
                      </div>
                    )}
                    {/* 2026-06-16: the volatile JSON-Pointer path list +
                        volatility_source badge + the in-UI declare control. */}
                    <BreakVolatilityDetail
                      breakRow={b}
                      declarable={isSelectable(b)}
                      busy={busy}
                      onDeclare={(op, paths) =>
                        void handleDeclareVolatile(op, paths)
                      }
                    />
                    {/* Spec D (2026-06-18): a sequence break is the act step
                        fully diffed -- surface that it came from a sequence,
                        plus the cleanup / residual-pollution flags + the
                        sequence diagnostics read off the break detail. Renders
                        nothing for a single-shot break (graceful degrade). */}
                    <BreakSequenceDetail breakRow={b} />
                  </td>
                  <td>
                    <span
                      className={`${styles.badge} ${dispositionBadgeClass(b.disposition_status)}`}
                      data-testid={`mdd-recon-break-disposition-${id}`}
                      data-state={b.disposition_status ?? ''}
                    >
                      {dispositionLabel(b.disposition_status)}
                    </span>
                  </td>
                  <td data-testid={`mdd-recon-break-attempt-${id}`}>
                    {b.attempt_count ?? 0}
                  </td>
                  <td>
                    {escalated ? (
                      <span
                        className={`${styles.badge} ${styles.badgeNeedsAttention ?? styles.badge}`}
                        data-testid={`mdd-recon-break-escalated-${id}`}
                        title="The bounded re-run round tripped (or a failed/rejected outcome arrived); needs a human disposition."
                      >
                        Escalated
                      </span>
                    ) : (
                      <span className={styles.badge}>
                        {terminal ? 'Terminal' : 'Active'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* ----- Needs-review queue (escalated breaks awaiting a disposition) ----- */}
      {needsReviewBreaks.length > 0 && (
        <div data-testid="mdd-recon-needs-review-queue">
          <h3 className={styles.sectionTitle}>
            Needs review ({needsReviewBreaks.length})
          </h3>
          <ul className={styles.defineTestsBannerList}>
            {needsReviewBreaks.map((b) => {
              const id = b.id ?? '';
              const { method, path } = breakDetail(b);
              return (
                <li key={id} data-testid={`mdd-recon-needs-review-item-${id}`}>
                  <strong>{method}</strong> {path} — attempt {b.attempt_count ?? 0}
                  {b.error_detail ? ` (${b.error_detail})` : ''}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
};

export default MigrationDeliveryReconciliationPanel;
