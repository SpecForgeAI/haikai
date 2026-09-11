/**
 * Call-site compatibility (Stored Proc & Function Behaviour Program, Spec 2,
 * 2026-09-09) — PACK CODE.
 *
 * The code scan mints `endpoint_data_effects` rows for every stored-proc
 * call it can see (`access_mode: execute`, `path_metadata_json.proc_name`,
 * `query_text`). Given the per-routine calling-convention descriptor and
 * the pair ruleset's SYBPG.PROC.CALLSITE.001 matrix, each call site is
 * classified deterministically:
 *
 *   compatible    — the existing JDBC call keeps working against the shape
 *   needs_change  — a named Java-side change is required
 *   unknown       — the call pattern could not be read from the query text
 *                   (a bare routine reference); honest, never guessed
 *
 * In a DB-only migration this count is the headline: how many call sites
 * keep working unchanged, and exactly which ones need a change.
 */

import { procRulePrefix, type MigrationPairRuleset } from '../../migrationPairRules';
import type { RoutineDescriptor } from './routineInvocationDescriptor';

export type CallSitePattern =
  | 'jdbc_call_return'
  | 'jdbc_call'
  | 'exec_text'
  | 'bare_reference'
  | 'error_number_branching';

export interface CallSiteEffect {
  id?: string;
  endpoint_id: string;
  access_mode?: string | null;
  path_metadata_json?: Record<string, unknown> | null;
}

export interface CallSiteVerdict {
  endpoint_id: string;
  routine: string;
  pattern: CallSitePattern;
  verdict: 'compatible' | 'needs_change' | 'unknown';
  reason: string | null;
  shape: RoutineDescriptor['shape'] | null;
}

export interface CallSiteCompatibilitySummary {
  compatible: number;
  needs_change: number;
  unknown: number;
  /** Routines referenced by call sites that have no descriptor (no catalog row / not translated). */
  undescribed_routines: string[];
  sites: CallSiteVerdict[];
  rule_id: string;
}

/** The pair's call-site matrix rule: `<prefix>PROC.CALLSITE.001` (prefix from the ruleset, never a literal). */
const MATRIX_RULE_SUFFIX = 'PROC.CALLSITE.001';
function matrixRuleId(ruleset: MigrationPairRuleset | null): string {
  return `${ruleset ? procRulePrefix(ruleset) : ''}${MATRIX_RULE_SUFFIX}`;
}

function bareName(raw: string): string {
  const cleaned = raw.replace(/[[\]"'`]/g, '').trim();
  return (cleaned.split('.').pop() ?? cleaned).toLowerCase();
}

/** Classify one call site's query text (exported for tests). */
export function classifyCallSitePattern(queryText: string | null | undefined): CallSitePattern {
  const text = (queryText ?? '').trim();
  if (text.length === 0) return 'bare_reference';
  if (/\{\s*\?\s*=\s*call\b/i.test(text)) return 'jdbc_call_return';
  if (/\{\s*call\b/i.test(text)) return 'jdbc_call';
  if (/(^|[^A-Za-z0-9_])exec(?:ute)?\s+/i.test(text)) return 'exec_text';
  return 'bare_reference';
}

/**
 * Per-engine detectors for "this Java call site BRANCHES on a source error
 * NUMBER" (Spec 5.7) — the pattern the pair's CALLSITE matrix judges hardest,
 * because the number does not survive the migration unchanged.
 *
 *   sybase: `@@error`, jConnect's `getErrorCode()`, ASE's 1xxxx / 20xxx
 *           message numbers.
 *   mssql:  `SQLServerException`, `getErrorCode()`, RAISERROR/THROW's
 *           user range (>= 50000) and the constraint families 547 (FK/CHECK
 *           violation), 2627 (PK/UNIQUE violation) and 2601 (duplicate key
 *           in a unique index).
 *
 * Engine-keyed rather than one union so a Sybase pack's verdicts cannot
 * shift because a SQL Server pattern happened to match.
 */
const ERROR_NUMBER_PATTERNS: Record<string, RegExp> = {
  sybase: /getErrorCode\s*\(\s*\)|@@error\b|SQLException.*\b(20\d{3}|1\d{4})\b/i,
  mssql:
    /SQLServerException|getErrorCode\s*\(\s*\)|@@error\b|\b(?:5[0-9]{4,}|547|2627|2601)\b/i,
};

/** TRUE when the call site's surrounding text branches on a source error number. */
function branchesOnErrorNumber(
  meta: Record<string, unknown> | null | undefined,
  engine?: string
): boolean {
  const text = String(meta?.['query_text'] ?? '') + ' ' + String(meta?.['context_snippet'] ?? '');
  const pattern =
    ERROR_NUMBER_PATTERNS[String(engine ?? '').toLowerCase()] ?? ERROR_NUMBER_PATTERNS.sybase;
  return pattern.test(text);
}

function matrixVerdict(
  ruleset: MigrationPairRuleset | null,
  shape: RoutineDescriptor['shape'],
  pattern: CallSitePattern
): { verdict: CallSiteVerdict['verdict']; reason: string | null } {
  const rule = ruleset?.rules.find((r) => r.id === matrixRuleId(ruleset));
  const cell = rule?.matrix?.[shape]?.[pattern];
  if (typeof cell !== 'string' || cell.length === 0) {
    return { verdict: 'unknown', reason: 'no matrix entry for this shape/pattern' };
  }
  if (cell === 'compatible') return { verdict: 'compatible', reason: null };
  if (cell === 'unknown') return { verdict: 'unknown', reason: null };
  const m = /^needs_change:\s*(.*)$/.exec(cell);
  return { verdict: 'needs_change', reason: m ? m[1] : cell };
}

/**
 * Compute the compatibility summary for every proc-call effect the scan
 * recorded, against the descriptors keyed by bare lower-case routine name.
 */
export function computeCallSiteCompatibility(
  effects: CallSiteEffect[],
  descriptorsByRoutine: Map<string, RoutineDescriptor>,
  ruleset: MigrationPairRuleset | null,
  /** Source engine (Spec 5.7); defaults to the ruleset's own source engine. */
  engine?: string
): CallSiteCompatibilitySummary {
  const sourceEngine = String(engine ?? ruleset?.source?.engine ?? 'sybase').toLowerCase();
  const sites: CallSiteVerdict[] = [];
  const undescribed = new Set<string>();
  for (const e of effects) {
    const meta = e.path_metadata_json ?? null;
    const procName = meta?.['proc_name'];
    if (typeof procName !== 'string' || procName.trim().length === 0) continue;
    const routine = bareName(procName);
    const descriptor = descriptorsByRoutine.get(routine);
    if (!descriptor) {
      undescribed.add(routine);
      sites.push({
        endpoint_id: e.endpoint_id,
        routine,
        pattern: classifyCallSitePattern(String(meta?.['query_text'] ?? '')),
        verdict: 'unknown',
        reason: 'routine has no calling-convention descriptor',
        shape: null,
      });
      continue;
    }
    const pattern: CallSitePattern = branchesOnErrorNumber(meta, sourceEngine)
      ? 'error_number_branching'
      : classifyCallSitePattern(String(meta?.['query_text'] ?? ''));
    const { verdict, reason } = matrixVerdict(ruleset, descriptor.shape, pattern);
    sites.push({ endpoint_id: e.endpoint_id, routine, pattern, verdict, reason, shape: descriptor.shape });
  }
  sites.sort((a, b) => a.routine.localeCompare(b.routine) || a.endpoint_id.localeCompare(b.endpoint_id));
  return {
    compatible: sites.filter((s) => s.verdict === 'compatible').length,
    needs_change: sites.filter((s) => s.verdict === 'needs_change').length,
    unknown: sites.filter((s) => s.verdict === 'unknown').length,
    undescribed_routines: [...undescribed].sort(),
    sites,
    rule_id: matrixRuleId(ruleset),
  };
}
