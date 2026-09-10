/**
 * Spec 5 (Stored Proc & Function Behaviour Program, 2026-09-09): the
 * graduated proc-parity gate — resolver precedence, the dependent/
 * non-dependent × state × waiver × final-plane matrix, and the honest
 * read-failure legs. Pure DI, no network.
 */

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  evaluateProcParityGate,
  evaluateProcParityReadiness,
  resolveRoutineParityStates,
  type ProcParityGateReads,
  type RoutineStateInput,
} from '../services/migrationProcParityGate';
import type { TranslationRow } from '../services/dbMigrationPack/translations';
import type { RoutineCatalogRow } from '../services/dbMigrationPack/routineInvocationDescriptor';

function translation(partial: Partial<TranslationRow> & { id: string; routine_id: string }): TranslationRow {
  return {
    translation_key: `stored_procedure--dbo.${partial.id}`,
    object_ref: `dbo.${partial.id}`,
    kind: 'stored_procedure',
    disposition: 'translate',
    drop_reason: null,
    pipeline_state: 'drafted',
    source_body: 'x',
    source_body_hash: 'h',
    truncated: false,
    legacy_redacted: false,
    draft_content: 'd',
    judge_verdict_json: {},
    review_status: 'approved',
    reviewer_notes: null,
    loop_status: 'reconciled',
    ...partial,
  } as TranslationRow;
}

function routine(id: string, name: string): RoutineCatalogRow {
  return { id, schema_name: 'dbo', routine_name: name, routine_kind: 'procedure', params_json: [], profile_json: {} } as RoutineCatalogRow;
}

const report = (id: string, status: string, purpose = 'workbench') => ({ id, status, purpose, created_at: '2026-09-09T00:00:00Z' });

function input(overrides: Partial<RoutineStateInput> = {}): RoutineStateInput {
  return {
    translations: [
      translation({ id: 'upd_ledger_roll', routine_id: 'r1' }),
      // Functions ride the pack as `stored_procedure` translations; the catalog row carries `routine_kind`.
      translation({ id: 'fn_ledger_total', routine_id: 'r2', loop_status: 'exhausted' }),
      translation({ id: 'sp_archive_old', routine_id: 'r3', loop_status: 'unverified' }),
      translation({ id: 'sp_legacy_dump', routine_id: 'r4', disposition: 'rewrite_in_app' }),
      translation({ id: 'sp_dead', routine_id: 'r5', disposition: 'drop', drop_reason: 'unused' }),
      translation({ id: 'sp_pending', routine_id: 'r6', review_status: 'unreviewed', loop_status: 'reconciled' }),
    ],
    routines: [
      routine('r1', 'upd_ledger_roll'), { ...routine('r2', 'fn_ledger_total'), routine_kind: 'function' }, routine('r3', 'sp_archive_old'),
      routine('r4', 'sp_legacy_dump'), routine('r5', 'sp_dead'), routine('r6', 'sp_pending'),
    ],
    executionReports: {},
    anyReports: {},
    waivers: [],
    capturedRoutineIds: null,
    ...overrides,
  };
}

describe('resolveRoutineParityStates', () => {
  it('applies the precedence: disposition > approval > waiver > latest report (execution first) > loop status', () => {
    const states = resolveRoutineParityStates(input({
      executionReports: { r1: report('e1', 'divergent', 'execution') },
      anyReports: { r1: report('w1', 'clean'), r2: report('w2', 'clean_with_waivers') },
      waivers: [{ id: 'w', target: 'SP_ARCHIVE_OLD', reason: 'accepted', dimension: 'proc-parity' } as never],
    }));
    const byId = new Map(states.map((s) => [s.routine_id, s]));
    expect(byId.get('r1')?.state).toBe('divergent');            // execution report beats the older workbench clean
    expect(byId.get('r1')?.report_purpose).toBe('execution');
    expect(byId.get('r2')?.state).toBe('reconciled_with_waivers'); // report beats the exhausted loop status
    expect(byId.get('r3')?.state).toBe('reconciled_with_waivers'); // routine-level waiver
    expect(byId.get('r4')?.state).toBe('moved_to_code');
    expect(byId.get('r5')?.state).toBe('dropped');
    expect(byId.get('r6')?.state).toBe('not_migrated');            // reconciled but not approved = not on the target
  });

  it('falls back to the loop status, and splits not_captured only when the baseline was consulted', () => {
    const states = resolveRoutineParityStates(input({ capturedRoutineIds: new Set(['r1']) }));
    const byId = new Map(states.map((s) => [s.routine_id, s]));
    expect(byId.get('r1')?.state).toBe('reconciled');
    expect(byId.get('r2')?.state).toBe('not_captured');
    expect(byId.get('r3')?.state).toBe('not_captured');
    const gateView = resolveRoutineParityStates(input());
    expect(gateView.find((s) => s.routine_id === 'r2')?.state).toBe('divergent');
    expect(gateView.find((s) => s.routine_id === 'r3')?.state).toBe('unverified');
  });
});

describe('evaluateProcParityGate (pure matrix)', () => {
  const states = resolveRoutineParityStates(input());

  it('service plane: blocks ONLY dependent non-reconciled routines; the rest are warnings', () => {
    const result = evaluateProcParityGate({ states, dependent: new Set(['fn_ledger_total', 'upd_ledger_roll']), nextPlane: 'service' });
    expect(result.ok).toBe(false);
    expect(result.reasons.map((r) => r.code)).toEqual(['proc_parity_failed']);
    expect(result.reasons[0].routines).toEqual(['dbo.fn_ledger_total']);
    // sp_archive_old (unverified) + sp_pending (not migrated) are NOT called by the plane -> warnings only
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join(' ')).toContain('not called by the service plane');
    expect(result.counts).toMatchObject({ routines: 4, reconciled: 1, divergent: 1, unverified: 1, not_migrated: 1, out_of_scope: 2, dependent: 2, dependent_blocked: 1 });
    expect(result.findings.map((f) => f.routine)).toEqual(['dbo.fn_ledger_total', 'dbo.sp_archive_old', 'dbo.sp_pending']);
  });

  it('service plane: a dependent routine without a verdict blocks as unverified; a waived one passes', () => {
    const waived = resolveRoutineParityStates(input({ waivers: [{ id: 'w', target: 'fn_ledger_total', reason: 'accepted', dimension: 'proc-parity' } as never] }));
    const result = evaluateProcParityGate({ states: waived, dependent: new Set(['fn_ledger_total', 'sp_archive_old']), nextPlane: 'service' });
    expect(result.reasons.map((r) => r.code)).toEqual(['proc_parity_unverified']);
    expect(result.reasons[0].routines).toEqual(['dbo.sp_archive_old']);
    expect(result.counts.reconciled_with_waivers).toBe(1);
  });

  it('nothing dependent, and the UI plane: never blocks', () => {
    expect(evaluateProcParityGate({ states, dependent: new Set(), nextPlane: 'service' }).ok).toBe(true);
    const ui = evaluateProcParityGate({ states, dependent: new Set(['fn_ledger_total']), nextPlane: 'ui' });
    expect(ui.ok).toBe(true);
    expect(ui.warnings.length).toBeGreaterThan(0);
  });

  it('final plane (DB-only): never blocks, every non-reconciled routine is a finding', () => {
    const result = evaluateProcParityGate({ states, dependent: new Set(['fn_ledger_total']), nextPlane: null });
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.findings).toHaveLength(3);
    expect(result.findings.every((f) => !f.dependent)).toBe(true);
    expect(result.warnings.join(' ')).toContain('recorded as findings on the run; nothing blocks');
  });
});

describe('evaluateProcParityReadiness (reads)', () => {
  function reads(overrides: Partial<ProcParityGateReads> = {}): ProcParityGateReads {
    return {
      fetchPackView: async () => ({ packId: 'k1' }) as never,
      fetchTranslations: async () => input().translations,
      fetchRoutines: async () => input().routines,
      fetchLatestReports: async () => ({}),
      fetchWaivers: async () => [],
      fetchProcCallEffects: async () => [{ path_metadata_json: { proc_name: 'dbo.fn_ledger_total' } }],
      ...overrides,
    };
  }

  it('reads the pack, resolves dependents from proc-call effects (schema stripped), and blocks the caller', async () => {
    const result = await evaluateProcParityReadiness({ projectId: 'p', architectureId: 'a', nextPlane: 'service', reads: reads() });
    expect(result.ok).toBe(false);
    expect(result.reasons[0].routines).toEqual(['dbo.fn_ledger_total']);
  });

  it('no pack / no architecture: ok with nothing to gate', async () => {
    expect((await evaluateProcParityReadiness({ projectId: 'p', architectureId: null, nextPlane: 'service', reads: reads() })).ok).toBe(true);
    expect((await evaluateProcParityReadiness({ projectId: 'p', architectureId: 'a', nextPlane: 'service', reads: reads({ fetchPackView: async () => null }) })).ok).toBe(true);
  });

  it('read failure: fail-closed for the service plane, a warning on the final plane', async () => {
    const boom = reads({ fetchTranslations: async () => { throw new Error('AMS down'); } });
    const service = await evaluateProcParityReadiness({ projectId: 'p', architectureId: 'a', nextPlane: 'service', reads: boom });
    expect(service.ok).toBe(false);
    expect(service.reasons[0].code).toBe('proc_parity_unverified');
    const final = await evaluateProcParityReadiness({ projectId: 'p', architectureId: 'a', nextPlane: null, reads: boom });
    expect(final.ok).toBe(true);
    expect(final.warnings[0]).toContain('AMS down');
  });
});
