/**
 * V3 Discovery Pipeline Orchestrator.
 *
 * Inverts the V2 LLM-first pipeline so extension packs run FIRST and LLM
 * gap-fill runs SECOND. V3 is the ONLY runtime pipeline; the V2 LLM-first
 * path is no longer reachable (V2 pack files remain in-tree as un-registered
 * dead code per the spec's "prefer un-registration over deletion" guidance).
 *
 * Four stages:
 *   1. LanguagePack.extract()   — deterministic IR extraction for the
 *                                 matched language (e.g. `javaLangPack`).
 *   2. FrameworkPack.adapt()    — deterministic candidate emission for
 *                                 each matched framework pack (e.g.
 *                                 `springClassicFrameworkPack`).
 *   3. LLM gap-fill             — real stage as of the "V3 Layered Prompt
 *                                 System" spec (2026-04-19, Task Group 5).
 *                                 Delegates per-file to `runLlmGapFill`,
 *                                 which composes layered prompts, calls the
 *                                 gateway relay, parses candidates, dedups
 *                                 against pack output, and returns surviving
 *                                 LLM candidates + stage metrics. The earlier
 *                                 Stage 3 stub (`V3_STAGE3_STUB_MARKER`) has
 *                                 been retired.
 *   4. Merge + persist          — merge Stage 2 pack candidates with the
 *                                 Stage 3 LLM candidates (pack first,
 *                                 LLM appended — identity preserved on the
 *                                 pack side so caller-visible references are
 *                                 unchanged), persist via the existing
 *                                 `bulkSaveCandidates` path, and persist the
 *                                 computed tier (A/B/C) on the run's `mode`
 *                                 column via `updateDiscoveryRun`. The run's
 *                                 `steps_payload.v3.gapFill` object records
 *                                 stage status, failure list, dedup-dropped
 *                                 count, file-processed count, and
 *                                 `promptVersion` (the four 8-char SHA-256
 *                                 hashes surfaced by `runLlmGapFill`).
 *
 * Tier model (`computeTier`):
 *   - 'A' — LanguagePack + FrameworkPack both matched.
 *   - 'B' — LanguagePack matched, no FrameworkPack matched (IR-only).
 *   - 'C' — neither matched.
 *
 * Tier input precedence (Spec: 2026-04-20 V3 Tier UX — Task Group 3):
 *   - If `context.tier` is supplied (the `POST /discovery/runs` route owns
 *     tier computation now and passes it through), use it verbatim and do
 *     NOT re-invoke `computeTier`. This eliminates double computation and
 *     ensures the persisted tier matches the tier the pipeline actually
 *     ran under.
 *   - If `context.tier` is absent, fall back to `computeTier(techHints)`
 *     for backward compatibility with callers that have not yet been
 *     updated (legacy path). The route-driven supply is landed in Task
 *     Group 4 of the same spec.
 *
 * Per-file tier scoping: the run-level tier is applied to every file. Per-file
 * tier refinement (e.g. downgrading files where the LanguagePack produced no
 * IR) is a future improvement and is explicitly called out as out-of-scope
 * for Task Group 5 (`agent-os/specs/2026-04-19-v3-layered-prompts/tasks.md`).
 *
 * Candidate confidence (Spec: 2026-04-20 V3 Tier UX — Task Group 3):
 *   - Pack adapters that already emit an explicit numeric `confidence`
 *     (currently in the 0.85–0.95 range) are preserved as-is. This matches
 *     the requirement "adapters that already emit an explicit confidence
 *     retain it (no overwrite)".
 *   - Pack adapters that leave `confidence` undefined / null get filled in
 *     by `getConfidenceForTag` using the adapter tag recovered from the
 *     candidate's `data._addedBy`. The tag midpoint (default 0.9) applies.
 *   - LLM candidates are fully owned by `llmGapFillStep`; confidence is
 *     assigned there (not re-assigned here) so cross-module semantics stay
 *     single-sourced via `confidence.ts`.
 *
 * External contract: `llmFileAnalysisStep.ts` calls `runDiscoveryV3` to
 * implement the Phase-1 step previously backed by the V2 LLM-first path.
 * The existing return shape (`candidates`, `evidenceCount`, `filesAnalyzed`,
 * `filesFailed`, `tier`) is preserved. A new optional `gapFillOutput` field
 * carries the raw stage output so Task Group 6 (prompt-version persistence)
 * can read `promptVersion` without threading a second return value.
 */

import { archModelClient } from './archModelClient';
import { runDiscoveryRuntimeEvidence } from './runtimeEvidence/runDiscoveryRuntimeEvidence';
import type { RuntimeEvidenceLlmContext } from './runtimeEvidence/httpRuntimeObservation';
import {
  findLanguagePack,
  findFrameworkPacks,
  computeTier,
} from './extensionPackRegistry';
import { sortCandidatesParentsFirst } from './llmFileAnalysisStep';
import { runLlmGapFill } from './llmGapFillStep';
import {
  runBehaviourCapture,
  type BehaviourBlock,
  type BehaviourCaptureStepOutput,
} from './llmBehaviourCaptureStep';
import {
  runResponseContractEnrichment,
  type ResponseContractEnrichOutput,
} from './responseContractEnrichmentStep';
import {
  resolveEndpointDataEffects,
  resolveInternalProcessDataEffects,
} from './extensionPacks/frameworkAdapters/springClassic/endpointDataEffectResolver';
import {
  scanInternalProcessXml,
  xmlEntryTargets,
} from './extensionPacks/frameworkAdapters/springClassic/internalProcessXmlScanner';
import { mintProcCallEdgeCandidates } from './procCallEdgeMinting';
import { filterNonExternalInterfaces } from './packPostProcess';
// Spec 0 (Unique, Aggregate Discovery Candidates): the universal, identity-keyed
// cross-source MERGE replaces the parent-inclusive dedup-DROP. `mergeCandidates`
// folds every source's view of one real element into one survivor;
// `reconcileMergedCandidates` re-parents endpoints to the specific controller,
// drops emptied generic interfaces, and rebuilds the relationship rows.
import { mergeCandidates, type MergeGroup, type MergeConflict } from './candidateMerge';
import { reconcileMergedCandidates } from './candidateReconcile';
import {
  buildMergeGroupFinding,
  buildMergeConflictFinding,
} from './findings/mergeFindingBuilders';
import type {
  GapFillStepFile,
  GapFillStepInput,
  GapFillStepOutput,
} from './llmGapFillStep';
import type { DiscoveryCandidate } from '../types/candidate';
import type { SourceFileIR, TechHints } from './extensionPacks';
import type { IrInjectionPayload } from './prompts/injection';
import { getConfidenceForTag } from './confidence';
import { type FindingEmitRunContext, type FindingEmitInput } from './findings/FindingEmitter';
import {
  buildLowConfidenceCandidateFinding,
  buildScannerFailedFinding,
} from './findings/emissionSources';
import { scanForEvidenceGaps } from './findings/evidenceGapScanner';
import { scanForSpecificationCoverage } from './findings/specificationCoverageScanner';
import { runPackFindingScanners } from './findings/packFindingScanners';
import { runContractCandidatePasses } from './findings/packFindingScanners/contractCandidates';
import { AMBIGUOUS_THRESHOLD } from '../constants/linkerDefaults';
// Operational-Artifact Scan (D1, Spec 2026-06-14): the always-on, pack-agnostic
// pass that summarises unclaimed-but-relevant files into operational_artifact
// findings. Its findingInputs join collectedFindingInputs (same emission boundary).
import { runOperationalArtifactScan } from './operationalArtifactScanStep';
import { OPERATIONAL_ARTIFACT_SCAN_ENABLED } from '../config';
// Capability Synthesis (D2, Spec 2026-06-14): deterministic seeding (JIL-DAG
// transitive closure + co-location heuristic) -> naming-only LLM -> durable
// discovery_capability records. Runs AFTER the merge/persist seam so candidate
// members carry stable ids; consumes the OA findings for detail_json (D9 — works
// from candidates/JIL alone when D1 is absent).
import {
  runCapabilitySynthesis,
  type OperationalArtifactInput,
} from './batchSpines/capabilitySynthesisStep';
import { collectJilTopologies } from './batchSpines/jilCollector';
import { CAPABILITY_SYNTHESIS_ENABLED } from '../config';
import {
  buildLeanExistingEntityIndex,
  type ExistingEntityIndexItem,
} from './prompts/existingEntityIndex';


/**
 * Candidate-save batch size for V3 candidate persistence. Matches the
 * value used by `runManager.ts` so operational behaviour is unchanged.
 */
const CANDIDATE_BATCH_SIZE = 100;

/**
 * Input context for `runDiscoveryV3`.
 *
 * `sourceFiles` is a pre-built `Map<filePath, contents>` — the caller
 * (`llmFileAnalysisStep.ts`) is responsible for scan-plan selection,
 * repo cloning, and file reading so the orchestrator stays focused on
 * the four-stage pack-first flow.
 */
export interface V3PipelineContext {
  /** Discovery run UUID. */
  runId: string;
  /** Project UUID. */
  projectId: string;
  /** Source files keyed by file path (contents already read + truncated). */
  sourceFiles: Map<string, string>;
  /**
   * Operator-supplied API contract files (2026-08-02): WADL/WSDL/XSD content
   * uploaded to the scan as an AUTHORITATIVE Interface/Endpoint source — the
   * service-discovery analogue of API Baseline Capture's contract upload.
   * Parsed by the SAME contract passes as repo-discovered contracts (injected
   * as synthetic IR files before Stage 2), so their declared media types stamp
   * the endpoint discriminators even when the repo merge missed them. Contract
   * endpoints union with code-discovered ones; the merge reconciles the rest.
   */
  contractFiles?: Array<{ fileName: string; content: string }>;
  /** Technology hints from the discovery config, used for pack selection. */
  techHints: TechHints;
  /**
   * Optional allow-list of candidate types for service-scoped runs. When
   * provided, candidates whose `candidateType` is not in the list are
   * filtered out after Stage 2 (mirroring the V2 post-filter path).
   */
  allowedCandidateTypes?: string[];
  /**
   * Optional explicit tier (A/B/C) supplied by the caller.
   *
   * When provided, `runDiscoveryV3` uses this value verbatim and does NOT
   * re-compute via `computeTier`. When absent, the pipeline falls back to
   * `computeTier(techHints)` so legacy callers continue to work.
   *
   * Precedence: caller-supplied tier > internal `computeTier` fallback.
   *
   * Spec: 2026-04-20 V3 Tier UX — Task Group 3. The `POST /discovery/runs`
   * route (Task Group 4) will supply this so the tier persisted on the run
   * row matches the tier the route gated on.
   */
  tier?: 'A' | 'B' | 'C';
  /**
   * Bug-10 root-cause fix (2026-04-21): when the caller persists candidates
   * itself (e.g. `runManager` service-scoped and project-scoped branches both
   * call `bulkSaveCandidates` after `executeLlmFileAnalysis` returns), set
   * this flag to skip the internal persist inside the V3 pipeline. This
   * prevents every candidate from being saved twice (once here, once by the
   * caller). Default false preserves legacy/test behaviour.
   */
  skipPersist?: boolean;
  /**
   * Bug-fix 2026-05-28: absolute on-disk path to the cloned-repo root.
   * Threaded into `runPackFindingScanners` so the optional spec-file linker
   * stage (`packFindingScanners/index.ts`) can walk the repo for OAS/Swagger
   * spec files and emit `oas_spec_orphan` / `oas_spec_ambiguous_match`
   * findings. Without this, the linker is skipped silently (back-compat
   * gate at the shim level).
   */
  repoRoot?: string;
  /**
   * Service-scope filter for the operational-artifact scan pass (D1, Spec
   * 2026-06-14). `repoRoot` alone does NOT scope a service-scoped run: the
   * subfolder / include-paths / exclude-paths are assembled in `runManager`
   * (service-scoped branch) and `llmFileAnalysisStep` (`scanPlanFilter`), NOT on
   * this context historically. We thread them HERE so the operational-artifact
   * re-walk scans ONLY in-scope files -- repo-scoped and service-scoped runs
   * behave identically except for this filter. Absent => whole-repo walk.
   */
  operationalArtifactScope?: {
    subfolder?: string;
    includePaths?: string[];
    excludePaths?: string[];
  };
}

/**
 * Result shape returned by `runDiscoveryV3`. Matches the V2
 * `LlmFileAnalysisStepResult` on the required fields so `runManager.ts`
 * needs no surgery; adds an optional `gapFillOutput` for Task Group 6.
 */
export interface V3PipelineResult {
  /** Merged Stage 2 (pack) + Stage 3 (LLM) candidates. */
  candidates: DiscoveryCandidate[];
  /** Evidence atoms persisted. Always 0 in this spec (no evidence path). */
  evidenceCount: number;
  /** Number of files for which Stage 1 produced IR. */
  filesAnalyzed: number;
  /** Number of files Stage 1 failed to process. */
  filesFailed: number;
  /** Computed pipeline tier ('A' | 'B' | 'C') persisted on the run row. */
  tier: 'A' | 'B' | 'C';
  /**
   * Raw output from the gap-fill stage. Exposed so downstream persistence
   * hooks (Task Group 6 — `promptVersion`) can read the full stage output
   * without re-running anything. Undefined when the gap-fill stage itself
   * was skipped (e.g. the caller disabled it in a future flag path).
   */
  gapFillOutput?: GapFillStepOutput;
  /**
   * Findings BUILT by the pipeline (low-confidence, candidate-conflict,
   * evidence-gap, pack scanners). Emission is DEFERRED to the caller
   * (`runManager`), which emits them AFTER it persists the candidates they
   * link to. Emitting pre-persist made AMS reject every candidate-linked
   * finding (dangling `discovery_candidate` link -> whole bulk rolled back)
   * and `FindingEmitter` soft-failed, so findings silently never landed and
   * the Findings tab showed 0. Bug-fix 2026-05-29.
   */
  findingInputs?: FindingEmitInput[];
  /**
   * Advisory run-level "degraded / may-be-partial" signal (Spec 2026-05-30
   * Oracle Integrity & Determinism, Task Group 2). TRUE when ANY run-integrity
   * trigger fired: a `scanner_failed` Finding was emitted (W4 -- a framework
   * adapter / pack scanner / contract pass / runtime-evidence sub-stage
   * soft-failed); the gap-fill stage reported `stageStatus: 'failed'` OR a
   * nonzero `filesFailed`; a behaviour-capture method/token CAP truncated
   * capture (Spec 2); or a contract/runtime pass failed.
   *
   * RIDES ALONGSIDE the COMPLETED status -- it is NEVER a block and NEVER a new
   * terminal run status (the `validateStatusTransition` state machine is
   * untouched). The caller (`runManager`) persists it on the run record at the
   * COMPLETED branches. Undefined leaves the run-record value unchanged.
   */
  degraded?: boolean;
  /**
   * Human-readable reasons the run tripped `degraded`, accumulated in trigger
   * order (Spec 2026-05-30, Task Group 2). Empty when `degraded` is false.
   * Persisted by `runManager` as a JSON-encoded string[] on the run record's
   * `degraded_reasons`, mirroring the advisory `warnings` precedent.
   */
  degradedReasons?: string[];
}

// ---------------------------------------------------------------------------
// Run-integrity degraded computation (Spec 2026-05-30 Oracle Integrity &
// Determinism, Task Group 2)
// ---------------------------------------------------------------------------

/**
 * Compute the advisory run-level `degraded` signal from the run's trigger set.
 *
 * ADVISORY ONLY -- this ESCALATES already-existing signals to the run level so
 * downstream consumers (Spec #5 coverage, the runtime harness) know the
 * captured model MAY be partial. It NEVER blocks and NEVER changes run status:
 * the run still transitions to COMPLETED in every branch. Pure + deterministic
 * (no I/O), so it is unit-testable in isolation.
 *
 * Triggers (any one sets `degraded = true` and appends its reason, in order):
 *   1. A `scanner_failed` Finding was emitted (W4) -- detected by scanning the
 *      built finding inputs for `detailJson.gapType === 'scanner_failed'`. This
 *      single check covers EVERY W4 soft-fail catch site uniformly: a framework
 *      adapter, a pack-finding scanner, the contract-candidate pass
 *      (`stage2_contract_passes`), AND the runtime-evidence sub-stage
 *      (`stage2_5_runtime_evidence`). The named scanner(s) ride in the reason.
 *      This is ALSO how the "a contract pass or runtime pass failed" trigger is
 *      satisfied -- those failures surface as `scanner_failed` findings with
 *      those phases. We do NOT re-emit anything (W4 already emitted them).
 *   2. The gap-fill stage reported `stageStatus: 'failed'`.
 *   3. The gap-fill stage reported a nonzero `filesFailed` (the real per-file
 *      count, wired in this spec; `GAP_FILL_MAX_FAILURE_RATE` semantics are
 *      UNCHANGED -- a partial gap-fill is a degraded trigger, not a run
 *      failure).
 *   4. A behaviour-capture method/token CAP truncated capture (Spec 2's
 *      `DEFAULT_METHOD_CAP` / `DEFAULT_TOKEN_CEILING`).
 *   5. The response-contract enrichment stage reported `stageStatus: 'failed'`
 *      (the harness/contract LLM pass) -- an additional, explicit contract-pass
 *      failure signal beyond the W4 `scanner_failed` route in (1).
 */
export function computeRunDegradedSignal(args: {
  findingInputs: FindingEmitInput[];
  gapFillStageStatus: 'completed' | 'failed';
  gapFillFilesFailed: number;
  behaviourCaptureCapHit?: boolean;
  responseContractStageStatus?: 'completed' | 'failed';
}): { degraded: boolean; degradedReasons: string[] } {
  const reasons: string[] = [];

  // (1) W4 scanner_failed Findings -> escalate to run level. Collect the named
  // scanners so the reason is actionable. One reason line lists them all.
  const failedScanners: string[] = [];
  for (const f of args.findingInputs) {
    const detail = (f.detailJson ?? undefined) as Record<string, unknown> | undefined;
    if (detail && detail.gapType === 'scanner_failed') {
      const name = typeof detail.scanner === 'string' ? detail.scanner : 'unknown';
      if (!failedScanners.includes(name)) failedScanners.push(name);
    }
  }
  if (failedScanners.length > 0) {
    reasons.push(
      `scanner_failed: ${failedScanners.join(', ')} soft-failed; ` +
        `the architecture they would have produced is missing from this run.`,
    );
  }

  // (2) gap-fill stage failed.
  if (args.gapFillStageStatus === 'failed') {
    reasons.push(
      'gap_fill_stage_failed: the LLM gap-fill stage exceeded its failure-rate ' +
        'threshold; captured candidates may be incomplete.',
    );
  }

  // (3) nonzero gap-fill per-file failures (the real count, this spec).
  if (args.gapFillFilesFailed > 0) {
    reasons.push(
      `gap_fill_files_failed: ${args.gapFillFilesFailed} file(s) failed gap-fill ` +
        'and produced zero candidates; those files are partially captured.',
    );
  }

  // (4) behaviour-capture method/token cap truncation (Spec 2).
  if (args.behaviourCaptureCapHit === true) {
    reasons.push(
      'capture_cap_hit: a behaviour-capture method/token cap truncated capture ' +
        '(DEFAULT_METHOD_CAP / DEFAULT_TOKEN_CEILING); some methods were not captured.',
    );
  }

  // (5) response-contract enrichment (contract pass) failed.
  if (args.responseContractStageStatus === 'failed') {
    reasons.push(
      'contract_pass_failed: the response-contract enrichment pass exceeded its ' +
        'failure-rate threshold; some endpoint contracts may be incomplete.',
    );
  }

  return { degraded: reasons.length > 0, degradedReasons: reasons };
}

// ---------------------------------------------------------------------------
// Stage 3 input builders
// ---------------------------------------------------------------------------

/**
 * Pick the first `techHints` language string, or null when none is present.
 *
 * `TechHints` entries carry at most one of `language` / `technology`; the V3
 * pipeline uses a single run-level language for the whole file set.
 */
function pickRunLanguage(techHints: TechHints): string | null {
  for (const entry of Object.values(techHints)) {
    if (entry?.language) return entry.language;
  }
  return null;
}

/**
 * Project a SourceFileIR into the compact injection payload the gap-fill
 * composer expects.
 *
 * Only classes / methods / imports are included — no full AST, per Task
 * Group 2 injection spec. "Methods" is the union of class methods and
 * top-level functions, matching how the LLM reasons about callable units.
 */
function projectIrForInjection(ir: SourceFileIR | undefined): IrInjectionPayload | null {
  if (!ir) return null;
  const classes = (ir.classes ?? []).map((c) => ({
    name: c.name,
    isInterface: c.isInterface,
    isAbstract: c.isAbstract,
    extends: c.extends,
    implements: c.implements,
  }));
  const methods: Array<{ name: string; returnType: string; className?: string }> = [];
  for (const c of ir.classes ?? []) {
    for (const m of c.methods ?? []) {
      methods.push({ name: m.name, returnType: m.returnType, className: c.name });
    }
  }
  for (const fn of ir.functions ?? []) {
    methods.push({ name: fn.name, returnType: fn.returnType });
  }
  const imports = (ir.imports ?? []).map((imp) => imp.path);
  return { classes, methods, imports };
}

/**
 * Build the per-file `GapFillStepFile[]` the gap-fill stage consumes.
 *
 * - Every source file is represented — including files the LanguagePack
 *   produced no IR for (Tier C routing per spec Q11: unclassifiable files
 *   go through the Tier-C prompt, not skipped).
 * - `packCandidates` seen by each file include BOTH the per-file pack
 *   candidates AND run-wide `physical_entity` / `physical_attribute` /
 *   `entity_relationship` candidates from all other files. The cross-file
 *   context lets the LLM honour the abstraction-layer rule when it reads
 *   SQL schema / migration files: it can see that Java `Owner` already maps
 *   to `tableName: "owners"` even when processing `schema.sql`, which has
 *   no per-file pack candidates of its own.
 */
function buildGapFillFiles(
  sourceFiles: Map<string, string>,
  irFiles: Map<string, SourceFileIR>,
  packCandidates: DiscoveryCandidate[],
  runTier: 'A' | 'B' | 'C',
  runLanguage: string | null,
  frameworkPackId: string | null,
): GapFillStepFile[] {
  // Index pack candidates by their first source cluster (== file path) for
  // O(1) per-file lookup as we walk the source files.
  const packByFile = new Map<string, DiscoveryCandidate[]>();
  for (const cand of packCandidates) {
    const fp =
      Array.isArray(cand.sourceClusterIds) && cand.sourceClusterIds.length > 0
        ? cand.sourceClusterIds[0]
        : '';
    if (!fp) continue;
    const bucket = packByFile.get(fp);
    if (bucket) {
      bucket.push(cand);
    } else {
      packByFile.set(fp, [cand]);
    }
  }

  // Cross-file context: all pack candidates for types vulnerable to
  // Java↔SQL (or other cross-abstraction) duplication. Kept compact —
  // only the types where abstraction-layer collisions are a known risk.
  const CROSS_FILE_TYPES = new Set<DiscoveryCandidate['candidateType']>([
    'physical_data_entities',
    'physical_data_attributes',
    'logical_data_entity_relationships',
  ]);
  const crossFileContext = packCandidates.filter((c) =>
    CROSS_FILE_TYPES.has(c.candidateType),
  );

  const files: GapFillStepFile[] = [];
  for (const [filePath, sourceCode] of sourceFiles.entries()) {
    const ir = irFiles.get(filePath);
    // Merge per-file and cross-file pack context; dedupe by identity so a
    // candidate from THIS file isn't double-listed.
    const local = packByFile.get(filePath) ?? [];
    const localSet = new Set(local);
    const merged = [...local, ...crossFileContext.filter((c) => !localSet.has(c))];
    files.push({
      filePath,
      sourceCode,
      tier: runTier,
      language: runLanguage,
      // Only Tier A supplies a framework pack layer; Tier B/C pass null.
      frameworkPackId: runTier === 'A' ? frameworkPackId : null,
      packCandidates: merged,
      ir: runTier === 'A' || runTier === 'B' ? projectIrForInjection(ir) : null,
    });
  }
  return files;
}

// ---------------------------------------------------------------------------
// Adapter candidate confidence backfill
// ---------------------------------------------------------------------------

/**
 * Fill in `confidence` on pack-adapter-emitted candidates when the adapter
 * left it undefined / null. Preserves any existing numeric confidence
 * regardless of its value — adapters that set 0.85–0.95 are kept verbatim.
 *
 * Spec 2026-04-20 V3 Tier UX — Task Group 3. Centralises the
 * `getConfidenceForTag(tag, currentValue?)` call at the single point where
 * pack candidates leave the adapter layer and enter the pipeline, so
 * per-adapter source files do NOT need modification.
 *
 * The tag is recovered from `candidate.data._addedBy` (adapters set this
 * convention; see `springClassic/index.ts::makeCandidate` etc). Candidates
 * without a recognisable `_addedBy` still get the adapter midpoint because
 * they reach this step from the pack-adapter stage by construction.
 *
 * Mutates in place (each candidate is already owned by the pipeline at this
 * point — callers past this line see the filled-in value).
 */
function applyAdapterConfidence(candidates: DiscoveryCandidate[]): void {
  for (const cand of candidates) {
    // Model-Aware Discovery (2026-05-30): deterministic pack candidates are
    // always `create` (the operation dimension only diverges from `create` for
    // LLM-proposed enrich/link candidates). Default it here so the in-memory
    // candidate carries `operation` for the frontend badge + tests; the AMS
    // mapper independently defaults a missing value to `create`.
    if (cand.operation === undefined) {
      cand.operation = 'create';
    }
    // Only fill when the adapter left confidence missing. Adapter-emitted
    // explicit values (typical 0.85–0.95) are preserved verbatim.
    const existing = cand.confidence as number | undefined | null;
    if (existing !== undefined && existing !== null && Number.isFinite(existing)) {
      continue;
    }
    const addedBy =
      ((cand.data as Record<string, unknown> | undefined)?._addedBy as
        | string
        | undefined) ?? '';
    // Recovered tag falls back to a generic adapter tag so the tag-family
    // classifier in `confidence.ts` routes to the adapter midpoint.
    const tag = addedBy || 'generic-adapter';
    cand.confidence = getConfidenceForTag(tag);
  }
}

// ---------------------------------------------------------------------------
// Stage 3 payload persistence
// ---------------------------------------------------------------------------

/**
 * Merge the gap-fill stage metrics into the run's `steps_payload` under
 * `v3.gapFill`. Existing `steps_payload` contents are preserved (we load,
 * merge, and overwrite only our key).
 *
 * Persists (Task Groups 5 + 6):
 *   - `stageStatus`          — 'completed' | 'failed'
 *   - `dedupDroppedCount`    — number of LLM candidates dropped by per-file
 *                              dedup-against-pack (existing behaviour)
 *   - `crossFileDedupCount`  — Bug 4 fix (2026-04-20): number of LLM
 *                              candidates collapsed by the cross-file
 *                              coalesce pass, keyed on `(type,
 *                              normalizeName(name))`. Surfaced so
 *                              observability can monitor how often the LLM
 *                              restates the same architectural element
 *                              across multiple files.
 *   - `failures[]`           — per-file `{ filePath, error }` records
 *   - `filesProcessed`       — total files fed into the stage
 *   - `promptVersion`        — `{ base, language, framework, composed }` of
 *                              8-char SHA-256 truncated hashes, surfaced by
 *                              `runLlmGapFill` from the first file it
 *                              actually composed a prompt for (or a synthetic
 *                              empty-hash record when every file skipped the
 *                              LLM call).
 *
 * Exported for testing.
 */
export async function persistGapFillStagePayload(
  projectId: string,
  runId: string,
  tier: 'A' | 'B' | 'C',
  gapFillOutput: GapFillStepOutput,
  filesProcessed: number,
): Promise<void> {
  const existing = await archModelClient.getDiscoveryRun(projectId, runId);
  const currentSteps = (existing?.steps_payload ?? {}) as Record<string, unknown>;
  const currentV3 =
    (currentSteps.v3 as Record<string, unknown> | undefined) ?? {};

  const merged: Record<string, unknown> = {
    ...currentSteps,
    v3: {
      ...currentV3,
      gapFill: {
        stageStatus: gapFillOutput.stageStatus,
        dedupDroppedCount: gapFillOutput.dedupDroppedCount,
        // Bug 4 fix (2026-04-20): cross-file coalesce count. See
        // `llmGapFillStep.ts::coalesceCrossFile` for the merge rules.
        crossFileDedupCount: gapFillOutput.crossFileDedupCount,
        failures: gapFillOutput.failures,
        filesProcessed,
        // Task Group 6: persist the per-layer + composed prompt-version
        // hashes surfaced by `runLlmGapFill`. When every file skipped the
        // LLM call, `runLlmGapFill` still returns a synthetic empty-hash
        // `PromptVersion` (not undefined), so this field is always a valid
        // four-field object on the persisted payload.
        promptVersion: gapFillOutput.promptVersion,
      },
    },
  };

  await archModelClient.updateDiscoveryRun(projectId, runId, {
    steps_payload: merged,
    mode: tier,
  });
}

// ---------------------------------------------------------------------------
// Behaviour-capture (Gap C) tier gate + metrics persistence
// ---------------------------------------------------------------------------

/**
 * Tier gate for the behaviour-capture stage (Spec 2026-05-29 Gap C).
 *
 * Behaviour capture is TIER-GATED exactly like gap-fill -- it is NOT an
 * off-by-default opt-in flag (avoid a built-but-never-runs feature). The stage
 * reads the method body + 1 hop of callee bodies, so it only makes sense when
 * Stage 1 produced IR; that means tiers A and B. Tier C (nothing matched, no
 * IR) has no Spring call graph + no methodId-stamped business_logics, so the
 * selector would return an empty set anyway -- we gate it out explicitly to
 * skip the resolver + fetch work. The env override BEHAVIOUR_CAPTURE_TIERS
 * (comma-separated, e.g. "A,B") lets operators widen / narrow the gate without
 * a code change.
 */
function behaviourCaptureTierAdmits(tier: 'A' | 'B' | 'C'): boolean {
  const raw = process.env.BEHAVIOUR_CAPTURE_TIERS;
  const allowed = raw && raw.trim().length > 0
    ? new Set(raw.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean))
    : new Set(['A', 'B']);
  return allowed.has(tier);
}

/**
 * Tier gate for the OPTIONAL response-contract ENRICHMENT stage
 * (Spec 2026-05-30 response-contract capture, Task Group 2.6).
 *
 * Tier-gated EXACTLY like behaviour capture -- NOT an off-by-default opt-in
 * flag. The deterministic response-contract scanner ALWAYS runs (in the
 * springClassic adapter); only the LLM prose-enrichment of the captured
 * contracts is gated here. Default tiers A/B (the tiers that produced IR + the
 * deterministic contracts); tier C has no Spring contracts so it is gated out
 * to skip the work. The env override RESPONSE_CONTRACT_TIERS (comma-separated,
 * e.g. "A,B") lets operators widen / narrow the gate without a code change.
 */
function responseContractTierAdmits(tier: 'A' | 'B' | 'C'): boolean {
  const raw = process.env.RESPONSE_CONTRACT_TIERS;
  const allowed = raw && raw.trim().length > 0
    ? new Set(raw.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean))
    : new Set(['A', 'B']);
  return allowed.has(tier);
}

/**
 * Merge the response-contract-enrichment stage metrics into the run's
 * `steps_payload` under `v3.responseContract`, ALONGSIDE `v3.behaviourCapture`.
 * Same load-merge-write pattern as {@link persistBehaviourCaptureStagePayload};
 * observability only -- callers swallow persistence errors.
 *
 * Exported for testing.
 */
export async function persistResponseContractStagePayload(
  projectId: string,
  runId: string,
  output: ResponseContractEnrichOutput,
): Promise<void> {
  const existing = await archModelClient.getDiscoveryRun(projectId, runId);
  const currentSteps = (existing?.steps_payload ?? {}) as Record<string, unknown>;
  const currentV3 =
    (currentSteps.v3 as Record<string, unknown> | undefined) ?? {};

  const merged: Record<string, unknown> = {
    ...currentSteps,
    v3: {
      ...currentV3,
      responseContract: {
        stageStatus: output.stageStatus,
        selectedCount: output.selectedCount,
        processed: output.processed,
        skipped: output.skipped,
        failures: output.failures,
      },
    },
  };

  await archModelClient.updateDiscoveryRun(projectId, runId, {
    steps_payload: merged,
  });
}

/**
 * Merge the behaviour-capture stage metrics into the run's `steps_payload`
 * under `v3.behaviourCapture`, ALONGSIDE `v3.gapFill`. Follows the same
 * load-merge-write pattern as {@link persistGapFillStagePayload}: load the
 * current payload, preserve everything, overwrite only our key. Observability
 * only -- callers swallow persistence errors.
 *
 * Persists: selectedCount / processed / skipped / cacheHits / failures /
 * stageStatus.
 *
 * Exported for testing.
 */
export async function persistBehaviourCaptureStagePayload(
  projectId: string,
  runId: string,
  output: BehaviourCaptureStepOutput,
): Promise<void> {
  const existing = await archModelClient.getDiscoveryRun(projectId, runId);
  const currentSteps = (existing?.steps_payload ?? {}) as Record<string, unknown>;
  const currentV3 =
    (currentSteps.v3 as Record<string, unknown> | undefined) ?? {};

  const merged: Record<string, unknown> = {
    ...currentSteps,
    v3: {
      ...currentV3,
      behaviourCapture: {
        stageStatus: output.stageStatus,
        selectedCount: output.selectedCount,
        processed: output.processed,
        skipped: output.skipped,
        cacheHits: output.cacheHits,
        failures: output.failures,
      },
    },
  };

  await archModelClient.updateDiscoveryRun(projectId, runId, {
    steps_payload: merged,
  });
}

/**
 * Build the priorBlocksByMethodId cache map for the behaviour-capture stage.
 *
 * Best-effort: reads any business_logics candidates ALREADY persisted for
 * this run that carry a data.behavior block, and indexes them by their
 * embedded method_id. On a re-execution of the same run this lets the stage
 * hit the source_hash cache and skip the LLM for unchanged methods. A genuine
 * brand-new run simply gets an empty map (cold cache). Never throws -- returns
 * an empty map on any error so the stage still runs.
 *
 * NOTE: cross-RUN carry-forward (indexing the previous run's blocks under a new
 * run id) would require a new AMS run-history query and is intentionally NOT
 * built here (out of scope); the cache mechanism + its env/test coverage live
 * in llmBehaviourCaptureStep, and this seam feeds it whatever prior blocks
 * are cheaply available.
 */
async function buildPriorBehaviourBlocks(
  projectId: string,
  runId: string,
): Promise<Map<string, BehaviourBlock>> {
  const out = new Map<string, BehaviourBlock>();
  try {
    const existing = await archModelClient.getCandidatesByRun(
      projectId,
      runId,
      'business_logics',
    );
    for (const cand of existing) {
      const data = (cand.data ?? {}) as Record<string, unknown>;
      const block = data.behavior as BehaviourBlock | undefined;
      if (
        block &&
        typeof block === 'object' &&
        typeof block.method_id === 'string' &&
        typeof block.source_hash === 'string'
      ) {
        out.set(block.method_id, block);
      }
    }
  } catch {
    // Cold cache on any error.
  }
  return out;
}

// ---------------------------------------------------------------------------
// Capability Synthesis stage (D2, Spec 2026-06-14, Task Group 4)
// ---------------------------------------------------------------------------

/**
 * Project the in-memory `operational_artifact` FindingEmitInputs into the
 * synthesis step's {@link OperationalArtifactInput} shape. D1 stamps the rich
 * per-file summary onto `detailJson` (purpose / artifactKind / behaviourBearing /
 * invokes / externalSystems); we read it straight off the in-memory finding so
 * the substance flows into the capability `detail_json` (the findings have NO AMS
 * id yet here -- they are emitted post-persist by `runManager`).
 */
function projectOperationalArtifactInputs(
  findingInputs: FindingEmitInput[],
): OperationalArtifactInput[] {
  const out: OperationalArtifactInput[] = [];
  for (const f of findingInputs) {
    if (f.findingType !== 'operational_artifact') continue;
    const d = (f.detailJson ?? {}) as Record<string, unknown>;
    const filePath = typeof d.filePath === 'string' ? d.filePath : '';
    if (!filePath) continue;
    out.push({
      filePath,
      artifactKind: typeof d.artifactKind === 'string' ? d.artifactKind : 'other',
      behaviourBearing: d.behaviourBearing === true,
      invokes: toStrArray(d.invokes),
      externalSystems: toStrArray(d.externalSystems),
      purpose: typeof d.purpose === 'string' ? d.purpose : undefined,
    });
  }
  return out;
}

function toStrArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}

/**
 * Run the capability-synthesis stage end-to-end: collect JIL topologies (a
 * self-contained `.jil` re-read), project the OA findings, synthesise capability
 * payloads (deterministic seeding + naming-only LLM), and persist them via the
 * AMS bulk endpoint. A no-op when there are no payloads (the zero-signal path).
 * Soft -- the caller wraps this in a try/catch so it can never abort the run.
 */
async function runCapabilitySynthesisStage(args: {
  projectId: string;
  runId: string;
  candidates: DiscoveryCandidate[];
  findingInputs: FindingEmitInput[];
  repoRoot?: string;
  subfolder?: string;
}): Promise<void> {
  const start = Date.now();
  const operationalArtifacts = projectOperationalArtifactInputs(args.findingInputs);

  // Collect + parse `.jil` files (symbol-less -> not in the IR set). Skipped when
  // there is no repoRoot (e.g. a non-clone run): synthesis still seeds from
  // candidates + OA findings (D9).
  let jilTopologies = new Map<string, import('./batchSpines/jilParser').JilTopology>();
  if (args.repoRoot) {
    jilTopologies = await collectJilTopologies(args.repoRoot, args.subfolder);
  }

  const result = await runCapabilitySynthesis({
    runId: args.runId,
    candidates: args.candidates,
    operationalArtifacts,
    jilTopologies,
  });

  if (result.payloads.length === 0) {
    console.log(
      `[DiscoveryV3:CapabilitySynthesis] no capabilities synthesised ` +
        `(seeds=${result.seedCount}, jilFiles=${jilTopologies.size}, oaArtifacts=${operationalArtifacts.length}); ` +
        `no-op in ${Date.now() - start}ms.`,
    );
    return;
  }

  await archModelClient.bulkCreateDiscoveryCapabilities(args.projectId, args.runId, result.payloads);
  console.log(
    `[DiscoveryV3:CapabilitySynthesis] persisted ${result.payloads.length} capabilities ` +
      `(seeds=${result.seedCount}, namedByLlm=${result.namedByLlm}, cacheHits=${result.cacheHits}, ` +
      `namingFailures=${result.namingFailures}) in ${Date.now() - start}ms.`,
  );
}

// ---------------------------------------------------------------------------
// Pipeline entry point
// ---------------------------------------------------------------------------

/**
 * V3 pipeline entry point.
 *
 * Orchestrates the four V3 stages against the provided context. See the
 * module-level doc comment for the stage contract.
 *
 * @param context  Pre-built context (runId, projectId, sourceFiles, techHints,
 *                 and optionally a caller-supplied `tier`).
 * @returns        V3PipelineResult with merged candidates, counts, tier, and
 *                 gap-fill stage output.
 */
/**
 * Turn operator-uploaded contract files into synthetic `SourceFileIR` entries
 * (keyed `__uploaded_contract__/<fileName>`) that the WADL/XSD contract passes
 * parse identically to a repo-discovered `.wadl`/`.xsd`. The extension drives
 * the pass selection (`isWadlFile`/`isXsdFile` key off it), so the uploaded
 * file name MUST carry the real extension. Blank names / empty content are
 * dropped. Pure + exported for tests.
 */
export function buildUploadedContractIrEntries(
  contractFiles: ReadonlyArray<{ fileName: string; content: string }>,
): Map<string, SourceFileIR> {
  const out = new Map<string, SourceFileIR>();
  for (const cf of contractFiles) {
    const fileName = (cf?.fileName || '').trim();
    const content = typeof cf?.content === 'string' ? cf.content : '';
    if (!fileName || content.length === 0) continue;
    const key = `__uploaded_contract__/${fileName}`;
    if (out.has(key)) continue;
    out.set(key, {
      filePath: key,
      language: 'xml',
      packageOrNamespace: null,
      imports: [],
      classes: [],
      functions: [],
      rawContent: content,
    });
  }
  return out;
}

export async function runDiscoveryV3(
  context: V3PipelineContext,
): Promise<V3PipelineResult> {
  const { runId, projectId, sourceFiles, techHints } = context;

  const pipelineStart = Date.now();
  // Tier precedence (Spec 2026-04-20 Task Group 3):
  //   1. caller-supplied `context.tier` (route owns this post Task Group 4)
  //   2. fallback: `computeTier(techHints)` for legacy callers
  const tier: 'A' | 'B' | 'C' = context.tier ?? computeTier(techHints);
  console.log(
    `[DiscoveryV3] Starting run ${runId} (project ${projectId}): tier=${tier}` +
      `${context.tier ? ' (supplied)' : ' (computed)'}, ${sourceFiles.size} source files.`,
  );
  // Structured diag for the runbook. Counts only -- no file paths, no tier
  // logic detail, no project / run uuids beyond the 8-char prefix.
  console.log(
    `[diag-scan] run=${(runId || '').slice(0, 8)} files=${sourceFiles.size} tier=${tier}`,
  );

  // ---------------------------------------------------------------------------
  // Stage 1: LanguagePack — extract Universal IR.
  // ---------------------------------------------------------------------------
  const stage1Start = Date.now();
  const languagePack = findLanguagePack(techHints);
  let irFiles: Map<string, SourceFileIR> = new Map();
  if (languagePack) {
    console.log(
      `[DiscoveryV3:Stage1] Running LanguagePack '${languagePack.id}' on ${sourceFiles.size} files...`,
    );
    irFiles = languagePack.extract(sourceFiles, techHints);
    console.log(
      `[DiscoveryV3:Stage1] LanguagePack '${languagePack.id}' produced IR for ${irFiles.size} files in ${Date.now() - stage1Start}ms.`,
    );
    console.log(
      `[diag-scan] run=${(runId || '').slice(0, 8)} stage=stage1_ir ` +
        `files_in=${sourceFiles.size} files_with_ir=${irFiles.size} ` +
        `elapsed_ms=${Date.now() - stage1Start}`,
    );
  } else {
    console.log(
      `[DiscoveryV3:Stage1] No LanguagePack matched techHints — skipping IR extraction (tier ${tier}).`,
    );
  }

  // W4 (2026-05-30): scanner-failure visibility. Every SOFT-FAIL catch site
  // below (framework adapters, contract passes, runtime-evidence sub-stage)
  // pushes a `scanner_failed` evidence-gap Finding here IN ADDITION to its
  // existing log, so a COMPLETED run no longer silently hides a framework that
  // threw. These flow onto the SAME caller-emit boundary as every other
  // finding source (flushed into `findingInputs` near the end of the
  // pipeline). The pack-finding scanners have their OWN per-scanner soft-fail
  // inside `runPackFindingScanners`, which appends `scanner_failed` findings to
  // its returned list directly.
  const scannerFailureFindings: FindingEmitInput[] = [];

  // ---------------------------------------------------------------------------
  // Stage 2: FrameworkPacks — adapt IR into candidates.
  // ---------------------------------------------------------------------------
  const stage2Start = Date.now();
  const frameworkPacks = findFrameworkPacks(techHints);
  const packCandidates: DiscoveryCandidate[] = [];
  if (frameworkPacks.length === 0) {
    console.log(
      `[DiscoveryV3:Stage2] No FrameworkPacks matched techHints — no candidates produced (tier ${tier}).`,
    );
  } else {
    for (const pack of frameworkPacks) {
      const packStart = Date.now();
      try {
        const out = pack.adapt(irFiles, runId, techHints);
        packCandidates.push(...out);
        console.log(
          `[DiscoveryV3:Stage2] FrameworkPack '${pack.id}' emitted ${out.length} candidates in ${Date.now() - packStart}ms.`,
        );
      } catch (err) {
        // Framework adapters are deterministic, but defensively catch so a
        // failing adapter does not abort the whole run — other adapters may
        // still contribute candidates.
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `[DiscoveryV3:Stage2] FrameworkPack '${pack.id}' threw:`,
          errMsg,
        );
        // W4: make the silent drop VISIBLE as a high-severity Finding naming
        // the failed adapter. Soft-fail preserved (loop continues).
        scannerFailureFindings.push(
          buildScannerFailedFinding({
            scanner: `FrameworkPack:${pack.id}`,
            phase: 'stage2_framework_adapter',
            error: errMsg,
          }),
        );
      }
    }
  }
  console.log(
    `[DiscoveryV3:Stage2] Total ${packCandidates.length} candidates across ${frameworkPacks.length} FrameworkPacks in ${Date.now() - stage2Start}ms.`,
  );

  // Apply the centralized-confidence backfill to any pack candidate that
  // came out of the adapter without a confidence value. Existing explicit
  // adapter confidences (0.85–0.95 range) are preserved verbatim — this
  // only fills in the `undefined`/`null` case.
  applyAdapterConfidence(packCandidates);

  // ---------------------------------------------------------------------------
  // Optional service-scoped post-filter (mirrors V2 behaviour).
  //
  // Runs BEFORE gap-fill so the LLM sees the filtered pack output and does
  // not waste tokens proposing candidates we would drop downstream.
  // ---------------------------------------------------------------------------
  let filteredPackCandidates = packCandidates;
  if (context.allowedCandidateTypes) {
    const before = filteredPackCandidates.length;
    const allowed = new Set(context.allowedCandidateTypes);
    filteredPackCandidates = filteredPackCandidates.filter((c) => allowed.has(c.candidateType));
    if (filteredPackCandidates.length !== before) {
      console.log(
        `[DiscoveryV3:Stage2] Service-scoped post-filter: removed ${before - filteredPackCandidates.length} pack candidates outside allowed types [${context.allowedCandidateTypes.join(', ')}]. Remaining: ${filteredPackCandidates.length}.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Stage 2 contract-candidate passes (bug-fix 2026-05-22).
  //
  // The deterministic SOAP / WADL / XSD packs produce DiscoveryCandidate rows
  // that previously dead-ended:
  //   - SOAP candidates were built by `runSpringClassicSoapPass` but no caller
  //     routed them into `packCandidates`.
  //   - WADL files only produced `FindingEmitInput`s -- the candidate-shape
  //     (interfaces + endpoints in the meta-model) was missing.
  //   - Standalone XSD files had no deterministic emitter at all.
  //
  // `runContractCandidatePasses` runs all three contract passes and returns
  // the merged `DiscoveryCandidate[]`. Append here so the candidates flow
  // through the gap-fill context (Stage 3 -- the LLM sees them and skips
  // re-extraction) AND the Stage 4 merge + persist. Filtered by
  // `context.allowedCandidateTypes` for service-scoped runs to match the
  // existing pack-candidate post-filter.
  // ---------------------------------------------------------------------------
  // Inject operator-uploaded contract files as synthetic IR entries so the
  // contract passes parse them exactly like repo-discovered `.wadl`/`.xsd`
  // files (2026-08-02). Authoritative source: an endpoint the repo merge
  // missed is recovered here, and its declared media types stamp the
  // discriminator on merge.
  if (context.contractFiles && context.contractFiles.length > 0) {
    const injectedEntries = buildUploadedContractIrEntries(context.contractFiles);
    let injected = 0;
    for (const [key, entry] of injectedEntries) {
      if (irFiles.has(key)) continue; // repo wins the key; both parse the same
      irFiles.set(key, entry);
      injected += 1;
    }
    console.log(
      `[DiscoveryV3:Stage2] Injected ${injected} operator-uploaded contract file(s) ` +
        `for the contract passes (authoritative Interface/Endpoint source).`,
    );
  }

  const deferredContractFindings: FindingEmitInput[] = [];
  try {
    const contractOutput = runContractCandidatePasses({
      runId,
      irFiles,
      packCandidates: filteredPackCandidates,
    });
    let admittedContractCandidates = contractOutput.candidates;
    if (context.allowedCandidateTypes) {
      const allowed = new Set(context.allowedCandidateTypes);
      admittedContractCandidates = contractOutput.candidates.filter((c) =>
        allowed.has(c.candidateType),
      );
    }
    if (admittedContractCandidates.length > 0) {
      filteredPackCandidates = [
        ...filteredPackCandidates,
        ...admittedContractCandidates,
      ];
      console.log(
        `[DiscoveryV3:Stage2] Contract candidate passes (WADL/WSDL/XSD) emitted ` +
          `${admittedContractCandidates.length} candidate(s); total filteredPack=` +
          `${filteredPackCandidates.length}.`,
      );
    } else {
      console.log(
        `[DiscoveryV3:Stage2] Contract candidate passes (WADL/WSDL/XSD) emitted 0 candidates.`,
      );
    }
    deferredContractFindings.push(...contractOutput.findings);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[DiscoveryV3:Stage2] Contract candidate passes threw; continuing with pack candidates only:`,
      errMsg,
    );
    // W4: surface the missing WADL/WSDL/XSD contract candidates as a Finding.
    scannerFailureFindings.push(
      buildScannerFailedFinding({
        scanner: 'runContractCandidatePasses',
        phase: 'stage2_contract_passes',
        error: errMsg,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Stage 2 post-process: filter non-external interfaces + dedup.
  //
  // 1. Drop `interfaces` candidates carrying internal-Spring markers
  //    (springConfigKind in {configuration, xml-context, xml-bean,
  //    service-api, aop-aspect} or interfaceSubtype = spring-bean-definition).
  //    The architecture meta-model's "Interface" is reserved for external
  //    surfaces (REST controllers, Feign clients, WADL REST_API, etc.); bare
  //    Java `interface`-keyword types and Spring wiring are not interfaces.
  //
  // 2. Collapse duplicates across packs (e.g. springClassic + WADL pack both
  //    emitting the same endpoint) by entity-aware key:
  //      - endpoints: (verb, path, parentInterface)
  //      - others:    (candidateType, normalizedName)
  //
  // Runs BEFORE Stage 2.5 and Stage 3 so the LLM gap-fill stage sees only the
  // cleaned pack output.
  // ---------------------------------------------------------------------------
  // Spec 0: merge-group + conflict metadata captured at the Phase-1 hook so the
  // post-persist Findings block can emit one Finding per merge group + per
  // conflict (Group 4). Phase 2 (the LLM fold-in after Stage 3) appends to these.
  let packMergeGroups: MergeGroup[] = [];
  let packMergeConflicts: MergeConflict[] = [];
  {
    const before = filteredPackCandidates.length;
    const filterResult = filterNonExternalInterfaces(filteredPackCandidates);
    if (filterResult.droppedCount > 0) {
      console.log(
        `[DiscoveryV3:Stage2] Internal-interface filter: dropped ` +
          `${filterResult.droppedCount} of ${before} candidate(s). ` +
          `Breakdown: ${JSON.stringify(filterResult.droppedByMarker)}.`,
      );
    }
    // Spec 0: replace the parent-inclusive dedup-DROP with the universal,
    // identity-keyed cross-source MERGE over the kept pack + Stage-2 contract
    // candidates (Phase 1). The merge aggregates attribute-level findings from
    // every source into one survivor and HOLDS true value conflicts; reconcile
    // then re-parents endpoints to the specific controller, drops emptied
    // generic interfaces, and rebuilds the relationship rows. The survivor
    // objects keep their stable ids, so Stage 2.5 runtime evidence (which
    // matches/enriches BY ID) keeps finding them in the assigned-back array.
    const mergeBefore = filterResult.kept.length;
    const packMergeOutput = mergeCandidates(filterResult.kept);
    filteredPackCandidates = reconcileMergedCandidates(packMergeOutput.merged);
    packMergeGroups = packMergeOutput.mergeGroups;
    packMergeConflicts = packMergeOutput.conflicts;
    const mergeCollapsed = mergeBefore - filteredPackCandidates.length;
    if (mergeCollapsed > 0 || packMergeOutput.mergeGroups.length > 0) {
      console.log(
        `[DiscoveryV3:Stage2] Pack-candidate MERGE: ${packMergeOutput.mergeGroups.length} ` +
          `merge group(s) collapsed ${mergeCollapsed} duplicate(s) ` +
          `(${mergeBefore} -> ${filteredPackCandidates.length}); ` +
          `${packMergeOutput.conflicts.length} attribute conflict(s) held for review.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Stage 2.5 (Spec 5): Runtime Evidence sub-stage.
  //
  // Reads uploaded log files (config_snapshot.inputArtifacts.logFiles[]),
  // parses HTTP observations, matches them against deterministic Stage 2
  // endpoint candidates, and persists per-candidate + run-level evidence.
  // The orchestrator NEVER throws -- on any failure it persists a
  // skipped/failed sub-stage marker and returns an empty LLM context so
  // Stage 3 can proceed (acceptance criterion 22).
  //
  // Status visibility is exclusively through `steps_payload.v3.runtimeEvidence`
  // (no new VALID_STEPS entry, no runManager change).
  // ---------------------------------------------------------------------------
  const runtimeEvidenceStart = Date.now();
  let runtimeEvidenceLlmContext: RuntimeEvidenceLlmContext | undefined;
  try {
    // Resolve the project folder + config snapshot from existing AMS endpoints
    // so callers (`runManager`, tests) do not need to thread these through the
    // V3PipelineContext shape.
    const [projectDto, runDto] = await Promise.all([
      archModelClient.getProject(projectId).catch(() => null),
      archModelClient.getDiscoveryRun(projectId, runId).catch(() => null),
    ]);
    const projectFolder =
      (projectDto && typeof projectDto.project_parent_folder === 'string'
        ? projectDto.project_parent_folder
        : null) ?? '';
    const configSnapshot =
      (runDto?.config_snapshot as Record<string, unknown> | undefined) ?? {};

    const runtimeEvidenceResult = await runDiscoveryRuntimeEvidence({
      projectId,
      runId,
      architectureId:
        (runDto?.architecture_id as string | null | undefined) ?? undefined,
      projectFolder,
      deterministicCandidates: filteredPackCandidates,
      configSnapshot,
      archModelClient,
    });
    runtimeEvidenceLlmContext = runtimeEvidenceResult.llmContext;
    console.log(
      `[DiscoveryV3:Stage2.5] Runtime evidence done in ${Date.now() - runtimeEvidenceStart}ms.`,
    );
  } catch (err) {
    // Belt-and-braces -- the orchestrator already swallows its own
    // failures, but if anything in the resolve-and-call path throws
    // (e.g. archModelClient unavailable in a test that did not stub it)
    // we still proceed to Stage 3 with no runtime context.
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[DiscoveryV3:Stage2.5] Runtime evidence sub-stage threw at boundary:`,
      errMsg,
    );
    runtimeEvidenceLlmContext = undefined;
    // W4: surface a runtime-evidence sub-stage failure as a Finding so the
    // absent runtime usage/observation findings are not a silent gap.
    scannerFailureFindings.push(
      buildScannerFailedFinding({
        scanner: 'runtimeEvidence',
        phase: 'stage2_5_runtime_evidence',
        error: errMsg,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Stage 3: LLM gap-fill (real stage, replacing the earlier stub marker).
  //
  // Per-file inputs are scoped with the run-level tier. The first framework
  // pack that matched is used as the Tier-A layer id; Tier B/C receive null.
  // Unclassifiable files (no IR from Stage 1) stay in the file set and get
  // Tier-C routing inside the gap-fill stage.
  // ---------------------------------------------------------------------------
  const stage3Start = Date.now();
  const runLanguage = pickRunLanguage(techHints);
  const frameworkPackId =
    frameworkPacks.length > 0 ? frameworkPacks[0].id : null;

  const gapFillFiles = buildGapFillFiles(
    sourceFiles,
    irFiles,
    filteredPackCandidates,
    tier,
    runLanguage,
    frameworkPackId,
  );

  // -------------------------------------------------------------------------
  // Model-as-input (Spec 2026-05-30 Model-Aware Discovery -- Task Group 2).
  //
  // Load the existing (project, architecture) model and build a LEAN index of
  // the entities that ALREADY exist, so the LLM gap-fill prompt can nudge the
  // model away from restating known concepts and toward proposing enrich/link
  // candidates that reference them BY NAME. Tolerate an empty/absent model
  // (first run) by proceeding with no existing-entity section. The
  // load-bearing dedup/match runs deterministically in CODE at save-back --
  // this index is ONLY a nudge.
  //
  // If the WHOLE-model index is too large to inject in full, the builder
  // narrows to the relevant slice (scanned subtree + ALL data entities) and we
  // emit a Finding noting the truncation (no silent drop).
  // -------------------------------------------------------------------------
  let existingEntityIndex: ExistingEntityIndexItem[] = [];
  const modelTooLargeFindings: FindingEmitInput[] = [];
  try {
    const existingModel = await archModelClient.getModel(projectId, runId);
    if (existingModel) {
      const indexResult = buildLeanExistingEntityIndex(existingModel);
      existingEntityIndex = indexResult.items;
      console.log(
        `[DiscoveryV3:ModelAsInput] Loaded existing model; lean index has ` +
          `${existingEntityIndex.length} entit${existingEntityIndex.length === 1 ? 'y' : 'ies'} ` +
          `(wholeModel=${indexResult.wholeModelCount}, tooLarge=${indexResult.tooLarge}).`,
      );
      if (indexResult.tooLarge) {
        modelTooLargeFindings.push({
          findingType: 'model_too_large_for_injection',
          category: 'evidence_gap',
          severity: 'info',
          title:
            'Existing model too large to inject in full; narrowed to relevant slice',
          summary:
            `The existing architecture model holds ${indexResult.wholeModelCount} entities, ` +
            `exceeding the prompt-injection size cap. The "existing entities" prompt nudge ` +
            `was narrowed to the scanned service's subtree plus all data entities ` +
            `(${existingEntityIndex.length} entities). Deterministic dedup-against-existing ` +
            `at save-back is UNAFFECTED — it always uses the full persisted model.`,
          detailJson: {
            wholeModelCount: indexResult.wholeModelCount,
            injectedSliceCount: existingEntityIndex.length,
          },
          source: 'pipeline_model_as_input',
          createdByStage: 'discoveryV3Pipeline.modelAsInput',
        });
      }
    } else {
      console.log(
        `[DiscoveryV3:ModelAsInput] No existing model (first run / empty); ` +
          `proceeding with no existing-entity section.`,
      );
    }
  } catch (err) {
    // Model-awareness is additive: a failed load must NEVER abort the run.
    // Proceed with no existing-entity section (the prompt renders the
    // first-run stub) and let save-back do the authoritative matching.
    console.warn(
      `[DiscoveryV3:ModelAsInput] Failed to load existing model; proceeding ` +
        `without the existing-entity nudge:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  const gapFillInput: GapFillStepInput = {
    runId,
    files: gapFillFiles,
    runtimeEvidenceContext: runtimeEvidenceLlmContext,
    existingEntities: existingEntityIndex.length > 0 ? existingEntityIndex : undefined,
  };

  let gapFillOutput: GapFillStepOutput;
  try {
    gapFillOutput = await runLlmGapFill(gapFillInput);
    console.log(
      `[DiscoveryV3:Stage3] Gap-fill done in ${Date.now() - stage3Start}ms: ` +
        `status=${gapFillOutput.stageStatus}, llmCandidates=${gapFillOutput.llmCandidates.length}, ` +
        `dedupDropped=${gapFillOutput.dedupDroppedCount}, crossFileDedup=${gapFillOutput.crossFileDedupCount}, failures=${gapFillOutput.failures.length}.`,
    );
  } catch (err) {
    // Defensive: `runLlmGapFill` catches its own per-file failures and only
    // throws on truly exceptional paths. Synthesize an empty failed payload
    // so persistence still sees a shape it can write, and the pipeline
    // continues with pack candidates only.
    console.error(
      `[DiscoveryV3:Stage3] runLlmGapFill threw:`,
      err instanceof Error ? err.message : String(err),
    );
    gapFillOutput = {
      llmCandidates: [],
      stageStatus: 'failed',
      failures: [
        {
          filePath: '(pipeline)',
          error: err instanceof Error ? err.message : String(err),
        },
      ],
      // Spec 2026-05-30 Oracle Integrity & Determinism (Task Group 2): the
      // synthetic stub carries exactly one failure, so `filesFailed` is 1 --
      // keeps the scalar in lock-step with `failures.length` on this path too.
      filesFailed: 1,
      dedupDroppedCount: 0,
      // Bug 4 fix (2026-04-20): include the new field on the fallback stub
      // so the `GapFillStepOutput` shape stays consistent even on the
      // exceptional "runLlmGapFill threw" path.
      crossFileDedupCount: 0,
      promptVersion: {
        base: 'e3b0c442',
        language: 'e3b0c442',
        framework: 'e3b0c442',
        composed: 'e3b0c442',
      },
    };
  }

  // Persist stage metrics + tier. Observability-only — do not fail the run
  // on persistence errors since the candidate save below is the
  // authoritative persistence path.
  try {
    await persistGapFillStagePayload(
      projectId,
      runId,
      tier,
      gapFillOutput,
      gapFillFiles.length,
    );
  } catch (err) {
    console.warn(
      `[DiscoveryV3:Stage3] Failed to persist gap-fill payload + tier:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // ---------------------------------------------------------------------------
  // Stage 3b: per-method behaviour capture (Gap C, Spec 2026-05-29).
  //
  // TIER-GATED exactly like gap-fill (tiers A/B by default; env override
  // BEHAVIOUR_CAPTURE_TIERS) -- NOT an off-by-default opt-in flag. Runs as part
  // of the existing LLM stages.
  //
  // Driven by a DETERMINISTIC selector over the `business_logics` candidates:
  // a method qualifies only if it is endpoint-reachable via Spec 1's call graph
  // (reuse `resolveEndpointDataEffects` -- running it twice is cheap and the
  // resolver is pure) AND survives boilerplate exclusion. The 7-part block is
  // attached to the EXISTING `business_logics` candidate's `data.behavior` (no
  // new candidate type), so it flows into the Stage 4 merge + persist and
  // auto-stores on `discovery_candidates.data`. `source_hash` caching skips the
  // LLM for unchanged methods (Spec 1 edge churn does NOT invalidate the block).
  //
  // Mutates the in-place `filteredPackCandidates` business_logics rows; metrics
  // land on `steps_payload.v3.behaviourCapture` alongside `v3.gapFill`.
  // ---------------------------------------------------------------------------
  let behaviourCaptureOutput: BehaviourCaptureStepOutput | undefined;
  if (behaviourCaptureTierAdmits(tier)) {
    const stage3bStart = Date.now();
    try {
      const businessLogicCandidates = filteredPackCandidates.filter(
        (c) => c.candidateType === 'business_logics',
      );
      if (businessLogicCandidates.length > 0) {
        // Endpoint-reachable method ids from Spec 1's resolver (path hops).
        const effects = resolveEndpointDataEffects(Array.from(irFiles.values()));
        const endpointReachableMethodIds = new Set<string>();
        for (const edge of effects.resolved) {
          for (const hop of edge.path) {
            if (hop.methodId) endpointReachableMethodIds.add(hop.methodId);
          }
        }
        // Spec 2026-07-06-m (criterion B): INTERNAL entry points (scheduled /
        // listeners / Quartz / XML-wired) extend the reachable set the SAME
        // way, so batch/listener code gets behaviour blocks exactly like
        // endpoint code. Soft-fails to the endpoint-only set.
        try {
          const allFiles = Array.from(irFiles.values());
          const internalEffects = resolveInternalProcessDataEffects(
            allFiles,
            xmlEntryTargets(scanInternalProcessXml(allFiles)),
          );
          for (const edge of internalEffects.resolved) {
            for (const hop of edge.path) {
              if (hop.methodId) endpointReachableMethodIds.add(hop.methodId);
            }
          }
        } catch (err) {
          console.warn(
            `[DiscoveryV3:Stage3b] internal-entry reachable-set fold failed; ` +
              `continuing with endpoint-only selection:`,
            err instanceof Error ? err.message : String(err),
          );
        }

        const priorBlocksByMethodId = await buildPriorBehaviourBlocks(projectId, runId);

        behaviourCaptureOutput = await runBehaviourCapture({
          runId,
          tier,
          businessLogicCandidates,
          irFiles,
          endpointReachableMethodIds,
          priorBlocksByMethodId,
        });
        console.log(
          `[DiscoveryV3:Stage3b] Behaviour capture done in ${Date.now() - stage3bStart}ms: ` +
            `status=${behaviourCaptureOutput.stageStatus}, selected=${behaviourCaptureOutput.selectedCount}, ` +
            `processed=${behaviourCaptureOutput.processed}, cacheHits=${behaviourCaptureOutput.cacheHits}, ` +
            `skipped=${behaviourCaptureOutput.skipped}, failures=${behaviourCaptureOutput.failures.length}.`,
        );
      } else {
        console.log(
          `[DiscoveryV3:Stage3b] No business_logics candidates -- behaviour capture skipped.`,
        );
      }
    } catch (err) {
      // Defensive: behaviour capture is best-effort enrichment; never abort the
      // run. The 7-part block is optional metadata on the candidate.
      console.error(
        `[DiscoveryV3:Stage3b] Behaviour capture threw:`,
        err instanceof Error ? err.message : String(err),
      );
    }
    // Persist stage metrics (observability-only; do not fail the run).
    if (behaviourCaptureOutput) {
      try {
        await persistBehaviourCaptureStagePayload(projectId, runId, behaviourCaptureOutput);
      } catch (err) {
        console.warn(
          `[DiscoveryV3:Stage3b] Failed to persist behaviour-capture payload:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

  } else {
    console.log(
      `[DiscoveryV3:Stage3b] Tier ${tier} not admitted by behaviour-capture gate -- skipped.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Spec 2026-07-06-f §2 (Tier-1 batch): proc-call EDGE minting. Deterministic
  // and TIER-INDEPENDENT (no LLM). A COMBINED run carries both the code-side
  // proc references (data-effect query_text) and the sidecar's proc inventory
  // — join them into `endpoint_data_effects` candidates (access_mode
  // 'execute', query_kind 'proc_call'). Code-only runs mint nothing (the
  // proc_call_unmatched finding stays the visible signal). Soft-fail: a
  // minting error never aborts the run.
  // ---------------------------------------------------------------------------
  try {
    const procEdges = mintProcCallEdgeCandidates(filteredPackCandidates, runId);
    if (procEdges.length > 0) {
      filteredPackCandidates.push(...procEdges);
      console.log(
        `[DiscoveryV3] proc-call edge minting: ${procEdges.length} edge(s) ` +
          `joined against the run's proc inventory.`,
      );
    }
  } catch (err) {
    console.warn(
      `[DiscoveryV3] proc-call edge minting failed; continuing without edges:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // ---------------------------------------------------------------------------
  // Stage 3c: per-endpoint response-contract ENRICHMENT (Spec 2026-05-30,
  // response-contract capture, Task Group 2.6).
  //
  // The DETERMINISTIC response-contract scanner already ran inside the
  // springClassic adapter (Stage 2) and attached a `response_contract` blob to
  // each `endpoints` candidate's `data`. This OPTIONAL stage fills ONLY the
  // prose/semantic sub-fields the static pass could not (`body_shape`,
  // `response_summary`, `validation[].message` interpolation, `serialization
  // .envelope`) via the EXISTING gateway relay at temperature 0.
  //
  // TIER-GATED exactly like behaviour capture (tiers A/B by default; env
  // override RESPONSE_CONTRACT_TIERS) -- NOT an off-by-default opt-in flag. The
  // deterministic spine BOUNDS the set (only endpoints with a captured contract
  // that has a null prose field are eligible). Mutates the in-place
  // `filteredPackCandidates` endpoint rows; metrics land on
  // `steps_payload.v3.responseContract`.
  // ---------------------------------------------------------------------------
  let responseContractOutput: ResponseContractEnrichOutput | undefined;
  if (responseContractTierAdmits(tier)) {
    const stage3cStart = Date.now();
    try {
      const endpointCandidates = filteredPackCandidates.filter(
        (c) => c.candidateType === 'endpoints',
      );
      if (endpointCandidates.length > 0) {
        responseContractOutput = await runResponseContractEnrichment({
          runId,
          tier,
          endpointCandidates,
        });
        console.log(
          `[DiscoveryV3:Stage3c] Response-contract enrichment done in ${Date.now() - stage3cStart}ms: ` +
            `status=${responseContractOutput.stageStatus}, selected=${responseContractOutput.selectedCount}, ` +
            `processed=${responseContractOutput.processed}, skipped=${responseContractOutput.skipped}, ` +
            `failures=${responseContractOutput.failures.length}.`,
        );
      } else {
        console.log(
          `[DiscoveryV3:Stage3c] No endpoints candidates -- response-contract enrichment skipped.`,
        );
      }
    } catch (err) {
      // Defensive: enrichment is best-effort; never abort the run. The
      // deterministic contract is already on the candidate.
      console.error(
        `[DiscoveryV3:Stage3c] Response-contract enrichment threw:`,
        err instanceof Error ? err.message : String(err),
      );
    }
    if (responseContractOutput) {
      try {
        await persistResponseContractStagePayload(projectId, runId, responseContractOutput);
      } catch (err) {
        console.warn(
          `[DiscoveryV3:Stage3c] Failed to persist response-contract payload:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  } else {
    console.log(
      `[DiscoveryV3:Stage3c] Tier ${tier} not admitted by response-contract gate -- skipped.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Stage 4: FOLD the Stage-3 LLM candidates into the SAME identity index as the
  // already-merged pack/contract set, then persist (Spec 0 -- Phase 2).
  //
  // This REPLACES the legacy name-only LLM dedup (keyed on
  // `(candidateType, normalize(name))`). The universal merge folds each LLM
  // candidate into the matching pack survivor BY IDENTITY KEY, so the LLM
  // gap-fills against ONE clean set (it saw the merged pack set as its context,
  // so it mints fewer dupes) and the persisted review list shows ONE candidate
  // per real element. Provenance is preserved (the re-merge seeds `_mergedFrom`
  // from the survivors' existing audit trail). `reconcileMergedCandidates`
  // re-runs so a late LLM-only interface/endpoint is reconciled too.
  //
  // The merge's per-group + per-conflict metadata is appended to the holders the
  // post-persist Findings block reads (the `candidate_conflict`-shaped Findings
  // are KEPT -- emitted from `buildMergeGroupFinding`/`buildMergeConflictFinding`).
  // ---------------------------------------------------------------------------
  const preFoldPackCount = filteredPackCandidates.length;
  const llmCandidateCount = gapFillOutput.llmCandidates.length;
  const stage4MergeOutput = mergeCandidates([
    ...filteredPackCandidates,
    ...gapFillOutput.llmCandidates,
  ]);
  const merged: DiscoveryCandidate[] = reconcileMergedCandidates(
    stage4MergeOutput.merged,
  );
  packMergeGroups = [...packMergeGroups, ...stage4MergeOutput.mergeGroups];
  packMergeConflicts = [...packMergeConflicts, ...stage4MergeOutput.conflicts];
  const llmFoldedCount = preFoldPackCount + llmCandidateCount - merged.length;
  if (llmFoldedCount > 0 || stage4MergeOutput.mergeGroups.length > 0) {
    console.log(
      `[DiscoveryV3:Stage4] LLM fold-in: ${llmCandidateCount} LLM candidate(s) folded into ` +
        `the ${preFoldPackCount}-candidate merged set -> ${merged.length} total ` +
        `(${llmFoldedCount} collapsed; ${stage4MergeOutput.conflicts.length} new conflict(s)).`,
    );
  }

  const stage4Start = Date.now();
  if (context.skipPersist) {
    console.log(
      `[DiscoveryV3:Stage4] skipPersist=true — caller will persist ${merged.length} merged candidates (pre-fold pack=${preFoldPackCount}, llm=${llmCandidateCount}, collapsed=${llmFoldedCount}).`,
    );
  } else if (merged.length > 0) {
    const sorted = sortCandidatesParentsFirst(merged);
    const totalBatches = Math.ceil(sorted.length / CANDIDATE_BATCH_SIZE);
    console.log(
      `[DiscoveryV3:Stage4] Persisting ${sorted.length} merged candidates (pre-fold pack=${preFoldPackCount} + llm=${llmCandidateCount}, collapsed=${llmFoldedCount}) in ${totalBatches} batches of ${CANDIDATE_BATCH_SIZE}...`,
    );
    for (let i = 0; i < sorted.length; i += CANDIDATE_BATCH_SIZE) {
      const batch = sorted.slice(i, i + CANDIDATE_BATCH_SIZE);
      await archModelClient.bulkSaveCandidates(projectId, runId, batch);
    }
    console.log(
      `[DiscoveryV3:Stage4] Candidate persist complete in ${Date.now() - stage4Start}ms.`,
    );
  } else {
    console.log(`[DiscoveryV3:Stage4] No candidates to persist.`);
  }


  // =========================================================================
  // Discovery Findings emission (Spec 2026-05-16 -- Task Group 5)
  // -------------------------------------------------------------------------
  // Three v1 sources fire from this orchestrator:
  //   - Source A: low-confidence candidates (post-merge)
  //   - Source C (pipeline dedup): candidate_conflict per dedup drop
  //   - Source H: evidence_gap via scanForEvidenceGaps
  //
  // Sources B, C (triage), D, E, F live in their respective files:
  //   - B + C-triage + F: runManager.ts (alongside DecisionTask creation)
  //   - D + E: runtimeEvidence/runDiscoveryRuntimeEvidence.ts
  //
  // Source G (`unsupported_pattern`) is DEFERRED per D4 -- the enum value
  // lives in the AMS vocabulary for forward compat, but no v1 emission site
  // wires it. The negative test in __tests__/findingsEmissionSources.test.ts
  // asserts this stance.
  //
  // The architectureId is resolved server-side by archModelClient via the
  // runArchitectureRegistry, so the runContext's `architectureId` field is
  // a marker for forward-compat only. Emission is soft-fail (FindingEmitter
  // catches archModelClient errors internally) so this block CANNOT abort
  // the run.
  // =========================================================================
  // Bug-fix 2026-05-29: findings are BUILT here but EMITTED by the caller
  // (runManager) AFTER candidates are persisted. Emitting pre-persist made AMS
  // reject every candidate-linked finding (dangling discovery_candidate link
  // rolls back the whole bulk) and FindingEmitter soft-failed, so the Findings
  // tab silently showed 0. We collect the inputs here and return them.
  let collectedFindingInputs: FindingEmitInput[] = [];
  try {
    const findingInputs: FindingEmitInput[] = [];
    // Source A: low-confidence candidates. Emit for any candidate with
    // confidence below AUTO_ACCEPT_THRESHOLD (0.8) -- both the 'ambiguous'
    // [0.4, 0.8) and 'discarded-low' (<0.4) buckets get a finding so the
    // reviewer can see the long tail.
    for (const cand of merged) {
      const conf = typeof cand.confidence === 'number' ? cand.confidence : 1;
      if (conf < 0.8) {
        findingInputs.push(
          buildLowConfidenceCandidateFinding({
            candidateId: cand.id,
            candidateName: cand.name,
            candidateType: cand.candidateType,
            confidence: conf,
          }),
        );
      }
    }
    // Source C (pipeline MERGE -- Spec 0): one `candidate_conflict`-shaped
    // Finding per merge group (oracle completeness: the collapsed source ids +
    // per-source contribution are never silently lost) AND one per detected
    // attribute conflict (each competing value + its source). These EXTEND the
    // legacy `candidate_conflict` emission shape; `packMergeGroups` /
    // `packMergeConflicts` accumulate from BOTH the Phase-1 pack merge and the
    // Phase-2 LLM fold-in.
    for (const grp of packMergeGroups) {
      findingInputs.push(
        buildMergeGroupFinding({
          survivorId: grp.survivorId,
          survivorName: grp.survivorName,
          candidateType: grp.candidateType,
          mergedFromIds: grp.mergedFromIds,
          perSourceContribution: grp.perSourceContribution,
        }),
      );
    }
    for (const conflict of packMergeConflicts) {
      findingInputs.push(
        buildMergeConflictFinding({
          survivorId: conflict.survivorId,
          survivorName: conflict.survivorName,
          attr: conflict.attr,
          competingValues: conflict.competingValues,
        }),
      );
    }
    // Source H: evidence-gap scanner over the merged set.
    findingInputs.push(...scanForEvidenceGaps(merged));
    // Dimension-B specification coverage (Spec 2026-05-30 Capture Coverage
    // Gates, Task Group 2): one evidence-gap Finding per UNDER-SPECIFIED
    // discovered endpoint, using the SAME per-protocol "fully specified" bar
    // as AMS Group 1 (REST = resolved endpoint_data_effects edge; SOAP =
    // parent interface has bound message entities; business_logics.behavior is
    // BONUS only, never required). Deterministic, no LLM. The per-endpoint
    // "fully specified?" completeness rollup surfaces through the existing
    // FindingEmitter.getRunAggregate (no new aggregate shape) once these
    // Findings are emitted post-persist by the caller.
    const specCoverage = scanForSpecificationCoverage(merged);
    findingInputs.push(...specCoverage.inputs);
    if (specCoverage.totalEndpoints > 0) {
      console.log(
        `[DiscoveryV3:Findings] dimension-B specification coverage: ` +
          `${specCoverage.fullySpecifiedCount}/${specCoverage.totalEndpoints} endpoints fully specified ` +
          `(${specCoverage.underSpecifiedCount} under-specified -> evidence_gap findings).`,
      );
    }
    // Pack-finding scanners (Spec 2026-05-16 Java/Spring/Maven Findings):
    // run post-Stage-2 / before merge in conceptual terms; in practice we
    // invoke here alongside the evidence-gap scanner so the same emission
    // boundary owns soft-fail. Java scanner registered in Commit 1; Spring
    // Classic added in Commit 2. Maven runs from runManager.ts.
    // Bug-fix 2026-05-28: thread `repoRoot` + `runContext` so the spec-file
    // linker stage inside `runPackFindingScanners` is no longer skipped at
    // the back-compat gate. Without these the linker silently no-ops and
    // `oas_spec_orphan` / `oas_spec_ambiguous_match` / `oas_spec_missing`
    // findings never emit. `architectureId` is intentionally empty — the
    // AMS client resolves it server-side via the `runArchitectureRegistry`.
    const packFindingScannerRunContext: FindingEmitRunContext = {
      runId,
      projectId,
      architectureId: '',
    };
    findingInputs.push(
      ...runPackFindingScanners({
        runId,
        irFiles,
        packCandidates: filteredPackCandidates,
        repoRoot: context.repoRoot,
        runContext: packFindingScannerRunContext,
      }),
    );

    // Bug-fix 2026-05-22: SOAP-pass spec-link findings produced during the
    // Stage-2 contract-candidate pass (`runContractCandidatePasses`) are
    // accumulated up-front and flushed here so they land on the same
    // emission boundary as every other source. Previously they were dropped
    // because `runSpringClassicScannerWithSoap` did not propagate
    // `soap.findings` through `SpringClassicScannerOutput`.
    findingInputs.push(...deferredContractFindings);

    // Model-as-input (Spec 2026-05-30): the "model too large to inject whole"
    // Finding (if any) flows onto the SAME deferred emission boundary. It has
    // no candidate link, so it is run-level and always validates at AMS.
    findingInputs.push(...modelTooLargeFindings);

    // W4 (2026-05-30): scanner-failure findings accumulated at the Stage 2 /
    // Stage 2.5 soft-fail catch sites flow onto the SAME deferred emission
    // boundary. Run-level (no candidate link) so they always validate at AMS.
    findingInputs.push(...scannerFailureFindings);

    // Reference AMBIGUOUS_THRESHOLD here (imported for symmetry with the
    // emission-sources builders, even though the V3 site uses 0.8 as the
    // emit ceiling rather than the threshold itself).
    void AMBIGUOUS_THRESHOLD;
    // Hand the built inputs to the caller for post-persist emission (see the
    // V3PipelineResult.findingInputs doc + runManager.emitPipelineFindingsForRun).
    collectedFindingInputs = findingInputs;
  } catch (err) {
    // If a builder throws on a malformed candidate we must NOT abort the run.
    // Leave collectedFindingInputs empty -- matches the prior behaviour where
    // a throw before the (then-inline) emit meant nothing was emitted.
    collectedFindingInputs = [];
    console.warn(
      `[DiscoveryV3:Findings] Build boundary swallowed error:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // =========================================================================
  // Operational-Artifact Scan (D1, Spec 2026-06-14). ALWAYS-ON (env kill-switch
  // OPERATIONAL_ARTIFACT_SCAN_ENABLED). A DEDICATED re-walk of `repoRoot` that
  // COMPLEMENTS the pruned scan plan -- it summarises every unclaimed-but-
  // relevant operational file (shell / JIL / monitoring XML / CI config) into
  // ONE `operational_artifact` finding each, plus ONE run-level skip finding on
  // cap overflow. Its findingInputs join `collectedFindingInputs` so they flow
  // through the SAME post-persist emission boundary
  // (`emitPipelineFindingsForRun` -> `findingEmitter`); NO parallel emitter, NO
  // AMS schema change. Service-scoped runs honour scope via
  // `context.operationalArtifactScope` (threaded from `llmFileAnalysisStep`).
  // Soft-fail: a throw here never aborts the run.
  // =========================================================================
  if (OPERATIONAL_ARTIFACT_SCAN_ENABLED && context.repoRoot) {
    try {
      // The scan-plan `sourceFiles` keys are the repo-relative (forward-slash)
      // paths the deterministic packs/LLM already consumed -- pass them as the
      // claimed set so a config XML a pack parsed is not re-summarised (D2).
      const claimedPaths = new Set<string>();
      for (const fp of context.sourceFiles.keys()) {
        claimedPaths.add(fp.replace(/\\/g, "/"));
      }
      const oaResult = await runOperationalArtifactScan({
        runId,
        repoRoot: context.repoRoot,
        subfolder: context.operationalArtifactScope?.subfolder,
        includePaths: context.operationalArtifactScope?.includePaths,
        excludePaths: context.operationalArtifactScope?.excludePaths,
        claimedPaths,
      });
      collectedFindingInputs = collectedFindingInputs.concat(oaResult.findingInputs);
      console.log(
        `[DiscoveryV3:OperationalArtifact] selected=${oaResult.filesSelected}, ` +
          `summarised=${oaResult.filesSummarised}, failures=${oaResult.filesFailed}, ` +
          `overflow=${oaResult.overflowCount}, stageStatus=${oaResult.stageStatus}, ` +
          `findings=${oaResult.findingInputs.length}`,
      );
    } catch (err) {
      console.warn(
        `[DiscoveryV3:OperationalArtifact] scan boundary swallowed error; run continues:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  } else if (!OPERATIONAL_ARTIFACT_SCAN_ENABLED) {
    console.log('[DiscoveryV3:OperationalArtifact] disabled via OPERATIONAL_ARTIFACT_SCAN_ENABLED=false');
  }

  // =========================================================================
  // Capability Synthesis (D2, Spec 2026-06-14, Task Group 4). Runs AFTER the
  // Stage-4 merge/persist seam (so candidate members carry stable ids) AND after
  // the operational-artifact scan (so the OA findings are available for
  // detail_json). DETERMINISTIC membership via two seeding modes (JIL-DAG
  // transitive closure + a co-location heuristic for the un-orchestrated tail);
  // the LLM is NAMING-ONLY (mocked in tests, temperature 0, source-hash cached).
  // STANDS ALONE (D9): seeds from candidates + JIL topology + DB-object findings
  // alone; ZERO signals -> a no-op. Persists via the AMS capability bulk endpoint.
  // Soft-fail: a throw here never aborts the run (skipPersist runs skip it -- the
  // caller owns persistence + the capability write keys on persisted candidate ids).
  // =========================================================================
  if (CAPABILITY_SYNTHESIS_ENABLED && !context.skipPersist) {
    try {
      await runCapabilitySynthesisStage({
        projectId,
        runId,
        candidates: merged,
        findingInputs: collectedFindingInputs,
        repoRoot: context.repoRoot,
        subfolder: context.operationalArtifactScope?.subfolder,
      });
    } catch (err) {
      console.warn(
        `[DiscoveryV3:CapabilitySynthesis] stage boundary swallowed error; run continues:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  } else if (!CAPABILITY_SYNTHESIS_ENABLED) {
    console.log('[DiscoveryV3:CapabilitySynthesis] disabled via CAPABILITY_SYNTHESIS_ENABLED=false');
  }

  // Run-integrity degraded computation (Spec 2026-05-30 Oracle Integrity &
  // Determinism, Task Group 2). ESCALATES already-existing signals to the run
  // level; ADVISORY ONLY -- never blocks, never changes status. The caller
  // (`runManager`) persists `degraded` / `degradedReasons` alongside COMPLETED.
  const { degraded, degradedReasons } = computeRunDegradedSignal({
    findingInputs: collectedFindingInputs,
    gapFillStageStatus: gapFillOutput.stageStatus,
    gapFillFilesFailed: gapFillOutput.filesFailed,
    behaviourCaptureCapHit: behaviourCaptureOutput?.capHit,
    responseContractStageStatus: responseContractOutput?.stageStatus,
  });

  const totalMs = Date.now() - pipelineStart;
  console.log(
    `[DiscoveryV3] === RUN COMPLETE === runId=${runId}, tier=${tier}, ` +
      `candidates=${merged.length} (pack=${filteredPackCandidates.length}, llm=${gapFillOutput.llmCandidates.length}), ` +
      `irFiles=${irFiles.size}, filesFailed=${gapFillOutput.filesFailed}, ` +
      `degraded=${degraded}${degraded ? ` reasons=${degradedReasons.length}` : ''}, totalMs=${totalMs}`,
  );

  return {
    candidates: merged,
    // No evidence path in V3 — zero is the stable contract.
    evidenceCount: 0,
    filesAnalyzed: irFiles.size,
    // Spec 2026-05-30 Oracle Integrity & Determinism (Task Group 2): the real
    // per-file gap-fill failure count, replacing the historical hardcoded `0`.
    // Derived from `runLlmGapFill`'s `failures[]` (== failures.length). A
    // nonzero count is one of the degraded triggers above; the run still
    // COMPLETES (no new block).
    filesFailed: gapFillOutput.filesFailed,
    tier,
    gapFillOutput,
    findingInputs: collectedFindingInputs,
    degraded,
    degradedReasons,
  };
}
