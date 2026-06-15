/**
 * In-process secret bundle for database discovery runs.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 2.
 *
 * CONTRACT
 * --------
 *  - This module holds {@link DatabaseDiscoveryCredentials} (username +
 *    password) in a module-local `Map<runId, ...>` for the lifetime of a
 *    single discovery run. NOTHING else may persist these values.
 *  - The values are NEVER:
 *       * written to disk
 *       * serialised to a network payload
 *       * forwarded to AMS (`config_snapshot` is the
 *         {@link RedactedDatabaseDiscoveryConfig} shape)
 *       * included in finding `detailJson` payloads
 *       * included in log lines (only `runId` is logged)
 *  - The bundle for a run is purged on terminal status (success, failure,
 *    AND cancellation). The orchestrator's `finally` block MUST call
 *    {@link purgeForRun} before returning.
 *  - On process restart, the entire bundle is gone -- this is by design.
 *    A run that survives a discovery-service restart cannot continue; it
 *    must be re-started by the user with fresh credentials.
 *  - `toJSON` is intentionally NOT implemented on the credential objects.
 *    A future engineer who tries to `JSON.stringify` the bundle gets the
 *    raw object back -- still leaks, but the explicit absence of `toJSON`
 *    is a tripwire reviewers can grep for.
 *
 * The Map is module-scoped (a single mutable singleton). This is appropriate
 * because the discovery-service is the only process touching it. Tests reset
 * via {@link resetAllForTests}.
 */

import type { DatabaseDiscoveryCredentials } from './types';

const SECRET_BUNDLE = new Map<string, DatabaseDiscoveryCredentials>();

/**
 * Store credentials for a run. Throws if a different set is already stored
 * for the same `runId` -- callers must purge first if they need to rotate.
 */
export function storeForRun(
  runId: string,
  creds: DatabaseDiscoveryCredentials,
): void {
  if (!runId || typeof runId !== 'string') {
    throw new Error('secretsStore.storeForRun: runId is required.');
  }
  if (!creds || typeof creds.password !== 'string') {
    throw new Error('secretsStore.storeForRun: credentials with password required.');
  }
  if (SECRET_BUNDLE.has(runId)) {
    throw new Error(
      `secretsStore.storeForRun: credentials already present for runId='${runId}'. ` +
        `Purge first if rotating.`,
    );
  }
  // Defensive copy -- prevent caller-side mutation from affecting the bundle.
  SECRET_BUNDLE.set(runId, {
    username: creds.username,
    password: creds.password,
  });
}

/**
 * Retrieve credentials for a run. Returns `null` when not present.
 */
export function getForRun(runId: string): DatabaseDiscoveryCredentials | null {
  const v = SECRET_BUNDLE.get(runId);
  return v ? { username: v.username, password: v.password } : null;
}

/**
 * Purge credentials for a run. Idempotent -- safe to call from `finally`
 * even if `storeForRun` was never reached.
 */
export function purgeForRun(runId: string): void {
  SECRET_BUNDLE.delete(runId);
}

/**
 * TEST-ONLY: reset the entire bundle. Production code MUST NOT call this.
 */
export function resetAllForTests(): void {
  SECRET_BUNDLE.clear();
}

/**
 * TEST-ONLY: how many runs currently have credentials stored. Used by tests
 * to verify the purge contract.
 */
export function sizeForTests(): number {
  return SECRET_BUNDLE.size;
}
