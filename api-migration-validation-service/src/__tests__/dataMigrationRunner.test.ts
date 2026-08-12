import { DbAdapter, DbAllowlist, DbQueryLimits, DbReadResult, DbTableMetadata } from '../services/db/DbAdapter';
import { TableLoadError, TargetLoader } from '../services/dataMigration/targetLoader';
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
  /** Every maxRows the runner asked for (asserts the page-size clamp). */
  maxRowsSeen: number[] = [];
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
    this.maxRowsSeen.push(args.limits.maxRows);
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

  it('a MID-TABLE load failure reports the rows actually written, never loadedCount 0 (2026-08-07)', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
    const source = new FakeAdapter({}, {
      'dbo.mid': { count: 5, columns: [{ column: 'id', dataType: 'int' }], rows },
    });
    class MidFailLoader extends FakeLoader {
      async loadTable(s: TableLoadSpec, r: unknown[][]): Promise<number> {
        if (this.loadCalls === 1) {
          // Second page: 1 row of the page lands, then the insert dies.
          this.loadCalls += 1;
          throw new TableLoadError('insert into "dbo"."mid" failed: disk full', 1);
        }
        return super.loadTable(s, r);
      }
    }
    const report = await runDataMigration({
      source,
      target: new FakeAdapter(),
      targetLoader: new MidFailLoader(),
      plan: planFor([spec({ table: 'mid', expectedSourceRowCount: 5 })]),
      ruleset,
      knobs: { readCap: 0, pageRows: 2, timeoutSeconds: 30 },
    });
    expect(report.tables[0].status).toBe('unverifiable');
    // Page 1 (2 rows) + the failing page's 1 written row = 3, not 0.
    expect(report.tables[0].loadedCount).toBe(3);
    expect(report.tables[0].reason).toContain('after 3 row(s)');
    expect(report.tables[0].reason).toContain('PARTIAL');
  });

  it('clamps operator pageRows to the adapter single-fetch cap (a clipped page must not read as final)', async () => {
    const source = new FakeAdapter({}, {
      'dbo.small': { count: 2, columns: [{ column: 'id', dataType: 'int' }], rows: [{ id: 1 }, { id: 2 }] },
    });
    const report = await runDataMigration({
      source,
      target: new FakeAdapter({ 'dbo.small': 2 }),
      targetLoader: new FakeLoader(),
      plan: planFor([spec({ table: 'small', expectedSourceRowCount: 2 })]),
      ruleset,
      knobs: { readCap: 0, pageRows: 50_000, timeoutSeconds: 30 },
    });
    expect(report.tables[0].status).toBe('loaded');
    expect(source.maxRowsSeen.every((n) => n <= 10_000)).toBe(true);
  });

  it('keeps paging when an adapter CLIPS a page (truncated=true short page is not "final")', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
    class ClippingAdapter extends FakeAdapter {
      async fetchOrderedRows(args: {
        schema?: string | null;
        table: string;
        orderBy: string[];
        limits: DbQueryLimits;
        after?: unknown[] | null;
      }): Promise<DbReadResult> {
        // The adapter guard clips every page at 2 rows regardless of maxRows.
        const clipped = await super.fetchOrderedRows({
          ...args,
          limits: { ...args.limits, maxRows: Math.min(2, args.limits.maxRows) },
        });
        return args.limits.maxRows > 2 ? clipped : { ...clipped, truncated: false };
      }
    }
    const source = new ClippingAdapter({}, {
      'dbo.clip': { count: 5, columns: [{ column: 'id', dataType: 'int' }], rows },
    });
    const loader = new FakeLoader();
    const report = await runDataMigration({
      source,
      target: new FakeAdapter({ 'dbo.clip': 5 }),
      targetLoader: loader,
      plan: planFor([spec({ table: 'clip', expectedSourceRowCount: 5 })]),
      ruleset,
      knobs: { readCap: 0, pageRows: 1000, timeoutSeconds: 30 },
    });
    // The old break condition (rows < pageRows = final) would have stopped
    // after 2 rows; honoring `truncated` pages through all 5.
    expect(report.tables[0].status).toBe('loaded');
    expect(report.tables[0].loadedCount).toBe(5);
    expect(loader.loaded['dbo.clip']).toEqual(rows.map((r) => [r.id]));
  });

  it('KEY-INTEGRITY PREFLIGHT: a declared PK with duplicate tuples is unverifiable naming the surrogate remedy — NOTHING is written (2026-08-12)', async () => {
    class ProbingAdapter extends FakeAdapter {
      probes: Array<{ table: string; keyColumns: string[] }> = [];
      constructor(
        private readonly result: { nullKeys: boolean; duplicateKeys: boolean },
        counts: Record<string, number>,
        fixtures: Record<string, TableFixture>,
      ) {
        super(counts, fixtures);
      }
      async probeKeyIntegrity(args: {
        schema?: string | null;
        table: string;
        keyColumns: string[];
        limits: DbQueryLimits;
      }): Promise<{ nullKeys: boolean; duplicateKeys: boolean }> {
        this.probes.push({ table: args.table, keyColumns: args.keyColumns });
        return this.result;
      }
    }
    const fixtures = {
      'dbo.hir_organisation': {
        count: 4,
        columns: [{ column: 'HierarchyId', dataType: 'int' }],
        rows: [{ HierarchyId: 1 }, { HierarchyId: 1 }, { HierarchyId: 2 }, { HierarchyId: 3 }],
      },
    };
    const source = new ProbingAdapter({ nullKeys: false, duplicateKeys: true }, {}, fixtures);
    const loader = new FakeLoader();
    const report = await runDataMigration({
      source,
      target: new FakeAdapter({ 'dbo.hir_organisation': 0 }),
      targetLoader: loader,
      plan: planFor([spec({ table: 'hir_organisation', orderBy: ['HierarchyId'], loadColumns: ['HierarchyId'] })]),
      ruleset,
      knobs,
    });
    expect(source.probes).toEqual([{ table: 'hir_organisation', keyColumns: ['HierarchyId'] }]);
    expect(report.tables[0].status).toBe('unverifiable');
    expect(report.tables[0].reason).toContain('is NOT UNIQUE');
    expect(report.tables[0].reason).toContain('demote_tables');
    expect(report.tables[0].reason).toContain('"dbo.hir_organisation"');
    // Nothing was truncated or written — the doomed load never started.
    expect(loader.prepared).toEqual([]);
    expect(loader.loadCalls).toBe(0);

    // NULL key members hit the same preflight with their own wording.
    const nullSource = new ProbingAdapter({ nullKeys: true, duplicateKeys: false }, {}, fixtures);
    const nullReport = await runDataMigration({
      source: nullSource,
      target: new FakeAdapter({ 'dbo.hir_organisation': 0 }),
      targetLoader: new FakeLoader(),
      plan: planFor([spec({ table: 'hir_organisation', orderBy: ['HierarchyId'], loadColumns: ['HierarchyId'] })]),
      ruleset,
      knobs,
    });
    expect(nullReport.tables[0].reason).toContain('contains NULL key values');
  });

  it('BOUNDARY-TRIMMED pagination loads duplicate key tuples EXACTLY ONCE on a non-unique order key (2026-08-12)', async () => {
    // Duplicate run of k=2 spans the first page boundary — the strict `>`
    // cursor used to SKIP the tail of the run silently.
    const rows = [
      { k: 1, v: 'a' },
      { k: 2, v: 'b1' },
      { k: 2, v: 'b2' },
      { k: 3, v: 'c' },
      { k: 4, v: 'd' },
    ];
    const source = new FakeAdapter({}, {
      'dbo.dups': {
        count: 5,
        columns: [{ column: 'k', dataType: 'int' }, { column: 'v', dataType: 'varchar(10)' }],
        rows,
      },
    });
    const loader = new FakeLoader();
    const report = await runDataMigration({
      source,
      target: new FakeAdapter({ 'dbo.dups': 5 }),
      targetLoader: loader,
      plan: planFor([
        spec({ table: 'dups', orderBy: ['k'], orderKeyIsPrimaryKey: false, loadColumns: ['k', 'v'] }),
      ]),
      ruleset,
      knobs: { readCap: 0, pageRows: 3, timeoutSeconds: 30 },
    });
    expect(report.tables[0].status).toBe('loaded');
    expect(report.tables[0].loadedCount).toBe(5);
    // Every row exactly once — no boundary skip, no boundary re-read.
    expect(loader.loaded['dbo.dups']).toEqual(rows.map((r) => [r.k, r.v]));
  });

  it('a full page sharing ONE key tuple on a non-unique key fails LOUD, never a silent partial (2026-08-12)', async () => {
    const rows = [
      { k: 2, v: 'a' },
      { k: 2, v: 'b' },
      { k: 2, v: 'c' },
      { k: 3, v: 'd' },
    ];
    const source = new FakeAdapter({}, {
      'dbo.run': {
        count: 4,
        columns: [{ column: 'k', dataType: 'int' }, { column: 'v', dataType: 'varchar(10)' }],
        rows,
      },
    });
    const report = await runDataMigration({
      source,
      target: new FakeAdapter({ 'dbo.run': 0 }),
      targetLoader: new FakeLoader(),
      plan: planFor([
        spec({ table: 'run', orderBy: ['k'], orderKeyIsPrimaryKey: false, loadColumns: ['k', 'v'] }),
      ]),
      ruleset,
      knobs: { readCap: 0, pageRows: 2, timeoutSeconds: 30 },
    });
    expect(report.tables[0].status).toBe('unverifiable');
    expect(report.tables[0].reason).toContain('shares ONE order-key tuple');
    expect(report.tables[0].reason).toContain('raise page_rows');
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
