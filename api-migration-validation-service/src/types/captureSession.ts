/**
 * Capture-session domain types -- TypeScript projections of the seven
 * `api_behaviour_*` AMS tables. All numeric / boolean fields that participate
 * in PATCH semantics are boxed as `T | null` so that a missing key in a JSON
 * patch body never silently overwrites a stored value with `0` / `false`
 * (the primitive-double pitfall called out in spec / project memory).
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 */

import type { ResponseSemanticsConfig } from '../services/responseSemantics';

export type CaptureSessionStatus =
  | 'draft'
  | 'configured'
  | 'running'
  | 'completed'
  | 'failed'
  // Terminal: the LLM provider's per-DAY token quota was reached mid-capture
  // (Spec 2026-07-22). Not a failure — captured data is intact; resume after
  // reset via "Retry uncovered APIs".
  | 'paused_rate_limited'
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
  /** LEGACY wizard wire key — the Step-3 form persisted its table allowlist
   *  as flat `allowlist` while the tools read `allowlistTables`, so the
   *  session allowlist was ALWAYS empty at the reader and `list_db_metadata`
   *  fail-closed to zero rows (2026-08-21 diagnosis — the same wire-key bug
   *  class as `dbType` vs `type`). Read via {@link effectiveDbAllowlist}. */
  allowlist?: string[] | null;
  maxRowsPerQuery?: number | null;
  queryTimeoutSeconds?: number | null;
}

/**
 * THE session DB allowlist, wire-key tolerant: tables from `allowlistTables`
 * (canonical) falling back to the legacy wizard key `allowlist`; schemas
 * from `allowlistSchemas` falling back to the single `schema` connection
 * field (the operator naming a schema plainly intends it as the metadata
 * scope). Every allowlist consumer MUST read through this helper.
 */
export function effectiveDbAllowlist(config: RedactedDbConfig | null | undefined): {
  schemas: string[] | null;
  tables: string[] | null;
} {
  const tables = config?.allowlistTables ?? config?.allowlist ?? null;
  const schemas =
    config?.allowlistSchemas ??
    (config?.schema && config.schema.trim().length > 0 ? [config.schema.trim()] : null);
  return {
    schemas: schemas && schemas.length > 0 ? schemas : null,
    tables: tables && tables.length > 0 ? tables : null,
  };
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
  /**
   * Per-data-type operator-confirmed default formats (Capture data-type
   * format defaults, 2026-06-20; AMS changeset 195). Plain map
   * `category -> format`: a non-null string is the operator default, `null`
   * is an explicit "no default" (no operator nudge for that type), an absent
   * key is untouched/never-decided. Hydrated from the AMS DTO
   * `data_type_defaults_json` and fed to the capture LLM as a separate
   * `dataTypeDefaults` prompt block. Null/absent on legacy sessions.
   */
  dataTypeDefaultsJson?: Record<string, string | null> | null;
  /**
   * Per-API operator-confirmed response-semantics config (Semantics-aware API
   * Behaviour Baseline coverage, 2026-06-23; AMS changeset 196). A structured
   * `ResponseSemanticsConfig` (optional `statusBucketOverride` /
   * `notFoundMarkers` / `badRequestMarkers` / `fiveXxIsBadInput`) steering how
   * the scorer maps an observed status + body to a coverage bucket for a legacy
   * API that violates REST conventions. Hydrated from the AMS DTO
   * `behaviour_semantics_config_json` and threaded into the orchestrator's
   * `classifyObservedBehaviour`. Null/absent === built-in default vocabulary
   * (the valid empty state; forward-only, no backfill on legacy sessions).
   */
  behaviourSemanticsConfigJson?: ResponseSemanticsConfig | null;
}

export type ScenarioType =
  | 'happy_path'
  | 'not_found'
  | 'validation_error'
  | 'empty_result'
  | 'boundary_value'
  | 'auth_error'
  | 'business_edge_case'
  | 'generated_candidate'
  | 'manual';

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
  | 'user_edited'
  | 'manual';

export type DiagnosticType =
  | 'failed_request'
  | 'auth_failure'
  | 'db_sample_failure'
  | 'llm_generation_failure'
  | 'redaction_warning'
  | 'endpoint_skipped'
  | 'retry_exhausted'
  // Capture-State Discipline Spec 3 (2026-08-18): compensation-bracket and
  // S0-fingerprint session diagnostics (mirrored in the AMS allowlist).
  | 'compensation_no_effect_map'
  | 'compensation_refused'
  | 'compensation_residue'
  | 'compensation_inactive'
  | 'compensation_credential_split_recommended'
  | 's0_fingerprint_mismatch'
  | 's0_snapshot_missing'
  | 's0_fingerprint_check_failed'
  // Proven-read classification (2026-08-20): write-verb endpoint with
  // READ-only committed effects fires unbracketed (info, never a refusal).
  | 'proven_read_only';

export type BaselineStatus = 'draft' | 'active' | 'archived';
