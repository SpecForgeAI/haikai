/**
 * Shared test fakes for the compensation / S0 machinery (Capture-State
 * Discipline Specs 1–2): an in-memory table store, a read adapter
 * implementing the keyset-paged ordered read the imagers use, and a write
 * adapter that APPLIES generated statements through a mini-interpreter for
 * the exact grammar the generators emit (incl. the restore grammar's
 * TRUNCATE TABLE). NOT a test file — imported by the *.test.ts suites.
 */

import type { DbAdapter, DbReadResult } from '../../services/db/DbAdapter';
import type {
  CompensationBatchOptions,
  CompensationBatchResult,
  CompensationWriteAdapter,
} from '../../services/compensation/WriteAdapter';

export type Row = Record<string, unknown>;

export class FakeStore {
  tables = new Map<string, Row[]>();
  reseeds: string[] = [];
  truncates: string[] = [];

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

export function tupleCompare(a: unknown[], b: unknown[]): number {
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

export function fakeReadAdapter(store: FakeStore): DbAdapter {
  return {
    async testConnection() {
      return { success: true as const };
    },
    async listMetadata() {
      return [];
    },
    async runReadonlySelect(sql: string): Promise<DbReadResult> {
      // The state-delta snapshot ladder (stateDelta.ts) reads through this
      // surface: a COUNT per effect table plus an optional keyed-row SELECT.
      const mCount = sql.match(/^SELECT COUNT\(\*\) AS row_count FROM (\S+)$/i);
      if (mCount) {
        return {
          rows: [{ row_count: (store.tables.get(mCount[1]) ?? []).length }],
          rowCount: 1,
          truncated: false,
        };
      }
      const mKeyed = sql.match(/^SELECT \* FROM (\S+) WHERE (\S+) = (.+)$/i);
      if (mKeyed) {
        const wanted = parseLiteral(mKeyed[3]);
        const rows = (store.tables.get(mKeyed[1]) ?? [])
          .filter((r) => String(r[mKeyed[2]] ?? '') === String(wanted ?? ''))
          .map((r) => ({ ...r }));
        return { rows, rowCount: rows.length, truncated: false };
      }
      // Scoped-row imaging primitives (Item #1, 2026-08-27): new-row sweep
      // (`pk > max-before`) and max(PK) aggregate.
      const mAbove = sql.match(/^SELECT \* FROM (\S+) WHERE (\S+) > (.+)$/i);
      if (mAbove) {
        const threshold = Number(parseLiteral(mAbove[3]));
        const rows = (store.tables.get(mAbove[1]) ?? [])
          .filter((r) => Number(r[mAbove[2]] ?? NaN) > threshold)
          .map((r) => ({ ...r }));
        return { rows, rowCount: rows.length, truncated: false };
      }
      const mMax = sql.match(/^SELECT MAX\((\S+)\) AS max_val FROM (\S+)$/i);
      if (mMax) {
        let max: number | null = null;
        for (const r of store.tables.get(mMax[2]) ?? []) {
          const n = Number(r[mMax[1]] ?? NaN);
          if (Number.isFinite(n) && (max === null || n > max)) max = n;
        }
        return { rows: [{ max_val: max }], rowCount: 1, truncated: false };
      }
      throw new Error(`fake runReadonlySelect cannot interpret: ${sql}`);
    },
    async sampleValues(): Promise<DbReadResult> {
      throw new Error('not used by the imagers');
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

// --- mini-interpreter for the generators' exact statement grammar ----------

export function splitTopLevel(input: string, separator: string): string[] {
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

export function parseLiteral(raw: string): unknown {
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

export function applyStatement(store: FakeStore, sql: string): number {
  let m = sql.match(/^SET IDENTITY_INSERT \S+ (ON|OFF)$/i);
  if (m) return 0;
  m = sql.match(/^EXEC sp_chgattribute '([^']+)', 'identity_burn_max', 0, '(\d+)'$/i);
  if (m) {
    store.reseeds.push(sql);
    return 0;
  }
  m = sql.match(/^TRUNCATE TABLE (\S+)$/i);
  if (m) {
    const rows = store.tables.get(m[1]) ?? [];
    store.tables.set(m[1], []);
    store.truncates.push(m[1]);
    return rows.length;
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

export interface FakeWriteAdapter extends CompensationWriteAdapter {
  batches: string[][];
  executeRestoreBatch(
    statements: string[],
    options?: CompensationBatchOptions,
  ): Promise<CompensationBatchResult>;
}

export function fakeWriteAdapter(
  store: FakeStore,
  opts?: { dropMatching?: RegExp },
): FakeWriteAdapter {
  const batches: string[][] = [];
  const run = async (statements: string[]): Promise<CompensationBatchResult> => {
    batches.push(statements);
    const rowCounts: number[] = [];
    for (const statement of statements) {
      if (opts?.dropMatching?.test(statement)) {
        rowCounts.push(0); // sabotage: silently skip (residue-path tests)
        continue;
      }
      rowCounts.push(applyStatement(store, statement));
    }
    return { rowCounts };
  };
  return {
    batches,
    async executeCompensationBatch(statements: string[]): Promise<CompensationBatchResult> {
      return run(statements);
    },
    async executeRestoreBatch(statements: string[]): Promise<CompensationBatchResult> {
      return run(statements);
    },
    async dispose() {
      /* noop */
    },
  };
}
