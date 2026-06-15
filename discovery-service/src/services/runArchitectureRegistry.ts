/**
 * Run Architecture Registry
 *
 * Spec: 2026-05-01 Multi-Architecture Discovery Integration (Spec #4) — Task Group 4.
 *
 * In-process registry that binds each discovery run (by `runId`) to exactly
 * one `architectureId` for its entire lifetime. Once a run is registered with
 * an `architectureId` here, that binding is permanent for the lifetime of the
 * discovery-service process — there is no API surface to rebind.
 *
 * The binding is established at run-start (and re-asserted at resume) by the
 * routes in `discovery-service/src/routes/runs.ts`. Every code path that
 * needs an architecture id while a run is in flight reads from this registry
 * via {@link getRunArchitectureId} rather than calling
 * `archModelClient.resolveDefaultArchitectureId(...)` (the spec #1 silent
 * default helper). The default helper is retained as a fallback for the
 * (likely zero) non-run code paths.
 *
 * The registry is NOT persisted across discovery-service restarts. After a
 * restart, callers fall back to the resolver helper. This is acceptable
 * because the architecture-model-service is the source of truth — every
 * persisted `discovery_runs` row carries `architecture_id` (Group 1
 * changeset 095) and any operation that needs the bound id can re-read it
 * from the run row via `archModelClient.getDiscoveryRun(...)`.
 */

interface RunBinding {
  /** The bound architecture id for this run. Permanent once set. */
  architectureId: string;
  /** The project the run belongs to (for diagnostic logging). */
  projectId: string;
}

const runBindings: Map<string, RunBinding> = new Map();

/**
 * Records the architecture binding for a run. Called at run-start and at
 * resume (resume re-asserts the binding so a process restart between
 * start and resume does not leave the binding empty).
 *
 * If the run already has a binding, this rejects mismatched architecture
 * ids loudly — defensive against client bugs that try to retarget a run
 * mid-flight.
 *
 * @throws Error when an existing binding exists with a different
 *         architectureId — this catches programming bugs early. UI / route
 *         layers should also enforce a 409 ConflictError before reaching
 *         this point.
 */
export function bindRunArchitecture(
  runId: string,
  projectId: string,
  architectureId: string,
): void {
  const existing = runBindings.get(runId);
  if (existing && existing.architectureId !== architectureId) {
    throw new Error(
      `[runArchitectureRegistry] Refusing to rebind run ${runId} from ` +
        `architectureId=${existing.architectureId} to ${architectureId}. ` +
        `Discovery runs are bound to one architecture for life.`,
    );
  }
  runBindings.set(runId, { architectureId, projectId });
}

/**
 * Returns the architecture id bound to the given run, or `undefined` when
 * no binding exists in the in-process registry. Callers that hit the
 * `undefined` branch typically fall back to the spec #1 default-resolver
 * helper to preserve behaviour for non-run code paths and post-restart
 * scenarios.
 */
export function getRunArchitectureId(runId: string): string | undefined {
  return runBindings.get(runId)?.architectureId;
}

/**
 * Returns the full binding (architectureId + projectId) for the given
 * run, or `undefined` when no binding exists.
 */
export function getRunBinding(runId: string): RunBinding | undefined {
  return runBindings.get(runId);
}

/**
 * Test-only helper: clears the entire registry. Production code should
 * never call this — bindings are permanent for the run's lifetime by
 * design.
 *
 * Tests call this in `beforeEach` to isolate run state between tests.
 */
export function _resetRunArchitectureRegistryForTests(): void {
  runBindings.clear();
}
