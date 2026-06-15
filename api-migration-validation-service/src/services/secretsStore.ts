import type { SecretsBundle } from '../types/secrets';

/**
 * In-memory secrets store. Keyed by `sessionId`. Holds plaintext API auth
 * + DB password material. NEVER persisted, NEVER logged, NEVER shipped to
 * AMS. Cleared on terminal session status (`completed` / `failed` /
 * `cancelled`) or on process restart (a restart cannot continue a `running`
 * session for this reason; see `startupReconciliation.ts`).
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 */

class SecretsStore {
  private readonly bundles = new Map<string, SecretsBundle>();

  set(bundle: SecretsBundle): void {
    this.bundles.set(bundle.sessionId, { ...bundle, loadedAt: Date.now() });
  }

  get(sessionId: string): SecretsBundle | undefined {
    return this.bundles.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.bundles.has(sessionId);
  }

  /**
   * Purge a single session's bundle. Called on terminal status, on `cancel`,
   * and on the secret-loss UX re-entry path (replaced by a fresh `set()`
   * directly after).
   */
  purge(sessionId: string): boolean {
    return this.bundles.delete(sessionId);
  }

  /** Diagnostic: list session ids with stored bundles. NEVER returns plaintext. */
  listLoadedSessionIds(): string[] {
    return Array.from(this.bundles.keys());
  }

  /** Test-only: drop every bundle. */
  clearAll(): void {
    this.bundles.clear();
  }
}

export const secretsStore = new SecretsStore();

/** Exported for tests. */
export { SecretsStore };
