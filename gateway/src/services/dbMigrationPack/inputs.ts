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
import { isSybaseSystemObject } from './sybaseSystemObjects';
import {
  fetchActiveTargetArchitectureId,
  fetchLatestCapturedDecisions,
  fetchMostRecentSavedTargetArchitectureId,
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
  StructuralFinding,
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
  /** Foundations scope tag (Spec 4, 2026-08-22): null/absent = in_scope. */
  migration_scope?: string | null;
  scope_decision_ref?: string | null;
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

/** Scope receipt (Foundations Spec 4, 2026-08-22): what the model fetch
 *  removed from TARGET-side generation, with decision receipts — rendered
 *  on the pack manifest and cited by reconciliation. */
export interface PackScopeReceipt {
  total_entities: number;
  in_scope: number;
  data_only: number;
  excluded: Array<{ name: string; decision_ref: string | null }>;
  volatile: Array<{ name: string; decision_ref: string | null }>;
}

/** The slice of the committed architecture model the generator consumes. */
export interface CommittedPhysicalModel {
  physicalDataEntities: RawPhysicalEntity[];
  physicalDataAttributes: RawPhysicalAttribute[];
  dataEntityPoints: RawDataEntityPoint[];
  dataEntityRelationships: RawDataEntityRelationship[];
  /** Populated by the scope-filtering fetch (absent in older callers). */
  scopeReceipt?: PackScopeReceipt;
}

/**
 * Foundations Spec 4: apply migration scope to a fetched model bundle —
 * `excluded` and `volatile` entities (and their attributes) never reach
 * TARGET-side generation (`data_only` stays; behaviour-level consumers
 * refine via tags). Pure + exported for tests; the receipt carries the
 * decision refs for every removal.
 */
export function applyScopeToModelBundle(model: CommittedPhysicalModel): CommittedPhysicalModel {
  const excluded: PackScopeReceipt['excluded'] = [];
  const volatileList: PackScopeReceipt['volatile'] = [];
  let dataOnly = 0;
  const kept: RawPhysicalEntity[] = [];
  for (const entity of model.physicalDataEntities) {
    const scope = (entity.migration_scope ?? '').toLowerCase();
    if (scope === 'excluded') {
      excluded.push({ name: entity.name, decision_ref: entity.scope_decision_ref ?? null });
      continue;
    }
    if (scope === 'volatile') {
      volatileList.push({ name: entity.name, decision_ref: entity.scope_decision_ref ?? null });
      continue;
    }
    if (scope === 'data_only') dataOnly += 1;
    kept.push(entity);
  }
  const keptIds = new Set(kept.map((e) => e.id));
  return {
    ...model,
    physicalDataEntities: kept,
    physicalDataAttributes: model.physicalDataAttributes.filter((a) =>
      keptIds.has(a.physical_entity_id),
    ),
    scopeReceipt: {
      total_entities: model.physicalDataEntities.length,
      in_scope: kept.length - dataOnly,
      data_only: dataOnly,
      excluded: excluded.sort((a, b) => a.name.localeCompare(b.name)),
      volatile: volatileList.sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
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

/**
 * What the `db.*` decision read returns: the decisions PLUS the target the
 * reader actually bound to (2026-09-02). The resolved id is what the pack
 * manifest must record as its decision-binding receipt — echoing the REQUEST
 * id instead wrote null whenever the caller omitted it (the frontend Generate
 * button does), and `dbMigrationPackEnsure.boundTargetOf` then treated the
 * pack as bound to a different target and regenerated it needlessly on the
 * next plan run. Mirrors the 2026-05-26 `CapturedDecisionsForCitationFetcher`
 * reshape: return the resolved id rather than making callers re-resolve it.
 */
export interface DbDecisionsRead {
  decisions: IrDbDecision[];
  /** Null only when the project has no active AND no saved target. */
  resolvedTargetArchitectureId: string | null;
}

export interface GenerationInputs {
  model: CommittedPhysicalModel;
  findings: RawDiscoveryFinding[];
  dbDecisions: IrDbDecision[];
  resolvedPackDecisions: RawResolvedPackDecision[];
  /**
   * The target the `db.*` decisions were READ FROM (not the one requested).
   *
   * OPTIONAL by design: this is provenance, not an input. Keeping it optional
   * means the many hand-built `GenerationInputs` fixtures stay valid, and it
   * is deliberately EXCLUDED from `computeInputSnapshotHash` so adding it does
   * not churn existing packs' hashes into false staleness.
   */
  resolvedTargetArchitectureId?: string | null;
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
   * (legacy callers) → fall back to the active target, then to the
   * most-recent-saved target (closing the conversation stamps saved, not
   * active — an active-only fallback found nothing).
   */
  fetchDbDecisions: (
    projectId: string,
    targetArchitectureId?: string | null
  ) => Promise<DbDecisionsRead>;
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
  const [model, findings, decisionsRead, resolvedPackDecisions] = await Promise.all([
    deps.fetchModel(projectId, architectureId),
    deps.fetchFindings(projectId, architectureId),
    deps.fetchDbDecisions(projectId, targetArchitectureId),
    deps.fetchResolvedPackDecisions(projectId, architectureId),
  ]);
  return {
    model,
    findings,
    dbDecisions: decisionsRead.decisions,
    resolvedPackDecisions,
    // Prefer what the reader actually bound to; fall back to the requested id
    // so an injected test double that reports nothing still records intent.
    resolvedTargetArchitectureId:
      decisionsRead.resolvedTargetArchitectureId ?? targetArchitectureId ?? null,
  };
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
  // Sybase system-catalog objects are ENGINE INFRASTRUCTURE, never migrated
  // app schema (2026-08-07: a harvested dbo.sysquerymetrics system view was
  // translated + emitted and failed the final post-load changeset — its
  // sysqueryplans source can never exist on the target). Excluded here, with
  // every exclusion recorded for the manifest.
  const sybaseSystemExclusions: SourceSchemaIr['sybaseSystemExclusions'] = [];

  for (const entity of sortedEntities) {
    const { schemaName, tableName } = parseQualifiedName(entity.name);
    if (isSybaseSystemObject(tableName)) {
      const physicalType = entity.physical_type ?? '';
      sybaseSystemExclusions.push({
        kind: /view/i.test(physicalType) ? 'view' : 'table',
        objectRef: `${schemaName}.${tableName}`,
      });
      continue;
    }
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
      keyPolicy:
        ((cm as { key_policy?: string | null }).key_policy ?? null) === 'keyless_multiset'
          ? 'keyless_multiset'
          : null,
      sequenceGenerator:
        ((cm as { sequence_generator?: IrTable['sequenceGenerator'] }).sequence_generator ??
          null),
      parityKey:
        ((cm as { parity_key?: IrTable['parityKey'] }).parity_key ?? null),
      auditSink: (cm as { audit_sink?: unknown }).audit_sink === true,
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
        // ASE system objects (2026-08-07): a system view/proc finding must
        // never enter the translation queue — it references Sybase-internal
        // catalogs that cannot exist on the target.
        if (isSybaseSystemObject(objectName)) {
          if (!sybaseSystemExclusions.some((e) => e.kind === kind && e.objectRef === objectRef)) {
            sybaseSystemExclusions.push({ kind, objectRef });
          }
          break;
        }
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

  // Surrogate-PK injection (2026-08-08): a resolved `surrogate_pk` decision
  // gives every no-PK table a target-only identity PK BEFORE the structural
  // accounting below, so the no_primary_keys finding stops firing for the
  // tables the decision covered — the generator stays the only resolution
  // oracle.
  applySurrogatePkDecision(tables, resolvedDecisions);

  const ir: SourceSchemaIr = {
    scopeReceipt: inputs.model.scopeReceipt ?? null,
    sourceCharset: null,
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
    sybaseSystemExclusions: sybaseSystemExclusions.sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.objectRef.localeCompare(b.objectRef)
    ),
    dbDecisions: inputs.dbDecisions,
    resolvedDecisions,
  };
  ir.structuralAccounting = buildStructuralAccounting(inputs, ir);
  return ir;
}

// ---------------------------------------------------------------------------
// Surrogate primary keys (2026-08-08 — the "modern DBA" target fix)
// ---------------------------------------------------------------------------

/** The single pack-wide surrogate-PK decision key. */
export const SURROGATE_PK_DECISION_KEY = 'surrogate_pk--tables_without_pk';
/** Its options: add a target-only identity PK to every no-PK table, or not. */
export const SURROGATE_PK_OPTIONS = [
  'add_surrogate_identity_pk',
  'leave_without_pk',
] as const;

/** Deterministic surrogate column-name cascade (first non-colliding wins). */
const SURROGATE_COLUMN_CANDIDATES = ['id', 'row_id', 'haikai_row_id'];

/** Clamp an identifier to PostgreSQL's 63-byte limit (ASCII-safe slice). */
function clampIdent(name: string): string {
  return name.length > 63 ? name.slice(0, 63) : name;
}

/**
 * Apply a resolved `surrogate_pk` decision to the IR tables IN PLACE: every
 * `objectType === 'table'` row with NO primary key gains a synthetic
 * `BIGINT GENERATED ALWAYS AS IDENTITY` column + PK, both flagged
 * `isSurrogate` so every source-facing consumer (load column lists,
 * delta-key detection, parity keying, sync ordering) can exclude them — the
 * SOURCE has no such column and target values are generated independently.
 *
 * DEMOTION (2026-08-12): `resolution_json.demote_tables` (array of
 * "schema.table", case-insensitive) names tables whose DECLARED primary key
 * the live source data does not satisfy — the bulk-load preflight reports
 * duplicate/NULL key tuples with exactly this remedy. Each named table's
 * natural PK is demoted to a NON-UNIQUE index (the key stays useful for
 * keyset ordering; duplicates are boundary-trim paginated) and the table
 * then takes a surrogate identity PK like any no-PK table.
 *
 * The column name cascades `id` -> `row_id` -> `haikai_row_id` to the first
 * name not colliding (case-insensitively) with an existing column; a table
 * colliding on all three (pathological) is left untouched and reported so
 * the caller can surface it — never a silent partial.
 *
 * Returns the per-table outcome for manifest/warning surfaces. A missing or
 * `leave_without_pk` resolution is a no-op.
 */
export function applySurrogatePkDecision(
  tables: IrTable[],
  resolvedDecisions: Record<string, Record<string, unknown>>,
): { added: string[]; skipped: string[]; demoted: string[] } {
  const added: string[] = [];
  const skipped: string[] = [];
  const demoted: string[] = [];
  const resolution = resolvedDecisions[SURROGATE_PK_DECISION_KEY];
  const globalOn = !!resolution && resolution['option'] === 'add_surrogate_identity_pk';
  // Foundations Spec 4 (2026-08-22): a table whose foundation key policy is
  // keyless_multiset ALWAYS takes a surrogate identity PK on the target —
  // the decision was already made at the foundations review; the pack-level
  // surrogate decision is not required for those tables.
  const hasPolicyTables = tables.some(
    (t) => t.objectType === 'table' && !t.primaryKey && t.keyPolicy === 'keyless_multiset',
  );
  if (!globalOn && !hasPolicyTables) {
    return { added, skipped, demoted };
  }

  // --- demotions first (GLOBAL decision only): the demoted tables become ---
  // --- no-PK tables and the surrogate loop below picks them up.          ---
  // Accept an ARRAY of "schema.table" names or a comma-separated STRING
  // (belt-and-braces for hand-entered resolutions).
  const rawDemote = globalOn ? resolution?.['demote_tables'] : undefined;
  const demoteList = Array.isArray(rawDemote)
    ? rawDemote
    : typeof rawDemote === 'string'
      ? rawDemote.split(',')
      : [];
  const demoteWanted = new Set(
    demoteList
      .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
      .map((t) => t.trim().toLowerCase()),
  );
  for (const table of tables) {
    if (table.objectType !== 'table') continue;
    const qn = `${table.schemaName}.${table.tableName}`;
    if (!demoteWanted.has(qn.toLowerCase())) continue;
    const pk = table.primaryKey;
    if (!pk || pk.isSurrogate) continue; // nothing real to demote
    table.indexes.push({
      name: clampIdent(`ix_${table.tableName}_natural_key`),
      columns: [...pk.columns],
      isUnique: false, // the whole point: the live data is NOT unique on it
      isClustered: false,
      columnDirections: null,
      method: null,
      predicate: null,
    });
    table.primaryKey = null;
    demoted.push(qn);
  }

  for (const table of tables) {
    if (table.objectType !== 'table' || table.primaryKey) continue;
    // Global decision OFF: only foundation keyless-policy tables surrogate.
    if (!globalOn && table.keyPolicy !== 'keyless_multiset') continue;
    const taken = new Set(table.columns.map((c) => c.columnName.toLowerCase()));
    const columnName = SURROGATE_COLUMN_CANDIDATES.find((n) => !taken.has(n));
    const qn = `${table.schemaName}.${table.tableName}`;
    if (!columnName) {
      skipped.push(qn);
      continue;
    }
    table.columns.push({
      schemaName: table.schemaName,
      tableName: table.tableName,
      columnName,
      dataType: 'bigint',
      maxLength: null,
      scale: null,
      precision: null,
      isNullable: false,
      isPrimaryKey: true,
      defaultExpression: null,
      // After every source column so DDL appends it last, deterministically.
      ordinalPosition:
        Math.max(0, ...table.columns.map((c) => c.ordinalPosition ?? 0)) + 1,
      isIdentity: true,
      collation: null,
      collationCaseInsensitive: false,
      isGenerated: false,
      generationExpression: null,
      nonPortableDefault: null,
      attributeId: `surrogate:${qn}.${columnName}`,
      entityId: table.entityId,
      findingIds: [],
      isSurrogate: true,
    });
    table.primaryKey = {
      name: clampIdent(`pk_${table.tableName}_surrogate`),
      columns: [columnName],
      isSurrogate: true,
    };
    added.push(qn);
  }
  added.sort((a, b) => a.localeCompare(b));
  skipped.sort((a, b) => a.localeCompare(b));
  demoted.sort((a, b) => a.localeCompare(b));
  return { added, skipped, demoted };
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
  // Per-item detail lists (2026-08-04 partial-coverage follow-up): the
  // findings itemise WHICH tables/relationships dropped, not just how many.
  const tablesWithoutPk: string[] = [];
  for (const table of ir.tables) {
    if (table.objectType !== 'table') continue;
    if (table.primaryKey) tablesWithPk++;
    else tablesWithoutPk.push(`${table.schemaName}.${table.tableName}`);
    uniqueTotal += table.uniqueConstraints.length;
    checkTotal += table.checkConstraints.length;
    indexesTotal += table.indexes.length;
  }
  for (const entity of inputs.model.physicalDataEntities) {
    const cm = entity.constraints_metadata;
    if (cm && typeof cm === 'object' && Object.keys(cm).length > 0) tablesWithCm++;
  }
  const relationshipsTotal = inputs.model.dataEntityRelationships.length;
  let relationshipsWithFk = 0;
  const relationshipsWithoutFk: string[] = [];
  const pointById = new Map(inputs.model.dataEntityPoints.map((p) => [p.id, p]));
  const entityNameById = new Map(
    inputs.model.physicalDataEntities.map((e) => [e.id, e.name])
  );
  const endpointName = (pointId: string | null | undefined): string => {
    const point = pointId ? pointById.get(pointId) : null;
    const name = point?.physical_entity_id
      ? entityNameById.get(point.physical_entity_id)
      : null;
    return name ?? '(unresolved entity)';
  };
  for (const r of inputs.model.dataEntityRelationships) {
    const hasJoin =
      !!r.fk_columns &&
      Array.isArray(r.fk_columns.join_columns) &&
      r.fk_columns.join_columns.length > 0;
    if (hasJoin) {
      relationshipsWithFk++;
    } else {
      relationshipsWithoutFk.push(
        `${endpointName(r.fromDataEntityPointId)} -> ${endpointName(r.toDataEntityPointId)}`
      );
    }
  }
  relationshipsWithoutFk.sort((a, b) => a.localeCompare(b));
  tablesWithoutPk.sort((a, b) => a.localeCompare(b));
  const codeCounts = { stored_procedure: 0, trigger: 0, view: 0, scheduled_job: 0 };
  for (const u of ir.untranslated) {
    if (u.kind in codeCounts) codeCounts[u.kind as keyof typeof codeCounts]++;
  }
  // View ENTITIES also count as captured views (they reach requires_translation
  // via the emitter's view pass even without a view_definition finding).
  const viewEntities = ir.tables.filter((t) => t.objectType === 'view').length;

  // FINDINGS-channel visibility (2026-08-01): these facts exist ONLY in
  // findings (merged into IR columns / sequences above), never on committed
  // attributes — count them so the channel's health shows in the manifest.
  let collationHazardColumns = 0;
  let generatedColumns = 0;
  for (const table of ir.tables) {
    for (const c of table.columns) {
      if (c.collationCaseInsensitive) collationHazardColumns++;
      if (c.isGenerated) generatedColumns++;
    }
  }

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
    tables_without_primary_key: tablesWithoutPk,
    relationships_without_fk_details: relationshipsWithoutFk,
    collation_hazard_columns: collationHazardColumns,
    generated_columns: generatedColumns,
    sequences_captured: ir.sequences.length,
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
    collation_hazard_columns: ir.tables.reduce(
      (n, t) => n + t.columns.filter((c) => c.collationCaseInsensitive).length,
      0
    ),
    generated_columns: ir.tables.reduce(
      (n, t) => n + t.columns.filter((c) => c.isGenerated).length,
      0
    ),
    sequences_captured: ir.sequences.length,
    code_objects_captured: codeCounts,
  };
}

/**
 * Convert suspicious zeros into EXPLICIT structured findings (Spec
 * 2026-08-04-2). Each carries a stable `kind`/`subject` identity (counts stay
 * in the message only) so human dispositions — accepted / fix_upstream /
 * known_gap, stored per project in AMS — survive pack regeneration. The
 * findings gate blocks plan generation and Migrate until every CURRENT
 * finding is dispositioned; resolution is only ever "a regenerated pack no
 * longer emits the finding". Never a silent drop.
 */
export function deriveStructuralFindings(acc: StructuralAccounting): StructuralFinding[] {
  const findings: StructuralFinding[] = [];
  if (acc.tables_total > 0 && acc.tables_with_constraints_metadata === 0) {
    findings.push({
      kind: 'constraints_metadata_absent',
      subject: 'all_tables',
      message:
        `constraints_metadata is absent from every committed entity (${acc.tables_total} tables) — ` +
        'primary keys, unique constraints, check constraints and indexes CANNOT be emitted. ' +
        'Re-run discovery/commit with constraint capture, then regenerate the pack.',
    });
  } else {
    // PARTIAL coverage fires too (2026-08-04 follow-up): everything captured
    // goes into the pack; every PK-less table is itemised in the finding.
    // The all-or-nothing check silently dropped the partial case — arguably
    // the MORE suspicious one (specific tables lost their metadata).
    if (acc.tables_total > 0 && acc.tables_with_primary_key < acc.tables_total) {
      const missing = acc.tables_total - acc.tables_with_primary_key;
      findings.push({
        kind: 'no_primary_keys',
        subject: 'all_tables',
        message:
          acc.tables_with_primary_key === 0
            ? `no table carries a primary key (${acc.tables_total} tables) — the target gets 0 PKs, ` +
              'row identity is lost, and data-parity reconciliation has no reliable ordering.'
            : `${missing} of ${acc.tables_total} table(s) carry no primary key — those tables get ` +
              'no PK on the target, losing row identity for data-parity reconciliation. ' +
              'Captured PKs are emitted normally.',
        ...(acc.tables_without_primary_key && acc.tables_without_primary_key.length > 0
          ? { details: acc.tables_without_primary_key }
          : {}),
      });
    }
    if (acc.tables_total > 0 && acc.indexes_total === 0) {
      findings.push({
        kind: 'no_indexes',
        subject: 'all_tables',
        message:
          `no indexes captured across ${acc.tables_total} tables — 030-indexes.sql will be EMPTY. ` +
          'If the source has indexes, re-run discovery with index capture.',
      });
    }
  }
  // PARTIAL coverage fires too (2026-08-04 follow-up): relationships WITH
  // join metadata emit into 020-foreign-keys.sql regardless; each join-less
  // one is itemised here instead of being silently skipped.
  if (
    acc.relationships_total > 0 &&
    acc.relationships_with_fk_columns < acc.relationships_total
  ) {
    const missing = acc.relationships_total - acc.relationships_with_fk_columns;
    findings.push({
      kind: 'relationships_without_fk_columns',
      subject: 'all_relationships',
      message:
        acc.relationships_with_fk_columns === 0
          ? `${acc.relationships_total} relationship(s) carry no fk_columns join metadata — ` +
            '020-foreign-keys.sql will be EMPTY despite declared relationships. ' +
            'Re-run discovery/commit with referential-constraint capture.'
          : `${missing} of ${acc.relationships_total} relationship(s) carry no fk_columns join ` +
            `metadata — those ${missing} FK(s) will be silently absent from 020-foreign-keys.sql. ` +
            `The ${acc.relationships_with_fk_columns} captured FK(s) are emitted normally.`,
      ...(acc.relationships_without_fk_details && acc.relationships_without_fk_details.length > 0
        ? { details: acc.relationships_without_fk_details }
        : {}),
    });
  }
  const codeTotal =
    acc.code_objects_captured.stored_procedure +
    acc.code_objects_captured.trigger +
    acc.code_objects_captured.view +
    acc.code_objects_captured.scheduled_job +
    acc.view_entities_total;
  if (codeTotal === 0) {
    findings.push({
      kind: 'no_code_objects',
      subject: 'all_code_objects',
      message:
        'discovery captured NO stored-procedure / trigger / view / scheduled-job objects — ' +
        'if the source database contains DB code objects they are MISSING from this pack ' +
        '(no translation, no finding). Re-run discovery with DB code capture, or sign the ' +
        'absence off explicitly.',
    });
  }
  return findings;
}

/** Legacy string view of {@link deriveStructuralFindings} (wire back-compat). */
export function deriveStructuralWarnings(acc: StructuralAccounting): string[] {
  return deriveStructuralFindings(acc).map((f) => f.message);
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
  // Foundations Spec 4: excluded/volatile entities never reach TARGET-side
  // generation — filtered here at the single fetch choke point, receipted.
  return applyScopeToModelBundle({
    physicalDataEntities: model.metaModel?.entities?.physical_data_entities ?? [],
    physicalDataAttributes: model.metaModel?.entities?.physical_data_attributes ?? [],
    dataEntityPoints: model.metaModel?.entities?.data_entity_points ?? [],
    dataEntityRelationships:
      model.metaModel?.relationships?.logical_data_entity_relationships ?? [],
  });
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
  // pack/plan is generated FOR); fall back for legacy callers that omit it —
  // mirrors the 2026-06-27 migration-discovery-context binding fix.
  //
  // Fallback order is active THEN most-recent-saved (2026-09-02 fix): closing
  // the target-state conversation stamps `conversation_saved_at` but does NOT
  // make the target "active", so an active-only fallback resolved to null on a
  // normally-completed conversation and returned ZERO db.* decisions — which
  // surfaced as the misleading "No 'db.engine' captured decision found" engine-
  // pair rejection even though db.engine was captured. Same decoupling every
  // other plan-sourcing reader already does (Spec 2026-06-26 FR4; cf.
  // sclModernizationReview.resolveTargetArchitectureId).
  let boundTargetId = targetArchitectureId ?? null;
  if (!boundTargetId) {
    const active = await fetchActiveTargetArchitectureId(projectId);
    boundTargetId = active.activeTargetArchitectureId ?? null;
  }
  if (!boundTargetId) {
    const saved = await fetchMostRecentSavedTargetArchitectureId(projectId);
    boundTargetId = saved.savedTargetArchitectureId ?? null;
  }
  if (!boundTargetId) return { decisions: [], resolvedTargetArchitectureId: null };
  const decisions: TargetStateCapturedDecision[] = await fetchLatestCapturedDecisions(
    projectId,
    boundTargetId
  );
  return {
    decisions: decisions
      .filter((d) => d.decisionCode.startsWith('db.'))
      .map((d) => ({ decisionCode: d.decisionCode, answerValue: d.answerValue })),
    resolvedTargetArchitectureId: boundTargetId,
  };
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


/**
 * Item 3 (2026-08-23): the DB scan persists the detected server charset on
 * its run's steps payload — fetch it (fail-soft null) so the pack manifest
 * carries it and the data plane declares it on extraction connections.
 */
export async function fetchServerCharsetFacts(
  amsBaseUrl: string,
  projectId: string,
  architectureId: string,
  fetchFn: typeof fetch = fetch,
): Promise<{
  charset: string | null;
  sortorderName: string | null;
  caseSensitive: boolean | null;
} | null> {
  try {
    const response = await fetchFn(
      `${amsBaseUrl}/api/model/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}/discovery/runs`,
      { headers: { Accept: 'application/json' } },
    );
    if (!response.ok) return null;
    const runs = (await response.json()) as Array<{
      discovery_kind?: string;
      status?: string;
      started_at?: string;
      steps_payload?: { database?: { server_charset?: unknown } };
    }>;
    const latest = (Array.isArray(runs) ? runs : [])
      .filter(
        (r) =>
          String(r.discovery_kind ?? '') === 'database' &&
          String(r.status ?? '').toUpperCase() === 'COMPLETED',
      )
      .sort((a, b) => String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')))[0];
    const facts = latest?.steps_payload?.database?.server_charset as
      | { charset?: unknown; sortorderName?: unknown; caseSensitive?: unknown }
      | null
      | undefined;
    if (!facts) return null;
    return {
      charset: facts.charset === null || facts.charset === undefined ? null : String(facts.charset),
      sortorderName:
        facts.sortorderName === null || facts.sortorderName === undefined
          ? null
          : String(facts.sortorderName),
      caseSensitive: typeof facts.caseSensitive === 'boolean' ? facts.caseSensitive : null,
    };
  } catch {
    return null;
  }
}
