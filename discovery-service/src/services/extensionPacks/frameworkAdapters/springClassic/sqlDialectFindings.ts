/**
 * SQL-dialect + proc-call linkage findings (Spec 2026-07-06-f — T-SQL
 * Affinity & Consumer Revalidation, Code-Tier Oracle Program).
 *
 * Cross-file pass over the RESOLVED endpoint→data-effect edges (the same
 * resolver output the candidate emitter uses — run-it-twice pattern, like
 * the unresolved-chain finding pass):
 *
 *   - `tsql_dialect_in_code` — an edge's captured `query_text` classified
 *     `tsql`. Severity MEDIUM, raised to HIGH when the constructs include
 *     lock hints or `@@identity` (semantics-bearing, not just spelling).
 *     Detail carries the SQL verbatim (capped), the construct list, and the
 *     single-source suggested PostgreSQL equivalents.
 *   - `proc_call_unmatched` — a proc name extracted from captured SQL with
 *     NO match in the run's proc inventory (case-insensitive,
 *     schema-tolerant). When the run carried NO inventory at all (a
 *     code-only scan), the finding says so explicitly — match deferral is
 *     visible, never silent. Matched procs are enriched onto the
 *     `tsql_dialect_in_code` / edge detail rather than duplicated as
 *     findings.
 */

import type { SourceFileIR } from '../../languageIR';
import type { FindingEmitInput } from '../../../findings/FindingEmitter';
import {
  classifySqlDialect,
  extractProcCallNames,
  matchProcCalls,
  type NonPortableConstruct,
} from '../../../findings/sqlDialectClassifier';
import { resolveEndpointDataEffects } from './endpointDataEffectResolver';

const FINDING_SOURCE = 'spring-classic-framework-pack';
const CREATED_BY_STAGE = 'deterministic_spring_classic_analysis';

/** Constructs whose presence raises the dialect finding to HIGH severity. */
const HIGH_SEVERITY_CONSTRUCTS = new Set([
  'HOLDLOCK',
  'NOLOCK',
  'READPAST',
  'UPDLOCK',
  '@@identity',
]);

const MAX_SQL_IN_DETAIL = 500;

function capSql(sql: string): string {
  return sql.length > MAX_SQL_IN_DETAIL ? `${sql.slice(0, MAX_SQL_IN_DETAIL)}…` : sql;
}

function severityFor(constructs: NonPortableConstruct[]): 'medium' | 'high' {
  return constructs.some((c) => HIGH_SEVERITY_CONSTRUCTS.has(c.construct)) ? 'high' : 'medium';
}

export interface SqlDialectFindingsArgs {
  files: SourceFileIR[];
  /**
   * Proc names discovered in THIS run (sidecar inventory / physical-entity
   * candidates). Null/absent = code-only scan with no inventory — extracted
   * proc names are still surfaced (deferred-match wording), never dropped.
   */
  procInventory?: Iterable<string> | null;
}

/**
 * Build the dialect + proc-linkage findings across the whole IR set.
 * Deterministic, pure; caller applies the per-type run cap.
 */
export function buildSqlDialectFindings(args: SqlDialectFindingsArgs): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  const { resolved } = resolveEndpointDataEffects(args.files);
  const inventory = args.procInventory ? [...args.procInventory] : [];
  const hasInventory = inventory.length > 0;
  const seenProcNames = new Set<string>();

  for (const edge of resolved) {
    if (edge.queryText === undefined) continue;

    const classification = classifySqlDialect(edge.queryText);
    if (classification.dialect === 'tsql') {
      const constructNames = classification.non_portable_constructs.map((c) => c.construct);
      out.push({
        findingType: 'tsql_dialect_in_code',
        category: 'migration_risk',
        severity: severityFor(classification.non_portable_constructs),
        title: `T-SQL dialect SQL on ${edge.endpointName} → ${edge.dataEntityName}`,
        summary:
          `The SQL behind endpoint '${edge.endpointName}' (→ ${edge.dataEntityName}) uses ` +
          `${constructNames.length} T-SQL construct(s) (${constructNames.slice(0, 4).join(', ')}` +
          `${constructNames.length > 4 ? ', …' : ''}) that will not run unchanged on ` +
          'PostgreSQL. Suggested equivalents are attached (guidance only — the SQL is never rewritten here).',
        detailJson: {
          endpointName: edge.endpointName,
          dataEntityName: edge.dataEntityName,
          filePath: edge.sourceFilePath,
          queryKind: edge.queryKind ?? null,
          sql: capSql(edge.queryText),
          sqlDialect: classification.dialect,
          nonPortableConstructs: classification.non_portable_constructs,
          migrationConcern:
            'Dialect-affected code paths must be rewritten AND re-verified against the pinned ' +
            'baseline (scoped revalidation) when the database moves Sybase→PostgreSQL.',
        },
        source: FINDING_SOURCE,
        createdByStage: CREATED_BY_STAGE,
      });
    }

    // Proc-call linkage: extract + match against the run's inventory.
    const procNames = extractProcCallNames(edge.queryText);
    if (procNames.length === 0) continue;
    const { unmatched } = matchProcCalls(procNames, inventory);
    for (const name of unmatched) {
      const dedupeKey = name.toLowerCase();
      if (seenProcNames.has(dedupeKey)) continue;
      seenProcNames.add(dedupeKey);
      out.push({
        findingType: 'proc_call_unmatched',
        category: 'migration_risk',
        severity: 'medium',
        title: `Unmatched stored-proc call: ${name}`,
        summary: hasInventory
          ? `Code calls stored procedure '${name}' (from endpoint '${edge.endpointName}') but ` +
            'no such procedure exists in the discovered proc inventory — the call target is ' +
            'unaccounted for in the migration plan.'
          : `Code calls stored procedure '${name}' (from endpoint '${edge.endpointName}'); this ` +
            'run carried NO proc inventory (code-only scan), so the match is DEFERRED to the ' +
            'committed model — verify the proc is captured by a database scan.',
        detailJson: {
          procedureName: name,
          endpointName: edge.endpointName,
          filePath: edge.sourceFilePath,
          sql: capSql(edge.queryText),
          inventoryAvailable: hasInventory,
          migrationConcern:
            'A proc call with no discovered definition cannot be translated or re-verified — ' +
            'the persistence-tier plan has a hole until it is matched or dismissed.',
        },
        source: FINDING_SOURCE,
        createdByStage: CREATED_BY_STAGE,
      });
    }
  }
  return out;
}
