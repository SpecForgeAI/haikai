/**
 * Manifest upload orchestrator — the full (re-)upload iterate loop.
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3) — Task Group 4
 * (task 4.0 end-to-end wiring; consumes Groups 2 + 3 + the precedence layer).
 *
 * Given the parsed manifests (Group 1) this:
 *   1. RESOLVES versions (Group 2) → resolved manifests.
 *   2. DERIVES the dependency-answerable candidate set (Group 3).
 *   3. Applies MANUAL-WINS PRECEDENCE (Group 4): drops candidates whose current
 *      winning row was manually set (preserved; logged), keeps the rest.
 *   4. WRITES the surviving candidates via the EXISTING POST seam (Group 3),
 *      which drives AMS's append-only supersession of older manifest-derived
 *      rows for the same code (re-upload supersede). POST-only; no PATCH/DELETE.
 *   5. RECOMPUTES the resolved target-version set from the latest manifests +
 *      surviving manual edits (`version-unknown` passes through) — the
 *      structured target-version source Spec 4 (Group 6) consumes.
 *
 * Never throws on a write failure — the partial outcome from the auto-answerer
 * is surfaced so the route can report partial success.
 */

import { logger } from '../logger';
import {
  ManifestAutoAnswererDeps,
  ManifestAnswerCandidate,
  defaultManifestAutoAnswererDeps,
  dedupeCandidatesByPrecedence,
  deriveManifestAnswerCandidates,
  runManifestAutoAnswer,
  ManifestAutoAnswerOutcome,
} from './manifestAutoAnswerer';
import {
  ManifestLlmAnswer,
  ManifestLlmAnswerableCode,
  runManifestLlmGapFill,
} from './manifestLlmGapFill';
import { DEPENDENCY_ANSWERABLE_CODES } from './manifestCodeMapping';
import { QUESTION_LIBRARY } from '../../config/architect-conversation/questionLibrary';
import { VERSION_UNKNOWN } from '../../config/architect-conversation/frameworkVersionShape';
import {
  ManifestPrecedenceDeps,
  ResolvedTargetVersion,
  defaultManifestPrecedenceDeps,
  filterCandidatesByPrecedence,
  recomputeResolvedTargetVersions,
} from './manifestPrecedence';
import { ParsedManifest } from './parsedManifestModel';
import {
  ResolvedManifest,
  resolveManifestVersions,
} from './manifestVersionResolution';

export interface ManifestUploadOrchestratorDeps
  extends ManifestAutoAnswererDeps,
    ManifestPrecedenceDeps {}

export const defaultManifestUploadOrchestratorDeps: ManifestUploadOrchestratorDeps = {
  ...defaultManifestAutoAnswererDeps,
  ...defaultManifestPrecedenceDeps,
};

export interface ProcessManifestUploadArgs {
  projectId: string;
  targetArchitectureId: string;
  conversationThreadId?: string | null;
  /** Parsed manifests from the Group 1 upload route. */
  parsedManifests: readonly ParsedManifest[];
}

export interface ProcessManifestUploadResult {
  /** Group 2 resolved manifests (resolved versions / version-unknown). */
  resolvedManifests: ResolvedManifest[];
  /** Group 3 candidate set BEFORE precedence filtering (full inspection set). */
  allCandidates: ManifestAnswerCandidate[];
  /** Candidates that survived manual-wins precedence (the ones written). */
  survivingCandidates: ManifestAnswerCandidate[];
  /** Codes skipped because a manual answer was preserved (logged). */
  skippedManualCodes: string[];
  /** The auto-answer write outcome (rows written, partial-failure, abort). */
  writeOutcome: ManifestAutoAnswerOutcome;
  /**
   * The recomputed structured target-version set (latest manifests + surviving
   * manual edits; `version-unknown` passthrough). Spec 4 hand-off source.
   */
  resolvedTargetVersions: ResolvedTargetVersion[];
  /**
   * Tier-2 "free facts" — LLM-named manifest tech OUTSIDE the 51 questions
   * (`"<friendly> — <coordinate>"` labels). Empty when the LLM is unwired or
   * failed (fail-open). Surfaced + persisted by Task Group 7.
   */
  freeFacts: string[];
}

// ---------------------------------------------------------------------------
// LLM gap-fill projection helpers (Spec 2 R5)
// ---------------------------------------------------------------------------

/**
 * The manifest-answerable decision-code surface the LLM gap-fill may propose
 * answers for: the deterministic coordinate/build-tool set PLUS the
 * property/plugin-extractor codes (`service.language`, `db.migrations`), the
 * INFERRED codes (`db.engine`, `service.runtime`), and the clearly
 * manifest-relevant combo code `testing.integration` the registry deliberately
 * leaves to the LLM. NEVER includes a not-manifest code (cutover/auth/etc.).
 */
const MANIFEST_LLM_ANSWERABLE_SURFACE: ReadonlySet<string> = new Set<string>([
  ...DEPENDENCY_ANSWERABLE_CODES,
  'service.language',
  'db.migrations',
  'db.engine',
  'service.runtime',
  'testing.integration',
]);

/** Project the manifest-answerable codes still OPEN (not already answered). */
function projectOpenAnswerableCodes(
  answeredCodes: ReadonlySet<string>,
): ManifestLlmAnswerableCode[] {
  const out: ManifestLlmAnswerableCode[] = [];
  for (const q of QUESTION_LIBRARY) {
    if (!MANIFEST_LLM_ANSWERABLE_SURFACE.has(q.code)) continue;
    if (answeredCodes.has(q.code)) continue;
    out.push({
      code: q.code,
      prompt: q.prompt,
      expectedAnswerShape: q.expectedAnswerShape,
      choices: q.choices,
      versioned: q.versioned,
    });
  }
  return out;
}

/** Index resolved deps by coordinate for LLM-answer version/source recovery. */
function indexResolvedDependencies(manifests: readonly ResolvedManifest[]): {
  versionByCoord: Map<string, string>;
  sourceFileByCoord: Map<string, string>;
  tagByCoord: Map<string, string>;
} {
  const versionByCoord = new Map<string, string>();
  const sourceFileByCoord = new Map<string, string>();
  const tagByCoord = new Map<string, string>();
  for (const m of manifests) {
    for (const dep of m.resolvedDependencies) {
      if (!versionByCoord.has(dep.name)) versionByCoord.set(dep.name, dep.resolvedVersion);
      if (!sourceFileByCoord.has(dep.name)) sourceFileByCoord.set(dep.name, dep.manifestPath);
      if (!tagByCoord.has(dep.name)) tagByCoord.set(dep.name, dep.tag);
    }
  }
  return { versionByCoord, sourceFileByCoord, tagByCoord };
}

/**
 * Convert an LLM-suggested answer into a write-immediately candidate badged
 * `llm`. A versioned code recovers its version from the source dependency's
 * resolved version (else `version-unknown`); a single-choice code writes the
 * verbatim value. Provenance + source-dependency are carried for the UI badge.
 */
function llmAnswerToCandidate(
  answer: ManifestLlmAnswer,
  index: ReturnType<typeof indexResolvedDependencies> & {
    fallbackSourceFile: string;
    fallbackTag: string;
  },
): ManifestAnswerCandidate {
  const sourceFile =
    index.sourceFileByCoord.get(answer.sourceDependency) ?? index.fallbackSourceFile;
  const tag = index.tagByCoord.get(answer.sourceDependency) ?? index.fallbackTag;
  const recovered = index.versionByCoord.get(answer.sourceDependency);
  const base = {
    decisionCode: answer.decisionCode,
    sourceFile,
    sourceQuote: `${answer.value} (LLM-suggested from ${answer.sourceDependency})`,
    tag,
    provenance: 'llm' as const,
    sourceDependency: answer.sourceDependency,
  };
  if (answer.versioned) {
    return {
      ...base,
      answerKind: 'framework-version',
      framework: answer.value,
      version: recovered && recovered !== VERSION_UNKNOWN ? recovered : VERSION_UNKNOWN,
    };
  }
  return { ...base, answerKind: 'single-choice', framework: answer.value, version: '' };
}

/**
 * Run the full (re-)upload iterate loop for a set of parsed manifests. Pure with
 * respect to its injected deps (the POST + read seams). Returns a structured
 * result the route surfaces to the caller; never throws on a write failure.
 */
export async function processManifestUpload(
  args: ProcessManifestUploadArgs,
  deps: ManifestUploadOrchestratorDeps = defaultManifestUploadOrchestratorDeps,
): Promise<ProcessManifestUploadResult> {
  // 1. Resolve versions (Group 2).
  const resolvedManifests = args.parsedManifests.map((m) =>
    resolveManifestVersions(m),
  );

  // 2. Derive candidate set (Groups 3/4): deterministic-direct + inferred.
  const baseCandidates = deriveManifestAnswerCandidates(resolvedManifests);

  // 2b. The ONE LLM gap-fill (Spec 2 R5) — ONLY when a client is wired in.
  //     FAIL-OPEN: any failure leaves the deterministic + inferred set standing.
  //     LLM candidates ride the LOWEST non-manual precedence (de-dup never lets
  //     them override a deterministic OR inferred hit). Tier-2 free facts are
  //     captured separately for Task Group 7.
  let allCandidates = baseCandidates;
  let freeFacts: string[] = [];
  if (deps.llmClient) {
    const answeredCodes = new Set(baseCandidates.map((c) => c.decisionCode));
    const gapFill = await runManifestLlmGapFill({
      resolvedManifests,
      answerableCodes: projectOpenAnswerableCodes(answeredCodes),
      llmClient: deps.llmClient,
    });
    if (gapFill.kind === 'success') {
      const firstManifest = resolvedManifests[0];
      const index = {
        ...indexResolvedDependencies(resolvedManifests),
        fallbackSourceFile: firstManifest?.manifestPath ?? '',
        fallbackTag: firstManifest?.tag ?? '',
      };
      const llmCandidates = gapFill.answers.map((a) => llmAnswerToCandidate(a, index));
      allCandidates = dedupeCandidatesByPrecedence([...baseCandidates, ...llmCandidates]);
      freeFacts = gapFill.freeFacts.map((f) => f.label);
    } else {
      logger.info('target-manifest upload: LLM gap-fill skipped (fail-open)', {
        projectId: args.projectId,
        targetArchitectureId: args.targetArchitectureId,
        reason: gapFill.reason,
      });
    }
  }

  // 3. Manual-wins precedence (Group 4).
  const precedence = await filterCandidatesByPrecedence(
    args.projectId,
    args.targetArchitectureId,
    allCandidates,
    deps,
  );

  // 4. Write the surviving candidates (Group 3 writer, prefill-shaped
  //    robustness). The POST drives AMS append-only supersession of older
  //    manifest-derived rows (re-upload supersede); manual rows were already
  //    filtered out in step 3 (preserve).
  const writeOutcome = await runManifestAutoAnswer(
    {
      projectId: args.projectId,
      targetArchitectureId: args.targetArchitectureId,
      conversationThreadId: args.conversationThreadId ?? null,
      resolvedManifests,
      candidates: precedence.survivingCandidates,
    },
    deps,
  );

  // 5. Recompute the resolved target-version set (Group 4 / Group 6 hand-off).
  //    Uses the full candidate set (so every manifest-derived dependency code is
  //    represented) overlaid with surviving manual answers (manual wins).
  const resolvedTargetVersions = recomputeResolvedTargetVersions({
    resolvedManifests,
    manifestCandidates: allCandidates,
    latestDecisions: precedence.latestDecisions,
  });

  logger.debug('target-manifest upload processed', {
    projectId: args.projectId,
    targetArchitectureId: args.targetArchitectureId,
    parsedManifests: args.parsedManifests.length,
    candidates: allCandidates.length,
    surviving: precedence.survivingCandidates.length,
    skippedManual: precedence.skippedManualCodes.length,
    rowsWritten: writeOutcome.rowsWritten,
    aborted: writeOutcome.aborted,
    resolvedTargetVersions: resolvedTargetVersions.length,
  });

  return {
    resolvedManifests,
    allCandidates,
    survivingCandidates: precedence.survivingCandidates,
    skippedManualCodes: precedence.skippedManualCodes,
    writeOutcome,
    resolvedTargetVersions,
    freeFacts,
  };
}
