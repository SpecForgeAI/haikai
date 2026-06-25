/**
 * Seed-build-files story minting (gateway-side, fail-soft).
 *
 * SUPERSEDED / UNUSED BY PRODUCTION (Spec 2026-06-25 follow-up): production
 * seed-story minting has MOVED to book-of-work CREATION time in
 * `migrationBookOfWorkHandler.ts` (`generateMigrationBookOfWork`), where the seed
 * rides the initial `book_of_work_json` blob that AMS `createDraft` persists
 * WITHOUT per-item kind validation — sidestepping the AMS ALLOWED_KINDS 400 this
 * module's add-item path hits. This module is no longer wired into the upload
 * route; it is retained (with its tests) to avoid churn and as the documented
 * reference for the timing + AMS-kind gaps below.
 *
 * Spec: 2026-06-25-confirmed-manifest-producer-wiring (Spec 5 Phase 2) —
 * Task Group 4 (D3): mint the dedicated `seed_build_files` story.
 *
 * On confirm (= manifest upload), this module mints a FIRST-sequenced work item
 * carrying the `SEED_BUILD_FILES_STORY_KIND` marker so the already-built
 * consumer carriage (`migrationSeedBuildFilesEnrichment.ts` /
 * `isSeedBuildFilesStory`) recognises it and fills it with the verbatim build
 * file(s) at spec-gen time. The minting is:
 *
 *   - REUSABLE + INDEPENDENTLY FAIL-SOFT — a hiccup here is caught + logged via
 *     the `[diag-gateway]` posture and degraded to a no-op. It is invoked at the
 *     upload confirm point ALONGSIDE the Task Group 3 persist, but kept entirely
 *     independent: one failing must never affect the other or the upload
 *     response (the caller wraps it; this function also never throws).
 *   - FIRST-sequenced (`sequence_order = 0`, at/below the current min) so the
 *     seed story is the first eligible story — the carriage requires write-first
 *     ordering.
 *   - REPLACE-IN-PLACE — on re-upload/re-confirm the existing `seed_build_files`
 *     story for the book of work is left as the single seed story rather than a
 *     duplicate FIRST-sequenced story being appended (idempotent; see
 *     {@link findExistingSeedBuildFilesItem}).
 *   - SUPPRESSED TRIGGER — minting does NOT fire `runShapeSpecGenerationBatch`
 *     (the description-grounded spec-gen the ordinary add-item route fires). The
 *     seed story is filled by the existing enrichment carriage from the verbatim
 *     manifest bytes, not by a generated description. This module never calls the
 *     batch at all, so the suppression is structural and scoped to EXACTLY this
 *     kind — the ordinary `api`/`operational` manual-add path in the add-item
 *     route is untouched.
 *
 * ====================================================================
 * TIMING LIMITATION (documented; no silent drop) — bookId reality
 * --------------------------------------------------------------------
 * The AMS add-item mechanism mints into a SPECIFIC book of work
 * (`POST .../migration-books-of-work/:bookId/items/add-item`). At
 * manifest-upload time a book of work may NOT exist yet (books of work are
 * generated LATER in the workflow). This module therefore RESOLVES the book of
 * work for `(projectId, targetArchitectureId)` via the genuine AMS list seam
 * (`GET /api/projects/{projectId}/migration-books-of-work` -> match on
 * `target_architecture_id`). If NO book exists yet (or the lookup fails), it
 * SKIPS-WITH-LOG and continues — it NEVER breaks the upload and never invents a
 * bookId.
 *
 * Consequence: the seed story is minted only when a book of work ALREADY exists
 * for the target architecture at upload time. If the book is generated later,
 * minting must be re-driven there — flagged for follow-up. (A natural home is
 * the book-of-work generation path, which already has the bookId in hand.)
 *
 * ====================================================================
 * AMS `kind` allow-list gap (documented; surfaces live) — follow-up
 * --------------------------------------------------------------------
 * The current AMS add-item service validates `kind` against an allow-list of
 * EXACTLY `{api, operational}` (`GeneratedMigrationBookOfWorkService.ALLOWED_KINDS`)
 * and 400-rejects any other kind. So a `kind='seed_build_files'` add is rejected
 * by today's AMS until that allow-list admits the seed kind (an AMS change,
 * outside this gateway-only task group). The gateway side is built correctly per
 * spec; at runtime the AMS 400 is caught fail-soft + logged (no upload impact),
 * i.e. the seed story is effectively a SKIP-WITH-LOG until AMS admits the kind.
 * Flagged for follow-up. This is a cross-layer integration gap of the class the
 * spec flags as "caught only by the live smoke".
 */

import { getConfig } from '../config';
import { logger } from './logger';
import { SEED_BUILD_FILES_STORY_KIND } from './migrationSeedBuildFilesEnrichment';

/** Stable title for the minted seed story (recognised by `kind`, not title). */
export const SEED_BUILD_FILES_STORY_TITLE = 'Seed build files (authoritative — write first)';

/** Human description carried on the blob item (provenance only; the carriage fills the spec). */
const SEED_BUILD_FILES_STORY_DESCRIPTION =
  'Dedicated seed-build-files story. The verbatim target build file(s) (pom.xml / ' +
  'package.json) are injected into this story by the seed-build-files enrichment ' +
  'carriage at spec-gen time and written FIRST, before any other story. Do not ' +
  'edit by hand.';

/**
 * Minimal slice of the AMS book-of-work DTO this module reads (snake_case wire).
 * Only the fields the lookup + idempotency need are declared; the rest pass
 * through opaquely.
 */
interface BookOfWorkBlobItem {
  id?: string | null;
  type?: string | null;
  kind?: string | null;
  title?: string | null;
  workItemId?: string | null;
  sequenceOrder?: number | null;
}

interface BookOfWorkDraftWire {
  id?: string | null;
  project_id?: string | null;
  target_architecture_id?: string | null;
  status?: string | null;
  book_of_work_json?: { items?: BookOfWorkBlobItem[] | null } | null;
}

/**
 * The dependency seams this module needs, declared as an injectable bag so unit
 * tests can stub the AMS round-trips without a live service. Production wiring
 * defaults to the real `fetch`-backed implementations below.
 */
export interface SeedStoryMintingDeps {
  /**
   * List the active (non-archived) book-of-work drafts for a project. Used to
   * resolve the book of work for the target architecture. Returns `[]` (never
   * throws) when none / unreachable — the caller treats that as SKIP-WITH-LOG.
   */
  listBooksOfWork: (projectId: string) => Promise<BookOfWorkDraftWire[]>;
  /**
   * Add ONE work item to a book of work via the AMS add-item endpoint. Resolves
   * to the created `work_item_id` (or null), and MAY reject on a non-2xx / network
   * failure — the caller catches it fail-soft.
   */
  addWorkItem: (
    projectId: string,
    bookId: string,
    request: SeedStoryAddItemRequest,
  ) => Promise<{ workItemId: string | null }>;
}

/**
 * The snake_case add-item request body for the seed story. Mirrors the AMS
 * `AddWorkItemRequest` fields this module sets. `kind` is the seed marker;
 * `sequence_order = 0` makes it FIRST.
 */
export interface SeedStoryAddItemRequest {
  kind: string;
  title: string;
  description: string;
  sequence_order: number;
}

/** Structured outcome of a minting attempt (returned, never thrown). */
export interface SeedStoryMintingOutcome {
  /** 'minted' on a successful add; 'skipped' when no book / already present / a fail-soft skip. */
  status: 'minted' | 'skipped';
  /** Why it was skipped (only set when status === 'skipped'). */
  reason?: string;
  /** The book of work the seed story was minted into / found in, when resolved. */
  bookId?: string | null;
  /** The created work item id, when minted. */
  workItemId?: string | null;
}

// ---------------------------------------------------------------------------
// Default (production) AMS-backed seams
// ---------------------------------------------------------------------------

/** GET the active book-of-work drafts for a project (snake_case wire). */
async function defaultListBooksOfWork(projectId: string): Promise<BookOfWorkDraftWire[]> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(
      `architecture model service migration-books-of-work list failed: HTTP ${response.status}`,
    );
  }
  const body = (await response.json()) as BookOfWorkDraftWire[];
  return Array.isArray(body) ? body : [];
}

/** POST the seed story to the AMS add-item endpoint (snake_case wire). */
async function defaultAddWorkItem(
  projectId: string,
  bookId: string,
  request: SeedStoryAddItemRequest,
): Promise<{ workItemId: string | null }> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}/items/add-item`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(
      `architecture model service add-item (seed_build_files) failed: HTTP ${response.status}`,
    );
  }
  const json = (await response.json()) as { work_item_id?: string | null };
  return { workItemId: json?.work_item_id ?? null };
}

export const defaultSeedStoryMintingDeps: SeedStoryMintingDeps = {
  listBooksOfWork: defaultListBooksOfWork,
  addWorkItem: defaultAddWorkItem,
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for focused unit tests)
// ---------------------------------------------------------------------------

/**
 * Pick the book of work for a target architecture from the project's drafts.
 * Matches on `target_architecture_id`. When multiple match (e.g. history), the
 * FIRST non-archived match is used — the list endpoint already excludes archived
 * drafts by default. Returns null when none matches (SKIP-WITH-LOG upstream).
 */
export function pickBookForTargetArchitecture(
  drafts: readonly BookOfWorkDraftWire[],
  targetArchitectureId: string,
): BookOfWorkDraftWire | null {
  for (const d of drafts) {
    if (
      typeof d?.target_architecture_id === 'string' &&
      d.target_architecture_id === targetArchitectureId &&
      (d.status ?? '').toLowerCase() !== 'archived' &&
      typeof d.id === 'string' &&
      d.id.length > 0
    ) {
      return d;
    }
  }
  return null;
}

/**
 * Find an existing `seed_build_files` story on a book's blob (idempotency
 * match scope = book of work + `kind='seed_build_files'`). Tolerant of
 * surrounding whitespace / case on the `kind` marker, mirroring
 * {@link isSeedBuildFilesStory}. Returns the first match or null.
 */
export function findExistingSeedBuildFilesItem(
  book: BookOfWorkDraftWire | null,
): BookOfWorkBlobItem | null {
  const items = book?.book_of_work_json?.items;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if ((item?.kind ?? '').trim().toLowerCase() === SEED_BUILD_FILES_STORY_KIND) {
      return item;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Minting entry point
// ---------------------------------------------------------------------------

/**
 * Mint (or confirm-in-place) the dedicated `seed_build_files` story for the
 * target architecture's book of work. NEVER throws — every failure path degrades
 * to a logged SKIP and returns a structured outcome, so the caller can invoke
 * this alongside the Task Group 3 persist without either affecting the other or
 * the upload response.
 *
 * Flow:
 *   1. Resolve the book of work for `(projectId, targetArchitectureId)` via the
 *      list seam. No book yet -> SKIP-WITH-LOG (the documented timing limitation).
 *   2. Replace-in-place: if a `seed_build_files` story already exists on the
 *      book, leave it as-is (SKIP, no duplicate FIRST-sequenced story).
 *   3. Otherwise POST the add-item with `kind='seed_build_files'`,
 *      `sequence_order = 0` (FIRST). The spec-gen trigger is NOT fired (the seed
 *      story is filled by the enrichment carriage).
 */
export async function mintSeedBuildFilesStory(
  args: {
    projectId: string;
    targetArchitectureId: string | null | undefined;
  },
  deps: SeedStoryMintingDeps = defaultSeedStoryMintingDeps,
): Promise<SeedStoryMintingOutcome> {
  const { projectId } = args;
  const targetArchitectureId = args.targetArchitectureId ?? null;

  // Safe no-op when there is no target architecture key to resolve a book by.
  if (!targetArchitectureId) {
    logger.info(
      `[diag-gateway] confirmed_manifest_to_codebase seed_story_mint_skipped ` +
        `projectId=${projectId} reason=no_target_architecture_id`,
    );
    return { status: 'skipped', reason: 'no_target_architecture_id' };
  }

  // 1. Resolve the book of work for the target architecture. A lookup hiccup is
  //    fail-soft (SKIP-WITH-LOG) — never break the upload.
  let drafts: BookOfWorkDraftWire[] = [];
  try {
    drafts = await deps.listBooksOfWork(projectId);
  } catch (err) {
    logger.warn(
      `[diag-gateway] confirmed_manifest_to_codebase seed_story_mint_skipped ` +
        `projectId=${projectId} targetArchitectureId=${targetArchitectureId} ` +
        `reason=book_lookup_failed error=${err instanceof Error ? err.message : String(err)}`,
    );
    return { status: 'skipped', reason: 'book_lookup_failed' };
  }

  const book = pickBookForTargetArchitecture(drafts, targetArchitectureId);
  if (!book || typeof book.id !== 'string' || book.id.length === 0) {
    // No book of work exists yet for this target architecture (books are
    // generated later in the workflow). DOCUMENTED timing limitation — the seed
    // story must be re-driven from the book-of-work generation path when the book
    // appears. No silent drop: logged here.
    logger.info(
      `[diag-gateway] confirmed_manifest_to_codebase seed_story_mint_skipped ` +
        `projectId=${projectId} targetArchitectureId=${targetArchitectureId} ` +
        `reason=no_book_of_work_yet follow_up=mint_from_book_generation_path`,
    );
    return { status: 'skipped', reason: 'no_book_of_work_yet' };
  }
  const bookId = book.id;

  // 2. Replace-in-place idempotency: a seed story already on the book means the
  //    upload was re-confirmed — leave the single seed story (no duplicate).
  const existing = findExistingSeedBuildFilesItem(book);
  if (existing) {
    logger.info(
      `[diag-gateway] confirmed_manifest_to_codebase seed_story_mint_skipped ` +
        `projectId=${projectId} bookId=${bookId} ` +
        `targetArchitectureId=${targetArchitectureId} reason=already_present ` +
        `existingBookItemId=${existing.id ?? 'null'}`,
    );
    return { status: 'skipped', reason: 'already_present', bookId };
  }

  // 3. Mint the FIRST-sequenced seed story. The spec-gen trigger is suppressed:
  //    this path NEVER calls runShapeSpecGenerationBatch — the seed story is
  //    filled by the enrichment carriage, not a generated description.
  const request: SeedStoryAddItemRequest = {
    kind: SEED_BUILD_FILES_STORY_KIND,
    title: SEED_BUILD_FILES_STORY_TITLE,
    description: SEED_BUILD_FILES_STORY_DESCRIPTION,
    sequence_order: 0,
  };
  try {
    const { workItemId } = await deps.addWorkItem(projectId, bookId, request);
    logger.info(
      `[diag-gateway] confirmed_manifest_to_codebase seed_story_minted ` +
        `projectId=${projectId} bookId=${bookId} ` +
        `targetArchitectureId=${targetArchitectureId} ` +
        `kind=${SEED_BUILD_FILES_STORY_KIND} sequence_order=0 ` +
        `workItemId=${workItemId ?? 'null'} spec_gen_trigger=suppressed`,
    );
    return { status: 'minted', bookId, workItemId };
  } catch (err) {
    // Fail-soft: a write hiccup (incl. the AMS `kind` allow-list 400 documented
    // in the file header) is caught + logged and degraded to a SKIP. The upload
    // response is unchanged.
    logger.warn(
      `[diag-gateway] confirmed_manifest_to_codebase seed_story_mint_failed ` +
        `projectId=${projectId} bookId=${bookId} ` +
        `targetArchitectureId=${targetArchitectureId} ` +
        `kind=${SEED_BUILD_FILES_STORY_KIND} ` +
        `error=${err instanceof Error ? err.message : String(err)}`,
    );
    return { status: 'skipped', reason: 'add_item_failed', bookId };
  }
}
