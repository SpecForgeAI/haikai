import { v4 as uuidv4 } from 'uuid';
import { archModelClient } from './archModelClient';
import { getAnalyzerRegistry } from './analyzerRegistry';
import { getLinkerRuleRegistry } from './linkerRuleRegistry';
import { triageCandidates } from './triageEngine';
import { findingEmitter, type FindingEmitRunContext, type FindingEmitInput } from './findings/FindingEmitter';
import {
  buildUnresolvedDecisionTaskFinding,
  buildCandidateConflictFinding,
  buildAmbiguousRelationshipFinding,
} from './findings/emissionSources';

import { gatewayClient } from './gatewayClient';
import { executeLlmFileAnalysis, sortCandidatesParentsFirst, ServiceScopedAnalysisOptions } from './llmFileAnalysisStep';
import { buildTempDir, gitCloneRepoAccess, isGitRepoUrl, normalizeRepoLocation, normalizeRepoSubfolder } from './repoAccess';
import { scoreRun as scorePerformanceRun } from './performancePostRun';
import { runVulnerabilityEnrichment } from './vulnerabilityEnrichment/vulnerabilityEnrichmentService';
import { DISCOVERY_PERFORMANCE_AUTO_SCORE, DISCOVERY_VULN_ENRICH_AUTO } from '../config';
import { AnalyzerInput } from '../types';
import { DiscoveryCandidate } from '../types/candidate';
import { EvidenceAtom } from '../types/evidenceAtom';
import { EvidenceRelationship } from '../types/relationship';
import { CandidateRelationship } from '../types/linkerRule';
import { DiscoveryConfigPayload } from '../types/projectContext';
import {
  DecisionTask,
  DecisionTaskType,
  ConfirmRelationshipInput,
  ResolveCompetingInput,
  ConfirmRelationshipOutput,
  ResolveCompetingOutput,
} from '../types/decisionTask';
import { generateRelationshipId } from '../utils/evidenceId';
import { logRunEvent } from '../utils/runLogger';
import type { TechHints } from './extensionPacks/packTypes';
import { getLanguagePackById, getFrameworkPackById } from './extensionPackRegistry';
import { SERVICE_SCOPED_CANDIDATE_TYPES } from '../constants/candidateTypes';
import { bindRunArchitecture } from './runArchitectureRegistry';
import { buildRepoLookupTable } from './repoLookupTableBuilder';
import { planLibraryScan, ScanPlan, WalkerArchClient, WalkerLibraryPayload, WalkerLibraryResult, WalkerEdgePayload, WalkerRootEntity } from './transitiveDependencyWalker';
import { getOrClonePreflightRepo, getCachedPreflightDir } from './preflightCachedClone';
import { buildLibraryFindOrCreatePayload, buildCodeUnitDependencyFindOrCreatePayload } from './archModelClient';
import './dependencyResolvers/register';
import { mavenDependencyResolver } from './dependencyResolvers/maven/MavenDependencyResolver';
import { parsePomMetadataFromFile } from './dependencyResolvers/maven/mavenPomMetadataParser';
import { runMavenFindingScanner, type MavenPomScannerInput } from './findings/packFindingScanners';
import { resolveLibrarySource } from './librarySourceResolver';
import { createTracer } from '../trace';
import { emitCodeScanPredicates } from './scanPredicates';

// Haikai workflow trace (OFF unless HAIKAI_TRACE set). SUMMARY-only here:
// run started / scan COMPLETED, keyed on project+arch+run. See docs/trace-logging.md.
const trace = createTracer('discovery');

/**
 * Reconstructs `TechHints` (the indexed `{ language?, technology?, version? }`
 * shape that `matchesPredicate` evaluates) for the V3 pipeline's pack selector.
 *
 * Authority order (2026-04-27, ISS-### resolved):
 *   1. **Pack-id columns are the source of truth.** When the service's
 *      `core_tech_language_pack` and/or `core_tech_framework_packs` columns
 *      hold registered pack IDs, look those packs up and use their `when`
 *      clauses (`{ language: 'Java' }`, `{ language: 'Java', technology:
 *      'Spring' }`, …) directly. This guarantees the runtime pack selector
 *      matches what the tier gate already validated, eliminating the
 *      dual-source-of-truth bug where the LLM resolver wrote
 *      `frameworks[0].name = "Spring Framework"` while the spring-classic
 *      predicate wanted bare `"Spring"` — pack never fired, run degraded
 *      to 0% adapter.
 *   2. **Resolved-column free-text names are the fallback.** When pack IDs
 *      aren't set (e.g. the resolver ran tier-C without recommending packs)
 *      we still build hints from `core_tech_resolved.language.name` /
 *      `core_tech_resolved.frameworks[].name`, but we attempt to find a
 *      registered pack whose `when` clause matches and substitute its
 *      canonical predicate values when found — so a friendly
 *      `"Spring Framework"` still selects spring-classic.
 *   3. **Versions come from the resolved columns** in both cases — they
 *      aren't part of the predicate but we surface them for downstream
 *      analyzers that key off version (e.g. JPA vs. Hibernate-XML).
 *
 * Returns an empty `TechHints` record when neither pack IDs nor resolved
 * columns yield any hints — safe tier-C fall-through.
 */
function techHintsFromResolvedColumns(
  coreTechResolved: Record<string, unknown> | null | undefined,
  coreTechLanguagePack: string | null | undefined = null,
  coreTechFrameworkPacks: string[] | null | undefined = null,
): TechHints {
  const result: TechHints = {};
  let idx = 0;

  const langVer = (coreTechResolved?.language as { version?: string } | null | undefined)?.version;
  const fwsRaw = (coreTechResolved?.frameworks as Array<{ name?: string; version?: string }> | null | undefined) ?? [];

  // 1) Language: prefer the registered pack's predicate value when a pack ID
  //    is set on the service.
  let languageFromPack: string | null = null;
  if (typeof coreTechLanguagePack === 'string' && coreTechLanguagePack.length > 0) {
    const pack = getLanguagePackById(coreTechLanguagePack);
    if (pack) {
      languageFromPack = pack.when.language;
    } else {
      console.warn(
        `[techHintsFromResolvedColumns] core_tech_language_pack="${coreTechLanguagePack}" is not a registered pack id; falling back to core_tech_resolved.language.name.`,
      );
    }
  }
  const languageName =
    languageFromPack ??
    ((coreTechResolved?.language as { name?: string } | null | undefined)?.name || null);
  if (languageName && languageName.length > 0) {
    const hint: { language?: string; technology?: string; version?: string } = {
      language: languageName,
    };
    if (typeof langVer === 'string' && langVer.length > 0) hint.version = langVer;
    result[String(idx++)] = hint;
  }

  // 2) Frameworks: same pattern. Iterate the framework pack IDs first, then
  //    backfill from any resolved-column names that didn't map to a pack ID.
  const usedFwIndices = new Set<number>();
  if (Array.isArray(coreTechFrameworkPacks)) {
    for (const fwPackId of coreTechFrameworkPacks) {
      if (typeof fwPackId !== 'string' || fwPackId.length === 0) continue;
      const pack = getFrameworkPackById(fwPackId);
      if (!pack) {
        console.warn(
          `[techHintsFromResolvedColumns] core_tech_framework_packs entry "${fwPackId}" is not a registered pack id; skipping.`,
        );
        continue;
      }
      // Try to find a matching resolved framework so we can carry its
      // version through. Match heuristically: same case-insensitive name
      // OR substring relationship (LLM resolver may emit "Spring Framework"
      // while the predicate wants "Spring").
      const resolvedFw = fwsRaw.find((fw) => {
        if (!fw || typeof fw.name !== 'string') return false;
        const r = fw.name.toLowerCase();
        const p = pack.when.technology.toLowerCase();
        return r === p || r.includes(p) || p.includes(r);
      });
      if (resolvedFw) usedFwIndices.add(fwsRaw.indexOf(resolvedFw));
      const hint: { language?: string; technology?: string; version?: string } = {
        technology: pack.when.technology,
      };
      const ver = resolvedFw?.version;
      if (typeof ver === 'string' && ver.length > 0) hint.version = ver;
      result[String(idx++)] = hint;
    }
  }
  // Fallback: any resolved-column framework names not already covered by a
  // pack ID become free-text hints. These won't match a predicate exactly
  // unless the LLM happened to emit the predicate-compatible form, but
  // they preserve the prior behaviour for tier-C runs without pack IDs.
  for (let i = 0; i < fwsRaw.length; i++) {
    if (usedFwIndices.has(i)) continue;
    const fw = fwsRaw[i];
    if (!fw || typeof fw.name !== 'string' || fw.name.length === 0) continue;
    const hint: { language?: string; technology?: string; version?: string } = {
      technology: fw.name,
    };
    if (typeof fw.version === 'string' && fw.version.length > 0) hint.version = fw.version;
    result[String(idx++)] = hint;
  }

  return result;
}

/**
 * Run the Maven finding scanner over every `pom.xml` under `repoDir` and
 * persist the resulting findings via the standard `FindingEmitter`.
 *
 * Bug-fix 2026-05-28: the Maven scanner is imported at the top of this file
 * (via `findings/packFindingScanners`) but had no call site in production —
 * Java/Maven projects produced zero `risky_dependency_*` / `legacy_java_*`
 * /etc. Maven-pack findings. This helper closes that wiring gap and is
 * invoked from BOTH the project-scoped (1c) and service-scoped discovery
 * paths, immediately after candidates have been persisted and just before
 * the cloned-repo cleanup runs.
 *
 * Soft-fail per POM (`mavenDependencyResolver.resolve` / metadata parse) and
 * at the boundary itself — a Maven scan failure NEVER aborts the discovery
 * run. The emit path is also soft-fail at `findingEmitter.emitFindings`.
 *
 * `architectureId` is intentionally left empty here — the AMS client
 * resolves it server-side via the `runArchitectureRegistry`, matching every
 * other finding-emission site in this file.
 */
async function runMavenPackFindingsForRun(
  repoDir: string,
  runId: string,
  projectId: string,
): Promise<void> {
  const mavenStart = Date.now();
  try {
    const manifestPaths = await mavenDependencyResolver.findManifests(repoDir);
    if (manifestPaths.length === 0) {
      console.log(
        `[diag-pack] scanner=maven start files=0 (no pom.xml under repoDir)`,
      );
      return;
    }
    const poms: MavenPomScannerInput[] = [];
    for (const pomAbsPath of manifestPaths) {
      try {
        const deps = await mavenDependencyResolver.resolve(repoDir, pomAbsPath);
        const metadata = await parsePomMetadataFromFile(pomAbsPath);
        poms.push({
          pomPath: metadata.pomPath,
          dependencies: deps,
          metadata,
        });
      } catch (perPomErr) {
        console.warn(
          `[runMavenPackFindingsForRun] Per-POM failure for '${pomAbsPath}'; continuing:`,
          perPomErr instanceof Error ? perPomErr.message : String(perPomErr),
        );
      }
    }
    if (poms.length === 0) {
      console.log(`[diag-pack] scanner=maven no_resolvable_poms=true`);
      return;
    }
    const findingInputs = runMavenFindingScanner({ runId, poms });
    if (findingInputs.length === 0) return;
    const findingsRunContext: FindingEmitRunContext = {
      runId,
      projectId,
      architectureId: '', // resolved server-side via runArchitectureRegistry
    };
    await findingEmitter.emitFindings(findingsRunContext, findingInputs);
  } catch (err) {
    console.warn(
      `[runMavenPackFindingsForRun] Boundary swallowed error after ${Date.now() - mavenStart}ms; run continues:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Emit the discovery-pipeline findings AFTER candidates have been persisted.
 *
 * Bug-fix 2026-05-29: the V3 pipeline used to emit findings inline, BEFORE
 * `runManager` persisted the candidates they link to. AMS hard-rejects a
 * finding whose `discovery_candidate` link target does not yet exist (one bad
 * link rolls back the whole `@Transactional` bulk), and `FindingEmitter`
 * soft-fails -- so every candidate-linked finding was silently lost and the
 * Findings tab showed 0. The pipeline now RETURNS its `findingInputs` and we
 * emit them here, once the candidates exist, so the links validate.
 *
 * Soft-fail at the boundary (mirrors `runMavenPackFindingsForRun`). Returns a
 * small summary so the caller can surface emit success/failure into
 * `steps_payload` -- the prior silent soft-fail is exactly how this bug hid.
 * `failed = attempted > persisted` (some non-deduped findings were rejected).
 */
async function emitPipelineFindingsForRun(
  findingInputs: FindingEmitInput[] | undefined,
  runId: string,
  projectId: string,
): Promise<{ attempted: number; persisted: number; deduped: number; failed: boolean }> {
  if (!findingInputs || findingInputs.length === 0) {
    return { attempted: 0, persisted: 0, deduped: 0, failed: false };
  }
  const before = findingEmitter.getRunAggregate(runId);
  const emittedBefore = before?.totalEmitted ?? 0;
  const persistedBefore = before?.totalPersisted ?? 0;
  const dedupedBefore = before?.totalDeduped ?? 0;
  try {
    const findingsRunContext: FindingEmitRunContext = {
      runId,
      projectId,
      architectureId: '', // resolved server-side via runArchitectureRegistry
    };
    await findingEmitter.emitFindings(findingsRunContext, findingInputs);
  } catch (err) {
    // emitFindings is already soft-fail; this is belt-and-braces.
    console.warn(
      `[emitPipelineFindingsForRun] Boundary swallowed error; run continues:`,
      err instanceof Error ? err.message : String(err),
    );
  }
  const after = findingEmitter.getRunAggregate(runId);
  const attempted = (after?.totalEmitted ?? 0) - emittedBefore;
  const persisted = (after?.totalPersisted ?? 0) - persistedBefore;
  const deduped = (after?.totalDeduped ?? 0) - dedupedBefore;
  const failed = attempted > persisted;
  if (failed) {
    console.error(
      `[findings-emit] FAILED to persist pipeline findings for run ${runId}: ` +
        `attempted=${attempted} persisted=${persisted} deduped=${deduped}. ` +
        `Surfaced in steps_payload as findingsEmit.failed=true.`,
    );
  } else {
    console.log(
      `[findings-emit] run=${(runId || '').slice(0, 8)} attempted=${attempted} ` +
        `persisted=${persisted} deduped=${deduped}`,
    );
  }
  return { attempted, persisted, deduped, failed };
}

/**
 * Run Manager
 *
 * Owns the internal step sequencing for a discovery run.
 * Progresses through Phase 1 steps (1a, 1b, 1c-llm-analysis) sequentially,
 * updating run state in the architecture-model-service after each transition.
 *
 * Step 1a executes the Phase 1a universal extraction analyzer pack,
 * persisting evidence atoms via bulkSaveEvidence in batches.
 *
 * Step 1b executes the Phase 1b relationship inference:
 * fetches 1a atoms, runs all linker rules, triages candidates,
 * persists auto-accepted relationships, creates and resolves DecisionTasks,
 * and returns summary metadata.
 *
 * Step 1c-llm-analysis executes LLM-driven file-level architectural analysis:
 * fetches 1a atoms and 1b relationships, builds a scan plan of architecturally
 * interesting files, sends each file to the LLM for entity extraction, converts
 * LLM results to DiscoveryCandidates, persists evidence and candidates, and
 * runs the Extension Pack hook (no-op for v1).
 */

/**
 * Valid steps for the discovery pipeline.
 *
 * Steps 1a and 1b are preserved from the original pipeline.
 * Step 1c-llm-analysis replaces the former 1c (clustering) and 1d (candidate generation)
 * with LLM-driven file-level analysis that produces typed candidates directly.
 */
export const VALID_STEPS = ['1a', '1b', '1c-llm-analysis'] as const;

/**
 * Bulk save batch size for all discovery entity persistence HTTP calls.
 *
 * Used for evidence atoms (step 1a), relationships (step 1b), and
 * candidates (step 1c-llm-analysis). Value of 500 is appropriate for atoms
 * and relationships which have moderate payload sizes.
 */
export const BULK_SAVE_BATCH_SIZE = 500;

/**
 * Pagination threshold: if the total count of atoms or relationships exceeds
 * this value, paginated fetches are used instead of a single HTTP call.
 * NOTE: Set high because the backend does not currently support offset/limit
 * query params — paginated fetches return duplicate data. Use single-fetch
 * until backend pagination is implemented.
 */
export const PAGINATION_THRESHOLD = 500000;

/**
 * Page size for paginated atom/relationship fetches.
 * Each page fetches up to this many records via offset/limit query parameters.
 * Set to 2000 to balance between minimizing HTTP round-trips and keeping
 * individual response payloads manageable.
 */
export const PAGINATION_PAGE_SIZE = 2000;

/**
 * Executes a single pipeline step internally.
 *
 * For step '1a': runs the Phase 1a analyzer pack, persists evidence atoms
 * in batches, and returns atom count summary metadata.
 *
 * For step '1b': runs all linker rules, triages candidates, persists
 * auto-accepted relationships, creates/resolves DecisionTasks, returns summary.
 *
 * For step '1c-llm-analysis': runs LLM file-level analysis, produces typed
 * candidates, persists evidence and candidates, returns summary.
 *
 * @param step - The step identifier (1a, 1b, 1c-llm-analysis)
 * @param projectId - The project UUID
 * @param runId - The discovery run UUID
 * @returns Step result metadata for inclusion in stepsPayload
 */
async function executeStep(
  step: string,
  projectId: string,
  runId: string,
  options?: StartRunOptions
): Promise<Record<string, unknown>> {
  switch (step) {
    case '1a':
      return executeStep1a(projectId, runId);
    case '1b':
      return executeStep1b(projectId, runId);
    case '1c-llm-analysis':
      return executeStepLlmAnalysis(projectId, runId, options);
    default:
      throw new Error(`Unknown step: ${step}`);
  }
}

/**
 * Read-merge-write helper for `steps_payload` updates.
 *
 * Hotfix 2026-04-20: the V3 pipeline (`runDiscoveryV3`) writes its own
 * `steps_payload.v3.gapFill` sub-tree mid-step via `persistGapFillStagePayload`.
 * If the surrounding step-wrapper later writes `steps_payload: { ...local }`,
 * the wrapper's write replaces the entire jsonb column on the run row
 * and silently destroys whatever the V3 stage wrote. The fix is to fetch
 * the latest persisted `steps_payload` immediately before each post-V3
 * write, deep-merge our wrapper-owned step keys on top, and persist the
 * union. Top-level keys we did not touch (notably `v3`) survive.
 *
 * Merge semantics:
 *   - Top level: union of (DB) keys and (wrapper) keys.
 *   - For keys that appear in both: the wrapper value wins (the wrapper
 *     owns step-status records like `service-scoped-llm-analysis` and we
 *     want the freshest local view to land).
 *   - The merge is shallow at the top level: sub-objects (e.g. the
 *     entire `v3` tree) are taken whole. The V3 sub-tree is single-owner
 *     (only `persistGapFillStagePayload` writes it), so a shallow take
 *     is safe and avoids accidental partial overwrites.
 *
 * Failure mode: if the read fails, fall back to the wrapper-only payload
 * to keep the run progressing - better to lose the V3 sub-tree than to
 * abort the run mid-update.
 */
async function buildMergedStepsPayload(
  projectId: string,
  runId: string,
  localStepsPayload: Record<string, Record<string, unknown>>
): Promise<Record<string, unknown>> {
  let dbSteps: Record<string, unknown> = {};
  try {
    const latest = await archModelClient.getDiscoveryRun(projectId, runId);
    if (latest && latest.steps_payload) {
      dbSteps = latest.steps_payload as Record<string, unknown>;
    }
  } catch (err) {
    // Best-effort: fall through to wrapper-only payload.
    console.warn(
      `[RunManager] buildMergedStepsPayload: failed to re-read steps_payload for run ${runId} -- falling back to wrapper-only payload:`,
      err instanceof Error ? err.message : String(err)
    );
  }
  return { ...dbSteps, ...localStepsPayload };
}

/**
 * Executes the real Phase 1a extraction logic:
 * 1. Fetches the discovery run to get config_snapshot
 * 2. Builds AnalyzerInput and calls the Phase 1a analyzer pack
 * 3. Persists returned evidence atoms via bulkSaveEvidence in batches
 * 4. Returns atom count summary metadata
 *
 * @param projectId - The project UUID
 * @param runId - The discovery run UUID
 * @returns Atom count summary metadata
 */
async function executeStep1a(
  projectId: string,
  runId: string
): Promise<Record<string, unknown>> {
  console.log(`[RunManager:1a] Starting step 1a for run ${runId}, project ${projectId}`);
  const stepStart = Date.now();

  // Fetch the discovery run to get config_snapshot
  const fetchRunStart = Date.now();
  const discoveryRun = await archModelClient.getDiscoveryRun(projectId, runId);
  if (!discoveryRun) {
    throw new Error(`Discovery run ${runId} not found for project ${projectId}`);
  }
  console.log(`[RunManager:1a] Fetched discovery run in ${Date.now() - fetchRunStart}ms`);

  const configSnapshot = discoveryRun.config_snapshot as Record<string, unknown>;
  console.log(`[RunManager:1a] Config snapshot repos: ${JSON.stringify((configSnapshot as any).repos?.map((r: any) => r.url) || [])}`);

  // Build AnalyzerInput
  const analyzerInput: AnalyzerInput = {
    projectId,
    phase: 'phase1',
    step: '1a',
    context: {
      ...configSnapshot,
      runId,
    },
  };

  // Look up the Phase 1a analyzer pack from the registry
  const registry = getAnalyzerRegistry();
  const analyzerPack = registry.get('phase-1a-universal-extraction');
  if (!analyzerPack) {
    throw new Error('Phase 1a analyzer pack not found in registry');
  }

  // Execute the analyzer
  const analyzerStart = Date.now();
  console.log(`[RunManager:1a] Executing phase-1a-universal-extraction analyzer...`);
  const result = await analyzerPack.analyze(analyzerInput);
  const analyzerDuration = Date.now() - analyzerStart;
  console.log(`[RunManager:1a] Analyzer complete in ${analyzerDuration}ms (${Math.round(analyzerDuration / 1000)}s): ${result.evidenceAtoms?.length || 0} atoms produced`);

  // Persist evidence atoms in batches
  const atoms: EvidenceAtom[] = result.evidenceAtoms || [];
  if (atoms.length > 0) {
    const totalBatches = Math.ceil(atoms.length / BULK_SAVE_BATCH_SIZE);
    const persistStart = Date.now();
    console.log(`[RunManager:1a] Persisting ${atoms.length} atoms in ${totalBatches} batches of ${BULK_SAVE_BATCH_SIZE}...`);
    for (let i = 0; i < atoms.length; i += BULK_SAVE_BATCH_SIZE) {
      const batch = atoms.slice(i, i + BULK_SAVE_BATCH_SIZE);
      const batchNum = Math.floor(i / BULK_SAVE_BATCH_SIZE) + 1;
      const batchStart = Date.now();
      await archModelClient.bulkSaveEvidence(projectId, runId, batch);
      console.log(`[RunManager:1a] Batch ${batchNum}/${totalBatches} (${batch.length} atoms) persisted in ${Date.now() - batchStart}ms`);
    }
    console.log(`[RunManager:1a] All atoms persisted in ${Date.now() - persistStart}ms`);
  } else {
    console.log(`[RunManager:1a] No atoms to persist`);
  }

  // Return atom count summary from the analyzer result metadata
  const atomCounts = (result.metadata.atomCounts as Record<string, number>) || {
    file_structure: 0,
    symbol: 0,
    string_pattern: 0,
  };

  const totalDuration = Date.now() - stepStart;
  console.log(`[RunManager:1a] Step 1a complete in ${totalDuration}ms (${Math.round(totalDuration / 1000)}s). Atom counts: ${JSON.stringify(atomCounts)}`);

  return { atomCounts };
}

/**
 * Executes the real Phase 1b relationship inference logic:
 *
 * 1. Fetch 1a atoms via archModelClient.getEvidenceByRun
 * 2. Run all registered linker rules, collecting CandidateRelationship[]
 * 3. Triage candidates into accepted/ambiguous/discarded buckets
 * 4. Persist auto-accepted relationships in BULK_SAVE_BATCH_SIZE batches
 * 5. Create DecisionTask objects for ambiguous/competing candidates, persist them
 * 6. Call gateway to resolve pending DecisionTasks via LLM
 * 7. Process resolution results -- persist confirmed, skip rejected/failed
 * 8. Update DecisionTask records with resolved status, outputData, resolvedAt
 * 9. Return summary metadata
 *
 * @param projectId - The project UUID
 * @param runId - The discovery run UUID
 * @returns Summary metadata with relationship counts, decision task counts, etc.
 */
export async function executeStep1b(
  projectId: string,
  runId: string
): Promise<Record<string, unknown>> {
  console.log(`[RunManager:1b] Starting step 1b for run ${runId}, project ${projectId}`);
  const stepStart = Date.now();

  // -------------------------------------------------------------------------
  // Step 1: Fetch 1a atoms (paginated if count exceeds threshold)
  // -------------------------------------------------------------------------
  const fetchAtomsStart = Date.now();
  const atomCount = await archModelClient.getEvidenceCount(projectId, runId);
  console.log(`[RunManager:1b] Evidence count from backend: ${atomCount} (pagination threshold: ${PAGINATION_THRESHOLD})`);
  let atoms: EvidenceAtom[];
  if (atomCount > PAGINATION_THRESHOLD) {
    console.log(`[RunManager:1b] Using paginated fetch (${PAGINATION_PAGE_SIZE} per page)...`);
    atoms = await archModelClient.getEvidenceByRunPaginated(
      projectId, runId, atomCount, PAGINATION_PAGE_SIZE
    );
  } else {
    console.log(`[RunManager:1b] Using single fetch...`);
    atoms = await archModelClient.getEvidenceByRun(projectId, runId);
  }
  const upstreamAtomCount = atoms.length;
  console.log(`[RunManager:1b] Fetched ${upstreamAtomCount} atoms in ${Date.now() - fetchAtomsStart}ms`);

  // -------------------------------------------------------------------------
  // Step 2: Run all registered linker rules
  // Each rule receives the full in-memory atom array and operates locally --
  // no per-rule HTTP fetches. This eliminates N+1 query patterns.
  // -------------------------------------------------------------------------
  const linkerStart = Date.now();
  const ruleRegistry = getLinkerRuleRegistry();
  const allCandidates: CandidateRelationship[] = [];
  console.log(`[RunManager:1b] Running ${ruleRegistry.size} linker rules against ${atoms.length} atoms...`);

  for (const rule of ruleRegistry.values()) {
    const ruleStart = Date.now();
    const candidates = rule.match(atoms);
    allCandidates.push(...candidates);
    console.log(`[RunManager:1b]   Rule '${rule.id}': ${candidates.length} candidates in ${Date.now() - ruleStart}ms`);
  }
  console.log(`[RunManager:1b] All linker rules complete in ${Date.now() - linkerStart}ms: ${allCandidates.length} total candidates`);

  // -------------------------------------------------------------------------
  // Step 3: Triage candidates
  // -------------------------------------------------------------------------
  const triageStart = Date.now();
  const triageResult = triageCandidates(allCandidates);
  console.log(`[RunManager:1b] Triage complete in ${Date.now() - triageStart}ms: ${triageResult.accepted.length} accepted, ${triageResult.ambiguous.length} ambiguous, ${triageResult.discarded.length} discarded, ${triageResult.competingGroups.size} competing groups`);

  // -------------------------------------------------------------------------
  // Step 4: Persist auto-accepted relationships in batches
  // -------------------------------------------------------------------------
  const autoAcceptedRelationships: EvidenceRelationship[] = triageResult.accepted.map(
    (candidate) => candidateToRelationship(candidate, runId)
  );

  let autoAcceptedCount = 0;
  if (autoAcceptedRelationships.length > 0) {
    const persistRelStart = Date.now();
    const totalBatches = Math.ceil(autoAcceptedRelationships.length / BULK_SAVE_BATCH_SIZE);
    console.log(`[RunManager:1b] Persisting ${autoAcceptedRelationships.length} auto-accepted relationships in ${totalBatches} batches...`);
    for (let i = 0; i < autoAcceptedRelationships.length; i += BULK_SAVE_BATCH_SIZE) {
      const batch = autoAcceptedRelationships.slice(i, i + BULK_SAVE_BATCH_SIZE);
      await archModelClient.bulkSaveRelationships(projectId, runId, batch);
    }
    autoAcceptedCount = autoAcceptedRelationships.length;
    console.log(`[RunManager:1b] Auto-accepted relationships persisted in ${Date.now() - persistRelStart}ms`);
  } else {
    console.log(`[RunManager:1b] No auto-accepted relationships to persist`);
  }

  // -------------------------------------------------------------------------
  // Step 5: Create DecisionTasks for ambiguous candidates and competing groups
  // -------------------------------------------------------------------------
  // Build a lookup map from atom ID to full atom data for DecisionTask input
  const atomMap = new Map<string, EvidenceAtom>();
  for (const atom of atoms) {
    atomMap.set(atom.id, atom);
  }

  const pendingTasks: DecisionTask[] = [];

  // Collect the set of candidate IDs that are part of competing groups
  // (they should NOT get individual confirm tasks)
  const competingCandidateIds = new Set<string>();
  for (const group of triageResult.competingGroups.values()) {
    for (const candidate of group) {
      competingCandidateIds.add(`${candidate.sourceAtomId}::${candidate.targetAtomId}::${candidate.ruleId}`);
    }
  }

  // Create resolve_competing_relationships tasks for competing groups
  for (const group of triageResult.competingGroups.values()) {
    const sourceAtom = atomMap.get(group[0].sourceAtomId);
    if (!sourceAtom) continue;

    const inputData: ResolveCompetingInput = {
      sourceAtom,
      competitors: group.map((candidate) => ({
        targetAtom: atomMap.get(candidate.targetAtomId) || ({} as EvidenceAtom),
        relationshipType: candidate.relationshipType,
        confidence: candidate.confidence,
        ruleId: candidate.ruleId,
      })),
    };

    const task: DecisionTask = {
      id: uuidv4(),
      runId,
      taskType: 'resolve_competing_relationships' as DecisionTaskType,
      status: 'pending',
      inputData,
      outputData: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };

    pendingTasks.push(task);
  }

  // Create confirm_relationship tasks for non-competing ambiguous candidates
  for (const candidate of triageResult.ambiguous) {
    const candidateKey = `${candidate.sourceAtomId}::${candidate.targetAtomId}::${candidate.ruleId}`;
    if (competingCandidateIds.has(candidateKey)) {
      continue; // Skip -- already part of a competing group
    }

    const sourceAtom = atomMap.get(candidate.sourceAtomId);
    const targetAtom = atomMap.get(candidate.targetAtomId);
    if (!sourceAtom || !targetAtom) continue;

    const inputData: ConfirmRelationshipInput = {
      sourceAtom,
      targetAtom,
      proposedRelationshipType: candidate.relationshipType,
      confidence: candidate.confidence,
      ruleId: candidate.ruleId,
    };

    const task: DecisionTask = {
      id: uuidv4(),
      runId,
      taskType: 'confirm_relationship' as DecisionTaskType,
      status: 'pending',
      inputData,
      outputData: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };

    pendingTasks.push(task);
  }

  const decisionTaskCount = pendingTasks.length;
  console.log(`[RunManager:1b] Created ${decisionTaskCount} decision tasks (confirm: ${pendingTasks.filter(t => t.taskType === 'confirm_relationship').length}, competing: ${pendingTasks.filter(t => t.taskType === 'resolve_competing_relationships').length})`);

  // =========================================================================
  // Discovery Findings emission (Spec 2026-05-16 -- Task Group 5)
  // -------------------------------------------------------------------------
  // Three v1 sources fire here, alongside DecisionTask creation:
  //   - Source B: unresolved_decision_task -- one finding per pending
  //               DecisionTask (both confirm + competing variants).
  //   - Source C (triage site): candidate_conflict -- one finding per
  //               competing-relationships group (D3 -- in v1).
  //   - Source F: ambiguous_relationship -- one finding per ambiguous
  //               candidate (single + each competing-group member).
  //
  // architectureId is resolved server-side by archModelClient via the
  // runArchitectureRegistry, so the emitter context just carries a marker.
  // Emission is soft-fail at the FindingEmitter boundary; this block
  // CANNOT abort the run.
  // =========================================================================
  try {
    const findingsRunContext: FindingEmitRunContext = {
      runId,
      projectId,
      architectureId: '', // resolved server-side via runArchitectureRegistry
    };
    const findingInputs = [];

    // Source B: unresolved decision task. One finding per pending task.
    for (const task of pendingTasks) {
      const inputData = task.inputData as unknown as Record<string, unknown> | undefined;
      // Pull the related source/target atom ids from the task input so the
      // finding's links include the relevant evidence. The atom ids are
      // also the discovery_evidence row ids in AMS, so link target_type
      // 'discovery_evidence' is correct here.
      const relatedEvidenceIds: string[] = [];
      const sourceAtomId =
        (inputData?.sourceAtom as { id?: string } | undefined)?.id;
      if (typeof sourceAtomId === 'string' && sourceAtomId.length > 0) {
        relatedEvidenceIds.push(sourceAtomId);
      }
      const targetAtomId =
        (inputData?.targetAtom as { id?: string } | undefined)?.id;
      if (typeof targetAtomId === 'string' && targetAtomId.length > 0) {
        relatedEvidenceIds.push(targetAtomId);
      }
      findingInputs.push(
        buildUnresolvedDecisionTaskFinding({
          decisionTaskId: task.id,
          taskType: task.taskType,
          relatedEvidenceIds,
        }),
      );
    }

    // Source C (triage): one candidate_conflict per competing-relationships
    // group. Source F: one ambiguous_relationship per individual ambiguous
    // candidate (including each member of a competing group).
    for (const group of triageResult.competingGroups.values()) {
      const targetCandidateIds = group
        .map((c) => c.targetAtomId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      const ruleIds = Array.from(new Set(group.map((c) => c.ruleId))).join('+');
      findingInputs.push(
        buildCandidateConflictFinding({
          conflictingCandidateIds: targetCandidateIds,
          conflictDescription:
            `Competing relationships at source atom '${group[0].sourceAtomId}': ` +
            `${group.length} candidate relationships (rules: ${ruleIds}) compete for the same anchor.`,
          stage: 'triageEngine.competingRelationships',
          title: `Competing relationships: ${group.length} candidates at ${group[0].sourceAtomId}`,
        }),
      );
      // Per-member ambiguous_relationship findings (Source F).
      for (const candidate of group) {
        findingInputs.push(
          buildAmbiguousRelationshipFinding({
            relationshipDescription:
              `${candidate.relationshipType} from ${candidate.sourceAtomId} to ${candidate.targetAtomId}`,
            confidence: candidate.confidence,
            competingTargetCandidateIds: targetCandidateIds,
            sourceEvidenceId: candidate.sourceAtomId,
            ruleId: candidate.ruleId,
          }),
        );
      }
    }

    if (findingInputs.length > 0) {
      await findingEmitter.emitFindings(findingsRunContext, findingInputs);
    }
  } catch (err) {
    // Belt-and-braces: emitFindings is already soft-fail, but a synchronous
    // error in a builder must NOT abort the run.
    console.warn(
      `[RunManager:1b:Findings] Emission boundary swallowed error:`,
      err instanceof Error ? err.message : String(err),
    );
  }


  // Persist DecisionTasks if any were created
  if (pendingTasks.length > 0) {
    const persistTasksStart = Date.now();
    await archModelClient.bulkSaveDecisionTasks(projectId, runId, pendingTasks);
    console.log(`[RunManager:1b] Decision tasks persisted in ${Date.now() - persistTasksStart}ms`);
  }

  // -------------------------------------------------------------------------
  // Step 6: Resolve DecisionTasks via gateway LLM
  // -------------------------------------------------------------------------
  let decisionTaskResolvedCount = 0;
  let decisionTaskFailedCount = 0;
  let llmConfirmedRelationshipCount = 0;

  if (pendingTasks.length > 0) {
    const resolveStart = Date.now();
    console.log(`[RunManager:1b] Sending ${pendingTasks.length} decision tasks to gateway for LLM resolution...`);
    const resolutionResponse = await gatewayClient.resolveDecisionTasks(
      projectId,
      runId,
      pendingTasks
    );
    console.log(`[RunManager:1b] Gateway resolution complete in ${Date.now() - resolveStart}ms (${Math.round((Date.now() - resolveStart) / 1000)}s): ${resolutionResponse.results.length} results`);

    // Build a lookup from task ID to the task and its candidates
    const taskMap = new Map<string, DecisionTask>();
    for (const task of pendingTasks) {
      taskMap.set(task.id, task);
    }

    // -----------------------------------------------------------------------
    // Step 7: Process resolution results
    // -----------------------------------------------------------------------
    const llmConfirmedRelationships: EvidenceRelationship[] = [];

    for (const result of resolutionResponse.results) {
      const task = taskMap.get(result.taskId);
      if (!task) continue;

      if (result.status === 'resolved' && result.outputData) {
        decisionTaskResolvedCount++;

        if (task.taskType === 'confirm_relationship') {
          const output = result.outputData as ConfirmRelationshipOutput;
          if (output.decision === 'confirm') {
            const input = task.inputData as ConfirmRelationshipInput;
            const relationship: EvidenceRelationship = {
              id: generateRelationshipId(runId, input.sourceAtom.id, input.targetAtom.id, input.proposedRelationshipType),
              runId,
              sourceAtomId: input.sourceAtom.id,
              targetAtomId: input.targetAtom.id,
              relationshipType: input.proposedRelationshipType,
              confidence: output.adjustedConfidence,
              data: findCandidateData(allCandidates, input.sourceAtom.id, input.targetAtom.id, input.ruleId),
              inferredAt: new Date().toISOString(),
            };
            llmConfirmedRelationships.push(relationship);
          }
          // If decision === 'reject', skip -- do not persist a relationship
        } else if (task.taskType === 'resolve_competing_relationships') {
          const output = result.outputData as ResolveCompetingOutput;
          if (output.selectedIndex !== null && output.selectedIndex !== undefined) {
            const input = task.inputData as ResolveCompetingInput;
            const selected = input.competitors[output.selectedIndex];
            if (selected) {
              const relationship: EvidenceRelationship = {
                id: generateRelationshipId(runId, input.sourceAtom.id, selected.targetAtom.id, selected.relationshipType),
                runId,
                sourceAtomId: input.sourceAtom.id,
                targetAtomId: selected.targetAtom.id,
                relationshipType: selected.relationshipType,
                confidence: output.adjustedConfidence,
                data: findCandidateData(allCandidates, input.sourceAtom.id, selected.targetAtom.id, selected.ruleId),
                inferredAt: new Date().toISOString(),
              };
              llmConfirmedRelationships.push(relationship);
            }
          }
          // If selectedIndex === null, skip -- none selected
        }
      } else {
        // status === 'failed'
        decisionTaskFailedCount++;
      }

      // -------------------------------------------------------------------
      // Step 8: Update each DecisionTask record
      // -------------------------------------------------------------------
      await archModelClient.updateDecisionTask(projectId, runId, result.taskId, {
        status: result.status,
        outputData: result.outputData || undefined,
        resolvedAt: new Date().toISOString(),
      } as Partial<DecisionTask>);
    }

    // Persist LLM-confirmed relationships in batches
    if (llmConfirmedRelationships.length > 0) {
      const persistLlmRelStart = Date.now();
      console.log(`[RunManager:1b] Persisting ${llmConfirmedRelationships.length} LLM-confirmed relationships...`);
      for (let i = 0; i < llmConfirmedRelationships.length; i += BULK_SAVE_BATCH_SIZE) {
        const batch = llmConfirmedRelationships.slice(i, i + BULK_SAVE_BATCH_SIZE);
        await archModelClient.bulkSaveRelationships(projectId, runId, batch);
      }
      llmConfirmedRelationshipCount = llmConfirmedRelationships.length;
      console.log(`[RunManager:1b] LLM-confirmed relationships persisted in ${Date.now() - persistLlmRelStart}ms`);
    }

    console.log(`[RunManager:1b] Decision task resolution summary: ${decisionTaskResolvedCount} resolved, ${decisionTaskFailedCount} failed, ${llmConfirmedRelationshipCount} relationships confirmed by LLM`);
  }

  // -------------------------------------------------------------------------
  // Step 9: Return summary metadata
  // -------------------------------------------------------------------------
  const relationshipCount = autoAcceptedCount + llmConfirmedRelationshipCount;
  const discardedCount = triageResult.discarded.length;

  const totalDuration = Date.now() - stepStart;
  console.log(`[RunManager:1b] Step 1b complete in ${totalDuration}ms (${Math.round(totalDuration / 1000)}s). Relationships: ${relationshipCount} (${autoAcceptedCount} auto + ${llmConfirmedRelationshipCount} LLM), discarded: ${discardedCount}, tasks: ${decisionTaskCount} (${decisionTaskResolvedCount} resolved, ${decisionTaskFailedCount} failed)`);

  return {
    relationshipCount,
    autoAcceptedCount,
    decisionTaskCount,
    decisionTaskResolvedCount,
    decisionTaskFailedCount,
    discardedCount,
    upstreamAtomCount,
  };
}

/**
 * Finds the original candidate's RelationshipData for a given source/target/rule combination.
 * Used when creating an EvidenceRelationship from a resolved DecisionTask.
 */
function findCandidateData(
  candidates: CandidateRelationship[],
  sourceAtomId: string,
  targetAtomId: string,
  ruleId: string
): EvidenceRelationship['data'] {
  const match = candidates.find(
    (c) => c.sourceAtomId === sourceAtomId && c.targetAtomId === targetAtomId && c.ruleId === ruleId
  );
  if (match) {
    return match.data;
  }
  // Fallback: return a generic references data shape
  return { referenceContext: 'resolved via DecisionTask', line: 0 };
}

/**
 * Converts an auto-accepted CandidateRelationship to a persistable EvidenceRelationship.
 */
function candidateToRelationship(
  candidate: CandidateRelationship,
  runId: string
): EvidenceRelationship {
  return {
    id: generateRelationshipId(runId, candidate.sourceAtomId, candidate.targetAtomId, candidate.relationshipType),
    runId,
    sourceAtomId: candidate.sourceAtomId,
    targetAtomId: candidate.targetAtomId,
    relationshipType: candidate.relationshipType,
    confidence: candidate.confidence,
    data: candidate.data,
    inferredAt: new Date().toISOString(),
  };
}

/**
 * Executes the LLM file-level analysis step (replaces former 1c clustering and 1d candidate generation):
 *
 * 1. Fetch the discovery run to get config_snapshot (for repo info)
 * 2. Fetch 1a atoms via archModelClient.getEvidenceByRun
 * 3. Fetch 1b relationships via archModelClient.getRelationshipsByRun
 * 4. Clone the repository to a temp directory
 * 5. Call executeLlmFileAnalysis() with atoms, relationships, config, and repoDir
 * 6. Persist returned candidates via bulkSaveCandidates in batches
 * 7. Cleanup the cloned repo
 * 8. Return summary metadata (filesAnalyzed, filesFailed, candidateCount, evidenceCount)
 *
 * @param projectId - The project UUID
 * @param runId - The discovery run UUID
 * @returns Summary metadata with file analysis and candidate counts
 */
export async function executeStepLlmAnalysis(
  projectId: string,
  runId: string,
  options?: StartRunOptions
): Promise<Record<string, unknown>> {
  console.log(`[RunManager:1c] Starting step 1c-llm-analysis for run ${runId}, project ${projectId}`);
  const stepStart = Date.now();

  // -------------------------------------------------------------------------
  // Step 1: Fetch the discovery run to get config_snapshot
  // -------------------------------------------------------------------------
  const fetchRunStart = Date.now();
  const discoveryRun = await archModelClient.getDiscoveryRun(projectId, runId);
  if (!discoveryRun) {
    throw new Error(`Discovery run ${runId} not found for project ${projectId}`);
  }
  console.log(`[RunManager:1c] Fetched discovery run in ${Date.now() - fetchRunStart}ms`);

  const configSnapshot = discoveryRun.config_snapshot as DiscoveryConfigPayload;
  const repos = configSnapshot.repos || [];

  if (repos.length === 0) {
    console.warn(`[RunManager:1c] No repos configured for run ${runId}, skipping LLM file analysis`);
    return {
      filesAnalyzed: 0,
      filesFailed: 0,
      candidateCount: 0,
      evidenceCount: 0,
    };
  }

  console.log(`[RunManager:1c] Repos: ${repos.map(r => `${r.url} (branch: ${r.branch || 'main'})`).join(', ')}`);

  // -------------------------------------------------------------------------
  // Step 2: Fetch 1a atoms (paginated if count exceeds threshold)
  // -------------------------------------------------------------------------
  const fetchAtomsStart = Date.now();
  const atomCount = await archModelClient.getEvidenceCount(projectId, runId);
  console.log(`[RunManager:1c] Evidence count: ${atomCount} (pagination threshold: ${PAGINATION_THRESHOLD})`);
  let atoms: EvidenceAtom[];
  if (atomCount > PAGINATION_THRESHOLD) {
    console.log(`[RunManager:1c] Using paginated atom fetch...`);
    atoms = await archModelClient.getEvidenceByRunPaginated(
      projectId, runId, atomCount, PAGINATION_PAGE_SIZE
    );
  } else {
    atoms = await archModelClient.getEvidenceByRun(projectId, runId);
  }
  console.log(`[RunManager:1c] Fetched ${atoms.length} atoms in ${Date.now() - fetchAtomsStart}ms`);

  // -------------------------------------------------------------------------
  // Step 3: Fetch 1b relationships (paginated if count exceeds threshold)
  // -------------------------------------------------------------------------
  const fetchRelsStart = Date.now();
  const relCount = await archModelClient.getRelationshipCount(projectId, runId);
  console.log(`[RunManager:1c] Relationship count: ${relCount} (pagination threshold: ${PAGINATION_THRESHOLD})`);
  let relationships: EvidenceRelationship[];
  if (relCount > PAGINATION_THRESHOLD) {
    console.log(`[RunManager:1c] Using paginated relationship fetch...`);
    relationships = await archModelClient.getRelationshipsByRunPaginated(
      projectId, runId, relCount, PAGINATION_PAGE_SIZE
    );
  } else {
    relationships = await archModelClient.getRelationshipsByRun(projectId, runId);
  }
  console.log(`[RunManager:1c] Fetched ${relationships.length} relationships in ${Date.now() - fetchRelsStart}ms`);

  // -------------------------------------------------------------------------
  // Step 4: Clone the repository to a temp directory
  // For v1, process only the first configured repo
  // -------------------------------------------------------------------------
  const repoUrl = repos[0].url;
  const branch = repos[0].branch || 'main';
  const repoDir = buildTempDir(runId, repoUrl);

  const cloneStart = Date.now();
  console.log(`[RunManager:1c] Cloning repo ${repoUrl} (branch: ${branch}) to ${repoDir}...`);
  try {
    await gitCloneRepoAccess.cloneRepo(repoUrl, branch, repoDir);
    console.log(`[RunManager:1c] Clone complete in ${Date.now() - cloneStart}ms`);
  } catch (cloneError) {
    const msg = cloneError instanceof Error ? cloneError.message : String(cloneError);
    console.error(`[RunManager:1c] Clone FAILED after ${Date.now() - cloneStart}ms: ${msg}`);
    throw new Error(`Failed to clone repo ${repoUrl}: ${msg}`);
  }

  let allCandidates: DiscoveryCandidate[] = [];
  let findingsEmit: { attempted: number; persisted: number; deduped: number; failed: boolean } =
    { attempted: 0, persisted: 0, deduped: 0, failed: false };
  let filesAnalyzed = 0;
  let filesFailed = 0;
  let evidenceCount = 0;
  // Spec 2026-05-30 Oracle Integrity & Determinism (Task Group 2): advisory
  // run-level degraded signal carried up from the V3 pipeline result.
  let runDegraded = false;
  let runDegradedReasons: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // Step 5: Call executeLlmFileAnalysis() with atoms, relationships, config, repoDir
    // -------------------------------------------------------------------------
    const llmStart = Date.now();
    console.log(`[RunManager:1c] Calling executeLlmFileAnalysis with ${atoms.length} atoms, ${relationships.length} relationships...`);
    const stepResult = await executeLlmFileAnalysis(
      runId,
      projectId,
      atoms,
      relationships,
      configSnapshot,
      repoDir,
      undefined,
      options?.tier
    );
    const llmDuration = Date.now() - llmStart;
    console.log(`[RunManager:1c] executeLlmFileAnalysis returned in ${llmDuration}ms (${Math.round(llmDuration / 1000)}s): ${stepResult.filesAnalyzed} analyzed, ${stepResult.filesFailed} failed, ${stepResult.candidates.length} candidates, ${stepResult.evidenceCount} evidence`);

    allCandidates = stepResult.candidates;
    filesAnalyzed = stepResult.filesAnalyzed;
    filesFailed = stepResult.filesFailed;
    evidenceCount = stepResult.evidenceCount;
    // Spec 2026-05-30 Oracle Integrity & Determinism (Task Group 2): carry the
    // advisory run-level `degraded` signal (+ reasons) computed by the V3
    // pipeline up to the executeStep summary so it lands in
    // `stepsPayload[step]` (via the `...stepResult` spread) AND is persisted on
    // the run record at the COMPLETED branches. Rides ALONGSIDE COMPLETED --
    // never a block, never a status change.
    if (typeof stepResult.degraded === 'boolean') {
      runDegraded = stepResult.degraded;
    }
    if (Array.isArray(stepResult.degradedReasons)) {
      runDegradedReasons = stepResult.degradedReasons as string[];
    }

    // -------------------------------------------------------------------------
    // Step 6: Persist returned candidates via bulkSaveCandidates in batches
    // -------------------------------------------------------------------------
    if (allCandidates.length > 0) {
      // Sort candidates so parents always precede children. Required because
      // the DB FK constraint on parent_candidate_id is checked per-INSERT.
      const sortedCandidates = sortCandidatesParentsFirst(allCandidates);
      const persistStart = Date.now();
      // Use smaller batch size for candidates (100) to avoid large payloads
      // and transaction pressure with JSONB data fields.
      const candidateBatchSize = 100;
      const totalBatches = Math.ceil(sortedCandidates.length / candidateBatchSize);
      console.log(`[RunManager:1c] Persisting ${sortedCandidates.length} candidates in ${totalBatches} batches of ${candidateBatchSize} (sorted parents-first)...`);
      for (let i = 0; i < sortedCandidates.length; i += candidateBatchSize) {
        const batch = sortedCandidates.slice(i, i + candidateBatchSize);
        const batchNum = Math.floor(i / candidateBatchSize) + 1;
        const batchStart = Date.now();
        const payloadSize = JSON.stringify(batch).length;
        console.log(`[RunManager:1c] Sending candidate batch ${batchNum}/${totalBatches}: ${batch.length} candidates, ~${Math.round(payloadSize / 1024)}KB payload`);
        try {
          await archModelClient.bulkSaveCandidates(projectId, runId, batch);
          console.log(`[RunManager:1c] Candidate batch ${batchNum}/${totalBatches} (${batch.length}) persisted in ${Date.now() - batchStart}ms`);
        } catch (batchError: unknown) {
          const axiosErr = batchError as { response?: { status?: number; data?: unknown }; message?: string };
          const respBody = axiosErr.response?.data
            ? JSON.stringify(axiosErr.response.data).substring(0, 1000)
            : 'no response body';
          console.error(`[RunManager:1c] Candidate batch ${batchNum} FAILED (${Date.now() - batchStart}ms): status=${axiosErr.response?.status}, body=${respBody}, message=${axiosErr.message}`);
          throw batchError;
        }
      }
      console.log(`[RunManager:1c] All candidates persisted in ${Date.now() - persistStart}ms`);
    } else {
      console.log(`[RunManager:1c] No candidates to persist`);
    }

    // -------------------------------------------------------------------------
    // Step 6.4: Emit the V3 pipeline's findings NOW -- AFTER candidates are
    // persisted (above) so their discovery_candidate links validate at AMS.
    // Bug-fix 2026-05-29: the previous inline pre-persist emit silently lost
    // every candidate-linked finding. Soft-fail; outcome surfaced via
    // findingsEmit in the returned step payload.
    // -------------------------------------------------------------------------
    findingsEmit = await emitPipelineFindingsForRun(stepResult.findingInputs, runId, projectId);

    // -------------------------------------------------------------------------
    // Step 6.5: Maven pack-finding scanner (bug-fix 2026-05-28).
    // Walks every pom.xml under repoDir, runs the Maven finding rules,
    // persists findings via the standard FindingEmitter. Soft-fail at the
    // boundary — never aborts the run.
    // -------------------------------------------------------------------------
    await runMavenPackFindingsForRun(repoDir, runId, projectId);
  } finally {
    // -------------------------------------------------------------------------
    // Step 7: Cleanup the cloned repo (always, even on failure)
    // -------------------------------------------------------------------------
    const cleanupStart = Date.now();
    try {
      await gitCloneRepoAccess.cleanup(repoDir);
      console.log(`[RunManager:1c] Repo cleanup complete in ${Date.now() - cleanupStart}ms`);
    } catch (cleanupError) {
      console.warn(
        `[RunManager:1c] Failed to clean up temp directory ${repoDir} after ${Date.now() - cleanupStart}ms:`,
        cleanupError
      );
    }
  }

  // -------------------------------------------------------------------------
  // Step 8: Return summary metadata
  // -------------------------------------------------------------------------
  const candidateCount = allCandidates.length;

  // Build candidatesByType breakdown
  const candidatesByType: Record<string, number> = {};
  for (const candidate of allCandidates) {
    const t = candidate.candidateType;
    candidatesByType[t] = (candidatesByType[t] || 0) + 1;
  }

  // SCAN-stage predicate emission (predicate run-judging batch) — pure
  // counting over the in-memory candidate set; never affects the run.
  emitCodeScanPredicates(allCandidates, findingsEmit, { run: runId, project: projectId });

  const totalDuration = Date.now() - stepStart;
  console.log(`[RunManager:1c] Step 1c-llm-analysis complete in ${totalDuration}ms (${Math.round(totalDuration / 1000)}s). Files: ${filesAnalyzed} analyzed, ${filesFailed} failed. Candidates: ${candidateCount}. Evidence: ${evidenceCount}. Types: ${JSON.stringify(candidatesByType)}`);

  return {
    filesAnalyzed,
    filesFailed,
    candidateCount,
    evidenceCount,
    candidatesByType,
    findingsEmit,
    // Spec 2026-05-30 Oracle Integrity & Determinism (Task Group 2): surface the
    // advisory degraded signal on the step summary so the COMPLETED branches can
    // read it off `stepsPayload[step]` and persist it on the run record.
    degraded: runDegraded,
    degradedReasons: runDegradedReasons,
  };
}

/**
 * Valid run status transitions for the discovery run state machine.
 *
 * The allowed transitions are:
 * - PENDING -> RUNNING   (when the first step begins)
 * - RUNNING -> RUNNING   (when advancing to the next step within the run)
 * - RUNNING -> COMPLETED (when the final step finishes successfully)
 * - RUNNING -> FAILED    (when any step throws an error)
 * - FAILED  -> RUNNING   (when resuming a failed run from a specific step)
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['RUNNING'],
  RUNNING: ['RUNNING', 'COMPLETED', 'FAILED'],
  FAILED: ['RUNNING'],
};

/**
 * Validates that a run status transition is allowed by the state machine.
 *
 * @param currentStatus - The current run status
 * @param newStatus - The proposed new run status
 * @throws Error if the transition is not allowed
 */
export function validateStatusTransition(currentStatus: string, newStatus: string): void {
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(
      `Invalid run status transition: ${currentStatus} -> ${newStatus}. ` +
      `Allowed transitions from ${currentStatus}: ${allowed ? allowed.join(', ') : 'none'}`
    );
  }
}

/**
 * Extract the advisory run-level `degraded` signal from the accumulated
 * `stepsPayload` so it can be persisted on the run record ALONGSIDE the
 * COMPLETED write.
 *
 * Spec: 2026-05-30 Oracle Integrity & Determinism, Task Group 2.
 *
 * The V3 pipeline computes `degraded` + `degradedReasons` and `executeStep`
 * folds them into its per-step summary, which `startRun` / `resumeRun` spread
 * into `stepsPayload[step]`. This reads them back across every step (the first
 * step that reports `degraded: true` wins for the flag; reasons are the union
 * across steps, order-preserving + de-duplicated). Returns
 * `{ degraded: undefined, degradedReasons: undefined }` when NO step reported a
 * signal -- callers pass those straight to `updateDiscoveryRun`, where the
 * AMS-side boxed-Boolean null-guard leaves any existing value unchanged
 * (non-clobber). NEVER throws -- a malformed payload yields the all-undefined
 * result so the COMPLETED write is never blocked.
 *
 * IMPORTANT: this does NOT touch `validateStatusTransition` or the transition
 * map. `degraded` rides ON TOP of COMPLETED; the state machine is untouched.
 */
function extractDegradedFromStepsPayload(
  stepsPayload: Record<string, unknown>,
): { degraded: boolean | undefined; degradedReasons: string | undefined } {
  try {
    let degraded = false;
    let anySignal = false;
    const reasons: string[] = [];
    for (const value of Object.values(stepsPayload)) {
      if (typeof value !== 'object' || value === null) continue;
      const step = value as Record<string, unknown>;
      if (typeof step.degraded === 'boolean') {
        anySignal = true;
        if (step.degraded) degraded = true;
      }
      if (Array.isArray(step.degradedReasons)) {
        for (const r of step.degradedReasons) {
          if (typeof r === 'string' && r.length > 0 && !reasons.includes(r)) {
            reasons.push(r);
          }
        }
      }
    }
    if (!anySignal && reasons.length === 0) {
      return { degraded: undefined, degradedReasons: undefined };
    }
    return {
      degraded,
      // Persist as a JSON-encoded string[] verbatim, mirroring the advisory
      // `warnings` precedent (AMS `degraded_reasons TEXT` column).
      degradedReasons: reasons.length > 0 ? JSON.stringify(reasons) : undefined,
    };
  } catch {
    return { degraded: undefined, degradedReasons: undefined };
  }
}

/**
 * Optional execution parameters for {@link startRun}.
 *
 * Spec: 2026-04-20 V3 Tier UX — Task Group 4. The `POST /discovery/runs`
 * route computes the V3 tier before run creation and passes it through to
 * the run manager here so downstream `runDiscoveryV3` uses the tier the
 * gate actually evaluated (avoiding double computation).
 *
 * When omitted, existing behaviour is preserved: `runDiscoveryV3` falls
 * back to `computeTier(techHints)` internally per Task Group 3.
 */
export interface StartRunOptions {
  /** V3 pipeline tier ('A' | 'B' | 'C') computed at the route. */
  tier?: 'A' | 'B' | 'C';
  /**
   * Per-run override for the post-run performance scoring auto-trigger.
   *
   * Spec: Discovery Performance Scoring (2026-04-25), Phase 2.
   *
   *   - `undefined` (default): use the global `DISCOVERY_PERFORMANCE_AUTO_SCORE` flag.
   *   - `true`: force-score this run even if the flag is off.
   *   - `false`: skip scoring this run even if the flag is on.
   */
  doPerformanceRun?: boolean;

  /**
   * Database discovery kind dispatch (Spec 2026-05-16 Database Discovery Packs).
   *
   * When the AMS run row carries `discovery_kind='database'`, the route layer
   * passes `discoveryKind: 'database'` here along with the DB config + the
   * in-memory credentials. `startRun` then dispatches to
   * `startDatabaseRun` instead of the V3 code-discovery pipeline.
   *
   * Default (`undefined` or `'code'`): legacy V3 code-discovery flow.
   */
  discoveryKind?: 'code' | 'database';

  /**
   * Database discovery config blob. Required when `discoveryKind === 'database'`.
   */
  databaseConfig?: import('./databasePacks/types').DatabaseDiscoveryConfig;

  /**
   * Database discovery credentials. Required when `discoveryKind === 'database'`.
   * Passed in-memory only; never persisted.
   */
  databaseCredentials?: import('./databasePacks/types').DatabaseDiscoveryCredentials;

  /**
   * Expand the service-scoped discovery run's code base to include internal
   * library sources resolved via sibling-folder lookup.
   *
   * Spec 2026-05-21 Library-Scoped Unification: previously a separate
   * orchestrator (`startLibraryScopedRun`) handled "with libraries" runs,
   * but it skipped the tier gate + service identity snapshot + atom-driven
   * pipeline, producing Tier-C LLM-solo results when the user expected
   * Tier-A parity with the no-libraries flow.
   *
   * When `true`, `startServiceScopedRun` parses the service's pom.xml /
   * package.json for declared dependencies and, for each internal one,
   * looks in `dirname(repoDir)`'s children for a sibling folder whose
   * manifest matches the coordinate. Each matched directory is added to
   * the code-base set and scanned by `executeLlmFileAnalysis` with the
   * SAME tier + serviceScopedOptions as the root scan.
   *
   * Default `undefined` / `false` — scan only the root.
   */
  includeLibraries?: boolean;
}

/**
 * Fire-and-forget post-run performance scoring trigger.
 *
 * Spec: Discovery Performance Scoring (2026-04-25), Phase 2.
 *
 * Called from the COMPLETED branch of every run path. Failures here
 * never propagate — `performancePostRun.scoreRun` already swallows its
 * own errors and writes a `_FAILED.md` per-run file when the LLM call
 * fails. We additionally wrap the trigger in a top-level try/catch so a
 * crash inside the scoring stack can never bubble up and fail the run.
 *
 * The decision matrix:
 *
 *   options.doPerformanceRun  | DISCOVERY_PERFORMANCE_AUTO_SCORE | Result
 *   -------------------------|----------------------------------|--------
 *   undefined                | true (default)                   | score
 *   undefined                | false                            | skip
 *   true                     | (any)                            | score
 *   false                    | (any)                            | skip
 */
function maybeTriggerPerformanceScoring(
  projectId: string,
  runId: string,
  options?: StartRunOptions,
): void {
  const explicit = options?.doPerformanceRun;
  const shouldScore = explicit !== undefined ? explicit : DISCOVERY_PERFORMANCE_AUTO_SCORE;
  if (!shouldScore) {
    console.log(
      `[RunManager] Skipping performance scoring for run ${runId} (` +
        `explicit=${explicit}, autoScore=${DISCOVERY_PERFORMANCE_AUTO_SCORE})`,
    );
    return;
  }
  // Fire-and-forget. Use Promise.resolve().then so this is properly
  // scheduled as a microtask; we don't await.
  Promise.resolve()
    .then(() => scorePerformanceRun({ projectId, runId }))
    .then((result) => {
      console.log(
        `[RunManager] Performance scoring for run ${runId}: status=${result.status}` +
          (result.score ? `, overall=${result.score.overall.toFixed(1)}` : '') +
          (result.promotedToGolden ? ', promoted-to-golden=true' : ''),
      );
    })
    .catch((err) => {
      console.warn(
        `[RunManager] Performance scoring crashed for run ${runId}: ` +
          (err instanceof Error ? err.message : String(err)) +
          ' (run completion is not affected)',
      );
    });
}

/**
 * Fire-and-forget post-run AUTOMATED VULNERABILITY ENRICHMENT trigger
 * (Spec 2 -- Automated Vulnerability Enrichment, Task Group 3, task 3.4).
 *
 * Mirrors {@link maybeTriggerPerformanceScoring} EXACTLY: called from the
 * COMPLETED branch of the run paths, gated by the {@link DISCOVERY_VULN_ENRICH_AUTO}
 * env toggle (default ON). Runs `runVulnerabilityEnrichment` for the
 * architecture through the `VulnerabilitySource` interface (online OSV.dev by
 * default; an offline mirror swaps in via config -- never OSV.dev directly).
 *
 * STRICTLY NON-BLOCKING (HARD REQUIREMENT): `runVulnerabilityEnrichment` already
 * ALWAYS resolves (it degrades every OSV/network/proxy/TLS/timeout/malformed
 * failure to an `unavailable` / `error` outcome and never rejects). We STILL
 * wrap the trigger in `Promise.resolve().then(...).catch(...)` -- the `.catch`
 * is the FINAL backstop -- so that even an unexpected synchronous throw can
 * NEVER bubble up and fail run completion. The run is ALREADY COMPLETED before
 * this fires; enrichment is purely additive.
 *
 * The toggle is global-only (no per-run override needed): the on-demand
 * "Scan for vulnerabilities" route is the user-driven path; this is the
 * automatic after-discovery convenience pull.
 */
function maybeTriggerVulnerabilityEnrichment(
  projectId: string,
  architectureId: string,
  runId: string,
): void {
  if (!DISCOVERY_VULN_ENRICH_AUTO) {
    console.log(
      `[RunManager] Skipping automated vulnerability enrichment for run ${runId} ` +
        `(DISCOVERY_VULN_ENRICH_AUTO=false)`,
    );
    return;
  }
  // Fire-and-forget. Scheduled as a microtask; we do NOT await -- run
  // completion has already been persisted and must not depend on enrichment.
  Promise.resolve()
    .then(() => runVulnerabilityEnrichment({ projectId, architectureId }))
    .then((outcome) => {
      console.log(
        `[RunManager] Automated vulnerability enrichment for run ${runId} ` +
          `(architecture ${architectureId}): status=${outcome.status}, ` +
          `minted=${outcome.rowsMinted}, advisories=${outcome.advisoriesFound}` +
          (outcome.unavailable ? `, unavailable(${outcome.unavailableReason ?? 'unknown'})` : '') +
          ' (run completion is not affected)',
      );
    })
    .catch((err) => {
      console.warn(
        `[RunManager] Automated vulnerability enrichment crashed for run ${runId}: ` +
          (err instanceof Error ? err.message : String(err)) +
          ' (run completion is not affected)',
      );
    });
}

/**
 * Starts a discovery run by sequentially executing steps 1a, 1b, 1c-llm-analysis.
 *
 * Before each step: validates the status transition, then updates the run
 * status to RUNNING with the current step set to "running" in stepsPayload.
 *
 * After each step: updates the step's entry in stepsPayload to "completed"
 * with all summary metadata fields returned by the step execution.
 *
 * On final step completion: validates the transition to COMPLETED, then sets
 * overall status to COMPLETED with current_step null.
 *
 * On any step failure: sets the failing step to "failed" with error detail,
 * validates the transition to FAILED, records the error_message with step
 * identifier prefix, and returns immediately (fail-fast, no retry).
 *
 * @param projectId - The project UUID
 * @param runId - The discovery run UUID
 */
export async function startRun(projectId: string, runId: string, architectureId: string, serviceId?: string, options?: StartRunOptions): Promise<void> {
  // Bind the run to its picked architecture for life. The route layer
  // resolves the architectureId from the URL path segment and passes it
  // here; this binding is permanent for the lifetime of the discovery
  // service process and is the source of truth for every entity-fetch
  // and save-back during the run. Spec: 2026-05-01 Multi-Architecture
  // Discovery Integration (Spec #4) — Task Group 4.
  bindRunArchitecture(runId, projectId, architectureId);

  // Reset the per-run default-architecture cache so this run resolves the
  // project default afresh. Operators may have renamed / archived / re-ordered
  // architectures between runs (spec #3) and we must not serve a stale value.
  // Spec: 2026-05-01 Multi-Architecture Plumbing — Task Group 5.
  archModelClient.resetDefaultArchitectureCache();

  // Database-kind dispatch (Spec 2026-05-16 Database Discovery Packs --
  // Task Group 3). When the run is a database-discovery run, route to the
  // pack orchestrator instead of the V3 code pipeline. Code-kind runs
  // continue through the legacy path unchanged.
  if (options?.discoveryKind === 'database') {
    console.log(`[diag-runs] dispatch kind=database run=${(runId || '').slice(0, 8)}`);
    return startDatabaseRun(projectId, runId, architectureId, options);
  }
  // Code-kind dispatch -- log once at the entry so the runbook can pair this
  // line with `[diag-emitter] session=...` at the end.
  console.log(`[diag-runs] dispatch kind=code run=${(runId || '').slice(0, 8)}`);

  // When serviceId is present, delegate to the service-scoped pipeline
  if (serviceId) {
    return startServiceScopedRun(projectId, runId, architectureId, serviceId, options);
  }

  trace.runHeader(runId, projectId, architectureId);
  trace.step('discovery run started — kind=code', { run: runId, project: projectId, arch: architectureId });
  trace.stageStart('SCAN', { run: runId, project: projectId, arch: architectureId });

  // Initialize steps payload with all steps pending
  const stepsPayload: Record<string, Record<string, unknown>> = {};
  for (const s of VALID_STEPS) {
    stepsPayload[s] = { status: 'pending' };
  }

  // Track the current run status for state machine validation
  let currentRunStatus = 'PENDING';

  // Record run start time for total duration tracking
  const runStartTime = Date.now();

  for (let i = 0; i < VALID_STEPS.length; i++) {
    const step = VALID_STEPS[i];

    try {
      // Before step: mark current step as "running"
      const stepStartTime = Date.now();
      stepsPayload[step] = { status: 'running', stepStartedAt: new Date(stepStartTime).toISOString() };

      // Emit structured log: step_start
      logRunEvent({
        runId,
        projectId,
        step,
        event: 'step_start',
        timestamp: new Date(stepStartTime).toISOString(),
      });

      // Validate state transition before updating
      validateStatusTransition(currentRunStatus, 'RUNNING');

      await archModelClient.updateDiscoveryRun(projectId, runId, {
        status: 'RUNNING',
        current_step: step,
        steps_payload: await buildMergedStepsPayload(projectId, runId, stepsPayload),
      });
      currentRunStatus = 'RUNNING';

      // Execute the step internally
      const stepResult = await executeStep(step, projectId, runId, options);

      // After step: mark current step as "completed" with all summary metadata
      // Include timing data in the stepsPayload
      const stepEndTime = Date.now();
      const stepDurationMs = stepEndTime - stepStartTime;

      // Generically merge all step result fields alongside the status and timing
      stepsPayload[step] = {
        status: 'completed',
        ...stepResult,
        stepStartedAt: new Date(stepStartTime).toISOString(),
        stepCompletedAt: new Date(stepEndTime).toISOString(),
        durationMs: stepDurationMs,
      };

      // Build counts object from step result for structured logging
      const counts: Record<string, number> = {};
      for (const [key, value] of Object.entries(stepResult)) {
        if (typeof value === 'number') {
          counts[key] = value;
        }
      }

      // Emit structured log: step_complete
      logRunEvent({
        runId,
        projectId,
        step,
        event: 'step_complete',
        timestamp: new Date(stepEndTime).toISOString(),
        durationMs: stepDurationMs,
        counts: Object.keys(counts).length > 0 ? counts : undefined,
      });

      // If this is the final step, set overall status to COMPLETED
      if (i === VALID_STEPS.length - 1) {
        // Validate state transition before updating
        validateStatusTransition(currentRunStatus, 'COMPLETED');

        // Spec 2026-05-30 Oracle Integrity & Determinism (Task Group 2): persist
        // the advisory `degraded` signal ALONGSIDE the COMPLETED write (read off
        // the accumulated stepsPayload). Non-clobber: undefined leaves the AMS
        // value unchanged. The run still COMPLETES -- this adds NO block and does
        // NOT touch the transition map.
        const { degraded: completedDegraded, degradedReasons: completedDegradedReasons } =
          extractDegradedFromStepsPayload(stepsPayload);
        await archModelClient.updateDiscoveryRun(projectId, runId, {
          status: 'COMPLETED',
          current_step: null,
          steps_payload: await buildMergedStepsPayload(projectId, runId, stepsPayload),
          degraded: completedDegraded,
          degraded_reasons: completedDegradedReasons,
        });
        currentRunStatus = 'COMPLETED';

        const profilingOn = options?.doPerformanceRun ?? DISCOVERY_PERFORMANCE_AUTO_SCORE;
        const candCount = typeof stepResult.candidateCount === 'number' ? stepResult.candidateCount : 0;
        const evCount = typeof stepResult.evidenceCount === 'number' ? stepResult.evidenceCount : 0;
        trace.ok(
          `code scan COMPLETED — ${candCount} candidates, ${evCount} evidence, profiling ${profilingOn ? 'ON' : 'OFF'}`,
          { run: runId, project: projectId, arch: architectureId },
        );
        // Stage-END scorecard for the SCAN predicates (a run that dies
        // mid-scan leaves STAGE_START with no SCORECARD — absence detection).
        trace.stageEnd('SCAN', { run: runId, project: projectId, arch: architectureId });

        // Emit structured log: run_complete
        const totalDurationMs = Date.now() - runStartTime;
        logRunEvent({
          runId,
          projectId,
          event: 'run_complete',
          timestamp: new Date().toISOString(),
          durationMs: totalDurationMs,
        });

        // 2026-04-25: post-run performance scoring (fire-and-forget).
        maybeTriggerPerformanceScoring(projectId, runId, options);

        // 2026-06-24 (Spec 2 Task Group 3): post-run automated vulnerability
        // enrichment (fire-and-forget, STRICTLY NON-BLOCKING -- never affects
        // run completion). Gated by DISCOVERY_VULN_ENRICH_AUTO (default on).
        maybeTriggerVulnerabilityEnrichment(projectId, architectureId, runId);
      }
    } catch (error) {
      // Fail-fast: set failing step to "failed" with error detail, overall status to FAILED
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const stepFailTime = Date.now();
      const stepDurationMs = stepFailTime - runStartTime;

      stepsPayload[step] = { status: 'failed', errorMessage, step };

      // Emit structured log: step_failed
      logRunEvent({
        runId,
        projectId,
        step,
        event: 'step_failed',
        timestamp: new Date(stepFailTime).toISOString(),
        durationMs: stepDurationMs,
        error: errorMessage,
        stack: errorStack,
      });

      // Only validate and update if we're in a state that can transition to FAILED.
      // If the error came from validateStatusTransition itself (e.g., an invalid
      // transition attempt), currentRunStatus may not be RUNNING. In that case,
      // we still attempt the FAILED update to persist the error, but skip validation
      // to avoid masking the original error.
      if (VALID_TRANSITIONS[currentRunStatus]?.includes('FAILED')) {
        await archModelClient.updateDiscoveryRun(projectId, runId, {
          status: 'FAILED',
          current_step: null,
          steps_payload: await buildMergedStepsPayload(projectId, runId, stepsPayload),
          error_message: `Step ${step} failed: ${errorMessage}`,
        });
        currentRunStatus = 'FAILED';
      } else {
        // Attempt to persist the failure state even if the transition is technically
        // invalid (e.g., error during PENDING -> RUNNING validation). This ensures
        // the error is recorded for diagnostics.
        try {
          await archModelClient.updateDiscoveryRun(projectId, runId, {
            status: 'FAILED',
            current_step: null,
            steps_payload: await buildMergedStepsPayload(projectId, runId, stepsPayload),
            error_message: `Step ${step} failed: ${errorMessage}`,
          });
        } catch {
          // If we can't even persist the failure, there's nothing more we can do
        }
      }

      // Emit structured log: run_failed
      const totalDurationMs = Date.now() - runStartTime;
      logRunEvent({
        runId,
        projectId,
        event: 'run_failed',
        timestamp: new Date().toISOString(),
        durationMs: totalDurationMs,
        error: errorMessage,
        stack: errorStack,
      });

      return;
    }
  }
}

/**
 * Resumes a FAILED discovery run from a specific step.
 *
 * Validates that:
 * 1. The run exists and is in FAILED status
 * 2. The fromStep is a valid pipeline step
 *
 * Preserves completed steps' stepsPayload data, resets the fromStep and all
 * subsequent steps to 'pending', then runs the pipeline from fromStep onwards
 * using the same step execution logic as startRun.
 *
 * This allows expensive earlier steps (e.g., 1a extraction, 1b linking) to be
 * preserved while retrying a failed later step (e.g., 1c-llm-analysis).
 *
 * @param projectId - The project UUID
 * @param runId - The discovery run UUID
 * @param fromStep - The step to resume from (must be one of VALID_STEPS)
 */
export async function resumeRun(
  projectId: string,
  runId: string,
  architectureId: string,
  fromStep: string
): Promise<void> {
  // Re-assert the run-architecture binding on resume. A discovery-service
  // process restart between start and resume would have lost the
  // in-process binding; the route layer reads architectureId from the URL
  // (which is itself sourced from the persisted run row) so this is safe
  // and idempotent.
  // Spec: 2026-05-01 Multi-Architecture Discovery Integration — Group 4.
  bindRunArchitecture(runId, projectId, architectureId);

  // Reset the per-run default-architecture cache so a resumed run resolves
  // the project default afresh — see startRun above for rationale.
  // Spec: 2026-05-01 Multi-Architecture Plumbing — Task Group 5.
  archModelClient.resetDefaultArchitectureCache();

  // Validate fromStep
  const stepIndex = VALID_STEPS.indexOf(fromStep as typeof VALID_STEPS[number]);
  if (stepIndex === -1) {
    throw new Error(
      `Invalid step: ${fromStep}. Valid steps: ${VALID_STEPS.join(', ')}`
    );
  }

  // Fetch the run and validate it's in FAILED status
  const discoveryRun = await archModelClient.getDiscoveryRun(projectId, runId);
  if (!discoveryRun) {
    throw new Error(`Discovery run ${runId} not found for project ${projectId}`);
  }
  if (discoveryRun.status !== 'FAILED') {
    throw new Error(
      `Cannot resume run ${runId}: status is ${discoveryRun.status}, expected FAILED`
    );
  }

  // Build stepsPayload: preserve completed steps, reset fromStep and onwards to 'pending'
  const existingSteps = (discoveryRun.steps_payload || {}) as Record<string, Record<string, unknown>>;
  const stepsPayload: Record<string, Record<string, unknown>> = {};

  for (let i = 0; i < VALID_STEPS.length; i++) {
    const s = VALID_STEPS[i];
    if (i < stepIndex) {
      // Preserve completed step data
      stepsPayload[s] = existingSteps[s] || { status: 'completed' };
    } else {
      // Reset this step and all subsequent steps
      stepsPayload[s] = { status: 'pending' };
    }
  }

  // Track the current run status for state machine validation
  let currentRunStatus = 'FAILED';

  // Record run resume time for total duration tracking
  const runStartTime = Date.now();

  // Emit structured log: run_resume
  logRunEvent({
    runId,
    projectId,
    event: 'run_resume',
    step: fromStep,
    timestamp: new Date(runStartTime).toISOString(),
  });

  // Execute steps from fromStep onwards (same logic as startRun)
  for (let i = stepIndex; i < VALID_STEPS.length; i++) {
    const step = VALID_STEPS[i];

    try {
      // Before step: mark current step as "running"
      const stepStartTime = Date.now();
      stepsPayload[step] = { status: 'running', stepStartedAt: new Date(stepStartTime).toISOString() };

      // Emit structured log: step_start
      logRunEvent({
        runId,
        projectId,
        step,
        event: 'step_start',
        timestamp: new Date(stepStartTime).toISOString(),
      });

      // Validate state transition before updating
      validateStatusTransition(currentRunStatus, 'RUNNING');

      await archModelClient.updateDiscoveryRun(projectId, runId, {
        status: 'RUNNING',
        current_step: step,
        steps_payload: await buildMergedStepsPayload(projectId, runId, stepsPayload),
        error_message: null,
      });
      currentRunStatus = 'RUNNING';

      // Execute the step internally
      const stepResult = await executeStep(step, projectId, runId);

      // After step: mark current step as "completed" with all summary metadata
      const stepEndTime = Date.now();
      const stepDurationMs = stepEndTime - stepStartTime;

      stepsPayload[step] = {
        status: 'completed',
        ...stepResult,
        stepStartedAt: new Date(stepStartTime).toISOString(),
        stepCompletedAt: new Date(stepEndTime).toISOString(),
        durationMs: stepDurationMs,
      };

      // Build counts object from step result for structured logging
      const counts: Record<string, number> = {};
      for (const [key, value] of Object.entries(stepResult)) {
        if (typeof value === 'number') {
          counts[key] = value;
        }
      }

      // Emit structured log: step_complete
      logRunEvent({
        runId,
        projectId,
        step,
        event: 'step_complete',
        timestamp: new Date(stepEndTime).toISOString(),
        durationMs: stepDurationMs,
        counts: Object.keys(counts).length > 0 ? counts : undefined,
      });

      // If this is the final step, set overall status to COMPLETED
      if (i === VALID_STEPS.length - 1) {
        validateStatusTransition(currentRunStatus, 'COMPLETED');

        // Spec 2026-05-30 Oracle Integrity & Determinism (Task Group 2): persist
        // the advisory `degraded` signal ALONGSIDE the COMPLETED write on the
        // RESUME path too. Non-clobber; adds NO block; transition map untouched.
        const { degraded: completedDegraded, degradedReasons: completedDegradedReasons } =
          extractDegradedFromStepsPayload(stepsPayload);
        await archModelClient.updateDiscoveryRun(projectId, runId, {
          status: 'COMPLETED',
          current_step: null,
          steps_payload: await buildMergedStepsPayload(projectId, runId, stepsPayload),
          degraded: completedDegraded,
          degraded_reasons: completedDegradedReasons,
        });
        currentRunStatus = 'COMPLETED';

        const totalDurationMs = Date.now() - runStartTime;
        logRunEvent({
          runId,
          projectId,
          event: 'run_complete',
          timestamp: new Date().toISOString(),
          durationMs: totalDurationMs,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const stepFailTime = Date.now();
      const stepDurationMs = stepFailTime - runStartTime;

      stepsPayload[step] = { status: 'failed', errorMessage, step };

      logRunEvent({
        runId,
        projectId,
        step,
        event: 'step_failed',
        timestamp: new Date(stepFailTime).toISOString(),
        durationMs: stepDurationMs,
        error: errorMessage,
        stack: errorStack,
      });

      if (VALID_TRANSITIONS[currentRunStatus]?.includes('FAILED')) {
        await archModelClient.updateDiscoveryRun(projectId, runId, {
          status: 'FAILED',
          current_step: null,
          steps_payload: await buildMergedStepsPayload(projectId, runId, stepsPayload),
          error_message: `Step ${step} failed: ${errorMessage}`,
        });
        currentRunStatus = 'FAILED';
      } else {
        try {
          await archModelClient.updateDiscoveryRun(projectId, runId, {
            status: 'FAILED',
            current_step: null,
            steps_payload: await buildMergedStepsPayload(projectId, runId, stepsPayload),
            error_message: `Step ${step} failed: ${errorMessage}`,
          });
        } catch {
          // If we can't even persist the failure, there's nothing more we can do
        }
      }

      const totalDurationMs = Date.now() - runStartTime;
      logRunEvent({
        runId,
        projectId,
        event: 'run_failed',
        timestamp: new Date().toISOString(),
        durationMs: totalDurationMs,
        error: errorMessage,
        stack: errorStack,
      });

      return;
    }
  }
}

// =============================================================================
// Service-Scoped Discovery Pipeline
// Spec: Service-Scoped Discovery (TG6)
// =============================================================================

/**
 * Executes a service-scoped discovery run.
 *
 * Unlike the project-level pipeline which runs through steps 1a, 1b, and
 * 1c-llm-analysis sequentially, the service-scoped pipeline:
 *
 * 1. Fetches the service entity to get repo_location, repo_subfolder, core_tech
 * 2. Validates that repo_location is present
 * 3. Resolves the repository (clone git URL or use local folder directly)
 * 4. Builds service context string from service, application, and app_component
 * 5. Builds techHints from the service's resolved-column jsonb map
 *    (`core_tech_resolved.language` + `core_tech_resolved.frameworks[]`);
 *    spec: 2026-04-20 Tech Hints LLM Resolution (Task Group 4)
 * 6. Builds a synthetic DiscoveryConfigPayload from service entity fields
 * 7. Fetches any existing atoms and relationships from prior runs
 * 8. Calls executeLlmFileAnalysis() with service-scoped parameters
 *    (allowedCandidateTypes, serviceContext, serviceId)
 * 9. Post-filter candidates by allowed types (done inside executeLlmFileAnalysis)
 * 10. Populates service_id on all candidates
 * 11. Sorts candidates parents-first
 * 12. Persists candidates in batches
 * 13. Cleans up cloned repo (if applicable)
 * 14. Updates run status to COMPLETED
 *
 * Spec: Service-Scoped Discovery (TG6 + TG8)
 *
 * @param projectId - The project UUID
 * @param runId - The discovery run UUID
 * @param serviceId - The service entity ID
 */
async function startServiceScopedRun(
  projectId: string,
  runId: string,
  architectureId: string,
  serviceId: string,
  options?: StartRunOptions
): Promise<void> {
  const runStartTime = Date.now();
  const stepName = 'service-scoped-llm-analysis';

  // Single-step stepsPayload for service-scoped runs
  const stepsPayload: Record<string, Record<string, unknown>> = {
    [stepName]: { status: 'pending' },
  };

  let currentRunStatus = 'PENDING';

  trace.runHeader(runId, projectId, architectureId);
  trace.step('discovery run started — kind=code', { run: runId, project: projectId, arch: architectureId });
  // SCAN stage banner — the service-scoped pipeline is the LIVE code-scan path
  // (the legacy sequential startRun/executeStepLlmAnalysis path is not taken
  // for service-scoped runs). Without this the SCAN.* code predicates never
  // fired even though the scan completed (run-judge issue SCAN.CAND.01).
  trace.stageStart('SCAN', { run: runId, project: projectId, arch: architectureId });

  try {
    // Mark step as running
    const stepStartTime = Date.now();
    stepsPayload[stepName] = {
      status: 'running',
      stepStartedAt: new Date(stepStartTime).toISOString(),
    };

    logRunEvent({
      runId,
      projectId,
      step: stepName,
      event: 'step_start',
      timestamp: new Date(stepStartTime).toISOString(),
    });

    validateStatusTransition(currentRunStatus, 'RUNNING');
    await archModelClient.updateDiscoveryRun(projectId, runId, {
      status: 'RUNNING',
      current_step: stepName,
      steps_payload: await buildMergedStepsPayload(projectId, runId, stepsPayload),
    });
    currentRunStatus = 'RUNNING';

    // -----------------------------------------------------------------------
    // Step 1: Fetch service entity
    // -----------------------------------------------------------------------
    console.log(`[RunManager:service-scoped] Fetching service ${serviceId} for project ${projectId} (architectureId=${architectureId})...`);
    // architectureId is bound to the run for life by the route layer at
    // startRun. The earlier per-run-cached default resolver is intentionally
    // NOT used here — the run's bound architectureId is the authoritative
    // value. Spec: 2026-05-01 Multi-Architecture Discovery Integration —
    // Task Group 4.
    const service = await archModelClient.getService(projectId, architectureId, serviceId);
    if (!service) {
      throw new Error(
        `Service ${serviceId} not found in project ${projectId}. ` +
        `Cannot run service-scoped discovery without a valid service entity.`
      );
    }
    console.log(`[RunManager:service-scoped] Service: "${service.name}" (core_tech: ${service.core_tech || 'none'})`);

    // -----------------------------------------------------------------------
    // Step 2: Fetch config_snapshot to resolve branch from project framing
    // -----------------------------------------------------------------------
    const discoveryRun = await archModelClient.getDiscoveryRun(projectId, runId);
    const configSnapshot = discoveryRun?.config_snapshot as DiscoveryConfigPayload | undefined;

    // -----------------------------------------------------------------------
    // Step 3: Validate + normalize repo_location / repo_subfolder
    // -----------------------------------------------------------------------
    const repoLocationRaw = service.repo_location;
    if (!repoLocationRaw || repoLocationRaw.trim() === '') {
      throw new Error(
        `Service "${service.name}" (${serviceId}) has no repo_location configured. ` +
        `Set repo_location on the service entity before running service-scoped discovery.`
      );
    }
    // Normalize to guard against small input quirks saved to the service row
    // (stray `file://` prefix, backslashes, trailing slash, whitespace). Using
    // the raw value would have caused `fs.readdir` to ENOENT silently and the
    // scan plan to produce 0 candidates with no diagnostic.
    const repoLocation = normalizeRepoLocation(repoLocationRaw);
    const repoSubfolder = service.repo_subfolder
      ? normalizeRepoSubfolder(service.repo_subfolder)
      : undefined;
    console.log(`[RunManager:service-scoped] repo_location: ${repoLocation}${repoLocation !== repoLocationRaw ? ` (normalized from "${repoLocationRaw}")` : ''}`);
    if (repoSubfolder) {
      console.log(`[RunManager:service-scoped] repo_subfolder: ${repoSubfolder}${repoSubfolder !== service.repo_subfolder ? ` (normalized from "${service.repo_subfolder}")` : ''}`);
    }

    // -----------------------------------------------------------------------
    // Step 3: Resolve repository (clone git or use local path)
    // -----------------------------------------------------------------------
    let repoDir: string;
    let isCloned = false;

    if (isGitRepoUrl(repoLocation)) {
      // Clone remote git repository — resolve branch from project framing config.
      // Compare URLs after normalization so stored config entries with trailing
      // whitespace or case-variant prefixes still match the normalized value.
      const matchingRepo = configSnapshot?.repos?.find(
        (r: any) => typeof r.url === 'string' && normalizeRepoLocation(r.url) === repoLocation
      );
      const branch = matchingRepo?.branch || 'main';
      repoDir = buildTempDir(runId, repoLocation);
      const cloneStart = Date.now();
      console.log(`[RunManager:service-scoped] Cloning repo ${repoLocation} (branch: ${branch}) to ${repoDir}...`);
      try {
        await gitCloneRepoAccess.cloneRepo(repoLocation, branch, repoDir);
        console.log(`[RunManager:service-scoped] Clone complete in ${Date.now() - cloneStart}ms`);
        isCloned = true;
      } catch (cloneError) {
        const msg = cloneError instanceof Error ? cloneError.message : String(cloneError);
        console.error(`[RunManager:service-scoped] Clone FAILED after ${Date.now() - cloneStart}ms: ${msg}`);
        throw new Error(`Failed to clone repo ${repoLocation}: ${msg}`);
      }
    } else {
      // Use local folder path directly
      repoDir = repoLocation;
      console.log(`[RunManager:service-scoped] Using local folder: ${repoDir}`);
    }

    let allCandidates: DiscoveryCandidate[] = [];
    let allFindingInputs: FindingEmitInput[] = [];
    let findingsEmit: { attempted: number; persisted: number; deduped: number; failed: boolean } =
      { attempted: 0, persisted: 0, deduped: 0, failed: false };
    let filesAnalyzed = 0;
    let filesFailed = 0;
    let evidenceCount = 0;
    // Spec 2026-05-30 Oracle Integrity & Determinism (Task Group 2): advisory
    // run-level degraded signal, accumulated across every scanned directory.
    let runDegraded = false;
    const runDegradedReasons: string[] = [];
    // SCL 2026-08-19: structural-model scan outcome — produced by THIS run
    // (same clone, same root), recorded on the step payload.
    let structuralScan:
      | import('../scl/structuralScanStep').StructuralScanStepOutcome
      | null = null;
    // Item 8 (2026-08-23): Autosys jil scheduler linkage summary.
    let schedulerSummary: {
      jilJobCount: number;
      commandJobsResolved: number;
      candidatesEnriched: number;
      mintedRoots: number;
      unresolvedCommandJobs: string[];
    } | null = null;
    // SCL 2026-08-20: effect-candidate emission summary (one scan, one
    // review, one save) — counts + honest unproposed tail on the payload.
    let effectCandidates: Record<string, unknown> | null = null;

    try {
      // -----------------------------------------------------------------------
      // Step 4: Build service context string for LLM prompt (TG8)
      // -----------------------------------------------------------------------
      console.log(`[RunManager:service-scoped] Building service context for LLM prompt...`);
      const contextLines: string[] = [
        'This analysis is scoped to a specific service:',
      ];

      // Service details
      const serviceLabel = service.core_tech
        ? `"${service.name}" -- ${service.core_tech}`
        : `"${service.name}"`;
      contextLines.push(`- Service: ${serviceLabel}`);
      if (service.description) {
        contextLines.push(`- Description: ${service.description}`);
      }
      if (service.tags) {
        contextLines.push(`- Tags: ${service.tags}`);
      }

      // Parent application details
      if (service.application_id) {
        const app = await archModelClient.getApplication(projectId, architectureId, service.application_id);
        if (app) {
          const appLabel = app.description
            ? `"${app.name}" -- ${app.description}`
            : `"${app.name}"`;
          contextLines.push(`- Parent Application: ${appLabel}`);
        }
      }

      // Parent app_component details
      if (service.app_component_id) {
        const appComponent = await archModelClient.getAppComponent(projectId, architectureId, service.app_component_id);
        if (appComponent) {
          const compLabel = appComponent.description
            ? `"${appComponent.name}" -- ${appComponent.description}`
            : `"${appComponent.name}"`;
          contextLines.push(`- Parent App Component: ${compLabel}`);
        }
      }

      const serviceContext = contextLines.join('\n');
      console.log(`[RunManager:service-scoped] Service context:\n${serviceContext}`);

      // -----------------------------------------------------------------------
      // Step 5: Read resolved tech-hint columns and build synthetic
      // DiscoveryConfigPayload. Spec: 2026-04-20 Tech Hints LLM Resolution
      // (Task Group 4) — the pipeline consumes the same per-entry hint
      // shape `matchesPredicate` expects, but the raw names come from the
      // resolver's output (`core_tech_resolved.language` / `.frameworks`)
      // rather than the legacy `parseCoretech` comma-split over raw `core_tech`.
      // When the service is unresolved (`core_tech_resolved` NULL) the tier
      // gate in routes/runs.ts would have already rejected the run with
      // 409 `TECH_HINTS_UNRESOLVED`; here we fall through to an empty map
      // defensively so any out-of-band entry path degrades to tier-C pack
      // selection.
      // Pass pack IDs alongside the resolved JSON so the function can prefer
      // registered packs' canonical predicate values over the LLM resolver's
      // free-text names. See the function's doc-comment for the dual-source
      // bug this works around.
      const svcRec = service as unknown as Record<string, unknown>;
      const techHints: TechHints = techHintsFromResolvedColumns(
        service.core_tech_resolved ?? null,
        (svcRec.core_tech_language_pack as string | null | undefined) ?? null,
        (svcRec.core_tech_framework_packs as string[] | null | undefined) ?? null,
      );

      const includePaths: string[] = repoSubfolder
        ? [repoSubfolder]
        : [];

      const matchingRepoForConfig = configSnapshot?.repos?.find(
        (r: any) => typeof r.url === 'string' && normalizeRepoLocation(r.url) === repoLocation
      );
      const resolvedBranch = matchingRepoForConfig?.branch || 'main';

      // Inherit excludePaths from project framing config (e.g. test exclusion patterns)
      const configExcludePaths = matchingRepoForConfig?.excludePaths as string[] || [];

      const syntheticConfig: DiscoveryConfigPayload = {
        repos: [{
          url: repoLocation,
          ...(isGitRepoUrl(repoLocation) ? { branch: resolvedBranch } : {}),
          excludePaths: configExcludePaths,
        }],
        techHints,
        includePaths,
        excludePaths: configExcludePaths,
      };

      console.log(`[RunManager:service-scoped] Synthetic config: ${JSON.stringify({
        repos: syntheticConfig.repos,
        techHints: syntheticConfig.techHints,
        includePaths: syntheticConfig.includePaths,
        excludePaths: syntheticConfig.excludePaths,
      })}`);

      // -----------------------------------------------------------------------
      // Step 6: Fetch atoms and relationships (from any prior runs, or empty)
      // -----------------------------------------------------------------------
      const fetchAtomsStart = Date.now();
      const atomCount = await archModelClient.getEvidenceCount(projectId, runId);
      let atoms: EvidenceAtom[];
      if (atomCount > PAGINATION_THRESHOLD) {
        atoms = await archModelClient.getEvidenceByRunPaginated(
          projectId, runId, atomCount, PAGINATION_PAGE_SIZE
        );
      } else {
        atoms = await archModelClient.getEvidenceByRun(projectId, runId);
      }
      console.log(`[RunManager:service-scoped] Fetched ${atoms.length} atoms in ${Date.now() - fetchAtomsStart}ms`);

      const fetchRelsStart = Date.now();
      const relCount = await archModelClient.getRelationshipCount(projectId, runId);
      let relationships: EvidenceRelationship[];
      if (relCount > PAGINATION_THRESHOLD) {
        relationships = await archModelClient.getRelationshipsByRunPaginated(
          projectId, runId, relCount, PAGINATION_PAGE_SIZE
        );
      } else {
        relationships = await archModelClient.getRelationshipsByRun(projectId, runId);
      }
      console.log(`[RunManager:service-scoped] Fetched ${relationships.length} relationships in ${Date.now() - fetchRelsStart}ms`);

      // -----------------------------------------------------------------------
      // Step 7: Build the code-base set + scan each directory
      //
      // Spec 2026-05-21 Library-Scoped Unification: the same orchestrator
      // handles both "no libraries" and "with libraries" modes. The
      // difference is purely the SET of directories fed to the loop:
      //
      //   - includeLibraries = false (default) -> [root] only
      //   - includeLibraries = true            -> [root, ...matched sibling
      //                                            folder libraries]
      //
      // Tier, serviceScopedOptions, and atom-driven analysis are identical
      // for every directory in the set. The visual progress in the UI is
      // reported via the existing `library-scans` sub-array on the
      // `service-scoped-llm-analysis` step (root always at depth=0, libs at
      // depth=1+).
      // -----------------------------------------------------------------------
      const serviceScopedOptions: ServiceScopedAnalysisOptions = {
        allowedCandidateTypes: SERVICE_SCOPED_CANDIDATE_TYPES,
        serviceId,
        serviceContext,
      };

      // Build the root scan target: <repoDir>/<repoSubfolder> if a subfolder
      // is configured, else repoDir itself.
      const pathLib = await import('path');
      const rootScanDir = repoSubfolder ? pathLib.join(repoDir, repoSubfolder) : repoDir;

      interface CodeBaseEntry {
        label: string;
        sourceDir: string;
        depth: number;
        libraryId: string | null;
        isRoot: boolean;
      }
      const codeBaseSet: CodeBaseEntry[] = [
        {
          label: service.name,
          sourceDir: rootScanDir,
          depth: 0,
          libraryId: null,
          isRoot: true,
        },
      ];

      // Library expansion: walk declared internal deps, resolve each to a
      // sibling folder on disk, add matched dirs to the code-base set.
      // Soft-fail on the whole expansion: if anything goes wrong here, fall
      // back to a root-only scan rather than failing the run.
      if (options?.includeLibraries === true) {
        try {
          const ecosystem = inferLibraryEcosystem(service.core_tech);

          // Resolve a real ApplicationPoint id for the service root so the
          // walker can emit real edges (same pattern as the legacy
          // library-scoped path; AP id is required by code_unit_dependencies'
          // FK on source_application_point_id).
          let rootApId: string;
          const existingServiceAp = await archModelClient.getApplicationPointByTarget(
            projectId, architectureId, 'SERVICE', serviceId,
          );
          if (existingServiceAp) {
            rootApId = existingServiceAp.id;
          } else {
            const created = await archModelClient.findOrCreateApplicationPoint(
              projectId, architectureId, {
                name: service.name,
                kind: 'SERVICE',
                target_type: 'SERVICE',
                target_ref_id: serviceId,
                service_id: serviceId,
              },
            );
            rootApId = created.id;
          }

          const rootEntity: WalkerRootEntity = {
            kind: 'service',
            id: serviceId,
            name: service.name,
            applicationPointId: rootApId,
            ecosystem,
            repo_location: repoLocation,
            repo_subfolder: repoSubfolder || '',
          };

          const lookup = await buildRepoLookupTable(repoDir);
          const writeClient: WalkerArchClient = {
            async findOrCreateLibrary(payload: WalkerLibraryPayload): Promise<WalkerLibraryResult> {
              const body = buildLibraryFindOrCreatePayload({
                name: payload.name,
                ecosystem: payload.ecosystem,
                runId,
                repo_location: payload.repo_location,
                repo_subfolder: payload.repo_subfolder,
              });
              const resp = await archModelClient.findOrCreateLibrary(projectId, architectureId, body);
              return {
                library_id: resp.id,
                application_point_id: resp.derived_application_point_id,
                is_new: resp.is_new,
              };
            },
            async findOrCreateCodeUnitDependency(payload: WalkerEdgePayload) {
              const body = buildCodeUnitDependencyFindOrCreatePayload({
                source_application_point_id: payload.source_application_point_id,
                target_application_point_id: payload.target_application_point_id,
                declared_name: payload.declared_name,
                declared_version: payload.declared_version,
                declared_version_range: payload.declared_version_range,
                scope: payload.scope,
                manifest_path: payload.manifest_path,
                manifest_line: payload.manifest_line,
              });
              const resp = await archModelClient.findOrCreateCodeUnitDependency(projectId, architectureId, body);
              return { id: resp.id, is_new: resp.is_new };
            },
          };

          // includeExternal=false: we only walk internal libraries (external
          // deps like Spring Boot itself are recorded but not scanned).
          const plan: ScanPlan = await planLibraryScan(rootEntity, repoDir, lookup, false, writeClient);
          console.log(
            `[RunManager:service-scoped] Library expansion: ${plan.internalLibrariesToScan.length} internal deps; ` +
              `${plan.externalLibrariesToRecord.length} external deps recorded`,
          );

          for (const entry of plan.internalLibrariesToScan) {
            // Skip cycles + depth-capped entries (their edge is recorded but
            // they do not contribute to the scan set).
            if (entry.status === 'skipped-cycle' || entry.status === 'skipped-depth-cap') {
              console.log(
                `[RunManager:service-scoped] Library '${entry.name}' skipped (${entry.status}); not added to scan set.`,
              );
              continue;
            }
            try {
              const resolved = await resolveLibrarySource(
                entry.name,
                entry.repo_subfolder || '',
                repoDir,
                ecosystem,
              );
              if (resolved.length === 0) {
                console.warn(
                  `[RunManager:service-scoped] No source dir resolved for '${entry.name}' ` +
                    `(subfolder='${entry.repo_subfolder ?? ''}', root='${repoDir}'); skipping scan.`,
                );
                continue;
              }
              for (const match of resolved) {
                codeBaseSet.push({
                  label: entry.name,
                  sourceDir: match.sourceDir,
                  depth: entry.depth,
                  libraryId: entry.library_id,
                  isRoot: false,
                });
              }
            } catch (perLibResolveErr) {
              console.warn(
                `[RunManager:service-scoped] Library source resolution failed for '${entry.name}'; continuing.`,
                perLibResolveErr instanceof Error ? perLibResolveErr.message : String(perLibResolveErr),
              );
            }
          }
        } catch (expansionErr) {
          // The library-expansion step is soft-fail: if it blows up entirely
          // (e.g. archModelClient is unreachable, dep walker bug) we still
          // perform the root scan rather than failing the whole run.
          console.warn(
            `[RunManager:service-scoped] Library expansion failed; proceeding with root-only scan.`,
            expansionErr instanceof Error ? expansionErr.message : String(expansionErr),
          );
        }
      }

      // -----------------------------------------------------------------------
      // Step 7b: Initialise library-scans sub-rows in the steps_payload so the
      // UI can render progress per directory.
      // -----------------------------------------------------------------------
      const subRows: LibraryScanSubRow[] = codeBaseSet.map((e) => ({
        library_id: e.libraryId,
        library_name: e.label,
        depth: e.depth,
        status: 'pending',
      }));
      stepsPayload[stepName] = {
        ...stepsPayload[stepName],
        'library-scans': subRows,
        pending: subRows.length,
      };
      await archModelClient.updateDiscoveryRun(projectId, runId, {
        status: 'RUNNING',
        current_step: stepName,
        steps_payload: await buildMergedStepsPayload(projectId, runId, stepsPayload),
      });

      // -----------------------------------------------------------------------
      // Step 7c: Loop the code-base set, scan each, aggregate results.
      //
      // The root scan inherits the prior-run atoms + relationships (so
      // atom-driven Tier A/B analysis fires); library scans always pass
      // empty atoms (libraries have no prior extraction) and rely on the
      // filesystem-walk branch of executeLlmFileAnalysis (which is the
      // standard service-scoped path when no prior atoms exist).
      // Per-directory failures are isolated (R-12): one bad library does
      // NOT abort the run.
      // -----------------------------------------------------------------------
      const llmStart = Date.now();
      console.log(
        `[RunManager:service-scoped] Scanning code-base set (${codeBaseSet.length} dirs): ` +
          `${codeBaseSet.map((e) => `${e.label}@depth=${e.depth}`).join(', ')}`,
      );
      filesAnalyzed = 0;
      filesFailed = 0;
      evidenceCount = 0;
      allCandidates = [];
      allFindingInputs = [];
      for (let i = 0; i < codeBaseSet.length; i++) {
        const entry = codeBaseSet[i];
        const row = subRows[i];
        row.status = 'running';
        stepsPayload[stepName] = { ...stepsPayload[stepName], 'library-scans': subRows };
        await archModelClient.updateDiscoveryRun(projectId, runId, {
          status: 'RUNNING',
          current_step: stepName,
          steps_payload: await buildMergedStepsPayload(projectId, runId, stepsPayload),
        });

        try {
          // Root: pass prior atoms + relationships. Libraries: pass empty
          // (libraries have no prior atom extraction).
          const entryAtoms = entry.isRoot ? atoms : [];
          const entryRelationships = entry.isRoot ? relationships : [];

          const entryResult = await executeLlmFileAnalysis(
            runId,
            projectId,
            entryAtoms,
            entryRelationships,
            syntheticConfig,
            entry.sourceDir,
            serviceScopedOptions,
            options?.tier,
          );

          // Stamp library_id on library candidates so they remain attributable.
          if (!entry.isRoot && entry.libraryId) {
            for (const c of entryResult.candidates) {
              (c.data as Record<string, unknown>).library_id = entry.libraryId;
            }
          }

          allCandidates.push(...entryResult.candidates);
          allFindingInputs.push(...(entryResult.findingInputs ?? []));
          filesAnalyzed += entryResult.filesAnalyzed;
          filesFailed += entryResult.filesFailed;
          evidenceCount += entryResult.evidenceCount;
          // Spec 2026-05-30 Oracle Integrity & Determinism (Task Group 2):
          // accumulate the advisory degraded signal across every scanned
          // directory (root + libraries). Any degraded entry degrades the run;
          // reasons are the order-preserving, de-duplicated union. Advisory only.
          if (entryResult.degraded === true) runDegraded = true;
          if (Array.isArray(entryResult.degradedReasons)) {
            for (const r of entryResult.degradedReasons as string[]) {
              if (typeof r === 'string' && r.length > 0 && !runDegradedReasons.includes(r)) {
                runDegradedReasons.push(r);
              }
            }
          }

          row.files_analyzed = entryResult.filesAnalyzed;
          row.candidate_count = entryResult.candidates.length;
          row.status = 'completed';
        } catch (perEntryErr) {
          const message =
            perEntryErr instanceof Error ? perEntryErr.message : String(perEntryErr);
          console.warn(
            `[RunManager:service-scoped] Scan failed for '${entry.label}' (${entry.sourceDir}); continuing.`,
            message,
          );
          row.status = 'failed';
          row.errorMessage = message;
          row.files_analyzed = 0;
          row.candidate_count = 0;
        }

        stepsPayload[stepName] = {
          ...stepsPayload[stepName],
          'library-scans': subRows,
          pending: subRows.filter((r) => r.status === 'pending' || r.status === 'running').length,
        };
        await archModelClient.updateDiscoveryRun(projectId, runId, {
          status: 'RUNNING',
          current_step: stepName,
          steps_payload: await buildMergedStepsPayload(projectId, runId, stepsPayload),
        });
      }
      const llmDuration = Date.now() - llmStart;
      console.log(
        `[RunManager:service-scoped] Code-base scan loop done in ${llmDuration}ms: ${filesAnalyzed} files analyzed, ${filesFailed} failed, ${allCandidates.length} total candidates across ${codeBaseSet.length} directories.`,
      );

      // -----------------------------------------------------------------------
      // Step 8: Populate service_id on all candidates (TG8)
      // Critical for interface candidates where service_id is mandatory.
      // Also sets service_id on endpoint, logical_entity, physical_entity
      // candidates for traceability back to the originating service.
      // -----------------------------------------------------------------------
      if (allCandidates.length > 0) {
        console.log(`[RunManager:service-scoped] Populating service_id=${serviceId} on ${allCandidates.length} candidates...`);
        for (const candidate of allCandidates) {
          candidate.data.service_id = serviceId;
        }
        console.log(`[RunManager:service-scoped] service_id populated on all ${allCandidates.length} candidates`);
      }

      // -----------------------------------------------------------------------
      // Step 9: Sort and persist candidates in batches
      // -----------------------------------------------------------------------
      if (allCandidates.length > 0) {
        const sortedCandidates = sortCandidatesParentsFirst(allCandidates);
        const candidateBatchSize = 100;
        const totalBatches = Math.ceil(sortedCandidates.length / candidateBatchSize);
        console.log(`[RunManager:service-scoped] Persisting ${sortedCandidates.length} candidates in ${totalBatches} batches (sorted parents-first)...`);

        for (let i = 0; i < sortedCandidates.length; i += candidateBatchSize) {
          const batch = sortedCandidates.slice(i, i + candidateBatchSize);
          const batchNum = Math.floor(i / candidateBatchSize) + 1;
          const batchStart = Date.now();
          try {
            await archModelClient.bulkSaveCandidates(projectId, runId, batch);
            console.log(`[RunManager:service-scoped] Candidate batch ${batchNum}/${totalBatches} (${batch.length}) persisted in ${Date.now() - batchStart}ms`);
          } catch (batchError: unknown) {
            const axiosErr = batchError as { response?: { status?: number; data?: unknown }; message?: string };
            const respBody = axiosErr.response?.data
              ? JSON.stringify(axiosErr.response.data).substring(0, 1000)
              : 'no response body';
            console.error(`[RunManager:service-scoped] Candidate batch ${batchNum} FAILED (${Date.now() - batchStart}ms): status=${axiosErr.response?.status}, body=${respBody}`);
            throw batchError;
          }
        }
        console.log(`[RunManager:service-scoped] All candidates persisted`);
      } else {
        console.log(`[RunManager:service-scoped] No candidates to persist`);
      }

      // -----------------------------------------------------------------------
      // Step 9.4: Emit the V3 pipeline's findings NOW -- AFTER candidates are
      // persisted (above) so their discovery_candidate links validate at AMS.
      // Bug-fix 2026-05-29. Accumulated across every code-base directory in the
      // loop; soft-fail; outcome surfaced via findingsEmit in the step payload.
      // -----------------------------------------------------------------------
      findingsEmit = await emitPipelineFindingsForRun(allFindingInputs, runId, projectId);

      // -----------------------------------------------------------------------
      // Step 9.5: Maven pack-finding scanner (bug-fix 2026-05-28).
      // Same wiring as the project-scoped 1c path. Soft-fail at the
      // boundary; never aborts the service-scoped run.
      // -----------------------------------------------------------------------
      await runMavenPackFindingsForRun(repoDir, runId, projectId);

      // -----------------------------------------------------------------------
      // Step 9.6: Structural (SCL) scan — same clone, same pass (2026-08-19
      // user ruling: the ONE code scan produces the structural model; no
      // separate trigger, no second scan). Runs while the clone is still on
      // disk, against the SAME root directory the LLM analysis scanned.
      // FAIL-SOFT LOUD: the outcome rides the step payload; a structural
      // failure never fails the code run.
      // -----------------------------------------------------------------------
      const structuralStart = Date.now();
      // Live proc sources (2026-08-23): the latest COMPLETED database run
      // carries the live catalog harvest on its steps payload — the corpus
      // merges it with the repo `.sql` harvest (live wins, drift loud).
      // FAIL-SOFT: no DB run / no harvest -> repo-only, logged.
      let liveProcSources:
        | import('../scl/sqlProcHarvester').LiveProcSource[]
        | undefined;
      try {
        const runs = await archModelClient.listDiscoveryRuns(projectId, architectureId);
        const dbRuns = (runs ?? [])
          .filter(
            (r) =>
              String((r as { discovery_kind?: string }).discovery_kind ?? '') === 'database' &&
              String((r as { status?: string }).status ?? '').toUpperCase() === 'COMPLETED',
          )
          .sort((a, b) =>
            String((b as { started_at?: string }).started_at ?? '').localeCompare(
              String((a as { started_at?: string }).started_at ?? ''),
            ),
          );
        const latest = dbRuns[0] as
          | { steps_payload?: { database?: { proc_sources?: unknown } } }
          | undefined;
        const sources = latest?.steps_payload?.database?.proc_sources;
        if (Array.isArray(sources) && sources.length > 0) {
          liveProcSources = sources as import('../scl/sqlProcHarvester').LiveProcSource[];
          console.log(
            `[RunManager:service-scoped] Live proc sources: ${liveProcSources.length} object(s) from the latest database run`,
          );
        } else {
          console.log(
            `[RunManager:service-scoped] Live proc sources: none available (repo-only proc catalog)`,
          );
        }
      } catch (procFetchErr) {
        console.warn(
          `[RunManager:service-scoped] Live proc source fetch failed (repo-only proc catalog): ${
            procFetchErr instanceof Error ? procFetchErr.message : String(procFetchErr)
          }`,
        );
      }
      const structural = await runStructuralScanStep({
        projectId,
        architectureId,
        sourceDir: rootScanDir,
        liveProcSources,
      });
      // Item 8 (2026-08-23): Autosys .jil scheduler linkage — job -> shell
      // -> Java main resolved against the corpus's internal roots; schedule
      // metadata (box, times, days, conditions) rides the matching internal
      // endpoint candidates so the quiet-window rule and the batch
      // book-of-work know WHEN the batch plane runs. Silent no-op without
      // .jil files; unresolved jobs stay LOUD in the run payload.
      if (structural.corpus) {
        try {
          const jilJobs = parseJilFiles(rootScanDir);
          if (jilJobs.length > 0) {
            const mains = (structural.corpus.roots ?? [])
              .filter((r) => r.kind === 'internal')
              .map((r) => {
                const symbol = String(r.symbol ?? '');
                const hash = symbol.indexOf('#');
                return hash > 0 ? symbol.slice(0, hash) : symbol;
              })
              .filter((fqn) => fqn.length > 0);
            const resolved = resolveJobsToMains(jilJobs, rootScanDir, [...new Set(mains)]);
            // Kiro bug 4 (2026-08-24): a main the scheduler PROVABLY runs
            // (jil job -> shell -> java FQCN) must be an entrypoint even
            // when the batch detector's heuristics missed it — rescue-mint
            // a BATCH_MAIN endpoint candidate so its chain roots.
            let mintedRoots = 0;
            for (const fqn of new Set(
              resolved.map((j) => j.resolvedMainFqn).filter((x): x is string => !!x),
            )) {
              const simpleName = fqn.includes('.') ? fqn.slice(fqn.lastIndexOf('.') + 1) : fqn;
              const exists = allCandidates.some((c) => {
                if (c.candidateType !== 'endpoints') return false;
                const data = c.data as
                  | { className?: string; methodName?: string; fullPath?: string }
                  | undefined;
                // The emitter joins internal entrypoints on className#methodName
                // (Kiro 2026-08-24): a class-only candidate suppressed the mint
                // AND could not root the chain — nine batch-written tables
                // looked read-only or untouched. Only a candidate that can
                // actually ROOT counts as existing.
                if (!data?.methodName) return false;
                return (
                  String(data?.fullPath ?? '') === fqn ||
                  String(data?.className ?? '') === fqn ||
                  String(data?.className ?? '') === simpleName
                );
              });
              if (exists) continue;
              const minted = {
                id: uuidv4(),
                runId,
                candidateType: 'endpoints',
                name: `BATCH_MAIN ${fqn}`,
                confidence: 0.9,
                status: 'proposed',
                sourceClusterIds: [],
                data: {
                  endpoint_subtype: 'batch-main',
                  httpMethod: 'BATCH_MAIN',
                  fullPath: fqn,
                  className: simpleName,
                  methodName: 'main',
                  batchSignalSource: 'jil-resolved',
                },
                synthesizedAt: new Date().toISOString(),
              } as unknown as (typeof allCandidates)[number];
              allCandidates.push(minted);
              mintedRoots += 1;
            }
            if (mintedRoots > 0) {
              await archModelClient.bulkSaveCandidates(
                projectId,
                runId,
                allCandidates.slice(-mintedRoots),
              );
              console.log(
                `[RunManager:service-scoped] Scheduler root rescue: ${mintedRoots} jil-resolved main(s) minted as BATCH_MAIN endpoints`,
              );
            }
            let enriched = 0;
            for (const job of resolved) {
              if (!job.resolvedMainFqn) continue;
              const fqn = job.resolvedMainFqn;
              // Batch-main endpoint candidates carry the FQN in `fullPath`
              // and the SIMPLE name in `className` (2026-08-24 shakedown:
              // comparing className against the FQN matched NOTHING --
              // candidatesEnriched was 0 with 31 jobs resolved).
              const simpleName = fqn.includes('.') ? fqn.slice(fqn.lastIndexOf('.') + 1) : fqn;
              const target = allCandidates.find((c) => {
                if (c.candidateType !== 'endpoints') return false;
                const data = c.data as { className?: string; fullPath?: string } | undefined;
                const className = String(data?.className ?? '');
                const fullPath = String(data?.fullPath ?? '');
                return fullPath === fqn || className === fqn || className === simpleName;
              });
              if (!target) continue;
              const schedules =
                ((target.data as Record<string, unknown>).schedules as unknown[]) ?? [];
              schedules.push({
                job_name: job.jobName,
                box_name: job.boxName,
                start_times: job.startTimes,
                days_of_week: job.daysOfWeek,
                condition: job.condition,
                source: job.sourcePath,
              });
              (target.data as Record<string, unknown>).schedules = schedules;
              enriched++;
            }
            const unresolvedCommands = resolved
              .filter((j) => (j.jobType === null || j.jobType === 'c') && !j.resolvedMainFqn)
              .map((j) => j.jobName)
              .slice(0, 20);
            schedulerSummary = {
              jilJobCount: jilJobs.length,
              commandJobsResolved: resolved.filter((j) => j.resolvedMainFqn).length,
              candidatesEnriched: enriched,
              mintedRoots,
              unresolvedCommandJobs: unresolvedCommands,
            };
            console.log(
              `[RunManager:service-scoped] Scheduler linkage: ${jilJobs.length} jil job(s), ` +
                `${schedulerSummary.commandJobsResolved} resolved to mains, ` +
                `${unresolvedCommands.length} unresolved command job(s)`,
            );
          }
        } catch (jilErr) {
          console.warn(
            `[RunManager:service-scoped] jil parse failed (non-fatal): ${
              jilErr instanceof Error ? jilErr.message : String(jilErr)
            }`,
          );
        }
      }
      // Item 6 (2026-08-23): web.xml-mapped handlers become REAL endpoint
      // candidates under an OPERATIONAL_HTTP interface — inventoried and
      // capturable DELIBERATELY (AMS auto-classifies the interface type out
      // of capture scope by default; a cache-rebuild endpoint firing
      // mid-capture is exactly what the quiet rule forbids).
      if (structural.corpus) {
        const minted = mintOperationalHttpCandidates(
          structural.corpus.roots ?? [],
          runId,
          allCandidates,
        );
        if (minted.length > 0) {
          await archModelClient.bulkSaveCandidates(projectId, runId, minted);
          allCandidates.push(...minted);
          console.log(
            `[RunManager:service-scoped] Operational web.xml endpoints minted: ${minted.length - 1} endpoint(s)`,
          );
        }
      }
      // Shakedown fix 3 (2026-08-23): the repo-vs-live proc merge findings
      // (drift / live-only / repo-only / duplicate) previously lived ONLY on
      // the structural corpus artifact (Structural Model tab). They are
      // migration-load-bearing — promote them into the run findings register
      // where every other loud signal lands. Soft-fail, never dents the run.
      if (structural.corpus) {
        try {
          const procFindings = (structural.corpus.findings ?? []).filter((f) =>
            String(f.kind ?? '').startsWith('proc_'),
          );
          if (procFindings.length > 0) {
            const inputs = procMergeFindingInputs(procFindings);
            await findingEmitter.emitFindings(
              { runId, projectId, architectureId: '' },
              inputs,
            );
            console.log(
              `[RunManager:service-scoped] Proc merge findings promoted to run register: ${inputs.length}`,
            );
          }
        } catch (procFindingErr) {
          console.warn(
            `[RunManager:service-scoped] Proc finding promotion failed (corpus copy remains authoritative): ${
              procFindingErr instanceof Error ? procFindingErr.message : String(procFindingErr)
            }`,
          );
        }
      }
      structuralScan = structural.outcome;
      console.log(
        `[RunManager:service-scoped] Structural scan ${structuralScan.status}` +
          (structuralScan.scanId ? ` id=${structuralScan.scanId}` : '') +
          (structuralScan.contractCount !== null ? ` contracts=${structuralScan.contractCount}` : '') +
          ` in ${Date.now() - structuralStart}ms` +
          (structuralScan.annotation ? ` annotation=${structuralScan.annotation.status}` : '') +
          (structuralScan.detail ? ` detail=${structuralScan.detail}` : ''),
      );
      if (structuralScan.status === 'failed') {
        console.warn(
          `[diag-runs] code_run=${(runId || '').slice(0, 8)} structural_scan_failed ` +
            `detail=${(structuralScan.detail ?? 'unknown').slice(0, 200)}`,
        );
      }
      if (structuralScan.annotation?.status === 'request_failed') {
        console.warn(
          `[diag-runs] code_run=${(runId || '').slice(0, 8)} scl_annotation_request_failed ` +
            `detail=${(structuralScan.annotation.detail ?? 'unknown').slice(0, 200)}`,
        );
      }

      // -----------------------------------------------------------------------
      // Step 9.7: Effect-candidate emission (2026-08-20 user ruling: "truly
      // one scan, one review, one save"). The scan's own corpus yields
      // endpoint_data_effects candidates for THIS RUN's write endpoints that
      // discovery's own mining left bare: deterministic corpus derivations
      // (0.9) + vocabulary-guarded LLM proposals (0.65) — both land in the
      // NORMAL candidate review; save-back resolves names to ids. FAIL-SOFT
      // LOUD: an emission failure never fails the run. The gateway backfill
      // button remains the recovery path.
      // -----------------------------------------------------------------------
      if (structural.corpus) {
        try {
          const emissionStart = Date.now();
          const derivedPhase = deriveCorpusEffectCandidates({
            corpus: structural.corpus,
            runId,
            runCandidates: allCandidates,
          });
          let proposalPhase: import('../scl/effectCandidateEmitter').ProposeResult = {
            candidates: [],
            unproposed: [],
            llmCalls: 0,
          };
          if (derivedPhase.uncovered.length > 0) {
            const vocabulary = await fetchCommittedTableVocabulary(projectId, architectureId);
            if (vocabulary && vocabulary.length > 0) {
              proposalPhase = await proposeEffectCandidatesViaLlm({
                runId,
                uncovered: derivedPhase.uncovered,
                corpus: structural.corpus,
                vocabulary,
                relay: (prompt, tag, r) => gatewayClient.gapFill(prompt, tag, r),
              });
            } else {
              proposalPhase.unproposed = derivedPhase.uncovered.map((u) => ({
                method: u.method,
                path: u.path,
                reason:
                  'no committed table vocabulary — save the database scan candidates first, ' +
                  'then use "Backfill effect maps" (recovery path)',
                diagnosis: u.diagnosis,
              }));
            }
          }
          const emitted = [...derivedPhase.candidates, ...proposalPhase.candidates];
          for (let i = 0; i < emitted.length; i += 100) {
            await archModelClient.bulkSaveCandidates(projectId, runId, emitted.slice(i, i + 100));
          }
          allCandidates.push(...emitted);
          effectCandidates = {
            derived: derivedPhase.candidates.length,
            readMapped: derivedPhase.readMapped,
            internalWalked: derivedPhase.internalWalked.length,
            provenRead: derivedPhase.provenRead.length,
            proposed: proposalPhase.candidates.length,
            llmCalls: proposalPhase.llmCalls,
            // Screenshot-friendly rollup FIRST; full unproposed detail after.
            summary: summarizeEmission(derivedPhase, proposalPhase),
            unproposed: proposalPhase.unproposed,
            readUnderived: derivedPhase.readUnderived,
            chainBreaks: derivedPhase.chainBreaks,
            // 2026-08-24 shakedown: WHICH internal chains walked (capped 20
            // upstream) -- diagnosing batch-plane rooting needs the names,
            // not the count.
            internalWalkedNames: derivedPhase.internalWalked,
            // Shakedown fix 2 (2026-08-23): table -> caller-less proc
            // touchers; the foundations never-touched card annotates WHY.
            orphanProcTouchers: derivedPhase.orphanProcTouchers,
            // Kiro backstop: unrooted corpus-wide read facts — the
            // foundations write-only bucket refuses tables listed here.
            readAnywhereTables: derivedPhase.readAnywhereTables,
          };
          console.log(
            `[RunManager:service-scoped] Effect candidates: ${derivedPhase.candidates.length} corpus-derived ` +
              `(${derivedPhase.readMapped} read-mapped endpoint(s), ` +
              `${derivedPhase.readUnderived.length} read-underived, ` +
              `${derivedPhase.chainBreaks.length} chain-break(s), ` +
              `${derivedPhase.internalWalked.length} internal chain(s), ` +
              `${derivedPhase.provenRead.length} proven-read), ` +
              `${proposalPhase.candidates.length} LLM-proposed (${proposalPhase.llmCalls} call(s)), ` +
              `${proposalPhase.unproposed.length} unproposed in ${Date.now() - emissionStart}ms`,
          );
        } catch (emissionErr) {
          const message =
            emissionErr instanceof Error ? emissionErr.message : String(emissionErr);
          console.warn(
            `[diag-runs] code_run=${(runId || '').slice(0, 8)} effect_candidate_emission_failed ` +
              `detail=${message.slice(0, 200)}`,
          );
          effectCandidates = { error: message.slice(0, 300) };
        }
      }
    } finally {
      // -----------------------------------------------------------------------
      // Step 10: Cleanup cloned repo (if applicable)
      // -----------------------------------------------------------------------
      if (isCloned) {
        try {
          await gitCloneRepoAccess.cleanup(repoDir);
          console.log(`[RunManager:service-scoped] Repo cleanup complete`);
        } catch (cleanupError) {
          console.warn(`[RunManager:service-scoped] Failed to clean up temp directory ${repoDir}:`, cleanupError);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step complete: update run status to COMPLETED
    // -----------------------------------------------------------------------
    const stepEndTime = Date.now();
    const stepDurationMs = stepEndTime - stepStartTime;

    const candidatesByType: Record<string, number> = {};
    for (const candidate of allCandidates) {
      const t = candidate.candidateType;
      candidatesByType[t] = (candidatesByType[t] || 0) + 1;
    }

    stepsPayload[stepName] = {
      status: 'completed',
      filesAnalyzed,
      filesFailed,
      candidateCount: allCandidates.length,
      evidenceCount,
      candidatesByType,
      findingsEmit,
      // SCL 2026-08-19: structural-model scan outcome (completed|failed|skipped
      // + scan id / contract count / reason) — minted by THIS run.
      structuralScan,
      scheduler: schedulerSummary,
      // SCL 2026-08-20: corpus/LLM effect-candidate emission summary.
      effectCandidates,
      stepStartedAt: new Date(stepStartTime).toISOString(),
      stepCompletedAt: new Date(stepEndTime).toISOString(),
      durationMs: stepDurationMs,
    };

    logRunEvent({
      runId,
      projectId,
      step: stepName,
      event: 'step_complete',
      timestamp: new Date(stepEndTime).toISOString(),
      durationMs: stepDurationMs,
      counts: {
        filesAnalyzed,
        filesFailed,
        candidateCount: allCandidates.length,
        evidenceCount,
      },
    });

    validateStatusTransition(currentRunStatus, 'COMPLETED');
    // Spec 2026-05-30 Oracle Integrity & Determinism (Task Group 2): persist the
    // advisory degraded signal ALONGSIDE the COMPLETED write on the
    // service-scoped path too (accumulated across directories above). Non-clobber
    // (undefined leaves the AMS value unchanged); adds NO block; transition map
    // untouched.
    await archModelClient.updateDiscoveryRun(projectId, runId, {
      status: 'COMPLETED',
      current_step: null,
      steps_payload: await buildMergedStepsPayload(projectId, runId, stepsPayload),
      degraded: runDegraded || runDegradedReasons.length > 0 ? runDegraded : undefined,
      degraded_reasons:
        runDegradedReasons.length > 0 ? JSON.stringify(runDegradedReasons) : undefined,
    });
    currentRunStatus = 'COMPLETED';

    const profilingOn = options?.doPerformanceRun ?? DISCOVERY_PERFORMANCE_AUTO_SCORE;
    trace.ok(
      `code scan COMPLETED — ${allCandidates.length} candidates, ${evidenceCount} evidence, profiling ${profilingOn ? 'ON' : 'OFF'}`,
      { run: runId, project: projectId, arch: architectureId },
    );
    // SCAN-stage predicate emission + scorecard for the LIVE service-scoped
    // code scan (run-judge issue SCAN.CAND.01: these never fired because the
    // emission was wired only into the unused legacy executeStepLlmAnalysis
    // path). Pure counting over the in-memory candidate set; never throws.
    emitCodeScanPredicates(allCandidates, findingsEmit, { run: runId, project: projectId });
    trace.stageEnd('SCAN', { run: runId, project: projectId, arch: architectureId });

    const totalDurationMs = Date.now() - runStartTime;
    logRunEvent({
      runId,
      projectId,
      event: 'run_complete',
      timestamp: new Date().toISOString(),
      durationMs: totalDurationMs,
    });

    console.log(`[RunManager:service-scoped] Run ${runId} completed in ${totalDurationMs}ms. Candidates: ${allCandidates.length}, Types: ${JSON.stringify(candidatesByType)}`);

    // 2026-04-25: post-run performance scoring (fire-and-forget).
    maybeTriggerPerformanceScoring(projectId, runId, options);

    // 2026-06-24 (Spec 2 Task Group 3): post-run automated vulnerability
    // enrichment (fire-and-forget, STRICTLY NON-BLOCKING -- never affects run
    // completion). Gated by DISCOVERY_VULN_ENRICH_AUTO (default on).
    maybeTriggerVulnerabilityEnrichment(projectId, architectureId, runId);

  } catch (error) {
    // Fail-fast: set step to "failed", overall status to FAILED
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const stepFailTime = Date.now();
    const stepDurationMs = stepFailTime - runStartTime;

    stepsPayload[stepName] = { status: 'failed', errorMessage, step: stepName };

    logRunEvent({
      runId,
      projectId,
      step: stepName,
      event: 'step_failed',
      timestamp: new Date(stepFailTime).toISOString(),
      durationMs: stepDurationMs,
      error: errorMessage,
      stack: errorStack,
    });

    if (VALID_TRANSITIONS[currentRunStatus]?.includes('FAILED')) {
      await archModelClient.updateDiscoveryRun(projectId, runId, {
        status: 'FAILED',
        current_step: null,
        steps_payload: await buildMergedStepsPayload(projectId, runId, stepsPayload),
        error_message: `Service-scoped discovery failed: ${errorMessage}`,
      });
      currentRunStatus = 'FAILED';
    } else {
      try {
        await archModelClient.updateDiscoveryRun(projectId, runId, {
          status: 'FAILED',
          current_step: null,
          steps_payload: await buildMergedStepsPayload(projectId, runId, stepsPayload),
          error_message: `Service-scoped discovery failed: ${errorMessage}`,
        });
      } catch {
        // If we cannot persist the failure, there is nothing more we can do
      }
    }

    const totalDurationMs = Date.now() - runStartTime;
    logRunEvent({
      runId,
      projectId,
      event: 'run_failed',
      timestamp: new Date().toISOString(),
      durationMs: totalDurationMs,
      error: errorMessage,
      stack: errorStack,
    });

    console.error(`[RunManager:service-scoped] Run ${runId} FAILED in ${totalDurationMs}ms: ${errorMessage}`);
  }
}

/**
 * Per-directory progress row used inside the
 * `service-scoped-llm-analysis` step's `library-scans` sub-array.
 *
 * Spec 2026-05-21 Library-Scoped Unification: the same orchestrator
 * (`startServiceScopedRun`) handles both no-libraries and with-libraries
 * runs. The root entity always appears at `depth=0`; matched sibling-
 * folder libraries appear at `depth >= 1` when `includeLibraries` is set.
 */
interface LibraryScanSubRow {
  library_id: string | null;
  library_name: string;
  depth: number;
  status:
    | 'pending'
    | 'running'
    | 'completed'
    | 'skipped-cycle'
    | 'skipped-depth-cap'
    | 'skipped-source-not-found'
    | 'failed';
  files_analyzed?: number;
  candidate_count?: number;
  error?: string;
  /** Populated when status='failed' to surface the cause to the UI. */
  errorMessage?: string;
}

function inferLibraryEcosystem(hint: string | null | undefined): 'MAVEN' | 'NPM' {
  if (!hint) return 'MAVEN';
  const h = hint.toLowerCase();
  if (h.includes('npm') || h.includes('typescript') || h.includes('javascript') || h.includes('node')) return 'NPM';
  return 'MAVEN';
}


// =============================================================================
// Spec 2026-05-16 Database Discovery Packs -- Task Group 3.
//
// `startDatabaseRun` orchestrates a database-kind discovery run. It does
// NOT run any V3 code-discovery steps; instead it delegates to the database
// pack orchestrator which walks introspect / profile / inferRelationships /
// emitCandidates / emitFindings.
//
// AMS run-row updates:
//   - PENDING -> RUNNING at start
//   - RUNNING -> COMPLETED (or FAILED) at end
// The single `steps_payload` entry records the per-pack envelope returned
// by the orchestrator (no per-step granularity in v1; the orchestrator's
// soft-fail wrapper already collects per-stage failures as warning findings).
//
// Candidate persistence:
//   - After the orchestrator returns, the DatabaseCandidatePayload list is
//     converted to DiscoveryCandidate rows (clientId -> UUID for parent
//     linkage), sorted parents-first, then sent to
//     archModelClient.bulkSaveCandidates in batches of 200. Per-batch
//     errors are logged but do NOT fail the run -- partial persistence is
//     better than losing the entire introspection result.
//
// Secrets:
//   - The route layer passes credentials in options.databaseCredentials. The
//     orchestrator stashes them in the in-process secretsStore for the
//     lifetime of the run; the `finally` purge runs unconditionally.
// =============================================================================

import { runDatabasePackDiscovery } from './databasePacks/databasePackOrchestrator';
// CSD auto-S0 (2026-08-19): the DB scan pins the canonical state in one go.
import { takeS0AutoSnapshot } from './databasePacks/s0AutoSnapshot';
// SCL 2026-08-19: the CODE scan produces the structural model in the same
// pass (same clone, same root) — never a separate trigger or second scan.
import { runStructuralScanStep } from '../scl/structuralScanStep';
import { parseJilFiles, resolveJobsToMains } from './schedulerAdapters/autosysJil';
// SCL 2026-08-20: the scan also emits endpoint_data_effects candidates from
// its own corpus (deterministic + vocabulary-guarded LLM) — one scan, one
// review, one save.
import {
  deriveCorpusEffectCandidates,
  fetchCommittedTableVocabulary,
  proposeEffectCandidatesViaLlm,
  summarizeEmission,
} from '../scl/effectCandidateEmitter';
import type { DatabaseCandidatePayload } from './databasePacks/DatabaseDiscoveryPack';

/**
 * Convert the database orchestrator's {@link DatabaseCandidatePayload} list
 * into the {@link DiscoveryCandidate} shape that
 * {@link archModelClient.bulkSaveCandidates} accepts.
 *
 * Two-pass: pass 1 assigns a UUID to every payload (keyed by `clientId`),
 * pass 2 builds the DiscoveryCandidate rows resolving each child's
 * `parentCandidateClientId` to the parent's freshly-minted UUID.
 *
 * @internal
 */
function convertDatabasePayloadsToCandidates(
  payloads: DatabaseCandidatePayload[],
  runId: string,
): DiscoveryCandidate[] {
  const synthesizedAt = new Date().toISOString();
  const clientIdToUuid = new Map<string, string>();
  for (const p of payloads) {
    clientIdToUuid.set(p.clientId, uuidv4());
  }
  return payloads.map((p) => {
    const id = clientIdToUuid.get(p.clientId) as string;
    const parentCandidateId = p.parentCandidateClientId
      ? clientIdToUuid.get(p.parentCandidateClientId)
      : undefined;
    const confidenceFromData =
      typeof (p.data as { confidence?: unknown })?.confidence === 'number'
        ? ((p.data as { confidence: number }).confidence)
        : 1.0;
    return {
      id,
      runId,
      candidateType: p.candidateType,
      name: p.name,
      confidence: confidenceFromData,
      status: 'proposed',
      // sourceClusterIds is repurposed across the codebase as "source file
      // paths". For DB candidates the closest analog is the synthetic
      // `db://...` URI from the pack; emit it as a single-element array.
      sourceClusterIds: [p.filePath],
      data: p.data,
      synthesizedAt,
      parentCandidateId,
    } as DiscoveryCandidate;
  });
}

/**
 * Item 6 (2026-08-23): mint an OPERATIONAL_HTTP interface + one endpoint
 * candidate per corpus `web_xml:` root. Pure + deduped against existing
 * candidate names so re-scans stay additive.
 */
/**
 * Map repo-vs-live proc merge findings (SclFinding kind `proc_*`) to run
 * findings register inputs (shakedown fix 3, 2026-08-23). Pure — pinned by
 * tests; the emission site stays soft-fail.
 */
export function procMergeFindingInputs(
  procFindings: Array<{ kind: string; symbol?: string; detail?: string; candidates?: string[] }>,
): FindingEmitInput[] {
  const severityByKind: Record<string, string> = {
    proc_repo_drift: 'medium',
    proc_repo_duplicate: 'medium',
    proc_live_only: 'medium',
    proc_repo_only: 'low',
  };
  return procFindings.map((f) => ({
    findingType: String(f.kind),
    category: 'proc_catalog',
    severity: severityByKind[String(f.kind)] ?? 'low',
    title: `${String(f.kind)}: ${String(f.symbol ?? '')}`,
    summary: String(f.detail ?? ''),
    detailJson: {
      procName: String(f.symbol ?? ''),
      kind: String(f.kind),
      candidates: f.candidates ?? null,
    },
    source: 'scl_proc_merge',
    createdByStage: 'structural_scan',
  }));
}

export function mintOperationalHttpCandidates(
  roots: Array<{ kind?: string; symbol?: string; detail?: string }>,
  runId: string,
  existing: Array<{ name?: string | null }>,
): DiscoveryCandidate[] {
  const webRoots = roots.filter(
    (r) => typeof r.detail === 'string' && r.detail.startsWith('web_xml:'),
  );
  if (webRoots.length === 0) return [];
  const existingNames = new Set(
    existing.map((c) => String(c.name ?? '').toLowerCase()).filter((n) => n.length > 0),
  );
  const synthesizedAt = new Date().toISOString();
  const interfaceName = 'Operational endpoints (web.xml)';
  const out: DiscoveryCandidate[] = [];
  const interfaceId = uuidv4();
  let mintedAny = false;
  for (const root of webRoots) {
    const urlPattern = String(root.detail).slice('web_xml:'.length);
    const symbol = String(root.symbol ?? '');
    const hash = symbol.indexOf('#');
    const className = hash > 0 ? symbol.slice(0, hash) : symbol;
    const methodName =
      hash > 0 ? symbol.slice(hash + 1).replace(/\(.*$/, '') : 'handleRequest';
    const name = `POST ${urlPattern}`;
    if (existingNames.has(name.toLowerCase())) continue;
    mintedAny = true;
    out.push({
      id: uuidv4(),
      runId,
      candidateType: 'endpoints',
      name,
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: [],
      parentCandidateId: interfaceId,
      data: {
        method: 'POST',
        path: urlPattern,
        className,
        methodName,
        endpoint_subtype: 'webxml_handler',
        operational_note:
          'web.xml-mapped operational endpoint (state-mutating handler) — auto-classified ' +
          'OUT of capture scope by default; opt in deliberately.',
        _addedBy: 'webxml-handler-detector',
      },
      synthesizedAt,
    } as DiscoveryCandidate);
  }
  if (!mintedAny) return [];
  out.unshift({
    id: interfaceId,
    runId,
    candidateType: 'interfaces',
    name: interfaceName,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    data: {
      interface_type: 'OPERATIONAL_HTTP',
      protocol: 'rest',
      _addedBy: 'webxml-handler-detector',
    },
    synthesizedAt,
  } as DiscoveryCandidate);
  return out;
}

export async function startDatabaseRun(
  projectId: string,
  runId: string,
  architectureId: string,
  options: StartRunOptions,
): Promise<void> {
  const config = options.databaseConfig;
  const credentials = options.databaseCredentials;

  if (!config || !credentials) {
    const err =
      'startDatabaseRun: options.databaseConfig and options.databaseCredentials are required.';
    console.error(`[RunManager:database] ${err} runId=${runId}`);
    console.warn(
      `[diag-runs] db_run=${(runId || '').slice(0, 8)} reject=missing_config_or_credentials`,
    );
    try {
      await archModelClient.updateDiscoveryRun(projectId, runId, {
        status: 'FAILED',
        current_step: null,
        error_message: err,
      });
    } catch (persistErr) {
      const message =
        persistErr instanceof Error ? persistErr.message : String(persistErr);
      console.warn(
        `[RunManager:database] Failed to persist FAILED status. error='${message}'`,
      );
    }
    return;
  }

  const runContext: FindingEmitRunContext = {
    runId,
    projectId,
    architectureId,
  };

  const dbRunStartedAt = Date.now();
  console.log(`[diag-runs] db_run=${(runId || '').slice(0, 8)} start elapsed_ms=0`);

  trace.runHeader(runId, projectId, architectureId);
  trace.step('discovery run started — kind=database', { run: runId, project: projectId, arch: architectureId });
  trace.stageStart('SCAN', { run: runId, project: projectId, arch: architectureId });

  // Validate state transition before updating.
  try {
    validateStatusTransition('PENDING', 'RUNNING');
    await archModelClient.updateDiscoveryRun(projectId, runId, {
      status: 'RUNNING',
      current_step: 'database',
      steps_payload: { database: { status: 'running' } },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[RunManager:database] Failed to transition PENDING->RUNNING. error='${message}'`,
    );
    // Continue anyway -- the orchestrator is the source of truth for the run's
    // findings, and we don't want to lose a real DB discovery result over a
    // status-row hiccup.
  }

  try {
    const result = await runDatabasePackDiscovery({
      config,
      credentials,
      runContext,
    });

    // -------------------------------------------------------------------------
    // Persist candidates (one row per discovered table + per discovered
    // column). Mirrors the code-discovery batch flow at runManager.ts:958+,
    // but with a smaller pre-flight conversion step because the database
    // packs emit a lightweight payload shape rather than full
    // DiscoveryCandidate rows.
    //
    // Soft-fail policy: a batch error is logged but does NOT short-circuit
    // the loop. The orchestrator's introspection result is the run's source
    // of truth; partial persistence is better than zero persistence on a
    // transient AMS hiccup.
    // -------------------------------------------------------------------------
    let candidatesPersisted = 0;
    // Sequence-generator enrichment (2026-08-23, item 2): attach the
    // detected idiom + live rows + PROPOSED name->table.column mappings to
    // the sequence TABLE's own entity candidate — the foundations card
    // derives from candidate data, the human confirms the mapping.
    if (result.sequenceIdioms.length > 0) {
      const columnsByLower = new Map<string, Array<{ table: string; column: string }>>();
      for (const col of result.introspection.columns) {
        const key = String((col as { columnName?: string }).columnName ?? '').toLowerCase();
        if (!key) continue;
        const list = columnsByLower.get(key) ?? [];
        list.push({
          table: String((col as { tableName?: string }).tableName ?? ''),
          column: String((col as { columnName?: string }).columnName ?? ''),
        });
        columnsByLower.set(key, list);
      }
      for (const idiom of result.sequenceIdioms) {
        const target = result.candidates.find(
          (c) =>
            c.candidateType === 'physical_data_entities' &&
            String(c.name ?? '').toLowerCase() === idiom.seqTable.toLowerCase(),
        );
        if (!target) continue;
        const proposedMappings = (idiom.rows ?? [])
          .filter((r) => r.name)
          .map((r) => {
            const seqName = String(r.name);
            const lower = seqName.toLowerCase();
            // exact column-name match first, then suffix match
            // (`FilterWorkflowId` -> column `WorkflowId`).
            let matches = columnsByLower.get(lower) ?? [];
            let exact = true;
            if (matches.length === 0) {
              exact = false;
              for (const [colLower, list] of columnsByLower) {
                if (colLower.length >= 4 && lower.endsWith(colLower)) {
                  matches = [...matches, ...list];
                }
              }
            }
            return {
              sequenceName: seqName,
              currentValue: r.value,
              proposals: matches
                .filter((m) => m.table.toLowerCase() !== idiom.seqTable.toLowerCase())
                .slice(0, 3)
                .map((m) => ({ table: m.table, column: m.column, exact })),
            };
          });
        (target.data as Record<string, unknown>).sequence_generator_idiom = {
          procName: idiom.procName,
          numberColumn: idiom.numberColumn,
          nameColumn: idiom.nameColumn,
          rows: idiom.rows,
          proposedMappings,
        };
      }
    }
    // Parity-key probe enrichment (item 4): probes ride the table candidate
    // so the key-posture foundations card proposes a VERIFIED parity key.
    for (const probeEntry of result.keyProbes) {
      const target = result.candidates.find(
        (c) =>
          c.candidateType === 'physical_data_entities' &&
          String(c.name ?? '').toLowerCase() === probeEntry.tableName.toLowerCase(),
      );
      if (!target) continue;
      (target.data as Record<string, unknown>).parity_key_probes = probeEntry.probes;
    }
    if (result.candidates.length > 0) {
      const converted = convertDatabasePayloadsToCandidates(result.candidates, runId);
      const sortedCandidates = sortCandidatesParentsFirst(converted);
      const candidateBatchSize = 200;
      const totalBatches = Math.ceil(sortedCandidates.length / candidateBatchSize);
      const persistStart = Date.now();
      console.log(
        `[RunManager:database] Persisting ${sortedCandidates.length} candidates in ${totalBatches} batch(es) of ${candidateBatchSize}...`,
      );
      for (let i = 0; i < sortedCandidates.length; i += candidateBatchSize) {
        const batch = sortedCandidates.slice(i, i + candidateBatchSize);
        const batchNum = Math.floor(i / candidateBatchSize) + 1;
        const batchStart = Date.now();
        try {
          await archModelClient.bulkSaveCandidates(projectId, runId, batch);
          candidatesPersisted += batch.length;
          console.log(
            `[RunManager:database] Candidate batch ${batchNum}/${totalBatches} (${batch.length}) persisted in ${Date.now() - batchStart}ms`,
          );
        } catch (batchError: unknown) {
          const axiosErr = batchError as {
            response?: { status?: number; data?: unknown };
            message?: string;
          };
          const respBody = axiosErr.response?.data
            ? JSON.stringify(axiosErr.response.data).substring(0, 1000)
            : 'no response body';
          console.error(
            `[RunManager:database] Candidate batch ${batchNum}/${totalBatches} FAILED (${Date.now() - batchStart}ms): status=${axiosErr.response?.status}, body=${respBody}, message=${axiosErr.message}`,
          );
          console.warn(
            `[diag-runs] db_run=${(runId || '').slice(0, 8)} candidate_batch_fail batch=${batchNum}/${totalBatches}`,
          );
          // Intentionally do NOT throw -- keep going on the next batch.
        }
      }
      console.log(
        `[RunManager:database] Candidate persistence done: ${candidatesPersisted}/${sortedCandidates.length} in ${Date.now() - persistStart}ms`,
      );
    }

    const status = result.shortCircuited || !result.connectedOk ? 'FAILED' : 'COMPLETED';

    // ---- Automatic S0 snapshot (CSD, 2026-08-19 — user ruling): the DB
    // scan and the canonical-state pin are ONE action. On a successful scan
    // the validation service snapshots the source DB IMMEDIATELY, using the
    // scan's own harvested tables/keys and the same credentials — no
    // save-back wait, no separate step. FAIL-SOFT + LOUD: a snapshot
    // failure never fails the scan; the outcome (taken/failed/skipped +
    // snapshot id + reason) rides the run's steps payload so the scan
    // results answer "was S0 pinned?" directly.
    let s0Snapshot: import('./databasePacks/s0AutoSnapshot').S0AutoSnapshotOutcome | null =
      null;
    if (status === 'COMPLETED' && result.introspection.tables.length > 0) {
      const s0Start = Date.now();
      s0Snapshot = await takeS0AutoSnapshot({
        projectId,
        architectureId,
        config,
        credentials,
        introspection: result.introspection,
      });
      console.log(
        `[RunManager:database] S0 auto-snapshot ${s0Snapshot.status}` +
          (s0Snapshot.snapshotId ? ` id=${s0Snapshot.snapshotId}` : '') +
          ` tables=${s0Snapshot.tableCount} in ${Date.now() - s0Start}ms` +
          (s0Snapshot.detail ? ` detail=${s0Snapshot.detail}` : ''),
      );
      if (s0Snapshot.status === 'failed') {
        console.warn(
          `[diag-runs] db_run=${(runId || '').slice(0, 8)} s0_snapshot_failed ` +
            `detail=${(s0Snapshot.detail ?? 'unknown').slice(0, 200)}`,
        );
      }
    }

    const stepsPayload: Record<string, unknown> = {
      database: {
        status: status === 'COMPLETED' ? 'completed' : 'failed',
        engineKey: result.engineKey,
        connectedOk: result.connectedOk,
        tableCount: result.introspection.tables.length,
        columnCount: result.introspection.columns.length,
        viewCount: result.introspection.views.length,
        procedureCount: result.introspection.procedures.length,
        triggerCount: result.introspection.triggers.length,
        candidateCount: result.candidates.length,
        candidatesPersisted,
        findingCount: result.emittedFindings.length,
        warningCount: result.warningFindings.length,
        skippedTableCount: result.profile.skippedTables.length,
        // CSD auto-S0 (2026-08-19): taken | failed | skipped (+ id/reason).
        s0Snapshot,
        // Live stored-object harvest (2026-08-23): raw sources ride the run
        // so the CODE scan can merge repo-vs-live (live wins, drift loud).
        procSourceCount: result.procSources.length,
        proc_sources: result.procSources,
        sequenceIdiomCount: result.sequenceIdioms.length,
        // Item 3: detected server charset/sortorder — the pack + data plane
        // read this to declare the charset on extraction connections and to
        // raise the target-collation decision.
        server_charset: result.serverCharset,
        keyProbeTableCount: result.keyProbes.length,
      },
    };

    await archModelClient.updateDiscoveryRun(projectId, runId, {
      status,
      current_step: null,
      steps_payload: stepsPayload,
      error_message:
        status === 'FAILED'
          ? 'Database discovery run did not complete connect/testConnection. See pack warnings on the Findings tab.'
          : null,
    });

    const dbProfilingOn = config.profilingMode !== 'none';
    const dbCorr = { run: runId, project: projectId, arch: architectureId };
    const dbScanMsg =
      `database scan COMPLETED — ${result.introspection.tables.length} tables, ` +
      `${result.candidates.length} candidates, ${result.emittedFindings.length} findings, ` +
      `profiling ${dbProfilingOn ? 'ON' : 'OFF'}`;
    if (status === 'COMPLETED') {
      trace.ok(dbScanMsg, dbCorr);
    } else {
      trace.fail(dbScanMsg, dbCorr);
    }
    // SCAN predicates for the database-kind run: introspection surface +
    // persistence parity, then the stage-END scorecard.
    trace.predicate(
      'SCAN.DB.01', 'database introspection produced a surface',
      result.introspection.tables.length > 0,
      'tables > 0',
      `tables=${result.introspection.tables.length} candidates=${result.candidates.length} ` +
        `findings=${result.emittedFindings.length} profiling=${dbProfilingOn ? 'on' : 'off'}`,
      dbCorr,
    );
    trace.predicate(
      'SCAN.DB.02', 'database candidates persisted without loss',
      candidatesPersisted === result.candidates.length,
      'persisted == minted',
      `persisted=${candidatesPersisted}/${result.candidates.length}`,
      dbCorr,
    );
    trace.stageEnd('SCAN', dbCorr);

    console.log(
      `[RunManager:database] Run ${runId} ${status}: tables=${result.introspection.tables.length} candidates=${result.candidates.length} persisted=${candidatesPersisted} findings=${result.emittedFindings.length}`,
    );
    console.log(
      `[diag-runs] db_run=${(runId || '').slice(0, 8)} end ` +
        `status=${status.toLowerCase()} ` +
        `elapsed_ms=${Date.now() - dbRunStartedAt} ` +
        `candidates=${result.candidates.length} ` +
        `candidates_persisted=${candidatesPersisted} ` +
        `emitted=${result.emittedFindings.length} ` +
        `persisted=${result.emittedFindings.length}`,
    );
  } catch (err) {
    // Defense-in-depth -- the orchestrator NEVER throws per its contract,
    // but if a wiring bug causes it to propagate, log + persist FAILED.
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[RunManager:database] Run ${runId} unexpected error: ${message}`,
    );
    try {
      await archModelClient.updateDiscoveryRun(projectId, runId, {
        status: 'FAILED',
        current_step: null,
        error_message: `Database discovery failed: ${message}`,
      });
    } catch (persistErr) {
      const persistMessage =
        persistErr instanceof Error ? persistErr.message : String(persistErr);
      console.warn(
        `[RunManager:database] Failed to persist FAILED status. error='${persistMessage}'`,
      );
    }
  }
}
