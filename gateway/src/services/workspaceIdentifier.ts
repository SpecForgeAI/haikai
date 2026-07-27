/**
 * Workspace identifier normalisation (gateway mirror, 2026-07-27).
 *
 * The implement-verify service addresses its workspace by LITERAL
 * `<company>/<project>` directory names. Every frontend surface that talks to
 * it (project init, repo CRUD, browser shape-spec, orchestration) normalises
 * the organisation/product display names first via
 * `frontend/src/utils/normalizeIdentifier.ts` (Spec 2026-01-30) — so the
 * workspace on disk is e.g. `example-corp/demo-migration`.
 *
 * The migration execution driver's `MigrateScope` DOCUMENTED its
 * company/project as "normalised" but nothing enforced it, and the plan
 * screen passes the RAW display names ("Example Corp" / "Demo Migration").
 * Result, live-confirmed 2026-07-27: the first Stage-1 dispatch 400'd at the
 * IVS precondition gate ("Project not initialized") because the driver was
 * addressing a workspace directory that can never exist under the raw names —
 * even after a correct project init.
 *
 * This module is the gateway-side mirror of the frontend util — SAME
 * algorithm, byte-for-byte (trim → lowercase → collapse whitespace runs to a
 * single hyphen) — applied at the driver's entry points so the invariant is
 * enforced where it matters ("never trust the UI"), idempotently.
 */

/**
 * Normalise one identifier: trim, lowercase, collapse whitespace runs to a
 * single hyphen. Mirrors `frontend/src/utils/normalizeIdentifier.ts` exactly.
 * Idempotent: normalising an already-normalised value is a no-op.
 */
export function normalizeWorkspaceIdentifier(input: string | null | undefined): string {
  if (input == null) {
    return '';
  }
  return input.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Return a copy of any `{ company, project }`-bearing scope with both
 * identifiers normalised. Applied as the FIRST step of every migration-driver
 * entry point (start / resume / build-result advances / boot recovery), so
 * raw display names from the UI — or from run records created before this fix
 * — can never reach an IVS workspace lookup.
 */
export function normalizeScopeIdentifiers<T extends { company: string; project: string }>(
  scope: T
): T {
  return {
    ...scope,
    company: normalizeWorkspaceIdentifier(scope.company),
    project: normalizeWorkspaceIdentifier(scope.project),
  };
}
