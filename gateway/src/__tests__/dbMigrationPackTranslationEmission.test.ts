/**
 * Approved-only translation emission — focused tests (Task 4.1).
 *
 * Spec: 2026-06-11 LLM-Assisted DB Object Translation Drafts — Task Group 4.
 *
 * Covers ONLY:
 *   (a) an approved translate-disposition object emits one translation-kind
 *       file row at `translations/<kind>.<schema>.<object>.sql` AND its
 *       changeset in `liquibase/changesets/050-translations.sql`, referenced
 *       from the master changelog;
 *   (b) unapproved / rejected / needs-rework / dispositioned-away objects in
 *       NEITHER output (the approved-only invariant);
 *   (c) un-approving re-runs emission and the object drops out of both;
 *   (d) changeset ids / logicalFilePath stable per object identity —
 *       re-emission of unchanged approved content is byte-identical;
 *   (e) the manifest + readme describe the translations section with
 *       per-object approval provenance;
 *   (f) the review route triggers re-emission to/from approved (Task 4.3).
 */

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    discoveryServiceBaseUrl: 'http://localhost:8091',
  }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockFetch = jest.fn();
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

import express from 'express';
import request from 'supertest';
import { dbMigrationPackRouter } from '../routes/dbMigrationPack';
import { buildReadme } from '../services/dbMigrationPackHandler';
import {
  emitMasterChangelog,
  MASTER_CHANGELOG_PATH,
  SCHEMAS_CHANGESET_PATH,
  SEQUENCES_SEED_CHANGESET_PATH,
} from '../services/dbMigrationPack/liquibase';
import {
  applyTranslationEmission,
  EmissionFileRow,
  translationChangesetId,
  translationFilePath,
  TRANSLATIONS_CHANGESET_PATH,
} from '../services/dbMigrationPack/translationEmission';
import { validatePackFiles } from '../services/dbMigrationPack/packValidation';
import {
  computeSourceBodyHash,
  TranslationRow,
} from '../services/dbMigrationPack/translations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DRAFT_SQL =
  'CREATE OR REPLACE FUNCTION dbo.usp_calc() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;';

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
    pipeline_state: partial.pipeline_state ?? 'drafted',
    source_body: partial.source_body ?? 'SELECT 1',
    source_body_hash:
      partial.source_body_hash ?? computeSourceBodyHash(partial.source_body ?? 'SELECT 1'),
    truncated: partial.truncated ?? false,
    legacy_redacted: partial.legacy_redacted ?? false,
    draft_content: partial.draft_content ?? DRAFT_SQL,
    judge_verdict_json:
      partial.judge_verdict_json ?? { verdict: 'equivalent', confidence: 0.9, flags: [] },
    review_status: partial.review_status ?? 'unreviewed',
    reviewer_notes: partial.reviewer_notes ?? null,
    reviewed_at: partial.reviewed_at ?? null,
  };
}

function baseManifest(): Record<string, unknown> {
  return {
    manifest_version: 1,
    requires_translation_spec_2: [
      { kind: 'stored_procedure', object_ref: 'dbo.usp_calc', finding_ids: [] },
    ],
  };
}

function baseFiles(): EmissionFileRow[] {
  // Every include resolves to a real file row — the runnable-pack validation
  // gate (WS3 P0) rejects dangling includes at emission time, exactly like
  // real generation output.
  const changeset = (path: string, id: string, context: string, sql: string): EmissionFileRow => ({
    file_path: path,
    file_kind: 'liquibase_changeset',
    content:
      `--liquibase formatted sql logicalFilePath:${path}\n` +
      `--changeset db-migration-pack:${id} context:${context} splitStatements:false\n` +
      `${sql}\n`,
    sort_order: 0,
  });
  return [
    {
      file_path: MASTER_CHANGELOG_PATH,
      file_kind: 'liquibase_master',
      content: emitMasterChangelog([
        SCHEMAS_CHANGESET_PATH,
        'liquibase/changesets/010-tables/dbo.orders.sql',
        SEQUENCES_SEED_CHANGESET_PATH,
      ]),
      sort_order: 0,
    },
    { ...changeset(SCHEMAS_CHANGESET_PATH, 'schemas', 'structural', 'CREATE SCHEMA IF NOT EXISTS "dbo";'), sort_order: 1 },
    { ...changeset('liquibase/changesets/010-tables/dbo.orders.sql', 'table-dbo.orders', 'structural', 'CREATE TABLE "dbo"."orders" ("id" integer);'), sort_order: 2 },
    { ...changeset(SEQUENCES_SEED_CHANGESET_PATH, 'sequences-seed', 'post-load', 'SELECT 1;'), sort_order: 3 },
    {
      file_path: 'manifest.json',
      file_kind: 'manifest',
      content: JSON.stringify(baseManifest(), null, 2) + '\n',
      sort_order: 4,
    },
  ];
}

const APPROVED = makeRow({
  id: 't1',
  translation_key: 'stored_procedure--dbo.usp_calc',
  review_status: 'approved',
  reviewed_at: '2026-06-11T10:00:00Z',
});

// ---------------------------------------------------------------------------
// (a) + (b) — dual emission with the approved-only invariant
// ---------------------------------------------------------------------------

describe('dbMigrationPack translation emission (4.2)', () => {
  it('emits an APPROVED object into translations/<kind>.<schema>.<object>.sql AND the 050 changeset referenced from the master changelog', () => {
    const result = applyTranslationEmission({
      files: baseFiles(),
      manifest: baseManifest(),
      rows: [APPROVED],
    });

    const fileRow = result.files.find(
      (f) => f.file_path === translationFilePath('stored_procedure', 'dbo.usp_calc')
    )!;
    expect(fileRow).toBeDefined();
    expect(fileRow.file_path).toBe('translations/stored_procedure.dbo.usp_calc.sql');
    expect(fileRow.file_kind).toBe('translation');
    expect(fileRow.content).toContain(DRAFT_SQL);

    const changeset = result.files.find((f) => f.file_path === TRANSLATIONS_CHANGESET_PATH)!;
    expect(changeset).toBeDefined();
    expect(changeset.file_kind).toBe('liquibase_changeset');
    expect(changeset.content).toContain(
      `logicalFilePath:${TRANSLATIONS_CHANGESET_PATH}`
    );
    expect(changeset.content).toContain(
      `--changeset db-migration-pack:${translationChangesetId('stored_procedure', 'dbo.usp_calc')}`
    );
    expect(changeset.content).toContain(DRAFT_SQL);

    const master = result.files.find((f) => f.file_path === MASTER_CHANGELOG_PATH)!;
    expect(master.content).toContain('changesets/050-translations.sql');
    // 050 referenced AFTER 040-sequences-seed (Spec-1 numbering).
    expect(master.content.indexOf('050-translations.sql')).toBeGreaterThan(
      master.content.indexOf('040-sequences-seed.sql')
    );
  });

  it('keeps unapproved / rejected / needs-rework / dispositioned-away objects out of BOTH outputs (approved-only invariant)', () => {
    const rows = [
      makeRow({ translation_key: 'stored_procedure--dbo.usp_unreviewed' }),
      makeRow({ translation_key: 'view--dbo.v_rejected', review_status: 'rejected' }),
      makeRow({ translation_key: 'trigger--dbo.trg_rework', review_status: 'needs_rework' }),
      // Approved but dispositioned AWAY — disposition wins, never emitted.
      makeRow({
        translation_key: 'view--dbo.v_dispositioned',
        review_status: 'approved',
        disposition: 'rewrite_in_app',
      }),
      makeRow({
        translation_key: 'trigger--dbo.trg_dropped',
        review_status: 'approved',
        disposition: 'drop',
        drop_reason: 'obsolete',
      }),
    ];
    const result = applyTranslationEmission({
      files: baseFiles(),
      manifest: baseManifest(),
      rows,
    });
    expect(result.files.some((f) => f.file_kind === 'translation')).toBe(false);
    expect(result.files.some((f) => f.file_path === TRANSLATIONS_CHANGESET_PATH)).toBe(false);
    const master = result.files.find((f) => f.file_path === MASTER_CHANGELOG_PATH)!;
    expect(master.content).not.toContain('050-translations');
    expect(result.emittedFilePaths).toEqual([]);
  });

  // (c) -----------------------------------------------------------------
  it('drops an un-approved object out of BOTH outputs on re-emission (e.g. the regeneration demote)', () => {
    const approvedResult = applyTranslationEmission({
      files: baseFiles(),
      manifest: baseManifest(),
      rows: [APPROVED],
    });
    expect(approvedResult.files.some((f) => f.file_kind === 'translation')).toBe(true);

    // Demoted (approve -> needs_rework, the re-link demote) — re-run the
    // emission over the PREVIOUS output: prior artifacts are stripped.
    const demoted = { ...APPROVED, review_status: 'needs_rework' as const };
    const reEmitted = applyTranslationEmission({
      files: approvedResult.files,
      manifest: approvedResult.manifest,
      rows: [demoted],
    });
    expect(reEmitted.files.some((f) => f.file_kind === 'translation')).toBe(false);
    expect(reEmitted.files.some((f) => f.file_path === TRANSLATIONS_CHANGESET_PATH)).toBe(false);
    const master = reEmitted.files.find((f) => f.file_path === MASTER_CHANGELOG_PATH)!;
    expect(master.content).not.toContain('050-translations');
    const manifest = reEmitted.manifest as { translations: { approved_count: number } };
    expect(manifest.translations.approved_count).toBe(0);
  });

  // (d) -----------------------------------------------------------------
  it('re-emits unchanged approved content byte-identically (stable ids + logicalFilePath — no checksum churn)', () => {
    const first = applyTranslationEmission({
      files: baseFiles(),
      manifest: baseManifest(),
      rows: [APPROVED],
    });
    const second = applyTranslationEmission({
      files: first.files,
      manifest: first.manifest,
      rows: [APPROVED],
    });
    expect(second.files).toEqual(first.files);
    expect(second.manifest).toEqual(first.manifest);
    // Identity-derived names are pure functions of object identity.
    expect(translationChangesetId('stored_procedure', 'dbo.usp_calc')).toBe(
      'translation-stored_procedure-dbo.usp_calc'
    );
    expect(translationFilePath('stored_procedure', 'dbo.usp_calc')).toBe(
      'translations/stored_procedure.dbo.usp_calc.sql'
    );
  });

  // (e) -----------------------------------------------------------------
  it('records per-object approval provenance in the manifest (and the readme describes the translations section)', () => {
    const result = applyTranslationEmission({
      files: baseFiles(),
      manifest: baseManifest(),
      rows: [APPROVED],
    });
    const manifest = result.manifest as {
      translations: {
        approved_count: number;
        approved_objects: Array<Record<string, unknown>>;
        note: string;
      };
    };
    expect(manifest.translations.approved_count).toBe(1);
    expect(manifest.translations.approved_objects[0]).toEqual({
      kind: 'stored_procedure',
      object_ref: 'dbo.usp_calc',
      translation_key: 'stored_procedure--dbo.usp_calc',
      file_path: 'translations/stored_procedure.dbo.usp_calc.sql',
      changeset_id: 'translation-stored_procedure-dbo.usp_calc',
      source_body_hash: APPROVED.source_body_hash,
      reviewed_at: '2026-06-11T10:00:00Z',
    });
    expect(manifest.translations.note).toContain('Only APPROVED translations');
    // The manifest.json FILE row is kept in lockstep with the manifest.
    const manifestFile = result.files.find((f) => f.file_path === 'manifest.json')!;
    expect(JSON.parse(manifestFile.content)).toEqual(manifest);
    // The pack readme describes the translations section.
    const readme = buildReadme();
    expect(readme).toContain('050-translations.sql');
    expect(readme).toContain('translations/');
    expect(readme).toContain('APPROVED');
  });
});

// ---------------------------------------------------------------------------
// (f) review-route trigger (Task 4.3): to/from approved re-runs emission
// ---------------------------------------------------------------------------

describe('dbMigrationPack translation emission — review-route trigger (4.3)', () => {
  function createTestApp() {
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/api/v1', dbMigrationPackRouter);
    return app;
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

  it('approve emits the translation into the pack PUT; needs_rework re-emission removes it', async () => {
    // Stateful AMS stub: the review PATCH mutates the row; emission re-reads.
    const row = makeRow({
      id: 't1',
      translation_key: 'stored_procedure--dbo.usp_calc',
      review_status: 'unreviewed',
    });
    const packPuts: Array<Record<string, unknown>> = [];
    let files = baseFiles();
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/translations') && method === 'GET') {
        return jsonResponse(200, [row]);
      }
      if (url.endsWith('/translations/t1') && method === 'PATCH') {
        Object.assign(row, JSON.parse(String(init!.body)));
        return jsonResponse(200, row);
      }
      if (url.endsWith('/db-migration-packs/pack-1/files') && method === 'GET') {
        return jsonResponse(200, files);
      }
      if (url.endsWith('/db-migration-packs/pack-1') && method === 'GET') {
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
          manifest_json: baseManifest(),
        });
      }
      if (url.endsWith('/db-migration-packs') && method === 'PUT') {
        const body = JSON.parse(String(init!.body)) as Record<string, unknown>;
        packPuts.push(body);
        files = body.files as EmissionFileRow[]; // AMS replaces files wholesale
        return jsonResponse(200, { id: 'pack-1' });
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });

    const app = createTestApp();

    // --- approve: emission PUT carries the translation + 050 + master include
    const approve = await request(app)
      .post('/api/v1/projects/p1/db-migration-packs/pack-1/translations/t1/review')
      .send({ action: 'approve', notes: 'verified in IDE' });
    expect(approve.status).toBe(200);
    expect(approve.body.translation.review_status).toBe('approved');
    expect(approve.body.emission.approved_count).toBe(1);
    expect(packPuts).toHaveLength(1);
    const emittedFiles = packPuts[0].files as EmissionFileRow[];
    expect(
      emittedFiles.some(
        (f) =>
          f.file_path === 'translations/stored_procedure.dbo.usp_calc.sql' &&
          f.file_kind === 'translation'
      )
    ).toBe(true);
    expect(emittedFiles.some((f) => f.file_path === TRANSLATIONS_CHANGESET_PATH)).toBe(true);
    const master = emittedFiles.find((f) => f.file_path === MASTER_CHANGELOG_PATH)!;
    expect(master.content).toContain('050-translations.sql');

    // --- un-approve (needs_rework): re-emission removes it from BOTH outputs
    const rework = await request(app)
      .post('/api/v1/projects/p1/db-migration-packs/pack-1/translations/t1/review')
      .send({ action: 'needs_rework', notes: 'tighten error handling' });
    expect(rework.status).toBe(200);
    expect(packPuts).toHaveLength(2);
    const reworkFiles = packPuts[1].files as EmissionFileRow[];
    expect(reworkFiles.some((f) => f.file_kind === 'translation')).toBe(false);
    expect(reworkFiles.some((f) => f.file_path === TRANSLATIONS_CHANGESET_PATH)).toBe(false);
    expect(
      (reworkFiles.find((f) => f.file_path === MASTER_CHANGELOG_PATH)!.content as string)
    ).not.toContain('050-translations');

    // --- a plain reject from a non-approved state does NOT re-emit
    const reject = await request(app)
      .post('/api/v1/projects/p1/db-migration-packs/pack-1/translations/t1/review')
      .send({ action: 'reject' });
    expect(reject.status).toBe(200);
    expect(reject.body.emission).toBeNull();
    expect(packPuts).toHaveLength(2);
  });
});
// ---------------------------------------------------------------------------
// Emission gate (2026-08-09): approved drafts that cannot apply are DEMOTED —
// excluded from the executable path and reported — never allowed to brick the
// pack (the first live approved batch carried a proc still SELECTing from
// sysobjects, and the emission validator failed the WHOLE regenerate).
// ---------------------------------------------------------------------------

describe('translation emission — approved-but-unrunnable drafts demote instead of bricking', () => {
  it('sysobjects-referencing draft: excluded from 050, reported as a demotion with the honest reason', () => {
    const rows = [
      makeRow({
        translation_key: 'stored_procedure--dbo.CreateGrants',
        review_status: 'approved',
        draft_content:
          'CREATE OR REPLACE FUNCTION dbo.creategrants() RETURNS void LANGUAGE plpgsql AS $$ ' +
          'BEGIN PERFORM name FROM sysobjects; END $$;',
      }),
      makeRow({
        translation_key: 'stored_procedure--dbo.usp_calc',
        review_status: 'approved',
      }),
    ];
    const result = applyTranslationEmission({
      files: baseFiles(),
      manifest: baseManifest(),
      rows,
    });
    expect(result.demotions).toHaveLength(1);
    expect(result.demotions[0].row.translation_key).toBe('stored_procedure--dbo.CreateGrants');
    expect(result.demotions[0].reason).toContain('sysobjects');
    const changeset = result.files.find((f) => f.file_path === TRANSLATIONS_CHANGESET_PATH)!;
    expect(changeset.content).toContain('dbo.usp_calc');
    expect(changeset.content).not.toContain('CreateGrants');
    // The pack validator passes — the bad draft never reached the executable path.
    expect(validatePackFiles(result.files)).toEqual([]);
  });

  it('a draft declaring a relation the structural pack already owns demotes with the collision named', () => {
    const files = baseFiles();
    // Structural changeset owns dbo.orders.
    files.push({
      file_path: 'liquibase/changesets/010-tables/dbo.orders.sql',
      file_kind: 'liquibase_changeset',
      content:
        '--liquibase formatted sql logicalFilePath:liquibase/changesets/010-tables/dbo.orders.sql\n' +
        '--changeset db-migration-pack:table-dbo.orders context:structural splitStatements:false\n' +
        'CREATE TABLE "dbo"."orders" (\n  "id" bigint\n);\n',
      sort_order: 90,
    });
    const rows = [
      makeRow({
        translation_key: 'view--dbo.orders',
        review_status: 'approved',
        draft_content: 'CREATE OR REPLACE VIEW "dbo"."orders" AS SELECT 1 AS x;',
      }),
    ];
    const result = applyTranslationEmission({ files, manifest: baseManifest(), rows });
    expect(result.demotions).toHaveLength(1);
    expect(result.demotions[0].reason).toContain('already owned by');
    expect(result.files.some((f) => f.file_path === TRANSLATIONS_CHANGESET_PATH)).toBe(false);
  });

  it('two approved drafts claiming ONE view: the first emits, the second demotes', () => {
    const rows = [
      makeRow({
        translation_key: 'view--dbo.v_a',
        review_status: 'approved',
        draft_content: 'CREATE OR REPLACE VIEW "dbo"."v_shared" AS SELECT 1;',
      }),
      makeRow({
        translation_key: 'view--dbo.v_b',
        review_status: 'approved',
        draft_content: 'CREATE OR REPLACE VIEW "dbo"."v_shared" AS SELECT 2;',
      }),
    ];
    const result = applyTranslationEmission({
      files: baseFiles(),
      manifest: baseManifest(),
      rows,
    });
    expect(result.demotions).toHaveLength(1);
    expect(result.demotions[0].row.translation_key).toBe('view--dbo.v_b');
    const changeset = result.files.find((f) => f.file_path === TRANSLATIONS_CHANGESET_PATH)!;
    expect(changeset.content).toContain('SELECT 1');
    expect(changeset.content).not.toContain('SELECT 2');
  });

  it('a clean approved view emits with ZERO demotions (the provenance copy is not a self-collision)', () => {
    const rows = [
      makeRow({
        translation_key: 'view--dbo.ext_hierarchy_org_vw',
        review_status: 'approved',
        draft_content: 'CREATE OR REPLACE VIEW "dbo"."ext_hierarchy_org_vw" AS SELECT 1 AS x;',
      }),
    ];
    const result = applyTranslationEmission({
      files: baseFiles(),
      manifest: baseManifest(),
      rows,
    });
    expect(result.demotions).toEqual([]);
    // Both the 050 changeset AND the provenance copy exist — and validate.
    expect(result.files.some((f) => f.file_path === TRANSLATIONS_CHANGESET_PATH)).toBe(true);
    expect(
      result.files.some((f) => f.file_path === 'translations/view.dbo.ext_hierarchy_org_vw.sql'),
    ).toBe(true);
    expect(validatePackFiles(result.files)).toEqual([]);
  });
});

