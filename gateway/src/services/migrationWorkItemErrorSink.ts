/**
 * Migration Execution Driver -- work-item error surfacing (Spec 3, Task Group 2).
 *
 * When a spec's implementation segment fails (shape-spec auto-answer error,
 * orchestration rejected, or a `failed`/`rejected` build-results callback), the
 * Driver halts THIS run cleanly and SURFACES the failure (per-item failure
 * isolation -- it never aborts unrelated state).
 *
 * The CANONICAL, durable error record is the run-item's `error_detail` column
 * (AMS run-state, surfaced in the run-progress view) -- that write is owned by
 * the Driver. This sink is the WORK-ITEM-facing surfacing: a best-effort,
 * NON-DESTRUCTIVE record keyed to the work item, so a migration owner can find
 * the failure from the backlog/work-item view too.
 *
 * It is deliberately conservative: it does NOT mutate the work item's
 * structured columns (title / status / parent / tags), because a build failure
 * must NEVER corrupt the work item itself. It emits a structured
 * `[diag-gateway] migration_execution_driver work_item_error` log keyed to the
 * work item. The function is an injected DI seam so the Driver's tests assert it
 * was called without a live AMS round-trip; a future spec can extend it to a
 * dedicated per-work-item failure feed without touching the Driver.
 *
 * Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 2.
 */

import { logger } from './logger';

/**
 * Surface a build/implementation failure against a work item (non-destructive).
 * Records a structured, work-item-keyed diagnostic. Never throws.
 */
export async function recordWorkItemImplementationError(
  projectId: string,
  workItemId: string,
  errorDetail: string
): Promise<void> {
  // Non-destructive surfacing: a structured, work-item-keyed record. The
  // authoritative error lives on the run-item `error_detail` (AMS run-state).
  logger.error('[diag-gateway] migration_execution_driver work_item_error', {
    projectId,
    workItemId,
    errorDetail,
  });
}
