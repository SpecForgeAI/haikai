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
import type { ArchitectLlmClient } from '../architectConversation/architectLlmClient';
import { writePendingVersionConfirmations as defaultWritePendingVersionConfirmations } from '../architectConversation/pendingVersionConfirmations';
import type { PendingVersionConfirmationEntry } from '../architectConversation/turnShape';
import {
  BUILD_TOOL_CODE,
  buildToolAnswerForEcosystem,
  matchManifestCoordinate,
} from './manifestCodeMapping';
import { deriveManifestPomFacts } from './manifestFactExtractors';
import { deriveInferredCandidates } from './manifestInference';
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
  /**
   * OPTIONAL single-shot LLM client for the gap-fill (Spec 2 R5). Threaded
   * from the route via `buildArchitectLlmClient()`. ABSENT in unit tests + the
   * default deps => the LLM step is skipped (deterministic + inferred only;
   * fail-open).
   */
  llmClient?: ArchitectLlmClient;
  /**
   * Persistence seam for the recomputed pending-version-confirmation set (Spec
   * 2026-06-27-target-manifest-version-unknown-pending-questions). Injected for
   * the test seam; OPTIONAL so existing inline-constructed deps keep compiling —
   * the run falls back to the real thread-store writer when absent.
   */
  writePendingVersionConfirmations?: typeof defaultWritePendingVersionConfirmations;
}

export const defaultManifestAutoAnswererDeps: ManifestAutoAnswererDeps = {
  postCapturedDecision: defaultPostCapturedDecision,
  writePendingVersionConfirmations: defaultWritePendingVersionConfirmations,
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
  /**
   * The answer kind (Spec 2 R2 union). `'framework-version'` (the default when
   * omitted) writes the structured `{ framework, version }` envelope; for that
   * kind `framework` is the bare stem and `version` is the resolved version.
   * `'single-choice'` writes a plain-string value — for that kind `framework`
   * carries the EXACT `questionLibrary.choices` string and `version` is unused.
   */
  answerKind?: 'framework-version' | 'single-choice';
  framework: string;
  /** Concrete version OR `version-unknown` (flows through unchanged). */
  version: string;
  /** `sourceFile` provenance — the tagged manifest path. */
  sourceFile: string;
  /** `sourceQuote` provenance — the resolved coordinate/version evidence. */
  sourceQuote: string;
  /** Target module/service tag (carried for logging/recompute context). */
  tag: string;
  /**
   * Provenance of this candidate (Spec 2 R6): `deterministic` (a direct
   * coordinate / property / plugin / build-tool witness), `inferred` (a badged
   * write-immediately inference such as db.driver=>db.engine), or `llm` (the
   * gap-fill suggestion). De-dup ranks deterministic > inferred > llm, all
   * strictly below manual. Absent === `deterministic` (the historic default).
   */
  provenance?: 'deterministic' | 'inferred' | 'llm';
  /**
   * The source dependency/evidence that drove this candidate (e.g.
   * `org.postgresql:postgresql` for a driver, carried onto the inferred
   * `db.engine`). Surfaced so the UI can badge "from <dependency>" /
   * "inferred from <driver>". Absent for legacy / synthetic candidates.
   */
  sourceDependency?: string;
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
  /**
   * Version-unknown VERSIONED coordinates DIVERTED out of the write path into the
   * persisted pending-version-confirmation set (Spec 2026-06-27). These wrote NO
   * captured-decision row and do NOT count toward `rowsWritten` / partial-failure
   * handling. This is the FULL recomputed pending set persisted (replace,
   * latest-wins) at the end of the run via `writePendingVersionConfirmations`.
   */
  pendingVersionConfirmations: PendingVersionConfirmationEntry[];
}

// ---------------------------------------------------------------------------
// Candidate derivation (pure) — exported so Group 4 / tests can reuse it.
// ---------------------------------------------------------------------------

/**
 * Precedence rank for a candidate's provenance (higher wins). Spec 2 R6:
 * `deterministic-direct > inferred > llm`. Manual is enforced SEPARATELY and
 * strictly above all three (see `manifestPrecedence.ts`). An absent provenance
 * is treated as `deterministic` (the historic default).
 */
export function candidateProvenanceRank(
  provenance: ManifestAnswerCandidate['provenance'],
): number {
  switch (provenance) {
    case 'llm':
      return 1;
    case 'inferred':
      return 2;
    case 'deterministic':
    default:
      return 3;
  }
}

/**
 * De-duplicate a candidate stream to EXACTLY ONE candidate per decision code,
 * honouring Spec 2 R6 precedence: `deterministic-direct > inferred > llm`
 * (manual is enforced separately, strictly above all three). Within the SAME
 * provenance a concrete version beats a stored `version-unknown`; otherwise the
 * first-seen candidate wins (deterministic in array order). Exported so the
 * orchestrator can merge the LLM gap-fill candidates under the same rule.
 */
export function dedupeCandidatesByPrecedence(
  candidates: readonly ManifestAnswerCandidate[],
): ManifestAnswerCandidate[] {
  const byCode = new Map<string, ManifestAnswerCandidate>();
  for (const candidate of candidates) {
    const existing = byCode.get(candidate.decisionCode);
    if (!existing) {
      byCode.set(candidate.decisionCode, candidate);
      continue;
    }
    const existingRank = candidateProvenanceRank(existing.provenance);
    const incomingRank = candidateProvenanceRank(candidate.provenance);
    if (incomingRank > existingRank) {
      byCode.set(candidate.decisionCode, candidate);
      continue;
    }
    if (incomingRank < existingRank) {
      continue;
    }
    // Same precedence: a concrete version supersedes a stored version-unknown.
    if (existing.version === VERSION_UNKNOWN && candidate.version !== VERSION_UNKNOWN) {
      byCode.set(candidate.decisionCode, candidate);
    }
    // Otherwise the first-seen candidate stays (deterministic).
  }
  return [...byCode.values()];
}

/**
 * Derive the de-duplicated auto-answer candidate set from resolved manifests.
 *
 * Three deterministic-direct sources feed the set: coordinate witnesses (per
 * `manifestCodeMapping.ts`), pom property/plugin facts (per
 * `manifestFactExtractors.ts`), and the ecosystem build tool. The INFERENCE
 * layer (Spec 2 R4 — `db.driver`=>`db.engine`, `service.language`=>
 * `service.runtime`) then runs OVER the de-duped deterministic set and is
 * layered on top as badged, write-immediately candidates.
 *
 * Exactly ONE candidate is kept per decision code (one resolved chip
 * downstream), honouring R6 precedence (`deterministic > inferred > llm`); a
 * concrete version beats a `version-unknown` within the same provenance.
 *
 * Deterministic: manifests + dependencies are consumed in array order.
 */
export function deriveManifestAnswerCandidates(
  manifests: readonly ResolvedManifest[],
): ManifestAnswerCandidate[] {
  const deterministic: ManifestAnswerCandidate[] = [];

  for (const manifest of manifests) {
    // Coordinate-witnessed codes. The registry returns a UNION (Spec 2 R2): a
    // bare-stem framework-version answer, or a single-choice value (the exact
    // questionLibrary choice) for the genuinely-non-versioned residue.
    for (const dep of manifest.resolvedDependencies) {
      const match = matchManifestCoordinate(dep);
      if (!match) continue;
      if (match.kind === 'single-choice') {
        deterministic.push({
          decisionCode: match.decisionCode,
          answerKind: 'single-choice',
          // The single-choice value rides `framework`; the version slot is unused
          // for a non-versioned code.
          framework: match.value,
          version: '',
          sourceFile: dep.manifestPath,
          sourceQuote: dep.evidence,
          tag: manifest.tag,
          provenance: 'deterministic',
          sourceDependency: dep.name,
        });
      } else {
        deterministic.push({
          decisionCode: match.decisionCode,
          answerKind: 'framework-version',
          framework: match.framework,
          version: dep.resolvedVersion,
          sourceFile: dep.manifestPath,
          // Evidence echoes the resolved coordinate/version (Group 2 evidence).
          sourceQuote: dep.evidence,
          tag: manifest.tag,
          provenance: 'deterministic',
          sourceDependency: dep.name,
        });
      }
    }

    // Property + plugin extractors (Spec 2 FR3): deterministic-direct facts from
    // `<properties>` (java.version / kotlin.version => service.language) and
    // `<plugins>` (flyway / liquibase maven-plugin => db.migrations), now
    // reachable via the pomMetadata carried on the resolved manifest (FR1). Both
    // are Spec-1 versioned codes => bare-stem framework-version answers.
    for (const fact of deriveManifestPomFacts(manifest.pomMetadata)) {
      deterministic.push({
        decisionCode: fact.decisionCode,
        answerKind: 'framework-version',
        framework: fact.framework,
        version: fact.version,
        sourceFile: manifest.manifestPath,
        sourceQuote: fact.evidence,
        tag: manifest.tag,
        provenance: 'deterministic',
        sourceDependency: fact.evidence,
      });
    }

    // Ecosystem-derived build tool. A manifest's existence witnesses its build
    // tool deterministically; the build tool has no single library coordinate.
    // build.tool is a Spec-1 versioned code => a bare-stem `{ framework, version }`
    // (e.g. `{ framework: 'Maven', version: '3.9' }`), NOT the old doubled label.
    const buildTool = buildToolAnswerForEcosystem(manifest.ecosystem);
    if (buildTool) {
      deterministic.push({
        decisionCode: BUILD_TOOL_CODE,
        answerKind: 'framework-version',
        framework: buildTool.framework,
        version: buildTool.version,
        sourceFile: manifest.manifestPath,
        sourceQuote: `${manifest.manifestPath} (${buildTool.framework} ${buildTool.version})`,
        tag: manifest.tag,
        provenance: 'deterministic',
        sourceDependency: manifest.manifestPath,
      });
    }
  }

  // De-dup the deterministic set first (so inference reads ONE stable hit per
  // code), then layer the inference (Spec 2 R4 — badged, write-immediately) ON
  // TOP. Inference fills the codes no single coordinate/property witnesses
  // (db.engine from the driver, service.runtime from the language) and can never
  // override a deterministic hit (R6 precedence).
  const deterministicByCode = dedupeCandidatesByPrecedence(deterministic);
  const inferred = deriveInferredCandidates(deterministicByCode);
  return dedupeCandidatesByPrecedence([...deterministicByCode, ...inferred]);
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
  // Single-choice (non-versioned) codes write a plain-string `value` (the EXACT
  // questionLibrary choice) through the SAME `{ value, sourceQuote, sourceFile }`
  // envelope the LLM tech-stack pre-fill uses (openTurnTechStackPrefill.ts). No
  // new AMS DTO; only the `value` shape differs from the versioned envelope.
  if (candidate.answerKind === 'single-choice') {
    return {
      decisionCode: candidate.decisionCode,
      scopeKind: 'architecture',
      scopeRefType: null,
      scopeRefId: null,
      answerValue: JSON.stringify({
        value: candidate.framework,
        sourceQuote: candidate.sourceQuote,
        sourceFile: candidate.sourceFile,
      }),
      answerSummary: candidate.framework,
      standardsLookupRef: null,
      conversationThreadId,
      conversationTurnRef: null,
      createdByTask: TARGET_MANIFEST_AUTO_ANSWER_TASK_NAME,
    };
  }
  // Versioned codes write the structured `{ framework, version }` envelope.
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
  /**
   * Decision codes that ALREADY have a captured row carrying a CONCRETE (non-
   * sentinel) version (manifest-derived OR manual). A `version-unknown` candidate
   * for such a code is NEITHER written NOR added to the recomputed pending set
   * (re-upload rules 5b/5c: a degraded result never retracts a concrete capture).
   * Defaults to empty. The orchestrator supplies this from the latest captured
   * decisions it already reads for manual-wins precedence.
   */
  existingConcreteVersionCodes?: ReadonlySet<string>;
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
  const existingConcreteVersionCodes =
    args.existingConcreteVersionCodes ?? new Set<string>();
  const writePending =
    deps.writePendingVersionConfirmations ?? defaultWritePendingVersionConfirmations;

  const writtenCodes: string[] = [];
  const partialFailureCodes: string[] = [];
  const pendingEntries: PendingVersionConfirmationEntry[] = [];
  let firstFailure: { code: string; error: unknown } | null = null;

  for (const candidate of candidates) {
    // DIVERT (Spec 2026-06-27): a VERSIONED candidate whose version degraded to
    // the `version-unknown` sentinel is NOT a fully-captured decision. It writes
    // NO captured-decision row; instead it is collected into the recomputed
    // pending set (surfaced FIRST in the next-question walk, framework pre-chosen).
    // The diversion runs BEFORE the abort check so the pending set stays COMPLETE
    // even if an earlier concrete write failed, and a pending entry NEVER counts
    // toward `rowsWritten` or `partialFailureCodes`. Single-choice (non-versioned)
    // candidates carry `version === ''` and never match — they are unchanged.
    if (candidate.answerKind !== 'single-choice' && candidate.version === VERSION_UNKNOWN) {
      // Re-upload rules 5b/5c: a coordinate already captured with a CONCRETE
      // version (manifest-derived OR manual) is neither retracted nor re-queued as
      // pending. (Manual rows are also dropped upstream by precedence filtering;
      // this is the belt-and-braces check the orchestrator feeds.)
      if (existingConcreteVersionCodes.has(candidate.decisionCode)) {
        logger.debug(
          'target-manifest auto-answer: version-unknown skipped; concrete capture preserved (no write, no pending)',
          {
            projectId: args.projectId,
            targetArchitectureId: args.targetArchitectureId,
            decisionCode: candidate.decisionCode,
          },
        );
        continue;
      }
      pendingEntries.push({
        decisionCode: candidate.decisionCode,
        framework: candidate.framework,
        sourceFile: candidate.sourceFile,
        sourceQuote: candidate.sourceQuote,
        tag: candidate.tag,
      });
      logger.debug(
        'target-manifest auto-answer: version-unknown diverted to pending (no captured row)',
        {
          projectId: args.projectId,
          targetArchitectureId: args.targetArchitectureId,
          decisionCode: candidate.decisionCode,
        },
      );
      continue;
    }
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

  // Persist the FULL recomputed pending set (replace; readers take latest-wins so
  // a single authoritative pending turn governs). An EMPTY set is meaningful — it
  // CLEARS any prior pending turn (an upload that resolved everything). Fail-soft:
  // a persistence hiccup is logged and degraded to a no-op so a thread-store error
  // never throws through the auto-answer flow (mirrors the never-throw write loop).
  try {
    await writePending(args.projectId, args.targetArchitectureId, pendingEntries);
  } catch (err) {
    logger.warn(
      'target-manifest auto-answer: failed to persist pending-version-confirmations (degraded to no-op)',
      {
        projectId: args.projectId,
        targetArchitectureId: args.targetArchitectureId,
        pendingCount: pendingEntries.length,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }

  return {
    writtenCodes,
    rowsWritten: writtenCodes.length,
    partialFailureCodes,
    aborted: firstFailure !== null,
    failureReason,
    candidates,
    pendingVersionConfirmations: pendingEntries,
  };
}
