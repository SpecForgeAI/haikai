/**
 * Sybase pack -- finding emission.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 4.
 *
 * Mirrors {@code postgresFindings.ts} structurally. Emits the same
 * net-new finding-type set so the Findings tab UI does not need
 * engine-specific branches.
 *
 * Engine-specific differences:
 *   - {@code createdByStage} uses {@code 'deterministic_sybase_introspection'}
 *     or {@code 'sybaseDiscoveryPack.findings.*'} so AMS-side filters can
 *     distinguish Sybase-origin findings.
 *   - Snippet redaction is applied via {@code snippetRedaction.redactSnippet}
 *     inside this module BEFORE the snippet reaches a {@code detailJson}
 *     payload. The shared builders also re-redact defensively.
 */

import type { FindingEmitInput } from '../../findings/FindingEmitter';
import {
  buildMissingPrimaryKeyFinding,
  buildNoForeignKeysDeclaredFinding,
  buildInferredRelationshipFinding,
  buildHighNullRateFinding,
  buildDbMigrationRiskFinding,
  buildStoredProcedureLogicFinding,
  buildHiddenBusinessLogicFinding,
  buildTriggerLogicFinding,
  buildViewDefinitionFinding,
  buildSequenceDefinitionFinding,
  buildSequenceCutoverHazardFinding,
  buildCollationHazardFinding,
  collationImpliesCaseInsensitive,
  detectNonPortableDefault,
  buildNonPortableDefaultFinding,
  buildScheduledJobFinding,
  buildDbEvidenceGapFinding,
} from '../../findings/databasePackFindingScanners';
import type {
  IntrospectionResult,
  MetadataApplicability,
  MetadataGroupKey,
  ProfileResult,
  RelationshipInference,
} from '../types';

/**
 * Detect DML statements (case-insensitive) inside a routine body.
 */
function bodyHasDml(body: string): boolean {
  if (!body) return false;
  return /\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(body);
}

/**
 * Detect procedure-call patterns inside a routine body. Sybase TSQL uses
 * EXEC / EXECUTE / CALL.
 */
function bodyHasProcCall(body: string): boolean {
  if (!body) return false;
  return /\b(EXEC|EXECUTE|CALL)\b/i.test(body);
}

/**
 * Complex view heuristic (line count + join count + window function count).
 */
function isComplexViewDefinition(definition: string): boolean {
  if (!definition) return false;
  const lines = definition.split(/\r?\n/).length;
  const joins = (definition.match(/\bJOIN\b/gi) ?? []).length;
  const windowFuncs = (definition.match(/\bOVER\s*\(/gi) ?? []).length;
  return lines > 40 || joins > 3 || windowFuncs > 0;
}

function tablesWithFks(introspection: IntrospectionResult): Set<string> {
  const out = new Set<string>();
  for (const k of introspection.keysAndIndexes) {
    if (k.kind === 'foreign_key') {
      out.add(`${k.schemaName}.${k.tableName}`);
    }
  }
  return out;
}

function tablesWithPks(introspection: IntrospectionResult): Set<string> {
  const out = new Set<string>();
  for (const k of introspection.keysAndIndexes) {
    if (k.kind === 'primary_key') {
      out.add(`${k.schemaName}.${k.tableName}`);
    }
  }
  return out;
}

/**
 * Build a sample-data-hint finding (info, per table).
 */
function buildSampleDataHintFinding(args: {
  schemaName: string;
  tableName: string;
  samplePayload: Record<string, string[]>;
}): FindingEmitInput {
  const objectIdentity = `${args.schemaName}.${args.tableName}`;
  return {
    findingType: 'sample_data_hint',
    category: 'data_quality',
    severity: 'info',
    title: `Sample values [sybase]: ${objectIdentity}`,
    summary:
      `Sample values captured for ${Object.keys(args.samplePayload).length} ` +
      `columns of '${objectIdentity}'. Use to confirm column semantics.`,
    detailJson: {
      engineKey: 'sybase',
      schemaName: args.schemaName,
      tableName: args.tableName,
      samplePayload: args.samplePayload,
    },
    source: 'db_discovery_pack',
    createdByStage: 'sybaseDiscoveryPack.findings.sampleDataHint',
    links: [],
  };
}

function buildSentinelValueFinding(args: {
  schemaName: string;
  tableName: string;
  columnName: string;
}): FindingEmitInput {
  const objectIdentity = `${args.schemaName}.${args.tableName}.${args.columnName}`;
  return {
    findingType: 'sentinel_value_detected',
    category: 'data_quality',
    severity: 'low',
    title: `Sentinel value [sybase]: ${objectIdentity}`,
    summary:
      `Column '${objectIdentity}' contains a sentinel placeholder. ` +
      `Review for migration-time data cleanup.`,
    detailJson: {
      engineKey: 'sybase',
      schemaName: args.schemaName,
      tableName: args.tableName,
      columnName: args.columnName,
    },
    source: 'db_discovery_pack',
    createdByStage: 'sybaseDiscoveryPack.findings.sentinelValue',
    links: [],
  };
}

function buildGenericDbFinding(args: {
  findingType: string;
  category: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  schemaName: string;
  tableName?: string;
  columnName?: string;
  summary: string;
  detailJson?: Record<string, unknown>;
}): FindingEmitInput {
  const objectIdentity =
    args.tableName === undefined
      ? args.schemaName
      : args.columnName === undefined
      ? `${args.schemaName}.${args.tableName}`
      : `${args.schemaName}.${args.tableName}.${args.columnName}`;
  return {
    findingType: args.findingType,
    category: args.category,
    severity: args.severity,
    title: `${args.findingType.replace(/_/g, ' ')} [sybase]: ${objectIdentity}`,
    summary: args.summary,
    detailJson: {
      engineKey: 'sybase',
      schemaName: args.schemaName,
      tableName: args.tableName ?? null,
      columnName: args.columnName ?? null,
      ...(args.detailJson ?? {}),
    },
    source: 'db_discovery_pack',
    createdByStage: `sybaseDiscoveryPack.findings.${args.findingType}`,
    links: [],
  };
}

function emitStructuralFindings(
  introspection: IntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  const pks = tablesWithPks(introspection);
  const fks = tablesWithFks(introspection);
  for (const t of introspection.tables) {
    const key = `${t.schemaName}.${t.tableName}`;
    if (!pks.has(key)) {
      out.push(
        buildMissingPrimaryKeyFinding({
          engineKey: 'sybase',
          schemaName: t.schemaName,
          tableName: t.tableName,
          estimatedRowCount: t.estimatedRowCount ?? null,
        }),
      );
    }
    if (!fks.has(key)) {
      out.push(
        buildNoForeignKeysDeclaredFinding({
          engineKey: 'sybase',
          schemaName: t.schemaName,
          tableName: t.tableName,
        }),
      );
    }
  }
  return out;
}

function emitRelationshipFindings(
  relationships: RelationshipInference[],
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const r of relationships) {
    if (r.kind === 'declared_fk') continue;
    if (r.kind === 'ambiguous') {
      out.push({
        findingType: 'ambiguous_relationship',
        category: 'schema_quality',
        severity: 'low',
        title: `Ambiguous relationship [sybase]: ${r.fromSchema}.${r.fromTable}(${r.fromColumns.join(',')})`,
        summary: r.rationale ?? 'Multiple plausible parent tables.',
        confidence: r.confidence,
        detailJson: {
          engineKey: 'sybase',
          from: {
            schemaName: r.fromSchema,
            tableName: r.fromTable,
            columns: r.fromColumns,
          },
          competingTargets: r.competingTargets ?? [],
        },
        source: 'db_discovery_pack',
        createdByStage: 'sybaseDiscoveryPack.findings.ambiguousRelationship',
        links: [],
      });
    } else if (r.kind === 'inferred') {
      out.push(
        buildInferredRelationshipFinding({
          engineKey: 'sybase',
          fromSchema: r.fromSchema,
          fromTable: r.fromTable,
          fromColumns: r.fromColumns,
          toSchema: r.toSchema,
          toTable: r.toTable,
          toColumns: r.toColumns,
          confidence: r.confidence,
          rationale: r.rationale ?? undefined,
        }),
      );
    }
  }
  return out;
}

function emitProfileFindings(profile: ProfileResult): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const t of profile.tables) {
    if (t.rowCount !== null && t.rowCount !== undefined) {
      if (t.rowCount === 0) {
        out.push(
          buildGenericDbFinding({
            findingType: 'empty_table',
            category: 'data_quality',
            severity: 'low',
            schemaName: t.schemaName,
            tableName: t.tableName,
            summary:
              `Table '${t.schemaName}.${t.tableName}' is empty. May be a ` +
              `staging table, future feature, or dead.`,
          }),
        );
      } else if (t.rowCount >= 1_000_000) {
        out.push(
          buildGenericDbFinding({
            findingType: 'large_table',
            category: 'data_quality',
            severity: 'medium',
            schemaName: t.schemaName,
            tableName: t.tableName,
            summary:
              `Table '${t.schemaName}.${t.tableName}' has approx ${t.rowCount} ` +
              `rows. Migration / replication strategy should account for volume.`,
            detailJson: { rowCount: t.rowCount },
          }),
        );
      }
    }
    const samplePayload: Record<string, string[]> = {};
    for (const c of t.columnProfiles) {
      if (
        c.nullRate !== null &&
        c.nullRate !== undefined &&
        c.nullRate > 0.8
      ) {
        out.push(
          buildHighNullRateFinding({
            engineKey: 'sybase',
            schemaName: c.schemaName,
            tableName: c.tableName,
            columnName: c.columnName,
            nullRate: c.nullRate,
            rowsObserved: t.rowCount ?? undefined,
          }),
        );
      }
      if (
        c.nullRate !== null &&
        c.nullRate !== undefined &&
        t.rowCount !== null &&
        t.rowCount !== undefined &&
        t.rowCount > 100 &&
        c.nullRate > 0.6 &&
        c.nullRate <= 0.8
      ) {
        out.push(
          buildGenericDbFinding({
            findingType: 'sparse_column',
            category: 'data_quality',
            severity: 'low',
            schemaName: c.schemaName,
            tableName: c.tableName,
            columnName: c.columnName,
            summary:
              `Column '${c.schemaName}.${c.tableName}.${c.columnName}' is ` +
              `sparsely populated (${(c.nullRate * 100).toFixed(1)}% null).`,
          }),
        );
      }
      if (c.sentinelDetected) {
        out.push(
          buildSentinelValueFinding({
            schemaName: c.schemaName,
            tableName: c.tableName,
            columnName: c.columnName,
          }),
        );
      }
      if (c.sampleValues && c.sampleValues.length > 0) {
        samplePayload[c.columnName] = c.sampleValues;
      }
    }
    if (Object.keys(samplePayload).length > 0) {
      out.push(
        buildSampleDataHintFinding({
          schemaName: t.schemaName,
          tableName: t.tableName,
          samplePayload,
        }),
      );
    }
  }
  for (const skip of profile.skippedTables) {
    out.push(
      buildDbEvidenceGapFinding({
        engineKey: 'sybase',
        gapType: 'db_unreadable_object',
        objectName: `${skip.schemaName}.${skip.tableName}`,
        gapDescription:
          `Profile attempt failed for '${skip.schemaName}.${skip.tableName}': ${skip.reason}`,
      }),
    );
  }
  return out;
}

function emitHiddenLogicFindings(
  introspection: IntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];

  // Views: emit a `view_definition` finding for EVERY view, plus the
  // consolidated `db_migration_risk` (`complex_view_logic`) for complex views.
  // Bodies are passed RAW -- the builders apply full-body redaction + ~64KB cap.
  for (const v of introspection.views) {
    const complex = isComplexViewDefinition(v.definition);
    out.push(
      buildViewDefinitionFinding({
        engineKey: 'sybase',
        schemaName: v.schemaName,
        viewName: v.viewName,
        isMaterialized: v.isMaterialized,
        definition: v.definition,
        isComplex: complex,
      }),
    );
    if (complex) {
      out.push(
        buildDbMigrationRiskFinding({
          engineKey: 'sybase',
          riskCategory: 'complex_view_logic',
          objectName: `${v.schemaName}.${v.viewName}`,
          objectKind: 'view',
          rationale:
            `View '${v.schemaName}.${v.viewName}' contains complex logic ` +
            `(many joins / windows / lines). Capture for migration planning.`,
          bodySnippet: v.definition,
        }),
      );
    }
  }

  for (const p of introspection.procedures) {
    const hasDml = bodyHasDml(p.body);
    out.push(
      buildStoredProcedureLogicFinding({
        engineKey: 'sybase',
        schemaName: p.schemaName,
        procedureName: p.procedureName,
        routineKind: p.routineKind,
        bodySnippet: p.body,
        language: p.language ?? undefined,
      }),
    );
    if (hasDml) {
      out.push(
        buildHiddenBusinessLogicFinding({
          engineKey: 'sybase',
          sourceObjectType:
            p.routineKind === 'procedure' ? 'stored_procedure' : 'function',
          schemaName: p.schemaName,
          objectName: p.procedureName,
          bodySnippet: p.body,
        }),
      );
      out.push(
        buildGenericDbFinding({
          findingType: 'procedure_data_write',
          category: 'hidden_logic',
          severity: 'medium',
          schemaName: p.schemaName,
          tableName: p.procedureName,
          summary:
            `Procedure '${p.schemaName}.${p.procedureName}' writes data ` +
            `(INSERT/UPDATE/DELETE/MERGE detected in body). Migration must ` +
            `preserve write semantics.`,
        }),
      );
    }
    if (bodyHasProcCall(p.body)) {
      out.push(
        buildGenericDbFinding({
          findingType: 'procedure_dependency',
          category: 'hidden_logic',
          severity: 'low',
          schemaName: p.schemaName,
          tableName: p.procedureName,
          summary:
            `Procedure '${p.schemaName}.${p.procedureName}' calls another ` +
            `procedure (EXEC/EXECUTE/CALL detected). Capture call graph for ` +
            `migration order.`,
        }),
      );
    }
  }

  // Triggers: dedicated `trigger_logic` + consolidated `hidden_business_logic`.
  for (const t of introspection.triggers) {
    const hasDml = bodyHasDml(t.actionStatement);
    out.push(
      buildTriggerLogicFinding({
        engineKey: 'sybase',
        schemaName: t.schemaName,
        triggerName: t.triggerName,
        tableSchema: t.tableSchema,
        tableName: t.tableName,
        timing: t.timing,
        events: t.events,
        body: t.actionStatement,
        bodyHasDml: hasDml,
      }),
    );
    out.push(
      buildHiddenBusinessLogicFinding({
        engineKey: 'sybase',
        sourceObjectType: 'trigger',
        schemaName: t.schemaName,
        objectName: t.triggerName,
        bodySnippet: t.actionStatement,
      }),
    );
  }

  // Sequences (Spec 2026-05-29). Optional IR field -> default to []. Spec
  // 2026-05-30 Group C: the current value (high-water mark) is carried in the
  // sequence payload too (null on the Sybase path -- the sidecar does not
  // surface a current value, TODO(oracle-W3)).
  for (const q of introspection.sequences ?? []) {
    out.push(
      buildSequenceDefinitionFinding({
        engineKey: 'sybase',
        schemaName: q.schemaName,
        sequenceName: q.sequenceName,
        dataType: q.dataType ?? null,
        startValue: q.startValue ?? null,
        increment: q.increment ?? null,
        minValue: q.minValue ?? null,
        maxValue: q.maxValue ?? null,
        cycle: q.cycle === true,
        currentValue: q.currentValue ?? null,
        ownedByTable: q.ownedByTable ?? null,
        ownedByColumn: q.ownedByColumn ?? null,
        definition: q.definition ?? null,
      }),
    );
  }

  return out;
}

/**
 * Emit a sequence cutover-hazard finding (Spec 2026-05-30 Data-Layer Fidelity
 * 2, Group C) per sequence. On the Sybase path the sidecar surfaces the
 * sequence shape but NO current-value column (TODO(oracle-W3)), so
 * `q.currentValue` is null and the finding is emitted with the value marked
 * UNAVAILABLE -- the book-of-work still learns the high-water mark must be
 * obtained out-of-band before cutover (recreating at START collides the first
 * post-cutover INSERT with existing PKs).
 */
function emitSequenceCutoverFindings(
  introspection: IntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const q of introspection.sequences ?? []) {
    out.push(
      buildSequenceCutoverHazardFinding({
        engineKey: 'sybase',
        schemaName: q.schemaName,
        sequenceName: q.sequenceName,
        currentValue: q.currentValue ?? null,
        startValue: q.startValue ?? null,
        ownedByTable: q.ownedByTable ?? null,
        ownedByColumn: q.ownedByColumn ?? null,
      }),
    );
  }
  return out;
}

/**
 * Emit a non-portable default-expression hazard finding (Spec 2026-05-30
 * Data-Layer Fidelity 2, Group D) for each column whose VERBATIM
 * `column_default` uses an engine-specific server built-in (`getdate()` /
 * `newid()` / `suser_name()` / `host_name()` etc.). On the Sybase SOURCE path
 * these T-SQL defaults are common. FLAG-ONLY: the captured default is carried
 * verbatim and NEVER rewritten; a portable literal default emits nothing.
 */
function emitNonPortableDefaultFindings(
  introspection: IntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const c of introspection.columns) {
    const detected = detectNonPortableDefault(c.defaultExpression);
    if (!detected) continue;
    out.push(
      buildNonPortableDefaultFinding({
        engineKey: 'sybase',
        schemaName: c.schemaName,
        tableName: c.tableName,
        columnName: c.columnName,
        // VERBATIM -- the captured expression is passed through unchanged.
        columnDefault: String(c.defaultExpression),
        detectedToken: detected.token,
        portabilityNote: detected.note,
      }),
    );
  }
  return out;
}

/**
 * Emit a cross-engine collation hazard finding (Spec 2026-05-30 Data-Layer
 * Fidelity 2, Group B). This is the PRIMARY direction: Sybase commonly
 * defaults to a case-INSENSITIVE sort order, which Postgres's case-SENSITIVE
 * default would not reproduce. Fires per column whose VERBATIM collation (read
 * from the sidecar where exposed) implies case-insensitivity. The captured
 * collation value is never mutated -- the hazard lives only in the finding.
 *
 * NOTE: the current Sybase sidecar does not yet project a per-column collation
 * (see sybaseSidecarClient / sybaseIntrospection TODO(oracle-W3)); until it
 * does, `c.collation` is undefined and this emits nothing. When the sidecar
 * surfaces collation/sort-order, this fires with no further code change.
 */
function emitCollationHazardFindings(
  introspection: IntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const c of introspection.columns) {
    if (!collationImpliesCaseInsensitive(c.collation)) continue;
    out.push(
      buildCollationHazardFinding({
        engineKey: 'sybase',
        schemaName: c.schemaName,
        tableName: c.tableName,
        columnName: c.columnName,
        collation: String(c.collation),
        databaseCollation: introspection.databaseCollation ?? null,
      }),
    );
  }
  return out;
}

/**
 * Emit unsupported_db_feature findings (Spec 2026-05-30 Data-Layer Fidelity 2,
 * Group F): genuinely-unsupported / non-portable DB-resident features. v1 fills
 * this with database-resident scheduled jobs / agents (the Sybase Job
 * Scheduler / `sp_add_job`-style agents) where the sidecar surfaces them. Each
 * job becomes a `db_resident_scheduled_job` Finding (procedural reality, NOT a
 * new entity type). PostgreSQL core ships no built-in scheduler, so these must
 * be recreated on the target via an equivalent mechanism.
 *
 * NOTE: the current Sybase sidecar does NOT yet project scheduler jobs (its
 * /introspect shape exposes no jobs array -- see sybaseSidecarClient
 * TODO(oracle-W3)), so `scheduledJobs` is empty and this emits nothing today.
 * When the sidecar surfaces the Job Scheduler, this fires with no further code
 * change. Empty `scheduledJobs` -> no finding.
 */
function emitUnsupportedFeatureFindings(
  introspection: IntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const j of introspection.scheduledJobs ?? []) {
    out.push(
      buildScheduledJobFinding({
        engineKey: 'sybase',
        schemaName: j.schemaName,
        jobName: j.jobName,
        scheduler: j.scheduler ?? null,
        schedule: j.schedule ?? null,
        command: j.command ?? null,
        enabled: j.enabled ?? null,
      }),
    );
  }
  return out;
}

/**
 * Human-readable label + the engine catalog source for each enrichment metadata
 * group, used to compose the evidence-gap Finding when a group is
 * `unavailable`. Keyed by the canonical {@link MetadataGroupKey}.
 */
const METADATA_GROUP_GAP_DETAIL: Partial<
  Record<MetadataGroupKey, { label: string; source: string }>
> = {
  collation: {
    label: 'column / database collation (sort-order / case-sensitivity)',
    source: 'the ASE syscolumns sort-order + database sort order',
  },
  computed_columns: {
    label: 'computed-column flag + expression',
    source: 'ASE syscolumns.status / syscomments',
  },
  sequence_current_value: {
    label: 'sequence / identity current value (allocation high-water mark)',
    source: 'the ASE sequence catalog / ident_current() / a MAX(col) scan',
  },
  fk_actions: {
    label: 'foreign-key referential actions (on delete / on update)',
    source: 'ASE sysreferences / sysconstraints',
  },
  index_clustering: {
    label: 'index ordering / clustering metadata',
    source: 'ASE sysindexes status bits + key column order',
  },
  db_jobs: {
    label: 'database-resident scheduled jobs (Job Scheduler)',
    source: 'the ASE Job Scheduler catalog / read-only job procs',
  },
  native_sequence: {
    label: 'native SEQUENCE objects',
    source: 'the ASE16 SEQUENCE catalog',
  },
};

/**
 * Emit a `db_schema_metadata_gap` evidence-gap Finding for each enrichment
 * metadata group whose three-state applicability resolved to `unavailable`
 * (Spec 2026-05-31, decision 2). This is the `TODO(oracle-W3)` evidence-gap
 * surface for the enrichment groups.
 *
 * The whole point of the three-state model: a group resolved to
 * `not_applicable_for_engine` (ASE structurally lacks it -- the partial-index
 * predicate; native SEQUENCE pre-ASE16) is SUPPRESSED here (no evidence gap, no
 * noise for reconciliation) while a genuine `unavailable` group (engine supports
 * it and/or the sidecar advertised the capability but the value could not be
 * read -- INCLUDING an absent capability from an older sidecar) still surfaces
 * the gap. `present` groups emit nothing. When the IR carries no applicability
 * map at all (a producer that did not resolve it), this emits nothing and the
 * pre-existing hazard findings (which carry their own value-unavailable flags)
 * are unchanged.
 */
function emitMetadataEvidenceGapFindings(
  introspection: IntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  const applicability = introspection.metadataApplicability;
  if (!applicability) return out;
  // `index_predicate` is always `not_applicable_for_engine` for ASE and has no
  // gap detail -- it is intentionally omitted from METADATA_GROUP_GAP_DETAIL so
  // the structural N/A is never even a candidate for an evidence gap.
  for (const [group, detail] of Object.entries(METADATA_GROUP_GAP_DETAIL)) {
    const state: MetadataApplicability | undefined =
      applicability[group as MetadataGroupKey];
    // SUPPRESS for present / not_applicable_for_engine; only `unavailable`
    // (and an absent map entry, treated as unavailable) emits the gap.
    if (state === 'present' || state === 'not_applicable_for_engine') continue;
    if (!detail) continue;
    out.push(
      buildDbEvidenceGapFinding({
        engineKey: 'sybase',
        gapType: 'db_schema_metadata_gap',
        objectName: '',
        gapDescription:
          `The ${detail.label} could NOT be read for this Sybase source ` +
          `(${detail.source}). The value is genuinely UNAVAILABLE -- either this ` +
          `sidecar build does not yet surface the group, or it surfaced the ` +
          `capability but the value was unreadable. Obtain it out-of-band before ` +
          `migration. (This is a real read gap, NOT a structural ` +
          `not-applicable-for-engine case.) TODO(oracle-W3).`,
      }),
    );
  }
  return out;
}

/**
 * Walk all inputs and return the full finding list for the run. Order is
 * deterministic (structural -> profile -> relationship -> hidden logic ->
 * collation -> non-portable default -> sequence cutover -> unsupported) so test
 * snapshots are stable.
 */
export function buildAllSybaseFindings(
  introspection: IntrospectionResult,
  profile: ProfileResult,
  relationships: RelationshipInference[],
): FindingEmitInput[] {
  return [
    ...emitStructuralFindings(introspection),
    ...emitProfileFindings(profile),
    ...emitRelationshipFindings(relationships),
    ...emitHiddenLogicFindings(introspection),
    ...emitCollationHazardFindings(introspection),
    ...emitNonPortableDefaultFindings(introspection),
    ...emitSequenceCutoverFindings(introspection),
    ...emitUnsupportedFeatureFindings(introspection),
    ...emitMetadataEvidenceGapFindings(introspection),
  ];
}

// Re-export internals for unit tests.
export const __testOnly = {
  bodyHasDml,
  bodyHasProcCall,
  isComplexViewDefinition,
  emitStructuralFindings,
  emitProfileFindings,
  emitRelationshipFindings,
  emitHiddenLogicFindings,
  emitCollationHazardFindings,
  emitNonPortableDefaultFindings,
  emitSequenceCutoverFindings,
  emitUnsupportedFeatureFindings,
  emitMetadataEvidenceGapFindings,
};
