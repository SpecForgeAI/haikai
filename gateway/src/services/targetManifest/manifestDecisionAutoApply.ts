/**
 * Decision→manifest AUTO-APPLY (2026-08-16).
 *
 * Ruling change: the uploaded pom is the authoritative STARTING POINT, not a
 * frozen artifact — after the target-state conversation captures a decision
 * that REQUIRES a coordinate the pom lacks (db.migrations → liquibase-core was
 * the live gap: the decision said Liquibase 4, the pom never gained the
 * dependency, `spring.liquibase.enabled` stayed false and nothing could ever
 * migrate), the manifest is deliberately amended. The previous propose-and-wait
 * flow (`/manifest-reconcile` panel) required the operator to notice and click;
 * nobody did, and the seeded manifest shipped without the migration tool.
 *
 * Behaviour:
 *   - ADDITIONS (decision-required coordinate absent) are applied
 *     automatically: a NEW latest artifact version with the dependency inserted
 *     (minimal textual edit; BOM-managed = version-less), `resolved_dependencies`
 *     extended to match. The panel's GET reconcile then shows no pending
 *     additions — the manifest already carries them.
 *   - CONFLICTS (decision contradicts an EXISTING entry's version) are NEVER
 *     auto-changed — unchanged from the original ruling; they stay loud in the
 *     reconcile panel for the operator.
 *   - Fail-soft: this never throws into a caller (conversation turns and
 *     uploads must not break on a reconcile hiccup); every outcome is logged.
 *
 * Wiring: `scheduleDecisionManifestAutoApply` is invoked from the ONE
 * captured-decision write seam (`postCapturedDecision`) with a short debounce,
 * so every writer — conversation answers/captures/revisions/cascades, the
 * decisions-file import, vulnerability-reduction revisions, and the manifest
 * auto-answerer — funnels into a single apply per burst. The manifest upload
 * route ALSO awaits `autoApplyDecisionAdditions` directly so its response can
 * surface what was applied.
 */

import { logger } from '../logger';
import {
  TargetManifestArtifactWire,
  fetchLatestTargetManifestArtifacts,
  persistTargetManifestArtifacts,
} from '../targetManifestArtifactsClient';
import { fetchLatestCapturedDecisions } from '../targetStateCapturedDecisionsClient';
import {
  applyAdditionsToPom,
  reconcileManifestWithDecisions,
} from './manifestDecisionReconcile';

export interface AutoApplyDeps {
  fetchArtifacts?: typeof fetchLatestTargetManifestArtifacts;
  fetchDecisions?: typeof fetchLatestCapturedDecisions;
  persistArtifacts?: typeof persistTargetManifestArtifacts;
}

export interface AutoApplyResult {
  status: 'applied' | 'noop' | 'no_manifest' | 'no_insertion_point' | 'error';
  /** `groupId:artifactId` of every coordinate applied this run. */
  applied: string[];
  /** Version conflicts left LOUD for the operator (never auto-changed). */
  conflicts: number;
}

/** First Maven manifest artifact (latest per tag list), or null. */
function latestMavenArtifact(
  artifacts: TargetManifestArtifactWire[],
): TargetManifestArtifactWire | null {
  return (
    artifacts.find(
      (a) =>
        (a.ecosystem ?? '').toUpperCase() === 'MAVEN' ||
        (a.manifest_path ?? '').toLowerCase().endsWith('pom.xml'),
    ) ?? null
  );
}

/**
 * Reconcile the latest confirmed Maven manifest against the captured decisions
 * and APPLY any missing decision-required additions as a new latest artifact
 * version. Never throws.
 */
export async function autoApplyDecisionAdditions(
  projectId: string,
  targetArchitectureId: string,
  deps: AutoApplyDeps = {},
): Promise<AutoApplyResult> {
  const fetchArtifacts = deps.fetchArtifacts ?? fetchLatestTargetManifestArtifacts;
  const fetchDecisions = deps.fetchDecisions ?? fetchLatestCapturedDecisions;
  const persist = deps.persistArtifacts ?? persistTargetManifestArtifacts;
  try {
    const artifacts = await fetchArtifacts(projectId, targetArchitectureId);
    const artifact = latestMavenArtifact(artifacts ?? []);
    if (!artifact || !artifact.content) {
      // Nothing uploaded yet — the upload path re-runs this once one exists.
      return { status: 'no_manifest', applied: [], conflicts: 0 };
    }
    const decisions = await fetchDecisions(projectId, targetArchitectureId);
    const { additions, conflicts } = reconcileManifestWithDecisions(
      artifact.content,
      decisions,
    );
    if (conflicts.length > 0) {
      // Unchanged ruling: existing entries are NEVER auto-changed — the
      // reconcile panel carries these loudly for the operator.
      logger.warn('[diag-gateway] manifest_decision_auto_apply conflicts_left_loud', {
        projectId,
        targetArchitectureId,
        conflicts: conflicts.map((c) => c.coordinate),
      });
    }
    if (additions.length === 0) {
      return { status: 'noop', applied: [], conflicts: conflicts.length };
    }
    const updated = applyAdditionsToPom(artifact.content, additions);
    if (updated === null) {
      logger.warn('[diag-gateway] manifest_decision_auto_apply no_insertion_point', {
        projectId,
        targetArchitectureId,
        wanted: additions.map((a) => `${a.groupId}:${a.artifactId}`),
      });
      return {
        status: 'no_insertion_point',
        applied: [],
        conflicts: conflicts.length,
      };
    }
    await persist(projectId, targetArchitectureId, [
      {
        tag: artifact.tag,
        kind: artifact.kind ?? null,
        ecosystem: artifact.ecosystem ?? null,
        manifest_path: artifact.manifest_path ?? null,
        content: updated,
        package_lock_content: artifact.package_lock_content ?? null,
        resolved_dependencies: [
          ...(Array.isArray(artifact.resolved_dependencies)
            ? artifact.resolved_dependencies
            : []),
          ...additions.map((a) => ({
            name: `${a.groupId}:${a.artifactId}`,
            resolvedVersion: a.version ?? 'version-unknown',
            versionUnknown: a.version == null,
            ecosystem: 'MAVEN',
            provenance: 'decision-reconcile-auto',
          })),
        ],
        target_service_element_id: artifact.target_service_element_id ?? null,
        tier2_facts: Array.isArray(artifact.tier2_facts) ? artifact.tier2_facts : [],
      },
    ]);
    const applied = additions.map((a) => `${a.groupId}:${a.artifactId}`);
    logger.info('[diag-gateway] manifest_decision_auto_apply applied', {
      projectId,
      targetArchitectureId,
      tag: artifact.tag,
      applied,
      conflictsLeftLoud: conflicts.length,
    });
    return { status: 'applied', applied, conflicts: conflicts.length };
  } catch (err) {
    logger.warn('[diag-gateway] manifest_decision_auto_apply failed (fail-soft)', {
      projectId,
      targetArchitectureId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 'error', applied: [], conflicts: 0 };
  }
}

// ---------------------------------------------------------------------------
// Debounced scheduling — one apply per write burst
// ---------------------------------------------------------------------------

/** Debounce window: a conversation answer typically writes 1-N rows (answer +
 * cascades) within a couple of seconds; one apply per burst is enough. */
export const AUTO_APPLY_DEBOUNCE_MS = 3000;

const pendingTimers = new Map<string, NodeJS.Timeout>();

/**
 * Schedule a debounced auto-apply for the (project, target architecture) pair.
 * Fire-and-forget: callers never await; failures are logged inside
 * {@link autoApplyDecisionAdditions}. Timers are unref'd so they never hold
 * the process (or a test runner) open.
 */
export function scheduleDecisionManifestAutoApply(
  projectId: string,
  targetArchitectureId: string,
  deps: AutoApplyDeps = {},
): void {
  const key = `${projectId}|${targetArchitectureId}`;
  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingTimers.delete(key);
    void autoApplyDecisionAdditions(projectId, targetArchitectureId, deps);
  }, AUTO_APPLY_DEBOUNCE_MS);
  timer.unref?.();
  pendingTimers.set(key, timer);
}

/** Test hook: cancel all pending debounce timers. */
export function __resetDecisionManifestAutoApplyTimers(): void {
  for (const t of pendingTimers.values()) clearTimeout(t);
  pendingTimers.clear();
}
