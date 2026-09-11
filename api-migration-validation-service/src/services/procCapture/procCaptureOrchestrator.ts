/**
 * Proc behaviour capture orchestrator (Stored Proc & Function Behaviour
 * Program, Spec 3, 2026-09-09).
 *
 * Per routine in scope (callee-first): preflight (non-compensatable
 * constructs refuse BEFORE any fire), deterministic scenario plan, one LLM
 * loop per planned scenario (the LLM records inputs and fires through
 * `execute_routine`), every fire inside the derived compensation bracket
 * sized from the routine's write closure ∪ trigger expansion ∪ reads, the
 * envelope + state delta persisted as a capture, volatility double-fire for
 * clock/random-bearing routines, the coverage floor scored, and the
 * end-of-job S0 fingerprint at the end. DB-native: nothing here touches the
 * API capture session model.
 */

import { secretsStore } from '../secretsStore';
import type { SecretsBundle } from '../../types/secrets';
import { createDbAdapter } from '../db/dbAdapterFactory';
import type { DbAdapter } from '../db/DbAdapter';
import type { RoutineInvocationEnvelope, RoutineInvocationRequest } from '../db/routineEnvelope';
import { buildCaptureCompensationContext, runEndOfJobFingerprint, runQuietWindowCheck, type CaptureCompensationContext } from '../captureCompensation';
import { runCompensationBracket } from '../compensation/compensationRunner';
import { computeStateDelta, snapshotEffectTables } from '../stateDelta';
import { latestSnapshotId } from '../s0/manifest';
import { gatewayClient as defaultGatewayClient, type GatewayClient } from '../gatewayClient';
import { pairRulesetForSource, sessionProfileRule } from '../../migrationPairRules';
import { redactJson } from '../redactor';
import { procBehaviourClient, type ProcBehaviourClientSurface } from '../procBehaviourClient';
import { PROC_TOOLS } from './procTools';
import { runProcScenarioLoop, type ProcFireResult, type ProcToolContext, type ProcToolEntry } from './procToolLoop';
import { bindInputs, defaultRoutineScenarioPlan, enumerateExitOutcomes, mineParamDomains, type ScenarioPlan } from './routineScenarioSeeds';
import { assembleProcCoverageSummary, scoreRoutineCoverage } from './routineCoverageFloor';
import {
  PROC_CALL_MAX_RESULT_SETS,
  PROC_CALL_MAX_ROWS_PER_RESULT_SET,
  PROC_CALL_TIMEOUT_SECONDS,
  PROC_CAPTURE_QUIET_WINDOW_SECONDS,
  PROC_LLM_ATTEMPTS_PER_ROUTINE,
  PROC_LLM_RESEARCH_ROUND_CEILING,
  PROC_LLM_ROUND_LIMIT,
  PROC_LLM_SCENARIO_WALL_CLOCK_MS,
  PROC_LLM_TOOL_CALL_TIMEOUT_MS,
  procCallSessionSetOverride,
} from './procConfig';
import type {
  ProcCaptureDto,
  ProcCaptureSessionDto,
  ProcCoverageSummary,
  ProcDbConfig,
  ProcDiagnosticDto,
  ProcDiagnosticType,
  ProcScenarioDto,
  RoutineCatalogRow,
  RoutineCoverage,
  VolatileCell,
} from './types';
import type { ChatMessage } from '../../types/llm';

// ---------------------------------------------------------------------------
// Run registry (status / cancel) — proc-specific, never the API runManager
// ---------------------------------------------------------------------------

export interface ProcRunState {
  sessionId: string;
  projectId: string;
  architectureId: string;
  startedAt: number;
  abortController: AbortController;
  phase: string;
  routineIndex: number;
  routineTotal: number;
  scenariosFired: number;
  capturesAccepted: number;
  findings: number;
}

export const procRunRegistry = new Map<string, ProcRunState>();

export function cancelProcRun(sessionId: string): boolean {
  const run = procRunRegistry.get(sessionId);
  if (!run) return false;
  run.abortController.abort();
  return true;
}

// ---------------------------------------------------------------------------
// Deps + args
// ---------------------------------------------------------------------------

export interface ProcCaptureDeps {
  client?: ProcBehaviourClientSurface;
  createAdapter?: typeof createDbAdapter;
  buildCompensation?: typeof buildCaptureCompensationContext;
  runBracket?: typeof runCompensationBracket;
  snapshotTables?: typeof snapshotEffectTables;
  quietWindow?: typeof runQuietWindowCheck | null;
  endOfJobFingerprint?: typeof runEndOfJobFingerprint | null;
  latestSnapshot?: typeof latestSnapshotId;
  gatewayClient?: Pick<GatewayClient, 'callLlmToolLoop'>;
  loop?: typeof runProcScenarioLoop;
  tools?: ReadonlyArray<ProcToolEntry>;
  secrets?: (sessionId: string) => SecretsBundle | undefined;
  sleep?: (ms: number) => Promise<void>;
  sessionSetResolver?: () => string[];
  now?: () => Date;
}

export interface ProcCaptureRunArgs {
  projectId: string;
  architectureId: string;
  sessionId: string;
  /** Scoped re-run (retry-uncovered): only these routines. */
  routineIds?: string[] | null;
}

export interface ProcCaptureOutcome {
  status: 'completed' | 'completed_with_findings' | 'failed' | 'cancelled';
  routines: number;
  scenariosFired: number;
  capturesAccepted: number;
  findings: number;
  error: string | null;
  coverage: ProcCoverageSummary | null;
}

const FINDING_CLASS: ReadonlySet<ProcDiagnosticType> = new Set([
  'non_compensatable',
  'bracket_residue',
  'coverage_floor_unmet',
  'result_set_truncated',
]);

/**
 * Session SET list: env override, else the explicit profile, else the pair
 * ruleset's session-profile rule for the SOURCE engine (looked up by role,
 * never by a hardcoded rule id), else nothing.
 */
export function resolveSessionSet(
  sessionProfile?: { set?: string[] } | null,
  sourceEngine?: string | null,
): string[] {
  const override = procCallSessionSetOverride();
  if (override) return override;
  if (sessionProfile?.set && sessionProfile.set.length > 0) return sessionProfile.set;
  const ruleset = pairRulesetForSource(sourceEngine);
  const rule = sessionProfileRule(ruleset);
  return rule?.session_profile?.set ?? [];
}

/** Callee-first order over the routines in scope (cycle-safe DFS). */
export function orderCalleesFirst(routines: RoutineCatalogRow[]): RoutineCatalogRow[] {
  const byName = new Map(routines.map((r) => [r.routine_name.toLowerCase(), r]));
  const state = new Map<string, 'visiting' | 'done'>();
  const out: RoutineCatalogRow[] = [];
  const visit = (r: RoutineCatalogRow): void => {
    const key = r.routine_name.toLowerCase();
    if (state.get(key)) return;
    state.set(key, 'visiting');
    for (const called of [...(r.proc_calls_json ?? [])].sort()) {
      const callee = byName.get(called.toLowerCase());
      if (callee) visit(callee);
    }
    state.set(key, 'done');
    out.push(r);
  };
  for (const r of [...routines].sort((a, b) => a.routine_name.localeCompare(b.routine_name))) visit(r);
  return out;
}

/** Cells that differ between two fires of the same inputs (volatility evidence). */
export function diffEnvelopes(a: RoutineInvocationEnvelope[], b: RoutineInvocationEnvelope[], cap = 200): VolatileCell[] {
  const cells: VolatileCell[] = [];
  const push = (c: VolatileCell): void => {
    if (cells.length < cap) cells.push(c);
  };
  for (let s = 0; s < Math.min(a.length, b.length); s++) {
    const x = a[s];
    const y = b[s];
    if (x.return_status !== y.return_status) push({ where: 'return_status' });
    for (const k of new Set([...Object.keys(x.output_params), ...Object.keys(y.output_params)])) {
      if (JSON.stringify(x.output_params[k] ?? null) !== JSON.stringify(y.output_params[k] ?? null)) push({ where: 'output_param', param: k });
    }
    for (let i = 0; i < Math.min(x.result_sets.length, y.result_sets.length); i++) {
      const rx = x.result_sets[i];
      const ry = y.result_sets[i];
      for (let r = 0; r < Math.min(rx.rows.length, ry.rows.length); r++) {
        for (let c = 0; c < Math.min(rx.rows[r].length, ry.rows[r].length); c++) {
          if (JSON.stringify(rx.rows[r][c] ?? null) !== JSON.stringify(ry.rows[r][c] ?? null)) {
            push({ where: 'result_set', result_set: i + 1, row: r, column: rx.columns[c]?.name ?? String(c) });
          }
        }
      }
    }
  }
  return cells;
}

export function buildRoutinePrompt(
  routine: RoutineCatalogRow,
  plan: ScenarioPlan,
  learnedFacts: string[],
  sessionSet: string[],
): ChatMessage[] {
  const userPayload = {
    routine: {
      name: `${routine.schema_name}.${routine.routine_name}`,
      kind: routine.routine_kind,
      signature: (routine.params_json ?? []).map((p) => `@${p.name} ${p.source_type}${p.default_literal !== null ? ` = ${p.default_literal}` : ''}${p.direction === 'output' ? ' OUTPUT' : ''}`),
      returns_type: routine.returns_type ?? null,
      exit_outcomes: enumerateExitOutcomes(routine),
      result_sets_static: routine.profile_json?.max_result_sets ?? 0,
      constructs: routine.profile_json?.constructs ?? [],
      reads: routine.reads_closure_json ?? routine.reads_json ?? [],
      writes: routine.writes_closure_json ?? routine.writes_json ?? [],
      param_domains: mineParamDomains(routine),
    },
    scenario: {
      name: plan.name,
      type: plan.type,
      directive: plan.directive,
      target_outcome: plan.target_outcome,
      seed_inputs: plan.seed_inputs,
    },
    session_settings: sessionSet,
    learned_facts: learnedFacts.slice(-20),
  };
  return [
    {
      role: 'system',
      content:
        'You are a stored-procedure behaviour capture planner for a database migration. The routine SOURCE is the specification. ' +
        'Read it with `get_routine_context`, resolve REAL parameter values from the database with `sample_routine_db_values` / `run_routine_readonly_sql` (never invent ids), ' +
        'record the scenario with `record_routine_scenario`, fire it with `execute_routine`, and close with `record_routine_note`. ' +
        'Target the scenario directive exactly: drive the named exit outcome (success, a specific RETURN value, or a specific RAISERROR) by choosing inputs the source logic routes there. ' +
        'Use a multi-step sequence ONLY when the state the scenario needs cannot exist in the database beforehand (create-then-act). ' +
        'After an unexpected outcome, read the error and change the specific input the source rejected — never repeat an identical call. ' +
        'Close honestly: `captured_ok` for a clean capture of the intended outcome, `captured_as_error` when the routine answered with an error that IS the intended behaviour, ' +
        '`not_possible` when the data cannot produce this scenario (say why), `routine_skipped` when you captured nothing.',
    },
    { role: 'user', content: JSON.stringify(userPayload) },
  ];
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function orchestrateProcCaptureSession(
  args: ProcCaptureRunArgs,
  deps: ProcCaptureDeps = {},
): Promise<ProcCaptureOutcome> {
  const client = deps.client ?? procBehaviourClient;
  const createAdapter = deps.createAdapter ?? createDbAdapter;
  const buildCompensation = deps.buildCompensation ?? buildCaptureCompensationContext;
  const runBracket = deps.runBracket ?? runCompensationBracket;
  const snapshotTables = deps.snapshotTables ?? snapshotEffectTables;
  const quietWindow = deps.quietWindow === undefined ? runQuietWindowCheck : deps.quietWindow;
  const endOfJob = deps.endOfJobFingerprint === undefined ? runEndOfJobFingerprint : deps.endOfJobFingerprint;
  const gateway = deps.gatewayClient ?? defaultGatewayClient;
  const loop = deps.loop ?? runProcScenarioLoop;
  const tools = deps.tools ?? PROC_TOOLS;
  const getSecrets = deps.secrets ?? ((id: string) => secretsStore.get(id));
  const now = deps.now ?? (() => new Date());
  const { projectId, architectureId, sessionId } = args;

  const abortController = new AbortController();
  const run: ProcRunState = {
    sessionId,
    projectId,
    architectureId,
    startedAt: Date.now(),
    abortController,
    phase: 'starting',
    routineIndex: 0,
    routineTotal: 0,
    scenariosFired: 0,
    capturesAccepted: 0,
    findings: 0,
  };
  procRunRegistry.set(sessionId, run);

  const adapters: DbAdapter[] = [];
  const diag = async (d: Omit<ProcDiagnosticDto, 'session_id'>): Promise<void> => {
    if (FINDING_CLASS.has(d.diagnostic_type)) run.findings += 1;
    try {
      await client.createDiagnostics(projectId, architectureId, sessionId, [{ session_id: sessionId, ...d }]);
    } catch (err) {
      console.warn(`[diag-amvs] op=proc_capture diagnostic_write_failed session=${sessionId.slice(0, 8)} type=${d.diagnostic_type} reason=${err instanceof Error ? err.message : String(err)}`);
    }
  };
  let coverage: ProcCoverageSummary | null = null;
  try {
    const session = await client.getSession(projectId, architectureId, sessionId);
    const secrets = getSecrets(sessionId);
    const cfg = session.db_config_redacted_json ?? null;
    if (!cfg || !secrets?.db?.password) {
      throw new Error('Proc capture requires the session DB configuration and loaded DB secrets.');
    }
    await client.patchSession(projectId, architectureId, sessionId, { status: 'running', started_at: now().toISOString() });
    const tuning = session.capture_tuning_json ?? {};
    const limits = {
      maxRows: cfg.maxRowsPerQuery ?? 200,
      timeoutSeconds: cfg.queryTimeoutSeconds ?? 60,
    };
    const invocationLimits = {
      max_rows_per_result_set: tuning.max_rows_per_result_set ?? PROC_CALL_MAX_ROWS_PER_RESULT_SET(),
      max_result_sets: tuning.max_result_sets ?? PROC_CALL_MAX_RESULT_SETS(),
      timeout_seconds: tuning.invocation_timeout_seconds ?? PROC_CALL_TIMEOUT_SECONDS(),
    };
    const sessionSet = (deps.sessionSetResolver ?? (() => resolveSessionSet(session.session_profile_json, cfg.dbType)))();

    // ---- Routines in scope, callee-first ---------------------------------
    run.phase = 'loading_routines';
    const all = (await client.listRoutines(projectId, architectureId)).filter(
      (r) => r.routine_kind === 'procedure' || r.routine_kind === 'function',
    );
    const scopeIds = new Set<string>(session.scope_routine_ids_json ?? []);
    const retryIds = args.routineIds && args.routineIds.length > 0 ? new Set(args.routineIds) : null;
    const inScope = all.filter((r) => (scopeIds.size === 0 || scopeIds.has(r.id)) && (!retryIds || retryIds.has(r.id)));
    const routines = orderCalleesFirst(inScope);
    const routineById = new Map(all.map((r) => [r.id, r]));
    const routinesByName = new Map(all.map((r) => [r.routine_name.toLowerCase(), r]));
    run.routineTotal = routines.length;

    const priorDiagnostics = await client.listDiagnostics(projectId, architectureId, sessionId);
    const excludedRoutineIds = new Set(
      priorDiagnostics
        .filter((d) => d.diagnostic_type === 'excluded_by_user' || d.diagnostic_type === 'not_possible')
        .map((d) => d.routine_id)
        .filter((id): id is string => typeof id === 'string'),
    );

    // ---- Adapters + compensation ----------------------------------------
    run.phase = 'connecting';
    const readonlySplit = !!secrets.db.readonlyUsername && !!secrets.db.readonlyPassword;
    const primaryConfig = {
      dbType: cfg.dbType,
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      schema: cfg.schema ?? null,
      username: cfg.username,
      password: secrets.db.password,
    };
    const readAdapter = createAdapter({
      ...primaryConfig,
      username: readonlySplit ? (secrets.db.readonlyUsername as string) : cfg.username,
      password: readonlySplit ? (secrets.db.readonlyPassword as string) : secrets.db.password,
    });
    // Capture fires with the DB credentials the user entered (ruling 2026-09-09).
    const fireAdapter = createAdapter(primaryConfig);
    adapters.push(readAdapter, fireAdapter);
    if (typeof fireAdapter.callRoutine !== 'function') {
      throw new Error(`The ${cfg.dbType} adapter cannot invoke routines (callRoutine unavailable).`);
    }
    const compensationResult = await buildCompensation({ projectId, architectureId, writeConfig: primaryConfig, readAdapter });
    const compensation: CaptureCompensationContext | null = compensationResult.context;
    if (!compensation) {
      await diag({
        routine_id: null,
        diagnostic_type: 'non_compensatable',
        message:
          `Compensation is inactive (${compensationResult.inactiveReason ?? 'unknown'}): routines with a write closure will be REFUSED (fail closed); write-free routines still capture.`,
        detail_json: { reason: compensationResult.inactiveReason },
      });
    }

    // ---- Quiet window (a busy database cannot be S0) --------------------
    const gapSeconds = tuning.quiet_window_seconds ?? PROC_CAPTURE_QUIET_WINDOW_SECONDS();
    if (compensation && quietWindow && gapSeconds > 0) {
      run.phase = 'quiet_window';
      const quiet = await quietWindow({
        adapter: readAdapter,
        metadata: compensation.metadata,
        schema: compensation.schema,
        gapSeconds,
        sleep: deps.sleep,
      });
      if (!quiet.quiet) {
        throw new Error(
          `The database is not quiet: ${quiet.drifted.map((d) => `${d.table} ${d.before}->${d.after}`).join(', ')} changed in ${quiet.gapSeconds}s. Capture refused (S0 cannot be pinned on a moving database).`,
        );
      }
    }

    // ---- Per routine ----------------------------------------------------
    const learnedFacts: string[] = [];
    const perRoutine: RoutineCoverage[] = [];
    const attemptsBudget = tuning.attempts_per_scenario ?? PROC_LLM_ATTEMPTS_PER_ROUTINE();
    for (let idx = 0; idx < routines.length; idx++) {
      const routine = routines[idx];
      run.routineIndex = idx + 1;
      run.phase = `routine ${idx + 1}/${routines.length}`;
      if (abortController.signal.aborted) break;
      if (excludedRoutineIds.has(routine.id)) {
        perRoutine.push(scoreRoutineCoverage(routine, [], [], { excluded: true }));
        continue;
      }
      const profile = routine.profile_json ?? {};
      const writeTables = uniqLower([...(routine.writes_closure_json ?? routine.writes_json ?? []), ...(routine.trigger_expanded_writes_json ?? [])]);
      const nonCompensatable = profile.non_compensatable_reasons ?? [];
      if (!routine.signature_parsed && (routine.params_json ?? []).length === 0 && /@/.test(routine.full_body.slice(0, 2000))) {
        await diag({ routine_id: routine.id, diagnostic_type: 'routine_skipped', message: `Signature not parsed for ${routine.routine_name}; parameters cannot be bound.`, detail_json: { signature_error: routine.signature_error ?? null } });
        perRoutine.push(scoreRoutineCoverage(routine, [], [], { unverifiableReason: 'signature_unparsed' }));
        continue;
      }
      if (nonCompensatable.length > 0) {
        await diag({
          routine_id: routine.id,
          diagnostic_type: 'non_compensatable',
          message: `${routine.routine_name} REFUSED before firing: ${nonCompensatable.join(', ')} cannot be bracketed by the compensation engine.`,
          detail_json: { reasons: nonCompensatable },
        });
        perRoutine.push(scoreRoutineCoverage(routine, [], [], { unverifiableReason: `non_compensatable:${nonCompensatable.join('+')}` }));
        continue;
      }
      if (!compensation && writeTables.length > 0) {
        await diag({ routine_id: routine.id, diagnostic_type: 'non_compensatable', message: `${routine.routine_name} REFUSED: it writes ${writeTables.join(', ')} and compensation is inactive.`, detail_json: { writes: writeTables } });
        perRoutine.push(scoreRoutineCoverage(routine, [], [], { unverifiableReason: 'compensation_inactive' }));
        continue;
      }
      if ((profile.session_user_functions ?? []).length > 0) {
        await diag({
          routine_id: routine.id,
          diagnostic_type: 'login_dependent',
          message: `${routine.routine_name} reads the session user (${(profile.session_user_functions ?? []).join(', ')}); captured under login '${cfg.username}'.`,
          detail_json: { functions: profile.session_user_functions, login: cfg.username },
        });
      }

      const fire = async ({ scenario }: { scenario: ProcScenarioDto }): Promise<ProcFireResult> => {
        const steps = scenario.sequence_json && scenario.sequence_json.length > 0 ? scenario.sequence_json : null;
        const stepRoutines: Array<{ routine: RoutineCatalogRow; inputs: ProcScenarioDto['inputs_json'] }> = steps
          ? steps.map((s) => ({ routine: routineById.get(s.routine_id) as RoutineCatalogRow, inputs: s.inputs }))
          : [{ routine, inputs: scenario.inputs_json }];
        if (stepRoutines.some((s) => !s.routine)) throw new Error('A sequence step names a routine outside the catalog.');
        const writes = uniqLower(stepRoutines.flatMap((s) => [...(s.routine.writes_closure_json ?? s.routine.writes_json ?? []), ...(s.routine.trigger_expanded_writes_json ?? [])]));
        const reads = uniqLower(stepRoutines.flatMap((s) => s.routine.reads_closure_json ?? s.routine.reads_json ?? [])).filter((t) => !writes.includes(t));
        const requests: RoutineInvocationRequest[] = stepRoutines.map((s) => {
          const bound = bindInputs(s.routine.params_json ?? [], s.inputs);
          if (!bound.ok) throw new Error(bound.error);
          return {
            schema_name: s.routine.schema_name,
            routine_name: s.routine.routine_name,
            routine_kind: s.routine.routine_kind === 'function' ? 'function' : 'procedure',
            params: bound.bound.map((b) => ({ name: b.name, ordinal: b.ordinal, source_type: b.source_type, direction: b.direction, value: b.value })),
            returns_type: s.routine.returns_type ?? null,
            return_status: s.routine.routine_kind !== 'function',
            session_set: sessionSet,
            limits: invocationLimits,
          };
        });
        const doFire = async (): Promise<{ envelopes: RoutineInvocationEnvelope[]; delta: Record<string, unknown> | null }> => {
          const pre = writes.length > 0 ? await snapshotTables(readAdapter, writes) : null;
          const envelopes: RoutineInvocationEnvelope[] = [];
          for (const req of requests) {
            envelopes.push(await (fireAdapter.callRoutine as NonNullable<DbAdapter['callRoutine']>)(req));
          }
          const post = pre ? await snapshotTables(readAdapter, writes) : null;
          return { envelopes, delta: pre && post ? (computeStateDelta(pre, post) as unknown as Record<string, unknown>) : null };
        };
        const fireOnce = async (): Promise<{ envelopes: RoutineInvocationEnvelope[]; delta: Record<string, unknown> | null; bracket: string; fired: boolean; error: unknown }> => {
          if (!compensation || (writes.length === 0 && reads.length === 0)) {
            const r = await doFire();
            return { ...r, bracket: 'unbracketed', fired: true, error: null };
          }
          const b = await runBracket({
            readAdapter,
            writeAdapter: compensation.writeAdapter,
            engine: compensation.engine,
            schema: compensation.schema,
            tables: writes,
            readTables: reads,
            metadata: compensation.metadata,
            fire: doFire,
          });
          return {
            envelopes: b.fireResult?.envelopes ?? [],
            delta: b.fireResult?.delta ?? null,
            bracket: (b.outcome as { kind?: string }).kind ?? 'unknown',
            fired: b.fired,
            error: b.fireError,
          };
        };
        const started = Date.now();
        const first = await fireOnce();
        if (first.error) throw first.error instanceof Error ? first.error : new Error(String(first.error));
        let refusedReason: string | null = null;
        if (!first.fired || first.bracket === 'refused') refusedReason = `bracket refused (${first.bracket})`;
        if (first.bracket === 'residue') {
          await diag({ routine_id: routine.id, diagnostic_type: 'bracket_residue', message: `Compensation left residue after '${scenario.scenario_name}' on ${routine.routine_name}; the capture is NOT accepted. Remedy: S0 restore.`, detail_json: { scenario: scenario.scenario_name } });
        }
        const accepted = first.fired && ['clean', 'compensated', 'healed', 'unbracketed'].includes(first.bracket);
        let volatile: VolatileCell[] | null = null;
        if (accepted && (profile.volatile_functions ?? []).length > 0) {
          const second = await fireOnce();
          if (second.fired && !second.error) volatile = diffEnvelopes(first.envelopes, second.envelopes);
        }
        const truncated = first.envelopes.some((e) => e.result_sets.some((rs) => rs.truncated));
        if (truncated) {
          await diag({ routine_id: routine.id, diagnostic_type: 'result_set_truncated', message: `A result set of '${scenario.scenario_name}' on ${routine.routine_name} exceeded ${invocationLimits.max_rows_per_result_set} rows; the capture is unverifiable at full depth.`, detail_json: { scenario: scenario.scenario_name } });
        }
        const envelopeJson = first.envelopes.length === 1 ? first.envelopes[0] : { steps: first.envelopes };
        const [saved] = await client.createCaptures(projectId, architectureId, sessionId, [
          {
            session_id: sessionId,
            scenario_id: scenario.id as string,
            routine_id: routine.id,
            attempt_number: 1,
            envelope_json: redactJson(envelopeJson) as ProcCaptureDto['envelope_json'],
            state_delta_json: first.delta,
            volatile_cells_json: volatile,
            bracket_outcome: first.bracket as ProcCaptureDto['bracket_outcome'],
            duration_ms: Date.now() - started,
            error_type: first.envelopes.some((e) => e.outcome === 'error') ? 'routine_error' : null,
            error_message: first.envelopes.find((e) => e.outcome === 'error')?.error?.message ?? null,
            accepted: accepted && !truncated,
          },
        ]);
        await client.upsertScenarios(projectId, architectureId, sessionId, [{ ...scenario, status: 'fired' }]);
        run.scenariosFired += 1;
        if (accepted && !truncated) run.capturesAccepted += 1;
        return {
          capture_id: saved?.id ?? null,
          envelopes: first.envelopes,
          state_delta: first.delta,
          bracket: first.bracket,
          accepted: accepted && !truncated,
          refused_reason: refusedReason,
        };
      };

      const plans = defaultRoutineScenarioPlan(routine);
      for (const plan of plans) {
        if (abortController.signal.aborted) break;
        const ctx: ProcToolContext = {
          projectId,
          architectureId,
          sessionId,
          routine,
          routinesByName,
          dbAdapter: readAdapter,
          limits,
          plan,
          currentScenarioId: null,
          attemptsFired: 0,
          attemptsBudget,
          learnedFacts,
          client,
          fire,
          noteSink: { last: null },
        };
        const outcome = await loop({
          context: ctx,
          initialMessages: buildRoutinePrompt(routine, plan, learnedFacts, sessionSet),
          tools,
          gatewayClient: gateway,
          roundLimit: tuning.round_limit ?? PROC_LLM_ROUND_LIMIT(),
          researchRoundCeiling: tuning.research_round_ceiling ?? PROC_LLM_RESEARCH_ROUND_CEILING(),
          toolCallTimeoutMs: tuning.tool_call_timeout_ms ?? PROC_LLM_TOOL_CALL_TIMEOUT_MS(),
          scenarioWallClockMs: tuning.scenario_wall_clock_ms ?? PROC_LLM_SCENARIO_WALL_CLOCK_MS(),
          abortSignal: abortController.signal,
        });
        if (outcome.reason === 'llm_daily_limit') {
          throw new Error(`LLM daily limit reached during ${routine.routine_name}/${plan.name}; capture stopped.`);
        }
        if (outcome.reason !== 'completed') {
          await diag({
            routine_id: routine.id,
            diagnostic_type: 'routine_skipped',
            message: `Scenario '${plan.name}' on ${routine.routine_name} ended ${outcome.reason}${outcome.errorMessage ? `: ${outcome.errorMessage}` : ''}.`,
            detail_json: { scenario: plan.name, reason: outcome.reason, rounds: outcome.roundsUsed, research_rounds: outcome.researchRounds },
          });
        }
      }
      const scenarios = (await client.listScenarios(projectId, architectureId, sessionId)).filter((s) => s.routine_id === routine.id);
      const captures = (await client.listCaptures(projectId, architectureId, sessionId)).filter((c) => c.routine_id === routine.id);
      const cov = scoreRoutineCoverage(routine, scenarios, captures);
      if (!cov.floor_met) {
        await diag({
          routine_id: routine.id,
          diagnostic_type: 'coverage_floor_unmet',
          message: `${routine.routine_name}: coverage floor unmet — missing ${cov.missing.join(', ') || 'an accepted capture'}.`,
          detail_json: { missing: cov.missing, achieved: cov.achieved },
        });
      }
      perRoutine.push(cov);
    }

    // ---- End of job: S0 fingerprint --------------------------------------
    run.phase = 'fingerprint';
    let s0: Record<string, unknown> | null = null;
    if (compensation && endOfJob) {
      const fp = await endOfJob({ projectId, architectureId, readAdapter, metadata: compensation.metadata, schema: compensation.schema, effectScope: compensation.effectScope });
      s0 = { status: fp.status, snapshot_id: fp.snapshotId, verified_at: now().toISOString() };
      if (fp.status !== 'verified' && fp.status !== 'no_snapshot') {
        await diag({ routine_id: null, diagnostic_type: 'bracket_residue', message: `End-of-job S0 fingerprint: ${fp.status}. Restore S0 before any further capture.`, detail_json: { status: fp.status } });
      }
    } else if ((deps.latestSnapshot ?? latestSnapshotId)(projectId, architectureId)) {
      s0 = { status: 'not_verified', snapshot_id: (deps.latestSnapshot ?? latestSnapshotId)(projectId, architectureId) };
    }

    coverage = assembleProcCoverageSummary(perRoutine, now());
    const cancelled = abortController.signal.aborted;
    const status = cancelled ? 'cancelled' : run.findings > 0 ? 'completed_with_findings' : 'completed';
    await client.patchSession(projectId, architectureId, sessionId, {
      status,
      completed_at: now().toISOString(),
      coverage_summary_json: coverage,
      s0_fingerprint_json: s0,
    });
    return { status, routines: routines.length, scenariosFired: run.scenariosFired, capturesAccepted: run.capturesAccepted, findings: run.findings, error: null, coverage };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[diag-amvs] op=proc_capture result=failed session=${sessionId.slice(0, 8)} reason=${message.slice(0, 200)}`);
    try {
      await client.patchSession(projectId, architectureId, sessionId, { status: 'failed', completed_at: now().toISOString(), coverage_summary_json: coverage });
    } catch {
      /* the failure is already logged */
    }
    return { status: 'failed', routines: run.routineTotal, scenariosFired: run.scenariosFired, capturesAccepted: run.capturesAccepted, findings: run.findings, error: message, coverage };
  } finally {
    procRunRegistry.delete(sessionId);
    for (const a of adapters) {
      try {
        await a.dispose();
      } catch {
        /* nothing to release */
      }
    }
  }
}

function uniqLower(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim().toLowerCase()).filter((v) => v.length > 0))];
}
