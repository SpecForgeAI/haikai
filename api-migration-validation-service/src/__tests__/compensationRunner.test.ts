/**
 * Compensation bracket runner — END-TO-END tests (Capture-State Discipline
 * Spec 1) against an in-memory table store: a fake read adapter implements
 * the keyset-paged ordered read the imager uses, and a fake write adapter
 * APPLIES the generated statements through a mini-interpreter for the exact
 * grammar the generator emits. The proof is behavioural: fire mutates the
 * store, the bracket restores byte-parity, verification agrees.
 */

import type { DbAdapter, DbReadResult } from '../services/db/DbAdapter';
import { buildCompensationMetadataIndex } from '../services/compensation/compensationMetadata';
import { runCompensationBracket } from '../services/compensation/compensationRunner';
import type {
  CompensationBatchOptions,
  CompensationBatchResult,
  CompensationWriteAdapter,
} from '../services/compensation/WriteAdapter';

// ---------------------------------------------------------------------------
// In-memory store + fake adapters
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

class FakeStore {
  tables = new Map<string, Row[]>();
  reseeds: string[] = [];

  clone(): Map<string, Row[]> {
    const out = new Map<string, Row[]>();
    for (const [name, rows] of this.tables) {
      out.set(name, rows.map((r) => ({ ...r })));
    }
    return out;
  }

  snapshotJson(): string {
    const ordered: Record<string, Row[]> = {};
    for (const name of [...this.tables.keys()].sort()) {
      const pk = Object.keys(this.tables.get(name)?.[0] ?? { id: 1 })[0];
      ordered[name] = [...(this.tables.get(name) ?? [])].sort((a, b) =>
        String(a[pk]).localeCompare(String(b[pk])),
      );
    }
    return JSON.stringify(ordered);
  }
}

function tupleCompare(a: unknown[], b: unknown[]): number {
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === bv) continue;
    if (av === null || av === undefined) return -1;
    if (bv === null || bv === undefined) return 1;
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av) < String(bv) ? -1 : 1;
  }
  return 0;
}

function fakeReadAdapter(store: FakeStore): DbAdapter {
  return {
    async testConnection() {
      return { success: true as const };
    },
    async listMetadata() {
      return [];
    },
    async runReadonlySelect(): Promise<DbReadResult> {
      throw new Error('not used by the imager');
    },
    async sampleValues(): Promise<DbReadResult> {
      throw new Error('not used by the imager');
    },
    async countRows({ table }) {
      return (store.tables.get(table) ?? []).length;
    },
    async fetchOrderedRows({ table, orderBy, limits, after }) {
      const rows = [...(store.tables.get(table) ?? [])].sort((a, b) =>
        tupleCompare(
          orderBy.map((c) => a[c]),
          orderBy.map((c) => b[c]),
        ),
      );
      const fromIdx =
        after == null
          ? 0
          : rows.findIndex((r) => tupleCompare(orderBy.map((c) => r[c]), after) > 0);
      const start = fromIdx === -1 ? rows.length : fromIdx;
      const page = rows.slice(start, start + limits.maxRows).map((r) => ({ ...r }));
      return { rows: page, rowCount: page.length, truncated: false };
    },
    async dispose() {
      /* noop */
    },
  };
}

// --- mini-interpreter for the generator's exact statement grammar ----------

function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "'") {
      if (inQuote && input[i + 1] === "'") {
        current += "''";
        i++;
        continue;
      }
      inQuote = !inQuote;
      current += ch;
      continue;
    }
    if (!inQuote && input.startsWith(separator, i)) {
      parts.push(current.trim());
      current = '';
      i += separator.length - 1;
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

function parseLiteral(raw: string): unknown {
  const t = raw.trim();
  if (/^NULL$/i.test(t)) return null;
  if (t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  const n = Number(t);
  if (Number.isFinite(n)) return n;
  throw new Error(`fake applier cannot parse literal: ${raw}`);
}

function rowMatches(row: Row, predicate: string): boolean {
  return splitTopLevel(predicate, ' AND ').every((term) => {
    const isNull = term.match(/^(\S+)\s+IS\s+NULL$/i);
    if (isNull) return row[isNull[1]] === null || row[isNull[1]] === undefined;
    const eq = term.match(/^(\S+)\s*=\s*(.+)$/);
    if (!eq) throw new Error(`fake applier cannot parse predicate term: ${term}`);
    return JSON.stringify(row[eq[1]] ?? null) === JSON.stringify(parseLiteral(eq[2]) ?? null);
  });
}

function applyStatement(store: FakeStore, sql: string): number {
  let m = sql.match(/^SET IDENTITY_INSERT \S+ (ON|OFF)$/i);
  if (m) return 0;
  m = sql.match(/^EXEC sp_chgattribute '([^']+)', 'identity_burn_max', 0, '(\d+)'$/i);
  if (m) {
    store.reseeds.push(sql);
    return 0;
  }
  m = sql.match(/^DELETE FROM (\S+) WHERE (.+)$/i);
  if (m) {
    const rows = store.tables.get(m[1]) ?? [];
    const keep = rows.filter((r) => !rowMatches(r, m![2]));
    store.tables.set(m[1], keep);
    return rows.length - keep.length;
  }
  m = sql.match(/^UPDATE (\S+) SET (.+) WHERE (.+)$/i);
  if (m) {
    const rows = store.tables.get(m[1]) ?? [];
    let touched = 0;
    for (const row of rows) {
      if (!rowMatches(row, m[3])) continue;
      for (const assignment of splitTopLevel(m[2], ',')) {
        const eq = assignment.match(/^(\S+)\s*=\s*(.+)$/);
        if (!eq) throw new Error(`fake applier cannot parse assignment: ${assignment}`);
        row[eq[1]] = parseLiteral(eq[2]);
      }
      touched++;
    }
    return touched;
  }
  m = sql.match(/^INSERT INTO (\S+) \(([^)]+)\) VALUES \((.+)\)$/i);
  if (m) {
    const cols = m[2].split(',').map((c) => c.trim());
    const values = splitTopLevel(m[3], ',').map(parseLiteral);
    const row: Row = {};
    cols.forEach((c, i) => {
      row[c] = values[i];
    });
    const rows = store.tables.get(m[1]) ?? [];
    rows.push(row);
    store.tables.set(m[1], rows);
    return 1;
  }
  throw new Error(`fake applier cannot interpret: ${sql}`);
}

function fakeWriteAdapter(
  store: FakeStore,
  opts?: { dropMatching?: RegExp },
): CompensationWriteAdapter & { batches: string[][] } {
  const batches: string[][] = [];
  return {
    batches,
    async executeCompensationBatch(
      statements: string[],
      _options?: CompensationBatchOptions,
    ): Promise<CompensationBatchResult> {
      batches.push(statements);
      const rowCounts: number[] = [];
      for (const statement of statements) {
        if (opts?.dropMatching?.test(statement)) {
          rowCounts.push(0); // sabotage: silently skip (residue-path test)
          continue;
        }
        rowCounts.push(applyStatement(store, statement));
      }
      return { rowCounts };
    },
    async dispose() {
      /* noop */
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

  it('refuses table_too_large without firing when the live count exceeds the cap', async () => {
    jest.resetModules();
    process.env.COMPENSATION_FULL_IMAGE_MAX_ROWS = '1';
    /* eslint-disable @typescript-eslint/no-var-requires */
    const freshRunner = require('../services/compensation/compensationRunner');
    const freshMetadata = require('../services/compensation/compensationMetadata');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const store = seededStore(); // orders has 2 rows > cap 1
    const fire = jest.fn(async () => 'never');
    const run = await freshRunner.runCompensationBracket({
      readAdapter: fakeReadAdapter(store),
      writeAdapter: fakeWriteAdapter(store),
      engine: 'sybase',
      tables: ['orders'],
      metadata: freshMetadata.buildCompensationMetadataIndex(MODEL),
      fire,
    });
    expect(run.outcome.kind).toBe('refused');
    expect(run.outcome.refusals[0].reason).toBe('table_too_large');
    expect(fire).not.toHaveBeenCalled();
  });
});
