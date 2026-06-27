/**
 * Architect Conversation API client.
 *
 * Spec: 2026-05-24 Target State Architect-Persona Conversation -- Commit 5
 *
 * Thin client around the gateway orchestration endpoints that surface the
 * captured-decisions data plane and the conversation transcript helpers for
 * the Architect Conversation view-mode tab.
 *
 * Endpoint surface (gateway-mounted; the gateway routes proxy/orchestrate
 * Spec 2's POST captured-decisions, Spec 2's conversation thread store, and
 * the Commit 3+4 orchestrator methods):
 *
 *   GET    /api/projects/{p}/active-target-architecture-id
 *   GET    /api/projects/{p}/target-architectures/{t}/architect-conversation
 *   POST   /api/projects/{p}/target-architectures/{t}/architect-conversation/open
 *   POST   /api/projects/{p}/target-architectures/{t}/architect-conversation/close
 *   POST   /api/projects/{p}/target-architectures/{t}/architect-conversation/answer
 *   POST   /api/projects/{p}/target-architectures/{t}/architect-conversation/cascade/accept-batch
 *   POST   /api/projects/{p}/target-architectures/{t}/architect-conversation/cascade/override
 *   POST   /api/projects/{p}/target-architectures/{t}/architect-conversation/revise
 *   POST   /api/projects/{p}/target-architectures/{t}/architect-conversation/exception
 *
 * Mocked end-to-end in the Commit-5 frontend test suite -- the routes
 * themselves are owned by the gateway orchestration layer; this client only
 * defines the typed contract the UI consumes.
 *
 * Per Q18 every call is synchronous (no SSE / streaming). The UI applies a
 * 60-second per-turn frontend timeout via `AbortController` -- exposed here as
 * a default `requestTimeoutMs` argument so tests can override.
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Public types -- mirror the gateway turnShape.ts union (Commit 3)
// ============================================================================

/**
 * Closed Q12 scope_ref_type set. Mirrors the canonical member list in
 * `gateway/src/config/architect-conversation/scopeRefType.json` -- the
 * gateway's `questionLibrary.ts` derives its own `ScopeRefType` union
 * from that JSON file. Drift between this frontend mirror and the
 * gateway-side JSON is enforced at test-time by
 * `src/api/__tests__/scopeRefType.contractWithGateway.test.ts`.
 */
export type ScopeRefType =
  | 'service'
  | 'interface'
  | 'endpoint'
  | 'physical_data_entity'
  | 'physical_data_attribute'
  | 'method'
  | 'class';

export const ALLOWED_SCOPE_REF_TYPES: readonly ScopeRefType[] = [
  'service',
  'interface',
  'endpoint',
  'physical_data_entity',
  'physical_data_attribute',
  'method',
  'class',
];

// ----------------------------------------------------------------------------
// Decoupled {framework, version} captured-answer shape
//   Spec: 2026-06-24-target-conversation-tech-stack-constraints (FR5 + FR8)
//
// Mirrors the gateway source-of-truth
// (gateway/src/config/architect-conversation/frameworkVersionShape.ts). The
// seven versioned codes (service.language / service.framework /
// service.runtime / db.engine / db.driver / ui.framework / build.tool) capture
// ONE resolved { framework, version } value (rendered as a single chip such as
// `Spring Boot 3.4.1`) -- never a framework x version cartesian product.
//
// The closed version SENTINEL set is mirrored from
// gateway/src/config/architect-conversation/frameworkVersionShape.json. Drift
// between this frontend mirror and the gateway-side JSON is enforced at
// test-time by src/api/__tests__/frameworkVersionShape.contractWithGateway.test.ts
// (mirroring the ScopeRefType precedent).
// ----------------------------------------------------------------------------

/**
 * Closed set of version-axis SENTINEL strings (non-concrete versions). A
 * concrete version is any non-empty string NOT in this set (e.g. `3.4.1`).
 * `version-unknown` is the Spec 3 manifest-auto-answer state when a manifest
 * cannot resolve a concrete version (steering degrades gracefully -- no guess).
 */
export type VersionSentinel = 'version-unknown';

export const VERSION_SENTINELS: readonly VersionSentinel[] = ['version-unknown'];

/** The Spec 3 "manifest could not resolve a concrete version" sentinel. */
export const VERSION_UNKNOWN: VersionSentinel = 'version-unknown';

/** True iff `version` is a known sentinel (non-concrete) rather than a real version. */
export function isVersionSentinel(version: string): version is VersionSentinel {
  return (VERSION_SENTINELS as readonly string[]).includes(version);
}

/**
 * The resolved `{ framework, version }` value captured for a versioned question.
 * `framework` is the chosen single-select chip; `version` is a concrete version
 * string OR a {@link VersionSentinel}. Both fields are required + non-empty.
 * Mirrors the gateway `FrameworkVersion` shape field-for-field.
 */
export interface FrameworkVersion {
  framework: string;
  version: string;
}

/**
 * Resolve the SINGLE chip label for a `{ framework, version }` pair (mirrors the
 * gateway `resolveFrameworkVersionChip`). A `version-unknown` sentinel renders as
 * `<framework> (version unknown)`; any other concrete version is appended
 * verbatim. Exactly one chip per pair -- never a cartesian grid.
 */
export function resolveFrameworkVersionChip(value: FrameworkVersion): string {
  if (isVersionSentinel(value.version)) {
    if (value.version === VERSION_UNKNOWN) {
      return value.framework + ' (version unknown)';
    }
    return value.framework + ' (' + value.version + ')';
  }
  return (value.framework + ' ' + value.version).trim();
}

/**
 * Type guard: a structured `{ framework, version }` object whose both fields are
 * strings. Used to discriminate a versioned captured value from a plain-string
 * single-choice value when resolving a turn's `answerValue` client-side.
 */
function isFrameworkVersionObject(v: unknown): v is FrameworkVersion {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { framework?: unknown }).framework === 'string' &&
    typeof (v as { version?: unknown }).version === 'string'
  );
}

/**
 * Resolve the human-readable label for a captured-decision `answerValue` carried
 * on the decision-captured / cascade-accepted / cascade-overridden /
 * exception-pinned turns (which carry `answerValue` but NOT `answerSummary`,
 * unlike `CapturedDecisionRow`). Produces the SAME resolved chip the SummaryPanel
 * shows via `answerSummary`, resolved CLIENT-SIDE from the capture envelope:
 *
 *   - the JSON `{ value, sourceQuote, sourceFile }` envelope whose inner `value`
 *     is a `{ framework, version }` object  -> `resolveFrameworkVersionChip`
 *     (e.g. `Spring Boot 4.0`);
 *   - the envelope whose inner `value` is a plain string -> that string verbatim;
 *   - a bare `{ framework, version }` object -> `resolveFrameworkVersionChip`;
 *   - any plain single-choice string (not JSON) -> the string verbatim.
 *
 * Never throws: a non-JSON / non-envelope value falls through to `String(...)`,
 * matching the prior raw `String(answerValue)` behaviour for legacy rows.
 */
export function resolveCapturedAnswerLabel(answerValue: unknown): string {
  // A bare structured value already in { framework, version } shape.
  if (isFrameworkVersionObject(answerValue)) {
    return resolveFrameworkVersionChip(answerValue);
  }
  if (typeof answerValue !== 'string') {
    return String(answerValue);
  }
  // Try to unwrap the capture envelope. A plain single-choice answer is not
  // valid JSON and falls through to the verbatim string.
  try {
    const parsed: unknown = JSON.parse(answerValue);
    if (parsed !== null && typeof parsed === 'object' && 'value' in parsed) {
      const inner = (parsed as { value: unknown }).value;
      if (isFrameworkVersionObject(inner)) return resolveFrameworkVersionChip(inner);
      if (typeof inner === 'string') return inner;
      return String(inner);
    }
  } catch {
    // Not JSON -> a plain single-choice string answer; fall through.
  }
  return answerValue;
}


// ----------------------------------------------------------------------------
// API like-for-like lock — `api.surfaceMode` + the `L` (locked) treatment marker
//   Spec: 2026-06-24-target-conversation-tech-stack-constraints (FR9 / FR1 `L`)
//
// Mirrors the gateway source-of-truth
// (gateway/src/config/architect-conversation/apiSurfaceMode.ts +
// apiSurfaceMode.json). The migration mode `api.surfaceMode` governs the API
// surface (the whole of Group B): under `like_for_like` Group B is auto-answered
// + LOCKED from the reconciled source contract / baseline (treatment class `L`,
// read-only, NOT asked); under `may_change` Group B reverts to its underlying
// H/I/G class and is asked normally. `like_for_like` is the DEFAULT whenever a
// reconciled baseline / oracle is present.
//
// The closed mode set + the `locked` treatment marker are mirrored from
// gateway/src/config/architect-conversation/apiSurfaceMode.json. Drift between
// this frontend mirror and the gateway-side JSON is enforced at test-time by
// src/api/__tests__/apiSurfaceMode.contractWithGateway.test.ts (mirroring the
// ScopeRefType precedent).
// ----------------------------------------------------------------------------

/**
 * The closed set of `api.surfaceMode` migration modes (FR9):
 *   - 'like_for_like' Group B auto-answered + LOCKED from source, NOT asked.
 *   - 'may_change'    Group B reverts to its underlying H/I/G class + asked.
 */
export type ApiSurfaceMode = 'like_for_like' | 'may_change';

export const API_SURFACE_MODES: readonly ApiSurfaceMode[] = [
  'like_for_like',
  'may_change',
];

/** The default mode applied when a reconciled API Behaviour Baseline is present. */
export const DEFAULT_API_SURFACE_MODE: ApiSurfaceMode = 'like_for_like';

/**
 * The single runtime treatment-class marker (`locked`, surfaced as `L`) that
 * supersedes a Group B question's underlying H/I/G class while `like_for_like`
 * is active. NOT a dependency class — a question's underlying class is intact.
 */
export type LockedTreatmentMarker = 'locked';

export const LOCKED_TREATMENT_MARKER: LockedTreatmentMarker = 'locked';

/** True iff `mode` is a known closed-set `api.surfaceMode` value. */
export function isApiSurfaceMode(mode: string): mode is ApiSurfaceMode {
  return (API_SURFACE_MODES as readonly string[]).includes(mode);
}

/**
 * Read-only affordance label rendered on a Group B question locked under API
 * like-for-like (FR9). The frontend renders the question's resolved value +
 * provenance with this badge, NOT as editable choices.
 */
export const API_LIKE_FOR_LIKE_LOCK_LABEL = 'locked — API like-for-like';

export type DecisionScope =
  | { kind: 'architecture' }
  | { kind: 'element'; refType: ScopeRefType; refId: string };

export type ConversationTurnKind =
  | 'question'
  | 'answer'
  | 'cascade-summary'
  | 'cascade-accepted'
  | 'cascade-overridden'
  | 'decision-captured'
  | 'mapping-mutation-summary'
  | 'exception-pinned'
  | 'edit-superseded'
  | 'system-skip'
  | 'error'
  | 'open'
  | 'close'
  // 2026-05-25 Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write (Group 5):
  // banner-shaped turn appended after the `open` turn carrying the pre-fill
  // batch outcome. Source-quote text is NEVER on the turn payload (per Q22) --
  // it lives only on captured-decision rows for the SummaryPanel review.
  | 'tech-stack-prefill-summary'
  // 2026-06-05 Architect Tier-Gating (Half B): the opening confirmation turn
  // carrying the derived + confirmed technology-tier set (UI / Service /
  // Persistence). Mirrors the gateway `turnShape.ts` kind field-for-field.
  | 'tier-confirmation'
  // 2026-06-06 Architect Conversation — Open-Ended LLM Phase (S6): the five
  // open-phase turn kinds that begin STRICTLY after the deterministic preset
  // walk exhausts. Mirror the gateway `turnShape.ts` kinds field-for-field.
  // (1) architect "other areas?" prompt + suggested candidate areas;
  // (2) a user-raised topic; (3) the LLM option proposal (single/multi +
  // "something else…" escape, NO "Not applicable"); (4) the user pick;
  // (5) a free-form-discussion message (user OR assistant).
  | 'open-phase-prompt'
  | 'user-raised-topic'
  | 'option-proposal'
  | 'user-pick'
  | 'free-form-discussion';

export interface CascadeSummaryEntry {
  decisionCode: string;
  proposedValue: unknown;
  sourceStandardId: string;
}

export interface QuestionTurn {
  kind: 'question';
  decisionCode: string;
  promptText: string;
  roundIndex: number;
  /**
   * 2026-05-26 Architect Conversation Enrichments (#11): optional curated
   * framing paragraph mirrored from the gateway `QuestionTurn.staticContextLeadIn`
   * field, which in turn mirrors `QuestionLibraryEntry.staticContextLeadIn`.
   * Hand-authored per question; rendered by the UI in a muted `<small>` block
   * above the prompt. Older persisted turns from before this spec ship will
   * not carry the field -- readers must treat it as optional and the UI must
   * render silently when null/empty (no banner, no placeholder).
   */
  staticContextLeadIn?: string;
}

export interface AnswerTurn {
  kind: 'answer';
  decisionCode: string;
  answerText: string;
  roundIndex: number;
}

export interface CascadeSummaryTurn {
  kind: 'cascade-summary';
  cascadedDecisions: CascadeSummaryEntry[];
}

export interface CascadeAcceptedTurn {
  kind: 'cascade-accepted';
  cascadedDecisions: {
    decisionCode: string;
    answerValue: unknown;
    wasOverridden: false;
  }[];
}

export interface CascadeOverriddenTurn {
  kind: 'cascade-overridden';
  cascadedDecisions: {
    decisionCode: string;
    answerValue: unknown;
    wasOverridden: true;
    overrideReason: string;
  }[];
}

export interface DecisionCapturedTurn {
  kind: 'decision-captured';
  decisionId: string;
  decisionCode: string;
  scope: DecisionScope;
  answerValue: unknown;
  standardsLookupRef: string | null;
}

export interface MappingMutationSummaryTurn {
  kind: 'mapping-mutation-summary';
  affectedMappings: number;
  mappingTypeChanges: number;
  notesDecorations: number;
  tableSetSummary: {
    tableSet: string;
    affectedMappings: number;
    mappingTypeChanges: number;
    notesDecorations: number;
  }[];
}

export interface ExceptionPinnedTurn {
  kind: 'exception-pinned';
  decisionCode: string;
  scope: { kind: 'element'; refType: ScopeRefType; refId: string };
  answerValue: unknown;
}

export interface EditSupersededTurn {
  kind: 'edit-superseded';
  originalDecisionId: string;
  newDecisionId: string;
  affectedDownstreamCodes: string[];
}

export interface SystemSkipTurn {
  kind: 'system-skip';
  decisionCode: string;
  relevanceReason: string;
}

export type ConversationErrorKind =
  | 'round-budget-exhausted'
  | 'llm-call-timeout'
  | 'wall-clock-exceeded'
  | 'aborted'
  | 'llm-call-failed'
  | 'submit-answer-malformed'
  | 'decision-capture-failed'
  | 'mapping-mutation-failed';

export interface ErrorTurn {
  kind: 'error';
  errorKind: ConversationErrorKind;
  errorMessage: string;
  recoverableHint?: string;
}

export interface OpenTurn {
  kind: 'open';
  sessionId: string;
  openedBy: string;
}

export type CloseReason = 'completed-by-user' | 'retired-by-other-user';

export interface CloseTurn {
  kind: 'close';
  sessionId: string;
  closeReason: CloseReason;
  summaryMarkdown: string;
}

/**
 * Banner variant key surfaced by the {@link TechStackPrefillSummaryTurn}.
 * Mirrors the gateway-side `TechStackPrefillBannerVariant` (Task Group 3):
 *
 *   - 'both-files-matched'        org + project both present, pre-fill ran
 *   - 'organisation-only-matched' only the organisation file present
 *   - 'project-only-matched'      only the project file present
 *   - 'no-standards-found'        neither file present
 *   - 'failure'                   truncation / LLM error / validator error
 */
export type TechStackPrefillBannerVariant =
  | 'both-files-matched'
  | 'organisation-only-matched'
  | 'project-only-matched'
  | 'no-standards-found'
  | 'failure';

/**
 * Banner-shaped turn appended after a fresh `open` turn carrying the
 * tech-stack pre-fill outcome. Source-quote text is deliberately NOT included
 * on this turn payload -- the SummaryPanel review surface reads the quote
 * from the captured-decision row's `answer_value` JSON. Keeping the quote
 * off the transcript turn enforces the spec's isolation rule (per Q22):
 * source quotes never appear in the main transcript pane.
 */
export interface TechStackPrefillSummaryTurn {
  kind: 'tech-stack-prefill-summary';
  bannerVariant: TechStackPrefillBannerVariant;
  matchedCount: number;
  denominator: number;
  orgFilePresent: boolean;
  projectFilePresent: boolean;
  orgFilePath: string | null;
  projectFilePath: string | null;
  partialFailureCodes: string[];
  failureReason: string | null;
}

/**
 * The technology-tier flag set carried on the {@link TierConfirmationTurn}.
 * Mirrors the gateway-side `TierFlags` (`turnShape.ts`) field-for-field.
 *
 * NOTE: this "tier" is the architectural TECHNOLOGY tier (UI / Service /
 * Persistence) derived from `app_component.tech_type` -- UNRELATED to
 * `DiscoveryRunDto.tier` (the V3 confidence ladder A/B/C).
 */
export interface TierFlags {
  /** Target has at least one UI-tier component (gates Group E). */
  hasUiTier: boolean;
  /** Target has at least one Service-tier component (gates Groups A/B/D/H). */
  hasServiceTier: boolean;
  /** Target has at least one Persistence-tier component (gates Group C). */
  hasPersistenceTier: boolean;
}

/**
 * Opening tier-confirmation turn (Spec 2026-06-05-architect-tier-gating, Half B).
 * Mirrors the gateway-side `TierConfirmationTurn` (`turnShape.ts`)
 * field-for-field.
 *
 *   - `derivedTiers`   — the DEFAULT tier set the frontend derived from the
 *                        target model's `app_component.tech_type`.
 *   - `confirmedTiers` — the set actually in play for the session (the user may
 *                        have toggled a tier on/off); the sequencer gates on it.
 *
 * Surfaced at conversation OPEN, before the first question. IN-SESSION ONLY:
 * the set is ephemeral; re-deriving on reopen is idempotent.
 */
export interface TierConfirmationTurn {
  kind: 'tier-confirmation';
  derivedTiers: TierFlags;
  confirmedTiers: TierFlags;
}

/**
 * Phase signal carried on the `next-question` response (Spec
 * 2026-06-06-architect-conversation-open-ended-phase, S2). Mirrors the
 * gateway-side `ConversationPhase` (`turnShape.ts`). There is NO separate
 * phase endpoint — phase availability rides the `next-question` wire.
 *
 *   - 'preset-walk'    — the deterministic preset walk is still in progress
 *                        (a question was returned); the open phase is not yet
 *                        available.
 *   - 'open-available' — the walk is exhausted (`question` is null); the open
 *                        phase is reachable. The whole open phase is OPTIONAL.
 */
export type ConversationPhase = 'preset-walk' | 'open-available';

/**
 * A single proactively-suggested candidate area the architect floats at the
 * open-phase prompt (P3). Mirrors the gateway-side `SuggestedCandidateArea`.
 */
export interface SuggestedCandidateArea {
  /** Short user-facing area label (e.g. "Batch processing strategy"). */
  label: string;
  /** Optional one-line reason this area is relevant to the actual system. */
  rationale?: string;
}

/**
 * (1) Open-phase prompt turn — the architect's "other areas?" opener plus the
 * proactively-suggested grounded candidate areas (P3). Opens sub-phase (a).
 * Mirrors the gateway-side `OpenPhasePromptTurn` field-for-field.
 */
export interface OpenPhasePromptTurn {
  kind: 'open-phase-prompt';
  promptText: string;
  suggestedAreas: SuggestedCandidateArea[];
}

/**
 * (2) User-raised-topic turn — a topic the USER raised in sub-phase (a). Mirrors
 * the gateway-side `UserRaisedTopicTurn`. `topicLabel` is the basis for the later
 * `adhoc.<slug>` decision code; `topicText` is the verbatim phrasing when distinct.
 */
export interface UserRaisedTopicTurn {
  kind: 'user-raised-topic';
  topicLabel: string;
  topicText?: string;
}

/**
 * A single concrete option the LLM proposes for a user-raised topic. Mirrors the
 * gateway-side `ProposedOption` (a preset-style choice).
 */
export interface ProposedOption {
  value: string;
  label?: string;
}

/**
 * (3) LLM option-proposal turn — concrete options for a user-raised topic. The
 * LLM chooses single- vs multi-select PER TOPIC (`selectionMode`, mirroring the
 * preset `single-choice`/`multi-choice` shapes), ALWAYS offers a "something else…"
 * free-text escape (`allowFreeTextEscape`), and NEVER a "Not applicable" option
 * (P4). Mirrors the gateway-side `OptionProposalTurn` field-for-field.
 */
export interface OptionProposalTurn {
  kind: 'option-proposal';
  topicLabel: string;
  selectionMode: 'single' | 'multi';
  options: ProposedOption[];
  allowFreeTextEscape: boolean;
  freeTextEscapeLabel?: string;
}

/**
 * (4) User pick turn — the user's pick against an {@link OptionProposalTurn}.
 * `selectedValues` holds one entry for a `single` proposal or the selected set
 * for a `multi` proposal; when the "something else…" escape was taken,
 * `freeTextValue` carries the verbatim text and `selectedValues` is empty. The
 * pick is persisted as a first-class `adhoc.<slug>` captured decision. Mirrors
 * the gateway-side `UserPickTurn` field-for-field.
 */
export interface UserPickTurn {
  kind: 'user-pick';
  topicLabel: string;
  decisionCode: string;
  selectedValues: string[];
  freeTextValue?: string;
}

/**
 * (5) Free-form-discussion turn — a single message in the sub-phase (b) free-form
 * chat; `speaker` discriminates the user vs the assistant role within the one
 * kind. The end-of-(b) per-topic note summarisation is persisted separately as
 * `note.<slug>` captured-decision rows, NOT on this turn. Mirrors the gateway-side
 * `FreeFormDiscussionTurn` field-for-field.
 */
export interface FreeFormDiscussionTurn {
  kind: 'free-form-discussion';
  speaker: 'user' | 'assistant';
  messageText: string;
}

export type ConversationTurn =
  | QuestionTurn
  | AnswerTurn
  | CascadeSummaryTurn
  | CascadeAcceptedTurn
  | CascadeOverriddenTurn
  | DecisionCapturedTurn
  | MappingMutationSummaryTurn
  | ExceptionPinnedTurn
  | EditSupersededTurn
  | SystemSkipTurn
  | ErrorTurn
  | OpenTurn
  | CloseTurn
  | TechStackPrefillSummaryTurn
  | TierConfirmationTurn
  | OpenPhasePromptTurn
  | UserRaisedTopicTurn
  | OptionProposalTurn
  | UserPickTurn
  | FreeFormDiscussionTurn;

// ============================================================================
// Captured decision row (for the summary panel; mirrors Spec 2's read DTO)
// ============================================================================

export interface CapturedDecisionRow {
  decisionId: string;
  decisionCode: string;
  scopeKind: 'architecture' | 'element';
  scopeRefType: ScopeRefType | null;
  scopeRefId: string | null;
  /**
   * Raw answer value as persisted on the captured-decision row. For
   * tech-stack-md-prefill rows this is a JSON string of shape
   * `{ value, sourceQuote, sourceFile }`; the SummaryPanel unwraps it at
   * render time to show the source quote in the per-row expand affordance.
   * Non-prefill rows store the raw string verbatim.
   */
  answerValue: string;
  answerSummary: string | null;
  standardsLookupRef: string | null;
  supersededById: string | null;
  /**
   * 2026-05-25 Tech-Stack.md Pre-fill (Task Group 5). Audit signal that
   * discriminates pre-fill rows (`'tech-stack-md-prefill'`) from
   * user-walked rows (`'architect-persona-conversation'`). The SummaryPanel
   * uses this to decide whether to unwrap the `answerValue` JSON into a
   * value + sourceQuote pair for the review surface. Optional on the type
   * because legacy test fixtures + older gateway versions may omit it; the
   * SummaryPanel treats a missing value as "user-walked" (non-prefill).
   */
  createdByTask?: string;
}

// ============================================================================
// Conversation envelope returned by GET .../architect-conversation
// ============================================================================

export interface ConversationSession {
  sessionId: string;
  status: 'open' | 'closed';
  openedBy: string;
  openedAt: string;
}

export interface ConversationEnvelope {
  threadId: string;
  turns: ConversationTurn[];
  /**
   * The most recent session. `null` when no `open` turn has ever been written
   * to this thread. Per Q4 the current session may belong to a different user
   * -- the UI surfaces a "retire current and start new" affordance in that
   * case.
   */
  currentSession: ConversationSession | null;
  /**
   * The captured-decision rows currently active (non-superseded). Used by the
   * SummaryPanel for the grouped-by-scope summary.
   */
  capturedDecisions: CapturedDecisionRow[];
}

// ============================================================================
// Active target lookup wire shape
// ============================================================================

export interface ActiveTargetArchitectureResponse {
  activeTargetArchitectureId: string | null;
}

// ============================================================================
// Error type
// ============================================================================

export class ArchitectConversationApiError extends Error {
  readonly status: number;
  readonly body: { code?: string; message?: string };

  constructor(status: number, body: { code?: string; message?: string }, message?: string) {
    super(message ?? body.message ?? `Architect conversation API error (status ${status})`);
    this.name = 'ArchitectConversationApiError';
    this.status = status;
    this.body = body;
  }
}

async function parseError(res: Response): Promise<ArchitectConversationApiError> {
  let body: { code?: string; message?: string } = {};
  try {
    const raw = (await res.json()) as { code?: string; message?: string };
    if (raw && typeof raw === 'object') body = raw;
  } catch {
    // Fall through with empty body.
  }
  return new ArchitectConversationApiError(res.status, body);
}

// ============================================================================
// Request-options helper -- adds AbortController + JSON Content-Type.
// ============================================================================

const DEFAULT_TIMEOUT_MS = 60_000;

function buildRequestInit(
  method: 'GET' | 'POST',
  body?: unknown,
  signal?: AbortSignal,
): RequestInit {
  const init: RequestInit = {
    method,
    headers: { Accept: 'application/json' },
  };
  if (body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  if (signal) init.signal = signal;
  return init;
}

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// 1. Active-target-architecture lookup (Spec 2 endpoint).
// ============================================================================

export async function getActiveTargetArchitectureId(
  projectId: string,
): Promise<string | null> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}/active-target-architecture-id`;
  const res = await fetch(url, buildRequestInit('GET'));
  if (!res.ok) throw await parseError(res);
  const data = (await res.json()) as ActiveTargetArchitectureResponse;
  return data.activeTargetArchitectureId ?? null;
}

// ============================================================================
// 2. Load the full conversation envelope.
// ============================================================================

export async function loadConversation(
  projectId: string,
  targetArchitectureId: string,
): Promise<ConversationEnvelope> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/architect-conversation`;
  const res = await fetch(url, buildRequestInit('GET'));
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ConversationEnvelope;
}

// ============================================================================
// 2b. Question driver: fetch the NEXT question to present + the prompt-ready
//     preview. These back the question-walk + the SummaryPanel preview link.
// ============================================================================

/**
 * The next question the architect should answer, as projected from the gateway
 * question library. The prompt is the FIXED library text (never LLM-paraphrased);
 * `staticContextLeadIn` is a hand-authored framing line rendered above it.
 */
export interface PendingQuestion {
  decisionCode: string;
  group: string;
  orderInGroup: number;
  promptText: string;
  staticContextLeadIn: string | null;
  expectedAnswerShape: 'free-text' | 'single-choice' | 'multi-choice' | 'structured';
  choices: string[] | null;
  defaultsWhenUnchanged: string;
  /** True when the target may opt out of this capability entirely ("Not needed"). */
  optional: boolean;
  /**
   * Spec 2026-06-27-target-manifest-version-unknown-pending-questions: for a
   * PENDING versioned question (a version-unknown manifest coordinate asked
   * first) this is the pre-chosen framework stem so only the version needs
   * filling; null/absent for a normal question. Absent-tolerant for older
   * gateway responses.
   */
  prechosenFramework?: string | null;
}

/**
 * Result of {@link fetchNextQuestion}. Mirrors the gateway `next-question`
 * response (Spec 2026-06-06-architect-conversation-open-ended-phase, S2):
 * `{ question, phase }`. `phase` is `'open-available'` STRICTLY when the
 * deterministic preset walk is exhausted (`question` is null), else
 * `'preset-walk'`. There is NO separate phase endpoint.
 */
export interface NextQuestionResult {
  question: PendingQuestion | null;
  phase: ConversationPhase;
}

/**
 * Fetches the next un-answered question for the conversation, or null when the
 * walk is complete.
 *
 * Spec 2026-06-05-architect-tier-gating (Half B): the relevance-gating context
 * is now the three TECHNOLOGY-tier flags (`hasUiTier` / `hasServiceTier` /
 * `hasPersistenceTier`), threaded as query params. Each flag defaults to `true`
 * (FAIL-OPEN) so a question group is dropped ONLY when its tier is confirmed
 * absent. The previous single `hasUiScreens` param is folded into `hasUiTier`.
 */
export async function fetchNextQuestion(
  projectId: string,
  targetArchitectureId: string,
  tiers: TierFlags = {
    hasUiTier: true,
    hasServiceTier: true,
    hasPersistenceTier: true,
  },
): Promise<NextQuestionResult> {
  const params = new URLSearchParams({
    hasUiTier: tiers.hasUiTier ? 'true' : 'false',
    hasServiceTier: tiers.hasServiceTier ? 'true' : 'false',
    hasPersistenceTier: tiers.hasPersistenceTier ? 'true' : 'false',
  });
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/architect-conversation/next-question?${params.toString()}`;
  const res = await fetch(url, buildRequestInit('GET'));
  if (!res.ok) throw await parseError(res);
  const data = (await res.json()) as {
    question: PendingQuestion | null;
    phase?: ConversationPhase;
  };
  const question = data.question ?? null;
  // Derive the phase defensively if an older gateway omits it: the open phase
  // is available exactly when the walk is exhausted (no question).
  const phase: ConversationPhase =
    data.phase ?? (question === null ? 'open-available' : 'preset-walk');
  return { question, phase };
}

/**
 * Fetches the grouped-by-scope, prompt-ready markdown the downstream PM tasks
 * would consume for this target right now (backs "Preview prompt-ready output").
 */
export async function fetchPromptReadyOutput(
  projectId: string,
  targetArchitectureId: string,
): Promise<string> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/architect-conversation/prompt-ready-output`;
  const res = await fetch(url, buildRequestInit('GET'));
  if (!res.ok) throw await parseError(res);
  const data = (await res.json()) as { promptReadyOutput: string };
  return data.promptReadyOutput ?? '';
}

// ============================================================================
// 3. Open / close conversation -- writes the `open` / `close` synthetic turns.
// ============================================================================

export interface OpenConversationRequest {
  openedBy: string;
  /**
   * Spec 2026-06-05-architect-tier-gating (Half B): the technology-tier set in
   * play for this session, derived client-side from the target model's
   * `app_component.tech_type` (then optionally adjusted via the
   * tier-confirmation turn). The gateway gates the auto-skip + question walk on
   * these flags. Optional + each flag defaults `true` on the gateway
   * (FAIL-OPEN) so an omitted/under-derived set asks everything. THE CORE BUG
   * FIX: this was previously never sent, so `hasUiScreens` defaulted true and
   * the UI (Group E) questions were always asked.
   */
  relevanceContext?: TierFlags;
}

export interface OpenConversationResponse {
  sessionId: string;
  openTurn: OpenTurn;
  /**
   * The tier-confirmation opening turn the gateway appends immediately after the
   * `open` turn (Spec 2026-06-05-architect-tier-gating, Half B) — the "which
   * technology tiers are in play?" confirm/adjust step shown BEFORE the first
   * question. Callers must append this to the transcript on a fresh open or it
   * never renders (the optimistic open path does not reload from the server).
   */
  tierConfirmationTurn?: TierConfirmationTurn;
}

export async function openConversation(
  projectId: string,
  targetArchitectureId: string,
  body: OpenConversationRequest,
): Promise<OpenConversationResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/architect-conversation/open`;
  const res = await fetch(url, buildRequestInit('POST', body));
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as OpenConversationResponse;
}

export interface CloseConversationRequest {
  sessionId: string;
  closeReason: CloseReason;
  summaryMarkdown: string;
}

export interface CloseConversationResponse {
  closeTurn: CloseTurn;
}

export async function closeConversation(
  projectId: string,
  targetArchitectureId: string,
  body: CloseConversationRequest,
): Promise<CloseConversationResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/architect-conversation/close`;
  const res = await fetch(url, buildRequestInit('POST', body));
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as CloseConversationResponse;
}

// ============================================================================
// 4. Answer a question -- coordinates the LLM loop, captures the decision,
//    optionally applies mapping mutations, returns the surfaced turns.
// ============================================================================

export interface AnswerQuestionRequest {
  sessionId: string;
  decisionCode: string;
  userResponse: string;
}

export interface AnswerQuestionResponse {
  outcome: 'captured' | 'skipped' | 'error';
  questionTurn?: QuestionTurn;
  answerTurn?: AnswerTurn;
  decisionCapturedTurn?: DecisionCapturedTurn;
  cascadeSummaryTurn?: CascadeSummaryTurn | null;
  mappingMutationSummaryTurn?: MappingMutationSummaryTurn | null;
  systemSkipTurn?: SystemSkipTurn;
  errorTurn?: ErrorTurn;
}

export async function answerQuestion(
  projectId: string,
  targetArchitectureId: string,
  body: AnswerQuestionRequest,
  options: { timeoutMs?: number } = {},
): Promise<AnswerQuestionResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/architect-conversation/answer`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await withTimeout(async (signal) => {
    const res = await fetch(url, buildRequestInit('POST', body, signal));
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as AnswerQuestionResponse;
  }, timeoutMs);
}

// ============================================================================
// 4b. Deterministic capture (click-to-answer UI, 2026-06-01).
//
// Captures the EXACT value the user chose -- a single option, a multi-choice
// selection (string[]), a custom value, or an opt-out marker -- with NO LLM
// round-trip. Returns the same `AnswerQuestionResponse` envelope as
// `answerQuestion`, so cascade handling is identical.
// ============================================================================

/** Sentinel value captured when the user opts a capability out via "Not needed". */
export const OPT_OUT_ANSWER_VALUE = '(not used)';

export interface CaptureAnswerRequest {
  sessionId: string;
  decisionCode: string;
  value: string | string[];
  /** Optional display text for the answer turn (defaults to the value). */
  answerText?: string;
}

export async function captureAnswer(
  projectId: string,
  targetArchitectureId: string,
  body: CaptureAnswerRequest,
  options: { timeoutMs?: number } = {},
): Promise<AnswerQuestionResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/architect-conversation/capture`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await withTimeout(async (signal) => {
    const res = await fetch(url, buildRequestInit('POST', body, signal));
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as AnswerQuestionResponse;
  }, timeoutMs);
}

// ============================================================================
// 5. Cascade accept-batch -- writes N rows sharing one conversation_turn_ref.
// ============================================================================

export interface AcceptCascadeBatchRequest {
  sessionId: string;
  parentDecisionId: string;
  proposals: {
    decisionCode: string;
    proposedValue: unknown;
    sourceStandardId: string;
  }[];
}

export interface AcceptCascadeBatchResponse {
  cascadeAcceptedTurn: CascadeAcceptedTurn;
  decisionCapturedTurns: DecisionCapturedTurn[];
  sharedConversationTurnRef: string;
}

export async function acceptCascadeBatch(
  projectId: string,
  targetArchitectureId: string,
  body: AcceptCascadeBatchRequest,
  options: { timeoutMs?: number } = {},
): Promise<AcceptCascadeBatchResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/architect-conversation/cascade/accept-batch`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await withTimeout(async (signal) => {
    const res = await fetch(url, buildRequestInit('POST', body, signal));
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as AcceptCascadeBatchResponse;
  }, timeoutMs);
}

// ============================================================================
// 6. Per-cascade override -- one row with wasOverridden=true + reason.
// ============================================================================

export interface OverrideCascadeRequest {
  sessionId: string;
  parentDecisionId: string;
  proposal: {
    decisionCode: string;
    proposedValue: unknown;
    sourceStandardId: string;
  };
  overrideValue: unknown;
  overrideReason: string;
}

export interface OverrideCascadeResponse {
  cascadeOverriddenTurn: CascadeOverriddenTurn;
  decisionCapturedTurn: DecisionCapturedTurn;
}

export async function overrideCascade(
  projectId: string,
  targetArchitectureId: string,
  body: OverrideCascadeRequest,
  options: { timeoutMs?: number } = {},
): Promise<OverrideCascadeResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/architect-conversation/cascade/override`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await withTimeout(async (signal) => {
    const res = await fetch(url, buildRequestInit('POST', body, signal));
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as OverrideCascadeResponse;
  }, timeoutMs);
}

// ============================================================================
// 7. Revise prior answer -- writes a new superseding row + edit-superseded turn.
// ============================================================================

export interface RevisePriorAnswerRequest {
  sessionId: string;
  decisionCode: string;
  originalDecisionId: string;
  newAnswerValue: unknown;
  scope?: DecisionScope;
}

export interface RevisePriorAnswerResponse {
  editSupersededTurn: EditSupersededTurn;
  decisionCapturedTurn: DecisionCapturedTurn;
}

export async function revisePriorAnswer(
  projectId: string,
  targetArchitectureId: string,
  body: RevisePriorAnswerRequest,
  options: { timeoutMs?: number } = {},
): Promise<RevisePriorAnswerResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/architect-conversation/revise`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await withTimeout(async (signal) => {
    const res = await fetch(url, buildRequestInit('POST', body, signal));
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as RevisePriorAnswerResponse;
  }, timeoutMs);
}

// ============================================================================
// 8. Pin per-element exception -- element-scoped POST + exception-pinned turn.
// ============================================================================

export interface PinExceptionRequest {
  sessionId: string;
  decisionCode: string;
  scope: { kind: 'element'; refType: ScopeRefType; refId: string };
  answerValue: unknown;
}

export interface PinExceptionResponse {
  exceptionPinnedTurn: ExceptionPinnedTurn;
  decisionCapturedTurn: DecisionCapturedTurn;
}

export async function pinException(
  projectId: string,
  targetArchitectureId: string,
  body: PinExceptionRequest,
  options: { timeoutMs?: number } = {},
): Promise<PinExceptionResponse> {
  // Defence-in-depth -- the gateway also validates per Q12 closed set.
  if (!ALLOWED_SCOPE_REF_TYPES.includes(body.scope.refType)) {
    throw new ArchitectConversationApiError(400, {
      code: 'invalid_scope_ref_type',
      message: `Scope ref type '${body.scope.refType}' is not in the closed Q12 set.`,
    });
  }
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/architect-conversation/exception`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await withTimeout(async (signal) => {
    const res = await fetch(url, buildRequestInit('POST', body, signal));
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as PinExceptionResponse;
  }, timeoutMs);
}

// ============================================================================
// Question Library scopes (Four-Spec Hardening Pass, 2026-05-25, Item 4).
//
// Runtime fetch replacing the deleted static mirror at
// the static frontend mirror file (removed by the same commit).
// The Architecture Model Service is NOT involved in this flow -- the gateway
// owns the question library, so the projection lives in the gateway and the
// frontend reads it via a single GET on mount of the Architect Conversation
// tab.
// ============================================================================

/**
 * Per-decision-code exception-scope entry returned by the gateway scope
 * endpoint. Mirrors the gateway-side `QuestionLibraryScopeEntry` shape -- the
 * two unions are kept in lock-step via the drift-detection contract test on
 * `ScopeRefType` (see `scopeRefType.contractWithGateway.test.ts`).
 */
export interface QuestionLibraryScopeEntry {
  allowedExceptionScopes: ScopeRefType[];
}

/** Map from decision code to allowed exception scopes. */
export type QuestionLibraryScopeMap = Record<string, QuestionLibraryScopeEntry>;

/**
 * Fetches the question library scope map from the gateway. Backs the
 * Architect Conversation tab's exception sub-dialog scope filter.
 *
 * Calls `GET /api/architect-conversation/question-library/scopes`.
 *
 * Returns a flat map keyed by decision code. The map is session-cached in
 * memory by the Architect Conversation tab (no TTL; refetch only on tab
 * close + reopen) per Q6 of the hardening pass spec.
 *
 * On non-2xx responses this throws `ArchitectConversationApiError`; callers
 * are expected to catch and surface the graceful-degrade UX (per Q12 option
 * a of the spec: the exception sub-dialog still opens but the scope picker
 * is disabled and shows "no exception scopes available -- try again later").
 */
export async function fetchQuestionLibraryScopes(): Promise<QuestionLibraryScopeMap> {
  const url = `${GATEWAY_BASE}/api/architect-conversation/question-library/scopes`;
  const res = await fetch(url, buildRequestInit('GET'));
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as QuestionLibraryScopeMap;
}

// ============================================================================
// Captured Decision DTO + direct-list fetch
//   Spec: 2026-05-26-compare-view-decision-code-decoration -- Task Group 1
//
// Mirrors the AMS `TargetStateCapturedDecisionDto` (`@CamelCaseWire`). The
// existing envelope-shaped `CapturedDecisionRow` above intentionally omits
// `conversationThreadId` + `conversationTurnRef` (the gateway's envelope
// mapper strips them); this DTO is the direct AMS shape consumed by the
// Compare View chip decoration where the "View in conversation" link needs
// the thread ref.
// ============================================================================

/**
 * Direct AMS read DTO for a captured decision row. Used by the Compare View
 * captured-decision chip decoration (spec 2026-05-26).
 *
 * Note: the envelope-shaped `CapturedDecisionRow` above is a separate type
 * because the gateway's conversation-envelope mapper strips
 * `conversationThreadId` + `conversationTurnRef`. This DTO is the
 * pass-through AMS shape returned by `GET .../captured-decisions`.
 */
export interface CapturedDecisionDto {
  decisionId: string;
  projectId: string;
  targetArchitectureId: string;
  decisionCode: string;
  scopeKind: 'architecture' | 'element';
  scopeRefType: ScopeRefType | null;
  scopeRefId: string | null;
  answerValue: string;
  answerSummary: string | null;
  standardsLookupRef: string | null;
  conversationThreadId: string | null;
  conversationTurnRef: string | null;
  createdAt: string;
  createdByTask: string | null;
  supersededById: string | null;
}

/**
 * Direct list-fetch for the captured-decision rows of a target architecture.
 *
 * Defaults to the latest non-superseded rows; pass `{ includeSuperseded: true }`
 * to retrieve the full audit list. The query parameter is forwarded verbatim
 * to AMS via the existing gateway pass-through proxy
 * (`gateway/src/routes/targetArchitectures.ts` lines 662-701).
 *
 * On non-2xx the function throws `ArchitectConversationApiError`. Callers
 * (the Compare View workspace) surface this fail-soft as an empty list per
 * Q9 progressive-enhancement.
 */
export async function listCapturedDecisions(
  projectId: string,
  targetArchitectureId: string,
  opts: { includeSuperseded?: boolean } = {},
): Promise<CapturedDecisionDto[]> {
  const includeSuperseded = opts.includeSuperseded ?? false;
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/captured-decisions?includeSuperseded=${includeSuperseded}`;
  const res = await fetch(url, buildRequestInit('GET'));
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as CapturedDecisionDto[];
}

// ============================================================================
// 9. Open-phase (Spec 2026-06-06-architect-conversation-open-ended-phase).
//
// The five `/open-phase/*` calls drive the open-ended LLM phase that begins
// STRICTLY after the deterministic preset walk exhausts (signalled by
// `fetchNextQuestion().phase === 'open-available'`). Each is an EXPLICIT
// user-control entry point (the LLM never infers "done" -- S5). These are the
// SINGLE frontend surface for the open phase (Task Group 6.8); no parallel
// type definitions exist. The wire envelopes mirror the gateway routes in
// `gateway/src/routes/architectConversation.ts` (Task Group 4) field-for-field.
//
//   POST .../architect-conversation/open-phase/begin       -> suggested areas
//   POST .../architect-conversation/open-phase/raise-topic -> option proposal
//   POST .../architect-conversation/open-phase/pick        -> adhoc.<slug> write
//   POST .../architect-conversation/open-phase/discuss     -> one chat round
//   POST .../architect-conversation/open-phase/summarise   -> note.<slug> writes
// ============================================================================

/**
 * Sub-phase (a) ENTRY (P3): the architect's "other areas?" opener + the
 * proactively-suggested grounded candidate areas. Appends the
 * `open-phase-prompt` turn server-side (durable). On loop failure the gateway
 * returns `{ outcome: 'error', errorTurn }` (still HTTP 200 -- the error rides
 * the envelope, consistent with `/answer`).
 */
export type BeginOpenPhaseResponse =
  | { outcome: 'prompt'; openPhasePromptTurn: OpenPhasePromptTurn }
  | { outcome: 'error'; errorTurn: ErrorTurn };

export async function beginOpenPhase(
  projectId: string,
  targetArchitectureId: string,
  options: { timeoutMs?: number } = {},
): Promise<BeginOpenPhaseResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/architect-conversation/open-phase/begin`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await withTimeout(async (signal) => {
    const res = await fetch(url, buildRequestInit('POST', {}, signal));
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as BeginOpenPhaseResponse;
  }, timeoutMs);
}

/**
 * Sub-phase (a): the user raised a topic. Appends the `user-raised-topic` turn
 * + the LLM `option-proposal` turn (single/multi PER TOPIC + a "something else…"
 * escape; NO "Not applicable" -- P4/S4). On loop failure the user-raised-topic
 * turn is still returned alongside the `errorTurn`.
 */
export interface RaiseTopicRequest {
  topicLabel: string;
  topicText?: string;
}

export type RaiseTopicResponse =
  | {
      outcome: 'proposed';
      userRaisedTopicTurn: UserRaisedTopicTurn;
      optionProposalTurn: OptionProposalTurn;
    }
  | {
      outcome: 'error';
      userRaisedTopicTurn: UserRaisedTopicTurn;
      errorTurn: ErrorTurn;
    };

export async function raiseOpenPhaseTopic(
  projectId: string,
  targetArchitectureId: string,
  body: RaiseTopicRequest,
  options: { timeoutMs?: number } = {},
): Promise<RaiseTopicResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/architect-conversation/open-phase/raise-topic`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await withTimeout(async (signal) => {
    const res = await fetch(url, buildRequestInit('POST', body, signal));
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as RaiseTopicResponse;
  }, timeoutMs);
}

/**
 * Sub-phase (a): the user picked option(s) / typed a "something else…" answer.
 * Appends the `user-pick` turn, WRITES the first-class `adhoc.<slug>` decision
 * row (architecture scope, distinct `createdByTask`) via the NEW capture path
 * (does NOT 404 on the non-library code), and appends a `decision-captured`
 * turn. Provide `selectedValues` (non-empty for single/multi picks) OR
 * `freeTextValue` (the verbatim "something else…" text) -- never both empty.
 * `conversationThreadId` is forwarded so the written row carries the thread ref.
 */
export interface OpenPhasePickRequest {
  topicLabel: string;
  selectedValues?: string[];
  freeTextValue?: string;
  conversationThreadId?: string | null;
}

export type OpenPhasePickResponse =
  | {
      outcome: 'captured';
      userPickTurn: UserPickTurn;
      decisionCapturedTurn: DecisionCapturedTurn;
    }
  | { outcome: 'error'; errorTurn: ErrorTurn };

export async function pickOpenPhaseOption(
  projectId: string,
  targetArchitectureId: string,
  body: OpenPhasePickRequest,
  options: { timeoutMs?: number } = {},
): Promise<OpenPhasePickResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/architect-conversation/open-phase/pick`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await withTimeout(async (signal) => {
    const res = await fetch(url, buildRequestInit('POST', body, signal));
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as OpenPhasePickResponse;
  }, timeoutMs);
}

/**
 * Sub-phase (b): one round of the multi-turn free-form chat. Appends the user's
 * `free-form-discussion` turn + the assistant's reply turn (both durable, so the
 * assistant has conversational memory across reopen). On loop failure the user's
 * turn is still returned alongside the `errorTurn`.
 */
export interface OpenPhaseDiscussRequest {
  userMessage: string;
}

export type OpenPhaseDiscussResponse =
  | {
      outcome: 'replied';
      userTurn: FreeFormDiscussionTurn;
      assistantTurn: FreeFormDiscussionTurn;
    }
  | {
      outcome: 'error';
      userTurn: FreeFormDiscussionTurn;
      errorTurn: ErrorTurn;
    };

export async function discussOpenPhase(
  projectId: string,
  targetArchitectureId: string,
  body: OpenPhaseDiscussRequest,
  options: { timeoutMs?: number } = {},
): Promise<OpenPhaseDiscussResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/architect-conversation/open-phase/discuss`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await withTimeout(async (signal) => {
    const res = await fetch(url, buildRequestInit('POST', body, signal));
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as OpenPhaseDiscussResponse;
  }, timeoutMs);
}

/**
 * A single per-topic structured note the LLM summarised at the END of sub-phase
 * (b). Mirrors the gateway-side `DiscussionNote`. Each is written as a per-note-
 * UNIQUE `note.<slug>` captured-decision row (no mutual supersession -- Q2b).
 */
export interface DiscussionNote {
  topicLabel: string;
  noteText: string;
}

/**
 * Sub-phase (b) END (Q2a/b): the explicit "Done / Close" control. Summarises the
 * durable free-form discussion into PER-TOPIC structured notes and WRITES each as
 * a per-note-unique `note.<slug>` row. `writtenNotes` echoes the persisted
 * codes/ids. `conversationThreadId` is forwarded so the note rows carry the
 * thread ref. An empty `notes` array is valid (nothing note-worthy).
 */
export interface OpenPhaseSummariseRequest {
  conversationThreadId?: string | null;
}

export type OpenPhaseSummariseResponse =
  | {
      outcome: 'notes';
      notes: DiscussionNote[];
      writtenNotes: { decisionCode: string; decisionId: string }[];
    }
  | { outcome: 'error'; errorTurn: ErrorTurn };

export async function summariseOpenPhaseDiscussion(
  projectId: string,
  targetArchitectureId: string,
  body: OpenPhaseSummariseRequest = {},
  options: { timeoutMs?: number } = {},
): Promise<OpenPhaseSummariseResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/architect-conversation/open-phase/summarise`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await withTimeout(async (signal) => {
    const res = await fetch(url, buildRequestInit('POST', body, signal));
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as OpenPhaseSummariseResponse;
  }, timeoutMs);
}
