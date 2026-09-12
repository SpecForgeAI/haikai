/**
 * Spec 3 (Stored Proc & Function Behaviour Program, 2026-09-09): scenario
 * seeds, coverage floor, the proc tool loop, the tools, the orchestrator
 * with fakes (bracket, adapters, LLM, AMS client), and the baseline
 * builder. Offline, invented vocabulary.
 */

import { bindInputs, defaultRoutineScenarioPlan, enumerateExitOutcomes, mineParamDomains } from '../services/procCapture/routineScenarioSeeds';
import { assembleProcCoverageSummary, exitOutcomeOf, scoreRoutineCoverage } from '../services/procCapture/routineCoverageFloor';
import { runProcScenarioLoop, type ProcToolContext, type ProcToolEntry } from '../services/procCapture/procToolLoop';
import { PROC_TOOLS, executeRoutineTool, recordRoutineNoteTool, recordRoutineScenarioTool } from '../services/procCapture/procTools';
import { diffEnvelopes, orchestrateProcCaptureSession, orderCalleesFirst, procRunRegistry } from '../services/procCapture/procCaptureOrchestrator';
import { buildBaselineItems } from '../services/procCapture/procBaseline';
import type { ProcBehaviourClientSurface } from '../services/procBehaviourClient';
import type { ProcCaptureDto, ProcCaptureSessionDto, ProcDiagnosticDto, ProcScenarioDto, RoutineCatalogRow } from '../services/procCapture/types';
import type { RoutineInvocationEnvelope } from '../services/db/routineEnvelope';
import type { DbAdapter } from '../services/db/DbAdapter';

const BODY = `
create proc dbo.upd_ledger_roll @ledger_id int, @as_of datetime = null, @rows_done int output as
begin
  if @ledger_id is null begin raiserror 20012 'ledger id required' return -1 end
  update ledger_ctrl set last_roll = getdate() where ledger_id = @ledger_id
  if @@rowcount = 0 begin raiserror(20013, 16, 1, 'no ledger row') return 2 end
  select l.ledger_id, l.line_no from ledger_line l where l.ledger_id = @ledger_id order by l.line_no
  return 0
end`;

function routine(partial: Partial<RoutineCatalogRow> = {}): RoutineCatalogRow {
  return {
    id: 'r-roll',
    schema_name: 'dbo',
    routine_name: 'upd_ledger_roll',
    routine_kind: 'procedure',
    full_body: BODY,
    body_hash: 'hash-roll',
    params_json: [
      { name: 'ledger_id', ordinal: 1, source_type: 'int', direction: 'in', default_literal: null },
      { name: 'as_of', ordinal: 2, source_type: 'datetime', direction: 'in', default_literal: 'null' },
      { name: 'rows_done', ordinal: 3, source_type: 'int', direction: 'output', default_literal: null },
    ],
    profile_json: {
      return_sites: [{ value: -1, expr: null }, { value: 2, expr: null }, { value: 0, expr: null }],
      return_status_trivial: false,
      raiserror_sites: [{ number: 20012, severity: null, text_preview: 'ledger id required' }, { number: 20013, severity: 16, text_preview: 'no ledger row' }],
      result_selects: [{ ordinal: 1, has_order_by: true, has_top: false, select_list_static: 'l.ledger_id, l.line_no' }],
      max_result_sets: 1,
      constructs: ['set_nocount'],
      volatile_functions: ['getdate'],
      session_user_functions: [],
      non_compensatable_reasons: [],
      set_options: [],
    },
    reads_json: ['ledger_line'],
    writes_json: ['ledger_ctrl'],
    proc_calls_json: [],
    reads_closure_json: ['ledger_line'],
    writes_closure_json: ['ledger_ctrl'],
    trigger_expanded_writes_json: [],
    signature_parsed: true,
    ...partial,
  };
}

function envelope(partial: Partial<RoutineInvocationEnvelope> = {}): RoutineInvocationEnvelope {
  return {
    outcome: 'success',
    return_status: 0,
    output_params: { rows_done: 3 },
    result_sets: [{ ordinal: 1, columns: [{ name: 'ledger_id', type: 'int' }, { name: 'line_no', type: 'int' }], rows: [[1042, 1], [1042, 2]], row_count: 2, truncated: false }],
    update_counts: [1],
    messages: [],
    error: null,
    timing_ms: 5,
    session: { login: 'capture', set_options: [] },
    ...partial,
  };
}

describe('routine scenario seeds', () => {
  it('mines parameter domains from qualified and unqualified comparisons', () => {
    const domains = mineParamDomains(routine());
    const ledger = domains.find((d) => d.param === 'ledger_id');
    expect(ledger?.candidates).toEqual(expect.arrayContaining([
      { table: 'ledger_ctrl', column: 'ledger_id' },
      { table: 'ledger_line', column: 'ledger_id' },
    ]));
    expect(domains.find((d) => d.param === 'as_of')?.candidates).toEqual([]);
  });

  it('enumerates exit outcomes and builds a floor-bearing plan per outcome + seeded families', () => {
    expect(enumerateExitOutcomes(routine())).toEqual(['success', 'return:-1', 'return:2', 'error:20012', 'error:20013']);
    const plans = defaultRoutineScenarioPlan(routine());
    const names = plans.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['happy_path', 'raiserror_20012', 'raiserror_20013', 'return_neg1', 'return_2', 'zero_rows', 'null_params', 'boundary_values']));
    expect(plans.filter((p) => p.floor_bearing).map((p) => p.name)).not.toContain('null_params');
    expect(plans.find((p) => p.name === 'happy_path')?.seed_inputs).toEqual([
      { name: 'ledger_id', value: 1, is_null: false },
      { name: 'as_of', value: '2026-01-15 09:30:00.000', is_null: false },
    ]);
  });

  it('binds inputs in declaration order, applying defaults and rejecting unknown names', () => {
    const ok = bindInputs(routine().params_json, [{ name: 'ledger_id', value: 7 }]);
    expect(ok.ok && ok.bound.map((b) => [b.name, b.value])).toEqual([['ledger_id', 7], ['as_of', null], ['rows_done', null]]);
    const bad = bindInputs(routine().params_json, [{ name: 'nope', value: 1 }]);
    expect(bad.ok).toBe(false);
  });
});

describe('coverage floor', () => {
  const scenarios: ProcScenarioDto[] = [
    { id: 's1', session_id: 'sess', routine_id: 'r-roll', scenario_name: 'happy_path', scenario_type: 'happy_path', generation_source: 'llm_generated', inputs_json: [], status: 'fired' },
    { id: 's2', session_id: 'sess', routine_id: 'r-roll', scenario_name: 'raiserror_20012', scenario_type: 'error_path', generation_source: 'llm_generated', inputs_json: [], status: 'fired' },
    { id: 's3', session_id: 'sess', routine_id: 'r-roll', scenario_name: 'zero_rows', scenario_type: 'zero_rows', generation_source: 'llm_generated', inputs_json: [], status: 'fired' },
  ];
  const capture = (scenario_id: string, env: RoutineInvocationEnvelope, accepted = true): ProcCaptureDto => ({
    session_id: 'sess', scenario_id, routine_id: 'r-roll', attempt_number: 1, envelope_json: env, accepted,
  });

  it('classifies exit outcomes from envelopes', () => {
    expect(exitOutcomeOf(envelope())).toBe('success');
    expect(exitOutcomeOf(envelope({ return_status: 2 }))).toBe('return:2');
    expect(exitOutcomeOf(envelope({ outcome: 'error', error: { number: 20012, sqlstate: null, severity: 16, state: 1, message: 'x' } }))).toBe('error:20012');
    expect(exitOutcomeOf({ steps: [envelope(), envelope({ return_status: -1 })] })).toBe('return:-1');
  });

  it('is not met until every static outcome and seeded family is observed', () => {
    const partial = scoreRoutineCoverage(routine(), scenarios, [capture('s1', envelope()), capture('s2', envelope({ outcome: 'error', error: { number: 20012, sqlstate: null, severity: 16, state: 1, message: 'x' } }))]);
    expect(partial.bucket).toBe('not_exercised');
    expect(partial.missing).toEqual(['error:20013', 'family:zero_rows', 'return:-1', 'return:2']);
    const full = scoreRoutineCoverage(routine(), scenarios, [
      capture('s1', envelope()),
      capture('s2', envelope({ outcome: 'error', error: { number: 20012, sqlstate: null, severity: 16, state: 1, message: 'x' } })),
      capture('s2', envelope({ outcome: 'error', error: { number: 20013, sqlstate: null, severity: 16, state: 1, message: 'y' } })),
      capture('s1', envelope({ return_status: -1 })),
      capture('s3', envelope({ return_status: 2 })),
    ]);
    expect(full.bucket).toBe('verified');
    expect(full.floor_met).toBe(true);
    const unaccepted = scoreRoutineCoverage(routine(), scenarios, [capture('s1', envelope(), false)]);
    expect(unaccepted.captures_accepted).toBe(0);
    const summary = assembleProcCoverageSummary([full, partial, scoreRoutineCoverage(routine({ id: 'x' }), [], [], { excluded: true })]);
    expect(summary).toMatchObject({ routines_in_scope: 3, verified: 1, not_exercised: 1, excluded: 1 });
  });
});

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeClient implements ProcBehaviourClientSurface {
  routines: RoutineCatalogRow[] = [routine()];
  session: ProcCaptureSessionDto = {
    id: 'sess', project_id: 'p', architecture_id: 'a', name: 'n', status: 'configured', kind: 'current',
    db_config_redacted_json: { dbType: 'sybase', host: 'h', port: 5000, database: 'd', username: 'capture' },
    capture_tuning_json: { quiet_window_seconds: 0, attempts_per_scenario: 3 },
  };
  scenarios: ProcScenarioDto[] = [];
  captures: ProcCaptureDto[] = [];
  diagnostics: ProcDiagnosticDto[] = [];
  patches: Array<Partial<ProcCaptureSessionDto>> = [];
  baselines: unknown[] = [];
  async listRoutines() { return this.routines; }
  async saveProcParityReport() { return { id: 'ppr-1' }; }
  async getSession() { return this.session; }
  async patchSession(_p: string, _a: string, _s: string, patch: Partial<ProcCaptureSessionDto>) { this.patches.push(patch); this.session = { ...this.session, ...patch }; return this.session; }
  async upsertScenarios(_p: string, _a: string, _s: string, scenarios: ProcScenarioDto[]) {
    const out: ProcScenarioDto[] = [];
    for (const s of scenarios) {
      const existing = this.scenarios.find((x) => x.routine_id === s.routine_id && x.scenario_name === s.scenario_name);
      if (existing) { Object.assign(existing, s, { id: existing.id }); out.push(existing); }
      else { const saved = { ...s, id: `sc-${this.scenarios.length + 1}` }; this.scenarios.push(saved); out.push(saved); }
    }
    return out;
  }
  async listScenarios() { return this.scenarios; }
  async createCaptures(_p: string, _a: string, _s: string, captures: ProcCaptureDto[]) {
    const out = captures.map((c, i) => ({ ...c, id: `cap-${this.captures.length + i + 1}` }));
    this.captures.push(...out);
    return out;
  }
  async listCaptures() { return this.captures; }
  async createDiagnostics(_p: string, _a: string, _s: string, d: ProcDiagnosticDto[]) { this.diagnostics.push(...d); return d; }
  async listDiagnostics() { return this.diagnostics; }
  async createBaseline(_p: string, _a: string, body: unknown) { this.baselines.push(body); return { id: 'b1', project_id: 'p', architecture_id: 'a', name: 'b', status: 'draft' as const, kind: 'current' as const, routine_count: 1, scenario_count: 1 }; }
  async pinBaseline() { return { id: 'b1', project_id: 'p', architecture_id: 'a', name: 'b', status: 'pinned' as const, kind: 'current' as const, routine_count: 1, scenario_count: 1 }; }
  async getPinnedBaseline() { return null; }
  async listBaselineItems() { return []; }
}

function fakeAdapter(envelopes: RoutineInvocationEnvelope[] | ((n: number) => RoutineInvocationEnvelope)): DbAdapter & { calls: number } {
  const adapter = {
    calls: 0,
    testConnection: async () => ({ success: true as const }),
    listMetadata: async () => [],
    runReadonlySelect: async () => ({ rows: [{ ledger_id: 1042 }], rowCount: 1, truncated: false }),
    sampleValues: async () => ({ rows: [{ ledger_id: 1042 }], rowCount: 1, truncated: false }),
    countRows: async () => 0,
    fetchOrderedRows: async () => ({ rows: [], rowCount: 0, truncated: false }),
    callRoutine: async () => {
      adapter.calls += 1;
      return typeof envelopes === 'function' ? envelopes(adapter.calls) : envelopes[Math.min(adapter.calls - 1, envelopes.length - 1)];
    },
    dispose: async () => undefined,
  };
  return adapter as unknown as DbAdapter & { calls: number };
}

/** Scripted LLM: record the plan's seed scenario, fire it, close ok. */
function scriptedGateway(): { callLlmToolLoop: (args: { messages: Array<{ role: string; content: string | null }> }) => Promise<{ message: { role: 'assistant'; content: null; tool_calls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> } }> } {
  let step = 0;
  return {
    callLlmToolLoop: async (args) => {
      const user = args.messages.find((m) => m.role === 'user');
      const payload = JSON.parse(user?.content ?? '{}') as { scenario: { name: string; type: string; seed_inputs: unknown[] | null } };
      const lastTool = [...args.messages].reverse().find((m) => m.role === 'tool');
      const lastResult = lastTool?.content ? (JSON.parse(lastTool.content) as Record<string, unknown>) : {};
      step = args.messages.filter((m) => m.role === 'assistant').length;
      const call = (name: string, a: Record<string, unknown>) => ({
        message: { role: 'assistant' as const, content: null, tool_calls: [{ id: `c${step}`, type: 'function' as const, function: { name, arguments: JSON.stringify(a) } }] },
      });
      if (step === 0) return call('get_routine_context', {});
      if (step === 1) {
        return call('record_routine_scenario', {
          scenarioName: payload.scenario.name,
          scenarioType: payload.scenario.type,
          inputs: payload.scenario.seed_inputs ?? [{ name: 'ledger_id', value: 1042 }],
        });
      }
      if (step === 2) return call('execute_routine', { scenarioId: lastResult.scenario_id });
      return call('record_routine_note', { diagnosticType: 'captured_ok', message: 'done' });
    },
  };
}

describe('proc tool loop + tools', () => {
  it('drives record -> execute -> note, research rounds free, terminal ends the loop', async () => {
    const client = new FakeClient();
    const fired: string[] = [];
    const ctx: ProcToolContext = {
      projectId: 'p', architectureId: 'a', sessionId: 'sess', routine: routine(), routinesByName: new Map([['upd_ledger_roll', routine()]]),
      dbAdapter: fakeAdapter([envelope()]), limits: { maxRows: 10, timeoutSeconds: 5 },
      plan: defaultRoutineScenarioPlan(routine())[0], currentScenarioId: null, attemptsFired: 0, attemptsBudget: 3, learnedFacts: [], client,
      fire: async ({ scenario }) => { fired.push(scenario.scenario_name); return { capture_id: 'cap-1', envelopes: [envelope()], state_delta: null, bracket: 'compensated', accepted: true, refused_reason: null }; },
      noteSink: { last: null },
    };
    const outcome = await runProcScenarioLoop({
      context: ctx, initialMessages: [{ role: 'system', content: 'x' }, { role: 'user', content: JSON.stringify({ scenario: { name: 'happy_path', type: 'happy_path', seed_inputs: [{ name: 'ledger_id', value: 1042 }] } }) }],
      tools: PROC_TOOLS, gatewayClient: scriptedGateway(), roundLimit: 5, researchRoundCeiling: 20, toolCallTimeoutMs: 5000, scenarioWallClockMs: 60000,
    });
    expect(outcome.reason).toBe('completed');
    expect(outcome.researchRounds).toBe(1);
    expect(fired).toEqual(['happy_path']);
    expect(client.scenarios[0]).toMatchObject({ scenario_name: 'happy_path', inputs_json: [{ name: 'ledger_id', value: 1042, is_null: false }] });
    expect(ctx.noteSink.last).toBe('captured_ok');
    expect(ctx.attemptsFired).toBe(1);
  });

  it('refuses execution before a scenario is recorded and enforces the attempt budget', async () => {
    const client = new FakeClient();
    const ctx = { projectId: 'p', architectureId: 'a', sessionId: 'sess', routine: routine(), routinesByName: new Map(), dbAdapter: null, limits: { maxRows: 1, timeoutSeconds: 1 }, plan: defaultRoutineScenarioPlan(routine())[0], currentScenarioId: null, attemptsFired: 3, attemptsBudget: 3, learnedFacts: [], client, fire: async () => { throw new Error('no'); }, noteSink: { last: null } } as ProcToolContext;
    await expect(executeRoutineTool.handler({}, ctx)).rejects.toThrow(/Record the scenario/);
    await expect(executeRoutineTool.handler({ scenarioId: 'x' }, ctx)).rejects.toThrow(/budget/);
  });

  it('record_routine_scenario validates parameter names and sequence steps; the note tool writes diagnostics for non-ok closes', async () => {
    const client = new FakeClient();
    const ctx = { projectId: 'p', architectureId: 'a', sessionId: 'sess', routine: routine(), routinesByName: new Map([['upd_ledger_roll', routine()]]), dbAdapter: null, limits: { maxRows: 1, timeoutSeconds: 1 }, plan: defaultRoutineScenarioPlan(routine())[0], currentScenarioId: null, attemptsFired: 0, attemptsBudget: 3, learnedFacts: [], client, fire: async () => { throw new Error('no'); }, noteSink: { last: null } } as ProcToolContext;
    await expect(recordRoutineScenarioTool.handler({ scenarioName: 'x', scenarioType: 'happy_path', inputs: [{ name: 'ghost', value: 1 }] }, ctx)).rejects.toThrow(/unknown parameter/);
    await expect(recordRoutineScenarioTool.handler({ scenarioName: 'seq', scenarioType: 'sequence', inputs: [], steps: [{ routine: 'nope', inputs: [] }] }, ctx)).rejects.toThrow(/not in the catalog/);
    const seq = (await recordRoutineScenarioTool.handler({ scenarioName: 'seq', scenarioType: 'sequence', inputs: [], steps: [{ routine: 'dbo.upd_ledger_roll', inputs: [{ name: 'ledger_id', value: 1 }] }] }, ctx)) as { scenario_id: string };
    expect(seq.scenario_id).toBe('sc-1');
    expect(client.scenarios[0].sequence_json).toEqual([{ routine_id: 'r-roll', inputs: [{ name: 'ledger_id', value: 1, is_null: false }] }]);
    await recordRoutineNoteTool.handler({ diagnosticType: 'not_possible', message: 'no data' }, ctx);
    expect(client.diagnostics[0]).toMatchObject({ diagnostic_type: 'not_possible', routine_id: 'r-roll' });
  });
});

describe('orchestrator', () => {
  const secrets = () => ({ sessionId: 'sess', api: { type: 'none' as const }, db: { password: 'pw' }, loadedAt: 0 });

  it('S0 re-pin is the run\u2019s first phase (2026-09-12): a failed re-pin fails the run with an s0_not_pinned diagnostic; a successful one records s0_repinned and continues', async () => {
    const client = new FakeClient();
    const failing = jest.fn().mockResolvedValue({ status: 'failed', snapshotId: null, detail: 'no committed table metadata' });
    const failed = await orchestrateProcCaptureSession(
      { projectId: 'p', architectureId: 'a', sessionId: 'sess', repinS0: true },
      { client, secrets, ensurePinned: failing as never, createAdapter: (() => { throw new Error('must not connect'); }) as never },
    );
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('S0 not pinned: no committed table metadata');
    expect(failing.mock.calls[0][0]).toEqual(expect.objectContaining({ reason: 'proc_capture_start', config: expect.objectContaining({ password: 'pw' }) }));
    expect(client.diagnostics.some((d) => d.diagnostic_type === 's0_not_pinned' && d.message.includes('no committed table metadata'))).toBe(true);
    expect(client.session.status).toBe('failed');

    const client2 = new FakeClient();
    const pinning = jest.fn().mockResolvedValue({ status: 'pinned', snapshotId: 's0-new', detail: 're-pinned now from the committed model: 65 tables.' });
    const continued = await orchestrateProcCaptureSession(
      { projectId: 'p', architectureId: 'a', sessionId: 'sess', repinS0: true },
      { client: client2, secrets, ensurePinned: pinning as never, createAdapter: (() => { throw new Error('stop-here'); }) as never },
    );
    // The run got PAST the pin (it failed later, at our sentinel adapter).
    expect(continued.error).toContain('stop-here');
    expect(client2.diagnostics.some((d) => d.diagnostic_type === 's0_repinned' && d.detail_json?.snapshot_id === 's0-new')).toBe(true);

    // Without the flag nothing is pinned.
    const untouched = jest.fn();
    await orchestrateProcCaptureSession(
      { projectId: 'p', architectureId: 'a', sessionId: 'sess' },
      { client: new FakeClient(), secrets, ensurePinned: untouched as never, createAdapter: (() => { throw new Error('stop-here'); }) as never },
    );
    expect(untouched).not.toHaveBeenCalled();
  });
  const compensation = (writeAdapter = {}) => async () => ({
    context: { engine: 'sybase' as const, schema: null, effectScope: {} as never, metadata: { byTable: new Map() } as never, readAdapter: {} as never, writeAdapter: writeAdapter as never },
    inactiveReason: null,
  });

  it('fires every planned scenario inside the bracket, double-fires volatile routines, scores coverage and completes', async () => {
    const client = new FakeClient();
    const adapter = fakeAdapter((n) => envelope({ result_sets: [{ ordinal: 1, columns: [{ name: 'ledger_id', type: 'int' }, { name: 'stamp', type: 'datetime' }], rows: [[1042, `2026-09-09 10:00:0${n}`]], row_count: 1, truncated: false }] }));
    const brackets: string[][] = [];
    const runBracket = async (args: { tables: string[]; readTables?: string[]; fire: () => Promise<unknown> }) => {
      brackets.push([...args.tables, ...(args.readTables ?? [])]);
      const fireResult = await args.fire();
      return { outcome: { kind: 'compensated' }, fired: true, fireResult, fireError: null };
    };
    const outcome = await orchestrateProcCaptureSession(
      { projectId: 'p', architectureId: 'a', sessionId: 'sess' },
      {
        client, secrets, createAdapter: () => adapter, buildCompensation: compensation() as never, runBracket: runBracket as never,
        snapshotTables: async () => ({ tables: [] }), quietWindow: null, endOfJobFingerprint: async () => ({ status: 'verified', snapshotId: 's0-1', report: null }) as never,
        gatewayClient: scriptedGateway(), sessionSetResolver: () => ['set nocount off'],
      },
    );
    expect(outcome.status).toBe('completed_with_findings');
    const plans = defaultRoutineScenarioPlan(routine());
    expect(outcome.scenariosFired).toBe(plans.length);
    // Every fire ran inside a bracket sized from the write closure + reads.
    expect(brackets.every((b) => b.includes('ledger_ctrl') && b.includes('ledger_line'))).toBe(true);
    // Volatile routine (getdate): each scenario fired twice; the differing cell is evidence.
    expect(adapter.calls).toBe(plans.length * 2);
    expect(client.captures[0].volatile_cells_json).toEqual([{ where: 'result_set', result_set: 1, row: 0, column: 'stamp' }]);
    expect(client.captures.every((c) => c.accepted)).toBe(true);
    // The scripted LLM only ever produces the success outcome (it fires the
    // zero_rows plan too, which exercises that family), so the RETURN /
    // RAISERROR outcomes stay missing and the floor is honestly unmet.
    const floor = client.diagnostics.filter((d) => d.diagnostic_type === 'coverage_floor_unmet');
    expect(floor).toHaveLength(1);
    expect(outcome.coverage?.per_routine[0].bucket).toBe('not_exercised');
    expect(outcome.coverage?.per_routine[0].achieved).toEqual(['family:zero_rows', 'success']);
    expect(outcome.coverage?.per_routine[0].missing).toEqual(['error:20012', 'error:20013', 'return:-1', 'return:2']);
    const final = client.patches[client.patches.length - 1];
    expect(final.status).toBe('completed_with_findings');
    expect(final.s0_fingerprint_json).toMatchObject({ status: 'verified', snapshot_id: 's0-1' });
    expect(procRunRegistry.has('sess')).toBe(false);
  });

  it('refuses non-compensatable routines before firing and marks them unverifiable', async () => {
    const client = new FakeClient();
    client.routines = [routine({ profile_json: { ...routine().profile_json, non_compensatable_reasons: ['dynamic_sql'], volatile_functions: [] } })];
    const adapter = fakeAdapter([envelope()]);
    const outcome = await orchestrateProcCaptureSession(
      { projectId: 'p', architectureId: 'a', sessionId: 'sess' },
      { client, secrets, createAdapter: () => adapter, buildCompensation: compensation() as never, runBracket: (async () => { throw new Error('must not fire'); }) as never, quietWindow: null, endOfJobFingerprint: null, gatewayClient: scriptedGateway() },
    );
    expect(adapter.calls).toBe(0);
    expect(client.diagnostics.some((d) => d.diagnostic_type === 'non_compensatable' && /dynamic_sql/.test(d.message))).toBe(true);
    expect(outcome.coverage?.per_routine[0]).toMatchObject({ bucket: 'unverifiable', unverifiable_reason: 'non_compensatable:dynamic_sql' });
  });

  it('fails closed on writing routines when compensation is inactive, but still captures write-free routines', async () => {
    const client = new FakeClient();
    client.routines = [
      routine({ profile_json: { ...routine().profile_json, volatile_functions: [] } }),
      routine({ id: 'r-fn', routine_name: 'fn_roll_total', routine_kind: 'function', writes_json: [], writes_closure_json: [], reads_closure_json: [], profile_json: { max_result_sets: 0, return_status_trivial: true, return_sites: [], raiserror_sites: [], result_selects: [], constructs: [], volatile_functions: [], non_compensatable_reasons: [] }, params_json: [{ name: 'ledger_id', ordinal: 1, source_type: 'int', direction: 'in', default_literal: null }], returns_type: 'numeric(18,2)' }),
    ];
    const adapter = fakeAdapter([envelope({ result_sets: [], output_params: { return_value: '10.50' } })]);
    const outcome = await orchestrateProcCaptureSession(
      { projectId: 'p', architectureId: 'a', sessionId: 'sess' },
      { client, secrets, createAdapter: () => adapter, buildCompensation: (async () => ({ context: null, inactiveReason: 'model_unavailable' })) as never, quietWindow: null, endOfJobFingerprint: null, gatewayClient: scriptedGateway(), latestSnapshot: () => 's0-1' },
    );
    const byId = new Map(outcome.coverage?.per_routine.map((r) => [r.routine_id, r]));
    expect(byId.get('r-roll')).toMatchObject({ bucket: 'unverifiable', unverifiable_reason: 'compensation_inactive' });
    expect(byId.get('r-fn')?.bucket).toBe('verified');
    expect(client.captures.every((c) => c.routine_id === 'r-fn' && c.bracket_outcome === 'unbracketed')).toBe(true);
  });

  it('orders callees first and diffs envelopes cell-wise', () => {
    const a = routine({ id: 'a', routine_name: 'caller', proc_calls_json: ['callee'] });
    const b = routine({ id: 'b', routine_name: 'callee', proc_calls_json: [] });
    expect(orderCalleesFirst([a, b]).map((r) => r.routine_name)).toEqual(['callee', 'caller']);
    const cells = diffEnvelopes([envelope({ return_status: 0, output_params: { rows_done: 3 } })], [envelope({ return_status: 1, output_params: { rows_done: 4 } })]);
    expect(cells).toEqual([{ where: 'return_status' }, { where: 'output_param', param: 'rows_done' }]);
  });
});

describe('baseline builder', () => {
  it('emits one item per fired scenario from the first accepted capture, keyed by body hash', () => {
    const scenarios: ProcScenarioDto[] = [
      { id: 's1', session_id: 'sess', routine_id: 'r-roll', scenario_name: 'happy_path', scenario_type: 'happy_path', generation_source: 'llm_generated', inputs_json: [{ name: 'ledger_id', value: 1042, is_null: false }], status: 'fired' },
      { id: 's2', session_id: 'sess', routine_id: 'r-roll', scenario_name: 'unfired', scenario_type: 'boundary', generation_source: 'llm_generated', inputs_json: [], status: 'proposed' },
    ];
    const captures: ProcCaptureDto[] = [
      { id: 'c0', session_id: 'sess', scenario_id: 's1', routine_id: 'r-roll', attempt_number: 2, envelope_json: envelope({ return_status: 9 }), accepted: true },
      { id: 'c1', session_id: 'sess', scenario_id: 's1', routine_id: 'r-roll', attempt_number: 1, envelope_json: envelope(), accepted: true, volatile_cells_json: [{ where: 'return_status' }] },
      { id: 'c2', session_id: 'sess', scenario_id: 's2', routine_id: 'r-roll', attempt_number: 1, envelope_json: envelope(), accepted: false },
    ];
    const items = buildBaselineItems([routine()], scenarios, captures);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ routine_id: 'r-roll', routine_body_hash: 'hash-roll', scenario_name: 'happy_path', exit_outcome: 'success', volatile_cells_json: [{ where: 'return_status' }] });
  });
});
