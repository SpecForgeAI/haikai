/**
 * Stateful-sequence assembly (capture side).
 *
 * Spec: 2026-06-18 Stateful Sequence Scenarios (Spec D) -- Task Group 2.
 *
 * PURE assembly seam between the LLM's declarative sequence pin (the
 * `pin_sequence` terminal tool's validated declaration, carried on
 * `runManager.pinnedSequence`) and the persisted `sequence_json` baseline-item
 * field. Inputs in, value out -- no I/O, no mutation -- so the orchestrator can
 * call it inside the per-scenario block and the unit tests can drive it
 * directly.
 *
 * `sequence_json` shape (R1, snake_case wire):
 *   {
 *     steps: [ {
 *       index, role: 'setup'|'act'|'cleanup', kind: 'http',
 *       request: { method, path, query, headers, body },
 *       expected_status,
 *       response_refs: [ { ref: '$<step>.<jsonpath>', from_step, json_path } ]
 *     } ],
 *     act_step_index,
 *     cleanup_best_effort: true
 *   }
 *
 * A sequence stays ONE `GeneratedScenario` -> ONE `CoverageDimensionResult`:
 * this module does NOT touch the coverage rubric. The ACT step's capture is the
 * canonical one for scoring (handled by the existing `selectCanonicalCapture` /
 * `scoreEndpointCoverage` path, unchanged).
 */

import type {
  PinnedSequenceDeclaration,
  ScenarioCaptureRef,
} from './runManager';
import { volatilityEnvelopeToWire } from './volatilityProbe';
import type { VolatilityEnvelope } from './jsonShapeComparator';
import { extractIdentifierPaths } from './tools/_idFacts';

/** One assembled step in the persisted `sequence_json` (snake_case wire). */
export interface SequenceStepJson {
  index: number;
  role: 'setup' | 'act' | 'cleanup';
  /** Only `'http'` is implemented now (reserved `'sql'`/`'e2e'`). */
  kind: 'http';
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

/** The persisted `sequence_json` envelope (snake_case wire, R1 shape). */
export interface SequenceJson {
  steps: SequenceStepJson[];
  act_step_index: number;
  cleanup_best_effort: boolean;
}

/**
 * Map each declared step to the actual executed capture (by `captureIndex`),
 * step-aligned: result[i] is the capture for `declaration.steps[i]`. Returns
 * `null` when any step references a capture index that does not exist or whose
 * captured request/response `data` is missing (so the caller falls back to the
 * single-shot path rather than persisting a malformed sequence).
 */
function mapStepCaptures(
  declaration: PinnedSequenceDeclaration,
  captures: ReadonlyArray<ScenarioCaptureRef>,
): ScenarioCaptureRef[] | null {
  const out: ScenarioCaptureRef[] = [];
  for (const decl of declaration.steps) {
    const capture = captures[decl.captureIndex];
    if (!capture || !capture.data) return null;
    out.push(capture);
  }
  return out;
}

/**
 * Assemble the persisted `sequence_json` from the LLM's validated pin
 * declaration + the ordered per-scenario captures (each declared step maps to
 * the actual executed capture's request/response by `captureIndex`).
 *
 * Returns `null` when the declaration cannot be assembled against the captures
 * -- the orchestrator then falls back to the single-shot path. The pin tool
 * already validated the declaration's internal consistency (one act, valid
 * roles/kinds, refs to earlier steps); this is the capture-availability
 * backstop.
 */
export function assembleSequenceJson(
  declaration: PinnedSequenceDeclaration,
  captures: ReadonlyArray<ScenarioCaptureRef>,
): SequenceJson | null {
  const stepCaptures = mapStepCaptures(declaration, captures);
  if (!stepCaptures || stepCaptures.length === 0) return null;
  const steps: SequenceStepJson[] = stepCaptures.map((capture, i) => {
    const decl = declaration.steps[i];
    const d = capture.data!;
    return {
      index: i,
      role: decl.role,
      kind: 'http',
      request: {
        method: d.method,
        path: d.path,
        query: d.query ?? null,
        headers: d.headers ?? null,
        body: d.body ?? null,
      },
      expected_status: decl.expectedStatus,
      response_refs: (decl.responseRefs ?? []).map((r) => ({
        ref: r.ref,
        from_step: r.fromStep,
        json_path: r.jsonPath,
      })),
    };
  });
  return {
    steps,
    act_step_index: declaration.actStepIndex,
    cleanup_best_effort: declaration.cleanupBestEffort !== false,
  };
}

/**
 * Convert a `$<step>.<jsonpath>` inter-step ref's dotted/bracket JSONPath tail
 * into a normalised RFC-6901 JSON-Pointer so it lands in the same
 * `volatile_paths_json.paths` shape the diff engine consumes. e.g.
 *   `id`            -> `/id`
 *   `data.id`       -> `/data/id`
 *   `items[0].id`   -> `/items/0/id`
 * A leading `$N.` (if the caller passed the full ref) is stripped.
 */
function jsonPathToPointer(jsonPath: string): string {
  let p = jsonPath.trim();
  if (p.startsWith('$')) {
    p = p.replace(/^\$\d*\.?/, '');
  }
  if (p.length === 0) return '';
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
  return tokens
    .map((t) => `/${t.replace(/~/g, '~0').replace(/\//g, '~1')}`)
    .join('');
}

/**
 * Derive the REF-DERIVED (R3) expected-volatile paths for a pinned sequence and
 * pack them into the SAME `volatile_paths_json` envelope shape the diff engine
 * already consumes -- so the diff/reconcile side needs NO change to tolerate
 * them. Two sources, both expected-volatile by construction:
 *   (a) every response field a later step references as `$N.<jsonpath>`
 *       (the LLM pinned it precisely because it is a generated id threaded
 *       forward);
 *   (b) the generated-id paths surfaced by `extractIdentifierPaths` on the
 *       ACT + SETUP step responses (a 201's new id changes capture->replay).
 *
 * The volatility PROBE's mutating-skip guard is left untouched (re-running a
 * mutating call k times would create k resources -- see `volatilityProbe.ts`);
 * this is the ref-derived complement, NOT a probe.
 *
 * `declaration` + `captures` are the same inputs `assembleSequenceJson`
 * consumes; the same `captureIndex` mapping aligns each step to its captured
 * response. Returns `null` when no volatile path is derived (so the caller
 * leaves the envelope null = strict, the backward-compat default), tagged
 * `declared` (the LLM declared the chain). A genuinely-changed NON-volatile
 * field is NOT recorded here and still breaks at diff time (oracle invariant
 * intact).
 */
export function deriveSequenceVolatilePaths(
  declaration: PinnedSequenceDeclaration,
  captures: ReadonlyArray<ScenarioCaptureRef>,
): Record<string, unknown> | null {
  const stepCaptures = mapStepCaptures(declaration, captures);
  if (!stepCaptures) return null;

  const paths = new Set<string>();

  // (a) ref-referenced response fields -- volatile by construction.
  for (const decl of declaration.steps) {
    for (const ref of decl.responseRefs ?? []) {
      const pointer = jsonPathToPointer(ref.jsonPath);
      if (pointer.length > 0) paths.add(pointer);
    }
  }

  // (b) generated-id paths on the act + setup responses (extractIdentifierPaths
  //     uses the SAME id-ish shape as the cross-scenario id-reuse harvest).
  for (let i = 0; i < declaration.steps.length; i += 1) {
    if (declaration.steps[i].role === 'cleanup') continue;
    const body = stepCaptures[i].data?.responseBody;
    if (body === undefined) continue;
    for (const pointer of extractIdentifierPaths(body)) {
      paths.add(pointer);
    }
  }

  if (paths.size === 0) return null;

  const envelope: VolatilityEnvelope = {
    paths: Array.from(paths).sort(),
    // `declared`: the volatility is asserted from the pinned chain, not
    // empirically probed (a mutating call is never re-run k times). The diff
    // engine treats `declared` as VALUE-tolerant for these paths.
    volatility_source: 'declared',
    k: 0,
  };
  return volatilityEnvelopeToWire(envelope);
}
