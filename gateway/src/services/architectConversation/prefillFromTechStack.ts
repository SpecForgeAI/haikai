/**
 * Tech-Stack Pre-fill Orchestration — Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write
 * (Spec 2026-05-25, Task Group 2).
 *
 * Single-shot LLM call that extracts pre-fillable answers from organisation-
 * and project-level `tech-stack.md` content. Invoked from the architect-
 * conversation `open` turn after auto-skip has selected the candidate
 * decision codes (Task Group 3).
 *
 * Architecture:
 *   1. The orchestrator (Task Group 3) calls `loadTechStackMarkdown` to read
 *      both files.
 *   2. The orchestrator calls this module's `prefillFromTechStack(...)`,
 *      passing the markdown blobs + the candidate decision codes + light
 *      project context.
 *   3. This module composes a system + user prompt pair, invokes
 *      `ArchitectLlmClient.callSingleShot`, parses the JSON response, and
 *      runs it through the hand-rolled validator.
 *   4. The validated response is returned to the caller, which decides
 *      banner variant + writes captured-decision rows via Spec 2's POST
 *      endpoint.
 *
 * Failure handling:
 *   - LLM call failure (network / provider / timeout) → throws
 *     `SingleShotLlmCallError` from the adapter; this module catches it and
 *     returns the failure signal.
 *   - JSON parse failure → returns failure signal.
 *   - Validator failure → returns failure signal carrying the validator's
 *     error messages.
 *
 * Per spec §"Pre-fill LLM call + validator":
 *   - Single shot covering all candidate codes (no chunking).
 *   - Strong-connection matching only; bias toward unmatched when in doubt.
 *   - Project-level wins over organisation-level for any specific row.
 *   - Value extracted verbatim from the source; source quote cited.
 *   - Never hallucinate.
 */

import type {
  ArchitectLlmClient,
  CallSingleShotOptions,
  SingleShotPrompt,
} from './architectLlmClient';
import { SingleShotLlmCallError } from './architectLlmClient';
import {
  assertPreFillResponse,
  PreFillResponse,
} from './techStackPrefillResponseValidator';
import { logger } from '../logger';

// ---------------------------------------------------------------------------
// Question library shape — accepted as a tightly-scoped subset so this
// module stays decoupled from the full `QuestionLibraryEntry` interface (the
// orchestrator does the projection at the call site).
// ---------------------------------------------------------------------------

export interface PreFillLibraryCandidate {
  code: string;
  prompt: string;
  expectedAnswerShape: string;
  choices?: readonly string[];
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface PrefillFromTechStackArgs {
  /** Raw organisation-level tech-stack.md content (or null when absent). */
  orgMarkdown: string | null;
  /** Raw project-level tech-stack.md content (or null when absent). */
  projectMarkdown: string | null;
  /** Auto-skip-relevant decision codes the orchestrator filtered down to. */
  candidateDecisions: readonly PreFillLibraryCandidate[];
  /** Brief project context surfaced verbatim in the prompt. */
  projectContext: {
    projectName: string | null;
    currentArchitectureId: string | null;
    targetArchitectureId: string | null;
  };
  /** LLM client implementing the single-shot adapter. */
  llmClient: ArchitectLlmClient;
  /** Optional call settings (timeout, model). */
  callOptions?: CallSingleShotOptions;
}

// ---------------------------------------------------------------------------
// Outcome shape
// ---------------------------------------------------------------------------

export type PrefillFailureReason =
  | 'llm-call-failed'
  | 'response-not-json'
  | 'validator-failed';

export type PrefillFromTechStackResult =
  | {
      kind: 'success';
      response: PreFillResponse;
    }
  | {
      kind: 'failure';
      reason: PrefillFailureReason;
      errorMessage: string;
      validatorErrors?: string[];
    };

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are a tech-stack pre-fill assistant for an architecture migration tool.',
  'You read one or two `tech-stack.md` markdown blobs (an organisation-level one and a project-level one) and decide which of the supplied question library decision codes those files unambiguously settle.',
  '',
  'Rules:',
  '1. Strong-connection matching only. The file MUST explicitly name the technology, version, or pattern that answers the question. Vague references do not count.',
  '2. Bias toward UNMATCHED when in doubt. Never hallucinate an answer that the file does not unambiguously state.',
  '3. Extract `value` VERBATIM from the file (preserve the wording the source uses).',
  '4. Cite the `sourceQuote` verbatim from the file — a short line or table-cell that contains the value.',
  '5. When BOTH the organisation and project files name the same standard, the project-level entry WINS — return that entry with `sourceFile: "project"`.',
  '6. Every decisionCode in the supplied candidate list MUST appear in EITHER `preFilledAnswers` OR `unmatchedCodes` exactly once. Do not invent codes that were not supplied.',
  '7. `value` must match the question\'s expectedAnswerShape — for single-choice questions the value must be one of the supplied `choices` verbatim if such a choice is named in the file.',
  '',
  'Response shape (JSON only — no surrounding markdown, no commentary):',
  '{',
  '  "preFilledAnswers": [',
  '    { "decisionCode": "<code>", "value": "<verbatim value>", "sourceQuote": "<verbatim quote>", "sourceFile": "organisation"|"project" }',
  '  ],',
  '  "unmatchedCodes": ["<code>", ...],',
  '  "summary": "<one-sentence summary of how many were matched and which file(s) drove the matches>"',
  '}',
].join('\n');

/**
 * Build the user-prompt half of the single-shot call. Labelled
 * `## ORGANISATION STANDARDS` and `## PROJECT STANDARDS` sections per
 * Follow-up B so the LLM sees the two files distinctly and the precedence
 * rule (project wins) has a clear visual anchor.
 */
export function buildUserPrompt(args: PrefillFromTechStackArgs): string {
  const sections: string[] = [];

  sections.push('## PROJECT CONTEXT');
  sections.push(`projectName: ${args.projectContext.projectName ?? '(unknown)'}`);
  sections.push(`currentArchitectureId: ${args.projectContext.currentArchitectureId ?? '(unknown)'}`);
  sections.push(`targetArchitectureId: ${args.projectContext.targetArchitectureId ?? '(unknown)'}`);
  sections.push('');

  if (args.orgMarkdown) {
    sections.push('## ORGANISATION STANDARDS');
    sections.push(args.orgMarkdown);
    sections.push('');
  } else {
    sections.push('## ORGANISATION STANDARDS');
    sections.push('(no organisation-level tech-stack.md found)');
    sections.push('');
  }

  if (args.projectMarkdown) {
    sections.push('## PROJECT STANDARDS');
    sections.push(args.projectMarkdown);
    sections.push('');
  } else {
    sections.push('## PROJECT STANDARDS');
    sections.push('(no project-level tech-stack.md found)');
    sections.push('');
  }

  sections.push('## CANDIDATE QUESTIONS');
  sections.push('Each candidate below MUST appear once across preFilledAnswers or unmatchedCodes.');
  sections.push('');
  for (const c of args.candidateDecisions) {
    sections.push(`- decisionCode: ${c.code}`);
    sections.push(`  prompt: ${c.prompt}`);
    sections.push(`  expectedAnswerShape: ${c.expectedAnswerShape}`);
    if (c.choices && c.choices.length > 0) {
      sections.push(`  choices: ${c.choices.join(' | ')}`);
    }
  }

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Compose the prompt, call the single-shot LLM adapter, parse the JSON
 * response, and validate. Returns a `success` result with the validated
 * payload, or a `failure` result with the reason + message the orchestrator
 * surfaces to the failure-variant banner.
 */
export async function prefillFromTechStack(
  args: PrefillFromTechStackArgs,
): Promise<PrefillFromTechStackResult> {
  // Degenerate case: no candidate decisions to score against — return a
  // success with empty arrays so the orchestrator routes through cleanly.
  if (args.candidateDecisions.length === 0) {
    return {
      kind: 'success',
      response: {
        preFilledAnswers: [],
        unmatchedCodes: [],
        summary: 'No candidate questions supplied for pre-fill.',
      },
    };
  }

  // Both files null — caller should have short-circuited; defensive guard.
  if (!args.orgMarkdown && !args.projectMarkdown) {
    return {
      kind: 'failure',
      reason: 'validator-failed',
      errorMessage:
        'No organisation or project tech-stack.md content supplied; pre-fill cannot run.',
    };
  }

  const prompt: SingleShotPrompt = {
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(args),
  };

  let rawContent: string;
  try {
    const response = await args.llmClient.callSingleShot(prompt, args.callOptions);
    rawContent = response.content ?? '';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('tech-stack pre-fill: single-shot LLM call failed', {
      error: message,
    });
    return {
      kind: 'failure',
      reason: 'llm-call-failed',
      errorMessage: message,
    };
  }

  if (typeof rawContent !== 'string' || rawContent.trim().length === 0) {
    return {
      kind: 'failure',
      reason: 'response-not-json',
      errorMessage:
        'Single-shot tech-stack pre-fill returned an empty response. The architecture model service / LLM provider produced no JSON to validate.',
    };
  }

  // The provider may return ```json ... ``` fences — strip them defensively
  // before parsing.
  const cleaned = stripJsonFences(rawContent);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      kind: 'failure',
      reason: 'response-not-json',
      errorMessage: `Failed to parse single-shot tech-stack pre-fill response as JSON: ${message}`,
    };
  }

  const libraryCodeSet = new Set(args.candidateDecisions.map((c) => c.code));
  const validation = assertPreFillResponse(
    parsed,
    libraryCodeSet,
    args.orgMarkdown,
    args.projectMarkdown,
  );
  if (!validation.ok) {
    return {
      kind: 'failure',
      reason: 'validator-failed',
      errorMessage:
        'Tech-stack pre-fill response failed validation; no captured-decision rows will be written.',
      validatorErrors: validation.errors,
    };
  }

  return { kind: 'success', response: validation.value };
}

/**
 * Strip ```json ... ``` and ``` ... ``` fences that some LLM providers wrap
 * around JSON responses. Exported for unit tests.
 */
export function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  // Three-backtick fence with optional language tag.
  const fenceRegex = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i;
  const match = trimmed.match(fenceRegex);
  if (match) {
    return match[1].trim();
  }
  return trimmed;
}

// Re-export so the orchestrator can catch the typed error from the
// adapter boundary without depending on the adapter file directly.
export { SingleShotLlmCallError };
