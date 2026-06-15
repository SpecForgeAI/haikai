/**
 * Deterministic agenda/chunk sequencer for the discovery-review conversation
 * (Spec 3 — capstone, Task Group 2.2; FAMILY-CHUNKED by the 2026-06-05
 * review-room-agenda-redesign spec, Task Group 1). REPLACES the chassis
 * `questionSequencer` as the swappable driver: the chassis walks a fixed question
 * library in group order; THIS walks Spec 1's review model in a
 * deterministically-computed agenda order.
 *
 * Spec: 2026-06-02-conversational-discovery-review-architect (Decision 2)
 *       + 2026-06-05-review-room-agenda-redesign (Task Group 1: family chunking;
 *         Task Group 2: surface the family parent/children on the chunk turn).
 *       + 2026-06-06-discovery-review-room-agenda-redesign-2 (Task Group 2: the
 *         gateway-only `cascadePreview` populated on FAMILY chunks; Task Group 3:
 *         DEDUP of fully-decided families from the agenda + the FOUR family actions
 *         — the three `FAMILY_BULK_ACTIONS` dispositions PLUS the dedicated
 *         `familyVisibleChunkAction`).
 *
 * PURITY CONTRACT (load-bearing — do NOT break):
 *   - No fetch, no LLM, no clock, no global state, no I/O.
 *   - A pure function of the review model + the cursor.
 *   - The ORDER is computed by CODE, NEVER by the LLM. The LLM only narrates the
 *     chunk it is handed.
 *
 * AGENDA ORDER, scoped per scan (code run first, then DB run, then cross-scan
 * bridges LAST). The candidate sections (1-3) are now organised into PARENT
 * FAMILIES — a chunk is one parent + its DIRECT `parent_child` children, never a
 * flat slice of unrelated rows:
 *   (1) live-conflicts band       — any family/orphan with a live-conflict member
 *   (2) high-blast-radius band    — any family/orphan with a non-empty blast radius
 *   (3) remaining-by-type band    — everything else, by type then name
 *   (4) findings by severity      — `severity` rank (NOT folded into families)
 *   (5) cross-scan logical↔physical
 *       links                     — edges with `cross_scan === true`
 *
 * FAMILY CHUNKING (2026-06-05 Task Group 1):
 *   - A family = ONE parent node + its DIRECT `parent_child` children, derived
 *     from `model.edges` where `edge_kind === 'parent_child'` (`from_id` = parent,
 *     `to_id` = child). TWO-LEVEL structural only (interface+endpoints;
 *     entity+attributes; physical entity+columns). Relationship-row edges
 *     (`interface_logical_entities`, `endpoint_data_effects`, …) NEVER pull a node
 *     into a family.
 *   - A node with no `parent_child` edge in EITHER direction is an ORPHAN, grouped
 *     by `candidate_type` AFTER the multi-node families within its band.
 *   - ONE chunk per family regardless of size — a family's items are emitted
 *     CONTIGUOUSLY in the flat agenda (parent first, children conflicts-first then
 *     alphabetical), and `getReviewChunk` takes the whole contiguous run, so a
 *     40-attribute entity is one chunk and is never split.
 *   - A family's BAND rank = "does ANY member (parent or child) have a live
 *     conflict?" → conflicts band; else "does any member carry a non-empty blast
 *     radius?" → high-blast band; else remaining band. A conflicted member ranks
 *     its WHOLE family up — it is NEVER hoisted into a separate conflicts section
 *     that would split it from its parent.
 *
 * AGENDA DEDUP OF DECIDED FAMILIES (2026-06-06 agenda-redesign-2, Task Group 3 /
 * Q1): a family is presented as a chunk IFF it still has >=1 ACTIONABLE member,
 * where actionable = `review_status` pending AND NOT `committed`. A FULLY-decided
 * family (every member decided or committed) is EXCLUDED from the agenda — the
 * dedup fix. A PARTIALLY-decided family is KEPT, with its decided members RETAINED
 * in the chunk (the frontend annotates them read-only); they are not stripped. The
 * filter is type-driven (it reads only `review_status` + `committed`), so
 * DATABASE-scan families (a physical entity/table → its columns + cross-scan
 * logical↔physical mappings) are handled by the SAME filter as code-scan families.
 *
 * FAMILY SURFACING (2026-06-05 Task Group 2; FOUR actions + cascade preview by
 * 2026-06-06 agenda-redesign-2): the chunk-summary turn for a true multi-node
 * family carries `family = { parentId, childIds }`, the `familyBulkActions` flag
 * (the three full-cascade dispositions — Approve All / Reject All / Defer All), the
 * dedicated `familyVisibleChunkAction` ("Approve visible chunk", the fourth
 * button), and the rich `cascadePreview` (Task Group 2). These are a pure SURFACE
 * of the family already chunked above (the parent is the first item; the children
 * are the rest) plus a pure read of the model (`cascadePreview`) — NOT a second
 * derivation. Orphan-by-type / findings / cross-scan chunks carry NONE of them
 * (they are not families and keep the existing per-item treatment).
 *
 * NO NEW COMPUTATION: live-conflict reuses Spec 1's precomputed
 * `has_live_conflict`; high-blast-radius reuses the per-candidate `blast_radius`
 * dependent-set size; the type / severity buckets read the node/finding fields
 * Spec 1 already populated; the families are a pure re-derivation over the
 * existing `parent_child` edges; the dedup filter reads only the per-node
 * `review_status` + `committed` Spec 1 already populated; `cascadePreview` reuses
 * `resolveBulkActionSet` for the cascade reach. The sequencer NEVER re-derives
 * conflicts, cascades, or aggregations.
 *
 * `getReviewChunk(agendaCursor)` returns the next family (or orphan-by-type /
 * findings / cross-scan) chunk plus an advancing cursor — NEVER the firehose.
 */

import type {
  FullReviewModelWire,
  ReviewModelNode,
  ReviewModelFindingNode,
  ScanKind,
} from './reviewModelFull';
import type { BulkReviewAction } from '../discovery/reviewModelWire';
import type {
  AgendaSectionKind,
  ChunkItemConflictFact,
  ChunkItemRef,
  ChunkSummaryTurn,
  CrossLayerMapping,
  FamilyVisibleChunkAction,
} from './reviewTurnShape';
// getSimilarConflicts is a PURE read of the model (same package, no I/O), so
// calling it from the live-conflicts loop keeps buildAgenda pure. (The reverse
// edge — reviewTools importing getReviewChunk from here — is also call-time
// only, so this mutual import resolves safely at module init.)
import { getSimilarConflicts } from './reviewTools';
// The gateway-only rich cascade-preview builder (2026-06-06 agenda-redesign-2, S2)
// — PURE + cycle-safe; populated on FAMILY chunks at chunk-build time. It reuses
// `resolveBulkActionSet` for the full-cascade reach; neither
// `cascadePreviewBuilder` nor `resolveBulkActionSet` imports this module, so there
// is no import cycle.
import { buildCascadePreview } from './cascadePreviewBuilder';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Legacy target chunk size, retained for the public `getReviewChunk` signature
 * (callers still pass it). With family chunking it is NO LONGER a hard slice
 * boundary — a family is one chunk regardless of size — but it still bounds an
 * orphan-by-type / findings / cross-scan run so those homogeneous sections do not
 * become a single firehose chunk.
 */
export const DEFAULT_CHUNK_SIZE = 15;

/**
 * The family-level bulk dispositions every family chunk offers (2026-06-05 Task
 * Group 2): Approve-all / Reject-all / Defer-all for the WHOLE family — the
 * FULL-CASCADE (`scope: 'cascade'`) reach. Carried on
 * `ChunkSummaryTurn.familyBulkActions` so the frontend renders three of the four
 * family buttons; the family bulk is proposed by seeding the family parent into
 * the existing `apply-decision` intent.
 *
 * 2026-06-06 agenda-redesign-2: this STAYS the three-disposition
 * `BulkReviewAction` set — it is the parity-tested resolver enum and is NOT
 * widened. The FOURTH button ("Approve visible chunk", `scope: 'family'`) is
 * advertised SEPARATELY via {@link FAMILY_VISIBLE_CHUNK_ACTION} /
 * `ChunkSummaryTurn.familyVisibleChunkAction`.
 */
const FAMILY_BULK_ACTIONS: readonly BulkReviewAction[] = ['approved', 'rejected', 'deferred'];

/**
 * The dedicated "Approve visible chunk" family action (2026-06-06
 * agenda-redesign-2, Task Group 3 / S1). The FOURTH family button, carried on
 * `ChunkSummaryTurn.familyVisibleChunkAction` ALONGSIDE the three
 * `FAMILY_BULK_ACTIONS`. It maps to an `apply-decision` with `action: 'approved'`
 * + `scope: 'family'` (the `deriveFamilyForSeed` reach — seed ∪ direct
 * `parent_child` children only; the associated logical entities/attributes are NOT
 * cascaded and arrive as their own later chunks). Kept SEPARATE from
 * `FAMILY_BULK_ACTIONS` so the parity-tested resolver `BulkReviewAction` enum is
 * NOT widened.
 */
const FAMILY_VISIBLE_CHUNK_ACTION: FamilyVisibleChunkAction = 'approve-visible-chunk';

/**
 * Finding severity rank (higher = more urgent → earlier in the agenda).
 * Unknown severities sort last (rank 0).
 */
const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

// ---------------------------------------------------------------------------
// Internal agenda item shape (the flattened, fully-ordered list)
// ---------------------------------------------------------------------------

interface AgendaItem {
  ref: ChunkItemRef;
  section: AgendaSectionKind;
  scanScope: 'code' | 'database' | 'cross-scan';
  /**
   * The chunk-grouping key (internal — NOT on the wire). All items of one
   * family share it; orphans of one candidate_type share one (so the chunker
   * batches them), and findings / cross-scan items share their section key — so a
   * chunk boundary falls between groups exactly where the legacy 15-slice would.
   * `getReviewChunk` slices a chunk by taking the contiguous run that shares the
   * head item's `groupKey` (bounded by `DEFAULT_CHUNK_SIZE` only for the
   * homogeneous orphan/finding/cross-scan runs, never for a family).
   */
  groupKey: string;
  /** TRUE when this group is a parent_child FAMILY (one chunk regardless of size). */
  isFamily: boolean;
  /**
   * The family metadata (2026-06-05 Task Group 2), set ONLY on the items of a
   * true multi-node `parent_child` family so `getReviewChunk` can SURFACE the
   * family Group 1 already chunked on (it does NOT recompute it). `familyParentId`
   * is the family parent's node id (the same across every item of the family);
   * `familyChildIds` is the parent's direct `parent_child` child ids, in the
   * deterministic order they were emitted. Absent (undefined) on orphan-by-type,
   * findings, and cross-scan items (which are not families).
   */
  familyParentId?: string;
  familyChildIds?: string[];
  /**
   * The `candidate_type` of an ORPHAN-by-type candidate item (2026-06-09). Set ONLY
   * on orphan candidate items (a homogeneous by-type run with no `parent_child`
   * family); absent on family items, findings, and cross-scan items. `getReviewChunk`
   * reads it off the head item to populate the chunk's type-level bulk control
   * (`typeBulk` — "Approve all N <type>").
   */
  orphanCandidateType?: string;
}

// ---------------------------------------------------------------------------
// Internal family structure (re-derived from parent_child — never persisted)
// ---------------------------------------------------------------------------

/**
 * A two-level structural family: one parent node + its DIRECT `parent_child`
 * children. Built PURELY from `parent_child` edges; relationship-row edges never
 * contribute. A family-of-one (a parent with no surviving children, or an
 * orphan) is represented by `children = []`.
 */
interface NodeFamily {
  parent: ReviewModelNode;
  children: ReviewModelNode[];
  /** TRUE iff this family has ≥1 `parent_child` child (a true multi-node family). */
  isFamily: boolean;
  /** TRUE iff ANY member (parent or child) has a live conflict. */
  hasLiveConflict: boolean;
  /** TRUE iff ANY member (parent or child) carries a non-empty blast radius. */
  hasHighBlast: boolean;
}

// ---------------------------------------------------------------------------
// Actionable / decided predicate (2026-06-06 agenda-redesign-2 — Task Group 3)
// ---------------------------------------------------------------------------

/**
 * The terminal `review_status` values a candidate can be DECIDED into. The
 * verbatim AMS values; anything else (notably `pending_review`) is NOT decided.
 */
const DECIDED_REVIEW_STATUSES: ReadonlySet<string> = new Set<string>([
  'approved',
  'rejected',
  'deferred',
]);

/**
 * Whether a node is still ACTIONABLE (2026-06-06 agenda-redesign-2, Task Group 3 /
 * Q1): its `review_status` is pending (NOT one of the terminal dispositions) AND
 * it is NOT committed. A node that is decided OR committed is NOT actionable. The
 * agenda DEDUP keeps a family IFF >=1 member is actionable, and drops a family all
 * of whose members are non-actionable. PURE — reads only `review_status` +
 * `committed`, so it generalises across code-scan and DATABASE-scan families.
 */
function isActionable(n: ReviewModelNode): boolean {
  return !n.committed && !DECIDED_REVIEW_STATUSES.has(n.review_status);
}

/**
 * Whether a FINDING is still actionable — its `review_status` is not one of the
 * terminal dispositions. Findings have no `committed` lifecycle, so the predicate
 * reads `review_status` alone. Mirrors {@link isActionable} for findings so a
 * decided finding is deduped out of the agenda (and the findings-bulk count) the
 * same way a decided candidate family is.
 */
function isFindingActionable(f: ReviewModelFindingNode): boolean {
  return !DECIDED_REVIEW_STATUSES.has(f.review_status);
}

// ---------------------------------------------------------------------------
// Public output
// ---------------------------------------------------------------------------

export interface ReviewChunkResult {
  /** The chunk-summary turn to append + surface to the LLM/frontend. */
  chunk: ChunkSummaryTurn;
  /** TRUE when this chunk exhausts the agenda (nextCursor === null). */
  exhausted: boolean;
}

// ---------------------------------------------------------------------------
// Agenda assembly (pure)
// ---------------------------------------------------------------------------

/**
 * The architectural section a node `candidate_type` belongs to (2026-06-09
 * reorder), or `null` when the type is EXCLUDED from the review conversation. The
 * agenda walks these sections top-down in the order:
 *   interfaces-endpoints → logical-data → physical-data → (cross-scan links) →
 *   business-logic → (findings).
 *
 * EXCLUDED (returns null): `application`, `app_component`, `service` — these are
 * defined by the user BEFORE a scan, so the current-state discovery review does
 * NOT re-surface them. They remain in the model (the grid still shows them); they
 * are simply not walked in the conversation agenda.
 *
 * Relationship-ROW types are NOT nodes (they are edges), so they never reach this
 * function; the cross-scan logical↔physical mappings are emitted as their own
 * section between physical-data and business-logic.
 */
function sectionForNodeType(candidateType: string): AgendaSectionKind | null {
  switch (candidateType) {
    // User-defined pre-scan — excluded from the review conversation.
    case 'application':
    case 'app_component':
    case 'service':
      return null;

    // The contract / presentation surface. (Singular forms tolerated defensively.)
    case 'interfaces':
    case 'interface':
    case 'endpoints':
    case 'endpoint':
    case 'ui_screens':
    case 'ui_components':
      return 'interfaces-endpoints';

    // The logical data model.
    case 'logical_data_entities':
    case 'logical_data_entity':
    case 'logical_data_attributes':
    case 'logical_data_attribute':
      return 'logical-data';

    // The physical data model.
    case 'physical_data_entities':
    case 'physical_data_entity':
    case 'physical_data_attributes':
    case 'physical_data_attribute':
    case 'data_entity':
      return 'physical-data';

    // Behaviour. Unknown node types fall here too so nothing is silently lost.
    case 'business_logics':
    case 'business_process':
    case 'class':
    case 'method':
    default:
      return 'business-logic';
  }
}

/**
 * The architectural section walk order. Cross-scan links sit between physical-data
 * and business-logic (the user reviews logical, then physical, THEN the mapping
 * between them); findings are LAST.
 */
const CANDIDATE_SECTION_ORDER: readonly AgendaSectionKind[] = [
  'interfaces-endpoints',
  'logical-data',
  'physical-data',
];

/**
 * Build the FULL deterministically-ordered agenda for a review model. Exported
 * for direct unit-testing of the ordering.
 *
 * 2026-06-09 ARCHITECTURAL reorder: the agenda walks the architecture top-down —
 * interfaces & endpoints → logical data model → physical data model → cross-scan
 * logical↔physical mappings → business logic → findings — GLOBALLY across both
 * scans (so a logical entity from the code scan precedes a physical entity from
 * the DB scan regardless of scan order). Live conflicts are shown INLINE at each
 * item's position (NO conflicts-first band). `application`/`app_component`/`service`
 * candidates are EXCLUDED (user-defined pre-scan). FULLY-decided families/findings
 * are dropped (`buildFamilies` / `isFindingActionable`).
 */
export function buildAgenda(model: FullReviewModelWire): AgendaItem[] {
  const nodes = model.nodes ?? [];
  const findings = model.findings ?? [];
  const edges = model.edges ?? [];
  const blastRadius = model.blast_radius ?? [];

  // Per-candidate blast-radius size (reuses Spec 1 — never recomputed). Retained
  // for `buildFamilies`' signature though the agenda no longer bands by it.
  const blastSizeById = new Map<string, number>();
  for (const entry of blastRadius) {
    blastSizeById.set(entry.candidate_id, (entry.dependents ?? []).length);
  }

  // Build the parent families for EACH scan (parent_child edges are intra-scan),
  // EXCLUDING the user-defined-pre-scan types, then walk them by architectural
  // section globally. Each family is one contiguous run (one chunk); FULLY-decided
  // families are already dropped by `buildFamilies` (dedup).
  const allFamilies: Array<{ fam: NodeFamily; scope: 'code' | 'database' }> = [];
  for (const scan of ['code', 'database'] as ScanKind[]) {
    const scope: 'code' | 'database' = scan === 'code' ? 'code' : 'database';
    const scanNodes = nodes.filter(
      (n) => n.scan_kind === scan && sectionForNodeType(n.candidate_type) !== null,
    );
    for (const fam of buildFamilies(scanNodes, edges, blastSizeById)) {
      allFamilies.push({ fam, scope });
    }
  }

  const items: AgendaItem[] = [];

  // (1-3) Candidate sections in architectural order.
  for (const section of CANDIDATE_SECTION_ORDER) {
    emitSection(allFamilies, section, model, items);
  }

  // (4) Cross-scan logical↔physical mappings — the bridge, AFTER physical-data.
  emitCrossScanLinks(model, items);

  // (5) Business logic.
  emitSection(allFamilies, 'business-logic', model, items);

  // (6) Findings — LAST, grouped like the Findings table (severity → category).
  emitFindings(findings, items);

  return items;
}

/**
 * Emit one architectural SECTION's families across all scans: the multi-node
 * families first (ordered by scan, then type, then name), then the ORPHANS grouped
 * by `candidate_type` (so the chunker batches each type into ≤ DEFAULT_CHUNK_SIZE
 * chunks). Each multi-node family is one contiguous run (one chunk).
 */
function emitSection(
  allFamilies: ReadonlyArray<{ fam: NodeFamily; scope: 'code' | 'database' }>,
  section: AgendaSectionKind,
  model: FullReviewModelWire,
  out: AgendaItem[],
): void {
  const inSection = allFamilies.filter(
    ({ fam }) => sectionForNodeType(fam.parent.candidate_type) === section,
  );
  const byScopeTypeName = (
    a: { fam: NodeFamily; scope: 'code' | 'database' },
    b: { fam: NodeFamily; scope: 'code' | 'database' },
  ): number => {
    if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);
    return compareByTypeThenNameThenId(a.fam.parent, b.fam.parent);
  };

  const multiNode = inSection.filter(({ fam }) => fam.isFamily).sort(byScopeTypeName);
  for (const { fam, scope } of multiNode) {
    emitFamily(fam, section, scope, model, out);
  }

  // Orphans of the SAME scope+type share one group key so the chunker batches them.
  const orphans = inSection.filter(({ fam }) => !fam.isFamily).sort(byScopeTypeName);
  for (const { fam, scope } of orphans) {
    const orphan = fam.parent;
    out.push({
      ref: refForMember(orphan, model),
      section,
      scanScope: scope,
      groupKey: `${scope}:orphans:${section}:${orphan.candidate_type}`,
      isFamily: false,
      // Carry the type so `getReviewChunk` can offer a type-level bulk control
      // ("Approve all N <type>") on this orphan-by-type chunk.
      orphanCandidateType: orphan.candidate_type,
    });
  }
}

/**
 * Emit the cross-scan logical↔physical mapping links (the bridge section). One
 * agenda item per cross-scan edge (deterministic order: by from_id then to_id);
 * these are synthetic join EDGES (no real candidate row), kept as their own
 * informational section with no four-button family layout.
 */
function emitCrossScanLinks(model: FullReviewModelWire, out: AgendaItem[]): void {
  const edges = model.edges ?? [];
  const nodes = model.nodes ?? [];
  const crossScanEdges = edges
    .filter((e) => e.cross_scan === true)
    .sort((a, b) => {
      const f = a.from_id.localeCompare(b.from_id);
      return f !== 0 ? f : a.to_id.localeCompare(b.to_id);
    });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  for (const e of crossScanEdges) {
    const id = e.relationship_candidate_id || `${e.from_id}->${e.to_id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const fromName = nodeById.get(e.from_id)?.name ?? e.from_id;
    const toName = nodeById.get(e.to_id)?.name ?? e.to_id;
    out.push({
      ref: { id, itemType: 'candidate', name: `${fromName} ↔ ${toName}`, detail: e.edge_kind },
      section: 'cross-scan-links',
      scanScope: 'cross-scan',
      groupKey: 'cross-scan:links',
      isFamily: false,
    });
  }
}

/**
 * Emit the findings section LAST, grouped the SAME way the Findings table groups
 * them: severity (descending) → category → id. DECIDED findings are dropped (the
 * same dedup the candidate families get). Findings are emitted per scan (code then
 * database) so the per-scan findings bulk ("Approve all N findings in this scan")
 * stays unambiguous; within a scan they follow the table's severity→category order.
 */
function emitFindings(findings: readonly ReviewModelFindingNode[], out: AgendaItem[]): void {
  for (const scan of ['code', 'database'] as ScanKind[]) {
    const scope: 'code' | 'database' = scan === 'code' ? 'code' : 'database';
    const ordered = findings
      .filter((f) => f.scan_kind === scan && isFindingActionable(f))
      .sort(compareFindingBySeverityThenCategoryThenId);
    for (const f of ordered) {
      out.push({
        ref: findingRef(f),
        section: 'findings-by-severity',
        scanScope: scope,
        groupKey: `${scope}:findings`,
        isFamily: false,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Family derivation (pure — from parent_child edges only)
// ---------------------------------------------------------------------------

/**
 * Group a scan's nodes into TWO-LEVEL structural families from the
 * `parent_child` edges. A family = ONE parent + its DIRECT children; a node with
 * no `parent_child` edge in EITHER direction is a family-of-one (an orphan,
 * `isFamily === false`). Relationship-row edges are IGNORED here — families are
 * strictly structural.
 *
 * Cross-scan robustness: only edges whose BOTH endpoints are present in this
 * scan's node set are honoured (a `parent_child` edge should never cross scans,
 * but this keeps the derivation a closed function of the scan partition). A child
 * whose parent is not a node in this scan is treated as a top-level node (it
 * becomes its own family root, mirroring Spec 1's "drop when parent not a node"
 * structural-children rule).
 *
 * 2026-06-06 agenda-redesign-2 (Task Group 3 / Q1) — DEDUP OF DECIDED FAMILIES: a
 * family is RETAINED IFF it still has >=1 ACTIONABLE member (`isActionable` =
 * pending AND not committed), evaluated over the parent + ALL its children. A
 * FULLY-decided family (every member decided or committed) is DROPPED — it never
 * reaches the agenda, so an already-reviewed family is not re-presented. A
 * PARTIALLY-decided family is KEPT with ALL its members RETAINED (the decided ones
 * are NOT stripped — the frontend annotates them read-only). The same predicate
 * drops a fully-decided ORPHAN (a family-of-one whose single member is decided).
 * PURE — reads only `review_status` + `committed`, so it is type-agnostic and the
 * DATABASE-scan families (table → columns + cross-scan logical↔physical mappings)
 * are filtered identically.
 */
function buildFamilies(
  scanNodes: ReviewModelNode[],
  edges: FullReviewModelWire['edges'],
  blastSizeById: Map<string, number>,
): NodeFamily[] {
  const nodeById = new Map(scanNodes.map((n) => [n.id, n]));

  // parentId -> ordered child nodes (deterministic order applied below).
  const childrenByParent = new Map<string, ReviewModelNode[]>();
  // Every node id that appears as the `to_id` (child) of a HONOURED parent_child
  // edge — i.e. a node that has a parent within this scan.
  const childIds = new Set<string>();

  for (const e of edges) {
    if (e.edge_kind !== 'parent_child') continue;
    const parent = nodeById.get(e.from_id);
    const child = nodeById.get(e.to_id);
    // Honour only intra-scan edges where BOTH endpoints are real nodes.
    if (!parent || !child) continue;
    childIds.add(child.id);
    const bucket = childrenByParent.get(parent.id);
    if (bucket) bucket.push(child);
    else childrenByParent.set(parent.id, [child]);
  }

  const families: NodeFamily[] = [];
  for (const node of scanNodes) {
    // A node with a parent in this scan is a CHILD, not a family root — skip it
    // (it is emitted under its parent's family).
    if (childIds.has(node.id)) continue;

    const rawChildren = childrenByParent.get(node.id) ?? [];
    // Sub-order children: conflicts-first, then alphabetical by name (Q4).
    const children = [...rawChildren].sort(compareChildren);

    const members = [node, ...children];

    // 2026-06-06 DEDUP (Task Group 3 / Q1): drop a family with NO actionable
    // member (a fully-decided/committed family — or a fully-decided orphan). A
    // family with >=1 actionable member is KEPT with all its (still-listed)
    // members; decided members are NOT stripped (the frontend annotates them).
    if (!members.some(isActionable)) continue;

    families.push({
      parent: node,
      children,
      isFamily: children.length > 0,
      hasLiveConflict: members.some((m) => m.conflict_state?.has_live_conflict === true),
      hasHighBlast: members.some((m) => !m.committed && (blastSizeById.get(m.id) ?? 0) > 0),
    });
  }

  return families;
}

/**
 * Push one family's items into the flat agenda as a single contiguous,
 * single-`groupKey` run: the parent first, then its (already-sub-ordered)
 * children. Live-conflict members carry their conflict facts (the frontend's
 * deterministic source-pick controls) regardless of which band the family is in —
 * a conflicted child of a high-blast family still gets its facts.
 *
 * Each item of a TRUE multi-node family additionally carries the family metadata
 * (`familyParentId` + `familyChildIds`, 2026-06-05 Task Group 2) so
 * `getReviewChunk` can SURFACE `family = { parentId, childIds }` on the chunk turn
 * without re-deriving it. A family-of-one (orphan) is emitted via `emitBand`'s
 * orphan path, not here, so this metadata only ever rides true families.
 *
 * 2026-06-06 agenda-redesign-2 (Task Group 3): the DECIDED members of a
 * partially-decided family are RETAINED in the run (not stripped) so the frontend
 * can render them read-only/annotated; the chunk's `cascadePreview` (populated in
 * `getReviewChunk`) carries the per-type already-* counts the annotations read.
 */
function emitFamily(
  fam: NodeFamily,
  section: AgendaSectionKind,
  scope: 'code' | 'database',
  model: FullReviewModelWire,
  out: AgendaItem[],
): void {
  const groupKey = `${scope}:family:${fam.parent.id}`;
  const members = [fam.parent, ...fam.children];
  // The family metadata stamped on EVERY item of the run, so `getReviewChunk`
  // reads it off the head item. Only set for true multi-node families (this
  // function is never called for an orphan).
  const familyParentId = fam.parent.id;
  const familyChildIds = fam.children.map((c) => c.id);
  for (const m of members) {
    out.push({
      ref: refForMember(m, model),
      section,
      scanScope: scope,
      groupKey,
      isFamily: fam.isFamily,
      familyParentId,
      familyChildIds,
    });
  }
}

/**
 * The chunk-item ref for a family member: ENRICHED with live-conflict facts when
 * the member has a live conflict (so the frontend can render deterministic
 * source-pick controls), else the plain ref. This preserves the Spec 3 D2
 * behaviour (live-conflict items carry `ref.conflicts`) for members anywhere in
 * the agenda, not only the old standalone live-conflicts pass.
 */
function refForMember(n: ReviewModelNode, model: FullReviewModelWire): ChunkItemRef {
  return n.conflict_state?.has_live_conflict === true
    ? candidateRefWithConflicts(n, model)
    : candidateRef(n);
}

// ---------------------------------------------------------------------------
// Chunking (pure)
// ---------------------------------------------------------------------------

/**
 * Return the next chunk of the agenda starting at `agendaCursor` (0-based index
 * into the flattened agenda). The chunk is the contiguous run of items that share
 * the head item's internal `groupKey`:
 *   - a parent FAMILY → the parent + ALL its children, as ONE chunk regardless of
 *     size (never split a family across chunks); `chunkSize` is NOT applied.
 *   - a homogeneous orphan-by-type / findings / cross-scan run → at most
 *     `chunkSize` items (so those sections do not become a single firehose chunk).
 *
 * Returns the `chunk-summary` turn payload + a flag. `nextCursor` is the index
 * to pass back for the following chunk, or null when the agenda is exhausted.
 * When the head is a true multi-node family, the chunk additionally carries
 * `family = { parentId, childIds }`, the three `familyBulkActions`, the dedicated
 * fourth `familyVisibleChunkAction`, and the rich `cascadePreview` (2026-06-05
 * Task Group 2 + 2026-06-06 agenda-redesign-2 Task Groups 2/3) — a SURFACE of the
 * head item's family metadata + a pure read of the model, ABSENT for non-family
 * runs (orphan-by-type / findings / cross-scan-LINK).
 */
export function getReviewChunk(
  model: FullReviewModelWire,
  agendaCursor: number,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): ReviewChunkResult {
  const agenda = buildAgenda(model);
  const total = agenda.length;
  const start = Math.max(0, Math.floor(agendaCursor));

  // Exhausted / out-of-range cursor → an empty terminal chunk (section is a
  // neutral placeholder; the frontend renders no header for a zero-item chunk).
  if (start >= total) {
    return {
      chunk: {
        kind: 'chunk-summary',
        section: 'findings-by-severity',
        scanScope: 'code',
        items: [],
        cursor: start,
        nextCursor: null,
        agendaTotal: total,
      },
      exhausted: true,
    };
  }

  const head = agenda[start];
  const chunkItems: ChunkItemRef[] = [];
  let i = start;
  // Take the contiguous run sharing the head's groupKey. A FAMILY is taken whole
  // (never bounded by chunkSize); a homogeneous orphan/finding/cross-scan run is
  // bounded by chunkSize so it never becomes the firehose.
  while (i < total && agenda[i].groupKey === head.groupKey) {
    if (!head.isFamily && chunkItems.length >= chunkSize) break;
    chunkItems.push(agenda[i].ref);
    i += 1;
  }

  const nextCursor = i < total ? i : null;

  // Surface the family (2026-06-05 Task Group 2) for a TRUE multi-node family
  // head ONLY: the parent id + its direct child ids are read straight off the
  // head item's family metadata (stamped in `emitFamily`), so this is a pure
  // surface of the family Group 1 already chunked — no re-derivation. Orphan /
  // findings / cross-scan heads have `isFamily === false` and carry no metadata,
  // so `family`/`familyBulkActions`/`familyVisibleChunkAction`/`cascadePreview`
  // stay ABSENT (the additive-optional contract).
  const family =
    head.isFamily && head.familyParentId
      ? { parentId: head.familyParentId, childIds: head.familyChildIds ?? [] }
      : undefined;

  const chunk: ChunkSummaryTurn = {
    kind: 'chunk-summary',
    section: head.section,
    scanScope: head.scanScope,
    items: chunkItems,
    cursor: start,
    nextCursor,
    agendaTotal: total,
  };
  if (family) {
    chunk.family = family;
    // The three full-cascade dispositions (Approve All / Reject All / Defer All).
    chunk.familyBulkActions = [...FAMILY_BULK_ACTIONS];
    // The dedicated FOURTH action ("Approve visible chunk", scope: 'family').
    chunk.familyVisibleChunkAction = FAMILY_VISIBLE_CHUNK_ACTION;
    // The rich multi-line cascade preview (2026-06-06 agenda-redesign-2, S2).
    // Seeded from the family PARENT — the resolver's `'approved'` cascade pulls in
    // the `parent_child` children + the associated logical entities/attributes
    // (the exact "Approve All" reach). PURE + cycle-safe (delegated to the
    // parity-tested resolver). Populated for FAMILY chunks ONLY.
    chunk.cascadePreview = buildCascadePreview([family.parentId], model);
    // Cross-layer (logical↔physical) mapping note (Spec 2026-06-08): the cascade
    // does NOT cross layers, so surface the connection on a logical/physical data
    // ENTITY family — the mapped counterparts (and, for a physical parent, the
    // disposition tally of the mapped logical entities). PURE read of the model.
    const familyParentNode = (model.nodes ?? []).find((n) => n.id === family.parentId);
    const crossLayer = familyParentNode
      ? buildCrossLayerMapping(familyParentNode, model)
      : undefined;
    if (crossLayer) chunk.crossLayerMapping = crossLayer;
  } else if (head.orphanCandidateType && head.scanScope !== 'cross-scan') {
    // ORPHAN-by-type candidate chunk (2026-06-09): no parent_child family, so the
    // rows can otherwise only be actioned one at a time. Offer a TYPE-LEVEL bulk
    // ("Approve all N <type>") that targets EVERY still-actionable candidate of
    // this (type, scan) across the WHOLE model — not just this visible slice. The
    // count is the authoritative figure the coordinator will enumerate + write.
    const type = head.orphanCandidateType;
    const scope = head.scanScope;
    const actionableCount = (model.nodes ?? []).filter(
      (n) => n.candidate_type === type && n.scan_kind === scope && isActionable(n),
    ).length;
    chunk.typeBulk = { candidateType: type, scanScope: scope, actionableCount };
    chunk.typeBulkActions = [...FAMILY_BULK_ACTIONS];
  } else if (
    head.section === 'findings-by-severity' &&
    (head.scanScope === 'code' || head.scanScope === 'database')
  ) {
    // FINDINGS chunk (2026-06-09): findings are neither families nor candidates, so
    // they otherwise had NO bulk control. Offer "Approve all N findings" targeting
    // EVERY still-actionable finding of this scan across the whole model.
    const scope = head.scanScope;
    const actionableCount = (model.findings ?? []).filter(
      (f) => f.scan_kind === scope && isFindingActionable(f),
    ).length;
    chunk.findingsBulk = { scanScope: scope, actionableCount };
    chunk.findingsBulkActions = [...FAMILY_BULK_ACTIONS];
  }

  return {
    chunk,
    exhausted: nextCursor === null,
  };
}

// ---------------------------------------------------------------------------
// Cross-layer (logical↔physical) mapping note (Spec 2026-06-08 — pure)
// ---------------------------------------------------------------------------

/**
 * The entity-level logical↔physical mapping edge kind. The chunk note is
 * entity-level (logical entity ↔ physical entity); the attribute-level mapping is
 * intentionally not surfaced on the note (too granular for a chunk header).
 */
const LOGICAL_PHYSICAL_ENTITY_MAPPING = 'logical_data_entity_physical_data_entities' as const;

/**
 * Build the cross-layer mapping note for a family whose parent is a
 * logical/physical data ENTITY (Spec 2026-06-08 "don't cross layers on approve").
 * The blast-radius cascade does NOT cross the logical↔physical mapping, so this
 * preserves the connection on the chunk:
 *   - LOGICAL parent → the mapped PHYSICAL entity names (reviewed later in the DB scan);
 *   - PHYSICAL parent → the mapped LOGICAL entities + their disposition tally (the
 *     "you have already approved/rejected N logical entities" note).
 * PURE — a read of the model's entity-level mapping edges + the counterpart nodes'
 * `review_status`. Returns undefined when the parent is not a data entity or has no
 * entity-level cross-layer mapping. Mapping edges run logical (`from_id`) → physical
 * (`to_id`); a logical parent reads its OUTGOING edges, a physical parent its INCOMING.
 */
function buildCrossLayerMapping(
  parent: ReviewModelNode,
  model: FullReviewModelWire,
): CrossLayerMapping | undefined {
  const isLogical = parent.candidate_type === 'logical_data_entities';
  const isPhysical = parent.candidate_type === 'physical_data_entities';
  if (!isLogical && !isPhysical) return undefined;

  const counterpartIds: string[] = [];
  for (const e of model.edges ?? []) {
    if (e.edge_kind !== LOGICAL_PHYSICAL_ENTITY_MAPPING) continue;
    if (isLogical && e.from_id === parent.id) counterpartIds.push(e.to_id);
    else if (isPhysical && e.to_id === parent.id) counterpartIds.push(e.from_id);
  }
  if (counterpartIds.length === 0) return undefined;

  const nodeById = new Map((model.nodes ?? []).map((n) => [n.id, n]));
  const counterparts: ReviewModelNode[] = [];
  const seen = new Set<string>();
  for (const id of counterpartIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const n = nodeById.get(id);
    if (n) counterparts.push(n);
  }
  if (counterparts.length === 0) return undefined;

  const counterpartNames = counterparts.map((n) => n.name);

  if (isLogical) {
    // A logical parent: name the physical counterparts (reviewed separately).
    return { parentLayer: 'logical', counterpartNames };
  }

  // A physical parent: tally the mapped LOGICAL entities' review dispositions.
  const mappedDecisions = { approved: 0, rejected: 0, deferred: 0, pending: 0 };
  for (const n of counterparts) {
    switch (n.review_status) {
      case 'approved':
        mappedDecisions.approved += 1;
        break;
      case 'rejected':
        mappedDecisions.rejected += 1;
        break;
      case 'deferred':
        mappedDecisions.deferred += 1;
        break;
      default:
        mappedDecisions.pending += 1;
        break;
    }
  }
  return { parentLayer: 'physical', counterpartNames, mappedDecisions };
}

// ---------------------------------------------------------------------------
// Comparators + ref builders (pure)
// ---------------------------------------------------------------------------

function candidateRef(n: ReviewModelNode): ChunkItemRef {
  return {
    id: n.id,
    itemType: 'candidate',
    // Prefer the class-qualified name for method-level candidates so same-named
    // methods in different classes (e.g. two `createView`s) are visibly distinct.
    name: n.qualified_name ?? n.name,
    detail: n.candidate_type,
  };
}

/**
 * A candidate ref ENRICHED with its live-conflict facts (live-conflict members
 * only). For each LIVE conflict attribute on the node, the competing
 * `{value, source}` list comes straight from `conflict_state.conflicts[attr]`,
 * and `similarCount` is the Spec 0 similarity-class size from the PURE
 * `getSimilarConflicts` (same attr + same competing source-set). NO new
 * computation — both are reads of the model the resolver already populated.
 */
function candidateRefWithConflicts(
  n: ReviewModelNode,
  model: FullReviewModelWire,
): ChunkItemRef {
  return {
    ...candidateRef(n),
    conflicts: liveConflictFacts(n, model),
  };
}

/**
 * The per-attribute live-conflict facts for a node. The live attributes are
 * `conflict_state.live_conflict_attrs` when present, else the attrs in
 * `conflict_state.conflicts` that have NO entry in
 * `conflict_state.conflict_resolutions` (the resolved-vs-live predicate Spec 0
 * encodes). Attrs with no competing entries are skipped (nothing to pick).
 */
function liveConflictFacts(
  n: ReviewModelNode,
  model: FullReviewModelWire,
): ChunkItemConflictFact[] {
  const cs = n.conflict_state;
  if (!cs) return [];
  const conflicts = cs.conflicts ?? {};
  const liveAttrs =
    cs.live_conflict_attrs && cs.live_conflict_attrs.length > 0
      ? cs.live_conflict_attrs
      : Object.keys(conflicts).filter((attr) => !(cs.conflict_resolutions ?? {})[attr]);

  const facts: ChunkItemConflictFact[] = [];
  for (const attr of liveAttrs) {
    const competing = conflicts[attr];
    if (!competing || competing.length === 0) continue;
    facts.push({
      attr,
      competing,
      similarCount: getSimilarConflicts(n.id, attr, model).member_count,
    });
  }
  return facts;
}

function findingRef(f: ReviewModelFindingNode): ChunkItemRef {
  return {
    id: f.id,
    itemType: 'finding',
    name: f.finding_type || f.category || f.id,
    detail: f.severity,
  };
}

function compareByNameThenId(a: ReviewModelNode, b: ReviewModelNode): number {
  const n = (a.name ?? '').localeCompare(b.name ?? '');
  return n !== 0 ? n : a.id.localeCompare(b.id);
}

function compareByTypeThenNameThenId(a: ReviewModelNode, b: ReviewModelNode): number {
  const t = (a.candidate_type ?? '').localeCompare(b.candidate_type ?? '');
  if (t !== 0) return t;
  return compareByNameThenId(a, b);
}

/**
 * Child sub-order WITHIN a family (Q4): conflicts-first, then alphabetical by
 * name (then id for a stable tiebreak). A live-conflict child sorts above a
 * non-conflict sibling so the items that need a human decision sit at the top of
 * the family.
 */
function compareChildren(a: ReviewModelNode, b: ReviewModelNode): number {
  const ca = a.conflict_state?.has_live_conflict === true ? 1 : 0;
  const cb = b.conflict_state?.has_live_conflict === true ? 1 : 0;
  if (ca !== cb) return cb - ca; // live-conflict children first
  return compareByNameThenId(a, b);
}

/**
 * Findings order — MATCHES the Findings table's grouping (`FindingsTab.tsx`):
 * severity (descending: critical → info), then category (alphabetical), then id
 * for a stable tiebreak. So the review room walks findings in the same sensible
 * severity→category grouping the user sees in the table.
 */
function compareFindingBySeverityThenCategoryThenId(
  a: ReviewModelFindingNode,
  b: ReviewModelFindingNode,
): number {
  const ra = SEVERITY_RANK[(a.severity ?? '').toLowerCase()] ?? 0;
  const rb = SEVERITY_RANK[(b.severity ?? '').toLowerCase()] ?? 0;
  if (ra !== rb) return rb - ra; // more severe first
  const ca = (a.category ?? '').toLowerCase();
  const cb = (b.category ?? '').toLowerCase();
  if (ca !== cb) return ca.localeCompare(cb); // then by category (alphabetical)
  return a.id.localeCompare(b.id);
}
