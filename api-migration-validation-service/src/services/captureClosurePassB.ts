/**
 * Coverage Closure — Pass B: failure-mode-aware LLM repair directives (Spec
 * 2026-07-20, CC3).
 *
 * Whatever survives Pass A's deterministic id replay is not a plain missing-id
 * problem, so Pass B runs an LLM repair loop that is fundamentally different
 * from generation: its prompt is seeded with the EXACT persisted failed request,
 * the EXACT error response, and a playbook keyed to the failure MODE (a 404, a
 * 422, a 401 and a 500 each need a different next move, and today all four get
 * the same generic retry). The operator's per-endpoint notes ("try ID=3275, use
 * 'Core' for parameter 'type'") ride into the same directive, and the attempt
 * budget is raised for this tail-only phase (default 15, user-editable) — reads
 * get the full budget, mutating verbs a lower cap steered toward create-then-act
 * rather than blind re-firing.
 *
 * BUDGET SEMANTICS (2026-08-08 fix): "attempts" counts requests FIRED at the
 * target operation (enforced by the loop runner's firedAttemptBudget), never
 * research tool calls — the loop's round limit and wall clock derive from the
 * budget via {@link deriveLoopBudget}. The directive is seeded with the
 * deterministic values Pass A already holds ({@link RepairSeed}) so the LLM
 * starts from real ids and never repeats a known-failed candidate.
 *
 * This module is PURE: it classifies the failure and COMPOSES the directive +
 * clamped budget the loop runner will execute. No I/O, unit-tested. The live
 * loop (CC3 integration) consumes a RepairDirective per surviving endpoint.
 */

/** Default per-endpoint FIRED-attempt budget for Pass B (user-editable). */
export const DEFAULT_REPAIR_ATTEMPTS = 15;
/** Hard ceiling on per-endpoint attempts (guards a fat-fingered modal value). */
export const MAX_REPAIR_ATTEMPTS = 50;
/**
 * Mutating verbs re-fire real state changes, so their closure budget is capped
 * low and the directive steers toward create-then-act chains (user decision
 * 2026-07-20, option b). Since 2026-08-08 this caps FIRED attempts at the
 * target — research and prerequisite creates are free — so 5 is a real
 * five corrective iterations, not five LLM rounds.
 */
export const MUTATING_ATTEMPTS_CAP = 5;

/**
 * Derive the LLM loop limits from a FIRED-attempt budget (2026-08-08 budget
 * fix). "Attempts" in the retry modal means requests actually fired at the
 * target operation; research tool calls (contract reading, DB sampling,
 * source search) do not consume it. The loop's round limit and wall clock
 * scale generously so the budget — not an unrelated cap — is what ends a
 * repair: ~4 research/act rounds per attempt plus a fixed exploration
 * allowance, and one minute of wall clock per attempt on a 4-minute base
 * (ceiling 45 minutes).
 */
export function deriveLoopBudget(attempts: number): {
  roundLimit: number;
  wallClockMs: number;
} {
  const a = Math.max(1, Math.floor(attempts));
  return {
    roundLimit: a * 4 + 8,
    wallClockMs: Math.min(45 * 60_000, a * 60_000 + 240_000),
  };
}

export type FailureMode =
  | 'missing_id'
  | 'bad_request'
  | 'auth'
  | 'sequencing'
  | 'server_error'
  | 'transport'
  | 'unknown';

const MUTATING_VERBS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

export function isMutatingVerb(method: string): boolean {
  return MUTATING_VERBS.has((method || '').toUpperCase());
}

/** The last-attempt diagnosis the loop persisted for an uncovered endpoint. */
export interface EndpointDiagnosis {
  operation_id: string;
  method: string;
  path: string;
  /** Last observed HTTP status (null === transport failure / no response). */
  last_status: number | null;
  /** Distilled error summary the executor persisted (null when none). */
  last_error_summary: string | null;
  /** A compact rendering of the last request tried (for the prompt). */
  last_request_summary?: string | null;
}

/** Operator-supplied Pass B config for one endpoint (from the retry modal). */
export interface RepairConfig {
  /** Requested FIRED attempts at the target; clamped + verb-capped. */
  attempts?: number | null;
  /** Free-text notes to the LLM (real id to try, enum value to use, …). */
  notes?: string | null;
}

/**
 * Deterministic values the system already holds for this endpoint (2026-08-08
 * budget fix): Pass A's DB-mined ids per table, the session's harvested id
 * pool, and the candidates Pass A already fired WITHOUT success. Seeded into
 * the directive so the LLM starts with real values instead of spending its
 * research rediscovering them — and never repeats a known-failed candidate.
 */
export interface RepairSeed {
  /** table → sampled id-ish values Pass A mined from the source DB. */
  minedIdsByTable?: Record<string, ReadonlyArray<string>>;
  /** Identifier values harvested anywhere in the session. */
  sessionIdPool?: ReadonlyArray<string>;
  /** Concrete candidates Pass A fired that did NOT produce a 2xx. */
  triedAndFailed?: ReadonlyArray<{ path: string; status: number | null }>;
}

/** Cap the values rendered per seed list so the directive stays compact. */
const SEED_VALUES_CAP = 15;

/** The composed, budget-clamped repair plan for one endpoint. */
export interface RepairDirective {
  operation_id: string;
  method: string;
  path: string;
  failure_mode: FailureMode;
  is_mutating: boolean;
  /** Clamped, verb-capped attempt budget the loop must honour. */
  attempts: number;
  /** The repair instruction handed to the LLM (playbook + diagnosis + notes). */
  directive: string;
}

/** Classify the failure mode from the last status + distilled error. Pure. */
export function classifyFailureMode(
  lastStatus: number | null,
  errorSummary: string | null,
): FailureMode {
  if (lastStatus === null) return 'transport';
  if (lastStatus === 404) return 'missing_id';
  if (lastStatus === 409) return 'sequencing';
  if (lastStatus === 401 || lastStatus === 403) return 'auth';
  if (lastStatus === 400 || lastStatus === 422) return 'bad_request';
  if (lastStatus >= 500) return 'server_error';
  // A 2xx that still failed to score, or a 3xx — treat as bad_request-ish so the
  // LLM re-reads the contract; a sequencing hint in the error refines it.
  if (errorSummary && /order|sequence|exist|conflict|state/i.test(errorSummary)) {
    return 'sequencing';
  }
  return 'unknown';
}

const PLAYBOOK: Record<FailureMode, string> = {
  missing_id:
    'The request 404d — the path identifier does not resolve. Obtain a REAL id: ' +
    'reuse an id already seen in this session, sample the source database for a ' +
    'live value, or fetch a list endpoint first and take an id from its response.',
  bad_request:
    'The request was rejected as malformed (400/422). Read the error body and the ' +
    'code-derived request contract, then fix the request SHAPE — required fields, ' +
    'types, enum values, and content-type — rather than re-firing the same body. ' +
    'If the contract does not explain the rejection, read the SOURCE CODE: ' +
    'search_source_files finds the handler/validator/DTO files and ' +
    'get_source_file returns their contents — validation rules often live only ' +
    'in code.',
  auth:
    'The request was rejected for authorization (401/403). The happy path needs ' +
    'sufficient scope: supply the correct token/scope for this operation; do not ' +
    'treat this as the auth-negative dimension.',
  sequencing:
    'The request needs prior state (409 / dependency). Build a create-then-act ' +
    'chain: create or locate the prerequisite resource first, then act on it — ' +
    'do not blindly re-fire the terminal call.',
  server_error:
    'The system returned 5xx. Confirm the request is well-formed; if the endpoint ' +
    'genuinely errors on valid input, it is a candidate for exclude-with-reason ' +
    'rather than endless retry.',
  transport:
    'No response was received (transport failure/timeout). Re-check the base URL, ' +
    'connectivity, and any TLS/host settings before retrying.',
  unknown:
    'The happy-path baseline was not captured. Re-read the operation contract and ' +
    'the last error, then adjust the request to elicit a successful response.',
};

/**
 * Compose the repair directive + clamped budget for one endpoint. Pure.
 *
 * - budget: requested attempts clamped to [1, MAX]; default 15; mutating verbs
 *   capped at MUTATING_ATTEMPTS_CAP.
 * - directive: the failure-mode playbook + the persisted diagnosis (last status,
 *   error, request) + the operator's verbatim notes (highest-signal, so last).
 */
export function buildRepairDirective(
  diag: EndpointDiagnosis,
  config?: RepairConfig | null,
  seed?: RepairSeed | null,
): RepairDirective {
  const mode = classifyFailureMode(diag.last_status, diag.last_error_summary ?? null);
  const mutating = isMutatingVerb(diag.method);

  const requested =
    config && typeof config.attempts === 'number' && Number.isFinite(config.attempts)
      ? Math.floor(config.attempts)
      : DEFAULT_REPAIR_ATTEMPTS;
  let attempts = Math.max(1, Math.min(MAX_REPAIR_ATTEMPTS, requested));
  if (mutating) attempts = Math.min(attempts, MUTATING_ATTEMPTS_CAP);

  const lines: string[] = [];
  lines.push(`Repair the happy-path baseline for ${diag.method.toUpperCase()} ${diag.path}.`);
  lines.push(
    `Budget: ${attempts} request(s) fired at this target operation. Research is ` +
      'FREE and does not consume the budget — read the contract ' +
      '(get_oas_operation_detail), sample the database (list_db_metadata / ' +
      'sample_db_values / run_readonly_sql), read the application source ' +
      '(search_source_files / get_source_file), and call OTHER endpoints ' +
      '(list fetches, prerequisite creates) as needed. Spend the budget on ' +
      'CORRECTED requests, never on blind re-fires.',
  );
  lines.push(PLAYBOOK[mode]);
  const lastStatus =
    diag.last_status === null ? 'transport failure (no response)' : String(diag.last_status);
  lines.push(`Last attempt: status ${lastStatus}.`);
  if (diag.last_request_summary) lines.push(`Last request: ${diag.last_request_summary}`);
  if (diag.last_error_summary) lines.push(`Last error: ${diag.last_error_summary}`);
  if (mutating) {
    lines.push(
      'This is a mutating operation: prefer a create-then-act chain and keep ' +
        'side effects minimal; do not re-fire blindly.',
    );
  }

  // ---- Deterministic seeds (2026-08-08): hand over what the system already
  // knows so the LLM starts from real values, not rediscovery.
  const minedEntries = Object.entries(seed?.minedIdsByTable ?? {}).filter(
    ([, values]) => values.length > 0,
  );
  for (const [table, values] of minedEntries) {
    lines.push(
      `Real values already mined from source table ${table}: ` +
        `${values.slice(0, SEED_VALUES_CAP).join(', ')}. Try these before sampling further.`,
    );
  }
  const pool = (seed?.sessionIdPool ?? []).slice(0, SEED_VALUES_CAP);
  if (pool.length > 0) {
    lines.push(`Identifier values already seen in this session: ${pool.join(', ')}.`);
  }
  const tried = (seed?.triedAndFailed ?? []).slice(0, SEED_VALUES_CAP);
  if (tried.length > 0) {
    lines.push(
      'Already tried WITHOUT success (do NOT repeat these): ' +
        tried
          .map((t) => `${t.path} -> ${t.status === null ? 'no response' : t.status}`)
          .join('; ') +
        '.',
    );
  }

  const notes = (config?.notes ?? '').trim();
  if (notes) lines.push(`Operator hint (follow this): ${notes}`);

  return {
    operation_id: diag.operation_id,
    method: diag.method,
    path: diag.path,
    failure_mode: mode,
    is_mutating: mutating,
    attempts,
    directive: lines.join('\n'),
  };
}
