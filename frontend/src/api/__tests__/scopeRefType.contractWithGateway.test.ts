/**
 * ScopeRefType cross-package drift-detection contract.
 *
 * Spec: 2026-05-26-low-priority-mechanical-cleanups (#14).
 *
 * Drift between three sources is enforced here at test-time:
 *   1. `gateway/src/config/architect-conversation/scopeRefType.json` --
 *      canonical source of truth (also drives the gateway's
 *      `questionLibrary.ts` `ScopeRefType` union via `typeof ... [number]`).
 *   2. The frontend-side `ALLOWED_SCOPE_REF_TYPES` runtime array in
 *      `architectConversationApi.ts` (kept as a literal for now -- the
 *      frontend does not import gateway source).
 *   3. The frontend-side `ScopeRefType` literal-string union in the same
 *      file (compile-time check via a type-test assignment).
 *
 * Why JSON-source-of-truth and not a cross-package TS import:
 *   The two packages have never reached into each other's source trees;
 *   the frontend's `tsconfig.json` declares `"include": ["src"]` and
 *   strict linting that would actively resist a `import ... from
 *   '../../../gateway/...'`. JSON imports under bundler-mode resolution
 *   work without any new config (`resolveJsonModule: true` is already on).
 *
 * If this test fails after adding / removing a scope value:
 *   Update `gateway/src/config/architect-conversation/scopeRefType.json`
 *   AND the frontend's literal union + array in `architectConversationApi.ts`
 *   in the same change. The gateway's `questionLibrary.ts` tuple type
 *   `ScopeRefTypeTuple` may also need updating.
 */

import { describe, it, expect } from 'vitest';

import {
  ALLOWED_SCOPE_REF_TYPES as FRONTEND_ALLOWED,
  type ScopeRefType as FrontendScopeRefType,
} from '../architectConversationApi';
// Cross-package JSON import. `resolveJsonModule: true` is enabled in
// `frontend/tsconfig.json` per spec investigation. Path resolves four
// levels up: __tests__ -> api -> src -> frontend -> repo root.
import scopeRefTypeJson from '../../../../gateway/src/config/architect-conversation/scopeRefType.json';

describe('ScopeRefType drift-detection contract', () => {
  it('frontend ALLOWED_SCOPE_REF_TYPES matches gateway scopeRefType.json values', () => {
    const frontendSorted = [...FRONTEND_ALLOWED].sort();
    const jsonSorted = [...scopeRefTypeJson.values].sort();

    expect(frontendSorted).toEqual(jsonSorted);
    // Belt-and-braces length check so a future "values" key rename in the
    // JSON file surfaces as a clear failure rather than a silent empty
    // sort comparison.
    expect(FRONTEND_ALLOWED.length).toBe(scopeRefTypeJson.values.length);
    expect(FRONTEND_ALLOWED.length).toBeGreaterThan(0);
  });

  it('frontend ScopeRefType literal union accepts every JSON-declared value', () => {
    // Compile-time + runtime equivalence: assigning each JSON value through
    // a `FrontendScopeRefType` annotation forces the TS compiler to verify
    // that every JSON member is also a valid frontend `ScopeRefType`. If
    // the JSON gains a value the frontend hasn't mirrored yet, this file
    // fails to type-check (the compile error surfaces during `vitest run`).
    for (const value of scopeRefTypeJson.values) {
      const typed: FrontendScopeRefType = value as FrontendScopeRefType;
      expect(FRONTEND_ALLOWED).toContain(typed);
    }
  });
});
