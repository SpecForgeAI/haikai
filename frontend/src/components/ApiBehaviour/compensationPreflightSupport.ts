/**
 * Pre-start compensation-preflight warning (CSD Spec 3 gap fix, 2026-08-19).
 *
 * The validation service's GET .../compensation-preflight lists every
 * INCLUDED write endpoint whose (METHOD, path) resolves NO write tables in
 * the committed effect map — those mutating scenarios are REFUSED
 * (fail-closed) at capture time. The wizard shows this BEFORE /start so the
 * operator sees the list at judgeable scale (a long list = effect-map mining
 * needs attention) instead of discovering skips after the run.
 *
 * Pure message builders — the wizard pipes the result through
 * `window.confirm` (proceed / cancel). `null` = nothing to warn about.
 */

export interface CompensationPreflightSummary {
  model_resolvable: boolean;
  write_endpoints_without_effect_map: string[];
  note?: string | null;
}

/** Endpoints listed verbatim before eliding — keeps the confirm readable. */
const MAX_LISTED_ENDPOINTS = 10;

export function buildCompensationPreflightWarning(
  preflight: CompensationPreflightSummary,
): string | null {
  if (!preflight.model_resolvable) {
    return (
      'The committed model could not be read — compensation will be INACTIVE ' +
      'and mutating captures would run uncompensated (the database would NOT ' +
      'be restored to its canonical state).\n\nStart anyway?'
    );
  }
  const missing = preflight.write_endpoints_without_effect_map ?? [];
  if (missing.length === 0) return null;

  const listed = missing.slice(0, MAX_LISTED_ENDPOINTS);
  const elided = missing.length - listed.length;
  return (
    `${missing.length} write endpoint(s) will be REFUSED at capture time ` +
    '(fail-closed): no effect-table map in the committed model.\n\n' +
    listed.join('\n') +
    (elided > 0 ? `\n(+${elided} more)` : '') +
    '\n\nRemedy: run "Backfill effect maps" on the API Behaviour Baselines ' +
    'screen (corpus-derived + reviewed LLM proposals), or save-back the ' +
    'endpoint data effects for these endpoints, then start again.\n\nStart anyway?'
  );
}

export function buildPreflightUnavailableWarning(errorText: string): string {
  return (
    `The compensation pre-start check could not run (${errorText}). ` +
    'Write endpoints without effect maps cannot be listed — any such ' +
    'endpoint will be refused at capture time without prior warning.' +
    '\n\nStart anyway?'
  );
}
