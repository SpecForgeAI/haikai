/**
 * Deterministic review-model BUILDER (Spec 1 — Deterministic Review Model +
 * Cascade/Dependency Graph + Aggregation Backbone).
 *
 * Pure function: given a scan selection's fetched inputs (one or two
 * {@link ScanRunInput}s), build the complete in-memory {@link ReviewModel}:
 *   - one node per candidate (EXCLUDING `*_points` wrappers);
 *   - the full typed-edge set (structural `parent_child` + the six
 *     relationship-row kinds), with name→survivor resolution mirroring
 *     `candidateReconcile.ts` (drop orphans);
 *   - cross-scan logical↔physical edges when both a code run and a DB run are
 *     present (Group 3);
 *   - the unioned finding nodes bridged to candidates via
 *     `DiscoveryFindingDto.links[]` (Group 3);
 *   - the surface-only blast radius per candidate (Group 2);
 *   - the aggregation dimensions over the unified set (Group 2).
 *
 * NO I/O, NO LLM, NO mutation of the input candidate / finding rows. Reuses the
 * Spec 0 primitives directly (`buildIdentityKey`, `classifySourceTier`,
 * `readAddedBy`) — never re-derives identity / tier / conflict logic.
 *
 * The relationship-row name→survivor resolution intentionally mirrors
 * `candidateReconcile.ts`: relationship rows resolve endpoints BY NAME via the
 * SAME per-type identity key the merge keys on (`buildIdentityKey`), and any row
 * whose endpoint resolves to NO surviving candidate is DROPPED (orphan).
 *
 * IMPORTANT — name-key fidelity: `buildIdentityKey` uses a NUL (`\0`) separator
 * internally, while `candidateReconcile.ts`'s `ldeIdentityKeyForName` uses a
 * plain-space variant. To stay byte-identical to the survivor index (which keys
 * via `buildIdentityKey`), the resolver NEVER hand-builds a key string — it
 * constructs a synthetic candidate of the target type carrying the referenced
 * name and runs it through `buildIdentityKey`. Physical entities/attributes fold
 * db/type into their key, so they are additionally indexed by normalized NAME
 * (relationship rows reference them by table/column name alone).
 */

import type { DiscoveryCandidate, CandidateType } from '../../types/candidate';
import {
  buildIdentityKey,
  classifySourceTier,
  readAddedBy,
} from '../candidateIdentity';
import { normalizeName } from '../prompts/dedup';
import {
  POINTS_WRAPPER_TYPES,
  RELATIONSHIP_EDGE_KINDS,
  type EdgeKind,
  type ReviewModel,
  type ReviewModelEdge,
  type ReviewModelNode,
  type ScanRunInput,
} from './types';
import { computeBlastRadii, computeAggregations } from './computeBlastRadiusAndAggregations';
import { computeCrossScanEdges, buildFindingNodes } from './scanSelection';

// ---------------------------------------------------------------------------
// Conflict lens (matches the grid's getUnresolvedConflicts predicate exactly)
// ---------------------------------------------------------------------------

/**
 * Read the live (unresolved) conflict attributes off a candidate's merge data.
 * "Live" = a `data._conflicts[attr]` entry with NO matching
 * `data._conflictResolutions[attr]` — IDENTICAL to the grid's
 * `getUnresolvedConflicts` so the grid and backbone agree exactly.
 */
function readLiveConflictAttrs(data: Record<string, unknown>): {
  liveAttrs: string[];
  conflicts: Record<string, unknown[]> | null;
  resolutions: Record<string, unknown> | null;
} {
  const conflictsRaw = data._conflicts;
  const resolutionsRaw = data._conflictResolutions;
  const conflicts =
    conflictsRaw && typeof conflictsRaw === 'object'
      ? (conflictsRaw as Record<string, unknown[]>)
      : null;
  const resolutions =
    resolutionsRaw && typeof resolutionsRaw === 'object'
      ? (resolutionsRaw as Record<string, unknown>)
      : null;
  if (!conflicts) {
    return { liveAttrs: [], conflicts: null, resolutions };
  }
  const liveAttrs = Object.keys(conflicts).filter((attr) => {
    const entries = conflicts[attr];
    if (!Array.isArray(entries) || entries.length === 0) return false;
    // Resolved when there is a matching resolution for the attribute.
    return !(resolutions && resolutions[attr] !== undefined);
  });
  return { liveAttrs, conflicts, resolutions };
}

/** The best (highest-precedence) `_addedBy` label, defaulting safely. */
function bestAddedByLabel(c: DiscoveryCandidate): string | undefined {
  const labels = readAddedBy(c);
  return labels.length > 0 ? labels[0] : undefined;
}

// ---------------------------------------------------------------------------
// Node-set (Task 1.3)
// ---------------------------------------------------------------------------

/** TRUE when a candidate is a `*_points` wrapper (never a node or edge). */
function isPointsWrapper(c: DiscoveryCandidate): boolean {
  return POINTS_WRAPPER_TYPES.has(c.candidateType as string);
}

function buildNode(
  c: DiscoveryCandidate,
  scanKind: ScanRunInput['scan_kind'],
  runId: string,
): ReviewModelNode {
  const data = (c.data || {}) as Record<string, unknown>;
  const { liveAttrs, conflicts, resolutions } = readLiveConflictAttrs(data);
  const mergedFromRaw = data._mergedFrom;
  const mergedFrom = Array.isArray(mergedFromRaw)
    ? mergedFromRaw.filter((x): x is string => typeof x === 'string')
    : [];
  // Class-qualified display name for MEMBER-level candidates (a method or attribute
  // OF a class), e.g. `OrderService.createView`. The meta-model method is
  // signature-less, so two same-named members in DIFFERENT classes look identical
  // by `name` alone — the review room renders `qualified_name` so they are visibly
  // distinct. Set ONLY when the class context is DISTINCT from the candidate's own
  // name: an ENTITY/class candidate carries `data.className === name`, so qualifying
  // it would produce a redundant "Name.Name" — leave it unset there (consumers fall
  // back to `name`).
  const classNameRaw = data.className;
  const className =
    typeof classNameRaw === 'string' && classNameRaw.trim().length > 0
      ? classNameRaw.trim()
      : null;
  const candidateName = (c.name ?? '').trim();
  const qualifiedName =
    className && className.toLowerCase() !== candidateName.toLowerCase()
      ? `${className}.${c.name}`
      : undefined;
  return {
    id: c.id,
    candidate_type: c.candidateType,
    name: c.name,
    ...(qualifiedName ? { qualified_name: qualifiedName } : {}),
    // The node's review_status is the DISPOSITION (AMS `review_status`:
    // pending_review/approved/rejected/deferred), NOT the lifecycle `status`
    // (proposed/committed). Reading `status` here made every disposition invisible
    // to the agenda dedup, so an approved/rejected family was re-presented forever.
    // `committed` still reflects the lifecycle (`status === 'committed'`).
    review_status: c.reviewStatus ?? 'pending_review',
    committed: c.status === 'committed',
    conflict_state: {
      has_live_conflict: liveAttrs.length > 0,
      live_conflict_attrs: liveAttrs,
      conflicts: conflicts as ReviewModelNode['conflict_state']['conflicts'],
      conflict_resolutions:
        resolutions as ReviewModelNode['conflict_state']['conflict_resolutions'],
    },
    provenance: {
      added_by: readAddedBy(c),
      merged_from: mergedFrom,
    },
    merge_group_key: buildIdentityKey(c),
    operation: c.operation ?? 'create',
    source_tier: classifySourceTier(bestAddedByLabel(c)),
    scan_kind: scanKind,
    run_id: runId,
  };
}

// ---------------------------------------------------------------------------
// Name→survivor resolution index (mirrors candidateReconcile.ts)
// ---------------------------------------------------------------------------

/**
 * Build the per-type IDENTITY KEY for a NAME by running a synthetic candidate of
 * `type` carrying that name through `buildIdentityKey`. Byte-identical to a real
 * candidate's key (same separator), so it matches the survivor index exactly.
 */
function identityKeyForName(type: CandidateType, name: string): string {
  const synthetic: DiscoveryCandidate = {
    id: '',
    runId: '',
    candidateType: type,
    name,
    confidence: 0,
    status: 'proposed',
    sourceClusterIds: [],
    data: {},
    synthesizedAt: '',
  };
  return buildIdentityKey(synthetic);
}

/**
 * A per-type "name → survivor candidate id" index. Relationship rows reference
 * their endpoints BY NAME; we resolve each name to a surviving candidate of the
 * appropriate type using the SAME per-type identity key the merge keys on
 * (`buildIdentityKey`), so the cascade graph matches reconcile's name resolution
 * exactly. A name with no surviving candidate of that type ⇒ orphan ⇒ the edge
 * is dropped.
 */
class SurvivorIndex {
  /** identityKey → candidate id, partitioned by the candidate type bucket. */
  private readonly byTypeKey = new Map<CandidateType, Map<string, string>>();
  /**
   * `${type}::${normalizeName(name)}` → candidate id. Used for physical
   * entities/attributes (whose identity key folds in db/type, so a name-only
   * reference cannot reconstruct the full key) and as a tolerant fallback.
   */
  private readonly byTypeName = new Map<string, string>();

  add(c: DiscoveryCandidate): void {
    let bucket = this.byTypeKey.get(c.candidateType);
    if (!bucket) {
      bucket = new Map<string, string>();
      this.byTypeKey.set(c.candidateType, bucket);
    }
    // First survivor for an identity key wins (survivors are unique by identity).
    const key = buildIdentityKey(c);
    if (!bucket.has(key)) bucket.set(key, c.id);
    const nameKey = `${c.candidateType}::${normalizeName(c.name)}`;
    if (!this.byTypeName.has(nameKey)) this.byTypeName.set(nameKey, c.id);
  }

  /**
   * Resolve a NAME to the surviving candidate id of `type` via the identity key
   * (`buildIdentityKey`). Returns `undefined` when no survivor exists (orphan).
   */
  resolveName(type: CandidateType, name: string): string | undefined {
    const bucket = this.byTypeKey.get(type);
    if (!bucket) return undefined;
    return bucket.get(identityKeyForName(type, name));
  }

  /**
   * Resolve a physical-entity reference by table NAME alone (relationship rows
   * carry only the table/column name, not the db/type the physical identity key
   * folds in).
   */
  resolvePhysicalEntityByName(name: string): string | undefined {
    return this.byTypeName.get(`physical_data_entities::${normalizeName(name)}`);
  }

  /** Resolve a physical attribute reference by column/field NAME alone. */
  resolvePhysicalAttributeByName(name: string): string | undefined {
    return this.byTypeName.get(`physical_data_attributes::${normalizeName(name)}`);
  }

  /** All surviving candidate ids of a given type (used by the cross-scan pass). */
  idsOfType(type: CandidateType): string[] {
    const bucket = this.byTypeKey.get(type);
    return bucket ? [...bucket.values()] : [];
  }
}

// ---------------------------------------------------------------------------
// Relationship-row endpoint resolution (Task 1.5)
// ---------------------------------------------------------------------------

/** Read a string `data` field, trimming; empty ⇒ undefined. */
function readStr(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Resolve the (from_id, to_id) for one relationship-row candidate, mirroring the
 * emitter field shapes (verified against the spring-classic / springBoot / DB
 * pack emitters). Returns `undefined` when either endpoint is an orphan (no
 * surviving candidate) ⇒ the edge is dropped, matching `candidateReconcile.ts`.
 *
 * `nodeIds` is the set of node ids present (so an id-referencing endpoint or a
 * `parentCandidateId` is only honoured when it points at a real node).
 */
function resolveRelationshipEdge(
  rel: DiscoveryCandidate,
  survivors: SurvivorIndex,
  nodeIds: ReadonlySet<string>,
): { fromId: string; toId: string } | undefined {
  const data = (rel.data || {}) as Record<string, unknown>;
  const kind = rel.candidateType as EdgeKind;
  const parentId =
    rel.parentCandidateId && nodeIds.has(rel.parentCandidateId)
      ? rel.parentCandidateId
      : undefined;

  switch (kind) {
    case 'interface_logical_entities': {
      // from = interface (parentCandidateId, or by interfaceClassName); to = LDE by name.
      const interfaceName = readStr(data, 'interfaceClassName');
      const fromId =
        parentId ??
        (interfaceName ? survivors.resolveName('interfaces', interfaceName) : undefined);
      const ldeName = readStr(data, 'logicalEntityName');
      const toId = ldeName ? survivors.resolveName('logical_data_entities', ldeName) : undefined;
      if (!fromId || !toId) return undefined;
      return { fromId, toId };
    }

    case 'endpoint_data_effects': {
      // from = endpoint (parentCandidateId, or by endpointName); to = data entity by name.
      const endpointName = readStr(data, 'endpointName');
      const fromId =
        parentId ??
        (endpointName ? survivors.resolveName('endpoints', endpointName) : undefined);
      const dataEntityName = readStr(data, 'dataEntityName');
      // The data-entity side may be a logical OR physical entity; try logical
      // first (the common code-scan shape), then physical (DB scan).
      const toId = dataEntityName
        ? survivors.resolveName('logical_data_entities', dataEntityName) ??
          survivors.resolvePhysicalEntityByName(dataEntityName)
        : undefined;
      if (!fromId || !toId) return undefined;
      return { fromId, toId };
    }

    case 'logical_data_entity_physical_data_entities': {
      const logicalName = readStr(data, 'logicalEntityName');
      const physicalName =
        readStr(data, 'physicalEntityName') ?? readStr(data, 'physicalTableName');
      const fromId = logicalName
        ? survivors.resolveName('logical_data_entities', logicalName)
        : undefined;
      const toId = physicalName ? survivors.resolvePhysicalEntityByName(physicalName) : undefined;
      if (!fromId || !toId) return undefined;
      return { fromId, toId };
    }

    case 'logical_data_attribute_physical_data_attributes': {
      const logicalAttr = readStr(data, 'logicalAttributeName');
      const physicalAttr =
        readStr(data, 'physicalAttributeName') ?? readStr(data, 'physicalColumnName');
      const fromId = logicalAttr
        ? survivors.resolveName('logical_data_attributes', logicalAttr)
        : undefined;
      const toId = physicalAttr
        ? survivors.resolvePhysicalAttributeByName(physicalAttr)
        : undefined;
      if (!fromId || !toId) return undefined;
      return { fromId, toId };
    }

    case 'logical_data_entity_relationships': {
      // sourceEntity → targetEntity (BOTH logical-to-logical AND
      // physical-to-physical land on this type — try logical then physical for
      // each side, matching the meta-model note in `candidate.ts`).
      const sourceName = readStr(data, 'sourceEntity');
      const targetName = readStr(data, 'targetEntity');
      const fromId = sourceName
        ? survivors.resolveName('logical_data_entities', sourceName) ??
          survivors.resolvePhysicalEntityByName(sourceName)
        : undefined;
      const toId = targetName
        ? survivors.resolveName('logical_data_entities', targetName) ??
          survivors.resolvePhysicalEntityByName(targetName)
        : undefined;
      if (!fromId || !toId) return undefined;
      return { fromId, toId };
    }

    case 'data_movements': {
      // from = the owning service/endpoint (by name, or parentCandidateId);
      // to = the resolved target (by name). A purely-external target leaves the
      // target side unresolved ⇒ no edge (it is captured as a Finding instead).
      const sourceName =
        readStr(data, 'sourceServiceName') ?? readStr(data, 'sourceEndpointName');
      const fromId =
        parentId ??
        (sourceName
          ? survivors.resolveName('service', sourceName) ??
            survivors.resolveName('endpoints', sourceName)
          : undefined);
      const targetName = readStr(data, 'targetName') ?? readStr(data, 'target');
      const toId = targetName
        ? survivors.resolveName('service', targetName) ??
          survivors.resolveName('logical_data_entities', targetName) ??
          survivors.resolvePhysicalEntityByName(targetName)
        : undefined;
      if (!fromId || !toId) return undefined;
      return { fromId, toId };
    }

    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/**
 * Build the complete deterministic review model from a scan selection's fetched
 * inputs (one or two runs). Pure.
 */
export function buildReviewModel(runs: readonly ScanRunInput[]): ReviewModel {
  // --- Node-set (Task 1.3) ------------------------------------------------
  const nodes: ReviewModelNode[] = [];
  const nodeIds = new Set<string>();
  const survivors = new SurvivorIndex();
  // Track relationship-row candidates separately to emit their edges after the
  // survivor index is fully built across BOTH runs.
  const relationshipCandidates: DiscoveryCandidate[] = [];
  // Track structural children to emit parent_child edges after node-set is known.
  const structuralChildren: DiscoveryCandidate[] = [];

  for (const run of runs) {
    for (const c of run.candidates) {
      if (isPointsWrapper(c)) continue; // `*_points` are NEVER nodes/edges
      if (RELATIONSHIP_EDGE_KINDS.has(c.candidateType)) {
        // Relationship-ROW candidates are edges, not nodes.
        relationshipCandidates.push(c);
        continue;
      }
      nodes.push(buildNode(c, run.scan_kind, run.run_id));
      nodeIds.add(c.id);
      survivors.add(c);
      if (c.parentCandidateId) structuralChildren.push(c);
    }
  }

  // --- Structural parent_child edges (Task 1.4) ---------------------------
  const edges: ReviewModelEdge[] = [];
  for (const child of structuralChildren) {
    const parentId = child.parentCandidateId!;
    if (!nodeIds.has(parentId)) continue; // parent not a node (e.g. *_points) ⇒ drop
    edges.push({
      edge_kind: 'parent_child',
      from_id: parentId,
      to_id: child.id,
      relationship_candidate_id: child.id,
      cross_scan: false,
    });
  }

  // --- Relationship-row edges (Task 1.5) ----------------------------------
  for (const rel of relationshipCandidates) {
    const resolved = resolveRelationshipEdge(rel, survivors, nodeIds);
    if (!resolved) continue; // orphan ⇒ dropped (mirrors candidateReconcile.ts)
    edges.push({
      edge_kind: rel.candidateType as EdgeKind,
      from_id: resolved.fromId,
      to_id: resolved.toId,
      relationship_candidate_id: rel.id,
      cross_scan: false,
    });
  }

  // --- Cross-scan logical↔physical edges (Group 3) ------------------------
  edges.push(...computeCrossScanEdges(runs, survivors, nodes));

  // --- Findings bridge (Group 3) ------------------------------------------
  const findings = buildFindingNodes(runs, nodeIds);

  // --- Blast radius (Group 2) ---------------------------------------------
  const blastRadius = computeBlastRadii(nodes, edges);

  // --- Aggregations (Group 2) ---------------------------------------------
  const aggregations = computeAggregations(nodes, edges, findings, blastRadius, relationshipCandidates.length);

  return {
    scan_selection: runs.map((r) => ({ run_id: r.run_id, scan_kind: r.scan_kind })),
    nodes,
    edges,
    findings,
    blast_radius: blastRadius,
    aggregations,
  };
}

// Re-export the survivor index for the cross-scan module's signature.
export { SurvivorIndex };
