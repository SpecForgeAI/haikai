/**
 * Tests — Turn shape + wire-type contract for the confirm-box-removal + rich
 * cascade-chunk redesign (Spec 2026-06-06-discovery-review-room-agenda-redesign-2,
 * Task Group 1).
 *
 * Task Group 1 is a TYPE-ONLY contract change on `reviewTurnShape.ts` (mirrored in
 * `frontend/src/api/discoveryReviewApi.ts`). These are the 4 focused contract
 * assertions the task allows — they pin the additive/optional nature of the new
 * fields so the closed `ReviewTurn` union still validates the OLD shapes:
 *
 *   1. A `ChunkSummaryTurn` carrying the new structured `cascadePreview` field
 *      (total + per-type breakdown with the three already-* sub-counts) validates,
 *      and survives the closed `ReviewTurn` union.
 *   2. The `apply-decision` intent accepts the `scope: 'family' | 'cascade'`
 *      discriminator (both values), and remains valid with `scope` ABSENT
 *      (the additive/optional default-to-cascade contract).
 *   3. The `ReviewTurn` closed union still validates a NON-family chunk with
 *      `cascadePreview` (and the new visible-chunk action) ABSENT.
 *   4. The FOUR-button family layout is expressible: a family chunk carries the
 *      three `familyBulkActions` dispositions PLUS the dedicated
 *      `familyVisibleChunkAction`, and the resolver node shape (`{ id,
 *      review_status }`) is untouched (asserted against `REVIEW_MODEL_WIRE_FIELDS`).
 *
 * The shapes are compile-time-validated by being assigned to their declared
 * types (a structural-typing assertion); the runtime `expect`s additionally pin
 * the field VALUES + presence/absence so a regression that drops a field or makes
 * one required is caught at test-time, not only at typecheck-time.
 */

import { REVIEW_MODEL_WIRE_FIELDS, type ReviewModelNode } from '../../discovery/reviewModelWire';
import type {
  CascadePreview,
  ChunkSummaryTurn,
  FamilyVisibleChunkAction,
  ProposedReviewIntent,
  ReviewApplyScope,
  ReviewTurn,
} from '../reviewTurnShape';

describe('redesign-2 turn shape + wire types (Task Group 1)', () => {
  // 1 -------------------------------------------------------------------------
  it('a ChunkSummaryTurn carrying the new cascadePreview field validates (total + per-type already-* sub-counts)', () => {
    const cascadePreview: CascadePreview = {
      total: 123,
      byType: [
        {
          type: 'logical_data_entity',
          count: 8,
          alreadyApproved: 3,
          alreadyRejected: 0,
          alreadyDeferred: 1,
        },
        {
          type: 'logical_data_attribute',
          count: 104,
          alreadyApproved: 45,
          alreadyRejected: 2,
          alreadyDeferred: 0,
        },
      ],
    };

    const chunk: ChunkSummaryTurn = {
      kind: 'chunk-summary',
      section: 'business-logic',
      scanScope: 'code',
      items: [{ id: 'iface', itemType: 'candidate', name: 'My Interface', detail: 'interface' }],
      cursor: 0,
      nextCursor: 1,
      agendaTotal: 123,
      family: { parentId: 'iface', childIds: [] },
      cascadePreview,
    };

    // The structured field round-trips its total + per-type breakdown verbatim.
    expect(chunk.cascadePreview?.total).toBe(123);
    expect(chunk.cascadePreview?.byType).toHaveLength(2);
    expect(chunk.cascadePreview?.byType[0]).toEqual({
      type: 'logical_data_entity',
      count: 8,
      alreadyApproved: 3,
      alreadyRejected: 0,
      alreadyDeferred: 1,
    });
    // The attribute row carries ALL THREE already-* sub-counts independently.
    const attrRow = chunk.cascadePreview?.byType[1];
    expect(attrRow?.alreadyApproved).toBe(45);
    expect(attrRow?.alreadyRejected).toBe(2);
    expect(attrRow?.alreadyDeferred).toBe(0);
  });

  // 2 -------------------------------------------------------------------------
  it('the apply-decision intent accepts the scope discriminator (family + cascade) and is valid with scope absent', () => {
    const familyScope: ReviewApplyScope = 'family';
    const cascadeScope: ReviewApplyScope = 'cascade';

    // scope: 'family' — the "Approve visible chunk" reach.
    const approveVisible: ProposedReviewIntent = {
      kind: 'apply-decision',
      seedCandidateIds: ['iface'],
      findingIds: [],
      action: 'approved',
      scope: familyScope,
    };
    // scope: 'cascade' — the "Approve All" reach.
    const approveAll: ProposedReviewIntent = {
      kind: 'apply-decision',
      seedCandidateIds: ['iface'],
      findingIds: [],
      action: 'approved',
      scope: cascadeScope,
    };
    // scope ABSENT — the additive/optional contract (existing callers default to
    // cascade). This must still satisfy the apply-decision variant.
    const legacyNoScope: ProposedReviewIntent = {
      kind: 'apply-decision',
      seedCandidateIds: ['iface'],
      findingIds: [],
      action: 'rejected',
    };

    expect(approveVisible.kind === 'apply-decision' && approveVisible.scope).toBe('family');
    expect(approveAll.kind === 'apply-decision' && approveAll.scope).toBe('cascade');
    expect(legacyNoScope.kind === 'apply-decision' && legacyNoScope.scope).toBeUndefined();
  });

  // 3 -------------------------------------------------------------------------
  it('the ReviewTurn closed union still validates a NON-family chunk with cascadePreview + visible-chunk action ABSENT', () => {
    // A by-type / orphan chunk: no family, no preview, no visible-chunk action.
    const nonFamilyChunk: ReviewTurn = {
      kind: 'chunk-summary',
      section: 'findings-by-severity',
      scanScope: 'cross-scan',
      items: [{ id: 'f1', itemType: 'finding', name: 'Stored proc', detail: 'high' }],
      cursor: 2,
      nextCursor: null,
      agendaTotal: 7,
    };

    expect(nonFamilyChunk.kind).toBe('chunk-summary');
    // The additive fields are genuinely ABSENT on a non-family chunk.
    const asChunk = nonFamilyChunk as ChunkSummaryTurn;
    expect(asChunk.family).toBeUndefined();
    expect(asChunk.cascadePreview).toBeUndefined();
    expect(asChunk.familyBulkActions).toBeUndefined();
    expect(asChunk.familyVisibleChunkAction).toBeUndefined();
  });

  // 4 -------------------------------------------------------------------------
  it('the four-button family layout is expressible (3 dispositions + visible-chunk) and the resolver node shape is untouched', () => {
    const visibleChunk: FamilyVisibleChunkAction = 'approve-visible-chunk';

    const familyChunk: ChunkSummaryTurn = {
      kind: 'chunk-summary',
      section: 'business-logic',
      scanScope: 'code',
      items: [
        { id: 'iface', itemType: 'candidate', name: 'My Interface', detail: 'interface' },
        { id: 'ep-1', itemType: 'candidate', name: 'GET /x', detail: 'endpoint' },
      ],
      cursor: 0,
      nextCursor: 1,
      agendaTotal: 2,
      family: { parentId: 'iface', childIds: ['ep-1'] },
      // The three full-cascade dispositions (Approve All / Reject All / Defer All)...
      familyBulkActions: ['approved', 'rejected', 'deferred'],
      // ...PLUS the dedicated fourth "Approve visible chunk" action.
      familyVisibleChunkAction: visibleChunk,
    };

    // All FOUR buttons are advertised on the one family chunk.
    expect(familyChunk.familyBulkActions).toEqual(['approved', 'rejected', 'deferred']);
    expect(familyChunk.familyVisibleChunkAction).toBe('approve-visible-chunk');

    // The parity-tested resolver node shape (`{ id, review_status }`) is UNTOUCHED
    // by this spec — the visible-chunk action lives entirely on the conversation
    // turn shape, never on the resolver wire node.
    expect(REVIEW_MODEL_WIRE_FIELDS.node).toEqual(['id', 'review_status']);
    const node: ReviewModelNode = { id: 'iface', review_status: 'pending_review' };
    expect(Object.keys(node).sort()).toEqual(['id', 'review_status']);
  });
});
