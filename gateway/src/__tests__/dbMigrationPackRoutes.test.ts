/**
 * DB Migration Pack routes — focused route-surface tests.
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack —
 * Task Group 4 (Task 4.1, gateway half).
 *
 * Covers ONLY:
 *   1. POST generate happy path persists a pack via the handler, and
 *      REGENERATION ONLY happens via the explicit route call — a stale pack
 *      GET never auto-triggers generation.
 *   2. GET pack recomputes staleness and exposes `is_stale` + reason; the
 *      real staleness check recomputes the input snapshot hash with the ONE
 *      shared implementation (hash mismatch -> stale; AMS `stale` status from
 *      a decision resolve -> stale; identical inputs -> fresh).
 *   3. GET download assembles a zip ON DEMAND whose entry paths match the
 *      AMS `db_migration_pack_files.file_path` rows (no filesystem).
 *   4. refresh-seeds regenerates ONLY the sequences-seed changeset — every
 *      other persisted file row is byte-identical and the decision queue is
 *      untouched.
 */

// ---------------------------------------------------------------------------
// Mocks — declared before importing the units under test
// ---------------------------------------------------------------------------

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

const mockGenerate = jest.fn();
jest.mock('../services/dbMigrationPackHandler', () => {
  const actual = jest.requireActual('../services/dbMigrationPackHandler');
  return {
    ...actual,
    generateDbMigrationPack: (...args: unknown[]) => mockGenerate(...args),
  };
});

const mockEvaluateStaleness = jest.fn();
jest.mock('../services/dbMigrationPack/staleness', () => {
  const actual = jest.requireActual('../services/dbMigrationPack/staleness');
  return {
    ...actual,
    evaluatePackStaleness: (...args: unknown[]) => mockEvaluateStaleness(...args),
  };
});

const mockFetch = jest.fn();
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import { dbMigrationPackRouter } from '../routes/dbMigrationPack';
import { listZipEntryPaths } from '../services/dbMigrationPack/zip';
import { SEQUENCES_SEED_CHANGESET_PATH } from '../services/dbMigrationPack/liquibase';
import { computeInputSnapshotHash, GenerationInputs } from '../services/dbMigrationPack/inputs';

const actualHandler = jest.requireActual('../services/dbMigrationPackHandler');
const actualStaleness = jest.requireActual('../services/dbMigrationPack/staleness');

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

/** Minimal-but-real generation inputs (Sybase ASE -> PostgreSQL). */
function makeInputs(): GenerationInputs {
  return {
    model: {
      physicalDataEntities: [
        {
          id: 'pe-1',
          name: 'dbo.orders',
          physical_type: 'table',
          constraints_metadata: {
            primary_key: { name: 'pk_orders', columns: ['order_id'] },
          },
        },
      ],
      physicalDataAttributes: [
        {
          id: 'pa-1',
          name: 'order_id',
          physical_entity_id: 'pe-1',
          source_type: 'int',
          is_primary_key: true,
          is_nullable: false,
          ordinal: 1,
          is_identity: true,
        },
      ],
      dataEntityPoints: [],
      dataEntityRelationships: [],
    },
    findings: [
      {
        id: 'f-seq-1',
        finding_type: 'sequence_definition',
        detail_json: {
          schemaName: 'dbo',
          sequenceName: 'orders_seq',
          currentValue: '100',
          ownedByTable: 'orders',
          ownedByColumn: 'order_id',
        },
      },
    ],
    dbDecisions: [{ decisionCode: 'db.engine', answerValue: 'PostgreSQL' }],
    resolvedPackDecisions: [],
  };
}

function inputDeps(inputs: GenerationInputs) {
  return {
    fetchModel: jest.fn().mockResolvedValue(inputs.model),
    fetchFindings: jest.fn().mockResolvedValue(inputs.findings),
    fetchDbDecisions: jest.fn().mockResolvedValue(inputs.dbDecisions),
    fetchResolvedPackDecisions: jest.fn().mockResolvedValue(inputs.resolvedPackDecisions),
  };
}

beforeEach(() => {
  mockGenerate.mockReset();
  mockEvaluateStaleness.mockReset();
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// 1. generate happy path + explicit-only regeneration
// ---------------------------------------------------------------------------

describe('POST generate / regenerate (explicit only)', () => {
  it('persists a pack via the handler on generate; a stale pack GET NEVER auto-triggers generation; regenerate is its own explicit call', async () => {
    const app = createTestApp();
    mockGenerate.mockResolvedValue({
      pack: { id: 'pack-1', project_id: 'p-1', architecture_id: 'arch-1', status: 'generated' },
      inputSnapshotHash: 'hash-1',
      counts: { translated: 5, skipped: 1, flagged: 2 },
      fileCount: 9,
      decisionCount: 2,
    });

    const generated = await request(app)
      .post('/api/v1/projects/p-1/db-migration-packs/generate')
      .send({ architecture_id: 'arch-1', seed_margin: 500 });
    expect(generated.status).toBe(200);
    expect(generated.body.pack.id).toBe('pack-1');
    expect(generated.body.counts).toEqual({ translated: 5, skipped: 1, flagged: 2 });
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate).toHaveBeenCalledWith({
      projectId: 'p-1',
      architectureId: 'arch-1',
      seedMargin: 500,
    });

    // A STALE pack GET reports staleness but never regenerates.
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        id: 'pack-1',
        architecture_id: 'arch-1',
        status: 'generated',
        input_snapshot_hash: 'hash-1',
      })
    );
    mockEvaluateStaleness.mockResolvedValueOnce({
      is_stale: true,
      staleness_reason: 'inputs changed since generation',
      current_input_snapshot_hash: 'hash-2',
      staleness_check_error: null,
    });
    const got = await request(app).get('/api/v1/projects/p-1/db-migration-packs/pack-1');
    expect(got.status).toBe(200);
    expect(got.body.is_stale).toBe(true);
    expect(mockGenerate).toHaveBeenCalledTimes(1); // STILL exactly one — no auto-regenerate.

    // Regeneration requires the explicit route call.
    const regenerated = await request(app)
      .post('/api/v1/projects/p-1/db-migration-packs/regenerate')
      .send({ architecture_id: 'arch-1' });
    expect(regenerated.status).toBe(200);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 2. staleness — GET exposure + the real hash-recompute check
// ---------------------------------------------------------------------------

describe('staleness (Task 4.6)', () => {
  it('GET pack exposes is_stale + reason from the staleness check, and the REAL check recomputes the shared input snapshot hash', async () => {
    // Route exposure (staleness mocked).
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        id: 'pack-1',
        architecture_id: 'arch-1',
        status: 'generated',
        input_snapshot_hash: 'stored-hash',
        stale_reason: null,
      })
    );
    mockEvaluateStaleness.mockResolvedValueOnce({
      is_stale: true,
      staleness_reason: 'inputs changed since generation',
      current_input_snapshot_hash: 'fresh-hash',
      staleness_check_error: null,
    });
    const res = await request(createTestApp()).get(
      '/api/v1/projects/p-1/db-migration-packs/pack-1'
    );
    expect(res.status).toBe(200);
    expect(res.body.is_stale).toBe(true);
    expect(res.body.staleness_reason).toBe('inputs changed since generation');
    expect(res.body.current_input_snapshot_hash).toBe('fresh-hash');
    expect(mockEvaluateStaleness).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p-1',
        architectureId: 'arch-1',
        storedHash: 'stored-hash',
        storedStatus: 'generated',
      })
    );

    // The REAL check (jest.requireActual) recomputes the ONE shared hash:
    const inputs = makeInputs();
    const trueHash = computeInputSnapshotHash(inputs);
    const deps = inputDeps(inputs);

    // (a) identical inputs -> fresh.
    const fresh = await actualStaleness.evaluatePackStaleness(
      {
        projectId: 'p-1',
        architectureId: 'arch-1',
        storedHash: trueHash,
        storedStatus: 'generated',
        storedStaleReason: null,
      },
      deps
    );
    expect(fresh.is_stale).toBe(false);
    expect(fresh.current_input_snapshot_hash).toBe(trueHash);

    // (b) stored hash from older inputs -> stale via hash mismatch.
    const drifted = await actualStaleness.evaluatePackStaleness(
      {
        projectId: 'p-1',
        architectureId: 'arch-1',
        storedHash: 'older-hash',
        storedStatus: 'generated',
        storedStaleReason: null,
      },
      deps
    );
    expect(drifted.is_stale).toBe(true);
    expect(drifted.staleness_reason).toBe('inputs changed since generation');

    // (c) AMS already flipped the status on a decision resolve -> stale even
    // when the hash matches.
    const resolved = await actualStaleness.evaluatePackStaleness(
      {
        projectId: 'p-1',
        architectureId: 'arch-1',
        storedHash: trueHash,
        storedStatus: 'stale',
        storedStaleReason: 'decision resolved since generation',
      },
      deps
    );
    expect(resolved.is_stale).toBe(true);
    expect(resolved.staleness_reason).toBe('decision resolved since generation');
  });
});

// ---------------------------------------------------------------------------
// 3. download — on-demand zip from AMS rows
// ---------------------------------------------------------------------------

describe('GET download (Task 4.5)', () => {
  it('assembles a zip on demand whose entry paths match db_migration_pack_files.file_path rows', async () => {
    const fileRows = [
      {
        file_path: 'liquibase/db.changelog-master.xml',
        file_kind: 'liquibase_master',
        content: '<xml/>',
        sort_order: 0,
      },
      {
        file_path: 'liquibase/changesets/010-tables/dbo.orders.sql',
        file_kind: 'liquibase_changeset',
        content: 'CREATE TABLE dbo.orders ();',
        sort_order: 1,
      },
      { file_path: 'manifest.json', file_kind: 'manifest', content: '{}', sort_order: 2 },
      { file_path: 'README.md', file_kind: 'readme', content: '# pack', sort_order: 3 },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse(200, fileRows));

    const res = await request(createTestApp())
      .get('/api/v1/projects/p-1/db-migration-packs/pack-1/download')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain('db-migration-pack-pack-1.zip');
    // The archive's entry paths are EXACTLY the AMS file_path rows, in order.
    expect(listZipEntryPaths(res.body as Buffer)).toEqual(fileRows.map((f) => f.file_path));
    // Assembled purely from the AMS rows — the only upstream call was the
    // files GET (no filesystem, no second fetch).
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0][0])).toBe(
      'http://localhost:8080/api/projects/p-1/db-migration-packs/pack-1/files'
    );
  });
});

// ---------------------------------------------------------------------------
// 4. refresh-seeds — ONLY the sequences-seed changeset changes
// ---------------------------------------------------------------------------

describe('refresh-seeds (Task 4.4)', () => {
  it('regenerates ONLY the sequences-seed changeset; all other file rows are byte-identical and decisions are untouched', async () => {
    const existingFiles = [
      {
        file_path: 'liquibase/db.changelog-master.xml',
        file_kind: 'liquibase_master',
        content: '<xml/>',
        sort_order: 0,
      },
      {
        file_path: 'liquibase/changesets/010-tables/dbo.orders.sql',
        file_kind: 'liquibase_changeset',
        content: 'CREATE TABLE dbo.orders ();',
        sort_order: 1,
      },
      {
        file_path: SEQUENCES_SEED_CHANGESET_PATH,
        file_kind: 'liquibase_changeset',
        content: '-- OLD SEED CONTENT (restart 1100)',
        sort_order: 2,
      },
      { file_path: 'manifest.json', file_kind: 'manifest', content: '{"m":1}', sort_order: 3 },
    ];
    const putPack = jest.fn().mockResolvedValue({ id: 'pack-1', status: 'generated' });
    const inputs = makeInputs();

    const result = await actualHandler.refreshDbMigrationPackSeeds(
      {
        projectId: 'p-1',
        packId: 'pack-1',
        // Fresh scan: the high-water moved from 100 -> 50230.
        scanSequences: [
          {
            schemaName: 'dbo',
            sequenceName: 'orders_seq',
            currentValue: '50230',
            ownedByTable: 'orders',
            ownedByColumn: 'order_id',
          },
        ],
      },
      {
        ...inputDeps(inputs),
        fetchPack: jest.fn().mockResolvedValue({
          id: 'pack-1',
          architecture_id: 'arch-1',
          status: 'generated',
          stale_reason: null,
          input_snapshot_hash: 'stored-hash',
          translated_count: 5,
          skipped_count: 1,
          flagged_count: 2,
          seed_margin: 1000,
          manifest_json: { m: 1 },
        }),
        fetchPackFiles: jest.fn().mockResolvedValue(existingFiles),
        putPack,
      }
    );

    expect(result.updatedFilePath).toBe(SEQUENCES_SEED_CHANGESET_PATH);
    expect(result.seedChangesetChanged).toBe(true);

    expect(putPack).toHaveBeenCalledTimes(1);
    const body = putPack.mock.calls[0][1];
    // Pack-level fields pass through verbatim (nothing else changes).
    expect(body.architecture_id).toBe('arch-1');
    expect(body.status).toBe('generated');
    expect(body.input_snapshot_hash).toBe('stored-hash');
    expect(body.manifest_json).toEqual({ m: 1 });
    // The decision queue is NOT touched (the key is absent -> AMS leaves it).
    expect(body.decisions).toBeUndefined();
    // Every non-seed file row is byte-identical; ONLY the seed changeset
    // changed, and it carries the fresh high-water + margin (50230 + 1000).
    expect(body.files).toHaveLength(4);
    for (const original of existingFiles) {
      const updated = body.files.find(
        (f: { file_path: string }) => f.file_path === original.file_path
      );
      expect(updated).toBeDefined();
      if (original.file_path === SEQUENCES_SEED_CHANGESET_PATH) {
        expect(updated.content).not.toBe(original.content);
        expect(updated.content).toContain('RESTART WITH 51230');
      } else {
        expect(updated.content).toBe(original.content);
        expect(updated.sort_order).toBe(original.sort_order);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Group 7 — refresh-seeds over a REAL generated pack (Task 7.3)
// ---------------------------------------------------------------------------

describe('Group 7 — refresh-seeds end-to-end over a really generated pack', () => {
  it('leaves EVERY file byte-identical when the scanned high-water is unchanged, and changes ONLY the sequences-seed changeset when it moved', async () => {
    // 1. REAL generation (jest.requireActual — no handler mocks), capturing
    //    the exact persisted file rows.
    const inputs = makeInputs();
    const persistedBodies: Array<{
      input_snapshot_hash: string;
      translated_count: number;
      skipped_count: number;
      flagged_count: number;
      seed_margin: number;
      manifest_json: Record<string, unknown>;
      files: Array<{ file_path: string; file_kind: string; content: string; sort_order: number }>;
    }> = [];
    await actualHandler.generateDbMigrationPack(
      { projectId: 'p-1', architectureId: 'arch-1' },
      {
        ...inputDeps(inputs),
        // Spec-2 translation hook stubbed: this test covers the Spec-1 pipeline.
        translationHook: async () => null,
        persistPack: async (_projectId: string, body: (typeof persistedBodies)[number]) => {
          persistedBodies.push(body);
          return { id: 'pack-real', project_id: 'p-1', architecture_id: 'arch-1', status: 'generated' };
        },
      }
    );
    const generated = persistedBodies[0];
    const packRow = {
      id: 'pack-real',
      architecture_id: 'arch-1',
      status: 'generated',
      stale_reason: null,
      input_snapshot_hash: generated.input_snapshot_hash,
      translated_count: generated.translated_count,
      skipped_count: generated.skipped_count,
      flagged_count: generated.flagged_count,
      seed_margin: generated.seed_margin,
      manifest_json: generated.manifest_json,
    };
    const refreshDeps = (putPack: jest.Mock) => ({
      ...inputDeps(inputs),
      fetchPack: jest.fn().mockResolvedValue(packRow),
      fetchPackFiles: jest.fn().mockResolvedValue(generated.files),
      putPack,
    });

    // 2. Refresh with the SAME high-water (100): the emit path is
    //    deterministic across generate AND refresh — every row byte-identical.
    const putPackSame = jest.fn().mockResolvedValue({ id: 'pack-real', status: 'generated' });
    const same = await actualHandler.refreshDbMigrationPackSeeds(
      {
        projectId: 'p-1',
        packId: 'pack-real',
        scanSequences: [
          {
            schemaName: 'dbo',
            sequenceName: 'orders_seq',
            currentValue: '100',
            ownedByTable: 'orders',
            ownedByColumn: 'order_id',
          },
        ],
      },
      refreshDeps(putPackSame)
    );
    expect(same.seedChangesetChanged).toBe(false);
    expect(putPackSame.mock.calls[0][1].files).toEqual(generated.files);

    // 3. Refresh with a MOVED high-water (100 -> 50230): ONLY the
    //    sequences-seed changeset row changes; everything else (master
    //    changelog, table DDL, data scripts, manifest, readme) is
    //    byte-identical to the original generation.
    const putPackMoved = jest.fn().mockResolvedValue({ id: 'pack-real', status: 'generated' });
    const moved = await actualHandler.refreshDbMigrationPackSeeds(
      {
        projectId: 'p-1',
        packId: 'pack-real',
        scanSequences: [
          {
            schemaName: 'dbo',
            sequenceName: 'orders_seq',
            currentValue: '50230',
            ownedByTable: 'orders',
            ownedByColumn: 'order_id',
          },
        ],
      },
      refreshDeps(putPackMoved)
    );
    expect(moved.seedChangesetChanged).toBe(true);
    const movedFiles = putPackMoved.mock.calls[0][1].files as Array<{
      file_path: string;
      content: string;
      sort_order: number;
    }>;
    expect(movedFiles).toHaveLength(generated.files.length);
    let changedCount = 0;
    for (const original of generated.files) {
      const updated = movedFiles.find((f) => f.file_path === original.file_path)!;
      expect(updated).toBeDefined();
      expect(updated.sort_order).toBe(original.sort_order);
      if (original.file_path === SEQUENCES_SEED_CHANGESET_PATH) {
        expect(updated.content).not.toBe(original.content);
        expect(updated.content).toContain('RESTART WITH 51230'); // 50230 + margin 1000
        changedCount += 1;
      } else {
        expect(updated.content).toBe(original.content);
      }
    }
    expect(changedCount).toBe(1);
    // The decision queue stays untouched on BOTH refresh paths.
    expect(putPackSame.mock.calls[0][1].decisions).toBeUndefined();
    expect(putPackMoved.mock.calls[0][1].decisions).toBeUndefined();
  });
});
