/**
 * Destination-path resolver for confirmed build manifests (service→module map).
 *
 * Spec: 2026-06-24-confirmed-manifest-to-target-codebase (Spec 5) — Task Group 2
 * ("Resolve destination path from the service→module mapping").
 *
 * PURE FUNCTIONS over the Spec 3 per-manifest service/module tag + the target
 * architecture layout. No I/O, no network, no LLM (logging is the only side
 * effect, and only to surface an unresolved mapping per the no-silent-drop rule).
 *
 * SOURCE OF TRUTH (LOCKED, D5)
 * ---------------------------
 * The service→module MAPPING dictates WHERE each manifest lands; this resolver
 * does NOT invent a path scheme of its own — it only FORMATS what the mapping
 * provides. Each confirmed manifest carries a `serviceTag` (Spec 3's per-manifest
 * module/service tag, see `ConfirmedManifestArtifact.tag` in
 * `services/targetManifest/manifestHandoffs.ts`); the mapping resolves that tag
 * to a placement, and the resolver appends the build-file name:
 *   - monorepo (DEFAULT) → `<module-dir>/<fileName>`
 *   - multi-repo         → `<repo-root>/<fileName>`
 *
 * Support for MULTIPLE manifests is intrinsic: each manifest is resolved
 * independently against the same mapping, so distinct tags route to distinct
 * paths.
 *
 * UNRESOLVED MAPPING (D5 + no-silent-drop)
 * ----------------------------------------
 * When the mapping has no entry for a manifest's tag, the resolver does NOT
 * guess a path and does NOT drop the manifest silently: it returns a structured
 * `unresolved` result AND logs a `[diag-gateway]` line naming the manifest +
 * tag, so the threading layer (Group 3) can fail-soft skip-with-log (consistent
 * with the handler's per-story isolation posture).
 */

import { logger } from './logger';
import { SeedFileManifest } from './seedBuildFileWriteBlock';

/**
 * Target architecture layout. The DEFAULT is `monorepo` (per-service module
 * directories); `multi-repo` places each manifest at its per-repo root. Inherited
 * from the locked Spec 5 decision; the layout is supplied by the caller from the
 * confirmed target architecture.
 */
export type TargetArchitectureLayout = 'monorepo' | 'multi-repo';

export const DEFAULT_TARGET_ARCHITECTURE_LAYOUT: TargetArchitectureLayout = 'monorepo';

/**
 * One placement entry in the service→module mapping. Either field may be set;
 * the resolver reads the one relevant to the active layout. `moduleDir` is the
 * monorepo per-service directory (e.g. `services/orders-service`); `repoRoot` is
 * the multi-repo per-repo root (e.g. `orders-service` or a clone-relative root).
 * A single field (`dir`) covers the common case where the same placement string
 * is used regardless of layout.
 */
export interface ServiceModulePlacement {
  /** Monorepo per-service module directory (layout = 'monorepo'). */
  moduleDir?: string | null;
  /** Multi-repo per-repo root (layout = 'multi-repo'). */
  repoRoot?: string | null;
  /** Layout-agnostic placement; used when the layout-specific field is absent. */
  dir?: string | null;
}

/**
 * The service→module mapping: the SOURCE OF TRUTH for placement, keyed by the
 * Spec 3 service/module tag. A plain record so a caller can hand it straight from
 * the confirmed target architecture without a bespoke class.
 */
export type ServiceModuleMapping = Record<string, ServiceModulePlacement>;

/** A resolved destination — the concrete path the seed file is written at. */
export interface ResolvedSeedDestination {
  resolved: true;
  serviceTag: string;
  fileName: SeedFileManifest['fileName'];
  /** `<module-dir>/<fileName>` (monorepo) or `<repo-root>/<fileName>` (multi-repo). */
  destinationPath: string;
  layout: TargetArchitectureLayout;
}

/** An unresolved destination — the mapping had no entry for the tag. */
export interface UnresolvedSeedDestination {
  resolved: false;
  serviceTag: string;
  fileName: SeedFileManifest['fileName'];
  reason: string;
}

export type SeedDestinationResult =
  | ResolvedSeedDestination
  | UnresolvedSeedDestination;

/** Type guard: a resolved destination (vs unresolved). */
export function isResolvedSeedDestination(
  r: SeedDestinationResult,
): r is ResolvedSeedDestination {
  return r.resolved === true;
}

/**
 * Pick the placement string for the active layout, tolerating the layout-
 * agnostic `dir` fallback. Returns null when nothing usable is present.
 */
function placementDirFor(
  placement: ServiceModulePlacement,
  layout: TargetArchitectureLayout,
): string | null {
  const primary = layout === 'multi-repo' ? placement.repoRoot : placement.moduleDir;
  const chosen =
    typeof primary === 'string' && primary.trim().length > 0
      ? primary
      : typeof placement.dir === 'string' && placement.dir.trim().length > 0
        ? placement.dir
        : null;
  return chosen;
}

/**
 * Join a placement directory with a file name into a forward-slash path. The
 * generated codebase is described with POSIX separators regardless of host OS
 * (the path rides in spec text, not the local filesystem). A trailing slash on
 * the directory is tolerated; an empty/`.` directory yields just the file name.
 */
export function joinDestinationPath(dir: string, fileName: string): string {
  const trimmed = dir.replace(/[\\/]+$/, '').trim();
  if (trimmed.length === 0 || trimmed === '.') return fileName;
  // Normalise any backslashes a caller may have passed to POSIX separators.
  const posix = trimmed.replace(/\\/g, '/');
  return `${posix}/${fileName}`;
}

/**
 * Resolve ONE confirmed manifest's destination path from the service→module
 * mapping + the target layout.
 *
 * The mapping is the source of truth; the resolver only formats what it dictates:
 *   - monorepo → `<module-dir>/<fileName>`
 *   - multi-repo → `<repo-root>/<fileName>`
 *
 * Returns an {@link UnresolvedSeedDestination} (logged) when the tag has no
 * mapping entry — NEVER a guessed path, NEVER a silent drop.
 */
export function resolveSeedFileDestination(
  manifest: Pick<SeedFileManifest, 'fileName' | 'serviceTag'>,
  mapping: ServiceModuleMapping,
  layout: TargetArchitectureLayout = DEFAULT_TARGET_ARCHITECTURE_LAYOUT,
): SeedDestinationResult {
  const tag = (manifest.serviceTag ?? '').trim();
  const placement = tag.length > 0 ? mapping[tag] : undefined;
  const dir = placement ? placementDirFor(placement, layout) : null;

  if (!placement || dir === null) {
    const reason =
      `No service→module mapping entry yields a ${layout} placement for tag ` +
      `'${manifest.serviceTag}' (file '${manifest.fileName}'). The mapping is the ` +
      `source of truth; refusing to guess a path.`;
    // NO silent drop — surface the unresolved manifest + tag so Group 3 can
    // fail-soft skip-with-log.
    logger.warn(
      `[diag-gateway] confirmed_manifest_to_codebase seed_destination_unresolved ` +
        `tag=${manifest.serviceTag} fileName=${manifest.fileName} layout=${layout}`,
    );
    return {
      resolved: false,
      serviceTag: manifest.serviceTag,
      fileName: manifest.fileName,
      reason,
    };
  }

  return {
    resolved: true,
    serviceTag: manifest.serviceTag,
    fileName: manifest.fileName,
    destinationPath: joinDestinationPath(dir, manifest.fileName),
    layout,
  };
}

/**
 * Resolve a manifest's destination and FEED IT BACK into the manifest as
 * `destinationPath` (Group 1's builder renders it). Returns a NEW manifest object
 * (never mutates the input) plus the raw {@link SeedDestinationResult} so the
 * caller can branch on the unresolved case. On unresolved, `destinationPath` is
 * left null so the write-block renders its explicit "UNRESOLVED" notice rather
 * than a fabricated path.
 */
export function attachResolvedDestination(
  manifest: SeedFileManifest,
  mapping: ServiceModuleMapping,
  layout: TargetArchitectureLayout = DEFAULT_TARGET_ARCHITECTURE_LAYOUT,
): { manifest: SeedFileManifest; destination: SeedDestinationResult } {
  const destination = resolveSeedFileDestination(manifest, mapping, layout);
  return {
    manifest: {
      ...manifest,
      destinationPath: isResolvedSeedDestination(destination)
        ? destination.destinationPath
        : null,
    },
    destination,
  };
}

/**
 * Resolve destinations for MULTIPLE manifests against one mapping/layout. Each
 * manifest is resolved independently so distinct tags route to distinct paths;
 * unresolved manifests are surfaced (logged) but NOT dropped — they appear in
 * the result with a null `destinationPath` and their {@link SeedDestinationResult}
 * carrying `resolved:false`, so Group 3 can decide per-manifest.
 */
export function attachResolvedDestinations(
  manifests: readonly SeedFileManifest[],
  mapping: ServiceModuleMapping,
  layout: TargetArchitectureLayout = DEFAULT_TARGET_ARCHITECTURE_LAYOUT,
): Array<{ manifest: SeedFileManifest; destination: SeedDestinationResult }> {
  return manifests.map((m) => attachResolvedDestination(m, mapping, layout));
}
