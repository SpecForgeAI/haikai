import { ToolHandler, ToolRegistryEntry, ToolValidationError } from './toolTypes';
import { runManager } from '../runManager';
import type {
  PinnedSequenceDeclaration,
  PinnedSequenceStepDeclaration,
} from '../runManager';
import { createTracer } from '../../trace';

// Haikai workflow trace logger (OFF by default; no-op unless HAIKAI_TRACE is
// set). See docs/trace-logging.md.
const trace = createTracer('capture-svc');

/**
 * Tool: `pin_sequence`
 *
 * Spec: 2026-06-18 Stateful Sequence Scenarios (Spec D) -- Task Group 2.
 *
 * The TERMINAL pin tool the LLM calls (after exercising a multi-step chain via
 * `execute_http_request`) to PIN the captured chain as ONE oracle unit. The
 * LLM is the only actor that knows which executed calls were setup/act/cleanup
 * and which response field a later step references (`$N.<jsonpath>`); replay
 * never re-derives them. The orchestrator assembles the persisted
 * `sequence_json` from this declaration + the ordered scenario captures.
 *
 * Sits beside `record_capture_note` / `record_scenario_candidate`; marked
 * `terminal: true` so it exits the per-scenario loop like `record_capture_note`.
 *
 * Declaration shape (the LLM's `steps` arg):
 *   steps: [ {
 *     captureIndex,         // 0-based index into THIS scenario's executed
 *                           // captures (attempt order) -- maps the declared
 *                           // step to the real captured request/response.
 *     role: 'setup'|'act'|'cleanup',
 *     kind: 'http',         // ONLY 'http' is accepted now (reserved sql/e2e).
 *     expectedStatus,       // the status this step is asserted to reach.
 *     responseRefs?: [ { ref: '$<step>.<jsonpath>' } ]  // inter-step refs;
 *                           // `from_step` + `json_path` are parsed from `ref`.
 *   } ],
 *   actStepIndex            // index INTO `steps` of the single ACT step.
 *
 * Validation (raises `ToolValidationError` on malformed input):
 *   - a non-empty `steps` array;
 *   - every step's `kind` is `'http'` (reject reserved kinds);
 *   - every step's `role` is setup/act/cleanup;
 *   - every `captureIndex` points to a REAL executed capture in this scenario;
 *   - exactly ONE step has role `'act'` and `actStepIndex` points to it;
 *   - every inter-step ref parses as `$<earlierStep>.<jsonpath>` and points to
 *     an EARLIER step than the one declaring it (no forward / self reference);
 *   - a sequence is inherently mutating -> requires `mutating_calls_confirmed`.
 */

interface ParsedRef {
  ref: string;
  fromStep: number;
  jsonPath: string;
}

/**
 * Parse a `$<stepIndex>.<jsonpath>` inter-step ref into its components. Throws
 * `ToolValidationError` on a malformed ref. `$1.id` -> { fromStep: 1,
 * jsonPath: 'id' }; `$0.data.items[0].id` -> { fromStep: 0, jsonPath:
 * 'data.items[0].id' }.
 */
function parseRef(raw: unknown): ParsedRef {
  if (typeof raw !== 'string') {
    throw new ToolValidationError(
      'pin_sequence',
      'malformed_ref',
      `Each response ref must be a string of the form '$<stepIndex>.<jsonpath>'; got ${typeof raw}.`,
    );
  }
  const m = raw.match(/^\$(\d+)\.(.+)$/);
  if (!m) {
    throw new ToolValidationError(
      'pin_sequence',
      'malformed_ref',
      `Response ref '${raw}' must match '$<stepIndex>.<jsonpath>' (e.g. '$1.id').`,
    );
  }
  return { ref: raw, fromStep: Number(m[1]), jsonPath: m[2] };
}

const VALID_ROLES = new Set(['setup', 'act', 'cleanup']);

const handler: ToolHandler = async (args, ctx) => {
  // A sequence is inherently mutating (it creates resources). Capturing one
  // requires the session-level mutating confirmation.
  if (ctx.session.mutatingCallsConfirmed !== true) {
    throw new ToolValidationError(
      'pin_sequence',
      'mutating_not_confirmed',
      'A stateful sequence is inherently mutating; pin_sequence requires the session to have mutating_calls_confirmed=true.',
    );
  }

  const rawSteps = Array.isArray(args.steps) ? (args.steps as unknown[]) : null;
  if (!rawSteps || rawSteps.length === 0) {
    throw new ToolValidationError(
      'pin_sequence',
      'missing_steps',
      '`steps` must be a non-empty array of declared sequence steps.',
    );
  }

  // The executed captures for THIS scenario, in attempt order. Each declared
  // step's `captureIndex` must point to one of these.
  const scenarioCaptures = runManager.getScenarioCaptures(ctx.session.id);

  const steps: PinnedSequenceStepDeclaration[] = [];
  let actCount = 0;
  for (let i = 0; i < rawSteps.length; i += 1) {
    const raw = rawSteps[i];
    if (raw === null || typeof raw !== 'object') {
      throw new ToolValidationError(
        'pin_sequence',
        'malformed_step',
        `Step ${i} must be an object.`,
      );
    }
    const s = raw as Record<string, unknown>;

    const kind = typeof s.kind === 'string' ? s.kind : 'http';
    if (kind !== 'http') {
      // Reserved kinds (sql/e2e) are model headroom only -- not implemented.
      throw new ToolValidationError(
        'pin_sequence',
        'unsupported_kind',
        `Step ${i} kind='${kind}' is not supported; only 'http' is implemented (sql/e2e are reserved).`,
      );
    }

    const role = typeof s.role === 'string' ? s.role : null;
    if (!role || !VALID_ROLES.has(role)) {
      throw new ToolValidationError(
        'pin_sequence',
        'invalid_role',
        `Step ${i} role must be one of setup/act/cleanup; got '${String(s.role)}'.`,
      );
    }
    if (role === 'act') actCount += 1;

    const captureIndex = typeof s.captureIndex === 'number' ? s.captureIndex : null;
    if (
      captureIndex === null ||
      !Number.isInteger(captureIndex) ||
      captureIndex < 0 ||
      captureIndex >= scenarioCaptures.length
    ) {
      throw new ToolValidationError(
        'pin_sequence',
        'invalid_capture_index',
        `Step ${i} captureIndex='${String(s.captureIndex)}' does not reference a real executed ` +
          `capture for this scenario (have ${scenarioCaptures.length} captures).`,
      );
    }

    const expectedStatus =
      typeof s.expectedStatus === 'number' ? s.expectedStatus : null;
    if (expectedStatus === null || !Number.isInteger(expectedStatus)) {
      throw new ToolValidationError(
        'pin_sequence',
        'missing_expected_status',
        `Step ${i} requires an integer expectedStatus.`,
      );
    }

    // Parse + validate inter-step refs: each must point to an EARLIER step.
    const refsRaw = Array.isArray(s.responseRefs) ? (s.responseRefs as unknown[]) : [];
    const responseRefs: ParsedRef[] = [];
    for (const refRaw of refsRaw) {
      // The LLM may pass either a bare string ref or an object carrying `ref`.
      const refStr =
        typeof refRaw === 'string'
          ? refRaw
          : refRaw && typeof refRaw === 'object'
            ? (refRaw as Record<string, unknown>).ref
            : undefined;
      const parsed = parseRef(refStr);
      if (parsed.fromStep >= i) {
        throw new ToolValidationError(
          'pin_sequence',
          'forward_ref',
          `Step ${i} references '${parsed.ref}' which points to step ${parsed.fromStep}; ` +
            `a ref must point to an EARLIER step (a value is only available once an earlier step has run).`,
        );
      }
      if (parsed.fromStep < 0) {
        throw new ToolValidationError(
          'pin_sequence',
          'invalid_ref_step',
          `Step ${i} ref '${parsed.ref}' points to a negative step index.`,
        );
      }
      responseRefs.push(parsed);
    }

    steps.push({
      captureIndex,
      role: role as 'setup' | 'act' | 'cleanup',
      kind: 'http',
      expectedStatus,
      responseRefs,
    });
  }

  if (actCount !== 1) {
    throw new ToolValidationError(
      'pin_sequence',
      'act_step_count',
      `A sequence must declare exactly ONE act step; found ${actCount}.`,
    );
  }

  const actStepIndex =
    typeof args.actStepIndex === 'number' ? args.actStepIndex : null;
  if (
    actStepIndex === null ||
    !Number.isInteger(actStepIndex) ||
    actStepIndex < 0 ||
    actStepIndex >= steps.length ||
    steps[actStepIndex].role !== 'act'
  ) {
    throw new ToolValidationError(
      'pin_sequence',
      'invalid_act_step_index',
      `actStepIndex='${String(args.actStepIndex)}' must point to the step whose role is 'act'.`,
    );
  }

  const cleanupBestEffort =
    typeof args.cleanupBestEffort === 'boolean' ? args.cleanupBestEffort : true;

  const declaration: PinnedSequenceDeclaration = {
    steps,
    actStepIndex,
    cleanupBestEffort,
  };

  runManager.recordPinnedSequence(ctx.session.id, declaration);

  // DETAIL: a sequence was pinned for this scenario -- the orchestrator will
  // assemble `sequence_json` from this declaration + the ordered captures.
  trace.detail(
    'capture.sequence.pin',
    {
      stepCount: steps.length,
      actStepIndex,
      setupCount: steps.filter((s) => s.role === 'setup').length,
      cleanupCount: steps.filter((s) => s.role === 'cleanup').length,
    },
    {
      project: ctx.session.projectId,
      arch: ctx.session.architectureId,
      session: ctx.session.id,
    },
  );

  return {
    pinned: true,
    stepCount: steps.length,
    actStepIndex,
  };
};

/**
 * Marked `terminal: true` so the loop runner exits the per-scenario loop after
 * this tool's result is fed back to the LLM (same posture as
 * `record_capture_note`). The LLM calls it once it has exercised the full
 * setup -> act -> cleanup chain and is ready to declare the roles + refs.
 */
export const pinSequenceTool: ToolRegistryEntry = {
  name: 'pin_sequence',
  description:
    'Pin a multi-step HTTP chain (setup -> act -> cleanup) you have just exercised as ONE stateful sequence oracle. Declare each executed call by its captureIndex (0-based, attempt order) with a role (setup/act/cleanup), its expectedStatus, and any inter-step references ($<step>.<jsonpath>, pointing to an EARLIER step). Exactly one step must be role=act; point actStepIndex at it. Only kind=http is supported. Calling this ENDS the scenario loop. Requires mutating_calls_confirmed.',
  parameters: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        description:
          'Ordered declared steps. Each: { captureIndex, role: setup|act|cleanup, kind: "http", expectedStatus, responseRefs?: ["$<step>.<jsonpath>"] }.',
        items: {
          type: 'object',
          properties: {
            captureIndex: { type: 'number', description: '0-based index into this scenario executed captures (attempt order).' },
            role: { type: 'string', description: 'setup | act | cleanup.' },
            kind: { type: 'string', description: 'Only "http" is supported (sql/e2e reserved).' },
            expectedStatus: { type: 'number', description: 'The HTTP status this step is asserted to reach.' },
            responseRefs: {
              type: 'array',
              description: 'Inter-step references like "$1.id" pulled from an EARLIER step live response.',
              items: { type: 'string' },
            },
          },
          required: ['captureIndex', 'role', 'expectedStatus'],
        },
      },
      actStepIndex: { type: 'number', description: 'Index INTO steps of the single act step (the behaviour under test).' },
      cleanupBestEffort: { type: 'boolean', description: 'Whether cleanup steps run best-effort at replay (default true).' },
    },
    required: ['steps', 'actStepIndex'],
    additionalProperties: false,
  },
  handler,
  terminal: true,
};
