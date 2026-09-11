/**
 * Shared mapping of the sidecar `/call` response (snake_case wire) onto the
 * engine-neutral `RoutineInvocationEnvelope`. Used by every sidecar-backed
 * adapter (SQL Server today; the Sybase adapter adopts it in Spec 4 of the
 * second-pair programme).
 */
import type { RoutineInvocationEnvelope } from './routineEnvelope';

/** The sidecar `/call` response (snake_case keys, Spec 2 of the proc programme). */
export interface SidecarCallResponse {
  ok: boolean;
  error?: string | null;
  outcome?: string;
  return_status?: number | null;
  output_params?: Record<string, unknown>;
  result_sets?: Array<{
    ordinal?: number;
    columns?: Array<{ name: string; type?: string }>;
    rows?: unknown[][];
    row_count?: number;
    truncated?: boolean;
  }>;
  update_counts?: number[];
  messages?: Array<{ kind?: string; number?: number | null; severity?: number | null; state?: number | null; text?: string }>;
  error_detail?: {
    number?: number | null;
    sqlstate?: string | null;
    severity?: number | null;
    state?: number | null;
    message?: string;
  } | null;
  timing_ms?: number;
  session?: { login?: string; set_options?: string[] };
  driver_used?: string;
}

export function mapSidecarCallResponse(
  resp: SidecarCallResponse,
  fallback: { login: string; sessionSet: string[] },
): RoutineInvocationEnvelope {
  return {
    outcome: resp.outcome === 'error' ? 'error' : 'success',
    return_status: typeof resp.return_status === 'number' ? resp.return_status : null,
    output_params: resp.output_params ?? {},
    result_sets: (resp.result_sets ?? []).map((rs, i) => ({
      ordinal: typeof rs.ordinal === 'number' ? rs.ordinal : i + 1,
      columns: (rs.columns ?? []).map((c) => ({ name: c.name, type: c.type ?? '' })),
      rows: rs.rows ?? [],
      row_count: typeof rs.row_count === 'number' ? rs.row_count : (rs.rows ?? []).length,
      truncated: rs.truncated === true,
    })),
    update_counts: resp.update_counts ?? [],
    messages: (resp.messages ?? []).map((m) => ({
      kind: m.kind === 'print' || m.kind === 'raiserror' ? m.kind : 'info',
      number: typeof m.number === 'number' ? m.number : null,
      severity: typeof m.severity === 'number' ? m.severity : null,
      state: typeof m.state === 'number' ? m.state : null,
      text: m.text ?? '',
    })),
    error: resp.error_detail
      ? {
          number: typeof resp.error_detail.number === 'number' ? resp.error_detail.number : null,
          sqlstate: resp.error_detail.sqlstate ?? null,
          severity: typeof resp.error_detail.severity === 'number' ? resp.error_detail.severity : null,
          state: typeof resp.error_detail.state === 'number' ? resp.error_detail.state : null,
          message: resp.error_detail.message ?? '',
        }
      : null,
    timing_ms: typeof resp.timing_ms === 'number' ? resp.timing_ms : 0,
    session: {
      login: resp.session?.login ?? fallback.login,
      set_options: resp.session?.set_options ?? fallback.sessionSet,
    },
    engine: 'sidecar',
  };
}
