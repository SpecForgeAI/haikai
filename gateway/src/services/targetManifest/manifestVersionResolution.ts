/**
 * Layered version resolution + first-class "version-unknown".
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3) — Task Group 2.
 *
 * Resolves target versions ON TOP of the VERBATIM resolver output produced by
 * Task Group 1 (`ParsedManifest.declaredDependencies`). It NEVER mutates the
 * resolver rows and NEVER modifies the metadata parser — it consumes:
 *   - Maven: `parsePomMetadataFromString(pomPath, rawPom)` (the gateway-local
 *     port of the LOCKED discovery-service parser) to obtain `parent`,
 *     `dependencyManagement`, `properties`, `plugins`, then resolves `${...}`
 *     via the EXPORTED `resolvePropertyRef` helper and recovers BOM/parent-
 *     managed versions where feasible.
 *   - npm: the optional `package-lock.json` content for EXACT pinning.
 *
 * Anything genuinely unresolved (unmanaged `${...}`, no matching managed entry,
 * open npm range / `latest` / dist-tag with no lockfile) is marked the
 * first-class sentinel `version-unknown` — NO guessing. `version-unknown` flows
 * downstream unchanged so Spec 4 can render "remaining — fix version unknown"
 * and Group 3 can write an editable unknown answer.
 *
 * Every coordinate that degrades to `version-unknown` is LOGGED (no silent
 * drop — Spec 3 cross-cutting rule).
 *
 * PURE: no I/O, no network, no LLM.
 */

import { VERSION_UNKNOWN } from '../../config/architect-conversation/frameworkVersionShape';
import { logger } from '../logger';
import { DeclaredDependency, ManifestEcosystem } from './manifestDependencyResolvers';
import {
  parsePomMetadataFromString,
  resolvePropertyRef,
} from './mavenPomMetadata';
import { ParsedManifest } from './parsedManifestModel';

/** Re-export the shared sentinel so downstream Group 3/4 import from one place. */
export { VERSION_UNKNOWN } from '../../config/architect-conversation/frameworkVersionShape';

/**
 * How a version was determined — useful for the evidence string + UI
 * provenance, and for distinguishing "resolved" from "version-unknown".
 */
export type VersionResolutionSource =
  | 'declared' // a concrete version was declared verbatim on the dependency
  | 'property' // a `${...}` placeholder resolved against <properties>
  | 'dependency-management' // recovered from <dependencyManagement>
  | 'parent' // recovered from the <parent> (e.g. Spring parent) version
  | 'lockfile' // pinned exactly from package-lock.json
  | 'version-unknown'; // genuinely unresolved — NO guessing

/**
 * One resolved dependency. `resolvedVersion` is either a concrete version
 * string OR the `version-unknown` sentinel (NEVER a fabricated version).
 */
export interface ResolvedDependency {
  /** Coordinate / package name (`groupId:artifactId` or full npm name). */
  name: string;
  ecosystem: ManifestEcosystem;
  /** Target module/service tag this dependency belongs to. */
  tag: string;
  /** Source manifest path (becomes `sourceFile` provenance downstream). */
  manifestPath: string;
  /** Concrete version OR `version-unknown`. */
  resolvedVersion: string;
  /** True iff `resolvedVersion === VERSION_UNKNOWN`. */
  versionUnknown: boolean;
  /** How the version was determined. */
  source: VersionResolutionSource;
  /** The verbatim declared version/range as the resolver emitted it (provenance). */
  declaredVersion: string | null;
  declaredScope: string;
  /**
   * Short evidence string for later `sourceQuote`, e.g.
   * `org.springframework.boot:spring-boot-starter-web 3.4.1` (resolved) or
   * `com.example:lib (version unknown)` (unresolved). Echoes the chip style.
   */
  evidence: string;
}

/** The resolved view of one parsed manifest. */
export interface ResolvedManifest {
  ecosystem: ManifestEcosystem;
  tag: string;
  manifestPath: string;
  resolvedDependencies: ResolvedDependency[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /^\$\{[^}]+\}$/;

function isPlaceholder(value: string | null | undefined): boolean {
  return typeof value === 'string' && PLACEHOLDER_RE.test(value.trim());
}

/** Build the evidence string (resolved coordinate/version) for `sourceQuote`. */
export function buildEvidence(name: string, resolvedVersion: string): string {
  if (resolvedVersion === VERSION_UNKNOWN) {
    return `${name} (version unknown)`;
  }
  return `${name} ${resolvedVersion}`;
}

function logUnknown(
  name: string,
  manifestPath: string,
  ecosystem: ManifestEcosystem,
  detail: string,
): void {
  logger.warn('target-manifest version resolution: version-unknown (no guessing)', {
    name,
    manifestPath,
    ecosystem,
    detail,
  });
}

// ===========================================================================
// Maven
// ===========================================================================

/**
 * Resolve Maven versions layered on the metadata parser. For each declared
 * dependency:
 *   1. If a concrete version is declared verbatim → use it (`declared`).
 *   2. If the version is a `${...}` placeholder → resolve via
 *      `resolvePropertyRef` against `<properties>`; resolved → `property`,
 *      still a placeholder → recover from management/parent or `version-unknown`.
 *   3. If NO version is declared → recover from `<dependencyManagement>` by
 *      `groupId:artifactId` (resolving any `${...}` in the managed version too);
 *      else, for a Spring-managed starter with no managed entry, fall back to
 *      the `<parent>` version; else `version-unknown`.
 */
export function resolveMavenVersions(
  declared: DeclaredDependency[],
  rawPom: string | null,
  manifestPath: string,
  tag: string,
): ResolvedDependency[] {
  const metadata = parsePomMetadataFromString(manifestPath, rawPom ?? '');
  const properties = metadata.properties;

  // Index dependencyManagement by `groupId:artifactId` for managed-version recovery.
  const managedByCoord = new Map<string, string | null>();
  for (const dm of metadata.dependencyManagement) {
    if (dm.groupId && dm.artifactId) {
      managedByCoord.set(`${dm.groupId}:${dm.artifactId}`, dm.version);
    }
  }
  const parentVersion = metadata.parent?.version ?? null;

  return declared.map((dep) => {
    const declaredVersion = dep.version ?? dep.versionRange ?? null;
    let resolvedVersion: string = VERSION_UNKNOWN;
    let source: VersionResolutionSource = 'version-unknown';

    if (dep.version && dep.version.length > 0) {
      if (isPlaceholder(dep.version)) {
        // ${...} placeholder — resolve against <properties>.
        const resolved = resolvePropertyRef(dep.version, properties);
        if (resolved && !isPlaceholder(resolved)) {
          resolvedVersion = resolved;
          source = 'property';
        } else {
          // Unresolved property — try managed/parent recovery before giving up.
          const recovered = recoverManaged(dep.name, managedByCoord, properties, parentVersion);
          if (recovered) {
            resolvedVersion = recovered.version;
            source = recovered.source;
          } else {
            logUnknown(dep.name, manifestPath, 'MAVEN', `unresolved property ${dep.version}`);
          }
        }
      } else {
        // Concrete declared version.
        resolvedVersion = dep.version;
        source = 'declared';
      }
    } else if (dep.versionRange && dep.versionRange.length > 0) {
      // Maven hard range `[a,b)` — not a single concrete version. Recover a
      // managed pin if one exists, else leave the range unresolved as
      // version-unknown (no guessing a point inside the range).
      const recovered = recoverManaged(dep.name, managedByCoord, properties, parentVersion);
      if (recovered) {
        resolvedVersion = recovered.version;
        source = recovered.source;
      } else {
        logUnknown(dep.name, manifestPath, 'MAVEN', `version range ${dep.versionRange}`);
      }
    } else {
      // No version declared — recover from dependencyManagement / parent.
      const recovered = recoverManaged(dep.name, managedByCoord, properties, parentVersion);
      if (recovered) {
        resolvedVersion = recovered.version;
        source = recovered.source;
      } else {
        logUnknown(dep.name, manifestPath, 'MAVEN', 'no version declared and no managed match');
      }
    }

    return {
      name: dep.name,
      ecosystem: 'MAVEN' as const,
      tag,
      manifestPath,
      resolvedVersion,
      versionUnknown: resolvedVersion === VERSION_UNKNOWN,
      source,
      declaredVersion,
      declaredScope: dep.scope,
      evidence: buildEvidence(dep.name, resolvedVersion),
    };
  });
}

function recoverManaged(
  coord: string,
  managedByCoord: Map<string, string | null>,
  properties: Record<string, string>,
  parentVersion: string | null,
): { version: string; source: VersionResolutionSource } | null {
  if (managedByCoord.has(coord)) {
    const managed = managedByCoord.get(coord) ?? null;
    if (managed && managed.length > 0) {
      // Managed version may itself be a ${...} placeholder.
      const resolved = isPlaceholder(managed) ? resolvePropertyRef(managed, properties) : managed;
      if (resolved && !isPlaceholder(resolved)) {
        return { version: resolved, source: 'dependency-management' };
      }
    }
  }
  // Spring Boot starters (and other parent-managed BOM artifacts) typically
  // carry no explicit/managed version because the parent pins them. When the
  // coordinate has no managed entry but a parent version is present, surface
  // the parent version as the best-feasible managed recovery.
  if (parentVersion && parentVersion.length > 0 && !isPlaceholder(parentVersion)) {
    if (isSpringManagedCoordinate(coord)) {
      return { version: parentVersion, source: 'parent' };
    }
  }
  return null;
}

/**
 * Heuristic: a coordinate whose version is conventionally pinned by the Spring
 * Boot parent (so a versionless declaration is expected). Conservative — only
 * the Spring families, so we never over-claim a parent version for an unrelated
 * artifact.
 */
function isSpringManagedCoordinate(coord: string): boolean {
  return (
    coord.startsWith('org.springframework.boot:') ||
    coord.startsWith('org.springframework:') ||
    coord.startsWith('org.springframework.cloud:') ||
    coord.startsWith('org.springframework.security:')
  );
}

// ===========================================================================
// npm
// ===========================================================================

/**
 * Resolve npm versions with an OPTIONAL lockfile pin.
 *   - If `package-lock.json` is present, pin each dependency to its EXACT
 *     installed version from the lockfile (`lockfileVersion` 2/3
 *     `packages["node_modules/<name>"].version`, with a fallback to the legacy
 *     `dependencies` tree for `lockfileVersion` 1).
 *   - Without a lockfile, a CONCRETE pinned literal (e.g. `1.6.2`) is kept; an
 *     OPEN range / `latest` / dist-tag with no lockfile → `version-unknown`.
 */
export function resolveNpmVersions(
  declared: DeclaredDependency[],
  packageLockContent: string | null,
  manifestPath: string,
  tag: string,
): ResolvedDependency[] {
  const lockIndex = packageLockContent ? buildLockfileIndex(packageLockContent) : null;

  return declared.map((dep) => {
    const declaredVersion = dep.version ?? dep.versionRange ?? null;
    let resolvedVersion: string = VERSION_UNKNOWN;
    let source: VersionResolutionSource = 'version-unknown';

    const pinned = lockIndex ? lockIndex.get(dep.name) : undefined;
    if (pinned && pinned.length > 0) {
      resolvedVersion = pinned;
      source = 'lockfile';
    } else if (
      dep.version &&
      dep.version.length > 0 &&
      !dep.versionRange &&
      isConcreteNpmVersion(dep.version)
    ) {
      // A concrete pinned semver literal (e.g. `1.6.2`) — keep verbatim. A
      // dist-tag like `latest`/`next`, a `*`, or a non-semver specifier is NOT
      // concrete and falls through to version-unknown below.
      resolvedVersion = dep.version;
      source = 'declared';
    } else {
      // Open range / latest / dist-tag with no lockfile pin → version-unknown.
      logUnknown(
        dep.name,
        manifestPath,
        'NPM',
        `open range / tag '${declaredVersion ?? ''}' with no lockfile pin`,
      );
    }

    return {
      name: dep.name,
      ecosystem: 'NPM' as const,
      tag,
      manifestPath,
      resolvedVersion,
      versionUnknown: resolvedVersion === VERSION_UNKNOWN,
      source,
      declaredVersion,
      declaredScope: dep.scope,
      evidence: buildEvidence(dep.name, resolvedVersion),
    };
  });
}

/**
 * True iff an npm version literal is a CONCRETE pinned version (an exact
 * semver such as `1.6.2` or `1.6.2-rc.1`, optionally `v`-prefixed) that is
 * safe to keep verbatim WITHOUT a lockfile. Range operators are already split
 * off into `versionRange` by the resolver; this additionally rejects dist-tags
 * (`latest`, `next`, ...), `*`, URLs, and `workspace:`/`file:` specifiers so
 * they degrade to `version-unknown` (no guessing) when no lockfile is present.
 */
export function isConcreteNpmVersion(value: string): boolean {
  const v = value.trim();
  if (v.length === 0) return false;
  // Exact semver: MAJOR.MINOR.PATCH with an optional prerelease/build suffix.
  return /^v?\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(v);
}

/**
 * Build a `name -> exact version` index from a `package-lock.json`. Supports:
 *   - lockfileVersion 2/3: the `packages` map keyed by `node_modules/<name>`
 *     (the root package, key `""`, is skipped).
 *   - lockfileVersion 1: the legacy nested `dependencies` tree (top level only,
 *     which covers direct deps — sufficient for pinning declared deps).
 * Returns an empty index on malformed JSON (logged by the caller path).
 */
export function buildLockfileIndex(packageLockContent: string): Map<string, string> {
  const index = new Map<string, string>();
  let lock: Record<string, unknown>;
  try {
    lock = JSON.parse(packageLockContent) as Record<string, unknown>;
  } catch (err) {
    logger.warn('target-manifest version resolution: package-lock.json unparseable; no pins applied', {
      detail: err instanceof Error ? err.message : String(err),
    });
    return index;
  }

  // lockfileVersion 2/3: `packages` map.
  const packages = lock.packages as Record<string, unknown> | undefined;
  if (packages && typeof packages === 'object') {
    for (const [key, entry] of Object.entries(packages)) {
      if (!key || key === '') continue; // skip the root package
      // key looks like `node_modules/<name>` or `node_modules/<a>/node_modules/<b>`.
      const marker = 'node_modules/';
      const lastIdx = key.lastIndexOf(marker);
      if (lastIdx < 0) continue;
      const name = key.slice(lastIdx + marker.length);
      const version = (entry as { version?: unknown })?.version;
      if (typeof version === 'string' && version.length > 0 && !index.has(name)) {
        index.set(name, version);
      }
    }
  }

  // lockfileVersion 1 fallback: legacy `dependencies` tree (top level).
  const deps = lock.dependencies as Record<string, unknown> | undefined;
  if (deps && typeof deps === 'object') {
    for (const [name, entry] of Object.entries(deps)) {
      const version = (entry as { version?: unknown })?.version;
      if (typeof version === 'string' && version.length > 0 && !index.has(name)) {
        index.set(name, version);
      }
    }
  }

  return index;
}

// ===========================================================================
// Public entry point — resolve one parsed manifest
// ===========================================================================

/**
 * Resolve all versions for one {@link ParsedManifest}, dispatching on ecosystem.
 * Returns a {@link ResolvedManifest} carrying the per-dependency resolved
 * versions (concrete or `version-unknown`) + evidence strings for Group 3.
 */
export function resolveManifestVersions(parsed: ParsedManifest): ResolvedManifest {
  const resolvedDependencies =
    parsed.ecosystem === 'MAVEN'
      ? resolveMavenVersions(
          parsed.declaredDependencies,
          parsed.rawPomContent,
          parsed.manifestPath,
          parsed.tag,
        )
      : resolveNpmVersions(
          parsed.declaredDependencies,
          parsed.packageLockContent,
          parsed.manifestPath,
          parsed.tag,
        );

  return {
    ecosystem: parsed.ecosystem,
    tag: parsed.tag,
    manifestPath: parsed.manifestPath,
    resolvedDependencies,
  };
}
