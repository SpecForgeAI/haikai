/**
 * Read-only tool registry for the discovery-review conversation (Spec 3 —
 * capstone, Task Group 2.3).
 *
 * Spec: 2026-06-02-conversational-discovery-review-architect (Decision 3).
 *
 * These are the tools the LLM may call FREELY within the chassis round budget.
 * NONE of them write — they only READ the deterministic Spec 1 review model and
 * the pure Spec 2 resolver. They are registered in the chassis
 * `llmLoopRunner`'s pluggable `tools` registry (the same seam the target-state
 * conversation uses); tool-runtime errors are fed back to the LLM as tool
 * results so it can recover in-budget (existing chassis recovery behaviour).
 *
 * The five tools (Decision 3):
 *   - `selectScans`        — resolve the chosen scan SET (one run per service).
 *   - `getReviewChunk`     — drive the deterministic agenda sequencer (2.2).
 *   - `preview`            — wrap the PURE `resolveBulkActionSet` DIRECTLY
 *                            (the canonical resolver; returns the full touched
 *                            set + net counts).
 *   - `getConflictSet`     — the candidate's live `_conflicts`.
 *   - `getSimilarConflicts`— the Spec 0 similarity class (same attribute + same
 *                            competing source-set).
 *
 * CRITICAL SAFETY PROPERTY: these tools are PURE READS over a snapshot review
 * model the coordinator fetched once. They produce the deterministic FACTS the
 * LLM narrates; they NEVER mutate, and the preview counts they return come from
 * `resolveBulkActionSet`, NEVER from the LLM. The mutating verbs
 * (`applyDecision` / `resolveConflict` / `resolveConflictsByPattern` / `save`)
 * are deliberately ABSENT from this registry — they live only on the
 * orchestrator (the sole writer), behind the confirmation gate.
 */

import { resolveBulkActionSet } from '../discovery/resolveBulkActionSet';
import type { BulkReviewAction } from '../discovery/reviewModelWire';
import type {
  FullReviewModelWire,
  ReviewModelNode,
} from './reviewModelFull';
import { toResolverModel } from './reviewModelFull';
import { getReviewChunk } from './agendaSequencer';
import type {
  ArchitectToolDefinition,
} from '../architectConversation/architectLlmClient';
import type {
  ArchitectToolHandler,
  ArchitectToolRegistryEntry,
} from '../architectConversation/llmLoopRunner';

// ---------------------------------------------------------------------------
// Tool result shapes (the deterministic facts the LLM narrates)
// ---------------------------------------------------------------------------

export interface SelectScansResult {
  /** The PRIMARY run id — the thread/path anchor (per-service scan selection). */
  primary_run_id: string;
  /**
   * Every selected run (0-or-1 per scanned service; >=1 overall). The N-run
   * successor to the retired 2-run pair fields
   * (`2026-06-05-per-service-scan-selection`).
   */
  selected_runs: Array<{
    run_id: string;
    scan_kind: 'code' | 'database';
    service_id: string | null;
  }>;
  /** The scan selection the review model was actually built over (Spec 1 echo). */
  resolved_scan_selection: Array<{ run_id: string; scan_kind: 'code' | 'database' }>;
}

export interface ConflictSetResult {
  candidate_id: string;
  /** Live (unresolved) conflict attributes only (Spec 1 `live_conflict_attrs`). */
  live_conflict_attrs: string[];
  /** Per-attribute competing values (raw Spec 0 `_conflicts`), live attrs only. */
  conflicts_by_attr: Record<string, Array<{ value: unknown; source: string }>>;
}

export interface SimilarConflictsResult {
  /** The attribute the class is keyed on. */
  attr: string;
  /** The competing source-set (sorted) that defines the class. */
  competing_sources: string[];
  /** The candidate ids in the class (INCLUDING the anchor), deterministically ordered. */
  member_candidate_ids: string[];
  /** Class size (member count). */
  member_count: number;
}

// ---------------------------------------------------------------------------
// Pure tool implementations (exported for direct unit-testing)
// ---------------------------------------------------------------------------

/**
 * Resolve the selected scan SET against the review model the coordinator
 * fetched. PURE — it echoes both the chosen run set (per-service scan selection,
 * `2026-06-05-per-service-scan-selection`) and the model's `scan_selection` so
 * the LLM sees which run(s) actually back the agenda (no automatic pairing; the
 * opener picks). `primaryRunId` is the thread/path anchor.
 */
export function selectScans(args: {
  primaryRunId: string;
  runs: ReadonlyArray<{ runId: string; scanKind: 'code' | 'database'; serviceId: string | null }>;
  model: FullReviewModelWire;
}): SelectScansResult {
  return {
    primary_run_id: args.primaryRunId,
    selected_runs: args.runs.map((r) => ({
      run_id: r.runId,
      scan_kind: r.scanKind,
      service_id: r.serviceId,
    })),
    resolved_scan_selection: (args.model.scan_selection ?? []).map((s) => ({
      run_id: s.run_id,
      scan_kind: s.scan_kind,
    })),
  };
}

/**
 * Read a candidate's LIVE conflict set (unresolved attributes only). Reuses
 * Spec 1's precomputed `live_conflict_attrs` — never re-derives the
 * resolved-vs-live predicate.
 */
export function getConflictSet(
  candidateId: string,
  model: FullReviewModelWire,
): ConflictSetResult {
  const node = findNode(candidateId, model);
  const liveAttrs = node?.conflict_state?.live_conflict_attrs ?? [];
  const rawConflicts = node?.conflict_state?.conflicts ?? {};
  const conflictsByAttr: Record<string, Array<{ value: unknown; source: string }>> = {};
  for (const attr of liveAttrs) {
    if (rawConflicts[attr]) conflictsByAttr[attr] = rawConflicts[attr];
  }
  return {
    candidate_id: candidateId,
    live_conflict_attrs: liveAttrs,
    conflicts_by_attr: conflictsByAttr,
  };
}

/**
 * Compute the Spec 0 SIMILARITY CLASS for (candidateId, attr): all candidates
 * (including the anchor) with a LIVE conflict on the SAME attribute whose
 * COMPETING SOURCE-SET is identical. The source-set is the set of `source`
 * labels in `_conflicts[attr]` (order-insensitive). PURE.
 *
 * This is the membership read the bulk-resolve-by-pattern offer is gated on
 * (Decision 5: offered only for classes of ≥2). The LLM only narrates the
 * offer; the deterministic class membership comes from HERE.
 */
export function getSimilarConflicts(
  candidateId: string,
  attr: string,
  model: FullReviewModelWire,
): SimilarConflictsResult {
  const anchor = findNode(candidateId, model);
  const anchorSources = competingSourceSet(anchor, attr);

  // A null anchor or an anchor with no live conflict on attr → empty class.
  if (anchorSources === null) {
    return { attr, competing_sources: [], member_candidate_ids: [], member_count: 0 };
  }

  const anchorKey = sourceSetKey(anchorSources);
  const members: string[] = [];
  for (const n of model.nodes ?? []) {
    const sources = competingSourceSet(n, attr);
    if (sources === null) continue;
    if (sourceSetKey(sources) === anchorKey) {
      members.push(n.id);
    }
  }
  members.sort((a, b) => a.localeCompare(b));

  return {
    attr,
    competing_sources: anchorSources,
    member_candidate_ids: members,
    member_count: members.length,
  };
}

/**
 * Preview a bulk apply over the chosen seed set + action by calling the PURE
 * `resolveBulkActionSet` DIRECTLY against the (narrowed) review model. Returns
 * the resolver's full touched set + net counts VERBATIM — the deterministic
 * numbers the confirmation gate surfaces. NEVER an LLM number.
 */
export function preview(
  seedCandidateIds: readonly string[],
  action: BulkReviewAction,
  model: FullReviewModelWire,
): ReturnType<typeof resolveBulkActionSet> {
  return resolveBulkActionSet({ seedCandidateIds, action }, toResolverModel(model));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findNode(id: string, model: FullReviewModelWire): ReviewModelNode | undefined {
  return (model.nodes ?? []).find((n) => n.id === id);
}

/**
 * The competing source-set for (node, attr): the SORTED, DE-DUPED list of
 * `source` labels in the node's live `_conflicts[attr]`. Returns null when the
 * node has NO live conflict on `attr` (so it is not a class member).
 */
function competingSourceSet(
  node: ReviewModelNode | undefined,
  attr: string,
): string[] | null {
  if (!node) return null;
  const cs = node.conflict_state;
  if (!cs?.has_live_conflict) return null;
  if (!cs.live_conflict_attrs?.includes(attr)) return null;
  const entries = cs.conflicts?.[attr];
  if (!entries || entries.length === 0) return null;
  const sources = Array.from(new Set(entries.map((e) => e.source)));
  sources.sort((a, b) => a.localeCompare(b));
  return sources;
}

function sourceSetKey(sources: string[]): string {
  return sources.join(' ');
}

// ---------------------------------------------------------------------------
// Tool registry build (the chassis `llmLoopRunner` seam)
// ---------------------------------------------------------------------------

/**
 * Build the read-only tool registry bound to a single review-model snapshot +
 * the selected scan pair. Returned as chassis `ArchitectToolRegistryEntry[]`
 * for `runArchitectQuestionLoop({ tools })`. EVERY handler is a pure read over
 * the bound model; none write.
 */
export function buildReviewToolRegistry(ctx: {
  model: FullReviewModelWire;
  scanPair: {
    primaryRunId: string;
    runs: ReadonlyArray<{ runId: string; scanKind: 'code' | 'database'; serviceId: string | null }>;
  };
  chunkSize?: number;
}): ArchitectToolRegistryEntry[] {
  const { model, scanPair } = ctx;

  const selectScansHandler: ArchitectToolHandler = async () =>
    selectScans({ ...scanPair, model });

  const getReviewChunkHandler: ArchitectToolHandler = async (rawArgs) => {
    const cursor = typeof rawArgs.agendaCursor === 'number' ? rawArgs.agendaCursor : 0;
    return getReviewChunk(model, cursor, ctx.chunkSize).chunk;
  };

  const previewHandler: ArchitectToolHandler = async (rawArgs) => {
    const seedIds = Array.isArray(rawArgs.seedCandidateIds)
      ? (rawArgs.seedCandidateIds.filter((v) => typeof v === 'string') as string[])
      : [];
    const action = normaliseAction(rawArgs.action);
    if (!action) {
      return { error: "Invalid 'action' (expected approved | rejected | deferred)." };
    }
    return preview(seedIds, action, model);
  };

  const getConflictSetHandler: ArchitectToolHandler = async (rawArgs) => {
    const candidateId = typeof rawArgs.candidateId === 'string' ? rawArgs.candidateId : '';
    if (!candidateId) return { error: "Missing 'candidateId'." };
    return getConflictSet(candidateId, model);
  };

  const getSimilarConflictsHandler: ArchitectToolHandler = async (rawArgs) => {
    const candidateId = typeof rawArgs.candidateId === 'string' ? rawArgs.candidateId : '';
    const attr = typeof rawArgs.attr === 'string' ? rawArgs.attr : '';
    if (!candidateId || !attr) return { error: "Missing 'candidateId' or 'attr'." };
    return getSimilarConflicts(candidateId, attr, model);
  };

  return [
    { name: 'selectScans', definition: SELECT_SCANS_DEF, handler: selectScansHandler },
    { name: 'getReviewChunk', definition: GET_REVIEW_CHUNK_DEF, handler: getReviewChunkHandler },
    { name: 'preview', definition: PREVIEW_DEF, handler: previewHandler },
    { name: 'getConflictSet', definition: GET_CONFLICT_SET_DEF, handler: getConflictSetHandler },
    { name: 'getSimilarConflicts', definition: GET_SIMILAR_CONFLICTS_DEF, handler: getSimilarConflictsHandler },
  ];
}

function normaliseAction(raw: unknown): BulkReviewAction | null {
  if (raw === 'approved' || raw === 'rejected' || raw === 'deferred') return raw;
  return null;
}

// ---------------------------------------------------------------------------
// Tool definitions (the OpenAI/Azure function-tool schema the LLM sees)
// ---------------------------------------------------------------------------

const SELECT_SCANS_DEF: ArchitectToolDefinition = {
  type: 'function',
  function: {
    name: 'selectScans',
    description:
      'Echo the selected scan set (one run per scanned service) and the scan selection the review model was built over. Read-only.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

const GET_REVIEW_CHUNK_DEF: ArchitectToolDefinition = {
  type: 'function',
  function: {
    name: 'getReviewChunk',
    description:
      'Return the NEXT deterministically-ordered agenda chunk (~10-20 items) starting at agendaCursor, plus an advancing nextCursor. The ORDER is computed by deterministic code — you do NOT order or segment. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        agendaCursor: {
          type: 'number',
          description: 'The 0-based agenda cursor to start the chunk from (0 for the first chunk).',
        },
      },
      required: [],
    },
  },
};

const PREVIEW_DEF: ArchitectToolDefinition = {
  type: 'function',
  function: {
    name: 'preview',
    description:
      'Compute the DETERMINISTIC cascade-aware touched set + net counts for a bulk apply over seedCandidateIds + action. The counts are authoritative — NEVER assert your own count; always quote these. Read-only (this does NOT apply anything).',
    parameters: {
      type: 'object',
      properties: {
        seedCandidateIds: {
          type: 'array',
          description: 'The seed candidate ids the action is scoped from.',
          items: { type: 'string' },
        },
        action: {
          type: 'string',
          description: 'The disposition: approved | rejected | deferred.',
        },
      },
      required: ['seedCandidateIds', 'action'],
    },
  },
};

const GET_CONFLICT_SET_DEF: ArchitectToolDefinition = {
  type: 'function',
  function: {
    name: 'getConflictSet',
    description:
      "Return a candidate's LIVE (unresolved) conflict attributes and the competing values per attribute. Read-only.",
    parameters: {
      type: 'object',
      properties: {
        candidateId: { type: 'string', description: 'The candidate id.' },
      },
      required: ['candidateId'],
    },
  },
};

const GET_SIMILAR_CONFLICTS_DEF: ArchitectToolDefinition = {
  type: 'function',
  function: {
    name: 'getSimilarConflicts',
    description:
      'Return the similarity class for (candidateId, attr): all candidates with a live conflict on the SAME attribute and the SAME competing source-set. Use the member_count to decide whether a bulk-resolve-by-pattern offer is warranted (only for classes of ≥2). Read-only.',
    parameters: {
      type: 'object',
      properties: {
        candidateId: { type: 'string', description: 'The anchor candidate id.' },
        attr: { type: 'string', description: 'The conflicting attribute name.' },
      },
      required: ['candidateId', 'attr'],
    },
  },
};
