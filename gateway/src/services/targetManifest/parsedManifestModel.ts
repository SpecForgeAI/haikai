/**
 * Parsed-manifest model + parse orchestration.
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3) —
 * Task Group 1 (tasks 1.3 + 1.4).
 *
 * Defines the typed "parsed manifest" structure handed to Task Group 2's
 * version-resolution layer, and the function that turns one uploaded manifest
 * (raw bytes + a required module/service tag) into that structure by running it
 * through the gateway-local resolver port (which is a faithful reuse of the
 * locked discovery-service resolver contract — see
 * `manifestDependencyResolvers.ts`).
 *
 * NO version resolution happens here. Versions are stored VERBATIM exactly as
 * the resolver emits them (incl. Maven `${propname}` and npm `^1.2.3` /
 * `latest`). Resolution is layered on top in Task Group 2, which consumes
 * `declaredDependencies` + (for Maven) `rawPomContent` + (for npm)
 * `packageLockContent`.
 *
 * NO SILENT DROPS: a manifest that cannot be parsed (or carries no required
 * tag, wrong type, empty body) is returned as an `unparsed` result carrying its
 * path + a human-readable reason; the route LOGS it and reports it back. The
 * caller never silently discards a file.
 */

import {
  DeclaredDependency,
  ManifestEcosystem,
  NpmManifestParseError,
  resolveMavenManifest,
  resolveNpmManifest,
} from './manifestDependencyResolvers';

/**
 * The kind of manifest detected from the upload (by filename / explicit field).
 */
export type ManifestKind = 'pom.xml' | 'package.json';

/**
 * One uploaded manifest as it arrives at the parse layer, before parsing.
 * `tag` is the REQUIRED target module/service tag (rejected upstream if blank).
 * `manifestPath` is the repo-relative path stamped onto every emitted row and
 * later reused as `sourceFile` provenance (defaults to the original filename
 * when the caller does not supply a richer path).
 */
export interface UploadedManifestInput {
  /** Repo-relative path / filename used as provenance + on each emitted row. */
  manifestPath: string;
  /** Detected manifest kind. */
  kind: ManifestKind;
  /** Required target module/service tag (per Spec 5 per-module placement). */
  tag: string;
  /** Raw manifest content (UTF-8). */
  content: string;
  /**
   * Optional `package-lock.json` content paired with a `package.json` (npm
   * only). Used by Task Group 2 for EXACT version pinning. Ignored for Maven.
   */
  packageLockContent?: string | null;
}

/**
 * A successfully-parsed manifest. Carries everything Task Group 2 needs:
 * the verbatim `DeclaredDependency[]`, the raw pom string (Maven, to feed
 * `parsePomMetadataFromString`), and the optional lockfile content (npm).
 */
export interface ParsedManifest {
  status: 'parsed';
  ecosystem: ManifestEcosystem;
  kind: ManifestKind;
  /** Target module/service this manifest is tagged to. */
  tag: string;
  /** Repo-relative manifest path (becomes `sourceFile` downstream). */
  manifestPath: string;
  /** Verbatim resolver output — NO version resolution applied. */
  declaredDependencies: DeclaredDependency[];
  /** Raw pom.xml string for Task Group 2 (`parsePomMetadataFromString`). Maven only. */
  rawPomContent: string | null;
  /**
   * The VERBATIM manifest bytes for BOTH ecosystems (the `pom.xml` /
   * `package.json` content exactly as uploaded). Carried so the Spec 5 hand-off
   * (Group 6, `manifestHandoffs.ts`) can surface the write-this-exact-file
   * artifact for npm as well as Maven WITHOUT re-reading the buffer. For Maven
   * this equals `rawPomContent`; for npm it is the package.json content (where
   * `rawPomContent` stays null per its Maven-only meaning).
   */
  rawManifestContent?: string;
  /** Raw `package-lock.json` string for Task Group 2 exact-pinning. npm only. */
  packageLockContent: string | null;
}

/**
 * A manifest that was dropped / could not be parsed. NEVER silently discarded —
 * the route logs `manifestPath` + `reason` and surfaces it to the caller.
 */
export interface UnparsedManifest {
  status: 'unparsed';
  kind: ManifestKind | null;
  tag: string | null;
  manifestPath: string;
  reason: string;
}

export type ManifestParseResult = ParsedManifest | UnparsedManifest;

/**
 * Parse one uploaded manifest into a {@link ParsedManifest}, or return an
 * {@link UnparsedManifest} carrying the drop reason. Pure: no I/O, no network.
 *
 * Maven: runs the gateway-local Maven resolver port (verbatim versions);
 *        keeps `rawPomContent` for Group 2's metadata parse.
 * npm:   runs the gateway-local npm resolver port across all four dependency
 *        groups; a malformed `package.json` becomes an `unparsed` result
 *        (no silent drop); keeps `packageLockContent` for Group 2's exact-pin.
 */
export function parseUploadedManifest(
  input: UploadedManifestInput,
): ManifestParseResult {
  const tag = (input.tag ?? '').trim();
  if (tag.length === 0) {
    return {
      status: 'unparsed',
      kind: input.kind ?? null,
      tag: null,
      manifestPath: input.manifestPath,
      reason: 'Missing required target module/service tag for manifest.',
    };
  }

  if (!input.content || input.content.trim().length === 0) {
    return {
      status: 'unparsed',
      kind: input.kind,
      tag,
      manifestPath: input.manifestPath,
      reason: 'Manifest content was empty.',
    };
  }

  if (input.kind === 'pom.xml') {
    const declaredDependencies = resolveMavenManifest(input.content, input.manifestPath);
    return {
      status: 'parsed',
      ecosystem: 'MAVEN',
      kind: 'pom.xml',
      tag,
      manifestPath: input.manifestPath,
      declaredDependencies,
      rawPomContent: input.content,
      rawManifestContent: input.content,
      packageLockContent: null,
    };
  }

  if (input.kind === 'package.json') {
    let declaredDependencies: DeclaredDependency[];
    try {
      declaredDependencies = resolveNpmManifest(input.content, input.manifestPath);
    } catch (err) {
      if (err instanceof NpmManifestParseError) {
        return {
          status: 'unparsed',
          kind: 'package.json',
          tag,
          manifestPath: input.manifestPath,
          reason: err.message,
        };
      }
      return {
        status: 'unparsed',
        kind: 'package.json',
        tag,
        manifestPath: input.manifestPath,
        reason: `Unexpected error parsing package.json: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    return {
      status: 'parsed',
      ecosystem: 'NPM',
      kind: 'package.json',
      tag,
      manifestPath: input.manifestPath,
      declaredDependencies,
      rawPomContent: null,
      rawManifestContent: input.content,
      packageLockContent: input.packageLockContent ?? null,
    };
  }

  return {
    status: 'unparsed',
    kind: null,
    tag,
    manifestPath: input.manifestPath,
    reason: `Unsupported manifest kind '${String((input as { kind?: unknown }).kind)}'.`,
  };
}
