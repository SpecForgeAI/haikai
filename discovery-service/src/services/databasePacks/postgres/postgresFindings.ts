/**
 * PostgreSQL pack -- finding emission.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 3.
 *
 * Walks the introspection + profile + relationship results and emits the
 * `FindingEmitInput[]` list to the orchestrator. The orchestrator (not this
 * module) caps per-finding-type, dedupes, and forwards through the
 * singleton `FindingEmitter`.
 *
 * Snippet redaction (view bodies, procedure bodies, trigger bodies) is
 * applied INSIDE this module before the snippet reaches a `detailJson`
 * payload. The builders in `databasePackFindingBuilders` apply a defensive
 * second redact as a safety net.
 *
 * Finding types emitted (per spec.md "DB Finding Types" + Group 3 scope):
 *  - missing_primary_key           (structural)
 *  - no_foreign_keys_declared      (structural)
 *  - inferred_relationship         (from relationship inference)
 *  - ambiguous_relationship        (from relationship inference)
 *  - large_table                   (rowCount > 1M)
 *  - empty_table                   (rowCount = 0)
 *  - sparse_column                 (very few non-null values)
 *  - high_null_rate                (nullRate > 0.8)
 *  - sample_data_hint              (info, per-table sample summary)
 *  - sentinel_value_detected       (data quality, when profile flagged one)
 *  - db_migration_risk             (consolidated: view_dependency,
 *                                   complex_view_logic, etc.)
 *  - stored_procedure_logic        (per procedure)
 *  - hidden_business_logic         (per trigger; per procedure with DML)
 *  - procedure_data_write          (procedure body contains INSERT/UPDATE/
 *                                   DELETE/MERGE)
 *  - procedure_dependency          (procedure body calls another via
 *                                   PERFORM/EXECUTE)
 *  - non_portable_default          (Spec 2026-05-30 Group D: getdate()/newid()…)
 *  - sequence_cutover_hazard       (Spec 2026-05-30 Group C: high-water mark)
 *  - db_resident_scheduled_job     (Spec 2026-05-30 Group F: pg_cron / pgAgent)
 *  - unsupported_db_feature        (partitioning / foreign tables / etc.)
 *  - evidence_gap (gapType=db_*)   (one per skipped table from the profiler)
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
  ProfileResult,
  RelationshipInference,
  TableMetadata,
} from '../types';

/**
 * Detect DML statements inside a routine body. Used to decide whether to
 * emit `hidden_business_logic` (writes) vs. `stored_procedure_logic` only.
 */
function bodyHasDml(body: string): boolean {
  if (!body) return false;
  return /\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(body);
}

/**
 * Detect calls to other procedures inside a routine body. Used to emit
 * `procedure_dependency` findings.
 */
function bodyHasProcCall(body: string): boolean {
  if (!body) return false;
  return /\b(PERFORM|EXECUTE|CALL)\b/i.test(body);
}

/**
 * `db_migration_risk` is consolidated per D6: this helper decides whether a
 * view definition is "complex" enough to warrant a finding. The thresholds
 * are intentionally conservative -- the operator is the one who decides what
 * to keep.
 */
function isComplexViewDefinition(definition: string): boolean {
  if (!definition) return false;
  const lines = definition.split(/\r?\n/).length;
  const joins = (definition.match(/\bJOIN\b/gi) ?? []).length;
  const windowFuncs = (definition.match(/\bOVER\s*\(/gi) ?? []).length;
  return lines > 40 || joins > 3 || windowFuncs > 0;
}

/**
 * Find the set of tables with at least one declared FK.
 */
function tablesWithFks(introspection: IntrospectionResult): Set<string> {
  const out = new Set<string>();
  for (const k of introspection.keysAndIndexes) {
    if (k.kind === 'foreign_key') {
      out.add(`${k.schemaName}.${k.tableName}`);
    }
  }
  return out;
}

/**
 * Find the set of tables with a primary key.
 */
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
 * Build a sample-data-hint finding (info severity). Carries a redacted
 * sampleValues array for the table's columns.
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
    title: `Sample values [postgres]: ${objectIdentity}`,
    summary:
      `Sample values captured for ${Object.keys(args.samplePayload).length} ` +
      `columns of '${objectIdentity}'. Use to confirm column semantics.`,
    detailJson: {
      engineKey: 'postgres',
      schemaName: args.schemaName,
      tableName: args.tableName,
      samplePayload: args.samplePayload,
    },
    source: 'db_discovery_pack',
    createdByStage: 'postgresDiscoveryPack.findings.sampleDataHint',
    links: [],
  };
}

/**
 * Build a sentinel-value-detected finding (low severity, per (table, column)).
 */
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
    title: `Sentinel value [postgres]: ${objectIdentity}`,
    summary:
      `Column '${objectIdentity}' contains a sentinel placeholder ` +
      `(e.g. 9999-12-31, -1). Review for migration-time data cleanup.`,
    detailJson: {
      engineKey: 'postgres',
      schemaName: args.schemaName,
      tableName: args.tableName,
      columnName: args.columnName,
    },
    source: 'db_discovery_pack',
    createdByStage: 'postgresDiscoveryPack.findings.sentinelValue',
    links: [],
  };
}

/**
 * Generic finding shape for the lower-frequency types not covered by the
 * builders. Keeps the same source / createdByStage discipline.
 */
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
    title: `${args.findingType.replace(/_/g, ' ')} [postgres]: ${objectIdentity}`,
    summary: args.summary,
    detailJson: {
      engineKey: 'postgres',
      schemaName: args.schemaName,
      tableName: args.tableName ?? null,
      columnName: args.columnName ?? null,
      ...(args.detailJson ?? {}),
    },
    source: 'db_discovery_pack',
    createdByStage: `postgresDiscoveryPack.findings.${args.findingType}`,
    links: [],
  };
}

/**
 * Walk the structural inputs and emit primary-key + foreign-key findings.
 */
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
          engineKey: 'postgres',
          schemaName: t.schemaName,
          tableName: t.tableName,
          estimatedRowCount: t.estimatedRowCount ?? null,
        }),
      );
    }
    if (!fks.has(key)) {
      out.push(
        buildNoForeignKeysDeclaredFinding({
          engineKey: 'postgres',
          schemaName: t.schemaName,
          tableName: t.tableName,
        }),
      );
    }
  }
  return out;
}

/**
 * Emit relationship-inference findings: inferred / ambiguous. Declared FKs
 * do NOT produce findings here (they are facts, not advisories).
 */
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
        title: `Ambiguous relationship [postgres]: ${r.fromSchema}.${r.fromTable}(${r.fromColumns.join(',')})`,
        summary: r.rationale ?? 'Multiple plausible parent tables.',
        confidence: r.confidence,
        detailJson: {
          engineKey: 'postgres',
          from: {
            schemaName: r.fromSchema,
            tableName: r.fromTable,
            columns: r.fromColumns,
          },
          competingTargets: r.competingTargets ?? [],
        },
        source: 'db_discovery_pack',
        createdByStage: 'postgresDiscoveryPack.findings.ambiguousRelationship',
        links: [],
      });
    } else if (r.kind === 'inferred') {
      out.push(
        buildInferredRelationshipFinding({
          engineKey: 'postgres',
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

/**
 * Emit profile-driven findings: row count thresholds, null rates, samples.
 */
function emitProfileFindings(
  profile: ProfileResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const t of profile.tables) {
    // large_table / empty_table
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
              `staging table, a future feature, or dead.`,
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
    // High null rate per column.
    const samplePayload: Record<string, string[]> = {};
    for (const c of t.columnProfiles) {
      if (c.nullRate !== null && c.nullRate !== undefined && c.nullRate > 0.8) {
        out.push(
          buildHighNullRateFinding({
            engineKey: 'postgres',
            schemaName: c.schemaName,
            tableName: c.tableName,
            columnName: c.columnName,
            nullRate: c.nullRate,
            rowsObserved: t.rowCount ?? undefined,
          }),
        );
      }
      // sparse_column: very few non-null values relative to row count.
      // Triggered when rowCount > 100 AND nullRate is between 0.6 and 0.8
      // (above 0.8 is covered by high_null_rate already).
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
      // sentinel_value_detected -- one finding per column the profiler flagged.
      if (c.sentinelDetected) {
        out.push(
          buildSentinelValueFinding({
            schemaName: c.schemaName,
            tableName: c.tableName,
            columnName: c.columnName,
          }),
        );
      }
      // Accumulate the per-column sample list for the per-table hint finding.
      if (c.sampleValues && c.sampleValues.length > 0) {
        samplePayload[c.columnName] = c.sampleValues;
      }
    }
    // One sample_data_hint per table (info severity).
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
  // Skipped tables -> evidence_gap findings.
  for (const skip of profile.skippedTables) {
    out.push(
      buildDbEvidenceGapFinding({
        engineKey: 'postgres',
        gapType: 'db_unreadable_object',
        objectName: `${skip.schemaName}.${skip.tableName}`,
        gapDescription:
          `Profile attempt failed for '${skip.schemaName}.${skip.tableName}': ${skip.reason}`,
      }),
    );
  }
  return out;
}

/**
 * Emit findings for views, procedures, and triggers (D7: findings + evidence
 * only; no business_logics / data_movements candidates).
 */
function emitHiddenLogicFindings(
  introspection: IntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];

  // Views: emit a `view_definition` finding for EVERY view (captures the
  // COMPLETE verbatim defining SQL), AND keep the consolidated
  // `db_migration_risk` (`complex_view_logic`) signal for complex views so the
  // existing vocabulary is preserved. The body is passed RAW -- the builders
  // apply the full-body redaction + ~64KB cap internally (no 200-char cap).
  for (const v of introspection.views) {
    const complex = isComplexViewDefinition(v.definition);
    out.push(
      buildViewDefinitionFinding({
        engineKey: 'postgres',
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
          engineKey: 'postgres',
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

  // Procedures + functions. Pass the RAW body to the builders; they redact +
  // size-cap the full body internally.
  for (const p of introspection.procedures) {
    const hasDml = bodyHasDml(p.body);
    // Always emit a `stored_procedure_logic` finding.
    out.push(
      buildStoredProcedureLogicFinding({
        engineKey: 'postgres',
        schemaName: p.schemaName,
        procedureName: p.procedureName,
        routineKind: p.routineKind,
        bodySnippet: p.body,
        language: p.language ?? undefined,
        // Group G (Spec 2026-05-30): fuller capture ALONGSIDE the body so an
        // overloaded / SECURITY DEFINER function is recreatable. Verbatim.
        fullDefinition: p.fullDefinition ?? null,
        arguments: p.arguments ?? null,
        returnType: p.returnType ?? null,
        volatility: p.volatility ?? null,
        securityDefiner: p.securityDefiner ?? null,
      }),
    );
    if (hasDml) {
      // Procedures that write data: emit BOTH hidden_business_logic AND
      // procedure_data_write so the Findings tab carries the dedicated
      // signal as well as the consolidated one.
      out.push(
        buildHiddenBusinessLogicFinding({
          engineKey: 'postgres',
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
            `procedure (PERFORM/EXECUTE/CALL detected). Capture call graph for ` +
            `migration order.`,
        }),
      );
    }
  }

  // Triggers: emit a dedicated `trigger_logic` finding (complete verbatim body
  // + the table it fires on), AND keep the consolidated `hidden_business_logic`
  // signal so the existing vocabulary is preserved. Risk-weighted by whether
  // the body writes data, NOT blanket INFO.
  for (const t of introspection.triggers) {
    const hasDml = bodyHasDml(t.actionStatement);
    out.push(
      buildTriggerLogicFinding({
        engineKey: 'postgres',
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
        engineKey: 'postgres',
        sourceObjectType: 'trigger',
        schemaName: t.schemaName,
        objectName: t.triggerName,
        bodySnippet: t.actionStatement,
      }),
    );
  }

  // Sequences: emit a `sequence_definition` finding per sequence (Spec
  // 2026-05-29). Optional IR field -> default to []. Spec 2026-05-30 Group C:
  // the current value (high-water mark) is carried in the sequence payload too.
  for (const q of introspection.sequences ?? []) {
    out.push(
      buildSequenceDefinitionFinding({
        engineKey: 'postgres',
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
 * Emit a cross-engine collation hazard finding (Spec 2026-05-30 Data-Layer
 * Fidelity 2, Group B) for each column whose VERBATIM collation implies
 * case-INSENSITIVE matching that Postgres's case-SENSITIVE default would not
 * reproduce. On the Postgres SOURCE path this fires for a column carrying an
 * explicitly case-insensitive collation; the same builder is reused on the
 * Sybase source path (where the default sort order is commonly CI). The stored
 * `column_default` / `collation` values are never mutated -- the hazard lives
 * only in the finding.
 */
function emitCollationHazardFindings(
  introspection: IntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const c of introspection.columns) {
    if (!collationImpliesCaseInsensitive(c.collation)) continue;
    out.push(
      buildCollationHazardFinding({
        engineKey: 'postgres',
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
 * Emit a non-portable default-expression hazard finding (Spec 2026-05-30
 * Data-Layer Fidelity 2, Group D) for each column whose VERBATIM
 * `column_default` uses an engine-specific server built-in (`getdate()` /
 * `newid()` / `suser_name()` / `host_name()` etc.) that Postgres does not
 * reproduce identically. FLAG-ONLY: the captured default is carried verbatim in
 * the finding and is NEVER rewritten. A plain literal / portable default emits
 * nothing.
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
        engineKey: 'postgres',
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
 * Emit a sequence cutover-hazard finding (Spec 2026-05-30 Data-Layer Fidelity
 * 2, Group C) per sequence: recreating the target sequence at its START rather
 * than its current high-water mark would collide the first post-cutover INSERT
 * with an existing PK. Fires for every introspected sequence; carries the
 * VERBATIM current value (or value-unavailable when the engine / sidecar does
 * not expose it -- e.g. Sybase TODO(oracle-W3)).
 */
function emitSequenceCutoverFindings(
  introspection: IntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const q of introspection.sequences ?? []) {
    out.push(
      buildSequenceCutoverHazardFinding({
        engineKey: 'postgres',
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
 * Emit unsupported_db_feature findings (Spec 2026-05-30 Data-Layer Fidelity 2,
 * Group F): genuinely-unsupported / non-portable DB-resident features. v1 fills
 * this with database-resident scheduled jobs / agents (pg_cron / pgAgent) --
 * PostgreSQL core ships no built-in scheduler, so a source-side scheduled job
 * is procedural reality that does NOT travel with a static schema migration.
 * Each job becomes a `db_resident_scheduled_job` Finding (procedural reality,
 * NOT a new entity type). Empty `scheduledJobs` -> no finding.
 */
function emitUnsupportedFeatureFindings(
  introspection: IntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const j of introspection.scheduledJobs ?? []) {
    out.push(
      buildScheduledJobFinding({
        engineKey: 'postgres',
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
 * Walk all inputs and return the full finding list for the run. Order is
 * deterministic (structural -> profile -> relationship -> hidden logic ->
 * collation -> non-portable default -> sequence cutover -> unsupported) so test
 * snapshots are stable.
 */
export function buildAllPostgresFindings(
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
  ];
}

// Re-export internals for unit tests.
export const __testOnly = {
  bodyHasDml,
  bodyHasProcCall,
  isComplexViewDefinition,
  emitStructuralFindings,
  emitRelationshipFindings,
  emitProfileFindings,
  emitHiddenLogicFindings,
  emitCollationHazardFindings,
  emitNonPortableDefaultFindings,
  emitSequenceCutoverFindings,
  emitUnsupportedFeatureFindings,
};

// `TableMetadata` is used only as a type reference for the JSDoc above; the
// re-import keeps `tsc --noEmit` from flagging the import as unused when the
// file is consumed by the orchestrator.
export type _UnusedTableMetadataRef = TableMetadata;
