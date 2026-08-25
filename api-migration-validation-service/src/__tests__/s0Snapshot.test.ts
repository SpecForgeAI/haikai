/**
 * S0 snapshot / fingerprint / restore — end-to-end tests (Capture-State
 * Discipline Spec 2) against the shared in-memory fakes. The env var is set
 * BEFORE the config-dependent modules load (explicit requires below) so the
 * snapshot files land in a throwaway temp dir.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TMP_ROOT = path.join(os.tmpdir(), `haikai-s0-test-${process.pid}-${Date.now()}`);
process.env.S0_SNAPSHOT_DIR = TMP_ROOT;

/* eslint-disable @typescript-eslint/no-var-requires */
const { buildCompensationMetadataIndex } = require('../services/compensation/compensationMetadata');
const { runS0Snapshot } = require('../services/s0/snapshotRunner');
const { verifyS0Fingerprint, defaultVerifyTolerated } = require('../services/s0/fingerprint');
const { runS0Restore } = require('../services/s0/restoreRunner');
const { latestSnapshotId, readManifest, snapshotDirFor } = require('../services/s0/manifest');
const {
  checkRestoreStatement,
  checkCompensationStatement,
} = require('../services/compensation/compensationSqlGuard');
const { FakeStore, fakeReadAdapter, fakeWriteAdapter } = require('./helpers/compensationFakes');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

const MODEL = {
  metaModel: {
    entities: {
      physical_data_entities: [
        {
          id: 'e-orders',
          name: 'orders',
          constraints_metadata: { primary_key: { name: 'pk', columns: ['id'] } },
        },
        {
          id: 'e-lines',
          name: 'order_lines',
          constraints_metadata: { primary_key: { name: 'pk', columns: ['order_id', 'line_no'] } },
        },
        { id: 'e-audit', name: 'audit_log', constraints_metadata: {} },
      ],
      physical_data_attributes: [
        { physical_entity_id: 'e-orders', name: 'id', is_identity: true, is_primary_key: true, source_type: 'int', ordinal: 1 },
        { physical_entity_id: 'e-orders', name: 'name', source_type: 'varchar', ordinal: 2 },
        { physical_entity_id: 'e-lines', name: 'order_id', is_primary_key: true, source_type: 'int', ordinal: 1 },
        { physical_entity_id: 'e-lines', name: 'line_no', is_primary_key: true, source_type: 'int', ordinal: 2 },
        { physical_entity_id: 'e-lines', name: 'sku', source_type: 'varchar', ordinal: 3 },
        { physical_entity_id: 'e-audit', name: 'message', source_type: 'text', ordinal: 1 },
      ],
    },
  },
};
const METADATA = buildCompensationMetadataIndex(MODEL);

function seededStore() {
  const store = new FakeStore();
  store.tables.set('orders', [
    { id: 1, name: 'alpha' },
    { id: 2, name: 'beta' },
    { id: 3, name: 'gamma' },
  ]);
  store.tables.set('order_lines', [
    { order_id: 1, line_no: 1, sku: 'A' },
    { order_id: 1, line_no: 2, sku: 'B' },
  ]);
  store.tables.set('audit_log', [{ message: 'no pk here' }]);
  return store;
}

async function takeSnapshot(store: InstanceType<typeof FakeStore>, snapshotId: string) {
  return runS0Snapshot({
    adapter: fakeReadAdapter(store),
    metadata: METADATA,
    projectId: 'p1',
    architectureId: 'a1',
    sourceDbType: 'sybase',
    snapshotId,
  });
}

describe('runS0Snapshot', () => {
  it('dumps PK-ordered JSONL per table with counts + checksums, and skips no-PK tables loudly', async () => {
    const store = seededStore();
    const { manifest, dir } = await takeSnapshot(store, 's0-test-001');

    const byTable = new Map(manifest.tables.map((t: { table: string }) => [t.table, t]));
    expect((byTable.get('orders') as { row_count: number }).row_count).toBe(3);
    expect((byTable.get('orders') as { checksum: string | null }).checksum).not.toBeNull();
    expect((byTable.get('order_lines') as { row_count: number }).row_count).toBe(2);
    const audit = byTable.get('audit_log') as { note: string | null; file: string | null; checksum: string | null };
    expect(audit.note).toBe('skipped_no_pk_count_only');
    expect(audit.file).toBeNull();
    expect(audit.checksum).toBeNull();

    const ordersFile = fs.readFileSync(path.join(dir, 'orders.jsonl'), 'utf8').trim().split('\n');
    expect(ordersFile).toHaveLength(3);
    expect(JSON.parse(ordersFile[0])).toEqual({ id: 1, name: 'alpha' });
  });

  it('is deterministic: identical state -> identical checksums', async () => {
    const a = await takeSnapshot(seededStore(), 's0-test-002');
    const b = await takeSnapshot(seededStore(), 's0-test-003');
    const csA = a.manifest.tables.map((t: { checksum: string | null }) => t.checksum);
    const csB = b.manifest.tables.map((t: { checksum: string | null }) => t.checksum);
    expect(csA).toEqual(csB);
  });

  it('latestSnapshotId resolves the lexicographically newest manifest-bearing dir', () => {
    expect(latestSnapshotId('p1', 'a1')).toBe('s0-test-003');
    expect(readManifest(snapshotDirFor('p1', 'a1', 's0-test-003'))).not.toBeNull();
  });
});

describe('verifyS0Fingerprint', () => {
  it('matches an untouched store and lists no-PK tables as count-only', async () => {
    const store = seededStore();
    const { manifest } = await takeSnapshot(store, 's0-test-010');
    const report = await verifyS0Fingerprint(fakeReadAdapter(store), METADATA, manifest);
    expect(report.matches).toBe(true);
    expect(report.count_only_tables).toContain('audit_log');
  });

  it('flags a value change as checksum_mismatch (counts equal)', async () => {
    const store = seededStore();
    const { manifest } = await takeSnapshot(store, 's0-test-011');
    store.tables.get('orders')![1].name = 'MUTATED';
    const report = await verifyS0Fingerprint(fakeReadAdapter(store), METADATA, manifest);
    expect(report.matches).toBe(false);
    expect(report.mismatches).toEqual([
      expect.objectContaining({ table: 'orders', kind: 'checksum_mismatch' }),
    ]);
  });

  it('flags a row-count change as count_mismatch', async () => {
    const store = seededStore();
    const { manifest } = await takeSnapshot(store, 's0-test-012');
    store.tables.get('order_lines')!.pop();
    const report = await verifyS0Fingerprint(fakeReadAdapter(store), METADATA, manifest);
    expect(report.matches).toBe(false);
    expect(report.mismatches).toEqual([
      expect.objectContaining({ table: 'order_lines', kind: 'count_mismatch', expected: 2, actual: 1 }),
    ]);
  });
});

describe('runS0Restore', () => {
  it('truncates + re-inserts + reseeds back to a verified S0', async () => {
    const store = seededStore();
    const pristine = store.snapshotJson();
    const { manifest, dir } = await takeSnapshot(store, 's0-test-020');

    // Wreck the state: insert, update, delete across dumped tables.
    store.tables.get('orders')!.push({ id: 9, name: 'junk' });
    store.tables.get('orders')![0].name = 'WRECKED';
    store.tables.get('order_lines')!.shift();

    const report = await runS0Restore({
      readAdapter: fakeReadAdapter(store),
      writeAdapter: fakeWriteAdapter(store),
      metadata: METADATA,
      manifest,
      dir,
      engine: 'sybase',
    });

    expect(report.status).toBe('restored');
    expect(store.snapshotJson()).toBe(pristine);
    expect(store.truncates).toEqual(expect.arrayContaining(['orders', 'order_lines']));
    expect(store.reseeds.some((r: string) => r.includes("'orders'"))).toBe(true);
    expect(report.verification?.matches).toBe(true);
    const audit = report.tables.find((t: { table: string }) => t.table === 'audit_log');
    expect(audit?.status).toBe('skipped_not_dumped');
  });

  it('reports failed (never silent) when an insert batch is sabotaged', async () => {
    const store = seededStore();
    const { manifest, dir } = await takeSnapshot(store, 's0-test-021');
    store.tables.get('orders')!.push({ id: 9, name: 'junk' });

    const report = await runS0Restore({
      readAdapter: fakeReadAdapter(store),
      writeAdapter: fakeWriteAdapter(store, { dropMatching: /^INSERT INTO orders/ }),
      metadata: METADATA,
      manifest,
      dir,
      engine: 'sybase',
    });
    // Inserts silently skipped -> orders is empty -> verification count fails.
    expect(report.status).toBe('failed');
    expect(report.verification?.matches).toBe(false);
  });
});

describe('S0 verify tolerated default (Kiro C2, 2026-08-25)', () => {
  it('defaultVerifyTolerated composes un-dumped manifest tables with the model tolerance classes', () => {
    const manifest = {
      snapshot_id: 's', project_id: 'p', architecture_id: 'a',
      created_at: 'x', source_db_type: 'sybase', schema: null,
      tables: [
        { table: 'orders', pk_columns: ['id'], row_count: 3, checksum: 'c', file: 'orders.jsonl', note: null },
        { table: 'audit_log', pk_columns: [], row_count: 1, checksum: null, file: null, note: 'skipped_no_pk_count_only' },
      ],
    };
    const tolerated = defaultVerifyTolerated(
      {
        volatileTables: new Set(['work_queue']),
        auditSinkTables: new Set(['audit_trail_info']),
        sequenceGeneratorTables: new Set(['seq_registry']),
      },
      manifest,
    );
    expect([...tolerated].sort()).toEqual([
      'audit_log',
      'audit_trail_info',
      'seq_registry',
      'work_queue',
    ]);
    // Dumped tables are NEVER tolerated — a mismatch there stays a hard failure.
    expect(tolerated.has('orders')).toBe(false);
  });

  it('the restore self-verify reports RESTORED when only un-restorable tables diverged', async () => {
    // Pre-fix: the self-verify received no tolerated set, so a restore
    // that reset every restorable table still reported failed on the
    // un-dumped audit table it structurally could not touch.
    const store = seededStore();
    const { manifest, dir } = await takeSnapshot(store, 's0-test-c2');

    // Wreck a dumped table (restorable) AND write to the un-dumped no-PK
    // audit table (NOT restorable — it was never dumped).
    store.tables.get('orders')!.push({ id: 9, name: 'junk' });
    store.tables.get('audit_log')!.push({ message: 'late write during capture' });

    const report = await runS0Restore({
      readAdapter: fakeReadAdapter(store),
      writeAdapter: fakeWriteAdapter(store),
      metadata: METADATA,
      manifest,
      dir,
      engine: 'sybase',
    });

    const audit = report.tables.find((t: { table: string }) => t.table === 'audit_log');
    expect(audit?.status).toBe('skipped_not_dumped');
    // The un-dumped divergence is tolerated — visible, honest, non-failing.
    expect(report.verification?.matches).toBe(true);
    expect(
      report.verification?.tolerated_mismatches.map((m: { table: string }) => m.table),
    ).toContain('audit_log');
    expect(report.status).toBe('restored');
  });
});

describe('restore guard grammar', () => {
  it('admits TRUNCATE TABLE only in restore mode', () => {
    expect(checkRestoreStatement('TRUNCATE TABLE orders').allowed).toBe(true);
    expect(checkCompensationStatement('TRUNCATE TABLE orders').allowed).toBe(false);
  });
  it('full-anchors the truncate form (no chaining)', () => {
    expect(checkRestoreStatement('TRUNCATE TABLE orders; DROP TABLE orders').allowed).toBe(false);
  });
  it('restore mode still admits the compensation grammar', () => {
    expect(checkRestoreStatement("INSERT INTO orders (id, name) VALUES (1, 'a')").allowed).toBe(
      true,
    );
    expect(checkRestoreStatement('SET IDENTITY_INSERT orders ON').allowed).toBe(true);
  });
  it('restore mode still refuses DDL', () => {
    expect(checkRestoreStatement('DROP TABLE orders').allowed).toBe(false);
    expect(checkRestoreStatement('ALTER TABLE orders ADD c INT').allowed).toBe(false);
  });
});
