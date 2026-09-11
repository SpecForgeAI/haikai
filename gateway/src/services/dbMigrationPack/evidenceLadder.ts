/**
 * Evidence ladder (Stored Proc & Function Behaviour Program, Spec 4,
 * 2026-09-09).
 *
 * The T-SQL source is the specification; captured scenarios are TESTS that
 * enter a translation prompt only after they fail, one rung at a time:
 *
 *   rung 1  none      — source + contract only (owner ruling: zero scenarios)
 *   rung 2  one       — ONE failing scenario: inputs + the one divergent
 *                       dimension, expected vs actual for that dimension
 *   rung 3  cluster   — one representative per distinct failure signature
 *   rung 4  full      — every failing scenario, every dimension's examples
 *
 * Evidence is rendered as a BUG REPORT against a fixed spec, never as
 * behaviour to reproduce. The reconcile always runs against every scenario;
 * only the prompt is rationed.
 */

export type EvidenceRung = 'none' | 'one' | 'cluster' | 'full';

export const DEFAULT_EVIDENCE_LADDER: EvidenceRung[] = ['none', 'one', 'cluster', 'full'];

/** Env-tunable ladder: `PROC_TRANSLATE_EVIDENCE_LADDER=none,one,cluster,full`. */
export function evidenceLadderFromEnv(raw: string | undefined = process.env.PROC_TRANSLATE_EVIDENCE_LADDER): EvidenceRung[] {
  if (!raw || raw.trim().length === 0) return DEFAULT_EVIDENCE_LADDER;
  const rungs = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is EvidenceRung => s === 'none' || s === 'one' || s === 'cluster' || s === 'full');
  return rungs.length > 0 ? rungs : DEFAULT_EVIDENCE_LADDER;
}

/** The per-scenario slice of a proc parity report the ladder reads. */
export interface FailingScenarioEvidence {
  scenario_name: string;
  scenario_type: string;
  signature: string | null;
  inputs: Array<{ name: string; value: unknown; is_null?: boolean }>;
  dimensions: Array<{
    dimension: string;
    verdict: string;
    advisory: boolean;
    detail: string | null;
    first_divergence: string | null;
    examples: Array<{ where: string; expected: unknown; actual: unknown }>;
  }>;
}

export interface ApplyFailureEvidence {
  sqlstate: string | null;
  message: string;
  position: number | null;
  detail: string | null;
}

/** Scenario types that describe error-mid-routine behaviour (second-pair programme, item 3). */
const ERROR_BEHAVIOUR_SCENARIO_TYPES = new Set(['error_path', 'error_mid_routine']);

/**
 * Group failing scenarios by signature; error-behaviour clusters first (an
 * error/transaction divergence explains most other failures, so it leads the
 * evidence), then largest cluster first, stable.
 */
export function clusterBySignature(failing: FailingScenarioEvidence[]): Array<{ signature: string; scenarios: FailingScenarioEvidence[] }> {
  const map = new Map<string, FailingScenarioEvidence[]>();
  for (const f of failing) {
    const key = f.signature ?? 'unknown';
    const list = map.get(key) ?? [];
    list.push(f);
    map.set(key, list);
  }
  const hasErrorBehaviour = (scenarios: FailingScenarioEvidence[]): number =>
    scenarios.some((s) => ERROR_BEHAVIOUR_SCENARIO_TYPES.has(s.scenario_type)) ? 1 : 0;
  return [...map.entries()]
    .map(([signature, scenarios]) => ({ signature, scenarios }))
    .sort(
      (a, b) =>
        hasErrorBehaviour(b.scenarios) - hasErrorBehaviour(a.scenarios) ||
        b.scenarios.length - a.scenarios.length ||
        a.signature.localeCompare(b.signature),
    );
}

function renderInputs(inputs: FailingScenarioEvidence['inputs']): string {
  if (inputs.length === 0) return '(no inputs)';
  return inputs.map((i) => `@${i.name} = ${i.is_null || i.value === null ? 'NULL' : JSON.stringify(i.value)}`).join(', ');
}

function renderDimension(d: FailingScenarioEvidence['dimensions'][number], cap: number): string[] {
  const lines: string[] = [];
  lines.push(`  - ${d.dimension}${d.detail ? `: ${d.detail}` : ''}`);
  for (const ex of d.examples.slice(0, cap)) {
    lines.push(`      at ${ex.where}: expected ${JSON.stringify(ex.expected)}, actual ${JSON.stringify(ex.actual)}`);
  }
  return lines;
}

/**
 * Render the evidence section for a rung. `null` when the rung carries no
 * scenarios (rung `none`) and no apply failure.
 */
export function renderEvidenceRung(
  rung: EvidenceRung,
  failing: FailingScenarioEvidence[],
  applyFailure: ApplyFailureEvidence | null,
  opts: { examplesPerDimension?: number } = {},
): string | null {
  const cap = opts.examplesPerDimension ?? 5;
  const lines: string[] = [];
  if (applyFailure) {
    lines.push('The previous draft FAILED TO APPLY on PostgreSQL (fix this first):');
    lines.push(`  ${applyFailure.sqlstate ?? '?'}: ${applyFailure.message}${applyFailure.position ? ` (at position ${applyFailure.position})` : ''}${applyFailure.detail ? ` — ${applyFailure.detail}` : ''}`);
  }
  const divergentDims = (f: FailingScenarioEvidence) => f.dimensions.filter((d) => !d.advisory && d.verdict === 'divergent');
  const header = (n: number) =>
    `Failing tests (${n}) against the SOURCE specification. These are test failures, not behaviour to copy: fix the translated logic so the source semantics hold for ALL inputs — never special-case these input values.`;
  if (rung === 'one' && failing.length > 0) {
    const cluster = clusterBySignature(failing)[0];
    const f = cluster.scenarios[0];
    const dims = divergentDims(f).slice(0, 1);
    lines.push(header(1));
    lines.push(`- ${f.scenario_name} (${f.scenario_type}) with inputs ${renderInputs(f.inputs)}`);
    for (const d of dims) lines.push(...renderDimension(d, cap));
  } else if (rung === 'cluster' && failing.length > 0) {
    const clusters = clusterBySignature(failing);
    lines.push(header(clusters.length));
    for (const c of clusters) {
      const f = c.scenarios[0];
      lines.push(`- ${f.scenario_name} (${f.scenario_type}; ${c.scenarios.length} scenario(s) fail the same way: ${c.signature}) with inputs ${renderInputs(f.inputs)}`);
      for (const d of divergentDims(f).slice(0, 1)) lines.push(...renderDimension(d, cap));
    }
  } else if (rung === 'full' && failing.length > 0) {
    lines.push(header(failing.length));
    for (const f of failing) {
      lines.push(`- ${f.scenario_name} (${f.scenario_type}) with inputs ${renderInputs(f.inputs)}`);
      for (const d of divergentDims(f)) lines.push(...renderDimension(d, cap));
    }
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Overfitting guard (deterministic half): captured input literals that
 * appear in the draft but NOT in the source are a sign the draft special-
 * cased the test inputs. Numbers shorter than 3 digits and one-character
 * strings are ignored (too common to mean anything).
 */
export function findSpecialCasedLiterals(draftSql: string, sourceBody: string, failing: FailingScenarioEvidence[]): string[] {
  const hits = new Set<string>();
  const source = sourceBody.toLowerCase();
  const draft = draftSql.toLowerCase();
  for (const f of failing) {
    for (const input of f.inputs) {
      if (input.value === null || input.value === undefined) continue;
      const literal = String(input.value).toLowerCase();
      if (/^-?\d+(\.\d+)?$/.test(literal) ? literal.replace(/[^0-9]/g, '').length < 3 : literal.length < 2) continue;
      const needle = /^-?\d+(\.\d+)?$/.test(literal) ? literal : `'${literal}'`;
      if (draft.includes(needle) && !source.includes(needle)) hits.add(String(input.value));
    }
  }
  return [...hits].sort();
}
