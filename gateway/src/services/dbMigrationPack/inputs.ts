/**
 * Input snapshot + source-schema IR for the DB migration pack generator.
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack — Task 2.2.
 *
 * Pipeline stages 1-2:
 *   1. Fetch ALL mandatory inputs — the committed AMS physical model
 *      (`physical_data_entities` incl. `constraints_metadata`,
 *      `physical_data_attributes`, relationship `fk_columns`), persisted
 *      discovery findings, captured `db.*` decisions, resolved pack
 *      decisions — and canonically serialize them to the SHA-256
 *      `input_snapshot_hash` (also the Group 4 staleness comparator:
 *      ONE hash implementation, defined here).
 *   2. Merge findings into the IR by object identity BEFORE translation —
 *      collation hazards, computed-column generation expressions, sequence
 *      high-water marks, and non-portable defaults exist ONLY in findings
 *      (see discovery's `databasePackFindingBuilders.ts`); they never reach
 *      committed attributes.
 *
 * Engine gate: Sybase ASE -> PostgreSQL is the ONLY supported pair in v1 —
 * any other combination is rejected (target engine read from the `db.engine`
 * captured decision).
 *
 * NO LLM — pure deterministic code.
 */

import * as crypto from 'crypto';
import { getConfig } from '../../config';
import { logger } from '../logger';
import {
  fetchActiveTargetArchitectureId,
  fetchLatestCapturedDecisions,
  TargetStateCapturedDecision,
} from '../targetStateCapturedDecisionsClient';
import {
  IrColumn,
  IrDbDecision,
  IrForeignKey,
  IrSequence,
  IrTable,
  IrUntranslatedObject,
  SourceSchemaIr,
  StructuralAccounting,
  UnsupportedEnginePairError,
} from './types';

// ---------------------------------------------------------------------------
// Raw wire shapes (AMS snake_case wire; relationship ids camel per the DTO)
// ---------------------------------------------------------------------------

export interface RawPhysicalEntity {
  id: string;
  name: string;
  description?: string | null;
  physical_type?: string | null;
  database?: string | null;
  tags?: string | null;
  constraints_metadata?: Record<string, unknown> | null;
}

export interface RawPhysicalAttribute {
  id: string;
  name: string;
  physical_entity_id: string;
  data_type?: string | null;
  is_primary_key?: boolean | null;
  is_nullable?: boolean | null;
  source_type?: string | null;
  scale?: number | null;
  precision?: number | null;
  column_default?: string | null;
  ordinal?: number | null;
  is_identity?: boolean | null;
}

export interface RawDataEntityPoint {
  id: string;
  point_kind?: string | null;
  logical_entity_id?: string | null;
  physical_entity_id?: string | null;
}

export interface RawDataEntityRelationship {
  id: string;
  fromDataEntityPointId?: string | null;
  toDataEntityPointId?: string | null;
  relationship?: string | null;
  fk_columns?: {
    join_columns?: string[];
    referenced_columns?: string[];
    on_delete?: string | null;
    on_update?: string | null;
  } | null;
}

/** The slice of the committed architecture model the generator consumes. */
export interface CommittedPhysicalModel {
  physicalDataEntities: RawPhysicalEntity[];
  physicalDataAttributes: RawPhysicalAttribute[];
  dataEntityPoints: RawDataEntityPoint[];
  dataEntityRelationships: RawDataEntityRelationship[];
}

/** Persisted discovery finding (AMS snake_case wire). */
export interface RawDiscoveryFinding {
  id: string;
  finding_type: string;
  category?: string | null;
  severity?: string | null;
  title?: string | null;
  summary?: string | null;
  detail_json?: Record<string, unknown> | null;
  source?: string | null;
}

/** Resolved pack decision (AMS snake_case wire, status === 'resolved'). */
export interface RawResolvedPackDecision {
  decision_key: string;
  resolution_json: Record<string, unknown> | null;
  status: string;
}

export interface GenerationInputs {
  model: CommittedPhysicalModel;
  findings: RawDiscoveryFinding[];
  dbDecisions: IrDbDecision[];
  resolvedPackDecisions: RawResolvedPackDecision[];
}

// ---------------------------------------------------------------------------
// Dependency seams (production defaults below; tests inject)
// ---------------------------------------------------------------------------

export interface InputFetchDeps {
  fetchModel: (projectId: string, architectureId: string) => Promise<CommittedPhysicalModel>;
  fetchFindings: (projectId: string, architectureId: string) => Promise<RawDiscoveryFinding[]>;
  /**
   * `targetArchitectureId` binds the `db.*` decision read to the target the
   * pack is generated FOR (Spec 2026-07-02-a). The migration plan can target a
   * saved DRAFT that is not the project's "active" target — decisions live on
   * whatever target the user answered the conversation in, so reading from
   * "active" hid them (same bug class as the 2026-06-27 context fix). Absent
   * (legacy callers) → fall back to the active target.
   */
  fetchDbDecisions: (
    projectId: string,
    targetArchitectureId?: string | null
  ) => Promise<IrDbDecision[]>;
  fetchResolvedPackDecisions: (
    projectId: string,
    architectureId: string
  ) => Promise<RawResolvedPackDecision[]>;
}

export async function fetchGenerationInputs(
  projectId: string,
  architectureId: string,
  deps: InputFetchDeps,
  targetArchitectureId?: string | null
): Promise<GenerationInputs> {
  const [model, findings, dbDecisions, resolvedPackDecisions] = await Promise.all([
    deps.fetchModel(projectId, architectureId),
    deps.fetchFindings(projectId, architectureId),
    deps.fetchDbDecisions(projectId, targetArchitectureId),
    deps.fetchResolvedPackDecisions(projectId, architectureId),
  ]);
  return { model, findings, dbDecisions, resolvedPackDecisions };
}

// ---------------------------------------------------------------------------
// Canonical serialization + SHA-256 snapshot hash (shared with Group 4)
// ---------------------------------------------------------------------------

/** Recursively sort object keys so serialization is order-independent. */
export function canonicalSerialize(value: unknown): string {
  return JSON.stringify(sortValue(value));

  function sortValue(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(sortValue);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = sortValue((v as Record<string, unknown>)[key]);
      }
      return out;
    }
    return v;
  }
}

/**
 * The ONE snapshot-hash implementation: canonical serialization of all four
 * mandatory inputs (arrays pre-sorted by stable identity so fetch order never
 * churns the hash) -> SHA-256 hex. The Group 4 staleness check recomputes
 * THIS function over current inputs and compares to the stored value.
 */
export function computeInputSnapshotHash(inputs: GenerationInputs): string {
  const sortById = <T extends { id: string }>(arr: T[]): T[] =>
    [...arr].sort((a, b) => a.id.localeCompare(b.id));
  const canonical = {
    model: {
      physical_data_entities: sortById(inputs.model.physicalDataEntities),
      physical_data_attributes: sortById(inputs.model.physicalDataAttributes),
      data_entity_points: sortById(inputs.model.dataEntityPoints),
      data_entity_relationships: sortById(inputs.model.dataEntityRelationships),
    },
    findings: sortById(inputs.findings),
    db_decisions: [...inputs.dbDecisions].sort((a, b) =>
      a.decisionCode.localeCompare(b.decisionCode)
    ),
    resolved_pack_decisions: [...inputs.resolvedPackDecisions].sort((a, b) =>
      a.decision_key.localeCompare(b.decision_key)
    ),
  };
  return crypto.createHash('sha256').update(canonicalSerialize(canonical), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Engine-pair gate
// ---------------------------------------------------------------------------

/**
 * Reject any source/target pair other than Sybase ASE -> PostgreSQL.
 * Target engine = the `db.engine` captured decision (mandatory). Source
 * engine = the engineKey carried on db_discovery_pack findings (defaults to
 * sybase when no finding declares one — the committed model alone has no
 * engine discriminator).
 */
export function assertSupportedEnginePair(inputs: GenerationInputs): {
  sourceEngine: string;
  targetEngine: string;
} {
  const engineKeys = new Set<string>();
  for (const f of inputs.findings) {
    const key = f.detail_json?.['engineKey'];
    if (typeof key === 'string' && key.length > 0) engineKeys.add(key.toLowerCase());
  }
  const sourceEngine = engineKeys.size === 0 || engineKeys.has('sybase') ? 'sybase' : [...engineKeys].sort()[0];

  const engineDecision = inputs.dbDecisions.find((d) => d.decisionCode === 'db.engine');
  if (!engineDecision) {
    throw new UnsupportedEnginePairError(
      sourceEngine,
      'unknown',
      `No 'db.engine' captured decision found — the target engine is a mandatory input.`
    );
  }
  const targetEngine = engineDecision.answerValue;
  if (!/postgres/i.test(targetEngine)) {
    throw new UnsupportedEnginePairError(sourceEngine, targetEngine);
  }
  if (sourceEngine !== 'sybase') {
    throw new UnsupportedEnginePairError(sourceEngine, targetEngine);
  }
  return { sourceEngine: 'sybase_ase', targetEngine: 'postgresql' };
}

// ---------------------------------------------------------------------------
// IR build + findings merge (stage 2)
// ---------------------------------------------------------------------------

/** Parse `[catalog.]schema.table` / bare `table` (default schema dbo). */
export function parseQualifiedName(name: string): { schemaName: string; tableName: string } {
  const parts = (name ?? '').split('.').filter((p) => p.length > 0);
  if (parts.length >= 2) {
    return { schemaName: parts[parts.length - 2], tableName: parts[parts.length - 1] };
  }
  return { schemaName: 'dbo', tableName: name };
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function columnKey(schema: string, table: string, column: string): string {
  return `${schema}.${table}.${column}`.toLowerCase();
}

/**
 * Build the source-schema IR from the committed model, then merge the
 * findings-only facts in by object identity. Returns the IR the deterministic
 * translator (type mapping + emission) consumes.
 */
export function buildSourceSchemaIr(inputs: GenerationInputs): SourceSchemaIr {
  const { sourceEngine, targetEngine } = assertSupportedEnginePair(inputs);

  // --- tables + columns from the committed model -------------------------
  const tables: IrTable[] = [];
  const tablesByKey = new Map<string, IrTable>();
  const columnsByKey = new Map<string, IrColumn>();

  const sortedEntities = [...inputs.model.physicalDataEntities].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const entity of sortedEntities) {
    const { schemaName, tableName } = parseQualifiedName(entity.name);
    const cm = (entity.constraints_metadata ?? {}) as {
      primary_key?: { name: string; columns: string[] } | null;
      unique_constraints?: Array<{ name: string; columns: string[] }>;
      check_constraints?: Array<{ name: string; expression: string | null }>;
      indexes?: Array<{
        name: string;
        columns: string[];
        is_unique?: boolean;
        is_clustered?: boolean;
        column_directions?: string[];
        method?: string;
        predicate?: string;
      }>;
    };
    const physicalType = entity.physical_type ?? null;
    const isView = /view/i.test(physicalType ?? '');
    const table: IrTable = {
      schemaName,
      tableName,
      entityId: entity.id,
      physicalType,
      objectType: isView ? 'view' : 'table',
      columns: [],
      primaryKey: cm.primary_key ?? null,
      uniqueConstraints: cm.unique_constraints ?? [],
      checkConstraints: cm.check_constraints ?? [],
      indexes: (cm.indexes ?? []).map((i) => ({
        name: i.name,
        columns: i.columns ?? [],
        isUnique: i.is_unique === true,
        isClustered: i.is_clustered === true,
        columnDirections: i.column_directions ?? null,
        method: i.method ?? null,
        predicate: i.predicate ?? null,
      })),
      estimatedRowCount: null,
      findingIds: [],
    };
    tables.push(table);
    tablesByKey.set(`${schemaName}.${tableName}`.toLowerCase(), table);
  }

  const entityById = new Map(inputs.model.physicalDataEntities.map((e) => [e.id, e]));
  const sortedAttributes = [...inputs.model.physicalDataAttributes].sort(
    (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0) || a.name.localeCompare(b.name)
  );
  for (const attr of sortedAttributes) {
    const entity = entityById.get(attr.physical_entity_id);
    if (!entity) continue;
    const { schemaName, tableName } = parseQualifiedName(entity.name);
    const table = tablesByKey.get(`${schemaName}.${tableName}`.toLowerCase());
    if (!table) continue;
    const sourceType = attr.source_type ?? attr.data_type ?? '';
    const column: IrColumn = {
      schemaName,
      tableName,
      columnName: attr.name,
      dataType: sourceType,
      maxLength: null, // committed attributes carry no length column; inline `(n)` is parsed by the mapper
      scale: attr.scale ?? null,
      precision: attr.precision ?? null,
      isNullable: attr.is_nullable !== false,
      isPrimaryKey: attr.is_primary_key === true,
      defaultExpression: attr.column_default ?? null,
      ordinalPosition: attr.ordinal ?? null,
      isIdentity: attr.is_identity === true,
      collation: null,
      collationCaseInsensitive: false,
      isGenerated: false,
      generationExpression: null,
      nonPortableDefault: null,
      attributeId: attr.id,
      entityId: entity.id,
      findingIds: [],
    };
    table.columns.push(column);
    columnsByKey.set(columnKey(schemaName, tableName, attr.name), column);
  }

  // --- foreign keys from relationship fk_columns -------------------------
  const pointById = new Map(inputs.model.dataEntityPoints.map((p) => [p.id, p]));
  const foreignKeys: IrForeignKey[] = [];
  for (const rel of inputs.model.dataEntityRelationships) {
    const fk = rel.fk_columns;
    if (!fk || !Array.isArray(fk.join_columns) || fk.join_columns.length === 0) continue;
    const fromPoint = rel.fromDataEntityPointId ? pointById.get(rel.fromDataEntityPointId) : null;
    const toPoint = rel.toDataEntityPointId ? pointById.get(rel.toDataEntityPointId) : null;
    const fromEntity = fromPoint?.physical_entity_id
      ? entityById.get(fromPoint.physical_entity_id)
      : null;
    const toEntity = toPoint?.physical_entity_id ? entityById.get(toPoint.physical_entity_id) : null;
    if (!fromEntity || !toEntity) continue;
    const from = parseQualifiedName(fromEntity.name);
    const to = parseQualifiedName(toEntity.name);
    foreignKeys.push({
      relationshipId: rel.id,
      fromSchema: from.schemaName,
      fromTable: from.tableName,
      toSchema: to.schemaName,
      toTable: to.tableName,
      joinColumns: fk.join_columns ?? [],
      referencedColumns: fk.referenced_columns ?? [],
      onDelete: fk.on_delete ?? null,
      onUpdate: fk.on_update ?? null,
    });
  }

  // --- findings merge by object identity ---------------------------------
  const sequencesByKey = new Map<string, IrSequence>();
  const untranslated: IrUntranslatedObject[] = [];

  const resolveColumn = (detail: Record<string, unknown>): IrColumn | null => {
    const schema = asString(detail['schemaName']) ?? 'dbo';
    const table = asString(detail['tableName']);
    const column = asString(detail['columnName']);
    if (!table || !column) return null;
    return columnsByKey.get(columnKey(schema, table, column)) ?? null;
  };

  const sortedFindings = [...inputs.findings].sort((a, b) => a.id.localeCompare(b.id));
  for (const finding of sortedFindings) {
    const detail = finding.detail_json ?? {};
    switch (finding.finding_type) {
      case 'collation_case_sensitivity_hazard': {
        const col = resolveColumn(detail);
        if (col) {
          col.collation = asString(detail['collation']);
          col.collationCaseInsensitive = true;
          col.findingIds.push(finding.id);
        }
        break;
      }
      case 'non_portable_default': {
        const col = resolveColumn(detail);
        if (col) {
          const token = asString(detail['detectedToken']);
          if (token) {
            col.nonPortableDefault = {
              token,
              note: asString(detail['portabilityNote']) ?? '',
            };
          }
          if (!col.defaultExpression) {
            col.defaultExpression = asString(detail['columnDefault']);
          }
          col.findingIds.push(finding.id);
        }
        break;
      }
      case 'sequence_definition':
      case 'sequence_cutover_hazard': {
        const schema = asString(detail['schemaName']) ?? 'dbo';
        const seqName = asString(detail['sequenceName']);
        if (!seqName) break;
        const key = `${schema}.${seqName}`.toLowerCase();
        const existing = sequencesByKey.get(key);
        const currentValue = asString(detail['currentValue']);
        const seq: IrSequence = existing ?? {
          schemaName: schema,
          sequenceName: seqName,
          currentValue: null,
          currentValueAvailable: false,
          startValue: null,
          ownedByTable: null,
          ownedByColumn: null,
          findingIds: [],
        };
        if (currentValue !== null) {
          seq.currentValue = currentValue;
          seq.currentValueAvailable = true;
        }
        seq.startValue = seq.startValue ?? asString(detail['startValue']);
        seq.ownedByTable = seq.ownedByTable ?? asString(detail['ownedByTable']);
        seq.ownedByColumn = seq.ownedByColumn ?? asString(detail['ownedByColumn']);
        seq.findingIds.push(finding.id);
        sequencesByKey.set(key, seq);
        break;
      }
      case 'stored_procedure_logic':
      case 'trigger_logic':
      case 'view_definition':
      case 'db_resident_scheduled_job': {
        const kind =
          finding.finding_type === 'stored_procedure_logic'
            ? ('stored_procedure' as const)
            : finding.finding_type === 'trigger_logic'
            ? ('trigger' as const)
            : finding.finding_type === 'view_definition'
            ? ('view' as const)
            : ('scheduled_job' as const);
        const schema = asString(detail['schemaName']) ?? 'dbo';
        const objectName =
          asString(detail['procedureName']) ??
          asString(detail['triggerName']) ??
          asString(detail['viewName']) ??
          asString(detail['jobName']) ??
          asString(detail['objectName']) ??
          'unknown';
        const objectRef = `${schema}.${objectName}`;
        const existing = untranslated.find((u) => u.kind === kind && u.objectRef === objectRef);
        if (existing) {
          existing.findingIds.push(finding.id);
        } else {
          untranslated.push({ kind, objectRef, findingIds: [finding.id] });
        }
        break;
      }
      default: {
        // Computed-column generation expressions arrive on whichever finding
        // carries them (tolerant by-key merge — these facts exist ONLY in
        // findings, never on committed attributes).
        const generationExpression =
          asString(detail['generationExpression']) ?? asString(detail['generation_expression']);
        if (generationExpression) {
          const col = resolveColumn(detail);
          if (col) {
            col.isGenerated = true;
            col.generationExpression = generationExpression;
            col.findingIds.push(finding.id);
          }
        }
        // Best-effort row counts from profiling findings (bulk manifest).
        const rowCount = detail['rowCount'];
        if (typeof rowCount === 'number' && Number.isFinite(rowCount)) {
          const schema = asString(detail['schemaName']) ?? 'dbo';
          const tableName = asString(detail['tableName']) ?? asString(detail['objectName']);
          if (tableName) {
            const t = tablesByKey.get(`${schema}.${tableName}`.toLowerCase());
            if (t && t.estimatedRowCount === null) {
              t.estimatedRowCount = rowCount;
              t.findingIds.push(finding.id);
            }
          }
        }
        break;
      }
    }
  }

  // --- resolved pack decisions keyed by decision_key ----------------------
  const resolvedDecisions: Record<string, Record<string, unknown>> = {};
  for (const d of inputs.resolvedPackDecisions) {
    if (d.status === 'resolved' && d.resolution_json) {
      resolvedDecisions[d.decision_key] = d.resolution_json;
    }
  }

  const ir: SourceSchemaIr = {
    sourceEngine,
    targetEngine,
    tables,
    foreignKeys,
    sequences: [...sequencesByKey.values()].sort((a, b) =>
      `${a.schemaName}.${a.sequenceName}`.localeCompare(`${b.schemaName}.${b.sequenceName}`)
    ),
    untranslated: untranslated.sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.objectRef.localeCompare(b.objectRef)
    ),
    dbDecisions: inputs.dbDecisions,
    resolvedDecisions,
  };
  ir.structuralAccounting = buildStructuralAccounting(inputs, ir);
  return ir;
}

// ---------------------------------------------------------------------------
// Structural completeness accounting (WS3 P1, 2026-07-31)
// ---------------------------------------------------------------------------

/**
 * Count what the generation inputs actually carried, so silent drops become
 * visible numbers. The live 2026-07-30 pack shipped 0 PKs / 0 FKs / 0
 * indexes and no code-object coverage precisely because every absence here
 * defaulted to "empty" without a trace.
 */
export function buildStructuralAccounting(
  inputs: GenerationInputs,
  ir: SourceSchemaIr
): StructuralAccounting {
  let tablesWithCm = 0;
  let tablesWithPk = 0;
  let uniqueTotal = 0;
  let checkTotal = 0;
  let indexesTotal = 0;
  for (const table of ir.tables) {
    if (table.objectType !== 'table') continue;
    if (table.primaryKey) tablesWithPk++;
    uniqueTotal += table.uniqueConstraints.length;
    checkTotal += table.checkConstraints.length;
    indexesTotal += table.indexes.length;
  }
  for (const entity of inputs.model.physicalDataEntities) {
    const cm = entity.constraints_metadata;
    if (cm && typeof cm === 'object' && Object.keys(cm).length > 0) tablesWithCm++;
  }
  const relationshipsTotal = inputs.model.dataEntityRelationships.length;
  const relationshipsWithFk = inputs.model.dataEntityRelationships.filter(
    (r) => r.fk_columns && Array.isArray(r.fk_columns.join_columns) && r.fk_columns.join_columns.length > 0
  ).length;
  const codeCounts = { stored_procedure: 0, trigger: 0, view: 0, scheduled_job: 0 };
  for (const u of ir.untranslated) {
    if (u.kind in codeCounts) codeCounts[u.kind as keyof typeof codeCounts]++;
  }
  // View ENTITIES also count as captured views (they reach requires_translation
  // via the emitter's view pass even without a view_definition finding).
  const viewEntities = ir.tables.filter((t) => t.objectType === 'view').length;

  return {
    tables_total: ir.tables.filter((t) => t.objectType === 'table').length,
    view_entities_total: viewEntities,
    tables_with_constraints_metadata: tablesWithCm,
    tables_with_primary_key: tablesWithPk,
    unique_constraints_total: uniqueTotal,
    check_constraints_total: checkTotal,
    indexes_total: indexesTotal,
    relationships_total: relationshipsTotal,
    relationships_with_fk_columns: relationshipsWithFk,
    code_objects_captured: codeCounts,
  };
}

/**
 * IR-only approximation for IR literals that bypassed buildSourceSchemaIr
 * (test fixtures, older callers). Relationships fall back to the emittable
 * FK count — the model-level relationship total is unknown here.
 */
export function accountingFromIr(ir: SourceSchemaIr): StructuralAccounting {
  const codeCounts = { stored_procedure: 0, trigger: 0, view: 0, scheduled_job: 0 };
  for (const u of ir.untranslated) {
    if (u.kind in codeCounts) codeCounts[u.kind as keyof typeof codeCounts]++;
  }
  const realTables = ir.tables.filter((t) => t.objectType === 'table');
  return {
    tables_total: realTables.length,
    view_entities_total: ir.tables.filter((t) => t.objectType === 'view').length,
    tables_with_constraints_metadata: realTables.filter(
      (t) => t.primaryKey || t.uniqueConstraints.length > 0 || t.checkConstraints.length > 0 || t.indexes.length > 0
    ).length,
    tables_with_primary_key: realTables.filter((t) => t.primaryKey).length,
    unique_constraints_total: realTables.reduce((n, t) => n + t.uniqueConstraints.length, 0),
    check_constraints_total: realTables.reduce((n, t) => n + t.checkConstraints.length, 0),
    indexes_total: realTables.reduce((n, t) => n + t.indexes.length, 0),
    relationships_total: ir.foreignKeys.length,
    relationships_with_fk_columns: ir.foreignKeys.length,
    code_objects_captured: codeCounts,
  };
}

/**
 * Convert suspicious zeros into EXPLICIT warnings. Each one becomes a
 * manifest `structural_warnings` entry and a prerequisite item in the plan —
 * resolve the capture gap and regenerate, or defer the item as an explicit
 * out-of-scope sign-off. Never a silent drop.
 */
export function deriveStructuralWarnings(acc: StructuralAccounting): string[] {
  const warnings: string[] = [];
  if (acc.tables_total > 0 && acc.tables_with_constraints_metadata === 0) {
    warnings.push(
      `constraints_metadata is absent from every committed entity (${acc.tables_total} tables) — ` +
        'primary keys, unique constraints, check constraints and indexes CANNOT be emitted. ' +
        'Re-run discovery/commit with constraint capture, then regenerate the pack.'
    );
  } else {
    if (acc.tables_total > 0 && acc.tables_with_primary_key === 0) {
      warnings.push(
        `no table carries a primary key (${acc.tables_total} tables) — the target gets 0 PKs, ` +
          'row identity is lost, and data-parity reconciliation has no reliable ordering.'
      );
    }
    if (acc.tables_total > 0 && acc.indexes_total === 0) {
      warnings.push(
        `no indexes captured across ${acc.tables_total} tables — 030-indexes.sql will be EMPTY. ` +
          'If the source has indexes, re-run discovery with index capture.'
      );
    }
  }
  if (acc.relationships_total > 0 && acc.relationships_with_fk_columns === 0) {
    warnings.push(
      `${acc.relationships_total} relationship(s) carry no fk_columns join metadata — ` +
        '020-foreign-keys.sql will be EMPTY despite declared relationships. ' +
        'Re-run discovery/commit with referential-constraint capture.'
    );
  }
  const codeTotal =
    acc.code_objects_captured.stored_procedure +
    acc.code_objects_captured.trigger +
    acc.code_objects_captured.view +
    acc.code_objects_captured.scheduled_job +
    acc.view_entities_total;
  if (codeTotal === 0) {
    warnings.push(
      'discovery captured NO stored-procedure / trigger / view / scheduled-job objects — ' +
        'if the source database contains DB code objects they are MISSING from this pack ' +
        '(no translation, no finding). Re-run discovery with DB code capture, or sign the ' +
        'absence off explicitly.'
    );
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Production default fetchers (AMS REST; mocked in tests via the deps seam)
// ---------------------------------------------------------------------------

function amsBaseUrl(): string {
  return getConfig().architectureModelServiceBaseUrl;
}

async function getJson<T>(url: string, label: string): Promise<T> {
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`AMS ${label} fetch failed: HTTP ${response.status} ${text}`);
  }
  return (await response.json()) as T;
}

export const defaultFetchModel: InputFetchDeps['fetchModel'] = async (
  projectId,
  architectureId
) => {
  const url =
    `${amsBaseUrl()}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}`;
  const model = await getJson<{
    metaModel?: {
      entities?: {
        physical_data_entities?: RawPhysicalEntity[];
        physical_data_attributes?: RawPhysicalAttribute[];
        data_entity_points?: RawDataEntityPoint[];
      };
      relationships?: {
        logical_data_entity_relationships?: RawDataEntityRelationship[];
      };
    };
  }>(url, 'architecture model');
  return {
    physicalDataEntities: model.metaModel?.entities?.physical_data_entities ?? [],
    physicalDataAttributes: model.metaModel?.entities?.physical_data_attributes ?? [],
    dataEntityPoints: model.metaModel?.entities?.data_entity_points ?? [],
    dataEntityRelationships:
      model.metaModel?.relationships?.logical_data_entity_relationships ?? [],
  };
};

export const defaultFetchFindings: InputFetchDeps['fetchFindings'] = async (
  projectId,
  architectureId
) => {
  const base =
    `${amsBaseUrl()}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}/discovery/runs`;
  const runs = await getJson<Array<{ id: string }>>(base, 'discovery runs');
  const all: RawDiscoveryFinding[] = [];
  for (const run of runs) {
    let page = 0;
    const size = 200;
    // Paged walk — keep going until a short page.
    for (;;) {
      const url = `${base}/${encodeURIComponent(run.id)}/findings?page=${page}&size=${size}`;
      const result = await getJson<{ items?: RawDiscoveryFinding[] }>(url, 'discovery findings');
      const items = result.items ?? [];
      all.push(...items);
      if (items.length < size) break;
      page += 1;
    }
  }
  logger.debug('[diag-gateway] db_migration_pack fetched findings', {
    projectId,
    architectureId,
    runCount: runs.length,
    findingCount: all.length,
  });
  return all;
};

export const defaultFetchDbDecisions: InputFetchDeps['fetchDbDecisions'] = async (
  projectId,
  targetArchitectureId
) => {
  // Bind to the EXPLICIT target when the caller supplied one (the target the
  // pack/plan is generated FOR); fall back to the active target only for
  // legacy callers that omit it — mirrors the 2026-06-27 migration-discovery-
  // context binding fix.
  let boundTargetId = targetArchitectureId ?? null;
  if (!boundTargetId) {
    const active = await fetchActiveTargetArchitectureId(projectId);
    boundTargetId = active.activeTargetArchitectureId ?? null;
  }
  if (!boundTargetId) return [];
  const decisions: TargetStateCapturedDecision[] = await fetchLatestCapturedDecisions(
    projectId,
    boundTargetId
  );
  return decisions
    .filter((d) => d.decisionCode.startsWith('db.'))
    .map((d) => ({ decisionCode: d.decisionCode, answerValue: d.answerValue }));
};

export const defaultFetchResolvedPackDecisions: InputFetchDeps['fetchResolvedPackDecisions'] =
  async (projectId, architectureId) => {
    const listUrl =
      `${amsBaseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
      `/db-migration-packs?architecture_id=${encodeURIComponent(architectureId)}`;
    const packs = await getJson<Array<{ id: string }>>(listUrl, 'db migration packs');
    if (!Array.isArray(packs) || packs.length === 0) return [];
    const packId = packs[0].id;
    const decisionsUrl =
      `${amsBaseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
      `/db-migration-packs/${encodeURIComponent(packId)}/decisions?status=resolved`;
    const decisions = await getJson<RawResolvedPackDecision[]>(decisionsUrl, 'pack decisions');
    return Array.isArray(decisions) ? decisions : [];
  };

export const defaultInputFetchDeps: InputFetchDeps = {
  fetchModel: defaultFetchModel,
  fetchFindings: defaultFetchFindings,
  fetchDbDecisions: defaultFetchDbDecisions,
  fetchResolvedPackDecisions: defaultFetchResolvedPackDecisions,
};
