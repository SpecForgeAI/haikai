/**
 * The ONE manifest LLM gap-fill call (answers-51 + Tier-2 free facts).
 *
 * Spec: 2026-06-26-target-dependency-manifest-auto-answer-comprehensive (Spec 2)
 * — Task Group 5 (R5/FR5).
 *
 * Mirrors `architectConversation/prefillFromTechStack.ts`: composes a single
 * `SingleShotPrompt {system,user}`, calls the injected
 * `ArchitectLlmClient.callSingleShot`, strips ```json fences, defensively
 * `JSON.parse`s, runs a hand-rolled validator, and returns a typed
 * `success | failure` union. FAIL-OPEN: a thrown `SingleShotLlmCallError`, an
 * empty/unparseable body, or any validator rejection returns a `failure` (never
 * throws through) so the deterministic + inferred results still stand.
 *
 * ONE batched call does BOTH jobs:
 *   (a) ANSWERS-51: proposes answers to the manifest-answerable decision codes
 *       the deterministic registry MISSED, for the UNMATCHED dependency
 *       coordinates (badge `llm`, source-dependency carried). A single-choice
 *       value is guard-railed to the code's verbatim `questionLibrary.choices`.
 *   (b) TIER-2 FREE FACTS: names notable manifest-declared tech OUTSIDE the 51
 *       (e.g. MCP SDK, Spring AI) as informational `"<friendly> — <coordinate>"`
 *       labels — never new questions.
 *
 * Only the UNMATCHED deps (those `matchManifestCoordinate` returns null for) go
 * into the prompt, capped at {@link DEFAULT_MAX_DEPS}. The result is CACHED by a
 * manifest CONTENT HASH (a simple in-process Map): identical content does not
 * re-call; changed content re-calls. The LLM NEVER overrides a deterministic or
 * inferred hit — its rows feed Task Group 6 precedence at the lowest non-manual
 * rank.
 */

import * as crypto from 'crypto';
import type {
  ArchitectLlmClient,
  CallSingleShotOptions,
  SingleShotPrompt,
} from '../architectConversation/architectLlmClient';
import { SingleShotLlmCallError } from '../architectConversation/architectLlmClient';
import { logger } from '../logger';
import { matchManifestCoordinate } from './manifestCodeMapping';
import { ResolvedManifest } from './manifestVersionResolution';

/** Default cap on the number of unmatched deps fed into the prompt. */
export const DEFAULT_MAX_DEPS = 40;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * One manifest-answerable decision code still OPEN (not answered by the
 * deterministic / inferred layers). The orchestrator projects these from the
 * question library; the module both prompts with them and guard-rails any
 * single-choice answer against `choices`.
 */
export interface ManifestLlmAnswerableCode {
  code: string;
  prompt: string;
  expectedAnswerShape: string;
  choices?: readonly string[];
  /** Spec-1 versioned code => the LLM value is a bare-stem framework. */
  versioned: boolean;
}

export interface ManifestLlmGapFillArgs {
  /** Resolved manifests — the UNMATCHED deps are derived from these. */
  resolvedManifests: readonly ResolvedManifest[];
  /** The manifest-answerable codes still open (projected by the caller). */
  answerableCodes: readonly ManifestLlmAnswerableCode[];
  /** Injected single-shot LLM client (mirrors prefillFromTechStack). */
  llmClient: ArchitectLlmClient;
  /** Optional call settings (timeout, model). */
  callOptions?: CallSingleShotOptions;
  /** Cap on unmatched deps included in the prompt (default {@link DEFAULT_MAX_DEPS}). */
  maxDeps?: number;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/** One LLM-proposed answer to a manifest-answerable code (badge `llm`). */
export interface ManifestLlmAnswer {
  decisionCode: string;
  /** Bare-stem framework (versioned code) OR exact single-choice value. */
  value: string;
  /** True iff the code is a Spec-1 versioned code (=> framework-version write). */
  versioned: boolean;
  /** The unmatched dependency coordinate that drove this answer. */
  sourceDependency: string;
}

/** One Tier-2 "free fact" — manifest tech outside the 51 (informational only). */
export interface ManifestLlmFreeFact {
  /** `"<friendly name> — <coordinate>"` (em-dash separated). */
  label: string;
  friendlyName: string;
  coordinate: string;
}

export type ManifestLlmGapFillFailureReason =
  | 'llm-call-failed'
  | 'response-not-json'
  | 'validator-failed';

export type ManifestLlmGapFillResult =
  | {
      kind: 'success';
      answers: ManifestLlmAnswer[];
      freeFacts: ManifestLlmFreeFact[];
      /** True iff served from the content-hash cache (no LLM call was made). */
      cached: boolean;
    }
  | {
      kind: 'failure';
      reason: ManifestLlmGapFillFailureReason;
      errorMessage: string;
    };

// ---------------------------------------------------------------------------
// Unmatched-dependency extraction
// ---------------------------------------------------------------------------

interface UnmatchedDep {
  coordinate: string;
  version: string;
}

/**
 * The UNMATCHED dependency coordinates across all resolved manifests — the deps
 * the deterministic coordinate registry did NOT recognise (the gap the LLM
 * fills). De-duplicated by coordinate, in first-seen order, capped at `maxDeps`.
 */
export function collectUnmatchedDependencies(
  manifests: readonly ResolvedManifest[],
  maxDeps: number,
): UnmatchedDep[] {
  const seen = new Set<string>();
  const out: UnmatchedDep[] = [];
  for (const manifest of manifests) {
    for (const dep of manifest.resolvedDependencies) {
      if (matchManifestCoordinate(dep)) continue; // registry already covers it
      if (seen.has(dep.name)) continue;
      seen.add(dep.name);
      out.push({ coordinate: dep.name, version: dep.resolvedVersion });
      if (out.length >= maxDeps) return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Content-hash cache (in-process)
// ---------------------------------------------------------------------------

const gapFillCache = new Map<string, ManifestLlmGapFillResult>();

/** Clear the in-process gap-fill cache (test seam). */
export function clearManifestLlmGapFillCache(): void {
  gapFillCache.clear();
}

/**
 * Stable content hash over the UNMATCHED deps + the OPEN answerable codes. The
 * hash changes exactly when the manifest content (the unmatched coordinates /
 * versions) or the open-code set changes, so the cache re-runs only on a real
 * content change.
 */
export function computeManifestGapFillContentHash(
  unmatched: readonly UnmatchedDep[],
  answerableCodes: readonly ManifestLlmAnswerableCode[],
): string {
  const canonical = JSON.stringify({
    deps: unmatched.map((d) => `${d.coordinate}@${d.version}`),
    codes: answerableCodes.map((c) => c.code).sort(),
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are a dependency classifier for an architecture-migration tool.',
  'You are given a list of UNMATCHED target-build dependency coordinates (the deterministic registry could not classify them) and a list of still-OPEN architecture decision codes.',
  '',
  'Do TWO jobs in ONE JSON response:',
  '1. ANSWERS: when an unmatched coordinate UNAMBIGUOUSLY answers one of the supplied open decision codes, add an entry to `answers`. Use the coordinate as `sourceDependency`. For a single-choice code, `value` MUST be one of that code\'s supplied `choices` verbatim. For a versioned code, `value` is the bare framework name (no version). Strong matches only — never guess.',
  '2. FREE FACTS: for a coordinate that is notable technology OUTSIDE the supplied decision codes (e.g. an MCP SDK, an LLM client, a feature-flag SDK), add an entry to `freeFacts` with a short human `friendlyName` and the `coordinate`. These are informational only.',
  '',
  'Rules: never invent a decisionCode that was not supplied; never answer a code from a coordinate that does not clearly imply it; an unmatched coordinate may appear in `answers` OR `freeFacts` OR neither.',
  '',
  'Response shape (JSON only — no markdown, no commentary):',
  '{',
  '  "answers": [',
  '    { "decisionCode": "<code>", "value": "<bare framework or verbatim choice>", "sourceDependency": "<coordinate>" }',
  '  ],',
  '  "freeFacts": [',
  '    { "friendlyName": "<short name>", "coordinate": "<coordinate>" }',
  '  ]',
  '}',
].join('\n');

/** Build the user-prompt half of the single-shot call. Exported for tests. */
export function buildManifestGapFillUserPrompt(
  unmatched: readonly UnmatchedDep[],
  answerableCodes: readonly ManifestLlmAnswerableCode[],
): string {
  const sections: string[] = [];

  sections.push('## UNMATCHED DEPENDENCIES');
  if (unmatched.length === 0) {
    sections.push('(none)');
  } else {
    for (const d of unmatched) {
      sections.push(`- ${d.coordinate} (${d.version})`);
    }
  }
  sections.push('');

  sections.push('## OPEN DECISION CODES');
  if (answerableCodes.length === 0) {
    sections.push('(none)');
  } else {
    for (const c of answerableCodes) {
      sections.push(`- decisionCode: ${c.code}`);
      sections.push(`  prompt: ${c.prompt}`);
      sections.push(`  answerShape: ${c.expectedAnswerShape}`);
      if (c.choices && c.choices.length > 0) {
        sections.push(`  choices: ${c.choices.join(' | ')}`);
      }
    }
  }

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Fence-strip + defensive parse (mirrors prefillFromTechStack)
// ---------------------------------------------------------------------------

/** Strip ```json ... ``` / ``` ... ``` fences. Exported for unit tests. */
export function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenceRegex = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i;
  const match = trimmed.match(fenceRegex);
  if (match) return match[1].trim();
  return trimmed;
}

// ---------------------------------------------------------------------------
// Validator (hand-rolled — mirrors the prefill validator posture)
// ---------------------------------------------------------------------------

function buildLabel(friendlyName: string, coordinate: string): string {
  return `${friendlyName} — ${coordinate}`;
}

/**
 * Validate the parsed LLM payload into the typed answers + freeFacts. The
 * top-level shape MUST be an object with `answers` + `freeFacts` arrays (else a
 * failure); INDIVIDUAL malformed / off-contract entries are dropped (logged),
 * not fatal — a single bad row never sinks the whole gap-fill.
 */
export function validateManifestGapFillResponse(
  parsed: unknown,
  answerableCodes: readonly ManifestLlmAnswerableCode[],
):
  | { ok: true; answers: ManifestLlmAnswer[]; freeFacts: ManifestLlmFreeFact[] }
  | { ok: false; error: string } {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'gap-fill response is not a JSON object' };
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.answers) || !Array.isArray(obj.freeFacts)) {
    return { ok: false, error: 'gap-fill response is missing `answers` / `freeFacts` arrays' };
  }

  const codeByName = new Map<string, ManifestLlmAnswerableCode>();
  for (const c of answerableCodes) codeByName.set(c.code, c);

  const answers: ManifestLlmAnswer[] = [];
  for (const raw of obj.answers) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const decisionCode = typeof a.decisionCode === 'string' ? a.decisionCode : '';
    const value = typeof a.value === 'string' ? a.value.trim() : '';
    const sourceDependency =
      typeof a.sourceDependency === 'string' ? a.sourceDependency.trim() : '';
    const code = codeByName.get(decisionCode);
    if (!code || value.length === 0 || sourceDependency.length === 0) {
      logger.debug('manifest gap-fill: dropping off-contract LLM answer', {
        decisionCode,
      });
      continue;
    }
    // R10 guard-rail: a single-choice value must be a verbatim choice member.
    if (!code.versioned && code.choices && !code.choices.includes(value)) {
      logger.debug('manifest gap-fill: dropping single-choice value outside choices', {
        decisionCode,
        value,
      });
      continue;
    }
    answers.push({
      decisionCode,
      value,
      versioned: code.versioned,
      sourceDependency,
    });
  }

  const freeFacts: ManifestLlmFreeFact[] = [];
  for (const raw of obj.freeFacts) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as Record<string, unknown>;
    const friendlyName = typeof f.friendlyName === 'string' ? f.friendlyName.trim() : '';
    const coordinate = typeof f.coordinate === 'string' ? f.coordinate.trim() : '';
    if (friendlyName.length === 0 || coordinate.length === 0) continue;
    freeFacts.push({
      friendlyName,
      coordinate,
      label: buildLabel(friendlyName, coordinate),
    });
  }

  return { ok: true, answers, freeFacts };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the single batched, fail-open gap-fill. Returns cached results when the
 * content hash is unchanged. A degenerate input (no unmatched deps AND no open
 * codes) short-circuits to an empty success WITHOUT calling the LLM.
 */
export async function runManifestLlmGapFill(
  args: ManifestLlmGapFillArgs,
): Promise<ManifestLlmGapFillResult> {
  const maxDeps = args.maxDeps ?? DEFAULT_MAX_DEPS;
  const unmatched = collectUnmatchedDependencies(args.resolvedManifests, maxDeps);

  // Degenerate: nothing to ask about — empty success, no LLM call.
  if (unmatched.length === 0) {
    return { kind: 'success', answers: [], freeFacts: [], cached: false };
  }

  const cacheKey = computeManifestGapFillContentHash(unmatched, args.answerableCodes);
  const cached = gapFillCache.get(cacheKey);
  if (cached) {
    // Re-serve the cached outcome; a cached SUCCESS is flagged `cached: true`.
    return cached.kind === 'success' ? { ...cached, cached: true } : cached;
  }

  const prompt: SingleShotPrompt = {
    system: SYSTEM_PROMPT,
    user: buildManifestGapFillUserPrompt(unmatched, args.answerableCodes),
  };

  let rawContent: string;
  try {
    const response = await args.llmClient.callSingleShot(prompt, args.callOptions);
    rawContent = response.content ?? '';
  } catch (err) {
    // FAIL-OPEN: a provider/network error (SingleShotLlmCallError or any throw)
    // becomes a typed failure — the deterministic + inferred results still stand.
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.warn('manifest gap-fill: single-shot LLM call failed (fail-open)', {
      error: errorMessage,
      isSingleShotError: err instanceof SingleShotLlmCallError,
    });
    const failure: ManifestLlmGapFillResult = {
      kind: 'failure',
      reason: 'llm-call-failed',
      errorMessage,
    };
    gapFillCache.set(cacheKey, failure);
    return failure;
  }

  if (typeof rawContent !== 'string' || rawContent.trim().length === 0) {
    const failure: ManifestLlmGapFillResult = {
      kind: 'failure',
      reason: 'response-not-json',
      errorMessage: 'manifest gap-fill returned an empty response',
    };
    gapFillCache.set(cacheKey, failure);
    return failure;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(rawContent));
  } catch (err) {
    const failure: ManifestLlmGapFillResult = {
      kind: 'failure',
      reason: 'response-not-json',
      errorMessage: `manifest gap-fill response was not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
    gapFillCache.set(cacheKey, failure);
    return failure;
  }

  const validation = validateManifestGapFillResponse(parsed, args.answerableCodes);
  if (!validation.ok) {
    const failure: ManifestLlmGapFillResult = {
      kind: 'failure',
      reason: 'validator-failed',
      errorMessage: validation.error,
    };
    gapFillCache.set(cacheKey, failure);
    return failure;
  }

  const success: ManifestLlmGapFillResult = {
    kind: 'success',
    answers: validation.answers,
    freeFacts: validation.freeFacts,
    cached: false,
  };
  gapFillCache.set(cacheKey, success);
  return success;
}
