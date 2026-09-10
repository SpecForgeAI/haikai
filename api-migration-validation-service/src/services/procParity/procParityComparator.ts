/**
 * Proc parity comparator (Stored Proc & Function Behaviour Program, Spec 4,
 * 2026-09-09) — GENERIC. Diffs a captured baseline envelope against a
 * target envelope across the routine dimensions, strict by default and
 * relaxed ONLY through cited pair rules:
 *
 *   outcome            success/error; error identity = source_error (ERR.001)
 *   return_status      strict integer compare
 *   output_params      per param; cells under the column-type rules (RS.TYPE)
 *   result_sets        count; per set: column names (COLNAME rule), row count,
 *                      rows ORDERED when the producing SELECT has ORDER BY
 *                      (RS.ORDER), else canonical multiset; cells under the
 *                      column-type rules + VOL rules for flagged cells
 *   messages           advisory (MSG.001) — never fails on its own
 *   update_counts      advisory
 *   state_delta        compareStateDeltas (state_match | state_drift | state_unverified)
 *
 * Verdict ladder per scenario: match | tolerated (rules cited) | divergent
 * (dimension) | unverifiable (reason). Failure signature = dimension +
 * first divergent column/field — the clustering key for Spec 4's evidence
 * ladder.
 */

import {
  activeRules,
  canonicalColumnType,
  compareWithRules,
  rulesForColumnType,
  rulesForDimension,
  type MigrationPairRule,
  type MigrationPairRuleset,
} from '../../migrationPairRules';
import { compareStateDeltas, type StateDeltaJson } from '../stateDelta';
import type { RoutineInvocationEnvelope } from '../db/routineEnvelope';
import type { VolatileCell } from '../procCapture/types';

export type ScenarioVerdict = 'match' | 'tolerated' | 'divergent' | 'unverifiable';

export interface DimensionResult {
  dimension: string;
  verdict: ScenarioVerdict;
  advisory: boolean;
  detail: string | null;
  /** First divergent column / field (the signature's second half). */
  first_divergence: string | null;
  rules_cited: string[];
  examples: Array<{ where: string; expected: unknown; actual: unknown }>;
}

export interface ScenarioParityResult {
  scenario_name: string;
  scenario_type: string;
  verdict: ScenarioVerdict;
  unverifiable_reason: string | null;
  /** `dimension:first_divergence` of the first failing non-advisory dimension. */
  signature: string | null;
  dimensions: DimensionResult[];
  rules_cited: string[];
  waived: boolean;
  waiver_reason: string | null;
}

export interface CompareScenarioArgs {
  scenarioName: string;
  scenarioType: string;
  expected: RoutineInvocationEnvelope | { steps: RoutineInvocationEnvelope[] };
  actual: RoutineInvocationEnvelope | { steps: RoutineInvocationEnvelope[] };
  expectedStateDelta?: StateDeltaJson | Record<string, unknown> | null;
  actualStateDelta?: StateDeltaJson | Record<string, unknown> | null;
  /** From the capture (double-fire evidence) — those cells are compared under VOL rules. */
  volatileCells?: VolatileCell[] | null;
  /** Static profile facts the RS.ORDER / VOL rules key off. */
  resultSelectOrderBy?: boolean[];
  constructsPresent?: string[];
  objectKind: 'procedure' | 'function';
  ruleset: MigrationPairRuleset | null;
  /** Scenario-level or routine-level waiver (reason) — records, never hides. */
  waiver?: { reason: string } | null;
  /** Baseline tables with an open data-parity divergence (upstream precondition). */
  upstreamDivergentTables?: string[];
  routineReads?: string[];
  maxExamples?: number;
}

const EXAMPLE_CAP = 20;

function steps(env: RoutineInvocationEnvelope | { steps: RoutineInvocationEnvelope[] }): RoutineInvocationEnvelope[] {
  return 'steps' in env ? env.steps : [env];
}

function cellRules(ruleset: MigrationPairRuleset | null, reportedType: string, dimension: string, kind: string, constructs: string[], volatile: boolean): MigrationPairRule[] {
  if (!ruleset) return [];
  const typeRules = rulesForColumnType(ruleset, canonicalColumnType(ruleset, reportedType));
  const dimRules = volatile ? rulesForDimension(ruleset, dimension, kind, constructs) : [];
  return [...typeRules, ...dimRules];
}

function canonicalRowKey(row: unknown[]): string {
  return JSON.stringify(row.map((v) => (v === undefined ? null : v)));
}

/**
 * Rule-cited cell compare. `tolerated` is TRUE only when the raw values
 * differ and a cited rule made them equal — identical values are a plain
 * match even when rules were consulted.
 */
function cmp(a: unknown, b: unknown, rules: MigrationPairRule[]): { equal: boolean; cited: string[]; tolerated: boolean } {
  const r = compareWithRules(a, b, rules);
  const rawEqual = JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return { equal: r.equal, cited: r.equal && !rawEqual ? r.appliedRuleIds : [], tolerated: r.equal && !rawEqual && r.appliedRuleIds.length > 0 };
}

/** Compare ONE scenario (single or sequence) — exported for tests + the runner. */
export function compareScenario(args: CompareScenarioArgs): ScenarioParityResult {
  const ruleset = args.ruleset;
  const constructs = args.constructsPresent ?? [];
  const kind = args.objectKind;
  const dims: DimensionResult[] = [];
  const allCited = new Set<string>();
  const cap = args.maxExamples ?? EXAMPLE_CAP;
  const base = { scenario_name: args.scenarioName, scenario_type: args.scenarioType, waived: !!args.waiver, waiver_reason: args.waiver?.reason ?? null };

  // Upstream precondition: a routine reading a table whose data parity is
  // open cannot be attributed honestly — unverifiable, never a false break.
  const upstream = (args.upstreamDivergentTables ?? []).map((t) => t.toLowerCase());
  const reads = (args.routineReads ?? []).map((t) => t.toLowerCase());
  const overlap = reads.filter((t) => upstream.includes(t));
  if (overlap.length > 0) {
    return { ...base, verdict: 'unverifiable', unverifiable_reason: `upstream_data_divergence:${overlap.join(',')}`, signature: null, dimensions: [], rules_cited: [] };
  }
  const expSteps = steps(args.expected);
  const actSteps = steps(args.actual);
  if (expSteps.length !== actSteps.length) {
    return { ...base, verdict: 'divergent', unverifiable_reason: null, signature: 'sequence:step_count', dimensions: [{ dimension: 'sequence', verdict: 'divergent', advisory: false, detail: `expected ${expSteps.length} step(s), got ${actSteps.length}`, first_divergence: 'step_count', rules_cited: [], examples: [] }], rules_cited: [] };
  }
  const truncated = [...expSteps, ...actSteps].some((e) => e.result_sets.some((rs) => rs.truncated));
  if (truncated) {
    return { ...base, verdict: 'unverifiable', unverifiable_reason: 'result_set_truncated', signature: null, dimensions: [], rules_cited: [] };
  }
  const volatile = args.volatileCells ?? [];
  const isVolatileCell = (where: VolatileCell['where'], extra: Partial<VolatileCell>): boolean =>
    volatile.some((v) => v.where === where && Object.entries(extra).every(([k, val]) => (v as unknown as Record<string, unknown>)[k] === val));

  for (let s = 0; s < expSteps.length; s++) {
    const e = expSteps[s];
    const a = actSteps[s];
    const prefix = expSteps.length > 1 ? `step${s + 1}.` : '';

    // ---- outcome --------------------------------------------------------
    {
      const errRules = ruleset ? rulesForDimension(ruleset, 'outcome', kind, constructs) : [];
      let verdict: ScenarioVerdict = 'match';
      let detail: string | null = null;
      const examples: DimensionResult['examples'] = [];
      if (e.outcome !== a.outcome) {
        verdict = 'divergent';
        detail = `expected ${e.outcome}, got ${a.outcome}`;
        examples.push({ where: `${prefix}outcome`, expected: e.outcome, actual: a.outcome });
      } else if (e.outcome === 'error') {
        const en = e.error?.number ?? null;
        const an = a.error?.number ?? null;
        if (en !== an) {
          verdict = 'divergent';
          detail = `expected error ${en ?? '?'}, got ${an ?? '?'}`;
          examples.push({ where: `${prefix}error.number`, expected: en, actual: an });
        }
      }
      errRules.forEach((r) => allCited.add(r.id));
      dims.push({ dimension: `${prefix}outcome`, verdict, advisory: false, detail, first_divergence: verdict === 'divergent' ? (e.outcome === a.outcome ? 'error.number' : 'outcome') : null, rules_cited: errRules.map((r) => r.id), examples });
    }
    if (e.outcome === 'error' && a.outcome === 'error') {
      // Same error identity: the rest of the envelope is not asserted
      // (result sets before the raise are engine-dependent noise).
      continue;
    }

    // ---- return_status --------------------------------------------------
    {
      const equal = (e.return_status ?? null) === (a.return_status ?? null);
      dims.push({
        dimension: `${prefix}return_status`,
        verdict: equal ? 'match' : 'divergent',
        advisory: false,
        detail: equal ? null : `expected ${e.return_status}, got ${a.return_status}`,
        first_divergence: equal ? null : 'return_status',
        rules_cited: [],
        examples: equal ? [] : [{ where: `${prefix}return_status`, expected: e.return_status, actual: a.return_status }],
      });
    }

    // ---- output_params --------------------------------------------------
    {
      const keys = [...new Set([...Object.keys(e.output_params), ...Object.keys(a.output_params)])].sort();
      let verdict: ScenarioVerdict = 'match';
      let first: string | null = null;
      const cited = new Set<string>();
      const examples: DimensionResult['examples'] = [];
      for (const k of keys) {
        const ev = e.output_params[k] ?? null;
        const av = a.output_params[k] ?? null;
        const rules = cellRules(ruleset, typeof ev === 'number' ? 'numeric' : 'varchar', 'output_params', kind, constructs, isVolatileCell('output_param', { param: k }));
        const r = cmp(ev, av, rules);
        r.cited.forEach((id) => cited.add(id));
        if (!r.equal) {
          verdict = 'divergent';
          first = first ?? k;
          if (examples.length < cap) examples.push({ where: `${prefix}output_params.${k}`, expected: ev, actual: av });
        } else if (r.tolerated && verdict === 'match') {
          verdict = 'tolerated';
        }
      }
      cited.forEach((id) => allCited.add(id));
      dims.push({ dimension: `${prefix}output_params`, verdict, advisory: false, detail: first ? `differs at ${first}` : null, first_divergence: first, rules_cited: [...cited], examples });
    }

    // ---- result_sets ----------------------------------------------------
    {
      const orderRule = ruleset ? rulesForDimension(ruleset, 'result_sets', kind, constructs).find((r) => r.comparison?.strategy === 'multiset') : null;
      const colRules = ruleset ? rulesForDimension(ruleset, 'result_set_columns', kind, constructs) : [];
      let verdict: ScenarioVerdict = 'match';
      let first: string | null = null;
      let detail: string | null = null;
      const cited = new Set<string>();
      const examples: DimensionResult['examples'] = [];
      if (e.result_sets.length !== a.result_sets.length) {
        verdict = 'divergent';
        first = 'count';
        detail = `expected ${e.result_sets.length} result set(s), got ${a.result_sets.length}`;
        examples.push({ where: `${prefix}result_sets.count`, expected: e.result_sets.length, actual: a.result_sets.length });
      } else {
        for (let i = 0; i < e.result_sets.length; i++) {
          const er = e.result_sets[i];
          const ar = a.result_sets[i];
          const ecols = er.columns.map((c) => c.name);
          const acols = ar.columns.map((c) => c.name);
          const colEqual = ecols.length === acols.length && ecols.every((n, idx) => {
            const r = cmp(n, acols[idx], colRules);
            r.cited.forEach((id) => cited.add(id));
            if (r.tolerated && verdict === 'match') verdict = 'tolerated';
            return r.equal;
          });
          if (!colEqual) {
            verdict = 'divergent';
            first = first ?? `rs${i + 1}.columns`;
            detail = detail ?? `result set ${i + 1} columns differ`;
            if (examples.length < cap) examples.push({ where: `${prefix}rs${i + 1}.columns`, expected: ecols, actual: acols });
            continue;
          }
          if (er.rows.length !== ar.rows.length) {
            verdict = 'divergent';
            first = first ?? `rs${i + 1}.row_count`;
            detail = detail ?? `result set ${i + 1}: expected ${er.rows.length} row(s), got ${ar.rows.length}`;
            if (examples.length < cap) examples.push({ where: `${prefix}rs${i + 1}.row_count`, expected: er.rows.length, actual: ar.rows.length });
            continue;
          }
          const ordered = args.resultSelectOrderBy?.[i] === true || !orderRule;
          if (orderRule) cited.add(orderRule.id);
          const typeOf = (idx: number): string => er.columns[idx]?.type || ar.columns[idx]?.type || 'varchar';
          const cellEqual = (x: unknown, y: unknown, idx: number, rowIdx: number): boolean => {
            const rules = cellRules(ruleset, typeOf(idx), 'result_set_cells', kind, constructs, isVolatileCell('result_set', { result_set: i + 1, row: rowIdx, column: ecols[idx] }));
            const r = cmp(x, y, rules);
            r.cited.forEach((id) => cited.add(id));
            if (r.tolerated && verdict === 'match') verdict = 'tolerated';
            return r.equal;
          };
          if (ordered) {
            for (let r = 0; r < er.rows.length; r++) {
              for (let c = 0; c < ecols.length; c++) {
                if (!cellEqual(er.rows[r][c], ar.rows[r][c], c, r)) {
                  verdict = 'divergent';
                  first = first ?? `rs${i + 1}.${ecols[c]}`;
                  detail = detail ?? `result set ${i + 1} row ${r} column ${ecols[c]} differs`;
                  if (examples.length < cap) examples.push({ where: `${prefix}rs${i + 1}[${r}].${ecols[c]}`, expected: er.rows[r][c], actual: ar.rows[r][c] });
                }
              }
            }
          } else {
            // Canonical multiset: canonicalise every cell under its rules,
            // then compare sorted row keys. Volatile cells are neutralised
            // (replaced by a marker) so they never decide membership.
            const canon = (row: unknown[], rowIdx: number): string =>
              canonicalRowKey(row.map((v, c) => {
                if (isVolatileCell('result_set', { result_set: i + 1, row: rowIdx, column: ecols[c] })) return '<volatile>';
                const rules = cellRules(ruleset, typeOf(c), 'result_set_cells', kind, constructs, false);
                const r = compareWithRules(v, v, rules);
                r.appliedRuleIds.forEach((id) => cited.add(id));
                return r.canonicalA;
              }));
            const ek = er.rows.map((row, idx) => canon(row, idx)).sort();
            const ak = ar.rows.map((row, idx) => canon(row, idx)).sort();
            const missing = ek.filter((k) => !ak.includes(k));
            if (missing.length > 0 || ek.length !== ak.length) {
              verdict = 'divergent';
              first = first ?? `rs${i + 1}.rows`;
              detail = detail ?? `result set ${i + 1}: ${missing.length} expected row(s) not found in the target multiset`;
              for (const k of missing.slice(0, cap)) examples.push({ where: `${prefix}rs${i + 1}.multiset`, expected: JSON.parse(k), actual: null });
            }
          }
        }
      }
      cited.forEach((id) => allCited.add(id));
      dims.push({ dimension: `${prefix}result_sets`, verdict, advisory: false, detail, first_divergence: first, rules_cited: [...cited], examples });
    }

    // ---- messages (advisory) -------------------------------------------
    {
      const msgRules = ruleset ? rulesForDimension(ruleset, 'messages', kind, constructs) : [];
      const et = e.messages.map((m) => m.text);
      const at = a.messages.map((m) => m.text);
      const equal = JSON.stringify(et) === JSON.stringify(at);
      msgRules.forEach((r) => allCited.add(r.id));
      dims.push({ dimension: `${prefix}messages`, verdict: equal ? 'match' : 'tolerated', advisory: true, detail: equal ? null : 'message text differs (advisory)', first_divergence: null, rules_cited: msgRules.map((r) => r.id), examples: equal ? [] : [{ where: `${prefix}messages`, expected: et, actual: at }] });
    }

    // ---- update_counts (advisory) --------------------------------------
    {
      const equal = JSON.stringify(e.update_counts) === JSON.stringify(a.update_counts);
      dims.push({ dimension: `${prefix}update_counts`, verdict: equal ? 'match' : 'tolerated', advisory: true, detail: equal ? null : 'update counts differ (advisory)', first_divergence: null, rules_cited: [], examples: equal ? [] : [{ where: `${prefix}update_counts`, expected: e.update_counts, actual: a.update_counts }] });
    }
  }

  // ---- state_delta (once per scenario; asserted only when the baseline
  // recorded one — a capture without write tables carries no oracle here) ---
  if (args.expectedStateDelta && args.actualStateDelta) {
    const sc = compareStateDeltas(
      (args.expectedStateDelta ?? null) as StateDeltaJson | null,
      (args.actualStateDelta ?? null) as StateDeltaJson | null,
    ) as unknown as { classification?: string; detail?: string | null };
    const cls = sc.classification ?? 'state_unverified';
    dims.push({
      dimension: 'state_delta',
      verdict: cls === 'state_match' ? 'match' : cls === 'state_drift' ? 'divergent' : 'unverifiable',
      advisory: false,
      detail: cls === 'state_match' ? null : (sc.detail ?? cls),
      first_divergence: cls === 'state_drift' ? 'state_delta' : null,
      rules_cited: [],
      examples: [],
    });
  }

  const failing = dims.filter((d) => !d.advisory && d.verdict === 'divergent');
  const unverifiable = dims.filter((d) => !d.advisory && d.verdict === 'unverifiable');
  let verdict: ScenarioVerdict;
  if (failing.length > 0) verdict = 'divergent';
  else if (unverifiable.length > 0) verdict = 'unverifiable';
  else if (dims.some((d) => d.verdict === 'tolerated' && !d.advisory)) verdict = 'tolerated';
  else verdict = 'match';
  const signature = failing.length > 0 ? `${failing[0].dimension}:${failing[0].first_divergence ?? '?'}` : null;
  return {
    ...base,
    verdict,
    unverifiable_reason: verdict === 'unverifiable' ? (unverifiable[0]?.detail ?? unverifiable[0]?.dimension ?? 'unverified') : null,
    signature,
    dimensions: dims,
    rules_cited: [...allCited].sort(),
  };
}

/** The rule ids a ruleset contributes to proc comparison (for report citation). */
export function procRuleIds(ruleset: MigrationPairRuleset | null): string[] {
  return ruleset ? activeRules(ruleset).filter((r) => r.id.startsWith('SYBPG.PROC.')).map((r) => r.id) : [];
}

export interface RoutineParitySummary {
  status: 'clean' | 'clean_with_waivers' | 'divergent' | 'unverifiable';
  scenarios: number;
  matched: number;
  tolerated: number;
  divergent: number;
  unverifiable: number;
  waived: number;
  /** Distinct failure signatures with counts — the ladder's clustering. */
  signatures: Array<{ signature: string; count: number; scenario_names: string[] }>;
}

export function summariseRoutineParity(results: ScenarioParityResult[]): RoutineParitySummary {
  const sig = new Map<string, { count: number; names: string[] }>();
  let divergent = 0;
  let waived = 0;
  for (const r of results) {
    if (r.verdict === 'divergent') {
      if (r.waived) {
        waived += 1;
      } else {
        divergent += 1;
        const key = r.signature ?? 'unknown';
        const entry = sig.get(key) ?? { count: 0, names: [] };
        entry.count += 1;
        entry.names.push(r.scenario_name);
        sig.set(key, entry);
      }
    }
  }
  const unverifiable = results.filter((r) => r.verdict === 'unverifiable' && !r.waived).length;
  const status: RoutineParitySummary['status'] =
    divergent > 0 ? 'divergent' : unverifiable > 0 ? 'unverifiable' : waived > 0 ? 'clean_with_waivers' : 'clean';
  return {
    status,
    scenarios: results.length,
    matched: results.filter((r) => r.verdict === 'match').length,
    tolerated: results.filter((r) => r.verdict === 'tolerated').length,
    divergent,
    unverifiable,
    waived,
    signatures: [...sig.entries()]
      .map(([signature, v]) => ({ signature, count: v.count, scenario_names: v.names }))
      .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature)),
  };
}
