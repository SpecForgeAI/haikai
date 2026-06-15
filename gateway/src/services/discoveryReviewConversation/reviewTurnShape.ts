/**
 * Discovery-Review Conversation Transcript Turn Shape (Spec 3 — capstone, Task
 * Group 3.3).
 *
 * Spec: 2026-06-02-conversational-discovery-review-architect
 *       + 2026-06-05-review-room-agenda-redesign (Task Group 2: family awareness
 *         on the chunk turn + the family-bulk control flag).
 *       + 2026-06-06-discovery-review-room-agenda-redesign-2 (Task Group 1: the
 *         rich `cascadePreview` field, the "Approve visible chunk" action, the
 *         apply-decision `scope` discriminator, and the retirement of
 *         `PendingConfirmationTurn` to the TERMINAL Save only).
 *
 * The review-flavoured closed turn union for the conversational "Architect"
 * discovery-review persona. Modeled on the target-state chassis
 * `architectConversation/turnShape.ts` (the closed-union-the-frontend-renders-
 * per-kind pattern) but with REVIEW kinds instead of decision-capture kinds.
 *
 * IMPORTANT: This file is type-only. No I/O, no orchestration, no LLM.
 *
 * Persistence: turns are appended via the discovery-review thread store
 * (`discoveryReviewConversationStore.ts`) which sees only `unknown[]` — this
 * file owns the typed shape and is the single source of truth for downstream
 * readers (the orchestrator, the routes, the frontend renderer).
 *
 * The single net-new SAFETY property the union encodes (per the oracle
 * standard): the `pending-confirmation` turn carries the DETERMINISTIC preview
 * counts the coordinator attached (never an LLM-asserted number) plus the
 * structured mutation intent; nothing about a `pending-confirmation` turn
 * implies a write has happened. The matching `decision-applied` /
 * `conflict-resolved` / `bulk-pattern-resolved` / `saved` turns are ONLY ever
 * appended by the orchestrator AFTER it performed the real write — so a reader
 * walking the transcript can trust those kinds as evidence of a committed
 * mutation.
 *
 * 2026-06-06 redesign-2 note on the confirm gate: after this spec the ONLY turn
 * that opens a `pending-confirmation` is the TERMINAL "Save all approved
 * candidates back to the architecture?" Yes/No, surfaced ONLY when the agenda is
 * exhausted. The per-chunk + per-conflict confirm gate is retired — chunk
 * dispositions and conflict resolutions apply IMMEDIATELY (the click IS the
 * confirmation). `PendingConfirmationTurn` remains in the union purely for that
 * one terminal Save use (the coordinator/orchestrator change owns the behaviour;
 * this file only documents/constrains the type's surviving use).
 */

import type { BulkReviewAction } from '../discovery/reviewModelWire';

// ---------------------------------------------------------------------------
// Closed review turn-kind union
// ---------------------------------------------------------------------------

export type ReviewTurnKind =
  | 'open'
  | 'chunk-summary'
  | 'preview'
  | 'pending-confirmation'
  | 'decision-applied'
  | 'conflict-resolved'
  | 'bulk-pattern-resolved'
  | 'saved'
  | 'error'
  // The deterministic click-to-answer turns (the NO-LLM path the room degrades
  // to). `user-message` records the reviewer's verbatim free-text or click;
  // `narration` records a deterministic Architect line surfaced WITHOUT the LLM.
  | 'user-message'
  | 'narration';

// ---------------------------------------------------------------------------
// Shared payload bits
// ---------------------------------------------------------------------------

/**
 * The selected scan SET recorded on the `open` turn -- the N-run successor to
 * the retired 2-run scan pair (spec `2026-06-05-per-service-scan-selection`, Task
 * Group 1; the pair was removed in Task Group 2). Replaces the hardcoded
 * "max 1 code + 1 database" pair with one
 * selected run PER scanned service (0-or-1 each), so a UI + Service + DB review
 * (2 code + 1 DB) is legitimate -- there is no `primaryScanKind !== secondScanKind`
 * assumption here.
 *
 * `primaryRunId` STAYS the thread anchor (the first chosen run in a deterministic
 * order) so the run-id-keyed routes (`startReview` / `/answer` / `/capture` /
 * `/confirm` / `loadReviewConversation`) keep `:runId = primaryRunId` and don't
 * churn; the rest of the selection rides alongside in `runs[]` the way
 * `secondRunId` did before. `primaryRunId` MUST appear as one of `runs[].runId`.
 *
 * Each entry's `serviceId` is the run's `service_id` FK (nullable since Liquibase
 * 126 -- an orphan run carries `null`, surfacing under the picker's "Unassigned
 * scans" bucket).
 */
export interface SelectedScanSet {
  /** Every selected run (0-or-1 per scanned service; >=1 overall). */
  runs: Array<{
    /** The run id of this selected scan. */
    runId: string;
    /** This run's scan kind. */
    scanKind: 'code' | 'database';
    /** The run's service FK, or null for an orphan / "Unassigned" run. */
    serviceId: string | null;
  }>;
  /**
   * The PRIMARY run id -- the thread/path anchor (the first chosen run in a
   * deterministic order). MUST equal one of `runs[].runId`.
   */
  primaryRunId: string;
}

/**
 * One agenda section label, in the deterministic ARCHITECTURAL order the sequencer
 * emits (2026-06-09 reorder): interfaces & endpoints → logical data model →
 * physical data model → cross-scan logical↔physical mappings → business logic →
 * findings. The order walks the architecture top-down (contract → logical →
 * physical → the bridge between them → behaviour → cross-cutting evidence) rather
 * than by review priority; live conflicts are shown INLINE at each item's
 * architectural position (no separate conflicts-first band). Carried on
 * `chunk-summary` so the frontend can label the chunk.
 */
export type AgendaSectionKind =
  | 'interfaces-endpoints'
  | 'logical-data'
  | 'physical-data'
  | 'cross-scan-links'
  | 'business-logic'
  | 'findings-by-severity';

/**
 * The apply REACH discriminator on an `apply-decision` intent
 * (2026-06-06-discovery-review-room-agenda-redesign-2, S1). It selects WHICH id
 * set the coordinator hands the unchanged AMS bulk-review applicator:
 *
 *   - `'cascade'` — the resolver's FULL touched set (today's behaviour: seed ∪
 *     the whole reject/approve/defer cascade). This is the "Approve All" /
 *     "Reject All" / "Defer All" reach.
 *   - `'family'`  — the EXACT family id set from the pure
 *     `deriveFamilyForSeed(seeds, model)` (seed ∪ its DIRECT `parent_child`
 *     children) ONLY. This is the "Approve visible chunk" reach: the associated
 *     logical entities/attributes are NOT cascaded and arrive as their own later
 *     chunks.
 *
 * The selection lives ENTIRELY in the coordinator — `resolveBulkActionSet` stays
 * PURE with no shallow flag, and the orchestrator's flat `candidate_ids[]` write
 * path is unchanged (only WHICH ids are sent differs). ADDITIVE + optional:
 * callers that omit it default to `'cascade'` (today's full-cascade behaviour).
 */
export type ReviewApplyScope = 'family' | 'cascade';

/**
 * The structured mutation intent the LLM PROPOSES (modeled on the chassis
 * reserved `submit_structured_answer`). It is data only — proposing it NEVER
 * writes. The coordinator surfaces it on a `pending-confirmation` turn with the
 * deterministic preview counts attached; the orchestrator only acts on it after
 * an explicit confirm. The four variants mirror the four orchestrator writers.
 */
export type ProposedReviewIntent =
  | {
      kind: 'apply-decision';
      /** The seed candidate ids the bulk apply is scoped from. */
      seedCandidateIds: string[];
      /** Findings to apply the disposition to (Spec F shared vocabulary). */
      findingIds: string[];
      /** The chosen disposition. */
      action: BulkReviewAction;
      /** Optional reviewer notes forwarded to the atomic apply. */
      reviewerNotes?: string;
      /**
       * The apply REACH (2026-06-06 agenda-redesign-2, S1): `'family'` applies
       * ONLY `deriveFamilyForSeed` (seed ∪ direct `parent_child` children) for
       * "Approve visible chunk"; `'cascade'` applies the resolver's full touched
       * set for "Approve All" / "Reject All" / "Defer All". ADDITIVE + optional —
       * absent defaults to `'cascade'` (today's full-cascade behaviour), so every
       * existing caller is unchanged.
       */
      scope?: ReviewApplyScope;
    }
  | {
      /**
       * Type-level bulk disposition (2026-06-09): Approve / Reject / Defer ALL
       * still-actionable candidates of a single `candidate_type` within a scan —
       * the "Approve all N <type>" control on an ORPHAN-by-type chunk. Those
       * candidates have NO `parent_child` parent, so they never family-chunk and
       * otherwise can only be actioned one row at a time. The coordinator
       * enumerates the target set from the model server-side (no cascade, no family
       * expansion — orphan-by-type candidates have no children), so the frontend
       * never sends the potentially-thousands of ids. Already-decided / committed
       * members are filtered out before the write.
       */
      kind: 'apply-decision-by-type';
      /** The `candidate_type` to bulk-apply. */
      candidateType: string;
      /** The scan whose candidates of this type are targeted. */
      scanScope: 'code' | 'database';
      /** The chosen disposition. */
      action: BulkReviewAction;
      /** Optional reviewer notes forwarded to the atomic apply. */
      reviewerNotes?: string;
    }
  | {
      /**
       * Findings bulk disposition (2026-06-09): Approve / Reject / Defer ALL
       * still-actionable FINDINGS within a scan — the "Approve all N findings"
       * control on a findings-by-severity chunk (findings are not families nor
       * candidates, so they otherwise had NO bulk control). The coordinator
       * enumerates the actionable finding ids from the model server-side and routes
       * the disposition through the findings apply path.
       */
      kind: 'apply-decision-findings';
      /** The scan whose findings are targeted. */
      scanScope: 'code' | 'database';
      /** The chosen disposition. */
      action: BulkReviewAction;
      /** Optional reviewer notes forwarded to the apply. */
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
      /** The candidate the similarity class was anchored on. */
      candidateId: string;
      attr: string;
      /** The source chosen for ALL members of the class (resolve-by-SAME-SOURCE). */
      chosenSource: string;
      /** The candidate ids in the similarity class (≥2). */
      classCandidateIds: string[];
    }
  | {
      kind: 'save';
    };

// ---------------------------------------------------------------------------
// Per-kind payloads
// ---------------------------------------------------------------------------

export interface OpenTurn {
  kind: 'open';
  sessionId: string;
  openedBy: string;
  /**
   * The selected scan SET (per-service scan selection,
   * `2026-06-05-per-service-scan-selection`). `primaryRunId` keys the thread; the
   * rest of the chosen runs (0-or-1 per scanned service) ride in `runs[]`.
   */
  scanPair: SelectedScanSet;
}

/**
 * The competing facts of ONE live conflict attribute on a chunk item. Present
 * (on `ChunkItemRef.conflicts`) only for live-conflict-section candidates so the
 * frontend can render deterministic "pick a source" controls WITHOUT consulting
 * the LLM. The values are read straight from the Spec 0 `conflict_state` +
 * `getSimilarConflicts` — never recomputed or LLM-asserted.
 */
export interface ChunkItemConflictFact {
  /** The conflicting attribute name. */
  attr: string;
  /** The competing values per source (raw Spec 0 `_conflicts[attr]`). */
  competing: Array<{ value: unknown; source: string }>;
  /**
   * Size of the similarity class (same attr + same competing source-set). `>= 2`
   * enables a "resolve all" (resolve-conflicts-by-pattern) offer for this attr.
   */
  similarCount: number;
}

/** One agenda item surfaced in a chunk (a candidate or a finding reference). */
export interface ChunkItemRef {
  /** The node/finding id. */
  id: string;
  /** Whether this item is a candidate node or a finding node. */
  itemType: 'candidate' | 'finding';
  /** Display name (candidate name, or a finding label). */
  name: string;
  /** The candidate_type (for candidates) or the severity (for findings); informational. */
  detail: string;
  /**
   * The live-conflict facts for this candidate (live-conflict-section items
   * ONLY; absent otherwise). Populated by the sequencer from `conflict_state` +
   * `getSimilarConflicts` so the frontend can offer deterministic source-pick +
   * resolve-all controls without consulting the LLM.
   */
  conflicts?: ChunkItemConflictFact[];
}

/**
 * The two-level structural FAMILY a chunk renders (2026-06-05 Task Group 2). A
 * family = ONE parent node + its DIRECT `parent_child` children, the exact unit
 * the Group 1 sequencer chunked the agenda into (one chunk per family). Carried
 * ADDITIVELY on `ChunkSummaryTurn.family` for family chunks ONLY — absent for
 * orphan-by-type / findings / cross-scan chunks (which are not families).
 *
 * `parentId` is the parent node's id (always the FIRST item in `items`), and
 * `childIds` is the ids of its direct `parent_child` children present in the
 * chunk (the remaining `items`). The frontend reads these to render the parent
 * with indented children + a single family-level bulk control; the coordinator's
 * server-side confirm-skip re-derives the SAME family (parent + parent_child
 * children) from the model, so this is a surface of what Group 1 computed, not a
 * second derivation.
 */
export interface ChunkFamily {
  /** The family parent node id (also the first id in `ChunkSummaryTurn.items`). */
  parentId: string;
  /** The parent's direct `parent_child` child node ids present in this chunk. */
  childIds: string[];
}

/**
 * One per-`candidate_type` row of the rich cascade preview
 * (2026-06-06-discovery-review-room-agenda-redesign-2, S2). `type` is the
 * `candidate_type`; `count` is the full-cascade count of that type (how many
 * members of this type "Approve All" would touch); the three sub-counts are how
 * many of those members are ALREADY in each terminal disposition. The breakdown
 * is type-driven, so a DATABASE-scan family (a physical entity/table → its
 * columns + cross-scan logical↔physical mappings) renders analogously to a
 * code-scan family (an interface → its endpoints + associated logical
 * entities/attributes). The frontend renders the "(N already approved)" /
 * "(N already rejected)" / "(N already deferred)" annotations from these
 * (only when non-zero).
 */
export interface CascadePreviewByType {
  /** The `candidate_type` this row aggregates. */
  type: string;
  /** Full-cascade count of this type (members "Approve All" would touch). */
  count: number;
  /** Of `count`, how many are already `approved`. */
  alreadyApproved: number;
  /** Of `count`, how many are already `rejected`. */
  alreadyRejected: number;
  /** Of `count`, how many are already `deferred`. */
  alreadyDeferred: number;
}

/**
 * The rich multi-line cascade summary a FAMILY chunk renders
 * (2026-06-06-discovery-review-room-agenda-redesign-2, S2). Carried ADDITIVELY +
 * OPTIONALLY on `ChunkSummaryTurn.cascadePreview` for FAMILY chunks ONLY — absent
 * for orphan-by-type / findings / cross-scan-LINK chunks (which keep the existing
 * per-item treatment and have no shallow-vs-full distinction).
 *
 * `total` is the full-cascade total (the "Review the current N candidates" line —
 * the distinct candidate count "Approve All" would touch); `byType` is the
 * per-`candidate_type` breakdown, each row carrying the full-cascade `count` of
 * that type plus the three already-* sub-counts. A NEW gateway-only, PURE,
 * cycle-safe builder computes this over the FULL review model the coordinator
 * already holds — it does NOT widen the parity-tested resolver wire, so there is
 * NO resolver/parity-fixture churn for the preview.
 */
export interface CascadePreview {
  /** The full-cascade total (distinct candidates "Approve All" would touch). */
  total: number;
  /** The per-`candidate_type` breakdown with the three already-* sub-counts. */
  byType: CascadePreviewByType[];
}

/**
 * The dedicated "Approve visible chunk" family action
 * (2026-06-06-discovery-review-room-agenda-redesign-2, Task Group 1). It sits
 * ALONGSIDE the three `familyBulkActions` dispositions (the full-cascade Approve
 * All / Reject All / Defer All) to make the FOUR-button family layout
 * expressible WITHOUT widening the parity-tested resolver `BulkReviewAction`
 * enum (`{ approved | rejected | deferred }`). "Approve visible chunk" maps to an
 * `apply-decision` with `action: 'approved'` + `scope: 'family'` (the
 * `deriveFamilyForSeed` reach) — see {@link ReviewApplyScope}.
 */
export type FamilyVisibleChunkAction = 'approve-visible-chunk';

/**
 * Cross-layer (logical↔physical) mapping context for a FAMILY chunk
 * (Spec 2026-06-08 "don't cross layers on approve"). The logical↔physical cascade
 * is intentionally NOT crossed — approving/rejecting a logical entity does NOT pull
 * in the mapped physical entity (and vice-versa); the two layers are reviewed as
 * separate families. This note PRESERVES the connection on the chunk:
 *   - on a PHYSICAL-entity family: the mapped LOGICAL entities + their disposition
 *     tally (the "you have already approved/rejected N logical entities mapped to
 *     this physical entity" note);
 *   - on a LOGICAL-entity family: the mapped PHYSICAL entity names (reviewed
 *     separately in the database scan).
 * Present ONLY when the family parent is a logical/physical data entity with ≥1
 * cross-layer mapping; ABSENT otherwise. ADDITIVE + optional.
 */
export interface CrossLayerMapping {
  /** Which layer THIS family's parent sits in. */
  parentLayer: 'logical' | 'physical';
  /** Display names of the mapped counterpart entities in the OTHER layer (de-duped). */
  counterpartNames: string[];
  /**
   * For a PHYSICAL parent: the review-disposition tally of the mapped LOGICAL
   * entities (the "already approved/rejected" note). Omitted for a logical parent
   * (its physical counterparts are reviewed LATER, so there is nothing decided to
   * report — the note just names them).
   */
  mappedDecisions?: {
    approved: number;
    rejected: number;
    deferred: number;
    pending: number;
  };
}

export interface ChunkSummaryTurn {
  kind: 'chunk-summary';
  /** Which agenda section this chunk belongs to. */
  section: AgendaSectionKind;
  /** The scan scope of this chunk's items. */
  scanScope: 'code' | 'database' | 'cross-scan';
  /** The ~10-20 items in this chunk, deterministically ordered. */
  items: ChunkItemRef[];
  /** The agenda cursor that produced this chunk (opaque to the frontend). */
  cursor: number;
  /** The advancing cursor to request the NEXT chunk; null when the agenda is exhausted. */
  nextCursor: number | null;
  /** Total agenda items across all sections (for a progress indicator). */
  agendaTotal: number;
  /**
   * The two-level structural family this chunk renders (2026-06-05 Task Group 2)
   * — present for FAMILY chunks ONLY (a parent + its direct `parent_child`
   * children), ABSENT for orphan-by-type / findings / cross-scan chunks. ADDITIVE
   * + optional so non-family chunks still validate. When present, `family.parentId`
   * is the first item in `items` and `family.childIds` are the remaining child
   * items. Populated by the sequencer from the family Group 1 already chunked on.
   */
  family?: ChunkFamily;
  /**
   * The family-level bulk dispositions the frontend renders an Approve-all /
   * Reject-all / Defer-all control from (2026-06-05 Task Group 2). Present for
   * FAMILY chunks ONLY (alongside `family`), ABSENT otherwise. The frontend
   * proposes a family bulk by seeding `family.parentId` into the existing
   * `apply-decision` intent (the cascade pulls the `parent_child` children), so
   * the touched set the server-side confirm-skip compares is EXACT against the
   * re-derived family. ADDITIVE + optional.
   *
   * 2026-06-06 redesign-2: these three are now the full-cascade
   * (`scope: 'cascade'`) Approve All / Reject All / Defer All; the FOURTH button
   * ("Approve visible chunk", `scope: 'family'`) is advertised separately via
   * {@link ChunkSummaryTurn.familyVisibleChunkAction}.
   */
  familyBulkActions?: BulkReviewAction[];
  /**
   * The dedicated "Approve visible chunk" action the frontend renders the FOURTH
   * family button from (2026-06-06-discovery-review-room-agenda-redesign-2, Task
   * Group 1). Present for FAMILY chunks ONLY (alongside `familyBulkActions`),
   * ABSENT otherwise. It maps to an `apply-decision` with `action: 'approved'` +
   * `scope: 'family'` (the `deriveFamilyForSeed` reach — seed ∪ direct
   * `parent_child` children only; the associated logical entities/attributes are
   * NOT cascaded and arrive as their own later chunks). ADDITIVE + optional, kept
   * SEPARATE from `familyBulkActions` so the parity-tested resolver
   * `BulkReviewAction` enum is NOT widened.
   */
  familyVisibleChunkAction?: FamilyVisibleChunkAction;
  /**
   * The rich multi-line cascade summary this FAMILY chunk renders
   * (2026-06-06-discovery-review-room-agenda-redesign-2, S2) — the full-cascade
   * `total` plus the per-`candidate_type` breakdown with the three already-*
   * sub-counts. Present for FAMILY chunks ONLY (alongside `family`), ABSENT for
   * orphan-by-type / findings / cross-scan-LINK chunks. ADDITIVE + optional so
   * non-family chunks still validate against the closed `ReviewTurn` union.
   * Computed by a NEW gateway-only, PURE, cycle-safe builder over the FULL review
   * model the coordinator already holds — it does NOT widen the parity-tested
   * resolver wire.
   */
  cascadePreview?: CascadePreview;
  /**
   * Cross-layer (logical↔physical) mapping note (Spec 2026-06-08). Present for a
   * FAMILY chunk whose parent is a logical/physical data entity with ≥1 cross-layer
   * mapping; ABSENT otherwise. Preserves the logical↔physical connection that the
   * cascade intentionally does NOT cross. ADDITIVE + optional.
   */
  crossLayerMapping?: CrossLayerMapping;
  /**
   * The type-level bulk control for an ORPHAN-by-type candidate chunk (2026-06-09).
   * Present ONLY when this chunk is a homogeneous run of orphan candidates of ONE
   * `candidate_type` with NO `parent_child` family (e.g. the 3,000+ `business_logics`
   * service methods) — ABSENT for family / findings / cross-scan chunks. The
   * frontend renders Approve-all / Reject-all / Defer-all buttons from it, proposing
   * an `apply-decision-by-type` intent the coordinator enumerates + writes
   * server-side. `actionableCount` is the count of STILL-ACTIONABLE candidates of
   * this (type, scan) across the WHOLE model (not just the visible slice) — the
   * "Approve all N" figure. ADDITIVE + optional.
   */
  typeBulk?: {
    /** The `candidate_type` the bulk control targets. */
    candidateType: string;
    /** The scan whose candidates of this type the bulk control targets. */
    scanScope: 'code' | 'database';
    /** Still-actionable candidates of this (type, scan) across the whole model. */
    actionableCount: number;
  };
  /**
   * The dispositions the type-level bulk offers (Approve all / Reject all / Defer
   * all). Present alongside `typeBulk`; ABSENT otherwise. Kept SEPARATE from the
   * family controls so the family layout is unaffected.
   */
  typeBulkActions?: BulkReviewAction[];
  /**
   * The findings bulk control for a findings-by-severity chunk (2026-06-09).
   * Present ONLY on a findings chunk — ABSENT for family / orphan-by-type /
   * cross-scan chunks. The frontend renders Approve-all / Reject-all / Defer-all
   * buttons from it, proposing an `apply-decision-findings` intent the coordinator
   * enumerates + applies across the WHOLE scan. `actionableCount` is the count of
   * still-actionable findings of this scan (the "Approve all N findings" figure).
   * ADDITIVE + optional.
   */
  findingsBulk?: {
    /** The scan whose findings the bulk control targets. */
    scanScope: 'code' | 'database';
    /** Still-actionable findings of this scan. */
    actionableCount: number;
  };
  /** The dispositions the findings bulk offers (Approve all / Reject all / Defer all). */
  findingsBulkActions?: BulkReviewAction[];
}

/**
 * The deterministic preview of a proposed apply-decision, carrying the touched
 * set + net counts straight from `resolveBulkActionSet` (NEVER an LLM number).
 * Surfaced as context BEFORE the user confirms.
 */
export interface PreviewTurn {
  kind: 'preview';
  action: BulkReviewAction;
  /** Distinct candidates in the touched set (seed + cascaded). */
  totalCandidates: number;
  /** Of `totalCandidates`, how many were seeds. */
  seedCandidates: number;
  /** Of `totalCandidates`, how many were pulled in by cascade. */
  cascadedCandidates: number;
  /** Distinct linked findings in the touched set. */
  totalFindings: number;
  /** Whole-run candidate total (the "of N" context), or null. */
  runTotalCandidates: number | null;
  /** Whole-run finding total, or null. */
  runTotalFindings: number | null;
}

/**
 * The HARD confirmation-gate surface. Carries the structured intent + the
 * DETERMINISTIC preview counts the coordinator attached. NO write has happened
 * when this turn is appended; the frontend renders a click-to-confirm button
 * and the reviewer may also confirm in natural language (re-validated against
 * the still-pending intent).
 *
 * 2026-06-06 redesign-2 — SURVIVING USE CONSTRAINT: after the confirm-box-removal
 * redesign this turn is opened for the TERMINAL "Save all approved candidates
 * back to the architecture?" Yes/No ONLY (a `save` intent), surfaced ONLY when an
 * apply leaves the agenda exhausted. Chunk dispositions (`apply-decision`,
 * including the `scope: 'family'` "Approve visible chunk") and conflict
 * resolutions (`resolve-conflict` / `resolve-conflicts-by-pattern`) NO LONGER
 * open this gate — they apply IMMEDIATELY (the click IS the confirmation). The
 * `previewCounts` / `patternFacts` / `overage` fields therefore remain only for
 * historic transcript-replay compatibility; new chunk/conflict flows never
 * populate them. The behaviour change lives in the coordinator/orchestrator; the
 * type stays in the union purely for the terminal Save.
 */
export interface PendingConfirmationTurn {
  kind: 'pending-confirmation';
  /** A stable id correlating the confirm/cancel back to THIS pending intent. */
  pendingId: string;
  /** The structured mutation intent awaiting an explicit confirm. */
  intent: ProposedReviewIntent;
  /**
   * The deterministic preview counts (apply-decision only; null for
   * conflict/save intents whose counts are described in `summary`). NEVER an
   * LLM-asserted number — sourced from `resolveBulkActionSet` / the conflict
   * reads.
   */
  previewCounts: {
    totalCandidates: number;
    seedCandidates: number;
    cascadedCandidates: number;
    totalFindings: number;
  } | null;
  /**
   * For a bulk-pattern resolve: the deterministic class facts the user MUST see
   * before applying (exact count + attribute + competing sources). Null
   * otherwise. The count is the class size; the sources are the competing
   * source labels from the live conflict.
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
   * DISTINCT figures the confirm surface displays; null for a fully-visible apply
   * (which never reaches the gate) and for conflict/save intents. Both counts are
   * deterministic — derived from `resolveBulkActionSet`'s touched set partitioned
   * against the re-derived family + the model's node-id set, NEVER an LLM number.
   *
   * 2026-06-06 redesign-2: the chunk confirm gate is retired, so apply-decisions
   * no longer open this gate or populate `overage`; it survives only for
   * transcript-replay back-compat (the terminal Save carries `overage: null`).
   */
  overage: {
    /**
     * Resolved candidates that ARE model nodes (entities/candidates) but sit
     * OUTSIDE the rendered family — the "+N beyond this family" figure.
     */
    beyondFamilyCount: number;
    /**
     * Resolved candidates that are NOT model nodes — relationship-row (EDGE)
     * candidates Spec A surfaces on REJECT — the "+N relationships dropped"
     * figure. Relationship rows are never rendered inside a family chunk, so they
     * always count as off-screen.
     */
    relationshipsDroppedCount: number;
  } | null;
  /** A short human-readable summary of what confirming will do (deterministic). */
  summary: string;
}

export interface DecisionAppliedTurn {
  kind: 'decision-applied';
  action: BulkReviewAction;
  /** The candidate ids the apply acted on (from the confirmed intent). */
  candidateIds: string[];
  /** The finding ids the apply acted on. */
  findingIds: string[];
  /** AMS-reported counts echoed back, when present (else null). */
  appliedCandidateCount: number | null;
  appliedFindingCount: number | null;
}

export interface ConflictResolvedTurn {
  kind: 'conflict-resolved';
  candidateId: string;
  attr: string;
  chosenValue: unknown;
  chosenSource: string;
}

export interface BulkPatternResolvedTurn {
  kind: 'bulk-pattern-resolved';
  attr: string;
  chosenSource: string;
  /** The candidate ids in the class that were each resolved-by-same-source. */
  candidateIds: string[];
  /** Count of members that resolved successfully. */
  resolvedCount: number;
}

export interface SavedTurn {
  kind: 'saved';
  /** AMS/MCP-reported saved count when present, else null. */
  savedCount: number | null;
}

export type ReviewErrorKind =
  | 'round-budget-exhausted'
  | 'llm-call-timeout'
  | 'wall-clock-exceeded'
  | 'aborted'
  | 'llm-call-failed'
  | 'submit-answer-malformed'
  | 'apply-failed'
  | 'resolve-conflict-failed'
  | 'save-failed'
  | 'confirm-stale'
  | 'no-pending-intent';

export interface ErrorTurn {
  kind: 'error';
  errorKind: ReviewErrorKind;
  errorMessage: string;
  recoverableHint?: string;
}

/** The reviewer's verbatim free-text or click (the deterministic NO-LLM path). */
export interface UserMessageTurn {
  kind: 'user-message';
  text: string;
}

/** A deterministic Architect narration line (NO LLM). */
export interface NarrationTurn {
  kind: 'narration';
  text: string;
}

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type ReviewTurn =
  | OpenTurn
  | ChunkSummaryTurn
  | PreviewTurn
  | PendingConfirmationTurn
  | DecisionAppliedTurn
  | ConflictResolvedTurn
  | BulkPatternResolvedTurn
  | SavedTurn
  | ErrorTurn
  | UserMessageTurn
  | NarrationTurn;

/**
 * Exhaustiveness helper for switch statements walking the review turn union —
 * keeps the closed union honest at type-check time.
 */
export function assertExhaustiveReviewTurnKind(k: never): never {
  throw new Error(`Unexpected review turn kind: ${String(k)}`);
}
