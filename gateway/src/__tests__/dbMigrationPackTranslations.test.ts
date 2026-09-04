/**
 * DB object translation pipeline — focused tests (Task 3.1).
 *
 * Spec: 2026-06-11 LLM-Assisted DB Object Translation Drafts — Task Group 3.
 *
 * Covers ONLY:
 *   (a) seeding — one row per requires_translation_spec_2 entry, body from
 *       provenance finding detail_json, fidelity flags at seed time
 *       (truncated -> needs_manual terminal; missing literal_policy marker ->
 *       legacy_redacted) PLUS the hash re-link (unchanged preserved sparse /
 *       changed demoted to needs_rework with the auto note / absent deleted);
 *   (b) deterministic pre-pass — token conversions applied,
 *       known-untranslatable constructs flagged (never guessed), output feeds
 *       the translation prompt;
 *   (c) happy path — translate -> judge -> ONE persist as drafted carrying
 *       BOTH draft and verdict (a draft is never persisted without it);
 *   (d) judge failure after one retry -> failed (draft NOT reviewable);
 *       translate validation failure after one retry -> failed;
 *   (e) coverage assertion — every manifest object in exactly one bucket; an
 *       unaccounted object FAILS the run;
 *   (f) translate-all selects ONLY pending + failed; re-translate of a
 *       drafted object resets review_status to unreviewed via a fresh judge
 *       pass; an approved object is refused;
 *   (g) ALL LLM calls route through the shared pool (admissions counted).
 */

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    migrationPlanLlmConcurrency: 4,
  }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import type { LlmConcurrencyPool } from '../services/llmConcurrencyPool';
import type { RawDiscoveryFinding } from '../services/dbMigrationPack/inputs';
import {
  assertTranslationCoverage,
  buildTranslationPrompt,
  buildTranslationUpsertBatch,
  computeSourceBodyHash,
  resolveSeedSources,
  runDeterministicPrePass,
  runTranslationPipeline,
  selectTranslateAllTargets,
  syncPackTranslations,
  TranslationActionError,
  TranslationCoverageError,
  TranslationPatch,
  TranslationRow,
  TranslationUpsertRow,
} from '../services/dbMigrationPack/translations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function procFinding(
  id: string,
  name: string,
  body: string,
  opts: { truncated?: boolean; legacy?: boolean } = {}
): RawDiscoveryFinding {
  return {
    id,
    finding_type: 'stored_procedure_logic',
    detail_json: {
      schemaName: 'dbo',
      procedureName: name,
      bodySnippet: body,
      redacted: false,
      truncated: opts.truncated === true,
      ...(opts.legacy ? {} : { literal_policy: 'targeted_v2' }),
    },
  };
}

function bodyFinding(
  id: string,
  findingType: 'trigger_logic' | 'view_definition',
  body: string,
  opts: { truncated?: boolean; legacy?: boolean } = {}
): RawDiscoveryFinding {
  return {
    id,
    finding_type: findingType,
    detail_json: {
      schemaName: 'dbo',
      body,
      truncated: opts.truncated === true,
      ...(opts.legacy ? {} : { literal_policy: 'targeted_v2' }),
    },
  };
}

let rowSeq = 0;
function makeRow(partial: Partial<TranslationRow> & { translation_key: string }): TranslationRow {
  const [kind, objectRef] = partial.translation_key.split('--');
  return {
    id: partial.id ?? `t-${++rowSeq}`,
    translation_key: partial.translation_key,
    object_ref: partial.object_ref ?? objectRef,
    kind: (partial.kind ?? kind) as TranslationRow['kind'],
    disposition: partial.disposition ?? 'translate',
    drop_reason: partial.drop_reason ?? null,
    pipeline_state: partial.pipeline_state ?? 'pending',
    source_body: partial.source_body ?? 'SELECT 1',
    source_body_hash: partial.source_body_hash ?? computeSourceBodyHash(partial.source_body ?? 'SELECT 1'),
    truncated: partial.truncated ?? false,
    legacy_redacted: partial.legacy_redacted ?? false,
    draft_content: partial.draft_content ?? null,
    judge_verdict_json: partial.judge_verdict_json ?? null,
    review_status: partial.review_status ?? 'unreviewed',
    reviewer_notes: partial.reviewer_notes ?? null,
  };
}

/** Stateful in-memory AMS stub: PATCHes mutate rows; every patch is logged. */
function makeStore(initialRows: TranslationRow[]) {
  const rows = initialRows.map((r) => ({ ...r }));
  const patches: Array<{ id: string; patch: TranslationPatch }> = [];
  return {
    rows,
    patches,
    fetchTranslations: async () => rows.map((r) => ({ ...r })),
    patchTranslation: async (
      _projectId: string,
      _packId: string,
      id: string,
      patch: TranslationPatch
    ): Promise<TranslationRow> => {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error(`no row ${id}`);
      Object.assign(row, patch);
      patches.push({ id, patch });
      return { ...row };
    },
  };
}

function makeManifest(entries: Array<{ kind: string; object_ref: string }>) {
  return {
    requires_translation_spec_2: entries.map((e) => ({ ...e, finding_ids: [] })),
    expected_schema: {
      tables: [{ schemaName: 'dbo', tableName: 'orders' }],
      columns: [
        {
          schemaName: 'dbo',
          tableName: 'orders',
          columnName: 'order_id',
          dataType: 'integer',
          isNullable: false,
          isPrimaryKey: true,
        },
      ],
    },
  };
}

const passthroughPool = { run: (task: () => Promise<unknown>) => task() } as LlmConcurrencyPool;

const translateJson = JSON.stringify({
  draft_sql: 'CREATE OR REPLACE FUNCTION dbo.usp_calc() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;',
});
const judgeJson = JSON.stringify({ verdict: 'equivalent', confidence: 0.92, flags: [] });

/** Dispatches by prompt role: the judge system prompt self-identifies. */
function makeLlmDispatcher() {
  return jest.fn(async ({ systemPrompt }: { systemPrompt: string }) =>
    systemPrompt.includes('verdict-only judge')
      ? { content: judgeJson }
      : { content: translateJson }
  );
}

// ---------------------------------------------------------------------------
// (a) seeding + hash re-link/demote
// ---------------------------------------------------------------------------

describe('dbMigrationPack translations — seeding + re-link (3.2)', () => {
  it('seeds one row per manifest entry with body, hash, and fidelity flags; re-links by hash (unchanged sparse, changed demoted with auto note, absent deleted)', async () => {
    const procBody = "CREATE PROCEDURE dbo.usp_calc AS SELECT getdate() WHERE status = 'ACTIVE'";
    const entries = [
      { kind: 'stored_procedure', object_ref: 'dbo.usp_calc', finding_ids: ['f1'] },
      { kind: 'view', object_ref: 'dbo.v_big', finding_ids: ['f2'] },
      { kind: 'trigger', object_ref: 'dbo.trg_audit', finding_ids: ['f3'] },
    ];
    const findings = [
      procFinding('f1', 'usp_calc', procBody),
      bodyFinding('f2', 'view_definition', 'SELECT * FROM dbo.orders', { truncated: true }),
      bodyFinding('f3', 'trigger_logic', 'INSERT INTO audit VALUES (1)', { legacy: true }),
    ];

    // --- first generation: everything seeds fresh -------------------------
    let captured: { translations: TranslationUpsertRow[]; delete_absent: boolean } | null = null;
    const first = await syncPackTranslations(
      { projectId: 'p1', packId: 'pack-1', entries, findings },
      {
        fetchTranslations: async () => [],
        upsertTranslations: async (_p, _k, body) => {
          captured = body;
          return body.translations.map((t, i) => makeRow({ ...t, id: `t-${i}` } as never));
        },
      }
    );
    expect(captured!.translations).toHaveLength(3);
    expect(captured!.delete_absent).toBe(true);
    const byKey = new Map(captured!.translations.map((t) => [t.translation_key, t]));
    const proc = byKey.get('stored_procedure--dbo.usp_calc')!;
    expect(proc.source_body).toBe(procBody);
    expect(proc.source_body_hash).toBe(computeSourceBodyHash(procBody));
    expect(proc.pipeline_state).toBe('pending');
    expect(proc.truncated).toBe(false);
    expect(proc.legacy_redacted).toBe(false);
    // Truncated capture -> terminal needs_manual at seed time.
    const view = byKey.get('view--dbo.v_big')!;
    expect(view.truncated).toBe(true);
    expect(view.pipeline_state).toBe('needs_manual');
    // Marker ABSENCE = legacy-redacted body (still translatable -> pending).
    const trig = byKey.get('trigger--dbo.trg_audit')!;
    expect(trig.legacy_redacted).toBe(true);
    expect(trig.pipeline_state).toBe('pending');
    expect(first.summary.seeded_new).toBe(3);

    // --- regeneration re-link: unchanged / changed / removed --------------
    const seeds = resolveSeedSources(entries, findings);
    const existing = [
      // Unchanged hash: approved + drafted — must be preserved verbatim
      // (the upsert row stays SPARSE: no review/draft fields supplied).
      makeRow({
        translation_key: 'stored_procedure--dbo.usp_calc',
        source_body: procBody,
        pipeline_state: 'drafted',
        review_status: 'approved',
        draft_content: 'CREATE FUNCTION ...',
        judge_verdict_json: { verdict: 'equivalent', confidence: 0.9, flags: [] },
      }),
      // Changed hash: approval NEVER silently survives -> needs_rework + note.
      makeRow({
        translation_key: 'trigger--dbo.trg_audit',
        source_body: 'OLD TRIGGER BODY',
        pipeline_state: 'drafted',
        review_status: 'approved',
        draft_content: 'CREATE FUNCTION old ...',
        judge_verdict_json: { verdict: 'equivalent', confidence: 0.8, flags: [] },
        reviewer_notes: 'looks good',
      }),
      // No longer in the manifest -> deleted deterministically.
      makeRow({ translation_key: 'view--dbo.v_gone' }),
    ];
    const batch = buildTranslationUpsertBatch(seeds, existing);
    expect(batch.delete_absent).toBe(true);
    expect(batch.summary).toEqual({
      seeded_new: 1, // dbo.v_big had no prior row in this scenario
      relinked_unchanged: 1,
      demoted_needs_rework: 1,
      removed: 1,
    });
    const relinked = batch.translations.find(
      (t) => t.translation_key === 'stored_procedure--dbo.usp_calc'
    )!;
    expect(relinked.review_status).toBeUndefined();
    expect(relinked.reviewer_notes).toBeUndefined();
    expect(relinked).not.toHaveProperty('draft_content');
    const demoted = batch.translations.find(
      (t) => t.translation_key === 'trigger--dbo.trg_audit'
    )!;
    expect(demoted.review_status).toBe('needs_rework');
    expect(demoted.reviewer_notes).toContain('looks good');
    expect(demoted.reviewer_notes).toContain('[auto] Source body changed on pack regeneration');
  });
});

// ---------------------------------------------------------------------------
// (b) deterministic pre-pass
// ---------------------------------------------------------------------------

describe('dbMigrationPack translations — deterministic pre-pass (3.3)', () => {
  it('applies token conversions, flags known-untranslatable constructs (never guesses), and feeds both into the translation prompt', () => {
    const body =
      'SET @ts = getdate()\nSELECT newid(), @@servername\n' + "EXEC xp_cmdshell 'dir'";
    const prePass = runDeterministicPrePass(body);

    // Deterministic conversions applied.
    expect(prePass.convertedBody).toContain('now()');
    expect(prePass.convertedBody).toContain('gen_random_uuid()');
    expect(prePass.convertedBody).not.toMatch(/getdate\s*\(/i);
    expect(prePass.conversionNotes.join(' ')).toContain('getdate');
    // No-equivalent constructs FLAGGED — never guessed (still in the body).
    expect(prePass.convertedBody).toContain('@@servername');
    expect(prePass.flags.some((f) => f.startsWith('@@servername'))).toBe(true);
    expect(prePass.flags.some((f) => f.startsWith('xp_cmdshell'))).toBe(true);

    // The pre-pass output (converted body + flags) feeds the prompt.
    const prompt = buildTranslationPrompt({
      kind: 'stored_procedure',
      objectRef: 'dbo.usp_calc',
      prePass,
      schemaContext: 'Referenced target tables (PostgreSQL types):\n- dbo.orders(order_id integer PK)',
    });
    expect(prompt.userPrompt).toContain(prePass.convertedBody);
    for (const flag of prePass.flags) expect(prompt.userPrompt).toContain(flag);
    expect(prompt.userPrompt).toContain('dbo.orders(order_id integer PK');
  });
});

// ---------------------------------------------------------------------------
// (c) happy path — drafted ONLY together with its verdict
// ---------------------------------------------------------------------------

describe('dbMigrationPack translations — translate + judge pipeline (3.4/3.5)', () => {
  it('persists draft + judge verdict TOGETHER in one drafted PATCH (never a draft without its verdict)', async () => {
    const store = makeStore([
      makeRow({ id: 't1', translation_key: 'stored_procedure--dbo.usp_calc' }),
    ]);
    const callLlm = makeLlmDispatcher();
    const result = await runTranslationPipeline(
      { projectId: 'p1', packId: 'pack-1', scope: { mode: 'single', translationId: 't1' } },
      {
        fetchPack: async () => ({
          manifest_json: makeManifest([
            { kind: 'stored_procedure', object_ref: 'dbo.usp_calc' },
          ]),
        }),
        fetchTranslations: store.fetchTranslations,
        patchTranslation: store.patchTranslation,
        callLlm,
        llmPool: passthroughPool,
      }
    );

    expect(callLlm).toHaveBeenCalledTimes(2); // ONE translate + ONE judge
    expect(store.patches[0].patch).toEqual({ pipeline_state: 'translating' });
    const drafted = store.patches.find((p) => p.patch.pipeline_state === 'drafted')!;
    expect(drafted.patch.draft_content).toContain('CREATE OR REPLACE FUNCTION');
    expect(drafted.patch.judge_verdict_json).toEqual({
      verdict: 'equivalent',
      confidence: 0.92,
      flags: [],
    });
    expect(drafted.patch.review_status).toBe('unreviewed');
    // The hard invariant: NO patch ever carries a draft without its verdict.
    for (const p of store.patches) {
      if (p.patch.draft_content !== undefined) {
        expect(p.patch.judge_verdict_json).toBeDefined();
        expect(p.patch.pipeline_state).toBe('drafted');
      }
    }
    expect(result.outcomes).toEqual([
      expect.objectContaining({ translation_id: 't1', new_state: 'drafted', error: null }),
    ]);
    expect(result.coverage.drafted).toBe(1);
  });

  // (d) -----------------------------------------------------------------
  it('lands failed (retryable) after one retry — judge failure leaves the draft unpersisted; translate validation failure likewise', async () => {
    // Judge returns an invalid verdict shape on BOTH attempts.
    const judgeFailStore = makeStore([
      makeRow({ id: 't1', translation_key: 'stored_procedure--dbo.usp_calc' }),
    ]);
    const judgeFailLlm = jest.fn(async ({ systemPrompt }: { systemPrompt: string }) =>
      systemPrompt.includes('verdict-only judge')
        ? { content: JSON.stringify({ nope: true }) }
        : { content: translateJson }
    );
    const judgeRun = await runTranslationPipeline(
      { projectId: 'p1', packId: 'pack-1', scope: { mode: 'single', translationId: 't1' } },
      {
        fetchPack: async () => ({
          manifest_json: makeManifest([
            { kind: 'stored_procedure', object_ref: 'dbo.usp_calc' },
          ]),
        }),
        fetchTranslations: judgeFailStore.fetchTranslations,
        patchTranslation: judgeFailStore.patchTranslation,
        callLlm: judgeFailLlm,
        llmPool: passthroughPool,
      }
    );
    // 1 translate + 2 judge attempts (the one-retry convention).
    expect(judgeFailLlm).toHaveBeenCalledTimes(3);
    expect(judgeRun.outcomes[0].new_state).toBe('failed');
    expect(judgeRun.outcomes[0].error).toContain('failed after retry');
    // The unverified draft was NEVER persisted — not reviewable.
    expect(judgeFailStore.patches.some((p) => p.patch.draft_content !== undefined)).toBe(false);
    expect(judgeFailStore.rows[0].pipeline_state).toBe('failed');

    // Translate response invalid on BOTH attempts -> failed after 2 calls.
    const translateFailStore = makeStore([
      makeRow({ id: 't2', translation_key: 'view--dbo.v_orders', kind: 'view' }),
    ]);
    const translateFailLlm = jest.fn(async () => ({ content: '{"garbage": 1}' }));
    const translateRun = await runTranslationPipeline(
      { projectId: 'p1', packId: 'pack-1', scope: { mode: 'single', translationId: 't2' } },
      {
        fetchPack: async () => ({
          manifest_json: makeManifest([{ kind: 'view', object_ref: 'dbo.v_orders' }]),
        }),
        fetchTranslations: translateFailStore.fetchTranslations,
        patchTranslation: translateFailStore.patchTranslation,
        callLlm: translateFailLlm,
        llmPool: passthroughPool,
      }
    );
    expect(translateFailLlm).toHaveBeenCalledTimes(2);
    expect(translateRun.outcomes[0].new_state).toBe('failed');
    expect(translateFailStore.rows[0].pipeline_state).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// (e) coverage — the CODE guarantee
// ---------------------------------------------------------------------------

describe('dbMigrationPack translations — coverage assertion (3.6)', () => {
  it('fails the run on any unaccounted object and on a drafted row without its verdict', async () => {
    const entries = [
      { kind: 'stored_procedure', object_ref: 'dbo.usp_calc', finding_ids: [] },
      { kind: 'view', object_ref: 'dbo.v_orders', finding_ids: [] },
    ];
    const draftedRow = makeRow({
      translation_key: 'stored_procedure--dbo.usp_calc',
      pipeline_state: 'drafted',
      draft_content: 'CREATE ...',
      judge_verdict_json: { verdict: 'equivalent', confidence: 1, flags: [] },
    });

    // A manifest object with NO row is unaccounted -> throws.
    expect(() => assertTranslationCoverage(entries, [draftedRow])).toThrow(
      TranslationCoverageError
    );
    expect(() => assertTranslationCoverage(entries, [draftedRow])).toThrow(/view--dbo\.v_orders/);

    // A drafted row WITHOUT its judge verdict is never a valid bucket.
    const unverified = makeRow({
      translation_key: 'view--dbo.v_orders',
      kind: 'view',
      pipeline_state: 'drafted',
      draft_content: 'CREATE VIEW ...',
      judge_verdict_json: null,
    });
    expect(() => assertTranslationCoverage(entries, [draftedRow, unverified])).toThrow(
      /without draft content \+ judge verdict/
    );

    // All five buckets together pass.
    const ok = [
      draftedRow,
      makeRow({
        translation_key: 'view--dbo.v_orders',
        kind: 'view',
        disposition: 'drop',
        drop_reason: 'superseded by reporting service',
      }),
    ];
    expect(() => assertTranslationCoverage(entries, ok)).not.toThrow();

    // And the pipeline run itself FAILS on an artificially unaccounted object.
    const store = makeStore([]);
    await expect(
      runTranslationPipeline(
        { projectId: 'p1', packId: 'pack-1', scope: { mode: 'all' } },
        {
          fetchPack: async () => ({
            manifest_json: makeManifest([
              { kind: 'stored_procedure', object_ref: 'dbo.usp_ghost' },
            ]),
          }),
          fetchTranslations: store.fetchTranslations,
          patchTranslation: store.patchTranslation,
          callLlm: makeLlmDispatcher(),
          llmPool: passthroughPool,
        }
      )
    ).rejects.toThrow(TranslationCoverageError);
  });
});

// ---------------------------------------------------------------------------
// (f) translate-all scope + re-translate semantics
// ---------------------------------------------------------------------------

describe('dbMigrationPack translations — translate-all admits stuck translating rows (2026-09-04)', () => {
  it('selects pending + failed + translating with disposition translate; never drafted / needs_manual / dropped', () => {
    const rows = [
      makeRow({ id: 'pending', translation_key: 'stored_procedure--dbo.usp_pending' }),
      makeRow({ id: 'failed', translation_key: 'stored_procedure--dbo.usp_failed', pipeline_state: 'failed' }),
      // A run that died mid-flight (500 after the stamp) left this one here
      // indefinitely; per-row Retry allowed it, Translate-all said "no work".
      makeRow({ id: 'stuck', translation_key: 'view--dbo.v_stuck', pipeline_state: 'translating' }),
      makeRow({ id: 'drafted', translation_key: 'view--dbo.v_drafted', pipeline_state: 'drafted' }),
      makeRow({ id: 'manual', translation_key: 'stored_procedure--dbo.usp_huge', pipeline_state: 'needs_manual' }),
      makeRow({ id: 'dropped', translation_key: 'trigger--dbo.trg_dead', disposition: 'drop', drop_reason: 'dead' }),
      makeRow({
        id: 'dropped_stuck',
        translation_key: 'trigger--dbo.trg_stuck',
        disposition: 'drop',
        drop_reason: 'dead',
        pipeline_state: 'translating',
      }),
    ];
    expect(selectTranslateAllTargets(rows).map((r) => r.id)).toEqual(['pending', 'failed', 'stuck']);
  });
});

describe('dbMigrationPack translations — translate-all scope + re-translate (3.6)', () => {
  it('translate-all processes ONLY pending + failed; re-translate resets review to unreviewed with a fresh judge pass; approved objects are refused', async () => {
    const rows = [
      makeRow({ id: 'p1', translation_key: 'stored_procedure--dbo.usp_pending' }),
      makeRow({
        id: 'p2',
        translation_key: 'stored_procedure--dbo.usp_failed',
        pipeline_state: 'failed',
      }),
      makeRow({
        id: 'd1',
        translation_key: 'view--dbo.v_drafted',
        kind: 'view',
        pipeline_state: 'drafted',
        draft_content: 'CREATE VIEW ...',
        judge_verdict_json: { verdict: 'equivalent', confidence: 0.7, flags: [] },
        review_status: 'needs_rework',
      }),
      makeRow({
        id: 'a1',
        translation_key: 'view--dbo.v_approved',
        kind: 'view',
        pipeline_state: 'drafted',
        draft_content: 'CREATE VIEW ...',
        judge_verdict_json: { verdict: 'equivalent', confidence: 0.9, flags: [] },
        review_status: 'approved',
      }),
      makeRow({
        id: 'r1',
        translation_key: 'trigger--dbo.trg_rewrite',
        kind: 'trigger',
        disposition: 'rewrite_in_app',
      }),
      makeRow({
        id: 'm1',
        translation_key: 'stored_procedure--dbo.usp_huge',
        pipeline_state: 'needs_manual',
        truncated: true,
      }),
      makeRow({
        id: 'x1',
        translation_key: 'trigger--dbo.trg_dead',
        kind: 'trigger',
        disposition: 'drop',
        drop_reason: 'obsolete audit trigger',
      }),
    ];
    const entries = rows.map((r) => ({
      kind: r.kind,
      object_ref: r.object_ref,
    }));
    const store = makeStore(rows);
    const callLlm = makeLlmDispatcher();
    const deps = {
      fetchPack: async () => ({ manifest_json: makeManifest(entries) }),
      fetchTranslations: store.fetchTranslations,
      patchTranslation: store.patchTranslation,
      callLlm,
      llmPool: passthroughPool,
    };

    const all = await runTranslationPipeline(
      { projectId: 'p1', packId: 'pack-1', scope: { mode: 'all' } },
      deps
    );
    // ONLY pending + failed were processed.
    expect(all.outcomes.map((o) => o.translation_id).sort()).toEqual(['p1', 'p2']);
    expect(callLlm).toHaveBeenCalledTimes(4); // 2 objects x (translate + judge)
    const touchedIds = new Set(store.patches.map((p) => p.id));
    expect(touchedIds).toEqual(new Set(['p1', 'p2']));
    expect(all.coverage).toMatchObject({
      total: 7,
      drafted: 4, // p1 + p2 (fresh) + d1 + a1
      needs_manual: 1,
      rewrite_in_app: 1,
      dropped: 1,
      approved: 1,
    });

    // Per-object re-translate of the drafted object: fresh judge pass +
    // review reset to unreviewed.
    store.patches.length = 0;
    const single = await runTranslationPipeline(
      { projectId: 'p1', packId: 'pack-1', scope: { mode: 'single', translationId: 'd1' } },
      deps
    );
    expect(single.outcomes[0].new_state).toBe('drafted');
    expect(callLlm).toHaveBeenCalledTimes(6);
    const drafted = store.patches.find((p) => p.patch.pipeline_state === 'drafted')!;
    expect(drafted.patch.review_status).toBe('unreviewed');
    expect(store.rows.find((r) => r.id === 'd1')!.review_status).toBe('unreviewed');

    // An APPROVED object is skipped/refused — never silently re-translated.
    await expect(
      runTranslationPipeline(
        { projectId: 'p1', packId: 'pack-1', scope: { mode: 'single', translationId: 'a1' } },
        deps
      )
    ).rejects.toThrow(TranslationActionError);
  });

  // (g) -----------------------------------------------------------------
  it('routes EVERY LLM call (translate + judge) through the shared pool', async () => {
    const store = makeStore([
      makeRow({ id: 'p1', translation_key: 'stored_procedure--dbo.usp_a' }),
      makeRow({ id: 'p2', translation_key: 'stored_procedure--dbo.usp_b' }),
    ]);
    const poolRun = jest.fn((task: () => Promise<unknown>) => task());
    const countingPool = { run: poolRun } as unknown as LlmConcurrencyPool;
    await runTranslationPipeline(
      { projectId: 'p1', packId: 'pack-1', scope: { mode: 'all' } },
      {
        fetchPack: async () => ({
          manifest_json: makeManifest([
            { kind: 'stored_procedure', object_ref: 'dbo.usp_a' },
            { kind: 'stored_procedure', object_ref: 'dbo.usp_b' },
          ]),
        }),
        fetchTranslations: store.fetchTranslations,
        patchTranslation: store.patchTranslation,
        callLlm: makeLlmDispatcher(),
        llmPool: countingPool,
      }
    );
    // 2 objects x (translate + judge) — all admitted through the ONE pool.
    expect(poolRun).toHaveBeenCalledTimes(4);
  });
});
