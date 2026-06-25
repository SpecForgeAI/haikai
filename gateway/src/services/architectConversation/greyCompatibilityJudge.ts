/**
 * Grey-area compatibility LLM-judge (code-pre-filter-then-LLM, fail-open) —
 * Target-conversation tech-stack constraints
 * (Spec 2026-06-24-target-conversation-tech-stack-constraints, FR3 LLM half).
 *
 * This module is the LLM half of the code-pre-filter-then-LLM pattern (the same
 * shape used by vuln-dedup). The DETERMINISTIC pre-filter lives in Task Group 2
 * (`branchLists.ts` `resolveBranchSubset` + `compatibilityMatrix.ts`
 * `resolveCompatibility`). Only the genuinely ambiguous residue — the candidates
 * the deterministic matrix returns `undecided` for — ever reaches the LLM here.
 *
 * Guarantees (all enforced + tested):
 *   1. HAPPY PATH IS NEVER AN LLM CALL. When the deterministic matrix resolves
 *      every candidate (keep/hide), `deps.llmClient` is NOT invoked.
 *   2. FAIL-OPEN. If the judge throws, times out, or returns a malformed/partial
 *      verdict, the FULL candidate set is offered (every residue candidate is
 *      kept). The conversation is never blocked by an LLM failure.
 *   3. NO SILENT DROPS. Every adjudication (deterministic OR LLM) logs the input
 *      + the keep/hide outcome via the shared `logger`.
 *
 * This module performs the per-question adjudication only. Task Group 4
 * (`choiceFilter.ts`) consumes the keep/hide result to actually HIDE the
 * incompatible choices, append the `Other (advanced)` escape hatch, and skip
 * moot questions. Nothing here mutates the offered set; it returns verdicts.
 *
 * The injectable-deps shape mirrors `OpenTurnTechStackPrefillDeps`: a `deps`
 * object carrying the `ArchitectLlmClient` (default supplied), so tests can
 * assert the LLM is/ isn't called and inject keep/hide verdicts or failures.
 */

import type {
  ArchitectLlmClient,
  CallSingleShotOptions,
  SingleShotPrompt,
} from './architectLlmClient';
import {
  COMPATIBILITY_MATRIX,
  resolveCompatibility,
  type CompatibilityVerdict,
} from '../../config/architect-conversation/compatibilityMatrix';
import { resolveBranchSubset } from '../../config/architect-conversation/branchLists';
import { logger } from '../logger';

// ---------------------------------------------------------------------------
// Verdict shapes
// ---------------------------------------------------------------------------

/** Final per-candidate verdict after deterministic + (optional) LLM passes. */
export type FinalVerdict = 'keep' | 'hide';

/** How a candidate's final verdict was reached (for logging + tests). */
export type VerdictSource = 'deterministic' | 'llm-judge' | 'fail-open';

export interface CandidateVerdict {
  /** The candidate choice string this verdict is about. */
  candidate: string;
  /** Final keep/hide verdict. */
  verdict: FinalVerdict;
  /** Where the verdict came from: the matrix, the LLM, or fail-open default. */
  source: VerdictSource;
}

export interface AdjudicateGreyQuestionResult {
  /** The question code adjudicated. */
  questionCode: string;
  /** One verdict per input candidate, in input order. */
  verdicts: CandidateVerdict[];
  /** The kept subset (convenience; `verdicts` filtered to `keep`). */
  kept: string[];
  /** The hidden subset (convenience; `verdicts` filtered to `hide`). */
  hidden: string[];
  /** True iff the LLM-judge was actually invoked for this question. */
  llmInvoked: boolean;
  /**
   * Set when the LLM-judge was invoked but failed (threw / unavailable /
   * malformed) and the residue was therefore failed-open. `null` on the
   * deterministic-only path or a clean LLM verdict.
   */
  failOpenReason: string | null;
}

// ---------------------------------------------------------------------------
// Injectable dependencies (test seam) — mirrors OpenTurnTechStackPrefillDeps
// ---------------------------------------------------------------------------

export interface GreyCompatibilityJudgeDeps {
  /** Single-shot LLM client used ONLY for the genuinely ambiguous residue. */
  llmClient: ArchitectLlmClient;
  /** Optional call settings forwarded to the single-shot adapter. */
  callOptions?: CallSingleShotOptions;
}

/**
 * Default deps. The default `llmClient` THROWS on use — the production wiring
 * injects the real route-level adapter (see `routes/architectConversation.ts`'s
 * `buildArchitectLlmClient()`). A throwing default keeps the deterministic happy
 * path honest: any accidental LLM call on a clear-cut question fails loudly in a
 * mis-wired caller rather than silently degrading.
 */
export const defaultGreyCompatibilityJudgeDeps: GreyCompatibilityJudgeDeps = {
  llmClient: {
    callLlmToolLoop: async () => {
      throw new Error(
        'greyCompatibilityJudge: no real ArchitectLlmClient was injected; ' +
          'callLlmToolLoop is unavailable on the default deps.',
      );
    },
    callSingleShot: async () => {
      throw new Error(
        'greyCompatibilityJudge: no real ArchitectLlmClient was injected; ' +
          'callSingleShot is unavailable on the default deps.',
      );
    },
  },
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface AdjudicateGreyQuestionArgs {
  /** The grey question's decision code (e.g. `ui.designSystem`). */
  questionCode: string;
  /**
   * The candidate choices to adjudicate. Task Group 4 passes the question's
   * `choices` (already narrowed by any branch-list); the judge re-derives the
   * deterministic verdict per candidate and only escalates the residue.
   */
  candidates: readonly string[];
  /**
   * Foundational answers gathered so far (decision code -> answer). The same
   * shape `resolveCompatibility` / `resolveBranchSubset` consume.
   */
  foundationalAnswers: Readonly<Record<string, string | readonly string[]>>;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are a tech-stack compatibility judge for an architecture migration tool.',
  'You are given ONE architect-conversation question, the foundational answers the architect has already chosen (e.g. service.language, service.framework, db.engine, ui.framework, api.protocol), and a short list of CANDIDATE choices that a deterministic pre-filter could not classify.',
  'For EACH candidate decide whether it is COMPATIBLE ("keep") or INCOMPATIBLE ("hide") with the foundational answers.',
  '',
  'Rules:',
  '1. "hide" ONLY a candidate that is genuinely incompatible with the chosen foundation (e.g. a JVM-only library when the language is Python). When in doubt, KEEP — never hide a plausibly-usable option.',
  '2. Judge ONLY the candidates supplied. Do not invent candidates and do not drop any: every supplied candidate MUST appear exactly once in the response.',
  '3. Do not consider versions or vulnerabilities — only technology-stack compatibility.',
  '',
  'Response shape (JSON only — no surrounding markdown, no commentary):',
  '{',
  '  "verdicts": [',
  '    { "candidate": "<verbatim candidate>", "verdict": "keep"|"hide" }',
  '  ]',
  '}',
].join('\n');

/** Build the user prompt half of the single-shot judge call. */
export function buildGreyJudgeUserPrompt(
  questionCode: string,
  residue: readonly string[],
  foundationalAnswers: Readonly<Record<string, string | readonly string[]>>,
): string {
  const lines: string[] = [];
  lines.push(`## QUESTION`);
  lines.push(`decisionCode: ${questionCode}`);
  lines.push('');
  lines.push('## FOUNDATIONAL ANSWERS');
  const keys = Object.keys(foundationalAnswers).sort();
  if (keys.length === 0) {
    lines.push('(none captured yet)');
  } else {
    for (const k of keys) {
      const v = foundationalAnswers[k];
      lines.push(`- ${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
    }
  }
  lines.push('');
  lines.push('## CANDIDATES (classify each as keep or hide)');
  for (const c of residue) {
    lines.push(`- ${c}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// LLM response parsing (defensive — any malformation => fail-open)
// ---------------------------------------------------------------------------

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenceRegex = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i;
  const match = trimmed.match(fenceRegex);
  return match ? match[1].trim() : trimmed;
}

/**
 * Parse the LLM judge response into a verdict map. Returns `null` (=> fail-open)
 * if the payload is not parseable into a `{ candidate, verdict }[]` shape. A
 * verdict for a candidate not in the residue is ignored; a missing verdict for a
 * residue candidate defaults to `keep` at the call site (fail-open per-candidate).
 */
function parseJudgeVerdicts(
  rawContent: string,
): Record<string, FinalVerdict> | null {
  const cleaned = stripJsonFences(rawContent ?? '');
  if (cleaned.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { verdicts?: unknown }).verdicts)
  ) {
    return null;
  }
  const out: Record<string, FinalVerdict> = {};
  for (const v of (parsed as { verdicts: unknown[] }).verdicts) {
    if (v === null || typeof v !== 'object') continue;
    const cand = (v as { candidate?: unknown }).candidate;
    const verdict = (v as { verdict?: unknown }).verdict;
    if (typeof cand !== 'string') continue;
    if (verdict === 'keep' || verdict === 'hide') {
      out[cand] = verdict;
    }
    // Any other verdict string => treat as absent => fail-open keep downstream.
  }
  return out;
}

// ---------------------------------------------------------------------------
// Core adjudication
// ---------------------------------------------------------------------------

/**
 * Adjudicate a single grey question's candidates.
 *
 * Pipeline (per FR3):
 *   1. Run the deterministic compatibility matrix (`resolveCompatibility`) on
 *      each candidate. `keep`/`hide` are FINAL; `undecided` forms the residue.
 *   2. If the residue is empty => NO LLM CALL. Return the deterministic verdicts.
 *   3. Otherwise invoke the single-shot LLM-judge on the residue ONLY.
 *      - A clean keep/hide verdict per residue candidate is honoured.
 *      - A missing verdict, malformed payload, throw, or timeout => FAIL-OPEN:
 *        the affected residue candidate(s) are KEPT.
 *   4. Log every adjudication (deterministic + LLM + fail-open) with the input
 *      and the keep/hide outcome. No silent drops.
 */
export async function adjudicateGreyQuestion(
  args: AdjudicateGreyQuestionArgs,
  deps: GreyCompatibilityJudgeDeps = defaultGreyCompatibilityJudgeDeps,
): Promise<AdjudicateGreyQuestionResult> {
  const { questionCode, candidates, foundationalAnswers } = args;

  // ---- Step 1: deterministic pre-filter (no LLM). ----
  const verdicts: CandidateVerdict[] = [];
  const residue: string[] = [];
  for (const candidate of candidates) {
    const det: CompatibilityVerdict = resolveCompatibility(
      questionCode,
      candidate,
      foundationalAnswers,
    );
    if (det === 'keep' || det === 'hide') {
      verdicts.push({ candidate, verdict: det, source: 'deterministic' });
      logger.debug('grey-judge: deterministic verdict', {
        questionCode,
        candidate,
        verdict: det,
        source: 'deterministic',
      });
    } else {
      // `undecided` — escalate to the LLM-judge.
      residue.push(candidate);
    }
  }

  // ---- Step 2: empty residue => never call the LLM. ----
  if (residue.length === 0) {
    return finalise(questionCode, verdicts, /* llmInvoked */ false, null);
  }

  // ---- Step 3: invoke the single-shot LLM-judge on the residue ONLY. ----
  const prompt: SingleShotPrompt = {
    system: SYSTEM_PROMPT,
    user: buildGreyJudgeUserPrompt(questionCode, residue, foundationalAnswers),
  };

  let verdictMap: Record<string, FinalVerdict> | null = null;
  let failOpenReason: string | null = null;
  try {
    const response = await deps.llmClient.callSingleShot(
      prompt,
      deps.callOptions,
    );
    verdictMap = parseJudgeVerdicts(response?.content ?? '');
    if (verdictMap === null) {
      failOpenReason =
        'grey-judge LLM returned an empty or malformed response; residue failed open (kept)';
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failOpenReason = `grey-judge LLM call failed (${message}); residue failed open (kept)`;
    verdictMap = null;
  }

  if (failOpenReason) {
    logger.warn('grey-judge: failing open for grey residue', {
      questionCode,
      residue,
      reason: failOpenReason,
    });
  }

  // ---- Step 4: fold the LLM verdicts in; fail-open per missing candidate. ----
  for (const candidate of residue) {
    const llmVerdict = verdictMap ? verdictMap[candidate] : undefined;
    if (llmVerdict === 'keep' || llmVerdict === 'hide') {
      verdicts.push({ candidate, verdict: llmVerdict, source: 'llm-judge' });
      logger.debug('grey-judge: llm verdict', {
        questionCode,
        candidate,
        verdict: llmVerdict,
        source: 'llm-judge',
      });
    } else {
      // Fail-open: no clean verdict for this residue candidate => KEEP it.
      verdicts.push({ candidate, verdict: 'keep', source: 'fail-open' });
      logger.warn('grey-judge: candidate failed open (kept)', {
        questionCode,
        candidate,
        verdict: 'keep',
        source: 'fail-open',
      });
    }
  }

  return finalise(questionCode, verdicts, /* llmInvoked */ true, failOpenReason);
}

/**
 * Re-order the verdicts back into the original candidate input order and build
 * the convenience kept/hidden lists + summary.
 */
function finalise(
  questionCode: string,
  verdicts: CandidateVerdict[],
  llmInvoked: boolean,
  failOpenReason: string | null,
): AdjudicateGreyQuestionResult {
  const kept = verdicts.filter((v) => v.verdict === 'keep').map((v) => v.candidate);
  const hidden = verdicts
    .filter((v) => v.verdict === 'hide')
    .map((v) => v.candidate);
  return {
    questionCode,
    verdicts,
    kept,
    hidden,
    llmInvoked,
    failOpenReason,
  };
}

// ---------------------------------------------------------------------------
// Convenience predicate
// ---------------------------------------------------------------------------

/** True iff `questionCode` has a deterministic compatibility rule (grey). */
export function isGreyJudgeQuestion(questionCode: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    COMPATIBILITY_MATRIX,
    questionCode,
  );
}

/**
 * Re-export so a caller composing the full pipeline (branch-list narrowing then
 * grey adjudication) can resolve the branch subset without a second import.
 */
export { resolveBranchSubset };
