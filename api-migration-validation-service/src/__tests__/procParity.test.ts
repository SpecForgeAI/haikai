/**
 * Spec 4 (Stored Proc & Function Behaviour Program, 2026-09-09): the proc
 * parity comparator (dimensions, ordering rule, multiset, error identity,
 * volatility by evidence, upstream precondition, signatures), the runner
 * (descriptor / stale / bracket / report shape) and the routine-apply
 * primitive. Offline, invented vocabulary.
 */

import { compareScenario, summariseRoutineParity } from '../services/procParity/procParityComparator';
import { runRoutineParity } from '../services/procParity/procParityRunner';
import { applyRoutineWithClient, dropStatementsFor } from '../services/db/postgresRoutineApply';
import { pairRulesetForSource, resetPairRulesetCacheForTest } from '../migrationPairRules';
import type { RoutineDescriptor, RoutineInvocationEnvelope } from '../services/db/routineEnvelope';
import type { ProcBaselineItemDto, RoutineCatalogRow } from '../services/procCapture/types';
import type { DbAdapter } from '../services/db/DbAdapter';

function env(partial: Partial<RoutineInvocationEnvelope> = {}): RoutineInvocationEnvelope {
  return {
    outcome: 'success',
    return_status: 0,
    output_params: { rows_done: 3 },
    result_sets: [{ ordinal: 1, columns: [{ name: 'ledger_id', type: 'int' }, { name: 'amount', type: 'numeric' }], rows: [[1042, '10.50'], [1043, '20.00']], row_count: 2, truncated: false }],
    update_counts: [1],
    messages: [{ kind: 'print', number: null, severity: null, state: null, text: 'rolling' }],
    error: null,
    timing_ms: 3,
    session: { login: 'x', set_options: [] },
    ...partial,
  };
}

describe('compareScenario', () => {
  beforeEach(() => resetPairRulesetCacheForTest());
  const rs = () => pairRulesetForSource('sybase');
  const base = { scenarioName: 'happy', scenarioType: 'happy_path', objectKind: 'procedure' as const, ruleset: rs() };

  it('matches identical envelopes and reports advisory-only differences as tolerated', () => {
    const same = compareScenario({ ...base, expected: env(), actual: env() });
    expect(same.verdict).toBe('match');
    const msg = compareScenario({ ...base, expected: env(), actual: env({ messages: [], update_counts: [2] }) });
    expect(msg.verdict).toBe('match');
    expect(msg.dimensions.filter((d) => d.advisory && d.verdict === 'tolerated').map((d) => d.dimension)).toEqual(['messages', 'update_counts']);
  });

  it('diverges on return status, output params and result-set cells with a signature', () => {
    const r = compareScenario({ ...base, expected: env(), actual: env({ return_status: 2 }) });
    expect(r.verdict).toBe('divergent');
    expect(r.signature).toBe('return_status:return_status');
    const o = compareScenario({ ...base, expected: env(), actual: env({ output_params: { rows_done: 4 } }) });
    expect(o.signature).toBe('output_params:rows_done');
    const c = compareScenario({ ...base, expected: env(), actual: env({ result_sets: [{ ...env().result_sets[0], rows: [[1042, '10.50'], [1043, '99.00']] }] }), resultSelectOrderBy: [true] });
    expect(c.signature).toBe('result_sets:rs1.amount');
    expect(c.dimensions.find((d) => d.dimension === 'result_sets')?.examples[0]).toMatchObject({ where: 'rs1[1].amount', expected: '20.00', actual: '99.00' });
  });

  it('compares rows as a multiset when the SELECT has no ORDER BY, and ordered when it does', () => {
    const swapped = env({ result_sets: [{ ...env().result_sets[0], rows: [[1043, '20.00'], [1042, '10.50']] }] });
    expect(compareScenario({ ...base, expected: env(), actual: swapped, resultSelectOrderBy: [false] }).verdict).not.toBe('divergent');
    expect(compareScenario({ ...base, expected: env(), actual: swapped, resultSelectOrderBy: [true] }).verdict).toBe('divergent');
  });

  it('applies cited cell rules (numeric canonical, column-name case) and error identity', () => {
    const r = compareScenario({ ...base, expected: env(), actual: env({ result_sets: [{ ...env().result_sets[0], columns: [{ name: 'LEDGER_ID', type: 'int4' }, { name: 'Amount', type: 'numeric' }], rows: [[1042, '10.5'], [1043, '20']] }] }), resultSelectOrderBy: [true] });
    expect(r.verdict).toBe('tolerated');
    expect(r.rules_cited).toEqual(expect.arrayContaining(['SYBPG.PROC.RS.COLNAME.001', 'SYBPG.NUM.003']));
    const err = (n: number) => env({ outcome: 'error', error: { number: n, sqlstate: 'P0001', severity: 16, state: 1, message: 'x' } });
    expect(compareScenario({ ...base, expected: err(20012), actual: err(20012) }).verdict).toBe('match');
    const bad = compareScenario({ ...base, expected: err(20012), actual: err(20013) });
    expect(bad.verdict).toBe('divergent');
    expect(bad.signature).toBe('outcome:error.number');
    expect(compareScenario({ ...base, expected: err(20012), actual: env() }).signature).toBe('outcome:outcome');
  });

  it('treats double-fire volatile cells under the volatility rules only when the construct is present', () => {
    const clocked = (stamp: string) => env({ result_sets: [{ ordinal: 1, columns: [{ name: 'id', type: 'int' }, { name: 'stamp', type: 'datetime' }], rows: [[1, stamp]], row_count: 1, truncated: false }] });
    const args = { ...base, expected: clocked('2026-09-09 10:00:00'), actual: clocked('2026-09-09 10:05:00'), resultSelectOrderBy: [true], volatileCells: [{ where: 'result_set' as const, result_set: 1, row: 0, column: 'stamp' }] };
    expect(compareScenario({ ...args, constructsPresent: ['getdate'] }).verdict).toBe('tolerated');
    expect(compareScenario({ ...args, constructsPresent: [] }).verdict).toBe('divergent');
  });

  it('is unverifiable on upstream data divergence, truncation, and sequence step mismatch', () => {
    expect(compareScenario({ ...base, expected: env(), actual: env(), upstreamDivergentTables: ['ledger_line'], routineReads: ['ledger_line'] })).toMatchObject({ verdict: 'unverifiable', unverifiable_reason: 'upstream_data_divergence:ledger_line' });
    expect(compareScenario({ ...base, expected: env(), actual: env({ result_sets: [{ ...env().result_sets[0], truncated: true }] }) }).unverifiable_reason).toBe('result_set_truncated');
    expect(compareScenario({ ...base, expected: { steps: [env(), env()] }, actual: env() }).signature).toBe('sequence:step_count');
  });

  it('summarises signatures and honours waivers', () => {
    const d1 = compareScenario({ ...base, scenarioName: 'a', expected: env(), actual: env({ return_status: 2 }) });
    const d2 = compareScenario({ ...base, scenarioName: 'b', expected: env(), actual: env({ return_status: 3 }) });
    const w = compareScenario({ ...base, scenarioName: 'c', expected: env(), actual: env({ return_status: 4 }), waiver: { reason: 'known' } });
    const s = summariseRoutineParity([d1, d2, w, compareScenario({ ...base, scenarioName: 'd', expected: env(), actual: env() })]);
    expect(s).toMatchObject({ status: 'divergent', scenarios: 4, matched: 1, divergent: 2, waived: 1 });
    expect(s.signatures).toEqual([{ signature: 'return_status:return_status', count: 2, scenario_names: ['a', 'b'] }]);
    expect(summariseRoutineParity([w]).status).toBe('clean_with_waivers');
  });
});

describe('runRoutineParity', () => {
  const routine: RoutineCatalogRow = {
    id: 'r1', schema_name: 'dbo', routine_name: 'upd_ledger_roll', routine_kind: 'procedure', full_body: 'x', body_hash: 'h',
    params_json: [{ name: 'ledger_id', ordinal: 1, source_type: 'int', direction: 'in', default_literal: null }],
    profile_json: { result_selects: [{ ordinal: 1, has_order_by: true, has_top: false, select_list_static: null }], constructs: [] },
    writes_closure_json: ['ledger_ctrl'], reads_closure_json: ['ledger_line'],
  };
  const descriptor: RoutineDescriptor = { shape: 'single_result_set', pg_schema: 'dbo', pg_function: 'upd_ledger_roll', args: [{ name: 'ledger_id', pg_type: 'integer', source_param: 'ledger_id', direction: 'in' }], out_params: [], refcursors: [], return_status_carriage: 'none', error_carriage_rule: 'SYBPG.PROC.ERR.001', session_profile_rule: 'SYBPG.PROC.SESSION.001', confidence: 'static', rules_cited: [] };
  const item = (overrides: Partial<ProcBaselineItemDto> = {}): ProcBaselineItemDto => ({
    routine_id: 'r1', routine_body_hash: 'h', scenario_name: 'happy', scenario_type: 'happy_path', exit_outcome: 'success',
    inputs_json: [{ name: 'ledger_id', value: 1042, is_null: false }], expected_envelope_json: env(), ...overrides,
  });
  const adapter = (fn: (req: unknown) => RoutineInvocationEnvelope): DbAdapter => ({ callRoutine: async (req: unknown) => fn(req), dispose: async () => undefined } as unknown as DbAdapter);

  it('replays inside the target bracket, compares, and shapes the report', async () => {
    const brackets: string[][] = [];
    const runBracket = async (a: { tables: string[]; readTables?: string[]; fire: () => Promise<unknown> }) => { brackets.push([...a.tables, ...(a.readTables ?? [])]); return { outcome: { kind: 'compensated' }, fired: true, fireResult: await a.fire(), fireError: null }; };
    const report = await runRoutineParity({
      routine, items: [item(), item({ scenario_name: 'off', expected_envelope_json: env({ return_status: 1 }) })], baselineId: 'b1', descriptor,
      sourceEngine: 'sybase',
      targetAdapter: adapter(() => env()), compensation: { writeAdapter: {}, engine: 'postgres', schema: null, metadata: {} } as never, routinesById: new Map([['r1', routine]]),
      purpose: 'workbench', limits: { max_rows_per_result_set: 100, max_result_sets: 5, timeout_seconds: 10 }, snapshotTables: async () => ({ tables: [] }), runBracket: runBracket as never,
    });
    expect(brackets).toEqual([['ledger_ctrl', 'ledger_line'], ['ledger_ctrl', 'ledger_line']]);
    expect(report.summary).toMatchObject({ status: 'divergent', scenarios: 2, matched: 1, divergent: 1 });
    expect(report.scenarios[1].signature).toBe('return_status:return_status');
    expect(report.descriptor_shape).toBe('single_result_set');
    expect(report.rules_available).toContain('SYBPG.PROC.ABI.001');
  });

  it('is unverifiable without a descriptor, with stale items, or when the replay fails', async () => {
    const common = { routine, baselineId: 'b1', compensation: null, routinesById: new Map([['r1', routine]]), purpose: 'workbench' as const, limits: { max_rows_per_result_set: 1, max_result_sets: 1, timeout_seconds: 1 } };
    const noDesc = await runRoutineParity({ ...common, items: [item()], descriptor: null, targetAdapter: adapter(() => env()) });
    expect(noDesc.summary.unverifiable_reason).toBe('no_invocation_descriptor');
    const stale = await runRoutineParity({ ...common, items: [item({ stale: true })], descriptor, targetAdapter: adapter(() => env()) });
    expect(stale.summary.unverifiable_reason).toBe('baseline_stale:body_changed');
    const failing = await runRoutineParity({ ...common, items: [item()], descriptor, targetAdapter: adapter(() => { throw new Error('boom'); }), snapshotTables: async () => ({ tables: [] }) });
    expect(failing.scenarios[0].unverifiable_reason).toBe('replay_failed:boom');
  });
});

describe('routine apply', () => {
  it('drops the descriptor signature and creates in one transaction; rolls back on failure', async () => {
    const d: RoutineDescriptor = { shape: 'return_status', pg_schema: 'dbo', pg_function: 'fn_x', args: [{ name: 'a', pg_type: 'integer', source_param: 'a', direction: 'in' }, { name: 'b', pg_type: 'varchar(10)', source_param: 'b', direction: 'in' }], out_params: [], refcursors: [], return_status_carriage: 'function_return', error_carriage_rule: 'x', session_profile_rule: 'y', confidence: 'static', rules_cited: [] };
    expect(dropStatementsFor(d)).toEqual(['DROP FUNCTION IF EXISTS "dbo"."fn_x"(integer, varchar(10))']);
    const calls: string[] = [];
    const ok = await applyRoutineWithClient({ query: async (t: string) => { calls.push(t); } }, d, 'CREATE FUNCTION dbo.fn_x(a integer, b varchar(10)) RETURNS integer AS $$ SELECT 1 $$ LANGUAGE sql;', { dropFirst: true, timeoutSeconds: 5 });
    expect(ok.ok).toBe(true);
    expect(calls[0]).toBe('BEGIN');
    expect(calls[calls.length - 1]).toBe('COMMIT');
    const failing = await applyRoutineWithClient({ query: async (t: string) => { if (/CREATE FUNCTION/.test(t)) throw Object.assign(new Error('syntax error'), { code: '42601', position: '17' }); } }, d, 'CREATE FUNCTION broken', { dropFirst: false, timeoutSeconds: 5 });
    expect(failing).toMatchObject({ ok: false, error: { sqlstate: '42601', position: 17 } });
  });
});
