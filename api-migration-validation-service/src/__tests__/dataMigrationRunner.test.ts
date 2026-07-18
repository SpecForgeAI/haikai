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

class FakeAdapter implements DbAdapter {
  throwOnFetch = false;
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
  }): Promise<DbReadResult> {
    if (this.throwOnFetch) throw new Error('sidecar down');
    const fx = this.fixtures[this.k(args.schema, args.table)];
    return { rows: fx?.rows ?? [], rowCount: fx?.rows.length ?? 0, truncated: false };
  }

  async dispose(): Promise<void> {
    /* no-op */
  }
}

class FakeLoader implements TargetLoader {
  loaded: Record<string, unknown[][]> = {};
  async loadTable(spec: TableLoadSpec, rows: unknown[][]): Promise<number> {
    this.loaded[`${spec.schema ?? ''}.${spec.table}`] = rows;
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
const knobs = { readCap: 1000, timeoutSeconds: 30 };
function planFor(tables: TableLoadSpec[]): LoadPlan {
  return { tables, issues: [] };
}
function spec(partial: Partial<TableLoadSpec> & { table: string }): TableLoadSpec {
  return {
    schema: 'dbo',
    orderBy: ['id'],
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

  it('marks an oversize table unverifiable without loading partial data', async () => {
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
      knobs: { readCap: 5, timeoutSeconds: 30 },
    });
    expect(report.tables[0].status).toBe('unverifiable');
    expect(loader.loaded['dbo.big']).toBeUndefined();
    expect(report.summary.status).toBe('unverifiable');
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
