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
import { DbAdapter, DbColumnMetadata, MAX_SINGLE_FETCH_ROWS } from '../db/DbAdapter';
import {
  MigrationPairRuleset,
  canonicalize,
  compareWithRules,
  rulesForColumnType,
} from '../../migrationPairRules';

export interface DataParityTableSpec {
  schema?: string | null;
  table: string;
  /** Explicit deterministic order key (e.g. the primary key). Optional. */
  orderBy?: string[];
  /**
   * TRUE when `orderBy` is a UNIQUE key (the primary key) — rows are then
   * compared by KEYED JOIN, never positional zip (2026-08-07): the engines
   * disagree on string/datetime collation order, so index-zipping two
   * differently-ordered fetches misaligned one row and counted essentially
   * every cell divergent (the live filter_tag 26,508-divergence artifact).
   */
  keyIsUnique?: boolean;
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
  divergence_class: 'count_mismatch' | 'column_set' | 'cell_values' | 'row_set' | null;
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
    status: 'clean' | 'clean_sampled' | 'divergent' | 'unverifiable' | 'empty';
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

  // ---- Rung 3: row comparison ----------------------------------------------
  // KEYED JOIN when a unique key is declared (2026-08-07); canonical-sorted
  // multiset comparison for keyless tables under the full-scan bound; honest
  // unverifiable above it. Positional index-zipping across two engines'
  // fetch orders is GONE — Sybase's binary-ish collation and Postgres's
  // locale collation disagree on string/datetime order, so a one-row shift
  // counted essentially every cell divergent (the live filter_tag /
  // ghr_entity artifact: equal counts, 26,508 false cell divergences).
  const rulesFor = (column: string) => {
    const sourceType = sourceTypeByColumn.get(normalizeColumnKey(column)) ?? '';
    return ruleset ? rulesForColumnType(ruleset, sourceType) : [];
  };
  const canonicalCell = (row: Record<string, unknown>, column: string): string => {
    let v: unknown = cellValue(row, column) ?? null;
    for (const rule of rulesFor(column)) {
      if (rule.comparison) v = canonicalize(v, rule.comparison);
    }
    if (v === null || v === undefined) return ' ';
    return `${typeof v}:${String(v)}`;
  };

  const keyed = spec.keyIsUnique === true && (spec.orderBy?.length ?? 0) > 0;
  const orderBy = spec.orderBy && spec.orderBy.length > 0
    ? spec.orderBy
    : defaultOrderKey(sourceColumns);
  if (orderBy.length === 0) {
    return {
      ...base,
      reason: 'no totally-orderable columns available for a deterministic order key',
    };
  }
  // The full-scan bound is CLAMPED to the adapter seam's single-fetch cap
  // (2026-08-07): the comparator fetches each side in ONE call, so a
  // full_scan_max_rows above the cap would silently compare a clipped fetch
  // as if it were the whole table.
  const fullBound = Math.min(knobs.fullScanMaxRows, MAX_SINGLE_FETCH_ROWS);
  const full = sourceCount <= fullBound;
  if (!keyed && !full) {
    // A keyless positional sample across two collations is noise, not
    // verification — depth-honest refusal naming the fix.
    return {
      ...base,
      reason:
        `table has no unique comparison key and exceeds the full-scan bound ` +
        `(${sourceCount} > ${fullBound}; single-fetch cap ${MAX_SINGLE_FETCH_ROWS}) — keyed ` +
        `comparison needs a primary key; add/propose one (PK gap proposals) or raise full_scan_max_rows`,
    };
  }
  const maxRows = full ? sourceCount : Math.min(knobs.sampleRows, MAX_SINGLE_FETCH_ROWS);
  const rowLimits = { maxRows, timeoutSeconds: knobs.timeoutSeconds };
  // KEY-ANCHORED sampling (2026-08-11): at sampled depth, fetching "first N
  // by key" from each side independently only intersects when both engines
  // order identically — they don't (collation + datetime rendering), so the
  // live 13-table shape was near-zero overlap "compared". When the target
  // adapter can fetch BY KEYS, anchor its fetch on the source's sampled key
  // tuples: the intersection is the sample by construction, and a sampled
  // source key with NO target row is genuine row-set evidence.
  const anchored =
    keyed && !full && typeof target.fetchRowsByKeys === 'function';
  const sourceRows = await source.fetchOrderedRows({
    schema: spec.schema, table: spec.table, orderBy, limits: rowLimits,
  });
  const targetRows = anchored
    ? await target.fetchRowsByKeys!({
        schema: spec.schema,
        table: spec.table,
        keyColumns: orderBy,
        keys: sourceRows.rows.map((r) => orderBy.map((c) => cellValue(r, c) ?? null)),
        limits: rowLimits,
      })
    : await target.fetchOrderedRows({
        schema: spec.schema, table: spec.table, orderBy, limits: rowLimits,
      });
  if (full && (sourceRows.truncated || targetRows.truncated)) {
    // FULL depth promised the whole table in one fetch; a truncation flag
    // here means more rows exist than the count claimed (source drifted
    // mid-comparison) or the fetch was clipped — comparing the partial set
    // as "full" would under-report divergence (gold standard 2026-08-07).
    // At SAMPLED depth truncation is the expected shape of a deliberate
    // partial fetch and the depth label already carries the honesty.
    return {
      ...base,
      reason:
        `full-depth fetch came back truncated ` +
        `(source truncated=${!!sourceRows.truncated}, target truncated=${!!targetRows.truncated}) — ` +
        `the table changed under the comparison or the fetch was clipped; a partial fetch ` +
        `cannot verify the table at full depth`,
    };
  }

  const rulesCited = new Set<string>();
  let cellDivergences = 0;
  const examples: CellDivergenceExample[] = [];
  const compareCells = (
    sRow: Record<string, unknown>,
    tRow: Record<string, unknown>,
    rowIndex: number,
  ): void => {
    for (const column of comparedColumns) {
      const result = compareWithRules(cellValue(sRow, column), cellValue(tRow, column), rulesFor(column));
      for (const id of result.appliedRuleIds) rulesCited.add(id);
      if (!result.equal) {
        cellDivergences++;
        if (examples.length < EXAMPLES_CAP) {
          examples.push({
            row_index: rowIndex,
            column,
            source_value: excerpt(cellValue(sRow, column)),
            target_value: excerpt(cellValue(tRow, column)),
            rule_ids: result.appliedRuleIds,
          });
        }
      }
    }
  };

  if (keyed) {
    // ---- keyed join: rows correspond by KEY VALUES, never by position ------
    const keyOf = (row: Record<string, unknown>): string =>
      JSON.stringify(orderBy.map((c) => canonicalCell(row, c)));
    const targetByKey = new Map<string, Record<string, unknown>>();
    for (const row of targetRows.rows) targetByKey.set(keyOf(row), row);

    const sourceOnly: string[] = [];
    let rowsCompared = 0;
    for (const sRow of sourceRows.rows) {
      const k = keyOf(sRow);
      const tRow = targetByKey.get(k);
      if (tRow === undefined) {
        sourceOnly.push(excerpt(orderBy.map((c) => cellValue(sRow, c) ?? '∅').join('|')));
        continue;
      }
      targetByKey.delete(k);
      compareCells(sRow, tRow, rowsCompared);
      rowsCompared++;
    }
    const targetOnlyCount = targetByKey.size;

    // At FULL depth an unmatched key is real row-set divergence; at SAMPLED
    // depth the two first-N pages can legitimately cover different key ranges
    // — exclusive keys are a sampling note, never a divergence.
    if (full && (sourceOnly.length > 0 || targetOnlyCount > 0)) {
      return {
        ...base,
        verdict: 'divergent',
        divergence_class: 'row_set',
        depth: 'full',
        rows_compared: rowsCompared,
        cell_divergences: cellDivergences,
        divergence_examples: examples,
        rules_cited: [...rulesCited].sort(),
        reason:
          `key sets differ: ${sourceOnly.length} key(s) only on source, ${targetOnlyCount} only ` +
          `on target (e.g. ${sourceOnly.slice(0, 5).join(', ') || 'target-only keys'})`,
      };
    }
    // ANCHORED sampled depth: a sampled source key with no target row is
    // genuine row-set divergence (the target was asked for exactly those
    // keys), never page drift (2026-08-11).
    if (anchored && sourceOnly.length > 0) {
      return {
        ...base,
        verdict: 'divergent',
        divergence_class: 'row_set',
        depth: 'sampled',
        rows_compared: rowsCompared,
        cell_divergences: cellDivergences,
        divergence_examples: examples,
        rules_cited: [...rulesCited].sort(),
        reason:
          `${sourceOnly.length} of ${sourceRows.rows.length} sampled source key(s) have no ` +
          `target row (key-anchored fetch; e.g. ${sourceOnly.slice(0, 5).join(', ')})`,
      };
    }
    // A comparison that compared NOTHING can never claim match (2026-08-11 —
    // the live false-`match` defect: zero shared keys between two
    // independently-fetched pages meant zero cells compared, and
    // `cellDivergences > 0 ? … : 'match'` verified nothing as verified).
    if (rowsCompared === 0 && sourceRows.rows.length > 0) {
      return {
        ...base,
        depth: full ? 'full' : 'sampled',
        rows_compared: 0,
        cell_divergences: 0,
        reason:
          `the sampled pages shared no keys — nothing was actually compared ` +
          `(${sourceOnly.length} source-only / ${targetOnlyCount} target-only); a 0-row ` +
          `intersection is unverifiable, never a match`,
      };
    }
    return {
      ...base,
      verdict: cellDivergences > 0 ? 'divergent' : 'match',
      depth: full ? 'full' : 'sampled',
      divergence_class: cellDivergences > 0 ? 'cell_values' : null,
      rows_compared: rowsCompared,
      cell_divergences: cellDivergences,
      divergence_examples: examples,
      rules_cited: [...rulesCited].sort(),
      reason:
        !full && (sourceOnly.length > 0 || targetOnlyCount > 0)
          ? `sampled pages covered partly different key ranges (${sourceOnly.length}/${targetOnlyCount} ` +
            `exclusive keys skipped) — compared the ${rowsCompared}-row intersection`
          : null,
    };
  }

  // ---- keyless full scan: canonical-sorted multiset comparison -------------
  // Both row sets are re-sorted in JS by their rule-canonicalized cell
  // projections, so the engines' collation orders are irrelevant — identical
  // multisets align row-for-row regardless of fetch order.
  if (sourceRows.rows.length !== targetRows.rows.length) {
    return {
      ...base,
      reason: `equal counts but unequal fetched row sets ` +
        `(source=${sourceRows.rows.length} target=${targetRows.rows.length}) — fetch truncated?`,
    };
  }
  const projection = (row: Record<string, unknown>): string =>
    JSON.stringify(comparedColumns.map((c) => canonicalCell(row, c)));
  const byProjection = (a: Record<string, unknown>, b: Record<string, unknown>): number =>
    projection(a) < projection(b) ? -1 : projection(a) > projection(b) ? 1 : 0;
  const sortedSource = [...sourceRows.rows].sort(byProjection);
  const sortedTarget = [...targetRows.rows].sort(byProjection);
  for (let i = 0; i < sortedSource.length; i++) {
    compareCells(sortedSource[i], sortedTarget[i], i);
  }

  return {
    ...base,
    verdict: cellDivergences > 0 ? 'divergent' : 'match',
    depth: 'full',
    divergence_class: cellDivergences > 0 ? 'cell_values' : null,
    rows_compared: sortedSource.length,
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
  // clean_sampled (gold standard 2026-08-07): a run whose only verification
  // depth for some tables was a SAMPLE is not the same claim as full-depth
  // clean — the status now says so; the gate passes it with the depth note
  // and the FE shows it distinctly.
  const status: DataParityReportBody['summary']['status'] =
    results.length === 0 ? 'empty'
      : divergent > 0 ? 'divergent'
        : unverifiable > 0 ? 'unverifiable'
          : matchSampled > 0 ? 'clean_sampled'
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
