/**
 * Migration Execution Driver -- AMS data reads (gateway -> AMS).
 *
 * The read-side seam the Driver (Spec 3, Task Group 2) uses to compose the
 * hard-block readiness gate and the ordered dispatch set:
 *
 *   - the Book of Work (`book_of_work_json` -> the ordered items the run walks);
 *   - the per-story spec generations (the `generated_spec_text` to dispatch +
 *     the readiness signals: status / stale_reason);
 *   - the work items (the `deferred` flag the predicate + sequence builder read);
 *   - the active `kind='current'` API-behaviour baseline (the pinned oracle the
 *     hard-block requires and the run records).
 *
 * Wire shape is snake_case (the AMS global default). These functions are the DI
 * seam the Driver mocks in unit tests.
 *
 * Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 2.
 */

import { getConfig } from '../config';
import { logger } from './logger';

// ============================================================================
// Wire types (subset of the AMS DTOs the Driver reads)
// ============================================================================

/** One item in `book_of_work_json.items[]` (the run-sequence source, CD-5). */
export interface BookOfWorkItem {
  /** Stable book-item id. */
  id?: string;
  /** Parent book-item id (null/absent for roots). */
  parentId?: string | null;
  /** initiative | epic | feature | story | test (free-text per WorkItem audit). */
  type?: string | null;
  /** Display title. */
  title?: string | null;
  /** Sort key within siblings. */
  sequenceOrder?: number | null;
  /** Stored WorkItem UUID (presence = saved-to-backlog). */
  workItemId?: string | null;
  /**
   * The discovery-finding ids this book item cites (D4 carry_over gate, D8): a
   * finding is `cited-by-story` iff its id appears in ANY book item's
   * `discoveryFindingReferences`. Reused as-is from the finding-citation
   * mechanism (no change to how it is written).
   */
  discoveryFindingReferences?: string[] | null;
}

/** The generated Book of Work draft (AMS `generated_migration_books_of_work`). */
export interface BookOfWork {
  id?: string;
  project_id?: string | null;
  current_architecture_id?: string | null;
  target_architecture_id?: string | null;
  status?: string | null;
  book_of_work_json?: { items?: BookOfWorkItem[] } | null;
}

/** A per-story spec-generation row (AMS `migration_story_spec_generations`). */
export interface SpecGeneration {
  id?: string;
  work_item_id?: string | null;
  book_item_id?: string | null;
  status?: string | null;
  generated_spec_text?: string | null;
  stale_reason?: string | null;
  generation_attempt_number?: number | null;
  created_at?: string | null;
}

/** A flat work item (AMS `work_item`) -- the Driver reads `deferred`. */
export interface WorkItem {
  id?: string;
  type?: string | null;
  parent_id?: string | null;
  title?: string | null;
  deferred?: boolean | null;
  /**
   * The originating `discovery_capability` UUID, when this work item was minted
   * from a capability via `append-capability-story` (AMS changeset 185). The D4
   * carry_over completeness gate reads this column off the work-items list it
   * already fetches: a capability is `cited-by-story` iff a work_item exists with
   * `source_capability_id == capability.id`.
   */
  source_capability_id?: string | null;
}

/** An API-behaviour baseline row (AMS `api_behaviour_baselines`). */
export interface ApiBehaviourBaseline {
  id?: string;
  architectureId?: string | null;
  status?: string | null;
  kind?: string | null;
  name?: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

function baseUrl(): string {
  return getConfig().architectureModelServiceBaseUrl;
}

async function getJsonOrNull<T>(url: string, label: string): Promise<T | null> {
  try {
    const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!response.ok) {
      logger.warn(`[diag-gateway] migration_execution_driver ${label} AMS non-OK`, {
        status: response.status,
        url,
      });
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    logger.warn(`[diag-gateway] migration_execution_driver ${label} AMS read failed`, {
      url,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

// ============================================================================
// Reads
// ============================================================================

/** GET the generated Book of Work draft (the run-sequence + architecture source). */
export async function fetchBookOfWork(
  projectId: string,
  bookId: string
): Promise<BookOfWork | null> {
  const url = `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}/migration-books-of-work/${encodeURIComponent(bookId)}`;
  return getJsonOrNull<BookOfWork>(url, 'fetch_book_of_work');
}

/** GET all spec-generation rows for a book (the dispatch text + readiness signals). */
export async function fetchSpecGenerationsForBook(
  projectId: string,
  bookId: string
): Promise<SpecGeneration[]> {
  const url = `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}/migration-books-of-work/${encodeURIComponent(bookId)}/spec-generations`;
  const rows = await getJsonOrNull<SpecGeneration[]>(url, 'fetch_spec_generations');
  return Array.isArray(rows) ? rows : [];
}

/** GET all work items for the project (the Driver reads the `deferred` flag). */
export async function fetchWorkItems(projectId: string): Promise<WorkItem[]> {
  const url = `${baseUrl()}/api/model/projects/${encodeURIComponent(projectId)}/work-items`;
  const rows = await getJsonOrNull<WorkItem[]>(url, 'fetch_work_items');
  return Array.isArray(rows) ? rows : [];
}

/**
 * GET the API-behaviour baselines for an architecture and return the active
 * `kind='current'` one (the pinned oracle the hard-block requires). Returns
 * null when no active current-state baseline exists for the architecture.
 */
export async function fetchActiveCurrentBaseline(
  projectId: string,
  architectureId: string
): Promise<ApiBehaviourBaseline | null> {
  const url =
    `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}/api-behaviour/baselines` +
    `?architectureId=${encodeURIComponent(architectureId)}`;
  const rows = await getJsonOrNull<ApiBehaviourBaseline[]>(url, 'fetch_baselines');
  if (!Array.isArray(rows)) {
    return null;
  }
  // The pinned oracle: kind='current' AND status='active'. Prefer the most
  // recently surfaced active current-state baseline (list order is AMS-defined;
  // first active current match is taken).
  const active = rows.find(
    (b) => (b.kind ?? 'current') === 'current' && b.status === 'active'
  );
  return active ?? null;
}
