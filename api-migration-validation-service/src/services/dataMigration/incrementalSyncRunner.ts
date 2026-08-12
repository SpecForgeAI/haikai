/**
 * Incremental (side-by-side daily) sync runner — gold-standard campaign C4
 * (2026-08-07).
 *
 * The operating model (Persistence-Tier program): weekend bulk load, then the
 * CURRENT and TARGET databases run side by side with a ONE-WAY daily
 * incremental sync into the shadow target until swap-over. The pack used to
 * emit a bash runner whose `sync_table()` body was COMMENTS — it executed
 * nothing. This runner is the real, rerunnable capability:
 *
 * Per table, driven by the pack's `sync.tables` strategies:
 *   - `insert_only` / `insert_update` — keyset-read source rows STRICTLY
 *     AFTER the stored high-water on the delta key (the same NULL-aware
 *     keyset predicate the bulk load uses, with `orderBy=[deltaKey]` and
 *     `after=[high_water]`), forward-transform through the pair ruleset, and
 *     UPSERT into the target (`ON CONFLICT (pk) DO NOTHING` for insert_only,
 *     `DO UPDATE` for insert_update). The high-water advances in
 *     `haikai_sync_state` ON THE TARGET only after the table syncs clean.
 *   - `full_reload` — truncate + reload the whole table (the delete-catching
 *     mechanism for keyless tables); pages exactly like the bulk load.
 *   - `needs_decision` / `skipped` — honest per-table rows naming the open
 *     decision / the resolution; NEVER silently absent from the report.
 *   - `delete_mode: 'pk_diff'` (opt-in per table) — after the delta apply,
 *     read BOTH sides' primary-key tuples and DELETE target-only keys
 *     (bounded by `pk_diff_max_rows`; refused above it, honestly).
 *
 * NEVER throws — a per-table failure becomes an error row and the run
 * continues (mirrors the bulk runner). Credentials are function-scope only.
 */
import { DbAdapter, MAX_SINGLE_FETCH_ROWS } from '../db/DbAdapter';
import { MigrationPairRuleset } from '../../migrationPairRules';
import { SyncTargetLoader, TableLoadError } from './targetLoader';
import { ForwardColumn, forwardTransformRow } from './pairRuleForwardTransform';
import { TableLoadSpec } from './types';

export interface SyncTableSpec {
  /** The bulk-load spec (columns, identity, pk order key) for this table. */
  load: TableLoadSpec;
  /** `<schema>.<table>` — the sync-state key (matches the pack manifest). */
  tableRef: string;
  strategy: 'insert_only' | 'insert_update' | 'full_reload' | 'needs_decision' | 'skipped';
  deltaKey: string | null;
  /** Opt-in delete propagation for this table. Default 'none'. */
  deleteMode?: 'none' | 'pk_diff';
}

export interface SyncKnobs {
  pageRows: number;
  timeoutSeconds: number;
  /**
   * pk-diff deletes read BOTH sides' full key sets — bounded honestly. A
   * table above the bound reports `delete_check: 'unverifiable'` rather than
   * pretending deletes were propagated.
   */
  pkDiffMaxRows: number;
}

export interface SyncTableResult {
  table: string;
  strategy: SyncTableSpec['strategy'];
  delta_key: string | null;
  status: 'synced' | 'reloaded' | 'skipped' | 'needs_decision' | 'error';
  rows_applied: number;
  rows_deleted: number;
  previous_high_water: string | null;
  new_high_water: string | null;
  delete_check: 'none' | 'clean' | 'deleted' | 'unverifiable';
  reason: string | null;
}

export interface IncrementalSyncReport {
  pair_id: string | null;
  tables: SyncTableResult[];
  summary: {
    tables: number;
    synced: number;
    reloaded: number;
    skipped: number;
    needs_decision: number;
    errors: number;
    rows_applied: number;
    rows_deleted: number;
    status: 'clean' | 'attention' | 'empty';
  };
}

function rowValue(row: Record<string, unknown>, column: string): unknown {
  if (column in row) return row[column];
  const wanted = column.trim().toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.trim().toLowerCase() === wanted) return row[key];
  }
  return undefined;
}

async function syncOneTable(
  source: DbAdapter,
  loader: SyncTargetLoader,
  spec: SyncTableSpec,
  ruleset: MigrationPairRuleset | null,
  knobs: SyncKnobs,
): Promise<SyncTableResult> {
  const base: SyncTableResult = {
    table: spec.tableRef,
    strategy: spec.strategy,
    delta_key: spec.deltaKey,
    status: 'error',
    rows_applied: 0,
    rows_deleted: 0,
    previous_high_water: null,
    new_high_water: null,
    delete_check: 'none',
    reason: null,
  };

  if (spec.strategy === 'needs_decision') {
    return {
      ...base,
      status: 'needs_decision',
      reason:
        `no usable delta key — resolve pack decision 'delta_key--${spec.tableRef}' ` +
        `(full_reload_each_increment | skip_from_incremental | manually_specified_key) ` +
        `and regenerate the pack; the table is NOT synced until then`,
    };
  }
  if (spec.strategy === 'skipped') {
    return {
      ...base,
      status: 'skipped',
      reason: `excluded from incremental sync by the resolved delta_key decision`,
    };
  }

  // Source column types (for the pair-rule forward transform) — same
  // metadata read as the bulk runner.
  const meta = await source.listMetadata({
    tables: [spec.load.table],
    schemas: spec.load.schema ? [spec.load.schema] : null,
  });
  const typeByColumn = new Map<string, string>();
  for (const t of meta) {
    for (const c of t.columns) typeByColumn.set(c.column.trim().toLowerCase(), c.dataType ?? '');
  }
  const columns: ForwardColumn[] = spec.load.loadColumns.map((name) => ({
    name,
    sourceType: typeByColumn.get(name.trim().toLowerCase()) ?? '',
  }));
  const pageRows = Math.max(1, Math.min(knobs.pageRows, MAX_SINGLE_FETCH_ROWS));
  // Type-aware cursor rendering (2026-08-12) — see the bulk runner.
  const typesFor = (cols: string[]): Array<string | null> =>
    cols.map((c) => typeByColumn.get(c.trim().toLowerCase()) ?? null);

  if (spec.strategy === 'full_reload') {
    await loader.prepareTable(spec.load);
    let after: unknown[] | null = null;
    let applied = 0;
    for (;;) {
      const read = await source.fetchOrderedRows({
        schema: spec.load.schema,
        table: spec.load.table,
        orderBy: spec.load.orderBy,
        limits: { maxRows: pageRows, timeoutSeconds: knobs.timeoutSeconds },
        after,
        orderByTypes: typesFor(spec.load.orderBy),
      });
      if (read.rows.length === 0) break;
      const tuples = read.rows.map((r) => forwardTransformRow(r, columns, ruleset).values);
      applied += await loader.loadTable(spec.load, tuples);
      if (read.rows.length < pageRows && !read.truncated) break;
      const lastRow = read.rows[read.rows.length - 1];
      const cursor = spec.load.orderBy.map((c) => rowValue(lastRow, c) ?? null);
      if (after !== null && JSON.stringify(cursor) === JSON.stringify(after)) {
        return {
          ...base,
          rows_applied: applied,
          reason:
            `keyset cursor did not advance during the full reload — the order key repeats ` +
            `across a page; the reload is PARTIAL`,
        };
      }
      after = cursor;
    }
    await loader.setHighWater(spec.tableRef, 'full_reload', 'ok');
    return { ...base, status: 'reloaded', rows_applied: applied, delete_check: 'clean' };
  }

  // Keyed delta (insert_only / insert_update).
  if (!spec.deltaKey) {
    return { ...base, reason: 'keyed strategy without a delta key — pack manifest is inconsistent' };
  }
  const previousHw = await loader.getHighWater(spec.tableRef);
  base.previous_high_water = previousHw;
  const conflictColumns =
    spec.load.orderKeyIsPrimaryKey !== false && spec.load.orderBy.length > 0
      ? spec.load.orderBy
      : [spec.deltaKey];
  let after: unknown[] | null = previousHw !== null ? [previousHw] : null;
  let applied = 0;
  let maxKey: unknown = previousHw;
  for (;;) {
    const read = await source.fetchOrderedRows({
      schema: spec.load.schema,
      table: spec.load.table,
      orderBy: [spec.deltaKey],
      limits: { maxRows: pageRows, timeoutSeconds: knobs.timeoutSeconds },
      after,
      orderByTypes: typesFor([spec.deltaKey]),
    });
    if (read.rows.length === 0) break;
    const tuples = read.rows.map((r) => forwardTransformRow(r, columns, ruleset).values);
    applied += await loader.upsertTable(
      spec.load,
      tuples,
      conflictColumns,
      spec.strategy === 'insert_update' ? 'update' : 'nothing',
    );
    const lastRow = read.rows[read.rows.length - 1];
    maxKey = rowValue(lastRow, spec.deltaKey) ?? maxKey;
    if (read.rows.length < pageRows && !read.truncated) break;
    const cursor = [rowValue(lastRow, spec.deltaKey) ?? null];
    if (after !== null && JSON.stringify(cursor) === JSON.stringify(after)) {
      return {
        ...base,
        rows_applied: applied,
        reason:
          `delta cursor did not advance (delta key '${spec.deltaKey}' repeats across a ` +
          `full page) — the applied rows are PARTIAL; a unique delta key is required`,
      };
    }
    after = cursor;
  }

  // Delete propagation (opt-in): pk-diff bounded by pkDiffMaxRows.
  let deleteCheck: SyncTableResult['delete_check'] = 'none';
  let deleted = 0;
  if (spec.deleteMode === 'pk_diff') {
    const pkColumns =
      spec.load.orderKeyIsPrimaryKey !== false && spec.load.orderBy.length > 0
        ? spec.load.orderBy
        : null;
    if (!pkColumns) {
      deleteCheck = 'unverifiable';
      base.reason = 'pk_diff delete requested but the table has no primary-key order key';
    } else {
      const sourceCount = await source.countRows({
        schema: spec.load.schema,
        table: spec.load.table,
        limits: { maxRows: 5, timeoutSeconds: knobs.timeoutSeconds },
      });
      if (sourceCount > knobs.pkDiffMaxRows) {
        deleteCheck = 'unverifiable';
        base.reason =
          `pk_diff delete skipped: source has ${sourceCount} rows > the pk_diff bound ` +
          `${knobs.pkDiffMaxRows} — raise pk_diff_max_rows or use full_reload for this table`;
      } else {
        const sourceKeys = new Set<string>();
        let kAfter: unknown[] | null = null;
        for (;;) {
          const read = await source.fetchOrderedRows({
            schema: spec.load.schema,
            table: spec.load.table,
            orderBy: pkColumns,
            limits: { maxRows: pageRows, timeoutSeconds: knobs.timeoutSeconds },
            after: kAfter,
            orderByTypes: typesFor(pkColumns),
          });
          if (read.rows.length === 0) break;
          for (const r of read.rows) {
            sourceKeys.add(JSON.stringify(pkColumns.map((c) => String(rowValue(r, c) ?? ''))));
          }
          if (read.rows.length < pageRows && !read.truncated) break;
          const lastRow = read.rows[read.rows.length - 1];
          kAfter = pkColumns.map((c) => rowValue(lastRow, c) ?? null);
        }
        const targetTuples = await loader.readKeyTuples(spec.load, pkColumns);
        const toDelete = targetTuples.filter(
          (t) => !sourceKeys.has(JSON.stringify(t.map((v) => String(v ?? ''))))
        );
        deleted = await loader.deleteByKeyTuples(spec.load, pkColumns, toDelete);
        deleteCheck = deleted > 0 ? 'deleted' : 'clean';
      }
    }
  }

  const newHw = maxKey === null || maxKey === undefined ? previousHw : String(maxKey);
  if (newHw !== null) {
    await loader.setHighWater(spec.tableRef, newHw, 'ok');
  }
  return {
    ...base,
    status: 'synced',
    rows_applied: applied,
    rows_deleted: deleted,
    new_high_water: newHw,
    delete_check: deleteCheck,
  };
}

export async function runIncrementalSync(args: {
  source: DbAdapter;
  loader: SyncTargetLoader;
  tables: SyncTableSpec[];
  ruleset: MigrationPairRuleset | null;
  knobs: SyncKnobs;
}): Promise<IncrementalSyncReport> {
  await args.loader.ensureSyncState();
  const results: SyncTableResult[] = [];
  for (const spec of args.tables) {
    try {
      results.push(await syncOneTable(args.source, args.loader, spec, args.ruleset, args.knobs));
    } catch (err) {
      const partial = err instanceof TableLoadError ? err.rowsWritten : 0;
      results.push({
        table: spec.tableRef,
        strategy: spec.strategy,
        delta_key: spec.deltaKey,
        status: 'error',
        rows_applied: partial,
        rows_deleted: 0,
        previous_high_water: null,
        new_high_water: null,
        delete_check: 'none',
        reason: `sync error: ${err instanceof Error ? err.message.slice(0, 300) : 'unknown'}`,
      });
      try {
        await args.loader.setHighWater(spec.tableRef, 'error', 'error');
      } catch {
        /* state stamp is best-effort on the error path */
      }
    }
  }
  const counts = {
    synced: results.filter((r) => r.status === 'synced').length,
    reloaded: results.filter((r) => r.status === 'reloaded').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    needs_decision: results.filter((r) => r.status === 'needs_decision').length,
    errors: results.filter((r) => r.status === 'error').length,
  };
  return {
    pair_id: args.ruleset?.pair_id ?? null,
    tables: results,
    summary: {
      tables: results.length,
      ...counts,
      rows_applied: results.reduce((n, r) => n + r.rows_applied, 0),
      rows_deleted: results.reduce((n, r) => n + r.rows_deleted, 0),
      status:
        results.length === 0
          ? 'empty'
          : counts.errors > 0 || counts.needs_decision > 0
            ? 'attention'
            : 'clean',
    },
  };
}
