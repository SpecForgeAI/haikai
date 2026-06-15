/**
 * Tests — Agenda DEDUP of fully-decided families + the FOUR family actions
 * (Spec 2026-06-06-discovery-review-room-agenda-redesign-2, Task Group 3 / Q1).
 *
 * The sequencer stays a PURE function of model + cursor, so every test is a direct
 * call to `buildAgenda` / `getReviewChunk`. These 5 focused tests pin ONLY the
 * critical Task-Group-3 behaviours:
 *
 *   1. A FULLY-decided family (every member `review_status` decided) is EXCLUDED
 *      from the agenda.
 *   2. A FULLY-COMMITTED family (every member `committed`, even if review_status
 *      still reads pending) is EXCLUDED (committed ⇒ not actionable).
 *   3. A PARTIALLY-decided family is KEPT (>=1 actionable member) and its DECIDED
 *      members are RETAINED in the chunk (not stripped — the frontend annotates).
 *   4. A fully-decided ORPHAN (family-of-one) is EXCLUDED by the same filter.
 *   5. A kept family chunk advertises the FOUR actions — the three
 *      `familyBulkActions` dispositions PLUS the dedicated
 *      `familyVisibleChunkAction`.
 */

import { buildAgenda, getReviewChunk } from '../agendaSequencer';
import type {
  FullReviewModelWire,
  ReviewModelEdge,
  ReviewModelNode,
} from '../reviewModelFull';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const CODE_RUN = 'run-code';

function node(partial: Partial<ReviewModelNode> & { id: string }): ReviewModelNode {
  return {
    candidate_type: 'logical_data_entity',
    name: partial.id,
    review_status: 'pending_review',
    committed: false,
    conflict_state: {
      has_live_conflict: false,
      live_conflict_attrs: [],
      conflicts: null,
      conflict_resolutions: null,
    },
    merge_group_key: partial.id,
    source_tier: 'code',
    scan_kind: 'code',
    run_id: CODE_RUN,
    ...partial,
  };
}

function parentChildEdge(parentId: string, childId: string): ReviewModelEdge {
  return {
    edge_kind: 'parent_child',
    from_id: parentId,
    to_id: childId,
    relationship_candidate_id: childId,
    cross_scan: false,
  };
}

function model(nodes: ReviewModelNode[], edges: ReviewModelEdge[] = []): FullReviewModelWire {
  return {
    scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
    nodes,
    edges,
    findings: [],
    blast_radius: nodes.map((n) => ({
      candidate_id: n.id,
      dependents: [],
      would_be_orphaned_parent_ids: [],
    })),
    aggregations: { total_candidates: nodes.length, total_findings: 0 },
  };
}

/** Walk every chunk the sequencer yields from cursor 0 to exhaustion. */
function allChunks(m: FullReviewModelWire) {
  const chunks = [];
  let cursor: number | null = 0;
  for (let guard = 0; guard < 1000 && cursor !== null; guard += 1) {
    const { chunk } = getReviewChunk(m, cursor);
    chunks.push(chunk);
    cursor = chunk.nextCursor;
  }
  return chunks;
}

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agenda sequencer — dedup of decided families + four family actions (Task Group 3)', () => {
  // 1 -------------------------------------------------------------------------
  it('a FULLY-decided family (every member review_status decided) is EXCLUDED from the agenda', () => {
    // Family A: every member decided (approved/rejected/deferred) → dropped.
    // Family B: one pending child → kept (the control, proving the agenda still
    // emits the actionable family).
    const m = model(
      [
        node({ id: 'a-parent', candidate_type: 'interface', review_status: 'approved' }),
        node({ id: 'a-ep1', candidate_type: 'endpoint', review_status: 'rejected' }),
        node({ id: 'a-ep2', candidate_type: 'endpoint', review_status: 'deferred' }),
        node({ id: 'b-parent', candidate_type: 'interface', review_status: 'approved' }),
        node({ id: 'b-ep1', candidate_type: 'endpoint', review_status: 'pending_review' }),
      ],
      [
        parentChildEdge('a-parent', 'a-ep1'),
        parentChildEdge('a-parent', 'a-ep2'),
        parentChildEdge('b-parent', 'b-ep1'),
      ],
    );

    const agenda = buildAgenda(m);
    const agendaIds = agenda.map((it) => it.ref.id);

    // Family A is entirely absent from the agenda.
    expect(agendaIds).not.toContain('a-parent');
    expect(agendaIds).not.toContain('a-ep1');
    expect(agendaIds).not.toContain('a-ep2');

    // Family B (one actionable child) survives in full.
    expect(agendaIds).toContain('b-parent');
    expect(agendaIds).toContain('b-ep1');

    const chunks = allChunks(m);
    expect(chunks).toHaveLength(1);
    expect(ids(chunks[0].items)).toEqual(['b-parent', 'b-ep1']);
  });

  // 2 -------------------------------------------------------------------------
  it('a FULLY-COMMITTED family is EXCLUDED (committed ⇒ not actionable, even if status reads pending)', () => {
    const m = model(
      [
        node({ id: 'c-parent', candidate_type: 'interface', committed: true, review_status: 'pending_review' }),
        node({ id: 'c-ep', candidate_type: 'endpoint', committed: true, review_status: 'pending_review' }),
      ],
      [parentChildEdge('c-parent', 'c-ep')],
    );

    expect(buildAgenda(m)).toHaveLength(0);
  });

  // 3 -------------------------------------------------------------------------
  it('a PARTIALLY-decided family is KEPT with its decided members RETAINED in the chunk', () => {
    // Parent already approved; one child rejected; one child still pending. The
    // family is kept (the pending child is actionable) and ALL THREE members are
    // present in the chunk so the frontend can annotate the decided ones read-only.
    const m = model(
      [
        node({ id: 'parent', candidate_type: 'interface', name: 'Iface', review_status: 'approved' }),
        node({ id: 'ch-rej', candidate_type: 'endpoint', name: 'aaa', review_status: 'rejected' }),
        node({ id: 'ch-pend', candidate_type: 'endpoint', name: 'bbb', review_status: 'pending_review' }),
      ],
      [parentChildEdge('parent', 'ch-rej'), parentChildEdge('parent', 'ch-pend')],
    );

    const chunks = allChunks(m);
    expect(chunks).toHaveLength(1);
    // All three members retained (parent first; children alphabetical).
    expect(ids(chunks[0].items)).toEqual(['parent', 'ch-rej', 'ch-pend']);
    // It is still surfaced as a family chunk.
    expect(chunks[0].family).toEqual({ parentId: 'parent', childIds: ['ch-rej', 'ch-pend'] });
  });

  // 4 -------------------------------------------------------------------------
  it('a fully-decided ORPHAN (family-of-one) is EXCLUDED by the same filter', () => {
    // business_logics (NOT an excluded pre-scan type) so only the decided/live
    // distinction drives inclusion.
    const m = model([
      node({ id: 'decided-orphan', candidate_type: 'business_logics', review_status: 'approved' }),
      node({ id: 'live-orphan', candidate_type: 'business_logics', review_status: 'pending_review' }),
    ]);

    const agendaIds = buildAgenda(m).map((it) => it.ref.id);
    expect(agendaIds).not.toContain('decided-orphan');
    expect(agendaIds).toEqual(['live-orphan']);
  });

  // 5 -------------------------------------------------------------------------
  it('a kept family chunk advertises the FOUR actions (3 familyBulkActions + the dedicated familyVisibleChunkAction)', () => {
    const m = model(
      [
        node({ id: 'p', candidate_type: 'interface', name: 'Iface' }),
        node({ id: 'ep', candidate_type: 'endpoint', name: 'GET /x' }),
      ],
      [parentChildEdge('p', 'ep')],
    );

    const chunks = allChunks(m);
    expect(chunks).toHaveLength(1);
    const chunk = chunks[0];

    // The three full-cascade dispositions (Approve All / Reject All / Defer All)...
    expect(chunk.familyBulkActions).toEqual(['approved', 'rejected', 'deferred']);
    // ...PLUS the dedicated fourth "Approve visible chunk" action.
    expect(chunk.familyVisibleChunkAction).toBe('approve-visible-chunk');
  });
});
