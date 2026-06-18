import type { ApiAuthSecret } from '../types/secrets';

/**
 * Scoped auth-override mode for a single HTTP call.
 *
 *   - `session`    -- normal path: use the session's auto-injected auth
 *                     (the executor's `currentAuth`). No override.
 *   - `none`       -- send NO auth despite the session auto-injecting the
 *                     valid ssoToken (`ApiAuthSecret { type: 'none' }`).
 *   - `bad_token`  -- send a garbage bearer token (a non-empty, definitely
 *                     invalid value) so the target rejects it 401/403.
 *
 * Spec: 2026-06-17 Oracle Coverage Scoring -- session-level auth-negative
 * coverage. Shared by `execute_http_request` (optional tool arg) and the
 * orchestrator's session-level auth probes so both speak ONE definition of the
 * no-auth / bad-token shapes (no drift).
 */
export type AuthMode = 'session' | 'none' | 'bad_token';

/**
 * The garbage bearer token sent for the `bad_token` probe. Deliberately NOT a
 * real-looking JWT -- it is a marker string the target must reject. Never a
 * secret, so it is safe to keep as a constant.
 */
export const BAD_TOKEN_VALUE = 'invalid-bad-token-for-auth-negative-probe';

/**
 * Resolve an `AuthMode` to the `ApiAuthSecret` the executor should send for
 * the scoped override, or `null` for the normal (`session`) path where the
 * executor's `currentAuth` is left untouched.
 *
 * Pure -- inputs in, value out; no I/O, no mutation.
 */
export function resolveAuthOverride(mode: AuthMode | undefined | null): ApiAuthSecret | null {
  switch (mode) {
    case 'none':
      return { type: 'none' };
    case 'bad_token':
      return { type: 'bearer', bearerToken: BAD_TOKEN_VALUE };
    case 'session':
    case undefined:
    case null:
    default:
      return null;
  }
}

/** Narrow an arbitrary value to a valid `AuthMode` (defaults to `session`). */
export function coerceAuthMode(value: unknown): AuthMode {
  return value === 'none' || value === 'bad_token' ? value : 'session';
}
