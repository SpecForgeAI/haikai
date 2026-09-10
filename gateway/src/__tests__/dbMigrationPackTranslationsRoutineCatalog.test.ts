/**
 * Spec 1 (Stored Proc & Function Behaviour Program, 2026-09-09): the
 * translation seed resolver prefers the routine catalog's FULL body over the
 * finding snippet, links routine_id, and never marks a catalog-sourced body
 * truncated / legacy-redacted. The finding path stays as the fallback.
 */

import {
  buildTranslationUpsertBatch,
  indexRoutineBodies,
  resolveSeedSources,
  syncPackTranslations,
  type RequiresTranslationEntry,
  type RoutineBodySource,
} from '../services/dbMigrationPack/translations';

const entries: RequiresTranslationEntry[] = [
  { kind: 'stored_procedure', object_ref: 'dbo.upd_ledger_roll', finding_ids: ['f1'] },
  { kind: 'trigger', object_ref: 'dbo.trg_ledger_line_ins', finding_ids: ['f2'] },
  { kind: 'stored_procedure', object_ref: 'dbo.orphan_only_in_findings', finding_ids: ['f3'] },
];

const findings = [
  {
    id: 'f1',
    finding_type: 'stored_procedure_logic',
    detail_json: { bodySnippet: 'create proc upd_ledger_roll as select 1 -- SNIPPET', truncated: true },
  },
  {
    id: 'f2',
    finding_type: 'trigger_logic',
    detail_json: { body: 'create trigger trg_ledger_line_ins on ledger_line for insert as select 1', literal_policy: 'targeted_v2' },
  },
  {
    id: 'f3',
    finding_type: 'stored_procedure_logic',
    detail_json: { bodySnippet: 'create proc orphan_only_in_findings as select 2', literal_policy: 'targeted_v2' },
  },
] as unknown as Parameters<typeof resolveSeedSources>[1];

const routines: RoutineBodySource[] = [
  {
    id: 'r-proc',
    schema_name: 'dbo',
    routine_name: 'upd_ledger_roll',
    routine_kind: 'procedure',
    full_body: 'create proc upd_ledger_roll @id int as select 1 -- FULL BODY',
  },
  {
    id: 'r-trg',
    schema_name: 'dbo',
    routine_name: 'trg_ledger_line_ins',
    routine_kind: 'trigger',
    full_body: 'create trigger trg_ledger_line_ins on ledger_line for insert as select 1 -- FULL',
  },
  {
    id: 'r-fn',
    schema_name: 'dbo',
    routine_name: 'fn_ignored',
    routine_kind: 'function',
    full_body: 'create function fn_ignored() returns int as begin return 1 end',
  },
];

describe('resolveSeedSources — routine catalog first (Spec 1)', () => {
  it('seeds from the FULL catalog body, links routine_id, and clears truncation', () => {
    const seeds = resolveSeedSources(entries, findings, routines);
    const proc = seeds.find((s) => s.object_ref === 'dbo.upd_ledger_roll');
    expect(proc).toBeDefined();
    expect(proc?.source_body).toContain('FULL BODY');
    expect(proc?.routine_id).toBe('r-proc');
    expect(proc?.truncated).toBe(false);
    expect(proc?.legacy_redacted).toBe(false);
    expect(proc?.terminal_needs_manual).toBe(false);
  });

  it('matches triggers by kind and falls back to the finding body when no routine exists', () => {
    const seeds = resolveSeedSources(entries, findings, routines);
    const trg = seeds.find((s) => s.object_ref === 'dbo.trg_ledger_line_ins');
    expect(trg?.routine_id).toBe('r-trg');
    const orphan = seeds.find((s) => s.object_ref === 'dbo.orphan_only_in_findings');
    expect(orphan?.routine_id).toBeUndefined();
    expect(orphan?.source_body).toContain('orphan_only_in_findings');
  });

  it('behaves exactly as before when no catalog is supplied (truncated snippet stays terminal)', () => {
    const seeds = resolveSeedSources(entries, findings);
    const proc = seeds.find((s) => s.object_ref === 'dbo.upd_ledger_roll');
    expect(proc?.truncated).toBe(true);
    expect(proc?.terminal_needs_manual).toBe(true);
    expect(proc?.routine_id).toBeUndefined();
  });

  it('carries routine_id onto the upsert row', () => {
    const seeds = resolveSeedSources(entries, findings, routines);
    const batch = buildTranslationUpsertBatch(seeds, []);
    const row = batch.translations.find((r) => r.object_ref === 'dbo.upd_ledger_roll');
    expect(row?.routine_id).toBe('r-proc');
    expect(row?.pipeline_state).toBe('pending');
  });

  it('indexRoutineBodies ignores empty bodies and keys by kind + bare name', () => {
    const index = indexRoutineBodies([
      ...routines,
      { id: 'empty', schema_name: 'dbo', routine_name: 'x', routine_kind: 'procedure', full_body: '' },
    ]);
    expect(index.has('procedure:upd_ledger_roll')).toBe(true);
    expect(index.has('procedure:x')).toBe(false);
  });
});

describe('syncPackTranslations — catalog fetch is fail-soft and optional', () => {
  it('fetches the catalog when architectureId is given and seeds from it', async () => {
    const fetchRoutines = jest.fn().mockResolvedValue(routines);
    const upsert = jest.fn().mockImplementation(async (_p: string, _k: string, body: { translations: unknown[] }) => body.translations);
    await syncPackTranslations(
      { projectId: 'p', packId: 'k', entries, findings, architectureId: 'a' },
      { fetchTranslations: async () => [], upsertTranslations: upsert, fetchRoutines }
    );
    expect(fetchRoutines).toHaveBeenCalledWith('p', 'a');
    const rows = upsert.mock.calls[0][2].translations as Array<{ object_ref: string; routine_id?: string }>;
    expect(rows.find((r) => r.object_ref === 'dbo.upd_ledger_roll')?.routine_id).toBe('r-proc');
  });

  it('skips the catalog entirely when no architectureId is given', async () => {
    const fetchRoutines = jest.fn();
    await syncPackTranslations(
      { projectId: 'p', packId: 'k', entries, findings },
      { fetchTranslations: async () => [], upsertTranslations: async (_p, _k, b) => b.translations as never, fetchRoutines }
    );
    expect(fetchRoutines).not.toHaveBeenCalled();
  });
});
