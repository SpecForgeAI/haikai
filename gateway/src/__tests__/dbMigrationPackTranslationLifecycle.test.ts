/**
 * DB object translation drafts — Group 6 strategic end-to-end tests.
 *
 * Spec: 2026-06-11 LLM-Assisted DB Object Translation Drafts — Task Group 6
 * (Test Review & Gap Analysis). The Group 3/4 suites prove every stage with
 * INJECTED deps; the three tests here close the remaining integration seams
 * by running the REAL wiring end-to-end with only the process boundaries
 * mocked (global fetch for AMS, the llmClient module for the LLM):
 *
 *   (1) full lifecycle through the REAL routes + DEFAULT pipeline deps —
 *       translate-all (real shared pool + defaultCallLlm) -> drafted with
 *       verdict -> approve -> the emission pack PUT carries the
 *       translations/ file row + 050 changeset + master include + manifest
 *       approval provenance; reject never reaches emission; un-approve
 *       (needs_rework) strips the object from BOTH outputs; unchanged
 *       approved content re-emits byte-identical across PUTs (no checksum
 *       churn);
 *   (2) regeneration through the REAL generateDbMigrationPack stage-7
 *       default hook — unchanged-hash object preserves approval verbatim
 *       AND stays emitted; changed-hash object demotes to needs_rework with
 *       the auto note AND drops out of emission; manifest-removed object is
 *       deleted; new objects seed pending, with fidelity computed from the
 *       finding detail (truncated -> needs_manual terminal; missing
 *       literal_policy marker -> legacy_redacted);
 *   (3) a coverage-assertion violation surfaces through the real
 *       translate-all route as a 500 carrying the unaccounted key, with
 *       NOTHING persisted.
 */

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    discoveryServiceBaseUrl: 'http://localhost:8091',
    migrationPlanLlmConcurrency: 2,
  }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// The ONLY LLM mock: defaultCallLlm lazy-requires this module, so the real
// translate + judge call path (prompts, validators, retry, shared pool) runs.
const mockSendChatRequest = jest.fn(
  async (messages: Array<{ role: string; content: string }>) => {
    const system = messages[0]?.content ?? '';
    const user = messages[1]?.content ?? '';
    if (system.includes('verdict-only judge')) {
      return {
        content: JSON.stringify({
          verdict: 'equivalent',
          confidence: 0.9,
          flags: [{ construct: 'ISOLATION', concern: 'verify tx semantics', severity: 'low' }],
        }),
      };
    }
    const ref = /Object: (\S+) \(kind:/.exec(user)?.[1] ?? 'unknown';
    return {
      content: JSON.stringify({
        draft_sql:
          `CREATE OR REPLACE FUNCTION ${ref}_pg() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;`,
        notes: [],
      }),
    };
  }
);
jest.mock('../services/llmClient', () => ({
  getLlmClient: () => ({ sendChatRequest: mockSendChatRequest }),
}));

const mockFetch = jest.fn();
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

import express from 'express';
import request from 'supertest';
import { dbMigrationPackRouter } from '../routes/dbMigrationPack';
import {
  generateDbMigrationPack,
  GenerationInputs,
  UpsertPackBody,
} from '../services/dbMigrationPackHandler';
import {
  emitMasterChangelog,
  MASTER_CHANGELOG_PATH,
  SCHEMAS_CHANGESET_PATH,
  SEQUENCES_SEED_CHANGESET_PATH,
} from '../services/dbMigrationPack/liquibase';
import {
  EmissionFileRow,
  translationChangesetId,
  translationFilePath,
  TRANSLATIONS_CHANGESET_PATH,
} from '../services/dbMigrationPack/translationEmission';
import {
  computeSourceBodyHash,
  TranslationPatch,
  TranslationRow,
  TranslationUpsertRow,
} from '../services/dbMigrationPack/translations';

// ---------------------------------------------------------------------------
// Stateful in-memory AMS (one fake service behind the REAL default clients)
// ---------------------------------------------------------------------------

interface AmsState {
  manifest: Record<string, unknown> | null;
  rows: TranslationRow[];
  files: EmissionFileRow[];
  packPuts: Array<Record<string, unknown>>;
  upsertBodies: Array<{ translations: TranslationUpsertRow[]; delete_absent: boolean }>;
  patches: Array<{ id: string; patch: TranslationPatch }>;
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    text: async () => JSON.stringify(body),
  };
}

/** Wires mockFetch to a stateful AMS emulation honouring the wire contracts. */
function installAmsStub(state: AmsState): void {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.endsWith('/translations')) {
      return jsonResponse(200, state.rows.map((r) => ({ ...r })));
    }
    if (method === 'PUT' && url.endsWith('/translations')) {
      // AMS bulk upsert-by-translation_key: sparse rows merge into existing
      // (unsupplied fields untouched); delete_absent removes manifest-dropped
      // rows; new keys insert with defaults.
      const body = JSON.parse(String(init!.body)) as {
        translations: TranslationUpsertRow[];
        delete_absent: boolean;
      };
      state.upsertBodies.push(body);
      const incoming = new Set(body.translations.map((t) => t.translation_key));
      if (body.delete_absent) {
        state.rows = state.rows.filter((r) => incoming.has(r.translation_key));
      }
      for (const t of body.translations) {
        const existing = state.rows.find((r) => r.translation_key === t.translation_key);
        if (existing) {
          Object.assign(existing, t);
        } else {
          state.rows.push({
            id: `new-${t.translation_key}`,
            translation_key: t.translation_key,
            object_ref: t.object_ref,
            kind: t.kind,
            disposition: 'translate',
            drop_reason: null,
            pipeline_state: t.pipeline_state ?? 'pending',
            source_body: t.source_body,
            source_body_hash: t.source_body_hash,
            truncated: t.truncated,
            legacy_redacted: t.legacy_redacted,
            draft_content: null,
            judge_verdict_json: null,
            review_status: t.review_status ?? 'unreviewed',
            reviewer_notes: t.reviewer_notes ?? null,
          });
        }
      }
      return jsonResponse(200, state.rows.map((r) => ({ ...r })));
    }
    if (method === 'PATCH' && url.includes('/translations/')) {
      const id = url.slice(url.lastIndexOf('/') + 1);
      const row = state.rows.find((r) => r.id === id);
      if (!row) return jsonResponse(404, { error: { code: 404, message: `no translation ${id}` } });
      const patch = JSON.parse(String(init!.body)) as TranslationPatch;
      Object.assign(row, patch);
      state.patches.push({ id, patch });
      return jsonResponse(200, { ...row });
    }
    if (method === 'GET' && url.endsWith('/files')) {
      return jsonResponse(200, state.files.map((f) => ({ ...f })));
    }
    if (method === 'GET' && /\/db-migration-packs\/pack-1$/.test(url)) {
      return jsonResponse(200, {
        id: 'pack-1',
        architecture_id: 'arch-1',
        status: 'generated',
        stale_reason: null,
        input_snapshot_hash: 'h',
        translated_count: 1,
        skipped_count: 0,
        flagged_count: 0,
        seed_margin: 1000,
        manifest_json: state.manifest,
      });
    }
    if (method === 'PUT' && url.endsWith('/db-migration-packs')) {
      const body = JSON.parse(String(init!.body)) as Record<string, unknown>;
      state.packPuts.push(body);
      state.files = (body.files as EmissionFileRow[]).map((f) => ({ ...f }));
      state.manifest = (body.manifest_json as Record<string, unknown> | null) ?? state.manifest;
      return jsonResponse(200, { id: 'pack-1' });
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
}

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/v1', dbMigrationPackRouter);
  return app;
}

function baseFiles(): EmissionFileRow[] {
  // Every include resolves — the runnable-pack validation gate (WS3 P0)
  // rejects dangling includes at emission time, like real generation output.
  return [
    {
      file_path: MASTER_CHANGELOG_PATH,
      file_kind: 'liquibase_master',
      content: emitMasterChangelog([SCHEMAS_CHANGESET_PATH, SEQUENCES_SEED_CHANGESET_PATH]),
      sort_order: 0,
    },
    {
      file_path: SCHEMAS_CHANGESET_PATH,
      file_kind: 'liquibase_changeset',
      content:
        `--liquibase formatted sql logicalFilePath:${SCHEMAS_CHANGESET_PATH}\n` +
        '--changeset db-migration-pack:schemas context:structural splitStatements:false\n' +
        'CREATE SCHEMA IF NOT EXISTS "dbo";\n',
      sort_order: 1,
    },
    {
      file_path: SEQUENCES_SEED_CHANGESET_PATH,
      file_kind: 'liquibase_changeset',
      content:
        `--liquibase formatted sql logicalFilePath:${SEQUENCES_SEED_CHANGESET_PATH}\n` +
        '--changeset db-migration-pack:sequences-seed context:post-load splitStatements:false\n' +
        'SELECT 1;\n',
      sort_order: 2,
    },
    {
      file_path: 'manifest.json',
      file_kind: 'manifest',
      content: '{}\n',
      sort_order: 3,
    },
  ];
}

const T = (packId: string, rest: string) =>
  `/api/v1/projects/p1/db-migration-packs/${packId}/translations${rest}`;

const fileOf = (put: Record<string, unknown>, path: string) =>
  (put.files as EmissionFileRow[]).find((f) => f.file_path === path);

beforeEach(() => {
  mockFetch.mockReset();
  mockSendChatRequest.mockClear();
});

// ---------------------------------------------------------------------------
// (1) Full lifecycle through the REAL routes + default deps
// ---------------------------------------------------------------------------

describe('Group 6 — translate -> judge -> review -> approve -> emission through the real routes', () => {
  it('lands approved SQL in the 050 changeset + translations/ file + manifest provenance; reject/un-approve never reach emission; re-emission is byte-identical', async () => {
    const PROC_BODY = "CREATE PROCEDURE dbo.usp_calc AS SELECT getdate() WHERE status = 'ACTIVE'";
    const VIEW_BODY = 'CREATE VIEW dbo.v_orders AS SELECT order_id FROM dbo.orders';
    const state: AmsState = {
      manifest: {
        manifest_version: 1,
        requires_translation_spec_2: [
          { kind: 'stored_procedure', object_ref: 'dbo.usp_calc', finding_ids: [] },
          { kind: 'view', object_ref: 'dbo.v_orders', finding_ids: [] },
        ],
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
      },
      rows: [
        {
          id: 't1',
          translation_key: 'stored_procedure--dbo.usp_calc',
          object_ref: 'dbo.usp_calc',
          kind: 'stored_procedure',
          disposition: 'translate',
          drop_reason: null,
          pipeline_state: 'pending',
          source_body: PROC_BODY,
          source_body_hash: computeSourceBodyHash(PROC_BODY),
          truncated: false,
          legacy_redacted: false,
          draft_content: null,
          judge_verdict_json: null,
          review_status: 'unreviewed',
          reviewer_notes: null,
        },
        {
          id: 't2',
          translation_key: 'view--dbo.v_orders',
          object_ref: 'dbo.v_orders',
          kind: 'view',
          disposition: 'translate',
          drop_reason: null,
          pipeline_state: 'pending',
          source_body: VIEW_BODY,
          source_body_hash: computeSourceBodyHash(VIEW_BODY),
          truncated: false,
          legacy_redacted: false,
          draft_content: null,
          judge_verdict_json: null,
          review_status: 'unreviewed',
          reviewer_notes: null,
        },
      ],
      files: baseFiles(),
      packPuts: [],
      upsertBodies: [],
      patches: [],
    };
    installAmsStub(state);
    const app = createTestApp();

    // --- translate-all: REAL pipeline (defaultCallLlm + the shared pool) ---
    const all = await request(app).post(T('pack-1', '/translate-all')).send({});
    expect(all.status).toBe(200);
    expect(all.body.outcomes).toHaveLength(2);
    expect(all.body.outcomes.every((o: { new_state: string }) => o.new_state === 'drafted')).toBe(
      true
    );
    expect(all.body.coverage.drafted).toBe(2);
    // 2 objects x (translate + judge), all through the real llmClient seam.
    expect(mockSendChatRequest).toHaveBeenCalledTimes(4);
    // The hard invariant survives the real wiring: a draft is NEVER persisted
    // without its verdict, in the SAME drafted PATCH.
    for (const { patch } of state.patches) {
      if (patch.draft_content !== undefined) {
        expect(patch.judge_verdict_json).toBeDefined();
        expect(patch.pipeline_state).toBe('drafted');
      }
    }
    expect(state.rows.find((r) => r.id === 't1')!.judge_verdict_json).toMatchObject({
      verdict: 'equivalent',
      confidence: 0.9,
    });

    // --- approve t1: emission PUT carries file row + 050 + manifest provenance
    const approve1 = await request(app)
      .post(T('pack-1', '/t1/review'))
      .send({ action: 'approve', notes: 'verified in IDE' });
    expect(approve1.status).toBe(200);
    expect(approve1.body.emission.approved_count).toBe(1);
    expect(state.packPuts).toHaveLength(1);
    const put1 = state.packPuts[0];
    const procPath = translationFilePath('stored_procedure', 'dbo.usp_calc');
    expect(fileOf(put1, procPath)).toMatchObject({ file_kind: 'translation' });
    expect(fileOf(put1, procPath)!.content).toContain('dbo.usp_calc_pg()');
    const changeset1 = fileOf(put1, TRANSLATIONS_CHANGESET_PATH)!;
    expect(changeset1.content).toContain(
      `--changeset db-migration-pack:${translationChangesetId('stored_procedure', 'dbo.usp_calc')}`
    );
    expect(fileOf(put1, MASTER_CHANGELOG_PATH)!.content).toContain('050-translations.sql');
    const manifest1 = put1.manifest_json as {
      translations: { approved_count: number; approved_objects: Array<Record<string, unknown>> };
    };
    expect(manifest1.translations.approved_count).toBe(1);
    expect(manifest1.translations.approved_objects[0]).toMatchObject({
      object_ref: 'dbo.usp_calc',
      file_path: procPath,
      changeset_id: translationChangesetId('stored_procedure', 'dbo.usp_calc'),
      source_body_hash: computeSourceBodyHash(PROC_BODY),
    });

    // --- reject t2: NEVER reaches emission (no re-emission from unreviewed)
    const reject = await request(app).post(T('pack-1', '/t2/review')).send({ action: 'reject' });
    expect(reject.status).toBe(200);
    expect(reject.body.emission).toBeNull();
    expect(state.packPuts).toHaveLength(1);
    expect(state.files.some((f) => f.file_path.includes('v_orders'))).toBe(false);

    // --- approve t2 then demote it: un-approve strips it from BOTH outputs
    const approve2 = await request(app).post(T('pack-1', '/t2/review')).send({ action: 'approve' });
    expect(approve2.status).toBe(200);
    expect(approve2.body.emission.approved_count).toBe(2);
    const put2 = state.packPuts[1];
    expect(fileOf(put2, translationFilePath('view', 'dbo.v_orders'))).toBeDefined();
    expect(fileOf(put2, TRANSLATIONS_CHANGESET_PATH)!.content).toContain(
      translationChangesetId('view', 'dbo.v_orders')
    );

    const demote = await request(app)
      .post(T('pack-1', '/t2/review'))
      .send({ action: 'needs_rework', notes: 'tighten join' });
    expect(demote.status).toBe(200);
    expect(demote.body.emission.approved_count).toBe(1);
    const put3 = state.packPuts[2];
    expect(fileOf(put3, translationFilePath('view', 'dbo.v_orders'))).toBeUndefined();
    expect(fileOf(put3, TRANSLATIONS_CHANGESET_PATH)!.content).not.toContain('v_orders');

    // --- checksum stability across REAL re-emissions: the unchanged approved
    // object's file row AND 050 changeset are byte-identical PUT#1 vs PUT#3.
    expect(fileOf(put3, procPath)!.content).toBe(fileOf(put1, procPath)!.content);
    expect(fileOf(put3, procPath)!.sort_order).toBe(fileOf(put1, procPath)!.sort_order);
    expect(fileOf(put3, TRANSLATIONS_CHANGESET_PATH)!.content).toBe(changeset1.content);
    expect(fileOf(put3, MASTER_CHANGELOG_PATH)!.content).toBe(
      fileOf(put1, MASTER_CHANGELOG_PATH)!.content
    );
  });
});

// ---------------------------------------------------------------------------
// (2) Regeneration through the REAL stage-7 default hook
// ---------------------------------------------------------------------------

describe('Group 6 — regenerate -> re-link/demote through the real generateDbMigrationPack hook', () => {
  it('preserves unchanged approvals (still emitted), demotes changed-hash approvals out of emission, deletes manifest-removed rows, and seeds new objects with fidelity flags', async () => {
    const BODY_KEEP = "CREATE PROCEDURE dbo.usp_keep AS SELECT 'kept'";
    const BODY_NEW = "CREATE PROCEDURE dbo.usp_changed AS SELECT 'v2'";
    const BODY_OLD = "CREATE PROCEDURE dbo.usp_changed AS SELECT 'v1'";
    const KEEP_DRAFT =
      'CREATE OR REPLACE FUNCTION dbo.usp_keep_pg() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;';
    const verdict = { verdict: 'equivalent', confidence: 0.95, flags: [] };

    const inputs: GenerationInputs = {
      model: {
        physicalDataEntities: [
          {
            id: 'e-orders',
            name: 'dbo.orders',
            physical_type: 'table',
            constraints_metadata: {
              primary_key: { name: 'pk_orders', columns: ['order_id'] },
              unique_constraints: [],
              check_constraints: [],
              indexes: [],
            },
          },
        ],
        physicalDataAttributes: [
          {
            id: 'a-1',
            name: 'order_id',
            physical_entity_id: 'e-orders',
            source_type: 'int',
            is_nullable: false,
            is_identity: true,
            ordinal: 1,
          },
          {
            id: 'a-2',
            name: 'amount',
            physical_entity_id: 'e-orders',
            source_type: 'numeric',
            precision: 10,
            scale: 2,
            is_nullable: false,
            ordinal: 2,
          },
        ],
        dataEntityPoints: [],
        dataEntityRelationships: [],
      },
      findings: [
        {
          id: 'f-keep',
          finding_type: 'stored_procedure_logic',
          detail_json: {
            engineKey: 'sybase',
            schemaName: 'dbo',
            procedureName: 'usp_keep',
            bodySnippet: BODY_KEEP,
            truncated: false,
            literal_policy: 'targeted_v2',
          },
        },
        {
          id: 'f-changed',
          finding_type: 'stored_procedure_logic',
          detail_json: {
            engineKey: 'sybase',
            schemaName: 'dbo',
            procedureName: 'usp_changed',
            bodySnippet: BODY_NEW,
            truncated: false,
            literal_policy: 'targeted_v2',
          },
        },
        // NEW object captured by an OLD scan: NO literal_policy marker ->
        // seeds legacy_redacted (translatable, warned).
        {
          id: 'f-new-view',
          finding_type: 'view_definition',
          detail_json: {
            engineKey: 'sybase',
            schemaName: 'dbo',
            viewName: 'v_new',
            body: 'SELECT order_id FROM dbo.orders',
            truncated: false,
          },
        },
        // NEW object truncated at capture -> seeds terminal needs_manual.
        {
          id: 'f-huge',
          finding_type: 'stored_procedure_logic',
          detail_json: {
            engineKey: 'sybase',
            schemaName: 'dbo',
            procedureName: 'usp_huge',
            bodySnippet: 'SELECT * FROM big -- [TRUNCATED]',
            truncated: true,
            literal_policy: 'targeted_v2',
          },
        },
      ],
      dbDecisions: [
        { decisionCode: 'db.engine', answerValue: 'PostgreSQL' },
        { decisionCode: 'db.migrations', answerValue: 'Liquibase' },
      ],
      resolvedPackDecisions: [],
    };

    const state: AmsState = {
      manifest: null,
      rows: [
        // Unchanged hash + approved: preserved verbatim, stays emitted.
        {
          id: 'tk',
          translation_key: 'stored_procedure--dbo.usp_keep',
          object_ref: 'dbo.usp_keep',
          kind: 'stored_procedure',
          disposition: 'translate',
          drop_reason: null,
          pipeline_state: 'drafted',
          source_body: BODY_KEEP,
          source_body_hash: computeSourceBodyHash(BODY_KEEP),
          truncated: false,
          legacy_redacted: false,
          draft_content: KEEP_DRAFT,
          judge_verdict_json: verdict,
          review_status: 'approved',
          reviewer_notes: 'ship it',
          reviewed_at: '2026-06-10T09:00:00Z',
        },
        // Changed hash + approved: demoted needs_rework + auto note, drops out.
        {
          id: 'tc',
          translation_key: 'stored_procedure--dbo.usp_changed',
          object_ref: 'dbo.usp_changed',
          kind: 'stored_procedure',
          disposition: 'translate',
          drop_reason: null,
          pipeline_state: 'drafted',
          source_body: BODY_OLD,
          source_body_hash: computeSourceBodyHash(BODY_OLD),
          truncated: false,
          legacy_redacted: false,
          draft_content: 'CREATE OR REPLACE FUNCTION dbo.usp_changed_pg() ...;',
          judge_verdict_json: verdict,
          review_status: 'approved',
          reviewer_notes: null,
        },
        // No longer in the manifest -> deleted deterministically.
        {
          id: 'tg',
          translation_key: 'trigger--dbo.trg_gone',
          object_ref: 'dbo.trg_gone',
          kind: 'trigger',
          disposition: 'translate',
          drop_reason: null,
          pipeline_state: 'pending',
          source_body: 'OLD TRIGGER',
          source_body_hash: computeSourceBodyHash('OLD TRIGGER'),
          truncated: false,
          legacy_redacted: false,
          draft_content: null,
          judge_verdict_json: null,
          review_status: 'unreviewed',
          reviewer_notes: null,
        },
      ],
      files: [],
      packPuts: [],
      upsertBodies: [],
      patches: [],
    };
    installAmsStub(state);

    // REAL stage 1-7 pipeline; only the Spec-1 input fetches + persist are
    // injected — the stage-7 translation hook is the DEFAULT (AMS via fetch).
    const result = await generateDbMigrationPack(
      { projectId: 'p1', architectureId: 'arch-1' },
      {
        fetchModel: async () => inputs.model,
        fetchFindings: async () => inputs.findings,
        fetchDbDecisions: async () => inputs.dbDecisions,
        fetchResolvedPackDecisions: async () => [],
        persistPack: async (_projectId: string, body: UpsertPackBody) => {
          // Stage-6 wholesale persist: files replaced, manifest stored.
          state.files = body.files.map((f) => ({ ...f }));
          state.manifest = body.manifest_json;
          return {
            id: 'pack-1',
            project_id: 'p1',
            architecture_id: 'arch-1',
            status: 'generated',
            input_snapshot_hash: body.input_snapshot_hash,
            translated_count: body.translated_count,
            skipped_count: body.skipped_count,
            flagged_count: body.flagged_count,
            seed_margin: body.seed_margin,
          };
        },
      }
    );

    // The hook summary: 2 new (legacy view + truncated proc), 1 re-linked
    // unchanged, 1 demoted, 1 removed; 1 approval survives into emission.
    expect(result.translationSync).toEqual({
      sync: { seeded_new: 2, relinked_unchanged: 1, demoted_needs_rework: 1, removed: 1 },
      emission: { approved_count: 1, changed: true },
    });

    // The upsert batch: unchanged row SPARSE (no review/draft fields supplied);
    // changed row demoted with the auto note; delete_absent set.
    expect(state.upsertBodies).toHaveLength(1);
    const batch = state.upsertBodies[0];
    expect(batch.delete_absent).toBe(true);
    const upsertByKey = new Map(batch.translations.map((t) => [t.translation_key, t]));
    const keepRow = upsertByKey.get('stored_procedure--dbo.usp_keep')!;
    expect(keepRow.review_status).toBeUndefined();
    expect(keepRow).not.toHaveProperty('draft_content');
    const changedRow = upsertByKey.get('stored_procedure--dbo.usp_changed')!;
    expect(changedRow.review_status).toBe('needs_rework');
    expect(changedRow.reviewer_notes).toContain('[auto] Source body changed on pack regeneration');
    expect(changedRow.source_body).toBe(BODY_NEW);
    // New-object fidelity computed from the finding detail at seed time.
    const newView = upsertByKey.get('view--dbo.v_new')!;
    expect(newView.legacy_redacted).toBe(true);
    expect(newView.pipeline_state).toBe('pending');
    const hugeProc = upsertByKey.get('stored_procedure--dbo.usp_huge')!;
    expect(hugeProc.truncated).toBe(true);
    expect(hugeProc.pipeline_state).toBe('needs_manual');

    // Post-regeneration AMS state: approval preserved VERBATIM on the
    // unchanged row; the removed row is gone.
    const kept = state.rows.find((r) => r.translation_key === 'stored_procedure--dbo.usp_keep')!;
    expect(kept.review_status).toBe('approved');
    expect(kept.draft_content).toBe(KEEP_DRAFT);
    expect(kept.reviewer_notes).toBe('ship it');
    expect(state.rows.some((r) => r.translation_key === 'trigger--dbo.trg_gone')).toBe(false);
    expect(state.rows).toHaveLength(4);

    // Emission after the re-link: ONLY the surviving approval is emitted —
    // the demoted object dropped out of the executable path until re-approved.
    expect(state.packPuts).toHaveLength(1);
    const put = state.packPuts[0];
    expect(fileOf(put, translationFilePath('stored_procedure', 'dbo.usp_keep'))!.content).toContain(
      KEEP_DRAFT
    );
    expect(fileOf(put, translationFilePath('stored_procedure', 'dbo.usp_changed'))).toBeUndefined();
    const changeset = fileOf(put, TRANSLATIONS_CHANGESET_PATH)!;
    expect(changeset.content).toContain(
      translationChangesetId('stored_procedure', 'dbo.usp_keep')
    );
    expect(changeset.content).not.toContain('usp_changed');
    expect(fileOf(put, MASTER_CHANGELOG_PATH)!.content).toContain('050-translations.sql');
    const manifest = put.manifest_json as {
      translations: { approved_count: number; approved_objects: Array<{ object_ref: string }> };
    };
    expect(manifest.translations.approved_count).toBe(1);
    expect(manifest.translations.approved_objects.map((o) => o.object_ref)).toEqual([
      'dbo.usp_keep',
    ]);
    // Deterministic everywhere: no LLM call anywhere in seeding/re-link/emission.
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (3) Coverage violation through the real translate-all route
// ---------------------------------------------------------------------------

describe('Group 6 — coverage-assertion violation through the real translate-all route', () => {
  it('returns 500 with the unaccounted key and persists NOTHING', async () => {
    const state: AmsState = {
      manifest: {
        manifest_version: 1,
        requires_translation_spec_2: [
          { kind: 'stored_procedure', object_ref: 'dbo.usp_ghost', finding_ids: [] },
        ],
      },
      rows: [], // a manifest object with NO translation row = unaccounted
      files: baseFiles(),
      packPuts: [],
      upsertBodies: [],
      patches: [],
    };
    installAmsStub(state);
    const app = createTestApp();

    const response = await request(app).post(T('pack-1', '/translate-all')).send({});
    expect(response.status).toBe(500);
    expect(response.body.error.message).toContain('coverage assertion FAILED');
    expect(response.body.error.unaccounted).toContain('stored_procedure--dbo.usp_ghost');
    // Nothing persisted: no PATCH, no upsert, no pack PUT — and no LLM call.
    expect(state.patches).toHaveLength(0);
    expect(state.upsertBodies).toHaveLength(0);
    expect(state.packPuts).toHaveLength(0);
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });
});
