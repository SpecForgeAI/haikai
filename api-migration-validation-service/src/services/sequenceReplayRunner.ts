/**
 * Deterministic ordered-step sequence replay sub-runner (reconcile side).
 *
 * Spec: 2026-06-18 Stateful Sequence Scenarios (Spec D) -- Task Group 3.
 *
 * The reconcile-side complement of `sequenceAssembly.ts` (capture side). When
 * `targetReplayRunner.runTargetReplay` encounters a baseline item whose
 * `sequence_json` is non-null (an ordered setup -> act -> cleanup HTTP chain
 * captured atomically as ONE oracle unit), it hands the item to this sub-runner
 * INSTEAD of the single-shot replay path. Non-sequence items (`sequence_json`
 * null) NEVER reach here -- they take the existing single-shot path byte-for-
 * byte unchanged.
 *
 * What this sub-runner does (NO LLM -- fully deterministic):
 *   1. Runs the pinned steps IN ORDER via the SAME per-session target executor
 *      the single-shot path uses.
 *   2. Resolves `$<step>.<jsonpath>` inter-step references in a step's request
 *      from the LIVE response of the referenced EARLIER step (the field the LLM
 *      pinned as a generated id threaded forward). `from_step` + `json_path`
 *      are the parsed components carried alongside the raw `ref` (R1 shape).
 *   3. ASSERTS each SETUP step reaches its `expected_status` (status-only, NOT
 *      full-body-diffed). A failed setup FAILS the whole sequence with a
 *      `sequence_setup_failed` diagnostic; the ACT step is NOT reached / NOT
 *      diffed.
 *   4. Promotes the ACT step's LIVE response into a target baseline-item
 *      (Spec B `{ headers, body }` wrapper) at the act step's pairKey
 *      (`${method}|${path}|${scenarioName}`) so the EXISTING auto-triggered diff
 *      FULLY diffs it via `compareJsonShapes` + the source item's volatile
 *      envelope -- NO new diff engine, NO new pairing granularity.
 *   5. Runs CLEANUP steps best-effort (DELETEs are mutating, under the same
 *      `mutating_calls_confirmed` flag). On a cleanup failure -- or a created
 *      resource with no cleanup step -- emits `sequence_cleanup_failed` /
 *      `sequence_residual_pollution` and sets a flag on the result. Cleanup
 *      failure does NOT fail the sequence.
 *
 * The act step's promotion mirrors the single-shot promotion in
 * `targetReplayRunner.ts` EXACTLY (createCapture -> patchCapture accept ->
 * createBaselineItem on the same target baseline) so the downstream diff is
 * indistinguishable from a single-shot break.
 */

import type {
  BaselineDto,
  BaselineItemDto,
  CaptureDto,
  CaptureSessionDto,
} from './archModelClient';
import { archModelClient as defaultArchModelClient } from './archModelClient';
import { redactUrl } from './redactor';
import { normaliseBodyForAms } from './amsBodyEnvelope';
import type { SessionHttpExecutor } from './httpExecutor';

/**
 * One parsed step from a baseline item's `sequence_json.steps`. Mirrors the R1
 * snake_case wire shape but typed for the runner. Defensive parsing degrades a
 * malformed step to a safe default rather than throwing (a malformed sequence
 * is surfaced as a setup/cleanup diagnostic, never a crash).
 */
interface ParsedSequenceStep {
  index: number;
  role: 'setup' | 'act' | 'cleanup';
  kind: string;
  request: {
    method: string;
    path: string;
    query: Record<string, unknown> | null;
    headers: Record<string, string> | null;
    body: unknown;
  };
  expected_status: number;
  response_refs: Array<{ ref: string; from_step: number; json_path: string }>;
}

interface ParsedSequence {
  steps: ParsedSequenceStep[];
  act_step_index: number;
  cleanup_best_effort: boolean;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Parse + validate a baseline item's raw `sequence_json` blob into a typed
 * {@link ParsedSequence}, or `null` when it is structurally unusable (no steps,
 * no act step, an act_step_index out of range). A `null` return tells the
 * caller to treat the item as un-replayable (it emits a `sequence_setup_failed`
 * diagnostic and does not diff). Never throws.
 */
export function parseSequenceJson(raw: unknown): ParsedSequence | null {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const rawSteps = obj.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) return null;

  const steps: ParsedSequenceStep[] = [];
  for (let i = 0; i < rawSteps.length; i += 1) {
    const s = rawSteps[i];
    if (s === null || typeof s !== 'object' || Array.isArray(s)) return null;
    const so = s as Record<string, unknown>;
    const req = (so.request ?? {}) as Record<string, unknown>;
    const role = so.role;
    if (role !== 'setup' && role !== 'act' && role !== 'cleanup') return null;
    const refsRaw = Array.isArray(so.response_refs) ? so.response_refs : [];
    const response_refs: ParsedSequenceStep['response_refs'] = [];
    for (const r of refsRaw) {
      if (r === null || typeof r !== 'object') continue;
      const ro = r as Record<string, unknown>;
      const fromStep = typeof ro.from_step === 'number' ? ro.from_step : NaN;
      const jsonPath = typeof ro.json_path === 'string' ? ro.json_path : '';
      const ref = typeof ro.ref === 'string' ? ro.ref : '';
      if (Number.isNaN(fromStep) || jsonPath.length === 0) continue;
      response_refs.push({ ref, from_step: fromStep, json_path: jsonPath });
    }
    steps.push({
      index: typeof so.index === 'number' ? so.index : i,
      role,
      kind: typeof so.kind === 'string' ? so.kind : 'http',
      request: {
        method: typeof req.method === 'string' ? req.method.toUpperCase() : 'GET',
        path: typeof req.path === 'string' ? req.path : '/',
        query: (req.query ?? null) as Record<string, unknown> | null,
        headers: (req.headers ?? null) as Record<string, string> | null,
        body: req.body ?? null,
      },
      expected_status:
        typeof so.expected_status === 'number' ? so.expected_status : 200,
      response_refs,
    });
  }

  const actIdx = typeof obj.act_step_index === 'number' ? obj.act_step_index : -1;
  if (actIdx < 0 || actIdx >= steps.length) return null;
  if (steps[actIdx].role !== 'act') return null;

  return {
    steps,
    act_step_index: actIdx,
    cleanup_best_effort: obj.cleanup_best_effort !== false,
  };
}

/**
 * Resolve a `$<step>.<jsonpath>` JSONPath-ish tail (`id`, `data.id`,
 * `items[0].id`) against an already-extracted (unwrapped) response body, and
 * return the value found, or `undefined` when the path is absent. Consistent
 * with `sequenceAssembly.jsonPathToPointer`'s segment grammar: dotted segments
 * + `[index]` / `[key]` bracket accessors. Never throws.
 */
export function resolveJsonPath(body: unknown, jsonPath: string): unknown {
  let p = jsonPath.trim();
  if (p.startsWith('$')) {
    p = p.replace(/^\$\d*\.?/, '');
  }
  if (p.length === 0) return body;

  const tokens: string[] = [];
  for (const segment of p.split('.')) {
    const m = segment.match(/^([^[\]]*)((?:\[[^\]]*\])*)$/);
    if (!m) {
      if (segment.length > 0) tokens.push(segment);
      continue;
    }
    if (m[1].length > 0) tokens.push(m[1]);
    const brackets = m[2].match(/\[([^\]]*)\]/g) ?? [];
    for (const b of brackets) {
      tokens.push(b.slice(1, -1).replace(/['"]/g, ''));
    }
  }

  let cur: unknown = body;
  for (const token of tokens) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(token);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined;
      cur = cur[idx];
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * Recursively replace any string value that is EXACTLY a `$<step>.<jsonpath>`
 * inter-step reference with the resolved live value. The replacement is applied
 * to the WHOLE captured request value (query / headers / body / path), so a
 * placeholder can appear anywhere the pin tool put it. A ref whose referenced
 * step has not yet produced a live response (forward ref / missing) is left
 * verbatim. Never throws.
 */
function substituteRefs(
  value: unknown,
  liveBodies: Map<number, unknown>,
): unknown {
  if (typeof value === 'string') {
    const m = value.match(/^\$(\d+)\.(.+)$/);
    if (m) {
      const fromStep = Number(m[1]);
      const jsonPath = m[2];
      if (liveBodies.has(fromStep)) {
        const resolved = resolveJsonPath(liveBodies.get(fromStep), jsonPath);
        if (resolved !== undefined) return resolved;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => substituteRefs(v, liveBodies));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substituteRefs(v, liveBodies);
    }
    return out;
  }
  return value;
}

/**
 * Substitute `$<step>.<path>` placeholders that appear inside a URL path
 * segment (e.g. `/widgets/$1.id`). Path is a single string; we scan for any
 * `$<digits>.<token...>` substring and replace it with the stringified resolved
 * value. A token ends at the next `/`, `?`, or end-of-string.
 */
function substitutePathRefs(
  path: string,
  liveBodies: Map<number, unknown>,
): string {
  return path.replace(/\$(\d+)\.([A-Za-z0-9_.[\]'"-]+)/g, (full, stepStr, jsonPath) => {
    const fromStep = Number(stepStr);
    if (!liveBodies.has(fromStep)) return full;
    const resolved = resolveJsonPath(liveBodies.get(fromStep), jsonPath);
    if (resolved === undefined || resolved === null) return full;
    return String(resolved);
  });
}

/**
 * Diagnostic types this sub-runner can produce (a subset of
 * {@link TargetReplayDiagnosticType}, re-declared as a string to avoid a
 * circular import with `targetReplayRunner`).
 */
export type SequenceDiagnosticType =
  | 'sequence_skipped'
  | 'sequence_setup_failed'
  | 'sequence_cleanup_failed'
  | 'sequence_residual_pollution';

export interface SequenceDiagnostic {
  diagnosticType: SequenceDiagnosticType;
  message: string;
  itemId?: string;
  method?: string;
  path?: string;
  responseStatus?: number;
}

/**
 * Outcome of replaying ONE sequence-bearing baseline item. The caller folds
 * `diagnostics` into the run's diagnostics list and increments the right
 * counter from the booleans:
 *   - `skipped`         -> itemsSkipped (no `mutating_calls_confirmed`)
 *   - `setupFailed`     -> itemsFailed  (a setup step missed its status)
 *   - else (act ran)    -> itemsReplayed
 * `cleanupFailed` / `residualPollution` are surfaced as flags (NOT a hard fail)
 * AND as diagnostics in `diagnostics`.
 */
export interface SequenceReplayResult {
  /** Skipped for lack of `mutating_calls_confirmed`. */
  skipped: boolean;
  /** A setup step missed its expected_status; the act was NOT reached/diffed. */
  setupFailed: boolean;
  /** The act step ran and was promoted to a target baseline-item (diffed). */
  actReplayed: boolean;
  /** A cleanup step failed (best-effort; does NOT fail the sequence). */
  cleanupFailed: boolean;
  /** A created resource had no cleanup, or a cleanup failed -> bounded residue. */
  residualPollution: boolean;
  diagnostics: SequenceDiagnostic[];
}

export interface SequenceReplayDeps {
  archModelClient?: typeof defaultArchModelClient;
  now?: () => number;
}

/**
 * Replay ONE sequence-bearing source baseline item against the target.
 *
 * @param sourceItem    the source baseline item whose `sequence_json` is non-null
 *                      (and which is ITSELF the act step's oracle row -- its
 *                      `scenario_name`/`operation_id`/`scenario_id` are reused
 *                      when promoting the act result so the diff pairs at the
 *                      act step's pairKey).
 * @param session       the target session (carries `mutating_calls_confirmed`).
 * @param targetBaseline the draft target baseline to promote the act item onto.
 * @param executor      the SAME per-session target executor the single-shot path
 *                      uses.
 */
export async function replaySequenceItem(
  sourceItem: BaselineItemDto,
  session: CaptureSessionDto,
  targetBaseline: BaselineDto,
  executor: SessionHttpExecutor,
  deps: SequenceReplayDeps = {},
): Promise<SequenceReplayResult> {
  const archModelClient = deps.archModelClient ?? defaultArchModelClient;
  const now = deps.now ?? (() => Date.now());
  const projectId = session.project_id;

  const result: SequenceReplayResult = {
    skipped: false,
    setupFailed: false,
    actReplayed: false,
    cleanupFailed: false,
    residualPollution: false,
    diagnostics: [],
  };

  // A sequence is inherently mutating: it requires mutating_calls_confirmed.
  // A distinct `sequence_skipped` diagnostic (NOT the generic mutating_skipped)
  // so the whole sequence is never silently dropped (R4 + R6).
  if (session.mutating_calls_confirmed !== true) {
    result.skipped = true;
    result.diagnostics.push({
      diagnosticType: 'sequence_skipped',
      message:
        `Skipped stateful sequence for ${sourceItem.method ?? 'GET'} ${
          sourceItem.path ?? '/'
        } -- target session has mutating_calls_confirmed=false (a sequence ` +
        `is inherently mutating: setup creates + cleanup DELETEs resources)`,
      itemId: sourceItem.id,
      method: sourceItem.method ?? undefined,
      path: sourceItem.path ?? undefined,
    });
    return result;
  }

  const seq = parseSequenceJson(sourceItem.sequence_json);
  if (!seq) {
    // Structurally unusable sequence -- fail it as a setup failure (the act is
    // not reached) rather than crash or silently pass.
    result.setupFailed = true;
    result.diagnostics.push({
      diagnosticType: 'sequence_setup_failed',
      message:
        `Stateful sequence for ${sourceItem.method ?? 'GET'} ${
          sourceItem.path ?? '/'
        } is structurally invalid (no usable steps / act step) -- not replayed`,
      itemId: sourceItem.id,
      method: sourceItem.method ?? undefined,
      path: sourceItem.path ?? undefined,
    });
    return result;
  }

  // liveBodies[stepIndex] = the UNWRAPPED live response body of that step, used
  // to resolve `$<step>.<jsonpath>` refs in LATER steps. Keyed by the step's
  // `index` field (== array position, per the capture-side assembler).
  const liveBodies = new Map<number, unknown>();
  // Track resources a setup/act step created (a 2xx mutating call) so we can
  // flag residual pollution when no cleanup step ran for them.
  let createdResourceCount = 0;
  let cleanupStepCount = 0;

  const actStep = seq.steps[seq.act_step_index];

  // ----------------------------------------------------------------------
  // 1) Run setup steps in order, asserting each reaches its expected_status.
  // ----------------------------------------------------------------------
  for (const step of seq.steps) {
    if (step.role !== 'setup') continue;
    if (step.kind !== 'http') {
      // Only `http` is implemented now; a reserved `sql`/`e2e` setup step is a
      // hard setup failure (we cannot satisfy the precondition deterministically).
      result.setupFailed = true;
      result.diagnostics.push({
        diagnosticType: 'sequence_setup_failed',
        message:
          `Setup step ${step.index} has unimplemented kind='${step.kind}' ` +
          `(only 'http' is supported) -- sequence for ${sourceItem.method ?? 'GET'} ${
            sourceItem.path ?? '/'
          } not replayed`,
        itemId: sourceItem.id,
        method: step.request.method,
        path: step.request.path,
      });
      return result;
    }

    const sent = await sendStep(step, liveBodies, executor, now);
    if (sent.transportFailed || sent.status === null) {
      result.setupFailed = true;
      result.diagnostics.push({
        diagnosticType: 'sequence_setup_failed',
        message:
          `Setup step ${step.index} (${step.request.method} ${step.request.path}) ` +
          `transport-failed${sent.errorCode ? ` (${sent.errorCode})` : ''} -- ` +
          `act step NOT reached for ${sourceItem.method ?? 'GET'} ${sourceItem.path ?? '/'}`,
        itemId: sourceItem.id,
        method: step.request.method,
        path: step.request.path,
      });
      return result;
    }
    liveBodies.set(step.index, sent.body);
    if (sent.status === step.expected_status) {
      if (MUTATING_METHODS.has(step.request.method) && sent.status >= 200 && sent.status < 300) {
        createdResourceCount += 1;
      }
    } else {
      // Setup ASSERTION: status-only (NOT full-body-diffed). A miss fails the
      // whole sequence; the act step is NOT reached / NOT diffed.
      result.setupFailed = true;
      result.diagnostics.push({
        diagnosticType: 'sequence_setup_failed',
        message:
          `Setup step ${step.index} (${step.request.method} ${step.request.path}) ` +
          `returned status ${sent.status}, expected ${step.expected_status} -- ` +
          `act step NOT reached for ${sourceItem.method ?? 'GET'} ${sourceItem.path ?? '/'}`,
        itemId: sourceItem.id,
        method: step.request.method,
        path: step.request.path,
        responseStatus: sent.status,
      });
      return result;
    }
  }

  // ----------------------------------------------------------------------
  // 2) Run the ACT step + promote its response to a target baseline-item so
  //    the EXISTING auto-triggered diff fully diffs it (Spec B fidelity +
  //    volatile tolerance from the SOURCE item's volatile_paths_json).
  // ----------------------------------------------------------------------
  if (actStep.kind !== 'http') {
    result.setupFailed = true;
    result.diagnostics.push({
      diagnosticType: 'sequence_setup_failed',
      message:
        `Act step ${actStep.index} has unimplemented kind='${actStep.kind}' ` +
        `(only 'http' is supported) -- not replayed`,
      itemId: sourceItem.id,
      method: actStep.request.method,
      path: actStep.request.path,
    });
    return result;
  }

  const actSent = await sendStep(actStep, liveBodies, executor, now);
  if (actSent.transportFailed || actSent.status === null) {
    // A transport failure on the act itself is a setup-class failure (no usable
    // act response to diff). Surface it as `sequence_setup_failed` so the
    // sequence is not silently passed.
    result.setupFailed = true;
    result.diagnostics.push({
      diagnosticType: 'sequence_setup_failed',
      message:
        `Act step ${actStep.index} (${actStep.request.method} ${actStep.request.path}) ` +
        `transport-failed${actSent.errorCode ? ` (${actSent.errorCode})` : ''} -- ` +
        `nothing to diff for ${sourceItem.method ?? 'GET'} ${sourceItem.path ?? '/'}`,
      itemId: sourceItem.id,
      method: actStep.request.method,
      path: actStep.request.path,
    });
    return result;
  }
  liveBodies.set(actStep.index, actSent.body);
  if (
    MUTATING_METHODS.has(actStep.request.method) &&
    actSent.status >= 200 &&
    actSent.status < 300
  ) {
    createdResourceCount += 1;
  }

  // Promote the act response to a target baseline-item -- EXACTLY mirroring the
  // single-shot promotion in targetReplayRunner.ts (createCapture ->
  // patchCapture accept -> createBaselineItem). Reuse the SOURCE item's
  // scenario_name / operation_id / scenario_id so the diff pairs at the act
  // step's pairKey `${method}|${path}|${scenarioName}`.
  const capture: CaptureDto = await archModelClient.createCapture(projectId, {
    session_id: session.id,
    scenario_id: sourceItem.scenario_id,
    operation_id: sourceItem.operation_id,
    attempt_number: 1,
    request_method: actStep.request.method,
    request_path: actSent.resolvedPath,
    request_url_redacted: redactUrl(
      ((session.api_base_url ?? '').replace(/\/+$/, '') +
        (actSent.resolvedPath.startsWith('/')
          ? actSent.resolvedPath
          : `/${actSent.resolvedPath}`)) || actSent.resolvedPath),
    request_query_json: actSent.resolvedQuery ?? null,
    request_headers_redacted_json: actSent.resolvedHeaders ?? null,
    request_body_json: normaliseBodyForAms(actSent.resolvedBody),
    response_status: actSent.status,
    response_headers_redacted_json: actSent.headers,
    response_body_json: normaliseBodyForAms(actSent.body),
    duration_ms: actSent.durationMs,
    error_type: null,
    error_message: null,
    captured_at: new Date(now()).toISOString(),
  });

  await archModelClient.patchCapture(projectId, capture.id, {
    accepted: true,
    accepted_at: new Date(now()).toISOString(),
  });

  await archModelClient.createBaselineItem(projectId, {
    baseline_id: targetBaseline.id,
    capture_id: capture.id,
    operation_id: sourceItem.operation_id,
    scenario_id: sourceItem.scenario_id,
    method: actStep.request.method,
    // Pair at the act step's pairKey -- use the SOURCE item's method/path/
    // scenario_name (the source item IS the act step's oracle row). The act
    // step's request.path matches the source item's path by construction.
    path: sourceItem.path ?? actStep.request.path,
    scenario_name: sourceItem.scenario_name,
    request_json: {
      query: actSent.resolvedQuery ?? null,
      headers: actSent.resolvedHeaders ?? null,
      body: actSent.resolvedBody ?? null,
    },
    response_status: actSent.status,
    response_json: {
      headers: capture.response_headers_redacted_json,
      body: capture.response_body_json,
    },
    business_notes: null,
  });
  result.actReplayed = true;

  // ----------------------------------------------------------------------
  // 3) Run cleanup steps best-effort (DELETEs are mutating, under the same
  //    confirmation). A failure FLAGS residual pollution; it does NOT fail
  //    the sequence (R5 + R6).
  // ----------------------------------------------------------------------
  for (const step of seq.steps) {
    if (step.role !== 'cleanup') continue;
    cleanupStepCount += 1;
    if (step.kind !== 'http') {
      result.cleanupFailed = true;
      result.residualPollution = true;
      result.diagnostics.push({
        diagnosticType: 'sequence_cleanup_failed',
        message:
          `Cleanup step ${step.index} has unimplemented kind='${step.kind}' ` +
          `(only 'http' is supported) -- resource left in place (residual pollution)`,
        itemId: sourceItem.id,
        method: step.request.method,
        path: step.request.path,
      });
      continue;
    }
    const sent = await sendStep(step, liveBodies, executor, now);
    if (sent.transportFailed || sent.status === null) {
      result.cleanupFailed = true;
      result.residualPollution = true;
      result.diagnostics.push({
        diagnosticType: 'sequence_cleanup_failed',
        message:
          `Cleanup step ${step.index} (${step.request.method} ${step.request.path}) ` +
          `transport-failed${sent.errorCode ? ` (${sent.errorCode})` : ''} -- ` +
          `resource may be left in place (residual pollution)`,
        itemId: sourceItem.id,
        method: step.request.method,
        path: step.request.path,
      });
      continue;
    }
    liveBodies.set(step.index, sent.body);
    if (sent.status < 200 || sent.status >= 300) {
      // A non-2xx cleanup is a failed best-effort cleanup -> flagged residue.
      result.cleanupFailed = true;
      result.residualPollution = true;
      result.diagnostics.push({
        diagnosticType: 'sequence_cleanup_failed',
        message:
          `Cleanup step ${step.index} (${step.request.method} ${step.request.path}) ` +
          `returned non-2xx status ${sent.status} -- resource may be left in ` +
          `place (residual pollution)`,
        itemId: sourceItem.id,
        method: step.request.method,
        path: step.request.path,
        responseStatus: sent.status,
      });
    }
  }

  // A created resource (setup/act 2xx mutating) with NO cleanup step is bounded,
  // FLAGGED residual pollution -- never pretended-clean (R3/R6 isolation).
  if (createdResourceCount > 0 && cleanupStepCount === 0) {
    result.residualPollution = true;
    result.diagnostics.push({
      diagnosticType: 'sequence_residual_pollution',
      message:
        `Sequence for ${sourceItem.method ?? 'GET'} ${sourceItem.path ?? '/'} ` +
        `created ${createdResourceCount} resource(s) but declared NO cleanup step ` +
        `-- bounded residual pollution left on the target (flagged, not silent)`,
      itemId: sourceItem.id,
      method: sourceItem.method ?? undefined,
      path: sourceItem.path ?? undefined,
    });
  }

  return result;
}

interface SentStep {
  status: number | null;
  body: unknown;
  headers: Record<string, string> | null;
  transportFailed: boolean;
  errorCode: string | null;
  durationMs: number;
  resolvedPath: string;
  resolvedQuery: Record<string, unknown> | null;
  resolvedHeaders: Record<string, string> | null;
  resolvedBody: unknown;
}

/**
 * Send ONE step via the target executor, resolving `$<step>.<jsonpath>` refs in
 * its request from `liveBodies` first. The live response body is UNWRAPPED into
 * `body` (so later refs resolve against the raw response, consistent with
 * how the act step is later promoted as `{ headers, body }`). Transport errors
 * are caught and reported as `transportFailed` (no throw -- the caller decides
 * whether that fails the sequence or flags pollution).
 */
async function sendStep(
  step: ParsedSequenceStep,
  liveBodies: Map<number, unknown>,
  executor: SessionHttpExecutor,
  now: () => number,
): Promise<SentStep> {
  const resolvedPath = substitutePathRefs(step.request.path, liveBodies);
  const resolvedQuery = substituteRefs(step.request.query, liveBodies) as
    | Record<string, unknown>
    | null;
  const resolvedHeaders = substituteRefs(step.request.headers, liveBodies) as
    | Record<string, string>
    | null;
  const resolvedBody = substituteRefs(step.request.body, liveBodies);

  const startedAt = now();
  try {
    const response = await executor.request({
      method: step.request.method as never,
      url: resolvedPath,
      params: resolvedQuery ?? undefined,
      headers: resolvedHeaders ?? undefined,
      data: resolvedBody,
    });
    const headers =
      response.headers && typeof response.headers === 'object'
        ? (Object.fromEntries(
            Object.entries(response.headers).map(([k, v]) => [
              k,
              Array.isArray(v) ? v.join(', ') : String(v ?? ''),
            ]),
          ) as Record<string, string>)
        : null;
    return {
      status: response.status,
      body: response.data ?? null,
      headers,
      transportFailed: false,
      errorCode: null,
      durationMs: now() - startedAt,
      resolvedPath,
      resolvedQuery,
      resolvedHeaders,
      resolvedBody,
    };
  } catch (err) {
    const code =
      typeof (err as { code?: unknown })?.code === 'string'
        ? ((err as { code: string }).code)
        : null;
    return {
      status: null,
      body: null,
      headers: null,
      transportFailed: true,
      errorCode: code,
      durationMs: now() - startedAt,
      resolvedPath,
      resolvedQuery,
      resolvedHeaders,
      resolvedBody,
    };
  }
}
