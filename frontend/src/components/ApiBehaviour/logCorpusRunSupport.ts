/**
 * Log-corpus wizard support (Capture-State Discipline & Log-Replay program,
 * Spec 6, 2026-08-18). PURE helpers — the wizard and the append modal share
 * them, and they are unit-tested directly:
 *
 *   - SOURCE-SELECTION derivation: the multi-select checkboxes {LLM, Postman,
 *     Application log} + the include-in-initial checkbox + the extracted
 *     corpus state resolve to the EXISTING PostmanRunMode machinery plus a
 *     start-blocking verdict. The checked path reuses the manual-capture
 *     concrete-send pipeline and merges into the SAME postmanCapturedByOp map
 *     — the /start delta subtraction is source-agnostic, so the backend is
 *     untouched.
 *   - Corpus-item -> session-operation matching (placeholder-equivalent
 *     templates, mirroring the discovery-side normalizer's equivalence).
 *   - Corpus-item -> ManualCaptureRequest conversion.
 *   - The mutating split: mutating corpus items NEVER pre-fire — the
 *     manual-capture path is unbracketed (the same pre-existing posture as
 *     Postman mutating sends), so those endpoints are left to the LLM loop,
 *     which runs under compensation brackets (CSD Spec 3).
 */

import type {
  ApiBehaviourOperationDto,
  ManualCaptureRequest,
} from '../../api/apiBehaviourClient';
import type { PostmanRunMode } from './postmanImportRunSupport';

// ---------------------------------------------------------------------------
// Wire shapes from the discovery extract route (Spec 5)
// ---------------------------------------------------------------------------

export interface LogCorpusItemWire {
  method: string;
  path_template: string;
  concrete_path: string;
  request_json: {
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: unknown;
  } | null;
  response_status: number | null;
  occurrence_count: number;
  richness: 'url_only' | 'with_body';
  matched_endpoint_id: string | null;
}

export interface LogCorpusFunnelWire {
  lines_total: number;
  observations_parsed: number;
  matched_endpoint: number;
  useful: number;
  discarded_no_matching_endpoint: number;
  discarded_no_request_body: number;
  deduplicated_into: number;
  format_detected: string;
  parse_mode: string;
  unmatched_endpoints: string[];
}

export interface LogCorpusExtractResponse {
  abandoned: boolean;
  message?: string;
  funnel: LogCorpusFunnelWire;
  corpus: { id: string; item_count: number } | null;
  /** Items ride back for the checked-mode concrete sends (staging display). */
  items?: LogCorpusItemWire[];
}

// ---------------------------------------------------------------------------
// Source selection
// ---------------------------------------------------------------------------

export interface CaptureSourceSelection {
  llm: boolean;
  postman: boolean;
  log: boolean;
  /** "[ ] Include application log generated in initial reconciliation". */
  includeLogInInitial: boolean;
}

export interface SourceSelectionVerdict {
  mode: PostmanRunMode;
  /**
   * Non-null blocks /start with this operator-facing reason. The selection
   * itself can be invalid (no sources) or the log corpus state can make the
   * initial run empty (log-only unchecked / abandoned source).
   */
  startBlockReason: string | null;
  /** TRUE when the start body should carry postmanOnly (no LLM loop). */
  postmanOnly: boolean;
}

export function deriveSourceSelection(
  selection: CaptureSourceSelection,
  corpus: { abandoned: boolean; usefulCount: number } | null,
): SourceSelectionVerdict {
  const logContributesToInitial =
    selection.log &&
    selection.includeLogInInitial &&
    corpus !== null &&
    !corpus.abandoned &&
    corpus.usefulCount > 0;

  if (!selection.llm && !selection.postman) {
    if (logContributesToInitial) {
      // Log-only initial run: concrete sends only, no planner — the exact
      // postman-only semantics.
      return { mode: 'postman-only', startBlockReason: null, postmanOnly: true };
    }
    if (selection.log) {
      return {
        mode: 'llm',
        startBlockReason:
          selection.includeLogInInitial
            ? 'the application log yielded no useful requests — select LLM or Postman ' +
              'for the initial capture, or supply a richer log'
            : 'the log corpus is staged for reconciliation round 2 only — select LLM ' +
              'or Postman for the initial capture, or tick "Include application log ' +
              'generated in initial reconciliation"',
        postmanOnly: false,
      };
    }
    return {
      mode: 'llm',
      startBlockReason: 'select at least one capture source',
      postmanOnly: false,
    };
  }

  if (selection.llm && selection.postman) {
    return { mode: 'postman-delta', startBlockReason: null, postmanOnly: false };
  }
  if (selection.postman) {
    return { mode: 'postman-only', startBlockReason: null, postmanOnly: true };
  }
  return { mode: 'llm', startBlockReason: null, postmanOnly: false };
}

/** Map an existing PostmanRunMode onto the checkbox model (back-compat). */
export function selectionFromMode(mode: PostmanRunMode): CaptureSourceSelection {
  return {
    llm: mode === 'llm' || mode === 'postman-delta',
    postman: mode === 'postman-delta' || mode === 'postman-only',
    log: false,
    includeLogInInitial: false,
  };
}

// ---------------------------------------------------------------------------
// Corpus item -> session operation matching
// ---------------------------------------------------------------------------

/** Segment-wise template equivalence: placeholder segments match each other. */
export function templatesEquivalent(a: string, b: string): boolean {
  const segs = (t: string) =>
    t.split('?')[0].replace(/\/+$/, '').split('/').filter((s) => s.length > 0);
  const sa = segs(a);
  const sb = segs(b);
  if (sa.length !== sb.length) return false;
  for (let i = 0; i < sa.length; i++) {
    const pa = /^\{.+\}$/.test(sa[i]);
    const pb = /^\{.+\}$/.test(sb[i]);
    if (pa || pb) continue; // placeholder matches anything in that slot
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}

export function matchCorpusItemToOperation(
  item: LogCorpusItemWire,
  operations: ApiBehaviourOperationDto[],
): ApiBehaviourOperationDto | null {
  const method = item.method.toUpperCase();
  return (
    operations.find(
      (op) =>
        (op.method ?? '').toUpperCase() === method &&
        op.included !== false &&
        templatesEquivalent(op.path ?? '', item.path_template),
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Concrete-send conversion + the mutating split
// ---------------------------------------------------------------------------

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutatingCorpusItem(item: LogCorpusItemWire): boolean {
  return MUTATING_METHODS.has(item.method.toUpperCase());
}

/**
 * Split the corpus for the checked-mode pre-fire: only NON-mutating items
 * fire through the (unbracketed) manual-capture path; mutating items stay
 * with the LLM loop, which runs under compensation brackets.
 */
export function splitCorpusForPreFire(items: LogCorpusItemWire[]): {
  fireable: LogCorpusItemWire[];
  heldMutating: LogCorpusItemWire[];
} {
  const fireable: LogCorpusItemWire[] = [];
  const heldMutating: LogCorpusItemWire[] = [];
  for (const item of items) {
    (isMutatingCorpusItem(item) ? heldMutating : fireable).push(item);
  }
  return { fireable, heldMutating };
}

export function corpusItemToManualCapture(
  item: LogCorpusItemWire,
  operation: ApiBehaviourOperationDto,
  opts: { mutatingCallsConfirmed: boolean },
): ManualCaptureRequest {
  const pathOnly = item.concrete_path.split('?')[0];
  return {
    operationId: operation.operation_id ?? operation.id,
    method: item.method.toUpperCase(),
    path: pathOnly,
    query: item.request_json?.query ?? null,
    headers: item.request_json?.headers ?? null,
    body: item.request_json?.body,
    mutatingCallsConfirmed: opts.mutatingCallsConfirmed,
  };
}
