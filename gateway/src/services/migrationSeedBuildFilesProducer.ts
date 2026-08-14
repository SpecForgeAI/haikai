/**
 * Real production `SeedBuildFilesSource` (the producer that replaces the no-op).
 *
 * Spec: 2026-06-25-confirmed-manifest-producer-wiring (Spec 5 Phase 2) —
 * Task Group 5 (D6): implement the real source + flip it into productionDeps.
 *
 * The consumer-side carriage (`migrationSeedBuildFilesEnrichment.ts`) is already
 * complete + tested. This module supplies the ONE missing piece: a real
 * {@link SeedBuildFilesSource} that reads the persisted LATEST confirmed-manifest
 * artifacts for `(projectId, targetArchitectureId)` (written at upload by Task
 * Group 3) via the Task Group 2 gateway -> AMS client, builds the v1 convention
 * service->module mapping, and hands them to {@link confirmedArtifactsToSeedBundle}.
 *
 * Posture (per spec + the carriage's own fail-soft contract):
 *   - SAFE NO-OP — returns `null` (NOT an empty bundle) when `targetArchitectureId`
 *     is absent or the read returns nothing, so the carriage emits no seed block.
 *   - FAIL-SOFT — a read hiccup is caught + logged via the `[diag-gateway]`
 *     posture and degraded to `null`; it NEVER throws into the spec-gen batch
 *     (consistent with `resolveSeedBuildFilesEnrichment`'s own try/catch).
 *   - VERBATIM — `content` rides through unchanged; the bundle adapter carries
 *     the bytes byte-for-byte to the verbatim write-block builder.
 *   - CONVENTION MAPPING (D4/D5) — each artifact's `tag` maps to placement
 *     `{ moduleDir: '<tag>/' }` with `layout='monorepo'`
 *     (`DEFAULT_TARGET_ARCHITECTURE_LAYOUT`). Distinct tags resolve independently.
 *     An unresolved tag still carries the file verbatim with the existing
 *     "destination unresolved" notice (the destination resolver degrades
 *     gracefully) — NO path guessing, NO silent drop. (With this convention every
 *     non-empty tag resolves; an empty/blank tag is logged + left to the resolver,
 *     which surfaces it as unresolved rather than dropping it.)
 */

import { logger } from './logger';
import {
  ConfirmedManifestBundle,
  ConfirmedManifestArtifactLike,
  SeedBuildFilesSource,
  confirmedArtifactsToSeedBundle,
} from './migrationSeedBuildFilesEnrichment';
import {
  ServiceModuleMapping,
  DEFAULT_TARGET_ARCHITECTURE_LAYOUT,
} from './seedBuildFileDestination';
import {
  TargetManifestArtifactWire,
  fetchLatestTargetManifestArtifacts,
} from './targetManifestArtifactsClient';

/**
 * The AMS read seam, declared as an injectable type so unit tests can stub it.
 * Production defaults to the Task Group 2 client.
 */
export type FetchLatestTargetManifestArtifacts = (
  projectId: string,
  targetArchitectureId: string,
) => Promise<TargetManifestArtifactWire[]>;

/**
 * Adapt one persisted manifest-artifact wire row to the structural
 * {@link ConfirmedManifestArtifactLike} the bundle adapter consumes. The wire
 * row carries snake_case fields + nullable `content`/`kind`/`manifest_path`; we
 * map them onto the carriage shape, carrying `content` VERBATIM (a null content
 * becomes the empty string — the upstream store guarantees TEXT, so this is only
 * a type-narrowing fallback, never a re-encode/trim of real bytes).
 */
export function wireRowToArtifactLike(
  row: TargetManifestArtifactWire,
): ConfirmedManifestArtifactLike {
  return {
    tag: row.tag,
    kind: row.kind ?? '',
    manifestPath: row.manifest_path ?? '',
    content: row.content ?? '',
    // The carriage only reads `versionUnknown` off each element; the JSONB rows
    // pass through opaquely (their `versionUnknown` flag survives the round-trip).
    resolvedDependencies: Array.isArray(row.resolved_dependencies)
      ? (row.resolved_dependencies as Array<{ versionUnknown?: boolean | null }>)
      : null,
  };
}

/**
 * Build the convention service->module mapping for the artifacts.
 *
 * SINGLE-SERVICE REPO (2026-08-14): when exactly ONE artifact is confirmed,
 * its build file IS the application's root build file — placement `.` (repo
 * root). The prior `<tag>/pom.xml` convention buried a single service's pom in
 * a subdirectory the build tool never reads, so the scaffolded app could not
 * build from a fresh clone.
 *
 * MULTI-SERVICE: each distinct `tag` maps to `{ moduleDir: '<tag>' }`
 * (monorepo module dirs, the original v1 convention). A blank/empty tag is
 * logged (no silent drop) and left out of the mapping so the destination
 * resolver surfaces it as unresolved rather than the producer guessing a path.
 */
export function buildConventionServiceModuleMapping(
  artifacts: readonly ConfirmedManifestArtifactLike[],
): ServiceModuleMapping {
  const mapping: ServiceModuleMapping = {};
  const nonBlank = artifacts.filter((a) => (a.tag ?? '').trim().length > 0);
  const singleService = nonBlank.length === 1 && artifacts.length === 1;
  for (const a of artifacts) {
    const tag = (a.tag ?? '').trim();
    if (tag.length === 0) {
      logger.warn(
        `[diag-gateway] confirmed_manifest_to_codebase seed_producer_blank_tag ` +
          `manifestPath=${a.manifestPath} reason=empty_tag_left_unresolved`,
      );
      continue;
    }
    if (singleService) {
      logger.info(
        `[diag-gateway] confirmed_manifest_to_codebase seed_producer_root_placement ` +
          `tag=${tag} reason=single_service_repo destination=repo_root`,
      );
      mapping[tag] = { moduleDir: '.' };
    } else {
      // Multi-service convention: the module directory IS the tag (monorepo).
      // The destination resolver appends the file name, e.g. `<tag>/pom.xml`.
      mapping[tag] = { moduleDir: tag };
    }
  }
  return mapping;
}

/**
 * Factory for the real production {@link SeedBuildFilesSource}. The AMS read seam
 * is injectable (defaulting to the Task Group 2 client) so the producer can be
 * unit-tested with a stubbed read. The returned source:
 *   - returns `null` when `targetArchitectureId` is absent or the read is empty;
 *   - reads the persisted LATEST artifacts, builds the convention mapping, and
 *     returns `confirmedArtifactsToSeedBundle(artifacts, mapping, 'monorepo')`;
 *   - catches any read hiccup, logs it, and degrades to `null` (never throws).
 */
export function createProductionSeedBuildFilesSource(
  fetchLatest: FetchLatestTargetManifestArtifacts = fetchLatestTargetManifestArtifacts,
): SeedBuildFilesSource {
  return async (input): Promise<ConfirmedManifestBundle | null> => {
    const { projectId, bookOfWorkId } = input;
    const targetArchitectureId = input.targetArchitectureId ?? null;

    // Safe no-op: no target architecture key -> nothing to read.
    if (!targetArchitectureId) {
      logger.info(
        `[diag-gateway] confirmed_manifest_to_codebase seed_producer_noop ` +
          `projectId=${projectId} bookOfWorkId=${bookOfWorkId} ` +
          `reason=no_target_architecture_id`,
      );
      return null;
    }

    let rows: TargetManifestArtifactWire[];
    try {
      rows = await fetchLatest(projectId, targetArchitectureId);
    } catch (err) {
      // Fail-soft: a read hiccup degrades to a safe no-op (null). NEVER throw into
      // the batch — the spec-gen run must not be broken by a confirmed-manifest
      // read failure (consistent with resolveSeedBuildFilesEnrichment's try/catch).
      logger.warn(
        `[diag-gateway] confirmed_manifest_to_codebase seed_producer_read_failed ` +
          `projectId=${projectId} bookOfWorkId=${bookOfWorkId} ` +
          `targetArchitectureId=${targetArchitectureId} ` +
          `error=${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      // Safe no-op: nothing persisted for this target architecture yet.
      logger.info(
        `[diag-gateway] confirmed_manifest_to_codebase seed_producer_noop ` +
          `projectId=${projectId} bookOfWorkId=${bookOfWorkId} ` +
          `targetArchitectureId=${targetArchitectureId} reason=no_persisted_artifacts`,
      );
      return null;
    }

    const artifacts = rows.map(wireRowToArtifactLike);
    const mapping = buildConventionServiceModuleMapping(artifacts);

    logger.info(
      `[diag-gateway] confirmed_manifest_to_codebase seed_producer_read_ok ` +
        `projectId=${projectId} bookOfWorkId=${bookOfWorkId} ` +
        `targetArchitectureId=${targetArchitectureId} ` +
        `artifacts=${artifacts.length} mappedTags=${Object.keys(mapping).length} ` +
        `layout=${DEFAULT_TARGET_ARCHITECTURE_LAYOUT}`,
    );

    // The adapter drops unsupported-kind artifacts WITH a log (never silently),
    // carries verbatim content, and resolves each tag independently downstream.
    return confirmedArtifactsToSeedBundle(
      artifacts,
      mapping,
      DEFAULT_TARGET_ARCHITECTURE_LAYOUT,
    );
  };
}

/**
 * The real production source instance flipped into
 * `productionDeps.seedBuildFilesSource` (replacing the no-op
 * `defaultProductionSeedBuildFilesSource`). Uses the Task Group 2 client by
 * default.
 */
export const productionSeedBuildFilesSource: SeedBuildFilesSource =
  createProductionSeedBuildFilesSource();
