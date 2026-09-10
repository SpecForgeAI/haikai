/**
 * Spec 4 (Stored Proc & Function Behaviour Program, 2026-09-09): the
 * evidence ladder (rung contents, clustering, overfit literals), the loop
 * engine (cap, ladder progression, best attempt, callee-first, blocked by
 * callee, cycles, unverified, apply failure), callee-first emission order
 * and the workbench input builder. Offline, invented vocabulary.
 */

import { clusterBySignature, evidenceLadderFromEnv, findSpecialCasedLiterals, renderEvidenceRung, type FailingScenarioEvidence } from '../services/dbMigrationPack/evidenceLadder';
import { calleeGroups, runTranslationReconcileLoop, type LoopDeps, type LoopRoutine, type ParityOutcome } from '../services/dbMigrationPack/translationReconcileLoop';
import { orderApprovedCalleesFirst } from '../services/dbMigrationPack/translationEmission';
import { buildLoopRoutines } from '../services/dbMigrationPack/procWorkbench';
import type { RoutineDescriptor } from '../services/dbMigrationPack/routineInvocationDescriptor';
import type { TranslationRow } from '../services/dbMigrationPack/translations';

const descriptor: RoutineDescriptor = { shape: 'return_status', pg_schema: 'dbo', pg_function: 'x', args: [], out_params: [], refcursors: [], return_status_carriage: 'function_return', error_carriage_rule: 'e', session_profile_rule: 's', confidence: 'static', rules_cited: [], basis: { max_result_sets: 0, has_output_params: false, return_status_trivial: true, signature_parsed: true } };

function failing(name: string, signature: string, value: unknown = 1042): FailingScenarioEvidence {
  return {
    scenario_name: name,
    scenario_type: 'happy_path',
    signature,
    inputs: [{ name: 'ledger_id', value }],
    dimensions: [
      { dimension: 'return_status', verdict: 'divergent', advisory: false, detail: 'expected 0, got 2', first_divergence: 'return_status', examples: [{ where: 'return_status', expected: 0, actual: 2 }] },
      { dimension: 'messages', verdict: 'tolerated', advisory: true, detail: null, first_divergence: null, examples: [] },
    ],
  };
}

describe('evidence ladder', () => {
  it('parses the env ladder and falls back to the default', () => {
    expect(evidenceLadderFromEnv(undefined)).toEqual(['none', 'one', 'cluster', 'full']);
    expect(evidenceLadderFromEnv('none, full')).toEqual(['none', 'full']);
    expect(evidenceLadderFromEnv('garbage')).toEqual(['none', 'one', 'cluster', 'full']);
  });

  it('renders one scenario, one per cluster, or everything — always as failing tests', () => {
    const f = [failing('a', 'return_status:return_status'), failing('b', 'return_status:return_status'), failing('c', 'result_sets:rs1.amount')];
    expect(renderEvidenceRung('none', f, null)).toBeNull();
    const one = renderEvidenceRung('one', f, null) as string;
    expect(one).toMatch(/Failing tests \(1\)/);
    expect(one).toContain('- a (happy_path) with inputs @ledger_id = 1042');
    expect(one).not.toContain('- b ');
    expect(one).toMatch(/never special-case these input values/);
    const cluster = renderEvidenceRung('cluster', f, null) as string;
    expect(cluster).toMatch(/Failing tests \(2\)/);
    expect(cluster).toContain('2 scenario(s) fail the same way: return_status:return_status');
    expect(cluster).toContain('- c (');
    const full = renderEvidenceRung('full', f, null) as string;
    expect(full).toMatch(/Failing tests \(3\)/);
    expect(clusterBySignature(f).map((c) => c.signature)).toEqual(['return_status:return_status', 'result_sets:rs1.amount']);
    const applyOnly = renderEvidenceRung('none', [], { sqlstate: '42601', message: 'syntax error', position: 12, detail: null }) as string;
    expect(applyOnly).toMatch(/FAILED TO APPLY/);
  });

  it('flags captured input literals that appear in the draft but not in the source', () => {
    const f = [failing('a', 'x', 1042), failing('b', 'x', 'FULL')];
    expect(findSpecialCasedLiterals("IF ledger_id = 1042 THEN RETURN 2; END IF; IF mode = 'full' THEN", 'create proc p as select 1', f)).toEqual(['1042', 'FULL']);
    expect(findSpecialCasedLiterals('IF ledger_id = 1042 THEN', 'where ledger_id = 1042', f)).toEqual([]);
    expect(findSpecialCasedLiterals('x = 7', 'y', [failing('c', 'x', 7)])).toEqual([]);
  });
});

function routine(partial: Partial<LoopRoutine>): LoopRoutine {
  return { translationId: 't-' + (partial.routineName ?? 'r'), translationKey: 'k', objectRef: 'dbo.' + (partial.routineName ?? 'r'), routineName: 'r', routineId: 'rid-' + (partial.routineName ?? 'r'), sourceBody: 'create proc r as select 1', procCalls: [], descriptor, baselineScenarioCount: 3, priorAttempts: 0, guidance: null, waived: false, ...partial };
}

function fakeDeps(script: Record<string, Array<Partial<ParityOutcome> | 'apply_fail'>>): LoopDeps & { patches: Array<{ routine: string; patch: Record<string, unknown> }>; attempts: Array<{ routine: string; attemptNo: number; verdict: string; rung: string }>; evidence: Array<string | null> } {
  const counters = new Map<string, number>();
  const patches: Array<{ routine: string; patch: Record<string, unknown> }> = [];
  const attempts: Array<{ routine: string; attemptNo: number; verdict: string; rung: string }> = [];
  const evidence: Array<string | null> = [];
  return {
    patches,
    attempts,
    evidence,
    translate: async ({ routine, evidence: ev }) => { evidence.push(ev); return { draftSql: `CREATE FUNCTION ${routine.routineName}() RETURNS integer AS $$ $$`, judge: { verdict: 'equivalent' }, abiViolations: [] }; },
    apply: async ({ routine }) => {
      const n = counters.get(routine.routineName) ?? 0;
      const step = script[routine.routineName]?.[n];
      if (step === 'apply_fail') { counters.set(routine.routineName, n + 1); return { ok: false, error: { sqlstate: '42601', message: 'syntax error', position: 1, detail: null } }; }
      return { ok: true, error: null };
    },
    reconcile: async ({ routine }) => {
      const n = counters.get(routine.routineName) ?? 0;
      counters.set(routine.routineName, n + 1);
      const step = script[routine.routineName]?.[n];
      const base: ParityOutcome = { status: 'divergent', reportId: `rep-${routine.routineName}-${n + 1}`, failing: [failing('s', 'return_status:return_status')], divergentCount: 1, unverifiableReason: null };
      return { ...base, ...((step && step !== 'apply_fail') ? step : {}) };
    },
    persistAttempt: async ({ routine, attempt }) => { attempts.push({ routine: routine.routineName, attemptNo: attempt.attemptNo, verdict: attempt.verdict, rung: attempt.evidenceRung }); return { id: `att-${routine.routineName}-${attempt.attemptNo}` }; },
    patchTranslation: async ({ routine, patch }) => { patches.push({ routine: routine.routineName, patch }); },
  };
}

describe('translation reconcile loop', () => {
  const config = { attemptCap: 4, ladder: ['none', 'one', 'cluster', 'full'] as const, concurrency: 2 };

  it('walks the ladder (zero evidence first), stops on reconciled, persists every attempt', async () => {
    const deps = fakeDeps({ a: [{}, {}, { status: 'clean', failing: [], divergentCount: 0 }] });
    const res = await runTranslationReconcileLoop([routine({ routineName: 'a' })], deps, { ...config, ladder: [...config.ladder] });
    expect(res.results[0].finalStatus).toBe('reconciled');
    expect(res.results[0].reconciledAttemptNo).toBe(3);
    expect(deps.evidence[0]).toBeNull();
    expect(deps.evidence[1]).toMatch(/Failing tests \(1\)/);
    expect(deps.attempts.map((a) => [a.attemptNo, a.verdict, a.rung])).toEqual([[1, 'divergent', 'none'], [2, 'divergent', 'one'], [3, 'divergent', 'cluster']]);
    const final = deps.patches[deps.patches.length - 1].patch;
    expect(final).toMatchObject({ loop_status: 'reconciled', best_attempt_no: 3, parity_report_id: 'rep-a-3', pipeline_state: 'drafted' });
  });

  it('exhausts at the cap, keeps the best attempt as the draft, and tells the user', async () => {
    const deps = fakeDeps({ a: [{ divergentCount: 3 }, { divergentCount: 1 }, { divergentCount: 2 }, { divergentCount: 2 }] });
    const res = await runTranslationReconcileLoop([routine({ routineName: 'a' })], deps, { ...config, ladder: [...config.ladder] });
    expect(res.results[0].finalStatus).toBe('exhausted');
    expect(res.results[0].bestAttemptNo).toBe(2);
    expect(deps.attempts).toHaveLength(4);
    const final = deps.patches[deps.patches.length - 1].patch;
    expect(final).toMatchObject({ loop_status: 'exhausted', best_attempt_no: 2 });
    expect((final.verdict_json as { signatures: string[] }).signatures).toEqual(['return_status:return_status']);
  });

  it('feeds an apply failure into the next rung and records apply_failed attempts', async () => {
    const deps = fakeDeps({ a: ['apply_fail', { status: 'clean', failing: [], divergentCount: 0 }] });
    const res = await runTranslationReconcileLoop([routine({ routineName: 'a' })], deps, { ...config, ladder: [...config.ladder] });
    expect(res.results[0].finalStatus).toBe('reconciled');
    expect(deps.attempts[0].verdict).toBe('apply_failed');
    expect(deps.evidence[1]).toMatch(/FAILED TO APPLY/);
  });

  it('runs callees first, blocks callers on an unreconciled callee unless waived, and groups cycles', async () => {
    const deps = fakeDeps({ callee: [{}, {}, {}, {}], caller: [{ status: 'clean', failing: [], divergentCount: 0 }], w: [{}, {}, {}, {}], wcaller: [{ status: 'clean', failing: [], divergentCount: 0 }] });
    const routines = [
      routine({ routineName: 'caller', procCalls: ['callee'] }),
      routine({ routineName: 'callee' }),
      routine({ routineName: 'wcaller', procCalls: ['w'] }),
      routine({ routineName: 'w', waived: true }),
    ];
    const res = await runTranslationReconcileLoop(routines, deps, { ...config, ladder: [...config.ladder] });
    const byName = new Map(res.results.map((r) => [r.routineName, r]));
    expect(res.order.indexOf('callee')).toBeLessThan(res.order.indexOf('caller'));
    expect(byName.get('callee')?.finalStatus).toBe('exhausted');
    expect(byName.get('caller')?.finalStatus).toBe('blocked_by_callee');
    expect(byName.get('caller')?.blockedBy).toEqual(['callee']);
    expect(byName.get('w')?.finalStatus).toBe('exhausted');
    expect(byName.get('wcaller')?.finalStatus).toBe('reconciled');
    expect(calleeGroups([routine({ routineName: 'p', procCalls: ['q'] }), routine({ routineName: 'q', procCalls: ['p'] })])).toEqual([['p', 'q']]);
  });

  it('translates unverified routines once (no oracle) and stops', async () => {
    const deps = fakeDeps({});
    const res = await runTranslationReconcileLoop([routine({ routineName: 'u', baselineScenarioCount: 0 })], deps, { ...config, ladder: [...config.ladder] });
    expect(res.results[0].finalStatus).toBe('unverified');
    expect(deps.attempts).toEqual([{ routine: 'u', attemptNo: 1, verdict: 'unverified', rung: 'none' }]);
  });
});

describe('callee-first emission + loop inputs', () => {
  const row = (ref: string, extra: Partial<TranslationRow> = {}): TranslationRow => ({ id: 'id-' + ref, translation_key: `stored_procedure--${ref}`, object_ref: ref, kind: 'stored_procedure', disposition: 'translate', drop_reason: null, pipeline_state: 'drafted', source_body: 'x', source_body_hash: 'h', truncated: false, legacy_redacted: false, draft_content: 'd', judge_verdict_json: {}, review_status: 'approved', reviewer_notes: null, routine_id: 'r-' + ref, ...extra });

  it('orders approved translations so callees precede callers', () => {
    const approved = [row('dbo.caller'), row('dbo.callee'), row('dbo.view_only', { kind: 'view' })];
    const routines = [
      { id: 'r-dbo.caller', schema_name: 'dbo', routine_name: 'caller', routine_kind: 'procedure' as const, proc_calls_json: ['callee'] },
      { id: 'r-dbo.callee', schema_name: 'dbo', routine_name: 'callee', routine_kind: 'procedure' as const, proc_calls_json: [] },
    ];
    expect(orderApprovedCalleesFirst(approved, routines).map((r) => r.object_ref)).toEqual(['dbo.callee', 'dbo.caller', 'dbo.view_only']);
    expect(orderApprovedCalleesFirst(approved, undefined).map((r) => r.object_ref)).toEqual(['dbo.caller', 'dbo.callee', 'dbo.view_only']);
  });

  it('builds loop inputs only for translate-dispositioned routines with a catalog row, counting baseline scenarios', () => {
    const rows = [row('dbo.a'), row('dbo.b', { disposition: 'drop' }), row('dbo.c', { routine_id: null }), row('dbo.d', { pipeline_state: 'needs_manual' })];
    const r = (name: string) => ({ id: 'r-dbo.' + name, schema_name: 'dbo', routine_name: name, routine_kind: 'procedure' as const, proc_calls_json: [], full_body: 'src' });
    const descriptors = new Map([['r-dbo.a', { descriptor, routine: r('a') }], ['r-dbo.b', { descriptor, routine: r('b') }], ['r-dbo.d', { descriptor, routine: r('d') }]]);
    const out = buildLoopRoutines({ rows, routines: [], descriptors, baselineItems: [{ routine_id: 'r-dbo.a', scenario_name: 's1', inputs_json: [] }, { routine_id: 'r-dbo.a', scenario_name: 's2', inputs_json: [] }], waivers: [{ scope: 'routine', routine: 'a', reason: 'known' }], priorAttempts: new Map([['id-dbo.a', 2]]), guidanceByTranslation: { 'id-dbo.a': 'be careful' }, scope: null });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ routineName: 'a', baselineScenarioCount: 2, priorAttempts: 2, guidance: 'be careful', waived: true });
  });
});
