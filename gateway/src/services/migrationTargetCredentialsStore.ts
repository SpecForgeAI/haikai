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

/**
 * OPTIONAL target-database credentials (Spec 2026-07-06-n, Tier-1 batch
 * 2026-07-10 — user decision Q3): when supplied on the Migrate confirm, the
 * reconcile's target replay snapshots effect tables around mutating replays
 * so state parity gets a real verdict instead of `state_unverified`. Held
 * in-memory with the API bundle, same never-persist posture. The connection
 * CONFIG (host/port/db/user/engine) travels to the AMVS session row
 * (redacted, like the current-side capture flow); the PASSWORD travels only
 * to the AMVS in-memory secrets route.
 */
export interface TargetDbSecret {
  dbType: 'postgres' | 'sybase';
  host: string;
  port: number;
  database: string;
  schema?: string | null;
  username: string;
  password: string;
}

/**
 * OPTIONAL target-SERVICE serve spec (stage-2 Start modal, 2026-07-31): how
 * haibox should launch the migrated service for the deploy + API reconcile.
 * TRUST BOUNDARY: `command` is executed verbatim by haiboxd on the host — it
 * is OPERATOR-CONFIRMED input from the Start-stage dialog, carried by the
 * authenticated co-located gateway (the only peer allowed to set it). Same
 * in-memory / never-persisted / never-logged posture as the DB secret (env
 * values may carry datasource passwords).
 */
export interface TargetServeSpec {
  command: string;
  healthPath: string;
  portEnv: string;
  readinessTimeout?: number;
  env?: Record<string, string>;
}

interface RunCredentialsBundle {
  runId: string;
  api: TargetApiAuthSecret;
  db?: TargetDbSecret;
  service?: TargetServeSpec;
  loadedAt: number;
}

class MigrationTargetCredentialsStore {
  private readonly bundles = new Map<string, RunCredentialsBundle>();

  /** Register the run's target creds (captured at the Start-stage dialog). */
  set(
    runId: string,
    api: TargetApiAuthSecret,
    db?: TargetDbSecret,
    service?: TargetServeSpec
  ): void {
    this.bundles.set(runId, {
      runId,
      api,
      ...(db ? { db } : {}),
      ...(service ? { service } : {}),
      loadedAt: Date.now(),
    });
  }

  /** Read the run's target creds; undefined when not registered / restarted. */
  get(runId: string): TargetApiAuthSecret | undefined {
    return this.bundles.get(runId)?.api;
  }

  /** Read the run's OPTIONAL target-service serve spec (stage-2 deploy). */
  getService(runId: string): TargetServeSpec | undefined {
    return this.bundles.get(runId)?.service;
  }

  /** Read the run's OPTIONAL target-DB creds (state-delta snapshots). */
  getDb(runId: string): TargetDbSecret | undefined {
    return this.bundles.get(runId)?.db;
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
