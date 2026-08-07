/**
 * Spec P (Data-Tier Oracle Program) — data-parity comparator. Pins:
 *
 *   LADDER PIN    — counts rung short-circuits (divergent count_mismatch,
 *                   depth 'counts'); empty tables match at depth 'full'
 *   RULE PIN      — pair rules TOLERATE declared divergences and are CITED;
 *                   with no rules comparison is strict
 *   COLUMN PIN    — source columns missing on the target => column_set
 *   HONESTY PIN   — unorderable tables and per-table errors are
 *                   unverifiable(reason), never silent; the run continues
 *   DEPTH PIN     — tables above fullScanMaxRows compare a keyed sample and
 *                   report depth 'sampled'
 */
import { DbAdapter, DbReadResult, DbTableMetadata } from '../services/db/DbAdapter';
import {
  DataParityKnobs,
  runDataParityComparison,
} from '../services/dataParity/dataParityComparator';
import { MigrationPairRuleset } from '../migrationPairRules';

interface FakeTable {
  columns: Array<{ column: string; dataType: string }>;
  rows: Array<Record<string, unknown>>;
}

/** Nulls-low, type-loose ordering — mirrors the adapters' ordering contract. */
function orderRows(
  rows: Array<Record<string, unknown>>,
  orderBy: string[],
): Array<Record<string, unknown>> {
  return [...rows].sort((a, b) => {
    for (const col of orderBy) {
      const av = a[col];
      const bv = b[col];
      if (av === bv) continue;
      if (av === null || av === undefined) return -1;
      if (bv === null || bv === undefined) return 1;
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  });
}

class FakeAdapter implements DbAdapter {
  constructor(
    private readonly tables: Record<string, FakeTable>,
    private readonly failures: {
      countRowsThrows?: string[];
      /** Simulate a DIFFERENT engine collation: fetch order comes back reversed. */
      reverseFetchOrder?: boolean;
    } = {},
  ) {}

  async testConnection(): Promise<{ success: true }> {
    return { success: true };
  }

  async listMetadata(allowlist: { tables?: string[] | null }): Promise<DbTableMetadata[]> {
    const wanted = allowlist.tables ?? Object.keys(this.tables);
    return wanted
      .filter((t) => this.tables[t])
      .map((t) => ({
        schema: 'dbo',
        table: t,
        columns: this.tables[t].columns.map((c) => ({
          schema: 'dbo',
          table: t,
          column: c.column,
          dataType: c.dataType,
          isNullable: true,
        })),
      }));
  }

  async runReadonlySelect(): Promise<DbReadResult> {
    throw new Error('not used by the comparator');
  }

  async sampleValues(): Promise<DbReadResult> {
    throw new Error('not used by the comparator');
  }

  async countRows(args: { table: string }): Promise<number> {
    if (this.failures.countRowsThrows?.includes(args.table)) {
      throw new Error(`simulated connection failure for ${args.table}`);
    }
    return this.tables[args.table]?.rows.length ?? 0;
  }

  async fetchOrderedRows(args: {
    table: string;
    orderBy: string[];
    limits: { maxRows: number };
  }): Promise<DbReadResult> {
    const table = this.tables[args.table];
    if (!table) throw new Error(`unknown table ${args.table}`);
    let ordered = orderRows(table.rows, args.orderBy);
    if (this.failures.reverseFetchOrder) ordered = ordered.reverse();
    const rows = ordered.slice(0, args.limits.maxRows);
    return { rows, rowCount: rows.length, truncated: rows.length < table.rows.length };
  }

  async dispose(): Promise<void> {
    /* no-op */
  }
}

const RULESET: MigrationPairRuleset = {
  pair_id: 'test-pair',
  version: 1,
  source: { engine: 'engine-a', version: '1' },
  target: { engine: 'engine-b', version: '1' },
  rules: [
    {
      id: 'T.RTRIM',
      divergence_class: 'trailing_space',
      title: 'trailing spaces insignificant',
      applies_to: { column_types: ['varchar'] },
      comparison: { strategy: 'string-rtrim' },
    },
    {
      id: 'T.DT300',
      divergence_class: 'datetime_precision',
      title: 'tick-grid timestamps',
      applies_to: { column_types: ['datetime'] },
      comparison: { strategy: 'timestamp-truncate', params: { ticks_per_second: 300 } },
    },
  ],
};

const KNOBS: DataParityKnobs = { sampleRows: 100, fullScanMaxRows: 1000, timeoutSeconds: 5 };

const ID_COL = { column: 'id', dataType: 'int' };

describe('data-parity comparator', () => {
  test('identical tables match at depth full; status clean', async () => {
    const rows = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ];
    const columns = [ID_COL, { column: 'name', dataType: 'varchar' }];
    const report = await runDataParityComparison({
      source: new FakeAdapter({ t: { columns, rows } }),
      target: new FakeAdapter({ t: { columns, rows: [...rows] } }),
      tables: [{ table: 't', orderBy: ['id'] }],
      ruleset: RULESET,
      knobs: KNOBS,
    });
    expect(report.tables[0].verdict).toBe('match');
    expect(report.tables[0].depth).toBe('full');
    expect(report.tables[0].rows_compared).toBe(2);
    expect(report.summary.status).toBe('clean');
  });

  test('count mismatch short-circuits at the counts rung', async () => {
    const columns = [ID_COL];
    const report = await runDataParityComparison({
      source: new FakeAdapter({ t: { columns, rows: [{ id: 1 }, { id: 2 }] } }),
      target: new FakeAdapter({ t: { columns, rows: [{ id: 1 }] } }),
      tables: [{ table: 't' }],
      ruleset: RULESET,
      knobs: KNOBS,
    });
    expect(report.tables[0].verdict).toBe('divergent');
    expect(report.tables[0].divergence_class).toBe('count_mismatch');
    expect(report.tables[0].depth).toBe('counts');
    expect(report.tables[0].source_count).toBe(2);
    expect(report.tables[0].target_count).toBe(1);
  });

  test('empty tables match at depth full without fetching rows', async () => {
    const columns = [ID_COL];
    const report = await runDataParityComparison({
      source: new FakeAdapter({ t: { columns, rows: [] } }),
      target: new FakeAdapter({ t: { columns, rows: [] } }),
      tables: [{ table: 't' }],
      ruleset: null,
      knobs: KNOBS,
    });
    expect(report.tables[0].verdict).toBe('match');
    expect(report.tables[0].depth).toBe('full');
    expect(report.tables[0].rows_compared).toBe(0);
  });

  test('pair rules tolerate declared divergences and are cited', async () => {
    const columns = [ID_COL, { column: 'name', dataType: 'varchar' }];
    const report = await runDataParityComparison({
      source: new FakeAdapter({ t: { columns, rows: [{ id: 1, name: 'A ' }] } }),
      target: new FakeAdapter({ t: { columns, rows: [{ id: 1, name: 'A' }] } }),
      tables: [{ table: 't', orderBy: ['id'] }],
      ruleset: RULESET,
      knobs: KNOBS,
    });
    expect(report.tables[0].verdict).toBe('match');
    expect(report.tables[0].rules_cited).toContain('T.RTRIM');
    expect(report.summary.rules_cited).toContain('T.RTRIM');
  });

  test('timestamp tick-grid rule equates sub-tick differences', async () => {
    const columns = [ID_COL, { column: 'at', dataType: 'datetime' }];
    const report = await runDataParityComparison({
      source: new FakeAdapter({
        t: { columns, rows: [{ id: 1, at: '2026-01-01T00:00:00.001Z' }] },
      }),
      target: new FakeAdapter({
        t: { columns, rows: [{ id: 1, at: '2026-01-01T00:00:00.002Z' }] },
      }),
      tables: [{ table: 't', orderBy: ['id'] }],
      ruleset: RULESET,
      knobs: KNOBS,
    });
    expect(report.tables[0].verdict).toBe('match');
    expect(report.tables[0].rules_cited).toContain('T.DT300');
  });

  test('without an applicable rule, comparison is strict and evidence is capped', async () => {
    const columns = [ID_COL, { column: 'code', dataType: 'int' }];
    const report = await runDataParityComparison({
      source: new FakeAdapter({ t: { columns, rows: [{ id: 1, code: 10 }] } }),
      target: new FakeAdapter({ t: { columns, rows: [{ id: 1, code: 20 }] } }),
      tables: [{ table: 't', orderBy: ['id'] }],
      ruleset: RULESET,
      knobs: KNOBS,
    });
    const t = report.tables[0];
    expect(t.verdict).toBe('divergent');
    expect(t.divergence_class).toBe('cell_values');
    expect(t.cell_divergences).toBe(1);
    expect(t.divergence_examples[0]).toMatchObject({
      row_index: 0,
      column: 'code',
      source_value: '10',
      target_value: '20',
      rule_ids: [],
    });
    expect(report.summary.status).toBe('divergent');
  });

  test('source columns missing on the target => column_set divergence', async () => {
    const report = await runDataParityComparison({
      source: new FakeAdapter({
        t: {
          columns: [ID_COL, { column: 'extra', dataType: 'varchar' }],
          rows: [{ id: 1, extra: 'x' }],
        },
      }),
      target: new FakeAdapter({ t: { columns: [ID_COL], rows: [{ id: 1 }] } }),
      tables: [{ table: 't' }],
      ruleset: null,
      knobs: KNOBS,
    });
    expect(report.tables[0].verdict).toBe('divergent');
    expect(report.tables[0].divergence_class).toBe('column_set');
    expect(report.tables[0].reason).toContain('extra');
  });

  test('a table with no orderable columns is unverifiable, never guessed', async () => {
    const columns = [{ column: 'payload', dataType: 'json' }];
    const report = await runDataParityComparison({
      source: new FakeAdapter({ t: { columns, rows: [{ payload: '{}' }] } }),
      target: new FakeAdapter({ t: { columns, rows: [{ payload: '{}' }] } }),
      tables: [{ table: 't' }],
      ruleset: null,
      knobs: KNOBS,
    });
    expect(report.tables[0].verdict).toBe('unverifiable');
    expect(report.tables[0].reason).toContain('order');
    expect(report.summary.status).toBe('unverifiable');
  });

  test('a per-table error is unverifiable(reason) and the run continues', async () => {
    const columns = [ID_COL];
    const report = await runDataParityComparison({
      source: new FakeAdapter(
        { bad: { columns, rows: [] }, good: { columns, rows: [{ id: 1 }] } },
        { countRowsThrows: ['bad'] },
      ),
      target: new FakeAdapter({
        bad: { columns, rows: [] },
        good: { columns, rows: [{ id: 1 }] },
      }),
      tables: [{ table: 'bad' }, { table: 'good', orderBy: ['id'] }],
      ruleset: null,
      knobs: KNOBS,
    });
    expect(report.tables[0].verdict).toBe('unverifiable');
    expect(report.tables[0].reason).toContain('simulated connection failure');
    expect(report.tables[1].verdict).toBe('match');
  });

  test('tables above fullScanMaxRows compare a KEYED sample and report depth sampled', async () => {
    const columns = [ID_COL];
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const report = await runDataParityComparison({
      source: new FakeAdapter({ t: { columns, rows } }),
      target: new FakeAdapter({ t: { columns, rows: [...rows] } }),
      tables: [{ table: 't', orderBy: ['id'], keyIsUnique: true }],
      ruleset: null,
      knobs: { sampleRows: 2, fullScanMaxRows: 1, timeoutSeconds: 5 },
    });
    expect(report.tables[0].verdict).toBe('match');
    expect(report.tables[0].depth).toBe('sampled');
    expect(report.tables[0].rows_compared).toBe(2);
    expect(report.summary.match_sampled).toBe(1);
  });

  // ---- 2026-08-07: keyed join replaces positional zip ----------------------

  test('REGRESSION (live filter_tag shape): engines disagreeing on fetch order no longer diverge — keyed join aligns rows by key', async () => {
    const columns = [ID_COL, { column: 'name', dataType: 'varchar' }];
    const rows = [
      { id: 6, name: 'a' },
      { id: 17, name: 'b' },
      { id: 4419, name: 'z' },
    ];
    const report = await runDataParityComparison({
      source: new FakeAdapter({ t: { columns, rows } }),
      // Same logical rows; the target engine enumerates them in a DIFFERENT
      // order (the Sybase-binary vs Postgres-locale collation disagreement).
      target: new FakeAdapter({ t: { columns, rows: [...rows] } }, { reverseFetchOrder: true }),
      tables: [{ table: 't', orderBy: ['id'], keyIsUnique: true }],
      ruleset: null,
      knobs: KNOBS,
    });
    expect(report.tables[0].verdict).toBe('match');
    expect(report.tables[0].cell_divergences).toBe(0);
    expect(report.tables[0].rows_compared).toBe(3);
  });

  test('KEYLESS tables under the full-scan bound compare as a canonical-sorted multiset — fetch order still irrelevant', async () => {
    const columns = [ID_COL, { column: 'name', dataType: 'varchar' }];
    const rows = [
      { id: 1, name: 'x' },
      { id: 2, name: 'y' },
    ];
    const report = await runDataParityComparison({
      source: new FakeAdapter({ t: { columns, rows } }),
      target: new FakeAdapter({ t: { columns, rows: [...rows] } }, { reverseFetchOrder: true }),
      tables: [{ table: 't' }], // no key at all
      ruleset: null,
      knobs: KNOBS,
    });
    expect(report.tables[0].verdict).toBe('match');
    expect(report.tables[0].depth).toBe('full');
  });

  test('keyed FULL depth: a key on one side only is row_set divergence with examples', async () => {
    const columns = [ID_COL, { column: 'name', dataType: 'varchar' }];
    const report = await runDataParityComparison({
      source: new FakeAdapter({
        t: { columns, rows: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] },
      }),
      target: new FakeAdapter({
        t: { columns, rows: [{ id: 1, name: 'a' }, { id: 3, name: 'c' }] },
      }),
      tables: [{ table: 't', orderBy: ['id'], keyIsUnique: true }],
      ruleset: null,
      knobs: KNOBS,
    });
    expect(report.tables[0].verdict).toBe('divergent');
    expect(report.tables[0].divergence_class).toBe('row_set');
    expect(report.tables[0].reason).toContain('1 key(s) only on source');
    expect(report.tables[0].reason).toContain('1 only on target');
  });

  test('keyed comparison still finds REAL cell drift on matching keys', async () => {
    const columns = [ID_COL, { column: 'code', dataType: 'int' }];
    const report = await runDataParityComparison({
      source: new FakeAdapter({ t: { columns, rows: [{ id: 1, code: 10 }] } }),
      target: new FakeAdapter({ t: { columns, rows: [{ id: 1, code: 20 }] } }),
      tables: [{ table: 't', orderBy: ['id'], keyIsUnique: true }],
      ruleset: null,
      knobs: KNOBS,
    });
    expect(report.tables[0].verdict).toBe('divergent');
    expect(report.tables[0].divergence_class).toBe('cell_values');
  });

  test('KEYLESS above the full-scan bound is depth-honest unverifiable naming the PK fix — never sampled noise', async () => {
    const columns = [ID_COL];
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const report = await runDataParityComparison({
      source: new FakeAdapter({ t: { columns, rows } }),
      target: new FakeAdapter({ t: { columns, rows: [...rows] } }),
      tables: [{ table: 't', orderBy: ['id'] }], // orderable but NOT unique
      ruleset: null,
      knobs: { sampleRows: 2, fullScanMaxRows: 1, timeoutSeconds: 5 },
    });
    expect(report.tables[0].verdict).toBe('unverifiable');
    expect(report.tables[0].reason).toContain('primary key');
  });

  test('SAMPLED keyed pages covering different key ranges compare the intersection with a note, not divergence', async () => {
    const columns = [ID_COL];
    const report = await runDataParityComparison({
      source: new FakeAdapter({ t: { columns, rows: [{ id: 1 }, { id: 2 }, { id: 3 }] } }),
      // Target's first-2 page = ids 2,3 (id 1 missing on target entirely —
      // but at SAMPLED depth that is a sampling artifact, not proof).
      target: new FakeAdapter({ t: { columns, rows: [{ id: 2 }, { id: 3 }, { id: 4 }] } }),
      tables: [{ table: 't', orderBy: ['id'], keyIsUnique: true }],
      ruleset: null,
      knobs: { sampleRows: 2, fullScanMaxRows: 1, timeoutSeconds: 5 },
    });
    expect(report.tables[0].verdict).toBe('match');
    expect(report.tables[0].depth).toBe('sampled');
    expect(report.tables[0].rows_compared).toBe(1); // the {id:2} intersection
    expect(report.tables[0].reason).toContain('intersection');
  });
});
