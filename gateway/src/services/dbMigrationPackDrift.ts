/**
 * Expected-vs-actual schema verification diff (the DB drift report).
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack —
 * Task Group 5 (5.2 deterministic diff, 5.3 verify -> diff -> persisted
 * history).
 *
 * EXPECTED = the pack manifest's `expected_schema` JSON (emitted at
 * generation time by Task 2.5 — the gateway's own definition of "expected",
 * colocated here with the generation logic).
 * ACTUAL   = the verification-only scan snapshot from discovery-service
 * (Task 4.2), speaking the SAME `discovery-service/.../types.ts` shape
 * family (ColumnMetadata / KeyOrIndexMetadata / SequenceMetadata).
 *
 * Per-object classification vocabulary (spec verbatim):
 *   `match`    — present and structurally identical.
 *   `missing`  — expected, absent in the target.
 *   `mismatch` — present but differing; carries a structured detail list
 *                (property / expected / actual) covering column type,
 *                nullability, default, identity, generated flag, PK/unique/
 *                index composition + order + direction, FK referenced
 *                table/columns + referential actions.
 * Objects present in the target but not expected land in the INFORMATIONAL
 * `unexpected_in_target` section — never errors, never counted as mismatch.
 *
 * Re-runnable per area: a scope filter (schemas/tables) restricts the diff
 * and the persisted report records its `scan_scope_json`. Every verify run
 * APPENDS a `db_migration_pack_drift_reports` row (`source: 'in_tool'` — a
 * free string so a future external verification service can append per-area
 * runs without schema change; nothing else is built for it).
 *
 * NO LLM anywhere in this module — the diff is pure deterministic code.
 */

import { getConfig } from '../config';
import { logger } from './logger';
import {
  ExpectedSchema,
  ExpectedSchemaColumn,
  ExpectedSchemaKeyOrIndex,
} from './dbMigrationPack/types';

// ---------------------------------------------------------------------------
// Actual-snapshot wire shapes (the discovery-service `types.ts` vocabulary,
// mirrored field-for-field — the gateway cannot import across services)
// ---------------------------------------------------------------------------

export interface ActualTable {
  schemaName: string;
  tableName: string;
  objectType?: string;
}

export interface ActualColumn {
  schemaName: string;
  tableName: string;
  columnName: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey?: boolean;
  defaultExpression?: string | null;
  ordinalPosition?: number;
  maxLength?: number | null;
  scale?: number | null;
  precision?: number | null;
  isIdentity?: boolean;
  sequenceName?: string | null;
  collation?: string | null;
  isGenerated?: boolean;
  generationExpression?: string | null;
}

export interface ActualKeyOrIndex {
  schemaName: string;
  tableName: string;
  kind:
    | 'primary_key'
    | 'unique_constraint'
    | 'foreign_key'
    | 'index'
    | 'check_constraint';
  name: string;
  columns: string[];
  referencedSchema?: string | null;
  referencedTable?: string | null;
  referencedColumns?: string[] | null;
  onDelete?: string | null;
  onUpdate?: string | null;
  isUnique?: boolean;
  columnDirections?: string[] | null;
  isClustered?: boolean | null;
}

export interface ActualSchemaSnapshot {
  tables: ActualTable[];
  columns: ActualColumn[];
  keysAndIndexes: ActualKeyOrIndex[];
  sequences?: Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Report shapes (snake_case — persisted verbatim into `report_json`)
// ---------------------------------------------------------------------------

export type DriftClassification = 'match' | 'missing' | 'mismatch';

export type DriftObjectType =
  | 'table'
  | 'column'
  | 'primary_key'
  | 'unique_constraint'
  | 'foreign_key'
  | 'index';

export interface DriftDetail {
  property: string;
  expected: string | null;
  actual: string | null;
}

export interface DriftObjectEntry {
  object_type: DriftObjectType;
  object_ref: string;
  classification: DriftClassification;
  details?: DriftDetail[];
}

export interface UnexpectedObjectEntry {
  object_type: DriftObjectType;
  object_ref: string;
  detail: string | null;
}

export interface DriftScope {
  schemas?: string[] | null;
  tables?: string[] | null;
}

export interface DriftReport {
  classification_version: 1;
  objects: DriftObjectEntry[];
  /** Informational ONLY — never an error, never counted as mismatch. */
  unexpected_in_target: UnexpectedObjectEntry[];
  summary: {
    match_count: number;
    missing_count: number;
    mismatch_count: number;
    unexpected_count: number;
  };
}

// ---------------------------------------------------------------------------
// Normalization helpers (deterministic; tolerant of catalog-vs-DDL spelling)
// ---------------------------------------------------------------------------

/** information_schema long names -> the DDL short names the generator emits. */
const TYPE_ALIASES: Record<string, string> = {
  'character varying': 'varchar',
  character: 'char',
  'timestamp with time zone': 'timestamptz',
  'timestamp without time zone': 'timestamp',
  'time without time zone': 'time',
  'time with time zone': 'timetz',
  int4: 'integer',
  int8: 'bigint',
  int2: 'smallint',
  int: 'integer',
  bool: 'boolean',
  float8: 'double precision',
  float4: 'real',
  'double precision': 'double precision',
};

/**
 * Normalize a type for comparison: lowercase, alias-mapped base name plus
 * `(args)`. When the raw string carries no inline args, the catalog-reported
 * maxLength / precision / scale fill them in for the parameterized families
 * (varchar/char -> length, numeric/decimal -> precision,scale).
 */
export function normalizeTypeForDiff(
  raw: string | null | undefined,
  catalogFacts?: {
    maxLength?: number | null;
    precision?: number | null;
    scale?: number | null;
  }
): string {
  const text = (raw ?? '').trim().toLowerCase();
  const m = /^([a-z0-9_ ]+?)\s*(?:\(([^)]*)\))?$/.exec(text);
  let base = (m?.[1] ?? text).trim();
  let args = (m?.[2] ?? '').replace(/\s+/g, '');
  base = TYPE_ALIASES[base] ?? base;
  if (base === 'decimal') base = 'numeric';
  if (args === '' && catalogFacts) {
    if ((base === 'varchar' || base === 'char') && catalogFacts.maxLength != null) {
      args = String(catalogFacts.maxLength);
    } else if (
      base === 'numeric' &&
      catalogFacts.precision != null &&
      catalogFacts.scale != null
    ) {
      args = `${catalogFacts.precision},${catalogFacts.scale}`;
    }
  }
  return args ? `${base}(${args})` : base;
}

/**
 * Normalize a default expression: strip `::type` casts (Postgres decorates
 * stored defaults), collapse whitespace, lowercase. null/'' are equal.
 */
export function normalizeDefaultForDiff(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = raw
    .replace(/::[a-z_ ]+(\([^)]*\))?/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return text.length === 0 ? null : text;
}

/** FK action normalization: absent action means NO ACTION. */
function normalizeFkAction(raw: string | null | undefined): string {
  const text = (raw ?? '').trim().toUpperCase();
  return text.length === 0 ? 'NO ACTION' : text;
}

/** Direction normalization: absent / '' / ASC are all ascending. */
function normalizeDirections(
  columns: string[],
  directions: string[] | null | undefined
): string {
  return columns
    .map((_, i) => {
      const d = (directions?.[i] ?? '').trim().toUpperCase();
      return d === '' || d === 'ASC' ? 'ASC' : d;
    })
    .join(',');
}

function tableRef(schemaName: string, tableName: string): string {
  return `${schemaName}.${tableName}`;
}

function lc(s: string): string {
  return s.toLowerCase();
}

// ---------------------------------------------------------------------------
// Scope filter
// ---------------------------------------------------------------------------

function makeScopePredicate(
  scope: DriftScope | null | undefined
): (schemaName: string, tableName: string) => boolean {
  const schemas = (scope?.schemas ?? [])
    .filter((s) => typeof s === 'string' && s.length > 0)
    .map(lc);
  const tables = (scope?.tables ?? [])
    .filter((t) => typeof t === 'string' && t.length > 0)
    .map(lc);
  return (schemaName: string, tableName: string): boolean => {
    if (schemas.length > 0 && !schemas.includes(lc(schemaName))) return false;
    if (tables.length > 0) {
      const bare = lc(tableName);
      const qualified = lc(`${schemaName}.${tableName}`);
      if (!tables.includes(bare) && !tables.includes(qualified)) return false;
    }
    return true;
  };
}

// ---------------------------------------------------------------------------
// The deterministic diff (5.2)
// ---------------------------------------------------------------------------

export function diffExpectedVsActual(
  expected: ExpectedSchema,
  actual: ActualSchemaSnapshot,
  scope?: DriftScope | null
): DriftReport {
  const inScope = makeScopePredicate(scope);
  const objects: DriftObjectEntry[] = [];
  const unexpected: UnexpectedObjectEntry[] = [];

  const push = (
    objectType: DriftObjectType,
    objectRef: string,
    classification: DriftClassification,
    details?: DriftDetail[]
  ): void => {
    objects.push({
      object_type: objectType,
      object_ref: objectRef,
      classification,
      ...(details && details.length > 0 ? { details } : {}),
    });
  };

  // --- tables ---------------------------------------------------------------
  const expectedTables = expected.tables.filter((t) =>
    inScope(t.schemaName, t.tableName)
  );
  const expectedTableKeys = new Set(
    expectedTables.map((t) => lc(tableRef(t.schemaName, t.tableName)))
  );
  const actualTableKeys = new Set(
    actual.tables.map((t) => lc(tableRef(t.schemaName, t.tableName)))
  );

  for (const t of expectedTables) {
    const ref = tableRef(t.schemaName, t.tableName);
    push('table', ref, actualTableKeys.has(lc(ref)) ? 'match' : 'missing');
  }
  for (const t of actual.tables) {
    if (!inScope(t.schemaName, t.tableName)) continue;
    const ref = tableRef(t.schemaName, t.tableName);
    if (!expectedTableKeys.has(lc(ref))) {
      unexpected.push({
        object_type: 'table',
        object_ref: ref,
        detail: 'table exists in the target but is not part of the generated pack',
      });
    }
  }

  // --- columns ----------------------------------------------------------------
  const actualColumnsByKey = new Map<string, ActualColumn>();
  for (const c of actual.columns) {
    actualColumnsByKey.set(
      lc(`${c.schemaName}.${c.tableName}.${c.columnName}`),
      c
    );
  }
  const expectedColumnKeys = new Set<string>();

  for (const ec of expected.columns) {
    if (!inScope(ec.schemaName, ec.tableName)) continue;
    const ref = `${ec.schemaName}.${ec.tableName}.${ec.columnName}`;
    expectedColumnKeys.add(lc(ref));
    // A column on a missing table is reported once at table level; the
    // column rows still classify as missing so per-object counts are honest.
    const ac = actualColumnsByKey.get(lc(ref));
    if (!ac) {
      push('column', ref, 'missing');
      continue;
    }
    const details = diffColumn(ec, ac);
    push('column', ref, details.length === 0 ? 'match' : 'mismatch', details);
  }

  for (const ac of actual.columns) {
    if (!inScope(ac.schemaName, ac.tableName)) continue;
    const ref = `${ac.schemaName}.${ac.tableName}.${ac.columnName}`;
    const onExpectedTable = expectedTableKeys.has(
      lc(tableRef(ac.schemaName, ac.tableName))
    );
    if (onExpectedTable && !expectedColumnKeys.has(lc(ref))) {
      unexpected.push({
        object_type: 'column',
        object_ref: ref,
        detail: `column exists in the target but is not in the expected schema (type: ${ac.dataType})`,
      });
    }
  }

  // --- keys + indexes (PK / unique / FK / index) -----------------------------
  // check_constraint rows are excluded from the diff in v1: the expected
  // schema does not carry them (they live in the table changesets), so
  // diffing them would only produce noise.
  const diffableKinds = new Set([
    'primary_key',
    'unique_constraint',
    'foreign_key',
    'index',
  ]);

  const expectedKeys = expected.keysAndIndexes.filter(
    (k) => diffableKinds.has(k.kind) && inScope(k.schemaName, k.tableName)
  );
  const actualKeys = actual.keysAndIndexes.filter(
    (k) => diffableKinds.has(k.kind) && inScope(k.schemaName, k.tableName)
  );

  const actualKeyByName = new Map<string, ActualKeyOrIndex>();
  const actualKeyByComposition = new Map<string, ActualKeyOrIndex>();
  for (const k of actualKeys) {
    actualKeyByName.set(
      lc(`${k.kind}|${tableRef(k.schemaName, k.tableName)}|${k.name}`),
      k
    );
    actualKeyByComposition.set(
      lc(`${k.kind}|${tableRef(k.schemaName, k.tableName)}|${k.columns.join(',')}`),
      k
    );
  }

  const matchedActualKeys = new Set<ActualKeyOrIndex>();
  for (const ek of expectedKeys) {
    const tref = tableRef(ek.schemaName, ek.tableName);
    const ref = `${tref}.${ek.name}`;
    // Primary match by name; fallback by column composition (an engine may
    // rename a system-generated constraint).
    const ak =
      actualKeyByName.get(lc(`${ek.kind}|${tref}|${ek.name}`)) ??
      actualKeyByComposition.get(lc(`${ek.kind}|${tref}|${ek.columns.join(',')}`));
    if (!ak) {
      push(ek.kind as DriftObjectType, ref, 'missing');
      continue;
    }
    matchedActualKeys.add(ak);
    const details = diffKeyOrIndex(ek, ak);
    push(
      ek.kind as DriftObjectType,
      ref,
      details.length === 0 ? 'match' : 'mismatch',
      details
    );
  }

  for (const ak of actualKeys) {
    if (matchedActualKeys.has(ak)) continue;
    const tref = tableRef(ak.schemaName, ak.tableName);
    if (!expectedTableKeys.has(lc(tref))) continue; // table itself already reported
    unexpected.push({
      object_type: ak.kind as DriftObjectType,
      object_ref: `${tref}.${ak.name}`,
      detail: `${ak.kind} on (${ak.columns.join(', ')}) exists in the target but is not in the expected schema`,
    });
  }

  // --- summary ---------------------------------------------------------------
  const summary = {
    match_count: objects.filter((o) => o.classification === 'match').length,
    missing_count: objects.filter((o) => o.classification === 'missing').length,
    mismatch_count: objects.filter((o) => o.classification === 'mismatch').length,
    unexpected_count: unexpected.length,
  };

  return {
    classification_version: 1,
    objects,
    unexpected_in_target: unexpected,
    summary,
  };
}

function diffColumn(ec: ExpectedSchemaColumn, ac: ActualColumn): DriftDetail[] {
  const details: DriftDetail[] = [];

  const expectedType = normalizeTypeForDiff(ec.dataType);
  const actualType = normalizeTypeForDiff(ac.dataType, {
    maxLength: ac.maxLength,
    precision: ac.precision,
    scale: ac.scale,
  });
  // When the expected type is unparameterized, compare base names only.
  const expectedHasArgs = expectedType.includes('(');
  const comparableActual = expectedHasArgs
    ? actualType
    : actualType.replace(/\(.*\)$/, '');
  if (expectedType !== comparableActual) {
    details.push({ property: 'type', expected: expectedType, actual: actualType });
  }

  if (ec.isNullable !== ac.isNullable) {
    details.push({
      property: 'nullability',
      expected: ec.isNullable ? 'NULL' : 'NOT NULL',
      actual: ac.isNullable ? 'NULL' : 'NOT NULL',
    });
  }

  if (ec.isIdentity !== (ac.isIdentity === true)) {
    details.push({
      property: 'identity',
      expected: ec.isIdentity ? 'GENERATED ALWAYS AS IDENTITY' : 'not identity',
      actual: ac.isIdentity === true ? 'identity/serial' : 'not identity',
    });
  }

  if (ec.isGenerated !== (ac.isGenerated === true)) {
    details.push({
      property: 'generated',
      expected: ec.isGenerated ? `GENERATED ALWAYS AS (${ec.generationExpression ?? ''}) STORED` : 'plain column',
      actual: ac.isGenerated === true ? `generated (${ac.generationExpression ?? ''})` : 'plain column',
    });
  }

  // Defaults: identity columns carry engine-managed sequence defaults —
  // skip default comparison for them (the identity check above covers it).
  if (!ec.isIdentity && ac.isIdentity !== true) {
    const expectedDefault = normalizeDefaultForDiff(ec.defaultExpression);
    const actualDefault = normalizeDefaultForDiff(ac.defaultExpression);
    if (expectedDefault !== actualDefault) {
      details.push({
        property: 'default',
        expected: expectedDefault,
        actual: actualDefault,
      });
    }
  }

  return details;
}

function diffKeyOrIndex(
  ek: ExpectedSchemaKeyOrIndex,
  ak: ActualKeyOrIndex
): DriftDetail[] {
  const details: DriftDetail[] = [];

  const expectedCols = ek.columns.map(lc).join(',');
  const actualCols = ak.columns.map(lc).join(',');
  if (expectedCols !== actualCols) {
    details.push({
      property: 'columns',
      expected: ek.columns.join(', '),
      actual: ak.columns.join(', '),
    });
  }

  if (ek.kind === 'index' || ek.kind === 'unique_constraint') {
    if (ek.isUnique !== (ak.isUnique === true)) {
      details.push({
        property: 'unique',
        expected: ek.isUnique ? 'UNIQUE' : 'non-unique',
        actual: ak.isUnique === true ? 'UNIQUE' : 'non-unique',
      });
    }
  }

  if (ek.kind === 'index') {
    const expectedDirs = normalizeDirections(ek.columns, ek.columnDirections);
    const actualDirs = normalizeDirections(ak.columns, ak.columnDirections);
    if (expectedDirs !== actualDirs) {
      details.push({
        property: 'column_directions',
        expected: expectedDirs,
        actual: actualDirs,
      });
    }
  }

  if (ek.kind === 'foreign_key') {
    const expectedTarget = lc(`${ek.referencedSchema ?? ''}.${ek.referencedTable ?? ''}`);
    const actualTarget = lc(`${ak.referencedSchema ?? ''}.${ak.referencedTable ?? ''}`);
    if (expectedTarget !== actualTarget) {
      details.push({
        property: 'referenced_table',
        expected: `${ek.referencedSchema ?? ''}.${ek.referencedTable ?? ''}`,
        actual: `${ak.referencedSchema ?? ''}.${ak.referencedTable ?? ''}`,
      });
    }
    const expectedRefCols = (ek.referencedColumns ?? []).map(lc).join(',');
    const actualRefCols = (ak.referencedColumns ?? []).map(lc).join(',');
    if (expectedRefCols !== actualRefCols) {
      details.push({
        property: 'referenced_columns',
        expected: (ek.referencedColumns ?? []).join(', '),
        actual: (ak.referencedColumns ?? []).join(', '),
      });
    }
    if (normalizeFkAction(ek.onDelete) !== normalizeFkAction(ak.onDelete)) {
      details.push({
        property: 'on_delete',
        expected: normalizeFkAction(ek.onDelete),
        actual: normalizeFkAction(ak.onDelete),
      });
    }
    if (normalizeFkAction(ek.onUpdate) !== normalizeFkAction(ak.onUpdate)) {
      details.push({
        property: 'on_update',
        expected: normalizeFkAction(ek.onUpdate),
        actual: normalizeFkAction(ak.onUpdate),
      });
    }
  }

  return details;
}

// ---------------------------------------------------------------------------
// Verify orchestration: scan -> diff -> append drift-report row (5.3)
// ---------------------------------------------------------------------------

export class DriftAmsRoundTripError extends Error {
  public readonly status: number;
  public readonly body: string;
  constructor(status: number, body: string) {
    super(`AMS drift-report round-trip failed: HTTP ${status} ${body}`);
    this.name = 'DriftAmsRoundTripError';
    this.status = status;
    this.body = body;
  }
}

export interface VerifyConnection {
  host: string;
  port: number;
  databaseName: string;
  schemaName?: string | null;
  queryTimeoutSeconds?: number;
  username: string;
  /** Per-invocation only — passed through to discovery-service, never persisted. */
  password: string;
}

export interface PackDtoLike {
  id: string;
  architecture_id?: string;
  manifest_json?: { expected_schema?: ExpectedSchema } | null;
  [key: string]: unknown;
}

export interface PersistedDriftReportRow {
  id: string;
  pack_id: string;
  match_count: number | null;
  missing_count: number | null;
  mismatch_count: number | null;
  [key: string]: unknown;
}

export interface VerificationDeps {
  fetchPack?: (projectId: string, packId: string) => Promise<PackDtoLike>;
  scanTarget?: (
    connection: VerifyConnection,
    scope: DriftScope | null
  ) => Promise<ActualSchemaSnapshot>;
  appendDriftReport?: (
    projectId: string,
    packId: string,
    body: Record<string, unknown>
  ) => Promise<PersistedDriftReportRow>;
}

const defaultFetchPack: NonNullable<VerificationDeps['fetchPack']> = async (
  projectId,
  packId
) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/db-migration-packs/${encodeURIComponent(packId)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new DriftAmsRoundTripError(response.status, text);
  return JSON.parse(text) as PackDtoLike;
};

const defaultScanTarget: NonNullable<VerificationDeps['scanTarget']> = async (
  connection,
  scope
) => {
  const baseUrl = getConfig().discoveryServiceBaseUrl;
  const url = `${baseUrl}/discovery/db/verification-scan`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      host: connection.host,
      port: connection.port,
      databaseName: connection.databaseName,
      schemaName: connection.schemaName ?? null,
      queryTimeoutSeconds: connection.queryTimeoutSeconds,
      username: connection.username,
      password: connection.password,
      scope: scope ?? null,
    }),
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`Verification scan failed: HTTP ${response.status} ${text}`);
  }
  const parsed = JSON.parse(text) as { snapshot?: ActualSchemaSnapshot };
  if (!parsed.snapshot) {
    throw new Error('Verification scan returned no snapshot.');
  }
  return parsed.snapshot;
};

const defaultAppendDriftReport: NonNullable<VerificationDeps['appendDriftReport']> =
  async (projectId, packId, body) => {
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/db-migration-packs/${encodeURIComponent(packId)}/drift-reports`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text().catch(() => '');
    if (!response.ok) throw new DriftAmsRoundTripError(response.status, text);
    return JSON.parse(text) as PersistedDriftReportRow;
  };

export interface VerifyDbMigrationPackRequest {
  projectId: string;
  packId: string;
  connection: VerifyConnection;
  scope?: DriftScope | null;
}

export interface VerifyDbMigrationPackResult {
  report: DriftReport;
  persisted: PersistedDriftReportRow;
}

/**
 * The full verify flow: load the pack's expected schema, run the
 * verification-only scan against the target, compute the deterministic diff,
 * and APPEND one drift-report row to the pack's persisted history. History
 * is append-only — prior rows are never touched.
 */
export async function runDbMigrationPackVerification(
  request: VerifyDbMigrationPackRequest,
  deps: VerificationDeps = {}
): Promise<VerifyDbMigrationPackResult> {
  const fetchPack = deps.fetchPack ?? defaultFetchPack;
  const scanTarget = deps.scanTarget ?? defaultScanTarget;
  const appendDriftReport = deps.appendDriftReport ?? defaultAppendDriftReport;
  const { projectId, packId } = request;
  const scope = request.scope ?? null;

  logger.info(
    `[diag-gateway] db_migration_pack_verify stage=load_expected projectId=${projectId} packId=${packId}`
  );
  const pack = await fetchPack(projectId, packId);
  const expected = pack.manifest_json?.expected_schema;
  if (!expected) {
    throw new Error(
      `Pack ${packId} has no expected_schema in its manifest — generate the pack before verifying.`
    );
  }

  logger.info(
    `[diag-gateway] db_migration_pack_verify stage=scan projectId=${projectId} packId=${packId}`
  );
  const snapshot = await scanTarget(request.connection, scope);

  logger.info(
    `[diag-gateway] db_migration_pack_verify stage=diff projectId=${projectId} packId=${packId}`
  );
  const report = diffExpectedVsActual(expected, snapshot, scope);

  logger.info(
    `[diag-gateway] db_migration_pack_verify stage=persist projectId=${projectId} packId=${packId} ` +
      `match=${report.summary.match_count} missing=${report.summary.missing_count} mismatch=${report.summary.mismatch_count}`
  );
  const persisted = await appendDriftReport(projectId, packId, {
    scan_scope_json: scope,
    match_count: report.summary.match_count,
    missing_count: report.summary.missing_count,
    mismatch_count: report.summary.mismatch_count,
    report_json: report as unknown as Record<string, unknown>,
    source: 'in_tool',
  });

  return { report, persisted };
}
