/**
 * API like-for-like lock shape cross-package drift-detection contract.
 *
 * Spec: 2026-06-24-target-conversation-tech-stack-constraints (Task Group 7;
 * FR9 / FR1 `L` treatment).
 *
 * The `api.surfaceMode` migration-mode enum + the `locked` (`L`) treatment
 * marker are mirrored gateway <-> frontend. This test pins the sources that can
 * drift:
 *
 *   1. `gateway/src/config/architect-conversation/apiSurfaceMode.json` --
 *      canonical source of truth for the closed `api.surfaceMode` set, the
 *      default mode, the `locked` treatment marker, and the six lockable
 *      Group B codes (also drives the gateway's `apiSurfaceMode.ts`).
 *   2. The frontend-side `API_SURFACE_MODES` runtime array + `ApiSurfaceMode`
 *      literal union + `LOCKED_TREATMENT_MARKER` in `architectConversationApi.ts`
 *      (kept as literals; the frontend does not import gateway source).
 *
 * Why JSON-source-of-truth and not a cross-package TS import: identical
 * rationale to `scopeRefType.contractWithGateway.test.ts` /
 * `frameworkVersionShape.contractWithGateway.test.ts` -- the two packages never
 * reach into each other's source trees; `resolveJsonModule: true` is already
 * enabled so the JSON import works with no new config.
 *
 * If this test fails after adding / removing a mode or marker:
 *   Update `gateway/.../apiSurfaceMode.json` AND the frontend's literal union +
 *   `API_SURFACE_MODES` array + `LOCKED_TREATMENT_MARKER` in
 *   `architectConversationApi.ts` (and the gateway's `ApiSurfaceModeTuple` type)
 *   in the same change.
 */

import { describe, it, expect } from 'vitest';

import {
  API_SURFACE_MODES as FRONTEND_MODES,
  DEFAULT_API_SURFACE_MODE,
  LOCKED_TREATMENT_MARKER,
  isApiSurfaceMode,
  type ApiSurfaceMode as FrontendApiSurfaceMode,
} from '../architectConversationApi';
// Cross-package JSON import. `resolveJsonModule: true` is enabled in
// `frontend/tsconfig.json`. Path resolves four levels up:
// __tests__ -> api -> src -> frontend -> repo root.
import apiSurfaceModeJson from '../../../../gateway/src/config/architect-conversation/apiSurfaceMode.json';

describe('api.surfaceMode shape drift-detection contract', () => {
  it('frontend API_SURFACE_MODES matches gateway apiSurfaceMode.json modes', () => {
    const frontendSorted = [...FRONTEND_MODES].sort();
    const jsonSorted = [...apiSurfaceModeJson.apiSurfaceModes].sort();

    expect(frontendSorted).toEqual(jsonSorted);
    expect(FRONTEND_MODES.length).toBe(apiSurfaceModeJson.apiSurfaceModes.length);
    expect(FRONTEND_MODES.length).toBe(2);
  });

  it('frontend ApiSurfaceMode literal union accepts every JSON-declared mode', () => {
    // Compile-time + runtime equivalence: assigning each JSON mode through a
    // `FrontendApiSurfaceMode` annotation forces the TS compiler to verify that
    // every JSON member is also a valid frontend `ApiSurfaceMode`.
    for (const value of apiSurfaceModeJson.apiSurfaceModes) {
      const typed: FrontendApiSurfaceMode = value as FrontendApiSurfaceMode;
      expect(FRONTEND_MODES).toContain(typed);
      expect(isApiSurfaceMode(typed)).toBe(true);
    }
  });

  it('the default mode agrees across packages (like_for_like)', () => {
    expect(DEFAULT_API_SURFACE_MODE).toBe(apiSurfaceModeJson.defaultMode);
    expect(DEFAULT_API_SURFACE_MODE).toBe('like_for_like');
  });

  it('the locked (L) treatment marker agrees across packages', () => {
    expect(LOCKED_TREATMENT_MARKER).toBe(apiSurfaceModeJson.lockedTreatmentMarker);
    expect(LOCKED_TREATMENT_MARKER).toBe('locked');
  });

  it('the lockable Group B set is exactly the six API-surface codes', () => {
    expect(new Set(apiSurfaceModeJson.lockableGroupBCodes)).toEqual(
      new Set([
        'api.protocol',
        'api.versioning',
        'api.contractFormat',
        'api.auth',
        'api.errorContract',
        'api.rateLimiting',
      ]),
    );
    expect(apiSurfaceModeJson.lockableGroupBCodes).toHaveLength(6);
  });
});
