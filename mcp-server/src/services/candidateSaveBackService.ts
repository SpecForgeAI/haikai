/**
 * Candidate Save-Back Service
 *
 * Core business logic for promoting high-confidence discovery candidates
 * from Phase 1d into the canonical architecture meta-model.
 *
 * This module provides:
 * - CANDIDATE_TYPE_CONFIG: mapping from candidateType to target model array, ID prefix, and parent FK field
 * - getTargetArrayKey: helper to resolve the model array key for a candidate type
 * - buildDepthMap: topological sort utility that computes depth for each candidate in the forest
 * - convertCandidateToEntity: converts a DiscoveryCandidateDto into the canonical entity shape
 * - saveDiscoveryCandidatesToModel: orchestration function for the full save-back flow
 * - createEmptyModelShell: utility to create an empty model structure when no model exists
 *
 * Follows the GET-merge-PUT pattern from anchorEntitiesService.ts and
 * architectureBaselineService.ts.
 *
 * Spec: Candidate Save-Back to Canonical Model (Increment 11)
 * Task Groups 5 and 6
 *
 * Extended in Increment 13 with mode parameter for Candidate Review
 * and Approval Workflow (auto vs manual save-back paths).
 *
 * Extended in Increment 16 with idempotent save-back guarantees:
 * - Checks DiscoveryCandidateEntityMappingEntity for previously saved candidates
 * - Gates save-back on review_status (only 'approved', excludes 'committed')
 * - Transitions review_status to 'committed' after successful save-back
 *
 * Extended in Extension Pack Framework & LLM File-Level Analysis spec:
 * - Added 4 new candidate types: class, method, endpoint, physical_attribute
 * - Added corresponding CANDIDATE_TYPE_CONFIG entries
 * - Added convertCandidateToEntity switch branches for each new type
 *
 * Extended in 2026-04-20 cleanup:
 * - Renamed discovery-originated candidate_type keys from singular to plural to
 *   match the meta-model reference (e.g. `interface` -> `interfaces`,
 *   `physical_entity` -> `physical_data_entities`,
 *   `entity_relationship` -> `logical_data_entity_relationships`)
 * - Added new `interface_logical_entities` polymorphic relationship type
 * - The following MCP-predating keys remain singular and unchanged:
 *   application, app_component, service, business_process, class, method,
 *   data_entity
 *
 * Extended in SOAP Discovery -- Spring Classic Phase 1 spec (2026-05-17):
 * - The `case 'endpoints'` arm now bundles the seven SOAP `data` fields
 *   emitted by `springClassicSoap/soapEndpointEmitter.ts` into a
 *   `protocol_metadata_json` blob on the entity row when any are present.
 *   REST endpoint candidates (no SOAP fields) leave the column null
 *   (back-compat). Absent-key semantics: undefined SOAP fields on the
 *   candidate become absent keys in the JSONB blob (not `null` values).
 *
 * @module candidateSaveBackService
 */

import { generateId } from '../utils/generateId';
import {
  DiscoveryCandidateDto,
  CandidateEntityMappingDto,
  archModelClient,
  DiscoveryFindingCreatePayload,
} from './archModelClient';

// ============================================================================
// Constants
// ============================================================================

/**
 * Confidence threshold for candidate eligibility.
 * Candidates must have confidence >= this value to be promoted.
 * Mirrors the CANDIDATE_AUTO_ACCEPT_THRESHOLD from discovery-service.
 */
export const CANDIDATE_AUTO_ACCEPT_THRESHOLD = 0.75;

/**
 * Statuses that exclude a candidate from eligibility.
 * Candidates with any of these statuses are skipped during save-back.
 */
export const EXCLUDED_STATUSES = ['rejected', 'merged', 'committed'];

/**
 * Review statuses that exclude a candidate from auto-mode eligibility.
 * In auto mode, candidates with these review_status values are excluded
 * even if they meet the confidence threshold.
 */
export const REVIEW_EXCLUDED_STATUSES = ['rejected', 'deferred'];

// ============================================================================
// Types
// ============================================================================

/**
 * Save-back mode determines which eligibility filter path is used.
 *
 * - 'auto': Existing pipeline behavior (confidence threshold + status filter),
 *   enhanced to also exclude candidates with review_status of 'rejected' or 'deferred'.
 * - 'manual': User-governed save-back that selects only candidates with
 *   review_status === 'approved', ignoring confidence threshold.
 */
export type SaveBackMode = 'auto' | 'manual';

/**
 * Configuration for each candidate type, mapping it to the canonical model
 * array key, the ID generation prefix, and the parent FK field (if any).
 */
export interface CandidateTypeConfigEntry {
  /** The section in metaModel where this type lives: 'entities' (default) or 'relationships' */
  targetSection: 'entities' | 'relationships';
  /** The key within the target section where this entity type lives (e.g., 'applications') */
  targetArrayKey: string;
  /** The prefix for generateId (e.g., 'app-') */
  idPrefix: string;
  /** The parent FK field name on the entity (e.g., 'application_id'), or null if top-level */
  parentFkField: string | null;
}

/**
 * A single re-discovered entity suppressed as an EXACT duplicate of an
 * already-persisted model entity (Model-Aware Discovery, 2026-05-30). Recorded
 * + surfaced (NEVER a silent drop): the run summary reports the count and this
 * set so every suppression is visible.
 */
export interface SuppressedDuplicate {
  /** The candidate that was suppressed. */
  candidateId: string;
  /** The re-discovered (candidate) name. */
  candidateName: string;
  /** The candidate type / target array the duplicate landed against. */
  entityType: string;
  /** The id of the already-persisted entity the candidate exactly matched. */
  existingEntityId: string;
}

/**
 * A re-discovered entity that matched an existing model entity only AFTER
 * normalization (confidence 0.7, below the 0.75 gate). NOT auto-suppressed and
 * NOT auto-created: it stays a reviewable low-confidence "possible duplicate"
 * so a human decides. Surfaced on the run summary (no silent drop).
 */
export interface PossibleDuplicate {
  candidateId: string;
  candidateName: string;
  entityType: string;
  /** The id of the existing entity the candidate normalized-matched. */
  existingEntityId: string;
  /** The (low) match confidence -- always {@link NAME_MATCH_NORMALIZED_CONFIDENCE}. */
  confidence: number;
}

/**
 * A candidate whose OWN confidence is below the 0.75 auto-accept gate
 * (Oracle Integrity & Determinism, Spec #3 TG5). Kept as an explicit
 * "below auto-accept" REVIEWABLE item -- never auto-applied (the gate stands),
 * never silently dropped. Distinct from {@link PossibleDuplicate}, which is a
 * NORMALIZED-name MATCH against an existing entity; this is purely the
 * candidate's intrinsic confidence falling under the gate (e.g. Tier-C 0.4).
 */
export interface BelowGateCandidate {
  candidateId: string;
  candidateName: string;
  /** The candidate type (e.g. `logical_data_entities`). */
  candidateType: string;
  /** The candidate's own confidence (< CANDIDATE_AUTO_ACCEPT_THRESHOLD). */
  confidence: number;
  /** Explicit review status so downstream surfaces can label it. */
  reviewStatus: 'below_auto_accept';
}

/**
 * Result of the save-back orchestration.
 *
 * Extended by Model-Aware Discovery (2026-05-30, Task Group 4) with the
 * dedup-against-existing + enrich/link signals. Every new field is additive;
 * pre-model-aware callers that read only the original five counts are
 * unaffected.
 */
/**
 * A single per-candidate reason entry on {@link SaveBackResult.reasons} (the
 * "reason arm"). Collected at EVERY skip/reuse/create site so the save-result
 * chip + the C1 remediation panel can break the opaque `entitiesSkipped`
 * integer down by reason CLASS instead of guessing. Additive: pre-reason-arm
 * callers ignore it.
 *
 * `reason` is the broad CLASS; `reusedSubclass` further splits a `reused`
 * outcome; `missingField` names the specific blocking/degrading field for the
 * blocked + quality-gap classes so the panel can group by it.
 */
export interface SaveBackReasonEntry {
  /** The discovery candidate this entry describes. */
  candidateId: string;
  /** The candidate type (e.g. `business_logics`, `endpoints`). */
  candidateType: string;
  /** The candidate (display) name at the time of save-back. */
  name: string;
  /**
   * The parent/owning class context when known (e.g. a `business_logics`
   * candidate's `data.controllerClassName ?? data.className`). Empty string
   * when no class context is available.
   */
  class: string;
  /**
   * The broad reason CLASS for this candidate's outcome:
   * - `created`       newly minted into the model
   * - `reused`        matched an existing/earlier entity (see `reusedSubclass`)
   * - `suppressed`    auto-suppressed exact duplicate of a pre-existing entity
   * - `possible`      normalized-only possible duplicate (reviewable)
   * - `blocked`       did NOT commit (missing/unresolved reference, bad type)
   * - `quality_gap`   committed but missing an important field
   */
  reason: 'created' | 'reused' | 'suppressed' | 'possible' | 'blocked' | 'quality_gap';
  /**
   * For `reused`, which sub-class of reuse occurred:
   * - `intra-scan`   matched an entity an EARLIER candidate in THIS save minted
   * - `pre-existing` matched an entity that existed in the model BEFORE this save
   * - `already-saved` this exact candidate was committed in a PRIOR save run
   *                   (filtered pre-loop; never re-entered the merge)
   */
  reusedSubclass?: 'intra-scan' | 'pre-existing' | 'already-saved';
  /**
   * The specific field that is missing/unresolved (blocked) or empty
   * (quality_gap), so the C1 panel can GROUP affected candidates by it.
   * Omitted for created/reused/suppressed/possible.
   */
  missingField?: string;
}

export interface SaveBackResult {
  projectId: string;
  runId: string;
  entitiesCreated: number;
  entitiesSkipped: number;
  candidatesCommitted: number;
  /**
   * Count of re-discovered entities AUTO-SUPPRESSED as EXACT duplicates of
   * already-persisted entities. Equals `suppressedDuplicates.length`.
   */
  entitiesSuppressed: number;
  /**
   * The VISIBLE suppressed set backing {@link entitiesSuppressed}
   * ("N re-discovered entities suppressed as duplicates of existing model
   * entities"). Empty when nothing was suppressed.
   */
  suppressedDuplicates: SuppressedDuplicate[];
  /**
   * Re-discovered entities that matched an existing entity only after
   * normalization (below the auto-accept gate) -- kept as reviewable
   * possible-duplicate candidates, never auto-applied.
   */
  possibleDuplicates: PossibleDuplicate[];
  /**
   * Candidates whose OWN confidence sits below the 0.75 auto-accept gate
   * (Oracle Integrity & Determinism, Spec #3 TG5). In `auto` mode these are NOT
   * auto-applied (the gate is kept -- no low-confidence pollution) but they are
   * NO LONGER silently dropped: every one is recorded here as an explicit
   * "below auto-accept" reviewable item, and {@link belowGateCount} surfaces the
   * count on the run summary (a whole Tier-C `llm-solo` run scores 0.4 and sits
   * entirely below the gate). Empty in `manual` mode (which ignores the gate).
   */
  belowGateCandidates: BelowGateCandidate[];
  /** Count of below-auto-accept reviewable candidates (= belowGateCandidates.length). */
  belowGateCount: number;
  /** Count of `enrich` candidates whose attributes/relationships were applied. */
  enrichmentsApplied: number;
  /** Count of logical<->physical `link` mapping rows written on an EXACT match. */
  linksCreated: number;
  /**
   * Findings raised by the save-back (attribute conflicts + target-gone
   * enrich/link). Surfaced on the result AND best-effort persisted to AMS, so
   * the deterministic core never silently drops evidence.
   */
  findingsEmitted: DiscoveryFindingCreatePayload[];
  /**
   * The per-candidate "reason arm": one {@link SaveBackReasonEntry} for every
   * candidate that was created, reused, suppressed, left as a possible
   * duplicate, blocked, or committed-with-a-quality-gap. Lets the save-result
   * chip + the C1 remediation panel break the opaque skip count down by reason
   * CLASS (and distinguish intra-scan / pre-existing / already-saved reuse).
   * Additive: pre-reason-arm callers simply ignore it.
   */
  reasons: SaveBackReasonEntry[];
}

// ============================================================================
// Candidate Type Configuration
// ============================================================================

/**
 * Mapping from candidateType to its target model array, ID prefix, and parent FK field.
 *
 * Two naming conventions coexist here (by design):
 *
 * 1. Singular (MCP-predates-discovery) keys: `application`, `app_component`,
 *    `service`, `business_process`, `class`, `method`, `data_entity`. These
 *    entered the meta-model before the discovery pipeline was built and keep
 *    their original singular spellings.
 *
 * 2. Plural (discovery-originated) keys: `interfaces`, `endpoints`,
 *    `logical_data_entities`, `logical_data_attributes`, `physical_data_entities`,
 *    `physical_data_attributes`, `logical_data_entity_relationships`,
 *    `business_logics`, `ui_screens`, `ui_components`, `interface_logical_entities`.
 *    These were renamed from singular to plural in the 2026-04-20 cleanup to
 *    match the meta-model collection names emitted by discovery-service.
 */
export const CANDIDATE_TYPE_CONFIG: Record<string, CandidateTypeConfigEntry> = {
  // ---------------------------------------------------------------------------
  // MCP-predates-discovery: singular keys (unchanged)
  // ---------------------------------------------------------------------------
  application: { targetSection: 'entities', targetArrayKey: 'applications', idPrefix: 'app-', parentFkField: null },
  app_component: { targetSection: 'entities', targetArrayKey: 'app_components', idPrefix: 'comp-', parentFkField: 'application_id' },
  service: { targetSection: 'entities', targetArrayKey: 'services', idPrefix: 'svc-', parentFkField: 'application_id' },
  data_entity: { targetSection: 'entities', targetArrayKey: 'physical_data_entities', idPrefix: 'pde-', parentFkField: null },
  business_process: { targetSection: 'entities', targetArrayKey: 'business_processes', idPrefix: 'bp-', parentFkField: null },
  class: { targetSection: 'entities', targetArrayKey: 'classes', idPrefix: 'cls-', parentFkField: 'service_id' },
  method: { targetSection: 'entities', targetArrayKey: 'methods', idPrefix: 'mth-', parentFkField: 'class_id' },

  // ---------------------------------------------------------------------------
  // Discovery-originated: plural keys (renamed 2026-04-20)
  // ---------------------------------------------------------------------------
  interfaces: { targetSection: 'entities', targetArrayKey: 'interfaces', idPrefix: 'ifc-', parentFkField: 'service_id' },
  endpoints: { targetSection: 'entities', targetArrayKey: 'endpoints', idPrefix: 'ep-', parentFkField: 'interface_id' },
  logical_data_entities: { targetSection: 'entities', targetArrayKey: 'logical_data_entities', idPrefix: 'lde-', parentFkField: null },
  logical_data_attributes: { targetSection: 'entities', targetArrayKey: 'logical_data_attributes', idPrefix: 'lda-', parentFkField: 'logical_entity_id' },
  physical_data_entities: { targetSection: 'entities', targetArrayKey: 'physical_data_entities', idPrefix: 'pde-', parentFkField: null },
  physical_data_attributes: { targetSection: 'entities', targetArrayKey: 'physical_data_attributes', idPrefix: 'pda-', parentFkField: 'physical_entity_id' },
  business_logics: { targetSection: 'entities', targetArrayKey: 'business_logics', idPrefix: 'bl-', parentFkField: null },
  logical_data_entity_relationships: { targetSection: 'relationships', targetArrayKey: 'logical_data_entity_relationships', idPrefix: 'ler-', parentFkField: null },
  // UI taxonomy (React V2 / Chunk 3)
  ui_screens: { targetSection: 'entities', targetArrayKey: 'ui_screens', idPrefix: 'scr-', parentFkField: null },
  ui_components: { targetSection: 'entities', targetArrayKey: 'ui_components', idPrefix: 'uicomp-', parentFkField: null },
  // Polymorphic relationship between an interface and either a logical or
  // physical data entity. No single parent FK field -- the relationship row
  // carries both endpoints explicitly.
  interface_logical_entities: { targetSection: 'relationships', targetArrayKey: 'interface_logical_entities', idPrefix: 'ile-', parentFkField: null },
  // Endpoint->Data-Effect Call Graph for Discovery (2026-05-29) -- Task Group 2.
  // The endpoint->data-entity data-effect edge. A relationship row (no single
  // parent FK) modelled exactly on `interface_logical_entities`: it carries both
  // sides explicitly (endpoint_id + data_entity_point_id) and is resolved in a
  // deferred pass (after endpoints + data entities are minted) so both sides can
  // be looked up through the shared normalized-name matcher.
  endpoint_data_effects: { targetSection: 'relationships', targetArrayKey: 'endpoint_data_effects', idPrefix: 'ede-', parentFkField: null },
  // Outbound Integration Graph for Discovery (2026-05-30) -- Task Group 5.
  // The outbound `data_movements` edge (what a service/endpoint CALLS OUT TO).
  // A relationship row (no single parent FK) modelled exactly on
  // `endpoint_data_effects`: the candidate carries the source service/interface
  // NAME + the resolved target NAME (NOT point ids), resolved LATE in a deferred
  // pass (after services/interfaces are minted) to `application_point`s via the
  // deterministic `ap_{serviceId}` convention, through the SAME shared
  // normalized-name matcher. NEVER mints `*_points` (auto-managed by AMS) and
  // NEVER fabricates an external target (AMS `target_application_point_id` is a
  // NOT NULL FK, so an unmodellable target is left to Group 3's Finding).
  data_movements: { targetSection: 'relationships', targetArrayKey: 'data_movements', idPrefix: 'dm-', parentFkField: null },

  // ---------------------------------------------------------------------------
  // Backwards-compat aliases (2026-04-21): discovery runs persisted BEFORE the
  // 2026-04-20 singular→plural rename still carry the old type names. Add
  // aliases so those pre-rename runs can still be saved. Each alias maps to
  // the same target array + ID prefix + FK field as the canonical plural
  // form. Do NOT emit these from the V3 discovery pipeline going forward —
  // they exist purely to unblock already-persisted pre-rename runs.
  // ---------------------------------------------------------------------------
  interface: { targetSection: 'entities', targetArrayKey: 'interfaces', idPrefix: 'ifc-', parentFkField: 'service_id' },
  endpoint: { targetSection: 'entities', targetArrayKey: 'endpoints', idPrefix: 'ep-', parentFkField: 'interface_id' },
  logical_entity: { targetSection: 'entities', targetArrayKey: 'logical_data_entities', idPrefix: 'lde-', parentFkField: null },
  logical_data_attribute: { targetSection: 'entities', targetArrayKey: 'logical_data_attributes', idPrefix: 'lda-', parentFkField: 'logical_entity_id' },
  physical_entity: { targetSection: 'entities', targetArrayKey: 'physical_data_entities', idPrefix: 'pde-', parentFkField: null },
  physical_attribute: { targetSection: 'entities', targetArrayKey: 'physical_data_attributes', idPrefix: 'pda-', parentFkField: 'physical_entity_id' },
  business_logic: { targetSection: 'entities', targetArrayKey: 'business_logics', idPrefix: 'bl-', parentFkField: null },
  entity_relationship: { targetSection: 'relationships', targetArrayKey: 'logical_data_entity_relationships', idPrefix: 'ler-', parentFkField: null },
};

// ============================================================================
// getTargetArrayKey
// ============================================================================

/**
 * Returns the model array key for a given candidate type.
 *
 * @param candidateType - The candidate type string (e.g., 'application', 'service')
 * @returns The model array key (e.g., 'applications', 'services')
 * @throws Error if the candidate type is not recognized
 */
export function getTargetArrayKey(candidateType: string): string {
  const config = CANDIDATE_TYPE_CONFIG[candidateType];
  if (!config) {
    throw new Error(`Unknown candidate type: "${candidateType}"`);
  }
  return config.targetArrayKey;
}

// ============================================================================
// Entity Relationship Helpers
// ============================================================================

// ----------------------------------------------------------------------------
// Shared identity / name-matching primitive
//
// Spec: Endpoint->Data-Effect Call Graph for Discovery (2026-05-29) -- Task
// Group 2. This is the SHARED, cohesive, parameterized identity/matching
// primitive. It is deliberately generic (a normalized-name matcher over an
// arbitrary list of named records) so later specs -- the DB structural-fidelity
// work and model-aware enrichment -- can reuse it WITHOUT the edge use-case
// being baked in. Use-case-specific wrappers (`resolveEntityPoint`,
// `resolveEndpoint`) sit on top; the raw `resolveEntityToPointId` shim below
// preserves the pre-2026-05-29 public signature for the existing call sites.
// ----------------------------------------------------------------------------

/**
 * How a name resolved against a candidate list.
 * - `exact`: byte-for-byte name equality (confidence 1.0; the pre-existing
 *   behaviour of `resolveEntityToPointId`).
 * - `normalized`: matched only after case / separator / singular-plural
 *   normalization (a LOW confidence, intentionally below
 *   `CANDIDATE_AUTO_ACCEPT_THRESHOLD`) -- fixes the `Owner` vs `owners`
 *   duplication.
 * - `none`: no match found.
 */
export type NameMatchKind = 'exact' | 'normalized' | 'none';

/**
 * Confidence assigned to an exact (byte-for-byte) name match.
 */
export const NAME_MATCH_EXACT_CONFIDENCE = 1.0;

/**
 * Confidence assigned to a normalized-only name match. Intentionally below
 * {@link CANDIDATE_AUTO_ACCEPT_THRESHOLD} (0.75) so a fuzzy resolution surfaces
 * as a LOW-confidence outcome rather than silently auto-accepting.
 */
export const NAME_MATCH_NORMALIZED_CONFIDENCE = 0.7;

/**
 * Result of resolving a name against a list via {@link matchByNormalizedName}.
 */
export interface NameMatchResult<T> {
  /** The matched record, or null when nothing matched. */
  item: T | null;
  /** Match confidence: 1.0 exact, 0.7 normalized, 0.0 none. */
  confidence: number;
  /** Which matching strategy produced the result. */
  matchKind: NameMatchKind;
}

/**
 * Normalize a name for identity comparison.
 *
 * Folds case, strips word separators (`_`, `-`, `.`, whitespace) and applies a
 * small set of conservative English singularization rules so that `Owner`,
 * `owners`, `OWNER` and `owner_s` all collapse to the same key. This is
 * deliberately rule-based (not a dictionary) -- it only needs to catch the
 * common entity-naming variants (PascalCase singular vs snake/plural table
 * names) that cause the `Owner` vs `owners` duplication.
 *
 * @param raw - The raw name (may be null/undefined)
 * @returns The normalized comparison key (empty string for null/undefined)
 */
export function normalizeNameForMatch(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Case-fold and strip every separator so casing + delimiter style no longer
  // matter ("logical_data_entity" ~ "LogicalDataEntity").
  let s = raw.trim().toLowerCase().replace(/[\s_\-.]+/g, '');
  if (s.length === 0) return '';
  // Conservative singularization. Order matters (most specific first).
  if (s.endsWith('ies') && s.length > 3) {
    s = s.slice(0, -3) + 'y'; // "categories" -> "category"
  } else if (/(?:s|x|z|ch|sh)es$/.test(s)) {
    s = s.slice(0, -2); // "boxes" -> "box", "buses" -> "bus", "matches" -> "match"
  } else if (s.endsWith('s') && !s.endsWith('ss') && s.length > 1) {
    s = s.slice(0, -1); // "owners" -> "owner" (but leave "address" alone)
  }
  return s;
}

/**
 * Read the parent/owning CLASS context for a candidate, for the reason arm and
 * the `business_logics` on-collision qualifier. For a `business_logics`
 * candidate the parent class lives in the `data` blob (NOT a structural FK,
 * because the type is top-level) -- read it the SAME way
 * `discovery-service/src/services/candidateIdentity.ts` does
 * (`data.controllerClassName ?? data.className`). Returns an empty string when
 * no class context is available (the qualifier then leaves the candidate for
 * the C1 fallback group rather than guessing).
 */
export function readCandidateClassContext(candidate: DiscoveryCandidateDto): string {
  const data = (candidate?.data || {}) as Record<string, unknown>;
  const cls =
    (typeof data.controllerClassName === 'string' && data.controllerClassName) ||
    (typeof data.className === 'string' && data.className) ||
    '';
  return typeof cls === 'string' ? cls.trim() : '';
}

/**
 * Build a base {@link SaveBackReasonEntry} (without `reason`) from a candidate.
 * The caller stamps `reason` (+ optional `reusedSubclass` / `missingField`).
 */
export function baseReasonEntry(candidate: DiscoveryCandidateDto): Omit<SaveBackReasonEntry, 'reason'> {
  return {
    candidateId: candidate.id,
    candidateType: candidate.candidate_type,
    name: candidate.name,
    class: readCandidateClassContext(candidate),
  };
}

/**
 * The SHARED normalized-name matcher. Generic over the record type and
 * parameterized on how to read a record's name, so any consumer can resolve an
 * identity reference against any named collection.
 *
 * Resolution order (highest confidence first):
 *   1. exact byte-for-byte name equality -> confidence 1.0, `matchKind: 'exact'`
 *   2. normalized-name equality          -> confidence 0.7, `matchKind: 'normalized'`
 *   3. no match                          -> confidence 0.0, `matchKind: 'none'`
 *
 * Exact matches are checked across the WHOLE list before any normalized match,
 * so the presence of a fuzzy near-name never shadows a real exact name.
 *
 * @param items - The candidate records to search
 * @param name - The reference name to resolve
 * @param getName - Reads the comparable name off a record (defaults to `.name`)
 * @returns A {@link NameMatchResult} carrying the matched item, confidence and kind
 */
export function matchByNormalizedName<T>(
  items: T[],
  name: string,
  getName: (item: T) => string | undefined = (item: any) => item?.name
): NameMatchResult<T> {
  if (!Array.isArray(items) || items.length === 0 || typeof name !== 'string') {
    return { item: null, confidence: 0, matchKind: 'none' };
  }

  // Pass 1: exact name equality wins outright (preserves legacy behaviour).
  const exact = items.find((it) => getName(it) === name);
  if (exact) {
    return { item: exact, confidence: NAME_MATCH_EXACT_CONFIDENCE, matchKind: 'exact' };
  }

  // Pass 2: normalized-name equality (the duplication fix).
  const wanted = normalizeNameForMatch(name);
  if (wanted.length > 0) {
    const normalized = items.find((it) => normalizeNameForMatch(getName(it)) === wanted);
    if (normalized) {
      return {
        item: normalized,
        confidence: NAME_MATCH_NORMALIZED_CONFIDENCE,
        matchKind: 'normalized',
      };
    }
  }

  return { item: null, confidence: 0, matchKind: 'none' };
}

/**
 * Result of resolving an entity name to its data_entity_point id.
 */
export interface EntityPointMatch {
  /** The `dep_log_`/`dep_phy_` point id, or null when unresolved. */
  pointId: string | null;
  /** Match confidence: 1.0 exact, 0.7 normalized, 0.0 none. */
  confidence: number;
  /** Which matching strategy produced the result. */
  matchKind: NameMatchKind;
  /**
   * The NAME of the existing entity that was matched (additive, 2026-05-30
   * false-merge guard, Spec #3 TG5). Lets a normalized binding name the entity
   * it collided with in a `possible_entity_collision` Finding without re-running
   * the matcher. Undefined when nothing matched. Existing consumers ignore it.
   */
  matchedName?: string;
}

/**
 * Resolves an entity NAME to its deterministic data_entity_point id, using the
 * shared {@link matchByNormalizedName} primitive (so `Owner`, `owners` and
 * `OWNER` all resolve to the SAME point id).
 *
 * The architecture-model-service auto-creates data_entity_points with
 * deterministic ids: `dep_log_<logicalEntityId>` / `dep_phy_<physicalEntityId>`.
 * Logical entities are checked before physical ones, and an exact match in
 * either array beats a normalized match in the other.
 *
 * @param model - The full architecture model (must have metaModel.entities populated)
 * @param entityName - The entity name to resolve
 * @returns An {@link EntityPointMatch}: the point id (null if unresolved) plus a confidence
 */
export function resolveEntityPoint(model: any, entityName: string): EntityPointMatch {
  const logicals: any[] = model?.metaModel?.entities?.logical_data_entities || [];
  const physicals: any[] = model?.metaModel?.entities?.physical_data_entities || [];

  const logicalMatch = matchByNormalizedName(logicals, entityName);
  const physicalMatch = matchByNormalizedName(physicals, entityName);

  // An exact match in either array beats a normalized match in the other.
  // Default precedence (equal kinds) favours the logical entity.
  const logicalWins =
    logicalMatch.matchKind !== 'none' &&
    (physicalMatch.matchKind === 'none' ||
      logicalMatch.confidence >= physicalMatch.confidence);

  if (logicalWins && logicalMatch.item) {
    return {
      pointId: `dep_log_${logicalMatch.item.id}`,
      confidence: logicalMatch.confidence,
      matchKind: logicalMatch.matchKind,
      matchedName: logicalMatch.item.name,
    };
  }
  if (physicalMatch.matchKind !== 'none' && physicalMatch.item) {
    return {
      pointId: `dep_phy_${physicalMatch.item.id}`,
      confidence: physicalMatch.confidence,
      matchKind: physicalMatch.matchKind,
      matchedName: physicalMatch.item.name,
    };
  }
  return { pointId: null, confidence: 0, matchKind: 'none' };
}

/**
 * Result of resolving an endpoint reference to a minted endpoint entity id.
 */
export interface EndpointMatch {
  /** The resolved `endpoints.id`, or null when unresolved. */
  endpointId: string | null;
  /** Match confidence: 1.0 exact, 0.7 normalized, 0.0 none. */
  confidence: number;
  /** Which matching strategy produced the result. */
  matchKind: NameMatchKind;
}

/**
 * Resolves an endpoint reference (by name) to a minted endpoint entity id via
 * the shared {@link matchByNormalizedName} primitive. The data-effect edge's
 * `endpoint_id` is a raw FK to `endpoints.id` (NOT a data-entity point id), so
 * this wrapper returns the endpoint's `id` directly.
 *
 * @param model - The full architecture model (must have metaModel.entities populated)
 * @param endpointName - The endpoint reference name to resolve
 * @returns An {@link EndpointMatch}: the endpoint id (null if unresolved) plus a confidence
 */
export function resolveEndpoint(model: any, endpointName: string): EndpointMatch {
  const endpoints: any[] = model?.metaModel?.entities?.endpoints || [];
  const match = matchByNormalizedName(endpoints, endpointName);
  if (match.matchKind !== 'none' && match.item) {
    return { endpointId: match.item.id, confidence: match.confidence, matchKind: match.matchKind };
  }
  return { endpointId: null, confidence: 0, matchKind: 'none' };
}

/**
 * Resolves an entity name to its deterministic data_entity_point id.
 *
 * COMPAT SHIM (Task Group 2, 2026-05-29): preserves the pre-upgrade public
 * signature (`string | null`) so the existing call sites in the save-back
 * orchestration (request/response body resolution, logical_data_entity_
 * relationships, interface_logical_entities -- the ~1232-1393 block) keep
 * working unchanged. It now delegates to the richer {@link resolveEntityPoint}
 * primitive, which means those call sites also transparently gain the
 * normalized-name fallback (`Owner` <-> `owners`) without any change at the
 * call site.
 *
 * @param model - The full architecture model (must have metaModel.entities populated)
 * @param entityName - The entity name to look up
 * @returns The data_entity_point id, or null if the entity is not found
 */
export function resolveEntityToPointId(model: any, entityName: string): string | null {
  return resolveEntityPoint(model, entityName).pointId;
}

/**
 * Maps discovery candidate cardinality values to the backend enum format.
 * Backend expects UPPER_SNAKE_CASE: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY.
 */
function mapCardinality(value: unknown): string | null {
  if (!value) return null;
  const v = String(value).toUpperCase().replace(/-/g, '_');
  const allowed = ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY'];
  return allowed.includes(v) ? v : null;
}

/**
 * Maps discovery candidate relationship type values to the backend enum format.
 * Backend expects: GENERALIZATION, REALIZATION, COMPOSITION, AGGREGATION, ASSOCIATION, DEPENDENCY.
 */
function mapRelationshipType(value: unknown): string | null {
  if (!value) return null;
  const map: Record<string, string> = {
    composition: 'COMPOSITION',
    aggregation: 'AGGREGATION',
    association: 'ASSOCIATION',
    reference: 'ASSOCIATION',
    inheritance: 'GENERALIZATION',
    dependency: 'DEPENDENCY',
  };
  return map[String(value).toLowerCase()] || null;
}

// ============================================================================
// FK Validation
// ============================================================================

/**
 * Validates all FK references within the model and removes entities with broken FKs.
 *
 * The Java backend does DELETE ALL → re-INSERT in FK order, so every FK reference
 * must point to an entity present in the same PUT body. This function catches broken
 * references (e.g., from direct FK fallback) before they cause a DB constraint violation (500).
 *
 * Validates in FK dependency order so cascading removals are handled correctly:
 * services → interfaces → endpoints, classes → methods, etc.
 *
 * @returns The number of entities removed
 */
export function pruneInvalidFKReferences(model: any): number {
  const entities = model.metaModel?.entities;
  if (!entities) return 0;

  let totalRemoved = 0;

  const idSet = (arr: any[] | undefined) => new Set((arr || []).map((e: any) => e.id));

  // Build mutable ID sets for parent entity types
  const applicationIds = idSet(entities.applications);
  const serviceIds = idSet(entities.services);
  const interfaceIds = idSet(entities.interfaces);
  const classIds = idSet(entities.classes);
  const logicalEntityIds = idSet(entities.logical_data_entities);
  const physicalEntityIds = idSet(entities.physical_data_entities);

  // Validate in FK dependency order (parents before children)
  const checks: Array<{
    arrayKey: string;
    fkField: string;
    validIds: Set<string>;
    parentLabel: string;
    rebuildSet?: Set<string>;
  }> = [
    { arrayKey: 'app_components', fkField: 'application_id', validIds: applicationIds, parentLabel: 'applications' },
    { arrayKey: 'services', fkField: 'application_id', validIds: applicationIds, parentLabel: 'applications', rebuildSet: serviceIds },
    { arrayKey: 'interfaces', fkField: 'service_id', validIds: serviceIds, parentLabel: 'services', rebuildSet: interfaceIds },
    { arrayKey: 'endpoints', fkField: 'interface_id', validIds: interfaceIds, parentLabel: 'interfaces' },
    { arrayKey: 'classes', fkField: 'service_id', validIds: serviceIds, parentLabel: 'services', rebuildSet: classIds },
    { arrayKey: 'methods', fkField: 'class_id', validIds: classIds, parentLabel: 'classes' },
    { arrayKey: 'logical_data_attributes', fkField: 'logical_entity_id', validIds: logicalEntityIds, parentLabel: 'logical_data_entities' },
    { arrayKey: 'physical_data_attributes', fkField: 'physical_entity_id', validIds: physicalEntityIds, parentLabel: 'physical_data_entities' },
  ];

  for (const { arrayKey, fkField, validIds, parentLabel, rebuildSet } of checks) {
    const arr = entities[arrayKey];
    if (!Array.isArray(arr) || arr.length === 0) continue;

    const before = arr.length;
    entities[arrayKey] = arr.filter((e: any) => {
      const fkValue = e[fkField];
      if (!fkValue) return true; // Null FK — Java backend handles nullable constraints
      if (validIds.has(fkValue)) return true;
      console.warn(
        `[save-back] FK validation: removing ${arrayKey} "${e.name}" (${e.id}): ` +
          `${fkField}="${fkValue}" not found in ${parentLabel}`
      );
      return false;
    });

    const removed = before - entities[arrayKey].length;
    totalRemoved += removed;

    // Cascade: rebuild ID set so downstream types see the removals
    if (removed > 0 && rebuildSet) {
      rebuildSet.clear();
      for (const e of entities[arrayKey]) rebuildSet.add(e.id);
    }
  }

  if (totalRemoved > 0) {
    console.log(`[save-back] FK validation: removed ${totalRemoved} entities with broken FK references`);
  }

  return totalRemoved;
}

// ============================================================================
// buildDepthMap
// ============================================================================

/**
 * Builds a depth map from the candidate forest.
 *
 * Candidates with no parent_candidate_id are depth 0.
 * Children of depth-0 candidates are depth 1, and so on.
 *
 * Uses a simple iterative approach: start with all root candidates,
 * then for each depth level find candidates whose parent_candidate_id
 * is in the current depth's set.
 *
 * @param candidates - Array of DiscoveryCandidateDto objects
 * @returns Map of candidateId -> depth
 */
export function buildDepthMap(candidates: DiscoveryCandidateDto[]): Map<string, number> {
  const depthMap = new Map<string, number>();
  const candidateIds = new Set(candidates.map((c) => c.id));

  // Find root candidates (no parent, or parent not in the candidate set)
  const currentLevel: Set<string> = new Set();
  for (const candidate of candidates) {
    if (!candidate.parent_candidate_id || !candidateIds.has(candidate.parent_candidate_id)) {
      depthMap.set(candidate.id, 0);
      currentLevel.add(candidate.id);
    }
  }

  // Iteratively assign depths to children
  let depth = 0;
  while (currentLevel.size > 0) {
    depth++;
    const nextLevel: Set<string> = new Set();

    for (const candidate of candidates) {
      if (
        !depthMap.has(candidate.id) &&
        candidate.parent_candidate_id &&
        currentLevel.has(candidate.parent_candidate_id)
      ) {
        depthMap.set(candidate.id, depth);
        nextLevel.add(candidate.id);
      }
    }

    currentLevel.clear();
    for (const id of nextLevel) {
      currentLevel.add(id);
    }
  }

  return depthMap;
}

// ============================================================================
// deriveInterfaceType
// ============================================================================

/**
 * Pick a sensible `interface_type` for an interface candidate when the
 * discovery pipeline didn't emit one. The frontend declares the column as
 * NOT NULL (one of REST_API / GRAPHQL_API / MESSAGE_TOPIC / STREAM /
 * FILE_TRANSFER / SOAP_API / RPC / OTHER), so a missing value would block
 * the architecture from saving.
 *
 * Spec (hotfix 2026-05-13): every framework adapter that emits an
 * `interfaces` candidate today targets a web/HTTP framework -- Spring Boot,
 * Spring Classic, NestJS, ASP.NET Core, Rails, Django, Symfony, Magento,
 * Wordpress, Kratos, oat++, etc. The LLM-emitted interfaces from gap-fill
 * are also overwhelmingly REST controllers. Rather than touch every
 * adapter or extend the LLM contract, derive the value here using the
 * candidate's `data` shape and its child endpoint candidates' data, then
 * fall back to REST_API as the dominant default. The user can edit the
 * cell on the Interfaces grid if the inference is wrong.
 */
function deriveInterfaceType(
  interfaceCandidate: DiscoveryCandidateDto,
  allCandidates?: DiscoveryCandidateDto[]
): string {
  const data = (interfaceCandidate.data ?? {}) as Record<string, unknown>;

  // 1) Strong signals on the interface candidate's own data payload.
  if (data.graphqlSchema || data.graphqlOperations) return 'GRAPHQL_API';
  if (data.soapAction || data.wsdl) return 'SOAP_API';
  if (data.kafkaTopic || data.rabbitQueue || data.messageQueue) return 'MESSAGE_TOPIC';
  if (data.streamName || data.kinesisStream) return 'STREAM';
  if (data.basePath || data.controllerType || data.openApiTag) return 'REST_API';

  // 2) Child endpoint signals. Spring Boot / NestJS / etc. set
  //    `http_method` on every endpoint candidate; presence of any HTTP
  //    verb child means the parent is an HTTP-style interface.
  if (allCandidates) {
    const endpoints = allCandidates.filter(
      (c) =>
        c.candidate_type === 'endpoints' &&
        c.parent_candidate_id === interfaceCandidate.id
    );
    const hasHttpVerb = endpoints.some((e) => {
      const ed = (e.data ?? {}) as Record<string, unknown>;
      return typeof ed.http_method === 'string' || typeof ed.operation_verb === 'string';
    });
    if (hasHttpVerb) return 'REST_API';
  }

  // 3) Safe default: every framework adapter shipped today emits REST
  //    controllers, and a user-editable best guess is preferable to
  //    blocking the save.
  return 'REST_API';
}

/**
 * Translate the database packs' `data.objectType` value (`'table'` /
 * `'view'` / `'materialized_view'`) into the title-cased label the Physical
 * Entities grid expects on the entity row's `physical_type` column.
 *
 * Bug fix (2026-05-17): database-discovery candidates populate
 * `data.objectType` but NOT `data.physical_type`, so the entity used to land
 * with an empty `physical_type` and disappear from the grid's type filter.
 * This helper is the single source of truth for the mapping and is reused
 * by the `physical_data_entities` / `data_entity` switch branches.
 *
 * Returns null for any input the helper doesn't recognise so the caller can
 * cleanly fall through to its existing default.
 */
function objectTypeToPhysicalType(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  switch (raw.trim().toLowerCase()) {
    case 'table':
      return 'Table';
    case 'view':
      return 'View';
    case 'materialized_view':
      return 'Materialized View';
    default:
      return null;
  }
}

/**
 * The SOAP-specific `data` field names emitted by
 * `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/soapEndpointEmitter.ts`.
 *
 * These ride inside the JSONB `protocol_metadata_json` column on the AMS
 * `endpoints` table (D-5 of the SOAP Discovery -- Spring Classic Phase 1
 * spec); promotion to explicit columns is deferred to a future spec.
 *
 * The candidate-side enumeration here and the AMVS-side enumeration in
 * `synthesiseInventoryFromEndpoints` MUST stay in lock-step -- this is the
 * contract between the discovery emitter and the wizard's pre-population
 * pass.
 *
 * Phase 2, Group 3 (spec 2026-05-17-soap-llm-extraction-and-payload-
 * enrichment-phase-2): `discovery_method` joins the same JSONB blob to
 * carry the trace-metadata distinction between the deterministic
 * Phase 1 emitter (`'framework_scanner'`) and Workstream A's LLM
 * extractor (`'llm_extraction'`). No new AMS schema change -- the field
 * is just another key on the existing `protocol_metadata_json` column.
 */
const SOAP_PROTOCOL_METADATA_FIELDS = [
  'soap_action',
  'request_root_element',
  'request_namespace',
  'response_root_element',
  'request_dto_class',
  'response_dto_class',
  'wsdl_source',
  // Phase 2 Group 3: trace metadata -- 'framework_scanner' for Phase 1
  // deterministic candidates, 'llm_extraction' for Workstream A LLM
  // extractor candidates.
  'discovery_method',
] as const;

/**
 * Bundle the SOAP-specific subset of a candidate's `data` payload into the
 * JSONB blob that lands on the AMS `endpoints` row's
 * `protocol_metadata_json` column.
 *
 * Absent-key semantics (per Group 10 task spec): undefined SOAP fields on
 * the candidate become ABSENT keys in the returned blob, NOT `null` values.
 * `null` values explicitly set on the candidate ARE forwarded as `null`
 * (they represent "known unknown", typically paired with an `evidence_gap`
 * finding from Group 7).
 *
 * Returns `null` (so the caller skips assigning the column) when none of
 * the seven SOAP keys are present on the candidate's `data` -- this is the
 * back-compat path for REST endpoint candidates.
 *
 * Spec: SOAP Discovery -- Spring Classic Phase 1 (2026-05-17), Group 10.
 */
function buildSoapProtocolMetadata(
  data: Record<string, unknown>
): Record<string, unknown> | null {
  const blob: Record<string, unknown> = {};
  let anyPresent = false;
  for (const key of SOAP_PROTOCOL_METADATA_FIELDS) {
    // `in` distinguishes "key absent" from "key present with value undefined"
    // — but at the JSON wire level both collapse, so we use a key-presence
    // check on the source object to decide which keys to forward. Once a
    // key is present we forward its value verbatim (including `null`).
    if (Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined) {
      blob[key] = data[key];
      anyPresent = true;
    }
  }
  return anyPresent ? blob : null;
}

/**
 * Internal (non-HTTP) entry-point protocol metadata (Spec 2026-07-23). The
 * Spring adapters / XML scanner emit scheduled/listener/batch endpoint
 * candidates carrying `endpoint_subtype` + job metadata — pre-fix ALL of it
 * was dropped at commit ("endpoint_subtype is not persisted at commit"), so
 * the committed model could not distinguish an internal entry point and the
 * migration plan minted an unresolvable prerequisite. Bundle the discriminator
 * + provenance into the SAME `protocol_metadata_json` JSONB the SOAP fields
 * use (absent-key semantics, no DDL). Null for plain HTTP endpoints.
 */
const INTERNAL_PROTOCOL_METADATA_FIELDS = [
  'endpoint_subtype',
  'internal_process',
  'listenerAnnotation',
  'className',
  'methodName',
] as const;

function buildInternalProtocolMetadata(
  data: Record<string, unknown>
): Record<string, unknown> | null {
  if (
    typeof data.endpoint_subtype !== 'string' ||
    data.endpoint_subtype.trim().length === 0
  ) {
    return null;
  }
  const blob: Record<string, unknown> = {};
  for (const key of INTERNAL_PROTOCOL_METADATA_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined) {
      blob[key] = data[key];
    }
  }
  return blob;
}

/** Name of the synthesized owner interface for internal entry points. */
export const INTERNAL_PROCESSING_INTERFACE_NAME = 'Internal Processing';

/**
 * Find-or-create the synthesized "Internal Processing" interface that parents
 * internal entry-point endpoints (Spec 2026-07-23). A scheduler / listener /
 * batch owner class has no controller, so discovery never mints an interface
 * candidate for it — pre-fix every internal endpoint candidate was therefore
 * an ORPHAN and skipped wholesale at save-back ("Orphan: requires parent FK
 * 'interface_id'"), which is the real reason the committed model had no
 * internal entry points.
 *
 * `interfaces.service_id` is NOT NULL and the model PUT validates FKs, so the
 * synthesized interface parents onto the model's FIRST service. Returns null
 * (caller falls back to today's honest orphan-block) when the model has no
 * service to parent onto. Idempotent by name across commits.
 */
// Exported additively for unit testing of the internal entry-point rescue.
export function findOrCreateInternalProcessingInterface(
  model: any,
  modelFileId: string
): { id: string } | null {
  const entities = model?.metaModel?.entities;
  if (!entities) return null;
  if (!Array.isArray(entities.interfaces)) entities.interfaces = [];
  const existing = entities.interfaces.find(
    (i: any) => i?.name === INTERNAL_PROCESSING_INTERFACE_NAME
  );
  if (existing?.id) return existing;

  const services: any[] = Array.isArray(entities.services) ? entities.services : [];
  const parentService = services.find((s: any) => typeof s?.id === 'string');
  if (!parentService) return null;

  const iface = {
    id: generateId('ifc-'),
    model_file_id: modelFileId,
    service_id: parentService.id,
    name: INTERNAL_PROCESSING_INTERFACE_NAME,
    description:
      'Synthesized owner for internal (non-HTTP) entry points — scheduled ' +
      'jobs, listeners, batch. Created at commit so internal endpoint ' +
      'candidates are not dropped as orphans.',
    interface_type: 'INTERNAL_PROCESS',
    spec_link: null,
    tags: '',
    valid_from: null,
    valid_to: null,
  };
  entities.interfaces.push(iface);
  return iface;
}

// ============================================================================
// convertCandidateToEntity
// ============================================================================

/**
 * Converts a DiscoveryCandidateDto into the canonical entity shape for its type.
 *
 * - Generates a new entity ID via generateId(config.idPrefix)
 * - Populates common fields: id, name, description, model_file_id
 * - Populates type-specific fields from candidate data payload
 * - Resolves parent FK field from candidateIdToEntityId map
 *
 * Entity shapes follow the patterns from anchorEntitiesService.ts and
 * architectureBaselineService.ts (buildEntities).
 *
 * @param candidate - The discovery candidate to convert
 * @param modelFileId - The model_file_id (derived from project name)
 * @param candidateIdToEntityId - Map of candidateId -> already-created entity ID for parent resolution
 * @returns The entity object ready to be pushed into the model array
 * @throws Error if parent FK is required but parent candidate is not found in the map
 */
export function convertCandidateToEntity(
  candidate: DiscoveryCandidateDto,
  modelFileId: string,
  candidateIdToEntityId: Record<string, string>,
  // Hotfix 2026-05-13: optional full candidate batch so the 'interfaces'
  // branch below can call `deriveInterfaceType` and use child endpoint
  // candidates' http verbs as a signal. Callers from production code path
  // (the orchestration loop in `saveApprovedCandidatesInternal`) pass
  // `eligibleCandidates`; existing tests that omit it still work because
  // the derivation gracefully falls back to interface-data-only signals
  // and finally to the REST_API default.
  allCandidates?: DiscoveryCandidateDto[]
): any {
  const config = CANDIDATE_TYPE_CONFIG[candidate.candidate_type];
  if (!config) {
    throw new Error(
      `Unknown candidate type "${candidate.candidate_type}" for candidate "${candidate.name}" (${candidate.id})`
    );
  }

  const entityId = generateId(config.idPrefix);
  const data = candidate.data || {};

  // Common fields present on all entity types
  const entity: any = {
    id: entityId,
    name: candidate.name,
    description: data.description || '',
    model_file_id: modelFileId,
  };

  // Resolve parent FK field if this type requires a parent
  if (config.parentFkField) {
    if (!candidate.parent_candidate_id) {
      throw new Error(
        `Candidate "${candidate.name}" (${candidate.id}) of type "${candidate.candidate_type}" requires a parent ` +
        `(FK field: ${config.parentFkField}) but has no parent_candidate_id`
      );
    }
    const parentEntityId = candidateIdToEntityId[candidate.parent_candidate_id];
    if (!parentEntityId) {
      throw new Error(
        `Cannot resolve parent for candidate "${candidate.name}" (${candidate.id}): ` +
        `parent_candidate_id "${candidate.parent_candidate_id}" not found in candidateIdToEntityId map`
      );
    }
    entity[config.parentFkField] = parentEntityId;
  }

  // Type-specific field population
  switch (candidate.candidate_type) {
    case 'application':
      entity.app_type = data.app_type || '';
      entity.status = data.status || '';
      entity.tags = data.tags || '';
      entity.valid_from = null;
      entity.valid_to = null;
      entity.is_internal = null;
      break;

    case 'app_component':
      entity.tags = data.tags || '';
      entity.valid_from = null;
      entity.valid_to = null;
      entity.is_internal = null;
      entity.tech_type = data.tech_type || null;
      break;

    case 'service':
      entity.app_component_id = null;
      entity.service_type = data.service_type || '';
      entity.core_tech = data.core_tech || null;
      entity.tags = data.tags || '';
      entity.valid_from = null;
      entity.valid_to = null;
      entity.package_set_id = null;
      entity.is_internal = null;
      break;

    case 'interfaces':
      // Hotfix 2026-05-13: interface_type is NOT NULL in the model; if the
      // adapter / LLM didn't set one, derive it (see deriveInterfaceType
      // above) so the saved row passes validation. The user can still edit
      // the cell on the Interfaces grid afterwards.
      entity.interface_type =
        (typeof data.interface_type === 'string' && data.interface_type.trim().length > 0)
          ? data.interface_type
          : deriveInterfaceType(candidate, allCandidates);
      entity.spec_link = null;
      entity.tags = data.tags || '';
      entity.valid_from = null;
      entity.valid_to = null;
      break;

    case 'logical_data_entities':
      entity.tags = data.tags || '';
      entity.valid_from = null;
      entity.valid_to = null;
      // SOAP/WSDL Message-Field Depth (Spec 4, 2026-05-30) -- Task Group 6.2:
      // a SOAP message-type entity carries the Group-1 PROVENANCE field
      // (source namespace / originating DTO class name) on
      // `data.source_provenance` (emitted by
      // `springClassicSoap/messageEntityEmitter.ts`). Pass it through ADDITIVELY
      // to the AMS `logical_data_entities.source_provenance` column (snake_case
      // wire; `LogicalDataEntityDto.sourceProvenance`). ABSENT for non-SOAP
      // logical-entity candidates (REST/DB/LLM) -- leave the column unset
      // (undefined -> ABSENT key) rather than writing null, mirroring the
      // endpoint protocol-metadata + business-logic `behavior` idioms below.
      if (
        typeof data.source_provenance === 'string' &&
        data.source_provenance.length > 0
      ) {
        entity.source_provenance = data.source_provenance;
      }
      break;

    case 'physical_data_entities':
    case 'data_entity':
      // Bug fix (2026-05-17): database-discovery candidates carry the kind
      // on `data.objectType` ('table' / 'view' / 'materialized_view').
      // Fall back to mapping that field into the title-cased physical_type
      // value the UI expects ('Table' / 'View' / 'Materialized View').
      entity.physical_type =
        data.physical_type || objectTypeToPhysicalType(data.objectType) || '';
      // Database packs put the DB name on `data.databaseName` (camelCase).
      // Keep the existing `data.database_name` path as the primary so non-DB
      // callers are unaffected.
      entity.database_name = data.database_name || data.databaseName || '';
      entity.tags = data.tags || '';
      entity.valid_from = null;
      entity.valid_to = null;
      break;

    case 'business_process':
      entity.tags = data.tags || '';
      entity.valid_from = null;
      entity.valid_to = null;
      break;

    // ========================================================================
    // New types: Extension Pack Framework & LLM File-Level Analysis (TG10)
    // ========================================================================

    case 'class':
      // Class entity: id, name, description, service_id (parent FK), model_file_id
      // service_id already resolved via parent FK mechanism above
      break;

    case 'method':
      // Method entity: id, name, description, class_id (parent FK), model_file_id
      // class_id already resolved via parent FK mechanism above
      break;

    case 'endpoints':
      // Endpoint entity: id, name, description, interface_id (parent FK), model_file_id
      // interface_id already resolved via parent FK mechanism above
      // DTO field names: operation_verb (not http_method), path_or_address (not path)
      //
      // Root cause #2 (Spec 2026-06-02 Unique, Aggregate Discovery Candidates,
      // Task Group 6): the Spring-Classic JAX-RS inbound-surface detectors emit
      // the verb/path on `data.httpMethod` / `data.fullPath` (camelCase), so on
      // an UN-merged path neither snake_case slot was populated and the endpoint
      // persisted with an empty verb/path. Add those camelCase shapes as
      // ADDITIONAL fallbacks, mirroring the file's existing snake/camel
      // dual-tolerant idiom (e.g. `response_contract` / `responseContract`
      // below). Use `??` so the precedence is preserved: the legacy
      // `http_method`/`path` and the merge-normalized `operation_verb`/
      // `path_or_address` canonical slots still win, and the JAX-RS aliases only
      // fill the gap when no canonical value is present.
      entity.operation_verb =
        data.http_method ?? data.operation_verb ?? data.httpMethod ?? null;
      entity.path_or_address =
        data.path ?? data.path_or_address ?? data.fullPath ?? null;
      // SOAP Discovery -- Spring Classic Phase 1 (2026-05-17), Group 10:
      // when the candidate's `data` carries any of the seven SOAP fields
      // emitted by `springClassicSoap/soapEndpointEmitter.ts`, bundle them
      // into a `protocol_metadata_json` JSONB blob on the entity row.
      // Back-compat: REST endpoint candidates (no SOAP fields) leave the
      // column null (helper returns null -> we skip assignment).
      // Absent-key semantics: undefined SOAP fields on the candidate
      // become ABSENT keys in the JSONB blob (not `null` values).
      {
        const soapMetadata = buildSoapProtocolMetadata(data as Record<string, unknown>);
        if (soapMetadata) {
          entity.protocol_metadata_json = soapMetadata;
        }
        // Internal entry points (Spec 2026-07-23): persist the subtype +
        // job/listener provenance into the SAME JSONB (SOAP idiom, no DDL).
        // Pre-fix `endpoint_subtype` was dropped here, so even a committed
        // internal endpoint was indistinguishable on the model.
        const internalMetadata = buildInternalProtocolMetadata(
          data as Record<string, unknown>
        );
        if (internalMetadata) {
          entity.protocol_metadata_json = {
            ...(entity.protocol_metadata_json ?? {}),
            ...internalMetadata,
          };
        }
      }
      // Direction (Spec 2026-07-23, latent-bug fix): outbound-call endpoints
      // (Feign / RestTemplate / WebClient) mark themselves ONLY via
      // `endpoint_subtype: 'outbound-*'` — direction was never persisted, so
      // the migration planner's outbound exclusion could never trigger on
      // committed data and outbound rows polluted the REST partition. An
      // explicit `data.direction` (if an adapter ever sets one) wins.
      if (typeof data.direction === 'string' && data.direction.trim().length > 0) {
        entity.direction = data.direction;
      } else if (
        typeof data.endpoint_subtype === 'string' &&
        data.endpoint_subtype.trim().toLowerCase().startsWith('outbound')
      ) {
        entity.direction = 'outbound';
      }
      // Per-endpoint response-contract capture (Spec 2026-05-30, Task Group 3):
      // the deterministic response-contract scanner (+ optional LLM enrichment)
      // attaches the structured `response_contract` block (error_responses /
      // auth / validation / serialization / status_codes / conditional_variants
      // / provenance / confidence + embedded `schema_version`) to the candidate's
      // `data.response_contract` (snake_case, matching the host `EndpointDto`).
      // On save-approved, map it onto the AMS `endpoints.response_contract` JSONB
      // column. Snake/camel-tolerant (accept `responseContract` too) and additive
      // + nullable: ABSENT when the scanner was tier-gated off / skipped / found
      // nothing -- leave the column UNSET (undefined -> ABSENT key) rather than
      // overwriting an existing value with null, mirroring the business-logic
      // `behavior` and endpoint-data-effect `path_metadata_json` idioms.
      {
        const responseContract = data.response_contract ?? data.responseContract;
        if (responseContract !== undefined && responseContract !== null) {
          entity.response_contract = responseContract;
        }
      }
      // Per-endpoint REQUEST-contract capture (Spec 2026-06-19, Task Group 2):
      // sibling to the response-contract pass-through above. The discovery
      // scanner / adapter already writes the request-construction facts onto
      // the candidate's `data` -- a pre-assembled structured `request_contract`
      // block (Phase 2: param_formats / request_validation / provenance /
      // confidence + embedded `schema_version`) AND/OR the loose Phase-1
      // discriminator facts (`consumes` -> request media type, required
      // `headers`/`requestHeaders`, `requestParams`). Map them onto the AMS
      // `endpoints.request_contract` JSONB column (added in Task Group 1).
      // Snake/camel-tolerant (accept `requestContract` too) and additive +
      // nullable: ABSENT when no request facts are present -- leave the column
      // UNSET (undefined -> ABSENT key) rather than overwriting an existing
      // value with null, mirroring the response_contract / protocol-metadata
      // idioms above. Today these facts (consumes/headers/requestParams/
      // requestHeaders) reach `discovery_candidates.data` but die here -- this
      // pass-through is the Phase-1 unblock.
      {
        // (1) A pre-assembled structured block rides through verbatim.
        const requestContract = data.request_contract ?? data.requestContract;
        if (requestContract !== undefined && requestContract !== null) {
          entity.request_contract = requestContract;
        } else {
          // (2) Otherwise assemble from the loose adapter facts the scanner
          // already produces. Each piece is additive + absent-key safe: a
          // fact that is missing contributes NOTHING to the blob, and when
          // no request facts are present at all the column is left UNSET.
          const assembled: Record<string, unknown> = {};
          // content_type: request media type(s) from the `consumes`
          // discriminator (snake/camel-tolerant; array of media types).
          const consumes = data.consumes ?? data.consumes_media_types;
          if (Array.isArray(consumes) && consumes.length > 0) {
            assembled.consumes = consumes;
            assembled.content_type = consumes[0];
          }
          // required_headers: the mapping `headers` discriminators (always
          // required to match the route) plus any required `@RequestHeader`
          // params. Each entry is `{ name, source }`.
          const requiredHeaders: Array<Record<string, unknown>> = [];
          const headerDiscriminators = data.headers ?? data.header_discriminators;
          if (Array.isArray(headerDiscriminators)) {
            for (const h of headerDiscriminators) {
              if (typeof h === 'string' && h.length > 0) {
                requiredHeaders.push({ name: h, source: 'mapping-header' });
              }
            }
          }
          const requestHeaders = data.requestHeaders ?? data.request_headers;
          if (Array.isArray(requestHeaders)) {
            for (const rh of requestHeaders) {
              if (rh && typeof rh === 'object' && (rh as any).required === true) {
                requiredHeaders.push({
                  name: (rh as any).name,
                  source: '@RequestHeader',
                });
              }
            }
          }
          if (requiredHeaders.length > 0) {
            assembled.required_headers = requiredHeaders;
          }
          // params: `@RequestParam` request inputs the scanner captured.
          const requestParams = data.requestParams ?? data.request_params;
          if (Array.isArray(requestParams) && requestParams.length > 0) {
            assembled.params = requestParams;
          }
          // Only attach the assembled blob when at least one request fact was
          // present -- otherwise leave the column UNSET (absent key, not null).
          if (Object.keys(assembled).length > 0) {
            entity.request_contract = assembled;
          }
        }
      }
      break;

    case 'physical_data_attributes':
      // Physical attribute entity: id, name, description, physical_entity_id (parent FK), model_file_id
      // physical_entity_id already resolved via parent FK mechanism above
      entity.data_type = data.dataType || data.data_type || null;
      // DB columns are NOT NULL with defaults: is_primary_key DEFAULT FALSE, is_nullable DEFAULT TRUE
      entity.is_primary_key = data.isPrimaryKey ?? data.is_primary_key ?? false;
      entity.is_nullable = data.isNullable ?? data.is_nullable ?? true;
      break;

    case 'logical_data_attributes':
      // Logical data attribute entity: id, name, description, logical_entity_id (parent FK), model_file_id
      // logical_entity_id already resolved via parent FK mechanism above
      entity.data_type = data.dataType || data.data_type || null;
      // DB columns are NOT NULL with defaults: is_primary_key DEFAULT FALSE, is_nullable DEFAULT TRUE
      entity.is_primary_key = data.isPrimaryKey ?? data.is_primary_key ?? false;
      entity.is_nullable = data.isNullable ?? data.is_nullable ?? true;
      // SOAP/WSDL Message-Field Depth (Spec 4, 2026-05-30) -- Task Group 6.2:
      // a SOAP message FIELD carries the Group-1 on-attribute JSONB metadata
      // blob (cardinality { min_occurs / max_occurs / is_collection } +
      // value-domain restrictions + the AS-IS XSD source-type) on
      // `data.field_metadata` (emitted by
      // `springClassicSoap/messageEntityEmitter.ts`). Pass it through ADDITIVELY
      // to the AMS `logical_data_attributes.field_metadata` column (snake_case
      // wire; `LogicalDataAttributeDto.fieldMetadata`). The parent-FK
      // `logical_entity_id` resolution is UNCHANGED; `is_nullable` stays the
      // real column from `nillable` (NOT overloaded with cardinality). ABSENT
      // for non-SOAP logical-attribute candidates -- leave the column unset
      // (undefined -> ABSENT key) rather than writing null, mirroring the
      // endpoint protocol-metadata + business-logic `behavior` idioms.
      {
        const fm = data.field_metadata ?? data.fieldMetadata;
        if (fm && typeof fm === 'object') {
          entity.field_metadata = fm;
        }
      }
      break;

    case 'business_logics':
      // Business logic entity: id, name, description_md, type_text, tags,
      // behavior, model_file_id
      // No parent FK -- top-level entity (relationship to service via relationship tables)
      // DTO field names: description_md (not description), type_text
      entity.description_md = data.description || data.description_md || '';
      entity.type_text = data.type_text || data.typeText || null;
      entity.tags = data.tags || '';
      // Gap C (Spec 2026-05-29 Business-logic behaviour capture): the per-method
      // behaviour-capture stage attaches the 7-part structured behaviour block
      // to the candidate's `data.behavior` (JSONB passthrough, auto-stored on
      // `discovery_candidates.data` by bulkSaveCandidates). On save-approved,
      // map it onto the AMS `business_logics.behavior` JSONB column added in
      // Task Group 1. ABSENT when the stage was tier-gated off / skipped /
      // produced no block -- leave the column unset (undefined -> ABSENT key)
      // rather than writing null, mirroring the endpoint protocol-metadata idiom.
      if (data.behavior !== undefined && data.behavior !== null) {
        entity.behavior = data.behavior;
      }
      break;

    case 'logical_data_entity_relationships':
      // Entity relationship: id, name, description, model_file_id
      // Metadata carries sourceEntity, targetEntity, cardinality, relationshipType
      entity.source_entity = data.sourceEntity || null;
      entity.target_entity = data.targetEntity || null;
      entity.cardinality = data.cardinality || null;
      entity.relationship_type = data.relationshipType || null;
      break;

    case 'ui_screens':
      // UIScreenDto fields: id, name, route, description, application_point_id
      //
      // Bug fix (2026-04-21): `route` is declared `nullable=false` on
      // UIScreenEntity. The React pack emits `route: null` because it can't
      // derive a route from a class/function name alone. Persisting null
      // violates the DB constraint → 500 → MCP maps to 502. Fall back to an
      // empty string so the save lands; the route can be set manually later
      // in the UI (empty-string is how the meta-model represents "unknown"
      // for required-but-unknown text fields elsewhere in the DB).
      entity.route = data.route || data.path || '';
      entity.application_point_id = data.application_point_id || data.applicationPointId || null;
      break;

    case 'ui_components':
      // UIComponentDto fields: id, name, component_type, description, domain, props_schema_json
      entity.component_type = data.component_type || data.componentType || 'other';
      entity.domain = data.domain || null;
      entity.props_schema_json = data.props_schema_json || data.propsSchemaJson || null;
      break;

    case 'interface_logical_entities':
      // Polymorphic relationship between an interface and a logical/physical
      // data entity. The relationship row carries both endpoints explicitly;
      // no single parent FK field. Downstream persistence is responsible for
      // resolving these references into the meta-model.
      entity.interface_id = data.interface_id || data.interfaceId || null;
      entity.logical_data_entity_id = data.logical_data_entity_id || data.logicalDataEntityId || null;
      entity.physical_data_entity_id = data.physical_data_entity_id || data.physicalDataEntityId || null;
      entity.direction = data.direction || null;
      break;

    case 'endpoint_data_effects':
      // Endpoint->data-entity data-effect edge (Task Group 2, 2026-05-29).
      // Like `interface_logical_entities`, the row carries both sides
      // explicitly and is normally resolved by name in the deferred pass
      // (`convertEndpointDataEffectToRow`) which has the full model. This
      // branch covers the pre-resolved path: if the candidate already carries
      // a resolved `endpoint_id` / `data_entity_point_id`, pass them straight
      // through, plus the access semantics + structured path metadata. Emits
      // the AMS `endpoint_data_effects` row shape in snake_case (the DTO uses
      // explicit snake_case @JsonProperty for EVERY field, including
      // `data_entity_point_id` -- unlike interface_logical_entities which is
      // camelCase on the wire).
      entity.endpoint_id = data.endpoint_id || data.endpointId || null;
      entity.data_entity_point_id =
        data.data_entity_point_id || data.dataEntityPointId || null;
      entity.access_mode = data.access_mode || data.accessMode || null;
      entity.path_metadata_json =
        data.path_metadata_json || data.pathMetadataJson || null;
      // Edge confidence rides on the row; fall back to the candidate-level
      // confidence so a row always carries one.
      entity.confidence =
        data.confidence ?? candidate.confidence ?? null;
      entity.tags = data.tags || '';
      entity.valid_from = null;
      entity.valid_to = null;
      break;
  }

  return entity;
}

/**
 * Result of converting an `endpoint_data_effects` candidate into an AMS
 * relationship row.
 */
export interface EndpointDataEffectConversion {
  /** The AMS `endpoint_data_effects` row (snake_case wire shape), or null if unresolved. */
  row: any | null;
  /**
   * The lower of the two side-resolution confidences (endpoint side,
   * data-entity side), folded with the candidate's own confidence. Lets the
   * caller honour the three-outcome model without a new candidate state.
   */
  confidence: number;
  /** True when both the endpoint side AND the data-entity side resolved. */
  resolved: boolean;
  /** When unresolved, which side(s) failed (for finding/diagnostic context). */
  unresolvedSide: 'endpoint' | 'data_entity' | 'both' | null;
}

/**
 * Relationship sibling of {@link convertCandidateToEntity} for the
 * `endpoint_data_effects` edge.
 *
 * Resolves BOTH the endpoint side and the data-entity-point side THROUGH the
 * shared normalized-name primitive ({@link resolveEndpoint} /
 * {@link resolveEntityPoint}, both layered on {@link matchByNormalizedName}),
 * then emits the AMS row shape from Task Group 1: `endpoint_id`,
 * `data_entity_point_id`, `access_mode`, `confidence`, `path_metadata_json`
 * (all snake_case, matching `EndpointDataEffectDto`'s explicit @JsonProperty
 * declarations).
 *
 * This needs the full model (to look names up), so -- exactly like
 * `interface_logical_entities` -- it runs in a deferred pass after entities are
 * minted, NOT inside `convertCandidateToEntity` (which has no model). It does
 * NOT introduce a new candidate state: the returned `confidence` lets the
 * caller route the edge through the existing three-outcome model
 * (>=0.75 normal / <0.75-but-resolved low-confidence candidate / unresolved
 * -> finding upstream in discovery).
 *
 * Reference shape on the candidate's `data` (emitted by the discovery resolver
 * in Task Group 3; pre-resolved ids are also accepted):
 *   - endpoint side:    `endpointName` (or pre-resolved `endpoint_id`)
 *   - data-entity side: `entityName` / `dataEntityName` (or pre-resolved
 *                       `data_entity_point_id`)
 *   - `access_mode`, `path_metadata_json`, edge `confidence`.
 *
 * @param candidate - The `endpoint_data_effects` discovery candidate
 * @param model - The full architecture model (entities already minted)
 * @param modelFileId - The model_file_id (project name) stamped onto the row
 * @returns An {@link EndpointDataEffectConversion}
 */
export function convertEndpointDataEffectToRow(
  candidate: DiscoveryCandidateDto,
  model: any,
  modelFileId: string
): EndpointDataEffectConversion {
  const data = (candidate.data || {}) as Record<string, any>;

  // --- Endpoint side: pre-resolved id wins; else resolve the name. ---
  let endpointId: string | null = data.endpoint_id || data.endpointId || null;
  let endpointConfidence = endpointId ? NAME_MATCH_EXACT_CONFIDENCE : 0;
  if (!endpointId) {
    const endpointName = (data.endpointName || data.endpoint || candidate.name) as
      | string
      | undefined;
    if (typeof endpointName === 'string') {
      const m = resolveEndpoint(model, endpointName);
      endpointId = m.endpointId;
      endpointConfidence = m.confidence;
    }
  }

  // --- Data-entity side: pre-resolved point id wins; else resolve the name. ---
  let pointId: string | null =
    data.data_entity_point_id || data.dataEntityPointId || null;
  let pointConfidence = pointId ? NAME_MATCH_EXACT_CONFIDENCE : 0;
  if (!pointId) {
    const entityName = (data.entityName ||
      data.dataEntityName ||
      data.dataEntity ||
      data.entity) as string | undefined;
    if (typeof entityName === 'string') {
      const m = resolveEntityPoint(model, entityName);
      pointId = m.pointId;
      pointConfidence = m.confidence;
    }
  }

  const resolved = Boolean(endpointId && pointId);
  const unresolvedSide: EndpointDataEffectConversion['unresolvedSide'] = resolved
    ? null
    : !endpointId && !pointId
      ? 'both'
      : !endpointId
        ? 'endpoint'
        : 'data_entity';

  // Edge confidence: an explicit edge confidence on the candidate (from the
  // discovery resolver) leads; otherwise fold the two side-resolution
  // confidences (weakest link) with the candidate's own confidence.
  const sideConfidence = Math.min(endpointConfidence, pointConfidence);
  const edgeConfidence: number =
    typeof data.confidence === 'number'
      ? data.confidence
      : typeof candidate.confidence === 'number'
        ? Math.min(candidate.confidence, sideConfidence)
        : sideConfidence;

  if (!resolved) {
    return { row: null, confidence: edgeConfidence, resolved: false, unresolvedSide };
  }

  // AMS `endpoint_data_effects` row -- snake_case wire shape (Task Group 1).
  const row: any = {
    id: generateId('ede-'),
    endpoint_id: endpointId,
    data_entity_point_id: pointId,
    access_mode: data.access_mode || data.accessMode || null,
    path_metadata_json: data.path_metadata_json || data.pathMetadataJson || null,
    confidence: edgeConfidence,
    description: data.description || '',
    tags: data.tags || '',
    valid_from: null,
    valid_to: null,
  };

  return { row, confidence: edgeConfidence, resolved: true, unresolvedSide: null };
}

// ============================================================================
// Outbound Integration Graph -- `data_movements` save-back (2026-05-30, TG5)
//
// Resolves an outbound `data_movements` candidate (source service/interface
// NAME + resolved target NAME, emitted by the discovery Group-3
// `outboundIntegrationCandidates` builder) into the AMS `data_movements`
// relationship row. Source + target are resolved to their AUTO-MANAGED
// `application_point` ids via the deterministic `ap_{serviceId}` convention
// (`architectureBaselineService.ts` L1035/L1157-1158 -- the application_point
// for a service has id `ap_${svcId}`), REUSING the shared normalized-name
// primitive (`matchByNormalizedName`) so `OrderService`/`order-service`
// collapse to one id. NOTHING here creates or mutates an `application_point`
// (they are backend-auto-managed); `ap_{id}` is a deterministic REFERENCE only,
// exactly like the `dep_log_<id>` data-entity point references above.
// ============================================================================

/**
 * Result of resolving a service/interface NAME to its auto-managed
 * `application_point` id (`ap_{entityId}`).
 */
export interface ApplicationPointMatch {
  /** The `ap_<serviceId>` / `ap_<interfaceId>` point id, or null when unresolved. */
  pointId: string | null;
  /** Match confidence: 1.0 exact, 0.7 normalized, 0.0 none. */
  confidence: number;
  /** Which matching strategy produced the result. */
  matchKind: NameMatchKind;
  /** The NAME of the matched entity (undefined when nothing matched). */
  matchedName?: string;
}

/**
 * Resolves a service/interface NAME to its deterministic `application_point`
 * id, using the SHARED {@link matchByNormalizedName} primitive (NOT a fork) so
 * `OrderService`, `order-service` and `OrderSvc`-style variants resolve
 * consistently.
 *
 * The architecture-model-service auto-creates an `application_point` for every
 * service AND every interface with the deterministic id `ap_<entityId>`
 * (`architectureBaselineService.ts` -- `id: ap_${svcId}` L1035, `id: ap_${ifcId}`
 * L1055; the `buildRelationships` data_movements block derives source/target as
 * `ap_${svcId}` at L1157-1158). Services are checked before interfaces; an exact
 * match in either beats a normalized match in the other. NEVER creates an
 * `application_points` row -- they are auto-managed by AMS.
 *
 * @param model - The full architecture model (entities already minted)
 * @param name - The service/interface name to resolve
 * @returns An {@link ApplicationPointMatch}: the `ap_<id>` point id (null if
 *   unresolved) plus a confidence
 */
export function resolveApplicationPoint(model: any, name: string): ApplicationPointMatch {
  const services: any[] = model?.metaModel?.entities?.services || [];
  const interfaces: any[] = model?.metaModel?.entities?.interfaces || [];

  const serviceMatch = matchByNormalizedName(services, name);
  const interfaceMatch = matchByNormalizedName(interfaces, name);

  // An exact match in either array beats a normalized match in the other.
  // Default precedence (equal kinds) favours the service.
  const serviceWins =
    serviceMatch.matchKind !== 'none' &&
    (interfaceMatch.matchKind === 'none' ||
      serviceMatch.confidence >= interfaceMatch.confidence);

  if (serviceWins && serviceMatch.item) {
    return {
      pointId: `ap_${serviceMatch.item.id}`,
      confidence: serviceMatch.confidence,
      matchKind: serviceMatch.matchKind,
      matchedName: serviceMatch.item.name,
    };
  }
  if (interfaceMatch.matchKind !== 'none' && interfaceMatch.item) {
    return {
      pointId: `ap_${interfaceMatch.item.id}`,
      confidence: interfaceMatch.confidence,
      matchKind: interfaceMatch.matchKind,
      matchedName: interfaceMatch.item.name,
    };
  }
  return { pointId: null, confidence: 0, matchKind: 'none' };
}

/**
 * Result of converting a `data_movements` outbound-integration candidate into
 * an AMS `data_movements` relationship row.
 */
export interface DataMovementConversion {
  /** The AMS `data_movements` row (mixed snake/camelCase wire shape), or null if not written. */
  row: any | null;
  /** The source-side resolution confidence, folded with the candidate's own confidence. */
  confidence: number;
  /** True when a row was produced (SOURCE resolved AND a modellable target resolved). */
  resolved: boolean;
  /**
   * Why no row was produced:
   *  - `source`: the source service/interface NAME did not resolve (SKIP, never fabricate).
   *  - `external_target`: the target is purely external (left to Group 3's Finding;
   *    AMS `target_application_point_id` is a NOT NULL FK so we never write a null/fake target).
   *  - null when a row WAS produced.
   */
  skippedReason: 'source' | 'external_target' | null;
}

/**
 * Relationship sibling of {@link convertEndpointDataEffectToRow} for the
 * outbound `data_movements` edge (Outbound Integration Graph, TG5).
 *
 * Reads the candidate's source + target NAMES (emitted by the discovery
 * Group-3 builder) and resolves BOTH to their auto-managed `application_point`s
 * THROUGH the shared {@link resolveApplicationPoint} wrapper (layered on the
 * SAME {@link matchByNormalizedName} primitive the other producers use). It then
 * emits the AMS `data_movements` row shape EXACTLY (mixed wire: snake_case
 * `source_application_point_id` / `target_application_point_id` / `movement_type`
 * / `description` / `tags` / `valid_from` / `valid_to`; camelCase
 * `dataEntityPointId` / `interfaceWithSchemaId` / `biDirectional`).
 *
 * Outcomes (mirroring the `endpoint_data_effects` skip-not-fabricate discipline):
 *  - SOURCE unresolved        -> `{ row: null, skippedReason: 'source' }` (SKIP, logged).
 *  - target PURELY EXTERNAL   -> `{ row: null, skippedReason: 'external_target' }`.
 *      AMS `target_application_point_id` is a NOT NULL FK to `application_points(id)`
 *      (`DataMovementEntity` `nullable=false`; `schema.sql` `NOT NULL REFERENCES`),
 *      so an unmodellable target can NOT be written as a null/fabricated edge --
 *      it stays recorded as Group 3's `external_integration_dependency` Finding.
 *  - BOTH resolve             -> a row source `ap_` -> target `ap_`.
 *
 * `movement_type` carries the candidate's `movementType` (= the integration
 * kind). The XOR `dataEntityPointId` / `interfaceWithSchemaId` are BOTH left
 * absent (an outbound dependency is carried by the source->target link; we never
 * fabricate either side of the XOR). NEVER creates an `application_points` /
 * `data_entity_points` row.
 *
 * @param candidate - The `data_movements` outbound-integration candidate
 * @param model - The full architecture model (services/interfaces already minted)
 * @param _modelFileId - The model_file_id (unused; the PUT stamps it -- kept for
 *   signature parity with {@link convertEndpointDataEffectToRow})
 * @returns A {@link DataMovementConversion}
 */
export function convertDataMovementToRow(
  candidate: DiscoveryCandidateDto,
  model: any,
  _modelFileId: string
): DataMovementConversion {
  const data = (candidate.data || {}) as Record<string, any>;

  // --- Source side: resolve the owning service/interface NAME -> ap_{id}. ---
  // SKIP-not-fabricate: a source that does not resolve yields no row (the AMS
  // `source_application_point_id` is a NOT NULL FK).
  const sourceName = (data.sourceServiceName ||
    data.ownerClassName ||
    candidate.name) as string | undefined;
  let sourceConfidence = 0;
  let sourcePointId: string | null = null;
  if (typeof sourceName === 'string') {
    const m = resolveApplicationPoint(model, sourceName);
    sourcePointId = m.pointId;
    sourceConfidence = m.confidence;
  }
  if (!sourcePointId) {
    return { row: null, confidence: sourceConfidence, resolved: false, skippedReason: 'source' };
  }

  // --- Target side: a purely-external target is NEVER written as an edge. ---
  // The candidate's `targetLooksExternal` hint OR a target that does not resolve
  // to an in-model service/interface -> external-only. Because
  // `target_application_point_id` is a NOT NULL FK, we do NOT emit a null/fake
  // target; Group 3's `external_integration_dependency` Finding is the record.
  const targetName = (data.targetName || data.target) as string | undefined;
  const looksExternal = data.targetLooksExternal === true;
  const targetMatch =
    !looksExternal && typeof targetName === 'string'
      ? resolveApplicationPoint(model, targetName)
      : { pointId: null, confidence: 0, matchKind: 'none' as NameMatchKind };
  if (!targetMatch.pointId) {
    return {
      row: null,
      confidence: sourceConfidence,
      resolved: false,
      skippedReason: 'external_target',
    };
  }

  // Edge confidence: an explicit edge confidence on the candidate leads;
  // otherwise fold the source-resolution confidence with the candidate's own.
  const edgeConfidence: number =
    typeof data.confidence === 'number'
      ? data.confidence
      : typeof candidate.confidence === 'number'
        ? Math.min(candidate.confidence, sourceConfidence)
        : sourceConfidence;

  // AMS `data_movements` row -- MIXED wire shape (snake_case structural fields +
  // camelCase legacy fields), matching `DataMovementDto` / the `buildRelationships`
  // data_movements block EXACTLY. `movement_type` carries the integration kind.
  // The XOR `dataEntityPointId` / `interfaceWithSchemaId` are BOTH absent (null)
  // for an outbound dependency -- never fabricated.
  const row: any = {
    id: generateId('dm-'),
    source_application_point_id: sourcePointId,
    target_application_point_id: targetMatch.pointId,
    dataEntityPointId: null,
    interfaceWithSchemaId: null,
    biDirectional: false,
    movement_type: (data.movementType as string) || (data.movement_type as string) || '',
    description: (data.description as string) || '',
    tags: (data.tags as string) || '',
    valid_from: null,
    valid_to: null,
  };

  return { row, confidence: edgeConfidence, resolved: true, skippedReason: null };
}

// ============================================================================
// Model-Aware Discovery (2026-05-30, Task Group 4) -- deterministic helpers
//
// Dedup-against-existing, enrich-apply, and the logical<->physical link all run
// HERE, in CODE, zero tokens, REUSING the shared identity primitive
// (`matchByNormalizedName` / `resolveEntityPoint`; exact=1.0 / normalized=0.7 /
// none=0.0; the 0.75 gate). NOTHING below creates or mutates a `*_points`
// wrapper (they are backend-auto-managed); the link writes only the
// `logical_data_entity_physical_data_entities` MAPPING row, reusing the
// `dep_log_<id>` / `dep_phy_<id>` deterministic point ids for its endpoints.
// ============================================================================

/**
 * The data-entity layers a `logical_data_entity_physical_data_entities` mapping
 * row joins, kept DISTINCT per the meta-model (logical != physical, never 1:1).
 */
const LINK_LOGICAL_ARRAY_KEY = 'logical_data_entities';
const LINK_PHYSICAL_ARRAY_KEY = 'physical_data_entities';

/**
 * `findingType` / `category` tokens used by the save-back's Findings. Lowercase
 * (the AMS surface normalizes anyway) and stable so they dedupe cleanly.
 */
const FINDING_TYPE_ATTR_CONFLICT = 'attribute_conflict';
const FINDING_TYPE_TARGET_GONE = 'enrich_target_missing';
const FINDING_CATEGORY_MODEL_AWARE = 'model_aware_discovery';

/**
 * False-merge guard sentinel (Oracle Integrity & Determinism, Spec #3, Task
 * Group 5). Emitted when a NORMALIZED (non-exact) name match -- NOT a clean
 * EXACT match -- drives a relationship / enrich / link / request-response
 * binding. The `evidence_gap` finding-type + `possible_entity_collision`
 * `gapType` STRING mirror the single-source-of-truth registry entry that the
 * discovery-service batch (TG2-4) already registered in
 * `discovery-service/src/services/findings/emissionSources.ts`
 * (`buildPossibleEntityCollisionFinding`). discovery-service owns the
 * vocabulary; the MCP save-back guard is the EMISSION site, reached via the
 * SAME `archModelClient.bulkCreateDiscoveryFindings` route the existing
 * `enrich_target_missing` / `attribute_conflict` save-back findings use. The
 * gapType is passed as a STRING literal here (the `EvidenceGapType` union lives
 * in the other service) so the wire `detail_json.gapType` is byte-identical to
 * the discovery-side builder.
 */
const FINDING_TYPE_POSSIBLE_COLLISION = 'evidence_gap';
const FINDING_GAPTYPE_POSSIBLE_COLLISION = 'possible_entity_collision';
const FINDING_CATEGORY_AMBIGUITY = 'ambiguity';

/**
 * Build a `possible_entity_collision` Finding for a normalized (non-exact)
 * binding the false-merge guard refused to take silently. Reuses the existing
 * `DiscoveryFindingCreatePayload` shape (so it rides the same `saveBackFindings`
 * -> `bulkCreateDiscoveryFindings` path as the other save-back findings) and
 * reproduces the `detail_json` shape of the discovery-side
 * `buildPossibleEntityCollisionFinding` registry builder.
 *
 * The guard's CONSISTENT approach (Task Group 5.3): only EXACT (1.0) matches
 * bind silently; a NORMALIZED (0.7) match emits THIS finding and the binding is
 * LEFT UNSET (reviewable) -- never silently first-match-bound.
 */
function buildPossibleEntityCollisionPayload(args: {
  sourceName: string;
  matchedName: string;
  bindingKind: string;
  matchScore: number;
  candidateId?: string;
}): DiscoveryFindingCreatePayload {
  return {
    findingType: FINDING_TYPE_POSSIBLE_COLLISION,
    category: FINDING_CATEGORY_AMBIGUITY,
    severity: 'medium',
    title: `Possible entity collision: '${args.sourceName}' ~ '${args.matchedName}'`,
    summary:
      `A normalized (non-exact, score ${args.matchScore.toFixed(2)}) name match bound '${args.sourceName}' ` +
      `to existing entity '${args.matchedName}' during ${args.bindingKind} resolution. These may be ` +
      `DISTINCT entities (e.g. 'Order' vs 'Orders') -- review before accepting the binding.`,
    confidence: args.matchScore,
    detailJson: {
      gapType: FINDING_GAPTYPE_POSSIBLE_COLLISION,
      sourceName: args.sourceName,
      matchedName: args.matchedName,
      bindingKind: args.bindingKind,
      matchScore: args.matchScore,
      migrationConcern:
        'Only EXACT name matches bind silently. This normalized match folded case / separators / ' +
        'plural and may have conflated two distinct entities; accepting it could mis-merge the model.',
    },
    source: 'save-back',
    createdByStage: 'candidate-save-back.falseMergeGuard',
    links: args.candidateId
      ? [{ linkType: 'related_to', targetType: 'discovery_candidate', targetId: args.candidateId }]
      : [],
  };
}

/**
 * `evidence_gap` gapType + severity tokens for the durable Blocked /
 * Quality-gap findings (2026-06-20). These reuse the SAME `evidence_gap`
 * finding-type + the established gapType vocabulary the discovery-service
 * registry already uses, so the linked candidate findings dedupe + render
 * alongside the other evidence-gap findings. Mapped from the reason arm's
 * `missingField` (quality-gap) or the candidate type (blocked).
 */
const FINDING_TYPE_EVIDENCE_GAP = 'evidence_gap';
const FINDING_CATEGORY_EVIDENCE_GAP = 'evidence_gap';

/**
 * Choose the `evidence_gap` gapType STRING for a candidate gap finding. The
 * vocabulary mirrors the discovery-side registry: `interface_missing_contract_detail`,
 * `data_entity_missing_attributes`, `endpoint_missing_response_schema`,
 * `candidate_conflict`, `ambiguous_relationship`.
 */
function gapTypeForCandidateGap(kind: 'blocked' | 'quality_gap', candidateType: string, missingField?: string): string {
  if (kind === 'quality_gap') {
    if (missingField === 'interface_type') return 'interface_missing_contract_detail';
    if (missingField === 'attributes') return 'data_entity_missing_attributes';
    if (missingField === 'operation_verb' || missingField === 'path_or_address') return 'endpoint_missing_response_schema';
    return 'candidate_conflict';
  }
  // blocked: relationship / interface-link / data-effect blocks are ambiguous
  // references; everything else is a generic candidate conflict.
  if (
    candidateType.includes('relationship') ||
    candidateType.includes('interface_logical') ||
    candidateType.includes('endpoint_data_effects') ||
    candidateType.includes('data_movements')
  ) {
    return 'ambiguous_relationship';
  }
  return 'candidate_conflict';
}

/**
 * Build a durable linked {@link DiscoveryFindingCreatePayload} for a Blocked or
 * Quality-gap candidate (2026-06-20, Task Group 2). The finding is LINKED to the
 * candidate itself (`targetType: 'discovery_candidate'`) so the "what's wrong"
 * signal survives a page reload, and it rides the SAME saveBackFindings ->
 * `bulkCreateDiscoveryFindings` best-effort path the other save-back findings
 * use (so it is suppressed under the commit=false dry-run alongside them).
 */
function buildCandidateGapFinding(args: {
  kind: 'blocked' | 'quality_gap';
  candidateId: string;
  candidateType: string;
  candidateName: string;
  reasonText: string;
  missingField?: string;
}): DiscoveryFindingCreatePayload {
  const isBlocked = args.kind === 'blocked';
  const gapType = gapTypeForCandidateGap(args.kind, args.candidateType, args.missingField);
  return {
    findingType: FINDING_TYPE_EVIDENCE_GAP,
    category: FINDING_CATEGORY_EVIDENCE_GAP,
    severity: isBlocked ? 'medium' : 'low',
    title: isBlocked
      ? `Candidate "${args.candidateName}" was blocked from committing`
      : `Candidate "${args.candidateName}" committed with a quality gap`,
    summary: args.reasonText,
    detailJson: {
      gapType,
      candidateType: args.candidateType,
      missingField: args.missingField ?? null,
      outcome: isBlocked ? 'blocked' : 'quality_gap',
    },
    source: 'save-back',
    createdByStage: 'candidate-save-back.candidateGap',
    links: [
      { linkType: isBlocked ? 'blocked_candidate' : 'quality_gap_candidate', targetType: 'discovery_candidate', targetId: args.candidateId },
    ],
  };
}

/**
 * Guarded entity-point resolution for a binding side (the false-merge guard's
 * single primitive, Task Group 5.3). Resolves `name` to its data_entity_point
 * id THROUGH the shared {@link resolveEntityPoint} (the matcher itself is
 * UNCHANGED -- guarded IN PLACE, not replaced), then classifies the outcome so
 * the caller can treat EXACT and NORMALIZED matches differently:
 *   - `exact`      -> bind the returned `pointId` silently.
 *   - `normalized` -> `collision` populated; the caller emits the
 *                     `possible_entity_collision` finding and LEAVES THE BINDING
 *                     UNSET (reviewable) -- never silently first-match-bound.
 *   - `none`       -> `pointId` null (unresolved; existing behaviour).
 *
 * Pure read; never mints; never touches `*_points`.
 */
function resolveEntityPointForBinding(
  model: any,
  name: string,
  bindingKind: string,
  candidateId?: string,
): { pointId: string | null; matchKind: NameMatchKind; collision: DiscoveryFindingCreatePayload | null } {
  const m = resolveEntityPoint(model, name);
  if (m.matchKind === 'normalized' && m.pointId) {
    return {
      pointId: m.pointId,
      matchKind: 'normalized',
      collision: buildPossibleEntityCollisionPayload({
        sourceName: name,
        matchedName: m.matchedName ?? name,
        bindingKind,
        matchScore: m.confidence,
        candidateId,
      }),
    };
  }
  return { pointId: m.pointId, matchKind: m.matchKind, collision: null };
}

/**
 * Read the enrich/link target NAME(s) off a candidate's `data`, tolerating the
 * field-name variants the discovery emitter (Task Group 3) may use. For an
 * `enrich` candidate the single target entity is `targetEntityName` (falling
 * back to `logicalEntityName` / `entityName`). For a `link` candidate BOTH
 * `logicalEntityName` and `physicalEntityName` are read.
 */
function readEnrichTargetName(candidate: DiscoveryCandidateDto): string | undefined {
  const data = (candidate.data || {}) as Record<string, unknown>;
  const v =
    data.targetEntityName ||
    data.target_entity_name ||
    data.logicalEntityName ||
    data.entityName ||
    data.target;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Outcome of resolving an enrich/link target name against the live model via
 * the shared primitive. `kind === 'none'` means the target is GONE at save-back
 * (the model changed between run and approval) -> the caller raises a Finding.
 */
interface ResolvedEntity {
  entity: any | null;
  arrayKey: string | null;
  confidence: number;
  matchKind: NameMatchKind;
}

/**
 * Resolve an entity NAME to a concrete entity row (and the array it lives in)
 * across one or more candidate arrays, using {@link matchByNormalizedName} so
 * an exact match anywhere beats a normalized match elsewhere. Pure read -- it
 * NEVER mints, and it NEVER touches `*_points`.
 */
function resolveExistingEntity(
  model: any,
  name: string,
  arrayKeys: string[],
): ResolvedEntity {
  let best: ResolvedEntity = { entity: null, arrayKey: null, confidence: 0, matchKind: 'none' };
  for (const key of arrayKeys) {
    const arr: any[] = model?.metaModel?.entities?.[key] || [];
    const m = matchByNormalizedName(arr, name);
    if (m.matchKind === 'none' || !m.item) continue;
    // Exact anywhere wins outright; otherwise keep the highest-confidence hit.
    if (m.matchKind === 'exact') {
      return { entity: m.item, arrayKey: key, confidence: m.confidence, matchKind: m.matchKind };
    }
    if (m.confidence > best.confidence) {
      best = { entity: m.item, arrayKey: key, confidence: m.confidence, matchKind: m.matchKind };
    }
  }
  return best;
}

/**
 * Result of applying one `enrich` candidate's child attribute onto a resolved
 * existing entity. `applied` is the count of attributes ADDED (never
 * overwritten); `conflicts` carries any attribute whose value DIFFERS from an
 * already-present one (-> the caller raises a low-severity Finding, NEVER an
 * in-place overwrite).
 */
interface EnrichApplyResult {
  applied: number;
  conflicts: Array<{ attributeName: string; existingValue: unknown; incomingValue: unknown }>;
}

/**
 * Decide whether an incoming attribute value CONFLICTS with the existing one.
 * Absent / null / empty-string incoming is treated as "no opinion" (not a
 * conflict). Equal values (after trimming strings) are a no-op. A genuinely
 * different non-empty value is a conflict.
 */
function attributeValueConflicts(existing: unknown, incoming: unknown): boolean {
  if (incoming === undefined || incoming === null) return false;
  if (typeof incoming === 'string' && incoming.trim().length === 0) return false;
  if (existing === undefined || existing === null) return false;
  const a = typeof existing === 'string' ? existing.trim() : existing;
  const b = typeof incoming === 'string' ? incoming.trim() : incoming;
  return a !== b;
}

/**
 * Apply an `enrich` candidate of an ATTRIBUTE kind (logical/physical) onto the
 * resolved parent entity by ADDING a new child-attribute row to the model's
 * attribute array WITHOUT blanket-overwriting any field. If an attribute of the
 * same name already exists on that parent:
 *   - identical value  -> no-op (idempotent),
 *   - different value  -> NO overwrite; recorded as a conflict for a Finding.
 *
 * The attribute name is taken from the candidate's `data.attributeName` /
 * `data.name`, else the field-portion of a `Parent.field` candidate name. The
 * attribute value compared/added is `data.dataType` (the meta-model attribute
 * payload) -- the enrich machinery here is attribute-add; a value CHANGE is out
 * of scope (-> Finding, handled by the conflict path).
 */
function applyEnrichAttribute(
  model: any,
  candidate: DiscoveryCandidateDto,
  parentEntity: any,
  parentArrayKey: string,
): EnrichApplyResult {
  const data = (candidate.data || {}) as Record<string, any>;
  const result: EnrichApplyResult = { applied: 0, conflicts: [] };

  // logical_data_attributes -> logical_data_attributes array (FK logical_entity_id)
  // physical_data_attributes -> physical_data_attributes array (FK physical_entity_id)
  const isLogical = parentArrayKey === LINK_LOGICAL_ARRAY_KEY;
  const attrArrayKey = isLogical ? 'logical_data_attributes' : 'physical_data_attributes';
  const fkField = isLogical ? 'logical_entity_id' : 'physical_entity_id';

  // Derive the attribute name: explicit field on data, else the `field` portion
  // of a `Parent.field` candidate name, else the whole candidate name.
  let attrName: string | undefined =
    (typeof data.attributeName === 'string' && data.attributeName) ||
    (typeof data.name === 'string' && data.name) ||
    undefined;
  if (!attrName && typeof candidate.name === 'string') {
    const dotIdx = candidate.name.indexOf('.');
    attrName = dotIdx > 0 ? candidate.name.slice(dotIdx + 1) : candidate.name;
  }
  if (!attrName) return result;

  const incomingDataType = data.dataType ?? data.data_type ?? null;

  const entities = model.metaModel.entities;
  if (!Array.isArray(entities[attrArrayKey])) entities[attrArrayKey] = [];
  const attrArray: any[] = entities[attrArrayKey];

  const existingAttr = attrArray.find(
    (a: any) => a.name === attrName && a[fkField] === parentEntity.id,
  );

  if (existingAttr) {
    // Already present: NEVER overwrite. Equal -> no-op; different -> conflict.
    if (attributeValueConflicts(existingAttr.data_type, incomingDataType)) {
      result.conflicts.push({
        attributeName: attrName,
        existingValue: existingAttr.data_type,
        incomingValue: incomingDataType,
      });
    }
    return result;
  }

  // Add a brand-new child attribute onto the existing parent (an ADDITION, not
  // an overwrite of the parent entity's own fields).
  const attrEntity: any = {
    id: generateId(isLogical ? 'lda-' : 'pda-'),
    name: attrName,
    description: data.description || '',
    model_file_id: parentEntity.model_file_id,
    [fkField]: parentEntity.id,
    data_type: incomingDataType,
    is_primary_key: data.isPrimaryKey ?? data.is_primary_key ?? false,
    is_nullable: data.isNullable ?? data.is_nullable ?? true,
  };
  attrArray.push(attrEntity);
  result.applied = 1;
  return result;
}

/**
 * Build the AMS `logical_data_entity_physical_data_entities` mapping row for a
 * `link` candidate whose logical + physical NAMES have BOTH resolved EXACTLY.
 *
 * WIRE SHAPE NOTE: unlike `interface_logical_entities` / `endpoint_data_effects`
 * (which reference the auto-managed `data_entity_points` by their deterministic
 * `dep_log_<id>` / `dep_phy_<id>` ids), the AMS
 * `LogicalDataEntityPhysicalDataEntityDto` maps the two layers via the RAW
 * entity FKs `logical_entity_id` + `physical_entity_id` (both snake_case on the
 * wire, both `nullable=false`; `model_file_id` is injected server-side by the
 * entity mapper). So this row carries the resolved logical + physical entity
 * ids DIRECTLY -- no `dep_*` point id, and emphatically no `data_entity_point`
 * is ever created here (those stay backend auto-managed). The two endpoints
 * stay DISTINCT (logical on one side, physical on the other); this is NOT a
 * synthesized 1:1.
 */
function buildLogicalPhysicalLinkRow(
  logicalEntity: any,
  physicalEntity: any,
  _modelFileId: string,
  description: string,
): any {
  return {
    id: generateId('ldepe-'),
    // Raw entity FKs per LogicalDataEntityPhysicalDataEntityDto's explicit
    // snake_case @JsonProperty declarations. model_file_id is set server-side.
    logical_entity_id: logicalEntity.id,
    physical_entity_id: physicalEntity.id,
    description: description || '',
    tags: '',
    valid_from: null,
    valid_to: null,
  };
}

// ============================================================================
// createEmptyModelShell
// ============================================================================

/**
 * Creates an empty model shell with all entity and relationship arrays initialized
 * to empty arrays, used when no existing model is found (GET returned 404/null).
 *
 * Replicates the exact shape from anchorEntitiesService.ts.
 */
export function createEmptyModelShell(): any {
  return {
    metaModel: {
      entities: {
        business_users: [],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [],
        app_components: [],
        services: [],
        interfaces: [],
        endpoints: [],
        classes: [],
        methods: [],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
        data_entity_points: [],
        interactions: [],
        app_business_points: [],
        events: [],
        states: [],
        state_transitions: [],
        activities: [],
        activity_flows: [],
        activity_partitions: [],
        ui_screens: [],
        ui_contracts: [],
        ui_components: [],
        ui_actions: [],
        ui_characteristics: [],
        business_logics: [],
        package_sets: [],
        packages: [],
        package_set_default_rules: [],
      },
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
        ui_workflow_transitions: [],
        application_point_business_logics: [],
        // Endpoint->Data-Effect Call Graph (2026-05-29, Task Group 2).
        endpoint_data_effects: [],
      },
    },
    diagrams: [],
  };
}

// ============================================================================
// saveDiscoveryCandidatesToModel -- Orchestration Function
// ============================================================================

/**
 * Promotes discovery candidates into the canonical architecture meta-model
 * via a GET-merge-PUT pattern.
 *
 * Supports two eligibility modes:
 *
 * **Auto mode** (default, used by pipeline):
 * - Filters on confidence >= CANDIDATE_AUTO_ACCEPT_THRESHOLD
 * - Excludes candidates with status in EXCLUDED_STATUSES
 * - Excludes candidates with review_status in REVIEW_EXCLUDED_STATUSES ('rejected', 'deferred')
 *
 * **Manual mode** (used by "Save All Approved" action):
 * - Filters on review_status === 'approved' only
 * - Excludes candidates with status in EXCLUDED_STATUSES
 * - Excludes candidates with review_status === 'committed' (already saved back)
 * - Ignores confidence threshold entirely
 *
 * Idempotency guarantees (Increment 16):
 * - Before processing, fetches existing candidate-entity mappings for the run
 * - Candidates with an existing mapping are skipped (already saved back)
 * - After successful save-back, candidate review_status transitions to 'committed'
 * - Re-executing save-approved produces no duplicate canonical entities
 *
 * Orchestration flow:
 * 1. Validate project via archModelClient.getProjectById -- derive filename from project.name
 * 2. Fetch all candidates for the run via archModelClient.getCandidatesByRun
 * 3. Filter to eligible candidates based on mode
 * 4. Fetch existing candidate-entity mappings and exclude already-saved candidates
 * 5. If no eligible candidates, return early with zero counts
 * 6. GET existing model via archModelClient.getModel -- create empty shell if null
 * 7. Build depth map via buildDepthMap(eligibleCandidates)
 * 8. Sort candidates by ascending depth
 * 9. For each candidate in depth order:
 *    a. Check for existing entity with same name in target array (idempotent matching)
 *    b. If exists: skip, record ID, increment entitiesSkipped
 *    c. If not exists: convert, push to target array, record ID, increment entitiesCreated
 * 10. PUT updated model via archModelClient.putModel
 * 11. Update each promoted candidate's status to 'committed' and review_status to 'committed'
 * 12. Persist provenance mappings via archModelClient.bulkCreateCandidateEntityMappings
 * 13. Return SaveBackResult
 *
 * @param projectId - The project UUID
 * @param architectureId - The architecture UUID (required; threaded into every
 *   architecture-scoped archModelClient call so the save-back lands in the
 *   correct model_file row in multi-arch projects).
 * @param runId - The discovery run UUID
 * @param mode - Save-back mode: 'auto' (default) or 'manual'
 * @param commit - When `true` (default) the resolution is PERSISTED (model
 *   PUT, candidate `committed` transition, provenance mappings, findings).
 *   When `false` the SAME real ~25-branch resolution runs against the drafted
 *   model in memory and the would-commit / would-still-block projection (incl.
 *   the reason arm) is returned WITHOUT any persistence side-effect -- the
 *   server-side dry-run the C1 preview relies on (preview cannot drift from
 *   commit because it is the same code path).
 * @returns Promise resolving to the save-back result summary
 * @throws Error if project not found, model fetch fails, or entity conversion fails
 */
export async function saveDiscoveryCandidatesToModel(
  projectId: string,
  architectureId: string,
  runId: string,
  mode: SaveBackMode = 'auto',
  commit: boolean = true
): Promise<SaveBackResult> {
  // ===========================================================================
  // Step 1: Validate project and derive filename
  // ===========================================================================
  const project = await archModelClient.getProjectById(projectId);
  const filename = project.name;

  // ===========================================================================
  // Step 2: Fetch all candidates for the run
  // ===========================================================================
  const allCandidates = await archModelClient.getCandidatesByRun(projectId, architectureId, runId);

  // ===========================================================================
  // Step 3: Filter to eligible candidates based on mode
  // ===========================================================================
  let eligibleCandidates: DiscoveryCandidateDto[];

  if (mode === 'manual') {
    // Manual path: only approved candidates, ignore confidence threshold
    // Exclude candidates already in 'committed' review_status (idempotency gate)
    eligibleCandidates = allCandidates.filter(
      (c) =>
        c.review_status === 'approved' &&
        !EXCLUDED_STATUSES.includes(c.status)
    );
  } else {
    // Auto path: confidence threshold + status filter + review_status exclusion
    eligibleCandidates = allCandidates.filter(
      (c) =>
        c.confidence >= CANDIDATE_AUTO_ACCEPT_THRESHOLD &&
        !EXCLUDED_STATUSES.includes(c.status) &&
        !REVIEW_EXCLUDED_STATUSES.includes(c.review_status || '')
    );
  }

  // ===========================================================================
  // Step 3a: Below-auto-accept reviewable set (Oracle Integrity & Determinism,
  // Spec #3, Task Group 5.4). VERIFY-THEN-HARDEN: the auto filter above keeps
  // the 0.75 gate (no low-confidence model pollution), but a below-gate
  // candidate was otherwise SILENTLY DROPPED here -- never persisted-for-review,
  // never counted. Harden: record EVERY below-gate candidate as an explicit
  // "below auto-accept" reviewable item with a run-summary count, so a whole
  // Tier-C `llm-solo` run (every candidate scores 0.4) is visible rather than
  // vanishing. This is the CANDIDATE's own intrinsic confidence (distinct from
  // the NORMALIZED-name possible-duplicate path, which we do NOT duplicate). In
  // `manual` mode the gate is ignored, so no candidate is below-gate-dropped and
  // the set stays empty. We still exclude the hard-excluded statuses (rejected /
  // merged / committed) -- those are decisions, not low-confidence guesses.
  const belowGateCandidates: BelowGateCandidate[] =
    mode === 'auto'
      ? allCandidates
          .filter(
            (c) =>
              c.confidence < CANDIDATE_AUTO_ACCEPT_THRESHOLD &&
              !EXCLUDED_STATUSES.includes(c.status) &&
              !REVIEW_EXCLUDED_STATUSES.includes(c.review_status || ''),
          )
          .map((c) => ({
            candidateId: c.id,
            candidateName: c.name,
            candidateType: c.candidate_type,
            confidence: c.confidence,
            reviewStatus: 'below_auto_accept' as const,
          }))
      : [];
  if (belowGateCandidates.length > 0) {
    console.log(
      `[save-back] ${belowGateCandidates.length} candidate(s) below the ${CANDIDATE_AUTO_ACCEPT_THRESHOLD} ` +
        `auto-accept gate -- recorded as reviewable (below_auto_accept), NOT auto-applied.`,
    );
  }

  // ===========================================================================
  // Step 3b: Fetch existing mappings and exclude already-saved candidates
  // ===========================================================================
  let existingMappings: CandidateEntityMappingDto[] = [];
  try {
    existingMappings = await archModelClient.getCandidateEntityMappingsByRun(projectId, architectureId, runId);
  } catch (err) {
    // If fetching mappings fails, proceed without exclusion -- worst case is
    // the name-based idempotent matching in the model merge will catch duplicates
    console.warn(
      `[save-back] Failed to fetch existing mappings for run ${runId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // Build a set of candidate IDs that have already been saved back
  const alreadySavedCandidateIds = new Set(
    existingMappings.map((m) => m.candidate_id)
  );

  // Reason arm (2026-06-20): the already-saved candidates are filtered out
  // pre-loop and never re-enter the merge, so they were previously UNCOUNTED.
  // Capture them as explicit `reused` / `already-saved` reason entries so the
  // honest breakdown chip can distinguish them from intra-scan / pre-existing.
  const alreadySavedReasons: SaveBackReasonEntry[] = eligibleCandidates
    .filter((c) => alreadySavedCandidateIds.has(c.id))
    .map((c) => ({ ...baseReasonEntry(c), reason: 'reused' as const, reusedSubclass: 'already-saved' as const }));

  // Remove candidates that already have a mapping (previously saved back)
  eligibleCandidates = eligibleCandidates.filter(
    (c) => !alreadySavedCandidateIds.has(c.id)
  );

  // ===========================================================================
  // Step 4: Early return if no eligible candidates
  // ===========================================================================
  if (eligibleCandidates.length === 0) {
    return {
      projectId,
      runId,
      entitiesCreated: 0,
      entitiesSkipped: 0,
      candidatesCommitted: 0,
      // Model-Aware Discovery (2026-05-30): additive empty signals.
      entitiesSuppressed: 0,
      suppressedDuplicates: [],
      possibleDuplicates: [],
      belowGateCandidates,
      belowGateCount: belowGateCandidates.length,
      enrichmentsApplied: 0,
      linksCreated: 0,
      findingsEmitted: [],
      reasons: alreadySavedReasons,
    };
  }

  // ===========================================================================
  // Step 5: GET existing model (or create empty shell)
  // ===========================================================================
  let model = await archModelClient.getModel(projectId, architectureId, filename);
  if (!model) {
    model = createEmptyModelShell();
  }

  // Ensure structure exists
  if (!model.metaModel) {
    model.metaModel = createEmptyModelShell().metaModel;
  }
  if (!model.metaModel.entities) {
    model.metaModel.entities = createEmptyModelShell().metaModel.entities;
  }
  if (!model.metaModel.relationships) {
    model.metaModel.relationships = createEmptyModelShell().metaModel.relationships;
  }

  // ===========================================================================
  // Step 6: Build depth map
  // ===========================================================================
  const depthMap = buildDepthMap(eligibleCandidates);

  // ===========================================================================
  // Step 7: Sort candidates by ascending depth
  // ===========================================================================
  const sortedCandidates = [...eligibleCandidates].sort((a, b) => {
    const depthA = depthMap.get(a.id) ?? 0;
    const depthB = depthMap.get(b.id) ?? 0;
    return depthA - depthB;
  });
  // ===========================================================================
  // Step 7a: business_logics <class>.<method> qualification ON COLLISION
  // (2026-06-20). The save-back dedup (Pass 1, below) matches top-level
  // candidates by NORMALIZED bare name only, so a second same-named
  // business_logic from a DIFFERENT class (e.g. Order.process vs
  // Payment.process, both bare `process`) false-collapses into one -- silently
  // dropping a genuinely-distinct business logic. The discovery MERGE already
  // keeps these distinct (candidateIdentity.ts keys on className + methodName);
  // this re-applies that distinction at the save-back boundary.
  //
  // RULE (on-collision only): when a `business_logics` bare method name is
  // duplicated across DIFFERENT parent classes within this run, rewrite each
  // such candidate's `name` to `<className>.<methodName>` BEFORE the bare-name
  // dedup. normalizeNameForMatch strips `. _ - <ws>`, so `Order.process` ->
  // `orderprocess` stays distinct from `Payment.process` -> `paymentprocess`.
  // A same-name + same-class pair stays a genuine duplicate (both qualify to the
  // identical `<class>.<method>` and still collapse, as today). Candidates with
  // NO class context are left UNqualified (routed to the C1 fallback group +
  // surfaced as a finding/arm entry by Group 2) rather than guessed.
  {
    const BL_TYPES = new Set(['business_logics', 'business_logic']);
    const blByBareName = new Map<string, DiscoveryCandidateDto[]>();
    for (const c of sortedCandidates) {
      if (!BL_TYPES.has(c.candidate_type)) continue;
      const key = normalizeNameForMatch(c.name);
      if (!key) continue;
      const arr = blByBareName.get(key);
      if (arr) arr.push(c);
      else blByBareName.set(key, [c]);
    }
    for (const group of blByBareName.values()) {
      if (group.length < 2) continue;
      // Distinct NON-EMPTY classes present in this bare-name group.
      const distinctClasses = new Set(
        group
          .map((c) => readCandidateClassContext(c))
          .filter((cls) => cls.length > 0),
      );
      // Only a TRUE cross-class collision triggers qualification.
      if (distinctClasses.size < 2) continue;
      for (const c of group) {
        const cls = readCandidateClassContext(c);
        if (!cls) continue; // no class context -> leave for the C1 fallback group
        const qualified = `${cls}.${c.name}`;
        if (c.name !== qualified) {
          console.log(
            `[save-back] business_logics name-collision qualifier: "${c.name}" ` +
              `(${c.id}) -> "${qualified}" (bare method name duplicated across ` +
              `${distinctClasses.size} classes in this run)`,
          );
          c.name = qualified;
        }
      }
    }
  }

  // ===========================================================================
  // Step 8: Merge candidates into model (two-pass: entities first, then relationships)
  // ===========================================================================
  const candidateIdToEntityId: Record<string, string> = {};
  const candidateActions: Array<{ candidateId: string; entityId: string; entityType: string; action: 'created' | 'reused' }> = [];
  let entitiesCreated = 0;
  let entitiesSkipped = 0;

  // Collect entity-relationship candidates for second pass (need entities resolved first)
  const deferredRelationships: DiscoveryCandidateDto[] = [];
  // Bug fix (2026-04-21): `interface_logical_entities` candidates emitted by
  // the V3 pack carry `{ interfaceClassName, logicalEntityName }` — NOT the
  // resolved `interface_id` / `dataEntityPointId` the backend DTO requires.
  // They must be deferred until Pass 2 so both the interface and logical /
  // physical entities they reference have already been minted. Without this
  // deferral the relationship rows hit the DB with null FK columns and the
  // PUT /api/model fails with a 500 (masked to 502 by the MCP error handler).
  const deferredInterfaceLogicalEntities: DiscoveryCandidateDto[] = [];
  // Endpoint->Data-Effect Call Graph (2026-05-29, Task Group 2): like
  // `interface_logical_entities`, edge candidates carry endpoint/entity NAMES
  // (or pre-resolved ids) and must be deferred to a pass that has the full
  // model so both sides can resolve through the shared normalized-name matcher.
  const deferredEndpointDataEffects: DiscoveryCandidateDto[] = [];
  // Outbound Integration Graph (2026-05-30, Task Group 5): `data_movements`
  // edge candidates carry the source service/interface NAME + resolved target
  // NAME and must be deferred to a pass that has the full model so both sides
  // resolve to `application_point`s (`ap_{serviceId}`) through the shared matcher.
  const deferredDataMovements: DiscoveryCandidateDto[] = [];

  // ---------------------------------------------------------------------------
  // Model-Aware Discovery (2026-05-30, Task Group 4) collectors.
  //
  // `enrich` / `link` candidates resolve their target NAME(s) LATE (deferred
  // passes 2.7 / 2.8), exactly like the relationship deferred passes above.
  // Dedup-against-existing + conflict/target-gone findings are recorded here so
  // the run summary surfaces every suppression and NOTHING is silently dropped.
  // ---------------------------------------------------------------------------
  const deferredEnrich: DiscoveryCandidateDto[] = [];
  const deferredLink: DiscoveryCandidateDto[] = [];
  const suppressedDuplicates: SuppressedDuplicate[] = [];
  const possibleDuplicates: PossibleDuplicate[] = [];
  const saveBackFindings: DiscoveryFindingCreatePayload[] = [];
  // Reason arm collectors (2026-06-20). `reasons` accumulates the per-candidate
  // outcome (created / reused+subclass / blocked / quality_gap). blocked +
  // quality-gap are collected with their prose reason FIRST (so Group 2 can emit
  // a durable linked finding for each) and then folded into `reasons`.
  const reasons: SaveBackReasonEntry[] = [...alreadySavedReasons];
  // Internal: a reason entry plus the human prose used for the linked finding
  // summary (the public arm only carries the CLASS + missingField).
  type DetailedReason = { entry: SaveBackReasonEntry; reasonText: string; alreadyHasFinding?: boolean };
  const blockedReasons: DetailedReason[] = [];
  const qualityGapReasons: DetailedReason[] = [];
  /** Record a BLOCKED candidate (did NOT commit) on the reason arm. */
  const recordBlocked = (
    candidate: DiscoveryCandidateDto,
    reasonText: string,
    missingField?: string,
    alreadyHasFinding?: boolean,
  ): void => {
    blockedReasons.push({
      entry: { ...baseReasonEntry(candidate), reason: 'blocked', missingField },
      reasonText,
      alreadyHasFinding,
    });
  };
  let enrichmentsApplied = 0;
  let linksCreated = 0;

  // Snapshot the names of entities that ALREADY EXISTED in the loaded model,
  // per target array, BEFORE Pass 1 mints anything. Dedup-against-existing must
  // only match against PRE-EXISTING entities -- never against an entity minted
  // earlier in THIS same run (two genuinely-distinct new creates in one run must
  // not suppress each other). Top-level entity types only (the ones a `create`
  // candidate mints as a root row); child types resolve by parent FK already.
  const preExistingNamesByArray: Record<string, Set<string>> = {};
  {
    const ents = model.metaModel?.entities || {};
    for (const cfg of Object.values(CANDIDATE_TYPE_CONFIG)) {
      if (cfg.targetSection !== 'entities' || cfg.parentFkField !== null) continue;
      const key = cfg.targetArrayKey;
      if (preExistingNamesByArray[key]) continue;
      const arr: any[] = ents[key] || [];
      preExistingNamesByArray[key] = new Set(
        arr.map((e: any) => (typeof e?.name === 'string' ? e.name : '')).filter((n) => n.length > 0),
      );
    }
  }

  // --- Pass 1: All entity types (non-relationship) ---
  for (const candidate of sortedCandidates) {
    if (
      candidate.candidate_type === 'logical_data_entity_relationships' ||
      // Backwards-compat alias (2026-04-21): pre-rename runs use the
      // V2-style singular `entity_relationship` type name.
      candidate.candidate_type === 'entity_relationship'
    ) {
      deferredRelationships.push(candidate);
      continue;
    }
    if (candidate.candidate_type === 'interface_logical_entities') {
      deferredInterfaceLogicalEntities.push(candidate);
      continue;
    }
    if (candidate.candidate_type === 'endpoint_data_effects') {
      deferredEndpointDataEffects.push(candidate);
      continue;
    }
    if (candidate.candidate_type === 'data_movements') {
      deferredDataMovements.push(candidate);
      continue;
    }

    // Model-Aware Discovery (2026-05-30): `enrich` / `link` candidates reference
    // EXISTING entities BY NAME and are resolved LATE (after Pass 1 mints), so
    // defer them to passes 2.7 / 2.8. They are NEVER minted as new entities here.
    if (candidate.operation === 'enrich') {
      deferredEnrich.push(candidate);
      continue;
    }
    if (candidate.operation === 'link') {
      deferredLink.push(candidate);
      continue;
    }

    const config = CANDIDATE_TYPE_CONFIG[candidate.candidate_type];
    if (!config) {
      console.warn(
        `[save-back] Skipping candidate "${candidate.name}" (${candidate.id}): unknown type "${candidate.candidate_type}"`
      );
      recordBlocked(candidate, `Unknown candidate type "${candidate.candidate_type}"`, 'candidate_type');
      entitiesSkipped++;
      continue;
    }

    // Resolve parent FK for child candidates
    if (config.parentFkField) {
      const candidateData = candidate.data || {};
      // Fallback: service-scoped discovery populates data[parentFkField] (e.g., data.service_id)
      // directly with the model entity ID, even when parent_candidate_id is null
      const directFkValue = candidateData[config.parentFkField] as string | undefined;

      if (candidate.parent_candidate_id) {
        if (!candidateIdToEntityId[candidate.parent_candidate_id]) {
          if (directFkValue) {
            // Parent candidate not resolved, but we have a direct FK from the data
            candidateIdToEntityId[candidate.parent_candidate_id] = directFkValue;
          } else {
            console.warn(
              `[save-back] Skipping candidate "${candidate.name}" (${candidate.id}): ` +
              `parent "${candidate.parent_candidate_id}" not resolved to entity ID`
            );
            recordBlocked(candidate, `Parent "${candidate.parent_candidate_id}" not resolved to an entity id`, config.parentFkField ?? 'parent');
            entitiesSkipped++;
            continue;
          }
        }
      } else if (directFkValue) {
        // No parent_candidate_id, but direct FK value available — use a synthetic key
        const syntheticParentKey = `__direct_fk__${candidate.id}`;
        candidate.parent_candidate_id = syntheticParentKey;
        candidateIdToEntityId[syntheticParentKey] = directFkValue;
      } else {
        // Bug fix (2026-04-21): LLM-emitted attribute candidates often carry
        // `Parent.field` in their name without a `parent_candidate_id` (the
        // LLM doesn't know candidate UUIDs). Parse the name, look up the
        // parent entity already merged into the model, and attach via a
        // synthetic key — same mechanism as `directFkValue` above.
        let resolvedParent = false;
        if (
          candidate.candidate_type === 'logical_data_attributes' ||
          candidate.candidate_type === 'physical_data_attributes'
        ) {
          const dotIdx = candidate.name.indexOf('.');
          if (dotIdx > 0) {
            const parentName = candidate.name.slice(0, dotIdx);
            const fieldName = candidate.name.slice(dotIdx + 1);
            const parentArrayKey = candidate.candidate_type === 'logical_data_attributes'
              ? 'logical_data_entities'
              : 'physical_data_entities';
            const parentArr: any[] = model.metaModel.entities[parentArrayKey] || [];
            const parentEntity = parentArr.find((e: any) => e.name === parentName);
            if (parentEntity) {
              const syntheticParentKey = `__name_parse_fk__${candidate.id}`;
              candidate.parent_candidate_id = syntheticParentKey;
              candidateIdToEntityId[syntheticParentKey] = parentEntity.id;
              // Rewrite the candidate name to just the field portion so
              // downstream name-based idempotent matching compares correctly
              // against other attributes on the same parent.
              candidate.name = fieldName;
              resolvedParent = true;
            }
          }
        }
        // Internal entry-point rescue (Spec 2026-07-23): scheduled / listener
        // / batch endpoint candidates have no controller class, hence no
        // parent interface candidate — they arrived here as orphans and were
        // skipped WHOLESALE, which is why the committed model never carried
        // internal entry points and the migration plan's "re-scan and commit"
        // advice was a dead end. Parent them onto the synthesized
        // "Internal Processing" interface instead (subtype presence on
        // `data.endpoint_subtype` is the marker — only internal emissions set
        // it). Falls through to the honest orphan-block when the model has no
        // service to parent the interface onto.
        if (!resolvedParent && candidate.candidate_type === 'endpoints') {
          const subtype = (candidate.data as Record<string, unknown> | undefined)
            ?.endpoint_subtype;
          // Outbound-call subtypes are NOT entry points — an orphaned
          // outbound candidate stays honestly blocked.
          if (
            typeof subtype === 'string' &&
            subtype.trim().length > 0 &&
            !subtype.trim().toLowerCase().startsWith('outbound')
          ) {
            const internalIface = findOrCreateInternalProcessingInterface(
              model,
              filename
            );
            if (internalIface) {
              const syntheticParentKey = `__internal_iface_fk__${candidate.id}`;
              candidate.parent_candidate_id = syntheticParentKey;
              candidateIdToEntityId[syntheticParentKey] = internalIface.id;
              resolvedParent = true;
            }
          }
        }
        if (!resolvedParent) {
          console.warn(
            `[save-back] Skipping orphan candidate "${candidate.name}" (${candidate.id}): ` +
            `type "${candidate.candidate_type}" requires parent FK "${config.parentFkField}" but has no parent_candidate_id or data.${config.parentFkField}`
          );
          recordBlocked(candidate, `Orphan: requires parent FK "${config.parentFkField}" but none was provided`, config.parentFkField ?? 'parent');
          entitiesSkipped++;
          continue;
        }
      }
    }

    const targetArrayKey = config.targetArrayKey;
    const section = model.metaModel[config.targetSection];

    // Ensure target array exists in the correct section (entities or relationships)
    if (!Array.isArray(section[targetArrayKey])) {
      section[targetArrayKey] = [];
    }

    const targetArray: any[] = section[targetArrayKey];

    // -----------------------------------------------------------------------
    // Model-Aware Discovery (2026-05-30, Task Group 4): dedup-against-existing.
    //
    // For a top-level `create` candidate (no parent FK), match its name against
    // the entities that ALREADY EXISTED in the loaded model (the pre-Pass-1
    // snapshot) THROUGH the shared identity primitive:
    //   - EXACT (1.0) vs a pre-existing entity -> AUTO-SUPPRESS: do NOT mint a
    //     second entity, do NOT commit; record the (visible, counted)
    //     suppression for the run summary (4.6). No silent drop.
    //   - NORMALIZED (0.7) vs a pre-existing entity -> a reviewable
    //     low-confidence "possible duplicate": NOT auto-suppressed and NOT
    //     auto-created (below the 0.75 gate); recorded + surfaced for review.
    //   - NONE -> fall through to the normal create / idempotent-reuse path.
    // Child entity types resolve via their parent FK already and are out of
    // scope for cross-run dedup here.
    if (!config.parentFkField) {
      const preExistingNames = preExistingNamesByArray[targetArrayKey];
      if (preExistingNames && preExistingNames.size > 0) {
        // Restrict the match list to PRE-EXISTING rows so an entity minted
        // earlier in this same run can never trigger a suppression.
        const preExistingRows = targetArray.filter(
          (e: any) => typeof e?.name === 'string' && preExistingNames.has(e.name),
        );
        const dupMatch = matchByNormalizedName(preExistingRows, candidate.name);
        if (dupMatch.matchKind === 'exact' && dupMatch.item) {
          suppressedDuplicates.push({
            candidateId: candidate.id,
            candidateName: candidate.name,
            entityType: targetArrayKey,
            existingEntityId: dupMatch.item.id,
          });
          // Record the mapping so child create candidates whose
          // parent_candidate_id points at this suppressed parent resolve
          // their parent FK to the EXISTING entity instead of being dropped
          // by the orphan guard (spec line ~89: a new child under an
          // existing parent attaches to the existing entity).
          candidateIdToEntityId[candidate.id] = dupMatch.item.id;
          console.log(
            `[save-back] Model-aware dedup: SUPPRESSED re-discovered "${candidate.name}" ` +
              `(${candidate.id}) as an exact duplicate of existing ${targetArrayKey} ${dupMatch.item.id}`,
          );
          continue;
        }
        if (dupMatch.matchKind === 'normalized' && dupMatch.item) {
          possibleDuplicates.push({
            candidateId: candidate.id,
            candidateName: candidate.name,
            entityType: targetArrayKey,
            existingEntityId: dupMatch.item.id,
            confidence: dupMatch.confidence,
          });
          console.log(
            `[save-back] Model-aware dedup: "${candidate.name}" (${candidate.id}) is a ` +
              `possible duplicate (normalized, confidence ${dupMatch.confidence}) of existing ` +
              `${targetArrayKey} ${dupMatch.item.id} -- left as a reviewable candidate (not auto-applied)`,
          );
          continue;
        }
      }
    }

    // Bug fix (2026-04-21): idempotent match must include the parent FK for
    // child entity types, otherwise cross-parent name collisions (e.g. `id`
    // / `createdAt` attributes on multiple entities) all reuse the first
    // row found, silently dropping ~200 attributes per save on typical
    // projects. Top-level entity types (no parentFkField) still match by
    // name alone.
    const candidateParentEntityId: string | null =
      config.parentFkField && candidate.parent_candidate_id
        ? candidateIdToEntityId[candidate.parent_candidate_id] ?? null
        : null;
    const existingEntity = targetArray.find((e: any) => {
      if (e.name !== candidate.name) return false;
      if (!config.parentFkField) return true;
      return e[config.parentFkField] === candidateParentEntityId;
    });

    if (existingEntity) {
      // Skip creation, record existing entity ID for downstream parent resolution
      candidateIdToEntityId[candidate.id] = existingEntity.id;
      candidateActions.push({
        candidateId: candidate.id,
        entityId: existingEntity.id,
        entityType: targetArrayKey,
        action: 'reused',
      });
      // Reason arm (2026-06-20): classify the reuse. The matched row in
      // `targetArray` either EXISTED before this save (pre-existing, in the
      // preExistingNamesByArray snapshot) or was minted by an EARLIER
      // candidate in THIS save (intra-scan duplicate). already-saved is
      // handled pre-loop (alreadySavedReasons).
      {
        const preExistingNamesForArray = preExistingNamesByArray[targetArrayKey];
        const isPreExisting =
          !config.parentFkField &&
          !!preExistingNamesForArray &&
          typeof existingEntity.name === 'string' &&
          preExistingNamesForArray.has(existingEntity.name);
        reasons.push({
          ...baseReasonEntry(candidate),
          reason: 'reused',
          reusedSubclass: isPreExisting ? 'pre-existing' : 'intra-scan',
        });
      }
      entitiesSkipped++;
    } else {
      // Convert candidate to entity and push to target array
      const entity = convertCandidateToEntity(
        candidate,
        filename,
        candidateIdToEntityId,
        eligibleCandidates,
      );
      targetArray.push(entity);
      candidateIdToEntityId[candidate.id] = entity.id;
      candidateActions.push({
        candidateId: candidate.id,
        entityId: entity.id,
        entityType: targetArrayKey,
        action: 'created',
      });
      reasons.push({ ...baseReasonEntry(candidate), reason: 'created' });
      entitiesCreated++;
    }
  }

  // --- Pass 1b: Resolve endpoint request/response body refs to data_entity_point IDs ---
  // Endpoint candidates carry metadata.requestBodyType / responseType (DTO entity names).
  // After all entities are merged, look up those names in logical/physical data entities
  // and populate request_data_entity_point_id / response_data_entity_point_id on the endpoint
  // entities we just created. Fallback also accepts returnType / unwrappedReturnType from the
  // static Java extractor.
  const endpointActions = candidateActions.filter(
    (a) => a.action === 'created' && a.entityType === 'endpoints'
  );
  if (endpointActions.length > 0) {
    const endpointsArr: any[] = model.metaModel.entities.endpoints || [];
    for (const action of endpointActions) {
      const endpointEntity = endpointsArr.find((e: any) => e.id === action.entityId);
      if (!endpointEntity) continue;

      const candidate = sortedCandidates.find((c) => c.id === action.candidateId);
      const cdata = (candidate?.data || {}) as Record<string, unknown>;
      const requestName = (cdata.requestBodyType || cdata.requestDtoName || cdata.requestEntity) as string | undefined;
      const responseName = (cdata.responseType || cdata.unwrappedReturnType || cdata.returnType || cdata.responseDtoName || cdata.responseEntity) as string | undefined;

      if (requestName) {
        const r = resolveEntityPointForBinding(
          model,
          requestName,
          'request-response (request body)',
          candidate?.id,
        );
        if (r.matchKind === 'exact' && r.pointId) {
          endpointEntity.request_data_entity_point_id = r.pointId;
        } else if (r.collision) {
          // NORMALIZED (non-exact): do NOT silently bind. Emit the collision
          // finding and leave the binding unset (reviewable).
          saveBackFindings.push(r.collision);
          console.warn(
            `[save-back] Endpoint "${candidate?.name}" (${action.entityId}): request body ` +
            `entity "${requestName}" matched only by normalization -- left unset (possible collision finding raised)`,
          );
        } else {
          console.warn(
            `[save-back] Endpoint "${candidate?.name}" (${action.entityId}): ` +
            `request body entity "${requestName}" not found in model — request body left unset`
          );
        }
      }

      if (responseName) {
        // Strip array brackets for lookup ("UserDto[]" → "UserDto")
        const normalizedResp = responseName.replace(/\[\]$/, '').trim();
        const r = resolveEntityPointForBinding(
          model,
          normalizedResp,
          'request-response (response body)',
          candidate?.id,
        );
        if (r.matchKind === 'exact' && r.pointId) {
          endpointEntity.response_data_entity_point_id = r.pointId;
        } else if (r.collision) {
          saveBackFindings.push(r.collision);
          console.warn(
            `[save-back] Endpoint "${candidate?.name}" (${action.entityId}): response body ` +
            `entity "${responseName}" matched only by normalization -- left unset (possible collision finding raised)`,
          );
        } else {
          console.warn(
            `[save-back] Endpoint "${candidate?.name}" (${action.entityId}): ` +
            `response body entity "${responseName}" not found in model — response body left unset`
          );
        }
      }
    }
  }

  // --- Pass 2: Entity relationships (resolve entity names → data_entity_point IDs) ---
  if (deferredRelationships.length > 0) {
    const relArrayKey = 'logical_data_entity_relationships';
    if (!Array.isArray(model.metaModel.relationships[relArrayKey])) {
      model.metaModel.relationships[relArrayKey] = [];
    }
    const relArray: any[] = model.metaModel.relationships[relArrayKey];

    for (const candidate of deferredRelationships) {
      const data = candidate.data || {};
      let sourceName = data.sourceEntity as string | undefined;
      let targetName = data.targetEntity as string | undefined;

      // Bug fix (2026-04-21): LLM-emitted relationship candidates often only
      // populate the name (formatted "Source → Target") and omit the
      // structured `sourceEntity` / `targetEntity` fields. Fall back to
      // parsing the name before giving up.
      if ((!sourceName || !targetName) && typeof candidate.name === 'string') {
        const arrowMatch = candidate.name.split(/\s*(?:→|->|-->)\s*/);
        if (arrowMatch.length === 2) {
          if (!sourceName) sourceName = arrowMatch[0].trim();
          if (!targetName) targetName = arrowMatch[1].trim();
        }
      }

      if (!sourceName || !targetName) {
        console.warn(
          `[save-back] Skipping logical_data_entity_relationships "${candidate.name}" (${candidate.id}): ` +
          `missing sourceEntity or targetEntity in candidate data`
        );
        recordBlocked(candidate, 'Relationship is missing its source/target entity', 'sourceEntity');
        entitiesSkipped++;
        continue;
      }

      const sourceRes = resolveEntityPointForBinding(
        model, sourceName, 'relationship (source)', candidate.id,
      );
      const targetRes = resolveEntityPointForBinding(
        model, targetName, 'relationship (target)', candidate.id,
      );

      if (!sourceRes.pointId) {
        console.warn(
          `[save-back] Skipping logical_data_entity_relationships "${candidate.name}" (${candidate.id}): ` +
          `source entity "${sourceName}" not found in model`
        );
        recordBlocked(candidate, `Source entity "${sourceName}" not found in model`, 'sourceEntity');
        entitiesSkipped++;
        continue;
      }
      if (!targetRes.pointId) {
        console.warn(
          `[save-back] Skipping logical_data_entity_relationships "${candidate.name}" (${candidate.id}): ` +
          `target entity "${targetName}" not found in model`
        );
        recordBlocked(candidate, `Target entity "${targetName}" not found in model`, 'targetEntity');
        entitiesSkipped++;
        continue;
      }
      // False-merge guard: a NORMALIZED match on EITHER side must NOT silently
      // bind the relationship. Emit the collision finding(s) and leave the
      // relationship as a reviewable candidate (no row written).
      if (sourceRes.matchKind === 'normalized' || targetRes.matchKind === 'normalized') {
        if (sourceRes.collision) saveBackFindings.push(sourceRes.collision);
        if (targetRes.collision) saveBackFindings.push(targetRes.collision);
        console.warn(
          `[save-back] logical_data_entity_relationships "${candidate.name}" (${candidate.id}): ` +
          `"${sourceName}"->"${targetName}" resolved only by normalization -- left as a reviewable ` +
          `candidate (no relationship written; possible collision finding(s) raised)`,
        );
        recordBlocked(candidate, `Relationship resolved only by normalization ("${sourceName}"->"${targetName}") -- left for review`, 'sourceEntity');
        entitiesSkipped++;
        continue;
      }
      const sourcePointId = sourceRes.pointId;
      const targetPointId = targetRes.pointId;

      // Check for existing relationship with same endpoints (idempotent matching)
      // DTO serializes fromDataEntityPointId/toDataEntityPointId as camelCase JSON.
      const existingRel = relArray.find(
        (r: any) => r.fromDataEntityPointId === sourcePointId && r.toDataEntityPointId === targetPointId
      );

      if (existingRel) {
        candidateIdToEntityId[candidate.id] = existingRel.id;
        candidateActions.push({
          candidateId: candidate.id,
          entityId: existingRel.id,
          entityType: relArrayKey,
          action: 'reused',
        });
        entitiesSkipped++;
      } else {
        const relId = generateId('ler-');
        // DTO field names: fromDataEntityPointId/toDataEntityPointId are camelCase;
        // validFrom/validTo serialize as valid_from/valid_to via @JsonProperty.
        const rel: any = {
          id: relId,
          fromDataEntityPointId: sourcePointId,
          toDataEntityPointId: targetPointId,
          cardinality: mapCardinality(data.cardinality),
          relationship: mapRelationshipType(data.relationshipType),
          description: data.description || '',
          tags: '',
          valid_from: null,
          valid_to: null,
        };
        relArray.push(rel);
        candidateIdToEntityId[candidate.id] = relId;
        candidateActions.push({
          candidateId: candidate.id,
          entityId: relId,
          entityType: relArrayKey,
          action: 'created',
        });
        entitiesCreated++;
      }
    }
  }

  // --- Pass 2.5: Interface → Logical/Physical Entity relationships ---
  // Bug fix (2026-04-21): resolve `interfaceClassName` → interface.id and
  // `logicalEntityName` → `dep_log_<id>` / `dep_phy_<id>` via the
  // `data_entity_points` convention. Without this, the relationship rows
  // were being written with null FK columns and the PUT /api/model call
  // would reject the model with a 500 → MCP masked to 502.
  if (deferredInterfaceLogicalEntities.length > 0) {
    const ileArrayKey = 'interface_logical_entities';
    if (!Array.isArray(model.metaModel.relationships[ileArrayKey])) {
      model.metaModel.relationships[ileArrayKey] = [];
    }
    const ileArray: any[] = model.metaModel.relationships[ileArrayKey];
    const interfacesArr: any[] = model.metaModel.entities?.interfaces || [];

    for (const candidate of deferredInterfaceLogicalEntities) {
      const data = candidate.data || {};
      const interfaceName = (data.interfaceClassName || data.interfaceName) as string | undefined;
      const entityName = (data.logicalEntityName || data.physicalEntityName || data.entityName) as string | undefined;

      if (!interfaceName || !entityName) {
        console.warn(
          `[save-back] Skipping interface_logical_entities "${candidate.name}" (${candidate.id}): ` +
          `missing interfaceClassName or logicalEntityName in candidate data`
        );
        recordBlocked(candidate, 'Interface-logical-entity link is missing its interface or entity name', 'interfaceClassName');
        entitiesSkipped++;
        continue;
      }

      const ifaceEntity = interfacesArr.find((i: any) => i.name === interfaceName);
      if (!ifaceEntity) {
        console.warn(
          `[save-back] Skipping interface_logical_entities "${candidate.name}" (${candidate.id}): ` +
          `interface "${interfaceName}" not found in model`
        );
        recordBlocked(candidate, `Interface "${interfaceName}" not found in model`, 'interfaceClassName');
        entitiesSkipped++;
        continue;
      }
      const entRes = resolveEntityPointForBinding(
        model, entityName, 'interface_logical_entities', candidate.id,
      );
      if (!entRes.pointId) {
        console.warn(
          `[save-back] Skipping interface_logical_entities "${candidate.name}" (${candidate.id}): ` +
          `data entity "${entityName}" not found in model`
        );
        recordBlocked(candidate, `Data entity "${entityName}" not found in model`, 'logicalEntityName');
        entitiesSkipped++;
        continue;
      }
      // False-merge guard: a NORMALIZED data-entity match must NOT silently bind.
      if (entRes.matchKind === 'normalized') {
        if (entRes.collision) saveBackFindings.push(entRes.collision);
        console.warn(
          `[save-back] interface_logical_entities "${candidate.name}" (${candidate.id}): data entity ` +
          `"${entityName}" matched only by normalization -- left as a reviewable candidate ` +
          `(no relationship written; possible collision finding raised)`,
        );
        recordBlocked(candidate, `Data entity "${entityName}" resolved only by normalization -- left for review`, 'logicalEntityName');
        entitiesSkipped++;
        continue;
      }
      const dataEntityPointId = entRes.pointId;

      // Idempotent match: same (interface_id, dataEntityPointId) pair.
      const existingRel = ileArray.find(
        (r: any) => r.interface_id === ifaceEntity.id && r.dataEntityPointId === dataEntityPointId
      );
      if (existingRel) {
        candidateIdToEntityId[candidate.id] = existingRel.id;
        candidateActions.push({
          candidateId: candidate.id,
          entityId: existingRel.id,
          entityType: ileArrayKey,
          action: 'reused',
        });
        entitiesSkipped++;
      } else {
        const ileId = generateId('ile-');
        const rel: any = {
          id: ileId,
          interface_id: ifaceEntity.id,
          dataEntityPointId,
          description: (data.description as string) || '',
          tags: '',
          valid_from: null,
          valid_to: null,
        };
        ileArray.push(rel);
        candidateIdToEntityId[candidate.id] = ileId;
        candidateActions.push({
          candidateId: candidate.id,
          entityId: ileId,
          entityType: ileArrayKey,
          action: 'created',
        });
        entitiesCreated++;
      }
    }
  }

  // --- Pass 2.6: Endpoint -> Data-Effect edges ---
  // Endpoint->Data-Effect Call Graph (2026-05-29, Task Group 2). Each edge
  // candidate resolves its endpoint side and its data-entity-point side THROUGH
  // the shared normalized-name primitive (so `Owner`/`owners` collapse to one
  // point id), then lands as an AMS `endpoint_data_effects` relationship row.
  // No new candidate state: an edge whose sides cannot both be resolved here is
  // skipped (discovery emits the unresolved-chain finding upstream); a resolved
  // edge is written regardless of confidence and carries its (possibly LOW)
  // confidence on the row, mirroring the three-outcome model.
  if (deferredEndpointDataEffects.length > 0) {
    const edeArrayKey = 'endpoint_data_effects';
    if (!Array.isArray(model.metaModel.relationships[edeArrayKey])) {
      model.metaModel.relationships[edeArrayKey] = [];
    }
    const edeArray: any[] = model.metaModel.relationships[edeArrayKey];

    for (const candidate of deferredEndpointDataEffects) {
      const conversion = convertEndpointDataEffectToRow(candidate, model, filename);
      if (!conversion.resolved || !conversion.row) {
        console.warn(
          `[save-back] Skipping endpoint_data_effects "${candidate.name}" (${candidate.id}): ` +
          `could not resolve ${conversion.unresolvedSide} side to a model id`
        );
        recordBlocked(candidate, `Endpoint data-effect: could not resolve its ${conversion.unresolvedSide} side to a model id`, conversion.unresolvedSide ? `${conversion.unresolvedSide}` : 'endpoint');
        entitiesSkipped++;
        continue;
      }

      // Idempotent match: same (endpoint_id, data_entity_point_id) pair.
      const existingRel = edeArray.find(
        (r: any) =>
          r.endpoint_id === conversion.row.endpoint_id &&
          r.data_entity_point_id === conversion.row.data_entity_point_id
      );
      if (existingRel) {
        candidateIdToEntityId[candidate.id] = existingRel.id;
        candidateActions.push({
          candidateId: candidate.id,
          entityId: existingRel.id,
          entityType: edeArrayKey,
          action: 'reused',
        });
        entitiesSkipped++;
      } else {
        edeArray.push(conversion.row);
        candidateIdToEntityId[candidate.id] = conversion.row.id;
        candidateActions.push({
          candidateId: candidate.id,
          entityId: conversion.row.id,
          entityType: edeArrayKey,
          action: 'created',
        });
        entitiesCreated++;
      }
    }
  }

  // --- Pass 2.6b: Outbound `data_movements` edges ---
  // Outbound Integration Graph for Discovery (2026-05-30, Task Group 5). Each
  // outbound edge candidate resolves its SOURCE service/interface NAME to an
  // `application_point` (`ap_{serviceId}`) THROUGH the shared normalized-name
  // primitive, and its TARGET to an in-model `application_point` when modellable.
  // SKIP-not-fabricate: a candidate whose SOURCE cannot be resolved is skipped
  // (logged) -- never written. A PURELY-EXTERNAL target is ALSO skipped here
  // (AMS `target_application_point_id` is a NOT NULL FK; the dependency is
  // recorded by Group 3's `external_integration_dependency` Finding, never a
  // fabricated/null edge). Idempotent on (source ap, target ap, movement_type).
  // NEVER creates an `application_points` row (auto-managed by AMS).
  if (deferredDataMovements.length > 0) {
    const dmArrayKey = 'data_movements';
    if (!Array.isArray(model.metaModel.relationships[dmArrayKey])) {
      model.metaModel.relationships[dmArrayKey] = [];
    }
    const dmArray: any[] = model.metaModel.relationships[dmArrayKey];

    for (const candidate of deferredDataMovements) {
      const conversion = convertDataMovementToRow(candidate, model, filename);
      if (!conversion.resolved || !conversion.row) {
        if (conversion.skippedReason === 'external_target') {
          console.log(
            `[save-back] data_movements "${candidate.name}" (${candidate.id}): ` +
            `target is purely external -- left as an external-dependency Finding ` +
            `(no fabricated edge; target_application_point_id is a NOT NULL FK)`
          );
        } else {
          console.warn(
            `[save-back] Skipping data_movements "${candidate.name}" (${candidate.id}): ` +
            `source service/interface could not be resolved to an application_point`
          );
        }
        recordBlocked(candidate, 'Outbound data-movement: source service/interface could not be resolved to an application point', 'sourceService');
        entitiesSkipped++;
        continue;
      }

      // Idempotent match: same (source ap, target ap, movement_type) triple.
      const existingRel = dmArray.find(
        (r: any) =>
          r.source_application_point_id === conversion.row.source_application_point_id &&
          r.target_application_point_id === conversion.row.target_application_point_id &&
          r.movement_type === conversion.row.movement_type
      );
      if (existingRel) {
        candidateIdToEntityId[candidate.id] = existingRel.id;
        candidateActions.push({
          candidateId: candidate.id,
          entityId: existingRel.id,
          entityType: dmArrayKey,
          action: 'reused',
        });
        entitiesSkipped++;
      } else {
        dmArray.push(conversion.row);
        candidateIdToEntityId[candidate.id] = conversion.row.id;
        candidateActions.push({
          candidateId: candidate.id,
          entityId: conversion.row.id,
          entityType: dmArrayKey,
          action: 'created',
        });
        entitiesCreated++;
      }
    }
  }

  // --- Pass 2.7: Apply `enrich` candidates (Model-Aware Discovery, 2026-05-30) ---
  // Each enrich candidate references ONE existing entity BY NAME (resolved LATE
  // here, after Pass 1 mints, mirroring the relationship deferred passes). On an
  // auto-acceptable resolve (>= the 0.75 gate) we ADD the candidate's child
  // attribute (and/or a relationship to another pre-existing entity) onto that
  // entity WITHOUT blanket-overwriting any existing field. Outcomes:
  //   - target GONE (resolve none)        -> Finding (4.5), never a silent drop.
  //   - resolve below the gate (normalized) -> leave as a reviewable candidate
  //                                          (NEVER suppressed); no model change.
  //   - attribute already present, different value -> Finding (4.7); NO overwrite.
  if (deferredEnrich.length > 0) {
    for (const candidate of deferredEnrich) {
      const targetName = readEnrichTargetName(candidate);
      if (!targetName) {
        console.warn(
          `[save-back] enrich "${candidate.name}" (${candidate.id}): no target entity name on data -- skipping`,
        );
        recordBlocked(candidate, 'Enrich candidate has no target entity name', 'targetEntityName');
        entitiesSkipped++;
        continue;
      }
      const resolved = resolveExistingEntity(model, targetName, [
        LINK_LOGICAL_ARRAY_KEY,
        LINK_PHYSICAL_ARRAY_KEY,
      ]);

      // Target GONE at save-back -> Finding (never a silent drop).
      if (resolved.matchKind === 'none' || !resolved.entity) {
        saveBackFindings.push({
          findingType: FINDING_TYPE_TARGET_GONE,
          category: FINDING_CATEGORY_MODEL_AWARE,
          severity: 'low',
          title: `Enrich target "${targetName}" no longer exists`,
          summary:
            `Discovery intended to enrich "${targetName}" (candidate "${candidate.name}"), ` +
            `but no matching entity exists in the model at save-back.`,
          source: 'save-back',
          createdByStage: 'candidate-save-back',
          links: [
            { linkType: 'enrich_target_missing', targetType: 'discovery_candidate', targetId: candidate.id },
          ],
        });
        recordBlocked(candidate, `Enrich target "${targetName}" no longer exists`, 'targetEntityName', true);
        entitiesSkipped++;
        continue;
      }

      // Below the auto-accept gate -> reviewable candidate, never auto-applied,
      // never suppressed. We leave the candidate uncommitted (no model change).
      if (resolved.confidence < CANDIDATE_AUTO_ACCEPT_THRESHOLD) {
        console.log(
          `[save-back] enrich "${candidate.name}" (${candidate.id}): target "${targetName}" ` +
            `resolved only by normalization (confidence ${resolved.confidence}) -- left as a ` +
            `reviewable candidate (not auto-applied)`,
        );
        continue;
      }

      // Auto-apply. Attribute kinds add a child attribute; a relationship-bearing
      // enrich adds a logical_data_entity_relationships row between two
      // pre-existing entities (both resolved by name).
      const t = candidate.candidate_type;
      const isAttributeKind =
        t === 'logical_data_attributes' ||
        t === 'physical_data_attributes' ||
        t === 'logical_data_attribute' ||
        t === 'physical_attribute';
      const data = (candidate.data || {}) as Record<string, any>;
      const relatedName =
        (typeof data.relatedEntityName === 'string' && data.relatedEntityName) ||
        (typeof data.targetEntity === 'string' && data.targetEntity) ||
        (typeof data.sourceEntity === 'string' && data.sourceEntity) ||
        undefined;

      let didApply = false;

      if (isAttributeKind && resolved.arrayKey) {
        const enrichResult = applyEnrichAttribute(
          model,
          candidate,
          resolved.entity,
          resolved.arrayKey!,
        );
        if (enrichResult.applied > 0) {
          enrichmentsApplied += enrichResult.applied;
          didApply = true;
        }
        // Conflicts: NEVER overwrite -> a low-severity Finding linked to the
        // architecture_element ("architecture != reality" is evidence).
        for (const conflict of enrichResult.conflicts) {
          saveBackFindings.push({
            findingType: FINDING_TYPE_ATTR_CONFLICT,
            category: FINDING_CATEGORY_MODEL_AWARE,
            severity: 'low',
            title: `Attribute "${conflict.attributeName}" conflicts on "${resolved.entity.name}"`,
            summary:
              `Discovery found a different value for the existing attribute ` +
              `"${conflict.attributeName}" on "${resolved.entity.name}": existing ` +
              `"${String(conflict.existingValue)}" vs discovered "${String(conflict.incomingValue)}". ` +
              `The existing value was NOT overwritten.`,
            detailJson: {
              attributeName: conflict.attributeName,
              existingValue: conflict.existingValue ?? null,
              incomingValue: conflict.incomingValue ?? null,
            },
            source: 'save-back',
            createdByStage: 'candidate-save-back',
            links: [
              { linkType: 'conflicts_with', targetType: 'architecture_element', targetId: resolved.entity.id },
            ],
          });
        }
      }

      // Relationship-bearing enrich: add a logical_data_entity_relationships row
      // between the resolved target and a second pre-existing entity (resolved
      // by name), reusing the dep_log_/dep_phy_ point-id pattern for endpoints.
      if (relatedName) {
        const relatedRes = resolveEntityPointForBinding(
          model, relatedName, 'enrich (related entity)', candidate.id,
        );
        const targetRes = resolveEntityPointForBinding(
          model, targetName, 'enrich (target entity)', candidate.id,
        );
        // False-merge guard: a NORMALIZED match on either side -> collision
        // finding + skip the enrich relationship (reviewable, not bound).
        if (relatedRes.matchKind === 'normalized' || targetRes.matchKind === 'normalized') {
          if (relatedRes.collision) saveBackFindings.push(relatedRes.collision);
          if (targetRes.collision) saveBackFindings.push(targetRes.collision);
          console.warn(
            `[save-back] enrich "${candidate.name}" (${candidate.id}): related/target entity ` +
            `resolved only by normalization -- enrich relationship left as reviewable ` +
            `(not bound; possible collision finding(s) raised)`,
          );
        }
        const relatedPointId =
          relatedRes.matchKind === 'exact' ? relatedRes.pointId : null;
        const targetPointId =
          targetRes.matchKind === 'exact' ? targetRes.pointId : null;
        if (relatedPointId && targetPointId) {
          const relArrayKey = 'logical_data_entity_relationships';
          if (!Array.isArray(model.metaModel.relationships[relArrayKey])) {
            model.metaModel.relationships[relArrayKey] = [];
          }
          const relArray: any[] = model.metaModel.relationships[relArrayKey];
          const existsRel = relArray.find(
            (r: any) =>
              r.fromDataEntityPointId === targetPointId && r.toDataEntityPointId === relatedPointId,
          );
          if (!existsRel) {
            relArray.push({
              id: generateId('ler-'),
              fromDataEntityPointId: targetPointId,
              toDataEntityPointId: relatedPointId,
              cardinality: mapCardinality(data.cardinality),
              relationship: mapRelationshipType(data.relationshipType),
              description: data.description || '',
              tags: '',
              valid_from: null,
              valid_to: null,
            });
            enrichmentsApplied++;
            didApply = true;
          } else {
            // Idempotent: the relationship already exists -- treat as applied.
            didApply = true;
          }
        } else {
          // The OTHER endpoint is gone -> Finding (never a silent drop).
          saveBackFindings.push({
            findingType: FINDING_TYPE_TARGET_GONE,
            category: FINDING_CATEGORY_MODEL_AWARE,
            severity: 'low',
            title: `Enrich relationship endpoint "${relatedName}" no longer exists`,
            summary:
              `Discovery intended to relate "${targetName}" to "${relatedName}" (candidate ` +
              `"${candidate.name}"), but "${relatedName}" was not found in the model at save-back.`,
            source: 'save-back',
            createdByStage: 'candidate-save-back',
            links: [
              { linkType: 'enrich_target_missing', targetType: 'discovery_candidate', targetId: candidate.id },
            ],
          });
        }
      }

      if (didApply) {
        // Commit the enrich candidate against the resolved entity for provenance.
        candidateActions.push({
          candidateId: candidate.id,
          entityId: resolved.entity.id,
          entityType: resolved.arrayKey || candidate.candidate_type,
          action: 'created',
        });
      }
    }
  }

  // --- Pass 2.8: Logical<->physical `link` reconciliation (the Spec 3 gap) ---
  // Populate `logical_data_entity_physical_data_entities` (previously scaffolded
  // empty and NEVER written). Each side is matched in its OWN layer (logical name
  // vs logical_data_entities; physical name vs physical_data_entities) so the two
  // layers stay DISTINCT and we never synthesize a 1:1 mapping.
  //   - BOTH sides EXACT -> auto-write the mapping row.
  //   - either side normalized-only (below the gate) -> reviewable link candidate
  //     (no write).
  //   - either side GONE -> Finding (4.5); write nothing.
  if (deferredLink.length > 0) {
    const linkArrayKey = 'logical_data_entity_physical_data_entities';
    if (!Array.isArray(model.metaModel.relationships[linkArrayKey])) {
      model.metaModel.relationships[linkArrayKey] = [];
    }
    const linkArray: any[] = model.metaModel.relationships[linkArrayKey];
    const logicals: any[] = model.metaModel.entities?.logical_data_entities || [];
    const physicals: any[] = model.metaModel.entities?.physical_data_entities || [];

    for (const candidate of deferredLink) {
      const data = (candidate.data || {}) as Record<string, any>;
      const logicalName =
        (typeof data.logicalEntityName === 'string' && data.logicalEntityName) ||
        (typeof data.logical_entity_name === 'string' && data.logical_entity_name) ||
        undefined;
      const physicalName =
        (typeof data.physicalEntityName === 'string' && data.physicalEntityName) ||
        (typeof data.physical_entity_name === 'string' && data.physical_entity_name) ||
        undefined;

      if (!logicalName || !physicalName) {
        console.warn(
          `[save-back] link "${candidate.name}" (${candidate.id}): missing logical/physical name on data -- skipping`,
        );
        recordBlocked(candidate, 'Link candidate is missing its logical/physical entity name', 'logicalEntityName');
        entitiesSkipped++;
        continue;
      }

      const logicalMatch = matchByNormalizedName(logicals, logicalName);
      const physicalMatch = matchByNormalizedName(physicals, physicalName);

      // Either endpoint GONE -> Finding; write nothing (never a 1:1 synthesis).
      if (logicalMatch.matchKind === 'none' || physicalMatch.matchKind === 'none') {
        const missing =
          logicalMatch.matchKind === 'none' && physicalMatch.matchKind === 'none'
            ? `${logicalName}" and "${physicalName}`
            : logicalMatch.matchKind === 'none'
              ? logicalName
              : physicalName;
        saveBackFindings.push({
          findingType: FINDING_TYPE_TARGET_GONE,
          category: FINDING_CATEGORY_MODEL_AWARE,
          severity: 'low',
          title: `Link endpoint "${missing}" no longer exists`,
          summary:
            `Discovery intended to link logical "${logicalName}" <-> physical "${physicalName}" ` +
            `(candidate "${candidate.name}"), but "${missing}" was not found in the model at save-back.`,
          source: 'save-back',
          createdByStage: 'candidate-save-back',
          links: [
            { linkType: 'enrich_target_missing', targetType: 'discovery_candidate', targetId: candidate.id },
          ],
        });
        recordBlocked(candidate, `Link endpoint "${missing}" no longer exists`, 'logicalEntityName', true);
        entitiesSkipped++;
        continue;
      }

      // Below the gate on EITHER side -> reviewable link candidate (no write).
      if (
        logicalMatch.confidence < CANDIDATE_AUTO_ACCEPT_THRESHOLD ||
        physicalMatch.confidence < CANDIDATE_AUTO_ACCEPT_THRESHOLD
      ) {
        console.log(
          `[save-back] link "${candidate.name}" (${candidate.id}): logical/physical resolved only ` +
            `by normalization (logical ${logicalMatch.confidence}, physical ${physicalMatch.confidence}) ` +
            `-- left as a reviewable candidate (not auto-linked)`,
        );
        continue;
      }

      // BOTH EXACT -> write the mapping row (idempotent on the entity-id pair).
      const logicalEntity = logicalMatch.item!;
      const physicalEntity = physicalMatch.item!;
      const existsLink = linkArray.find(
        (r: any) =>
          r.logical_entity_id === logicalEntity.id && r.physical_entity_id === physicalEntity.id,
      );
      if (existsLink) {
        candidateActions.push({
          candidateId: candidate.id,
          entityId: existsLink.id,
          entityType: linkArrayKey,
          action: 'reused',
        });
        entitiesSkipped++;
        continue;
      }
      const linkRow = buildLogicalPhysicalLinkRow(
        logicalEntity,
        physicalEntity,
        filename,
        (data.description as string) || '',
      );
      linkArray.push(linkRow);
      linksCreated++;
      candidateActions.push({
        candidateId: candidate.id,
        entityId: linkRow.id,
        entityType: linkArrayKey,
        action: 'created',
      });
      entitiesCreated++;
    }
  }

  // ===========================================================================
  // Step 9: Validate FK references before PUT
  // ===========================================================================
  const fkPruned = pruneInvalidFKReferences(model);
  if (fkPruned > 0) {
    entitiesSkipped += fkPruned;
    entitiesCreated = Math.max(0, entitiesCreated - fkPruned);
  }


  // ===========================================================================
  // Step 9b: Quality-gap detection (2026-06-20). A candidate that COMMITTED but
  // is missing an important field is recorded as a `quality_gap` reason (and, in
  // Group 2, a durable linked finding) so the C1 panel can offer a bulk fill.
  // Starter set (extensible): interface committed with only the DEFAULTED
  // REST_API interface_type; endpoint with empty operation_verb and/or
  // path_or_address; logical/physical entity committed with NO attributes.
  // ===========================================================================
  {
    const qgEnts = model.metaModel?.entities || {};
    const findCreatedRow = (key: string, id: string): any =>
      (qgEnts[key] || []).find((e: any) => e?.id === id);
    for (const action of candidateActions) {
      if (action.action !== 'created') continue;
      const candidate = sortedCandidates.find((c) => c.id === action.candidateId);
      if (!candidate) continue;
      const entity = findCreatedRow(action.entityType, action.entityId);
      if (!entity) continue;
      let gapField: string | undefined;
      let gapText: string | undefined;
      if (action.entityType === 'interfaces') {
        const cdata = (candidate.data || {}) as Record<string, unknown>;
        const explicit =
          typeof cdata.interface_type === 'string' && cdata.interface_type.trim().length > 0;
        if (!explicit && entity.interface_type === 'REST_API') {
          gapField = 'interface_type';
          gapText = 'Interface committed with only the defaulted REST_API interface_type';
        }
      } else if (action.entityType === 'endpoints') {
        const noVerb = !entity.operation_verb;
        const noPath = !entity.path_or_address;
        if (noVerb || noPath) {
          gapField = noVerb ? 'operation_verb' : 'path_or_address';
          gapText = `Endpoint committed with empty ${
            noVerb && noPath ? 'operation_verb and path_or_address' : (noVerb ? 'operation_verb' : 'path_or_address')
          }`;
        }
      } else if (
        action.entityType === 'logical_data_entities' ||
        action.entityType === 'physical_data_entities'
      ) {
        const attrArrayKey =
          action.entityType === 'logical_data_entities'
            ? 'logical_data_attributes'
            : 'physical_data_attributes';
        const fkField =
          action.entityType === 'logical_data_entities'
            ? 'logical_entity_id'
            : 'physical_entity_id';
        const attrs = (qgEnts[attrArrayKey] || []).filter(
          (a: any) => a?.[fkField] === entity.id,
        );
        if (attrs.length === 0) {
          gapField = 'attributes';
          gapText = 'Data entity committed with no attributes';
        }
      }
      if (gapField && gapText) {
        qualityGapReasons.push({
          entry: { ...baseReasonEntry(candidate), reason: 'quality_gap', missingField: gapField },
          reasonText: gapText,
        });
      }
    }
  }

  // ===========================================================================
  // Step 10: PUT updated model
  // ===========================================================================
  console.log(`[save-back] Saving model "${filename}" — ${entitiesCreated} created, ${entitiesSkipped} skipped`);

  // Two-phase PUT: save entities first, then re-add and save relationships.
  // Relationships reference data_entity_points which the backend auto-creates
  // only when the referenced entities exist, so they must be saved in a
  // second pass after entities land. Bug fix (2026-04-21): the same holds for
  // `interface_logical_entities` — they FK to both interfaces (existing) AND
  // data_entity_points (auto-created from entities). Include them in the
  // two-phase split so the first PUT doesn't fail on an unresolved FK.
  const newLers = model.metaModel.relationships?.logical_data_entity_relationships?.filter(
    (r: any) => r.id?.startsWith('ler-')
  ) || [];
  const newIles = model.metaModel.relationships?.interface_logical_entities?.filter(
    (r: any) => r.id?.startsWith('ile-')
  ) || [];
  // Endpoint->data-effect edges FK to endpoints (existing/minted) AND
  // data_entity_points (auto-created from entities), so -- like
  // interface_logical_entities -- they must be held out of the first PUT and
  // re-added in the second pass once the base entities have landed.
  const newEdes = model.metaModel.relationships?.endpoint_data_effects?.filter(
    (r: any) => r.id?.startsWith('ede-')
  ) || [];
  if (newLers.length > 0) {
    model.metaModel.relationships.logical_data_entity_relationships =
      (model.metaModel.relationships.logical_data_entity_relationships || []).filter(
        (r: any) => !r.id?.startsWith('ler-')
      );
  }
  if (newIles.length > 0) {
    model.metaModel.relationships.interface_logical_entities =
      (model.metaModel.relationships.interface_logical_entities || []).filter(
        (r: any) => !r.id?.startsWith('ile-')
      );
  }
  if (newEdes.length > 0) {
    model.metaModel.relationships.endpoint_data_effects =
      (model.metaModel.relationships.endpoint_data_effects || []).filter(
        (r: any) => !r.id?.startsWith('ede-')
      );
  }

  try {
    if (commit) await archModelClient.putModel(projectId, architectureId, filename, model);
  } catch (phaseOneErr: any) {
    // Diagnostic logging (2026-04-21): the MCP error handler masks the
    // backend's actual error as a generic "Backend service error" 502. When
    // phase-1 PUT fails we need to see the real response to debug schema
    // violations, FK failures, etc. Log the full surface area before
    // rethrowing so the original 502 contract with callers is preserved.
    const status = phaseOneErr?.response?.status;
    const body = phaseOneErr?.response?.data;
    const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 4000) : 'no response body';
    const msg = phaseOneErr instanceof Error ? phaseOneErr.message : String(phaseOneErr);
    // Per-type counts of the NEW entities we sent, to help correlate the
    // failure to a specific candidate type.
    const entities = model.metaModel?.entities ?? {};
    const rels = model.metaModel?.relationships ?? {};
    const newCounts: Record<string, number> = {};
    for (const [k, v] of Object.entries({ ...entities, ...rels })) {
      if (!Array.isArray(v)) continue;
      // Only count rows whose id uses a prefix save-back mints (not the
      // backend-minted ones from prior saves).
      const minted = v.filter((row: any) =>
        typeof row?.id === 'string' &&
        /^(ifc|ep|lde|lda|pde|pda|bl|scr|uicomp|ler|ile|ede)-/.test(row.id),
      ).length;
      if (minted > 0) newCounts[k] = minted;
    }
    console.error(
      `[save-back] Phase-1 PUT failed (status=${status}, duration msg=${msg}). ` +
      `Backend body: ${bodyStr}. New rows minted by save-back this call: ${JSON.stringify(newCounts)}`,
    );
    throw phaseOneErr;
  }

  if (newLers.length > 0 || newIles.length > 0 || newEdes.length > 0) {
    if (newLers.length > 0) {
      model.metaModel.relationships.logical_data_entity_relationships.push(...newLers);
    }
    if (newIles.length > 0) {
      model.metaModel.relationships.interface_logical_entities.push(...newIles);
    }
    if (newEdes.length > 0) {
      model.metaModel.relationships.endpoint_data_effects.push(...newEdes);
    }
    try {
      if (commit) await archModelClient.putModel(projectId, architectureId, filename, model);
    } catch (relError: any) {
      console.warn(
        `[save-back] Phase-2 relationships PUT failed (status=${relError?.response?.status}). ` +
        `Base entities saved; ${newLers.length} logical_data_entity_relationships, ` +
        `${newIles.length} interface_logical_entities and ` +
        `${newEdes.length} endpoint_data_effects could not be saved.`
      );
    }
  }

  // ===========================================================================
  // Step 11: Update each promoted candidate's status and review_status to 'committed'
  // ===========================================================================
  const candidatesCommitted = candidateActions.length;

  for (const action of candidateActions) {
    const candidate = sortedCandidates.find((c) => c.id === action.candidateId);
    if (!candidate) continue;

    try {
      // Capture the pre-save review status so the AMS audit trail
      // reflects the actual transition (typically 'approved' -> 'committed').
      // 'pending_review' is the sentinel for legacy rows that somehow ended
      // up in the save-back set without an explicit prior review.
      const previousReviewStatus = candidate.review_status ?? 'pending_review';
      if (commit) await archModelClient.updateCandidate(projectId, architectureId, runId, action.candidateId, {
        status: 'committed',
        review_status: 'committed',
        reviewed_by: 'save-back',
        reviewed_at: new Date().toISOString(),
        previous_review_status: previousReviewStatus,
        data: {
          ...candidate.data,
          committedEntityId: action.entityId,
          committedEntityType: action.entityType,
        },
      });
    } catch (err) {
      // Status update failures after successful putModel are logged as warnings
      // but do not fail the overall operation (the model is already saved)
      console.warn(
        `[save-back] Status update failed for candidate "${candidate.name}" (${action.candidateId}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // ===========================================================================
  // Step 12: Persist provenance mappings
  // ===========================================================================
  const mappings: CandidateEntityMappingDto[] = candidateActions.map((action) => ({
    id: '', // server will generate
    candidate_id: action.candidateId,
    run_id: runId,
    entity_type: action.entityType,
    entity_id: action.entityId,
    action: action.action,
    created_at: '', // server will set
  }));

  try {
    if (commit) await archModelClient.bulkCreateCandidateEntityMappings(projectId, architectureId, runId, mappings);
  } catch (err) {
    // Log but do not fail -- the model and status updates are already persisted
    console.warn(
      `[save-back] Provenance mapping persistence failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // ===========================================================================
  // Step 12.5: Model-Aware Discovery (2026-05-30, Task Group 4) -- surface the
  // visible auto-suppress run summary + best-effort persist the save-back
  // Findings (attribute conflicts + target-gone). NO silent drops: the
  // suppressed set + possible-duplicates + findings all ride on the returned
  // result, and the findings are additionally pushed to AMS best-effort (a
  // persistence hiccup logs a warning and never aborts the already-saved model).
  // ===========================================================================
  if (suppressedDuplicates.length > 0) {
    console.log(
      `[save-back] Model-aware dedup: ${suppressedDuplicates.length} re-discovered ` +
        `entities suppressed as duplicates of existing model entities ` +
        `(${suppressedDuplicates.map((s) => `"${s.candidateName}"`).join(', ')}).`,
    );
  }
  if (possibleDuplicates.length > 0) {
    console.log(
      `[save-back] Model-aware dedup: ${possibleDuplicates.length} possible-duplicate ` +
        `candidate(s) left for review (normalized match, below the auto-accept gate).`,
    );
  }
  // ===========================================================================
  // Step 12.4: Durable linked findings for Blocked + Quality-gap candidates
  // (2026-06-20, Task Group 2). EXTEND the existing saveBackFindings array so
  // these ride the SAME best-effort bulkCreateDiscoveryFindings persistence
  // (Step 12.5) -- which is already gated on `commit`, so NOTHING is written
  // under the commit=false dry-run. Each finding LINKS to its candidate
  // (targetType='discovery_candidate') so the signal survives a page reload.
  // ===========================================================================
  for (const b of blockedReasons) {
    // Skip entries whose blocking site ALREADY emitted a durable finding
    // (enrich/link target-gone) -- avoid a duplicate evidence_gap finding.
    if (b.alreadyHasFinding) continue;
    saveBackFindings.push(
      buildCandidateGapFinding({
        kind: 'blocked',
        candidateId: b.entry.candidateId,
        candidateType: b.entry.candidateType,
        candidateName: b.entry.name,
        reasonText: b.reasonText,
        missingField: b.entry.missingField,
      }),
    );
  }
  for (const q of qualityGapReasons) {
    saveBackFindings.push(
      buildCandidateGapFinding({
        kind: 'quality_gap',
        candidateId: q.entry.candidateId,
        candidateType: q.entry.candidateType,
        candidateName: q.entry.name,
        reasonText: q.reasonText,
        missingField: q.entry.missingField,
      }),
    );
  }

  if (saveBackFindings.length > 0) {
    try {
      if (commit) await archModelClient.bulkCreateDiscoveryFindings(projectId, architectureId, runId, saveBackFindings);
    } catch (err) {
      // Soft-fail exactly like the discovery-service FindingEmitter: the model
      // is already saved; a findings-persistence failure must not abort.
      console.warn(
        `[save-back] Model-aware findings persistence failed (${saveBackFindings.length} ` +
          `finding(s) recorded on the result regardless): ${
            err instanceof Error ? err.message : String(err)
          }`,
      );
    }
  }


  // ===========================================================================
  // Step 12.7: Assemble the per-candidate reason arm (2026-06-20). Pass 1 already
  // pushed created + classified-reused entries; here we (a) add a generic
  // created/reused entry for any candidateAction from the DEFERRED passes not yet
  // represented, and (b) fold in suppressed / possible / blocked / quality-gap.
  // ===========================================================================
  {
    const representedIds = new Set(reasons.map((r) => r.candidateId));
    for (const action of candidateActions) {
      if (representedIds.has(action.candidateId)) continue;
      const candidate = sortedCandidates.find((c) => c.id === action.candidateId);
      if (!candidate) continue;
      if (action.action === 'created') {
        reasons.push({ ...baseReasonEntry(candidate), reason: 'created' });
      } else {
        // Deferred-pass reuse (e.g. an existing relationship row matched). The
        // intra-scan / pre-existing split is a top-level-entity distinction, so
        // these carry the generic 'intra-scan' subclass.
        reasons.push({ ...baseReasonEntry(candidate), reason: 'reused', reusedSubclass: 'intra-scan' });
      }
      representedIds.add(action.candidateId);
    }
    for (const sd of suppressedDuplicates) {
      reasons.push({
        candidateId: sd.candidateId,
        candidateType: sd.entityType,
        name: sd.candidateName,
        class: '',
        reason: 'suppressed',
      });
    }
    for (const pd of possibleDuplicates) {
      reasons.push({
        candidateId: pd.candidateId,
        candidateType: pd.entityType,
        name: pd.candidateName,
        class: '',
        reason: 'possible',
      });
    }
    for (const b of blockedReasons) reasons.push(b.entry);
    for (const q of qualityGapReasons) reasons.push(q.entry);
  }

  // ===========================================================================
  // Step 13: Return result summary
  // ===========================================================================
  return {
    projectId,
    runId,
    entitiesCreated,
    entitiesSkipped,
    candidatesCommitted,
    entitiesSuppressed: suppressedDuplicates.length,
    suppressedDuplicates,
    possibleDuplicates,
    belowGateCandidates,
    belowGateCount: belowGateCandidates.length,
    enrichmentsApplied,
    linksCreated,
    findingsEmitted: saveBackFindings,
    reasons,
  };
}
