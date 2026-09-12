/**
 * Proc behaviour capture — shared types (Stored Proc & Function Behaviour
 * Program, Spec 3, 2026-09-09). DB-NATIVE and independent of the API
 * capture session types: nothing here references an OAS inventory, a base
 * URL or an API baseline. Wire shapes mirror the AMS `proc_behaviour_*`
 * tables (snake_case).
 */

import type { RoutineInvocationEnvelope } from '../db/routineEnvelope';

/** A `db_routines` row as AMS serves it (Spec 1). */
export interface RoutineCatalogRow {
  id: string;
  schema_name: string;
  routine_name: string;
  routine_kind: 'procedure' | 'function' | 'trigger';
  language?: string | null;
  full_body: string;
  body_hash: string;
  params_json: RoutineParamDecl[];
  returns_type?: string | null;
  trigger_on_table?: string | null;
  profile_json: RoutineProfileJson;
  reads_json?: string[];
  writes_json?: string[];
  proc_calls_json?: string[];
  reads_closure_json?: string[];
  writes_closure_json?: string[];
  trigger_expanded_writes_json?: string[];
  signature_parsed?: boolean;
  signature_error?: string | null;
}

export interface RoutineParamDecl {
  name: string;
  ordinal: number;
  source_type: string;
  direction: 'in' | 'output';
  default_literal: string | null;
}

export interface RoutineProfileJson {
  return_sites?: Array<{ value: number | null; expr: string | null }>;
  return_status_trivial?: boolean;
  raiserror_sites?: Array<{ number: number | null; severity: number | null; text_preview: string | null }>;
  result_selects?: Array<{ ordinal: number; has_order_by: boolean; has_top: boolean; select_list_static: string | null }>;
  max_result_sets?: number;
  constructs?: string[];
  volatile_functions?: string[];
  session_user_functions?: string[];
  non_compensatable_reasons?: string[];
  set_options?: string[];
}

export type ProcSessionStatus =
  | 'draft'
  | 'configured'
  | 'running'
  | 'completed'
  | 'completed_with_findings'
  | 'failed'
  | 'cancelled';

export interface ProcDbConfig {
  dbType: import('../../types/db').DbType;
  /** SQL Server connection extras (ignored by other engines). */
  mssqlAuth?: import('../../types/db').MssqlAuth | null;
  host: string;
  port: number;
  database: string;
  schema?: string | null;
  username: string;
  maxRowsPerQuery?: number;
  queryTimeoutSeconds?: number;
}

export interface ProcCaptureTuning {
  /** LLM rounds per scenario that count against the budget. */
  round_limit?: number;
  research_round_ceiling?: number;
  tool_call_timeout_ms?: number;
  scenario_wall_clock_ms?: number;
  /** Fired routine invocations per scenario before the loop refuses. */
  attempts_per_scenario?: number;
  max_rows_per_result_set?: number;
  max_result_sets?: number;
  invocation_timeout_seconds?: number;
  /** Quiet-window gap before the first fire (0 = skip). */
  quiet_window_seconds?: number;
}

export interface ProcCaptureSessionDto {
  id: string;
  project_id: string;
  architecture_id: string;
  name: string;
  status: ProcSessionStatus;
  kind: 'current' | 'target';
  scope_routine_ids_json?: string[] | null;
  db_config_redacted_json?: ProcDbConfig | null;
  session_profile_json?: { driver?: string; set?: string[] } | null;
  capture_tuning_json?: ProcCaptureTuning | null;
  coverage_summary_json?: ProcCoverageSummary | null;
  s0_fingerprint_json?: Record<string, unknown> | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export type ProcScenarioType =
  | 'happy_path'
  | 'error_path'
  | 'zero_rows'
  | 'boundary'
  | 'null_param'
  | 'default_param'
  | 'business_edge'
  | 'sequence';

export type ProcGenerationSource = 'db_seed' | 'llm_generated' | 'llm_refined';

export interface ProcScenarioInput {
  name: string;
  value: unknown;
  is_null: boolean;
}

export interface ProcSequenceStep {
  routine_id: string;
  inputs: ProcScenarioInput[];
}

export interface ProcScenarioDto {
  id?: string;
  session_id: string;
  routine_id: string;
  scenario_name: string;
  scenario_type: ProcScenarioType;
  generation_source: ProcGenerationSource;
  inputs_json: ProcScenarioInput[];
  sequence_json?: ProcSequenceStep[] | null;
  status?: 'proposed' | 'fired' | 'excluded';
  exclusion_reason?: string | null;
  notes?: string | null;
}

export type BracketOutcomeName = 'clean' | 'compensated' | 'residue' | 'refused' | 'healed' | 'unbracketed';

export interface ProcCaptureDto {
  id?: string;
  session_id: string;
  scenario_id: string;
  routine_id: string;
  attempt_number: number;
  envelope_json: RoutineInvocationEnvelope | { steps: RoutineInvocationEnvelope[] };
  state_delta_json?: Record<string, unknown> | null;
  volatile_cells_json?: VolatileCell[] | null;
  bracket_outcome?: BracketOutcomeName | null;
  duration_ms?: number | null;
  error_type?: string | null;
  error_message?: string | null;
  accepted: boolean;
}

/** A cell that differed between two fires of the same inputs at S0 (evidence). */
export interface VolatileCell {
  where: 'result_set' | 'output_param' | 'return_status' | 'message';
  result_set?: number;
  row?: number;
  column?: string;
  param?: string;
}

export type ProcDiagnosticType =
  | 'routine_skipped'
  | 'non_compensatable'
  | 'bracket_residue'
  | 'coverage_floor_unmet'
  | 'excluded_by_user'
  | 'not_possible'
  | 'captured_as_error'
  | 'result_set_truncated'
  | 'login_dependent'
  | 's0_not_pinned'
  | 's0_repinned';

export interface ProcDiagnosticDto {
  id?: string;
  session_id: string;
  routine_id?: string | null;
  diagnostic_type: ProcDiagnosticType;
  message: string;
  detail_json?: Record<string, unknown> | null;
}

export interface ProcBaselineDto {
  id: string;
  session_id?: string | null;
  project_id: string;
  architecture_id: string;
  name: string;
  status: 'draft' | 'pinned' | 'superseded';
  kind: 'current' | 'target';
  s0_fingerprint_json?: Record<string, unknown> | null;
  content_hash?: string | null;
  routine_count: number;
  scenario_count: number;
  pinned_at?: string | null;
}

export interface ProcBaselineItemDto {
  id?: string;
  baseline_id?: string;
  routine_id: string;
  routine_body_hash: string | null;
  scenario_id?: string | null;
  scenario_name: string;
  scenario_type: ProcScenarioType;
  exit_outcome: string;
  inputs_json: ProcScenarioInput[];
  sequence_json?: ProcSequenceStep[] | null;
  expected_envelope_json: RoutineInvocationEnvelope | { steps: RoutineInvocationEnvelope[] };
  state_delta_json?: Record<string, unknown> | null;
  volatile_cells_json?: VolatileCell[] | null;
  business_notes?: string | null;
  stale?: boolean;
  stale_reason?: string | null;
}

/** Per-routine coverage (Spec 3 floor): required outcomes vs observed. */
export interface RoutineCoverage {
  routine_id: string;
  routine_name: string;
  bucket: 'verified' | 'not_exercised' | 'unverifiable' | 'excluded';
  required: string[];
  achieved: string[];
  missing: string[];
  reported_only_achieved: string[];
  floor_met: boolean;
  scenarios_fired: number;
  captures_accepted: number;
  unverifiable_reason?: string | null;
}

export interface ProcCoverageSummary {
  routines_in_scope: number;
  verified: number;
  not_exercised: number;
  unverifiable: number;
  excluded: number;
  per_routine: RoutineCoverage[];
  computed_at: string;
}
