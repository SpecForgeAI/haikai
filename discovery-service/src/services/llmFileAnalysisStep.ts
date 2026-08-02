/**
 * Phase-1 Analysis Orchestration Step (V3 entry point).
 *
 * This file historically owned the V2 LLM-first pipeline (scan plan ->
 * gateway LLM analyze-files -> convert to candidates -> evidence atoms ->
 * extension-pack enrichment). That path is no longer invoked: V3 inverts
 * the ordering (deterministic packs first, LLM gap-fill second) and is
 * the ONLY runtime pipeline.
 *
 * `executeLlmFileAnalysis` now:
 *   1. Builds the scan plan (same logic as before) to pick files of interest.
 *   2. Reads + truncates source files into a `Map<filePath, contents>`.
 *   3. Delegates to `runDiscoveryV3` (see `discoveryV3Pipeline.ts`) which
 *      runs the four V3 stages: LanguagePack.extract -> FrameworkPack.adapt
 *      -> Stage 3 stub marker (no LLM) -> candidate persist + tier persist.
 *
 * Exported helpers (`readSourceFile`, `sortCandidatesParentsFirst`) remain
 * available for existing callers and tests.
 *
 * Spec: V3 Discovery Pipeline Foundation (Task Group 5).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { buildScanPlan, buildScanPlanFromFilesystem, ScanPlanEntry, ScanPlanFilterOptions } from './scanPlanBuilder';
import { archModelClient } from './archModelClient';
import { DISCOVERY_FILE_LINE_LIMIT, DISCOVERY_FILE_ANALYSIS_LIMIT } from '../config';
import { DiscoveryCandidate } from '../types/candidate';
import { EvidenceAtom } from '../types/evidenceAtom';
import { EvidenceRelationship } from '../types/relationship';
import { DiscoveryConfigPayload } from '../types/projectContext';
import { runDiscoveryV3 } from './discoveryV3Pipeline';
import type { FindingEmitInput } from './findings/FindingEmitter';

/**
 * Bulk save batch size for evidence persistence.
 * Matches the BULK_SAVE_BATCH_SIZE in runManager.ts (500).
 * Defined locally to avoid circular dependency with runManager,
 * which will import executeLlmFileAnalysis in Task Group 9.
 */
const BULK_SAVE_BATCH_SIZE = 500;

/**
 * Result shape returned by the LLM file analysis orchestration step.
 */
export interface LlmFileAnalysisStepResult {
  /** Discovery candidates produced by LLM analysis + Extension Pack enrichment */
  candidates: DiscoveryCandidate[];
  /** Number of evidence atoms persisted (one per analyzed file) */
  evidenceCount: number;
  /** Number of files successfully analyzed */
  filesAnalyzed: number;
  /** Number of files that failed LLM analysis */
  filesFailed: number;
  /**
   * Findings built by the V3 pipeline, to be emitted by `runManager` AFTER
   * candidates persist (see `V3PipelineResult.findingInputs`). Bug-fix
   * 2026-05-29: deferring emission past candidate-persist is what makes the
   * findings' `discovery_candidate` links validate at AMS.
   */
  findingInputs?: FindingEmitInput[];
  /**
   * Advisory run-level `degraded` signal (Spec 2026-05-30 Oracle Integrity &
   * Determinism, Task Group 2). Forwarded verbatim from `V3PipelineResult`.
   * TRUE when the run COMPLETED but the captured model may be partial; rides
   * alongside COMPLETED, never a block. `runManager` persists it on the run
   * record at the COMPLETED branches.
   */
  degraded?: boolean;
  /** Reasons `degraded` tripped (Spec 2026-05-30). Forwarded from the V3 result. */
  degradedReasons?: string[];
}

/**
 * Optional parameters for service-scoped LLM file analysis.
 * These are only provided when running in service-scoped mode.
 *
 * Spec: Service-Scoped Discovery (TG8)
 */
export interface ServiceScopedAnalysisOptions {
  /**
   * Allowed candidate types for post-filtering after extension pack processing.
   * When provided, candidates whose candidateType is not in this list are
   * filtered out. When undefined/null, no filtering is applied (project-level).
   */
  allowedCandidateTypes?: string[];
  /**
   * Service ID for service-scoped candidate type selection in the gateway.
   * Forwarded to the gateway's analyze-files endpoint so the LLM prompt
   * uses SERVICE_SCOPED_CANDIDATE_TYPES instead of DEFAULT_CANDIDATE_TYPES.
   */
  serviceId?: string;
  /**
   * Service context string for LLM prompt injection.
   * Contains service name, description, core_tech, parent application and
   * app_component details. Forwarded to the gateway for prompt interpolation.
   */
  serviceContext?: string;
}

/**
 * Reads a source file from the repository directory, truncating at the
 * configured line limit. If the file exceeds DISCOVERY_FILE_LINE_LIMIT lines,
 * the content is truncated and a note is appended.
 *
 * @param repoDir - The root directory of the cloned repository
 * @param filePath - The relative file path within the repository
 * @returns The file content (possibly truncated), or null if the file cannot be read
 */
export async function readSourceFile(
  repoDir: string,
  filePath: string
): Promise<string | null> {
  try {
    const fullPath = path.join(repoDir, filePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    const lines = content.split('\n');

    if (lines.length > DISCOVERY_FILE_LINE_LIMIT) {
      const truncated = lines.slice(0, DISCOVERY_FILE_LINE_LIMIT).join('\n');
      return truncated + `\n\n[FILE TRUNCATED at ${DISCOVERY_FILE_LINE_LIMIT} lines]`;
    }

    return content;
  } catch {
    return null;
  }
}

/**
 * Sorts candidates so that parents always appear before their children.
 *
 * Required because the self-referencing FK constraint on parent_candidate_id
 * is checked IMMEDIATELY per INSERT in PostgreSQL. If a child is inserted
 * before its parent, the FK check fails. The LLM may return entities in any
 * order, so the conversion pipeline can produce a child before its parent
 * in the array. This function reorders them: root candidates first, then
 * their children, then grandchildren, etc.
 *
 * @param candidates - Unordered candidates (may have parent-child references)
 * @returns New array with parents always preceding their children
 */
export function sortCandidatesParentsFirst(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  const sorted: DiscoveryCandidate[] = [];
  const processedIds = new Set<string>();

  // First: all candidates with no parent
  for (const c of candidates) {
    if (!c.parentCandidateId) {
      sorted.push(c);
      processedIds.add(c.id);
    }
  }

  // Then: iteratively add children whose parent is already processed
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of candidates) {
      if (processedIds.has(c.id)) continue;
      if (c.parentCandidateId && processedIds.has(c.parentCandidateId)) {
        sorted.push(c);
        processedIds.add(c.id);
        changed = true;
      }
    }
  }

  // Finally: add any remaining (orphans whose parent isn't in this batch)
  // Null out their parentCandidateId to prevent FK constraint violations
  // (their parent doesn't exist in the candidate set or database)
  let orphanCount = 0;
  for (const c of candidates) {
    if (!processedIds.has(c.id)) {
      if (c.parentCandidateId) {
        console.warn(`[sortCandidatesParentsFirst] Orphan candidate "${c.name}" (${c.id}) references non-existent parent ${c.parentCandidateId} — clearing parentCandidateId`);
        c.parentCandidateId = undefined;
        orphanCount++;
      }
      sorted.push(c);
    }
  }
  if (orphanCount > 0) {
    console.warn(`[sortCandidatesParentsFirst] Cleared ${orphanCount} orphan parentCandidateId references`);
  }

  return sorted;
}

/**
 * Executes the discovery Phase-1 analysis step (V3 pipeline).
 *
 * Spec: V3 Discovery Pipeline Foundation (Task Group 5).
 *
 * This function is the public entry point invoked by `runManager.ts`. It is
 * the V3 pipeline: deterministic extension packs (LanguagePack ->
 * FrameworkPack) produce candidates first, the LLM gap-fill stage is
 * stubbed (Stage 3 writes a marker + 0 candidates), and the candidate
 * persist happens last. The V2 LLM-first runtime path was atomically
 * removed in Task Group 11 of the V3 Pack Migration Batch spec.
 *
 * The external contract (inputs + return shape) is unchanged so `runManager.ts`
 * does not need surgery. Details:
 *   - `filesAnalyzed`  = count of files the LanguagePack produced IR for.
 *   - `filesFailed`    = 0 in this spec (extractor failures are silently
 *                       omitted from the IR map, matching V2 extractor behaviour).
 *   - `evidenceCount`  = 0 in this spec (Stage 3 stub writes no evidence).
 *   - `candidates`     = Stage 1 + Stage 2 deterministic candidates.
 *
 * The 1a `atoms` and 1b `relationships` arguments are still accepted so
 * `runManager.ts` can call this without changes; they feed the scan plan that
 * determines which files the LanguagePack runs on.
 *
 * @param runId - The discovery run UUID
 * @param projectId - The project UUID
 * @param atoms - 1a evidence atoms (used for scan plan construction)
 * @param relationships - 1b evidence relationships (used for scan plan construction)
 * @param discoveryConfig - The discovery config payload (supplies techHints)
 * @param repoDir - The root directory of the cloned repository
 * @param serviceScopedOptions - Optional service-scoped parameters (TG8)
 * @returns V3 step result with candidates + file counters (evidenceCount is 0)
 */
export async function executeLlmFileAnalysis(
  runId: string,
  projectId: string,
  atoms: EvidenceAtom[],
  relationships: EvidenceRelationship[],
  discoveryConfig: DiscoveryConfigPayload,
  repoDir: string,
  serviceScopedOptions?: ServiceScopedAnalysisOptions,
  tier?: 'A' | 'B' | 'C'
): Promise<LlmFileAnalysisStepResult> {
  const repoConfig = discoveryConfig.repos?.[0] as Record<string, unknown> | undefined;
  const scanPlanFilter: ScanPlanFilterOptions = {
    includePaths: (repoConfig?.includePaths as string[]) || (discoveryConfig.includePaths as string[]) || [],
    excludePaths: (repoConfig?.excludePaths as string[]) || (discoveryConfig.excludePaths as string[]) || [],
  };
  const scanPlanStart = Date.now();
  let fullScanPlan: ScanPlanEntry[];

  if (atoms.length === 0 && serviceScopedOptions) {
    // Service-scoped run with no prior atoms — walk the filesystem directly.
    console.log(`[LlmFileAnalysis] No atoms available (service-scoped run). Building scan plan from filesystem at ${repoDir}...`);
    fullScanPlan = await buildScanPlanFromFilesystem(repoDir, undefined, scanPlanFilter);
  } else {
    console.log(`[LlmFileAnalysis] Building scan plan for run ${runId} (${atoms.length} atoms, ${relationships.length} relationships)...`);
    fullScanPlan = buildScanPlan(atoms, relationships, scanPlanFilter);
  }
  console.log(`[LlmFileAnalysis] Scan plan built in ${Date.now() - scanPlanStart}ms: ${fullScanPlan.length} files identified`);

  // Apply file analysis limit for subset testing.
  let scanPlan = fullScanPlan;
  if (DISCOVERY_FILE_ANALYSIS_LIMIT > 0 && fullScanPlan.length > DISCOVERY_FILE_ANALYSIS_LIMIT) {
    scanPlan = fullScanPlan.slice(0, DISCOVERY_FILE_ANALYSIS_LIMIT);
    console.log(`[LlmFileAnalysis] DISCOVERY_FILE_ANALYSIS_LIMIT=${DISCOVERY_FILE_ANALYSIS_LIMIT}: trimmed scan plan from ${fullScanPlan.length} to ${scanPlan.length} files`);
  }

  // Read source file contents from the repo, truncating at DISCOVERY_FILE_LINE_LIMIT.
  // The V3 pipeline consumes this `sourceFiles` map as its LanguagePack input.
  const readStart = Date.now();
  console.log(`[LlmFileAnalysis] Reading ${scanPlan.length} source files (line limit: ${DISCOVERY_FILE_LINE_LIMIT})...`);
  const sourceFiles = new Map<string, string>();
  let totalSourceChars = 0;
  let filesSkipped = 0;
  for (const entry of scanPlan) {
    const content = await readSourceFile(repoDir, entry.filePath);
    if (content !== null) {
      sourceFiles.set(entry.filePath, content);
      totalSourceChars += content.length;
    } else {
      filesSkipped++;
      console.warn(`[LlmFileAnalysis] Could not read file: ${entry.filePath}, skipping`);
    }
  }
  const readDurationMs = Date.now() - readStart;
  console.log(`[LlmFileAnalysis] Read ${sourceFiles.size} files in ${readDurationMs}ms (${filesSkipped} skipped, ~${Math.round(totalSourceChars / 1024)}KB total source)`);

  // Hand off to the V3 orchestrator. V3 runs LanguagePack -> FrameworkPack ->
  // Stage 3 stub -> candidate persist, and writes the computed tier onto the
  // run row. No LLM calls are made in this spec.
  const techHints = discoveryConfig.techHints || {};
  // Bug-10 root-cause fix (2026-04-21): `runManager` (both project-scoped and
  // service-scoped branches) invokes `bulkSaveCandidates` on the returned
  // candidates after this call. The V3 pipeline also persisted them
  // internally, producing exact-duplicate rows. Set `skipPersist: true` so
  // the pipeline returns candidates without saving; runManager owns the
  // single save path.
  const v3Result = await runDiscoveryV3({
    runId,
    projectId,
    sourceFiles,
    techHints,
    allowedCandidateTypes: serviceScopedOptions?.allowedCandidateTypes,
    // Operator-uploaded API contracts (2026-08-02): threaded verbatim to the
    // pipeline's contract passes as an authoritative Interface/Endpoint source.
    contractFiles: Array.isArray(discoveryConfig.contractFiles)
      ? discoveryConfig.contractFiles
      : undefined,
    tier,
    skipPersist: true,
    // Bug-fix 2026-05-28: forward the cloned-repo root so the spec-file
    // linker stage inside `runPackFindingScanners` can walk for OAS/Swagger
    // spec files. Without this, the linker stage is silently skipped at the
    // back-compat gate in `packFindingScanners/index.ts`.
    repoRoot: repoDir,
    // Operational-Artifact Scan scope (D1, Spec 2026-06-14): thread the SAME
    // include/exclude path filter the scan plan uses so the operational-artifact
    // re-walk scans ONLY in-scope files. For service-scoped runs `repoSubfolder`
    // is already folded into `includePaths` by `runManager`, so the walk roots
    // at `repoDir` and the include-paths filter scopes it (no separate subfolder
    // needed here). Repo-scoped runs pass empty filters => whole-repo walk.
    operationalArtifactScope: {
      includePaths: scanPlanFilter.includePaths,
      excludePaths: scanPlanFilter.excludePaths,
    },
  });

  const totalStepDuration = Date.now() - scanPlanStart;
  console.log(`[LlmFileAnalysis] === STEP COMPLETE === V3 tier=${v3Result.tier}, ${v3Result.candidates.length} candidates, ${v3Result.filesAnalyzed} files in IR. Total ${totalStepDuration}ms.`);

  // Bug-fix 2026-05-22 diagnostic: emit a `by_type` breakdown of the
  // candidates the LLM step is producing. Operators reported that
  // "interface" and "endpoint" candidates were appearing for Java DAOs
  // and other non-externally-exposed shapes -- distinguishing
  // LLM-emitted vs deterministic-pack-emitted candidates is the first
  // step in narrowing the over-classification source.
  //
  // Until the deterministic packs are correctly wired (the WADL/SOAP
  // wiring bug was fixed in the same change set), EVERY interface /
  // endpoint candidate seen by the dashboard comes from this step. With
  // the wiring fixed, deterministic candidates appear alongside LLM
  // ones and the by_type counts here capture the LLM contribution only.
  const candidateTypeCounts: Record<string, number> = {};
  for (const c of v3Result.candidates) {
    const k = c.candidateType || 'unknown';
    candidateTypeCounts[k] = (candidateTypeCounts[k] ?? 0) + 1;
  }
  console.log(
    `[diag-llm-step] candidates_by_type=${JSON.stringify(candidateTypeCounts)} ` +
      `tier=${v3Result.tier} filesAnalyzed=${v3Result.filesAnalyzed}`,
  );

  return {
    candidates: v3Result.candidates,
    evidenceCount: v3Result.evidenceCount,
    filesAnalyzed: v3Result.filesAnalyzed,
    filesFailed: v3Result.filesFailed,
    findingInputs: v3Result.findingInputs,
    // Spec 2026-05-30 Oracle Integrity & Determinism (Task Group 2): forward the
    // advisory degraded signal so `runManager` can persist it on the run record.
    degraded: v3Result.degraded,
    degradedReasons: v3Result.degradedReasons,
  };
}

/**
 * Normalizes a candidate name for deduplication comparison.
 * Converts PascalCase/camelCase to snake_case and lowercases.
 * e.g. "ScenarioType" -> "scenario_type", "scenario_type" -> "scenario_type"
 */
function normalizeCandidateName(name: string): string {
  // Insert underscore before uppercase letters preceded by lowercase (camelCase/PascalCase)
  const snaked = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
  return snaked;
}

/**
 * Deduplicates candidates by normalized name + candidate type.
 * For child entities (those with parentCandidateId), the parent's name
 * is included in the dedup key so that e.g. "id" on TableA and "id" on
 * TableB are treated as distinct candidates.
 * When duplicates exist, keeps the one with the highest confidence.
 * Merges source_cluster_ids from all duplicates into the kept candidate.
 */
function deduplicateCandidates(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  // Build a lookup from candidate ID to name for parent resolution
  const idToName = new Map<string, string>();
  for (const c of candidates) {
    idToName.set(c.id, c.name);
  }

  const groups = new Map<string, DiscoveryCandidate[]>();

  for (const candidate of candidates) {
    const normalizedName = normalizeCandidateName(candidate.name);
    // Include parent name in key for child entities to avoid cross-parent dedup
    const parentName = candidate.parentCandidateId
      ? normalizeCandidateName(idToName.get(candidate.parentCandidateId) || 'unknown')
      : '';
    const key = parentName
      ? `${candidate.candidateType}::${parentName}::${normalizedName}`
      : `${candidate.candidateType}::${normalizedName}`;
    const group = groups.get(key) || [];
    group.push(candidate);
    groups.set(key, group);
  }

  const deduplicated: DiscoveryCandidate[] = [];
  let totalDupsRemoved = 0;

  for (const [key, group] of groups.entries()) {
    // Sort by confidence descending, keep the best
    group.sort((a, b) => b.confidence - a.confidence);
    const best = group[0];

    // Merge source_cluster_ids from all duplicates
    if (group.length > 1) {
      const allSourceIds = new Set<string>();
      for (const c of group) {
        for (const id of c.sourceClusterIds) {
          allSourceIds.add(id);
        }
      }
      best.sourceClusterIds = Array.from(allSourceIds);
      totalDupsRemoved += group.length - 1;

      console.log(`[LlmFileAnalysis:dedup] "${key}" had ${group.length} duplicates, kept confidence=${best.confidence} from ${best.sourceClusterIds[0]}`);
    }

    deduplicated.push(best);
  }

  return deduplicated;
}
