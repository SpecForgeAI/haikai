/**
 * dbMigrationPackWorkbench
 *
 * Spec: 2026-09-09 Stored Proc & Function Behaviour Program — Spec 4
 * (Translation Workbench Loop).
 *
 * Pure derivations shared by the Translations-tab workbench table and the
 * reviewer's "Behaviour verdict" section, so a row and its open reviewer can
 * never disagree about what state a routine is in.
 *
 * Honesty rules baked in here (design decisions 12–17):
 *   - every non-reconciled routine gets a NAMED state, never a blank cell;
 *   - `unverified` (no scenarios in the pinned baseline) is its own state
 *     with a "waiver needed" review path — it is NEVER shown as reconciled;
 *   - `blocked_by_callee` names the callees it is waiting on (dependency
 *     order, decision 15) and is NOT a divergence;
 *   - the verdict text is read from `verdict_json` only; nothing is inferred
 *     or invented when the server has not said it yet.
 */

import type {
  DbMigrationPackTranslationDto,
  DbMigrationPackTranslationVerdict,
} from '../../../api/dbMigrationPackApi';
import { DB_PACK_TRANSLATION_ATTEMPT_CAP } from '../../../api/dbMigrationPackApi';

/** Filter buckets on the workbench toolbar. */
export type DbMigrationPackWorkbenchFilter =
  | 'needs-you'
  | 'reconciled'
  | 'blocked'
  | 'unverified'
  | 'all';

export const WORKBENCH_FILTERS: Array<{
  value: DbMigrationPackWorkbenchFilter;
  label: string;
}> = [
  { value: 'needs-you', label: 'Needs you' },
  { value: 'reconciled', label: 'Reconciled' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'unverified', label: 'Unverified' },
  { value: 'all', label: 'All' },
];

/** Loop states that mean a human has to act (the "Needs you" bucket). */
const NEEDS_YOU = new Set(['exhausted', 'apply_failed', 'unverified', 'stale']);

/** Loop states in which the routine is actively moving (no user action). */
const IN_FLIGHT_STATES = new Set([
  'queued',
  'translating',
  'applying',
  'reconciling',
]);

/**
 * Is this row managed by the workbench loop? Only routine rows carried by the
 * routine catalog are — views, jobs and check constraints keep the original
 * simple rendering, so the marker is the server-supplied routine identity /
 * loop state rather than the object kind (which pre-dates the program).
 */
export function isWorkbenchRow(row: DbMigrationPackTranslationDto): boolean {
  return (
    (typeof row.routine_id === 'string' && row.routine_id.length > 0) ||
    (typeof row.loop_status === 'string' && row.loop_status.length > 0)
  );
}

function verdictOf(
  row: DbMigrationPackTranslationDto,
): DbMigrationPackTranslationVerdict {
  return row.verdict_json ?? {};
}

/** `proc` / `func` short kind for the routine column. */
export function routineKindLabel(row: DbMigrationPackTranslationDto): string {
  const kind = String(row.kind ?? '');
  if (kind === 'stored_procedure' || kind === 'procedure' || kind === 'proc') {
    return 'proc';
  }
  if (kind === 'function' || kind === 'scalar_function' || kind === 'func') {
    return 'func';
  }
  return kind || '—';
}

/** Human loop-status text; `blocked_by_callee` names its callees. */
export function loopStatusLabel(row: DbMigrationPackTranslationDto): string {
  const status = String(row.loop_status ?? '');
  const verdict = verdictOf(row);
  switch (status) {
    case 'reconciled':
      return 'reconciled';
    case 'exhausted':
      return 'exhausted';
    case 'apply_failed':
      return 'apply failed';
    case 'unverified':
      return 'translated, unverified';
    case 'dispositioned':
      return 'dispositioned';
    case 'blocked_by_callee': {
      const callees = verdict.blocked_by ?? [];
      return callees.length > 0
        ? `blocked by ${callees.join(', ')}`
        : 'blocked by a callee';
    }
    case 'stale':
      return row.stale_reason ? `stale — ${row.stale_reason}` : 'stale';
    case 'idle':
      return 'not started';
    case '':
      return 'not started';
    default:
      return status.replace(/_/g, ' ');
  }
}

/** Scenario count for the routine ("none" when the loop never ran). */
export function scenariosLabel(row: DbMigrationPackTranslationDto): string {
  const status = String(row.loop_status ?? '');
  if (status === 'dispositioned') return 'none';
  const verdict = verdictOf(row);
  if (typeof verdict.scenarios === 'number') return String(verdict.scenarios);
  if (status === 'unverified') return '0';
  return '—';
}

/** Attempts spent, shown as `n of cap` once the cap has been reached. */
export function attemptsLabel(row: DbMigrationPackTranslationDto): string {
  const status = String(row.loop_status ?? '');
  if (status === 'dispositioned') return 'none';
  const current = row.current_attempt_no;
  if (typeof current !== 'number' || current <= 0) return '—';
  if (status === 'exhausted') {
    const cap = verdictOf(row).attempts ?? DB_PACK_TRANSLATION_ATTEMPT_CAP;
    return `${current} of ${cap}`;
  }
  return String(current);
}

/**
 * Verdict text: "match N of N" when reconciled, "divergent N" when the loop
 * gave up, the disposition when dispositioned away, and an honest "none"
 * whenever no behaviour evidence exists at all.
 */
export function verdictLabel(row: DbMigrationPackTranslationDto): string {
  const status = String(row.loop_status ?? '');
  const verdict = verdictOf(row);
  if (status === 'dispositioned') return String(row.disposition ?? 'none');
  if (status === 'unverified') return 'no scenarios';
  if (status === 'reconciled') {
    const total = verdict.scenarios;
    const failing = verdict.scenarios_failing ?? 0;
    if (typeof total === 'number') {
      return `match ${total - failing} of ${total}`;
    }
    return 'reconciled';
  }
  const failing = verdict.scenarios_failing;
  if (typeof failing === 'number' && failing > 0) return `divergent ${failing}`;
  if (status === 'apply_failed' || status === 'blocked_by_callee') return 'none';
  if (verdict.reason) return String(verdict.reason);
  return 'none';
}

/** The Review column's state for a routine row. */
export type DbMigrationPackWorkbenchReviewState =
  | 'approved'
  | 'approve'
  | 'needs-you'
  | 'waiver-needed'
  | 'waiting'
  | 'running'
  | 'none';

export function reviewState(
  row: DbMigrationPackTranslationDto,
): DbMigrationPackWorkbenchReviewState {
  const status = String(row.loop_status ?? '');
  if (row.review_status === 'approved') return 'approved';
  if (status === 'dispositioned') return 'none';
  if (status === 'reconciled') return 'approve';
  if (status === 'unverified') return 'waiver-needed';
  if (status === 'blocked_by_callee') return 'waiting';
  if (IN_FLIGHT_STATES.has(status)) return 'running';
  if (NEEDS_YOU.has(status)) return 'needs-you';
  return 'none';
}

export const REVIEW_STATE_LABEL: Record<
  DbMigrationPackWorkbenchReviewState,
  string
> = {
  approved: 'approved',
  approve: 'Approve',
  'needs-you': 'needs you',
  'waiver-needed': 'waiver needed',
  waiting: 'waiting',
  running: 'running',
  none: 'none',
};

/**
 * Filter predicate. Non-workbench rows (views, jobs, check constraints) are
 * only ever shown under "All" — the four behaviour buckets are about routines.
 */
export function matchesWorkbenchFilter(
  row: DbMigrationPackTranslationDto,
  filter: DbMigrationPackWorkbenchFilter,
): boolean {
  if (filter === 'all') return true;
  if (!isWorkbenchRow(row)) return false;
  const status = String(row.loop_status ?? '');
  switch (filter) {
    case 'needs-you':
      return NEEDS_YOU.has(status);
    case 'reconciled':
      return status === 'reconciled';
    case 'blocked':
      return status === 'blocked_by_callee';
    case 'unverified':
      return status === 'unverified';
    default:
      return true;
  }
}
