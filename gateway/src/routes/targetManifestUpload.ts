/**
 * Target dependency-manifest upload route.
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3) —
 * Task Group 1 (route + tagging + resolver-backed parsing) PLUS the Group 6
 * hand-off exposure (tasks 6.1 + 6.2): the route now runs the full (re-)upload
 * iterate loop via `processManifestUpload` (Groups 2-4) so the response carries:
 *   - the Group 3 auto-answer outcome (rows written / partial-failure / skipped
 *     manual codes), and
 *   - the recomputed STRUCTURED target-version set (Spec 4's hand-off source,
 *     `version-unknown` passthrough), and
 *   - the confirmed per-module/service-tagged manifests (Spec 5's hand-off
 *     source for the write-this-exact-file codebase artifact).
 *
 * Spec: 2026-06-25-confirmed-manifest-producer-wiring (Spec 5 Phase 2) —
 * Task Group 3 (persist-on-upload): immediately after the confirmed manifest
 * artifacts are built, a FAIL-SOFT call persists their verbatim bytes to the new
 * AMS `target_manifest_artifacts` store (keyed by
 * `(projectId, targetArchitectureId, tag)`) via the gateway -> AMS client. The
 * persist NEVER alters or blocks the upload response — a write hiccup is caught,
 * logged via the `[diag-gateway]` posture, and degraded to a no-op so the
 * response still carries `autoAnswer` exactly as before. The persist seam is
 * injectable (mirroring the orchestrator `deps`) so route tests can stub it.
 *
 * Accepts one or more TARGET dependency manifests (`pom.xml` / `package.json`
 * only, plus an optional `package-lock.json` paired with a `package.json`),
 * each tagged to a target module/service, and parses them through the
 * gateway-local resolver port (a faithful reuse of the LOCKED discovery-service
 * Maven/npm resolver contract — see
 * `services/targetManifest/manifestDependencyResolvers.ts`). Versions are stored
 * VERBATIM at parse time; the layered version-resolution (Task Group 2) and the
 * deterministic auto-answer (Task Group 3) sit on top.
 *
 * This route introduces NO new captured-decision endpoint — the auto-answer
 * writes flow through the EXISTING `targetStateCapturedDecisionsWriter` POST seam
 * inside `processManifestUpload`. It NEVER PATCHes/DELETEs (re-upload supersede is
 * the AMS append-only convention).
 *
 * NO SILENT DROPS: every file that is rejected (unsupported type, missing tag,
 * unpaired lockfile, unparseable, empty) is LOGGED via `logger` with its path +
 * reason AND reported back in the response `droppedManifests[]`.
 *
 * Mount: attached onto the shared `architectConversationRouter` (mounted at
 * `/api`) via {@link registerTargetManifestUploadRoute}, so the full path is
 *   POST /api/projects/:projectId/target-architectures/:targetArchitectureId/target-manifests
 * The multipart idiom mirrors `routes/discovery.ts` log-files +
 * `routes/missingInputResolutions.ts` parse-files (multer memoryStorage).
 */

import { Router, Request, Response as ExpressResponse } from 'express';
import multer from 'multer';
import { logger } from '../services/logger';
import {
  ManifestKind,
  ParsedManifest,
  UnparsedManifest,
  UploadedManifestInput,
  parseUploadedManifest,
} from '../services/targetManifest/parsedManifestModel';
import {
  ManifestUploadOrchestratorDeps,
  ProcessManifestUploadResult,
  defaultManifestUploadOrchestratorDeps,
  processManifestUpload,
} from '../services/targetManifest/manifestUploadOrchestrator';
import type { PendingVersionConfirmationEntry } from '../services/architectConversation/turnShape';
import {
  ConfirmedManifestArtifact,
  buildConfirmedManifestArtifacts,
} from '../services/targetManifest/manifestHandoffs';
import {
  TargetManifestArtifactInput,
  TargetManifestArtifactWire,
  Tier2FactWire,
  fetchLatestTargetManifestArtifacts,
  persistTargetManifestArtifacts,
} from '../services/targetManifestArtifactsClient';
// Manifest ↔ decision reconciliation (2026-08-15): proposed additions +
// conflicts; additions apply as a new latest artifact version.
import {
  applyAdditionsToPom,
  reconcileManifestWithAllDecisions,
} from '../services/targetManifest/manifestDecisionReconcile';
import { fetchLatestCapturedDecisions } from '../services/targetStateCapturedDecisionsClient';
import { autoApplyDecisionAdditions } from '../services/targetManifest/manifestDecisionAutoApply';

// ---------------------------------------------------------------------------
// Multipart config — in-memory only; the manifest bytes are parsed in-process
// and never written to disk. A pom.xml / package.json is tiny; a generous
// 5 MB-per-file ceiling covers even pathological manifests while keeping the
// multer default from silently truncating.
// ---------------------------------------------------------------------------

export const TARGET_MANIFEST_MAX_FILE_BYTES = (() => {
  const raw = process.env.TARGET_MANIFEST_MAX_FILE_BYTES;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 1024 * 1024; // 5 MB
})();

export const TARGET_MANIFEST_MAX_FILES = 50;

const manifestUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: TARGET_MANIFEST_MAX_FILE_BYTES,
    files: TARGET_MANIFEST_MAX_FILES,
  },
});

// ---------------------------------------------------------------------------
// Filename → manifest kind detection
// ---------------------------------------------------------------------------

/** Returns the supported manifest kind for a basename, or null if unsupported. */
export function detectManifestKind(originalName: string): ManifestKind | null {
  if (!originalName) return null;
  const base = originalName.split(/[\\/]/).pop() ?? originalName;
  const lower = base.toLowerCase();
  if (lower === 'pom.xml') return 'pom.xml';
  if (lower === 'package.json') return 'package.json';
  return null;
}

/** True iff the basename is a `package-lock.json` (paired lockfile, npm only). */
export function isPackageLock(originalName: string): boolean {
  if (!originalName) return false;
  const base = originalName.split(/[\\/]/).pop() ?? originalName;
  return base.toLowerCase() === 'package-lock.json';
}

// ---------------------------------------------------------------------------
// Tag resolution from the multipart body
// ---------------------------------------------------------------------------
//
// The per-manifest module/service tag arrives as a companion form field. Two
// shapes are accepted so the frontend can pick whichever is convenient:
//   1. Positional `tags` list aligned with the file parts (one entry per file,
//      same order). multer multi-value semantics produce a string[] when the
//      same field name repeats; a single tag arrives as a bare string.
//   2. A JSON `tagsByFilename` object mapping `originalname` -> tag, which wins
//      over the positional list when both supply a value for a file.
//
// A blank/missing tag is NOT silently accepted — the manifest is dropped with a
// clear reason (Spec 3: reject an untagged manifest).

interface ResolvedTags {
  positional: string[];
  byFilename: Record<string, string>;
}

export function resolveTagsFromBody(body: Record<string, unknown> | undefined): ResolvedTags {
  const positional: string[] = [];
  const rawTags = body?.tags;
  if (Array.isArray(rawTags)) {
    for (const v of rawTags) positional.push(typeof v === 'string' ? v : '');
  } else if (typeof rawTags === 'string') {
    positional.push(rawTags);
  }

  let byFilename: Record<string, string> = {};
  const rawByFilename = body?.tagsByFilename;
  if (typeof rawByFilename === 'string' && rawByFilename.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawByFilename);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, val] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof val === 'string') byFilename[k] = val;
        }
      }
    } catch {
      // Malformed tagsByFilename is ignored (positional list still applies);
      // the per-manifest drop path covers any file left without a tag.
      byFilename = {};
    }
  }

  return { positional, byFilename };
}

// ---------------------------------------------------------------------------
// Service-id resolution from the multipart body (Spec 2026-06-26 —
// target-manifest-service-association)
// ---------------------------------------------------------------------------
//
// PARALLEL to the tag seam above: the per-manifest target Service element id
// (the FK persisted as `target_service_element_id`) arrives as a companion form
// field. Two shapes are accepted, mirroring `resolveTagsFromBody`:
//   1. Positional `serviceIds` list aligned with the file parts.
//   2. A JSON `serviceIdsByFilename` object mapping `originalname` -> serviceId,
//      which wins over the positional list. THIS is the shape the frontend sends.
//
// Unlike the tag (which is required and drops an untagged manifest), the service
// id is a NULLABLE FK at this layer: a missing id resolves to `null` rather than
// dropping the manifest (the UI enforces required-ness; AMS owns ownership
// validation).

interface ResolvedServiceIds {
  positional: string[];
  byFilename: Record<string, string>;
}

export function resolveServiceIdsFromBody(
  body: Record<string, unknown> | undefined,
): ResolvedServiceIds {
  const positional: string[] = [];
  const rawIds = body?.serviceIds;
  if (Array.isArray(rawIds)) {
    for (const v of rawIds) positional.push(typeof v === 'string' ? v : '');
  } else if (typeof rawIds === 'string') {
    positional.push(rawIds);
  }

  let byFilename: Record<string, string> = {};
  const rawByFilename = body?.serviceIdsByFilename;
  if (typeof rawByFilename === 'string' && rawByFilename.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawByFilename);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, val] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof val === 'string') byFilename[k] = val;
        }
      }
    } catch {
      // Malformed serviceIdsByFilename is ignored (positional list still applies);
      // a manifest left without a service id simply carries a null FK.
      byFilename = {};
    }
  }

  return { positional, byFilename };
}

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

/**
 * The structured auto-answer + hand-off slice surfaced alongside the parsed
 * manifests (Group 6 hand-off exposure). Present only when at least one manifest
 * parsed (a 100%-dropped upload has nothing to auto-answer). Mirrors the shape
 * `processManifestUpload` returns, minus the bulky resolved-manifest internals
 * the UI does not need (it consumes `resolvedTargetVersions` + the confirmed
 * artifacts instead).
 */
export interface TargetManifestAutoAnswerSlice {
  /** Decision codes whose captured-decision rows were written successfully. */
  writtenCodes: string[];
  /** Successfully-written row count. */
  rowsWritten: number;
  /**
   * Codes attempted-but-not-written because the FIRST POST failure aborted the
   * remaining writes (the failed code + every code after it). Empty on success.
   */
  partialFailureCodes: string[];
  /** Whether a POST failure aborted the auto-answer run (partial success). */
  aborted: boolean;
  /** First-failure reason (null when the run completed cleanly). */
  failureReason: string | null;
  /**
   * Codes skipped because a MANUAL answer was preserved (manual-wins precedence,
   * Group 4). Surfaced so the UI can explain why a manifest value did not write.
   */
  skippedManualCodes: string[];
  /**
   * The recomputed STRUCTURED target-version set (latest manifests + surviving
   * manual edits; `version-unknown` passthrough). Spec 4's hand-off source AND
   * the data the UI renders as the auto-answered/provenance list.
   */
  resolvedTargetVersions: ProcessManifestUploadResult['resolvedTargetVersions'];
  /**
   * The confirmed per-module/service-tagged manifest artifacts — Spec 5's
   * hand-off source for the write-this-exact-file codebase artifact (one entry
   * per parsed manifest, carrying its tag + verbatim content + resolved deps).
   */
  confirmedManifests: ConfirmedManifestArtifact[];
  /**
   * Tier-2 "free facts" -- manifest-declared technology OUTSIDE the 51
   * questions (labels of the form "<friendly name> - <coordinate>", em-dash
   * separated), named by the upload LLM gap-fill. Informational +
   * editable/removable (NEVER new questions); feeds the prompt-ready output /
   * seed-build-files. Empty when the LLM is unwired or failed (fail-open).
   * Also PERSISTED on the `target_manifest_artifacts` store (Task Group 7).
   */
  freeFacts: string[];
  /**
   * Version-unknown manifest coordinates DIVERTED out of the captured-decision
   * write path into the persisted pending-version-confirmation set (Spec
   * 2026-06-27, design A). These wrote NO captured row and are NOT represented in
   * `resolvedTargetVersions` as auto-answered captures for the UI — they are
   * surfaced separately as an informational "Pending version confirmation (N)"
   * affordance and asked FIRST in the conversation (framework pre-chosen). The
   * normal `/answer` path captures the row once the user confirms the version.
   */
  pendingVersionConfirmations: PendingVersionConfirmationEntry[];
}

/**
 * Outcome of the confirmed-manifest AMS persist (2026-08-14) — SURFACED on the
 * upload response instead of log-only. The live failure this closes: the
 * persist was fail-soft with a `[diag-gateway]` line only, so an upload could
 * "succeed" on screen while the manifest store stayed empty — and the plan's
 * scaffold story (which reads that store) could never be created, with
 * nothing anywhere telling the operator why.
 */
export interface ManifestPersistOutcome {
  status: 'ok' | 'failed' | 'skipped_empty';
  artifactCount: number;
  tags: string[];
  /** The AMS/client error (status + body snippet) when `status='failed'`. */
  error?: string;
}

export interface TargetManifestUploadResponse {
  parsedManifests: ParsedManifest[];
  droppedManifests: UnparsedManifest[];
  /** Convenience counts so the UI does not re-derive them. */
  summary: {
    parsedCount: number;
    droppedCount: number;
    totalDeclaredDependencies: number;
  };
  /**
   * Auto-answer + hand-off slice (Groups 3/4/6). Null when no manifest parsed
   * (nothing to resolve/answer) OR when the auto-answer step is intentionally
   * not run (the parse-only test seam below). NEVER throws — a write failure is
   * surfaced via `aborted` / `partialFailureCodes`.
   */
  autoAnswer: TargetManifestAutoAnswerSlice | null;
  /**
   * Confirmed-manifest persist outcome (2026-08-14). Absent/null on the
   * parse-only seam and on a 100%-dropped upload. `failed` carries the AMS
   * error so the operator sees WHY the manifest store did not update.
   */
  manifestPersist?: ManifestPersistOutcome | null;
}

// ---------------------------------------------------------------------------
// Confirmed-manifest persist seam (Spec 5 Phase 2, Task Group 3)
//
// Spec 3 built the verbatim `ConfirmedManifestArtifact[]` but only ever surfaced
// them in the HTTP response, then dropped them. This seam writes those bytes to
// the new AMS `target_manifest_artifacts` store so the spec-gen producer (a
// separate, later request keyed by the SAME `targetArchitectureId`) can read the
// verbatim build file back and emit it into the generated codebase.
//
// The seam is injectable (defaulting to `defaultPersistConfirmedManifests`) so
// route tests can stub the AMS write — exactly like the orchestrator `deps`.
// ---------------------------------------------------------------------------

/**
 * Persists the confirmed manifest artifacts for a target architecture. Resolves
 * normally on success and MAY reject on a write hiccup — the CALLER
 * ({@link buildTargetManifestUploadResponseWithAutoAnswer}) wraps it fail-soft so
 * a rejection never reaches the upload response.
 */
export type PersistConfirmedManifestsSeam = (
  projectId: string,
  targetArchitectureId: string,
  artifacts: readonly ConfirmedManifestArtifact[],
  tier2Facts?: readonly Tier2FactWire[],
) => Promise<void>;

// ---------------------------------------------------------------------------
// Tier-2 "free facts" persist mapping (Spec 2026-06-26, Task Group 7)
//
// The orchestrator surfaces the upload-global Tier-2 free facts as
// "<friendly name> - <coordinate>" labels (em-dash separated, built by
// `manifestLlmGapFill.buildLabel`). For PERSISTENCE we split each label back
// into a { friendly_name, coordinate } object -- the shape the AMS
// `tier2_facts` JSONB column stores (mirroring `resolved_dependencies`). The
// split is on the LAST separator so a friendly name that itself contains it
// still yields the right (space-free) coordinate; a separator-less label is
// stored as a coordinate-less friendly name.
// ---------------------------------------------------------------------------

/** The em-dash separator the gap-fill label uses (mirrors `buildLabel`). */
const FREE_FACT_LABEL_SEPARATOR = ' \u2014 ';

/**
 * Split the orchestrator's Tier-2 free-fact LABELS into the persisted
 * `{ friendly_name, coordinate }` wire objects. Pure; tolerant of a malformed
 * (separator-less) label. Exported for unit testing.
 */
export function freeFactsToTier2Wire(freeFacts: readonly string[]): Tier2FactWire[] {
  const out: Tier2FactWire[] = [];
  for (const raw of freeFacts) {
    const label = typeof raw === 'string' ? raw.trim() : '';
    if (label.length === 0) continue;
    const idx = label.lastIndexOf(FREE_FACT_LABEL_SEPARATOR);
    if (idx === -1) {
      out.push({ friendly_name: label, coordinate: '' });
    } else {
      out.push({
        friendly_name: label.slice(0, idx).trim(),
        coordinate: label.slice(idx + FREE_FACT_LABEL_SEPARATOR.length).trim(),
      });
    }
  }
  return out;
}

/**
 * Maps one verified {@link ConfirmedManifestArtifact} onto the snake_case AMS
 * write payload ({@link TargetManifestArtifactInput}). `content` and
 * `packageLockContent` are carried VERBATIM (byte-for-byte — no trim, no
 * re-encode); `manifestPath` -> `manifest_path`,
 * `packageLockContent` -> `package_lock_content`,
 * `resolvedDependencies` -> `resolved_dependencies` (the resolved-dependency
 * objects pass through opaquely as JSONB). `kind` is carried as-is (the store
 * column is free TEXT; the actual `pom.xml`/`package.json` value is preserved
 * with no information loss).
 */
export function toTargetManifestArtifactInput(
  artifact: ConfirmedManifestArtifact,
  tier2Facts: readonly Tier2FactWire[] = [],
): TargetManifestArtifactInput {
  return {
    tag: artifact.tag,
    kind: artifact.kind ?? null,
    ecosystem: artifact.ecosystem ?? null,
    manifest_path: artifact.manifestPath ?? null,
    content: artifact.content,
    package_lock_content: artifact.packageLockContent ?? null,
    resolved_dependencies: artifact.resolvedDependencies.map(
      (d) => ({ ...d }) as Record<string, unknown>,
    ),
    // Per-manifest FK to the chosen target-state `services` element (nullable).
    target_service_element_id: artifact.targetServiceElementId ?? null,
    // Upload-global Tier-2 free facts (same set carried on every per-tag row).
    tier2_facts: tier2Facts.map((f) => ({ ...f })),
  };
}

/**
 * Default persist seam: maps the confirmed artifacts onto the snake_case write
 * payload and POSTs them to the AMS `target_manifest_artifacts` store via the
 * gateway -> AMS client. Lets the client's error surface so the fail-soft
 * wrapper at the call site can catch + log it.
 */
export const defaultPersistConfirmedManifests: PersistConfirmedManifestsSeam = async (
  projectId,
  targetArchitectureId,
  artifacts,
  tier2Facts = [],
) => {
  const payload = artifacts.map((a) => toTargetManifestArtifactInput(a, tier2Facts));
  await persistTargetManifestArtifacts(projectId, targetArchitectureId, payload);
};

// ---------------------------------------------------------------------------
// Seed-build-files story minting — history (corrected 2026-08-14)
//
// The upload-time `seed_build_files` story mint was removed from this route
// (Spec 2026-06-25 follow-up). A prior version of this comment claimed the
// mint was relocated to book-of-work CREATION time — that relocation was
// NEVER implemented, and creation-time seeding was subsequently deleted
// deliberately (Spec 2026-06-26 FR1: the orphan `parentId:null` seed story
// evaded hierarchy validation). The SINGLE live authority is the scaffold
// feature+story injection at PHASE-2 EPIC EXPANSION
// (`migrationBookOfWorkExpansionHandler.buildScaffoldInjectionForEpic`),
// gated on the confirmed manifest this route persists (Task Group 3, below).
// If the manifest is uploaded AFTER the foundations epic was expanded,
// RE-EXPANDING that epic injects the scaffold — the spec preflight surfaces
// this remedy. The dead `migrationSeedStoryMinting` module was deleted
// (2026-08-14).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Core PARSE handler (exported for unit testing without spinning Express).
//
// Pure with respect to I/O — operates on the already in-memory file buffers and
// runs NO auto-answer / network writes. Logs every dropped file (no silent
// drop). The Group-1 tests assert this seam directly; the auto-answer wiring is
// layered in `buildTargetManifestUploadResponseWithAutoAnswer` below so the
// parse contract is testable in isolation.
// ---------------------------------------------------------------------------

/**
 * Turn the multipart file parts + companion form fields into the parsed-manifest
 * slice of the response (parse + drop reporting only). The returned `autoAnswer`
 * is always null here — the orchestrated auto-answer is added by
 * {@link buildTargetManifestUploadResponseWithAutoAnswer}.
 */
export function buildTargetManifestUploadResponse(
  files: Express.Multer.File[],
  body: Record<string, unknown> | undefined,
  logContext: Record<string, string>,
): TargetManifestUploadResponse {
  const tags = resolveTagsFromBody(body);

  // Split incoming parts into manifests vs paired package-lock.json files.
  const manifestFiles: Express.Multer.File[] = [];
  const lockFilesByDir = new Map<string, Express.Multer.File>();

  for (const f of files) {
    if (isPackageLock(f.originalname)) {
      // Key the lockfile by its directory so it can be paired with the
      // package.json in the same directory; bare filename uploads key on ''.
      lockFilesByDir.set(dirKeyOf(f.originalname), f);
    } else {
      manifestFiles.push(f);
    }
  }

  const parsedManifests: ParsedManifest[] = [];
  const droppedManifests: UnparsedManifest[] = [];

  // Track which package.json indices consumed a lockfile so an orphan lockfile
  // (no matching package.json) can be reported as dropped.
  const consumedLockDirs = new Set<string>();

  manifestFiles.forEach((file, index) => {
    const kind = detectManifestKind(file.originalname);
    if (kind === null) {
      const dropped: UnparsedManifest = {
        status: 'unparsed',
        kind: null,
        tag: null,
        manifestPath: file.originalname,
        reason:
          'Unsupported file — only pom.xml and package.json (plus an optional ' +
          'package-lock.json paired with a package.json) are accepted.',
      };
      logDrop(dropped, logContext);
      droppedManifests.push(dropped);
      return;
    }

    const tag = pickTag(tags, file.originalname, index);

    let content: string;
    try {
      content = file.buffer.toString('utf-8');
    } catch (err) {
      const dropped: UnparsedManifest = {
        status: 'unparsed',
        kind,
        tag: tag || null,
        manifestPath: file.originalname,
        reason: `Could not decode file as UTF-8: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
      logDrop(dropped, logContext);
      droppedManifests.push(dropped);
      return;
    }

    let packageLockContent: string | null = null;
    if (kind === 'package.json') {
      const dir = dirKeyOf(file.originalname);
      const lock = lockFilesByDir.get(dir);
      if (lock) {
        consumedLockDirs.add(dir);
        try {
          packageLockContent = lock.buffer.toString('utf-8');
        } catch {
          packageLockContent = null;
        }
      }
    }

    const input: UploadedManifestInput = {
      manifestPath: file.originalname,
      kind,
      tag,
      content,
      packageLockContent,
    };

    const result = parseUploadedManifest(input);
    if (result.status === 'unparsed') {
      logDrop(result, logContext);
      droppedManifests.push(result);
    } else {
      parsedManifests.push(result);
    }
  });

  // Report orphan lockfiles (uploaded without a matching package.json).
  for (const [dir, lock] of lockFilesByDir.entries()) {
    if (consumedLockDirs.has(dir)) continue;
    const dropped: UnparsedManifest = {
      status: 'unparsed',
      kind: null,
      tag: null,
      manifestPath: lock.originalname,
      reason:
        'package-lock.json uploaded without a matching package.json in the same ' +
        'directory — lockfiles are only used to pin an accompanying package.json.',
    };
    logDrop(dropped, logContext);
    droppedManifests.push(dropped);
  }

  const totalDeclaredDependencies = parsedManifests.reduce(
    (sum, m) => sum + m.declaredDependencies.length,
    0,
  );

  return {
    parsedManifests,
    droppedManifests,
    summary: {
      parsedCount: parsedManifests.length,
      droppedCount: droppedManifests.length,
      totalDeclaredDependencies,
    },
    autoAnswer: null,
  };
}

/**
 * The full route behaviour: parse (Group 1) THEN run the (re-)upload iterate loop
 * (`processManifestUpload`, Groups 2-4) over the parsed manifests, and assemble
 * the auto-answer + hand-off slice (Group 6). Never throws on a write failure —
 * the partial outcome rides `autoAnswer.aborted` / `partialFailureCodes`.
 *
 * The orchestrator deps are injectable so route tests can stub the POST + read
 * seams (mirrors the prefill + precedence test seams). When the parse step drops
 * EVERY file there is nothing to resolve/answer, so `autoAnswer` is null.
 *
 * Spec 5 Phase 2 (Task Group 3): once the confirmed artifacts are built, their
 * verbatim bytes are persisted to the AMS store via `persistConfirmedManifests`
 * (injectable; defaults to {@link defaultPersistConfirmedManifests}). The persist
 * is FAIL-SOFT — wrapped in try/catch, logged via `[diag-gateway]` on failure,
 * and NEVER altering or blocking the returned response. (Seed-story minting was
 * RELOCATED to book-of-work CREATION time per the 2026-06-25 follow-up; this
 * route only persists the manifest bytes that the creation-time gate reads.)
 */
export async function buildTargetManifestUploadResponseWithAutoAnswer(args: {
  files: Express.Multer.File[];
  body: Record<string, unknown> | undefined;
  projectId: string;
  targetArchitectureId: string;
  conversationThreadId?: string | null;
  deps?: ManifestUploadOrchestratorDeps;
  /**
   * Injectable AMS-write seam (Task Group 3). Defaults to the real client-backed
   * {@link defaultPersistConfirmedManifests}. Route tests stub this to assert the
   * mapped payload and to exercise the fail-soft path.
   */
  persistConfirmedManifests?: PersistConfirmedManifestsSeam;
}): Promise<TargetManifestUploadResponse> {
  const { files, body, projectId, targetArchitectureId } = args;
  const parseResult = buildTargetManifestUploadResponse(files, body, {
    projectId,
    targetArchitectureId,
  });

  if (parseResult.parsedManifests.length === 0) {
    // 100%-dropped upload — nothing to resolve/answer; the drop reasons are
    // already logged + surfaced. Leave `autoAnswer` null.
    return parseResult;
  }

  const deps = args.deps ?? defaultManifestUploadOrchestratorDeps;
  const orchestrated = await processManifestUpload(
    {
      projectId,
      targetArchitectureId,
      conversationThreadId: args.conversationThreadId ?? null,
      parsedManifests: parseResult.parsedManifests,
    },
    deps,
  );

  // Resolve the per-manifest target Service element id from the body (parallel
  // to the tag seam) and carry it onto each confirmed artifact (-> the persisted
  // `target_service_element_id` FK). Keyed by `manifestPath` (== file
  // `originalname`), with a positional fallback.
  const serviceIds = resolveServiceIdsFromBody(body);
  const confirmedManifests = buildConfirmedManifestArtifacts(
    parseResult.parsedManifests,
    orchestrated.resolvedManifests,
    (manifestPath, index) => pickServiceId(serviceIds, manifestPath, index),
  );

  // -------------------------------------------------------------------------
  // FAIL-SOFT persist (Spec 5 Phase 2, Task Group 3).
  //
  // Persist the verbatim confirmed-manifest bytes to the AMS
  // `target_manifest_artifacts` store, keyed by
  // `(projectId, targetArchitectureId, tag)`. A write hiccup is caught + logged
  // via the `[diag-gateway]` posture (no silent drop) and degraded to a no-op —
  // it MUST NEVER alter or block the upload response, which always carries
  // `autoAnswer` exactly as before. Skipped (logged) when there are no confirmed
  // artifacts to persist.
  // -------------------------------------------------------------------------
  let manifestPersist: ManifestPersistOutcome;
  if (confirmedManifests.length > 0) {
    const persist = args.persistConfirmedManifests ?? defaultPersistConfirmedManifests;
    // Carry the orchestrator's Tier-2 free facts into the persisted payload
    // (split to { friendly_name, coordinate }); a write hiccup is still caught
    // below, so this never blocks the response.
    const tier2Facts = freeFactsToTier2Wire(orchestrated.freeFacts);
    try {
      await persist(projectId, targetArchitectureId, confirmedManifests, tier2Facts);
      logger.info('[diag-gateway] target_manifest_upload persist_confirmed_manifests_ok', {
        projectId,
        targetArchitectureId,
        artifactCount: confirmedManifests.length,
        tags: confirmedManifests.map((a) => a.tag),
      });
      manifestPersist = {
        status: 'ok',
        artifactCount: confirmedManifests.length,
        tags: confirmedManifests.map((a) => a.tag),
      };
    } catch (err) {
      // Fail-soft for the upload response's OTHER slices — but LOUD on the
      // response itself (2026-08-14): the operator must see that the manifest
      // store did NOT update, and why, because the plan's scaffold story
      // depends on this persist.
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('[diag-gateway] target_manifest_upload persist_confirmed_manifests_failed', {
        projectId,
        targetArchitectureId,
        artifactCount: confirmedManifests.length,
        tags: confirmedManifests.map((a) => a.tag),
        error: message,
      });
      manifestPersist = {
        status: 'failed',
        artifactCount: confirmedManifests.length,
        tags: confirmedManifests.map((a) => a.tag),
        error: message,
      };
    }
  } else {
    logger.info('[diag-gateway] target_manifest_upload persist_confirmed_manifests_skipped_empty', {
      projectId,
      targetArchitectureId,
    });
    manifestPersist = { status: 'skipped_empty', artifactCount: 0, tags: [] };
  }

  // -------------------------------------------------------------------------
  // Seed-story minting (corrected 2026-08-14): the scaffold feature+story
  // injects at EPIC-EXPANSION time, gated on the confirmed manifest the
  // persist above just wrote. If the foundations epic was expanded BEFORE
  // this upload, re-expanding it injects the scaffold — the spec preflight
  // surfaces that remedy. Nothing to do here.
  // -------------------------------------------------------------------------

  return {
    ...parseResult,
    autoAnswer: {
      writtenCodes: orchestrated.writeOutcome.writtenCodes,
      rowsWritten: orchestrated.writeOutcome.rowsWritten,
      partialFailureCodes: orchestrated.writeOutcome.partialFailureCodes,
      aborted: orchestrated.writeOutcome.aborted,
      failureReason: orchestrated.writeOutcome.failureReason,
      skippedManualCodes: orchestrated.skippedManualCodes,
      resolvedTargetVersions: orchestrated.resolvedTargetVersions,
      confirmedManifests,
      freeFacts: orchestrated.freeFacts,
      pendingVersionConfirmations:
        orchestrated.writeOutcome.pendingVersionConfirmations,
    },
    manifestPersist,
  };
}

function dirKeyOf(originalName: string): string {
  const norm = originalName.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(0, idx) : '';
}

function pickTag(tags: ResolvedTags, originalName: string, index: number): string {
  const byName = tags.byFilename[originalName];
  if (typeof byName === 'string' && byName.trim().length > 0) return byName.trim();
  const positional = tags.positional[index];
  if (typeof positional === 'string' && positional.trim().length > 0) {
    return positional.trim();
  }
  return '';
}

/**
 * Resolve the per-manifest target Service element id (the nullable FK), parallel
 * to {@link pickTag}: `serviceIdsByFilename` wins, then the positional list, else
 * `null` (a missing id is a null FK, NOT a drop).
 */
function pickServiceId(
  serviceIds: ResolvedServiceIds,
  originalName: string,
  index: number,
): string | null {
  const byName = serviceIds.byFilename[originalName];
  if (typeof byName === 'string' && byName.trim().length > 0) return byName.trim();
  const positional = serviceIds.positional[index];
  if (typeof positional === 'string' && positional.trim().length > 0) {
    return positional.trim();
  }
  return null;
}

function logDrop(dropped: UnparsedManifest, logContext: Record<string, string>): void {
  logger.warn('target-manifest upload: manifest dropped (no silent drop)', {
    ...logContext,
    manifestPath: dropped.manifestPath,
    kind: dropped.kind,
    reason: dropped.reason,
  });
}

// ---------------------------------------------------------------------------
// Manifest-artifacts READ proxy seam (Spec 2026-06-25 follow-up)
//
// A thin pass-through GET so the browser can LIST a target architecture's
// persisted confirmed manifests (the POST upload had no read counterpart). The
// list is round-tripped in AMS snake_case (`manifest_path`, `tag`, `kind`, ...).
// Modeled on the house proxy idiom (`routes/migrationBookOfWork.ts` GET): on an
// AMS-unreachable / read error we fail-soft to 503. The read is injectable
// (defaulting to the real client `fetchLatestTargetManifestArtifacts`) so route
// tests can stub it without a live AMS.
// ---------------------------------------------------------------------------

export type FetchTargetManifestArtifactsSeam = (
  projectId: string,
  targetArchitectureId: string,
) => Promise<TargetManifestArtifactWire[]>;

// ---------------------------------------------------------------------------
// Express wiring
// ---------------------------------------------------------------------------

/**
 * Attaches `POST .../target-manifests` onto the supplied router. Called once
 * from `architectConversation.ts` so the manifest route mounts ALONGSIDE the
 * existing conversation routes (Spec 3, task 1.2) without a new top-level mount
 * or a new captured-decision endpoint.
 */
export function registerTargetManifestUploadRoute(
  router: Router,
  /**
   * Injectable manifest-artifacts read seam for the GET proxy (defaults to the
   * real gateway -> AMS client). Route tests stub this to assert the proxied
   * list + the fail-soft path without a live AMS.
   */
  fetchManifestArtifacts: FetchTargetManifestArtifactsSeam = fetchLatestTargetManifestArtifacts,
): void {
  router.post(
    '/projects/:projectId/target-architectures/:targetArchitectureId/target-manifests',
    (req: Request, res: ExpressResponse, next) => {
      manifestUpload.any()(req, res, (err: unknown) => {
        if (err) {
          const code = (err as { code?: string }).code;
          if (code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
              error: `One or more manifests exceed the per-file size limit of ${TARGET_MANIFEST_MAX_FILE_BYTES} bytes`,
            });
          }
          if (code === 'LIMIT_FILE_COUNT') {
            return res.status(413).json({
              error: `Too many files (limit ${TARGET_MANIFEST_MAX_FILES})`,
            });
          }
          logger.warn('target-manifest upload: multer error parsing multipart body', {
            code,
            message: err instanceof Error ? err.message : String(err),
          });
          return res.status(400).json({
            error: `Multipart parse error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return next();
      });
    },
    async (req: Request, res: ExpressResponse) => {
      const { projectId, targetArchitectureId } = req.params;
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];

      if (files.length === 0) {
        return res
          .status(400)
          .json({ error: 'At least one manifest (pom.xml or package.json) must be uploaded' });
      }

      // Optional conversation thread id companion field (stamped on each written
      // captured-decision row so manifest rows carry the same thread envelope as
      // the rest of the conversation). Absent on a standalone upload.
      const body = req.body as Record<string, unknown> | undefined;
      const conversationThreadId =
        typeof body?.conversationThreadId === 'string' &&
        body.conversationThreadId.length > 0
          ? body.conversationThreadId
          : null;

      try {
        // Spec 2 R5: thread the ONE gap-fill LLM client through the manifest
        // path. A LAZY require avoids a LOAD-TIME circular import with
        // architectConversation.ts (which registers THIS route at its module top
        // level); buildArchitectLlmClient is only needed at REQUEST time, by when
        // both modules are fully initialised. Fail-open inside the orchestrator —
        // a missing/erroring LLM leaves the deterministic + inferred answers.
        const { buildArchitectLlmClient } =
          require('./architectConversation') as typeof import('./architectConversation');
        const response = await buildTargetManifestUploadResponseWithAutoAnswer({
          files,
          body,
          projectId,
          targetArchitectureId,
          conversationThreadId,
          deps: {
            ...defaultManifestUploadOrchestratorDeps,
            llmClient: buildArchitectLlmClient(),
          },
        });
        // Decision→manifest auto-apply (2026-08-16): the just-persisted pom is
        // a STARTING POINT — decisions already captured (a conversation run
        // before the upload) may require coordinates it lacks. Apply them NOW
        // and surface the outcome on the response so the panel/logs show what
        // was amended. Fail-soft inside; conflicts stay loud + manual.
        const decisionAutoApply = await autoApplyDecisionAdditions(
          projectId,
          targetArchitectureId,
        );
        return res.status(200).json({ ...response, decisionAutoApply });
      } catch (err) {
        logger.error('target-manifest upload: unexpected failure building response', {
          projectId,
          targetArchitectureId,
          error: err instanceof Error ? err.message : String(err),
        });
        return res
          .status(500)
          .json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET .../manifest-artifacts — thin READ proxy onto AMS.
  //
  // Full path (router mounted at `/api`):
  //   GET /api/projects/:projectId/target-architectures/:targetArchitectureId/manifest-artifacts
  // Lets the browser LIST the persisted confirmed manifests (latest per tag).
  // The snake_case wire list is round-tripped as-is. Fail-soft: an AMS read
  // hiccup degrades to 503 (matching the `migrationBookOfWork.ts` GET proxy)
  // rather than throwing — no silent drop (the failure is logged).
  // -------------------------------------------------------------------------
  router.get(
    '/projects/:projectId/target-architectures/:targetArchitectureId/manifest-artifacts',
    async (req: Request, res: ExpressResponse) => {
      const { projectId, targetArchitectureId } = req.params;
      try {
        const artifacts = await fetchManifestArtifacts(projectId, targetArchitectureId);
        return res.status(200).json(artifacts);
      } catch (err) {
        // Fail-soft: AMS unreachable / non-2xx -> 503 (no silent drop; logged).
        logger.warn('[diag-gateway] target_manifest_artifacts list proxy: AMS read failed', {
          projectId,
          targetArchitectureId,
          error: err instanceof Error ? err.message : String(err),
        });
        return res.status(503).json({
          error: 'Architecture model service unavailable',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // Manifest ↔ decision reconciliation (2026-08-15). The pom is the
  // authoritative BASELINE: existing entries never change silently, but
  // decisions imply ADDITIONS the operator can approve — applied as a new
  // latest artifact version with a minimal textual insert.
  //   GET  .../manifest-reconcile        → { tag, additions, conflicts }
  //   POST .../manifest-reconcile/apply  → { applied, tag } (body: {coordinates})
  // -------------------------------------------------------------------------
  const loadLatestMavenArtifact = async (projectId: string, targetArchitectureId: string) => {
    const artifacts = await fetchManifestArtifacts(projectId, targetArchitectureId);
    return (
      artifacts.find(
        (a) =>
          (a.ecosystem ?? '').toUpperCase() === 'MAVEN' ||
          (a.manifest_path ?? '').toLowerCase().endsWith('pom.xml')
      ) ?? null
    );
  };

  router.get(
    '/projects/:projectId/target-architectures/:targetArchitectureId/manifest-reconcile',
    async (req: Request, res: ExpressResponse) => {
      const { projectId, targetArchitectureId } = req.params;
      try {
        const artifact = await loadLatestMavenArtifact(projectId, targetArchitectureId);
        if (!artifact || !artifact.content) {
          return res.status(200).json({ tag: null, additions: [], conflicts: [] });
        }
        const decisions = await fetchLatestCapturedDecisions(projectId, targetArchitectureId);
        const result = reconcileManifestWithAllDecisions(artifact.content, decisions);
        return res.status(200).json({ tag: artifact.tag, ...result });
      } catch (err) {
        logger.warn('[diag-gateway] manifest_reconcile read failed', {
          projectId,
          targetArchitectureId,
          error: err instanceof Error ? err.message : String(err),
        });
        return res.status(503).json({
          error: 'reconciliation unavailable',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  router.post(
    '/projects/:projectId/target-architectures/:targetArchitectureId/manifest-reconcile/apply',
    async (req: Request, res: ExpressResponse) => {
      const { projectId, targetArchitectureId } = req.params;
      const coordinates: string[] = Array.isArray((req.body ?? {}).coordinates)
        ? (req.body.coordinates as string[])
        : [];
      if (coordinates.length === 0) {
        return res.status(400).json({ error: 'coordinates[] (g:a strings) is required' });
      }
      try {
        const artifact = await loadLatestMavenArtifact(projectId, targetArchitectureId);
        if (!artifact || !artifact.content) {
          return res.status(409).json({ error: 'no confirmed Maven manifest to amend' });
        }
        const decisions = await fetchLatestCapturedDecisions(projectId, targetArchitectureId);
        const { additions } = reconcileManifestWithAllDecisions(artifact.content, decisions);
        const selected = additions.filter((a) =>
          coordinates.includes(`${a.groupId}:${a.artifactId}`)
        );
        if (selected.length === 0) {
          return res
            .status(409)
            .json({ error: 'none of the requested coordinates is a pending addition' });
        }
        const updated = applyAdditionsToPom(artifact.content, selected);
        if (updated === null) {
          return res.status(409).json({
            error:
              'the pom has no <dependencies> section to insert into — amend it manually and re-upload',
          });
        }
        // New latest artifact version — the store keeps history; everything
        // except `content` carried verbatim from the prior latest row.
        // `resolved_dependencies` gains one entry per applied coordinate so
        // the row stays internally consistent (consumers of the resolved list
        // — e.g. vulnerability fate derivation — must see what `content` now
        // declares). BOM-managed additions ride the version-unknown sentinel.
        await persistTargetManifestArtifacts(projectId, targetArchitectureId, [
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
              ...selected.map((a) => ({
                name: `${a.groupId}:${a.artifactId}`,
                resolvedVersion: a.version ?? 'version-unknown',
                versionUnknown: a.version == null,
                ecosystem: 'MAVEN',
                provenance: 'decision-reconcile',
              })),
            ],
            target_service_element_id: artifact.target_service_element_id ?? null,
            tier2_facts: Array.isArray(artifact.tier2_facts) ? artifact.tier2_facts : [],
          },
        ]);
        logger.info('[diag-gateway] manifest_reconcile applied', {
          projectId,
          targetArchitectureId,
          tag: artifact.tag,
          applied: selected.map((a) => `${a.groupId}:${a.artifactId}`),
        });
        return res.status(200).json({
          tag: artifact.tag,
          applied: selected.map((a) => `${a.groupId}:${a.artifactId}`),
        });
      } catch (err) {
        logger.error('[diag-gateway] manifest_reconcile apply failed', {
          projectId,
          targetArchitectureId,
          error: err instanceof Error ? err.message : String(err),
        });
        return res.status(500).json({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}
