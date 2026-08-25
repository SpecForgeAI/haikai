/**
 * Capture-session diagnostics grouping (2026-08-20 journey-audit fix).
 *
 * The orchestrator writes structural diagnostics (compensation refusals,
 * residue, S0 advisories, …) to AMS, but the session screen previously
 * rendered none of them — only hard halts surfaced via `error_message`.
 * These pure helpers group and rank the diagnostics for a visible section:
 * halts first (red), warnings next (amber), info last (neutral).
 */

import type { ApiBehaviourDiagnosticDto } from '../../api/apiBehaviourClient';

export type DiagnosticSeverity = 'halt' | 'warning' | 'info';

/** State was NOT restored — the run halted (or would have) on these. */
const HALT_TYPES = new Set([
  'compensation_residue',
  'state_residue',
  's0_fingerprint_mismatch',
]);

/** Coverage / discipline warnings — the run continued but honesty demands
 *  the operator sees them (skipped mutations, missing S0, inactive undo). */
const WARNING_TYPES = new Set([
  'compensation_refused',
  'compensation_no_effect_map',
  'compensation_inactive',
  's0_snapshot_missing',
  's0_fingerprint_check_failed',
  'endpoint_skipped',
  // Foundations Spec 3 (2026-08-22): whole effect map removed by scope
  // decisions — a ruling to revisit, not a failure.
  'scope_conflict',
]);

export function severityFor(diagnosticType: string | null): DiagnosticSeverity {
  if (diagnosticType && HALT_TYPES.has(diagnosticType)) return 'halt';
  if (diagnosticType && WARNING_TYPES.has(diagnosticType)) return 'warning';
  return 'info';
}

/** Human label: `compensation_refused` -> `compensation refused`. */
export function labelFor(diagnosticType: string | null): string {
  return (diagnosticType ?? 'other').replace(/_/g, ' ');
}

export interface DiagnosticGroup {
  type: string;
  severity: DiagnosticSeverity;
  items: ApiBehaviourDiagnosticDto[];
}

const SEVERITY_ORDER: Record<DiagnosticSeverity, number> = {
  halt: 0,
  warning: 1,
  info: 2,
};

/**
 * Groups by diagnostic type, ordered halt -> warning -> info, then by count
 * descending, then alphabetically for a stable render.
 */
export function groupDiagnostics(
  diagnostics: readonly ApiBehaviourDiagnosticDto[],
): DiagnosticGroup[] {
  const byType = new Map<string, ApiBehaviourDiagnosticDto[]>();
  for (const d of diagnostics) {
    const type = d.diagnostic_type ?? 'other';
    const bucket = byType.get(type) ?? [];
    bucket.push(d);
    byType.set(type, bucket);
  }
  const groups: DiagnosticGroup[] = [...byType.entries()].map(([type, items]) => ({
    type,
    severity: severityFor(type),
    items,
  }));
  groups.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    const count = b.items.length - a.items.length;
    if (count !== 0) return count;
    return a.type.localeCompare(b.type);
  });
  return groups;
}

/**
 * Offer the S0-restore panel only when the session halted on a
 * canonical-state problem — the halt messages (orchestrator + log-replay
 * runner) all name S0.
 */
export function shouldOfferS0Restore(session: {
  status?: string | null;
  error_message?: string | null;
}): boolean {
  return session.status === 'failed' && /\bS0\b/.test(session.error_message ?? '');
}

export interface GroupedDiagnosticLine {
  message: string;
  count: number;
  /** First underlying diagnostic id (stable render key). */
  id: string;
}

/**
 * Collapse IDENTICAL messages within one severity group to a single line
 * with a xN count (Foundations Spec 0, 2026-08-22): a 300-row wall of
 * per-scenario repeats of the same refusal reason is screenshot-hostile;
 * the per-scenario rows remain in AMS untouched — this is display-only.
 */
export function groupIdenticalMessages(
  items: readonly ApiBehaviourDiagnosticDto[],
): GroupedDiagnosticLine[] {
  const byMessage = new Map<string, GroupedDiagnosticLine>();
  for (const d of items) {
    const message = d.message ?? '(no message)';
    const existing = byMessage.get(message);
    if (existing) existing.count += 1;
    else byMessage.set(message, { message, count: 1, id: d.id });
  }
  return [...byMessage.values()];
}

/**
 * Serialize the FULL diagnostics set to a plain-text report (2026-08-25 —
 * Copy/Download buttons on the session screen's diagnostics header). Reuses
 * `groupDiagnostics` + `labelFor` so the text ordering matches the on-screen
 * section (halt -> warning -> info), but unlike the screen it emits EVERY
 * row with its scenario/operation context and the complete `detail_json` —
 * no xN collapsing, no 5-line truncation. The exported artefact is the
 * whole thing, so what the operator pastes into a diagnosis chat is
 * complete.
 */
export function serializeDiagnosticsReport(
  header: string,
  diagnostics: readonly ApiBehaviourDiagnosticDto[],
): string {
  const lines: string[] = [header, ''];
  const groups = groupDiagnostics(diagnostics);
  for (const g of groups) {
    lines.push(`== ${labelFor(g.type)} [${g.severity}] (${g.items.length}) ==`);
    for (const d of g.items) {
      const context: string[] = [];
      if (d.operation_id) context.push(`operation=${d.operation_id}`);
      if (d.scenario_id) context.push(`scenario=${d.scenario_id}`);
      const contextSuffix = context.length > 0 ? ` [${context.join(' ')}]` : '';
      lines.push(`- ${d.message ?? '(no message)'}${contextSuffix}`);
      if (d.detail_json && Object.keys(d.detail_json).length > 0) {
        lines.push(`  detail: ${JSON.stringify(d.detail_json)}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
