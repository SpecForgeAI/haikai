/**
 * Migration target-credentials store (gateway, in-memory, never persisted).
 *
 * The CD-2 per-invocation credential pattern: target-env credentials are
 * captured ONCE at the Migrate confirm step (the user knows the target env's
 * auth up front; the target URL arrives later in the `deployed` callback) and
 * held in-memory keyed by the migration run id, for the run only. They are
 * NEVER persisted to AMS, NEVER logged. `type:'none'` is allowed for an
 * unauthenticated like-for-like target.
 *
 * The reconcile driver (Group 2) reads the run's bundle here and loads it into
 * the validation service's own in-memory `secretsStore` (via the session
 * `/secrets` route) at reconcile time. The callback supplies `target_base_url`
 * (location) but NEVER credentials (location != access).
 *
 * FALLBACK (CD-2): if no bundle is registered for the run when the `deployed`
 * callback lands (gateway restart, or a long-running migration that outlived
 * this in-memory store), the reconcile PAUSES in a `needs target credentials`
 * state for the user to re-enter -- the creds are STILL never stored on disk.
 *
 * Mirrors the validation service's `secretsStore.ts` invariants (in-memory,
 * never-persisted/never-logged), but keyed by migration RUN id rather than
 * capture-session id, because the reconcile session does not exist yet when the
 * creds are captured.
 *
 * Spec: Migration Reconciliation + Bug Loop (2026-06-14, Spec 4 of 4) --
 * Task Group 2.
 */

/**
 * The target-side API auth bundle. Mirrors the validation service's
 * `ApiAuthSecret` shape verbatim so it can be POSTed to the `/secrets` route
 * unchanged. `type:'none'` is the common like-for-like non-prod case.
 */
export interface TargetApiAuthSecret {
  type: 'none' | 'bearer' | 'api_key_header' | 'api_key_query' | 'basic' | 'custom_header';
  bearerToken?: string;
  headerName?: string;
  headerValue?: string;
  queryParamName?: string;
  queryParamValue?: string;
  username?: string;
  password?: string;
}

interface RunCredentialsBundle {
  runId: string;
  api: TargetApiAuthSecret;
  loadedAt: number;
}

class MigrationTargetCredentialsStore {
  private readonly bundles = new Map<string, RunCredentialsBundle>();

  /** Register the run's target creds (captured at Migrate confirm). */
  set(runId: string, api: TargetApiAuthSecret): void {
    this.bundles.set(runId, { runId, api, loadedAt: Date.now() });
  }

  /** Read the run's target creds; undefined when not registered / restarted. */
  get(runId: string): TargetApiAuthSecret | undefined {
    return this.bundles.get(runId)?.api;
  }

  has(runId: string): boolean {
    return this.bundles.has(runId);
  }

  /** Purge a single run's bundle (terminal / re-entry). Idempotent. */
  purge(runId: string): boolean {
    return this.bundles.delete(runId);
  }

  /** Diagnostic: the run ids with stored bundles. NEVER returns plaintext. */
  listLoadedRunIds(): string[] {
    return Array.from(this.bundles.keys());
  }

  /** Test-only: drop every bundle. */
  clearAll(): void {
    this.bundles.clear();
  }
}

export const migrationTargetCredentialsStore = new MigrationTargetCredentialsStore();

/** Exported for tests. */
export { MigrationTargetCredentialsStore };
