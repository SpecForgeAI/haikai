/**
 * Spec 2 (Stored Proc & Function Behaviour Program, 2026-09-09): the
 * Postgres routine invoker (per-shape dispatch, refcursor fetch order,
 * notice capture, error projection) and the v2 pair-ruleset additions
 * (selectors, envelope strategies). Offline, invented vocabulary.
 */

import {
  invokePostgresRoutine,
  projectPostgresError,
  type RoutineClient,
} from '../services/db/postgresRoutineInvoker';
import type { RoutineDescriptor, RoutineInvocationRequest } from '../services/db/routineEnvelope';
import {
  canonicalColumnType,
  compareWithRules,
  pairRulesetForSource,
  resetPairRulesetCacheForTest,
  rulesForDimension,
  type MigrationPairRule,
} from '../migrationPairRules';

function descriptor(partial: Partial<RoutineDescriptor>): RoutineDescriptor {
  return {
    shape: 'return_status',
    pg_schema: 'dbo',
    pg_function: 'upd_ledger_roll',
    args: [{ name: 'ledger_id', pg_type: 'integer', source_param: 'ledger_id', direction: 'in' }],
    out_params: [],
    refcursors: [],
    return_status_carriage: 'function_return',
    error_carriage_rule: 'SYBPG.PROC.ERR.001',
    session_profile_rule: 'SYBPG.PROC.SESSION.001',
    confidence: 'static',
    rules_cited: ['SYBPG.PROC.ABI.001'],
    ...partial,
  };
}

function request(d: RoutineDescriptor): RoutineInvocationRequest {
  return {
    schema_name: 'dbo',
    routine_name: 'upd_ledger_roll',
    routine_kind: 'procedure',
    params: [{ name: 'ledger_id', ordinal: 1, source_type: 'int', direction: 'in', value: 1042 }],
    return_status: true,
    session_set: ['set nocount off'],
    limits: { max_rows_per_result_set: 2, max_result_sets: 5, timeout_seconds: 30 },
    descriptor: d,
  };
}

class FakeClient implements RoutineClient {
  readonly calls: string[] = [];
  private noticeListener: ((m: { message?: string }) => void) | null = null;
  constructor(private readonly responses: Record<string, { rows: Array<Record<string, unknown>>; fields?: Array<{ name: string; dataTypeID?: number }> }>, private readonly failOn?: { pattern: RegExp; error: unknown }) {}
  async query(text: string, _values?: unknown[]) {
    this.calls.push(text);
    if (this.failOn && this.failOn.pattern.test(text)) throw this.failOn.error;
    if (/^SELECT \* FROM|^SELECT "dbo"/.test(text) && this.noticeListener) {
      this.noticeListener({ message: 'rolling ledger' });
    }
    for (const [key, res] of Object.entries(this.responses)) {
      if (text.startsWith(key)) return { rows: res.rows, rowCount: res.rows.length, fields: res.fields };
    }
    return { rows: [], rowCount: 0, fields: [] };
  }
  on(_event: 'notice', listener: (m: { message?: string }) => void) {
    this.noticeListener = listener;
    return this;
  }
  off() {
    this.noticeListener = null;
    return this;
  }
}

describe('invokePostgresRoutine — shapes', () => {
  it('return_status: SELECT fn() AS return_status inside BEGIN/COMMIT', async () => {
    const client = new FakeClient({ 'SELECT "dbo"."upd_ledger_roll"': { rows: [{ return_status: 2 }] } });
    const env = await invokePostgresRoutine(client, request(descriptor({})), { login: 'capture' });
    expect(env.outcome).toBe('success');
    expect(env.return_status).toBe(2);
    expect(client.calls[0]).toBe('BEGIN');
    expect(client.calls[client.calls.length - 1]).toBe('COMMIT');
    expect(client.calls.some((c) => c.includes('$1::integer'))).toBe(true);
    expect(env.messages.map((m) => m.text)).toEqual(['rolling ledger']);
    expect(env.messages[0].kind).toBe('notice');
  });

  it('single_result_set: rows + columns + per-set truncation', async () => {
    const d = descriptor({ shape: 'single_result_set', return_status_carriage: 'none' });
    const client = new FakeClient({
      'SELECT * FROM': {
        rows: [{ line_no: 1, amount: '10.00' }, { line_no: 2, amount: '20.00' }, { line_no: 3, amount: '30.00' }],
        fields: [{ name: 'line_no', dataTypeID: 23 }, { name: 'amount', dataTypeID: 1700 }],
      },
    });
    const env = await invokePostgresRoutine(client, request(d), { login: 'capture', typeName: (oid) => (oid === 23 ? 'int4' : 'numeric') });
    expect(env.result_sets).toHaveLength(1);
    expect(env.result_sets[0].columns).toEqual([{ name: 'line_no', type: 'int4' }, { name: 'amount', type: 'numeric' }]);
    expect(env.result_sets[0].rows).toEqual([[1, '10.00'], [2, '20.00']]);
    expect(env.result_sets[0].truncated).toBe(true);
    expect(env.return_status).toBe(0);
  });

  it('out_params: OUT columns land in output_params and return_status rides its OUT', async () => {
    const d = descriptor({
      shape: 'out_params',
      out_params: ['rows_done'],
      return_status_carriage: 'out_param',
      args: [
        { name: 'ledger_id', pg_type: 'integer', source_param: 'ledger_id', direction: 'in' },
        { name: 'rows_done', pg_type: 'integer', source_param: 'rows_done', direction: 'out' },
      ],
    });
    const client = new FakeClient({ 'SELECT * FROM': { rows: [{ rows_done: 7, return_status: -1 }] } });
    const env = await invokePostgresRoutine(client, request(d), { login: 'capture' });
    expect(env.output_params).toEqual({ rows_done: 7 });
    expect(env.return_status).toBe(-1);
  });

  it('rich: fetches every refcursor in descriptor order and keeps empty cursors as empty sets', async () => {
    const d = descriptor({ shape: 'rich', refcursors: ['rs1', 'rs2'], return_status_carriage: 'out_param' });
    const client = new FakeClient({
      'SELECT * FROM': { rows: [{ rs1: '<unnamed portal 1>', rs2: null, return_status: 0 }] },
      'FETCH ALL FROM': { rows: [{ ledger_id: 1042 }], fields: [{ name: 'ledger_id', dataTypeID: 23 }] },
    });
    const env = await invokePostgresRoutine(client, request(d), { login: 'capture' });
    expect(env.result_sets).toHaveLength(2);
    expect(env.result_sets[0].rows).toEqual([[1042]]);
    expect(env.result_sets[1]).toMatchObject({ ordinal: 2, rows: [], row_count: 0 });
    expect(client.calls.filter((c) => c.startsWith('FETCH ALL'))).toHaveLength(1);
  });

  it('projects a routine error (SQLSTATE + DETAIL source_error) and rolls back', async () => {
    const err = Object.assign(new Error('ledger id required'), {
      code: 'P0001',
      detail: '{"source_error": 20012, "severity": 16, "state": 1}',
    });
    const client = new FakeClient({}, { pattern: /upd_ledger_roll/, error: err });
    const env = await invokePostgresRoutine(client, request(descriptor({})), { login: 'capture' });
    expect(env.outcome).toBe('error');
    expect(env.error).toMatchObject({ number: 20012, sqlstate: 'P0001', severity: 16, state: 1 });
    expect(client.calls[client.calls.length - 1]).toBe('ROLLBACK');
  });

  it('refuses to run without a descriptor', async () => {
    const req = { ...request(descriptor({})), descriptor: null };
    await expect(invokePostgresRoutine(new FakeClient({}), req, { login: 'x' })).rejects.toThrow(/descriptor/);
  });

  it('projectPostgresError tolerates non-JSON DETAIL', () => {
    const e = projectPostgresError({ code: '23505', message: 'dup', detail: 'Key (id)=(1) already exists.', constraint: 'pk' });
    expect(e).toMatchObject({ number: null, sqlstate: '23505', constraint: 'pk' });
  });
});

describe('pair ruleset v2 — routine selectors and strategies', () => {
  beforeEach(() => resetPairRulesetCacheForTest());

  it('loads the repo ruleset as version 2 with the PROC family', () => {
    const rs = pairRulesetForSource('sybase');
    expect(rs).not.toBeNull();
    expect(rs?.version).toBe(2);
    const ids = (rs?.rules ?? []).map((r) => r.id);
    for (const id of [
      'SYBPG.PROC.ABI.001', 'SYBPG.PROC.ERR.001', 'SYBPG.PROC.MSG.001', 'SYBPG.PROC.RS.ORDER.001',
      'SYBPG.PROC.RS.COLNAME.001', 'SYBPG.PROC.RS.TYPE.001', 'SYBPG.PROC.TXN.001', 'SYBPG.PROC.VOL.001',
      'SYBPG.PROC.VOL.002', 'SYBPG.PROC.SESSION.001', 'SYBPG.PROC.CALLSITE.001',
    ]) {
      expect(ids).toContain(id);
    }
    const session = rs?.rules.find((r) => r.id === 'SYBPG.PROC.SESSION.001');
    expect(session?.session_profile?.set).toContain('set nocount off');
    const matrix = rs?.rules.find((r) => r.id === 'SYBPG.PROC.CALLSITE.001');
    expect(matrix?.matrix?.['single_result_set']?.['jdbc_call']).toBe('compatible');
  });

  it('rulesForDimension honours object kind and construct presence', () => {
    const rs = pairRulesetForSource('sybase')!;
    const clockRules = rulesForDimension(rs, 'result_set_cells', 'procedure', ['getdate']).map((r) => r.id);
    expect(clockRules).toContain('SYBPG.PROC.VOL.001');
    expect(clockRules).not.toContain('SYBPG.PROC.VOL.002');
    const noConstructs = rulesForDimension(rs, 'result_set_cells', 'procedure', []).map((r) => r.id);
    expect(noConstructs).not.toContain('SYBPG.PROC.VOL.001');
    expect(rulesForDimension(rs, 'outcome', 'trigger').map((r) => r.id)).toContain('SYBPG.PROC.ERR.001');
  });

  it('canonicalColumnType maps driver tokens onto the ruleset vocabulary', () => {
    const rs = pairRulesetForSource('sybase')!;
    expect(canonicalColumnType(rs, 'int4')).toBe('int');
    expect(canonicalColumnType(rs, 'TIMESTAMP')).toBe('datetime');
    expect(canonicalColumnType(rs, 'varchar(40)')).toBe('varchar');
    expect(canonicalColumnType(rs, 'exotic')).toBe('exotic');
  });

  it('timestamp-window and masked strategies compare by rule', () => {
    const windowRule: MigrationPairRule = {
      id: 'T.WIN', divergence_class: 'x', title: 'x',
      comparison: { strategy: 'timestamp-window', params: { window_ms: 60_000 } },
    };
    expect(compareWithRules('2026-09-09 10:00:00', '2026-09-09 10:00:30', [windowRule]).equal).toBe(true);
    expect(compareWithRules('2026-09-09 10:00:00', '2026-09-09 12:00:00', [windowRule]).equal).toBe(false);
    expect(compareWithRules(null, '2026-09-09 12:00:00', [windowRule]).equal).toBe(false);
    const maskedRule: MigrationPairRule = { id: 'T.MASK', divergence_class: 'x', title: 'x', comparison: { strategy: 'masked' } };
    expect(compareWithRules('a-uuid', 'another-uuid', [maskedRule]).equal).toBe(true);
    expect(compareWithRules(null, 'x', [maskedRule]).equal).toBe(false);
    const advisory: MigrationPairRule = { id: 'T.ADV', divergence_class: 'x', title: 'x', comparison: { strategy: 'advisory' } };
    const r = compareWithRules('a', 'b', [advisory]);
    expect(r.unknownStrategies).toEqual([]);
    expect(r.equal).toBe(false);
  });
});
