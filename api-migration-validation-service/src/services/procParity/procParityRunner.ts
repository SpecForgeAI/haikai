/**
 * Proc parity runner (Spec 4, 2026-09-09): replay the pinned proc baseline's
 * scenarios for a set of routines against the TARGET through each routine's
 * calling-convention descriptor, inside the target-side compensation
 * bracket (the target is non-disposable — undo is derived and verified
 * exactly as target replay does today), compare envelopes with the proc
 * comparator, and persist one report per routine.
 */

import type { DbAdapter } from '../db/DbAdapter';
import type { RoutineDescriptor, RoutineInvocationEnvelope, RoutineInvocationRequest } from '../db/routineEnvelope';
import type { CaptureCompensationContext } from '../captureCompensation';
import { runCompensationBracket } from '../compensation/compensationRunner';
import { computeStateDelta, snapshotEffectTables } from '../stateDelta';
import { loadPairRuleset, type MigrationPairRuleset } from '../../migrationPairRules';
import { bindInputs } from '../procCapture/routineScenarioSeeds';
import type { ProcBaselineItemDto, RoutineCatalogRow } from '../procCapture/types';
import { compareScenario, procRuleIds, summariseRoutineParity, type RoutineParitySummary, type ScenarioParityResult } from './procParityComparator';

export interface ProcParityWaiver {
  scope: 'routine' | 'scenario';
  routine: string;
  scenario?: string | null;
  reason: string;
}

export interface RoutineParityReport {
  pair_id: string | null;
  ruleset_version: number | null;
  routine_id: string;
  routine_name: string;
  baseline_id: string;
  purpose: 'workbench' | 'execution' | 'manual';
  pack_id?: string | null;
  translation_attempt_id?: string | null;
  descriptor_shape: string | null;
  summary: RoutineParitySummary & { unverifiable_reason?: string | null };
  scenarios: ScenarioParityResult[];
  rules_available: string[];
  computed_at: string;
}

export interface RunRoutineParityArgs {
  routine: RoutineCatalogRow;
  items: ProcBaselineItemDto[];
  baselineId: string;
  descriptor: RoutineDescriptor | null;
  /** The target adapter (invocation) and the target compensation context (undo). */
  targetAdapter: DbAdapter;
  compensation: CaptureCompensationContext | null;
  routinesById: Map<string, RoutineCatalogRow>;
  ruleset?: MigrationPairRuleset | null;
  waivers?: ProcParityWaiver[];
  upstreamDivergentTables?: string[];
  purpose: RoutineParityReport['purpose'];
  packId?: string | null;
  translationAttemptId?: string | null;
  limits: { max_rows_per_result_set: number; max_result_sets: number; timeout_seconds: number };
  sessionSet?: string[];
  now?: () => Date;
  snapshotTables?: typeof snapshotEffectTables;
  runBracket?: typeof runCompensationBracket;
}

function uniqLower(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim().toLowerCase()).filter((v) => v.length > 0))];
}

/** Replay + compare every baseline item of ONE routine. */
export async function runRoutineParity(args: RunRoutineParityArgs): Promise<RoutineParityReport> {
  const ruleset = args.ruleset === undefined ? loadPairRuleset() : args.ruleset;
  const now = args.now ?? (() => new Date());
  const snapshot = args.snapshotTables ?? snapshotEffectTables;
  const runBracket = args.runBracket ?? runCompensationBracket;
  const routine = args.routine;
  const routineName = routine.routine_name.toLowerCase();
  const waiverFor = (scenario: string): { reason: string } | null => {
    const w = (args.waivers ?? []).find(
      (x) => x.routine.toLowerCase() === routineName && (x.scope === 'routine' || (x.scenario ?? '').toLowerCase() === scenario.toLowerCase()),
    );
    return w ? { reason: w.reason } : null;
  };
  const base = {
    pair_id: ruleset?.pair_id ?? null,
    ruleset_version: ruleset?.version ?? null,
    routine_id: routine.id,
    routine_name: `${routine.schema_name}.${routine.routine_name}`,
    baseline_id: args.baselineId,
    purpose: args.purpose,
    pack_id: args.packId ?? null,
    translation_attempt_id: args.translationAttemptId ?? null,
    descriptor_shape: args.descriptor?.shape ?? null,
    rules_available: procRuleIds(ruleset),
    computed_at: now().toISOString(),
  };
  const unverifiableAll = (reason: string): RoutineParityReport => ({
    ...base,
    summary: { ...summariseRoutineParity([]), status: 'unverifiable', unverifiable_reason: reason },
    scenarios: args.items.map((it) => ({ scenario_name: it.scenario_name, scenario_type: it.scenario_type, verdict: 'unverifiable', unverifiable_reason: reason, signature: null, dimensions: [], rules_cited: [], waived: false, waiver_reason: null })),
  });
  if (args.items.length === 0) return unverifiableAll('no_baseline_scenarios');
  if (!args.descriptor) return unverifiableAll('no_invocation_descriptor');
  if (typeof args.targetAdapter.callRoutine !== 'function') return unverifiableAll('target_adapter_cannot_invoke');
  if (args.items.some((it) => it.stale)) {
    // A stale item (source body changed since capture) cannot be an oracle.
    return unverifiableAll('baseline_stale:body_changed');
  }

  const constructs = routine.profile_json?.constructs ?? [];
  const orderBy = (routine.profile_json?.result_selects ?? []).map((s) => s.has_order_by);
  const results: ScenarioParityResult[] = [];
  for (const item of args.items) {
    const stepsSpec = item.sequence_json && item.sequence_json.length > 0
      ? item.sequence_json.map((s) => ({ routine: args.routinesById.get(s.routine_id) as RoutineCatalogRow | undefined, inputs: s.inputs }))
      : [{ routine, inputs: item.inputs_json }];
    if (stepsSpec.some((s) => !s.routine)) {
      results.push({ scenario_name: item.scenario_name, scenario_type: item.scenario_type, verdict: 'unverifiable', unverifiable_reason: 'sequence_routine_missing', signature: null, dimensions: [], rules_cited: [], waived: false, waiver_reason: null });
      continue;
    }
    const writes = uniqLower(stepsSpec.flatMap((s) => [...(s.routine!.writes_closure_json ?? s.routine!.writes_json ?? []), ...(s.routine!.trigger_expanded_writes_json ?? [])]));
    const reads = uniqLower(stepsSpec.flatMap((s) => s.routine!.reads_closure_json ?? s.routine!.reads_json ?? [])).filter((t) => !writes.includes(t));
    const requests: RoutineInvocationRequest[] = stepsSpec.map((s) => {
      const bound = bindInputs(s.routine!.params_json ?? [], s.inputs);
      const params = bound.ok ? bound.bound : [];
      return {
        schema_name: s.routine!.schema_name,
        routine_name: s.routine!.routine_name,
        routine_kind: s.routine!.routine_kind === 'function' ? 'function' : 'procedure',
        params: params.map((b) => ({ name: b.name, ordinal: b.ordinal, source_type: b.source_type, direction: b.direction, value: b.value })),
        returns_type: s.routine!.returns_type ?? null,
        return_status: s.routine!.routine_kind !== 'function',
        session_set: args.sessionSet ?? [],
        limits: args.limits,
        // Each step follows ITS routine's descriptor; the last step is the routine under test.
        descriptor: s.routine!.id === routine.id ? args.descriptor : (args.descriptor ?? null),
      };
    });
    const doFire = async (): Promise<{ envelopes: RoutineInvocationEnvelope[]; delta: Record<string, unknown> | null }> => {
      const pre = writes.length > 0 ? await snapshot(args.targetAdapter, writes) : null;
      const envelopes: RoutineInvocationEnvelope[] = [];
      for (const req of requests) envelopes.push(await (args.targetAdapter.callRoutine as NonNullable<DbAdapter['callRoutine']>)(req));
      const post = pre ? await snapshot(args.targetAdapter, writes) : null;
      return { envelopes, delta: pre && post ? (computeStateDelta(pre, post) as unknown as Record<string, unknown>) : null };
    };
    let fired: { envelopes: RoutineInvocationEnvelope[]; delta: Record<string, unknown> | null } | null = null;
    let fireError: string | null = null;
    let bracketKind = 'unbracketed';
    try {
      if (!args.compensation || (writes.length === 0 && reads.length === 0)) {
        fired = await doFire();
      } else {
        const b = await runBracket({
          readAdapter: args.targetAdapter,
          writeAdapter: args.compensation.writeAdapter,
          engine: args.compensation.engine,
          schema: args.compensation.schema,
          tables: writes,
          readTables: reads,
          metadata: args.compensation.metadata,
          fire: doFire,
        });
        bracketKind = (b.outcome as { kind?: string }).kind ?? 'unknown';
        if (b.fireError) fireError = b.fireError instanceof Error ? b.fireError.message : String(b.fireError);
        fired = b.fireResult;
        if (!b.fired) fireError = fireError ?? `bracket refused (${bracketKind})`;
      }
    } catch (err) {
      fireError = err instanceof Error ? err.message : String(err);
    }
    if (!fired || fireError) {
      results.push({ scenario_name: item.scenario_name, scenario_type: item.scenario_type, verdict: 'unverifiable', unverifiable_reason: `replay_failed:${fireError ?? 'no envelope'}`, signature: null, dimensions: [], rules_cited: [], waived: !!waiverFor(item.scenario_name), waiver_reason: waiverFor(item.scenario_name)?.reason ?? null });
      continue;
    }
    const actual = fired.envelopes.length === 1 ? fired.envelopes[0] : { steps: fired.envelopes };
    const result = compareScenario({
      scenarioName: item.scenario_name,
      scenarioType: item.scenario_type,
      expected: item.expected_envelope_json,
      actual,
      expectedStateDelta: item.state_delta_json ?? null,
      actualStateDelta: fired.delta,
      volatileCells: item.volatile_cells_json ?? null,
      resultSelectOrderBy: orderBy,
      constructsPresent: constructs,
      objectKind: routine.routine_kind === 'function' ? 'function' : 'procedure',
      ruleset,
      waiver: waiverFor(item.scenario_name),
      upstreamDivergentTables: args.upstreamDivergentTables ?? [],
      routineReads: reads,
    });
    if (bracketKind === 'residue') {
      result.dimensions.push({ dimension: 'target_state', verdict: 'unverifiable', advisory: false, detail: 'target compensation left residue — restore the target before continuing', first_divergence: null, rules_cited: [], examples: [] });
      if (result.verdict !== 'divergent') {
        result.verdict = 'unverifiable';
        result.unverifiable_reason = 'target_residue';
      }
    }
    results.push(result);
  }
  return { ...base, summary: summariseRoutineParity(results), scenarios: results };
}
