/**
 * SCL modernization observed-idiom inventory (SCL pipeline spec 5 of 10,
 * 2026-08-18 design, "Intermediate modernization decisions").
 *
 * PURE + DETERMINISTIC: walks the SCL corpus contracts (+ scan-level findings)
 * and produces the observed-idiom rows that drive the modernization review.
 * The corpus drives the question set — only idioms with usageCount > 0 appear,
 * sorted by usage count descending (blast radius first).
 *
 * What is walked:
 * - shapes:  fields' `sourceCarrier` evidence, `opaque:<type>` kinds,
 *            representation:'pojo' (one use per POJO shape), slicer flags;
 * - tables:  annotations (matched against the ruleset's annotationPrefix
 *            rules), `opaque:<type>` occurrences in signatureInputs and rows;
 * - boundaries (Q- contracts): one 'dataaccess' idiom, count = boundary count;
 * - scan stats findings `near_duplicate_cluster` / `dispatch_ambiguity` /
 *   `data_derived_authorisation` / `aspect_pointcut_unresolved`: family
 *   'consolidation' rows — no ruleset default exists by design; the review
 *   pass proposes a starting point which the UI labels
 *   'llm_proposed_review_advised' because a human merge/keep call is still
 *   the decision (2026-09-04: previously these rode 'unmapped' with NO
 *   suggestion at all, so every such row was a blank the operator had to
 *   fill from nothing).
 *
 * Matching against services/sclModernizationRuleset.ts fills
 * matchedRuleCode/defaultTo (provenance 'ruleset_default'); anything observed
 * but unmatched rides provenance 'unmapped' for the review pass to propose on.
 * A value the operator typed or changed is labelled 'user_provided' by the
 * review UI at confirm time (derived from the input differing from the
 * default, never stored on the inventory row).
 */

import { SclContractWire } from './sclAnnotationPass';
import {
  defaultModernizationRuleset,
  ModernizationRule,
  ModernizationRuleset,
} from './sclModernizationRuleset';

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface ObservedIdiomCite {
  symbol: string;
  sourcePath: string;
}

export type ObservedIdiomProvenance =
  | 'ruleset_default'
  | 'llm_proposed'
  /** LLM starting point on a judgement family (consolidation): the model
   *  cannot know whether two near-duplicates should merge — review is
   *  advised, not optional. */
  | 'llm_proposed_review_advised'
  | 'unmapped';

export interface ObservedIdiom {
  family: string;
  /** Stable id of what matched, e.g. 'sourceCarrier:org.joda.time.LocalDate'. */
  matcherKey: string;
  usageCount: number;
  /** Up to 3 distinct cite sites (usageCount keeps the full count). */
  exampleCites: ObservedIdiomCite[];
  /** The pair-ruleset rule this idiom matched, or null when unmapped. */
  matchedRuleCode: string | null;
  /** The observed legacy idiom (verbatim type text where applicable). */
  from: string;
  /** The ruleset default target (rule.to), or null when unmapped. */
  defaultTo: string | null;
  provenance: ObservedIdiomProvenance;
  /** Rule notes (mapping tables / caveats) for the UI; null when unmapped. */
  notes: string | null;
  /** Set by the review pass when an LLM proposal fills defaultTo. */
  proposalRationale?: string;
}

// ---------------------------------------------------------------------------
// Internal accumulator
// ---------------------------------------------------------------------------

interface Accumulator {
  count: number;
  cites: ObservedIdiomCite[];
  citeKeys: Set<string>;
}

const MAX_EXAMPLE_CITES = 3;

function newAccumulator(): Accumulator {
  return { count: 0, cites: [], citeKeys: new Set() };
}

function bump(acc: Accumulator, cite: ObservedIdiomCite, by = 1): void {
  acc.count += by;
  const key = `${cite.symbol}\u0000${cite.sourcePath}`;
  if (!acc.citeKeys.has(key) && acc.cites.length < MAX_EXAMPLE_CITES) {
    acc.citeKeys.add(key);
    acc.cites.push(cite);
  }
}

function citeOf(contract: SclContractWire): ObservedIdiomCite {
  return {
    symbol: contract.source_symbol ?? contract.contract_key ?? '?',
    sourcePath: contract.source_path ?? '',
  };
}

/** Verbatim `opaque:<type>` occurrences in any stringified corpus text. */
const OPAQUE_TYPE_RE = /opaque:([A-Za-z_$][A-Za-z0-9_$.]*)/g;

function opaqueTypesIn(text: string): string[] {
  return [...text.matchAll(OPAQUE_TYPE_RE)].map((m) => m[1]);
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? '');
}

// ---------------------------------------------------------------------------
// Rule lookup helpers (all exact / prefix — deterministic)
// ---------------------------------------------------------------------------

function typeRuleFor(rules: ModernizationRule[], typeText: string): ModernizationRule | null {
  return (
    rules.find(
      (r) =>
        (r.matcher.kind === 'typeReference' || r.matcher.kind === 'sourceCarrier') &&
        r.matcher.value === typeText
    ) ?? null
  );
}

function flagRuleFor(rules: ModernizationRule[], flag: string): ModernizationRule | null {
  return rules.find((r) => r.matcher.kind === 'flag' && r.matcher.value === flag) ?? null;
}

function annotationRules(rules: ModernizationRule[]): ModernizationRule[] {
  return rules.filter((r) => r.matcher.kind === 'annotationPrefix');
}

function representationRule(rules: ModernizationRule[]): ModernizationRule | null {
  return rules.find((r) => r.matcher.kind === 'representation') ?? null;
}

function boundaryRule(rules: ModernizationRule[]): ModernizationRule | null {
  return rules.find((r) => r.matcher.kind === 'boundaryClass') ?? null;
}

// ---------------------------------------------------------------------------
// The inventory
// ---------------------------------------------------------------------------

/** Q- boundary contracts: explicit kind, or the Q- content-hash key prefix. */
export function isBoundaryContract(contract: SclContractWire): boolean {
  if (contract.kind === 'boundary') return true;
  return typeof contract.contract_key === 'string' && contract.contract_key.startsWith('Q-');
}

export function computeModernizationInventory(
  contracts: SclContractWire[],
  scanStats: Record<string, unknown>,
  ruleset: ModernizationRuleset = defaultModernizationRuleset()
): ObservedIdiom[] {
  const rules = ruleset.rules;

  // Third-party type observations, keyed by verbatim type text. A type seen
  // BOTH as a shape sourceCarrier and as an opaque typeRef merges into one
  // row; the matcherKey channel prefers sourceCarrier evidence.
  const typeAcc = new Map<string, Accumulator & { viaSourceCarrier: boolean }>();
  const bumpType = (typeText: string, contract: SclContractWire, viaSourceCarrier: boolean) => {
    let acc = typeAcc.get(typeText);
    if (!acc) {
      acc = { ...newAccumulator(), viaSourceCarrier: false };
      typeAcc.set(typeText, acc);
    }
    acc.viaSourceCarrier = acc.viaSourceCarrier || viaSourceCarrier;
    bump(acc, citeOf(contract));
  };

  // One accumulator per annotationPrefix RULE (unmatched annotations like
  // @Override are framework noise, not modernization idioms — skipped).
  const annotationAcc = new Map<string, Accumulator>();
  const annRules = annotationRules(rules);

  const flagAcc = new Map<string, Accumulator>();
  const pojoAcc = newAccumulator();
  const boundaryAcc = newAccumulator();

  for (const contract of contracts) {
    const body = contract.body_json ?? {};

    if (isBoundaryContract(contract)) {
      bump(boundaryAcc, citeOf(contract));
      continue;
    }

    if (contract.kind === 'shape') {
      const fields = Array.isArray((body as Record<string, unknown>).fields)
        ? ((body as Record<string, unknown>).fields as unknown[])
        : [];
      for (const field of fields) {
        const f = (field ?? {}) as Record<string, unknown>;
        if (typeof f.sourceCarrier === 'string' && f.sourceCarrier.length > 0) {
          bumpType(f.sourceCarrier, contract, true);
        }
        for (const opaqueType of opaqueTypesIn(asText(f.kind))) {
          bumpType(opaqueType, contract, false);
        }
      }
      if ((body as Record<string, unknown>).representation === 'pojo') {
        bump(pojoAcc, citeOf(contract));
      }
      const flags = Array.isArray((body as Record<string, unknown>).flags)
        ? ((body as Record<string, unknown>).flags as unknown[])
        : [];
      for (const flag of flags) {
        if (typeof flag !== 'string' || flag.length === 0) continue;
        const acc = flagAcc.get(flag) ?? newAccumulator();
        flagAcc.set(flag, acc);
        bump(acc, citeOf(contract));
      }
      continue;
    }

    if (contract.kind === 'behaviour_table') {
      const annotations = Array.isArray((body as Record<string, unknown>).annotations)
        ? ((body as Record<string, unknown>).annotations as unknown[])
        : [];
      for (const annotation of annotations) {
        const text = asText(annotation);
        for (const rule of annRules) {
          const anyOf = rule.matcher.kind === 'annotationPrefix' ? rule.matcher.anyOf : [];
          if (anyOf.some((prefix) => text.startsWith(prefix))) {
            const acc = annotationAcc.get(rule.code) ?? newAccumulator();
            annotationAcc.set(rule.code, acc);
            bump(acc, citeOf(contract));
          }
        }
      }
      const signatureInputs = Array.isArray((body as Record<string, unknown>).signatureInputs)
        ? ((body as Record<string, unknown>).signatureInputs as unknown[])
        : [];
      for (const input of signatureInputs) {
        for (const opaqueType of opaqueTypesIn(asText(input))) {
          bumpType(opaqueType, contract, false);
        }
      }
      const rows = Array.isArray((body as Record<string, unknown>).rows)
        ? ((body as Record<string, unknown>).rows as unknown[])
        : [];
      for (const row of rows) {
        for (const opaqueType of opaqueTypesIn(asText(row))) {
          bumpType(opaqueType, contract, false);
        }
      }
    }
  }

  // -- Assemble rows --------------------------------------------------------
  const idioms: ObservedIdiom[] = [];

  for (const [typeText, acc] of typeAcc) {
    const rule = typeRuleFor(rules, typeText);
    const channel = acc.viaSourceCarrier ? 'sourceCarrier' : 'typeReference';
    idioms.push({
      // Unmapped third-party types materialize under the generic 'types'
      // family until a rule (or an LLM proposal in the review pass) claims
      // them — the design's "core collections/types" catch-all.
      family: rule?.family ?? 'types',
      matcherKey: `${channel}:${typeText}`,
      usageCount: acc.count,
      exampleCites: acc.cites,
      matchedRuleCode: rule?.code ?? null,
      from: typeText,
      defaultTo: rule?.to ?? null,
      provenance: rule ? 'ruleset_default' : 'unmapped',
      notes: rule?.notes ?? null,
    });
  }

  for (const [ruleCode, acc] of annotationAcc) {
    const rule = rules.find((r) => r.code === ruleCode);
    if (!rule) continue;
    idioms.push({
      family: rule.family,
      matcherKey: `annotationPrefix:${rule.code}`,
      usageCount: acc.count,
      exampleCites: acc.cites,
      matchedRuleCode: rule.code,
      from: rule.from,
      defaultTo: rule.to,
      provenance: 'ruleset_default',
      notes: rule.notes ?? null,
    });
  }

  if (pojoAcc.count > 0) {
    const rule = representationRule(rules);
    idioms.push({
      family: rule?.family ?? 'dto',
      matcherKey: 'representation:pojo',
      usageCount: pojoAcc.count,
      exampleCites: pojoAcc.cites,
      matchedRuleCode: rule?.code ?? null,
      from: rule?.from ?? 'getter/setter POJO',
      defaultTo: rule?.to ?? null,
      provenance: rule ? 'ruleset_default' : 'unmapped',
      notes: rule?.notes ?? null,
    });
  }

  if (boundaryAcc.count > 0) {
    const rule = boundaryRule(rules);
    idioms.push({
      family: rule?.family ?? 'dataaccess',
      matcherKey: 'boundaryClass',
      usageCount: boundaryAcc.count,
      exampleCites: boundaryAcc.cites,
      matchedRuleCode: rule?.code ?? null,
      from: rule?.from ?? 'DAO / repository boundary classes',
      defaultTo: rule?.to ?? null,
      provenance: rule ? 'ruleset_default' : 'unmapped',
      notes: rule?.notes ?? null,
    });
  }

  for (const [flag, acc] of flagAcc) {
    const rule = flagRuleFor(rules, flag);
    idioms.push({
      // Un-ruled slicer flags (e.g. mutated-in-flight) still surface — they
      // are the collision evidence the review UI shows against dto rows.
      family: rule?.family ?? 'dto',
      matcherKey: `flag:${flag}`,
      usageCount: acc.count,
      exampleCites: acc.cites,
      matchedRuleCode: rule?.code ?? null,
      from: rule?.from ?? flag,
      defaultTo: rule?.to ?? null,
      provenance: rule ? 'ruleset_default' : 'unmapped',
      notes: rule?.notes ?? null,
    });
  }

  // -- Consolidation rows from scan-level findings --------------------------
  const findings = Array.isArray(scanStats.findings) ? (scanStats.findings as unknown[]) : [];
  const consolidationKinds: Array<{ kind: string; from: string }> = [
    { kind: 'near_duplicate_cluster', from: 'near-duplicate implementation cluster' },
    { kind: 'dispatch_ambiguity', from: 'ambiguous dynamic dispatch site' },
    // BEHAV-05 (2026-09-03): authorisation decided by data, not annotations —
    // a decision the target must make explicitly (keep data-derived ACLs).
    { kind: 'data_derived_authorisation', from: 'data-derived authorisation predicate' },
    { kind: 'aspect_pointcut_unresolved', from: 'aspect pointcut not resolvable statically' },
  ];
  for (const { kind, from } of consolidationKinds) {
    const acc = newAccumulator();
    for (const finding of findings) {
      const f = (finding ?? {}) as Record<string, unknown>;
      if (f.kind !== kind) continue;
      bump(acc, {
        symbol:
          typeof f.symbol === 'string' && f.symbol
            ? f.symbol
            : typeof f.contract_key === 'string'
              ? f.contract_key
              : '?',
        sourcePath: typeof f.source_path === 'string' ? f.source_path : '',
      });
    }
    if (acc.count > 0) {
      idioms.push({
        // Merge/keep consolidation calls ALWAYS need a human — no ruleset
        // default exists by design, so these ride 'unmapped' here and the
        // review pass proposes a starting point (labelled review-advised).
        family: 'consolidation',
        matcherKey: `consolidation:${kind}`,
        usageCount: acc.count,
        exampleCites: acc.cites,
        matchedRuleCode: null,
        from,
        defaultTo: null,
        provenance: 'unmapped',
        notes: null,
      });
    }
  }

  // Blast-radius ordering; matcherKey tiebreak keeps the output deterministic.
  idioms.sort(
    (a, b) => b.usageCount - a.usageCount || a.matcherKey.localeCompare(b.matcherKey)
  );
  return idioms;
}
