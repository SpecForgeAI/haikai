/**
 * Soft-fail wrapper for database discovery pack stages.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 2.
 *
 * Pattern mirrors the synchronous soft-fail loop in
 * `findings/packFindingScanners/index.ts` but is async (DB calls are
 * network I/O). A single stage failure must NOT abort the discovery run --
 * the orchestrator wraps each pack stage call in {@link withDbPackSoftFail}
 * and:
 *   1. Logs the failure (one line, no stack-noise spam)
 *   2. Collects a `db_pack_warning` `FindingEmitInput` via the
 *      `onWarning` callback so the operator can see it on the Findings tab
 *   3. Returns `null` -- the orchestrator skips that stage's contribution
 *      and continues with the next stage
 *
 * The wrapper NEVER throws; the orchestrator can rely on getting back
 * `T | null` for every wrapped call.
 */

import type { FindingEmitInput } from '../findings/FindingEmitter';
import { buildDbPackWarningFinding } from '../findings/databasePackFindingScanners/databasePackFindingBuilders';

/**
 * Run `fn`. On any thrown error: log it, emit a `db_pack_warning` finding
 * via the `onWarning` callback, return `null`.
 *
 * The `stage` string identifies the failure point in the finding's title
 * and the log line (e.g. `'introspectTables'`, `'profileTables.deep'`).
 *
 * The `onWarning` callback is intentionally a callback, not a return-list
 * append: the orchestrator may want to deduplicate, cap, or route warnings
 * through its own buffer rather than collect them at the call site.
 */
export async function withDbPackSoftFail<T>(
  stage: string,
  fn: () => Promise<T>,
  onWarning: (finding: FindingEmitInput) => void,
  engineKey: 'postgres' | 'sybase' | 'mssql' | 'unknown' = 'unknown',
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[databasePackOrchestrator] stage '${stage}' failed; continuing run. ` +
        `engine=${engineKey} error='${message}'`,
    );
    try {
      onWarning(
        buildDbPackWarningFinding({
          stage,
          engineKey,
          errorMessage: message,
        }),
      );
    } catch (cbErr) {
      // The callback itself failed -- log and continue. Do NOT propagate.
      const cbMessage = cbErr instanceof Error ? cbErr.message : String(cbErr);
      console.warn(
        `[databasePackOrchestrator] onWarning callback failed for stage ` +
          `'${stage}'. callbackError='${cbMessage}'`,
      );
    }
    return null;
  }
}
