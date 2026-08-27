/**
 * In-memory secret bundles held by the service for the lifetime of a single
 * capture session. NEVER serialised to disk, NEVER written to AMS, NEVER
 * logged. Cleared on session terminal status (completed / failed / cancelled)
 * or on process restart.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 */

export interface ApiAuthSecret {
  type: 'none' | 'bearer' | 'api_key_header' | 'api_key_query' | 'basic' | 'custom_header';
  /** Bearer token plaintext (only for type=bearer). */
  bearerToken?: string;
  /** Custom header name + value pair (for api_key_header / custom_header). */
  headerName?: string;
  headerValue?: string;
  /** Query-param name + value pair (for api_key_query). */
  queryParamName?: string;
  queryParamValue?: string;
  /** Basic-auth username + password (for type=basic). */
  username?: string;
  password?: string;
  /**
   * Optional SECOND identity value (four-eyes endpoints, Item #4
   * 2026-08-27): same auth type + header name as the primary, different
   * value (a different human's token). Consumed only by
   * `execute_http_request`'s `useSecondIdentity` per-call override; absent
   * = those scenarios record `manual_rec_required` instead of firing.
   */
  secondaryValue?: string;
}

export interface DbSecret {
  password: string;
  /**
   * Optional READ-ONLY login (credential-role split, Capture-State
   * Discipline Spec 3): when BOTH fields are present, observational paths
   * (DB sampling, state snapshots, compensation imaging, S0 fingerprints)
   * connect with THIS login, and the primary credentials above are reserved
   * for the compensation/restore write surface. When absent, the primary
   * login serves both roles and the session carries a visible advisory
   * recommending the split.
   */
  readonlyUsername?: string;
  readonlyPassword?: string;
}

export interface SecretsBundle {
  sessionId: string;
  api: ApiAuthSecret;
  db?: DbSecret;
  /** Wall-clock timestamp the bundle was last written. Used for audit only. */
  loadedAt: number;
}
