/**
 * Context Resolver Interface and Live Registry
 *
 * Spec 2026-02-28: Unified Conversation Engine v1 (Backend)
 * Task Group 4: Registry Loader and Context Resolver Interfaces
 *
 * + Increment 8, Task Group 1: Live resolver implementations for
 *   mission, tech-stack, test-strategy, meta-model-summary.
 *
 * + Increment 9, Task Group 1: Live resolver implementations for
 *   product-summary, roadmap-summary.
 *
 * + Spec 2026-05-16 Migration Discovery Context Integration (Task Group 2):
 *   live resolver `migration-discovery-context` aggregating Current/Target
 *   State Architecture, discovery findings/evidence, decision tasks, API
 *   Behaviour Baselines, and current-to-target element mappings via
 *   `POST /api/projects/{projectId}/migration-discovery-context` on AMS.
 *
 * + Spec 2026-05-19 PM Migration Shape-Spec Batch Generation (Task Group 5,
 *   sub-task 5.3): registers the NEW `migration-spec-context` resolver key
 *   alongside the existing `migration-discovery-context` resolver. Per A-5
 *   this resolver is sibling-to (not replacement-for) the discovery-summary
 *   resolver and MAY internally delegate to it for project-level base context.
 *   The per-story focused-context HTTP call is owned by
 *   `migrationSpecContextClient.fetchMigrationSpecContext` (Group 5 client);
 *   this registry-resolver returns a project-level summary text suitable for
 *   prompt-time context injection.
 *
 * Defines the ContextResolver interface and provides a registry of resolver
 * implementations. Live resolvers read files from disk or call API endpoints.
 * Remaining keys that are not yet implemented use StubContextResolver (returns empty string).
 *
 * The registry is populated during initializeRegistries() alongside persona
 * and task registries.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { fetchProjectFolder, fetchMetaModelSummary, fetchProductSummary, fetchProductName, resolveDefaultArchitectureId } from './architectureModelClient';
import {
  fetchMigrationDiscoveryContext,
  MigrationDiscoveryContext,
  MigrationDiscoveryContextRequest,
} from './migrationDiscoveryContextClient';
import {
  fetchMostRecentSavedTargetArchitectureId,
  fetchLatestCapturedDecisions,
  TargetStateCapturedDecision,
} from './targetStateCapturedDecisionsClient';
import {
  TargetManifestArtifactWire,
  fetchLatestTargetManifestArtifacts,
} from './targetManifestArtifactsClient';
import {
  ADHOC_CODE_PREFIX,
  ADHOC_DECISION_CREATED_BY_TASK,
  NOTE_CODE_PREFIX,
  NOTE_CREATED_BY_TASK,
} from './architectConversation/openPhaseCodes';
import { buildRoadmapSummary } from './roadmapSummaryBuilder';
import { resolveCapturedAnswerSummary } from '../config/architect-conversation/frameworkVersionShape';
import { logger } from './logger';

/**
 * Interface for a context resolver.
 *
 * Each resolver is responsible for fetching a specific piece of context
 * (e.g., mission statement, tech stack) for a given project and thread.
 */
export interface ContextResolver {
  /**
   * Resolves context content for a given project and thread.
   *
   * @param projectId - The project identifier
   * @param threadKey - The serialized thread key string
   * @returns A promise resolving to the context content string (empty string on failure)
   */
  resolve(projectId: string, threadKey: string): Promise<string>;
}

/**
 * All known context-need keys that tasks may reference.
 * Each key maps to a resolver in the registry.
 */
const KNOWN_CONTEXT_KEYS: readonly string[] = [
  'mission',
  'tech-stack',
  'test-strategy',
  'roadmap-summary',
  'meta-model-summary',
  'product-summary',
  'existing-roadmap',
  'migration-discovery-context',
  // Spec 2026-05-19 PM Migration Shape-Spec Batch Generation (A-5).
  'migration-spec-context',
  // Spec 2026-05-24 Target State Captured Decisions -- Data Plane (Task Group 6).
  'target-state-decisions-context',
  // Spec 2026-05-25 Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write (Task Group 4).
  'target-tech-stack-context',
] as const;

/**
 * Stub resolver that always returns an empty string.
 * Used for context keys that do not yet have live implementations.
 */
class StubContextResolver implements ContextResolver {
  private readonly key: string;

  constructor(key: string) {
    this.key = key;
  }

  async resolve(_projectId: string, _threadKey: string): Promise<string> {
    // Stub implementation -- returns empty string
    // Live implementations will be provided in a future increment
    return '';
  }
}

/**
 * Live resolver for the 'mission' context key.
 * Reads MISSION.MD from {basePath}/agent-os/product/MISSION.MD with
 * uppercase-first, lowercase-fallback (same two-path pattern used in chatV2.ts).
 *
 * Returns the file content on success; returns empty string on ENOENT or any read error.
 *
 * Increment 8, Task Group 1 (Task 1.5)
 */
export class MissionContextResolver implements ContextResolver {
  async resolve(projectId: string, _threadKey: string): Promise<string> {
    const projectFolder = await fetchProjectFolder(projectId);
    const basePath = projectFolder || process.cwd();
    // Try uppercase first
    try {
      const uppercasePath = path.join(basePath, 'agent-os', 'product', 'MISSION.MD');
      const content = await fs.readFile(uppercasePath, 'utf-8');
      return content;
    } catch {
      // Try lowercase fallback
      try {
        const lowercasePath = path.join(basePath, 'agent-os', 'product', 'mission.md');
        const content = await fs.readFile(lowercasePath, 'utf-8');
        return content;
      } catch {
        logger.debug('MISSION.MD not found for context resolution (both paths tried)');
        return '';
      }
    }
  }
}

/**
 * Live resolver for the 'tech-stack' context key.
 * Reads TECH-STACK.MD from {basePath}/agent-os/product/TECH-STACK.MD with
 * uppercase-first, lowercase-fallback.
 *
 * Returns the file content on success; returns empty string on ENOENT or any read error.
 *
 * Increment 8, Task Group 1 (Task 1.6)
 */
export class TechStackContextResolver implements ContextResolver {
  async resolve(projectId: string, _threadKey: string): Promise<string> {
    const projectFolder = await fetchProjectFolder(projectId);
    const basePath = projectFolder || process.cwd();
    // Try uppercase first
    try {
      const uppercasePath = path.join(basePath, 'agent-os', 'product', 'TECH-STACK.MD');
      const content = await fs.readFile(uppercasePath, 'utf-8');
      return content;
    } catch {
      // Try lowercase fallback
      try {
        const lowercasePath = path.join(basePath, 'agent-os', 'product', 'tech-stack.md');
        const content = await fs.readFile(lowercasePath, 'utf-8');
        return content;
      } catch {
        logger.debug('TECH-STACK.MD not found for context resolution (both paths tried)');
        return '';
      }
    }
  }
}

/**
 * Live resolver for the 'test-strategy' context key.
 * Reads TEST-STRATEGY.MD from {basePath}/agent-os/product/TEST-STRATEGY.MD with
 * uppercase-first, lowercase-fallback.
 *
 * Returns the file content on success; returns empty string on ENOENT or any read error.
 * Test strategy is an optional artifact, so file-not-found is expected and not an error.
 *
 * Increment 8, Task Group 1 (Task 1.7)
 */
export class TestStrategyContextResolver implements ContextResolver {
  async resolve(projectId: string, _threadKey: string): Promise<string> {
    const projectFolder = await fetchProjectFolder(projectId);
    const basePath = projectFolder || process.cwd();
    // Try uppercase first
    try {
      const uppercasePath = path.join(basePath, 'agent-os', 'product', 'TEST-STRATEGY.MD');
      const content = await fs.readFile(uppercasePath, 'utf-8');
      return content;
    } catch {
      // Try lowercase fallback
      try {
        const lowercasePath = path.join(basePath, 'agent-os', 'product', 'test-strategy.md');
        const content = await fs.readFile(lowercasePath, 'utf-8');
        return content;
      } catch {
        logger.debug('TEST-STRATEGY.MD not found for context resolution (both paths tried)');
        return '';
      }
    }
  }
}

/**
 * Live resolver for the 'meta-model-summary' context key.
 * Resolves the project's Default architecture id, then calls
 * fetchMetaModelSummary(projectId, architectureId) and returns
 * JSON.stringify(result).
 *
 * Returns JSON-stringified result on success; returns empty string if result is
 * null/undefined, the default architecture cannot be resolved, or on API error.
 *
 * Increment 8, Task Group 1 (Task 1.8)
 * Spec 2026-05-01 Multi-Architecture Plumbing - Task Group 3:
 *   resolves the project's Default architecture before the Bucket A call.
 */
export class MetaModelSummaryContextResolver implements ContextResolver {
  async resolve(projectId: string, _threadKey: string): Promise<string> {
    try {
      const architectureId = await resolveDefaultArchitectureId(projectId);
      if (!architectureId) {
        logger.debug('MetaModelSummary context resolution skipped: no default architecture', { projectId });
        return '';
      }
      const result = await fetchMetaModelSummary(projectId, architectureId);
      if (result == null) {
        return '';
      }
      return JSON.stringify(result);
    } catch (error) {
      logger.debug('MetaModelSummary context resolution failed', {
        projectId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return '';
    }
  }
}

/**
 * Live resolver for the 'product-summary' context key.
 * Calls fetchProductSummary(projectId) and returns a formatted string
 * combining the roadmap summary from buildRoadmapSummary().
 *
 * Returns the formatted string on success; returns empty string if result is
 * null/undefined or on API error (graceful degradation).
 *
 * Increment 9, Task Group 1 (Task 1.6)
 */
export class ProductSummaryContextResolver implements ContextResolver {
  async resolve(projectId: string, _threadKey: string): Promise<string> {
    try {
      const result = await fetchProductSummary(projectId);
      if (result == null) {
        return '';
      }

      // Build a formatted product summary string
      const parts: string[] = [];
      parts.push('Product Summary:');

      // Include roadmap summary (initiative/epic overview)
      const roadmapSummary = buildRoadmapSummary(result);
      if (roadmapSummary) {
        parts.push('');
        parts.push('Roadmap Overview:');
        parts.push(roadmapSummary);
      } else {
        parts.push('No roadmap initiatives or epics found.');
      }

      return parts.join('\n');
    } catch (error) {
      logger.debug('ProductSummary context resolution failed', {
        projectId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return '';
    }
  }
}

/**
 * Live resolver for the 'roadmap-summary' context key.
 * Calls fetchProductSummary(projectId) then buildRoadmapSummary(result)
 * to produce a condensed L1/L2 text summary of initiatives and epics.
 *
 * Returns the summary string on success; returns empty string if result is
 * null/undefined or on API error (graceful degradation).
 *
 * Increment 9, Task Group 1 (Task 1.7)
 */
export class RoadmapSummaryContextResolver implements ContextResolver {
  async resolve(projectId: string, _threadKey: string): Promise<string> {
    try {
      const result = await fetchProductSummary(projectId);
      if (result == null) {
        return '';
      }
      return buildRoadmapSummary(result);
    } catch (error) {
      logger.debug('RoadmapSummary context resolution failed', {
        projectId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return '';
    }
  }
}

/**
 * Live resolver for the 'existing-roadmap' context key (gold standard
 * 2026-08-07). This key was the ONE remaining stub — the migration delivery
 * plan and roadmap tasks declare it in contextNeeds and silently received an
 * EMPTY STRING, so plan generation never saw the roadmap it was asked to
 * align with. Reads the saved roadmap document from the project workspace
 * (the mission/tech-stack file idiom); falls back to the condensed
 * roadmap summary when no file exists so the context is never silently
 * empty while a roadmap is known to AMS.
 */
export class ExistingRoadmapContextResolver implements ContextResolver {
  async resolve(projectId: string, threadKey: string): Promise<string> {
    const projectFolder = await fetchProjectFolder(projectId);
    const basePath = projectFolder || process.cwd();
    for (const candidate of [
      path.join(basePath, 'agent-os', 'product', 'ROADMAP.MD'),
      path.join(basePath, 'agent-os', 'product', 'roadmap.md'),
      path.join(basePath, 'haikai', 'product', 'roadmap.md'),
    ]) {
      try {
        const content = await fs.readFile(candidate, 'utf-8');
        if (content.trim().length > 0) return content;
      } catch {
        /* try the next candidate */
      }
    }
    // No roadmap file — fall back to the condensed summary rather than an
    // empty string (the summary resolver already degrades gracefully).
    return new RoadmapSummaryContextResolver().resolve(projectId, threadKey);
  }
}

/**
 * Maximum length (in characters) of the prompt-ready text produced by
 * {@link MigrationDiscoveryContextResolver}. Count-based bound only per
 * shaping decision D7 -- token-budget-aware trimming is a v2 enhancement.
 */
export const MIGRATION_DISCOVERY_CONTEXT_MAX_CHARS = 8000;

/**
 * Internal: render a key/value count map as a comma-separated "k:v" string.
 * Sorts keys for deterministic output. Skips empty / null maps.
 */
function renderCountMap(map: Record<string, number> | undefined | null): string {
  if (!map) return '';
  const keys = Object.keys(map).filter((k) => Number.isFinite(map[k]));
  if (keys.length === 0) return '';
  keys.sort();
  return keys.map((k) => `${k}:${map[k]}`).join(', ');
}

/**
 * Internal: bound a string to the configured maximum char count, appending an
 * explicit truncation marker so the LLM can see the cut-off.
 */
function boundOutput(text: string, max: number): string {
  if (text.length <= max) return text;
  const marker = '\n[truncated -- exceeds prompt char budget]';
  return text.substring(0, Math.max(0, max - marker.length)) + marker;
}

/**
 * Build the prompt-ready bounded text view of a `MigrationDiscoveryContext`.
 *
 * Includes: high-level summary, current/target architecture entity counts,
 * findings summary with high-priority finding titles + ids, evidence highlight
 * ids, unresolved decision task ids, runtime/DB roll-ups, API behaviour
 * baseline header summary, mapping coverage counts, explicit readiness gap
 * codes, and an instruction line so prompt-callers do not invent missing
 * details.
 *
 * Exported for unit testing. Callers should prefer the resolver class.
 */
export function buildMigrationDiscoveryContextPromptText(
  ctx: MigrationDiscoveryContext
): string {
  const lines: string[] = [];

  lines.push('Migration Discovery Context');
  lines.push('===========================');
  lines.push(`Project: ${ctx.projectId}`);
  lines.push(`Current Architecture: ${ctx.currentArchitectureId}`);
  if (ctx.targetArchitectureId) {
    lines.push(`Target Architecture:  ${ctx.targetArchitectureId}`);
  } else {
    lines.push('Target Architecture:  (none)');
  }
  lines.push(`Generated At: ${ctx.generatedAt}`);
  if (ctx.discoveryRunIds && ctx.discoveryRunIds.length > 0) {
    lines.push(`Discovery Run IDs: ${ctx.discoveryRunIds.join(', ')}`);
  }
  if (ctx.apiBehaviourBaselineIds && ctx.apiBehaviourBaselineIds.length > 0) {
    lines.push(`API Behaviour Baseline IDs: ${ctx.apiBehaviourBaselineIds.join(', ')}`);
  }
  lines.push('');

  if (ctx.summary) {
    lines.push('Summary');
    lines.push('-------');
    lines.push(ctx.summary);
    lines.push('');
  }

  // Current architecture highlights
  if (ctx.currentArchitectureSummary) {
    const a = ctx.currentArchitectureSummary;
    lines.push('Current Architecture Highlights');
    lines.push('-------------------------------');
    lines.push(`Name: ${a.name} (id ${a.architectureId})`);
    const counts: string[] = [];
    if (a.applicationCount != null) counts.push(`applications=${a.applicationCount}`);
    if (a.serviceCount != null) counts.push(`services=${a.serviceCount}`);
    if (a.interfaceCount != null) counts.push(`interfaces=${a.interfaceCount}`);
    if (a.dataEntityCount != null) counts.push(`dataEntities=${a.dataEntityCount}`);
    if (a.dataStoreCount != null) counts.push(`dataStores=${a.dataStoreCount}`);
    if (a.businessUserCount != null) counts.push(`businessUsers=${a.businessUserCount}`);
    if (a.processActivityCount != null) counts.push(`processActivities=${a.processActivityCount}`);
    if (a.uiScreenCount != null) counts.push(`uiScreens=${a.uiScreenCount}`);
    if (a.userJourneyCount != null) counts.push(`userJourneys=${a.userJourneyCount}`);
    if (counts.length > 0) lines.push(`Entity counts: ${counts.join(', ')}`);
    if (a.hasModel === false) lines.push('NOTE: architecture has no model loaded.');
    lines.push('');
  }

  // Target architecture highlights (when present)
  if (ctx.targetArchitectureSummary) {
    const a = ctx.targetArchitectureSummary;
    lines.push('Target Architecture Highlights');
    lines.push('------------------------------');
    lines.push(`Name: ${a.name} (id ${a.architectureId})`);
    const counts: string[] = [];
    if (a.applicationCount != null) counts.push(`applications=${a.applicationCount}`);
    if (a.serviceCount != null) counts.push(`services=${a.serviceCount}`);
    if (a.interfaceCount != null) counts.push(`interfaces=${a.interfaceCount}`);
    if (a.dataEntityCount != null) counts.push(`dataEntities=${a.dataEntityCount}`);
    if (a.dataStoreCount != null) counts.push(`dataStores=${a.dataStoreCount}`);
    if (a.businessUserCount != null) counts.push(`businessUsers=${a.businessUserCount}`);
    if (a.processActivityCount != null) counts.push(`processActivities=${a.processActivityCount}`);
    if (a.uiScreenCount != null) counts.push(`uiScreens=${a.uiScreenCount}`);
    if (a.userJourneyCount != null) counts.push(`userJourneys=${a.userJourneyCount}`);
    if (counts.length > 0) lines.push(`Entity counts: ${counts.join(', ')}`);
    lines.push('');
  }

  // Findings summary + high priority findings
  if (ctx.findingsSummary) {
    const f = ctx.findingsSummary;
    lines.push('Findings Summary');
    lines.push('----------------');
    if (f.totalFindings != null) lines.push(`Total findings: ${f.totalFindings}`);
    if (f.highSeverityUnreviewedCount != null) {
      lines.push(`High-severity unreviewed: ${f.highSeverityUnreviewedCount}`);
    }
    if (f.sampleDataHintCount != null) {
      lines.push(`Sample-data hints: ${f.sampleDataHintCount}`);
    }
    const byStatus = renderCountMap(f.countsByStatus);
    if (byStatus) lines.push(`By status: ${byStatus}`);
    const bySeverity = renderCountMap(f.countsBySeverity);
    if (bySeverity) lines.push(`By severity: ${bySeverity}`);
    const byCategory = renderCountMap(f.countsByCategory);
    if (byCategory) lines.push(`By category: ${byCategory}`);
    lines.push('');
  }

  if (ctx.highPriorityFindings && ctx.highPriorityFindings.length > 0) {
    lines.push('High-Priority Findings');
    lines.push('----------------------');
    for (const f of ctx.highPriorityFindings) {
      const conf = f.confidence != null ? ` confidence=${f.confidence.toFixed(2)}` : '';
      lines.push(
        `- [${f.severity}/${f.status}/${f.category}] ${f.title} ` +
          `(findingId=${f.findingId}, runId=${f.runId}, type=${f.findingType}${conf})`
      );
      if (f.summary) {
        lines.push(`    summary: ${f.summary}`);
      }
    }
    lines.push('');
  }

  // Evidence highlights (references only; bounded list)
  if (ctx.evidenceHighlights && ctx.evidenceHighlights.length > 0) {
    lines.push('Evidence Highlights');
    lines.push('-------------------');
    for (const e of ctx.evidenceHighlights) {
      const linked = e.linkedFindingIds && e.linkedFindingIds.length > 0
        ? ` linkedFindingIds=[${e.linkedFindingIds.join(',')}]`
        : '';
      const src = e.source ? ` source=${e.source}` : '';
      const file = e.filePath ? ` file=${e.filePath}` : '';
      lines.push(`- evidenceId=${e.evidenceId} type=${e.type}${src}${file}${linked}`);
    }
    lines.push('');
  }

  // Unresolved decision tasks
  if (ctx.unresolvedDecisionTasks && ctx.unresolvedDecisionTasks.length > 0) {
    lines.push(`Unresolved Decision Tasks (${ctx.unresolvedDecisionTasks.length})`);
    lines.push('------------------------');
    for (const t of ctx.unresolvedDecisionTasks) {
      lines.push(`- taskId=${t.taskId} type=${t.taskType} status=${t.status} runId=${t.runId}`);
    }
    lines.push('');
  }

  // Runtime usage roll-up
  if (ctx.runtimeUsageSummary) {
    const r = ctx.runtimeUsageSummary;
    lines.push('Runtime Usage Summary');
    lines.push('---------------------');
    if (r.runtimeEvidenceCount != null) lines.push(`Runtime evidence count: ${r.runtimeEvidenceCount}`);
    if (r.runtimeFindingCount != null) lines.push(`Runtime finding count: ${r.runtimeFindingCount}`);
    if (r.hasRuntimeEvidence === false) {
      lines.push('NOTE: no runtime evidence linked to this architecture.');
    }
    lines.push('');
  }

  // Database discovery roll-up
  if (ctx.databaseDiscoverySummary) {
    const d = ctx.databaseDiscoverySummary;
    lines.push('Database Discovery Summary');
    lines.push('--------------------------');
    if (d.databaseFindingCount != null) lines.push(`Database findings: ${d.databaseFindingCount}`);
    if (d.databaseRunCount != null) lines.push(`Database runs: ${d.databaseRunCount}`);
    if (d.sampleDataHintCount != null) lines.push(`Sample-data hints: ${d.sampleDataHintCount}`);
    if (d.hasDatabaseDiscovery === false) {
      lines.push('NOTE: no database discovery findings linked.');
    }
    lines.push('');
  }

  // API behaviour baseline coverage
  if (ctx.apiBehaviourBaselineSummary) {
    const b = ctx.apiBehaviourBaselineSummary;
    lines.push('API Behaviour Baseline Coverage');
    lines.push('-------------------------------');
    if (b.totalBaselines != null) lines.push(`Total baselines: ${b.totalBaselines}`);
    if (b.activeBaselineCount != null) lines.push(`Active: ${b.activeBaselineCount}`);
    if (b.draftBaselineCount != null) lines.push(`Draft: ${b.draftBaselineCount}`);
    if (b.baselines && b.baselines.length > 0) {
      for (const h of b.baselines) {
        const session = h.sessionId ? ` sessionId=${h.sessionId}` : '';
        lines.push(
          `- baselineId=${h.baselineId} name="${h.name}" status=${h.status} ` +
            `operationCount=${h.operationCount ?? 0} ` +
            `acceptedCaptureCount=${h.acceptedCaptureCount ?? 0}${session}`
        );
      }
    }
    lines.push('');
  }

  // Architecture mappings coverage
  if (ctx.architectureMappingsSummary) {
    const m = ctx.architectureMappingsSummary;
    lines.push('Architecture Mappings Coverage');
    lines.push('------------------------------');
    if (m.totalMappings != null) lines.push(`Total mappings: ${m.totalMappings}`);
    const bySrc = renderCountMap(m.countsBySourceType);
    if (bySrc) lines.push(`By source type: ${bySrc}`);
    const byTgt = renderCountMap(m.countsByTargetType);
    if (byTgt) lines.push(`By target type: ${byTgt}`);
    const byKind = renderCountMap(m.countsByMappingType);
    if (byKind) lines.push(`By mapping type: ${byKind}`);
    lines.push('');
  }

  // Readiness gaps -- explicit, never invented
  if (ctx.readinessAssessment) {
    const r = ctx.readinessAssessment;
    lines.push('Readiness Assessment');
    lines.push('--------------------');
    lines.push(`Overall: ${r.overallStatus}`);
    if (r.apiReadiness) lines.push(`API:           ${r.apiReadiness}`);
    if (r.dataReadiness) lines.push(`Data:          ${r.dataReadiness}`);
    if (r.infrastructureReadiness) lines.push(`Infrastructure: ${r.infrastructureReadiness}`);
    if (r.discoveryReadiness) lines.push(`Discovery:     ${r.discoveryReadiness}`);
    if (r.mappingReadiness) lines.push(`Mapping:       ${r.mappingReadiness}`);
    if (r.baselineReadiness) lines.push(`Baseline:      ${r.baselineReadiness}`);
    if (r.decisionReadiness) lines.push(`Decision:      ${r.decisionReadiness}`);
    if (r.gaps && r.gaps.length > 0) {
      lines.push(`Readiness gaps: ${r.gaps.join(', ')}`);
    } else {
      lines.push('Readiness gaps: (none)');
    }
    lines.push('');
  }

  if (ctx.contextWarnings && ctx.contextWarnings.length > 0) {
    lines.push('Context Warnings');
    lines.push('----------------');
    for (const w of ctx.contextWarnings) {
      lines.push(`- ${w}`);
    }
    lines.push('');
  }

  lines.push(
    'If the context above is insufficient or any required input is missing, recommend ' +
      'the specific prerequisite work (e.g. capture an API Behaviour Baseline, resolve ' +
      'open discovery decision tasks, add current->target element mappings) rather than ' +
      'inventing details that are not supported by the discovery findings, evidence, or ' +
      'baselines listed above.'
  );

  return boundOutput(lines.join('\n'), MIGRATION_DISCOVERY_CONTEXT_MAX_CHARS);
}

/**
 * Live resolver for the 'migration-discovery-context' context key.
 *
 * Resolves the project's Default architecture via `resolveDefaultArchitectureId`
 * (matches the `MetaModelSummaryContextResolver` precedent), then calls AMS
 * `POST /api/projects/{projectId}/migration-discovery-context` with a minimal
 * default request body (current architecture only; include flags default true;
 * default limits 100/100). Transforms the response into a prompt-ready bounded
 * text view via {@link buildMigrationDiscoveryContextPromptText}.
 *
 * Fail-soft: any error -- missing default architecture, AMS unreachable, AMS
 * non-2xx, malformed response -- returns a short status string instead of
 * throwing so prompt-callers do not crash. Insufficient context surfaces as
 * explicit gap entries in the prompt-ready output; this resolver never invents
 * missing details.
 *
 * Spec: 2026-05-16 Migration Discovery Context Integration -- Task Group 2 (D6, D8).
 */
export class MigrationDiscoveryContextResolver implements ContextResolver {
  async resolve(projectId: string, _threadKey: string): Promise<string> {
    try {
      const architectureId = await resolveDefaultArchitectureId(projectId);
      if (!architectureId) {
        logger.debug(
          'MigrationDiscoveryContext resolution skipped: no default architecture',
          { projectId }
        );
        console.warn(
          `[diag-gw] resolver=migration-discovery-context result=fallback reason=no_default_architecture`,
        );
        return 'Migration discovery context unavailable: project has no default architecture.';
      }

      const request: MigrationDiscoveryContextRequest = {
        currentArchitectureId: architectureId,
        // All include flags default true at the AMS service layer when null.
        // We send `undefined` here for the cleanest wire shape; the same effect
        // could be achieved by explicitly setting each to true.
      };

      const ctx = await fetchMigrationDiscoveryContext(projectId, request);
      if (!ctx) {
        console.warn(
          `[diag-gw] resolver=migration-discovery-context result=fallback reason=empty_response`,
        );
        return 'Migration discovery context unavailable: empty response from architecture model service.';
      }

      const text = buildMigrationDiscoveryContextPromptText(ctx);
      console.log(
        `[diag-gw] resolver=migration-discovery-context result=ok ` +
          `char_count=${text.length}`,
      );
      return text;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.debug('MigrationDiscoveryContext resolution failed', {
        projectId,
        error: message,
      });
      // Category-only diag log. Never log the AMS error message.
      const anyErr = error as { response?: { status?: number }; code?: string };
      const status = anyErr?.response?.status;
      let reason = 'unknown';
      if (typeof status === 'number') {
        if (status >= 500) reason = 'ams_5xx';
        else if (status === 404) reason = 'ams_not_found';
        else if (status >= 400) reason = 'ams_4xx';
      } else if (anyErr?.code === 'ECONNREFUSED' || anyErr?.code === 'ECONNRESET') {
        reason = 'ams_unreachable';
      } else if (anyErr?.code === 'ETIMEDOUT') {
        reason = 'ams_timeout';
      } else if (typeof anyErr?.code === 'string') {
        reason = 'network_error';
      }
      console.warn(
        `[diag-gw] resolver=migration-discovery-context result=fallback reason=${reason}`,
      );
      return `Migration discovery context unavailable: ${message}`;
    }
  }
}

/**
 * Live resolver for the 'migration-spec-context' context key.
 *
 * Sibling-to (NOT replacement-for) {@link MigrationDiscoveryContextResolver}
 * per A-5 of the PM Migration Shape-Spec Batch Generation spec (2026-05-19).
 * This resolver returns the same project-level migration-discovery summary the
 * existing resolver returns -- the per-story focused-context HTTP call shape
 * needs `bookOfWorkId`, `bookItemId`, `workItemId`, and `contextTypes[]` which
 * are NOT available at registry-resolution time (the registry surfaces
 * project-level context only).
 *
 * Per-story focused-context fetches happen INSIDE the batch generation handler
 * (`gateway/src/services/migrationShapeSpecGenerationHandler.ts`, Group 6) via
 * direct calls to `fetchMigrationSpecContext` (Group 5's client). The registry
 * entry is documented so PM task configs can list `migration-spec-context` in
 * their `contextNeeds[]` and surface a project-level pre-call summary.
 *
 * Fail-soft semantics mirror the discovery-context resolver: any error returns
 * a short status string instead of throwing.
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation -- Task Group 5
 * (sub-task 5.3, picked up by Group 6's wiring per the implementer task note).
 */
export class MigrationSpecContextResolver implements ContextResolver {
  /**
   * Internally delegates to {@link MigrationDiscoveryContextResolver} for the
   * project-level base context, per A-5. The per-story drill-down lives in the
   * batch handler.
   */
  private readonly delegate: MigrationDiscoveryContextResolver;

  constructor(delegate?: MigrationDiscoveryContextResolver) {
    this.delegate = delegate ?? new MigrationDiscoveryContextResolver();
  }

  async resolve(projectId: string, threadKey: string): Promise<string> {
    try {
      const base = await this.delegate.resolve(projectId, threadKey);
      console.log(
        `[diag-gw] resolver=migration-spec-context result=ok ` +
          `char_count=${base.length}`,
      );
      return base;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.debug('MigrationSpecContext resolution failed', {
        projectId,
        error: message,
      });
      console.warn(
        `[diag-gw] resolver=migration-spec-context result=fallback reason=delegate_error`,
      );
      return `Migration spec context unavailable: ${message}`;
    }
  }
}

/**
 * Live resolver for the 'target-state-decisions-context' context key.
 *
 * Calls Architecture Model Service:
 *   1. GET /api/projects/{projectId}/active-target-architecture-id
 *   2. GET /api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions
 *      (latest non-superseded rows only -- the controller defaults
 *      includeSuperseded=false when the query parameter is absent)
 *
 * Returns three distinct outputs depending on state (Q12 from the requirements):
 *   - 'no target architecture defined yet'  -- most-recent-saved target id is null
 *   - 'no decisions captured yet'           -- saved target exists but list is empty
 *   - a bounded grouped-by-scope markdown summary, architecture-wide block first,
 *     then per-service / per-interface / per-element overrides (each non-empty
 *     scope rendered as its own subsection). Each line carries decisionCode,
 *     answerSummary, and the optional standardsLookupRef parenthetical.
 *
 * No transcript content (per Q5 -- transcript is queryable separately by Spec 3
 * once it lands). No size cap (per Q14 -- the question library is bounded by
 * design). Plain English in fallback strings -- no invented acronyms.
 *
 * Fail-soft: any error from the architecture model service (network, non-2xx,
 * malformed body) returns a short status string instead of throwing so the
 * prompt assembly path does not crash.
 *
 * Spec: 2026-05-24 Target State Captured Decisions -- Data Plane -- Task Group 6.
 *
 * Note on the proxy routes added in Task Group 5: this resolver runs inside
 * the gateway and calls the architecture model service directly via the typed
 * client, mirroring the MigrationDiscoveryContextResolver pattern. The gateway
 * proxy routes exist to serve the frontend and other gateway-external callers.
 */
/**
 * Fetch the persisted Tier-2 "free facts" for a target architecture and render
 * them as "<friendly name> - <coordinate>" labels (em-dash separated; deduped,
 * first-seen order).
 *
 * Reads the `tier2_facts` JSONB off the latest `target_manifest_artifacts` rows
 * (one per tag; the upload-global facts are carried on every row, so a union +
 * dedupe yields the set). FAIL-SOFT: any read error / malformed wire returns an
 * empty list so the decisions prompt still renders. Spec 2026-06-26 Task Group 7.
 */
async function fetchTier2FreeFactLabels(
  projectId: string,
  targetArchitectureId: string,
): Promise<string[]> {
  try {
    const artifacts = await fetchLatestTargetManifestArtifacts(projectId, targetArchitectureId);
    const labels: string[] = [];
    const seen = new Set<string>();
    for (const artifact of artifacts as TargetManifestArtifactWire[]) {
      const facts = Array.isArray(artifact.tier2_facts) ? artifact.tier2_facts : [];
      for (const fact of facts) {
        const friendly =
          fact && typeof fact.friendly_name === 'string' ? fact.friendly_name.trim() : '';
        const coordinate =
          fact && typeof fact.coordinate === 'string' ? fact.coordinate.trim() : '';
        if (friendly.length === 0 && coordinate.length === 0) continue;
        const label = coordinate.length > 0 ? `${friendly} \u2014 ${coordinate}` : friendly;
        if (seen.has(label)) continue;
        seen.add(label);
        labels.push(label);
      }
    }
    return labels;
  } catch (error) {
    logger.debug('Target state decisions context: tier-2 free-facts fetch failed (fail-soft)', {
      projectId,
      targetArchitectureId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return [];
  }
}

export class TargetStateDecisionsContextResolver implements ContextResolver {
  async resolve(projectId: string, _threadKey: string): Promise<string> {
    // Spec 2026-06-26 Task Group 3: source the plan from the most-recent-SAVED
    // target conversation (decoupled from the "active" target architecture) so
    // decisions authored against an un-promoted draft are visible to the plan.
    let savedTargetId: string | null;
    try {
      const response = await fetchMostRecentSavedTargetArchitectureId(projectId);
      savedTargetId = response?.savedTargetArchitectureId ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.debug('Target state decisions context: saved target lookup failed', {
        projectId,
        error: message,
      });
      console.warn(
        `[diag-gw] resolver=target-state-decisions-context result=fallback reason=saved_target_lookup_error`,
      );
      return `Target state decisions context unavailable: ${message}`;
    }

    if (!savedTargetId) {
      console.log(
        `[diag-gw] resolver=target-state-decisions-context result=ok reason=no_saved_conversation`,
      );
      return 'no target architecture defined yet';
    }

    let decisions: TargetStateCapturedDecision[];
    try {
      decisions = await fetchLatestCapturedDecisions(projectId, savedTargetId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.debug('Target state decisions context: captured-decisions list failed', {
        projectId,
        savedTargetId,
        error: message,
      });
      console.warn(
        `[diag-gw] resolver=target-state-decisions-context result=fallback reason=captured_decisions_lookup_error`,
      );
      return `Target state decisions context unavailable: ${message}`;
    }

    if (!decisions || decisions.length === 0) {
      console.log(
        `[diag-gw] resolver=target-state-decisions-context result=ok reason=no_decisions`,
      );
      return 'no decisions captured yet';
    }

    // Spec 2026-06-26 Task Group 7: read the persisted Tier-2 "free facts"
    // (manifest-declared tech outside the 51 questions) and feed them into the
    // prompt-ready output. Fail-soft inside the helper (no facts -> no section).
    // Fetched against the SAME resolved saved target so decisions + facts bind
    // to one target and cannot diverge (Task Group 3).
    const tier2Facts = await fetchTier2FreeFactLabels(projectId, savedTargetId);
    const text = buildTargetStateDecisionsPromptText(decisions, tier2Facts);
    console.log(
      `[diag-gw] resolver=target-state-decisions-context result=ok char_count=${text.length} decision_count=${decisions.length} tier2_fact_count=${tier2Facts.length}`,
    );
    return text;
  }
}

/**
 * Discriminate the two open-phase captured-decision row kinds (Spec
 * 2026-06-06 Architect Conversation -- Open-Ended LLM Phase, Task Group 5).
 *
 * Both the user-raised `adhoc.<slug>` decision rows and the free-form
 * `note.<slug>` note rows are written with `scopeKind:'architecture'`, so a
 * naive scope filter would fold them into the generic `### Architecture-wide`
 * block alongside the preset decisions. We instead partition them out into
 * their own sections. The discriminator is BELT-AND-BRACES: the
 * `decision_code` namespace prefix is the primary signal and the distinct
 * `createdByTask` is the secondary signal, so a row is classified even if one
 * dimension drifts.
 */
function isAdhocDecisionRow(d: TargetStateCapturedDecision): boolean {
  return (
    d.decisionCode.startsWith(`${ADHOC_CODE_PREFIX}.`) ||
    d.createdByTask === ADHOC_DECISION_CREATED_BY_TASK
  );
}

function isNoteRow(d: TargetStateCapturedDecision): boolean {
  return (
    d.decisionCode.startsWith(`${NOTE_CODE_PREFIX}.`) ||
    d.createdByTask === NOTE_CREATED_BY_TASK
  );
}

/**
 * Render the bounded grouped-by-scope summary text from a non-empty list of
 * latest captured decisions. Exported for unit testing.
 *
 * Scopes are partitioned into:
 *   - architecture-wide (scopeKind === 'architecture')
 *   - per-service overrides (scopeKind === 'service')
 *   - per-interface overrides (scopeKind === 'interface')
 *   - per-element overrides (scopeKind === 'element')
 *
 * Each non-empty group renders as its own '### ' subsection. Empty groups are
 * skipped so the output stays tight. Each decision line cites:
 *   - decisionCode (backtick-quoted so it reads well in markdown)
 *   - answerSummary (or answerValue when answerSummary is null)
 *   - optional '(standards: <standardsLookupRef>)' parenthetical when present
 *
 * Per-scope overrides additionally prefix the line with a 'service:<id>' /
 * 'interface:<id>' / 'element:<refType>:<refId>' qualifier so the prompt-side
 * reader knows which resource the override targets. The scopeRefType is only
 * non-null on 'element' scope per the database CHECK constraint -- the
 * renderer reflects that invariant.
 *
 * Spec 2026-06-06 Architect Conversation -- Open-Ended LLM Phase (Task Group 5):
 * two ADDITIVE sections sourced from the open phase's architecture-scoped rows:
 *   - '### Additional / user-raised decisions' from the `adhoc.<slug>` rows
 *     (first-class decisions citable by specs), and
 *   - '### Free-form discussion notes' from the per-note-unique `note.<slug>`
 *     rows.
 * These rows are SPLIT OUT of the architecture-wide group so the preset
 * `### Architecture-wide` block keeps rendering exactly as before; the two new
 * sections are appended AFTER the per-scope overrides. Both PM tasks pick the
 * new content up with NO task-config change (the resolver registration is
 * unchanged).
 */
export function buildTargetStateDecisionsPromptText(
  decisions: readonly TargetStateCapturedDecision[],
  tier2Facts: readonly string[] = [],
): string {
  // Split the open-phase rows OUT of the architecture-wide group so the preset
  // `### Architecture-wide` rendering is byte-faithful. `adhoc.*` and `note.*`
  // are mutually exclusive by construction; a row is an adhoc decision OR a
  // note, never both.
  const adhocDecisions = decisions.filter(
    (d) => d.scopeKind === 'architecture' && isAdhocDecisionRow(d),
  );
  const discussionNotes = decisions.filter(
    (d) => d.scopeKind === 'architecture' && isNoteRow(d) && !isAdhocDecisionRow(d),
  );
  const architectureWide = decisions.filter(
    (d) =>
      d.scopeKind === 'architecture' &&
      !isAdhocDecisionRow(d) &&
      !isNoteRow(d),
  );
  const perService = decisions.filter((d) => d.scopeKind === 'service');
  const perInterface = decisions.filter((d) => d.scopeKind === 'interface');
  const perElement = decisions.filter((d) => d.scopeKind === 'element');

  const lines: string[] = [];
  lines.push('## Target State Decisions');
  lines.push('');

  if (architectureWide.length > 0) {
    lines.push('### Architecture-wide');
    for (const d of architectureWide) {
      lines.push(`- ${renderDecisionBody(d)}`);
    }
    lines.push('');
  }

  if (perService.length > 0) {
    lines.push('### Per-service overrides');
    for (const d of perService) {
      const qualifier = `service:${d.scopeRefId ?? '(unknown)'}`;
      lines.push(`- ${qualifier} (${renderDecisionBody(d)})`);
    }
    lines.push('');
  }

  if (perInterface.length > 0) {
    lines.push('### Per-interface overrides');
    for (const d of perInterface) {
      const qualifier = `interface:${d.scopeRefId ?? '(unknown)'}`;
      lines.push(`- ${qualifier} (${renderDecisionBody(d)})`);
    }
    lines.push('');
  }

  if (perElement.length > 0) {
    lines.push('### Per-element overrides');
    for (const d of perElement) {
      const refType = d.scopeRefType ?? '(unknown)';
      const refId = d.scopeRefId ?? '(unknown)';
      const qualifier = `element:${refType}:${refId}`;
      lines.push(`- ${qualifier} (${renderDecisionBody(d)})`);
    }
    lines.push('');
  }

  // ---------------------------------------------------------------------
  // Open-phase additive sections (Spec 2026-06-06 Task Group 5).
  // Appended AFTER the per-scope overrides; gated on the open-phase rows
  // actually existing so they are silent for a preset-only project.
  // ---------------------------------------------------------------------
  if (adhocDecisions.length > 0) {
    lines.push('### Additional / user-raised decisions');
    for (const d of adhocDecisions) {
      lines.push(`- ${renderDecisionBody(d)}`);
    }
    lines.push('');
  }

  if (discussionNotes.length > 0) {
    lines.push('### Free-form discussion notes');
    for (const d of discussionNotes) {
      lines.push(`- ${renderDecisionBody(d)}`);
    }
    lines.push('');
  }

  // ---------------------------------------------------------------------
  // Tier-2 "free facts" from uploaded manifests (Spec 2026-06-26 Task
  // Group 7). Additive + fail-soft: appended LAST, gated on facts actually
  // existing, so a project with no manifest-declared Tier-2 tech renders
  // exactly as before. Informational lower-level facts, NOT answers to the
  // 51 questions.
  // ---------------------------------------------------------------------
  if (tier2Facts.length > 0) {
    lines.push('### Lower-level facts (from manifests)');
    for (const fact of tier2Facts) {
      lines.push(`- ${fact}`);
    }
    lines.push('');
  }

  // Trim trailing blank line to keep output tidy.
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.join('\n');
}

/**
 * Render the per-decision body (code = summary plus optional standards ref).
 * Falls back to answerValue when answerSummary is missing.
 */
function renderDecisionBody(d: TargetStateCapturedDecision): string {
  // Prefer the persisted chip; for rows captured before the summary was
  // persisted (or any row lacking one), resolve a versioned `{ framework,
  // version }` envelope at render time so the prompt-ready output never leaks the
  // raw JSON envelope into the downstream migration plan. Plain single-choice
  // answers resolve to null and keep their already-readable answerValue.
  const summary = d.answerSummary && d.answerSummary.length > 0
    ? d.answerSummary
    : (resolveCapturedAnswerSummary(d.answerValue) ?? d.answerValue ?? '');
  const standards = d.standardsLookupRef && d.standardsLookupRef.length > 0
    ? ` (standards: ${d.standardsLookupRef})`
    : '';
  return `\`${d.decisionCode}\` = ${summary}${standards}`;
}


/**
 * Live resolver for the 'target-tech-stack-context' context key.
 *
 * Spec 2026-05-25 Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write,
 * Task Group 4.
 *
 * Reads the migration-specific target tech stack file written by the
 * architect-conversation `close` turn:
 *
 *   {project_parent_folder}/{sanitised project.name}/agent-os/product/target-tech-stack-<lowercased-uuid>.md
 *
 * The AMS DTO field `project_parent_folder` IS the organisation root per
 * audit finding 1 (the naming predates the org/project hierarchy).
 *
 * Scoped to the project's most-recent-saved target architecture via
 * `fetchMostRecentSavedTargetArchitectureId` (Spec 2026-06-26 Task Group 3 --
 * bound to the SAME id the decisions resolver uses so they cannot diverge).
 * Returns:
 *   - the raw markdown content when the file exists,
 *   - the distinct sentinel "no migration target tech stack written yet"
 *     when the file is absent (distinguishable from empty / fetch-failed),
 *   - a short fail-soft status string when the upstream calls fail.
 *
 * Per-invocation cache only (no cross-request cache, per Follow-up F).
 * The existing `TechStackContextResolver` is NOT modified (per Follow-up E).
 */
export class TargetTechStackContextResolver implements ContextResolver {
  /**
   * Per-invocation cache so a single LLM task that asks for the context
   * twice in the same resolve cycle does not re-read the file. Map key is
   * the absolute path; value is the cached content.
   */
  private readonly perInvocationCache = new Map<string, string>();

  async resolve(projectId: string, _threadKey: string): Promise<string> {
    // ---------------------------------------------------------------
    // Resolve the most-recent-saved target architecture id -- the file is
    // named after it. Mirrors the TargetStateDecisionsContextResolver shape.
    // ---------------------------------------------------------------
    // Spec 2026-06-26 Task Group 3: resolve the most-recent-SAVED target (the
    // file is named after it). Bound to the SAME id the decisions resolver uses
    // so decisions + tech-stack cannot diverge across "active" vs "saved".
    let savedTargetId: string | null;
    try {
      const response = await fetchMostRecentSavedTargetArchitectureId(projectId);
      savedTargetId = response?.savedTargetArchitectureId ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.debug('Target tech stack context: saved target lookup failed', {
        projectId,
        error: message,
      });
      console.warn(
        `[diag-gw] resolver=target-tech-stack-context result=fallback reason=saved_target_lookup_error`,
      );
      return `Target tech stack context unavailable: ${message}`;
    }

    if (!savedTargetId) {
      console.log(
        `[diag-gw] resolver=target-tech-stack-context result=ok reason=no_saved_conversation`,
      );
      return 'no migration target tech stack written yet';
    }

    // ---------------------------------------------------------------
    // Resolve the organisation root + project name + sanitise.
    // ---------------------------------------------------------------
    let orgRoot: string | null;
    try {
      orgRoot = await fetchProjectFolder(projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `Target tech stack context unavailable: ${message}`;
    }
    if (!orgRoot) {
      return 'Target tech stack context unavailable: organisation root not resolvable from the architecture model service.';
    }

    let projectName: string | null;
    try {
      projectName = await fetchProductName(projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `Target tech stack context unavailable: ${message}`;
    }
    if (!projectName) {
      return 'Target tech stack context unavailable: project name not resolvable from the architecture model service.';
    }

    let safeName: string;
    try {
      // Defensive sanitisation -- reuse the shared helper so the loader,
      // the writer, and this resolver agree on the rejection rules.
      const { sanitiseProjectName } = await import('./architectConversation/projectNameSanitiser');
      safeName = sanitiseProjectName(projectName);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `Target tech stack context unavailable: ${message}`;
    }

    // ---------------------------------------------------------------
    // Compose the absolute path with the lowercased UUID and read the
    // file. Distinct miss message lets prompt readers tell the
    // file-absent case apart from empty-file / fetch-failed.
    // ---------------------------------------------------------------
    const filename = `target-tech-stack-${savedTargetId.toLowerCase()}.md`;
    const filePath = path.join(orgRoot, safeName, 'agent-os', 'product', filename);

    if (this.perInvocationCache.has(filePath)) {
      return this.perInvocationCache.get(filePath) ?? '';
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.perInvocationCache.set(filePath, content);
      return content;
    } catch (err) {
      const nodeErr = err as { code?: string };
      if (nodeErr?.code === 'ENOENT') {
        return 'no migration target tech stack written yet';
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.debug('Target tech stack context: read failed', {
        projectId,
        filePath,
        error: message,
      });
      return '';
    }
  }
}

/**
 * In-memory registry mapping context-need keys to resolver implementations.
 */
let contextResolverRegistry: Map<string, ContextResolver> = new Map();

/**
 * Initializes the context resolver registry with live resolvers for implemented
 * keys and stub resolvers for remaining keys. Called during initializeRegistries().
 *
 * Live resolvers (Increment 8):
 *   - mission: MissionContextResolver (reads MISSION.MD from disk)
 *   - tech-stack: TechStackContextResolver (reads TECH-STACK.MD from disk)
 *   - test-strategy: TestStrategyContextResolver (reads TEST-STRATEGY.MD from disk)
 *   - meta-model-summary: MetaModelSummaryContextResolver (calls fetchMetaModelSummary API)
 *
 * Live resolvers (Increment 9):
 *   - product-summary: ProductSummaryContextResolver (calls fetchProductSummary API)
 *   - roadmap-summary: RoadmapSummaryContextResolver (calls fetchProductSummary + buildRoadmapSummary)
 *
 * Live resolvers (Spec 2026-05-16 Migration Discovery Context Integration):
 *   - migration-discovery-context: MigrationDiscoveryContextResolver
 *     (calls fetchMigrationDiscoveryContext + transforms to bounded prompt text)
 *
 * Live resolvers (Spec 2026-05-19 PM Migration Shape-Spec Batch Generation, A-5):
 *   - migration-spec-context: MigrationSpecContextResolver
 *     (sibling-to migration-discovery-context, internally delegates for the
 *     project-level base summary; per-story drill-down handled by the
 *     batch generation handler)
 *
 * Stub resolvers (not yet implemented):
 *   - existing-roadmap
 */
export function initializeContextResolverRegistry(): void {
  contextResolverRegistry = new Map();

  // Live resolvers (Increment 8)
  contextResolverRegistry.set('mission', new MissionContextResolver());
  contextResolverRegistry.set('tech-stack', new TechStackContextResolver());
  contextResolverRegistry.set('test-strategy', new TestStrategyContextResolver());
  contextResolverRegistry.set('meta-model-summary', new MetaModelSummaryContextResolver());

  // Live resolvers (Increment 9)
  contextResolverRegistry.set('product-summary', new ProductSummaryContextResolver());
  contextResolverRegistry.set('roadmap-summary', new RoadmapSummaryContextResolver());
  // 2026-08-07: 'existing-roadmap' was the last stub key — now live.
  contextResolverRegistry.set('existing-roadmap', new ExistingRoadmapContextResolver());

  // Live resolvers (Spec 2026-05-16 Migration Discovery Context Integration)
  contextResolverRegistry.set(
    'migration-discovery-context',
    new MigrationDiscoveryContextResolver()
  );

  // Live resolvers (Spec 2026-05-19 PM Migration Shape-Spec Batch Generation, A-5)
  contextResolverRegistry.set(
    'migration-spec-context',
    new MigrationSpecContextResolver()
  );

  // Live resolvers (Spec 2026-05-24 Target State Captured Decisions -- Data Plane, Task Group 6)
  contextResolverRegistry.set(
    'target-state-decisions-context',
    new TargetStateDecisionsContextResolver()
  );

  // Live resolvers (Spec 2026-05-25 Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write, Task Group 4)
  contextResolverRegistry.set(
    'target-tech-stack-context',
    new TargetTechStackContextResolver()
  );

  // Stub resolvers for keys not yet implemented
  for (const key of KNOWN_CONTEXT_KEYS) {
    if (!contextResolverRegistry.has(key)) {
      contextResolverRegistry.set(key, new StubContextResolver(key));
    }
  }
}

/**
 * Returns the context resolver registry.
 *
 * @returns Map of context-need keys to ContextResolver implementations
 */
export function getContextResolverRegistry(): Map<string, ContextResolver> {
  return contextResolverRegistry;
}

/**
 * Test-only / introspection helper: returns the list of known context keys.
 *
 * Spec: 2026-05-16 Migration Discovery Context Integration -- Task Group 2.
 */
export function getKnownContextKeys(): readonly string[] {
  return KNOWN_CONTEXT_KEYS;
}
