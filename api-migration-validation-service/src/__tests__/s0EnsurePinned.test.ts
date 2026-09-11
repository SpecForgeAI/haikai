/**
 * S0 pin durability + self-heal (2026-09-11).
 *
 * The pin used to live inside the service checkout, so a fresh clone lost it
 * while the scan record still said "taken". Two repairs are pinned here: the
 * legacy tree migrates into the checkout-independent location at boot, and a
 * capture that finds no pin re-pins from the committed model instead of
 * refusing.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_ROOT = path.join(os.tmpdir(), `haikai-s0-ensure-${process.pid}-${Date.now()}`);
process.env.S0_SNAPSHOT_DIR = path.join(TMP_ROOT, 'target');

import { ensureS0Pinned, migrateLegacyS0Snapshots } from '../services/s0/ensurePinned';
import { S0_SNAPSHOT_DIR } from '../config';
import type { DbConnectionConfig } from '../types/db';

const config: DbConnectionConfig = {
  dbType: 'sybase',
  host: 'db',
  port: 5000,
  database: 'app',
  schema: null,
  username: 'u',
  password: 'p',
};

function writeSnapshot(root: string, project: string, arch: string, id: string): void {
  const dir = path.join(root, project, arch, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ snapshot_id: id, project_id: project, architecture_id: arch, created_at: '2026-09-10T19:53:59Z', source_db_type: 'sybase', schema: null, tables: [] }),
  );
  fs.writeFileSync(path.join(dir, 'orders.ndjson'), '{"id":1}\n');
}

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe('config: the snapshot root is checkout-independent', () => {
  it('honours S0_SNAPSHOT_DIR (and the default is under the user home, never the service root)', () => {
    expect(S0_SNAPSHOT_DIR).toBe(path.join(TMP_ROOT, 'target'));
  });
});

describe('migrateLegacyS0Snapshots', () => {
  it('copies snapshots the target lacks, skips ones it has, ignores half-written dirs, and is idempotent', () => {
    const legacy = path.join(TMP_ROOT, 'legacy');
    const target = path.join(TMP_ROOT, 'target');
    writeSnapshot(legacy, 'proj', 'arch', 's0-20260910195359-28080');
    writeSnapshot(legacy, 'proj', 'arch', 's0-20260901000000-1');
    writeSnapshot(target, 'proj', 'arch', 's0-20260901000000-1'); // already there
    fs.mkdirSync(path.join(legacy, 'proj', 'arch', 's0-halfwritten'), { recursive: true }); // no manifest

    const first = migrateLegacyS0Snapshots(legacy, target);
    expect(first.copied).toEqual(['proj/arch/s0-20260910195359-28080']);
    expect(first.skipped).toBe(1);
    expect(first.failed).toEqual([]);
    expect(fs.existsSync(path.join(target, 'proj', 'arch', 's0-20260910195359-28080', 'orders.ndjson'))).toBe(true);
    // The legacy copy is never deleted.
    expect(fs.existsSync(path.join(legacy, 'proj', 'arch', 's0-20260910195359-28080', 'manifest.json'))).toBe(true);

    const second = migrateLegacyS0Snapshots(legacy, target);
    expect(second.copied).toEqual([]);
    expect(second.skipped).toBe(2);
  });

  it('is a no-op when the legacy tree is absent or identical to the target', () => {
    expect(migrateLegacyS0Snapshots(path.join(TMP_ROOT, 'nope'), path.join(TMP_ROOT, 'target')).copied).toEqual([]);
    expect(migrateLegacyS0Snapshots(path.join(TMP_ROOT, 'target'), path.join(TMP_ROOT, 'target')).copied).toEqual([]);
  });
});

describe('ensureS0Pinned', () => {
  const adapter = { dispose: jest.fn().mockResolvedValue(undefined) } as unknown as ReturnType<typeof import('../services/db/dbAdapterFactory').createDbAdapter>;

  it('reports present when a snapshot is already pinned and touches nothing', async () => {
    const snapshot = jest.fn();
    const out = await ensureS0Pinned(
      { projectId: 'p', architectureId: 'a', config, reason: 'test' },
      { latestSnapshot: () => 's0-existing', snapshot, fetchMetadata: jest.fn(), createAdapter: jest.fn() },
    );
    expect(out).toEqual({ status: 'present', snapshotId: 's0-existing', detail: null });
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('re-pins from the committed model when nothing is pinned and says so', async () => {
    const snapshot = jest.fn().mockResolvedValue({
      snapshotId: 's0-new',
      dir: '/x',
      manifest: { tables: [{ table: 'orders' }, { table: 'books' }] },
    });
    const out = await ensureS0Pinned(
      { projectId: 'p', architectureId: 'a', config, reason: 'proc_capture_start' },
      {
        latestSnapshot: () => null,
        fetchMetadata: jest.fn().mockResolvedValue({ byTable: new Map([['orders', {}], ['books', {}]]) }),
        createAdapter: jest.fn().mockReturnValue(adapter),
        snapshot,
      },
    );
    expect(out.status).toBe('pinned');
    expect(out.snapshotId).toBe('s0-new');
    expect(out.detail).toContain('re-pinned now from the committed model: 2 tables');
    expect(snapshot).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p', architectureId: 'a', sourceDbType: 'sybase', schema: null }),
    );
    expect(adapter.dispose).toHaveBeenCalled();
  });

  it('fails honestly when the model holds no tables (nothing was committed) or the snapshot itself fails', async () => {
    const empty = await ensureS0Pinned(
      { projectId: 'p', architectureId: 'a', config, reason: 'test' },
      { latestSnapshot: () => null, fetchMetadata: jest.fn().mockResolvedValue({ byTable: new Map() }), createAdapter: jest.fn(), snapshot: jest.fn() },
    );
    expect(empty.status).toBe('failed');
    expect(empty.detail).toContain('no committed table metadata');

    const boom = await ensureS0Pinned(
      { projectId: 'p', architectureId: 'a', config, reason: 'test' },
      {
        latestSnapshot: () => null,
        fetchMetadata: jest.fn().mockResolvedValue({ byTable: new Map([['orders', {}]]) }),
        createAdapter: jest.fn().mockReturnValue(adapter),
        snapshot: jest.fn().mockRejectedValue(new Error('login failed')),
      },
    );
    expect(boom.status).toBe('failed');
    expect(boom.detail).toBe('S0 re-pin failed: login failed');
  });
});
