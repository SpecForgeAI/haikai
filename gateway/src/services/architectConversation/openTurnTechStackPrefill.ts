/**
 * Open-turn Tech-Stack Pre-fill Orchestration — Tech-Stack.md Pre-fill +
 * Target-Tech-Stack.md Write (Spec 2026-05-25, Task Group 3).
 *
 * Slots between the existing Spec 3 `open` turn append and the user-driven
 * question stream. The sequence per the spec is:
 *
 *   1. Append `open` turn (caller's responsibility — happens before this
 *      module is invoked).
 *   2. Run auto-skip for relevance-excluded codes (existing Spec 3
 *      behaviour). Pre-fill only attempts auto-skip-relevant codes.
 *   3. Load both org + project `tech-stack.md` files via the Group 1 loader.
 *   4. If both files absent → append a `tech-stack-prefill-summary` turn
 *      with the no-standards banner variant; return.
 *   5. If at least one file present AND not truncated → invoke
 *      `prefillFromTechStack` against the candidate code set.
 *   6. If truncated / LLM-failed / validator-failed → append the failure
 *      variant `tech-stack-prefill-summary` turn; return.
 *   7. On success → POST each pre-fill row via Spec 2's existing endpoint
 *      with `created_by_task = 'tech-stack-md-prefill'`, `scope_kind =
 *      'architecture'`, `standards_lookup_ref = null`, `answer_value =
 *      JSON.stringify({ value, sourceQuote, sourceFile })`. Per Q11, on
 *      first POST failure abort remaining writes, capture failed codes,
 *      merge them into the unmatched list, and route to the partial-success
 *      banner.
 *   8. Append the success/partial-failure variant
 *      `tech-stack-prefill-summary` turn with matched count + variant key.
 *
 * No new endpoint is introduced. The route layer calls
 * `runOpenTurnTechStackPrefill` after appending the open turn.
 */

import {
  appendTurn as defaultAppendTurn,
} from '../targetStateConversationStore';
import {
  postCapturedDecision as defaultPostCapturedDecision,
  CreateCapturedDecisionRequestBody,
} from './targetStateCapturedDecisionsWriter';
import {
  PreFillLibraryCandidate,
  prefillFromTechStack,
} from './prefillFromTechStack';
import {
  InvalidProjectFolderNameError,
  loadTechStackMarkdown,
  TechStackLoadResult,
} from './techStackLoader';
import type { ArchitectLlmClient } from './architectLlmClient';
import type {
  TechStackPrefillBannerVariant,
  TechStackPrefillSummaryTurn,
} from './turnShape';
import { logger } from '../logger';

/**
 * Fixed `created_by_task` value used on every captured-decision row written
 * from a tech-stack pre-fill. Discriminates pre-fill rows from
 * user-walked rows (which use `'architect-persona-conversation'`).
 */
export const TECH_STACK_PREFILL_TASK_NAME = 'tech-stack-md-prefill';

/**
 * Static denominator displayed on the banner (per Q12 of the requirements).
 * The library is a frozen 51-entry constant; we hardcode rather than dynamically
 * counting so the banner stays stable even if a later spec edits the library.
 */
export const TECH_STACK_PREFILL_BANNER_DENOMINATOR = 51;

// ---------------------------------------------------------------------------
// Injectable dependencies (test seam)
// ---------------------------------------------------------------------------

export interface OpenTurnTechStackPrefillDeps {
  loadTechStack: typeof loadTechStackMarkdown;
  postCapturedDecision: typeof defaultPostCapturedDecision;
  appendTurn: typeof defaultAppendTurn;
  prefillFromTechStack: typeof prefillFromTechStack;
}

export const defaultOpenTurnTechStackPrefillDeps: OpenTurnTechStackPrefillDeps = {
  loadTechStack: loadTechStackMarkdown,
  postCapturedDecision: defaultPostCapturedDecision,
  appendTurn: defaultAppendTurn,
  prefillFromTechStack,
};

// ---------------------------------------------------------------------------
// Inputs / Outputs
// ---------------------------------------------------------------------------

export interface RunOpenTurnTechStackPrefillArgs {
  projectId: string;
  targetArchitectureId: string;
  conversationThreadId: string;
  /** Auto-skip-relevant candidate codes the orchestrator already filtered. */
  candidateDecisions: readonly PreFillLibraryCandidate[];
  /** Brief project context surfaced verbatim in the pre-fill prompt. */
  projectContext: {
    projectName: string | null;
    currentArchitectureId: string | null;
    targetArchitectureId: string | null;
  };
  /** Single-shot LLM client. */
  llmClient: ArchitectLlmClient;
}

export interface OpenTurnTechStackPrefillOutcome {
  /** The summary turn appended at the end of the flow (banner payload source). */
  summaryTurn: TechStackPrefillSummaryTurn;
  /** Successfully-written captured-decision row count (== matchedCount on summary). */
  rowsWritten: number;
  /** Decision codes whose POSTs failed and were merged into the unmatched list. */
  partialFailureCodes: string[];
  /** Codes the LLM matched in the response. */
  matchedCodes: string[];
}

// ---------------------------------------------------------------------------
// Core entry point
// ---------------------------------------------------------------------------

export async function runOpenTurnTechStackPrefill(
  args: RunOpenTurnTechStackPrefillArgs,
  deps: OpenTurnTechStackPrefillDeps = defaultOpenTurnTechStackPrefillDeps,
): Promise<OpenTurnTechStackPrefillOutcome> {
  // -----------------------------------------------------------------------
  // Step 1 + 2: load tech-stack files. Catch invalid-project-name early so
  // the failure routes to a clean banner rather than throwing.
  // -----------------------------------------------------------------------
  let loaded: TechStackLoadResult;
  try {
    loaded = await deps.loadTechStack(args.projectId);
  } catch (err) {
    if (err instanceof InvalidProjectFolderNameError) {
      return await appendAndReturnFailure(
        deps,
        args,
        `Project name rejected by tech-stack loader: ${err.message}`,
        /* orgFilePresent */ false,
        /* projectFilePresent */ false,
        /* orgFilePath */ null,
        /* projectFilePath */ null,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return await appendAndReturnFailure(
      deps,
      args,
      `Tech-stack loader failed: ${message}`,
      false,
      false,
      null,
      null,
    );
  }

  const orgFilePresent = loaded.orgMarkdown !== null;
  const projectFilePresent = loaded.projectMarkdown !== null;

  // -----------------------------------------------------------------------
  // Step 3: both absent → no-standards banner; no LLM call; no rows.
  // -----------------------------------------------------------------------
  if (!orgFilePresent && !projectFilePresent) {
    const summaryTurn: TechStackPrefillSummaryTurn = {
      kind: 'tech-stack-prefill-summary',
      bannerVariant: 'no-standards-found',
      matchedCount: 0,
      denominator: TECH_STACK_PREFILL_BANNER_DENOMINATOR,
      orgFilePresent: false,
      projectFilePresent: false,
      orgFilePath: null,
      projectFilePath: null,
      partialFailureCodes: [],
      failureReason: null,
    };
    await deps.appendTurn(args.projectId, args.targetArchitectureId, summaryTurn);
    logger.debug('open-turn pre-fill: no tech-stack files found; banner = no-standards', {
      projectId: args.projectId,
      targetArchitectureId: args.targetArchitectureId,
    });
    return {
      summaryTurn,
      rowsWritten: 0,
      partialFailureCodes: [],
      matchedCodes: [],
    };
  }

  // -----------------------------------------------------------------------
  // Step 4: truncation → failure banner; no LLM call; no rows.
  // -----------------------------------------------------------------------
  if (loaded.orgTruncated || loaded.projectTruncated) {
    const which: string[] = [];
    if (loaded.orgTruncated) which.push('organisation');
    if (loaded.projectTruncated) which.push('project');
    return await appendAndReturnFailure(
      deps,
      args,
      `Tech-stack file exceeded the 50,000-character cap (${which.join(' + ')}); pre-fill skipped to avoid partial extraction.`,
      orgFilePresent,
      projectFilePresent,
      loaded.orgPath,
      loaded.projectPath,
    );
  }

  // -----------------------------------------------------------------------
  // Step 5: invoke the single-shot LLM call against the candidate codes.
  // -----------------------------------------------------------------------
  const prefillResult = await deps.prefillFromTechStack({
    orgMarkdown: loaded.orgMarkdown,
    projectMarkdown: loaded.projectMarkdown,
    candidateDecisions: args.candidateDecisions,
    projectContext: args.projectContext,
    llmClient: args.llmClient,
  });

  if (prefillResult.kind === 'failure') {
    return await appendAndReturnFailure(
      deps,
      args,
      `Tech-stack pre-fill could not run: ${prefillResult.errorMessage}`,
      orgFilePresent,
      projectFilePresent,
      loaded.orgPath,
      loaded.projectPath,
    );
  }

  // -----------------------------------------------------------------------
  // Step 6: POST each pre-fill row. Per Q11, on first POST failure abort
  // remaining writes and surface partial-success.
  // -----------------------------------------------------------------------
  const matchedCodes: string[] = [];
  const partialFailureCodes: string[] = [];
  let firstFailure: { code: string; error: unknown } | null = null;

  for (const answer of prefillResult.response.preFilledAnswers) {
    if (firstFailure) {
      // Abort remaining writes — surface the rest of the matched codes as
      // partial failures so the user is walked through them via the standard
      // flow.
      partialFailureCodes.push(answer.decisionCode);
      continue;
    }
    const body: CreateCapturedDecisionRequestBody = {
      decisionCode: answer.decisionCode,
      scopeKind: 'architecture',
      scopeRefType: null,
      scopeRefId: null,
      answerValue: JSON.stringify({
        value: answer.value,
        sourceQuote: answer.sourceQuote,
        sourceFile: answer.sourceFile,
      }),
      answerSummary: answer.value,
      standardsLookupRef: null,
      conversationThreadId: args.conversationThreadId,
      conversationTurnRef: null,
      createdByTask: TECH_STACK_PREFILL_TASK_NAME,
    };
    try {
      await deps.postCapturedDecision(
        args.projectId,
        args.targetArchitectureId,
        body,
      );
      matchedCodes.push(answer.decisionCode);
    } catch (err) {
      firstFailure = { code: answer.decisionCode, error: err };
      partialFailureCodes.push(answer.decisionCode);
    }
  }

  // -----------------------------------------------------------------------
  // Step 7: assemble + append the summary turn.
  // -----------------------------------------------------------------------
  let bannerVariant: TechStackPrefillBannerVariant;
  if (firstFailure) {
    bannerVariant = 'failure';
  } else if (orgFilePresent && projectFilePresent) {
    bannerVariant = 'both-files-matched';
  } else if (orgFilePresent) {
    bannerVariant = 'organisation-only-matched';
  } else {
    bannerVariant = 'project-only-matched';
  }

  const summaryTurn: TechStackPrefillSummaryTurn = {
    kind: 'tech-stack-prefill-summary',
    bannerVariant,
    matchedCount: matchedCodes.length,
    denominator: TECH_STACK_PREFILL_BANNER_DENOMINATOR,
    orgFilePresent,
    projectFilePresent,
    orgFilePath: loaded.orgPath,
    projectFilePath: loaded.projectPath,
    partialFailureCodes,
    failureReason: firstFailure
      ? `One or more pre-fill row writes failed; remaining writes aborted (first failure: ${
          firstFailure.error instanceof Error ? firstFailure.error.message : String(firstFailure.error)
        }).`
      : null,
  };
  await deps.appendTurn(args.projectId, args.targetArchitectureId, summaryTurn);

  logger.debug('open-turn pre-fill: completed', {
    projectId: args.projectId,
    targetArchitectureId: args.targetArchitectureId,
    bannerVariant,
    matchedCount: matchedCodes.length,
    partialFailureCount: partialFailureCodes.length,
  });

  return {
    summaryTurn,
    rowsWritten: matchedCodes.length,
    partialFailureCodes,
    matchedCodes,
  };
}

// ---------------------------------------------------------------------------
// Internal helper for the failure-banner short-circuits
// ---------------------------------------------------------------------------

async function appendAndReturnFailure(
  deps: OpenTurnTechStackPrefillDeps,
  args: RunOpenTurnTechStackPrefillArgs,
  reason: string,
  orgFilePresent: boolean,
  projectFilePresent: boolean,
  orgFilePath: string | null,
  projectFilePath: string | null,
): Promise<OpenTurnTechStackPrefillOutcome> {
  const summaryTurn: TechStackPrefillSummaryTurn = {
    kind: 'tech-stack-prefill-summary',
    bannerVariant: 'failure',
    matchedCount: 0,
    denominator: TECH_STACK_PREFILL_BANNER_DENOMINATOR,
    orgFilePresent,
    projectFilePresent,
    orgFilePath,
    projectFilePath,
    partialFailureCodes: [],
    failureReason: reason,
  };
  await deps.appendTurn(args.projectId, args.targetArchitectureId, summaryTurn);
  return {
    summaryTurn,
    rowsWritten: 0,
    partialFailureCodes: [],
    matchedCodes: [],
  };
}
