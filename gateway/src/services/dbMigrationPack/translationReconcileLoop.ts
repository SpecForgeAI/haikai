/**
 * Translation workbench loop engine (Stored Proc & Function Behaviour
 * Program, Spec 4, 2026-09-09) — GENERIC, deps injectable.
 *
 * For every routine in scope: translate → apply → reconcile (ALL baseline
 * scenarios) → re-translate with the evidence rung → … until reconciled or
 * the attempt cap; callee-first (a caller runs only when every in-loop
 * callee is reconciled or waived; otherwise `blocked_by_callee`); cycles run
 * as a group; every attempt persisted; on exhaustion the best attempt
 * (fewest failing scenarios) becomes the draft and the user is told loudly.
 * The judge's overfitting flag counts as divergent. Concurrency-capped.
 */

import type { RoutineDescriptor } from './routineInvocationDescriptor';
import { evidenceLadderFromEnv, findSpecialCasedLiterals, renderEvidenceRung, type ApplyFailureEvidence, type EvidenceRung, type FailingScenarioEvidence } from './evidenceLadder';

export type LoopFinalStatus =
  | 'reconciled'
  | 'exhausted'
  | 'apply_failed'
  | 'unverified'
  | 'blocked_by_callee'
  | 'failed'
  | 'dispositioned';

export type AttemptVerdict = 'reconciled' | 'divergent' | 'apply_failed' | 'abi_mismatch' | 'overfit_suspected' | 'unverified' | 'failed';

export interface LoopRoutine {
  translationId: string;
  translationKey: string;
  objectRef: string;
  /** Bare lower-case routine name (the callee-graph key). */
  routineName: string;
  routineId: string;
  sourceBody: string;
  procCalls: string[];
  descriptor: RoutineDescriptor;
  /** Baseline scenarios available for this routine (0 = unverified). */
  baselineScenarioCount: number;
  /** Prior attempts already persisted (resume / retry continues numbering). */
  priorAttempts: number;
  /** Reviewer guidance for the next attempt (retry with guidance). */
  guidance: string | null;
  /** Routine-level waiver present → a non-reconciled result never blocks callers. */
  waived: boolean;
}

export interface ParityOutcome {
  status: 'clean' | 'clean_with_waivers' | 'divergent' | 'unverifiable';
  reportId: string | null;
  failing: FailingScenarioEvidence[];
  divergentCount: number;
  unverifiableReason: string | null;
  /** Total scenarios replayed (the "match N of N" denominator); null when unknown. */
  scenarios?: number | null;
}

export interface AttemptRecord {
  attemptNo: number;
  verdict: AttemptVerdict;
  draftSql: string | null;
  judge: Record<string, unknown> | null;
  applyResult: { ok: boolean; error: ApplyFailureEvidence | null } | null;
  parityReportId: string | null;
  evidenceRung: EvidenceRung;
  divergentCount: number | null;
  guidance: string | null;
  error: string | null;
}

export interface LoopDeps {
  translate(args: { routine: LoopRoutine; attemptNo: number; evidence: string | null; guidance: string | null }): Promise<{ draftSql: string; judge: Record<string, unknown>; abiViolations: string[] }>;
  apply(args: { routine: LoopRoutine; draftSql: string }): Promise<{ ok: boolean; error: ApplyFailureEvidence | null }>;
  reconcile(args: { routine: LoopRoutine; attemptId: string | null }): Promise<ParityOutcome>;
  persistAttempt(args: { routine: LoopRoutine; attempt: AttemptRecord }): Promise<{ id: string | null }>;
  /** Sparse translation patch (loop_status, draft, verdict summary, best attempt, ...). */
  patchTranslation(args: { routine: LoopRoutine; patch: Record<string, unknown> }): Promise<void>;
  onEvent?(event: { routine: string; phase: string; detail?: string }): void;
}

export interface LoopConfig {
  attemptCap: number;
  ladder: EvidenceRung[];
  concurrency: number;
}

export interface RoutineLoopResult {
  translationId: string;
  routineName: string;
  finalStatus: LoopFinalStatus;
  attempts: AttemptRecord[];
  bestAttemptNo: number | null;
  reconciledAttemptNo: number | null;
  blockedBy: string[];
  lastFailing: FailingScenarioEvidence[];
  error: string | null;
}

export interface LoopResult {
  results: RoutineLoopResult[];
  order: string[];
}

export function loopConfigFromEnv(overrides: Partial<LoopConfig> = {}): LoopConfig {
  const cap = parseInt(process.env.PROC_TRANSLATE_ATTEMPT_CAP ?? '4', 10);
  const conc = parseInt(process.env.PROC_TRANSLATE_CONCURRENCY ?? '3', 10);
  return {
    attemptCap: overrides.attemptCap ?? (Number.isFinite(cap) && cap > 0 ? cap : 4),
    ladder: overrides.ladder ?? evidenceLadderFromEnv(),
    concurrency: overrides.concurrency ?? (Number.isFinite(conc) && conc > 0 ? conc : 3),
  };
}

/** Strongly connected components of the in-loop callee graph (Tarjan). */
export function calleeGroups(routines: LoopRoutine[]): string[][] {
  const byName = new Map(routines.map((r) => [r.routineName, r]));
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const groups: string[][] = [];
  const strong = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of byName.get(v)?.procCalls ?? []) {
      const key = w.toLowerCase();
      if (!byName.has(key)) continue;
      if (!idx.has(key)) {
        strong(key);
        low.set(v, Math.min(low.get(v) as number, low.get(key) as number));
      } else if (onStack.has(key)) {
        low.set(v, Math.min(low.get(v) as number, idx.get(key) as number));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const group: string[] = [];
      let w: string;
      do {
        w = stack.pop() as string;
        onStack.delete(w);
        group.push(w);
      } while (w !== v);
      groups.push(group.sort());
    }
  };
  for (const r of [...routines].sort((a, b) => a.routineName.localeCompare(b.routineName))) {
    if (!idx.has(r.routineName)) strong(r.routineName);
  }
  return groups; // Tarjan emits SCCs in reverse topological order = callees first.
}

async function runOne(routine: LoopRoutine, deps: LoopDeps, config: LoopConfig): Promise<RoutineLoopResult> {
  const attempts: AttemptRecord[] = [];
  const emit = (phase: string, detail?: string): void => deps.onEvent?.({ routine: routine.routineName, phase, detail });
  const result = (finalStatus: LoopFinalStatus, extra: Partial<RoutineLoopResult> = {}): RoutineLoopResult => ({
    translationId: routine.translationId,
    routineName: routine.routineName,
    finalStatus,
    attempts,
    bestAttemptNo: null,
    reconciledAttemptNo: null,
    blockedBy: [],
    lastFailing: [],
    error: null,
    ...extra,
  });
  if (routine.baselineScenarioCount === 0) {
    // Translate + judge once (no oracle): unverified, approval needs a waiver.
    try {
      await deps.patchTranslation({ routine, patch: { loop_status: 'translating' } });
      const t = await deps.translate({ routine, attemptNo: routine.priorAttempts + 1, evidence: null, guidance: routine.guidance });
      const apply = await deps.apply({ routine, draftSql: t.draftSql });
      const attempt: AttemptRecord = { attemptNo: routine.priorAttempts + 1, verdict: apply.ok ? 'unverified' : 'apply_failed', draftSql: t.draftSql, judge: t.judge, applyResult: apply, parityReportId: null, evidenceRung: 'none', divergentCount: null, guidance: routine.guidance, error: apply.error?.message ?? null };
      attempts.push(attempt);
      await deps.persistAttempt({ routine, attempt });
      await deps.patchTranslation({ routine, patch: { loop_status: apply.ok ? 'unverified' : 'apply_failed', current_attempt_no: attempt.attemptNo, best_attempt_no: attempt.attemptNo, draft_content: t.draftSql, verdict_json: { status: apply.ok ? 'unverified' : 'apply_failed', reason: apply.ok ? 'no_baseline_scenarios' : apply.error?.message ?? null } } });
      return result(apply.ok ? 'unverified' : 'apply_failed', { bestAttemptNo: attempt.attemptNo });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await deps.patchTranslation({ routine, patch: { loop_status: 'apply_failed', verdict_json: { status: 'failed', reason: message } } }).catch(() => undefined);
      return result('failed', { error: message });
    }
  }

  let failing: FailingScenarioEvidence[] = [];
  let lastScenarios: number | null = null;
  let applyFailure: ApplyFailureEvidence | null = null;
  let best: { attemptNo: number; divergent: number; draftSql: string } | null = null;
  try {
    for (let i = 0; i < config.attemptCap; i++) {
      const attemptNo = routine.priorAttempts + i + 1;
      const rung: EvidenceRung = config.ladder[Math.min(i, config.ladder.length - 1)] ?? 'full';
      const evidence = i === 0 && !applyFailure ? null : renderEvidenceRung(rung, failing, applyFailure);
      emit('translating', `attempt ${attemptNo} rung ${i === 0 ? 'none' : rung}`);
      await deps.patchTranslation({ routine, patch: { loop_status: 'translating', current_attempt_no: attemptNo } });
      const attempt: AttemptRecord = { attemptNo, verdict: 'failed', draftSql: null, judge: null, applyResult: null, parityReportId: null, evidenceRung: i === 0 ? 'none' : rung, divergentCount: null, guidance: routine.guidance, error: null };
      let translated: Awaited<ReturnType<LoopDeps['translate']>>;
      try {
        translated = await deps.translate({ routine, attemptNo, evidence, guidance: routine.guidance });
      } catch (err) {
        attempt.error = err instanceof Error ? err.message : String(err);
        attempt.verdict = /abi_mismatch/i.test(attempt.error) ? 'abi_mismatch' : 'failed';
        attempts.push(attempt);
        await deps.persistAttempt({ routine, attempt });
        continue;
      }
      attempt.draftSql = translated.draftSql;
      attempt.judge = translated.judge;
      const overfit = findSpecialCasedLiterals(translated.draftSql, routine.sourceBody, failing);
      const judgeOverfit = translated.judge && (translated.judge as { overfit_suspected?: boolean }).overfit_suspected === true;
      emit('applying', `attempt ${attemptNo}`);
      await deps.patchTranslation({ routine, patch: { loop_status: 'applying' } });
      const apply = await deps.apply({ routine, draftSql: translated.draftSql });
      attempt.applyResult = apply;
      if (!apply.ok) {
        applyFailure = apply.error;
        attempt.verdict = 'apply_failed';
        attempt.error = apply.error?.message ?? 'apply failed';
        attempts.push(attempt);
        await deps.persistAttempt({ routine, attempt });
        continue;
      }
      applyFailure = null;
      emit('reconciling', `attempt ${attemptNo}`);
      await deps.patchTranslation({ routine, patch: { loop_status: 'reconciling' } });
      const persisted = await deps.persistAttempt({ routine, attempt: { ...attempt, verdict: 'divergent' } });
      const parity = await deps.reconcile({ routine, attemptId: persisted.id });
      attempt.parityReportId = parity.reportId;
      attempt.divergentCount = parity.divergentCount;
      failing = parity.failing;
      lastScenarios = parity.scenarios ?? lastScenarios;
      if (parity.status === 'unverifiable') {
        attempt.verdict = 'unverified';
        attempt.error = parity.unverifiableReason;
        attempts.push(attempt);
        await deps.patchTranslation({ routine, patch: { loop_status: 'unverified', best_attempt_no: attemptNo, parity_report_id: parity.reportId, draft_content: translated.draftSql, verdict_json: { status: 'unverifiable', reason: parity.unverifiableReason, attempt_no: attemptNo } } });
        return result('unverified', { bestAttemptNo: attemptNo, lastFailing: failing, error: parity.unverifiableReason });
      }
      const clean = parity.status === 'clean' || parity.status === 'clean_with_waivers';
      if (clean && (overfit.length > 0 || judgeOverfit)) {
        attempt.verdict = 'overfit_suspected';
        attempt.error = `special-cased captured inputs: ${overfit.join(', ') || 'judge flag'}`;
        attempts.push(attempt);
        // Overfitting is a divergence for the ladder: keep going with evidence.
        continue;
      }
      attempt.verdict = clean ? 'reconciled' : 'divergent';
      attempts.push(attempt);
      if (best === null || parity.divergentCount < best.divergent) best = { attemptNo, divergent: parity.divergentCount, draftSql: translated.draftSql };
      if (clean) {
        await deps.patchTranslation({ routine, patch: { loop_status: 'reconciled', best_attempt_no: attemptNo, parity_report_id: parity.reportId, draft_content: translated.draftSql, pipeline_state: 'drafted', judge_verdict_json: translated.judge, review_status: 'unreviewed', verdict_json: { status: parity.status, attempt_no: attemptNo, scenarios_failing: 0, scenarios: parity.scenarios ?? null, attempts: config.attemptCap } } });
        emit('reconciled', `attempt ${attemptNo}`);
        return result('reconciled', { bestAttemptNo: attemptNo, reconciledAttemptNo: attemptNo });
      }
    }
    // Exhausted: the best attempt stays as the draft; the user is told loudly.
    const bestNo = best?.attemptNo ?? attempts[attempts.length - 1]?.attemptNo ?? null;
    await deps.patchTranslation({
      routine,
      patch: {
        loop_status: applyFailure && !best ? 'apply_failed' : 'exhausted',
        best_attempt_no: bestNo,
        ...(best ? { draft_content: best.draftSql, pipeline_state: 'drafted', review_status: 'unreviewed' } : {}),
        parity_report_id: attempts.filter((a) => a.parityReportId).pop()?.parityReportId ?? null,
        verdict_json: {
          status: applyFailure && !best ? 'apply_failed' : 'exhausted',
          attempts: config.attemptCap,
          attempts_made: attempts.length,
          best_attempt_no: bestNo,
          scenarios_failing: best?.divergent ?? null,
          scenarios: lastScenarios,
          signatures: [...new Set(failing.map((f) => f.signature ?? 'unknown'))],
          apply_error: applyFailure?.message ?? null,
        },
      },
    });
    emit(applyFailure && !best ? 'apply_failed' : 'exhausted', `after ${attempts.length} attempt(s)`);
    return result(applyFailure && !best ? 'apply_failed' : 'exhausted', { bestAttemptNo: bestNo, lastFailing: failing });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.patchTranslation({ routine, patch: { loop_status: 'apply_failed', verdict_json: { status: 'failed', reason: message } } }).catch(() => undefined);
    return result('failed', { error: message, lastFailing: failing });
  }
}

/**
 * Run the loop over a set of routines: callee-first groups, each group's
 * members in parallel (bounded), callers blocked when a callee ended
 * non-reconciled and unwaived.
 */
export async function runTranslationReconcileLoop(routines: LoopRoutine[], deps: LoopDeps, config: LoopConfig): Promise<LoopResult> {
  const byName = new Map(routines.map((r) => [r.routineName, r]));
  const groups = calleeGroups(routines);
  const results = new Map<string, RoutineLoopResult>();
  const order: string[] = [];
  const satisfied = (r: LoopRoutine): { ok: boolean; blockedBy: string[] } => {
    const blockedBy: string[] = [];
    for (const called of r.procCalls) {
      const key = called.toLowerCase();
      const callee = byName.get(key);
      if (!callee || callee === r) continue;
      const res = results.get(key);
      if (!res) continue; // same group (cycle) — runs together
      if (res.finalStatus !== 'reconciled' && !callee.waived) blockedBy.push(key);
    }
    return { ok: blockedBy.length === 0, blockedBy };
  };
  for (const group of groups) {
    const members = group.map((n) => byName.get(n) as LoopRoutine);
    const runnable: LoopRoutine[] = [];
    for (const m of members) {
      const s = satisfied(m);
      order.push(m.routineName);
      if (!s.ok) {
        await deps.patchTranslation({ routine: m, patch: { loop_status: 'blocked_by_callee', verdict_json: { status: 'blocked_by_callee', blocked_by: s.blockedBy } } });
        results.set(m.routineName, { translationId: m.translationId, routineName: m.routineName, finalStatus: 'blocked_by_callee', attempts: [], bestAttemptNo: null, reconciledAttemptNo: null, blockedBy: s.blockedBy, lastFailing: [], error: null });
      } else {
        runnable.push(m);
      }
    }
    for (let i = 0; i < runnable.length; i += config.concurrency) {
      const slice = runnable.slice(i, i + config.concurrency);
      const settled = await Promise.all(slice.map((m) => runOne(m, deps, config)));
      for (const r of settled) results.set(r.routineName, r);
    }
  }
  return { results: order.map((n) => results.get(n) as RoutineLoopResult), order };
}
