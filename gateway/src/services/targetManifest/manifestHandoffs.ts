/**
 * Spec 4 / Spec 5 hand-off shapes for the target dependency-manifest pipeline.
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3) — Task Group 6
 * (tasks 6.1 + 6.2: expose the structured hand-offs).
 *
 * PURE DATA + PURE BUILDERS. No I/O, no LLM, no network, no orchestration.
 *
 * This spec does NOT compute the CVE delta (Spec 4), makes NO steering UI, does
 * NOT write the codebase artifact (Spec 5), and makes ZERO IVS change. It only
 * EXPOSES the two structured sources the later specs consume:
 *
 *   6.1 — The recomputed resolved target-version set (from Group 4's
 *         `recomputeResolvedTargetVersions`) is Spec 4's STRUCTURED
 *         target-version source for reduction/steering, ALONGSIDE manual
 *         `{framework, version}` answers. `version-unknown` entries pass through
 *         unchanged so Spec 4 can render "remaining — fix version unknown". The
 *         set's element shape is {@link ResolvedTargetVersion} (re-exported here
 *         from the precedence module so consumers import the hand-off from ONE
 *         place); {@link selectSpec4TargetVersionSource} is the named accessor.
 *
 *   6.2 — The confirmed per-module/service-tagged manifest is Spec 5's source
 *         for the write-this-exact-file codebase artifact. {@link
 *         ConfirmedManifestArtifact} carries the per-manifest tag + ecosystem +
 *         the VERBATIM manifest content (the bytes Spec 5 writes unchanged) +
 *         the optional lockfile + the resolved dependencies (so Spec 5 can place
 *         per-module by tag and honour the curated versions). The declared
 *         deps/versions are NOT mutated here — Spec 5 writes them verbatim.
 */

import { ParsedManifest } from './parsedManifestModel';
import {
  ResolvedDependency,
  ResolvedManifest,
} from './manifestVersionResolution';
import { ResolvedTargetVersion } from './manifestPrecedence';
import { ManifestEcosystem } from './manifestDependencyResolvers';

// ===========================================================================
// 6.1 — Spec 4 structured target-version source
// ===========================================================================

/**
 * Re-export the resolved-target-version element shape so Spec 4 imports the
 * hand-off contract from this one module rather than reaching into the
 * precedence internals. The set itself is produced by Group 4's
 * `recomputeResolvedTargetVersions` and surfaced on the upload route response
 * (`autoAnswer.resolvedTargetVersions`).
 */
export type { ResolvedTargetVersion } from './manifestPrecedence';

/**
 * Named accessor for Spec 4's structured target-version source. Identity over
 * the recomputed set — the function exists so the hand-off has a single,
 * documented call site Spec 4 binds to (rather than Spec 4 reaching into the
 * route response shape directly). `version-unknown` entries are preserved.
 *
 * Pure; never throws; returns a defensive copy so a downstream consumer cannot
 * mutate the orchestrator's result in place.
 */
export function selectSpec4TargetVersionSource(
  resolvedTargetVersions: readonly ResolvedTargetVersion[],
): ResolvedTargetVersion[] {
  return resolvedTargetVersions.map((v) => ({ ...v }));
}

/**
 * Convenience partition for Spec 4: the resolved entries split into those with a
 * concrete version (steerable now) and those still `version-unknown` (Spec 4
 * renders "remaining — fix version unknown"). Spec 4 owns the actual CVE compute;
 * this is only a structural split so the unknown passthrough is explicit.
 */
export function partitionByVersionKnown(
  resolvedTargetVersions: readonly ResolvedTargetVersion[],
): { concrete: ResolvedTargetVersion[]; versionUnknown: ResolvedTargetVersion[] } {
  const concrete: ResolvedTargetVersion[] = [];
  const versionUnknown: ResolvedTargetVersion[] = [];
  for (const v of resolvedTargetVersions) {
    if (v.versionUnknown) versionUnknown.push({ ...v });
    else concrete.push({ ...v });
  }
  return { concrete, versionUnknown };
}

// ===========================================================================
// 6.2 — Spec 5 confirmed manifest source
// ===========================================================================

/**
 * One confirmed, per-module/service-tagged manifest — Spec 5's source for the
 * write-this-exact-file codebase artifact. Carries everything Spec 5 needs to
 * write the build file verbatim and place it per module:
 *   - `tag`            — the target module/service the manifest belongs to (the
 *                        per-module placement key Spec 5 resolves the path from).
 *   - `ecosystem`/`kind` — so Spec 5 knows which build file it is.
 *   - `manifestPath`   — the provenance path (default placement hint).
 *   - `content`        — the VERBATIM manifest bytes (Spec 5 writes these
 *                        UNCHANGED; declared deps/versions must NOT be mutated).
 *   - `packageLockContent` — the optional lockfile (npm), also verbatim.
 *   - `resolvedDependencies` — the Group 2 resolved deps (concrete /
 *                        `version-unknown`) so Spec 5 can honour the curated
 *                        versions / surface what was resolved without re-parsing.
 */
export interface ConfirmedManifestArtifact {
  tag: string;
  ecosystem: ManifestEcosystem;
  kind: ParsedManifest['kind'];
  manifestPath: string;
  /** VERBATIM manifest content — written unchanged by Spec 5. */
  content: string;
  /** VERBATIM `package-lock.json` content (npm only), or null. */
  packageLockContent: string | null;
  /** Group 2 resolved deps for this manifest (concrete / version-unknown). */
  resolvedDependencies: ResolvedDependency[];
}

/**
 * Build the confirmed-manifest artifacts (Spec 5 hand-off) by zipping each
 * parsed manifest with its Group 2 resolved view. Parsed + resolved manifests
 * are produced in the SAME order by `processManifestUpload` (it maps the parsed
 * array through `resolveManifestVersions`), so they align positionally; we match
 * defensively by `manifestPath` and fall back to the positional index so a
 * future ordering change cannot silently mis-pair.
 *
 * The VERBATIM manifest bytes (`rawManifestContent`, populated for BOTH
 * ecosystems at parse time) are carried through unchanged — Spec 5 writes the
 * declared deps/versions verbatim (the locked decision: "honour the curated
 * versions").
 *
 * Pure; never throws. A parsed manifest with no matching resolved view (should
 * not happen) still produces an artifact with an empty resolved-deps list rather
 * than being silently dropped.
 */
export function buildConfirmedManifestArtifacts(
  parsedManifests: readonly ParsedManifest[],
  resolvedManifests: readonly ResolvedManifest[],
): ConfirmedManifestArtifact[] {
  const resolvedByPath = new Map<string, ResolvedManifest>();
  for (const r of resolvedManifests) {
    if (!resolvedByPath.has(r.manifestPath)) {
      resolvedByPath.set(r.manifestPath, r);
    }
  }

  return parsedManifests.map((parsed, index) => {
    const resolved =
      resolvedByPath.get(parsed.manifestPath) ?? resolvedManifests[index] ?? null;
    return {
      tag: parsed.tag,
      ecosystem: parsed.ecosystem,
      kind: parsed.kind,
      manifestPath: parsed.manifestPath,
      // Verbatim manifest bytes for both ecosystems (Maven pom / npm package.json).
      content: parsed.rawManifestContent ?? parsed.rawPomContent ?? '',
      packageLockContent: parsed.packageLockContent ?? null,
      resolvedDependencies: resolved ? [...resolved.resolvedDependencies] : [],
    };
  });
}
