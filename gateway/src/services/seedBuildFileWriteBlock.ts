/**
 * Verbatim "write this exact file" block builder for confirmed build manifests.
 *
 * Spec: 2026-06-24-confirmed-manifest-to-target-codebase (Spec 5) — Task Group 1
 * ("Full-manifest 'write this exact file' block builder").
 *
 * PURE FUNCTION over a confirmed-manifest input shape. No I/O, no network, no
 * LLM, no orchestration (logging is the only side effect, and only to flag a
 * carried `version-unknown` marker per the no-silent-handling rule).
 *
 * WHAT THIS IS
 * ------------
 * Spec 3 produces a CONFIRMED manifest (`pom.xml` / `package.json`) with curated
 * coordinates + versions (`manifestHandoffs.ts` → `ConfirmedManifestArtifact`).
 * Spec 5's locked v1 mechanism carries that manifest VERBATIM into a migration
 * spec's requirements text as an explicit "create this file with exactly this
 * content" instruction (there is NO IVS seed-file input — IVS only reads the
 * spec folder, so the manifest must live inside the spec prose). This module is
 * the carriage core: it turns ONE confirmed manifest into a literal, fenced
 * exact-write instruction block that an unattended implementer treats as an
 * authoritative file to write, NOT a suggestion.
 *
 * CARRIAGE = THE FULL MANIFEST EMBEDDED VERBATIM (LOCKED, D1/D2/D4)
 * ----------------------------------------------------------------
 * The ENTIRE manifest file body rides byte-for-byte inside the block. This
 * builder NEVER edits, re-serialises, pretty-prints, entity-escapes, or
 * whitespace-normalises the body — the declared dependencies and their curated
 * vuln-reduction versions MUST survive untouched. Scaffolding is permitted
 * AROUND the file (the lock language explicitly allows plugin blocks / build
 * config) but the declared deps/versions are frozen.
 *
 * FENCE CHOICE
 * ------------
 * A `pom.xml` / `package.json` body can legitimately contain backtick runs (e.g.
 * inside a JSON string value or an XML comment), so a Markdown backtick fence
 * could be broken by the file content. Instead the body is delimited by explicit
 * BEGIN/END sentinel lines containing a long random-looking token that cannot
 * collide with real build-file content. The sentinel is on its OWN lines and the
 * body is reproduced verbatim BETWEEN them, so a downstream reader recovers the
 * exact bytes by slicing between the sentinels.
 *
 * `version-unknown` (D7)
 * ----------------------
 * If Spec 3 marked an entry `version-unknown` (genuinely unresolved — no
 * guessing), the marker rides through VERBATIM in the file body; this builder
 * NEVER invents or guesses a version. When a marker is detected (via the
 * explicit `hasVersionUnknown` flag OR a literal occurrence in the body) a
 * `[diag-gateway]` note is logged so the unresolved carriage is never silent.
 */

import { logger } from './logger';

/**
 * The Spec 3 `version-unknown` sentinel, mirrored as a literal here so this pure
 * module does not pull the whole `targetManifest` tree (or the architect-
 * conversation config) in just to scan for the marker. The canonical source of
 * truth is `config/architect-conversation/frameworkVersionShape.ts`
 * (`VERSION_UNKNOWN`); this literal MUST match it. Kept inline per the spec's
 * "mirror the inline-DTO convention; do NOT pull a generated-types module in".
 */
export const VERSION_UNKNOWN_MARKER = 'version-unknown';

/**
 * The supported confirmed-manifest file kinds — `pom.xml` + `package.json`
 * ONLY, inherited from Spec 3 (no Gradle). Any other kind is rejected with a
 * log (never silently dropped).
 */
export type SeedFileName = 'pom.xml' | 'package.json';

/**
 * Minimal inline DTO for ONE confirmed manifest the write-block builder consumes.
 *
 * Reflects Spec 3's confirmed output (`ConfirmedManifestArtifact` in
 * `services/targetManifest/manifestHandoffs.ts`) but is intentionally MINIMAL
 * and INLINE — mirroring the inline-DTO convention in
 * `migrationShapeSpecGenerationHandler.ts` — so the carriage core does not take a
 * hard dependency on the upstream module's full shape. A caller adapting a
 * `ConfirmedManifestArtifact` maps `kind`→`fileName`, `tag`→`serviceTag`,
 * `content`→`content`, and (optionally) any `resolvedDependencies[].versionUnknown`
 * →`hasVersionUnknown`.
 */
export interface SeedFileManifest {
  /** `pom.xml` | `package.json` (Spec 3 scope — no Gradle). */
  fileName: SeedFileName;
  /** The VERBATIM manifest bytes — carried unchanged into the block. */
  content: string;
  /** Target module/service tag (the per-module placement key, from Spec 3). */
  serviceTag: string;
  /**
   * Resolved destination path for the file (from Group 2's resolver). Optional
   * here because the builder is pure over a single manifest; when omitted the
   * block renders an explicit "destination unresolved" notice rather than
   * guessing a path (the unresolved case is logged + surfaced by Group 2).
   */
  destinationPath?: string | null;
  /**
   * True iff Spec 3 carried at least one `version-unknown` entry in this
   * manifest. Optional — the builder ALSO scans the body for a literal
   * occurrence, so a marker present in `content` is honoured even when the flag
   * is absent.
   */
  hasVersionUnknown?: boolean;
}

/** A non-pom/package file kind that the builder refuses to carry. */
export interface RejectedSeedFile {
  rejected: true;
  reason: string;
}

/**
 * BEGIN/END body sentinels. The long opaque token makes an accidental collision
 * with real `pom.xml` / `package.json` content effectively impossible, so the
 * embedded file body can contain ANY characters (including backtick runs and
 * triple backticks) without breaking the block. A reader recovers the exact
 * bytes by taking everything strictly between the BEGIN line and the END line.
 */
export const SEED_FILE_BODY_BEGIN =
  '----- BEGIN EXACT FILE CONTENT (HAIKAI-SEED-7f3a9c2e-DO-NOT-EDIT) -----';
export const SEED_FILE_BODY_END =
  '----- END EXACT FILE CONTENT (HAIKAI-SEED-7f3a9c2e-DO-NOT-EDIT) -----';

/** Stable heading marker so the threading layer (Group 3) can locate blocks. */
export const SEED_FILE_WRITE_BLOCK_HEADING = '### SEED BUILD FILE — WRITE EXACTLY AS SHOWN';

/**
 * True when `content` carries the literal `version-unknown` marker. Pure string
 * scan; intentionally simple (the marker is a fixed sentinel Spec 3 writes — we
 * never parse the manifest here).
 */
export function manifestBodyHasVersionUnknown(content: string): boolean {
  return content.includes(VERSION_UNKNOWN_MARKER);
}

/**
 * Build the literal, fenced "write this exact file" instruction block for ONE
 * confirmed manifest.
 *
 * Guarantees:
 *   - the ENTIRE `content` rides byte-for-byte between the BEGIN/END sentinels
 *     (no re-serialisation, no whitespace normalisation, no entity-escaping of
 *     the body);
 *   - explicit exact-write + authoritative-lock wording is present (D4);
 *   - the resolved destination path is rendered (or an explicit unresolved
 *     notice when absent — never a guessed path);
 *   - any `version-unknown` marker is carried verbatim and logged.
 *
 * Returns a {@link RejectedSeedFile} (logged) for an unsupported file kind —
 * never a silent drop.
 */
export function buildSeedFileWriteBlock(
  manifest: SeedFileManifest,
): string | RejectedSeedFile {
  // Scope guard: pom.xml + package.json ONLY (Spec 3). Reject + log anything else.
  if (manifest.fileName !== 'pom.xml' && manifest.fileName !== 'package.json') {
    const reason =
      `Unsupported seed build-file kind '${String(manifest.fileName)}' for tag ` +
      `'${manifest.serviceTag}' — only pom.xml / package.json are carried (Spec 3 scope).`;
    logger.warn(
      `[diag-gateway] confirmed_manifest_to_codebase seed_file_rejected ` +
        `tag=${manifest.serviceTag} fileName=${String(manifest.fileName)} reason=unsupported_kind`,
    );
    return { rejected: true, reason };
  }

  const hasUnknown =
    manifest.hasVersionUnknown === true ||
    manifestBodyHasVersionUnknown(manifest.content);
  if (hasUnknown) {
    // NO silent handling — flag the carried unresolved entry (D7). The marker is
    // carried THROUGH verbatim; we never invent or guess a version.
    logger.info(
      `[diag-gateway] confirmed_manifest_to_codebase seed_file_version_unknown_carried ` +
        `tag=${manifest.serviceTag} fileName=${manifest.fileName} ` +
        `note=carrying_unresolved_entry_verbatim_no_guess`,
    );
  }

  const dest =
    typeof manifest.destinationPath === 'string' &&
    manifest.destinationPath.trim().length > 0
      ? manifest.destinationPath
      : null;

  const destLine = dest
    ? `Destination path (write the file at EXACTLY this path): ${dest}`
    : // Group 2 surfaces unresolved-mapping cases; the builder must NOT guess a
      // path, so it renders an explicit notice rather than a fabricated location.
      `Destination path: UNRESOLVED — the service→module mapping did not yield a ` +
      `path for tag '${manifest.serviceTag}'. Do NOT guess a location; resolve the ` +
      `mapping before writing this file.`;

  const versionUnknownLine = hasUnknown
    ? `\n- One or more dependencies are marked \`${VERSION_UNKNOWN_MARKER}\` (Spec 3 could ` +
      `not resolve a concrete version). Carry that marker through EXACTLY as written — ` +
      `do NOT invent, guess, infer, or "fill in" a version for it.`
    : '';

  // The instruction wording is deliberately emphatic + unambiguous so an
  // unattended implementer treats this as an exact-write, not a suggestion (D2),
  // and treats the file as the frozen source of dependency truth (D4).
  const lines: string[] = [
    SEED_FILE_WRITE_BLOCK_HEADING,
    '',
    `Service / module tag: ${manifest.serviceTag}`,
    destLine,
    `File kind: ${manifest.fileName}`,
    '',
    `INSTRUCTION (exact-write, NOT a suggestion):`,
    `Create this file with EXACTLY this content. This is the AUTHORITATIVE, FROZEN ` +
      `source of dependency truth for this module: the declared dependencies and their ` +
      `versions were curated (specifically to reduce CVEs) and MUST survive byte-for-byte.`,
    '',
    `Rules for this file:`,
    `- Write the bytes between the BEGIN/END markers below EXACTLY as shown — same ` +
      `coordinates, same versions, same ordering, same formatting.`,
    `- Do NOT regenerate, overwrite, replace, re-pin, upgrade, downgrade, re-order, or ` +
      `infer an alternative build file for this module.`,
    `- Do NOT change, add, or remove any declared dependency or version.`,
    `- You MAY add scaffolding AROUND this file (plugin blocks, build config, project ` +
      `metadata, surrounding boilerplate needed to make it build) — but build the rest of ` +
      `the codebase to FIT this file, never the reverse.${versionUnknownLine}`,
    '',
    `The exact file content follows between the markers (reproduce verbatim; the marker ` +
      `lines themselves are NOT part of the file):`,
    SEED_FILE_BODY_BEGIN,
    // VERBATIM body — no transform whatsoever.
    manifest.content,
    SEED_FILE_BODY_END,
  ];

  return lines.join('\n');
}

/** Type guard: the builder returned a rejection rather than a block string. */
export function isRejectedSeedFile(
  result: string | RejectedSeedFile,
): result is RejectedSeedFile {
  return typeof result !== 'string' && result.rejected === true;
}
