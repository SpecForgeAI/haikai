import { DbAdapter, DbAllowlist, DbQueryLimits, DbReadResult, DbTableMetadata } from '../services/db/DbAdapter';
import { TargetLoader } from '../services/dataMigration/targetLoader';
import { LoadPlan, TableLoadSpec } from '../services/dataMigration/types';
import { runDataMigration } from '../services/dataMigration/dataMigrationRunner';
import { emitDataMigrationPredicates } from '../services/dataMigration/dataMigrationPredicates';
import { loadPairRuleset } from '../migrationPairRules';
import { Tracer } from '../trace';

interface TableFixture {
  count: number;
  columns: { column: string; dataType: string }[];
  rows: Record<string, unknown>[];
}

/** NULLS-LOW tuple comparison mirroring the adapters' keyset contract. */
function tupleAfter(candidate: unknown[], after: unknown[]): boolean {
  for (let i = 0; i < after.length; i++) {
    const c = candidate[i] ?? null;
    const a = after[i] ?? null;
    if (c === a) continue;
    if (a === null) return c !== null; // anything non-null is after NULL
    if (c === null) return false;
    return (c as never) > (a as never);
  }
  return false; // equal tuple is NOT after
}

class FakeAdapter implements DbAdapter {
  throwOnFetch = false;
  /** Simulates a broken keyset implementation: `after` is ignored. */
  ignoreAfter = false;
  fetchCalls = 0;
  constructor(
    private counts: Record<string, number> = {},
    private fixtures: Record<string, TableFixture> = {},
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
    const fx = this.fixtures[this.k(schema, table)];
    if (!fx) return [];
    return [
      {
        schema: schema ?? '',
        table,
        columns: fx.columns.map((c) => ({
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
    throw new Error('not used in these tests');
  }

  async sampleValues(): Promise<DbReadResult> {
    throw new Error('not used in these tests');
  }

  async countRows(args: { schema?: string | null; table: string; limits: DbQueryLimits }): Promise<number> {
    return this.counts[this.k(args.schema, args.table)] ?? this.fixtures[this.k(args.schema, args.table)]?.count ?? 0;
  }

  async fetchOrderedRows(args: {
    schema?: string | null;
    table: string;
    orderBy: string[];
    limits: DbQueryLimits;
    after?: unknown[] | null;
  }): Promise<DbReadResult> {
    if (this.throwOnFetch) throw new Error('sidecar down');
    this.fetchCalls += 1;
    const fx = this.fixtures[this.k(args.schema, args.table)];
    let rows = fx?.rows ?? [];
    if (!this.ignoreAfter && args.after && args.after.length > 0) {
      rows = rows.filter((r) =>
        tupleAfter(args.orderBy.map((c) => r[c] ?? null), args.after as unknown[]),
      );
    }
    const page = rows.slice(0, Math.max(1, args.limits.maxRows));
    return { rows: page, rowCount: page.length, truncated: page.length < rows.length };
  }

  async dispose(): Promise<void> {
    /* no-op */
  }
}

class FakeLoader implements TargetLoader {
  /** Pages APPEND (the paginated-load contract) — prepare truncates once. */
  loaded: Record<string, unknown[][]> = {};
  prepared: string[] = [];
  loadCalls = 0;
  async prepareTable(spec: TableLoadSpec): Promise<void> {
    const key = `${spec.schema ?? ''}.${spec.table}`;
    this.prepared.push(key);
    this.loaded[key] = [];
  }
  async loadTable(spec: TableLoadSpec, rows: unknown[][]): Promise<number> {
    const key = `${spec.schema ?? ''}.${spec.table}`;
    if (!this.prepared.includes(key)) {
      throw new Error(`loadTable called before prepareTable for ${key}`);
    }
    this.loadCalls += 1;
    this.loaded[key].push(...rows);
    return rows.length;
  }
  async dispose(): Promise<void> {
    /* no-op */
  }
}

function recordingTracer(): { tracer: Tracer; calls: { kind: string; args: unknown[] }[] } {
  const calls: { kind: string; args: unknown[] }[] = [];
  const rec = (kind: string) => (...args: unknown[]) => {
    calls.push({ kind, args });
  };
  const tracer = {
    enabled: true,
    summary: rec('summary'),
    step: rec('step'),
    ok: rec('ok'),
    warn: rec('warn'),
    fail: rec('fail'),
    detail: rec('detail'),
    runHeader: rec('runHeader'),
    predicate: rec('predicate'),
    predicateSkip: rec('predicateSkip'),
    stageStart: rec('stageStart'),
    stageEnd: rec('stageEnd'),
    configHeader: rec('configHeader'),
  } as unknown as Tracer;
  return { tracer, calls };
}

const ruleset = loadPairRuleset();
/** Uncapped (the default posture): read_cap is an explicit valve only. */
const knobs = { readCap: 0, pageRows: 1000, timeoutSeconds: 30 };
function planFor(tables: TableLoadSpec[]): LoadPlan {
  return { tables, issues: [] };
}
function spec(partial: Partial<TableLoadSpec> & { table: string }): TableLoadSpec {
  return {
    schema: 'dbo',
    orderBy: ['id'],
    orderKeyIsPrimaryKey: true,
    loadColumns: ['id'],
    identityColumns: [],
    expectedSourceRowCount: null,
    ...partial,
  };
}

describe('runDataMigration (Spec Y)', () => {
  it('loads, forward-transforms (bit->bool), and reconciles a clean table', async () => {
    const source = new FakeAdapter({}, {
      'dbo.flags': {
        count: 2,
        columns: [
          { column: 'id', dataType: 'int' },
          { column: 'active', dataType: 'bit' },
        ],
        rows: [
          { id: 1, active: 1 },
          { id: 2, active: 0 },
        ],
      },
    });
    const target = new FakeAdapter({ 'dbo.flags': 2 });
    const loader = new FakeLoader();

    const report = await runDataMigration({
      source,
      target,
      targetLoader: loader,
      plan: planFor([spec({ table: 'flags', loadColumns: ['id', 'active'], expectedSourceRowCount: 2 })]),
      ruleset,
      knobs,
    });

    expect(report.summary.status).toBe('clean');
    expect(report.tables[0].status).toBe('loaded');
    expect(loader.loaded['dbo.flags']).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(report.tables[0].rulesCited).toContain('SYBPG.BIT.001');
  });

  it('PAGINATES a table larger than one page and loads EVERY row (the old caps loaded 0 or 10k)', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: i + 1 }));
    const source = new FakeAdapter({}, {
      'dbo.big': { count: 7, columns: [{ column: 'id', dataType: 'int' }], rows },
    });
    const target = new FakeAdapter({ 'dbo.big': 7 });
    const loader = new FakeLoader();

    const report = await runDataMigration({
      source,
      target,
      targetLoader: loader,
      plan: planFor([spec({ table: 'big', expectedSourceRowCount: 7 })]),
      ruleset,
      knobs: { readCap: 0, pageRows: 3, timeoutSeconds: 30 },
    });

    expect(report.tables[0].status).toBe('loaded');
    expect(report.tables[0].loadedCount).toBe(7);
    expect(loader.loaded['dbo.big']).toEqual(rows.map((r) => [r.id]));
    // 3 + 3 + 1 rows over three pages; truncate exactly once.
    expect(loader.loadCalls).toBe(3);
    expect(loader.prepared).toEqual(['dbo.big']);
    expect(report.summary.rows_loaded).toBe(7);
    expect(report.summary.status).toBe('clean');
  });

  it('paginates NULLS-LOW across a page boundary landing on a NULL key value', async () => {
    const rows = [
      { id: null, v: 'a' },
      { id: null, v: 'b' },
      { id: 1, v: 'c' },
      { id: 2, v: 'd' },
    ];
    const source = new FakeAdapter({}, {
      'dbo.n': { count: 4, columns: [{ column: 'id', dataType: 'int' }, { column: 'v', dataType: 'varchar' }], rows },
    });
    const target = new FakeAdapter({ 'dbo.n': 4 });
    const loader = new FakeLoader();
    const report = await runDataMigration({
      source,
      target,
      targetLoader: loader,
      plan: planFor([
        spec({ table: 'n', orderBy: ['id', 'v'], orderKeyIsPrimaryKey: false, loadColumns: ['id', 'v'] }),
      ]),
      ruleset,
      knobs: { readCap: 0, pageRows: 2, timeoutSeconds: 30 },
    });
    expect(report.tables[0].status).toBe('loaded');
    expect(report.tables[0].loadedCount).toBe(4);
  });

  it('a STUCK cursor (adapter ignoring `after`) is a loud unverifiable, never a silent partial load', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ id: i + 1 }));
    const source = new FakeAdapter({}, {
      'dbo.stuck': { count: 4, columns: [{ column: 'id', dataType: 'int' }], rows },
    });
    source.ignoreAfter = true; // every page returns the FIRST page again
    const report = await runDataMigration({
      source,
      target: new FakeAdapter(),
      targetLoader: new FakeLoader(),
      plan: planFor([spec({ table: 'stuck', expectedSourceRowCount: 4 })]),
      ruleset,
      knobs: { readCap: 0, pageRows: 2, timeoutSeconds: 30 },
    });
    expect(report.tables[0].status).toBe('unverifiable');
    expect(report.tables[0].reason).toContain('did not advance');
    expect(report.summary.status).toBe('unverifiable');
  });

  it('flags a reconcile mismatch when the post-load target count differs', async () => {
    const source = new FakeAdapter({}, {
      'dbo.t': { count: 3, columns: [{ column: 'id', dataType: 'int' }], rows: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    });
    const target = new FakeAdapter({ 'dbo.t': 2 }); // one row short on target
    const report = await runDataMigration({
      source,
      target,
      targetLoader: new FakeLoader(),
      plan: planFor([spec({ table: 't', expectedSourceRowCount: 3 })]),
      ruleset,
      knobs,
    });
    expect(report.tables[0].status).toBe('reconciled_mismatch');
    expect(report.summary.status).toBe('divergent');
  });

  it('a mismatch on a NON-primary-key order key names the duplicate-boundary cause', async () => {
    const source = new FakeAdapter({}, {
      'dbo.nopk': { count: 3, columns: [{ column: 'id', dataType: 'int' }], rows: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    });
    const target = new FakeAdapter({ 'dbo.nopk': 2 });
    const report = await runDataMigration({
      source,
      target,
      targetLoader: new FakeLoader(),
      plan: planFor([spec({ table: 'nopk', orderKeyIsPrimaryKey: false })]),
      ruleset,
      knobs,
    });
    expect(report.tables[0].status).toBe('reconciled_mismatch');
    expect(report.tables[0].reason).toContain('NOT a primary key');
  });

  it('an OPERATOR-SET read cap marks an oversize table unverifiable, visibly naming the cap', async () => {
    const source = new FakeAdapter({}, {
      'dbo.big': { count: 10, columns: [{ column: 'id', dataType: 'int' }], rows: [] },
    });
    const loader = new FakeLoader();
    const report = await runDataMigration({
      source,
      target: new FakeAdapter(),
      targetLoader: loader,
      plan: planFor([spec({ table: 'big', expectedSourceRowCount: 10 })]),
      ruleset,
      knobs: { readCap: 5, pageRows: 1000, timeoutSeconds: 30 },
    });
    expect(report.tables[0].status).toBe('unverifiable');
    expect(report.tables[0].reason).toContain('OPERATOR-SET read cap 5');
    expect(loader.loaded['dbo.big']).toBeUndefined();
    expect(report.summary.status).toBe('unverifiable');
  });

  it('readCap 0 = UNCAPPED: a table above any historic default loads fully', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: i + 1 }));
    const source = new FakeAdapter({}, {
      'dbo.huge': { count: 12, columns: [{ column: 'id', dataType: 'int' }], rows },
    });
    const target = new FakeAdapter({ 'dbo.huge': 12 });
    const loader = new FakeLoader();
    const report = await runDataMigration({
      source,
      target,
      targetLoader: loader,
      plan: planFor([spec({ table: 'huge' })]),
      ruleset,
      knobs: { readCap: 0, pageRows: 5, timeoutSeconds: 30 },
    });
    expect(report.tables[0].status).toBe('loaded');
    expect(report.tables[0].loadedCount).toBe(12);
  });

  it('treats an empty source table as loaded/empty', async () => {
    const source = new FakeAdapter({}, {
      'dbo.empty': { count: 0, columns: [{ column: 'id', dataType: 'int' }], rows: [] },
    });
    const report = await runDataMigration({
      source,
      target: new FakeAdapter({ 'dbo.empty': 0 }),
      targetLoader: new FakeLoader(),
      plan: planFor([spec({ table: 'empty', expectedSourceRowCount: 0 })]),
      ruleset,
      knobs,
    });
    expect(report.tables[0].status).toBe('empty');
    expect(report.summary.status).toBe('clean');
  });

  it('never throws — a source read error becomes unverifiable', async () => {
    const source = new FakeAdapter({}, {
      'dbo.boom': { count: 1, columns: [{ column: 'id', dataType: 'int' }], rows: [{ id: 1 }] },
    });
    source.throwOnFetch = true;
    const report = await runDataMigration({
      source,
      target: new FakeAdapter(),
      targetLoader: new FakeLoader(),
      plan: planFor([spec({ table: 'boom', expectedSourceRowCount: 1 })]),
      ruleset,
      knobs,
    });
    expect(report.tables[0].status).toBe('unverifiable');
    expect(report.tables[0].reason).toContain('sidecar down');
  });

  it('emits EXEC.DATA predicates + an EXEC scorecard', async () => {
    const source = new FakeAdapter({}, {
      'dbo.flags': { count: 1, columns: [{ column: 'id', dataType: 'int' }], rows: [{ id: 1 }] },
    });
    const report = await runDataMigration({
      source,
      target: new FakeAdapter({ 'dbo.flags': 1 }),
      targetLoader: new FakeLoader(),
      plan: planFor([spec({ table: 'flags', expectedSourceRowCount: 1 })]),
      ruleset,
      knobs,
    });

    const { tracer, calls } = recordingTracer();
    emitDataMigrationPredicates(report, tracer);

    expect(calls.find((c) => c.kind === 'stageStart' && c.args[0] === 'EXEC')).toBeTruthy();
    expect(calls.find((c) => c.kind === 'stageEnd' && c.args[0] === 'EXEC')).toBeTruthy();
    const pred = calls.find((c) => c.kind === 'predicate' && c.args[0] === 'EXEC.DATA.01');
    expect(pred).toBeTruthy();
    expect(pred!.args[2]).toBe(true); // ok = true for a reconciled load
  });
});
