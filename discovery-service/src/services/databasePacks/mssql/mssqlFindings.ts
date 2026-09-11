/**
 * SQL Server pack -- finding emission.
 *
 * Spec: SQL Server 16 -> PostgreSQL 18 pair programme, Spec 2 (2026-09-11),
 * task 2.1. Design of record:
 * `agent-os/planning/2026-09-11-sqlserver-postgres-pair-shaping.md` §3 (owner
 * rulings, in particular which hard items are IN and which two are OUT) and
 * §5 (hard-item designs).
 *
 * Mirrors `sybaseFindings.ts` emitter for emitter, so the Findings tab needs
 * no engine-specific branch and a Sybase-trained reviewer reads a SQL Server
 * scan without relearning anything. On top of that mirror it adds the
 * SQL-Server-only findings the shaping doc's item 5 (objects with no
 * like-for-like shape) and items 1 + 6 (the two OUT rulings) require.
 *
 * Engine-specific conventions:
 *   - `createdByStage` uses `mssqlDiscoveryPack.findings.*` so AMS-side
 *     filters can distinguish SQL-Server-origin findings.
 *   - `METADATA_GROUP_GAP_DETAIL` names the `sys.*` catalog each group is
 *     read from, so an evidence gap says exactly what could not be read.
 *   - Snippet redaction is applied by the shared builders; the generic
 *     builder here applies it defensively to any body it carries itself.
 *
 * THE TWO OUT RULINGS (shaping §3 ruling 3). Cross-database / linked-server
 * references and indexed views are NOT translated by this tool. They are
 * never attempted and never silent: each gets a finding carrying a NAMED
 * untranslatable reason (`cross_database_reference` / `indexed_view`) so the
 * book-of-work shows the object, the reason, and what the owner must decide.
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
import { redactSnippet } from '../../../utils/snippetRedaction';
import type {
  MetadataApplicability,
  MetadataGroupKey,
  ProfileResult,
  RelationshipInference,
} from '../types';
import type {
  MssqlColumnExtras,
  MssqlIntrospectionResult,
} from './mssqlIntrospection';

/** Engine key used on every finding this module emits. */
const ENGINE = 'mssql' as const;

/** Snippet cap for the bodies this module carries itself. */
const BODY_SNIPPET_CAP = 4000;

/**
 * The two OUT rulings' named untranslatable reasons (shaping §3 ruling 3).
 * These strings are the contract the downstream pack generator and the
 * book-of-work key on -- NEVER free text.
 */
export const MSSQL_UNTRANSLATABLE_REASON = {
  crossDatabaseReference: 'cross_database_reference',
  indexedView: 'indexed_view',
} as const;

/**
 * Detect DML statements (case-insensitive) inside a routine body.
 */
function bodyHasDml(body: string): boolean {
  if (!body) return false;
  return /\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(body);
}

/**
 * Detect procedure-call patterns inside a routine body. T-SQL uses
 * EXEC / EXECUTE / CALL.
 */
function bodyHasProcCall(body: string): boolean {
  if (!body) return false;
  return /\b(EXEC|EXECUTE|CALL)\b/i.test(body);
}

/**
 * Complex view heuristic (line count + join count + window function count).
 * Same thresholds as the other packs so "complex" means one thing.
 */
function isComplexViewDefinition(definition: string): boolean {
  if (!definition) return false;
  const lines = definition.split(/\r?\n/).length;
  const joins = (definition.match(/\bJOIN\b/gi) ?? []).length;
  const windowFuncs = (definition.match(/\bOVER\s*\(/gi) ?? []).length;
  return lines > 40 || joins > 3 || windowFuncs > 0;
}

/** One name part: a bare identifier or a `[bracketed]` / `"quoted"` one. */
const NAME_PART = '(?:[A-Za-z_][A-Za-z0-9_$#@]*|\\[[^\\]]+\\]|"[^"]+")';

/**
 * Keywords after which a multi-part name is unambiguously an OBJECT
 * reference rather than a column reference. This is the whole reason the
 * detector is keyword-anchored: in T-SQL `Sales.Customers.CustomerID` is a
 * perfectly ordinary THREE-part COLUMN reference inside the current
 * database, so a bare three-dot scan would flag half a normal codebase.
 */
const OBJECT_REF_KEYWORDS =
  '(?:from|join|apply|into|update|delete\\s+from|insert\\s+into|insert|merge|exec|execute|references|truncate\\s+table)';

/**
 * Find cross-database / linked-server references in a routine or view body
 * (shaping §3 ruling 3, item 1 = OUT). Four shapes matter on SQL Server:
 *
 *   - a THREE-part name in OBJECT position (`... FROM OtherDb.dbo.Table`)
 *   - a FOUR-part name anywhere (`Srv.Db.dbo.Table`) -- four parts can only
 *     ever be `server.database.schema.object`, so no keyword anchor is needed
 *   - the `OtherDb..Table` double-dot shorthand anywhere -- an empty middle
 *     segment is impossible in a column reference
 *   - an explicit `OPENQUERY` / `OPENROWSET` / `OPENDATASOURCE` call
 *
 * Deliberate NON-matches: two-part names (`Sales.Customers`, `sys.indexes`)
 * are the normal in-database case, and a three-part name NOT in object
 * position is read as a fully-qualified COLUMN reference, which stays inside
 * the database.
 *
 * Returns the distinct reference tokens found, capped so a pathological body
 * cannot blow up a finding payload.
 */
export function findCrossDatabaseReferences(body: string): string[] {
  if (!body) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (token: string): void => {
    const t = token.trim().replace(/[,;)]+$/, '');
    if (t.length === 0) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    // A four-part name contains a three-part prefix, so the keyword-anchored
    // three-part scan re-finds `Srv.Db.dbo` inside `Srv.Db.dbo.Thing`. Keep
    // only the LONGEST form: a prefix of an already-recorded reference is the
    // same reference, and listing both would overstate the finding.
    for (const existing of seen) {
      if (existing.startsWith(`${key}.`)) return;
    }
    seen.add(key);
    if (out.length < 25) out.push(t);
  };
  let m: RegExpExecArray | null;
  // (1) Four-part `server.database.schema.object` -- unambiguous anywhere.
  const fourPartRe = new RegExp(
    `\\b${NAME_PART}\\.${NAME_PART}\\.${NAME_PART}\\.${NAME_PART}\\b`,
    'g',
  );
  while ((m = fourPartRe.exec(body)) !== null) push(m[0]);
  // (2) Three-part name in OBJECT position.
  const threePartRe = new RegExp(
    `\\b${OBJECT_REF_KEYWORDS}\\s+(${NAME_PART}\\.${NAME_PART}\\.${NAME_PART})\\b`,
    'gi',
  );
  while ((m = threePartRe.exec(body)) !== null) push(m[1]);
  // (3) The `OtherDb..Table` double-dot shorthand -- an empty middle segment
  //     cannot occur in a column reference, so it needs no keyword anchor.
  const doubleDotRe = new RegExp(`\\b${NAME_PART}\\.\\.${NAME_PART}\\b`, 'g');
  while ((m = doubleDotRe.exec(body)) !== null) push(m[0]);
  // (4) Distributed-query functions -- always a linked server or an ad-hoc
  //     external data source.
  const openRe = /\b(OPENQUERY|OPENROWSET|OPENDATASOURCE)\s*\(/gi;
  while ((m = openRe.exec(body)) !== null) push(m[1].toUpperCase());
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
    title: `Sample values [${ENGINE}]: ${objectIdentity}`,
    summary:
      `Sample values captured for ${Object.keys(args.samplePayload).length} ` +
      `columns of '${objectIdentity}'. Use to confirm column semantics.`,
    detailJson: {
      engineKey: ENGINE,
      schemaName: args.schemaName,
      tableName: args.tableName,
      samplePayload: args.samplePayload,
    },
    source: 'db_discovery_pack',
    createdByStage: 'mssqlDiscoveryPack.findings.sampleDataHint',
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
    title: `Sentinel value [${ENGINE}]: ${objectIdentity}`,
    summary:
      `Column '${objectIdentity}' contains a sentinel placeholder. ` +
      `Review for migration-time data cleanup.`,
    detailJson: {
      engineKey: ENGINE,
      schemaName: args.schemaName,
      tableName: args.tableName,
      columnName: args.columnName,
    },
    source: 'db_discovery_pack',
    createdByStage: 'mssqlDiscoveryPack.findings.sentinelValue',
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
    title: `${args.findingType.replace(/_/g, ' ')} [${ENGINE}]: ${objectIdentity}`,
    summary: args.summary,
    detailJson: {
      engineKey: ENGINE,
      schemaName: args.schemaName,
      tableName: args.tableName ?? null,
      columnName: args.columnName ?? null,
      ...(args.detailJson ?? {}),
    },
    source: 'db_discovery_pack',
    createdByStage: `mssqlDiscoveryPack.findings.${args.findingType}`,
    links: [],
  };
}

// -----------------------------------------------------------------------------
// Mirror of the Sybase emitter set
// -----------------------------------------------------------------------------

function emitStructuralFindings(
  introspection: MssqlIntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  const pks = new Set<string>();
  const fks = new Set<string>();
  for (const k of introspection.keysAndIndexes) {
    if (k.kind === 'primary_key') pks.add(`${k.schemaName}.${k.tableName}`);
    if (k.kind === 'foreign_key') fks.add(`${k.schemaName}.${k.tableName}`);
  }
  for (const t of introspection.tables) {
    const key = `${t.schemaName}.${t.tableName}`;
    if (!pks.has(key)) {
      out.push(
        buildMissingPrimaryKeyFinding({
          engineKey: ENGINE,
          schemaName: t.schemaName,
          tableName: t.tableName,
          estimatedRowCount: t.estimatedRowCount ?? null,
        }),
      );
    }
    if (!fks.has(key)) {
      out.push(
        buildNoForeignKeysDeclaredFinding({
          engineKey: ENGINE,
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
        title: `Ambiguous relationship [${ENGINE}]: ${r.fromSchema}.${r.fromTable}(${r.fromColumns.join(',')})`,
        summary: r.rationale ?? 'Multiple plausible parent tables.',
        confidence: r.confidence,
        detailJson: {
          engineKey: ENGINE,
          from: {
            schemaName: r.fromSchema,
            tableName: r.fromTable,
            columns: r.fromColumns,
          },
          competingTargets: r.competingTargets ?? [],
        },
        source: 'db_discovery_pack',
        createdByStage: 'mssqlDiscoveryPack.findings.ambiguousRelationship',
        links: [],
      });
    } else if (r.kind === 'inferred') {
      out.push(
        buildInferredRelationshipFinding({
          engineKey: ENGINE,
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
      if (c.nullRate !== null && c.nullRate !== undefined && c.nullRate > 0.8) {
        out.push(
          buildHighNullRateFinding({
            engineKey: ENGINE,
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
        engineKey: ENGINE,
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
  introspection: MssqlIntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];

  for (const v of introspection.views) {
    const complex = isComplexViewDefinition(v.definition);
    out.push(
      buildViewDefinitionFinding({
        engineKey: ENGINE,
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
          engineKey: ENGINE,
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
        engineKey: ENGINE,
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
          engineKey: ENGINE,
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

  for (const t of introspection.triggers) {
    const hasDml = bodyHasDml(t.actionStatement);
    out.push(
      buildTriggerLogicFinding({
        engineKey: ENGINE,
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
        engineKey: ENGINE,
        sourceObjectType: 'trigger',
        schemaName: t.schemaName,
        objectName: t.triggerName,
        bodySnippet: t.actionStatement,
      }),
    );
  }

  for (const q of introspection.sequences ?? []) {
    out.push(
      buildSequenceDefinitionFinding({
        engineKey: ENGINE,
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
 * Sequence cutover-hazard per sequence. Unlike the ASE path -- where the
 * sidecar cannot read a current value and the finding is marked
 * value-unavailable -- SQL Server's `sys.sequences.current_value` is a plain
 * catalog column, so the high-water mark is genuinely present and the target
 * sequence can be advanced past it.
 */
function emitSequenceCutoverFindings(
  introspection: MssqlIntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const q of introspection.sequences ?? []) {
    out.push(
      buildSequenceCutoverHazardFinding({
        engineKey: ENGINE,
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
 * Non-portable default-expression hazard per column. On SQL Server these are
 * everywhere -- `sysdatetime()`, `getdate()`, `newid()`, `suser_sname()` --
 * and, unlike ASE, the DEFAULT is a NAMED constraint whose name the target
 * must reproduce if scripts reference it. The name is carried in the payload;
 * the expression itself is VERBATIM and never rewritten.
 */
function emitNonPortableDefaultFindings(
  introspection: MssqlIntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const c of introspection.columns) {
    const detected = detectNonPortableDefault(c.defaultExpression);
    if (!detected) continue;
    out.push(
      buildNonPortableDefaultFinding({
        engineKey: ENGINE,
        schemaName: c.schemaName,
        tableName: c.tableName,
        columnName: c.columnName,
        columnDefault: String(c.defaultExpression),
        detectedToken: detected.token,
        portabilityNote: detected.note,
      }),
    );
  }
  return out;
}

/**
 * Cross-engine collation hazard per column. This is THE primary direction for
 * this pair (shaping §3 ruling 3, hard item 2): a SQL Server estate almost
 * always defaults to a `_CI_` (case-insensitive) collation, which Postgres's
 * case-SENSITIVE default would not reproduce -- `WHERE name = 'smith'`
 * silently stops matching `'Smith'`. Fires per column whose VERBATIM
 * collation implies case-insensitivity. The captured value is never mutated.
 *
 * A column with NO explicit collation inherits the database default, so when
 * the DATABASE collation is case-insensitive every string column in the
 * estate is affected -- the database-level hazard below states that once,
 * rather than emitting a per-column finding for a value the catalog never
 * reported.
 */
function emitCollationHazardFindings(
  introspection: MssqlIntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const c of introspection.columns) {
    if (!collationImpliesCaseInsensitive(c.collation)) continue;
    out.push(
      buildCollationHazardFinding({
        engineKey: ENGINE,
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
 * Database-resident scheduled jobs. On SQL Server these are SQL Server Agent
 * jobs read from `msdb`; each carries its ordered steps and its schedule so
 * the book-of-work can re-home it (PostgreSQL core ships no scheduler --
 * `pg_cron` is the documented target-side prerequisite).
 */
function emitUnsupportedFeatureFindings(
  introspection: MssqlIntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const j of introspection.scheduledJobs ?? []) {
    out.push(
      buildScheduledJobFinding({
        engineKey: ENGINE,
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

// -----------------------------------------------------------------------------
// SQL-Server-only findings (shaping §3 ruling 3, items 1 / 5 / 6)
// -----------------------------------------------------------------------------

/**
 * Temporal (system-versioned) tables -- shaping §5 item 5. PostgreSQL has no
 * `SYSTEM_VERSIONING`, so the emulation the tool BUILDS is: history table +
 * a `SYSTEM_TIME` trigger pair + `FOR SYSTEM_TIME` rewrite guidance. The
 * finding carries the period columns and the history-table name so the
 * emulation has everything it needs; the HISTORY half of the pair is flagged
 * too, because migrating it as an ordinary table would double-carry the rows.
 */
function emitTemporalTableFindings(
  introspection: MssqlIntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const t of introspection.mssql.tables) {
    if (t.temporalType === null) continue;
    const isCurrent = t.temporalType === 'system_versioned';
    out.push(
      buildGenericDbFinding({
        findingType: 'temporal_table_detected',
        category: 'migration_risk',
        severity: isCurrent ? 'high' : 'medium',
        schemaName: t.schemaName,
        tableName: t.tableName,
        summary: isCurrent
          ? `Table '${t.schemaName}.${t.tableName}' is SYSTEM_VERSIONED ` +
            `(period ${t.periodStartColumn ?? '?'} .. ${t.periodEndColumn ?? '?'}, ` +
            `history table '${t.historyTable ?? 'unknown'}'). PostgreSQL has no ` +
            `SYSTEM_VERSIONING: the tool emulates it with a history table plus a ` +
            `SYSTEM_TIME trigger pair, and FOR SYSTEM_TIME queries are rewritten.`
          : `Table '${t.schemaName}.${t.tableName}' is the HISTORY table of a ` +
            `system-versioned pair. It migrates as part of the temporal ` +
            `emulation, NOT as a standalone table -- migrating it separately ` +
            `would double-carry the versioned rows.`,
        detailJson: {
          temporalType: t.temporalType,
          historyTable: t.historyTable,
          periodStartColumn: t.periodStartColumn,
          periodEndColumn: t.periodEndColumn,
        },
      }),
    );
  }
  return out;
}

/** Memory-optimized (In-Memory OLTP) tables -- no PostgreSQL equivalent. */
function emitMemoryOptimizedFindings(
  introspection: MssqlIntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const t of introspection.mssql.tables) {
    if (!t.isMemoryOptimized) continue;
    out.push(
      buildGenericDbFinding({
        findingType: 'memory_optimized_table',
        category: 'migration_risk',
        severity: 'medium',
        schemaName: t.schemaName,
        tableName: t.tableName,
        summary:
          `Table '${t.schemaName}.${t.tableName}' is MEMORY_OPTIMIZED ` +
          `(In-Memory OLTP). PostgreSQL has no equivalent storage engine: the ` +
          `table migrates as an ordinary heap table, so the latency profile ` +
          `and the lock-free concurrency semantics change. Confirm the ` +
          `workload tolerates it.`,
        detailJson: { isMemoryOptimized: true, isFiletable: t.isFiletable },
      }),
    );
  }
  return out;
}

/**
 * Per-column type / storage hazards -- shaping §5 item 5. One pass over the
 * column extras emits every column-shaped finding so the ordering is stable
 * and a column that trips two of them (a FILESTREAM `varbinary(max)`, say)
 * emits both.
 */
function emitColumnFeatureFindings(
  introspection: MssqlIntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  const emit = (
    c: MssqlColumnExtras,
    findingType: string,
    severity: 'info' | 'low' | 'medium' | 'high' | 'critical',
    summary: string,
    detail?: Record<string, unknown>,
  ): void => {
    out.push(
      buildGenericDbFinding({
        findingType,
        category: 'migration_risk',
        severity,
        schemaName: c.schemaName,
        tableName: c.tableName,
        columnName: c.columnName,
        summary,
        detailJson: { dataType: c.dataType, ...(detail ?? {}) },
      }),
    );
  };
  for (const c of introspection.mssql.columns) {
    const id = `${c.schemaName}.${c.tableName}.${c.columnName}`;
    if (c.isFilestream) {
      emit(
        c,
        'filestream_column',
        'high',
        `Column '${id}' is FILESTREAM: the bytes live on the filesystem, not ` +
          `in the table. PostgreSQL has no FILESTREAM -- the content must be ` +
          `re-homed (bytea in-row, large objects, or an external object ` +
          `store) and every application path that opens the file handle ` +
          `rewritten. Owner decision required.`,
      );
    }
    if (c.dataType === 'xml') {
      emit(
        c,
        'xml_typed_column',
        'medium',
        `Column '${id}' is XML-typed` +
          (c.xmlSchemaCollection
            ? ` and bound to XML SCHEMA COLLECTION '${c.xmlSchemaCollection}'`
            : '') +
          `. PostgreSQL has an xml type but NOT the SQL Server XML methods ` +
          `(.value / .query / .nodes / .modify) or schema collections: those ` +
          `are rewritten to xpath() / xmltable().`,
        { xmlSchemaCollection: c.xmlSchemaCollection },
      );
    }
    if (c.dataType === 'sql_variant') {
      emit(
        c,
        'sql_variant_column',
        'high',
        `Column '${id}' is sql_variant -- a single column holding values of ` +
          `different types. PostgreSQL has no equivalent. Owner decision: ` +
          `carry as jsonb, split into typed columns, or drop.`,
      );
    }
    if (c.dataType === 'hierarchyid') {
      emit(
        c,
        'hierarchyid_column',
        'medium',
        `Column '${id}' is hierarchyid. The tool maps it to the PostgreSQL ` +
          `ltree extension; the hierarchyid METHODS (GetAncestor / IsDescendantOf ` +
          `/ GetLevel) are rewritten to their ltree equivalents.`,
      );
    }
    if (c.dataType === 'geography' || c.dataType === 'geometry') {
      emit(
        c,
        'spatial_column',
        'high',
        `Column '${id}' is a ${c.dataType} column. PostGIS MUST be installed ` +
          `on the target PostgreSQL 18 instance before this table can be ` +
          `created -- this is a loud runbook prerequisite, not an optional ` +
          `extra.`,
      );
    }
    // A computed column that is NOT persisted cannot be reproduced by
    // PostgreSQL's GENERATED ... STORED (which is always stored). That is a
    // real shape difference, so it is stated rather than assumed away.
    if (
      !c.isPersistedComputed &&
      introspection.columns.some(
        (n) =>
          n.schemaName === c.schemaName &&
          n.tableName === c.tableName &&
          n.columnName === c.columnName &&
          n.isGenerated === true,
      )
    ) {
      emit(
        c,
        'computed_column_not_persisted',
        'low',
        `Column '${id}' is a NON-PERSISTED computed column (evaluated on ` +
          `read). PostgreSQL generated columns are always STORED, so the ` +
          `target either stores the value or the expression moves into a view.`,
        { isPersistedComputed: false },
      );
    }
  }
  return out;
}

/**
 * Index-shaped findings: columnstore and full-text. Both are real SQL Server
 * index types with no like-for-like PostgreSQL form.
 */
function emitIndexFeatureFindings(
  introspection: MssqlIntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const x of introspection.mssql.indexes) {
    const id = `${x.schemaName}.${x.tableName}.${x.name}`;
    if (
      x.indexType === 'clustered_columnstore' ||
      x.indexType === 'nonclustered_columnstore'
    ) {
      out.push(
        buildGenericDbFinding({
          findingType: 'columnstore_index',
          category: 'migration_risk',
          severity: 'medium',
          schemaName: x.schemaName,
          tableName: x.tableName,
          summary:
            `Index '${id}' is a ${x.indexType.replace(/_/g, ' ')} index. ` +
            `PostgreSQL core has no columnstore: the analytic query profile ` +
            `this index serves must be re-planned (B-tree / BRIN covering ` +
            `indexes, or a column-store extension provisioned deliberately).`,
          detailJson: { indexType: x.indexType, indexName: x.name },
        }),
      );
    }
    if (x.indexType === 'fulltext') {
      out.push(
        buildGenericDbFinding({
          findingType: 'fulltext_index_detected',
          category: 'migration_risk',
          severity: 'medium',
          schemaName: x.schemaName,
          tableName: x.tableName,
          summary:
            `Index '${id}' is a FULL-TEXT index` +
            (x.fulltextCatalog ? ` in catalog '${x.fulltextCatalog}'` : '') +
            `. The tool emulates it with a tsvector column plus a GIN index; ` +
            `CONTAINS / FREETEXT predicates are rewritten to to_tsquery().`,
          detailJson: {
            indexName: x.name,
            fulltextCatalog: x.fulltextCatalog,
            columns: introspection.keysAndIndexes.find(
              (k) =>
                k.schemaName === x.schemaName &&
                k.tableName === x.tableName &&
                k.name === x.name,
            )?.columns ?? [],
          },
        }),
      );
    }
  }
  return out;
}

/**
 * OUT ruling 6 -- INDEXED VIEWS. A view with a unique clustered index is a
 * materialized, automatically-maintained result set that PostgreSQL's
 * MATERIALIZED VIEW does not reproduce (it has no automatic maintenance and
 * no query-optimizer substitution). Never attempted, never silent: each gets
 * the NAMED untranslatable reason `indexed_view`.
 */
function emitIndexedViewFindings(
  introspection: MssqlIntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const v of introspection.mssql.views) {
    if (!v.isIndexedView) continue;
    out.push(
      buildGenericDbFinding({
        findingType: 'indexed_view',
        category: 'migration_risk',
        severity: 'high',
        schemaName: v.schemaName,
        tableName: v.viewName,
        summary:
          `View '${v.schemaName}.${v.viewName}' is an INDEXED VIEW (it carries ` +
          `a unique clustered index and is maintained automatically by the ` +
          `engine). This tool does NOT translate indexed views: PostgreSQL's ` +
          `MATERIALIZED VIEW is not maintained automatically and is never ` +
          `substituted into a query plan. Untranslatable reason: ` +
          `'${MSSQL_UNTRANSLATABLE_REASON.indexedView}'. Owner decision ` +
          `required -- refresh strategy, or fold the view's logic into the ` +
          `querying application.`,
        detailJson: {
          untranslatableReason: MSSQL_UNTRANSLATABLE_REASON.indexedView,
          isSchemaBound: v.isSchemaBound,
          viewName: v.viewName,
        },
      }),
    );
  }
  return out;
}

/**
 * OUT ruling 1 -- CROSS-DATABASE / LINKED-SERVER REFERENCES. A routine, view
 * or trigger body that reaches into another database (three-part name) or a
 * linked server (four-part name / OPENQUERY) is never attempted: PostgreSQL
 * has no cross-database query at all, and the FDW alternative is a
 * deployment decision, not a translation. Each gets the NAMED untranslatable
 * reason `cross_database_reference`.
 */
function emitCrossDatabaseFindings(
  introspection: MssqlIntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  const emitFor = (
    schemaName: string,
    objectName: string,
    objectKind: string,
    body: string,
  ): void => {
    const refs = findCrossDatabaseReferences(body);
    if (refs.length === 0) return;
    out.push(
      buildGenericDbFinding({
        findingType: 'cross_database_reference',
        category: 'migration_risk',
        severity: 'high',
        schemaName,
        tableName: objectName,
        summary:
          `The ${objectKind} '${schemaName}.${objectName}' references objects ` +
          `outside this database (${refs.slice(0, 5).join(', ')}` +
          `${refs.length > 5 ? `, +${refs.length - 5} more` : ''}). ` +
          `This tool does NOT translate cross-database or linked-server ` +
          `references: PostgreSQL has no cross-database query, and a foreign ` +
          `data wrapper is a deployment decision rather than a translation. ` +
          `Untranslatable reason: ` +
          `'${MSSQL_UNTRANSLATABLE_REASON.crossDatabaseReference}'. Owner ` +
          `decision required.`,
        detailJson: {
          untranslatableReason:
            MSSQL_UNTRANSLATABLE_REASON.crossDatabaseReference,
          objectKind,
          references: refs,
          bodySnippet: redactSnippet(body, BODY_SNIPPET_CAP),
        },
      }),
    );
  };
  for (const p of introspection.procedures) {
    emitFor(
      p.schemaName,
      p.procedureName,
      p.routineKind === 'function' ? 'function' : 'procedure',
      p.body,
    );
  }
  for (const v of introspection.views) {
    emitFor(v.schemaName, v.viewName, 'view', v.definition);
  }
  for (const t of introspection.triggers) {
    emitFor(t.schemaName, t.triggerName, 'trigger', t.actionStatement);
  }
  return out;
}

/**
 * CLR routines -- shaping §5 item 5. The body is managed .NET code inside an
 * assembly, so there is nothing to translate: the owner decides between
 * rewriting the logic in the application, dropping it, or standing it up as
 * an external service.
 */
function emitClrFindings(
  introspection: MssqlIntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const r of introspection.mssql.routines) {
    if (!r.isClr) continue;
    out.push(
      buildGenericDbFinding({
        findingType: 'clr_object_detected',
        category: 'migration_risk',
        severity: 'high',
        schemaName: r.schemaName,
        tableName: r.routineName,
        summary:
          `'${r.schemaName}.${r.routineName}' is a SQL CLR ${r.wireKind.replace('clr_', '')} ` +
          (r.assemblyName ? `bound to assembly '${r.assemblyName}'. ` : '. ') +
          `Its body is managed .NET code, not T-SQL, so there is nothing to ` +
          `translate. Owner decision: rewrite the logic in the application, ` +
          `drop it, or stand it up as an external service.`,
        detailJson: {
          routineKind: r.wireKind,
          assemblyName: r.assemblyName,
          executeAs: r.executeAs,
        },
      }),
    );
  }
  // An assembly with no routine bound to it still matters -- it may host a
  // user-defined type or an aggregate.
  for (const e of introspection.extendedObjects ?? []) {
    if (e.kind !== 'assembly') continue;
    out.push(
      buildGenericDbFinding({
        findingType: 'clr_object_detected',
        category: 'migration_risk',
        severity: 'high',
        schemaName: e.schemaName || 'sys',
        tableName: e.name,
        summary:
          `CLR assembly '${e.name}' is registered in this database. Every ` +
          `routine, type or aggregate it hosts is managed .NET code with no ` +
          `PostgreSQL equivalent. Owner decision: rewrite in the application, ` +
          `drop, or stand up as an external service.`,
        detailJson: { extendedObjectKind: e.kind, detail: e.detail ?? null },
      }),
    );
  }
  return out;
}

/**
 * Extended-object findings -- Service Broker, synonyms, table types,
 * full-text catalogs, FILESTREAM filegroups. Each is procedural / structural
 * reality that a static schema migration would silently drop.
 */
function emitExtendedObjectFindings(
  introspection: MssqlIntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const e of introspection.extendedObjects ?? []) {
    const id = e.schemaName ? `${e.schemaName}.${e.name}` : e.name;
    if (
      e.kind === 'service_broker_queue' ||
      e.kind === 'service_broker_service' ||
      e.kind === 'service_broker_contract'
    ) {
      out.push(
        buildGenericDbFinding({
          findingType: 'service_broker_detected',
          category: 'migration_risk',
          severity: 'high',
          schemaName: e.schemaName || 'dbo',
          tableName: e.name,
          summary:
            `Service Broker object '${id}' (${e.kind.replace(/_/g, ' ')}) is ` +
            `in use. PostgreSQL has no in-database asynchronous messaging: ` +
            `LISTEN/NOTIFY is fire-and-forget, not transactional queuing. ` +
            `Owner decision: rewrite in the application, drop, or move to an ` +
            `external broker.`,
          detailJson: { extendedObjectKind: e.kind, detail: e.detail ?? null },
        }),
      );
    } else if (e.kind === 'synonym') {
      out.push(
        buildGenericDbFinding({
          findingType: 'synonym_detected',
          category: 'migration_risk',
          severity: 'medium',
          schemaName: e.schemaName || 'dbo',
          tableName: e.name,
          summary:
            `Synonym '${id}' aliases ` +
            `'${String((e.detail ?? {}).baseObject ?? 'an object')}'. ` +
            `PostgreSQL has no CREATE SYNONYM: every reference must be ` +
            `resolved to its base object, or a view / search_path entry ` +
            `stands in. A synonym pointing at ANOTHER DATABASE is also a ` +
            `cross-database reference and is untranslatable for that reason.`,
          detailJson: { extendedObjectKind: e.kind, detail: e.detail ?? null },
        }),
      );
    } else if (e.kind === 'user_defined_table_type') {
      out.push(
        buildGenericDbFinding({
          findingType: 'user_defined_table_type',
          category: 'migration_risk',
          severity: 'medium',
          schemaName: e.schemaName || 'dbo',
          tableName: e.name,
          summary:
            `User-defined TABLE TYPE '${id}' backs one or more table-valued ` +
            `(READONLY) parameters. PostgreSQL's closest forms are a composite ` +
            `type array or a temporary table; either way every routine ` +
            `signature that takes it changes, so the call sites move with it.`,
          detailJson: { extendedObjectKind: e.kind, detail: e.detail ?? null },
        }),
      );
    } else if (e.kind === 'fulltext_catalog') {
      out.push(
        buildGenericDbFinding({
          findingType: 'fulltext_index_detected',
          category: 'migration_risk',
          severity: 'medium',
          schemaName: e.schemaName || 'dbo',
          tableName: e.name,
          summary:
            `Full-text catalog '${id}' is registered. The tool emulates ` +
            `full-text search with a tsvector column plus a GIN index; ` +
            `CONTAINS / FREETEXT predicates are rewritten to to_tsquery().`,
          detailJson: { extendedObjectKind: e.kind, detail: e.detail ?? null },
        }),
      );
    } else if (e.kind === 'filestream_filegroup') {
      out.push(
        buildGenericDbFinding({
          findingType: 'filestream_column',
          category: 'migration_risk',
          severity: 'high',
          schemaName: e.schemaName || 'sys',
          tableName: e.name,
          summary:
            `FILESTREAM filegroup '${id}' is configured on this database, so ` +
            `some content lives on the filesystem rather than in the tables. ` +
            `PostgreSQL has no FILESTREAM: the content must be re-homed and ` +
            `every application path that opens a file handle rewritten.`,
          detailJson: { extendedObjectKind: e.kind, detail: e.detail ?? null },
        }),
      );
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Evidence gaps
// -----------------------------------------------------------------------------

/**
 * Human-readable label + the `sys.*` catalog source for each enrichment
 * metadata group, used to compose the evidence-gap Finding when a group is
 * `unavailable`. Keyed by the canonical {@link MetadataGroupKey}.
 *
 * Unlike the ASE map, `index_predicate` and `native_sequence` ARE listed:
 * SQL Server supports both constructs, so an unread value is a genuine
 * evidence gap rather than a structural not-applicable.
 */
const METADATA_GROUP_GAP_DETAIL: Partial<
  Record<MetadataGroupKey, { label: string; source: string }>
> = {
  collation: {
    label: 'column / database collation (sort-order / case-sensitivity)',
    source: "sys.columns.collation_name + DATABASEPROPERTYEX(db, 'Collation')",
  },
  computed_columns: {
    label: 'computed-column flag, expression and persisted status',
    source: 'sys.computed_columns (definition, is_persisted)',
  },
  sequence_current_value: {
    label: 'sequence / identity current value (allocation high-water mark)',
    source:
      'sys.sequences.current_value + IDENT_CURRENT() for identity columns',
  },
  fk_actions: {
    label: 'foreign-key referential actions (on delete / on update)',
    source: 'sys.foreign_keys.delete_referential_action_desc / update_...',
  },
  index_clustering: {
    label: 'index ordering / clustering metadata',
    source: 'sys.indexes.type_desc + sys.index_columns (key_ordinal, is_descending_key)',
  },
  index_predicate: {
    label: 'filtered-index predicate (the index WHERE clause)',
    source: 'sys.indexes.filter_definition',
  },
  native_sequence: {
    label: 'native SEQUENCE objects',
    source: 'sys.sequences',
  },
  db_jobs: {
    label: 'database-resident scheduled jobs (SQL Server Agent)',
    source: 'msdb.dbo.sysjobs / sysjobsteps / sysjobschedules / sysschedules',
  },
};

/**
 * Emit a `db_schema_metadata_gap` evidence-gap Finding for each enrichment
 * metadata group whose three-state applicability resolved to `unavailable`.
 *
 * The three-state model still applies here, but the SQL Server engine
 * supports every group, so in practice only `unavailable` (a real read gap --
 * usually an insufficient GRANT, e.g. no `SQLAgentReaderRole` for the job
 * harvest) ever emits. `present` and the theoretical
 * `not_applicable_for_engine` are both suppressed.
 */
function emitMetadataEvidenceGapFindings(
  introspection: MssqlIntrospectionResult,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  const applicability = introspection.metadataApplicability;
  if (!applicability) return out;
  for (const [group, detail] of Object.entries(METADATA_GROUP_GAP_DETAIL)) {
    const state: MetadataApplicability | undefined =
      applicability[group as MetadataGroupKey];
    if (state === 'present' || state === 'not_applicable_for_engine') continue;
    if (!detail) continue;
    out.push(
      buildDbEvidenceGapFinding({
        engineKey: ENGINE,
        gapType: 'db_schema_metadata_gap',
        objectName: '',
        gapDescription:
          `The ${detail.label} could NOT be read for this SQL Server source ` +
          `(${detail.source}). The value is genuinely UNAVAILABLE -- either ` +
          `this sidecar build does not surface the group, or it surfaced the ` +
          `capability but the value was unreadable (most often an ` +
          `insufficient GRANT: VIEW DEFINITION on the database, or ` +
          `SQLAgentReaderRole in msdb for the job harvest). Obtain it ` +
          `out-of-band before migration. This is a real read gap, NOT a ` +
          `structural not-applicable-for-engine case.`,
      }),
    );
  }
  return out;
}

/**
 * Walk all inputs and return the full finding list for the run. Order is
 * deterministic (the Sybase mirror first, in the same order, then the
 * SQL-Server-only findings) so test snapshots are stable.
 */
export function buildAllMssqlFindings(
  introspection: MssqlIntrospectionResult,
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
    // SQL-Server-only, in the shaping doc's own order: item 5's no-like-for-
    // like objects, then the two OUT rulings.
    ...emitTemporalTableFindings(introspection),
    ...emitMemoryOptimizedFindings(introspection),
    ...emitColumnFeatureFindings(introspection),
    ...emitIndexFeatureFindings(introspection),
    ...emitClrFindings(introspection),
    ...emitExtendedObjectFindings(introspection),
    ...emitIndexedViewFindings(introspection),
    ...emitCrossDatabaseFindings(introspection),
    ...emitMetadataEvidenceGapFindings(introspection),
  ];
}

// Re-export internals for unit tests.
export const __testOnly = {
  bodyHasDml,
  bodyHasProcCall,
  isComplexViewDefinition,
  findCrossDatabaseReferences,
  emitStructuralFindings,
  emitProfileFindings,
  emitRelationshipFindings,
  emitHiddenLogicFindings,
  emitCollationHazardFindings,
  emitNonPortableDefaultFindings,
  emitSequenceCutoverFindings,
  emitUnsupportedFeatureFindings,
  emitTemporalTableFindings,
  emitMemoryOptimizedFindings,
  emitColumnFeatureFindings,
  emitIndexFeatureFindings,
  emitClrFindings,
  emitExtendedObjectFindings,
  emitIndexedViewFindings,
  emitCrossDatabaseFindings,
  emitMetadataEvidenceGapFindings,
  METADATA_GROUP_GAP_DETAIL,
};
