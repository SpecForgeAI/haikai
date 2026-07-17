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
}
interface RawKeyIndex {
  schemaName?: string;
  tableName?: string;
  kind?: string;
  columns?: string[];
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
    const cols = columns.filter((c) => c.schemaName === schema && c.tableName === table);
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
        Array.isArray(k.columns) &&
        k.columns.length > 0,
    );
    let orderBy = pk?.columns ?? [];
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
