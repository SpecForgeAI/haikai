/**
 * Spec 5 (Stored Proc & Function Behaviour Program, 2026-09-09): the
 * GRADUATED proc-parity gate + the shared routine-state resolver.
 *
 * Doctrine (user ruling 2026-09-09, "that is too strict!"): plan START is
 * never blocked by proc parity; the DB plane always runs; the pause before
 * the NEXT plane blocks ONLY routines that plane depends on (a call-site
 * edge from endpoint code — `endpoint_data_effects.path_metadata_json.
 * proc_name`); every other non-reconciled routine is a WARNING with a
 * count; on the FINAL plane (a DB-only migration included) the run
 * completes with findings, never blocked.
 *
 * One state per routine, resolved from (in precedence order): the pack
 * disposition, the review status (an unapproved translation is NOT on the
 * target), a routine-level waiver, the latest parity report (execution
 * purpose preferred, else any), and finally the workbench loop status.
 *
 * NEVER throws: a read failure is a fail-closed `proc_parity_unverified`
 * reason when the next plane is the service plane (its dependents cannot be
 * enumerated); for the final plane it is a warning.
 */

import { logger } from './logger';
import { createTracer } from '../trace';
import { defaultFetchPackView, type PackView } from './migrationDbPackPlanner';
import {
  defaultFetchTranslations,
  defaultFetchRoutineCatalog,
  type TranslationRow,
} from './dbMigrationPack/translations';
import type { RoutineCatalogRow } from './dbMigrationPack/routineInvocationDescriptor';
import {
  fetchLatestProcParityByRoutine,
  listProcParityWaivers,
  type ProcParityWaiverRow,
} from './dbMigrationPack/procWorkbenchClients';
import { fetchProcCallEffects } from './endpointDataEffectsClient';

const trace = createTracer('gateway');

// ============================================================================
// Vocabulary
// ============================================================================

/** The plane that would start next; `null` = the DB plane was the last one. */
export type ProcParityNextPlane = 'service' | 'ui' | null;

export type RoutineParityState =
  | 'reconciled'
  | 'reconciled_with_waivers'
  | 'divergent'
  | 'unverified'
  | 'not_captured'
  | 'not_migrated'
  | 'moved_to_code'
  | 'dropped';

export interface RoutineParityStateRow {
  routine_id: string;
  /** `schema.name` when the catalog knows the routine, else the object ref. */
  routine_name: string;
  /** Lower-case bare name — the waiver target + call-site join key. */
  bare_name: string;
  translation_id: string;
  state: RoutineParityState;
  /** One short honest clause: where the state came from. */
  detail: string;
  /** The parity report behind the state, when one exists. */
  report_id: string | null;
  report_purpose: string | null;
}

export interface LatestProcParityRow {
  id: string;
  status: string;
  purpose: string;
  created_at: string;
  summary_json?: Record<string, unknown> | null;
}

/** Translation kinds that ride the routine catalog (procs + functions). */
export const ROUTINE_TRANSLATION_KINDS = new Set(['stored_procedure', 'function', 'user_defined_function']);

const RECONCILED_STATES = new Set<RoutineParityState>(['reconciled', 'reconciled_with_waivers']);
const OUT_OF_SCOPE_STATES = new Set<RoutineParityState>(['moved_to_code', 'dropped']);

// ============================================================================
// Resolver (pure) — shared by the gate, the DB-plane completion and the
// progress report so every screen tells the same story per routine.
// ============================================================================

export interface RoutineStateInput {
  translations: TranslationRow[];
  routines: RoutineCatalogRow[];
  /** Latest report per routine id, execution purpose (preferred). */
  executionReports: Record<string, LatestProcParityRow>;
  /** Latest report per routine id, any purpose. */
  anyReports: Record<string, LatestProcParityRow>;
  waivers: ProcParityWaiverRow[];
  /**
   * Routine ids with at least one pinned-baseline scenario. `null` = the
   * baseline was not consulted (the gate) — `not_captured` is then folded
   * into `unverified`.
   */
  capturedRoutineIds?: Set<string> | null;
}

export function bareRoutineName(name: string): string {
  const trimmed = name.trim().replace(/[[\]"`]/g, '').toLowerCase();
  const dot = trimmed.lastIndexOf('.');
  return dot >= 0 ? trimmed.slice(dot + 1) : trimmed;
}

function routineWaiverTargets(waivers: ProcParityWaiverRow[]): Set<string> {
  const out = new Set<string>();
  for (const w of waivers) {
    const target = typeof w.target === 'string' ? w.target.trim().toLowerCase() : '';
    if (!target || target.includes('::')) continue;
    out.add(bareRoutineName(target));
  }
  return out;
}

function stateFromReport(row: LatestProcParityRow): { state: RoutineParityState; detail: string } | null {
  const status = (row.status ?? '').toLowerCase();
  if (status === 'clean') return { state: 'reconciled', detail: `parity ${row.purpose} report clean` };
  if (status === 'clean_with_waivers') {
    return { state: 'reconciled_with_waivers', detail: `parity ${row.purpose} report clean with scenario waivers` };
  }
  if (status === 'divergent') return { state: 'divergent', detail: `parity ${row.purpose} report divergent` };
  if (status === 'unverifiable') return { state: 'unverified', detail: `parity ${row.purpose} report unverifiable` };
  return null;
}

function stateFromLoop(loopStatus: string | null | undefined): { state: RoutineParityState; detail: string } {
  const loop = (loopStatus ?? 'idle').toLowerCase();
  if (loop === 'reconciled') return { state: 'reconciled', detail: 'workbench loop reconciled' };
  if (loop === 'exhausted') return { state: 'divergent', detail: 'workbench loop exhausted its attempts without reconciling' };
  if (loop === 'apply_failed') return { state: 'divergent', detail: 'the translated routine failed to apply on the target' };
  if (loop === 'stale') return { state: 'unverified', detail: 'source body changed since the last reconcile (stale)' };
  if (loop === 'blocked_by_callee') return { state: 'unverified', detail: 'waiting on a callee routine' };
  if (loop === 'unverified') return { state: 'unverified', detail: 'no baseline scenarios to verify against' };
  return { state: 'unverified', detail: `workbench loop ${loop} — no parity verdict yet` };
}

/** Resolve one state per routine-linked translation (pure, deterministic). */
export function resolveRoutineParityStates(input: RoutineStateInput): RoutineParityStateRow[] {
  const routineById = new Map<string, RoutineCatalogRow>();
  for (const r of input.routines) routineById.set(r.id, r);
  const waived = routineWaiverTargets(input.waivers);
  const rows: RoutineParityStateRow[] = [];

  for (const t of input.translations) {
    if (!ROUTINE_TRANSLATION_KINDS.has(t.kind) || !t.routine_id) continue;
    const catalog = routineById.get(t.routine_id);
    const routineName = catalog ? `${catalog.schema_name}.${catalog.routine_name}` : t.object_ref;
    const bare = bareRoutineName(catalog ? catalog.routine_name : t.object_ref);
    const base = {
      routine_id: t.routine_id,
      routine_name: routineName,
      bare_name: bare,
      translation_id: t.id,
      report_id: null as string | null,
      report_purpose: null as string | null,
    };

    if (t.disposition !== 'translate') {
      rows.push({
        ...base,
        state: t.disposition === 'drop' ? 'dropped' : 'moved_to_code',
        detail: `dispositioned '${t.disposition}'${t.drop_reason ? `: ${t.drop_reason}` : ''}`,
      });
      continue;
    }
    if (t.review_status !== 'approved') {
      rows.push({
        ...base,
        state: 'not_migrated',
        detail: `translation ${t.review_status ?? 'unreviewed'} — not on the target until approved`,
      });
      continue;
    }
    if (waived.has(bare)) {
      rows.push({ ...base, state: 'reconciled_with_waivers', detail: 'routine-level waiver recorded' });
      continue;
    }
    const report = input.executionReports[t.routine_id] ?? input.anyReports[t.routine_id] ?? null;
    const fromReport = report ? stateFromReport(report) : null;
    if (report && fromReport) {
      rows.push({ ...base, ...fromReport, report_id: report.id, report_purpose: report.purpose });
      continue;
    }
    if (input.capturedRoutineIds && !input.capturedRoutineIds.has(t.routine_id)) {
      rows.push({ ...base, state: 'not_captured', detail: 'no pinned-baseline scenarios for this routine' });
      continue;
    }
    rows.push({ ...base, ...stateFromLoop(t.loop_status) });
  }
  return rows;
}

// ============================================================================
// Reads (DI seam)
// ============================================================================

export interface ProcParityGateReads {
  fetchPackView(projectId: string, architectureId: string): Promise<PackView | null>;
  fetchTranslations(projectId: string, packId: string): Promise<TranslationRow[]>;
  fetchRoutines(projectId: string, architectureId: string): Promise<RoutineCatalogRow[]>;
  fetchLatestReports(
    projectId: string,
    architectureId: string,
    purpose?: string,
  ): Promise<Record<string, LatestProcParityRow>>;
  fetchWaivers(projectId: string): Promise<ProcParityWaiverRow[]>;
  fetchProcCallEffects(
    projectId: string,
    architectureId: string,
  ): Promise<Array<{ path_metadata_json?: Record<string, unknown> | null }>>;
}

export function defaultProcParityGateReads(): ProcParityGateReads {
  return {
    fetchPackView: (p, a) => defaultFetchPackView(p, a),
    fetchTranslations: (p, k) => defaultFetchTranslations(p, k),
    fetchRoutines: (p, a) => defaultFetchRoutineCatalog(p, a),
    fetchLatestReports: (p, a, purpose) => fetchLatestProcParityByRoutine(p, a, purpose ? { purpose } : {}),
    fetchWaivers: (p) => listProcParityWaivers(p),
    fetchProcCallEffects: (p, a) => fetchProcCallEffects(p, a),
  };
}

/**
 * Load everything the resolver needs for an architecture. `null` when the
 * architecture has no DB migration pack (nothing to gate).
 */
export async function loadRoutineParityInputs(
  projectId: string,
  architectureId: string,
  reads: ProcParityGateReads,
): Promise<{ packId: string; input: RoutineStateInput } | null> {
  const packView = await reads.fetchPackView(projectId, architectureId);
  if (!packView) return null;
  const [translations, routines, executionReports, anyReports, waivers] = await Promise.all([
    reads.fetchTranslations(projectId, packView.packId),
    reads.fetchRoutines(projectId, architectureId),
    reads.fetchLatestReports(projectId, architectureId, 'execution'),
    reads.fetchLatestReports(projectId, architectureId),
    reads.fetchWaivers(projectId),
  ]);
  return {
    packId: packView.packId,
    input: { translations, routines, executionReports, anyReports, waivers, capturedRoutineIds: null },
  };
}

/** Bare routine names the service plane calls from endpoint code. */
export async function dependentRoutineNames(
  projectId: string,
  architectureId: string,
  reads: ProcParityGateReads,
): Promise<Set<string>> {
  const effects = await reads.fetchProcCallEffects(projectId, architectureId);
  const names = new Set<string>();
  for (const e of effects) {
    const procName = e.path_metadata_json?.['proc_name'];
    if (typeof procName === 'string' && procName.trim()) names.add(bareRoutineName(procName));
  }
  return names;
}

// ============================================================================
// The gate
// ============================================================================

export interface ProcParityGateReason {
  code: 'proc_parity_failed' | 'proc_parity_unverified';
  message: string;
  workItemId?: string | null;
  /** The routines behind the reason (schema-qualified when known). */
  routines: string[];
}

export interface ProcParityGateCounts {
  routines: number;
  reconciled: number;
  reconciled_with_waivers: number;
  divergent: number;
  unverified: number;
  not_captured: number;
  not_migrated: number;
  out_of_scope: number;
  dependent: number;
  dependent_blocked: number;
}

export interface ProcParityGateResult {
  ok: boolean;
  reasons: ProcParityGateReason[];
  /** Non-blocking findings, one line per state group. */
  warnings: string[];
  counts: ProcParityGateCounts;
  /** Every non-reconciled in-scope routine (the `completed_with_findings` list). */
  findings: Array<{ routine: string; state: RoutineParityState; detail: string; dependent: boolean }>;
  states: RoutineParityStateRow[];
}

function emptyCounts(): ProcParityGateCounts {
  return {
    routines: 0, reconciled: 0, reconciled_with_waivers: 0, divergent: 0, unverified: 0,
    not_captured: 0, not_migrated: 0, out_of_scope: 0, dependent: 0, dependent_blocked: 0,
  };
}

function namesClause(names: string[]): string {
  const shown = names.slice(0, 8).join(', ');
  return names.length > 8 ? `${shown}, …` : shown;
}

/**
 * Evaluate the graduated gate. Pure over the loaded inputs — see
 * {@link evaluateProcParityReadiness} for the reading wrapper.
 */
export function evaluateProcParityGate(args: {
  states: RoutineParityStateRow[];
  dependent: Set<string>;
  nextPlane: ProcParityNextPlane;
}): Omit<ProcParityGateResult, 'ok'> & { ok: boolean } {
  const counts = emptyCounts();
  const reasons: ProcParityGateReason[] = [];
  const warnings: string[] = [];
  const findings: ProcParityGateResult['findings'] = [];
  const blockedFailed: string[] = [];
  const blockedUnverified: string[] = [];
  const warnByState = new Map<RoutineParityState, string[]>();

  for (const row of args.states) {
    if (OUT_OF_SCOPE_STATES.has(row.state)) {
      counts.out_of_scope += 1;
      continue;
    }
    counts.routines += 1;
    counts[row.state as Exclude<RoutineParityState, 'moved_to_code' | 'dropped'>] += 1;
    const dependent = args.nextPlane === 'service' && args.dependent.has(row.bare_name);
    if (dependent) counts.dependent += 1;
    if (RECONCILED_STATES.has(row.state)) continue;
    findings.push({ routine: row.routine_name, state: row.state, detail: row.detail, dependent });
    if (dependent && args.nextPlane !== null) {
      counts.dependent_blocked += 1;
      if (row.state === 'divergent' || row.state === 'not_migrated') blockedFailed.push(row.routine_name);
      else blockedUnverified.push(row.routine_name);
    } else {
      const list = warnByState.get(row.state) ?? [];
      list.push(row.routine_name);
      warnByState.set(row.state, list);
    }
  }

  if (blockedFailed.length > 0) {
    reasons.push({
      code: 'proc_parity_failed',
      message:
        `${blockedFailed.length} stored routine(s) the ${args.nextPlane} plane calls are not reconciled ` +
        `(${namesClause(blockedFailed)}). Re-run the translation loop, or waive an accepted ` +
        'divergence per routine from the pack workbench (a recorded reason is required).',
      routines: blockedFailed,
    });
  }
  if (blockedUnverified.length > 0) {
    reasons.push({
      code: 'proc_parity_unverified',
      message:
        `${blockedUnverified.length} stored routine(s) the ${args.nextPlane} plane calls have no parity ` +
        `verdict (${namesClause(blockedUnverified)}). Capture + pin a proc baseline covering them and ` +
        'reconcile, or waive per routine with a recorded reason.',
      routines: blockedUnverified,
    });
  }
  const labels: Record<RoutineParityState, string> = {
    reconciled: 'reconciled',
    reconciled_with_waivers: 'reconciled with waivers',
    divergent: 'divergent',
    unverified: 'unverified',
    not_captured: 'not captured in the pinned baseline',
    not_migrated: 'not migrated (translation not approved)',
    moved_to_code: 'moved to code',
    dropped: 'dropped',
  };
  for (const [state, names] of warnByState) {
    warnings.push(
      `${names.length} stored routine(s) ${labels[state]} (${namesClause(names)})` +
        (args.nextPlane === null
          ? ' — recorded as findings on the run; nothing blocks.'
          : ` — not called by the ${args.nextPlane} plane, so nothing blocks; they stay findings.`),
    );
  }
  return { ok: reasons.length === 0, reasons, warnings, counts, findings, states: args.states };
}

/**
 * Read + evaluate. NEVER throws. `nextPlane === null` = final plane: the
 * result never carries block reasons (findings + warnings only).
 */
export async function evaluateProcParityReadiness(params: {
  projectId: string;
  architectureId: string | null;
  nextPlane: ProcParityNextPlane;
  reads?: ProcParityGateReads;
}): Promise<ProcParityGateResult> {
  const reads = params.reads ?? defaultProcParityGateReads();
  let result: ProcParityGateResult = {
    ok: true, reasons: [], warnings: [], counts: emptyCounts(), findings: [], states: [],
  };
  let actual = '';
  let readError = false;
  try {
    if (!params.architectureId) {
      actual = 'no current architecture id — nothing to gate';
    } else {
      const loaded = await loadRoutineParityInputs(params.projectId, params.architectureId, reads);
      if (!loaded) {
        actual = 'no DB migration pack — nothing to gate';
      } else {
        const states = resolveRoutineParityStates(loaded.input);
        const dependent =
          params.nextPlane === 'service'
            ? await dependentRoutineNames(params.projectId, params.architectureId, reads)
            : new Set<string>();
        result = evaluateProcParityGate({ states, dependent, nextPlane: params.nextPlane });
        const c = result.counts;
        actual =
          `next_plane=${params.nextPlane ?? 'none'} routines=${c.routines} reconciled=${c.reconciled}` +
          `+${c.reconciled_with_waivers}w divergent=${c.divergent} unverified=${c.unverified}` +
          ` not_captured=${c.not_captured} not_migrated=${c.not_migrated} dependent=${c.dependent}` +
          ` dependent_blocked=${c.dependent_blocked}`;
      }
    }
  } catch (err) {
    readError = true;
    const msg = err instanceof Error ? err.message.slice(0, 200) : 'unknown';
    if (params.nextPlane === 'service') {
      result = {
        ...result,
        ok: false,
        reasons: [{
          code: 'proc_parity_unverified',
          message: `Could not read the proc-parity state (fail-closed for the service plane): ${msg}`,
          routines: [],
        }],
      };
    } else {
      result = { ...result, warnings: [`Proc-parity state could not be read (${msg}); recorded as a finding.`] };
    }
    actual = `read error: ${msg}`;
    logger.warn('[diag-gateway] migration_proc_parity_gate read_failed', {
      projectId: params.projectId,
      error: msg,
    });
  }

  trace.predicate(
    'PROC.GATE.01', 'graduated proc-parity gate evaluated honestly (blocks only next-plane dependents)',
    !readError,
    'plan start never blocked; block reasons only for dependent routines; final plane = findings',
    `verdict=${result.ok ? 'ok' : 'blocked'} ${actual}` +
      (result.reasons.length > 0 ? ` codes=[${result.reasons.map((r) => r.code).join(',')}]` : '') +
      (result.warnings.length > 0 ? ` warnings=${result.warnings.length}` : ''),
    { project: params.projectId, arch: params.architectureId ?? undefined },
  );
  return result;
}
