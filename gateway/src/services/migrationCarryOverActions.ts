/**
 * Carry-over completeness-gate actions (gateway, on the review surface).
 *
 * Spec: D4 — Carry-over Completeness Gate (2026-06-14, Spec 4 of 6) — Task
 * Group 3.
 *
 * The three human-accounting actions that clear the carry_over gate for an item:
 *
 *   - {@link citeCapability} — "Create story": turn ONE approved
 *     `discovery_capability` into a first-class migration STORY by calling D3's
 *     `append-capability-story` AMS endpoint, which stamps both the
 *     `source_capability_id` COLUMN (changeset 185) and the `book_of_work_json`
 *     blob in one transaction -> the capability flips to `cited-by-story`.
 *   - {@link dismissCarryOverItem} — PATCH `review_status = dismissed` + a
 *     MANDATORY non-empty reason on the targeted finding / capability. An empty
 *     reason is REJECTED (the gate is not satisfied without a reason — D4).
 *   - {@link generateAllCapabilityStories} — the "Generate all capability
 *     stories" batch: run the cite once per un-covered approved behaviour-bearing
 *     capability (modelled on the AMS `append-test-item` batch-create
 *     precedent). Lives on the completeness review surface, NOT the
 *     spec-Generate-All dialog (a different stage).
 *
 * Every AMS call is injected ({@link CarryOverActionDeps}) so these handlers are
 * unit-testable with mocks and never reach a live LLM (they don't touch the LLM
 * boundary at all).
 */

import { getConfig } from '../config';
import { logger } from './logger';

// ============================================================================
// AMS wire shapes (snake_case — the global AMS default)
// ============================================================================

/** The `append-capability-story` request body (AMS snake_case shape). */
export interface AppendCapabilityStoryRequestBody {
  source_capability_id: string;
  title: string;
  description?: string | null;
  parent_book_item_id?: string | null;
  sequence_order?: number | null;
}

/** The `append-capability-story` response body. */
export interface AppendCapabilityStoryResponseBody {
  work_item_id?: string | null;
  book_item_id?: string | null;
  source_capability_id?: string | null;
  message?: string | null;
}

/** A capability / finding review PATCH body (review_status + reason). */
export interface ReviewPatchBody {
  review_status: string;
  reviewer_notes: string;
}

// ============================================================================
// Default AMS callers (the production wiring)
// ============================================================================

function baseUrl(): string {
  return getConfig().architectureModelServiceBaseUrl;
}

async function postJson<T>(url: string, body: unknown, label: string): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`AMS ${label} returned ${response.status}: ${text || '<empty body>'}`);
  }
  return (await response.json().catch(() => ({}))) as T;
}

async function patchJson<T>(url: string, body: unknown, label: string): Promise<T> {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`AMS ${label} returned ${response.status}: ${text || '<empty body>'}`);
  }
  return (await response.json().catch(() => ({}))) as T;
}

/** POST D3's `append-capability-story` (mints the STORY + stamps the column). */
export async function appendCapabilityStory(
  projectId: string,
  bookId: string,
  body: AppendCapabilityStoryRequestBody
): Promise<AppendCapabilityStoryResponseBody> {
  const url =
    `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}/items/append-capability-story`;
  return postJson<AppendCapabilityStoryResponseBody>(url, body, 'append-capability-story');
}

/** PATCH a `discovery_capability` review (review_status + reviewer_notes). */
export async function patchCapabilityReview(
  projectId: string,
  architectureId: string,
  capabilityId: string,
  body: ReviewPatchBody
): Promise<unknown> {
  const url =
    `${baseUrl()}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/discovery/capabilities/${encodeURIComponent(capabilityId)}/review`;
  return patchJson<unknown>(url, body, 'capability review');
}

/** PATCH a `discovery_findings` review (run-scoped review_status + notes). */
export async function patchFindingReview(
  projectId: string,
  architectureId: string,
  runId: string,
  findingId: string,
  body: ReviewPatchBody
): Promise<unknown> {
  const url =
    `${baseUrl()}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/discovery/runs/${encodeURIComponent(runId)}/findings/${encodeURIComponent(findingId)}`;
  return patchJson<unknown>(url, body, 'finding review');
}

/** The injectable AMS-caller surface (the DI seam for tests). */
export interface CarryOverActionDeps {
  appendCapabilityStory: typeof appendCapabilityStory;
  patchCapabilityReview: typeof patchCapabilityReview;
  patchFindingReview: typeof patchFindingReview;
}

/** The default (production) action deps. */
export function defaultCarryOverActionDeps(): CarryOverActionDeps {
  return { appendCapabilityStory, patchCapabilityReview, patchFindingReview };
}

// ============================================================================
// Cite (single)
// ============================================================================

export interface CiteCapabilityInput {
  projectId: string;
  bookId: string;
  capabilityId: string;
  /** The story title (the capability label / modernisation headline). */
  title: string;
  description?: string | null;
  parentBookItemId?: string | null;
  sequenceOrder?: number | null;
}

export type CiteCapabilityResult =
  | { ok: true; workItemId: string | null; bookItemId: string | null }
  | { ok: false; error: string };

/**
 * Cite ONE capability into a story via D3's `append-capability-story`. The
 * endpoint stamps `source_capability_id` (column + blob) so the capability flips
 * to `cited-by-story` and the carry_over gate clears for it.
 */
export async function citeCapability(
  input: CiteCapabilityInput,
  deps: CarryOverActionDeps = defaultCarryOverActionDeps()
): Promise<CiteCapabilityResult> {
  if (!input.capabilityId || input.capabilityId.trim() === '') {
    return { ok: false, error: 'capabilityId is required' };
  }
  if (!input.title || input.title.trim() === '') {
    return { ok: false, error: 'title is required' };
  }
  try {
    const response = await deps.appendCapabilityStory(input.projectId, input.bookId, {
      source_capability_id: input.capabilityId,
      title: input.title,
      description: input.description ?? null,
      parent_book_item_id: input.parentBookItemId ?? null,
      sequence_order: input.sequenceOrder ?? null,
    });
    logger.info('[diag-gateway] carry_over_action cite_capability', {
      projectId: input.projectId,
      bookId: input.bookId,
      capabilityId: input.capabilityId,
      workItemId: response.work_item_id ?? null,
    });
    return {
      ok: true,
      workItemId: response.work_item_id ?? null,
      bookItemId: response.book_item_id ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.warn('[diag-gateway] carry_over_action cite_capability_failed', {
      projectId: input.projectId,
      bookId: input.bookId,
      capabilityId: input.capabilityId,
      error: message,
    });
    return { ok: false, error: message };
  }
}

// ============================================================================
// Dismiss (with a mandatory reason)
// ============================================================================

export interface DismissCarryOverItemInput {
  projectId: string;
  architectureId: string;
  /** Whether the targeted item is a capability or a finding. */
  kind: 'capability' | 'finding';
  /** The capability id or finding id. */
  id: string;
  /** The discovery run id — REQUIRED for findings (the AMS review is run-scoped). */
  runId?: string;
  /** The MANDATORY, non-empty dismissal reason. */
  reason: string;
}

export type DismissCarryOverItemResult = { ok: true } | { ok: false; error: string };

/**
 * Dismiss a behaviour-bearing carry_over item: PATCH `review_status = dismissed`
 * + a MANDATORY non-empty reason (`reviewerNotes` for findings;
 * `detail_json.reviewerNotes` for capabilities — folded server-side per the D2
 * pattern). An empty reason is REJECTED before any AMS write (the gate is NOT
 * satisfied without a reason — D4).
 */
export async function dismissCarryOverItem(
  input: DismissCarryOverItemInput,
  deps: CarryOverActionDeps = defaultCarryOverActionDeps()
): Promise<DismissCarryOverItemResult> {
  if (!input.id || input.id.trim() === '') {
    return { ok: false, error: 'id is required' };
  }
  if (!input.reason || input.reason.trim() === '') {
    // A dismissal without a reason does NOT satisfy the gate.
    return { ok: false, error: 'a non-empty dismissal reason is required' };
  }
  const body: ReviewPatchBody = {
    review_status: 'dismissed',
    reviewer_notes: input.reason,
  };
  try {
    if (input.kind === 'capability') {
      await deps.patchCapabilityReview(input.projectId, input.architectureId, input.id, body);
    } else {
      if (!input.runId || input.runId.trim() === '') {
        return { ok: false, error: 'runId is required to dismiss a finding' };
      }
      await deps.patchFindingReview(
        input.projectId,
        input.architectureId,
        input.runId,
        input.id,
        body
      );
    }
    logger.info('[diag-gateway] carry_over_action dismiss_item', {
      projectId: input.projectId,
      kind: input.kind,
      id: input.id,
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.warn('[diag-gateway] carry_over_action dismiss_item_failed', {
      projectId: input.projectId,
      kind: input.kind,
      id: input.id,
      error: message,
    });
    return { ok: false, error: message };
  }
}

// ============================================================================
// Batch — "Generate all capability stories"
// ============================================================================

/** One capability the batch considers. */
export interface BatchCapabilityCandidate {
  id: string;
  title: string;
  reviewStatus: string | null;
  behaviourBearing: boolean | null;
  /** True iff a work_item already cites this capability (skip it). */
  alreadyCited: boolean;
}

export interface GenerateAllCapabilityStoriesInput {
  projectId: string;
  bookId: string;
  capabilities: BatchCapabilityCandidate[];
}

export interface GenerateAllCapabilityStoriesResult {
  /** Number of capabilities cited (a story created). */
  citedCount: number;
  /** Number of candidates skipped (already cited / non-bb / non-approved). */
  skippedCount: number;
  /** Per-capability failures (the batch is best-effort; never throws). */
  failures: Array<{ capabilityId: string; error: string }>;
}

/**
 * The "Generate all capability stories" batch: cite ONCE per un-covered approved
 * behaviour-bearing capability. Already-cited, non-behaviour-bearing, and
 * non-approved capabilities are skipped (only approved carry_over capabilities
 * that still need a story are cited — D6). Best-effort per item: a single cite
 * failure is collected and the batch continues.
 */
export async function generateAllCapabilityStories(
  input: GenerateAllCapabilityStoriesInput,
  deps: CarryOverActionDeps = defaultCarryOverActionDeps()
): Promise<GenerateAllCapabilityStoriesResult> {
  let citedCount = 0;
  let skippedCount = 0;
  const failures: Array<{ capabilityId: string; error: string }> = [];

  for (const cap of input.capabilities) {
    const eligible =
      cap.behaviourBearing === true &&
      cap.reviewStatus === 'approved' &&
      !cap.alreadyCited;
    if (!eligible) {
      skippedCount += 1;
      continue;
    }
    const result = await citeCapability(
      {
        projectId: input.projectId,
        bookId: input.bookId,
        capabilityId: cap.id,
        title: cap.title,
      },
      deps
    );
    if (result.ok) {
      citedCount += 1;
    } else {
      failures.push({ capabilityId: cap.id, error: result.error });
    }
  }

  logger.info('[diag-gateway] carry_over_action generate_all_capability_stories', {
    projectId: input.projectId,
    bookId: input.bookId,
    citedCount,
    skippedCount,
    failureCount: failures.length,
  });
  return { citedCount, skippedCount, failures };
}
