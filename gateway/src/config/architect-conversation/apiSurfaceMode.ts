/**
 * API like-for-like lock shape — Target-conversation tech-stack constraints
 * (Spec 2026-06-24-target-conversation-tech-stack-constraints, FR9 / FR1 `L`
 * treatment).
 *
 * The migration mode `api.surfaceMode` (`like_for_like` | `may_change`) governs
 * whether the API-surface questions (the whole of Group B) are auto-answered +
 * LOCKED from the reconciled source contract / API Behaviour Baseline (treatment
 * class `L`, read-only, NOT asked) or asked normally under their underlying
 * H/I/G class. `like_for_like` DEFAULTS on whenever a reconciled baseline /
 * oracle is present — the like-for-like / reconciliation contract forbids API
 * deviation.
 *
 * This module is PURE TYPES + PURE DATA derived from `apiSurfaceMode.json`. No
 * I/O, no LLM, no orchestration. It is the gateway source-of-truth for the
 * shared closed sets; the frontend mirror lives in
 * `frontend/src/api/architectConversationApi.ts` and the two are kept in
 * lock-step by `frontend/src/api/__tests__/apiSurfaceMode.contractWithGateway.test.ts`.
 */

import apiSurfaceModeJson from './apiSurfaceMode.json';

// ---------------------------------------------------------------------------
// Migration modes (closed set; canonical members in apiSurfaceMode.json)
// ---------------------------------------------------------------------------

/**
 * Tuple type capturing the literal-string mode members declared in
 * `apiSurfaceMode.json`. Listed here so the TS compiler can narrow the
 * JSON-imported `string[]` down to a literal-union-derivable tuple. If this list
 * and the JSON drift, the cross-package contract test catches it.
 */
type ApiSurfaceModeTuple = readonly ['like_for_like', 'may_change'];

/**
 * The closed set of `api.surfaceMode` migration modes. Sourced from
 * `apiSurfaceMode.json` — see that file's `_doc` for drift-detection guidance.
 */
export const API_SURFACE_MODES =
  apiSurfaceModeJson.apiSurfaceModes as unknown as ApiSurfaceModeTuple;

export type ApiSurfaceMode = ApiSurfaceModeTuple[number];

/**
 * The DEFAULT mode applied whenever the architecture has a reconciled API
 * Behaviour Baseline / oracle: `like_for_like`. (The like-for-like /
 * reconciliation contract forbids API-surface deviation.)
 */
export const DEFAULT_API_SURFACE_MODE =
  apiSurfaceModeJson.defaultMode as ApiSurfaceMode;

/** `like_for_like` — Group B is auto-answered + LOCKED from source. */
export const API_SURFACE_MODE_LIKE_FOR_LIKE: ApiSurfaceMode = 'like_for_like';

/** `may_change` — Group B reverts to its underlying H/I/G class and is asked. */
export const API_SURFACE_MODE_MAY_CHANGE: ApiSurfaceMode = 'may_change';

/** True iff `mode` is a known closed-set `api.surfaceMode` value. */
export function isApiSurfaceMode(mode: string): mode is ApiSurfaceMode {
  return (API_SURFACE_MODES as readonly string[]).includes(mode);
}

// ---------------------------------------------------------------------------
// `L` treatment marker (the locked runtime treatment class)
// ---------------------------------------------------------------------------

/**
 * The single runtime treatment-class marker (`locked`, surfaced as `L`) that
 * supersedes a Group B question's underlying H/I/G `dependencyClass` while
 * `like_for_like` is active. It is NOT a `dependencyClass` — see
 * `TreatmentClass` in `questionLibrary.ts`. Sourced from `apiSurfaceMode.json`.
 */
export const LOCKED_TREATMENT_MARKER =
  apiSurfaceModeJson.lockedTreatmentMarker as 'locked';

// ---------------------------------------------------------------------------
// Lockable Group B code set (matches the matrix `lockableFromSource: true` rows)
// ---------------------------------------------------------------------------

/**
 * The EXACT six Group B (API-surface) codes that carry
 * `lockableFromSource: true` in the matrix metadata and are auto-answered +
 * LOCKED under `like_for_like`. Sourced from `apiSurfaceMode.json` so the
 * lock resolver and the matrix metadata never declare the membership twice;
 * the loader / tests assert the two agree.
 */
export const LOCKABLE_GROUP_B_CODES =
  apiSurfaceModeJson.lockableGroupBCodes as readonly string[];

/** True iff `code` is one of the six lockable Group B (API-surface) codes. */
export function isLockableGroupBCode(code: string): boolean {
  return LOCKABLE_GROUP_B_CODES.includes(code);
}
