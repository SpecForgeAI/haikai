/**
 * Scoped-row imaging engine (state-discipline remediation Item #1,
 * 2026-08-27) — runner-level pins against the in-memory fakes with the
 * full-image cap forced tiny (env set BEFORE the config-dependent modules
 * load, s0Snapshot.test.ts pattern):
 *
 *   - an OVER-CAP write table with a single numeric PK is no longer refused:
 *     per-call scoped images give exact update undo, the max(PK) sweep
 *     deletes new rows, the identity reseeds to max-before;
 *   - an over-cap write table WITHOUT a sweepable PK still refuses
 *     `table_too_large` (fail-closed, unchanged);
 *   - READ-mapped tables are never imaged: inserts are reverted by the
 *     sweep; a delete the bracket cannot revert surfaces as
 *     `read_guard_moved` residue naming the table; untouched tables are
 *     clean with a guard observation; policy-tolerated (volatile) read
 *     tables are skipped entirely.
 */

process.env.COMPENSATION_FULL_IMAGE_MAX_ROWS = '5';

/* eslint-disable @typescript-eslint/no-var-requires */
const { runCompensationBracket } = require('../services/compensation/compensationRunner');
const {
  buildCompensationMetadataIndex,
} = require('../services/compensation/compensationMetadata');
const { FakeStore, fakeReadAdapter, fakeWriteAdapter } = require('./helpers/compensationFakes');
/* eslint-enable @typescript-eslint/no-var-requires */

import type { BracketCallHooks } from '../services/compensation/types';

const MODEL = {
  metaModel: {
    entities: {
      physical_data_entities: [
        {
          id: 'e-reg',
          name: 'view_registry',
          constraints_metadata: { primary_key: { name: 'pk', columns: ['ViewId'] } },
        },
        {
          id: 'e-comp',
          name: 'composite_ref',
          constraints_metadata: { primary_key: { name: 'pk', columns: ['A', 'B'] } },
        },
        {
          id: 'e-queue',
          name: 'work_queue',
          migration_scope: 'volatile',
          constraints_metadata: { primary_key: { name: 'pk', columns: ['Id'] } },
        },
      ],
      physical_data_attributes: [
        { physical_entity_id: 'e-reg', name: 'ViewId', is_identity: true, is_primary_key: true, source_type: 'int', ordinal: 1 },
        { physical_entity_id: 'e-reg', name: 'ViewName', source_type: 'varchar', ordinal: 2 },
        { physical_entity_id: 'e-comp', name: 'A', is_primary_key: true, source_type: 'int', ordinal: 1 },
        { physical_entity_id: 'e-comp', name: 'B', is_primary_key: true, source_type: 'int', ordinal: 2 },
        { physical_entity_id: 'e-comp', name: 'V', source_type: 'varchar', ordinal: 3 },
        { physical_entity_id: 'e-queue', name: 'Id', is_primary_key: true, source_type: 'int', ordinal: 1 },
      ],
    },
  },
};

const METADATA = buildCompensationMetadataIndex(MODEL);

/** Six rows — one over the forced cap of five. */
function overCapStore() {
  const store = new FakeStore();
  store.tables.set(
    'view_registry',
    [1, 2, 3, 4, 5, 6].map((i) => ({ ViewId: i, ViewName: `view-${i}` })),
  );
  return store;
}

describe('scoped-row imaging (Item #1)', () => {
  it('an over-cap write table with a numeric PK is scoped, swept, reseeded — never refused', async () => {
    const store = overCapStore();
    const pristine = store.snapshotJson();

    const run = await runCompensationBracket({
      readAdapter: fakeReadAdapter(store),
      writeAdapter: fakeWriteAdapter(store),
      engine: 'sybase',
      schema: null,
      tables: ['view_registry'],
      metadata: METADATA,
      fire: async (hooks?: BracketCallHooks) => {
        // The tool reports the concrete params BEFORE the call fires…
        await hooks?.beforeMutatingCall({ params: { viewId: 2 } });
        // …then the "app" updates the scoped row AND inserts a new one.
        store.tables.get('view_registry')![1].ViewName = 'RENAMED';
        store.tables.get('view_registry')!.push({ ViewId: 7, ViewName: 'created' });
        return 'fired';
      },
    });

    expect(run.fired).toBe(true);
    expect(run.outcome.kind).toBe('compensated');
    expect(store.snapshotJson()).toBe(pristine);
    // Exact undo, never a truncate; identity reseeded to max-before (6).
    expect(store.truncates).toEqual([]);
    expect(store.reseeds.some((r: string) => r.includes("'view_registry'") && r.includes("'6'"))).toBe(
      true,
    );
    expect(run.outcome.statementsApplied.some((s: string) => s.startsWith('DELETE FROM view_registry'))).toBe(true);
    expect(run.outcome.statementsApplied.some((s: string) => s.startsWith('UPDATE view_registry'))).toBe(true);
  });

  it('an over-cap write table WITHOUT a sweepable PK still refuses table_too_large (fail-closed)', async () => {
    const store = new FakeStore();
    store.tables.set(
      'composite_ref',
      [1, 2, 3, 4, 5, 6].map((i) => ({ A: i, B: i, V: `v${i}` })),
    );
    const run = await runCompensationBracket({
      readAdapter: fakeReadAdapter(store),
      writeAdapter: fakeWriteAdapter(store),
      engine: 'sybase',
      schema: null,
      tables: ['composite_ref'],
      metadata: METADATA,
      fire: async () => 'never',
    });
    expect(run.fired).toBe(false);
    expect(run.outcome.kind).toBe('refused');
    expect(run.outcome.refusals[0]).toMatchObject({ table: 'composite_ref', reason: 'table_too_large' });
  });

  it('a READ-mapped insert is reverted by the sweep; an unrevertable delete is read_guard_moved residue', async () => {
    // Insert case — sweep deletes the new row, guard settles.
    const insertStore = overCapStore();
    const pristine = insertStore.snapshotJson();
    const insertRun = await runCompensationBracket({
      readAdapter: fakeReadAdapter(insertStore),
      writeAdapter: fakeWriteAdapter(insertStore),
      engine: 'sybase',
      schema: null,
      tables: [],
      readTables: ['view_registry'],
      metadata: METADATA,
      fire: async () => {
        insertStore.tables.get('view_registry')!.push({ ViewId: 9, ViewName: 'leak' });
        return 'fired';
      },
    });
    expect(insertRun.outcome.kind).toBe('compensated');
    expect(insertStore.snapshotJson()).toBe(pristine);
    const obs = insertRun.outcome.readGuardObservations?.find(
      (o: { table: string }) => o.table === 'view_registry',
    );
    expect(obs?.revertedBySweep).toBe(true);

    // Delete case — nothing to sweep back; the guard names the table.
    const deleteStore = overCapStore();
    const deleteRun = await runCompensationBracket({
      readAdapter: fakeReadAdapter(deleteStore),
      writeAdapter: fakeWriteAdapter(deleteStore),
      engine: 'sybase',
      schema: null,
      tables: [],
      readTables: ['view_registry'],
      metadata: METADATA,
      fire: async () => {
        deleteStore.tables.get('view_registry')!.shift();
        return 'fired';
      },
    });
    expect(deleteRun.outcome.kind).toBe('residue');
    expect(deleteRun.outcome.residue[0]).toMatchObject({
      table: 'view_registry',
      kind: 'read_guard_moved',
    });
  });

  it('untouched read tables are clean; volatile read tables are policy-skipped even when they drift', async () => {
    const store = overCapStore();
    store.tables.set('work_queue', [{ Id: 1 }]);
    const run = await runCompensationBracket({
      readAdapter: fakeReadAdapter(store),
      writeAdapter: fakeWriteAdapter(store),
      engine: 'sybase',
      schema: null,
      tables: [],
      readTables: ['view_registry', 'work_queue'],
      metadata: METADATA,
      fire: async () => {
        // Policy-tolerated drift: the volatile queue moves; the guard must
        // not turn legitimate churn into residue.
        store.tables.get('work_queue')!.push({ Id: 2 });
        return 'fired';
      },
    });
    expect(run.outcome.kind).toBe('clean');
    const tables = (run.outcome.readGuardObservations ?? []).map((o: { table: string }) => o.table);
    expect(tables).toContain('view_registry');
    expect(tables).not.toContain('work_queue');
  });
});
