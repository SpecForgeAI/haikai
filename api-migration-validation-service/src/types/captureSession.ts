/**
 * Capture-session domain types -- TypeScript projections of the seven
 * `api_behaviour_*` AMS tables. All numeric / boolean fields that participate
 * in PATCH semantics are boxed as `T | null` so that a missing key in a JSON
 * patch body never silently overwrites a stored value with `0` / `false`
 * (the primitive-double pitfall called out in spec / project memory).
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 */

export type CaptureSessionStatus =
  | 'draft'
  | 'configured'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AuthType =
  | 'none'
  | 'bearer'
  | 'api_key_header'
  | 'api_key_query'
  | 'basic'
  | 'custom_header';

export interface RedactedAuthConfig {
  type: AuthType;
  /** Header / query-param NAMES present, values omitted. */
  headerNames?: string[];
  queryParamNames?: string[];
  username?: string | null;
}

export interface RedactedDbConfig {
  dbType: 'postgres' | 'sybase';
  host?: string | null;
  port?: number | null;
  database?: string | null;
  schema?: string | null;
  username?: string | null;
  allowlistTables?: string[] | null;
  allowlistSchemas?: string[] | null;
  maxRowsPerQuery?: number | null;
  queryTimeoutSeconds?: number | null;
}

export interface CaptureSession {
  id: string;
  projectId: string;
  architectureId: string;
  name: string | null;
  status: CaptureSessionStatus;
  envName: string | null;
  apiBaseUrl: string | null;
  authType: AuthType | null;
  authConfigRedactedJson: RedactedAuthConfig | null;
  defaultHeadersRedactedJson: Record<string, string> | null;
  oasSpecRefsJson: Array<{ interfaceId?: string; uploadName?: string }> | null;
  dbConfigRedactedJson: RedactedDbConfig | null;
  /** Boxed boolean -- PATCH-mutable, never assume primitive default. */
  mutatingCallsConfirmed: boolean | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ScenarioType =
  | 'happy_path'
  | 'not_found'
  | 'validation_error'
  | 'empty_result'
  | 'boundary_value'
  | 'auth_error'
  | 'business_edge_case'
  | 'generated_candidate';

export type ScenarioStatus =
  | 'draft'
  | 'executed_success'
  | 'executed_error'
  | 'accepted'
  | 'rejected'
  | 'needs_review';

export type GenerationSource =
  | 'oas_example'
  | 'db_sample'
  | 'llm_generated'
  | 'llm_refined'
  | 'user_edited';

export type DiagnosticType =
  | 'failed_request'
  | 'auth_failure'
  | 'db_sample_failure'
  | 'llm_generation_failure'
  | 'redaction_warning'
  | 'endpoint_skipped'
  | 'retry_exhausted';

export type BaselineStatus = 'draft' | 'active' | 'archived';
