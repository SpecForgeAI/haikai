/**
 * Seed-build-files enrichment seam for the Migration Shape-Spec generation flow.
 *
 * Spec: 2026-06-24-confirmed-manifest-to-target-codebase (Spec 5) — Task Groups
 * 3 ("Inject the write block into the dedicated 'seed build files' story,
 * sequenced FIRST") and 4 ("Trigger on target-state confirmation; commit rides
 * the normal IVS flow at implementation start").
 *
 * PURE over its inputs except for structured `[diag-gateway]` logging (the
 * no-silent-drop rule). No network, no LLM, no orchestration — the HANDLER owns
 * the batch lifecycle; this module only:
 *
 *   1. RECOGNISES the dedicated seed-build-files story (a stable `kind` marker on
 *      the book-of-work blob item — consistent with how the handler already
 *      recognises `sourceCapabilityId` / manual-add `provenance` + `kind`).
 *   2. ADAPTS Spec 3's confirmed manifests (`ConfirmedManifestArtifact`) into the
 *      Group 1 `SeedFileManifest` shape.
 *   3. RESOLVES each manifest's destination path via Group 2 (the service→module
 *      mapping is the source of truth) and BUILDS the Group 1 verbatim
 *      "write this exact file" block per module.
 *   4. ASSEMBLES the per-module blocks into ONE enrichment string with explicit
 *      FIRST-sequencing + authoritative-lock framing, ready to ride the seed
 *      story's `generatedSpecText`.
 *
 * WHY A DEDICATED SEED STORY, SEQUENCED FIRST (LOCKED, D4/D6)
 * ----------------------------------------------------------
 * The write instruction(s) ride a DEDICATED "seed build files" story — NOT the
 * first feature/foundation story — sequenced FIRST so the rest of the build is
 * constructed on top of the authoritative file. Because the seed story runs
 * first, the seeded build file(s) are committed at the START of implementation,
 * riding the EXISTING IVS commit/push/PR flow with NO special-case handoff and
 * NO new commit path. The `POST /api/v2/jobs/orchestrations` contract is
 * UNCHANGED (`spec_name` + `context_files` only); the manifest lives inside the
 * spec's requirements text because IVS has no seed-file input (D8 deferred).
 *
 * GROUP 4 TRIGGER (D7)
 * --------------------
 * The {@link SeedBuildFilesSource} DI seam reads Spec 3's CONFIRMED manifest(s) +
 * service mapping from the confirmed-target source (the captured-decisions close /
 * `target-tech-stack-<id>.md` write seam). It CONSUMES that confirmed artifact
 * as-is — it does NOT re-parse, re-resolve, or re-curate, and does NOT call the
 * discovery resolvers (`MavenDependencyResolver`, `mavenPomMetadataParser`,
 * `NpmDependencyResolver`). When NO confirmed manifest exists the seam is a safe
 * no-op (no empty / garbage seed block).
 *
 * V1 BOUNDARY (HONEST — D3/D8)
 * ----------------------------
 * The v1 mechanism is spec-text injection with ZERO IVS change: no new IVS
 * endpoint, no "seed files" input, no build-file editing/upgrading, no SBOM/SCA.
 * The first-class "IVS seed-files input" (D8) is the deferred longer-term
 * alternative and is explicitly NOT built in v1.
 */

import { logger } from './logger';
import {
  SeedFileManifest,
  SeedFileName,
  buildSeedFileWriteBlock,
  isRejectedSeedFile,
  manifestBodyHasVersionUnknown,
} from './seedBuildFileWriteBlock';
import {
  ServiceModuleMapping,
  TargetArchitectureLayout,
  DEFAULT_TARGET_ARCHITECTURE_LAYOUT,
  attachResolvedDestination,
  isResolvedSeedDestination,
} from './seedBuildFileDestination';
import { LoadedBookOfWorkItem } from './migrationShapeSpecGenerationHandler';

// ---------------------------------------------------------------------------
// Seed-build-files story recognition (Group 3.3 — stable marker)
// ---------------------------------------------------------------------------

/**
 * The stable `kind` marker the dedicated seed-build-files story carries on its
 * book-of-work blob item. Recognising the story by an explicit, known `kind`
 * mirrors the handler's existing convention of reading `kind` / `provenance` /
 * `sourceCapabilityId` off the blob item (NO new DDL). The seed story is minted
 * upstream with this marker; the handler routes ONLY this story through the
 * verbatim-manifest carriage path.
 */
export const SEED_BUILD_FILES_STORY_KIND = 'seed_build_files';

/**
 * True when the story is the dedicated seed-build-files story. Recognised by
 * EITHER its `kind` marker (the original create-time seed story) OR a
 * `seed_build_files` TAG (Spec 6's scaffold story, whose `kind` is `operational`
 * to satisfy AMS `ALLOWED_KINDS`). Tolerant of surrounding whitespace / case so
 * an upstream producer that stamps `Seed_Build_Files` still matches.
 */
export function isSeedBuildFilesStory(story: LoadedBookOfWorkItem): boolean {
  if ((story.kind ?? '').trim().toLowerCase() === SEED_BUILD_FILES_STORY_KIND) {
    return true;
  }
  return (story.tags ?? []).some(
    (t) => (t ?? '').trim().toLowerCase() === SEED_BUILD_FILES_STORY_KIND,
  );
}

// ---------------------------------------------------------------------------
// Group 4 trigger seam: confirmed-manifest source (Spec 3 hand-off consumer)
// ---------------------------------------------------------------------------

/**
 * The confirmed-manifest bundle the seed-build-files enrichment consumes. This
 * is the Spec 3 confirmed hand-off, ADAPTED to Spec 5's carriage shape:
 *   - `manifests` — the confirmed manifests as Group 1 `SeedFileManifest`s
 *     (verbatim content + per-module `serviceTag`).
 *   - `mapping`   — the service→module mapping (Group 2's source of truth for the
 *     destination path).
 *   - `layout`    — the target architecture layout (monorepo default / multi-repo).
 *
 * Produced from Spec 3's `ConfirmedManifestArtifact[]` via
 * {@link confirmedArtifactsToSeedBundle}; consumed as-is (NO re-parse /
 * re-resolve / re-curate — D7).
 */
export interface ConfirmedManifestBundle {
  manifests: SeedFileManifest[];
  mapping: ServiceModuleMapping;
  layout: TargetArchitectureLayout;
}

/**
 * Identifying context the handler passes to the {@link SeedBuildFilesSource} so
 * it can locate the confirmed manifest(s) for THIS batch's target architecture.
 */
export interface SeedBuildFilesSourceInput {
  projectId: string;
  bookOfWorkId: string;
  /** The batch's target architecture id, when known (the confirmed-target key). */
  targetArchitectureId?: string | null;
}

/**
 * Group 4 DI seam: read Spec 3's CONFIRMED manifest(s) + service mapping from the
 * confirmed-target source. Returns `null` (NOT an empty bundle) when no confirmed
 * manifest exists, so the caller treats it as a safe NO-OP rather than emitting
 * an empty seed block.
 *
 * The default production wiring (in the handler/route) is intentionally a no-op
 * that returns `null` in v1 until the confirmed-manifest persistence read is
 * wired; tests + the orchestrating caller inject a concrete source. This keeps
 * the seam HONEST about the v1 boundary while leaving the contract in place.
 */
export type SeedBuildFilesSource = (
  input: SeedBuildFilesSourceInput,
) => Promise<ConfirmedManifestBundle | null>;
/**
 * Honest v1 DEFAULT production source: a documented NO-OP that returns null.
 *
 * Spec 5 v1 ships the carriage SEAM (recognition + verbatim block builder +
 * per-module destination resolution + handler threading) end-to-end, but the
 * concrete read of Spec 3's persisted CONFIRMED manifest(s) + service mapping
 * for a given target architecture is the integration point a real producer
 * wires in (the confirmed-manifest store / target-tech-stack read). Until that
 * read is wired, production returns null so the seed carriage is a safe no-op
 * and NO ordinary story is affected. This keeps the v1 boundary HONEST: there
 * is ZERO IVS change and no fabricated seed block when no confirmed manifest
 * exists. The orchestrating caller / tests inject a concrete SeedBuildFilesSource
 * to exercise the full path.
 */
export const defaultProductionSeedBuildFilesSource: SeedBuildFilesSource = async () => {
  return null;
};

// ---------------------------------------------------------------------------
// Spec 3 → Spec 5 adaptation (ConfirmedManifestArtifact → SeedFileManifest)
// ---------------------------------------------------------------------------

/**
 * The MINIMAL slice of Spec 3's `ConfirmedManifestArtifact`
 * (`services/targetManifest/manifestHandoffs.ts`) that Spec 5 needs to carry the
 * file verbatim + place it per module. Declared structurally (NOT imported) so
 * this seam does not take a hard dependency on the upstream module's full shape —
 * mirroring the inline-DTO convention. A real `ConfirmedManifestArtifact`
 * structurally satisfies this.
 */
export interface ConfirmedManifestArtifactLike {
  /** Target module/service tag (the per-module placement key). */
  tag: string;
  /** The parsed-manifest kind — used to derive the build-file name. */
  kind: 'maven_pom' | 'npm_package' | string;
  /** Provenance path of the source manifest (a fallback file-name hint). */
  manifestPath: string;
  /** VERBATIM manifest bytes — carried unchanged (declared deps/versions frozen). */
  content: string;
  /** Group 2 resolved deps (concrete / version-unknown) — used to flag unknowns. */
  resolvedDependencies?: ReadonlyArray<{ versionUnknown?: boolean | null }> | null;
}

/**
 * Derive the seed build-file name from a confirmed artifact. Spec 3 scope is
 * `pom.xml` + `package.json` ONLY (no Gradle); the `kind` is authoritative, with
 * the `manifestPath` basename as a tolerant fallback. Returns `null` for an
 * unrecognised kind so the caller rejects-with-log (never a silent drop).
 */
export function seedFileNameForArtifact(
  artifact: ConfirmedManifestArtifactLike,
): SeedFileName | null {
  const kind = (artifact.kind ?? '').trim().toLowerCase();
  if (kind === 'maven_pom') return 'pom.xml';
  if (kind === 'npm_package') return 'package.json';
  // Tolerant fallback: inspect the provenance path basename.
  const base = (artifact.manifestPath ?? '').split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (base === 'pom.xml') return 'pom.xml';
  if (base === 'package.json') return 'package.json';
  return null;
}

/**
 * True iff this confirmed artifact carries at least one `version-unknown`
 * resolved dependency, OR its verbatim body contains the literal marker. The
 * marker rides through verbatim either way; this flag only drives the
 * `[diag-gateway]` note + the block's "do NOT invent a version" clause.
 */
export function artifactHasVersionUnknown(
  artifact: ConfirmedManifestArtifactLike,
): boolean {
  const deps = artifact.resolvedDependencies ?? [];
  if (Array.isArray(deps) && deps.some((d) => d?.versionUnknown === true)) {
    return true;
  }
  return manifestBodyHasVersionUnknown(artifact.content ?? '');
}

/**
 * Adapt ONE confirmed artifact into a Group 1 `SeedFileManifest`. Returns `null`
 * (logged) for an unsupported file kind — never a silent drop. The verbatim
 * `content` is carried through UNCHANGED.
 */
export function confirmedArtifactToSeedManifest(
  artifact: ConfirmedManifestArtifactLike,
): SeedFileManifest | null {
  const fileName = seedFileNameForArtifact(artifact);
  if (fileName === null) {
    logger.warn(
      `[diag-gateway] confirmed_manifest_to_codebase seed_artifact_rejected ` +
        `tag=${artifact.tag} kind=${String(artifact.kind)} ` +
        `manifestPath=${artifact.manifestPath} reason=unsupported_kind`,
    );
    return null;
  }
  return {
    fileName,
    content: artifact.content ?? '',
    serviceTag: artifact.tag,
    hasVersionUnknown: artifactHasVersionUnknown(artifact),
  };
}

/**
 * Adapt Spec 3's confirmed artifacts + mapping + layout into a
 * {@link ConfirmedManifestBundle} for the seam. Artifacts with an unsupported
 * kind are dropped WITH a log (via {@link confirmedArtifactToSeedManifest}); an
 * empty/all-unsupported input yields a bundle with zero manifests (the caller
 * then treats it as a no-op).
 */
export function confirmedArtifactsToSeedBundle(
  artifacts: ReadonlyArray<ConfirmedManifestArtifactLike>,
  mapping: ServiceModuleMapping,
  layout: TargetArchitectureLayout = DEFAULT_TARGET_ARCHITECTURE_LAYOUT,
): ConfirmedManifestBundle {
  const manifests: SeedFileManifest[] = [];
  for (const a of artifacts) {
    const m = confirmedArtifactToSeedManifest(a);
    if (m) manifests.push(m);
  }
  return { manifests, mapping, layout };
}

// ---------------------------------------------------------------------------
// Enrichment assembly (Group 3.2 + 3.4)
// ---------------------------------------------------------------------------

/** Stable heading the handler appends to mark the start of the seed carriage. */
export const SEED_BUILD_FILES_SECTION_HEADING =
  '## SEED BUILD FILES — AUTHORITATIVE, WRITE FIRST (do these before any other implementation)';

/** Result of assembling the seed-build-files enrichment text. */
export interface SeedBuildFilesEnrichment {
  /**
   * The assembled enrichment text to append to the seed story's spec, or `null`
   * when there is nothing to carry (no bundle / no resolvable manifests) — the
   * caller appends nothing in that case (safe no-op).
   */
  text: string | null;
  /** Count of per-module write-blocks actually carried. */
  carriedCount: number;
  /** Manifests skipped (unsupported kind already dropped upstream; here = unresolved path / rejected block) with reasons. */
  skipped: Array<{ serviceTag: string; fileName: string; reason: string }>;
}

/**
 * Assemble the FIRST-sequenced seed-build-files enrichment from a confirmed
 * bundle: one verbatim "write this exact file" block per module, each with its
 * own Group 2-resolved destination path, wrapped in explicit
 * write-first / authoritative-lock / honest-v1-boundary framing.
 *
 * Posture:
 *   - Each manifest is resolved INDEPENDENTLY (multiple manifests → multiple
 *     per-module blocks, distinct paths — D5).
 *   - An UNRESOLVED destination path does NOT drop the manifest silently and does
 *     NOT guess a path: the block still carries the verbatim file with an explicit
 *     "destination UNRESOLVED" notice (Group 1), and the skip/why is logged +
 *     surfaced in `skipped[]` (Group 2.4 + 3.4). The block is still carried so the
 *     verbatim file is never lost.
 *   - A `version-unknown` marker rides through verbatim (D7).
 *   - NO silent caps: the carried + skipped counts are logged.
 *
 * Returns `text: null` (a safe no-op) when the bundle is null/empty.
 */
export function buildSeedBuildFilesEnrichment(
  bundle: ConfirmedManifestBundle | null,
): SeedBuildFilesEnrichment {
  const skipped: SeedBuildFilesEnrichment['skipped'] = [];

  if (!bundle || bundle.manifests.length === 0) {
    // Safe no-op: no confirmed manifest → emit nothing (no empty/garbage block).
    logger.info(
      `[diag-gateway] confirmed_manifest_to_codebase seed_build_files_noop ` +
        `reason=${bundle ? 'no_manifests' : 'no_confirmed_bundle'} carried=0`,
    );
    return { text: null, carriedCount: 0, skipped };
  }

  const blocks: string[] = [];
  for (const manifest of bundle.manifests) {
    // Group 2: resolve the destination path from the service→module mapping and
    // feed it back into the manifest (never mutates the input).
    const { manifest: withDest, destination } = attachResolvedDestination(
      manifest,
      bundle.mapping,
      bundle.layout,
    );
    if (!isResolvedSeedDestination(destination)) {
      // Surfaced (already logged by Group 2). We DO NOT drop the file — the
      // verbatim content is too important to lose — but we record the unresolved
      // path so the threading layer/UI can see it (no silent cap).
      skipped.push({
        serviceTag: manifest.serviceTag,
        fileName: manifest.fileName,
        reason: 'destination_unresolved',
      });
    }

    // Group 1: build the verbatim write-block (verbatim body + exact-write +
    // authoritative-lock + destination/unresolved notice + version-unknown clause).
    const block = buildSeedFileWriteBlock(withDest);
    if (isRejectedSeedFile(block)) {
      // Unsupported kind reached the builder (already logged); record + skip ONLY
      // this block — never the whole batch.
      skipped.push({
        serviceTag: manifest.serviceTag,
        fileName: manifest.fileName,
        reason: 'rejected_unsupported_kind',
      });
      continue;
    }
    blocks.push(block);
  }

  if (blocks.length === 0) {
    // Everything was rejected — nothing to carry. Safe no-op (logged).
    logger.warn(
      `[diag-gateway] confirmed_manifest_to_codebase seed_build_files_noop ` +
        `reason=all_blocks_rejected carried=0 skipped=${skipped.length}`,
    );
    return { text: null, carriedCount: 0, skipped };
  }

  const preamble: string[] = [
    SEED_BUILD_FILES_SECTION_HEADING,
    '',
    `This is the DEDICATED "seed build files" story and it is SEQUENCED FIRST: ` +
      `implement the file write(s) below BEFORE any other story in this migration. ` +
      `The rest of the build is constructed ON TOP OF these authoritative files.`,
    '',
    `Each block below is an EXACT-WRITE instruction for one target module's build ` +
      `file (\`pom.xml\` / \`package.json\`). The declared dependencies and their ` +
      `versions were curated specifically to reduce CVEs: the INITIAL write must ` +
      `reproduce each file EXACTLY as shown at EXACTLY its stated destination path, ` +
      `and every declared entry must survive every later edit — never regenerate, ` +
      `re-pin, upgrade, downgrade, or replace an existing entry. The file is a ` +
      `STARTING POINT, not a freeze: when a requirement in this or a later spec ` +
      `needs a dependency, plugin, or build setting the file lacks, ADD the minimal ` +
      `entry (version-less where a managed BOM owns the version), citing the ` +
      `requirement/[decision:<code>] that demanded it. Build the rest of the ` +
      `codebase to FIT these files.`,
    '',
    `PHASE NOTE: the write instructions above apply to the IMPLEMENT phase only. ` +
      `During spec SHAPING, record these blocks in the spec verbatim — do not ` +
      `write any file to the repository while shaping.`,
    '',
    `Commit timing: because this story runs first, these files are committed at ` +
      `the START of implementation and ride the normal build / commit / push / PR ` +
      `flow — there is no special handoff. (v1 carries the files inline in this ` +
      `spec text; there is no separate "seed files" upload mechanism.)`,
    '',
  ];

  const text = [...preamble, blocks.join('\n\n')].join('\n');

  logger.info(
    `[diag-gateway] confirmed_manifest_to_codebase seed_build_files_carried ` +
      `carried=${blocks.length} skipped=${skipped.length} ` +
      `layout=${bundle.layout}`,
  );

  return { text, carriedCount: blocks.length, skipped };
}

/**
 * Convenience for the Group 4 trigger path: resolve the confirmed bundle via the
 * source seam (or `null`), then assemble the enrichment. Centralises the
 * "trigger → read confirmed manifest → emit blocks (or no-op)" flow so the
 * handler call site stays a single line, and so the no-op + manifest-count
 * `[diag-gateway]` marker is emitted in ONE place.
 *
 * NEVER throws: a source error degrades to a safe no-op (logged) so a confirmed-
 * manifest read hiccup can never break the batch (consistent with the handler's
 * per-story isolation posture + the non-blocking external-call rule).
 */
export async function resolveSeedBuildFilesEnrichment(
  source: SeedBuildFilesSource | undefined,
  input: SeedBuildFilesSourceInput,
): Promise<SeedBuildFilesEnrichment> {
  if (!source) {
    // No source wired (the honest v1 default) → safe no-op.
    return { text: null, carriedCount: 0, skipped: [] };
  }
  let bundle: ConfirmedManifestBundle | null = null;
  try {
    bundle = await source(input);
  } catch (e) {
    logger.warn(
      `[diag-gateway] confirmed_manifest_to_codebase seed_build_files_source_error ` +
        `projectId=${input.projectId} bookOfWorkId=${input.bookOfWorkId} ` +
        `error=${e instanceof Error ? e.message : String(e)}`,
    );
    return { text: null, carriedCount: 0, skipped: [] };
  }
  const enrichment = buildSeedBuildFilesEnrichment(bundle);
  // Group 4.4: explicit manifest-count marker (carried + skipped-with-reason).
  logger.info(
    `[diag-gateway] confirmed_manifest_to_codebase seed_build_files_injection ` +
      `projectId=${input.projectId} bookOfWorkId=${input.bookOfWorkId} ` +
      `carried=${enrichment.carriedCount} skipped=${enrichment.skipped.length} ` +
      `ivs_change=none v1_mechanism=spec_text_injection`,
  );
  return enrichment;
}
