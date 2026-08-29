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
  // Auth-expiry circuit breaker (Spec 0, 2026-08-22): consecutive all-401
  // scenarios mid-run — resume after re-entering secrets via "Retry
  // uncovered APIs".
  | 'paused_auth_expired'
  // State-discipline remediation (2026-08-27): the run FINISHED, healed
  // what it could, and flagged the rest (manual_rec_required /
  // state_healed findings). Terminal, and NOT a failure.
  | 'completed_with_findings'
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
  /** Per-session capture tuning (Item #5/S-1, 2026-08-27): operator
   *  overrides { llm_tool_call_timeout_ms, max_response_body_bytes };
   *  null/absent = env defaults. */
  captureTuningJson?: Record<string, unknown> | null;
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
  // Foundations Spec 3 (2026-08-22): an endpoint refused because its ENTIRE
  // effect map was removed by migration-scope decisions (receipts cited).
  | 'scope_conflict'
  // Foundations Spec 3: detect-only keyless_multiset bracket observation.
  | 'keyless_write_recorded'
  | 'db_sample_failure'
  | 'llm_generation_failure'
  | 'redaction_warning'
  | 'endpoint_skipped'
  // 2026-08-26: the behaviour WAS captured, as the legacy 200-with-
  // business-error-code idiom — a successful negative capture, never a
  // skip (108 "endpoint skipped" rows were mislabelled captured negatives).
  | 'captured_as_business_error'
  // State-discipline remediation taxonomy (2026-08-27): stop forcing the
  // LLM to mislabel successes.
  // captured_ok — a clean successful capture (plain success value).
  | 'captured_ok'
  // contract_gap — the endpoint structurally cannot produce the intended
  // scenario; detail_json.reason ∈ no_negative_available (e.g. a GET that
  // ignores its body) | format_variant_impossible (declared format cannot
  // bind). A fact about the contract, never a failure.
  | 'contract_gap'
  // manual_rec_required — cannot be auto-captured/auto-reconciled (e.g.
  // four-eyes without a second identity). Excluded from the coverage
  // score; a standing human todo, not a fake failure.
  | 'manual_rec_required'
  // irreversible_drift — orchestrator finding (2026-08-29): a residue
  // table could not be healed (keyless / never-dumped); the capture
  // CONTINUED and the end-of-job fingerprint tolerates exactly these
  // known tables. S0 restore is the reset lever.
  | 'irreversible_drift'
  // state_healed — orchestrator receipt: a drifted table was healed back
  // to its snapshot mid-run and the run continued.
  | 'state_healed'
  // s0_restore_recorded — post-capture S0 restore receipt; the
  // migrate/reconcile gate reads it.
  | 's0_restore_recorded'
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
