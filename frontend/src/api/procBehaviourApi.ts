/**
 * Proc Behaviour API client (Stored Proc & Function Behaviour Program,
 * Spec 3 — "Proc Behaviour Capture", 2026-09-09).
 *
 * The SECOND behaviour-baseline kind beside the API behaviour baseline. It is
 * DB-NATIVE and INDEPENDENT of the API capture path (design doc doctrine
 * "DB-native, independent of the API path"): no base URL, no OAS, no API auth,
 * no API session — only the DB credential block. Every call goes through the
 * gateway under
 *
 *   ${GATEWAY_BASE}/api/v1/projects/{projectId}/architectures/{architectureId}
 *
 * with two families behind it:
 *   - AMS data plane (passthrough proxies): `db-routines`,
 *     `proc-behaviour/capture-sessions`, `.../scenarios`, `.../captures`,
 *     `.../diagnostics`, `proc-behaviour/baselines`, `.../items`, `.../pin`.
 *   - AMVS actions (POST): `.../secrets`, `/start`, `/status`, `/cancel`,
 *     `/retry-uncovered`, `/exclude-routine`, `/not-possible`,
 *     `/save-baseline`.
 *
 * Wire is snake_case (AMS Jackson SNAKE_CASE global, see repo CLAUDE.md); the
 * public types here are camelCase. Every field is read through the
 * dual-accept `coerce(snake, camel)` idiom borrowed from
 * `epicCapturedDecisionsApi.ts` so a future naming-strategy flip — or an AMVS
 * route that answers in idiomatic camelCase — cannot break this client.
 * Request bodies are written snake_case exactly as the spec's wire contract
 * states.
 */
import type { DbEngineKey } from './dbEngines';

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Typed error
// ============================================================================

export interface ProcBehaviourErrorBody {
  code?: string | number;
  error?: string;
  message?: string;
  details?: string;
  [k: string]: unknown;
}

/**
 * Thrown on any non-2xx. Callers branch on `status` + `body.code` (the 409
 * start guards: SECRETS_NOT_LOADED | S0_NOT_PINNED | NO_ROUTINES |
 * RUN_IN_FLIGHT | DB_NOT_CONFIGURED).
 */
export class ProcBehaviourApiError extends Error {
  readonly status: number;
  readonly body: ProcBehaviourErrorBody;

  constructor(status: number, body: ProcBehaviourErrorBody, message?: string) {
    super(
      message ??
        body.message ??
        body.error ??
        `Proc behaviour API error (status ${status})`,
    );
    this.name = 'ProcBehaviourApiError';
    this.status = status;
    this.body = body;
  }

  /** The server's machine code, upper-cased, when one was carried. */
  get code(): string | null {
    return typeof this.body.code === 'string' ? this.body.code.toUpperCase() : null;
  }
}

async function parseErrorBody(res: Response): Promise<ProcBehaviourErrorBody> {
  try {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const parsed = (await res.json()) as unknown;
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        const wrapped = obj.error;
        // `{ error: { code, message } }` and `{ error: 'text', code }` are both
        // in the wild; the second must keep the sibling `code`.
        if (wrapped && typeof wrapped === 'object') {
          return { ...(wrapped as ProcBehaviourErrorBody), code: (wrapped as ProcBehaviourErrorBody).code ?? (obj.code as string | undefined) };
        }
        return obj as ProcBehaviourErrorBody;
      }
      return { message: res.statusText };
    }
    const text = await res.text();
    return { message: text || res.statusText };
  } catch {
    return { message: res.statusText };
  }
}

// ============================================================================
// Dual-accept helpers
// ============================================================================

type Wire = Record<string, unknown>;

function asRecord(v: unknown): Wire | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Wire) : null;
}

/** First non-null/undefined candidate, else null. */
function coerce<T>(...candidates: Array<T | null | undefined>): T | null {
  for (const c of candidates) {
    if (c !== undefined && c !== null) return c as T;
  }
  return null;
}

function pick(w: Wire, snake: string, camel: string): unknown {
  return coerce(w[snake], w[camel]);
}

function str(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

function bool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return fallback;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Defensive string list. Closures and construct lists arrive either as plain
 * strings or as `{ name | table | table_name }` objects depending on the
 * producer; both render as a table name here rather than `[object Object]`.
 */
function strList(v: unknown): string[] {
  return arr(v)
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      const rec = asRecord(entry);
      if (!rec) return null;
      return (
        str(pick(rec, 'table_name', 'tableName')) ??
        str(rec.table) ??
        str(rec.name) ??
        null
      );
    })
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
}

// ============================================================================
// Routine catalog
// ============================================================================

export type ProcRoutineKind = 'procedure' | 'function' | 'trigger';

export interface RoutineParam {
  name: string;
  ordinal: number;
  sourceType: string | null;
  direction: 'in' | 'output';
  defaultLiteral: string | null;
}

/**
 * Static profile produced by the DB scan's T-SQL profiler (Spec 1). Only the
 * fields the UI reasons about are typed; `raw` keeps the whole blob so nothing
 * is lost.
 */
export interface RoutineProfile {
  maxResultSets: number | null;
  returnSites: unknown[];
  raiserrorSites: unknown[];
  constructs: string[];
  volatileFunctions: string[];
  /**
   * Non-empty ⇒ the routine fails closed BEFORE any fire (xp_/system procs,
   * remote 4-part calls, cross-database DML, dynamic SQL with no static write
   * set, WAITFOR). Rendered as the `non-compensatable` flag in the wizard.
   */
  nonCompensatableReasons: string[];
  raw: Wire;
}

export interface RoutineCatalogRow {
  id: string;
  schemaName: string;
  routineName: string;
  routineKind: ProcRoutineKind;
  params: RoutineParam[];
  returnsType: string | null;
  profile: RoutineProfile;
  readsClosure: string[];
  writesClosure: string[];
  /** false ⇒ the signature could not be parsed; surfaced as a flag. */
  signatureParsed: boolean;
  bodyHash: string | null;
  fullBody: string | null;
}

function mapParam(v: unknown, index: number): RoutineParam {
  const w = asRecord(v) ?? {};
  const direction = (str(w.direction) ?? 'in').toLowerCase();
  return {
    name: str(w.name) ?? `@p${index + 1}`,
    ordinal: num(w.ordinal) ?? index + 1,
    sourceType: str(pick(w, 'source_type', 'sourceType')),
    direction: direction === 'output' || direction === 'out' ? 'output' : 'in',
    defaultLiteral: str(pick(w, 'default_literal', 'defaultLiteral')),
  };
}

function mapProfile(v: unknown): RoutineProfile {
  const w = asRecord(v) ?? {};
  return {
    maxResultSets: num(pick(w, 'max_result_sets', 'maxResultSets')),
    returnSites: arr(pick(w, 'return_sites', 'returnSites')),
    raiserrorSites: arr(pick(w, 'raiserror_sites', 'raiserrorSites')),
    constructs: strList(w.constructs),
    volatileFunctions: strList(pick(w, 'volatile_functions', 'volatileFunctions')),
    nonCompensatableReasons: strList(
      pick(w, 'non_compensatable_reasons', 'nonCompensatableReasons'),
    ),
    raw: w,
  };
}

export function mapRoutine(v: unknown): RoutineCatalogRow {
  const w = asRecord(v) ?? {};
  const kind = (str(pick(w, 'routine_kind', 'routineKind')) ?? 'procedure').toLowerCase();
  return {
    id: str(w.id) ?? '',
    schemaName: str(pick(w, 'schema_name', 'schemaName')) ?? '',
    routineName: str(pick(w, 'routine_name', 'routineName')) ?? '',
    routineKind: (kind === 'function' || kind === 'trigger'
      ? kind
      : 'procedure') as ProcRoutineKind,
    params: arr(pick(w, 'params_json', 'paramsJson')).map(mapParam),
    returnsType: str(pick(w, 'returns_type', 'returnsType')),
    profile: mapProfile(pick(w, 'profile_json', 'profileJson')),
    readsClosure: strList(pick(w, 'reads_closure_json', 'readsClosureJson')),
    writesClosure: strList(pick(w, 'writes_closure_json', 'writesClosureJson')),
    signatureParsed: bool(pick(w, 'signature_parsed', 'signatureParsed'), true),
    bodyHash: str(pick(w, 'body_hash', 'bodyHash')),
    fullBody: str(pick(w, 'full_body', 'fullBody')),
  };
}

/** `schema.name` for display; falls back to the bare name when unschema'd. */
export function routineLabel(r: {
  schemaName: string;
  routineName: string;
}): string {
  return r.schemaName ? `${r.schemaName}.${r.routineName}` : r.routineName;
}

// ============================================================================
// Capture session
// ============================================================================

export type ProcCaptureSessionStatus =
  | 'draft'
  | 'configured'
  | 'running'
  | 'completed'
  | 'completed_with_findings'
  | 'failed'
  | 'cancelled';

export type ProcCaptureSessionKind = 'current' | 'target';

/** Every routine ends in exactly one bucket (design decision 5). */
export type ProcRoutineBucket =
  | 'verified'
  | 'not_exercised'
  | 'unverifiable'
  | 'excluded';

export interface ProcRoutineCoverage {
  routineId: string;
  routineName: string;
  bucket: ProcRoutineBucket;
  required: string[];
  achieved: string[];
  missing: string[];
  floorMet: boolean;
  scenariosFired: number;
  capturesAccepted: number;
  unverifiableReason: string | null;
}

export interface ProcCoverageSummary {
  routinesInScope: number;
  verified: number;
  notExercised: number;
  unverifiable: number;
  excluded: number;
  perRoutine: ProcRoutineCoverage[];
  computedAt: string | null;
}

export interface ProcCaptureTuning {
  attemptsPerScenario: number | null;
  maxRowsPerResultSet: number | null;
  invocationTimeoutSeconds: number | null;
  quietWindowSeconds: number | null;
}

export interface ProcDbConfigRedacted {
  dbType: DbEngineKey;
  host: string;
  port: number | null;
  database: string;
  schema?: string | null;
  username: string;
  maxRowsPerQuery?: number | null;
  queryTimeoutSeconds?: number | null;
}

export interface ProcCaptureSession {
  id: string;
  projectId: string;
  architectureId: string;
  name: string;
  status: ProcCaptureSessionStatus;
  kind: ProcCaptureSessionKind;
  scopeRoutineIds: string[];
  dbConfigRedacted: Wire | null;
  captureTuning: ProcCaptureTuning | null;
  coverageSummary: ProcCoverageSummary | null;
  s0Fingerprint: Wire | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
}

function mapRoutineCoverage(v: unknown): ProcRoutineCoverage {
  const w = asRecord(v) ?? {};
  const bucket = (str(w.bucket) ?? 'not_exercised').toLowerCase();
  const known: ProcRoutineBucket[] = [
    'verified',
    'not_exercised',
    'unverifiable',
    'excluded',
  ];
  return {
    routineId: str(pick(w, 'routine_id', 'routineId')) ?? '',
    routineName: str(pick(w, 'routine_name', 'routineName')) ?? '',
    bucket: (known.includes(bucket as ProcRoutineBucket)
      ? bucket
      : 'not_exercised') as ProcRoutineBucket,
    required: strList(w.required),
    achieved: strList(w.achieved),
    missing: strList(w.missing),
    floorMet: bool(pick(w, 'floor_met', 'floorMet')),
    scenariosFired: num(pick(w, 'scenarios_fired', 'scenariosFired')) ?? 0,
    capturesAccepted: num(pick(w, 'captures_accepted', 'capturesAccepted')) ?? 0,
    unverifiableReason: str(pick(w, 'unverifiable_reason', 'unverifiableReason')),
  };
}

export function mapCoverageSummary(v: unknown): ProcCoverageSummary | null {
  const w = asRecord(v);
  if (!w) return null;
  return {
    routinesInScope: num(pick(w, 'routines_in_scope', 'routinesInScope')) ?? 0,
    verified: num(w.verified) ?? 0,
    notExercised: num(pick(w, 'not_exercised', 'notExercised')) ?? 0,
    unverifiable: num(w.unverifiable) ?? 0,
    excluded: num(w.excluded) ?? 0,
    perRoutine: arr(pick(w, 'per_routine', 'perRoutine')).map(mapRoutineCoverage),
    computedAt: str(pick(w, 'computed_at', 'computedAt')),
  };
}

function mapTuning(v: unknown): ProcCaptureTuning | null {
  const w = asRecord(v);
  if (!w) return null;
  return {
    attemptsPerScenario: num(pick(w, 'attempts_per_scenario', 'attemptsPerScenario')),
    maxRowsPerResultSet: num(pick(w, 'max_rows_per_result_set', 'maxRowsPerResultSet')),
    invocationTimeoutSeconds: num(
      pick(w, 'invocation_timeout_seconds', 'invocationTimeoutSeconds'),
    ),
    quietWindowSeconds: num(pick(w, 'quiet_window_seconds', 'quietWindowSeconds')),
  };
}

export function mapSession(v: unknown): ProcCaptureSession {
  const w = asRecord(v) ?? {};
  return {
    id: str(w.id) ?? '',
    projectId: str(pick(w, 'project_id', 'projectId')) ?? '',
    architectureId: str(pick(w, 'architecture_id', 'architectureId')) ?? '',
    name: str(w.name) ?? '',
    status: (str(w.status) ?? 'draft') as ProcCaptureSessionStatus,
    kind: (str(w.kind) ?? 'current') as ProcCaptureSessionKind,
    scopeRoutineIds: strList(pick(w, 'scope_routine_ids_json', 'scopeRoutineIdsJson')),
    dbConfigRedacted: asRecord(pick(w, 'db_config_redacted_json', 'dbConfigRedactedJson')),
    captureTuning: mapTuning(pick(w, 'capture_tuning_json', 'captureTuningJson')),
    coverageSummary: mapCoverageSummary(
      pick(w, 'coverage_summary_json', 'coverageSummaryJson'),
    ),
    s0Fingerprint: asRecord(pick(w, 's0_fingerprint_json', 's0FingerprintJson')),
    startedAt: str(pick(w, 'started_at', 'startedAt')),
    completedAt: str(pick(w, 'completed_at', 'completedAt')),
    createdAt: str(pick(w, 'created_at', 'createdAt')),
  };
}

// ============================================================================
// Scenarios / captures / diagnostics
// ============================================================================

export type ProcScenarioStatus = 'proposed' | 'fired' | 'excluded';

export interface ProcScenarioInput {
  name: string;
  value: unknown;
  isNull: boolean;
}

export interface ProcScenario {
  id: string;
  routineId: string;
  scenarioName: string;
  scenarioType: string;
  generationSource: string | null;
  inputs: ProcScenarioInput[];
  sequence: unknown[] | null;
  status: ProcScenarioStatus;
  notes: string | null;
}

function mapScenarioInput(v: unknown): ProcScenarioInput {
  const w = asRecord(v) ?? {};
  return {
    name: str(w.name) ?? '',
    value: w.value ?? null,
    isNull: bool(pick(w, 'is_null', 'isNull')),
  };
}

export function mapScenario(v: unknown): ProcScenario {
  const w = asRecord(v) ?? {};
  const seq = pick(w, 'sequence_json', 'sequenceJson');
  return {
    id: str(w.id) ?? '',
    routineId: str(pick(w, 'routine_id', 'routineId')) ?? '',
    scenarioName: str(pick(w, 'scenario_name', 'scenarioName')) ?? '',
    scenarioType: str(pick(w, 'scenario_type', 'scenarioType')) ?? 'happy_path',
    generationSource: str(pick(w, 'generation_source', 'generationSource')),
    inputs: arr(pick(w, 'inputs_json', 'inputsJson')).map(mapScenarioInput),
    sequence: Array.isArray(seq) ? seq : null,
    status: (str(w.status) ?? 'proposed') as ProcScenarioStatus,
    notes: str(w.notes),
  };
}

export interface ProcResultSetColumn {
  name: string;
  type: string | null;
}

export interface ProcResultSet {
  ordinal: number;
  columns: ProcResultSetColumn[];
  rows: unknown[][];
  rowCount: number | null;
  truncated: boolean;
}

export interface ProcMessage {
  kind: string | null;
  number: number | null;
  severity: number | null;
  state: number | null;
  text: string;
}

export interface ProcError {
  number: number | null;
  sqlstate: string | null;
  severity: number | null;
  state: number | null;
  message: string;
}

/**
 * The five-dimension routine envelope (doctrine: return status, OUTPUT
 * params, ordered result sets, messages/errors, and — carried beside it on
 * the capture — the state delta). A SEQUENCE envelope carries `steps` and
 * leaves the scalar fields empty.
 */
export interface ProcEnvelope {
  outcome: 'success' | 'error';
  returnStatus: number | null;
  outputParams: Record<string, unknown>;
  resultSets: ProcResultSet[];
  updateCounts: number[];
  messages: ProcMessage[];
  error: ProcError | null;
  timingMs: number | null;
  sessionLogin: string | null;
  sessionSetOptions: string[];
  /** Non-null for sequence scenarios: one envelope per ordered step. */
  steps: ProcEnvelope[] | null;
}

function mapResultSet(v: unknown, index: number): ProcResultSet {
  const w = asRecord(v) ?? {};
  const rows = arr(w.rows).map((r) => (Array.isArray(r) ? (r as unknown[]) : [r]));
  return {
    ordinal: num(w.ordinal) ?? index,
    columns: arr(w.columns).map((c) => {
      const cw = asRecord(c);
      if (!cw) return { name: str(c) ?? '', type: null };
      return { name: str(cw.name) ?? '', type: str(cw.type) };
    }),
    rows,
    rowCount: num(pick(w, 'row_count', 'rowCount')) ?? rows.length,
    truncated: bool(w.truncated),
  };
}

export function mapEnvelope(v: unknown): ProcEnvelope | null {
  const w = asRecord(v);
  if (!w) return null;
  const rawSteps = w.steps;
  const steps = Array.isArray(rawSteps)
    ? rawSteps
        .map((s) => mapEnvelope(s))
        .filter((s): s is ProcEnvelope => s !== null)
    : null;
  const errW = asRecord(w.error);
  const sessionW = asRecord(w.session);
  return {
    outcome: (str(w.outcome) ?? (errW ? 'error' : 'success')) === 'error'
      ? 'error'
      : 'success',
    returnStatus: num(pick(w, 'return_status', 'returnStatus')),
    outputParams: asRecord(pick(w, 'output_params', 'outputParams')) ?? {},
    resultSets: arr(pick(w, 'result_sets', 'resultSets')).map(mapResultSet),
    updateCounts: arr(pick(w, 'update_counts', 'updateCounts'))
      .map((n) => num(n))
      .filter((n): n is number => n !== null),
    messages: arr(w.messages).map((m) => {
      const mw = asRecord(m) ?? {};
      return {
        kind: str(mw.kind),
        number: num(mw.number),
        severity: num(mw.severity),
        state: num(mw.state),
        text: str(mw.text) ?? '',
      };
    }),
    error: errW
      ? {
          number: num(errW.number),
          sqlstate: str(errW.sqlstate),
          severity: num(errW.severity),
          state: num(errW.state),
          message: str(errW.message) ?? '',
        }
      : null,
    timingMs: num(pick(w, 'timing_ms', 'timingMs')),
    sessionLogin: sessionW ? str(sessionW.login) : null,
    sessionSetOptions: sessionW
      ? strList(pick(sessionW, 'set_options', 'setOptions'))
      : [],
    steps: steps && steps.length > 0 ? steps : null,
  };
}

export interface ProcCapture {
  id: string;
  scenarioId: string;
  routineId: string;
  attemptNumber: number | null;
  envelope: ProcEnvelope | null;
  stateDelta: Wire | null;
  volatileCells: unknown[];
  bracketOutcome: string | null;
  durationMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
  accepted: boolean;
  capturedAt: string | null;
}

export function mapCapture(v: unknown): ProcCapture {
  const w = asRecord(v) ?? {};
  const volatile = pick(w, 'volatile_cells_json', 'volatileCellsJson');
  return {
    id: str(w.id) ?? '',
    scenarioId: str(pick(w, 'scenario_id', 'scenarioId')) ?? '',
    routineId: str(pick(w, 'routine_id', 'routineId')) ?? '',
    attemptNumber: num(pick(w, 'attempt_number', 'attemptNumber')),
    envelope: mapEnvelope(pick(w, 'envelope_json', 'envelopeJson')),
    stateDelta: asRecord(pick(w, 'state_delta_json', 'stateDeltaJson')),
    volatileCells: Array.isArray(volatile)
      ? volatile
      : asRecord(volatile)
      ? Object.entries(asRecord(volatile) as Wire).map(([k, val]) => ({ cell: k, value: val }))
      : [],
    bracketOutcome: str(pick(w, 'bracket_outcome', 'bracketOutcome')),
    durationMs: num(pick(w, 'duration_ms', 'durationMs')),
    errorType: str(pick(w, 'error_type', 'errorType')),
    errorMessage: str(pick(w, 'error_message', 'errorMessage')),
    accepted: bool(w.accepted),
    capturedAt: str(pick(w, 'captured_at', 'capturedAt')),
  };
}

export interface ProcDiagnostic {
  id: string;
  routineId: string | null;
  diagnosticType: string;
  message: string;
  detail: Wire | null;
  createdAt: string | null;
}

export function mapDiagnostic(v: unknown): ProcDiagnostic {
  const w = asRecord(v) ?? {};
  return {
    id: str(w.id) ?? '',
    routineId: str(pick(w, 'routine_id', 'routineId')),
    diagnosticType: str(pick(w, 'diagnostic_type', 'diagnosticType')) ?? 'unknown',
    message: str(w.message) ?? '',
    detail: asRecord(pick(w, 'detail_json', 'detailJson')),
    createdAt: str(pick(w, 'created_at', 'createdAt')),
  };
}

/**
 * Defensive per-table roll-up of the opaque `state_delta_json`. Renders as
 * "table: n" chips; a shape we do not recognise contributes its own key with
 * a null count rather than throwing or printing `[object Object]`.
 */
export function summariseStateDelta(
  delta: Wire | null,
): Array<{ label: string; count: number | null }> {
  if (!delta) return [];
  return Object.entries(delta).map(([label, value]) => {
    if (Array.isArray(value)) return { label, count: value.length };
    const n = num(value);
    if (n !== null) return { label, count: n };
    const rec = asRecord(value);
    if (rec) {
      const direct = num(pick(rec, 'row_count', 'rowCount')) ?? num(rec.rows);
      if (direct !== null) return { label, count: direct };
      const summed = ['inserted', 'updated', 'deleted']
        .map((k) => num(rec[k]))
        .filter((x): x is number => x !== null);
      if (summed.length > 0) {
        return { label, count: summed.reduce((a, b) => a + b, 0) };
      }
    }
    return { label, count: null };
  });
}

// ============================================================================
// Baselines
// ============================================================================

export type ProcBaselineStatus = 'draft' | 'pinned' | 'superseded';

export interface ProcBaseline {
  id: string;
  sessionId: string | null;
  name: string;
  status: ProcBaselineStatus;
  kind: ProcCaptureSessionKind;
  routineCount: number | null;
  scenarioCount: number | null;
  contentHash: string | null;
  s0Fingerprint: Wire | null;
  pinnedAt: string | null;
  createdAt: string | null;
}

export function mapBaseline(v: unknown): ProcBaseline {
  const w = asRecord(v) ?? {};
  return {
    id: str(w.id) ?? '',
    sessionId: str(pick(w, 'session_id', 'sessionId')),
    name: str(w.name) ?? '',
    status: (str(w.status) ?? 'draft') as ProcBaselineStatus,
    kind: (str(w.kind) ?? 'current') as ProcCaptureSessionKind,
    routineCount: num(pick(w, 'routine_count', 'routineCount')),
    scenarioCount: num(pick(w, 'scenario_count', 'scenarioCount')),
    contentHash: str(pick(w, 'content_hash', 'contentHash')),
    s0Fingerprint: asRecord(pick(w, 's0_fingerprint_json', 's0FingerprintJson')),
    pinnedAt: str(pick(w, 'pinned_at', 'pinnedAt')),
    createdAt: str(pick(w, 'created_at', 'createdAt')),
  };
}

export interface ProcBaselineItem {
  id: string;
  routineId: string;
  routineBodyHash: string | null;
  scenarioName: string;
  scenarioType: string;
  exitOutcome: string | null;
  inputs: ProcScenarioInput[];
  sequence: unknown[] | null;
  expectedEnvelope: ProcEnvelope | null;
  stateDelta: Wire | null;
  volatileCells: unknown[];
  stale: boolean;
  staleReason: string | null;
}

export function mapBaselineItem(v: unknown): ProcBaselineItem {
  const w = asRecord(v) ?? {};
  const seq = pick(w, 'sequence_json', 'sequenceJson');
  const volatile = pick(w, 'volatile_cells_json', 'volatileCellsJson');
  return {
    id: str(w.id) ?? '',
    routineId: str(pick(w, 'routine_id', 'routineId')) ?? '',
    routineBodyHash: str(pick(w, 'routine_body_hash', 'routineBodyHash')),
    scenarioName: str(pick(w, 'scenario_name', 'scenarioName')) ?? '',
    scenarioType: str(pick(w, 'scenario_type', 'scenarioType')) ?? '',
    exitOutcome: str(pick(w, 'exit_outcome', 'exitOutcome')),
    inputs: arr(pick(w, 'inputs_json', 'inputsJson')).map(mapScenarioInput),
    sequence: Array.isArray(seq) ? seq : null,
    expectedEnvelope: mapEnvelope(
      pick(w, 'expected_envelope_json', 'expectedEnvelopeJson'),
    ),
    stateDelta: asRecord(pick(w, 'state_delta_json', 'stateDeltaJson')),
    volatileCells: Array.isArray(volatile) ? volatile : [],
    stale: bool(w.stale),
    staleReason: str(pick(w, 'stale_reason', 'staleReason')),
  };
}

// ============================================================================
// Run status
// ============================================================================

export interface ProcRunProgress {
  inFlight: boolean;
  phase: string | null;
  routineIndex: number | null;
  routineTotal: number | null;
  scenariosFired: number | null;
  capturesAccepted: number | null;
  findings: number | null;
  startedAt: string | null;
}

export interface ProcCaptureStatus {
  session: ProcCaptureSession | null;
  run: ProcRunProgress;
  secretsLoaded: boolean;
  s0Pinned: boolean;
}

function mapRun(v: unknown): ProcRunProgress {
  const w = asRecord(v) ?? {};
  return {
    inFlight: bool(pick(w, 'in_flight', 'inFlight')),
    phase: str(w.phase),
    routineIndex: num(pick(w, 'routine_index', 'routineIndex')),
    routineTotal: num(pick(w, 'routine_total', 'routineTotal')),
    scenariosFired: num(pick(w, 'scenarios_fired', 'scenariosFired')),
    capturesAccepted: num(pick(w, 'captures_accepted', 'capturesAccepted')),
    findings: num(w.findings),
    startedAt: str(pick(w, 'started_at', 'startedAt')),
  };
}

export function mapStatus(v: unknown): ProcCaptureStatus {
  const w = asRecord(v) ?? {};
  const sessionW = asRecord(w.session);
  return {
    session: sessionW ? mapSession(sessionW) : null,
    run: mapRun(w.run),
    secretsLoaded: bool(pick(w, 'secrets_loaded', 'secretsLoaded')),
    s0Pinned: bool(pick(w, 's0_pinned', 's0Pinned')),
  };
}

// ============================================================================
// URL building + transport
// ============================================================================

function archBase(projectId: string, architectureId: string): string {
  return (
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}`
  );
}

function procUrl(
  projectId: string,
  architectureId: string,
  path: string,
): string {
  return `${archBase(projectId, architectureId)}/proc-behaviour/${path}`;
}

function sessionActionUrl(
  projectId: string,
  architectureId: string,
  sessionId: string,
  action: string,
): string {
  return procUrl(
    projectId,
    architectureId,
    `capture-sessions/${encodeURIComponent(sessionId)}/${action}`,
  );
}

async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  // `no-store`: every proc-behaviour resource is live run state (session
  // status, scenario tallies, captures) — a cached GET renders a stale run.
  const res = await fetch(url, { cache: 'no-store', ...init });
  if (!res.ok) {
    throw new ProcBehaviourApiError(res.status, await parseErrorBody(res));
  }
  if (res.status === 204) return undefined as unknown as T;
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return undefined as unknown as T;
  }
  return (await res.json()) as T;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function getJson<T>(url: string): Promise<T> {
  return jsonRequest<T>(url, { method: 'GET' });
}

function postJson<T>(url: string, body?: unknown): Promise<T> {
  return jsonRequest<T>(url, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body ?? {}),
  });
}

// ============================================================================
// Routine catalog
// ============================================================================

export async function listDbRoutines(
  projectId: string,
  architectureId: string,
  opts?: { kind?: ProcRoutineKind },
): Promise<RoutineCatalogRow[]> {
  const qs = opts?.kind ? `?kind=${encodeURIComponent(opts.kind)}` : '';
  const raw = await getJson<unknown>(
    `${archBase(projectId, architectureId)}/db-routines${qs}`,
  );
  return arr(raw).map(mapRoutine);
}

// ============================================================================
// Capture sessions (AMS data plane)
// ============================================================================

export interface CreateProcCaptureSessionRequest {
  name: string;
  kind?: ProcCaptureSessionKind;
  scopeRoutineIds: string[];
  dbConfigRedacted: ProcDbConfigRedacted;
  captureTuning?: {
    attemptsPerScenario?: number;
    maxRowsPerResultSet?: number;
    invocationTimeoutSeconds?: number;
    quietWindowSeconds?: number;
  };
}

export async function createProcCaptureSession(
  projectId: string,
  architectureId: string,
  req: CreateProcCaptureSessionRequest,
): Promise<ProcCaptureSession> {
  const body: Wire = {
    name: req.name,
    kind: req.kind ?? 'current',
    scope_routine_ids_json: req.scopeRoutineIds,
    db_config_redacted_json: req.dbConfigRedacted,
  };
  if (req.captureTuning) {
    body.capture_tuning_json = {
      attempts_per_scenario: req.captureTuning.attemptsPerScenario,
      max_rows_per_result_set: req.captureTuning.maxRowsPerResultSet,
      invocation_timeout_seconds: req.captureTuning.invocationTimeoutSeconds,
      quiet_window_seconds: req.captureTuning.quietWindowSeconds,
    };
  }
  const raw = await postJson<unknown>(
    procUrl(projectId, architectureId, 'capture-sessions'),
    body,
  );
  return mapSession(raw);
}

export async function listProcCaptureSessions(
  projectId: string,
  architectureId: string,
): Promise<ProcCaptureSession[]> {
  const raw = await getJson<unknown>(
    procUrl(projectId, architectureId, 'capture-sessions'),
  );
  return arr(raw).map(mapSession);
}

export async function getProcCaptureSession(
  projectId: string,
  architectureId: string,
  sessionId: string,
): Promise<ProcCaptureSession> {
  const raw = await getJson<unknown>(
    procUrl(
      projectId,
      architectureId,
      `capture-sessions/${encodeURIComponent(sessionId)}`,
    ),
  );
  return mapSession(raw);
}

export async function updateProcCaptureSession(
  projectId: string,
  architectureId: string,
  sessionId: string,
  patch: Wire,
): Promise<ProcCaptureSession> {
  const raw = await jsonRequest<unknown>(
    procUrl(
      projectId,
      architectureId,
      `capture-sessions/${encodeURIComponent(sessionId)}`,
    ),
    { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) },
  );
  return mapSession(raw);
}

export async function listProcScenarios(
  projectId: string,
  architectureId: string,
  sessionId: string,
): Promise<ProcScenario[]> {
  const raw = await getJson<unknown>(
    sessionActionUrl(projectId, architectureId, sessionId, 'scenarios'),
  );
  return arr(raw).map(mapScenario);
}

export async function listProcCaptures(
  projectId: string,
  architectureId: string,
  sessionId: string,
): Promise<ProcCapture[]> {
  const raw = await getJson<unknown>(
    sessionActionUrl(projectId, architectureId, sessionId, 'captures'),
  );
  return arr(raw).map(mapCapture);
}

export async function listProcDiagnostics(
  projectId: string,
  architectureId: string,
  sessionId: string,
): Promise<ProcDiagnostic[]> {
  const raw = await getJson<unknown>(
    sessionActionUrl(projectId, architectureId, sessionId, 'diagnostics'),
  );
  return arr(raw).map(mapDiagnostic);
}

// ============================================================================
// Baselines (AMS data plane)
// ============================================================================

export async function listProcBaselines(
  projectId: string,
  architectureId: string,
): Promise<ProcBaseline[]> {
  const raw = await getJson<unknown>(
    procUrl(projectId, architectureId, 'baselines'),
  );
  return arr(raw).map(mapBaseline);
}

export async function getProcBaseline(
  projectId: string,
  architectureId: string,
  baselineId: string,
): Promise<ProcBaseline> {
  const raw = await getJson<unknown>(
    procUrl(projectId, architectureId, `baselines/${encodeURIComponent(baselineId)}`),
  );
  return mapBaseline(raw);
}

/**
 * The pinned baseline of a kind, or `null` when none is pinned (the route
 * answers 404 in that case — an expected state, never an error to the UI).
 */
export async function getPinnedProcBaseline(
  projectId: string,
  architectureId: string,
  kind: ProcCaptureSessionKind = 'current',
): Promise<ProcBaseline | null> {
  try {
    const raw = await getJson<unknown>(
      procUrl(
        projectId,
        architectureId,
        `baselines/pinned?kind=${encodeURIComponent(kind)}`,
      ),
    );
    return mapBaseline(raw);
  } catch (err) {
    if (err instanceof ProcBehaviourApiError && err.status === 404) return null;
    throw err;
  }
}

export async function listProcBaselineItems(
  projectId: string,
  architectureId: string,
  baselineId: string,
): Promise<ProcBaselineItem[]> {
  const raw = await getJson<unknown>(
    procUrl(
      projectId,
      architectureId,
      `baselines/${encodeURIComponent(baselineId)}/items`,
    ),
  );
  return arr(raw).map(mapBaselineItem);
}

export async function pinProcBaseline(
  projectId: string,
  architectureId: string,
  baselineId: string,
): Promise<ProcBaseline> {
  const raw = await postJson<unknown>(
    procUrl(
      projectId,
      architectureId,
      `baselines/${encodeURIComponent(baselineId)}/pin`,
    ),
  );
  return mapBaseline(raw);
}

// ============================================================================
// AMVS actions
// ============================================================================

export interface ProcSecretsRequest {
  password: string;
  readonlyUsername?: string | null;
  readonlyPassword?: string | null;
}

export interface ProcSecretsResponse {
  ok: boolean;
  readonlySplit: boolean;
}

/**
 * Post the DB secrets (never persisted redacted-side). Moves the session
 * draft → configured. The readonly pair is both-or-nothing — a lone value is
 * dropped here so the server never silently falls back to the write login.
 */
export async function submitProcSecrets(
  projectId: string,
  architectureId: string,
  sessionId: string,
  secrets: ProcSecretsRequest,
): Promise<ProcSecretsResponse> {
  const db: Wire = { password: secrets.password };
  const roUser = (secrets.readonlyUsername ?? '').trim();
  const roPass = secrets.readonlyPassword ?? '';
  if (roUser && roPass) {
    db.readonly_username = roUser;
    db.readonly_password = roPass;
  }
  const raw = await postJson<unknown>(
    sessionActionUrl(projectId, architectureId, sessionId, 'secrets'),
    { db },
  );
  const w = asRecord(raw) ?? {};
  return {
    ok: bool(w.ok, true),
    readonlySplit: bool(pick(w, 'readonly_split', 'readonlySplit')),
  };
}

export interface ProcStartResponse {
  accepted: boolean;
  routines: number | null;
}

export async function startProcCapture(
  projectId: string,
  architectureId: string,
  sessionId: string,
): Promise<ProcStartResponse> {
  const raw = await postJson<unknown>(
    sessionActionUrl(projectId, architectureId, sessionId, 'start'),
  );
  const w = asRecord(raw) ?? {};
  return { accepted: bool(w.accepted, true), routines: num(w.routines) };
}

export async function getProcCaptureStatus(
  projectId: string,
  architectureId: string,
  sessionId: string,
): Promise<ProcCaptureStatus> {
  const raw = await getJson<unknown>(
    sessionActionUrl(projectId, architectureId, sessionId, 'status'),
  );
  return mapStatus(raw);
}

export async function cancelProcCapture(
  projectId: string,
  architectureId: string,
  sessionId: string,
): Promise<{ cancelled: boolean }> {
  const raw = await postJson<unknown>(
    sessionActionUrl(projectId, architectureId, sessionId, 'cancel'),
  );
  const w = asRecord(raw) ?? {};
  return { cancelled: bool(w.cancelled, true) };
}

export async function retryUncoveredRoutines(
  projectId: string,
  architectureId: string,
  sessionId: string,
  routineIds: string[],
): Promise<{ accepted: boolean }> {
  const raw = await postJson<unknown>(
    sessionActionUrl(projectId, architectureId, sessionId, 'retry-uncovered'),
    { routine_ids: routineIds },
  );
  const w = asRecord(raw) ?? {};
  return { accepted: bool(w.accepted, true) };
}

export async function excludeProcRoutine(
  projectId: string,
  architectureId: string,
  sessionId: string,
  routineId: string,
  reason: string,
): Promise<void> {
  await postJson<unknown>(
    sessionActionUrl(projectId, architectureId, sessionId, 'exclude-routine'),
    { routine_id: routineId, reason },
  );
}

export async function markProcRoutineNotPossible(
  projectId: string,
  architectureId: string,
  sessionId: string,
  routineId: string,
  reason: string,
): Promise<void> {
  await postJson<unknown>(
    sessionActionUrl(projectId, architectureId, sessionId, 'not-possible'),
    { routine_id: routineId, reason },
  );
}

export interface SaveProcBaselineResponse {
  baseline: ProcBaseline;
  items: ProcBaselineItem[];
}

export async function saveProcBaseline(
  projectId: string,
  architectureId: string,
  sessionId: string,
  name: string,
  pin = true,
): Promise<SaveProcBaselineResponse> {
  const raw = await postJson<unknown>(
    sessionActionUrl(projectId, architectureId, sessionId, 'save-baseline'),
    { name, pin },
  );
  const w = asRecord(raw) ?? {};
  return {
    baseline: mapBaseline(w.baseline ?? w),
    items: arr(w.items).map(mapBaselineItem),
  };
}

// ============================================================================
// Readable messages for the server's machine codes
// ============================================================================

/**
 * Turn a thrown client error into a sentence the operator can act on. The
 * 409 guard codes get a next step; anything else falls back to the server's
 * own message (never a bare status code).
 */
export function describeProcError(err: unknown): string {
  if (err instanceof ProcBehaviourApiError) {
    switch (err.code) {
      case 'S0_NOT_PINNED':
        // Since 2026-09-11 the service re-pins S0 from the saved model itself
        // and refuses ONLY when that fails — its sentence then carries the
        // actual reason (nothing committed, DB login failed, ...). Show it;
        // the generic next step is only for a server that gave no reason.
        return err.message.includes('re-pinned')
          ? err.message
          : 'Run the DB scan first — it pins S0 automatically.';
      case 'SECRETS_NOT_LOADED':
        return 'Database credentials are not loaded for this session. Re-enter them and start again.';
      case 'NO_ROUTINES':
        return 'No routines are in scope for this session. Re-create it with at least one procedure or function selected.';
      case 'RUN_IN_FLIGHT':
        return 'A capture run is already in flight for this session. Wait for it to finish (or cancel it) before starting another.';
      case 'DB_NOT_CONFIGURED':
        return 'This session has no database configuration. Re-create it with the connection details filled in.';
      case 'NO_ACCEPTED_CAPTURES':
        return 'No accepted captures yet — nothing to save as a baseline. Run the capture (or retry the uncovered routines) first.';
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}
