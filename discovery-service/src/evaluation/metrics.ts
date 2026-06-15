/**
 * Per-fixture scoring for the V3 evaluation harness.
 *
 * Spec: `agent-os/specs/2026-04-19-v3-evaluation-harness` (Task Group 2.2 + 2.3).
 *
 * This module computes the five per-fixture metrics documented in the spec:
 *
 *   1. Pack recall        — `'pack'`-tagged expected hits over total.
 *   2. Gap-fill precision — LLM candidates matching `'gap-fill'` or `'either'`
 *                           expected entries over total LLM candidates.
 *   3. Gap-fill recall    — `'gap-fill'`-tagged expected hits over total
 *                           `'gap-fill'`-tagged expected.
 *   4. Duplication rate   — LLM candidates matching an adapter (pack) output
 *                           key over total LLM candidates.
 *   5. Hallucination rate — LLM candidates with no expected match OR matching
 *                           a `shouldNotEmit` entry over total LLM candidates.
 *
 * Matching uses the canonical dedup key from `services/prompts/dedup.ts`:
 * `(type, normalizeName(name), forward-slash filePath)`. The `shouldNotEmit`
 * match is intentionally filePath-agnostic (just `{ type, name }`), per spec
 * Q4 and the "Matching semantics" section.
 *
 * Design choices worth calling out:
 * - No re-implementation of normalization. We import `normalizeName` and
 *   `dedupKeyString` from `services/prompts/dedup.ts` directly so the harness
 *   cannot drift from production dedup rules.
 * - Every LLM candidate is classified into at most one of four buckets:
 *     (duplicate)        — matches a pack output key,
 *     (gap-fill hit)     — matches `'gap-fill'` or `'either'` expected,
 *     (pack-tag hit)     — matches `'pack'`-tagged expected (counts toward
 *                          duplication, NOT gap-fill precision, unless it is
 *                          already classified as a pack-output duplicate),
 *     (hallucination)    — no match OR `shouldNotEmit` match.
 *   The duplication and hallucination numerators are independent: a candidate
 *   matching `shouldNotEmit` AND the pack key is both a duplicate and a
 *   hallucination; the overlap is rare in practice but handled consistently
 *   by this module.
 */

import {
  dedupKeyString,
  forwardSlashNormalize,
  normalizeName,
} from '../services/prompts/dedup';
import type {
  ExpectedCandidate,
  FixtureCase,
  FixtureReport,
  MetricCountSet,
  MetricValues,
  PipelineInvocationCandidate,
  PipelineInvocationResult,
  ShouldNotEmitEntry,
} from './types';

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Score one fixture's pipeline output against its expectations and return a
 * fully-populated `FixtureReport` (counts + derived values).
 *
 * The runner delegates here once per fixture. `computeValues` is kept public
 * so Group 4's formatter can reuse it if it wants derived rates for
 * aggregates built from other count sets.
 */
export function scoreFixture(
  fixture: FixtureCase,
  pipelineResult: PipelineInvocationResult,
): FixtureReport {
  const counts = computeCounts(fixture, pipelineResult);
  return {
    frameworkId: fixture.frameworkId,
    caseId: fixture.caseId,
    sourceFileName: fixture.sourceFileName,
    counts,
    values: computeValues(counts),
  };
}

/**
 * Compute raw counts only (no division). Exported so the aggregation module
 * and any future consumers can stop at counts and micro-average elsewhere
 * without re-pulling the derived rates.
 */
export function computeCounts(
  fixture: FixtureCase,
  pipelineResult: PipelineInvocationResult,
): MetricCountSet {
  const packCandidates = pipelineResult.packCandidates ?? [];
  const llmCandidates = pipelineResult.llmCandidates ?? [];
  const expected = fixture.expectations.expected ?? [];
  const shouldNotEmit = fixture.expectations.shouldNotEmit ?? [];

  // Index structures built once per fixture.
  //
  // - `packKeySet`:            dedup-key strings of every pack candidate. Used
  //                            by duplication-rate + pack-recall match checks.
  // - `llmKeySet`:             dedup-key strings of every LLM candidate. Used
  //                            by pack-recall + gap-fill-recall when an
  //                            `'either'`/`'gap-fill'` expected entry is
  //                            checked against LLM output.
  // - `expectedByKey`:         dedup-key -> expected entry (for LLM-vs-expected lookup).
  // - `shouldNotEmitByTypeName`: `type\u0000normalized` -> entry (filePath-agnostic).
  const packKeySet = new Set<string>();
  for (const p of packCandidates) packKeySet.add(candidateKey(p));

  const llmKeySet = new Set<string>();
  for (const l of llmCandidates) llmKeySet.add(candidateKey(l));

  const expectedByKey = new Map<string, ExpectedCandidate>();
  for (const e of expected) {
    expectedByKey.set(expectedKeyForFixture(e, fixture.sourceFileName), e);
  }

  const shouldNotEmitByTypeName = new Set<string>();
  for (const s of shouldNotEmit) {
    shouldNotEmitByTypeName.add(shouldNotEmitKey(s));
  }

  // --- Pack recall -----------------------------------------------------------
  // Numerator: count of `'pack'`-tagged expected entries whose key matches
  // some pack candidate's key. (Spec: pack recall credit goes to adapter
  // output only — LLM hits do NOT rescue a pack miss.)
  let packRecallNum = 0;
  let packRecallDen = 0;
  for (const e of expected) {
    if (e.tag !== 'pack') continue;
    packRecallDen += 1;
    if (packKeySet.has(expectedKeyForFixture(e, fixture.sourceFileName))) {
      packRecallNum += 1;
    }
  }

  // --- Gap-fill recall -------------------------------------------------------
  // Numerator: count of `'gap-fill'`-tagged expected entries whose key
  // matches some LLM candidate's key.
  let gapFillRecallNum = 0;
  let gapFillRecallDen = 0;
  for (const e of expected) {
    if (e.tag !== 'gap-fill') continue;
    gapFillRecallDen += 1;
    if (llmKeySet.has(expectedKeyForFixture(e, fixture.sourceFileName))) {
      gapFillRecallNum += 1;
    }
  }

  // --- Per-LLM-candidate classification --------------------------------------
  // One pass over the LLM output computes all three LLM-denominated metrics
  // (gap-fill precision, duplication rate, hallucination rate).
  let gapFillPrecisionNum = 0;
  let duplicationNum = 0;
  let hallucinationNum = 0;
  const llmDen = llmCandidates.length;

  for (const l of llmCandidates) {
    const key = candidateKey(l);
    const expectedEntry = expectedByKey.get(key);
    const isDuplicate = packKeySet.has(key);
    const isShouldNotEmit = shouldNotEmitByTypeName.has(candidateShouldNotEmitKey(l));

    // gap-fill precision: credit given when matching a 'gap-fill' or 'either'
    // expected entry. A match against a 'pack'-tagged expected is NOT a
    // gap-fill precision hit (the LLM is restating an adapter finding and
    // will already be flagged as a duplicate elsewhere).
    if (expectedEntry && (expectedEntry.tag === 'gap-fill' || expectedEntry.tag === 'either')) {
      gapFillPrecisionNum += 1;
    }

    // Duplication rate: LLM key overlaps with any pack candidate's key.
    if (isDuplicate) {
      duplicationNum += 1;
    }

    // Hallucination rate: the LLM candidate has no expected match AT ALL
    // (across any tag) OR it explicitly matches a `shouldNotEmit` entry.
    // A 'pack'-tagged expected match counts as "known output" and is NOT a
    // hallucination, even though it also does not contribute to gap-fill
    // precision.
    if (isShouldNotEmit || !expectedEntry) {
      hallucinationNum += 1;
    }
  }

  return {
    packRecall: { numerator: packRecallNum, denominator: packRecallDen },
    gapFillPrecision: { numerator: gapFillPrecisionNum, denominator: llmDen },
    gapFillRecall: { numerator: gapFillRecallNum, denominator: gapFillRecallDen },
    duplicationRate: { numerator: duplicationNum, denominator: llmDen },
    hallucinationRate: { numerator: hallucinationNum, denominator: llmDen },
  };
}

/**
 * Compute derived metric rate values from raw counts. Returns `NaN` when a
 * denominator is zero — Group 4's formatter decides how to render that.
 */
export function computeValues(counts: MetricCountSet): MetricValues {
  const v = (c: { numerator: number; denominator: number }) =>
    c.denominator === 0 ? NaN : c.numerator / c.denominator;
  return {
    packRecall: v(counts.packRecall),
    gapFillPrecision: v(counts.gapFillPrecision),
    gapFillRecall: v(counts.gapFillRecall),
    duplicationRate: v(counts.duplicationRate),
    hallucinationRate: v(counts.hallucinationRate),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers — matching key builders.
//
// These thin adapters centralize the "what is the key for this entity" logic
// so the scorer body reads cleanly. All of them delegate to the canonical
// dedup helpers from `services/prompts/dedup.ts`.
// ---------------------------------------------------------------------------

/**
 * Build the canonical dedup key string for a pipeline candidate.
 *
 * Uses the shared `dedupKeyString` helper verbatim — if production dedup
 * rules change, the harness matches change in lockstep with zero edits here.
 */
function candidateKey(c: PipelineInvocationCandidate): string {
  return dedupKeyString(c);
}

/**
 * Build the filePath-agnostic key used for `shouldNotEmit` matching. Spec Q4
 * mandates filePath-agnostic matching for negative examples so they stay
 * robust to path-normalization differences.
 */
function candidateShouldNotEmitKey(c: PipelineInvocationCandidate): string {
  return `${c.type}\u0000${normalizeName(c.name)}`;
}

function shouldNotEmitKey(s: ShouldNotEmitEntry): string {
  return `${s.type}\u0000${normalizeName(s.name)}`;
}

/**
 * Build the canonical dedup key for an `expected.json` entry. Expected
 * entries do NOT carry a filePath (by design — see spec Q3), so we derive it
 * from the fixture's source filename. All candidates produced from one
 * fixture share this filePath.
 */
function expectedKeyForFixture(e: ExpectedCandidate, sourceFileName: string): string {
  return dedupKeyString({
    type: e.type,
    name: e.name,
    filePath: forwardSlashNormalize(sourceFileName),
  });
}
