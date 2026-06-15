import type { ParsedOasInventory } from '../types/oas';

/**
 * In-memory cache of parsed OAS inventories keyed by `sessionId`.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 6.
 *
 * Why this exists: `parse-oas` parses + dereferences the OAS document(s) for
 * a session and persists a flat inventory into `api_behaviour_operations`.
 * The dereferenced `oasOperation` schema objects are also surfaced to the
 * LLM via the `list_oas_operations` / `get_oas_operation_detail` tools at
 * run time. The persisted operation row carries the JSON shape, but the
 * orchestrator's `OrchestratorDeps.oasInventory` requires the in-memory
 * `ParsedOasInventory` object (with the openapi-types typed schema fields).
 *
 * Lifetime / cleanup:
 *   - Set by `POST /capture-sessions/:id/parse-oas` after a successful parse.
 *   - Read by `POST /capture-sessions/:id/start` to feed the orchestrator.
 *   - Purged on terminal status (`completed` / `failed` / `cancelled`) and on
 *     `cancel`. After process restart, `parse-oas` must be re-invoked to
 *     repopulate the cache before `/start` can succeed (raw OAS bytes are
 *     never persisted, but the persisted inventory rows let the wizard
 *     present operation choices regardless).
 *
 * Mirrors the `secretsStore` shape: small, in-process, typed, never logged.
 */
class OasInventoryStore {
  private readonly inventories = new Map<string, ParsedOasInventory>();

  set(sessionId: string, inventory: ParsedOasInventory): void {
    this.inventories.set(sessionId, inventory);
  }

  get(sessionId: string): ParsedOasInventory | undefined {
    return this.inventories.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.inventories.has(sessionId);
  }

  /**
   * Drop a single session's parsed inventory. Called on terminal status, on
   * `cancel`, and on the secret-loss UX re-entry path so a stale inventory
   * from a previous run can't leak across restarts.
   */
  purge(sessionId: string): boolean {
    return this.inventories.delete(sessionId);
  }

  /** Diagnostic: list session ids with cached inventories. */
  listLoadedSessionIds(): string[] {
    return Array.from(this.inventories.keys());
  }

  /** Test-only: drop every cached inventory. */
  clearAll(): void {
    this.inventories.clear();
  }
}

export const oasInventoryStore = new OasInventoryStore();

/** Exported for tests. */
export { OasInventoryStore };
