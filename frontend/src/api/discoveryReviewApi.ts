/**
 * Discovery-Review Conversation API client (Spec 3 — capstone, Task Group 4.6).
 *
 * Spec: 2026-06-02-conversational-discovery-review-architect.
 *
 * The typed client the Discovery Review Room consumes. It wraps the Group 3
 * gateway routes (mounted at `/api/v1/discovery-review`, base
 * `/projects/:p/architectures/:a/runs/:runId/review-conversation`):
 *
 *   GET    .../review-conversation        -> { threadId, turns }   (load transcript)
 *   POST   .../start    { openedBy, scanPair? }                    -> StartReviewResponse
 *   POST   .../answer   { userMessage, scanPair? }                 -> ReviewTurnOutcomeWire (LLM PROPOSES)
 *   POST   .../capture  { action, agendaCursor?|intent?, userText? } -> ReviewTurnOutcomeWire (NO-LLM)
 *   POST   .../confirm  { pendingId, intent, confirmation }        -> ConfirmReviewOutcomeWire (terminal Save write)
 *
 * Plus a thin review-model read (`getReviewModelCounts`) reusing the Spec 1
 * `review-model` backbone so the room can do its re-read-after-write to keep the
 * authoritative whole-run counts current (Decision 6) — NO shared cross-page
 * React store.
 *
 * SAFETY (the oracle standard): the numbers the transcript records are ALWAYS
 * server-supplied (from `resolveBulkActionSet` / the conflict reads — never an LLM
 * number). After the 2026-06-06 redesign chunk dispositions + conflicts apply
 * IMMEDIATELY (the click IS the confirmation) and return an `'applied'` outcome;
 * `/confirm` survives ONLY for the TERMINAL Save Yes/No (auto-appended on agenda
 * exhaustion).
 *
 * The turn-shape types below MIRROR the gateway
 * `discoveryReviewConversation/reviewTurnShape.ts` + `reviewConversationCoordinator.ts`
 * unions; this client only defines the wire contract the UI renders per-kind.
 *
 * 2026-06-06-discovery-review-room-agenda-redesign-2:
 *   - Task Group 1: the rich `cascadePreview` field on `ChunkSummaryTurnWire`, the
 *     dedicated "Approve visible chunk" action (`familyVisibleChunkAction`), and the
 *     `apply-decision` `scope: 'family' | 'cascade'` discriminator — all ADDITIVE +
 *     optional, in byte-for-shape lockstep with the gateway.
 *     `PendingConfirmationTurnWire` survives for the TERMINAL Save Yes/No only.
 *   - Task Group 4: the `'applied'` outcome is EXTENDED with `nextChunk`
 *     (auto-advance: the NEXT agenda chunk for a disposition, or the SAME chunk
 *     refreshed for a conflict), `advanced` (true ⇒ append + scroll; false ⇒ replace
 *     in place), and `terminalSaveTurn` (the auto-appended terminal Save on agenda
 *     exhaustion). `appliedTurn` widens to the conflict-resolved turns too. The
 *     gateway ALWAYS emits the three new fields; they are kept ADDITIVE + optional
 *     on this mirror (the established convention) so older `'applied'` fixtures
 *     still parse, and Task Group 5 consumes this single mirror.
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';
const REVIEW_BASE = `${GATEWAY_BASE}/api/v1/discovery-review`;

function convPath(projectId: string, architectureId: string, runId: string): string {
  return (
    `${REVIEW_BASE}/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/runs/${encodeURIComponent(runId)}/review-conversation`
  );
}

async function parseError(res: Response): Promise<Error> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: string };
    detail = body?.error ?? '';
  } catch {
    /* non-JSON body */
  }
  return new Error(
    `Discovery review request failed: ${res.status}${detail ? `: ${detail}` : ''}`,
  );
}

function jsonInit(method: string, body?: unknown): RequestInit {
  const init: RequestInit = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return init;
}

// ============================================================================
// Wire types — mirror the gateway reviewTurnShape.ts closed union.
// ============================================================================

export type BulkReviewActionWire = 'approved' | 'rejected' | 'deferred';

export type AgendaSectionKindWire =
  | 'interfaces-endpoints'
  | 'logical-data'
  | 'physical-data'
  | 'cross-scan-links'
  | 'business-logic'
  | 'findings-by-severity';

/**
 * The apply REACH discriminator on an `apply-decision` intent — the frontend
 * mirror of the gateway `ReviewApplyScope` (`reviewTurnShape.ts`,
 * 2026-06-06-discovery-review-room-agenda-redesign-2 S1). `'cascade'` applies the
 * resolver's FULL touched set (Approve All / Reject All / Defer All);
 * `'family'` applies ONLY the `deriveFamilyForSeed` reach (seed ∪ direct
 * `parent_child` children) for "Approve visible chunk". ADDITIVE + optional on
 * the intent — absent defaults to `'cascade'` (today's full-cascade behaviour).
 */
export type ReviewApplyScopeWire = 'family' | 'cascade';

/**
 * The N-run scan selection -- the frontend mirror of the gateway
 * `SelectedScanSet` (`reviewTurnShape.ts`), field-for-field. One
 * selected run PER scanned service (0-or-1 each; >=1 overall), so a UI + Service
 * + DB review (2 code + 1 DB) is legitimate. `primaryRunId` STAYS the thread
 * anchor and MUST equal one of `runs[].runId`; each `serviceId` is the run's
 * `service_id` FK (null for an orphan / "Unassigned" run). Byte-compatible with
 * the gateway type -- same field names + casing.
 */
export interface SelectedScanSetWire {
  runs: Array<{
    runId: string;
    scanKind: 'code' | 'database';
    serviceId: string | null;
  }>;
  primaryRunId: string;
}

export type ProposedReviewIntentWire =
  | {
      kind: 'apply-decision';
      seedCandidateIds: string[];
      findingIds: string[];
      action: BulkReviewActionWire;
      reviewerNotes?: string;
      /**
       * The apply REACH (2026-06-06 agenda-redesign-2, S1): `'family'` applies
       * ONLY `deriveFamilyForSeed` (seed ∪ direct `parent_child` children) for
       * "Approve visible chunk"; `'cascade'` applies the resolver's full touched
       * set for "Approve All" / "Reject All" / "Defer All". ADDITIVE + optional —
       * absent defaults to `'cascade'` (today's full-cascade behaviour).
       */
      scope?: ReviewApplyScopeWire;
    }
  | {
      /**
       * Type-level bulk disposition (2026-06-09) — the frontend mirror of the
       * gateway `apply-decision-by-type` intent. Approve / Reject / Defer ALL
       * still-actionable candidates of one `candidate_type` within a scan (the
       * "Approve all N <type>" control on an orphan-by-type chunk). The coordinator
       * enumerates the target set server-side, so the room never sends ids.
       */
      kind: 'apply-decision-by-type';
      candidateType: string;
      scanScope: 'code' | 'database';
      action: BulkReviewActionWire;
      reviewerNotes?: string;
    }
  | {
      /**
       * Findings bulk disposition (2026-06-09) — the frontend mirror of the gateway
       * `apply-decision-findings` intent. Approve / Reject / Defer ALL
       * still-actionable findings within a scan (the "Approve all N findings"
       * control on a findings-by-severity chunk). The coordinator enumerates the
       * target finding ids server-side.
       */
      kind: 'apply-decision-findings';
      scanScope: 'code' | 'database';
      action: BulkReviewActionWire;
      reviewerNotes?: string;
    }
  | {
      kind: 'resolve-conflict';
      candidateId: string;
      attr: string;
      chosenValue: unknown;
      chosenSource: string;
    }
  | {
      kind: 'resolve-conflicts-by-pattern';
      candidateId: string;
      attr: string;
      chosenSource: string;
      classCandidateIds: string[];
    }
  | { kind: 'save' };

export interface OpenTurnWire {
  kind: 'open';
  sessionId: string;
  openedBy: string;
  scanPair: SelectedScanSetWire;
}

/**
 * The competing facts of ONE live conflict attribute on a chunk item (present on
 * live-conflict-section candidates only). Mirrors the gateway
 * `ChunkItemConflictFact`. The frontend renders deterministic "pick a source"
 * controls from these — the values are server-supplied (Spec 0 `conflict_state`
 * + `getSimilarConflicts`), never client-recomputed or LLM-asserted.
 */
export interface ChunkItemConflictFactWire {
  attr: string;
  competing: Array<{ value: unknown; source: string }>;
  /** Similarity-class size (>= 2 enables a "resolve all" offer for this attr). */
  similarCount: number;
}

export interface ChunkItemRefWire {
  id: string;
  itemType: 'candidate' | 'finding';
  name: string;
  detail: string;
  /**
   * Live-conflict facts for live-conflict-section candidates (absent otherwise).
   * Drives the deterministic source-pick + resolve-all controls in the chunk.
   */
  conflicts?: ChunkItemConflictFactWire[];
}

/**
 * The two-level structural FAMILY a chunk renders (2026-06-05 review-room agenda
 * redesign, Task Group 2). Mirrors the gateway `ChunkFamily`. A family = ONE
 * parent node + its DIRECT `parent_child` children. `parentId` is always the
 * FIRST item in `ChunkSummaryTurnWire.items`; `childIds` are the remaining child
 * items. Present on FAMILY chunks ONLY (absent for orphan-by-type / findings /
 * cross-scan chunks). The room reads these to render the parent with indented
 * children + a single family-level bulk control.
 */
export interface ChunkFamilyWire {
  parentId: string;
  childIds: string[];
}

/**
 * One per-`candidate_type` row of the rich cascade preview — the frontend mirror
 * of the gateway `CascadePreviewByType`
 * (2026-06-06-discovery-review-room-agenda-redesign-2, S2). `type` is the
 * `candidate_type`; `count` is the full-cascade count of that type; the three
 * sub-counts are how many of those members are already in each terminal
 * disposition. The room renders the "(N already approved/rejected/deferred)"
 * annotations from these (only when non-zero).
 */
export interface CascadePreviewByTypeWire {
  type: string;
  count: number;
  alreadyApproved: number;
  alreadyRejected: number;
  alreadyDeferred: number;
}

/**
 * The rich multi-line cascade summary a FAMILY chunk renders — the frontend
 * mirror of the gateway `CascadePreview`
 * (2026-06-06-discovery-review-room-agenda-redesign-2, S2). `total` is the
 * full-cascade total (the "Review the current N candidates" line); `byType` is
 * the per-`candidate_type` breakdown. Present on FAMILY chunks ONLY (absent for
 * orphan-by-type / findings / cross-scan-LINK chunks). The values are
 * server-supplied by a gateway-only pure builder — never client-recomputed.
 */
export interface CascadePreviewWire {
  total: number;
  byType: CascadePreviewByTypeWire[];
}

/**
 * The dedicated "Approve visible chunk" family action — the frontend mirror of
 * the gateway `FamilyVisibleChunkAction`
 * (2026-06-06-discovery-review-room-agenda-redesign-2, Task Group 1). It sits
 * ALONGSIDE the three `familyBulkActions` dispositions to make the FOUR-button
 * family layout expressible WITHOUT widening the parity-tested resolver
 * `BulkReviewActionWire` enum. "Approve visible chunk" maps to an
 * `apply-decision` with `action: 'approved'` + `scope: 'family'`.
 */
export type FamilyVisibleChunkActionWire = 'approve-visible-chunk';

/**
 * The cross-layer (logical↔physical) mapping note a FAMILY chunk renders — the
 * frontend mirror of the gateway `CrossLayerMapping` (Spec 2026-06-08 "don't cross
 * layers on approve"). The cascade does NOT cross the logical↔physical mapping, so
 * this preserves the connection: on a PHYSICAL family it carries the mapped LOGICAL
 * entities + their disposition tally; on a LOGICAL family it names the mapped
 * PHYSICAL entities. Present ONLY when the family parent is a logical/physical data
 * entity with ≥1 cross-layer mapping. Server-supplied; never client-recomputed.
 */
export interface CrossLayerMappingWire {
  parentLayer: 'logical' | 'physical';
  counterpartNames: string[];
  mappedDecisions?: {
    approved: number;
    rejected: number;
    deferred: number;
    pending: number;
  };
}

export interface ChunkSummaryTurnWire {
  kind: 'chunk-summary';
  section: AgendaSectionKindWire;
  scanScope: 'code' | 'database' | 'cross-scan';
  items: ChunkItemRefWire[];
  cursor: number;
  nextCursor: number | null;
  agendaTotal: number;
  /**
   * The two-level structural family this chunk renders (2026-06-05 Task Group 2)
   * — present for FAMILY chunks ONLY, ABSENT for orphan-by-type / findings /
   * cross-scan chunks. ADDITIVE + optional so non-family chunks still parse.
   * When present, `family.parentId` is the first item in `items` and
   * `family.childIds` are the remaining child items.
   */
  family?: ChunkFamilyWire;
  /**
   * The family-level bulk dispositions the room renders an Approve-all /
   * Reject-all / Defer-all control from (2026-06-05 Task Group 2). Present for
   * FAMILY chunks ONLY (alongside `family`), ABSENT otherwise. The room proposes
   * a family bulk by seeding `family.parentId` into the existing `apply-decision`
   * intent (the cascade pulls the `parent_child` children server-side).
   *
   * 2026-06-06 redesign-2: these three are now the full-cascade
   * (`scope: 'cascade'`) Approve All / Reject All / Defer All; the FOURTH button
   * ("Approve visible chunk", `scope: 'family'`) is advertised separately via
   * `familyVisibleChunkAction`.
   */
  familyBulkActions?: BulkReviewActionWire[];
  /**
   * The dedicated "Approve visible chunk" action the room renders the FOURTH
   * family button from (2026-06-06-discovery-review-room-agenda-redesign-2, Task
   * Group 1). Present for FAMILY chunks ONLY (alongside `familyBulkActions`),
   * ABSENT otherwise. It maps to an `apply-decision` with `action: 'approved'` +
   * `scope: 'family'` (the `deriveFamilyForSeed` reach — seed ∪ direct
   * `parent_child` children only; the associated logical entities/attributes are
   * NOT cascaded and arrive as their own later chunks). ADDITIVE + optional, kept
   * SEPARATE from `familyBulkActions` so the parity-tested resolver action enum is
   * NOT widened.
   */
  familyVisibleChunkAction?: FamilyVisibleChunkActionWire;
  /**
   * The rich multi-line cascade summary this FAMILY chunk renders
   * (2026-06-06-discovery-review-room-agenda-redesign-2, S2) — the full-cascade
   * `total` plus the per-`candidate_type` breakdown with the three already-*
   * sub-counts. Present for FAMILY chunks ONLY (alongside `family`), ABSENT for
   * orphan-by-type / findings / cross-scan-LINK chunks. ADDITIVE + optional so
   * non-family chunks still parse. Server-supplied by a gateway-only pure builder.
   */
  cascadePreview?: CascadePreviewWire;
  /**
   * The cross-layer (logical↔physical) mapping note (Spec 2026-06-08). Present for
   * a FAMILY chunk whose parent is a logical/physical data entity with ≥1
   * cross-layer mapping; ABSENT otherwise. ADDITIVE + optional.
   */
  crossLayerMapping?: CrossLayerMappingWire;
  /**
   * The type-level bulk control for an ORPHAN-by-type candidate chunk (2026-06-09)
   * — the frontend mirror of the gateway `ChunkSummaryTurn.typeBulk`. Present ONLY
   * when this chunk is a homogeneous run of orphan candidates of ONE
   * `candidate_type` with no `parent_child` family (e.g. the `business_logics`
   * service methods). The room renders Approve-all / Reject-all / Defer-all buttons
   * that propose an `apply-decision-by-type` intent. `actionableCount` is the
   * count of still-actionable candidates of this (type, scan) across the WHOLE
   * model (the "Approve all N" figure). ADDITIVE + optional.
   */
  typeBulk?: {
    candidateType: string;
    scanScope: 'code' | 'database';
    actionableCount: number;
  };
  /** The dispositions the type-level bulk offers (Approve all / Reject all / Defer all). */
  typeBulkActions?: BulkReviewActionWire[];
  /**
   * The findings bulk control for a findings-by-severity chunk (2026-06-09) — the
   * frontend mirror of the gateway `ChunkSummaryTurn.findingsBulk`. Present ONLY on
   * a findings chunk. The room renders Approve-all / Reject-all / Defer-all buttons
   * that propose an `apply-decision-findings` intent. ADDITIVE + optional.
   */
  findingsBulk?: {
    scanScope: 'code' | 'database';
    actionableCount: number;
  };
  /** The dispositions the findings bulk offers (Approve all / Reject all / Defer all). */
  findingsBulkActions?: BulkReviewActionWire[];
}

export interface PreviewTurnWire {
  kind: 'preview';
  action: BulkReviewActionWire;
  totalCandidates: number;
  seedCandidates: number;
  cascadedCandidates: number;
  totalFindings: number;
  runTotalCandidates: number | null;
  runTotalFindings: number | null;
}

export interface PendingConfirmationTurnWire {
  kind: 'pending-confirmation';
  pendingId: string;
  intent: ProposedReviewIntentWire;
  /**
   * The DETERMINISTIC preview counts (apply-decision only; null for
   * conflict/save intents). NEVER an LLM-asserted number — sourced server-side
   * from `resolveBulkActionSet` / the conflict reads.
   */
  previewCounts: {
    totalCandidates: number;
    seedCandidates: number;
    cascadedCandidates: number;
    totalFindings: number;
  } | null;
  /**
   * For a bulk-pattern resolve: the deterministic class facts the user MUST see
   * before applying (exact count + attribute + competing sources). Null otherwise.
   */
  patternFacts: {
    attr: string;
    classMemberCount: number;
    competingSources: string[];
    chosenSource: string;
  } | null;
  /**
   * The off-screen overage of an apply-decision whose touched set is NOT fully
   * contained in the rendered family (2026-06-05 Task Group 3). When the gate is
   * SHOWN because the cascade reaches beyond the family, this carries the two
   * DISTINCT figures the confirm surface displays:
   *   - `beyondFamilyCount`     — "+N beyond this family" (resolved entity/
   *     candidate NODES outside the rendered family).
   *   - `relationshipsDroppedCount` — "+N relationships dropped" (resolved
   *     relationship-row (EDGE) candidates Spec A surfaces on REJECT; never
   *     rendered inside a family chunk, so always off-screen).
   * Null for a fully-visible apply (which never reaches the gate) and for
   * conflict/save intents. Both counts are deterministic (server-supplied), never
   * an LLM number.
   *
   * 2026-06-06 redesign-2: the chunk confirm gate is retired, so apply-decisions
   * no longer open this gate or populate `overage`; it survives only for
   * transcript-replay back-compat (the terminal Save carries `overage: null`).
   */
  overage: {
    beyondFamilyCount: number;
    relationshipsDroppedCount: number;
  } | null;
  summary: string;
}

export interface DecisionAppliedTurnWire {
  kind: 'decision-applied';
  action: BulkReviewActionWire;
  candidateIds: string[];
  findingIds: string[];
  appliedCandidateCount: number | null;
  appliedFindingCount: number | null;
}

export interface ConflictResolvedTurnWire {
  kind: 'conflict-resolved';
  candidateId: string;
  attr: string;
  chosenValue: unknown;
  chosenSource: string;
}

export interface BulkPatternResolvedTurnWire {
  kind: 'bulk-pattern-resolved';
  attr: string;
  chosenSource: string;
  candidateIds: string[];
  resolvedCount: number;
}

export interface SavedTurnWire {
  kind: 'saved';
  savedCount: number | null;
}

export interface ErrorTurnWire {
  kind: 'error';
  errorKind: string;
  errorMessage: string;
  recoverableHint?: string;
}

export interface UserMessageTurnWire {
  kind: 'user-message';
  text: string;
}

export interface NarrationTurnWire {
  kind: 'narration';
  text: string;
}

export type ReviewTurnWire =
  | OpenTurnWire
  | ChunkSummaryTurnWire
  | PreviewTurnWire
  | PendingConfirmationTurnWire
  | DecisionAppliedTurnWire
  | ConflictResolvedTurnWire
  | BulkPatternResolvedTurnWire
  | SavedTurnWire
  | ErrorTurnWire
  | UserMessageTurnWire
  | NarrationTurnWire;

// ============================================================================
// Response unions — mirror the coordinator's ReviewTurnOutcome / ConfirmPendingOutcome.
// ============================================================================

export type ReviewTurnOutcomeWire =
  | {
      /**
       * The TERMINAL Save (a `save` intent) opened the one surviving
       * `pending-confirmation` gate and is awaiting an explicit Yes/No. After the
       * 2026-06-06 redesign this is the ONLY intent that reaches a pending gate;
       * chunk dispositions + conflicts apply immediately and return `'applied'`.
       */
      kind: 'pending-confirmation';
      userMessageTurn: UserMessageTurnWire | null;
      previewTurn: PreviewTurnWire | null;
      pendingTurn: PendingConfirmationTurnWire;
    }
  | {
      /**
       * THE IMMEDIATE-APPLY outcome (2026-06-06 Task Group 4, extending the
       * 2026-06-05 Task Group 3 confirm-skip). A chunk disposition
       * (`apply-decision`, both `scope` values) or a conflict resolution
       * (`resolve-conflict` / `resolve-conflicts-by-pattern`) was applied
       * IMMEDIATELY server-side (the click WAS the confirmation) — NO
       * `pending-confirmation` turn was appended. The room reflects `appliedTurn`
       * (the orchestrator's write evidence) + the `previewTurn` counts WITHOUT a
       * confirm surface, then auto-advances using the fields below.
       *
       * `nextChunk` / `advanced` / `terminalSaveTurn` are ALWAYS emitted by the
       * gateway, but kept ADDITIVE + optional here (the established mirror
       * convention) so older `'applied'` fixtures still parse:
       *   - `advanced === true`  (a DISPOSITION): append `nextChunk` (the NEXT
       *     agenda chunk, or null when the agenda is exhausted) and scroll. When
       *     `nextChunk === null`, `terminalSaveTurn` carries the auto-appended
       *     terminal Save Yes/No.
       *   - `advanced === false` (a CONFLICT): `nextChunk` is the SAME chunk
       *     REFRESHED with the conflict cleared — replace the current chunk IN
       *     PLACE and do NOT advance (Q4). `terminalSaveTurn` is null.
       */
      kind: 'applied';
      userMessageTurn: UserMessageTurnWire | null;
      previewTurn: PreviewTurnWire | null;
      appliedTurn:
        | DecisionAppliedTurnWire
        | ConflictResolvedTurnWire
        | BulkPatternResolvedTurnWire;
      /**
       * The chunk to render next. For a disposition (`advanced === true`) this is
       * the NEXT agenda chunk (null when exhausted); for a conflict
       * (`advanced === false`) this is the SAME chunk refreshed (conflict cleared).
       * Gateway always emits it (possibly null); optional on the mirror.
       */
      nextChunk?: ChunkSummaryTurnWire | null;
      /** TRUE for a disposition (append + scroll); FALSE for a conflict (replace in place). */
      advanced?: boolean;
      /**
       * The auto-appended terminal Save Yes/No, present ONLY when a disposition
       * left the agenda exhausted (`nextChunk === null`); null otherwise. The ONLY
       * surviving `PendingConfirmationTurnWire` use.
       */
      terminalSaveTurn?: PendingConfirmationTurnWire | null;
    }
  | {
      kind: 'narrated';
      userMessageTurn: UserMessageTurnWire | null;
      narrationTurn: NarrationTurnWire;
      chunkTurn: ChunkSummaryTurnWire | null;
    }
  | {
      kind: 'error';
      userMessageTurn: UserMessageTurnWire | null;
      errorTurn: ErrorTurnWire;
    };

export type ConfirmReviewOutcomeWire =
  | { kind: 'applied'; appliedTurn: ReviewTurnWire }
  | { kind: 'cancelled'; narrationTurn: NarrationTurnWire }
  | { kind: 'error'; errorTurn: ErrorTurnWire };

export interface ReviewConversationEnvelope {
  threadId: string;
  turns: ReviewTurnWire[];
}

export interface StartReviewResponse {
  sessionId: string;
  openTurn: OpenTurnWire;
  firstChunk: ChunkSummaryTurnWire;
}

/** The authoritative whole-run counts the room re-reads after each write. */
export interface ReviewModelCounts {
  actionableCount: number;
  committedCount: number;
  liveConflictCount: number;
  totalCandidates: number;
  totalFindings: number;
}

// ============================================================================
// Calls
// ============================================================================

/** GET the transcript envelope for a run's review conversation. */
export async function loadReviewConversation(
  projectId: string,
  architectureId: string,
  runId: string,
): Promise<ReviewConversationEnvelope> {
  const res = await fetch(convPath(projectId, architectureId, runId), jsonInit('GET'));
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ReviewConversationEnvelope;
}

export interface StartReviewArgs {
  projectId: string;
  architectureId: string;
  /** The PRIMARY run id (keys the thread + the write path). */
  runId: string;
  openedBy: string;
  scanPair: SelectedScanSetWire;
}

/** POST /start — append the `open` turn + the first deterministic chunk. */
export async function startReview(args: StartReviewArgs): Promise<StartReviewResponse> {
  const url = `${convPath(args.projectId, args.architectureId, args.runId)}/start`;
  const res = await fetch(
    url,
    jsonInit('POST', { openedBy: args.openedBy, scanPair: args.scanPair }),
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as StartReviewResponse;
}

export interface AnswerReviewTurnArgs {
  projectId: string;
  architectureId: string;
  runId: string;
  userMessage: string;
  scanPair: SelectedScanSetWire;
}

/**
 * POST /answer — the LLM path. The LLM only PROPOSES. A chunk disposition /
 * conflict applies immediately (`'applied'`); a `save` proposal opens the terminal
 * gate (`pending-confirmation`); otherwise it `narrated`. The numbers are always
 * server-supplied.
 */
export async function answerReviewTurn(
  args: AnswerReviewTurnArgs,
): Promise<ReviewTurnOutcomeWire> {
  const url = `${convPath(args.projectId, args.architectureId, args.runId)}/answer`;
  const res = await fetch(
    url,
    jsonInit('POST', { userMessage: args.userMessage, scanPair: args.scanPair }),
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ReviewTurnOutcomeWire;
}

export type CaptureReviewAction =
  | { action: 'advance-chunk'; agendaCursor: number }
  | { action: 'propose-intent'; intent: ProposedReviewIntentWire; userText?: string };

export interface CaptureReviewTurnArgs {
  projectId: string;
  architectureId: string;
  runId: string;
  scanPair: SelectedScanSetWire;
  capture: CaptureReviewAction;
}

/**
 * POST /capture — the deterministic NO-LLM path (the click-to-act agenda). A
 * `propose-intent` for a chunk disposition / conflict applies IMMEDIATELY and
 * returns `'applied'` (with the next-chunk / refreshed-chunk auto-advance); an
 * `advance-chunk` returns the next chunk as a `narrated` outcome.
 */
export async function captureReviewTurn(
  args: CaptureReviewTurnArgs,
): Promise<ReviewTurnOutcomeWire> {
  const url = `${convPath(args.projectId, args.architectureId, args.runId)}/capture`;
  const res = await fetch(url, jsonInit('POST', { ...args.capture, scanPair: args.scanPair }));
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ReviewTurnOutcomeWire;
}

export interface ConfirmReviewTurnArgs {
  projectId: string;
  architectureId: string;
  runId: string;
  /** Correlates to the still-pending intent on the pending-confirmation turn. */
  pendingId: string;
  intent: ProposedReviewIntentWire;
  /** The explicit confirm: a click (always a confirm) OR a re-validated NL "yes". */
  confirmation: { kind: 'click' } | { kind: 'natural-language'; text: string };
  scanPair: SelectedScanSetWire;
}

/**
 * POST /confirm — the TERMINAL Save write path. After the 2026-06-06 redesign this
 * applies ONLY the terminal `save` intent (auto-appended on agenda exhaustion)
 * after an explicit Yes/No. Returns `applied` (the save happened), `cancelled` (a
 * natural-language reply that did not re-validate as affirmative — NO write), or
 * `error`.
 */
export async function confirmReviewTurn(
  args: ConfirmReviewTurnArgs,
): Promise<ConfirmReviewOutcomeWire> {
  const url = `${convPath(args.projectId, args.architectureId, args.runId)}/confirm`;
  const res = await fetch(
    url,
    jsonInit('POST', {
      pendingId: args.pendingId,
      intent: args.intent,
      confirmation: args.confirmation,
      scanPair: args.scanPair,
    }),
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ConfirmReviewOutcomeWire;
}

/**
 * Read the authoritative whole-run counts from the Spec 1 `review-model`
 * backbone (the SAME endpoint the grid reads), forwarding the FULL
 * additional-run-id set for the N-run union. Used for the room's
 * re-read-after-write so the counts stay authoritative (Decision 6).
 *
 * `runId` (= `primaryRunId`) stays the path anchor; every OTHER selected run
 * rides as a repeated `secondRunId=...` query param (the discovery-service
 * route unions `[primaryRunId, ...additionalRunIds]`). Widened from a single
 * optional `secondRunId` to the full set for per-service scan selection (spec
 * `2026-06-05-per-service-scan-selection`, Task Group 4.8) so a 2-code + 1-DB
 * review reads its true unioned counts. A bare string is still accepted for
 * back-compat with single-extra callers; null/undefined/empty forwards nothing.
 *
 * Returns just the convenience scalars the room surfaces (the full model is
 * large; the room only needs the headline counts).
 */
export async function getReviewModelCounts(
  projectId: string,
  architectureId: string,
  runId: string,
  additionalRunIds?: string | readonly string[] | null,
): Promise<ReviewModelCounts> {
  let url =
    `${GATEWAY_BASE}/api/v1/discovery/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/runs/${encodeURIComponent(runId)}/review-model`;
  // Normalise to a de-duplicated additional-run-id set (the primary is the path
  // anchor, never repeated as a query param). Emit one `secondRunId=...` each.
  const extras = (
    typeof additionalRunIds === 'string'
      ? [additionalRunIds]
      : additionalRunIds ?? []
  ).filter((id): id is string => typeof id === 'string' && id.length > 0 && id !== runId);
  const uniqueExtras = Array.from(new Set(extras));
  if (uniqueExtras.length > 0) {
    const qs = uniqueExtras
      .map((id) => `secondRunId=${encodeURIComponent(id)}`)
      .join('&');
    url += `?${qs}`;
  }
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw await parseError(res);
  const model = (await res.json()) as {
    aggregations?: {
      total_candidates?: number;
      total_findings?: number;
      committed_count?: number;
      actionable_count?: number;
      live_conflict_count?: number;
    };
  };
  const agg = model.aggregations ?? {};
  return {
    actionableCount: agg.actionable_count ?? 0,
    committedCount: agg.committed_count ?? 0,
    liveConflictCount: agg.live_conflict_count ?? 0,
    totalCandidates: agg.total_candidates ?? 0,
    totalFindings: agg.total_findings ?? 0,
  };
}
