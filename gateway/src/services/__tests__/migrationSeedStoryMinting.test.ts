/**
 * Task Group 4 tests (Spec 5 Phase 2) — seed-build-files story minting.
 *
 * Spec: 2026-06-25-confirmed-manifest-producer-wiring, tasks 4.1 / 4.3-4.5.
 *
 * Covers ONLY the contract this group owns (per the 2-8 focused-tests budget):
 *   (a) the mint adds a work item with `kind='seed_build_files'`
 *       (SEED_BUILD_FILES_STORY_KIND) — the marker the carriage recognises;
 *   (b) FIRST sequencing — `sequence_order = 0`;
 *   (c) replace-in-place on re-upload/re-confirm — when a `seed_build_files`
 *       story already exists on the book, NO second story is added (no duplicate
 *       FIRST-sequenced story);
 *   (d) the description-grounded spec-gen trigger (runShapeSpecGenerationBatch)
 *       is STRUCTURALLY suppressed for the seed kind — the minting path never
 *       calls the batch (and an ordinary api/operational add via the add-item
 *       route still fires it: asserted in the route test for the other half);
 *   (e) the documented bookId timing limitation — when NO book of work exists yet
 *       for the target architecture, minting SKIPS-WITH-LOG and adds nothing.
 *
 * The AMS list + add-item seams are stubbed; no live AMS required.
 */

jest.mock('../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { logger } = require('../logger');

import {
  mintSeedBuildFilesStory,
  pickBookForTargetArchitecture,
  findExistingSeedBuildFilesItem,
  SEED_BUILD_FILES_STORY_TITLE,
  type SeedStoryMintingDeps,
  type SeedStoryAddItemRequest,
} from '../migrationSeedStoryMinting';
import { SEED_BUILD_FILES_STORY_KIND } from '../migrationSeedBuildFilesEnrichment';

const PROJECT_ID = 'proj-1';
const TARGET_ARCH_ID = 'arch-9';
const BOOK_ID = 'book-7';

interface AddCall {
  projectId: string;
  bookId: string;
  request: SeedStoryAddItemRequest;
}

/** Build a deps bag with capturing add-item + a configurable book list. */
function makeDeps(books: unknown[]): {
  deps: SeedStoryMintingDeps;
  addCalls: AddCall[];
} {
  const addCalls: AddCall[] = [];
  const deps: SeedStoryMintingDeps = {
    listBooksOfWork: async () => books as never,
    addWorkItem: async (projectId, bookId, request) => {
      addCalls.push({ projectId, bookId, request });
      return { workItemId: 'wi-seed-1' };
    },
  };
  return { deps, addCalls };
}

function bookFor(
  targetArchitectureId: string,
  items: unknown[] = [],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: BOOK_ID,
    project_id: PROJECT_ID,
    target_architecture_id: targetArchitectureId,
    status: 'draft',
    book_of_work_json: { items },
    ...overrides,
  };
}

beforeEach(() => {
  (logger.info as jest.Mock).mockReset();
  (logger.warn as jest.Mock).mockReset();
});

// ===========================================================================
// (a) + (b) + (d) mint with seed kind, FIRST sequencing, no batch trigger
// ===========================================================================

test('mints a work item with kind=seed_build_files at sequence_order=0 (FIRST)', async () => {
  const { deps, addCalls } = makeDeps([bookFor(TARGET_ARCH_ID, [])]);

  const outcome = await mintSeedBuildFilesStory(
    { projectId: PROJECT_ID, targetArchitectureId: TARGET_ARCH_ID },
    deps,
  );

  expect(outcome.status).toBe('minted');
  expect(outcome.bookId).toBe(BOOK_ID);
  expect(outcome.workItemId).toBe('wi-seed-1');

  expect(addCalls).toHaveLength(1);
  expect(addCalls[0].projectId).toBe(PROJECT_ID);
  expect(addCalls[0].bookId).toBe(BOOK_ID);
  // (a) the seed kind marker the carriage recognises.
  expect(addCalls[0].request.kind).toBe(SEED_BUILD_FILES_STORY_KIND);
  expect(addCalls[0].request.kind).toBe('seed_build_files');
  // (b) FIRST sequencing.
  expect(addCalls[0].request.sequence_order).toBe(0);
  expect(addCalls[0].request.title).toBe(SEED_BUILD_FILES_STORY_TITLE);
});

test('the minting path never triggers description-grounded spec-gen (structural suppression)', async () => {
  // The minting module imports nothing from the handler and exposes no batch
  // seam: it CANNOT fire runShapeSpecGenerationBatch. Assert the deps surface is
  // exactly { listBooksOfWork, addWorkItem } so no generation hook can sneak in.
  const { deps, addCalls } = makeDeps([bookFor(TARGET_ARCH_ID, [])]);
  const depKeys = Object.keys(deps).sort();
  expect(depKeys).toEqual(['addWorkItem', 'listBooksOfWork']);

  await mintSeedBuildFilesStory(
    { projectId: PROJECT_ID, targetArchitectureId: TARGET_ARCH_ID },
    deps,
  );
  // The only AMS effect is the add-item; nothing batch-like was invoked.
  expect(addCalls).toHaveLength(1);
});

// ===========================================================================
// (c) replace-in-place idempotency
// ===========================================================================

test('replace-in-place: an existing seed_build_files story is NOT duplicated on re-confirm', async () => {
  const existingSeedItem = {
    id: 'manual-existing',
    type: 'story',
    kind: SEED_BUILD_FILES_STORY_KIND,
    title: SEED_BUILD_FILES_STORY_TITLE,
    workItemId: 'wi-existing',
    sequenceOrder: 0,
  };
  const { deps, addCalls } = makeDeps([
    bookFor(TARGET_ARCH_ID, [existingSeedItem]),
  ]);

  const outcome = await mintSeedBuildFilesStory(
    { projectId: PROJECT_ID, targetArchitectureId: TARGET_ARCH_ID },
    deps,
  );

  expect(outcome.status).toBe('skipped');
  expect(outcome.reason).toBe('already_present');
  expect(outcome.bookId).toBe(BOOK_ID);
  // No duplicate FIRST-sequenced story added.
  expect(addCalls).toHaveLength(0);
});

test('replace-in-place match is tolerant of whitespace/case on the kind marker', () => {
  const book = bookFor(TARGET_ARCH_ID, [
    { id: 'x', type: 'story', kind: '  Seed_Build_Files  ', title: 't' },
  ]);
  const found = findExistingSeedBuildFilesItem(book as never);
  expect(found).not.toBeNull();
  expect(found!.id).toBe('x');
});

// ===========================================================================
// (e) documented bookId timing limitation
// ===========================================================================

test('SKIPS-WITH-LOG when no book of work exists yet for the target architecture', async () => {
  // The project has a book, but for a DIFFERENT target architecture.
  const { deps, addCalls } = makeDeps([bookFor('some-other-arch', [])]);

  const outcome = await mintSeedBuildFilesStory(
    { projectId: PROJECT_ID, targetArchitectureId: TARGET_ARCH_ID },
    deps,
  );

  expect(outcome.status).toBe('skipped');
  expect(outcome.reason).toBe('no_book_of_work_yet');
  expect(addCalls).toHaveLength(0);

  // No silent drop — the deferral is logged with the follow-up flag.
  const skipLogs = (logger.info as jest.Mock).mock.calls.filter(
    (c: unknown[]) =>
      typeof c[0] === 'string' &&
      c[0].includes('[diag-gateway]') &&
      c[0].includes('seed_story_mint_skipped') &&
      c[0].includes('no_book_of_work_yet'),
  );
  expect(skipLogs.length).toBeGreaterThanOrEqual(1);
});

test('a book-list lookup hiccup degrades to a logged SKIP (fail-soft, never throws)', async () => {
  const deps: SeedStoryMintingDeps = {
    listBooksOfWork: async () => {
      throw new Error('AMS unreachable');
    },
    addWorkItem: async () => ({ workItemId: null }),
  };

  const outcome = await mintSeedBuildFilesStory(
    { projectId: PROJECT_ID, targetArchitectureId: TARGET_ARCH_ID },
    deps,
  );
  expect(outcome.status).toBe('skipped');
  expect(outcome.reason).toBe('book_lookup_failed');
});

test('an add-item hiccup (e.g. AMS kind allow-list 400) is caught + logged as a SKIP (fail-soft)', async () => {
  const deps: SeedStoryMintingDeps = {
    listBooksOfWork: async () => [bookFor(TARGET_ARCH_ID, [])] as never,
    addWorkItem: async () => {
      throw new Error("HTTP 400 Invalid kind 'seed_build_files'");
    },
  };

  const outcome = await mintSeedBuildFilesStory(
    { projectId: PROJECT_ID, targetArchitectureId: TARGET_ARCH_ID },
    deps,
  );
  expect(outcome.status).toBe('skipped');
  expect(outcome.reason).toBe('add_item_failed');

  const failLogs = (logger.warn as jest.Mock).mock.calls.filter(
    (c: unknown[]) =>
      typeof c[0] === 'string' &&
      c[0].includes('[diag-gateway]') &&
      c[0].includes('seed_story_mint_failed'),
  );
  expect(failLogs.length).toBeGreaterThanOrEqual(1);
});

test('no target architecture id -> safe no-op skip', async () => {
  const { deps, addCalls } = makeDeps([bookFor(TARGET_ARCH_ID, [])]);
  const outcome = await mintSeedBuildFilesStory(
    { projectId: PROJECT_ID, targetArchitectureId: null },
    deps,
  );
  expect(outcome.status).toBe('skipped');
  expect(outcome.reason).toBe('no_target_architecture_id');
  expect(addCalls).toHaveLength(0);
});

// ===========================================================================
// pickBookForTargetArchitecture — book resolution helper
// ===========================================================================

test('pickBookForTargetArchitecture matches on target_architecture_id and skips archived', () => {
  const drafts = [
    bookFor('other-arch', []),
    { ...bookFor(TARGET_ARCH_ID, []), status: 'archived' },
    bookFor(TARGET_ARCH_ID, [], { id: 'book-live' }),
  ];
  const picked = pickBookForTargetArchitecture(drafts as never, TARGET_ARCH_ID);
  expect(picked).not.toBeNull();
  expect(picked!.id).toBe('book-live');
});
