/**
 * Spec 2 (Stored Proc & Function Behaviour Program, 2026-09-09): descriptor
 * derivation (shape selection, header rendering), the draft header
 * validator, and call-site compatibility classification. Offline, invented
 * vocabulary.
 */

import {
  deriveDescriptorsByRoutine,
  deriveRoutineDescriptor,
  mapRoutineArgType,
  renderRequiredHeader,
  renderRoutineContract,
  selectRoutineShape,
  type RoutineCatalogRow,
} from '../services/dbMigrationPack/routineInvocationDescriptor';
import { parseFunctionHeader, validateDraftAgainstDescriptor } from '../services/dbMigrationPack/descriptorValidator';
import { classifyCallSitePattern, computeCallSiteCompatibility } from '../services/dbMigrationPack/callSiteCompatibility';
import { resolvePairRuleset, resetPairRulesetCacheForTest } from '../migrationPairRules';

function routine(partial: Partial<RoutineCatalogRow>): RoutineCatalogRow {
  return {
    id: 'r1',
    schema_name: 'dbo',
    routine_name: 'upd_ledger_roll',
    routine_kind: 'procedure',
    params_json: [
      { name: 'ledger_id', ordinal: 1, source_type: 'int', direction: 'in', default_literal: null },
      { name: 'as_of', ordinal: 2, source_type: 'datetime', direction: 'in', default_literal: 'null' },
    ],
    profile_json: { max_result_sets: 0, return_status_trivial: true, return_sites: [], raiserror_sites: [], result_selects: [], constructs: [] },
    signature_parsed: true,
    ...partial,
  };
}

describe('descriptor derivation (SYBPG.PROC.ABI.001)', () => {
  it('selects the shape from the static basis', () => {
    expect(selectRoutineShape({ max_result_sets: 0, has_output_params: false, return_status_trivial: true })).toBe('return_status');
    expect(selectRoutineShape({ max_result_sets: 1, has_output_params: false, return_status_trivial: true })).toBe('single_result_set');
    expect(selectRoutineShape({ max_result_sets: 0, has_output_params: true, return_status_trivial: true })).toBe('out_params');
    expect(selectRoutineShape({ max_result_sets: 1, has_output_params: true, return_status_trivial: true })).toBe('rich');
    expect(selectRoutineShape({ max_result_sets: 1, has_output_params: false, return_status_trivial: false })).toBe('rich');
    expect(selectRoutineShape({ max_result_sets: 2, has_output_params: false, return_status_trivial: true })).toBe('rich');
  });

  it('maps argument types and renders the required header per shape', () => {
    expect(mapRoutineArgType('numeric(10,2)')).toBe('numeric(10,2)');
    expect(mapRoutineArgType('varchar(40)')).toBe('varchar(40)');
    expect(mapRoutineArgType('money')).toBe('numeric(19,4)');
    expect(mapRoutineArgType('bit')).toBe('boolean');
    const d = deriveRoutineDescriptor(routine({}), null);
    expect(d.shape).toBe('return_status');
    expect(renderRequiredHeader(d)).toContain('dbo.upd_ledger_roll(ledger_id integer, as_of timestamp) RETURNS integer');
    const rich = deriveRoutineDescriptor(
      routine({
        params_json: [
          { name: 'ledger_id', ordinal: 1, source_type: 'int', direction: 'in', default_literal: null },
          { name: 'rows_done', ordinal: 2, source_type: 'int', direction: 'output', default_literal: null },
        ],
        profile_json: { max_result_sets: 2, return_status_trivial: false },
      }),
      null
    );
    expect(rich.shape).toBe('rich');
    expect(rich.refcursors).toEqual(['rs1', 'rs2']);
    expect(rich.out_params).toEqual(['rows_done']);
    expect(rich.return_status_carriage).toBe('out_param');
    expect(renderRequiredHeader(rich)).toContain('OUT rows_done integer, OUT return_status integer, OUT rs1 refcursor, OUT rs2 refcursor');
  });

  it('functions with no result set are return_status shaped and cite the rules present', () => {
    resetPairRulesetCacheForTest();
    const rs = resolvePairRuleset({ sourceEngine: 'sybase' });
    const d = deriveRoutineDescriptor(routine({ routine_kind: 'function', returns_type: 'numeric(18,2)', profile_json: { max_result_sets: 0 } }), rs);
    expect(d.shape).toBe('return_status');
    expect(d.rules_cited).toEqual(['SYBPG.PROC.ABI.001', 'SYBPG.PROC.ERR.001', 'SYBPG.PROC.SESSION.001']);
    const contract = renderRoutineContract(routine({}), d);
    expect(contract).toContain('Required header');
    expect(contract).toContain('SYBPG.PROC.ERR.001');
    expect(contract).not.toMatch(/scenario|captured/i);
  });

  it('deriveDescriptorsByRoutine skips triggers and keys by bare name', () => {
    const map = deriveDescriptorsByRoutine(
      [routine({}), routine({ id: 't', routine_name: 'trg_x', routine_kind: 'trigger' })],
      null
    );
    expect([...map.keys()]).toEqual(['upd_ledger_roll']);
  });
});

describe('draft header validation', () => {
  const d = deriveRoutineDescriptor(routine({}), null);

  it('accepts a matching header and rejects name / argument / RETURNS mismatches', () => {
    const good = 'CREATE OR REPLACE FUNCTION dbo.upd_ledger_roll(ledger_id integer, as_of timestamp) RETURNS integer LANGUAGE plpgsql AS $$ BEGIN RETURN 0; END $$;';
    expect(validateDraftAgainstDescriptor(good, d)).toEqual({ ok: true, violations: [] });
    const badName = good.replace('upd_ledger_roll', 'roll_ledger');
    expect(validateDraftAgainstDescriptor(badName, d).violations[0]).toMatch(/function name/);
    const badArgs = 'CREATE FUNCTION dbo.upd_ledger_roll(as_of timestamp, ledger_id integer) RETURNS integer AS $$ $$';
    expect(validateDraftAgainstDescriptor(badArgs, d).violations.join(' ')).toMatch(/IN arguments/);
    const badReturns = 'CREATE FUNCTION dbo.upd_ledger_roll(ledger_id integer, as_of timestamp) RETURNS TABLE(x int) AS $$ $$';
    expect(validateDraftAgainstDescriptor(badReturns, d).violations.join(' ')).toMatch(/RETURNS must be integer/);
    expect(validateDraftAgainstDescriptor('select 1', d).violations[0]).toMatch(/no CREATE/);
  });

  it('checks OUT arguments and refcursor types for the rich shape', () => {
    const rich = deriveRoutineDescriptor(
      routine({ profile_json: { max_result_sets: 2, return_status_trivial: false } }),
      null
    );
    const draft = 'CREATE OR REPLACE FUNCTION dbo.upd_ledger_roll(ledger_id integer, as_of timestamp, OUT return_status integer, OUT rs1 refcursor, OUT rs2 refcursor) LANGUAGE plpgsql AS $$ $$';
    expect(validateDraftAgainstDescriptor(draft, rich).ok).toBe(true);
    const missing = 'CREATE FUNCTION dbo.upd_ledger_roll(ledger_id integer, as_of timestamp, OUT return_status integer, OUT rs1 refcursor) AS $$ $$';
    expect(validateDraftAgainstDescriptor(missing, rich).violations).toContain('missing OUT argument rs2');
    const header = parseFunctionHeader(draft)!;
    expect(header.args.filter((a) => a.mode === 'out').map((a) => a.name)).toEqual(['return_status', 'rs1', 'rs2']);
  });
});

describe('call-site compatibility (SYBPG.PROC.CALLSITE.001)', () => {
  it('classifies query text patterns', () => {
    expect(classifyCallSitePattern('{? = call dbo.upd_ledger_roll(?, ?)}')).toBe('jdbc_call_return');
    expect(classifyCallSitePattern('{call upd_ledger_roll(?)}')).toBe('jdbc_call');
    expect(classifyCallSitePattern('exec upd_ledger_roll @ledger_id = ?')).toBe('exec_text');
    expect(classifyCallSitePattern('upd_ledger_roll')).toBe('bare_reference');
  });

  it('applies the matrix per shape and reports undescribed routines honestly', () => {
    resetPairRulesetCacheForTest();
    const rs = resolvePairRuleset({ sourceEngine: 'sybase' });
    const descriptors = deriveDescriptorsByRoutine(
      [
        routine({ id: 'a', routine_name: 'upd_ledger_roll', profile_json: { max_result_sets: 1, return_status_trivial: true } }),
        routine({ id: 'b', routine_name: 'roll_all', profile_json: { max_result_sets: 2 } }),
      ],
      rs
    );
    const summary = computeCallSiteCompatibility(
      [
        { endpoint_id: 'e1', access_mode: 'execute', path_metadata_json: { proc_name: 'dbo.upd_ledger_roll', query_text: '{call upd_ledger_roll(?)}' } },
        { endpoint_id: 'e2', access_mode: 'execute', path_metadata_json: { proc_name: 'upd_ledger_roll', query_text: '{? = call upd_ledger_roll(?)}' } },
        { endpoint_id: 'e3', access_mode: 'execute', path_metadata_json: { proc_name: 'roll_all', query_text: '{call roll_all()}' } },
        { endpoint_id: 'e4', access_mode: 'execute', path_metadata_json: { proc_name: 'ghost_proc', query_text: '{call ghost_proc()}' } },
        { endpoint_id: 'e5', access_mode: 'write', path_metadata_json: { query_text: 'update t set x = 1' } },
      ],
      descriptors,
      rs
    );
    expect(summary.compatible).toBe(1);
    expect(summary.needs_change).toBe(2);
    expect(summary.unknown).toBe(1);
    expect(summary.undescribed_routines).toEqual(['ghost_proc']);
    const e2 = summary.sites.find((s) => s.endpoint_id === 'e2');
    expect(e2?.verdict).toBe('needs_change');
    expect(e2?.reason).toMatch(/set-returning function/);
    const e3 = summary.sites.find((s) => s.endpoint_id === 'e3');
    expect(e3?.shape).toBe('rich');
    expect(e3?.reason).toMatch(/refcursor/);
  });
});
