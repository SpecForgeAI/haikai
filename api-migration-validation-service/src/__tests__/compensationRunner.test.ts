/**
 * Compensation bracket runner — END-TO-END tests (Capture-State Discipline
 * Spec 1) against the shared in-memory fakes (`helpers/compensationFakes`):
 * fire mutates the store, the bracket restores byte-parity, verification
 * agrees.
 */

import { buildCompensationMetadataIndex } from '../services/compensation/compensationMetadata';
import { runCompensationBracket } from '../services/compensation/compensationRunner';
import { FakeStore, fakeReadAdapter, fakeWriteAdapter } from './helpers/compensationFakes';

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

function seededStore(): FakeStore {
  const store = new FakeStore();
  store.tables.set('orders', [
    { id: 1, name: 'alpha' },
    { id: 2, name: 'beta' },
  ]);
  store.tables.set('order_lines', [
    { order_id: 1, line_no: 1, sku: 'A' },
    { order_id: 1, line_no: 2, sku: 'B' },
  ]);
  return store;
}

function bracketArgs<T>(store: FakeStore, tables: string[], fire: () => Promise<T>) {
  return {
    readAdapter: fakeReadAdapter(store),
    writeAdapter: fakeWriteAdapter(store),
    engine: 'sybase' as const,
    tables,
    metadata: METADATA,
    fire,
  };
}

describe('runCompensationBracket', () => {
  it('reports clean when the fire step wrote nothing', async () => {
    const store = seededStore();
    const before = store.snapshotJson();
    const run = await runCompensationBracket(
      bracketArgs(store, ['orders'], async () => 'response'),
    );
    expect(run.outcome.kind).toBe('clean');
    expect(run.fired).toBe(true);
    expect(run.fireResult).toBe('response');
    expect(store.snapshotJson()).toBe(before);
  });

  it('compensates an INSERT (delete + identity reseed) back to byte-parity', async () => {
    const store = seededStore();
    const before = store.snapshotJson();
    const run = await runCompensationBracket(
      bracketArgs(store, ['orders'], async () => {
        store.tables.get('orders')!.push({ id: 3, name: 'created' });
        return { id: 3 };
      }),
    );
    expect(run.outcome.kind).toBe('compensated');
    expect(run.outcome.statementsApplied).toContain('DELETE FROM orders WHERE id = 3');
    expect(run.outcome.reseedStatements).toEqual([
      "EXEC sp_chgattribute 'orders', 'identity_burn_max', 0, '2'",
    ]);
    expect(store.reseeds).toHaveLength(1);
    expect(store.snapshotJson()).toBe(before);
  });

  it('compensates an UPDATE by restoring the before-image row', async () => {
    const store = seededStore();
    const before = store.snapshotJson();
    const run = await runCompensationBracket(
      bracketArgs(store, ['orders'], async () => {
        store.tables.get('orders')![1].name = 'renamed';
      }),
    );
    expect(run.outcome.kind).toBe('compensated');
    expect(store.snapshotJson()).toBe(before);
  });

  it('compensates a DELETE with an identity-wrapped re-insert', async () => {
    const store = seededStore();
    const before = store.snapshotJson();
    const run = await runCompensationBracket(
      bracketArgs(store, ['orders'], async () => {
        store.tables.set(
          'orders',
          store.tables.get('orders')!.filter((r) => r.id !== 1),
        );
      }),
    );
    expect(run.outcome.kind).toBe('compensated');
    expect(run.outcome.statementsApplied).toEqual([
      'SET IDENTITY_INSERT orders ON',
      "INSERT INTO orders (id, name) VALUES (1, 'alpha')",
      'SET IDENTITY_INSERT orders OFF',
    ]);
    expect(store.snapshotJson()).toBe(before);
  });

  it('compensates mixed multi-table writes in one bracket', async () => {
    const store = seededStore();
    const before = store.snapshotJson();
    const run = await runCompensationBracket(
      bracketArgs(store, ['orders', 'order_lines'], async () => {
        store.tables.get('orders')!.push({ id: 3, name: 'created' });
        store.tables.get('order_lines')![0].sku = 'MUTATED';
      }),
    );
    expect(run.outcome.kind).toBe('compensated');
    expect(run.outcome.diffs.map((d) => d.table).sort()).toEqual(['order_lines', 'orders']);
    expect(store.snapshotJson()).toBe(before);
  });

  it('REFUSES (never fires) when a table is missing from the committed model', async () => {
    const store = seededStore();
    const fire = jest.fn(async () => 'never');
    const run = await runCompensationBracket(bracketArgs(store, ['not_modelled'], fire));
    expect(run.outcome.kind).toBe('refused');
    expect(run.outcome.refusals[0]).toMatchObject({ table: 'not_modelled', reason: 'missing_pk' });
    expect(run.fired).toBe(false);
    expect(fire).not.toHaveBeenCalled();
  });

  it('REFUSES (never fires) when the effect table has no primary key', async () => {
    const store = seededStore();
    store.tables.set('audit_log', [{ message: 'x' }]);
    const fire = jest.fn(async () => 'never');
    const run = await runCompensationBracket(bracketArgs(store, ['audit_log'], fire));
    expect(run.outcome.kind).toBe('refused');
    expect(run.outcome.refusals[0].reason).toBe('missing_pk');
    expect(fire).not.toHaveBeenCalled();
  });

  it('still compensates when fire() THROWS after mutating, preserving the error', async () => {
    const store = seededStore();
    const before = store.snapshotJson();
    const run = await runCompensationBracket(
      bracketArgs(store, ['orders'], async () => {
        store.tables.get('orders')!.push({ id: 3, name: 'partial' });
        throw new Error('transport blew up mid-call');
      }),
    );
    expect(run.outcome.kind).toBe('compensated');
    expect(run.fireError).toBeInstanceOf(Error);
    expect((run.fireError as Error).message).toBe('transport blew up mid-call');
    expect(store.snapshotJson()).toBe(before);
  });

  it('declares RESIDUE with row detail when the undo provably did not restore', async () => {
    const store = seededStore();
    const writeAdapter = fakeWriteAdapter(store, { dropMatching: /^DELETE FROM orders/ });
    const run = await runCompensationBracket({
      ...bracketArgs(store, ['orders'], async () => {
        store.tables.get('orders')!.push({ id: 3, name: 'sticky' });
      }),
      writeAdapter,
    });
    expect(run.outcome.kind).toBe('residue');
    expect(run.outcome.residue.some((r) => r.kind === 'row_extra')).toBe(true);
  });
});

describe('COMPENSATION_FULL_IMAGE_MAX_ROWS cap', () => {
  afterEach(() => {
    delete process.env.COMPENSATION_FULL_IMAGE_MAX_ROWS;
    jest.resetModules();
  });

  it('an over-cap table with a sweepable PK is SCOPED, not refused (re-pinned 2026-08-27, Item #1)', async () => {
    // Pre-scoped-imaging this refused `table_too_large` and the scenario was
    // never fired — the exact behaviour that zeroed out capture coverage on
    // endpoints whose READ tables are huge. With a single numeric PK the
    // runner now plans the scoped tier (per-call images + max(PK) sweep) and
    // fires. The fail-closed refusal survives ONLY for over-cap tables with
    // no sweepable PK — pinned in scopedRowImaging.test.ts.
    jest.resetModules();
    process.env.COMPENSATION_FULL_IMAGE_MAX_ROWS = '1';
    /* eslint-disable @typescript-eslint/no-var-requires */
    const freshRunner = require('../services/compensation/compensationRunner');
    const freshMetadata = require('../services/compensation/compensationMetadata');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const store = seededStore(); // orders has 2 rows > cap 1, single int PK
    const fire = jest.fn(async () => 'fired');
    const run = await freshRunner.runCompensationBracket({
      readAdapter: fakeReadAdapter(store),
      writeAdapter: fakeWriteAdapter(store),
      engine: 'sybase',
      tables: ['orders'],
      metadata: freshMetadata.buildCompensationMetadataIndex(MODEL),
      fire,
    });
    expect(run.outcome.kind).toBe('clean');
    expect(run.outcome.refusals).toEqual([]);
    expect(fire).toHaveBeenCalledTimes(1);
  });
});
