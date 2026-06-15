/**
 * Open-Phase Sibling LLM Loop Runner — Target State Architect-Persona Conversation,
 * Open-Ended LLM Phase (Spec 2026-06-06-architect-conversation-open-ended-phase,
 * Task Group 3; S3).
 *
 * A SIBLING to `runArchitectQuestionLoop` (in `llmLoopRunner.ts`) — NOT an
 * overload. The preset runner is entry-centric (coupled to a single
 * `QuestionLibraryEntry` via `buildSubmitAnswerToolDefinition`,
 * `parseStructuredAnswer`, the `defaultsWhenUnchanged` short-circuit, and a
 * prompt assembled around `entry.code`/`entry.expectedAnswerShape`/`entry.choices`).
 * NONE of that fits the open phase's "propose candidate areas" / "propose options
 * for a free-form topic" tasks, so this module builds its OWN prompt assembly
 * from the open-phase grounding (Task Group 2) and carries its OWN four tools.
 *
 * What it REUSES verbatim from the preset loop (S3):
 *   - the `ArchitectLlmClient` seam (`callLlmToolLoop`) — mocked at this boundary
 *     in every test, consistent with the existing suites;
 *   - the SAME hard limits (5 rounds / 30s per call / 120s wall clock — the
 *     `ARCHITECT_LOOP_*` constants, imported, not re-declared);
 *   - the SAME `withTimeout` synthetic-timer race + abort handling;
 *   - the SAME failure-to-`error` mapping shape (a structured `OpenPhaseLoopResult`
 *     the coordinator translates into the closed-union `error` turn — the
 *     `ConversationErrorKind` values line up so the coordinator's existing
 *     error-turn mapping is reused).
 *
 * The four tools are the LLM's structured output surface for the open phase:
 *   - `suggest-candidate-areas`  (P3) — emit grounded candidate areas for the
 *                                       open-phase prompt turn (sub-phase a entry);
 *   - `propose-options-for-topic`(S4) — concrete options for a user-raised topic,
 *                                       single- vs multi-select PER TOPIC + a
 *                                       "something else…" free-text escape,
 *                                       explicitly NO "Not applicable" (P4);
 *   - `capture-user-decision`         — produce the structured user-pick decision
 *                                       intent (the WRITE itself is Task Group 4);
 *   - `record-discussion-note`        — produce the per-topic structured note
 *                                       intent at the end of sub-phase (b) (the
 *                                       WRITE itself is Task Group 4).
 *
 * Each tool runs a single bounded LLM round (one `callLlmToolLoop` call with
 * `toolChoice` pinned to the tool) and returns the parsed tool arguments — there
 * is no multi-round "submit answer" recovery dance here because the open-phase
 * tools are deterministic producers, not free-text parsers. The hard limits +
 * abort are nonetheless enforced around the single call so a hung / over-budget
 * call maps to the SAME `error`-turn behaviour as the preset loop (per S3 + 3.1).
 *
 * IMPORTANT: like the preset runner, failures surface as structured result
 * values, NOT thrown exceptions. The LLM is mocked at the `ArchitectLlmClient`
 * boundary in every test.
 */

import type {
  ArchitectChatMessage,
  ArchitectLlmClient,
  ArchitectToolCall,
  ArchitectToolDefinition,
  CallLlmToolLoopResponse,
} from './architectLlmClient';
import {
  ARCHITECT_LOOP_PER_CALL_TIMEOUT_MS,
  ARCHITECT_LOOP_ROUND_LIMIT,
  ARCHITECT_LOOP_WALL_CLOCK_MS,
} from './llmLoopRunner';
import type {
  ProposedOption,
  SuggestedCandidateArea,
} from './turnShape';

// ---------------------------------------------------------------------------
// Tool names (final names — S3 leaves them at implementation discretion). Kebab
// per the spec wording; the underlying LLM tool-call wire is name-agnostic.
// ---------------------------------------------------------------------------

export const SUGGEST_CANDIDATE_AREAS_TOOL = 'suggest-candidate-areas';
export const PROPOSE_OPTIONS_FOR_TOPIC_TOOL = 'propose-options-for-topic';
export const CAPTURE_USER_DECISION_TOOL = 'capture-user-decision';
export const RECORD_DISCUSSION_NOTE_TOOL = 'record-discussion-note';

// ---------------------------------------------------------------------------
// Result discriminator — mirrors the preset loop's error vocabulary so the
// coordinator reuses the same failure-to-`error`-turn mapping.
// ---------------------------------------------------------------------------

/**
 * Error kinds the open-phase loop surfaces. A subset of the preset loop's
 * `LoopErrorKind` (no `round-budget-exhausted` — the open-phase tools are
 * single-round producers) PLUS `tool-output-malformed` for a tool call whose
 * arguments fail validation within budget. All map onto the closed-union
 * `ConversationErrorKind` via the coordinator (see `mapOpenPhaseErrorKind`).
 */
export type OpenPhaseLoopErrorKind =
  | 'llm-call-timeout'
  | 'wall-clock-exceeded'
  | 'aborted'
  | 'llm-call-failed'
  | 'tool-output-malformed';

export interface OpenPhaseLoopOkResult<TPayload> {
  outcome: 'ok';
  /** The parsed, validated tool payload (shape depends on which tool ran). */
  payload: TPayload;
  durationMs: number;
}

export interface OpenPhaseLoopErrorResult {
  outcome: 'error';
  errorKind: OpenPhaseLoopErrorKind;
  errorMessage: string;
  durationMs: number;
  recoverableHint?: string;
}

export type OpenPhaseLoopResult<TPayload> =
  | OpenPhaseLoopOkResult<TPayload>
  | OpenPhaseLoopErrorResult;

// ---------------------------------------------------------------------------
// withTimeout — synthetic timer race; tagged Error for the runner to detect.
// (Structurally identical to the preset loop's helper; kept local so this
// module is independent of the preset runner's internal — non-exported — copy.)
// ---------------------------------------------------------------------------

interface TimeoutTaggedError extends Error {
  __architectLlmTimeout?: boolean;
}

function withTimeout<T>(p: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(
        `LLM call '${label}' exceeded the ${timeoutMs}ms per-call timeout.`,
      ) as TimeoutTaggedError;
      err.__architectLlmTimeout = true;
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([p, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

function isTimeoutError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as TimeoutTaggedError).__architectLlmTimeout === true
  );
}

// ---------------------------------------------------------------------------
// Shared loop options
// ---------------------------------------------------------------------------

interface OpenPhaseCallOptions {
  /** LLM client (mocked at this boundary in all tests). */
  llmClient: ArchitectLlmClient;
  /** Pre-assembled grounding block (Task Group 2's `buildOpenPhaseGrounding`). */
  grounding: string;
  /** Optional external abort signal (e.g. user-cancel from the chat UI). */
  abortSignal?: AbortSignal;
  /** Optional limit overrides (test-only — production reads the constants). */
  roundLimit?: number;
  perCallTimeoutMs?: number;
  wallClockMs?: number;
  /** Optional model name forwarded to the LLM relay. */
  model?: string;
  /** Optional clock for deterministic tests (defaults to Date.now). */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

function suggestCandidateAreasToolDef(): ArchitectToolDefinition {
  return {
    type: 'function',
    function: {
      name: SUGGEST_CANDIDATE_AREAS_TOOL,
      description:
        'Propose a few migration-relevant ARCHITECTURE-DECISION areas the architect ' +
        'has not yet decided, grounded in the supplied context. Each area is a short ' +
        'user-facing label plus an optional one-line rationale. Do NOT propose areas ' +
        'already covered by the captured decisions.',
      parameters: {
        type: 'object',
        properties: {
          areas: {
            type: 'array',
            description: 'The proposed candidate areas (3-6 is ideal).',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                rationale: { type: 'string' },
              },
              required: ['label'],
            },
          },
          promptText: {
            type: 'string',
            description:
              "The architect's short opener message (e.g. \"We've covered the standard " +
              'decisions — are there other areas you\'d like to decide?").',
          },
        },
        required: ['areas'],
      },
    },
  };
}

function proposeOptionsForTopicToolDef(): ArchitectToolDefinition {
  return {
    type: 'function',
    function: {
      name: PROPOSE_OPTIONS_FOR_TOPIC_TOOL,
      description:
        'Propose concrete options for the user-raised topic. Choose ' +
        "selectionMode='single' (mirrors a single-choice question) or " +
        "'multi' (mirrors a multi-choice question) per topic. ALWAYS allow a " +
        '"something else…" free-text escape (allowFreeTextEscape MUST be true). ' +
        'NEVER include a "Not applicable" / "not_applicable" option — that opt-out ' +
        'exists ONLY on the preset questions, not on user-raised topics.',
      parameters: {
        type: 'object',
        properties: {
          topicLabel: {
            type: 'string',
            description: 'The user-facing topic label these options are for.',
          },
          selectionMode: {
            type: 'string',
            enum: ['single', 'multi'],
            description: "'single' or 'multi' — chosen per topic.",
          },
          options: {
            type: 'array',
            description: 'The concrete options (2-6 is ideal).',
            items: {
              type: 'object',
              properties: {
                value: { type: 'string' },
                label: { type: 'string' },
              },
              required: ['value'],
            },
          },
          freeTextEscapeLabel: {
            type: 'string',
            description: 'Optional friendly label for the free-text escape ("Something else…").',
          },
        },
        required: ['topicLabel', 'selectionMode', 'options'],
      },
    },
  };
}

function captureUserDecisionToolDef(): ArchitectToolDefinition {
  return {
    type: 'function',
    function: {
      name: CAPTURE_USER_DECISION_TOOL,
      description:
        "Capture the user's pick on a user-raised topic as a first-class decision. " +
        'Provide the topicLabel and EITHER selectedValues (the chosen option value(s)) ' +
        'OR freeTextValue (the verbatim "something else…" text) — never both empty. ' +
        'answerSummary is an optional one-line human-readable summary of the pick.',
      parameters: {
        type: 'object',
        properties: {
          topicLabel: { type: 'string' },
          selectedValues: {
            type: 'array',
            description: 'The selected option value(s); omit / empty when the free-text escape was taken.',
            items: { type: 'string' },
          },
          freeTextValue: {
            type: 'string',
            description: 'The verbatim "something else…" value, when the escape was taken.',
          },
          answerSummary: {
            type: 'string',
            description: 'Optional one-line human-readable summary of the decision.',
          },
        },
        required: ['topicLabel'],
      },
    },
  };
}

function recordDiscussionNoteToolDef(): ArchitectToolDefinition {
  return {
    type: 'function',
    function: {
      name: RECORD_DISCUSSION_NOTE_TOOL,
      description:
        'Summarise the free-form discussion into PER-TOPIC structured notes (NOT a ' +
        'raw-transcript blob). Emit one note object per distinct topic discussed. ' +
        'Each note has a short topicLabel and a noteText body. Notes are migration ' +
        'context for the backlog/spec generation — they are NOT first-class decisions.',
      parameters: {
        type: 'object',
        properties: {
          notes: {
            type: 'array',
            description: 'One structured note per distinct topic discussed.',
            items: {
              type: 'object',
              properties: {
                topicLabel: { type: 'string' },
                noteText: { type: 'string' },
              },
              required: ['topicLabel', 'noteText'],
            },
          },
        },
        required: ['notes'],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tool payload shapes (the parsed, validated outputs)
// ---------------------------------------------------------------------------

export interface SuggestCandidateAreasPayload {
  promptText: string;
  areas: SuggestedCandidateArea[];
}

export interface ProposeOptionsForTopicPayload {
  topicLabel: string;
  selectionMode: 'single' | 'multi';
  options: ProposedOption[];
  freeTextEscapeLabel?: string;
}

export interface CaptureUserDecisionPayload {
  topicLabel: string;
  selectedValues: string[];
  freeTextValue?: string;
  answerSummary?: string;
}

export interface DiscussionNote {
  topicLabel: string;
  noteText: string;
}

export interface RecordDiscussionNotePayload {
  notes: DiscussionNote[];
}

// ---------------------------------------------------------------------------
// Argument parsing for tool calls
// ---------------------------------------------------------------------------

function parseToolArguments(call: ArchitectToolCall): {
  ok: true;
  args: Record<string, unknown>;
} | {
  ok: false;
  reason: string;
} {
  if (!call.function.arguments) {
    return { ok: true, args: {} };
  }
  try {
    const parsed = JSON.parse(call.function.arguments) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'Tool arguments JSON parsed to a non-object value.' };
    }
    return { ok: true, args: parsed as Record<string, unknown> };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Tool arguments were not valid JSON: ${message}` };
  }
}

function findToolCall(
  response: CallLlmToolLoopResponse,
  toolName: string,
): ArchitectToolCall | null {
  const calls = response.message.tool_calls ?? [];
  return calls.find((c) => c.function.name === toolName) ?? null;
}

// ---------------------------------------------------------------------------
// Single bounded LLM round under the shared limits + abort.
//
// Runs exactly one `callLlmToolLoop` with `toolChoice` pinned to `toolName`,
// enforcing the SAME per-call timeout / wall-clock / abort as the preset loop,
// and returns the located tool call's parsed arguments. A `validate` callback
// maps the raw args to a typed payload (returning a rejection reason on bad
// shape → `tool-output-malformed`). Failures are structured results, never throws.
// ---------------------------------------------------------------------------

async function runSingleToolRound<TPayload>(
  opts: OpenPhaseCallOptions,
  toolName: string,
  toolDef: ArchitectToolDefinition,
  messages: ArchitectChatMessage[],
  validate: (
    args: Record<string, unknown>,
  ) => { ok: true; payload: TPayload } | { ok: false; reason: string },
): Promise<OpenPhaseLoopResult<TPayload>> {
  const now = opts.now ?? Date.now;
  const perCallTimeoutMs = opts.perCallTimeoutMs ?? ARCHITECT_LOOP_PER_CALL_TIMEOUT_MS;
  const wallClockMs = opts.wallClockMs ?? ARCHITECT_LOOP_WALL_CLOCK_MS;
  // `roundLimit` is accepted for parity with the preset loop and to satisfy the
  // SAME-limits contract (S3); a single-round producer never exceeds it, but the
  // pre-flight guard below keeps a roundLimit:0 override honest.
  const roundLimit = opts.roundLimit ?? ARCHITECT_LOOP_ROUND_LIMIT;
  const startedAt = now();

  // ---- Abort up-front ----
  if (opts.abortSignal?.aborted) {
    return {
      outcome: 'error',
      errorKind: 'aborted',
      errorMessage: `Open-phase '${toolName}' aborted before the LLM call via external signal.`,
      durationMs: now() - startedAt,
    };
  }

  // ---- Degenerate budget (test-only override) ----
  if (roundLimit <= 0) {
    return {
      outcome: 'error',
      errorKind: 'wall-clock-exceeded',
      errorMessage: `Open-phase '${toolName}' had no round budget (roundLimit=${roundLimit}).`,
      durationMs: now() - startedAt,
    };
  }

  // ---- Wall-clock pre-check ----
  if (now() - startedAt >= wallClockMs) {
    return {
      outcome: 'error',
      errorKind: 'wall-clock-exceeded',
      errorMessage: `Open-phase '${toolName}' wall-clock cap (${wallClockMs}ms) reached before the LLM call.`,
      durationMs: now() - startedAt,
    };
  }

  // ---- LLM round-trip under the per-call timeout ----
  let relayResult: CallLlmToolLoopResponse;
  try {
    relayResult = await withTimeout(
      opts.llmClient.callLlmToolLoop({
        messages,
        tools: [toolDef],
        toolChoice: { type: 'function', function: { name: toolName } },
        model: opts.model,
        timeoutMs: perCallTimeoutMs,
      }),
      perCallTimeoutMs,
      `architect-open-phase:${toolName}`,
    );
  } catch (err) {
    if (isTimeoutError(err)) {
      return {
        outcome: 'error',
        errorKind: 'llm-call-timeout',
        errorMessage: `Open-phase '${toolName}' LLM call exceeded the ${perCallTimeoutMs}ms per-call timeout.`,
        durationMs: now() - startedAt,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      outcome: 'error',
      errorKind: 'llm-call-failed',
      errorMessage: `Open-phase '${toolName}' LLM relay call failed: ${message}`,
      durationMs: now() - startedAt,
    };
  }

  // ---- Abort raised during the call ----
  if (opts.abortSignal?.aborted) {
    return {
      outcome: 'error',
      errorKind: 'aborted',
      errorMessage: `Open-phase '${toolName}' aborted during the LLM call via external signal.`,
      durationMs: now() - startedAt,
    };
  }

  // ---- Wall-clock post-check ----
  if (now() - startedAt >= wallClockMs) {
    return {
      outcome: 'error',
      errorKind: 'wall-clock-exceeded',
      errorMessage: `Open-phase '${toolName}' wall-clock cap (${wallClockMs}ms) reached after the LLM call.`,
      durationMs: now() - startedAt,
    };
  }

  const call = findToolCall(relayResult, toolName);
  if (!call) {
    return {
      outcome: 'error',
      errorKind: 'tool-output-malformed',
      errorMessage: `Open-phase LLM did not call the required '${toolName}' tool.`,
      durationMs: now() - startedAt,
      recoverableHint: `Retry; the model must call '${toolName}'.`,
    };
  }

  const parsed = parseToolArguments(call);
  if (!parsed.ok) {
    return {
      outcome: 'error',
      errorKind: 'tool-output-malformed',
      errorMessage: `Open-phase '${toolName}' arguments were malformed: ${parsed.reason}`,
      durationMs: now() - startedAt,
    };
  }

  const validated = validate(parsed.args);
  if (!validated.ok) {
    return {
      outcome: 'error',
      errorKind: 'tool-output-malformed',
      errorMessage: `Open-phase '${toolName}' output failed validation: ${validated.reason}`,
      durationMs: now() - startedAt,
    };
  }

  return {
    outcome: 'ok',
    payload: validated.payload,
    durationMs: now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// Validators (raw tool args → typed payload)
// ---------------------------------------------------------------------------

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

function validateSuggestCandidateAreas(
  args: Record<string, unknown>,
): { ok: true; payload: SuggestCandidateAreasPayload } | { ok: false; reason: string } {
  const rawAreas = args.areas;
  if (!Array.isArray(rawAreas)) {
    return { ok: false, reason: "'areas' must be an array." };
  }
  const areas: SuggestedCandidateArea[] = [];
  for (const a of rawAreas) {
    if (!a || typeof a !== 'object') continue;
    const obj = a as Record<string, unknown>;
    const label = asNonEmptyString(obj.label);
    if (!label) continue;
    const rationale = asNonEmptyString(obj.rationale);
    areas.push(rationale ? { label, rationale } : { label });
  }
  const promptText =
    asNonEmptyString(args.promptText) ??
    "We've covered the standard decisions — are there other areas you'd like to decide?";
  return { ok: true, payload: { promptText, areas } };
}

function validateProposeOptions(
  args: Record<string, unknown>,
): { ok: true; payload: ProposeOptionsForTopicPayload } | { ok: false; reason: string } {
  const topicLabel = asNonEmptyString(args.topicLabel);
  if (!topicLabel) return { ok: false, reason: "'topicLabel' is required." };
  const selectionMode = args.selectionMode === 'multi' ? 'multi' : 'single';
  const rawOptions = args.options;
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
    return { ok: false, reason: "'options' must be a non-empty array." };
  }
  const options: ProposedOption[] = [];
  for (const o of rawOptions) {
    if (!o || typeof o !== 'object') continue;
    const obj = o as Record<string, unknown>;
    const value = asNonEmptyString(obj.value);
    if (!value) continue;
    // P4: defensively drop any "not applicable" sentinel the model may emit —
    // user-raised topics NEVER carry the universal opt-out.
    if (value.trim().toLowerCase().replace(/[\s_-]+/g, '') === 'notapplicable') {
      continue;
    }
    const label = asNonEmptyString(obj.label);
    options.push(label ? { value, label } : { value });
  }
  if (options.length === 0) {
    return { ok: false, reason: 'No valid options after filtering.' };
  }
  const freeTextEscapeLabel = asNonEmptyString(args.freeTextEscapeLabel) ?? undefined;
  return {
    ok: true,
    payload: { topicLabel, selectionMode, options, freeTextEscapeLabel },
  };
}

function validateCaptureUserDecision(
  args: Record<string, unknown>,
): { ok: true; payload: CaptureUserDecisionPayload } | { ok: false; reason: string } {
  const topicLabel = asNonEmptyString(args.topicLabel);
  if (!topicLabel) return { ok: false, reason: "'topicLabel' is required." };
  const selectedValues: string[] = Array.isArray(args.selectedValues)
    ? (args.selectedValues as unknown[]).filter(
        (v): v is string => typeof v === 'string' && v.trim().length > 0,
      )
    : [];
  const freeTextValue = asNonEmptyString(args.freeTextValue) ?? undefined;
  if (selectedValues.length === 0 && !freeTextValue) {
    return {
      ok: false,
      reason: 'Provide selectedValues or freeTextValue (the pick cannot be empty).',
    };
  }
  const answerSummary = asNonEmptyString(args.answerSummary) ?? undefined;
  return {
    ok: true,
    payload: { topicLabel, selectedValues, freeTextValue, answerSummary },
  };
}

function validateRecordDiscussionNote(
  args: Record<string, unknown>,
): { ok: true; payload: RecordDiscussionNotePayload } | { ok: false; reason: string } {
  const rawNotes = args.notes;
  if (!Array.isArray(rawNotes)) {
    return { ok: false, reason: "'notes' must be an array." };
  }
  const notes: DiscussionNote[] = [];
  for (const n of rawNotes) {
    if (!n || typeof n !== 'object') continue;
    const obj = n as Record<string, unknown>;
    const topicLabel = asNonEmptyString(obj.topicLabel);
    const noteText = asNonEmptyString(obj.noteText);
    if (!topicLabel || !noteText) continue;
    notes.push({ topicLabel, noteText });
  }
  // An empty notes array is VALID — sub-phase (b) may have yielded nothing
  // note-worthy (or been skipped). The coordinator writes zero note rows then.
  return { ok: true, payload: { notes } };
}

// ---------------------------------------------------------------------------
// Prompt assembly (the open phase's OWN — NOT the entry-centric preset prompt)
// ---------------------------------------------------------------------------

function systemMessage(): ArchitectChatMessage {
  return {
    role: 'system',
    content:
      'You are the architect-conversation assistant for the OPEN PHASE that begins ' +
      'after the standard preset decisions have been walked. You help the architect ' +
      'decide migration-relevant topics they raise, and you summarise free-form ' +
      'discussion into structured notes. You MUST respond by calling the single ' +
      'provided tool with well-formed arguments. NEVER offer a "Not applicable" ' +
      'option for user-raised topics — that opt-out exists only on the preset questions.',
  };
}

function groundingMessage(grounding: string): ArchitectChatMessage {
  return {
    role: 'user',
    content: `Migration grounding context for the open phase:\n${grounding}`,
  };
}

// ---------------------------------------------------------------------------
// Public entry points — one per tool
// ---------------------------------------------------------------------------

/**
 * Sub-phase (a) ENTRY (P3): ask the LLM to propose a few grounded candidate
 * areas + the opener prompt text for the `open-phase-prompt` turn.
 */
export async function suggestCandidateAreas(
  opts: OpenPhaseCallOptions,
): Promise<OpenPhaseLoopResult<SuggestCandidateAreasPayload>> {
  const messages: ArchitectChatMessage[] = [
    systemMessage(),
    groundingMessage(opts.grounding),
    {
      role: 'user',
      content:
        'Propose a few migration-relevant decision areas the architect has not yet ' +
        'decided (grounded in the context above), plus a short opener message. Call ' +
        `the '${SUGGEST_CANDIDATE_AREAS_TOOL}' tool.`,
    },
  ];
  return runSingleToolRound(
    opts,
    SUGGEST_CANDIDATE_AREAS_TOOL,
    suggestCandidateAreasToolDef(),
    messages,
    validateSuggestCandidateAreas,
  );
}

/**
 * Sub-phase (a): given a user-raised topic, propose concrete options
 * (single/multi PER TOPIC + a "something else…" escape; NO "Not applicable" — P4/S4).
 */
export async function proposeOptionsForTopic(
  opts: OpenPhaseCallOptions & { topicLabel: string; topicText?: string },
): Promise<OpenPhaseLoopResult<ProposeOptionsForTopicPayload>> {
  const topicDescription = opts.topicText
    ? `${opts.topicLabel} (the user phrased it: "${opts.topicText}")`
    : opts.topicLabel;
  const messages: ArchitectChatMessage[] = [
    systemMessage(),
    groundingMessage(opts.grounding),
    {
      role: 'user',
      content:
        `The architect raised this topic to decide: ${topicDescription}.\n` +
        `Propose concrete options for it. Choose selectionMode 'single' or 'multi' ` +
        `as fits the topic. Do NOT include any "Not applicable" option. Call the ` +
        `'${PROPOSE_OPTIONS_FOR_TOPIC_TOOL}' tool.`,
    },
  ];
  return runSingleToolRound(
    opts,
    PROPOSE_OPTIONS_FOR_TOPIC_TOOL,
    proposeOptionsForTopicToolDef(),
    messages,
    validateProposeOptions,
  );
}

/**
 * Sub-phase (a): produce the structured user-pick decision intent for the
 * topic + the option(s) / free-text the user chose. The WRITE is Task Group 4.
 */
export async function captureUserDecision(
  opts: OpenPhaseCallOptions & {
    topicLabel: string;
    selectedValues?: string[];
    freeTextValue?: string;
  },
): Promise<OpenPhaseLoopResult<CaptureUserDecisionPayload>> {
  const picked = opts.freeTextValue
    ? `the free-text answer "${opts.freeTextValue}"`
    : `the option(s): ${JSON.stringify(opts.selectedValues ?? [])}`;
  const messages: ArchitectChatMessage[] = [
    systemMessage(),
    groundingMessage(opts.grounding),
    {
      role: 'user',
      content:
        `For the topic "${opts.topicLabel}" the architect picked ${picked}.\n` +
        `Capture this as a first-class decision. Call the ` +
        `'${CAPTURE_USER_DECISION_TOOL}' tool with the topicLabel and the pick.`,
    },
  ];
  return runSingleToolRound(
    opts,
    CAPTURE_USER_DECISION_TOOL,
    captureUserDecisionToolDef(),
    messages,
    validateCaptureUserDecision,
  );
}

/**
 * Sub-phase (b) END: summarise the free-form discussion into PER-TOPIC
 * structured notes (Q2a). The WRITE (per-note-unique `note.<slug>` rows) is
 * Task Group 4. `transcript` is the verbatim free-form discussion to summarise.
 */
export async function recordDiscussionNotes(
  opts: OpenPhaseCallOptions & { transcript: string },
): Promise<OpenPhaseLoopResult<RecordDiscussionNotePayload>> {
  const messages: ArchitectChatMessage[] = [
    systemMessage(),
    groundingMessage(opts.grounding),
    {
      role: 'user',
      content:
        'Summarise the following free-form discussion into PER-TOPIC structured ' +
        `notes (one note object per distinct topic). Do NOT produce a raw-transcript ` +
        `blob. Call the '${RECORD_DISCUSSION_NOTE_TOOL}' tool.\n\n` +
        `Discussion:\n${opts.transcript}`,
    },
  ];
  return runSingleToolRound(
    opts,
    RECORD_DISCUSSION_NOTE_TOOL,
    recordDiscussionNoteToolDef(),
    messages,
    validateRecordDiscussionNote,
  );
}

/**
 * A genuine free-form conversational reply for sub-phase (b) (the multi-turn
 * chat). Unlike the four structured tools this is a plain assistant message —
 * no tool call — so the architect can converse naturally. Enforces the SAME
 * per-call timeout / wall-clock / abort. Returns the assistant text (or an
 * `error` result on failure).
 */
export async function freeFormReply(
  opts: OpenPhaseCallOptions & { history: ArchitectChatMessage[]; userMessage: string },
): Promise<OpenPhaseLoopResult<{ replyText: string }>> {
  const now = opts.now ?? Date.now;
  const perCallTimeoutMs = opts.perCallTimeoutMs ?? ARCHITECT_LOOP_PER_CALL_TIMEOUT_MS;
  const wallClockMs = opts.wallClockMs ?? ARCHITECT_LOOP_WALL_CLOCK_MS;
  const startedAt = now();

  if (opts.abortSignal?.aborted) {
    return {
      outcome: 'error',
      errorKind: 'aborted',
      errorMessage: 'Open-phase free-form reply aborted before the LLM call via external signal.',
      durationMs: now() - startedAt,
    };
  }

  const messages: ArchitectChatMessage[] = [
    systemMessage(),
    groundingMessage(opts.grounding),
    ...opts.history,
    { role: 'user', content: opts.userMessage },
  ];

  let relayResult: CallLlmToolLoopResponse;
  try {
    relayResult = await withTimeout(
      opts.llmClient.callLlmToolLoop({
        messages,
        tools: [],
        toolChoice: 'none',
        model: opts.model,
        timeoutMs: perCallTimeoutMs,
      }),
      perCallTimeoutMs,
      'architect-open-phase:free-form-reply',
    );
  } catch (err) {
    if (isTimeoutError(err)) {
      return {
        outcome: 'error',
        errorKind: 'llm-call-timeout',
        errorMessage: `Open-phase free-form reply exceeded the ${perCallTimeoutMs}ms per-call timeout.`,
        durationMs: now() - startedAt,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      outcome: 'error',
      errorKind: 'llm-call-failed',
      errorMessage: `Open-phase free-form reply LLM relay call failed: ${message}`,
      durationMs: now() - startedAt,
    };
  }

  if (now() - startedAt >= wallClockMs) {
    return {
      outcome: 'error',
      errorKind: 'wall-clock-exceeded',
      errorMessage: `Open-phase free-form reply wall-clock cap (${wallClockMs}ms) reached.`,
      durationMs: now() - startedAt,
    };
  }

  const replyText = asNonEmptyString(relayResult.message.content) ?? '';
  return { outcome: 'ok', payload: { replyText }, durationMs: now() - startedAt };
}
