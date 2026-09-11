/**
 * Scenario seeds for SQL Server routines (second-pair programme, Spec 4):
 * type-appropriate placeholders for the SQL Server type families and the
 * error-mid-routine family keyed on the profiler's error constructs.
 */
import { defaultValueForType, seededFamilies } from '../services/procCapture/routineScenarioSeeds';

function routine(constructs: string[], body = 'select 1'): never {
  return {
    id: 'r1', schema_name: 'dbo', routine_name: 'usp_x', routine_kind: 'procedure', language: 'TSQL',
    full_body: body, params_json: [], profile_json: { constructs, return_sites: [], raiserror_sites: [] },
  } as never;
}

describe('defaultValueForType (SQL Server families)', () => {
  it('renders 7-digit datetime2 / datetimeoffset, uuid, rowversion and xml placeholders', () => {
    expect(defaultValueForType('datetime2(7)')).toBe('2026-01-15 09:30:00.0000000');
    expect(defaultValueForType('datetimeoffset')).toBe('2026-01-15 09:30:00.0000000 +00:00');
    expect(defaultValueForType('uniqueidentifier')).toBe('00000000-0000-0000-0000-000000000001');
    expect(defaultValueForType('rowversion')).toBe('\\x0000000000000001');
    expect(defaultValueForType('xml')).toBe('<r/>');
    expect(defaultValueForType('nvarchar(max)')).toBe('x');
    expect(defaultValueForType('bit')).toBe(1);
  });
});

describe('seededFamilies (error-mid-routine family)', () => {
  it('adds an error_path family for TRY/CATCH, THROW, XACT_ABORT and statement continuation', () => {
    for (const c of ['try_catch', 'throw', 'xact_abort', 'error_continuation']) {
      const fams = seededFamilies(routine([c]));
      expect(fams.map((f) => f.type)).toContain('error_path');
      expect(fams.find((f) => f.type === 'error_path')?.reason).toContain(c);
    }
  });
  it('does not duplicate the family when @@error already seeds it, and stays silent without error constructs', () => {
    const fams = seededFamilies(routine(['try_catch'], 'if @@error <> 0 return 1'));
    expect(fams.filter((f) => f.type === 'error_path')).toHaveLength(1);
    expect(seededFamilies(routine(['temp_table']))).toEqual([]);
  });
});

describe('enumerateExitOutcomes with THROW sites', () => {
  it('counts numbered THROW sites as error outcomes and ignores bare re-throws', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { enumerateExitOutcomes } = require('../services/procCapture/routineScenarioSeeds');
    const r = {
      id: 'r1', schema_name: 'dbo', routine_name: 'usp_x', routine_kind: 'procedure', language: 'TSQL', full_body: 'x', params_json: [],
      profile_json: { constructs: ['throw'], return_sites: [], raiserror_sites: [{ number: 50002, severity: 16, text_preview: null }], throw_sites: [{ number: 50001, state: 1, text_preview: null }, { number: null, state: null, text_preview: null }] },
    };
    expect(enumerateExitOutcomes(r as never).sort()).toEqual(['error:50001', 'error:50002', 'success']);
  });
});
