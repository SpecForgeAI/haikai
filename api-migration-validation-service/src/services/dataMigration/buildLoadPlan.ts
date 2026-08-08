/**
 * Build a data-migration LoadPlan from the generated pack manifests (Spec Y).
 *
 * Inputs (parsed JSON, not file paths — the CLI reads the files):
 *   - the MAIN pack manifest, whose `expected_schema` carries per-column
 *     isGenerated / isIdentity flags and the primary-key columns;
 *   - the BULK-load manifest (`data/bulk-load-manifest.json`), whose
 *     `table_order` (FK-topological) and `expected_source_row_counts` order the
 *     load and anchor the count reconcile. Optional.
 *
 * Fail-soft: a malformed / missing main manifest yields an empty plan + an
 * issue note, never a throw.
 */
import { LoadPlan, TableLoadSpec } from './types';

/** Target types that are not usable in a deterministic order key. */
const UNORDERABLE_TYPE_FRAGMENTS = ['json', 'xml', 'image', 'text', 'binary', 'blob', 'bytea'];

function qn(schema: string, table: string): string {
  return `${schema}.${table}`;
}

interface RawColumn {
  schemaName?: string;
  tableName?: string;
  columnName?: string;
  dataType?: string;
  isIdentity?: boolean;
  isGenerated?: boolean;
  /** Target-only surrogate-PK column (2026-08-08) — never source-loadable. */
  isSurrogate?: boolean;
}
interface RawKeyIndex {
  schemaName?: string;
  tableName?: string;
  kind?: string;
  columns?: string[];
  /** Surrogate PK (2026-08-08) — never a load order key. */
  isSurrogate?: boolean;
}
interface RawTable {
  schemaName?: string;
  tableName?: string;
}

export function buildLoadPlan(mainManifest: unknown, bulkManifest?: unknown): LoadPlan {
  const issues: string[] = [];
  const es = (mainManifest as { expected_schema?: unknown } | null | undefined)?.expected_schema as
    | { tables?: RawTable[]; columns?: RawColumn[]; keysAndIndexes?: RawKeyIndex[] }
    | undefined;

  if (!es || !Array.isArray(es.columns) || !Array.isArray(es.tables)) {
    return {
      tables: [],
      issues: ['manifest has no expected_schema.columns/tables — cannot build a load plan'],
    };
  }
  const columns = es.columns;
  const tables = es.tables;
  const keys = Array.isArray(es.keysAndIndexes) ? es.keysAndIndexes : [];

  const bulk = bulkManifest as
    | { table_order?: string[]; expected_source_row_counts?: Record<string, number> }
    | undefined;
  const tableOrder = Array.isArray(bulk?.table_order) ? bulk!.table_order : null;
  const expectedCounts =
    bulk?.expected_source_row_counts && typeof bulk.expected_source_row_counts === 'object'
      ? bulk.expected_source_row_counts
      : {};

  const specs: TableLoadSpec[] = [];
  for (const t of tables) {
    const schema = t.schemaName ?? '';
    const table = t.tableName ?? '';
    if (!table) continue;
    // Surrogate-PK columns (2026-08-08) exist ONLY on the target — they must
    // never appear in insert lists, identity handling, or ordering, so drop
    // them from the working set entirely (the source SELECT would fail on
    // the missing column, and the identity is target-generated anyway).
    const cols = columns.filter(
      (c) => c.schemaName === schema && c.tableName === table && c.isSurrogate !== true,
    );
    if (cols.length === 0) {
      issues.push(`no columns for ${qn(schema, table)} — skipped`);
      continue;
    }
    const loadColumns = cols
      .filter((c) => c.isGenerated !== true)
      .map((c) => c.columnName ?? '')
      .filter((n) => n.length > 0);
    const identityColumns = cols
      .filter((c) => c.isIdentity === true)
      .map((c) => c.columnName ?? '')
      .filter((n) => n.length > 0);

    const pk = keys.find(
      (k) =>
        k.schemaName === schema &&
        k.tableName === table &&
        k.kind === 'primary_key' &&
        // A surrogate PK (2026-08-08) cannot order the SOURCE read — the
        // column does not exist there. The table falls back to the keyless
        // all-orderable-columns ordering below, exactly as before the
        // surrogate was added.
        k.isSurrogate !== true &&
        Array.isArray(k.columns) &&
        k.columns.length > 0,
    );
    let orderBy = pk?.columns ?? [];
    const orderKeyIsPrimaryKey = orderBy.length > 0;
    if (orderBy.length === 0) {
      orderBy = cols
        .filter(
          (c) => !UNORDERABLE_TYPE_FRAGMENTS.some((f) => (c.dataType ?? '').toLowerCase().includes(f)),
        )
        .map((c) => c.columnName ?? '')
        .filter((n) => n.length > 0);
    }

    const expected = expectedCounts[qn(schema, table)];
    specs.push({
      schema,
      table,
      orderBy,
      orderKeyIsPrimaryKey,
      loadColumns,
      identityColumns,
      expectedSourceRowCount: typeof expected === 'number' ? expected : null,
    });
  }

  // Honour the bulk manifest's FK-topological order when present.
  if (tableOrder) {
    const idx = new Map(tableOrder.map((name, i) => [name, i]));
    specs.sort(
      (a, b) =>
        (idx.get(qn(a.schema ?? '', a.table)) ?? Number.MAX_SAFE_INTEGER) -
        (idx.get(qn(b.schema ?? '', b.table)) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  return { tables: specs, issues };
}
