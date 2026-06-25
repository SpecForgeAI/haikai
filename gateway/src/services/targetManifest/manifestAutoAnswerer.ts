/**
 * Manifest auto-answerer — the deterministic, rule-based sibling of
 * `openTurnTechStackPrefill.ts`.
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3) — Task Group 3.
 *
 * Consumes Group 2's {@link ResolvedManifest}[] (resolved target versions, with
 * `version-unknown` flowing through unchanged) and writes a captured-decision
 * row for each dependency-answerable decision code it can DETERMINISTICALLY
 * resolve from the manifests — using the EXACT same write contract as the
 * LLM-based tech-stack pre-fill, but a DISTINCT `createdByTask` so manifest rows
 * are discriminable from tech-stack-prefill (`'tech-stack-md-prefill'`) and
 * user-walked (`'architect-persona-conversation'`) rows.
 *
 * WRITE CONTRACT (reused verbatim from the prefill):
 *   - `answerValue   = JSON.stringify({ value: { framework, version }, sourceQuote, sourceFile })`
 *     (the structured `{ framework, version }` rides the `value` slot per Spec 6,
 *     so ONE resolved chip shows downstream, e.g. `Spring Boot 3.4.1`).
 *   - `answerSummary = the single resolved chip label`.
 *   - `scopeKind        = 'architecture'`.
 *   - `scopeRefType / scopeRefId / conversationTurnRef = null`.
 *   - `standardsLookupRef = null`.
 *   - `sourceFile  = the tagged manifest path`.
 *   - `sourceQuote = the resolved coordinate/version evidence string`.
 *   - `createdByTask = TARGET_MANIFEST_AUTO_ANSWER_TASK_NAME` (NEW constant).
 *
 * ROBUSTNESS (mirrors the prefill, Q11 shape): on the FIRST POST failure, ABORT
 * the remaining writes, capture the failed + remaining codes, and surface a
 * partial-success outcome — never throw through the flow. The POST seam is
 * injected exactly like `OpenTurnTechStackPrefillDeps` for the test seam.
 *
 * SELECTION BOUNDARY: only the dependency-answerable subset (per Spec 6's
 * matrix, consumed via `manifestCodeMapping.ts`) is attempted; non-dependency
 * codes (cutover/auth/rate-limiting/secrets/...) are NEVER written.
 *
 * `version-unknown` is a first-class editable answer (NOT skipped, NOT
 * fabricated): the row is written with `version = 'version-unknown'` and the
 * chip renders `<framework> (version unknown)`.
 *
 * NO SILENT DROPS: a coordinate that maps to no decision code is simply not a
 * candidate (expected — most coordinates are ordinary libraries); but anything
 * actively skipped (e.g. precedence in Group 4) is logged by the caller path.
 */

import {
  buildFrameworkVersionEnvelope,
  VERSION_UNKNOWN,
} from '../../config/architect-conversation/frameworkVersionShape';
import { logger } from '../logger';
import {
  postCapturedDecision as defaultPostCapturedDecision,
  CreateCapturedDecisionRequestBody,
} from '../architectConversation/targetStateCapturedDecisionsWriter';
import {
  BUILD_TOOL_CODE,
  buildToolFrameworkForEcosystem,
  matchManifestCoordinate,
} from './manifestCodeMapping';
import { ResolvedManifest } from './manifestVersionResolution';

/**
 * Fixed `created_by_task` value stamped on every captured-decision row written
 * from a manifest auto-answer. DISTINCT from the tech-stack pre-fill
 * (`'tech-stack-md-prefill'`) and the user-walked conversation
 * (`'architect-persona-conversation'`) so manifest-derived rows are
 * discriminable for the Group 4 precedence + re-upload supersede logic.
 */
export const TARGET_MANIFEST_AUTO_ANSWER_TASK_NAME = 'target-manifest-auto-answer';

// ---------------------------------------------------------------------------
// Injectable dependencies (test seam) — mirrors OpenTurnTechStackPrefillDeps.
// ---------------------------------------------------------------------------

export interface ManifestAutoAnswererDeps {
  postCapturedDecision: typeof defaultPostCapturedDecision;
}

export const defaultManifestAutoAnswererDeps: ManifestAutoAnswererDeps = {
  postCapturedDecision: defaultPostCapturedDecision,
};

// ---------------------------------------------------------------------------
// Candidate answer (one resolved decision code -> { framework, version })
// ---------------------------------------------------------------------------

/**
 * One auto-answer candidate AFTER de-duplication: exactly one per decision code.
 * Carries everything needed to build the captured-decision row.
 */
export interface ManifestAnswerCandidate {
  decisionCode: string;
  framework: string;
  /** Concrete version OR `version-unknown` (flows through unchanged). */
  version: string;
  /** `sourceFile` provenance — the tagged manifest path. */
  sourceFile: string;
  /** `sourceQuote` provenance — the resolved coordinate/version evidence. */
  sourceQuote: string;
  /** Target module/service tag (carried for logging/recompute context). */
  tag: string;
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

export interface ManifestAutoAnswerOutcome {
  /** Decision codes whose rows were written successfully. */
  writtenCodes: string[];
  /** Successfully-written row count (== writtenCodes.length). */
  rowsWritten: number;
  /**
   * Codes that were candidates but NOT written because the first POST failure
   * aborted the remaining writes (the failed code + every code after it).
   */
  partialFailureCodes: string[];
  /** Whether a POST failure aborted the run. */
  aborted: boolean;
  /** First-failure reason (null when the run completed cleanly). */
  failureReason: string | null;
  /** The de-duplicated candidate set that was attempted (provenance/inspection). */
  candidates: ManifestAnswerCandidate[];
}

// ---------------------------------------------------------------------------
// Candidate derivation (pure) — exported so Group 4 / tests can reuse it.
// ---------------------------------------------------------------------------

/**
 * Derive the de-duplicated auto-answer candidate set from resolved manifests.
 *
 * For every resolved dependency that witnesses a dependency-answerable decision
 * code (per `manifestCodeMapping.ts`), produce a `{ framework, version }`
 * candidate; additionally derive the `build.tool` candidate from each manifest's
 * ecosystem. Exactly ONE candidate is kept per decision code (one resolved chip
 * downstream):
 *   - the FIRST concrete-version match for a code wins;
 *   - a `version-unknown` match is kept ONLY if no concrete match exists for
 *     that code (so a real version always beats an unknown), and is itself
 *     replaced by a later concrete match.
 *
 * Deterministic: manifests + dependencies are consumed in array order.
 */
export function deriveManifestAnswerCandidates(
  manifests: readonly ResolvedManifest[],
): ManifestAnswerCandidate[] {
  // decisionCode -> chosen candidate so far.
  const byCode = new Map<string, ManifestAnswerCandidate>();

  const consider = (candidate: ManifestAnswerCandidate): void => {
    const existing = byCode.get(candidate.decisionCode);
    if (!existing) {
      byCode.set(candidate.decisionCode, candidate);
      return;
    }
    // Prefer a concrete version over a previously-stored version-unknown.
    const existingUnknown = existing.version === VERSION_UNKNOWN;
    const incomingConcrete = candidate.version !== VERSION_UNKNOWN;
    if (existingUnknown && incomingConcrete) {
      byCode.set(candidate.decisionCode, candidate);
    }
    // Otherwise the first-seen candidate stays (deterministic).
  };

  for (const manifest of manifests) {
    // Coordinate-witnessed codes (service.framework / db.driver / ui.framework).
    for (const dep of manifest.resolvedDependencies) {
      const match = matchManifestCoordinate(dep);
      if (!match) continue;
      consider({
        decisionCode: match.decisionCode,
        framework: match.framework,
        version: dep.resolvedVersion,
        sourceFile: dep.manifestPath,
        // Evidence echoes the resolved coordinate/version (Group 2 evidence).
        sourceQuote: dep.evidence,
        tag: manifest.tag,
      });
    }

    // Ecosystem-derived build tool. A manifest's existence witnesses its build
    // tool deterministically; the build tool has no single library coordinate.
    const buildFramework = buildToolFrameworkForEcosystem(manifest.ecosystem);
    if (buildFramework) {
      consider({
        decisionCode: BUILD_TOOL_CODE,
        framework: buildFramework,
        // The build tool's version is the chip's own version (e.g. "Maven 3.9");
        // there is no manifest-resolved version to attach, so the chip stands
        // alone — model it as a concrete framework with no extra version (the
        // version axis is the curated chip itself).
        version: buildFramework,
        sourceFile: manifest.manifestPath,
        sourceQuote: `${manifest.manifestPath} (${buildFramework})`,
        tag: manifest.tag,
      });
    }
  }

  return [...byCode.values()];
}

// ---------------------------------------------------------------------------
// Captured-decision row builder (pure) — reuses the prefill envelope verbatim.
// ---------------------------------------------------------------------------

/**
 * Build the `CreateCapturedDecisionRequestBody` for one candidate, reusing the
 * structured `{ framework, version }` capture envelope (Spec 6) — which is
 * itself the EXISTING `{ value, sourceQuote, sourceFile }` envelope used by
 * `openTurnTechStackPrefill.ts`. The manifest provenance rides `sourceFile` /
 * `sourceQuote`; `createdByTask` is the NEW manifest task constant.
 */
export function buildManifestCapturedDecisionBody(
  candidate: ManifestAnswerCandidate,
  conversationThreadId: string | null,
): CreateCapturedDecisionRequestBody {
  const envelope = buildFrameworkVersionEnvelope({
    value: { framework: candidate.framework, version: candidate.version },
    sourceQuote: candidate.sourceQuote,
    sourceFile: candidate.sourceFile,
  });
  return {
    decisionCode: candidate.decisionCode,
    scopeKind: 'architecture',
    scopeRefType: null,
    scopeRefId: null,
    answerValue: envelope.answerValue,
    answerSummary: envelope.answerSummary,
    standardsLookupRef: null,
    conversationThreadId,
    conversationTurnRef: null,
    createdByTask: TARGET_MANIFEST_AUTO_ANSWER_TASK_NAME,
  };
}

// ---------------------------------------------------------------------------
// Core entry point
// ---------------------------------------------------------------------------

export interface RunManifestAutoAnswerArgs {
  projectId: string;
  targetArchitectureId: string;
  /** Thread file id stamped on each row (Spec 2's thread envelope); may be null. */
  conversationThreadId?: string | null;
  /** Group 2 resolved manifests (one per uploaded manifest). */
  resolvedManifests: readonly ResolvedManifest[];
  /**
   * Optional pre-derived candidate set. When provided (e.g. Group 4 supplies a
   * precedence-filtered set), it is used VERBATIM and no derivation is run.
   * When omitted, candidates are derived from `resolvedManifests`.
   */
  candidates?: readonly ManifestAnswerCandidate[];
}

/**
 * Auto-answer the dependency-answerable subset from resolved manifests by
 * POSTing one captured-decision row per resolved decision code via the EXISTING
 * writer. Mirrors the prefill's abort-on-first-failure / partial-success shape.
 *
 * Never throws on a POST failure — the failure is captured into the outcome so
 * the caller (route) can surface a partial result.
 */
export async function runManifestAutoAnswer(
  args: RunManifestAutoAnswerArgs,
  deps: ManifestAutoAnswererDeps = defaultManifestAutoAnswererDeps,
): Promise<ManifestAutoAnswerOutcome> {
  const candidates: ManifestAnswerCandidate[] = args.candidates
    ? [...args.candidates]
    : deriveManifestAnswerCandidates(args.resolvedManifests);

  const conversationThreadId = args.conversationThreadId ?? null;

  const writtenCodes: string[] = [];
  const partialFailureCodes: string[] = [];
  let firstFailure: { code: string; error: unknown } | null = null;

  for (const candidate of candidates) {
    if (firstFailure) {
      // Abort remaining writes — surface the rest as partial failures.
      partialFailureCodes.push(candidate.decisionCode);
      continue;
    }
    const body = buildManifestCapturedDecisionBody(candidate, conversationThreadId);
    try {
      await deps.postCapturedDecision(args.projectId, args.targetArchitectureId, body);
      writtenCodes.push(candidate.decisionCode);
      logger.debug('target-manifest auto-answer: wrote captured-decision row', {
        projectId: args.projectId,
        targetArchitectureId: args.targetArchitectureId,
        decisionCode: candidate.decisionCode,
        versionUnknown: candidate.version === VERSION_UNKNOWN,
      });
    } catch (err) {
      firstFailure = { code: candidate.decisionCode, error: err };
      partialFailureCodes.push(candidate.decisionCode);
      logger.warn(
        'target-manifest auto-answer: POST failed; aborting remaining writes (partial success)',
        {
          projectId: args.projectId,
          targetArchitectureId: args.targetArchitectureId,
          decisionCode: candidate.decisionCode,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  const failureReason = firstFailure
    ? `Manifest auto-answer row write failed for '${firstFailure.code}'; remaining writes aborted (${
        firstFailure.error instanceof Error
          ? firstFailure.error.message
          : String(firstFailure.error)
      }).`
    : null;

  return {
    writtenCodes,
    rowsWritten: writtenCodes.length,
    partialFailureCodes,
    aborted: firstFailure !== null,
    failureReason,
    candidates,
  };
}
