/**
 * Translation workbench wiring (Stored Proc & Function Behaviour Program,
 * Spec 4, 2026-09-09): builds the loop inputs from the pack's translation
 * rows + the routine catalog + the pinned proc baseline + waivers, and
 * implements the loop's deps against the real downstreams:
 *
 *   translate  → `draftAndJudgeObject` (contract + evidence rung + guidance)
 *   apply      → AMVS routine-apply (DROP IF EXISTS + CREATE, one txn)
 *   reconcile  → AMVS proc-parity (ALL scenarios of the routine) → report
 *   persist    → AMS translation attempts + sparse translation patches
 *
 * Fire-and-forget from the routes; one loop per pack at a time; progress in
 * `workbenchRegistry`.
 */

import { getConfig } from '../../config';
import { logger } from '../logger';
import { createTracer } from '../../trace';
import { getMigrationPlanLlmPool } from '../llmConcurrencyPool';
import type { LlmCallerFn } from '../migrationBookOfWorkHandler';
import type { TargetDbSecret } from '../migrationTargetCredentialsStore';
import { loadPairRuleset } from '../../migrationPairRules';
import {
  defaultFetchPackRow,
  defaultFetchRoutineCatalog,
  defaultFetchTranslations,
  defaultPatchTranslation,
  draftAndJudgeObject,
  type RoutineContract,
  type TranslationRow,
} from './translations';
import { deriveRoutineDescriptor, renderRoutineContract, type RoutineCatalogRow, type RoutineDescriptor } from './routineInvocationDescriptor';
import {
  applyRoutineViaAmvs,
  createTranslationAttempt,
  failingScenariosOf,
  fetchProcParityReport,
  listProcParityWaivers,
  listTranslationAttempts,
  runProcParityViaAmvs,
  toRunnerWaivers,
} from './procWorkbenchClients';
import { loopConfigFromEnv, runTranslationReconcileLoop, type LoopConfig, type LoopDeps, type LoopResult, type LoopRoutine } from './translationReconcileLoop';

const trace = createTracer('gateway');

export interface WorkbenchRunState {
  packId: string;
  startedAt: number;
  phase: string;
  routines: number;
  done: number;
  events: Array<{ at: string; routine: string; phase: string; detail?: string }>;
  result: LoopResult | null;
  error: string | null;
}

export const workbenchRegistry = new Map<string, WorkbenchRunState>();

export interface ProcBaselineItemLite {
  routine_id: string;
  scenario_name: string;
  inputs_json: Array<{ name: string; value: unknown; is_null?: boolean }>;
}

async function amsGet<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (response.status === 404) return null;
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`AMS GET ${url} failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** The pinned CURRENT proc baseline's items (fail-soft → []). */
export async function fetchPinnedProcBaselineItems(projectId: string, architectureId: string): Promise<{ baselineId: string | null; items: ProcBaselineItemLite[] }> {
  const base = `${getConfig().architectureModelServiceBaseUrl}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/proc-behaviour`;
  try {
    const pinned = await amsGet<{ id: string }>(`${base}/baselines/pinned?kind=current`);
    if (!pinned) return { baselineId: null, items: [] };
    const items = (await amsGet<ProcBaselineItemLite[]>(`${base}/baselines/${encodeURIComponent(pinned.id)}/items`)) ?? [];
    return { baselineId: pinned.id, items: Array.isArray(items) ? items : [] };
  } catch (error) {
    logger.warn(`[diag-gateway] proc_workbench baseline_fetch_failed reason=${error instanceof Error ? error.message : String(error)}`);
    return { baselineId: null, items: [] };
  }
}

export interface WorkbenchDeps {
  fetchPack?: typeof defaultFetchPackRow;
  fetchTranslations?: typeof defaultFetchTranslations;
  fetchRoutineCatalog?: typeof defaultFetchRoutineCatalog;
  fetchBaselineItems?: typeof fetchPinnedProcBaselineItems;
  fetchWaivers?: typeof listProcParityWaivers;
  listAttempts?: typeof listTranslationAttempts;
  patchTranslation?: typeof defaultPatchTranslation;
  createAttempt?: typeof createTranslationAttempt;
  draftAndJudge?: typeof draftAndJudgeObject;
  applyRoutine?: typeof applyRoutineViaAmvs;
  runParity?: typeof runProcParityViaAmvs;
  fetchReport?: typeof fetchProcParityReport;
  callLlm?: LlmCallerFn;
  loadRuleset?: typeof loadPairRuleset;
  loop?: typeof runTranslationReconcileLoop;
  config?: Partial<LoopConfig>;
}

export interface WorkbenchRunArgs {
  projectId: string;
  packId: string;
  targetDb: TargetDbSecret;
  /** Scope: translation ids (default = every translate-dispositioned routine with a catalog row). */
  translationIds?: string[] | null;
  /** Reviewer guidance per translation id (retry with guidance). */
  guidanceByTranslation?: Record<string, string>;
  upstreamDivergentTables?: string[];
}

/** Build the loop inputs (exported for tests). */
export function buildLoopRoutines(args: {
  rows: TranslationRow[];
  routines: RoutineCatalogRow[];
  descriptors: Map<string, { descriptor: RoutineDescriptor; routine: RoutineCatalogRow }>;
  baselineItems: ProcBaselineItemLite[];
  waivers: ReturnType<typeof toRunnerWaivers>;
  priorAttempts: Map<string, number>;
  guidanceByTranslation: Record<string, string>;
  scope: Set<string> | null;
}): LoopRoutine[] {
  const itemsByRoutine = new Map<string, number>();
  for (const it of args.baselineItems) itemsByRoutine.set(it.routine_id, (itemsByRoutine.get(it.routine_id) ?? 0) + 1);
  const out: LoopRoutine[] = [];
  for (const row of args.rows) {
    if (row.kind !== 'stored_procedure' || row.disposition !== 'translate' || !row.routine_id) continue;
    if (args.scope && !args.scope.has(row.id)) continue;
    if (row.pipeline_state === 'needs_manual') continue;
    const entry = args.descriptors.get(row.routine_id);
    if (!entry) continue;
    const name = entry.routine.routine_name.toLowerCase();
    out.push({
      translationId: row.id,
      translationKey: row.translation_key,
      objectRef: row.object_ref,
      routineName: name,
      routineId: row.routine_id,
      sourceBody: row.source_body ?? entry.routine.full_body ?? '',
      procCalls: (entry.routine.proc_calls_json ?? []).map((c) => c.toLowerCase()),
      descriptor: entry.descriptor,
      baselineScenarioCount: itemsByRoutine.get(row.routine_id) ?? 0,
      priorAttempts: args.priorAttempts.get(row.id) ?? 0,
      guidance: args.guidanceByTranslation[row.id] ?? null,
      waived: args.waivers.some((w) => w.scope === 'routine' && w.routine === name),
    });
  }
  return out;
}

/** Run the workbench loop for a pack (returns when the loop finishes). */
export async function runWorkbenchLoop(args: WorkbenchRunArgs, deps: WorkbenchDeps = {}): Promise<LoopResult> {
  const fetchPack = deps.fetchPack ?? defaultFetchPackRow;
  const fetchTranslations = deps.fetchTranslations ?? defaultFetchTranslations;
  const fetchRoutineCatalog = deps.fetchRoutineCatalog ?? defaultFetchRoutineCatalog;
  const fetchBaselineItems = deps.fetchBaselineItems ?? fetchPinnedProcBaselineItems;
  const fetchWaivers = deps.fetchWaivers ?? listProcParityWaivers;
  const listAttempts = deps.listAttempts ?? listTranslationAttempts;
  const patchTranslation = deps.patchTranslation ?? defaultPatchTranslation;
  const createAttempt = deps.createAttempt ?? createTranslationAttempt;
  const draftAndJudge = deps.draftAndJudge ?? draftAndJudgeObject;
  const applyRoutine = deps.applyRoutine ?? applyRoutineViaAmvs;
  const runParity = deps.runParity ?? runProcParityViaAmvs;
  const fetchReport = deps.fetchReport ?? fetchProcParityReport;
  const loadRuleset = deps.loadRuleset ?? loadPairRuleset;
  const loop = deps.loop ?? runTranslationReconcileLoop;
  const config = loopConfigFromEnv(deps.config ?? {});
  const { projectId, packId } = args;
  const state: WorkbenchRunState = { packId, startedAt: Date.now(), phase: 'loading', routines: 0, done: 0, events: [], result: null, error: null };
  workbenchRegistry.set(packId, state);
  try {
    const pack = await fetchPack(projectId, packId);
    const architectureId = typeof pack.architecture_id === 'string' ? pack.architecture_id : null;
    if (!architectureId) throw new Error('The pack carries no architecture_id.');
    const manifest = (pack.manifest_json ?? null) as Record<string, unknown> | null;
    const ruleset = loadRuleset();
    const [rows, routines, baseline, waiverRows] = await Promise.all([
      fetchTranslations(projectId, packId),
      fetchRoutineCatalog(projectId, architectureId),
      fetchBaselineItems(projectId, architectureId),
      fetchWaivers(projectId),
    ]);
    const waivers = toRunnerWaivers(waiverRows);
    const descriptors = new Map<string, { descriptor: RoutineDescriptor; routine: RoutineCatalogRow }>();
    for (const r of routines) {
      if (r.routine_kind !== 'procedure' && r.routine_kind !== 'function') continue;
      descriptors.set(r.id, { descriptor: deriveRoutineDescriptor(r, ruleset, { captureRefined: baseline.items.some((it) => it.routine_id === r.id) }), routine: r });
    }
    const scope = args.translationIds && args.translationIds.length > 0 ? new Set(args.translationIds) : null;
    const priorAttempts = new Map<string, number>();
    for (const row of rows) {
      if (scope && !scope.has(row.id)) continue;
      if (row.kind !== 'stored_procedure' || !row.routine_id) continue;
      const attempts = await listAttempts(projectId, packId, row.id);
      priorAttempts.set(row.id, attempts.reduce((m, a) => Math.max(m, a.attempt_no), 0));
    }
    const loopRoutines = buildLoopRoutines({ rows, routines, descriptors, baselineItems: baseline.items, waivers, priorAttempts, guidanceByTranslation: args.guidanceByTranslation ?? {}, scope });
    state.routines = loopRoutines.length;
    state.phase = 'looping';
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const descriptorsByName: Record<string, RoutineDescriptor> = {};
    for (const [, v] of descriptors) descriptorsByName[v.routine.routine_name.toLowerCase()] = v.descriptor;
    const inputsByScenario = (routineId: string): Map<string, ProcBaselineItemLite['inputs_json']> =>
      new Map(baseline.items.filter((it) => it.routine_id === routineId).map((it) => [it.scenario_name, it.inputs_json]));
    const callLlm = deps.callLlm;
    const llmPool = getMigrationPlanLlmPool();

    const loopDeps: LoopDeps = {
      translate: async ({ routine, attemptNo, evidence, guidance }) => {
        const row = rowById.get(routine.translationId) as TranslationRow;
        const entry = descriptors.get(routine.routineId) as { descriptor: RoutineDescriptor; routine: RoutineCatalogRow };
        const contract: RoutineContract = { descriptor: entry.descriptor, text: renderRoutineContract(entry.routine, entry.descriptor) };
        const result = await draftAndJudge({ projectId, packId, row, manifest, contract, callLlm: callLlm as LlmCallerFn, llmPool, evidence, guidance });
        void attemptNo;
        return { draftSql: result.draft.draftSql, judge: { verdict: result.verdict.verdict, confidence: result.verdict.confidence, flags: result.verdict.flags, translator_notes: result.draft.notes }, abiViolations: result.abiViolations };
      },
      apply: async ({ routine, draftSql }) => applyRoutine({ projectId, architectureId, targetDb: args.targetDb, descriptor: routine.descriptor, draftSql }),
      reconcile: async ({ routine, attemptId }) => {
        const outcome = await runParity({
          projectId,
          architectureId,
          targetDb: args.targetDb,
          routineIds: [routine.routineId],
          descriptors: descriptorsByName,
          purpose: 'workbench',
          packId,
          translationAttemptId: attemptId,
          waivers,
          upstreamDivergentTables: args.upstreamDivergentTables ?? [],
        });
        if (outcome.error) return { status: 'unverifiable', reportId: null, failing: [], divergentCount: 0, unverifiableReason: outcome.error };
        const rep = outcome.reports.find((r) => r.routine_id === routine.routineId);
        if (!rep) return { status: 'unverifiable', reportId: null, failing: [], divergentCount: 0, unverifiableReason: 'no report for routine' };
        const full = rep.report_id ? await fetchReport(projectId, architectureId, rep.report_id) : null;
        return {
          status: rep.summary.status,
          reportId: rep.report_id,
          failing: failingScenariosOf(full, inputsByScenario(routine.routineId)),
          divergentCount: rep.summary.divergent,
          scenarios: rep.summary.scenarios ?? null,
          unverifiableReason: rep.summary.status === 'unverifiable' ? (rep.summary.unverifiable_reason ?? 'unverifiable') : null,
        };
      },
      persistAttempt: async ({ routine, attempt }) => {
        const saved = await createAttempt(projectId, packId, routine.translationId, {
          attempt_no: attempt.attemptNo,
          draft_content: attempt.draftSql,
          judge_verdict_json: attempt.judge,
          apply_result_json: attempt.applyResult,
          parity_report_id: attempt.parityReportId,
          verdict: attempt.verdict,
          evidence_rungs_json: { rung: attempt.evidenceRung, divergent: attempt.divergentCount, error: attempt.error },
          guidance_text: attempt.guidance,
        });
        return { id: saved?.id ?? null };
      },
      patchTranslation: async ({ routine, patch }) => {
        await patchTranslation(projectId, packId, routine.translationId, patch);
      },
      onEvent: (e) => {
        state.events.push({ at: new Date().toISOString(), ...e });
        if (state.events.length > 500) state.events.splice(0, state.events.length - 500);
        if (['reconciled', 'exhausted', 'apply_failed'].includes(e.phase)) state.done += 1;
      },
    };
    const result = await loop(loopRoutines, loopDeps, config);
    state.result = result;
    state.phase = 'done';
    const terminal = result.results.filter((r) => r.finalStatus !== 'failed');
    trace.predicate(
      'PROC.LOOP.01',
      'every routine in the loop reached a terminal state',
      terminal.length === result.results.length,
      `${result.results.length} routine(s)`,
      `reconciled=${result.results.filter((r) => r.finalStatus === 'reconciled').length} exhausted=${result.results.filter((r) => r.finalStatus === 'exhausted').length} blocked=${result.results.filter((r) => r.finalStatus === 'blocked_by_callee').length} unverified=${result.results.filter((r) => r.finalStatus === 'unverified').length} failed=${result.results.length - terminal.length}`,
      { project: projectId, arch: architectureId },
    );
    return result;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.phase = 'failed';
    logger.error('[diag-gateway] proc_workbench loop_failed', { projectId, packId, error: state.error });
    throw error;
  } finally {
    // Keep the final state readable for the poll; clear on the next run.
    setTimeout(() => {
      if (workbenchRegistry.get(packId) === state && state.phase !== 'looping') workbenchRegistry.delete(packId);
    }, 10 * 60 * 1000).unref?.();
  }
}
