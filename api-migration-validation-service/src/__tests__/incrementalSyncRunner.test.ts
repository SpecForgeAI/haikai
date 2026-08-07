/**
 * Incremental sync runner (gold-standard C4, 2026-08-07).
 *
 * The side-by-side daily sync used to be a bash comment-stub in the pack that
 * executed NOTHING. These tests pin the real capability: keyed keyset deltas
 * above the stored high-water UPSERT into the target, full_reload tables
 * truncate+reload, `haikai_sync_state` advances per clean table, deletes are
 * a bounded pk-diff opt-in, and open decisions / failures are HONEST rows.
 */
import { DbAdapter, DbAllowlist, DbQueryLimits, DbReadResult, DbTableMetadata } from '../services/db/DbAdapter';
import {
  SyncTargetLoader,
  TableLoadError,
} from '../services/dataMigration/targetLoader';
import { TableLoadSpec } from '../services/dataMigration/types';
import {
  SyncTableSpec,
  runIncrementalSync,
} from '../services/dataMigration/incrementalSyncRunner';

function tupleAfter(candidate: unknown[], after: unknown[]): boolean {
  for (let i = 0; i < after.length; i++) {
    const c = candidate[i] ?? null;
    const a = after[i] ?? null;
    if (c === a) continue;
    if (a === null) return c !== null;
    if (c === null) return false;
    return (c as never) > (a as never);
  }
  return false;
}

class FakeSource implements DbAdapter {
  constructor(
    private rows: Record<string, Array<Record<string, unknown>>>,
    private columns: Record<string, Array<{ column: string; dataType: string }>>,
  ) {}
  private k(schema: string | null | undefined, table: string): string {
    return `${schema ?? ''}.${table}`;
  }
  async testConnection(): Promise<{ success: true }> {
    return { success: true };
  }
  async listMetadata(allowlist: DbAllowlist): Promise<DbTableMetadata[]> {
    const table = allowlist.tables?.[0] ?? '';
    const schema = allowlist.schemas?.[0] ?? null;
    const cols = this.columns[this.k(schema, table)] ?? [];
    return [
      {
        schema: schema ?? '',
        table,
        columns: cols.map((c) => ({
          schema: schema ?? '',
          table,
          column: c.column,
          dataType: c.dataType,
          isNullable: true,
        })),
      },
    ];
  }
  async runReadonlySelect(): Promise<DbReadResult> {
    throw new Error('not used');
  }
  async sampleValues(): Promise<DbReadResult> {
    throw new Error('not used');
  }
  async countRows(args: { schema?: string | null; table: string }): Promise<number> {
    return (this.rows[this.k(args.schema, args.table)] ?? []).length;
  }
  async fetchOrderedRows(args: {
    schema?: string | null;
    table: string;
    orderBy: string[];
    limits: DbQueryLimits;
    after?: unknown[] | null;
  }): Promise<DbReadResult> {
    let rows = [...(this.rows[this.k(args.schema, args.table)] ?? [])].sort((a, b) => {
      for (const c of args.orderBy) {
        const av = a[c] as never;
        const bv = b[c] as never;
        if (av < bv) return -1;
        if (av > bv) return 1;
      }
      return 0;
    });
    if (args.after && args.after.length > 0) {
      rows = rows.filter((r) => tupleAfter(args.orderBy.map((c) => r[c] ?? null), args.after!));
    }
    const page = rows.slice(0, Math.max(1, args.limits.maxRows));
    return { rows: page, rowCount: page.length, truncated: page.length < rows.length };
  }
  async dispose(): Promise<void> {}
}

class FakeSyncLoader implements SyncTargetLoader {
  ensured = false;
  highWater = new Map<string, { hw: string; status: string }>();
  upserts: Array<{ table: string; rows: unknown[][]; conflict: string[]; mode: string }> = [];
  loads: Array<{ table: string; rows: unknown[][] }> = [];
  prepared: string[] = [];
  targetKeys: Record<string, unknown[][]> = {};
  deleted: Array<{ table: string; tuples: unknown[][] }> = [];
  failUpsertWith: TableLoadError | null = null;

  private ref(spec: TableLoadSpec): string {
    return `${spec.schema ?? ''}.${spec.table}`;
  }
  async ensureSyncState(): Promise<void> {
    this.ensured = true;
  }
  async getHighWater(tableRef: string): Promise<string | null> {
    return this.highWater.get(tableRef)?.hw ?? null;
  }
  async setHighWater(tableRef: string, hw: string, status: string): Promise<void> {
    this.highWater.set(tableRef, { hw, status });
  }
  async prepareTable(spec: TableLoadSpec): Promise<void> {
    this.prepared.push(this.ref(spec));
  }
  async loadTable(spec: TableLoadSpec, rows: unknown[][]): Promise<number> {
    this.loads.push({ table: this.ref(spec), rows });
    return rows.length;
  }
  async upsertTable(
    spec: TableLoadSpec,
    rows: unknown[][],
    conflictColumns: string[],
    onConflict: 'update' | 'nothing',
  ): Promise<number> {
    if (this.failUpsertWith) throw this.failUpsertWith;
    this.upserts.push({ table: this.ref(spec), rows, conflict: conflictColumns, mode: onConflict });
    return rows.length;
  }
  async readKeyTuples(spec: TableLoadSpec, keyColumns: string[]): Promise<unknown[][]> {
    void keyColumns;
    return this.targetKeys[this.ref(spec)] ?? [];
  }
  async deleteByKeyTuples(
    spec: TableLoadSpec,
    _keyColumns: string[],
    tuples: unknown[][],
  ): Promise<number> {
    this.deleted.push({ table: this.ref(spec), tuples });
    return tuples.length;
  }
  async dispose(): Promise<void> {}
}

function spec(partial: Partial<SyncTableSpec> & { tableRef: string; table: string }): SyncTableSpec {
  return {
    tableRef: partial.tableRef,
    strategy: partial.strategy ?? 'insert_update',
    deltaKey: partial.deltaKey ?? 'id',
    deleteMode: partial.deleteMode ?? 'none',
    load: {
      schema: 'dbo',
      table: partial.table,
      orderBy: ['id'],
      orderKeyIsPrimaryKey: true,
      loadColumns: ['id', 'v'],
      identityColumns: [],
      expectedSourceRowCount: null,
      ...(partial.load ?? {}),
    },
  };
}

const KNOBS = { pageRows: 2, timeoutSeconds: 5, pkDiffMaxRows: 1000 };
const COLS = { '.t': [] as Array<{ column: string; dataType: string }> };
void COLS;

function sourceFor(rows: Array<Record<string, unknown>>): FakeSource {
  return new FakeSource(
    { 'dbo.t': rows },
    { 'dbo.t': [{ column: 'id', dataType: 'int' }, { column: 'v', dataType: 'varchar' }] },
  );
}

describe('runIncrementalSync', () => {
  it('applies ONLY rows above the stored high-water, pages the delta, upserts, and advances the high-water', async () => {
    const source = sourceFor([
      { id: 1, v: 'old' },
      { id: 2, v: 'old' },
      { id: 3, v: 'new' },
      { id: 4, v: 'new' },
      { id: 5, v: 'new' },
    ]);
    const loader = new FakeSyncLoader();
    loader.highWater.set('dbo.t', { hw: '2', status: 'ok' });

    const report = await runIncrementalSync({
      source,
      loader,
      tables: [spec({ tableRef: 'dbo.t', table: 't', strategy: 'insert_update' })],
      ruleset: null,
      knobs: KNOBS,
    });

    expect(loader.ensured).toBe(true);
    const applied = loader.upserts.flatMap((u) => u.rows);
    expect(applied.map((r) => r[0])).toEqual([3, 4, 5]); // strictly after hw=2
    expect(loader.upserts[0].mode).toBe('update');
    expect(loader.upserts[0].conflict).toEqual(['id']); // pk conflict target
    expect(report.tables[0].status).toBe('synced');
    expect(report.tables[0].rows_applied).toBe(3);
    expect(report.tables[0].previous_high_water).toBe('2');
    expect(report.tables[0].new_high_water).toBe('5');
    expect(loader.highWater.get('dbo.t')).toEqual({ hw: '5', status: 'ok' });
    expect(report.summary.status).toBe('clean');
  });

  it('insert_only uses ON CONFLICT DO NOTHING and a first run (no high-water) reads everything', async () => {
    const source = sourceFor([{ id: 1, v: 'a' }, { id: 2, v: 'b' }]);
    const loader = new FakeSyncLoader();
    const report = await runIncrementalSync({
      source,
      loader,
      tables: [spec({ tableRef: 'dbo.t', table: 't', strategy: 'insert_only' })],
      ruleset: null,
      knobs: KNOBS,
    });
    expect(loader.upserts[0].mode).toBe('nothing');
    expect(report.tables[0].rows_applied).toBe(2);
    expect(report.tables[0].new_high_water).toBe('2');
  });

  it('full_reload truncates once and reloads every row (the delete-catching mechanism)', async () => {
    const source = sourceFor([{ id: 1, v: 'a' }, { id: 2, v: 'b' }, { id: 3, v: 'c' }]);
    const loader = new FakeSyncLoader();
    const report = await runIncrementalSync({
      source,
      loader,
      tables: [spec({ tableRef: 'dbo.t', table: 't', strategy: 'full_reload', deltaKey: null })],
      ruleset: null,
      knobs: KNOBS,
    });
    expect(loader.prepared).toEqual(['dbo.t']);
    expect(loader.loads.flatMap((l) => l.rows)).toHaveLength(3);
    expect(report.tables[0].status).toBe('reloaded');
  });

  it('needs_decision is an HONEST row naming the pack decision — the table is never silently absent', async () => {
    const source = sourceFor([{ id: 1, v: 'a' }]);
    const loader = new FakeSyncLoader();
    const report = await runIncrementalSync({
      source,
      loader,
      tables: [spec({ tableRef: 'dbo.t', table: 't', strategy: 'needs_decision', deltaKey: null })],
      ruleset: null,
      knobs: KNOBS,
    });
    expect(report.tables[0].status).toBe('needs_decision');
    expect(report.tables[0].reason).toContain('delta_key--dbo.t');
    expect(report.summary.status).toBe('attention');
    expect(loader.upserts).toHaveLength(0);
  });

  it('pk_diff delete propagation removes TARGET-only keys, bounded by pkDiffMaxRows', async () => {
    const source = sourceFor([{ id: 1, v: 'a' }, { id: 2, v: 'b' }]);
    const loader = new FakeSyncLoader();
    loader.targetKeys['dbo.t'] = [[1], [2], [9]]; // 9 was deleted at source
    const report = await runIncrementalSync({
      source,
      loader,
      tables: [
        spec({ tableRef: 'dbo.t', table: 't', strategy: 'insert_update', deleteMode: 'pk_diff' }),
      ],
      ruleset: null,
      knobs: KNOBS,
    });
    expect(loader.deleted[0].tuples).toEqual([[9]]);
    expect(report.tables[0].rows_deleted).toBe(1);
    expect(report.tables[0].delete_check).toBe('deleted');
  });

  it('pk_diff above the bound is an honest unverifiable, never a silent skip', async () => {
    const source = sourceFor([{ id: 1, v: 'a' }, { id: 2, v: 'b' }, { id: 3, v: 'c' }]);
    const loader = new FakeSyncLoader();
    const report = await runIncrementalSync({
      source,
      loader,
      tables: [
        spec({ tableRef: 'dbo.t', table: 't', strategy: 'insert_update', deleteMode: 'pk_diff' }),
      ],
      ruleset: null,
      knobs: { ...KNOBS, pkDiffMaxRows: 2 },
    });
    expect(report.tables[0].delete_check).toBe('unverifiable');
    expect(report.tables[0].reason).toContain('pk_diff');
    expect(loader.deleted).toHaveLength(0);
  });

  it('a mid-sync failure is an error row carrying the PARTIAL applied count; the run continues', async () => {
    const source = sourceFor([{ id: 1, v: 'a' }, { id: 2, v: 'b' }]);
    const loader = new FakeSyncLoader();
    loader.failUpsertWith = new TableLoadError('disk full', 1);
    const report = await runIncrementalSync({
      source,
      loader,
      tables: [
        spec({ tableRef: 'dbo.t', table: 't', strategy: 'insert_update' }),
        spec({ tableRef: 'dbo.t', table: 't', strategy: 'needs_decision', deltaKey: null }),
      ],
      ruleset: null,
      knobs: KNOBS,
    });
    expect(report.tables[0].status).toBe('error');
    expect(report.tables[0].rows_applied).toBe(1); // the partial truth
    expect(report.tables[0].reason).toContain('disk full');
    expect(loader.highWater.get('dbo.t')).toEqual({ hw: 'error', status: 'error' });
    expect(report.tables[1].status).toBe('needs_decision'); // run continued
  });
});
