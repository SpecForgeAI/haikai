/**
 * Data-migration runner (Spec Y) — executes the pack's Phase-2 bulk load.
 *
 * Per table, in the plan's (FK-topological) order:
 *   1. count the source;
 *   2. empty => nothing to load;
 *   3. read source column types + the source rows via KEYSET-PAGINATED
 *      ordered reads (2026-08-07) — EVERY row loads, whatever the table
 *      size; pages are bounded by `pageRows` (kept under the Sybase
 *      sidecar's per-response guard);
 *   4. forward-transform each row through the pair ruleset (rule-cited);
 *   5. write each page via the TargetLoader (truncate once, then append);
 *   6. reconcile: post-load target count == source count == rows read.
 *
 * The old v1 caps are GONE: the readCap skip-or-load gate (tables > 50k
 * loaded ZERO rows) and the single-read shape that silently truncated at the
 * sidecar's 10k clamp (tables 10k-50k loaded exactly 10k). `readCap` remains
 * ONLY as an explicit operator valve (0/absent = uncapped); a capped-out
 * table is a visible unverifiable, never a silent skip. Any read that cannot
 * make progress (stuck cursor) is a loud unverifiable — partial data is
 * NEVER reported as loaded.
 *
 * NEVER throws — a per-table failure becomes unverifiable(reason) and the run
 * continues (mirrors the data-parity comparator, Spec P). Predicate emission is
 * the caller's job (see dataMigrationPredicates.ts).
 */
import { DbAdapter } from '../db/DbAdapter';
import { MigrationPairRuleset } from '../../migrationPairRules';
import { TargetLoader } from './targetLoader';
import { ForwardColumn, forwardTransformRow } from './pairRuleForwardTransform';
import {
  DataMigrationReportBody,
  LoadPlan,
  TableLoadResult,
  TableLoadSpec,
} from './types';

export interface DataMigrationKnobs {
  /**
   * EXPLICIT operator valve ONLY (2026-08-07): 0 or negative = uncapped (the
   * default — a migration loads every row). When set > 0, a table whose
   * source exceeds it is reported unverifiable, visibly.
   */
  readCap: number;
  /** Rows per keyset page (bounded by the Sybase sidecar per-response guard). */
  pageRows: number;
  /** Per-QUERY timeout (each page/count runs under its own budget). */
  timeoutSeconds: number;
}

/** Case-insensitive row-value lookup (engines case-fold result keys differently). */
function rowValue(row: Record<string, unknown>, column: string): unknown {
  if (column in row) return row[column];
  const wanted = column.trim().toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.trim().toLowerCase() === wanted) return row[key];
  }
  return undefined;
}

async function safeCount(
  adapter: DbAdapter,
  spec: TableLoadSpec,
  timeoutSeconds: number,
): Promise<number | null> {
  try {
    return await adapter.countRows({
      schema: spec.schema,
      table: spec.table,
      limits: { maxRows: 5, timeoutSeconds },
    });
  } catch {
    return null;
  }
}

async function migrateOneTable(
  source: DbAdapter,
  target: DbAdapter,
  loader: TargetLoader,
  spec: TableLoadSpec,
  ruleset: MigrationPairRuleset | null,
  knobs: DataMigrationKnobs,
): Promise<TableLoadResult> {
  const base: TableLoadResult = {
    schema: spec.schema ?? null,
    table: spec.table,
    status: 'unverifiable',
    sourceCount: null,
    loadedCount: 0,
    targetCount: null,
    rulesCited: [],
    reason: null,
  };

  const sourceCount = await source.countRows({
    schema: spec.schema,
    table: spec.table,
    limits: { maxRows: 5, timeoutSeconds: knobs.timeoutSeconds },
  });
  base.sourceCount = sourceCount;

  if (sourceCount === 0) {
    return { ...base, status: 'empty', targetCount: await safeCount(target, spec, knobs.timeoutSeconds) };
  }
  if (knobs.readCap > 0 && sourceCount > knobs.readCap) {
    return {
      ...base,
      reason:
        `source has ${sourceCount} rows > the OPERATOR-SET read cap ${knobs.readCap} ` +
        `(read_cap / DATA_MIGRATION_READ_CAP) — raise or unset the cap to load this table`,
    };
  }

  // Source column types (for ruleset classification) from the source metadata.
  const meta = await source.listMetadata({
    tables: [spec.table],
    schemas: spec.schema ? [spec.schema] : null,
  });
  const typeByColumn = new Map<string, string>();
  for (const t of meta) {
    for (const c of t.columns) typeByColumn.set(c.column.trim().toLowerCase(), c.dataType ?? '');
  }
  const columns: ForwardColumn[] = spec.loadColumns.map((name) => ({
    name,
    sourceType: typeByColumn.get(name.trim().toLowerCase()) ?? '',
  }));

  // Idempotent load (WS3 P2, 2026-07-31): truncate ONCE before the first
  // page so a re-run (duplicate dispatch, retry, chain re-fire) can NEVER
  // double the rows — live: `view_tag` 864 -> 1,728 (exactly 2x) from a
  // duplicated run. Pages then APPEND.
  await loader.prepareTable(spec);

  const pageRows = Math.max(1, knobs.pageRows);
  const rulesCited = new Set<string>();
  let readTotal = 0;
  let loadedCount = 0;
  let after: unknown[] | null = null;
  let pages = 0;
  // Hard page budget: the exact page count + slack. Only a broken cursor
  // could exceed it; the guard converts an infinite loop into a loud failure.
  const maxPages = Math.ceil(sourceCount / pageRows) + 10;

  for (;;) {
    if (pages >= maxPages) {
      return {
        ...base,
        loadedCount,
        reason:
          `paginated read exceeded the page budget (${maxPages} pages of ${pageRows}) without ` +
          `finishing — the order key is not advancing; loaded rows are PARTIAL and the table is ` +
          `unverifiable`,
      };
    }
    const read = await source.fetchOrderedRows({
      schema: spec.schema,
      table: spec.table,
      orderBy: spec.orderBy,
      limits: { maxRows: pageRows, timeoutSeconds: knobs.timeoutSeconds },
      after,
    });
    pages += 1;
    if (read.rows.length === 0) break;

    const tuples: unknown[][] = [];
    for (const row of read.rows) {
      const transformed = forwardTransformRow(row, columns, ruleset);
      for (const id of transformed.appliedRuleIds) rulesCited.add(id);
      tuples.push(transformed.values);
    }
    loadedCount += await loader.loadTable(spec, tuples);
    readTotal += read.rows.length;

    if (read.rows.length < pageRows) break; // final page

    const lastRow = read.rows[read.rows.length - 1];
    const cursor = spec.orderBy.map((c) => rowValue(lastRow, c) ?? null);
    if (after !== null && JSON.stringify(cursor) === JSON.stringify(after)) {
      return {
        ...base,
        loadedCount,
        reason:
          `keyset cursor did not advance after page ${pages} (order key ` +
          `[${spec.orderBy.join(', ')}] repeats across a full page) — loaded rows are PARTIAL ` +
          `and the table is unverifiable; a unique order key (primary key) is required`,
      };
    }
    after = cursor;
  }

  const targetCount = await safeCount(target, spec, knobs.timeoutSeconds);
  const reconciled = targetCount === sourceCount && loadedCount === readTotal && readTotal === sourceCount;

  // In-loader manifest check: the pack's expected source count is the
  // generation-time truth — drift is worth a visible note even on a clean
  // load (the live business_date over-count class).
  const expected = spec.expectedSourceRowCount;
  const driftNote =
    expected !== null && expected !== sourceCount
      ? ` (source count ${sourceCount} differs from the pack manifest expectation ${expected} — source drifted since generation)`
      : '';
  // A non-unique order key can skip rows that exactly duplicate a page
  // boundary tuple — name the cause when the reconcile is off on such a key.
  const keyNote =
    spec.orderKeyIsPrimaryKey === false
      ? ' (order key is NOT a primary key: rows exactly duplicating a page-boundary key tuple ' +
        'are skipped by keyset pagination — add/propose a primary key for an exact load)'
      : '';

  return {
    ...base,
    status: reconciled ? 'loaded' : 'reconciled_mismatch',
    loadedCount,
    targetCount,
    rulesCited: [...rulesCited].sort(),
    reason: reconciled
      ? driftNote !== ''
        ? driftNote.trim()
        : null
      : `post-load reconcile off: source=${sourceCount} read=${readTotal} loaded=${loadedCount} ` +
        `target=${targetCount ?? '?'}${keyNote}${driftNote}`,
  };
}

export async function runDataMigration(args: {
  source: DbAdapter;
  target: DbAdapter;
  targetLoader: TargetLoader;
  plan: LoadPlan;
  ruleset: MigrationPairRuleset | null;
  knobs: DataMigrationKnobs;
}): Promise<DataMigrationReportBody> {
  const results: TableLoadResult[] = [];
  for (const spec of args.plan.tables) {
    try {
      results.push(
        await migrateOneTable(
          args.source,
          args.target,
          args.targetLoader,
          spec,
          args.ruleset,
          args.knobs,
        ),
      );
    } catch (err) {
      results.push({
        schema: spec.schema ?? null,
        table: spec.table,
        status: 'unverifiable',
        sourceCount: null,
        loadedCount: 0,
        targetCount: null,
        rulesCited: [],
        reason: `migration error: ${err instanceof Error ? err.message.slice(0, 300) : 'unknown'}`,
      });
    }
  }

  const rules = new Set<string>();
  for (const r of results) for (const id of r.rulesCited) rules.add(id);
  const loaded = results.filter((r) => r.status === 'loaded' || r.status === 'empty').length;
  const mismatched = results.filter((r) => r.status === 'reconciled_mismatch').length;
  const unverifiable = results.filter((r) => r.status === 'unverifiable').length;
  const rowsLoaded = results.reduce((n, r) => n + r.loadedCount, 0);
  const status: DataMigrationReportBody['summary']['status'] =
    results.length === 0
      ? 'empty'
      : mismatched > 0
        ? 'divergent'
        : unverifiable > 0
          ? 'unverifiable'
          : 'clean';

  return {
    pair_id: args.ruleset?.pair_id ?? null,
    ruleset_version: args.ruleset?.version ?? null,
    tables: results,
    summary: {
      tables: results.length,
      loaded,
      mismatched,
      unverifiable,
      rows_loaded: rowsLoaded,
      rules_cited: [...rules].sort(),
      status,
    },
  };
}
