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
}

export interface DbSecret {
  password: string;
}

export interface SecretsBundle {
  sessionId: string;
  api: ApiAuthSecret;
  db?: DbSecret;
  /** Wall-clock timestamp the bundle was last written. Used for audit only. */
  loadedAt: number;
}
