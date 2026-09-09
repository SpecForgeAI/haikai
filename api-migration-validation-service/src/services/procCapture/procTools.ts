/**
 * Tools for the routine scenario loop (Spec 3, 2026-09-09).
 *
 *   get_routine_context      research  — body, signature, profile, plan, param domains
 *   sample_routine_db_values research  — distinct values of one column (bounded)
 *   run_routine_readonly_sql research  — one SELECT (bounded, guarded)
 *   record_routine_scenario            — persist the scenario (inputs / steps) before firing
 *   execute_routine                    — fire the recorded scenario inside the bracket
 *   record_routine_note      terminal  — close the scenario honestly
 *
 * The source is the specification; the LLM proposes inputs, the tool
 * executes deterministically, the orchestrator owns state discipline.
 */

import { ToolValidationError } from '../tools/toolTypes';
import { assertReadonlySelect } from '../db/sqlGuard';
import { ProcAttemptBudgetExhausted, type ProcToolContext, type ProcToolEntry } from './procToolLoop';
import { bindInputs, mineParamDomains, enumerateExitOutcomes } from './routineScenarioSeeds';
import type { ProcDiagnosticType, ProcScenarioInput, ProcScenarioType, ProcSequenceStep } from './types';

const SCENARIO_TYPES: ReadonlySet<ProcScenarioType> = new Set([
  'happy_path', 'error_path', 'zero_rows', 'boundary', 'null_param', 'default_param', 'business_edge', 'sequence',
]);

const NOTE_TYPES: ReadonlySet<string> = new Set([
  'captured_ok', 'captured_as_error', 'not_possible', 'routine_skipped',
]);

const BODY_CAP = 64 * 1024;

export const getRoutineContextTool: ProcToolEntry = {
  name: 'get_routine_context',
  description:
    'The routine under capture: its FULL source body (the specification), parsed signature, static profile (exit outcomes, result-producing SELECTs, constructs), referenced tables, the parameter → column domains mined from the body, and the scenario plan you must exercise.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  research: true,
  handler: async (_args, ctx) => {
    const r = ctx.routine;
    return {
      routine: {
        name: `${r.schema_name}.${r.routine_name}`,
        kind: r.routine_kind,
        returns_type: r.returns_type ?? null,
        signature: (r.params_json ?? []).map((p) => ({
          name: `@${p.name}`,
          type: p.source_type,
          direction: p.direction,
          default: p.default_literal,
        })),
        exit_outcomes: enumerateExitOutcomes(r),
        profile: r.profile_json,
        reads: r.reads_closure_json ?? r.reads_json ?? [],
        writes: r.writes_closure_json ?? r.writes_json ?? [],
        calls: r.proc_calls_json ?? [],
        body: (r.full_body ?? '').slice(0, BODY_CAP),
        body_truncated_for_prompt: (r.full_body ?? '').length > BODY_CAP,
      },
      param_domains: mineParamDomains(r),
      scenario: {
        name: ctx.plan.name,
        type: ctx.plan.type,
        directive: ctx.plan.directive,
        target_outcome: ctx.plan.target_outcome,
        seed_inputs: ctx.plan.seed_inputs,
      },
      learned_facts: ctx.learnedFacts.slice(-20),
      attempts: { fired: ctx.attemptsFired, budget: ctx.attemptsBudget },
    };
  },
};

export const sampleRoutineDbValuesTool: ProcToolEntry = {
  name: 'sample_routine_db_values',
  description: 'Return up to N distinct values from ONE column (read-only, bounded). Use it to resolve REAL parameter values from the columns the routine compares its parameters against.',
  parameters: {
    type: 'object',
    properties: {
      schema: { type: 'string', description: 'Optional schema name.' },
      table: { type: 'string' },
      column: { type: 'string' },
      where: { type: 'string', description: 'Optional literal SQL predicate (no parameters).' },
    },
    required: ['table', 'column'],
    additionalProperties: false,
  },
  research: true,
  handler: async (args, ctx) => {
    if (!ctx.dbAdapter) throw new ToolValidationError('sample_routine_db_values', 'db_not_configured', 'No database adapter is configured for this session.');
    const table = String(args.table ?? '');
    const column = String(args.column ?? '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) {
      throw new ToolValidationError('sample_routine_db_values', 'bad_identifier', 'table and column must be plain identifiers.');
    }
    const where = typeof args.where === 'string' && args.where.trim().length > 0 ? { sql: args.where.trim(), params: [] } : null;
    const res = await ctx.dbAdapter.sampleValues({
      schema: typeof args.schema === 'string' ? args.schema : ctx.routine.schema_name,
      table,
      column,
      limits: ctx.limits,
      where,
    });
    return { table, column, rows: res.rows, row_count: res.rowCount, truncated: res.truncated };
  },
};

export const runRoutineReadonlySqlTool: ProcToolEntry = {
  name: 'run_routine_readonly_sql',
  description: 'Run ONE read-only SELECT (bounded rows/timeout). Literal SQL only — no parameters. Never EXEC/CALL: use execute_routine to invoke the routine.',
  parameters: {
    type: 'object',
    properties: { sql: { type: 'string' } },
    required: ['sql'],
    additionalProperties: false,
  },
  research: true,
  handler: async (args, ctx) => {
    if (!ctx.dbAdapter) throw new ToolValidationError('run_routine_readonly_sql', 'db_not_configured', 'No database adapter is configured for this session.');
    const sql = String(args.sql ?? '');
    assertReadonlySelect(sql);
    const res = await ctx.dbAdapter.runReadonlySelect(sql, [], ctx.limits);
    return { rows: res.rows, row_count: res.rowCount, truncated: res.truncated };
  },
};

function parseInputs(raw: unknown): ProcScenarioInput[] {
  if (!Array.isArray(raw)) return [];
  const out: ProcScenarioInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.replace(/^@/, '') : '';
    if (!name) continue;
    const isNull = rec.value === null || rec.value === undefined || rec.is_null === true;
    out.push({ name, value: isNull ? null : rec.value, is_null: isNull });
  }
  return out;
}

export const recordRoutineScenarioTool: ProcToolEntry = {
  name: 'record_routine_scenario',
  description:
    'Persist the scenario you are about to fire: a name, a type, the input values per parameter (by name, without @), and optionally ordered STEPS for a multi-routine sequence (each step: routine name + inputs). Returns the scenario id execute_routine needs.',
  parameters: {
    type: 'object',
    properties: {
      scenarioName: { type: 'string' },
      scenarioType: { type: 'string', enum: [...SCENARIO_TYPES] },
      inputs: {
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' }, value: {}, is_null: { type: 'boolean' } }, required: ['name'] },
      },
      steps: {
        type: 'array',
        description: 'Optional ordered sequence: each step names a routine (bare name) and its inputs; the LAST step must be this routine.',
        items: { type: 'object', properties: { routine: { type: 'string' }, inputs: { type: 'array' } }, required: ['routine'] },
      },
      notes: { type: 'string' },
    },
    required: ['scenarioName', 'scenarioType', 'inputs'],
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const scenarioName = typeof args.scenarioName === 'string' ? args.scenarioName.trim() : '';
    if (!scenarioName) throw new ToolValidationError('record_routine_scenario', 'missing_args', 'scenarioName is required.');
    const scenarioType: ProcScenarioType = SCENARIO_TYPES.has(args.scenarioType as ProcScenarioType) ? (args.scenarioType as ProcScenarioType) : 'business_edge';
    const inputs = parseInputs(args.inputs);
    const bound = bindInputs(ctx.routine.params_json ?? [], inputs);
    if (!bound.ok) throw new ToolValidationError('record_routine_scenario', 'bad_inputs', bound.error);
    let steps: ProcSequenceStep[] | null = null;
    if (Array.isArray(args.steps) && args.steps.length > 0) {
      steps = [];
      for (const raw of args.steps as unknown[]) {
        const rec = (raw ?? {}) as Record<string, unknown>;
        const name = typeof rec.routine === 'string' ? rec.routine.split('.').pop()?.toLowerCase() ?? '' : '';
        const routine = ctx.routinesByName.get(name);
        if (!routine) throw new ToolValidationError('record_routine_scenario', 'unknown_step_routine', `Sequence step routine '${name}' is not in the catalog.`);
        const stepInputs = parseInputs(rec.inputs);
        const b = bindInputs(routine.params_json ?? [], stepInputs);
        if (!b.ok) throw new ToolValidationError('record_routine_scenario', 'bad_step_inputs', `${name}: ${b.error}`);
        steps.push({ routine_id: routine.id, inputs: stepInputs });
      }
      const last = steps[steps.length - 1];
      if (last.routine_id !== ctx.routine.id) {
        throw new ToolValidationError('record_routine_scenario', 'sequence_last_step', 'The last step of a sequence must be the routine under capture.');
      }
    }
    const [saved] = await ctx.client.upsertScenarios(ctx.projectId, ctx.architectureId, ctx.sessionId, [
      {
        session_id: ctx.sessionId,
        routine_id: ctx.routine.id,
        scenario_name: scenarioName,
        scenario_type: steps ? 'sequence' : scenarioType,
        generation_source: 'llm_generated',
        inputs_json: inputs,
        sequence_json: steps,
        status: 'proposed',
        notes: typeof args.notes === 'string' ? args.notes : null,
      },
    ]);
    ctx.currentScenarioId = saved?.id ?? null;
    return { scenario_id: ctx.currentScenarioId, scenario_name: scenarioName, bound_inputs: bound.bound.map((b) => ({ name: b.name, value: b.value })) };
  },
};

export const executeRoutineTool: ProcToolEntry = {
  name: 'execute_routine',
  description:
    'Fire the recorded scenario against the current-state database inside a compensation bracket and return the full envelope (outcome, return status, OUTPUT params, result sets, messages, error, state delta). Record the scenario first.',
  parameters: {
    type: 'object',
    properties: { scenarioId: { type: 'string' } },
    required: ['scenarioId'],
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const scenarioId = typeof args.scenarioId === 'string' ? args.scenarioId : ctx.currentScenarioId;
    if (!scenarioId) throw new ToolValidationError('execute_routine', 'scenario_not_recorded', 'Record the scenario with record_routine_scenario first.');
    if (ctx.attemptsFired >= ctx.attemptsBudget) throw new ProcAttemptBudgetExhausted(ctx.attemptsBudget);
    const scenarios = await ctx.client.listScenarios(ctx.projectId, ctx.architectureId, ctx.sessionId);
    const scenario = scenarios.find((s) => s.id === scenarioId);
    if (!scenario) throw new ToolValidationError('execute_routine', 'scenario_unknown', `Scenario ${scenarioId} is not recorded for this session.`);
    ctx.attemptsFired += 1;
    const result = await ctx.fire({ scenario });
    // Learn identifier-like facts ONLY from routines that write nothing —
    // the bracket undoes every write, so ids minted by a mutating routine
    // would reference state that no longer exists.
    const writes = ctx.routine.writes_closure_json ?? ctx.routine.writes_json ?? [];
    if (writes.length === 0) {
      for (const env of result.envelopes) {
        for (const [k, v] of Object.entries(env.output_params)) {
          if (/(^id$|Id$|_id$)/i.test(k) && (typeof v === 'number' || typeof v === 'string')) ctx.learnedFacts.push(`${k}=${String(v)}`);
        }
      }
    }
    return {
      capture_id: result.capture_id,
      accepted: result.accepted,
      bracket: result.bracket,
      refused_reason: result.refused_reason,
      envelope: result.envelopes.length === 1 ? result.envelopes[0] : { steps: result.envelopes },
      state_delta: result.state_delta,
      attempts: { fired: ctx.attemptsFired, budget: ctx.attemptsBudget },
    };
  },
};

export const recordRoutineNoteTool: ProcToolEntry = {
  name: 'record_routine_note',
  description:
    'Close the scenario honestly. diagnosticType: captured_ok (captured cleanly), captured_as_error (the routine answered with an error outcome that IS the behaviour), not_possible (this scenario cannot be produced with the available data — say why), routine_skipped (you did not capture at all).',
  parameters: {
    type: 'object',
    properties: {
      diagnosticType: { type: 'string', enum: [...NOTE_TYPES] },
      message: { type: 'string' },
    },
    required: ['diagnosticType', 'message'],
    additionalProperties: false,
  },
  terminal: true,
  handler: async (args, ctx) => {
    const type = typeof args.diagnosticType === 'string' && NOTE_TYPES.has(args.diagnosticType) ? args.diagnosticType : 'routine_skipped';
    const message = typeof args.message === 'string' ? args.message.slice(0, 2000) : '';
    ctx.noteSink.last = type;
    if (type !== 'captured_ok') {
      await ctx.client.createDiagnostics(ctx.projectId, ctx.architectureId, ctx.sessionId, [
        {
          session_id: ctx.sessionId,
          routine_id: ctx.routine.id,
          diagnostic_type: type as ProcDiagnosticType,
          message,
          detail_json: { scenario: ctx.plan.name, scenario_id: ctx.currentScenarioId },
        },
      ]);
    }
    return { recorded: type };
  },
};

export const PROC_TOOLS: ReadonlyArray<ProcToolEntry> = [
  getRoutineContextTool,
  sampleRoutineDbValuesTool,
  runRoutineReadonlySqlTool,
  recordRoutineScenarioTool,
  executeRoutineTool,
  recordRoutineNoteTool,
];
