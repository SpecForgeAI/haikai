/**
 * PostgreSQL introspection queries.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 3.
 * Enriched: 2026-05-29 DB Structural Fidelity -- Task Group 2 (scale/precision
 * mapping, column default already wired, identity + sequence introspection,
 * check-constraint expression capture).
 * Enriched: 2026-05-30 Data-Layer Fidelity 2 -- column collation (Group B) +
 * computed/generated column flag & expression (Group E) + fuller procedure
 * capture (Group G: pg_get_functiondef / arguments / return type / volatility /
 * SECURITY DEFINER) + database-level collation carrier (Group B) + sequence
 * current value (Group C: pg_sequences.last_value) + database-resident
 * scheduled jobs / agents (Group F: pg_cron / pgAgent).
 *
 * Each function executes ONE catalog query through `PostgresAdapter.run
 * IntrospectionQuery`, which routes through the SQL guard + statement timeout
 * path. Schema/table filters are applied at the SQL level so the catalog
 * walk does not pull rows the caller will discard.
 *
 * Every query is SELECT-only and uses `information_schema` + `pg_catalog`
 * exclusively -- no `pg_class` mutations, no temp tables, no `EXECUTE`.
 */

import type {
  ColumnMetadata,
  DatabaseDiscoveryConfig,
  KeyOrIndexMetadata,
  ProcedureMetadata,
  ScheduledJobMetadata,
  SchemaMetadata,
  SequenceMetadata,
  TableMetadata,
  TriggerMetadata,
  ViewMetadata,
} from '../types';
import type { PostgresAdapter } from '../../db/PostgresAdapter';

/**
 * Resolve the schema filter for a query. Returns the list of schemas to
 * include (or `null` for "no filter"). Always strips the standard Postgres
 * internal schemas (`pg_catalog`, `information_schema`, `pg_toast`).
 */
function resolveSchemaFilter(
  config: DatabaseDiscoveryConfig,
): string[] | null {
  const include = (config.includeSchemas ?? []).filter(
    (s) => s && s.length > 0,
  );
  if (include.length > 0) return include;
  // No include list: caller will exclude system schemas in the SQL itself.
  if (config.schemaName && config.schemaName.length > 0) {
    return [config.schemaName];
  }
  return null;
}

/**
 * Resolve the exclude-schema set (always includes the standard system
 * schemas). Returns the full list for use as an SQL NOT IN filter.
 */
function resolveSchemaExclude(config: DatabaseDiscoveryConfig): string[] {
  const explicit = (config.excludeSchemas ?? []).filter(
    (s) => s && s.length > 0,
  );
  return Array.from(
    new Set([
      'pg_catalog',
      'information_schema',
      'pg_toast',
      ...explicit,
    ]),
  );
}

/**
 * Determine the per-query timeout. The pack's config carries
 * `queryTimeoutSeconds`; we use a smaller minimum (5s) when the config
 * carries a low value to avoid swallow-the-error-too-fast surprises.
 */
function resolveTimeoutSeconds(config: DatabaseDiscoveryConfig): number {
  return Math.max(5, Math.min(config.queryTimeoutSeconds || 30, 300));
}

/**
 * Map a Postgres `pg_proc.provolatile` single-char code to its verbatim
 * volatility keyword. Returns null for an unknown / absent code so the field
 * stays null rather than fabricating a value.
 */
export function mapPostgresVolatility(
  code: string | null | undefined,
): string | null {
  switch ((code ?? '').toLowerCase()) {
    case 'i':
      return 'IMMUTABLE';
    case 's':
      return 'STABLE';
    case 'v':
      return 'VOLATILE';
    default:
      return null;
  }
}

/**
 * Extract the sequence name from a Postgres column default of the
 * `nextval('schema.seq'::regclass)` / `nextval('seq'::regclass)` form. Returns
 * the bare (unqualified, unquoted) sequence name, or null when the default is
 * not a sequence default. This is the source for `ColumnMetadata.sequenceName`
 * + a serial column's implicit identity flag.
 */
export function extractSequenceFromDefault(
  defaultExpr: string | null | undefined,
): string | null {
  if (!defaultExpr) return null;
  const m = /nextval\(\s*'([^']+)'/i.exec(defaultExpr);
  if (!m || !m[1]) return null;
  // The captured token may be `schema.seq` or `"My Seq"` -- take the last
  // dotted segment and strip surrounding double quotes.
  const raw = m[1];
  const lastSegment = raw.split('.').pop() ?? raw;
  return lastSegment.replace(/^"|"$/g, '');
}

/**
 * Parse a Postgres `pg_indexes.indexdef` string into its structural-fidelity
 * parts (Oracle-W3). The canonical form is:
 *
 *   CREATE [UNIQUE] INDEX name ON schema.table USING method
 *     (col [ASC|DESC] [NULLS FIRST|LAST], ...) [WHERE predicate]
 *
 * All returned values are VERBATIM substrings of the def (no normalization):
 *   - `columns`           -- bare column / expression names (quotes stripped).
 *   - `columnDirections`  -- the trailing direction token per column
 *                           positionally aligned with `columns`, e.g.
 *                           `ASC` / `DESC NULLS FIRST` / '' when none stated.
 *   - `method`            -- the access method after `USING` (btree/gin/...).
 *   - `predicate`         -- the partial-index `WHERE ...` clause (sans WHERE).
 *   - `isUnique`          -- TRUE when the def says `UNIQUE`.
 *
 * Robust to a missing `USING` clause (older defs) by falling back to the first
 * parenthesised group after the table reference. Best-effort: when the column
 * list cannot be located the column arrays are empty and the caller still
 * captures the verbatim `definition` so nothing is silently discarded.
 */
export function parsePostgresIndexDef(def: string): {
  columns: string[];
  columnDirections: string[];
  method: string | null;
  predicate: string | null;
  isUnique: boolean;
} {
  const text = String(def ?? '');
  const isUnique = /\bUNIQUE\s+INDEX\b/i.test(text);

  // Access method: `USING <method>` (the token before the column `(`).
  const usingMatch = /\bUSING\s+([A-Za-z0-9_]+)/i.exec(text);
  const method = usingMatch && usingMatch[1] ? usingMatch[1] : null;

  // Partial-index predicate: everything after the FINAL top-level `WHERE`.
  let predicate: string | null = null;
  const whereMatch = /\)\s*WHERE\s+([\s\S]+)$/i.exec(text);
  if (whereMatch && whereMatch[1]) {
    predicate = whereMatch[1].trim();
  }

  // Column list: prefer the group right after `USING method`; else the first
  // `(...)` group. Strip the trailing predicate first so a WHERE clause that
  // contains parens does not confuse the matcher.
  let scanText = text;
  if (predicate !== null) {
    const idx = scanText.toUpperCase().lastIndexOf(') WHERE ');
    if (idx >= 0) scanText = scanText.slice(0, idx + 1);
  }
  let colGroup: string | null = null;
  if (usingMatch) {
    const after = scanText.slice(usingMatch.index + usingMatch[0].length);
    const m = /\(([\s\S]*)\)\s*$/.exec(after.trim());
    if (m && m[1] !== undefined) colGroup = m[1];
  }
  if (colGroup === null) {
    const m = /\(([\s\S]+)\)/.exec(scanText);
    if (m && m[1] !== undefined) colGroup = m[1];
  }

  const columns: string[] = [];
  const columnDirections: string[] = [];
  if (colGroup !== null) {
    // Split on top-level commas only (an expression index may contain nested
    // parens / commas, e.g. `lower((a || b))`).
    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of colGroup) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) {
        parts.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    parts.push(cur);
    for (const raw of parts) {
      const token = raw.trim();
      if (token.length === 0) continue;
      // Peel a trailing direction / nulls-ordering directive off the column.
      const dirMatch =
        /\s+((?:ASC|DESC)?(?:\s+NULLS\s+(?:FIRST|LAST))?)\s*$/i.exec(token);
      let colPart = token;
      let dir = '';
      if (dirMatch && dirMatch[1] && dirMatch[1].trim().length > 0) {
        dir = dirMatch[1].trim();
        colPart = token.slice(0, token.length - dirMatch[0].length).trim();
      }
      // Strip surrounding double quotes from a simple identifier.
      const bare = colPart.replace(/^"(.*)"$/, '$1');
      columns.push(bare);
      columnDirections.push(dir);
    }
  }

  return { columns, columnDirections, method, predicate, isUnique };
}

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

export async function introspectPostgresSchemas(
  adapter: PostgresAdapter,
  config: DatabaseDiscoveryConfig,
): Promise<SchemaMetadata[]> {
  const include = resolveSchemaFilter(config);
  const exclude = resolveSchemaExclude(config);
  const timeoutSec = resolveTimeoutSeconds(config);

  let sql: string;
  let params: unknown[];
  if (include) {
    sql = `
      SELECT schema_name, schema_owner
      FROM information_schema.schemata
      WHERE schema_name = ANY($1::text[])
        AND schema_name <> ALL($2::text[])
      ORDER BY schema_name
    `;
    params = [include, exclude];
  } else {
    sql = `
      SELECT schema_name, schema_owner
      FROM information_schema.schemata
      WHERE schema_name <> ALL($1::text[])
      ORDER BY schema_name
    `;
    params = [exclude];
  }
  const res = await adapter.runIntrospectionQuery(sql, params, timeoutSec);
  return res.rows.map((r) => ({
    schemaName: String(r.schema_name),
    owner: r.schema_owner ? String(r.schema_owner) : null,
  }));
}

// -----------------------------------------------------------------------------
// Database-level default collation (Spec 2026-05-30 Data-Layer Fidelity 2 -- B)
// -----------------------------------------------------------------------------

/**
 * Read the connected database's default collation (`pg_database.datcollate`)
 * VERBATIM. This is the DB-level collation carrier compared against per-column
 * collations to reason about the Sybase-CI -> Postgres-CS cross-engine hazard.
 * Returns null when the catalog row is unreadable / absent (best-effort; never
 * throws into the orchestrator -- the soft-fail wrapper handles a throw).
 */
export async function introspectPostgresDatabaseCollation(
  adapter: PostgresAdapter,
  config: DatabaseDiscoveryConfig,
): Promise<string | null> {
  const timeoutSec = resolveTimeoutSeconds(config);
  // current_database() scopes to the connected DB; datcollate is the verbatim
  // LC_COLLATE the database was created with.
  const sql = `
    SELECT d.datcollate AS db_collation
    FROM pg_catalog.pg_database d
    WHERE d.datname = current_database()
  `;
  const res = await adapter.runIntrospectionQuery(sql, [], timeoutSec);
  const row = res.rows[0];
  if (!row) return null;
  return row.db_collation !== null && row.db_collation !== undefined
    ? String(row.db_collation)
    : null;
}

// -----------------------------------------------------------------------------
// Tables (BASE TABLE only -- views are introspected separately)
// -----------------------------------------------------------------------------

export async function introspectPostgresTables(
  adapter: PostgresAdapter,
  config: DatabaseDiscoveryConfig,
): Promise<TableMetadata[]> {
  const include = resolveSchemaFilter(config);
  const exclude = resolveSchemaExclude(config);
  const timeoutSec = resolveTimeoutSeconds(config);

  // Use pg_catalog.pg_class for estimated row counts; join to
  // information_schema for the human-readable name + kind.
  // reltuples is a float; cast to bigint via :: for stability.
  const params: unknown[] = [];
  let schemaClause: string;
  if (include) {
    params.push(include);
    schemaClause = `n.nspname = ANY($${params.length}::text[])`;
  } else {
    params.push(exclude);
    schemaClause = `n.nspname <> ALL($${params.length}::text[])`;
  }

  // Apply include/exclude table filters at SQL level when present.
  const includeTables = (config.includeTables ?? []).filter(
    (t) => t && t.length > 0,
  );
  const excludeTables = (config.excludeTables ?? []).filter(
    (t) => t && t.length > 0,
  );
  let tableClause = '';
  if (includeTables.length > 0) {
    params.push(includeTables);
    tableClause += ` AND c.relname = ANY($${params.length}::text[])`;
  }
  if (excludeTables.length > 0) {
    params.push(excludeTables);
    tableClause += ` AND c.relname <> ALL($${params.length}::text[])`;
  }

  const sql = `
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      c.relkind AS rel_kind,
      c.reltuples::bigint AS est_rows,
      obj_description(c.oid, 'pg_class') AS comment
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND ${schemaClause}
      ${tableClause}
    ORDER BY n.nspname, c.relname
  `;
  const res = await adapter.runIntrospectionQuery(sql, params, timeoutSec);
  return res.rows.map((r) => ({
    schemaName: String(r.schema_name),
    tableName: String(r.table_name),
    objectType: 'table' as const,
    estimatedRowCount:
      r.est_rows === null || r.est_rows === undefined
        ? null
        : Number(r.est_rows),
    comment: r.comment ? String(r.comment) : null,
  }));
}

// -----------------------------------------------------------------------------
// Columns
// -----------------------------------------------------------------------------

export async function introspectPostgresColumns(
  adapter: PostgresAdapter,
  config: DatabaseDiscoveryConfig,
): Promise<ColumnMetadata[]> {
  const include = resolveSchemaFilter(config);
  const exclude = resolveSchemaExclude(config);
  const timeoutSec = resolveTimeoutSeconds(config);

  const params: unknown[] = [];
  let schemaClause: string;
  if (include) {
    params.push(include);
    schemaClause = `c.table_schema = ANY($${params.length}::text[])`;
  } else {
    params.push(exclude);
    schemaClause = `c.table_schema <> ALL($${params.length}::text[])`;
  }

  const includeTables = (config.includeTables ?? []).filter(
    (t) => t && t.length > 0,
  );
  const excludeTables = (config.excludeTables ?? []).filter(
    (t) => t && t.length > 0,
  );
  let tableClause = '';
  if (includeTables.length > 0) {
    params.push(includeTables);
    tableClause += ` AND c.table_name = ANY($${params.length}::text[])`;
  }
  if (excludeTables.length > 0) {
    params.push(excludeTables);
    tableClause += ` AND c.table_name <> ALL($${params.length}::text[])`;
  }

  // `is_identity` (YES/NO) exposes a column declared GENERATED ... AS IDENTITY.
  // A serial column (no is_identity) is detected via its nextval(...) default.
  //
  // Spec 2026-05-30 Data-Layer Fidelity 2 additive columns (all from the
  // standard information_schema.columns view, PG 12+ for generation):
  //   - collation_name        (Group B) -- per-column collation, VERBATIM.
  //   - is_generated          (Group E) -- 'ALWAYS' for a GENERATED column,
  //                            'NEVER' otherwise.
  //   - generation_expression (Group E) -- the VERBATIM generation expression.
  const sql = `
    SELECT
      c.table_schema   AS schema_name,
      c.table_name     AS table_name,
      c.column_name    AS column_name,
      c.data_type      AS data_type,
      c.is_nullable    AS is_nullable,
      c.column_default AS column_default,
      c.ordinal_position AS ordinal_position,
      c.character_maximum_length AS char_max_length,
      c.numeric_precision        AS num_precision,
      c.numeric_scale            AS num_scale,
      c.is_identity              AS is_identity,
      c.collation_name           AS collation_name,
      c.is_generated             AS is_generated,
      c.generation_expression    AS generation_expression
    FROM information_schema.columns c
    WHERE ${schemaClause}
      ${tableClause}
    ORDER BY c.table_schema, c.table_name, c.ordinal_position
  `;
  const res = await adapter.runIntrospectionQuery(sql, params, timeoutSec);
  return res.rows.map((r) => {
    const defaultExpression = r.column_default ? String(r.column_default) : null;
    const sequenceName = extractSequenceFromDefault(defaultExpression);
    const declaredIdentity =
      typeof r.is_identity === 'string'
        ? r.is_identity.toUpperCase() === 'YES'
        : r.is_identity === true;
    // Serial columns are not flagged `is_identity` but ARE auto-increment:
    // their default is a sequence nextval(...).
    const isIdentity = declaredIdentity || sequenceName !== null;
    const precision =
      r.num_precision !== null && r.num_precision !== undefined
        ? Number(r.num_precision)
        : null;
    const scale =
      r.num_scale !== null && r.num_scale !== undefined
        ? Number(r.num_scale)
        : null;
    // Group B: per-column collation VERBATIM (null when the column uses the DB
    // default collation -- information_schema reports collation_name only for a
    // collatable type with an explicit/derived collation).
    const collation =
      r.collation_name !== null && r.collation_name !== undefined
        ? String(r.collation_name)
        : null;
    // Group E: a generated column reports is_generated='ALWAYS'. The expression
    // is captured VERBATIM (null for a plain writable column).
    const isGenerated =
      typeof r.is_generated === 'string'
        ? r.is_generated.toUpperCase() === 'ALWAYS'
        : r.is_generated === true;
    const generationExpression =
      r.generation_expression !== null && r.generation_expression !== undefined
        ? String(r.generation_expression)
        : null;
    return {
      schemaName: String(r.schema_name),
      tableName: String(r.table_name),
      columnName: String(r.column_name),
      dataType: String(r.data_type),
      isNullable: String(r.is_nullable).toUpperCase() === 'YES',
      defaultExpression,
      ordinalPosition: Number(r.ordinal_position),
      // Preserve the existing maxLength fallback: char length, else precision.
      maxLength:
        r.char_max_length !== null && r.char_max_length !== undefined
          ? Number(r.char_max_length)
          : precision !== null
          ? precision
          : null,
      // Structural-fidelity fields (Spec 2026-05-29): map the previously
      // SELECTed-then-discarded numeric_scale / numeric_precision through.
      scale,
      precision,
      isIdentity,
      sequenceName,
      // Data-Layer Fidelity 2 (Spec 2026-05-30): collation (B) +
      // generated-column flag/expression (E), verbatim.
      collation,
      isGenerated,
      generationExpression,
    };
  });
}

// -----------------------------------------------------------------------------
// Keys + indexes (PKs, unique constraints, FKs, regular indexes)
// -----------------------------------------------------------------------------

export async function introspectPostgresKeysAndIndexes(
  adapter: PostgresAdapter,
  config: DatabaseDiscoveryConfig,
): Promise<KeyOrIndexMetadata[]> {
  const include = resolveSchemaFilter(config);
  const exclude = resolveSchemaExclude(config);
  const timeoutSec = resolveTimeoutSeconds(config);

  // ----- Primary keys + unique constraints + foreign keys via
  // information_schema.table_constraints + key_column_usage + (for FKs)
  // referential_constraints. -----
  const params: unknown[] = [];
  let schemaClause: string;
  if (include) {
    params.push(include);
    schemaClause = `tc.table_schema = ANY($${params.length}::text[])`;
  } else {
    params.push(exclude);
    schemaClause = `tc.table_schema <> ALL($${params.length}::text[])`;
  }

  const constraintSql = `
    SELECT
      tc.table_schema   AS schema_name,
      tc.table_name     AS table_name,
      tc.constraint_name AS constraint_name,
      tc.constraint_type AS constraint_type,
      kcu.column_name   AS column_name,
      kcu.ordinal_position AS ord,
      ccu.table_schema  AS ref_schema,
      ccu.table_name    AS ref_table,
      ccu.column_name   AS ref_column,
      rc.update_rule    AS update_rule,
      rc.delete_rule    AS delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_schema = kcu.constraint_schema
     AND tc.constraint_name   = kcu.constraint_name
    LEFT JOIN information_schema.referential_constraints rc
      ON tc.constraint_schema = rc.constraint_schema
     AND tc.constraint_name   = rc.constraint_name
    LEFT JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_schema = ccu.constraint_schema
     AND rc.unique_constraint_name   = ccu.constraint_name
    WHERE ${schemaClause}
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY', 'CHECK')
    ORDER BY tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position
  `;
  const constraintRes = await adapter.runIntrospectionQuery(
    constraintSql,
    params,
    timeoutSec,
  );

  // ----- Check-constraint expressions (Spec 2026-05-29): the table_constraints
  // walk above lists CHECK constraints but key_column_usage carries no row for
  // them, so they never form a bucket. Pull the expression separately and
  // emit a check_constraint bucket per (schema, table, name). -----
  const checkParams: unknown[] = [];
  let checkSchemaClause: string;
  if (include) {
    checkParams.push(include);
    checkSchemaClause = `tc.table_schema = ANY($${checkParams.length}::text[])`;
  } else {
    checkParams.push(exclude);
    checkSchemaClause = `tc.table_schema <> ALL($${checkParams.length}::text[])`;
  }
  const checkSql = `
    SELECT
      tc.table_schema     AS schema_name,
      tc.table_name       AS table_name,
      tc.constraint_name  AS constraint_name,
      cc.check_clause     AS check_clause
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc
      ON tc.constraint_schema = cc.constraint_schema
     AND tc.constraint_name   = cc.constraint_name
    WHERE ${checkSchemaClause}
      AND tc.constraint_type = 'CHECK'
      AND tc.constraint_name NOT LIKE '%_not_null'
    ORDER BY tc.table_schema, tc.table_name, tc.constraint_name
  `;
  const checkRes = await adapter.runIntrospectionQuery(
    checkSql,
    checkParams,
    timeoutSec,
  );

  // Group by (schema, table, constraint_name) and assemble.
  type Bucket = {
    schemaName: string;
    tableName: string;
    name: string;
    kind: KeyOrIndexMetadata['kind'];
    columns: string[];
    referencedSchema?: string | null;
    referencedTable?: string | null;
    referencedColumns?: string[] | null;
    onDelete?: string | null;
    onUpdate?: string | null;
    checkExpression?: string | null;
  };
  const buckets = new Map<string, Bucket>();
  for (const r of constraintRes.rows) {
    const key = `${r.schema_name}|${r.table_name}|${r.constraint_name}`;
    let kind: KeyOrIndexMetadata['kind'];
    switch (String(r.constraint_type)) {
      case 'PRIMARY KEY':
        kind = 'primary_key';
        break;
      case 'UNIQUE':
        kind = 'unique_constraint';
        break;
      case 'FOREIGN KEY':
        kind = 'foreign_key';
        break;
      case 'CHECK':
        kind = 'check_constraint';
        break;
      default:
        continue;
    }
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        schemaName: String(r.schema_name),
        tableName: String(r.table_name),
        name: String(r.constraint_name),
        kind,
        columns: [],
        referencedSchema: r.ref_schema ? String(r.ref_schema) : null,
        referencedTable: r.ref_table ? String(r.ref_table) : null,
        referencedColumns: r.ref_column ? [] : null,
        // Oracle-W3: verbatim FK referential actions (CASCADE / SET NULL /
        // NO ACTION / RESTRICT / SET DEFAULT). NULL for non-FK constraint kinds.
        onDelete:
          kind === 'foreign_key' && r.delete_rule
            ? String(r.delete_rule)
            : null,
        onUpdate:
          kind === 'foreign_key' && r.update_rule
            ? String(r.update_rule)
            : null,
      };
      buckets.set(key, bucket);
    }
    if (r.column_name) bucket.columns.push(String(r.column_name));
    if (kind === 'foreign_key' && r.ref_column) {
      if (!bucket.referencedColumns) bucket.referencedColumns = [];
      bucket.referencedColumns.push(String(r.ref_column));
    }
  }

  // Fold check-constraint expressions in (own bucket; no columns).
  for (const r of checkRes.rows) {
    const key = `${r.schema_name}|${r.table_name}|${r.constraint_name}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        schemaName: String(r.schema_name),
        tableName: String(r.table_name),
        name: String(r.constraint_name),
        kind: 'check_constraint',
        columns: [],
        referencedSchema: null,
        referencedTable: null,
        referencedColumns: null,
      };
      buckets.set(key, bucket);
    }
    bucket.checkExpression = r.check_clause ? String(r.check_clause) : null;
  }

  // ----- Regular indexes via pg_catalog.pg_indexes (skip those that back a
  // constraint -- pg_catalog already exposes constraint-backed indexes via
  // their constraint name, captured above). -----
  const indexParams: unknown[] = [];
  let indexSchemaClause: string;
  if (include) {
    indexParams.push(include);
    indexSchemaClause = `i.schemaname = ANY($${indexParams.length}::text[])`;
  } else {
    indexParams.push(exclude);
    indexSchemaClause = `i.schemaname <> ALL($${indexParams.length}::text[])`;
  }
  const indexSql = `
    SELECT
      i.schemaname AS schema_name,
      i.tablename  AS table_name,
      i.indexname  AS index_name,
      i.indexdef   AS index_def
    FROM pg_catalog.pg_indexes i
    WHERE ${indexSchemaClause}
      AND i.indexname NOT IN (
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE constraint_type IN ('PRIMARY KEY', 'UNIQUE')
      )
    ORDER BY i.schemaname, i.tablename, i.indexname
  `;
  const indexRes = await adapter.runIntrospectionQuery(
    indexSql,
    indexParams,
    timeoutSec,
  );

  const result: KeyOrIndexMetadata[] = [];
  for (const b of buckets.values()) {
    result.push({
      schemaName: b.schemaName,
      tableName: b.tableName,
      kind: b.kind,
      name: b.name,
      columns: b.columns,
      referencedSchema: b.referencedSchema ?? null,
      referencedTable: b.referencedTable ?? null,
      referencedColumns: b.referencedColumns ?? null,
      onDelete: b.onDelete ?? null,
      onUpdate: b.onUpdate ?? null,
      isUnique: b.kind === 'unique_constraint' || b.kind === 'primary_key',
      checkExpression: b.checkExpression ?? null,
    });
  }
  for (const r of indexRes.rows) {
    // Oracle-W3: parse the verbatim `indexdef` for method / per-column
    // ordering / partial predicate (previously only a loose column list was
    // kept and the rest discarded). The raw def is also captured verbatim so
    // nothing is silently dropped.
    const def = String(r.index_def ?? '');
    const parsed = parsePostgresIndexDef(def);
    const isClustered =
      r.is_clustered === true ||
      (typeof r.is_clustered === 'string' &&
        r.is_clustered.toLowerCase() === 't');
    result.push({
      schemaName: String(r.schema_name),
      tableName: String(r.table_name),
      kind: 'index',
      name: String(r.index_name),
      columns: parsed.columns,
      isUnique: parsed.isUnique,
      referencedSchema: null,
      referencedTable: null,
      referencedColumns: null,
      onDelete: null,
      onUpdate: null,
      checkExpression: null,
      // Oracle-W3 additive index ordering / clustering / predicate fields.
      indexDefinition: def.length > 0 ? def : null,
      indexMethod: parsed.method,
      isClustered,
      indexPredicate: parsed.predicate,
      columnDirections:
        parsed.columnDirections.some((d) => d.length > 0)
          ? parsed.columnDirections
          : null,
    });
  }
  return result;
}

// -----------------------------------------------------------------------------
// Views
// -----------------------------------------------------------------------------

export async function introspectPostgresViews(
  adapter: PostgresAdapter,
  config: DatabaseDiscoveryConfig,
): Promise<ViewMetadata[]> {
  const include = resolveSchemaFilter(config);
  const exclude = resolveSchemaExclude(config);
  const timeoutSec = resolveTimeoutSeconds(config);

  const params: unknown[] = [];
  let schemaClause: string;
  if (include) {
    params.push(include);
    schemaClause = `schemaname = ANY($${params.length}::text[])`;
  } else {
    params.push(exclude);
    schemaClause = `schemaname <> ALL($${params.length}::text[])`;
  }

  // Standard views + materialized views (two separate catalog tables).
  const sql = `
    SELECT schemaname AS schema_name, viewname AS view_name,
           definition AS definition, false AS is_materialized
    FROM pg_catalog.pg_views
    WHERE ${schemaClause}
    UNION ALL
    SELECT schemaname AS schema_name, matviewname AS view_name,
           definition AS definition, true AS is_materialized
    FROM pg_catalog.pg_matviews
    WHERE ${schemaClause}
    ORDER BY schema_name, view_name
  `;
  const res = await adapter.runIntrospectionQuery(sql, params, timeoutSec);
  return res.rows.map((r) => ({
    schemaName: String(r.schema_name),
    viewName: String(r.view_name),
    definition: r.definition ? String(r.definition) : '',
    isMaterialized: Boolean(r.is_materialized),
  }));
}

// -----------------------------------------------------------------------------
// Sequences (Spec 2026-05-29 DB Structural Fidelity -- Task Group 2)
// -----------------------------------------------------------------------------

/**
 * Introspect sequences via `information_schema.sequences`. The owned-by
 * (table.column) linkage is best-effort via `pg_depend` -> `pg_class` /
 * `pg_attribute`; a sequence with no owning column reports null. The result
 * feeds the Group B `sequence_definition` finding AND lets the column mapper
 * confirm a serial column's sequence is real.
 *
 * Spec 2026-05-30 Data-Layer Fidelity 2 (Group C): the sequence's CURRENT value
 * (`last_value`) is read VERBATIM from `pg_catalog.pg_sequences` (PG 10+) and
 * carried onto `currentValue`. This is the allocation high-water mark -- what
 * `currval()` would return -- and is the input to the cutover-hazard Finding
 * (recreating the sequence at its START rather than this value would collide
 * the first post-cutover INSERT with existing PKs). `pg_sequences.last_value`
 * is NULL for a sequence never advanced; we map that through as null (the
 * finding then reasons from `startValue`). LEFT JOIN keeps the row even when
 * the connected role cannot read `pg_sequences` for a particular sequence.
 */
export async function introspectPostgresSequences(
  adapter: PostgresAdapter,
  config: DatabaseDiscoveryConfig,
): Promise<SequenceMetadata[]> {
  const include = resolveSchemaFilter(config);
  const exclude = resolveSchemaExclude(config);
  const timeoutSec = resolveTimeoutSeconds(config);

  const params: unknown[] = [];
  let schemaClause: string;
  if (include) {
    params.push(include);
    schemaClause = `s.sequence_schema = ANY($${params.length}::text[])`;
  } else {
    params.push(exclude);
    schemaClause = `s.sequence_schema <> ALL($${params.length}::text[])`;
  }

  // pg_depend links a sequence (objid -> pg_class of relkind 'S') to its
  // owning table column (refobjid -> pg_class, refobjsubid -> pg_attribute).
  // pg_sequences (PG 10+) carries the runtime last_value (the current
  // high-water mark) -- joined by schema + name.
  const sql = `
    SELECT
      s.sequence_schema AS schema_name,
      s.sequence_name   AS sequence_name,
      s.data_type       AS data_type,
      s.start_value     AS start_value,
      s.increment       AS increment,
      s.minimum_value   AS min_value,
      s.maximum_value   AS max_value,
      s.cycle_option    AS cycle_option,
      pgs.last_value    AS last_value,
      owner_tbl.relname AS owned_by_table,
      owner_col.attname AS owned_by_column
    FROM information_schema.sequences s
    LEFT JOIN pg_catalog.pg_sequences pgs
      ON pgs.schemaname = s.sequence_schema AND pgs.sequencename = s.sequence_name
    LEFT JOIN pg_catalog.pg_class seq_cls
      ON seq_cls.relname = s.sequence_name
    LEFT JOIN pg_catalog.pg_namespace seq_ns
      ON seq_ns.oid = seq_cls.relnamespace AND seq_ns.nspname = s.sequence_schema
    LEFT JOIN pg_catalog.pg_depend dep
      ON dep.objid = seq_cls.oid AND dep.deptype = 'a'
    LEFT JOIN pg_catalog.pg_class owner_tbl
      ON owner_tbl.oid = dep.refobjid
    LEFT JOIN pg_catalog.pg_attribute owner_col
      ON owner_col.attrelid = dep.refobjid AND owner_col.attnum = dep.refobjsubid
    WHERE ${schemaClause}
    ORDER BY s.sequence_schema, s.sequence_name
  `;
  const res = await adapter.runIntrospectionQuery(sql, params, timeoutSec);
  return res.rows.map((r) => ({
    schemaName: String(r.schema_name),
    sequenceName: String(r.sequence_name),
    dataType: r.data_type ? String(r.data_type) : null,
    startValue: r.start_value !== null && r.start_value !== undefined ? String(r.start_value) : null,
    increment: r.increment !== null && r.increment !== undefined ? String(r.increment) : null,
    minValue: r.min_value !== null && r.min_value !== undefined ? String(r.min_value) : null,
    maxValue: r.max_value !== null && r.max_value !== undefined ? String(r.max_value) : null,
    cycle:
      typeof r.cycle_option === 'string'
        ? r.cycle_option.toUpperCase() === 'YES'
        : Boolean(r.cycle_option),
    // Group C: the sequence's current allocation high-water mark (VERBATIM, as
    // a string so a large bigint is never lossily coerced). null when the
    // sequence has never been advanced / pg_sequences row is unreadable.
    currentValue:
      r.last_value !== null && r.last_value !== undefined
        ? String(r.last_value)
        : null,
    ownedByTable: r.owned_by_table ? String(r.owned_by_table) : null,
    ownedByColumn: r.owned_by_column ? String(r.owned_by_column) : null,
    definition: null,
  }));
}

// -----------------------------------------------------------------------------
// Database-resident scheduled jobs / agents
// (Spec 2026-05-30 Data-Layer Fidelity 2 -- Group F)
// -----------------------------------------------------------------------------

/**
 * Introspect database-resident scheduled jobs / agents. PostgreSQL core ships
 * NO built-in scheduler; the two common in-database mechanisms are the `pg_cron`
 * extension (`cron.job`) and `pgAgent` (`pgagent.pga_job`). Both live in their
 * own schema only when the extension is installed, so we probe for the table
 * via `to_regclass(...)` FIRST and only SELECT the rows when the relation
 * exists -- a database without the extension simply returns no jobs (and no
 * error). Everything captured is VERBATIM (schedule expression + command).
 *
 * This is procedural REALITY -> it feeds a Finding (via
 * `emitUnsupportedFeatureFindings`), never a new architecture entity type.
 *
 * Best-effort: any probe that fails is swallowed by the orchestrator's
 * per-step soft-fail wrapper (this is one introspection step). Two independent
 * SELECTs (pg_cron, pgAgent) keep a missing-one from masking the other.
 */
export async function introspectPostgresScheduledJobs(
  adapter: PostgresAdapter,
  config: DatabaseDiscoveryConfig,
): Promise<ScheduledJobMetadata[]> {
  const timeoutSec = resolveTimeoutSeconds(config);
  const out: ScheduledJobMetadata[] = [];

  // --- pg_cron (cron.job): jobname / schedule / command / active. The
  // to_regclass guard returns NULL (no rows) when the extension is absent, so
  // the SELECT body only runs against a real relation. ---
  const cronSql = `
    SELECT j.jobname AS job_name, j.schedule AS schedule,
           j.command AS command, j.active AS active
    FROM cron.job j
    WHERE to_regclass('cron.job') IS NOT NULL
    ORDER BY j.jobname
  `;
  const cronRes = await adapter.runIntrospectionQuery(cronSql, [], timeoutSec);
  for (const r of cronRes.rows) {
    out.push({
      schemaName: 'cron',
      jobName: r.job_name !== null && r.job_name !== undefined ? String(r.job_name) : '',
      scheduler: 'pg_cron',
      schedule:
        r.schedule !== null && r.schedule !== undefined ? String(r.schedule) : null,
      command:
        r.command !== null && r.command !== undefined ? String(r.command) : null,
      enabled: r.active === true || r.active === 't',
    });
  }

  // --- pgAgent (pgagent.pga_job): jobname / jobenabled. The schedule + step
  // command live in child tables (pga_schedule / pga_jobstep); v1 captures the
  // job header VERBATIM and TODO(oracle-W3)s the per-step command join. ---
  const pgaSql = `
    SELECT j.jobname AS job_name, j.jobenabled AS job_enabled
    FROM pgagent.pga_job j
    WHERE to_regclass('pgagent.pga_job') IS NOT NULL
    ORDER BY j.jobname
  `;
  const pgaRes = await adapter.runIntrospectionQuery(pgaSql, [], timeoutSec);
  for (const r of pgaRes.rows) {
    out.push({
      schemaName: 'pgagent',
      jobName: r.job_name !== null && r.job_name !== undefined ? String(r.job_name) : '',
      scheduler: 'pgagent',
      // TODO(oracle-W3): join pgagent.pga_schedule (jscdesc / cron-style
      // bitmaps) + pgagent.pga_jobstep (jstcode) to capture the schedule
      // expression + step command verbatim. The job header is captured today.
      schedule: null,
      command: null,
      enabled: r.job_enabled === true || r.job_enabled === 't',
    });
  }

  return out;
}

// -----------------------------------------------------------------------------
// Stored procedures + functions
// -----------------------------------------------------------------------------

export async function introspectPostgresProcedures(
  adapter: PostgresAdapter,
  config: DatabaseDiscoveryConfig,
): Promise<ProcedureMetadata[]> {
  const include = resolveSchemaFilter(config);
  const exclude = resolveSchemaExclude(config);
  const timeoutSec = resolveTimeoutSeconds(config);

  const params: unknown[] = [];
  let schemaClause: string;
  if (include) {
    params.push(include);
    schemaClause = `n.nspname = ANY($${params.length}::text[])`;
  } else {
    params.push(exclude);
    schemaClause = `n.nspname <> ALL($${params.length}::text[])`;
  }

  // pg_proc.prokind: 'f' = function, 'p' = procedure, 'a' = aggregate,
  // 'w' = window. We capture functions + procedures only.
  // pg_language.lanname is the language ('sql', 'plpgsql', etc.).
  //
  // Spec 2026-05-30 Data-Layer Fidelity 2 (Group G) fuller capture, ALONGSIDE
  // the existing `p.prosrc AS proc_src` body (KEPT for the existing
  // stored_procedure_logic Finding):
  //   - pg_get_functiondef(p.oid)        -- the FULL recreatable CREATE envelope
  //   - pg_get_function_arguments(p.oid) -- the argument signature (overloads)
  //   - pg_get_function_result(p.oid)    -- the return type
  //   - p.provolatile                    -- volatility (i/s/v)
  //   - p.prosecdef                      -- SECURITY DEFINER flag
  // pg_get_functiondef raises for aggregates/window fns; we already filter to
  // prokind IN ('f','p'), and a procedure ('p') is also supported by
  // pg_get_functiondef on modern PG.
  const sql = `
    SELECT
      n.nspname        AS schema_name,
      p.proname        AS proc_name,
      p.prokind        AS prokind,
      l.lanname        AS lang_name,
      p.prosrc         AS proc_src,
      pg_get_functiondef(p.oid)        AS full_definition,
      pg_get_function_arguments(p.oid) AS proc_arguments,
      pg_get_function_result(p.oid)    AS proc_result,
      p.provolatile    AS provolatile,
      p.prosecdef      AS prosecdef
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language l  ON l.oid = p.prolang
    WHERE ${schemaClause}
      AND p.prokind IN ('f', 'p')
    ORDER BY n.nspname, p.proname
  `;
  const res = await adapter.runIntrospectionQuery(sql, params, timeoutSec);
  return res.rows.map((r) => ({
    schemaName: String(r.schema_name),
    procedureName: String(r.proc_name),
    routineKind: String(r.prokind) === 'p' ? ('procedure' as const) : ('function' as const),
    body: r.proc_src ? String(r.proc_src) : '',
    language: r.lang_name ? String(r.lang_name) : null,
    // Group G fuller capture (verbatim; null when the helper returned nothing).
    fullDefinition:
      r.full_definition !== null && r.full_definition !== undefined
        ? String(r.full_definition)
        : null,
    arguments:
      r.proc_arguments !== null && r.proc_arguments !== undefined
        ? String(r.proc_arguments)
        : null,
    returnType:
      r.proc_result !== null && r.proc_result !== undefined
        ? String(r.proc_result)
        : null,
    volatility: mapPostgresVolatility(
      typeof r.provolatile === 'string' ? r.provolatile : null,
    ),
    securityDefiner: r.prosecdef === true || r.prosecdef === 't',
  }));
}

// -----------------------------------------------------------------------------
// Triggers
// -----------------------------------------------------------------------------

export async function introspectPostgresTriggers(
  adapter: PostgresAdapter,
  config: DatabaseDiscoveryConfig,
): Promise<TriggerMetadata[]> {
  const include = resolveSchemaFilter(config);
  const exclude = resolveSchemaExclude(config);
  const timeoutSec = resolveTimeoutSeconds(config);

  const params: unknown[] = [];
  let schemaClause: string;
  if (include) {
    params.push(include);
    schemaClause = `t.trigger_schema = ANY($${params.length}::text[])`;
  } else {
    params.push(exclude);
    schemaClause = `t.trigger_schema <> ALL($${params.length}::text[])`;
  }

  // information_schema.triggers exposes one row per (trigger, event) so a
  // trigger that fires on INSERT/UPDATE shows up twice. We group below.
  const sql = `
    SELECT
      t.trigger_schema       AS schema_name,
      t.trigger_name         AS trigger_name,
      t.event_object_schema  AS table_schema,
      t.event_object_table   AS table_name,
      t.event_manipulation   AS event,
      t.action_timing        AS timing,
      t.action_statement     AS action_statement
    FROM information_schema.triggers t
    WHERE ${schemaClause}
    ORDER BY t.trigger_schema, t.trigger_name
  `;
  const res = await adapter.runIntrospectionQuery(sql, params, timeoutSec);

  type Bucket = {
    schemaName: string;
    triggerName: string;
    tableSchema: string;
    tableName: string;
    timing: TriggerMetadata['timing'];
    events: Set<TriggerMetadata['events'][number]>;
    actionStatement: string;
  };
  const buckets = new Map<string, Bucket>();
  for (const r of res.rows) {
    const key = `${r.schema_name}|${r.trigger_name}`;
    let bucket = buckets.get(key);
    const timingRaw = String(r.timing ?? '').toUpperCase();
    const timing: TriggerMetadata['timing'] =
      timingRaw === 'BEFORE'
        ? 'before'
        : timingRaw === 'INSTEAD OF'
        ? 'instead_of'
        : 'after';
    if (!bucket) {
      bucket = {
        schemaName: String(r.schema_name),
        triggerName: String(r.trigger_name),
        tableSchema: String(r.table_schema),
        tableName: String(r.table_name),
        timing,
        events: new Set(),
        actionStatement: r.action_statement ? String(r.action_statement) : '',
      };
      buckets.set(key, bucket);
    }
    const eventRaw = String(r.event ?? '').toLowerCase();
    if (
      eventRaw === 'insert' ||
      eventRaw === 'update' ||
      eventRaw === 'delete' ||
      eventRaw === 'truncate'
    ) {
      bucket.events.add(eventRaw);
    }
  }
  return Array.from(buckets.values()).map((b) => ({
    schemaName: b.schemaName,
    triggerName: b.triggerName,
    tableSchema: b.tableSchema,
    tableName: b.tableName,
    timing: b.timing,
    events: Array.from(b.events),
    actionStatement: b.actionStatement,
  }));
}

// -----------------------------------------------------------------------------
// Verification-only actual-schema snapshot
// (Spec 2026-06-11 DB Schema + Data Migration Pack -- Task 4.2)
// -----------------------------------------------------------------------------

/**
 * Run the structural introspection walk against the TARGET Postgres database
 * in VERIFICATION-ONLY mode and return the normalized actual-schema snapshot.
 *
 * The mode flag is explicit (`options.mode === 'verification_only'`) so a
 * future caller can never reach this path by accident: it reuses the exact
 * introspection queries above (schemas/tables/columns/keys+indexes/sequences)
 * but WRITES NOTHING to the model -- no candidates, no findings, no
 * discovery-run rows. The caller (a narrow `routes/database.ts` endpoint)
 * returns the snapshot to the gateway, which diffs it against the migration
 * pack's expected-schema JSON.
 *
 * Scope: the standard `includeSchemas` / `includeTables` config filters apply
 * at the SQL level, so a per-area re-verification only walks the requested
 * schemas/tables.
 */
export async function introspectPostgresActualSchema(
  adapter: PostgresAdapter,
  config: DatabaseDiscoveryConfig,
  options: { mode: 'verification_only' },
): Promise<import('../types').ActualSchemaSnapshot> {
  if (options.mode !== 'verification_only') {
    throw new Error(
      `introspectPostgresActualSchema: unsupported mode '${String(
        (options as { mode?: string }).mode,
      )}' -- only 'verification_only' exists.`,
    );
  }
  const [schemas, tables, columns, keysAndIndexes, sequences] =
    await Promise.all([
      introspectPostgresSchemas(adapter, config),
      introspectPostgresTables(adapter, config),
      introspectPostgresColumns(adapter, config),
      introspectPostgresKeysAndIndexes(adapter, config),
      introspectPostgresSequences(adapter, config),
    ]);
  return {
    scanMode: 'verification_only',
    engine: 'postgres',
    schemas,
    tables,
    columns,
    keysAndIndexes,
    sequences,
  };
}
