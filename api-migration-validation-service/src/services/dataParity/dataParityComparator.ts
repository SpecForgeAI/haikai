/**
 * Data-parity comparator — Spec P of the Data-Tier Oracle Program
 * (agent-os/planning/2026-07-14-data-tier-oracle-program.md).
 *
 * GENERIC CORE: never names a database engine. Engine access goes through
 * the DbAdapter seam (pack code owns SQL construction + quoting + the
 * cross-engine NULLS-LOW ordering contract); equality semantics come from
 * the migration-pair RULESET (data, with citable rule ids). With no
 * applicable rules, comparison is strict — divergence tolerance is always
 * rule-cited, never silent.
 *
 * Escalation ladder per table:
 *   1. row COUNTS both sides — mismatch => divergent(count_mismatch);
 *   2. column-set intersection check — source columns missing on the target
 *      => divergent(column_set);
 *   3. ordered row comparison — FULL when the table fits under
 *      `fullScanMaxRows`, KEYED SAMPLE of `sampleRows` otherwise, cell by
 *      cell through the pair rules.
 *
 * Verdicts are ternary and depth-honest: match(full|sampled) |
 * divergent(class) | unverifiable(reason). The comparator NEVER throws — a
 * per-table failure becomes unverifiable(reason) and the run continues.
 *
 * Evidence discipline: divergence examples carry value excerpts CAPPED at
 * 80 chars and live only in the persisted report (like captured raw
 * bodies); trace predicates must carry counts + rule ids ONLY.
 */
import { DbAdapter, DbColumnMetadata } from '../db/DbAdapter';
import {
  MigrationPairRuleset,
  compareWithRules,
  rulesForColumnType,
} from '../../migrationPairRules';

export interface DataParityTableSpec {
  schema?: string | null;
  table: string;
  /** Explicit deterministic order key (e.g. the primary key). Optional. */
  orderBy?: string[];
}

export interface DataParityKnobs {
  /** Rows compared per side for tables above the full-scan threshold. */
  sampleRows: number;
  /** Tables at or under this row count are compared in full. */
  fullScanMaxRows: number;
  /** Per-query statement timeout (seconds). */
  timeoutSeconds: number;
}

export interface CellDivergenceExample {
  row_index: number;
  column: string;
  source_value: string;
  target_value: string;
  rule_ids: string[];
}

export interface TableParityResult {
  schema?: string | null;
  table: string;
  verdict: 'match' | 'divergent' | 'unverifiable';
  /** How deep the verification went — the honesty bound on `match`. */
  depth: 'none' | 'counts' | 'sampled' | 'full';
  divergence_class: 'count_mismatch' | 'column_set' | 'cell_values' | null;
  reason: string | null;
  source_count: number | null;
  target_count: number | null;
  rows_compared: number;
  cell_divergences: number;
  divergence_examples: CellDivergenceExample[];
  /** Pair rules whose strategies participated (tolerated divergences). */
  rules_cited: string[];
}

export interface DataParityReportBody {
  pair_id: string | null;
  ruleset_version: number | null;
  knobs: DataParityKnobs;
  tables: TableParityResult[];
  summary: {
    tables: number;
    match_full: number;
    match_sampled: number;
    divergent: number;
    unverifiable: number;
    rules_cited: string[];
    status: 'clean' | 'divergent' | 'unverifiable' | 'empty';
  };
}

const EXAMPLES_CAP = 20;
const VALUE_EXCERPT_CAP = 80;
/** Source types excluded from the DEFAULT order key (not totally orderable). */
const UNORDERABLE_TYPE_FRAGMENTS = ['json', 'xml', 'image', 'text', 'binary', 'blob'];

function excerpt(value: unknown): string {
  const s = value === null || value === undefined ? '∅' : String(value);
  return s.length > VALUE_EXCERPT_CAP ? `${s.slice(0, VALUE_EXCERPT_CAP)}…` : s;
}

function normalizeColumnKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Case-insensitive row-value lookup (engines case-fold result keys differently). */
function cellValue(row: Record<string, unknown>, column: string): unknown {
  if (column in row) return row[column];
  const wanted = normalizeColumnKey(column);
  for (const key of Object.keys(row)) {
    if (normalizeColumnKey(key) === wanted) return row[key];
  }
  return undefined;
}

function defaultOrderKey(columns: DbColumnMetadata[]): string[] {
  return columns
    .filter((c) => {
      const t = (c.dataType ?? '').toLowerCase();
      return !UNORDERABLE_TYPE_FRAGMENTS.some((frag) => t.includes(frag));
    })
    .map((c) => c.column);
}

async function compareOneTable(
  source: DbAdapter,
  target: DbAdapter,
  spec: DataParityTableSpec,
  ruleset: MigrationPairRuleset | null,
  knobs: DataParityKnobs,
): Promise<TableParityResult> {
  const base: TableParityResult = {
    schema: spec.schema ?? null,
    table: spec.table,
    verdict: 'unverifiable',
    depth: 'none',
    divergence_class: null,
    reason: null,
    source_count: null,
    target_count: null,
    rows_compared: 0,
    cell_divergences: 0,
    divergence_examples: [],
    rules_cited: [],
  };
  const countLimits = { maxRows: 5, timeoutSeconds: knobs.timeoutSeconds };

  // ---- Rung 1: counts ------------------------------------------------------
  const [sourceCount, targetCount] = await Promise.all([
    source.countRows({ schema: spec.schema, table: spec.table, limits: countLimits }),
    target.countRows({ schema: spec.schema, table: spec.table, limits: countLimits }),
  ]);
  base.source_count = sourceCount;
  base.target_count = targetCount;
  base.depth = 'counts';
  if (sourceCount !== targetCount) {
    return {
      ...base,
      verdict: 'divergent',
      divergence_class: 'count_mismatch',
      reason: `row counts differ: source=${sourceCount} target=${targetCount}`,
    };
  }
  if (sourceCount === 0) {
    return { ...base, verdict: 'match', depth: 'full' };
  }

  // ---- Rung 2: column sets -------------------------------------------------
  const allowlist = { tables: [spec.table], schemas: spec.schema ? [spec.schema] : null };
  const [sourceMeta, targetMeta] = await Promise.all([
    source.listMetadata(allowlist),
    target.listMetadata(allowlist),
  ]);
  const sourceColumns = sourceMeta.flatMap((t) => t.columns);
  const targetColumns = targetMeta.flatMap((t) => t.columns);
  if (sourceColumns.length === 0) {
    return { ...base, reason: 'source metadata returned no columns for this table' };
  }
  const targetColumnKeys = new Set(targetColumns.map((c) => normalizeColumnKey(c.column)));
  const missingOnTarget = sourceColumns
    .map((c) => c.column)
    .filter((c) => !targetColumnKeys.has(normalizeColumnKey(c)));
  if (missingOnTarget.length > 0) {
    return {
      ...base,
      verdict: 'divergent',
      divergence_class: 'column_set',
      reason: `source columns missing on target: ${missingOnTarget.slice(0, 10).join(', ')}` +
        (missingOnTarget.length > 10 ? ` (+${missingOnTarget.length - 10} more)` : ''),
    };
  }
  const comparedColumns = sourceColumns.map((c) => c.column);
  const sourceTypeByColumn = new Map(
    sourceColumns.map((c) => [normalizeColumnKey(c.column), c.dataType ?? '']),
  );

  // ---- Rung 3: ordered row comparison --------------------------------------
  const orderBy = spec.orderBy && spec.orderBy.length > 0
    ? spec.orderBy
    : defaultOrderKey(sourceColumns);
  if (orderBy.length === 0) {
    return {
      ...base,
      reason: 'no totally-orderable columns available for a deterministic order key',
    };
  }
  const full = sourceCount <= knobs.fullScanMaxRows;
  const maxRows = full ? sourceCount : knobs.sampleRows;
  const rowLimits = { maxRows, timeoutSeconds: knobs.timeoutSeconds };
  const [sourceRows, targetRows] = await Promise.all([
    source.fetchOrderedRows({ schema: spec.schema, table: spec.table, orderBy, limits: rowLimits }),
    target.fetchOrderedRows({ schema: spec.schema, table: spec.table, orderBy, limits: rowLimits }),
  ]);
  if (sourceRows.rows.length !== targetRows.rows.length) {
    return {
      ...base,
      reason: `equal counts but unequal fetched row sets ` +
        `(source=${sourceRows.rows.length} target=${targetRows.rows.length}) — fetch truncated?`,
    };
  }

  const rulesCited = new Set<string>();
  let cellDivergences = 0;
  const examples: CellDivergenceExample[] = [];
  for (let i = 0; i < sourceRows.rows.length; i++) {
    const sRow = sourceRows.rows[i];
    const tRow = targetRows.rows[i];
    for (const column of comparedColumns) {
      const sourceType = sourceTypeByColumn.get(normalizeColumnKey(column)) ?? '';
      const rules = ruleset ? rulesForColumnType(ruleset, sourceType) : [];
      const result = compareWithRules(cellValue(sRow, column), cellValue(tRow, column), rules);
      for (const id of result.appliedRuleIds) rulesCited.add(id);
      if (!result.equal) {
        cellDivergences++;
        if (examples.length < EXAMPLES_CAP) {
          examples.push({
            row_index: i,
            column,
            source_value: excerpt(cellValue(sRow, column)),
            target_value: excerpt(cellValue(tRow, column)),
            rule_ids: result.appliedRuleIds,
          });
        }
      }
    }
  }

  return {
    ...base,
    verdict: cellDivergences > 0 ? 'divergent' : 'match',
    depth: full ? 'full' : 'sampled',
    divergence_class: cellDivergences > 0 ? 'cell_values' : null,
    rows_compared: sourceRows.rows.length,
    cell_divergences: cellDivergences,
    divergence_examples: examples,
    rules_cited: [...rulesCited].sort(),
  };
}

/**
 * Compare every table in `tables` across the two adapters. NEVER throws — a
 * per-table failure yields unverifiable(reason).
 */
export async function runDataParityComparison(args: {
  source: DbAdapter;
  target: DbAdapter;
  tables: DataParityTableSpec[];
  ruleset: MigrationPairRuleset | null;
  knobs: DataParityKnobs;
}): Promise<DataParityReportBody> {
  const results: TableParityResult[] = [];
  for (const spec of args.tables) {
    try {
      results.push(
        await compareOneTable(args.source, args.target, spec, args.ruleset, args.knobs),
      );
    } catch (err) {
      results.push({
        schema: spec.schema ?? null,
        table: spec.table,
        verdict: 'unverifiable',
        depth: 'none',
        divergence_class: null,
        reason: `comparison error: ${err instanceof Error ? err.message.slice(0, 300) : 'unknown'}`,
        source_count: null,
        target_count: null,
        rows_compared: 0,
        cell_divergences: 0,
        divergence_examples: [],
        rules_cited: [],
      });
    }
  }

  const allRules = new Set<string>();
  for (const r of results) for (const id of r.rules_cited) allRules.add(id);
  const divergent = results.filter((r) => r.verdict === 'divergent').length;
  const unverifiable = results.filter((r) => r.verdict === 'unverifiable').length;
  const matchFull = results.filter((r) => r.verdict === 'match' && r.depth === 'full').length;
  const matchSampled = results.filter((r) => r.verdict === 'match' && r.depth === 'sampled').length;
  const status: DataParityReportBody['summary']['status'] =
    results.length === 0 ? 'empty'
      : divergent > 0 ? 'divergent'
        : unverifiable > 0 ? 'unverifiable'
          : 'clean';

  return {
    pair_id: args.ruleset?.pair_id ?? null,
    ruleset_version: args.ruleset?.version ?? null,
    knobs: args.knobs,
    tables: results,
    summary: {
      tables: results.length,
      match_full: matchFull,
      match_sampled: matchSampled,
      divergent,
      unverifiable,
      rules_cited: [...allRules].sort(),
      status,
    },
  };
}
