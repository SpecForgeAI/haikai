/**
 * Data-migration runner (Spec Y) — executes the pack's Phase-2 bulk load.
 *
 * Per table, in the plan's (FK-topological) order:
 *   1. count the source;
 *   2. empty => nothing to load; oversize (> readCap) => unverifiable (v1 does
 *      not stream large tables — it never loads partial data silently);
 *   3. read source column types + an ordered page of rows;
 *   4. forward-transform each row through the pair ruleset (rule-cited);
 *   5. write the rows via the TargetLoader;
 *   6. reconcile: post-load target count == source count.
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
  /** Max rows read + loaded per table in v1. Larger tables => unverifiable. */
  readCap: number;
  timeoutSeconds: number;
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
  if (sourceCount > knobs.readCap) {
    return {
      ...base,
      reason: `source has ${sourceCount} rows > read cap ${knobs.readCap}; large-table streaming is a v1 follow-up`,
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

  const read = await source.fetchOrderedRows({
    schema: spec.schema,
    table: spec.table,
    orderBy: spec.orderBy,
    limits: { maxRows: Math.max(1, knobs.readCap), timeoutSeconds: knobs.timeoutSeconds },
  });

  const rulesCited = new Set<string>();
  const tuples: unknown[][] = [];
  for (const row of read.rows) {
    const transformed = forwardTransformRow(row, columns, ruleset);
    for (const id of transformed.appliedRuleIds) rulesCited.add(id);
    tuples.push(transformed.values);
  }

  const loadedCount = await loader.loadTable(spec, tuples);
  const targetCount = await safeCount(target, spec, knobs.timeoutSeconds);
  const reconciled = targetCount === sourceCount && loadedCount === read.rows.length;

  return {
    ...base,
    status: reconciled ? 'loaded' : 'reconciled_mismatch',
    loadedCount,
    targetCount,
    rulesCited: [...rulesCited].sort(),
    reason: reconciled
      ? null
      : `post-load reconcile off: source=${sourceCount} loaded=${loadedCount} target=${targetCount ?? '?'}`,
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
