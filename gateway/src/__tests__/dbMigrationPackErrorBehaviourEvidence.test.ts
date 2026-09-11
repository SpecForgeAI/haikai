/**
 * Item 3 evidence plumbing (second-pair programme, Spec 6 §6.2): THROW sites
 * reach the routine contract; the evidence ladder leads with error-behaviour
 * clusters; the VOL rule family is named under the pair's own prefix.
 */
import { clusterBySignature, type FailingScenarioEvidence } from '../services/dbMigrationPack/evidenceLadder';
import { deriveRoutineDescriptor, renderRoutineContract } from '../services/dbMigrationPack/routineInvocationDescriptor';
import { resetPairRulesetCacheForTest, resolvePairRuleset } from '../migrationPairRules';

beforeEach(() => {
  delete process.env.MIGRATION_PAIR;
  delete process.env.MIGRATION_PAIR_RULESET_PATH;
  resetPairRulesetCacheForTest();
});

function scenario(name: string, type: string, signature: string): FailingScenarioEvidence {
  return { scenario_name: name, scenario_type: type, signature, inputs: [], dimensions: [] };
}

describe('clusterBySignature', () => {
  it('leads with error-behaviour clusters even when a larger cluster exists', () => {
    const clusters = clusterBySignature([
      scenario('a', 'happy_path', 'result_sets:rs1'),
      scenario('b', 'happy_path', 'result_sets:rs1'),
      scenario('c', 'zero_rows', 'result_sets:rs1'),
      scenario('err', 'error_path', 'outcome:error'),
    ]);
    expect(clusters.map((c) => c.signature)).toEqual(['outcome:error', 'result_sets:rs1']);
  });
});

describe('routine contract on SQL Server', () => {
  const routine = {
    id: 'r1',
    schema_name: 'dbo',
    routine_name: 'usp_post',
    routine_kind: 'procedure',
    language: 'TSQL',
    full_body: 'begin try insert into t values (1) end try begin catch throw 50001, \'boom\', 1 end catch',
    params_json: [{ name: '@id', source_type: 'int', direction: 'in', ordinal: 1, default_literal: null }],
    returns_type: null,
    profile_json: {
      return_sites: [],
      return_status_trivial: true,
      raiserror_sites: [],
      throw_sites: [{ number: 50001, state: 1, text_preview: 'boom' }, { number: null, state: null, text_preview: null }],
      result_selects: [],
      max_result_sets: 0,
      constructs: ['try_catch', 'throw'],
      volatile_functions: ['sysdatetime'],
    },
  } as never;

  it('lists THROW exit sites and names the VOL family under the pair prefix', () => {
    const ruleset = resolvePairRuleset({ sourceEngine: 'mssql' });
    const descriptor = deriveRoutineDescriptor(routine, ruleset);
    expect(descriptor.error_carriage_rule).toBe('MSPG.PROC.ERR.001');
    const text = renderRoutineContract(routine, descriptor);
    expect(text).toContain('THROW 50001 state 1');
    expect(text).toContain('THROW (re-throw)');
    expect(text).toContain('map per MSPG.PROC.VOL.*');
    expect(text).not.toContain('SYBPG');
  });
});
