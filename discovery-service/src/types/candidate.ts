/**
 * Discovery Candidate Types
 *
 * Defines the core candidate interface, candidate type and status unions,
 * and related data shapes produced by the discovery pipeline.
 *
 * Data flow position: 1a atoms -> 1b relationships -> LLM file analysis -> **candidates**
 *
 * Each discovery candidate represents a synthesized proposal that maps to
 * a meta-model element type. For example, "this class is likely a Service
 * named X" or "this endpoint belongs to interface Y".
 * Candidates carry a status field for future human review workflows.
 */

/**
 * The types of discovery candidates, matching meta-model element types.
 *
 * Canonical names (2026-04-20) mirror the Architecture Meta-Model Reference:
 *
 * - `application`: A top-level application or system
 * - `app_component`: A component within an application
 * - `service`: A service (microservice, API service, background job, etc.)
 * - `logical_data_entities`: A logical data entity or concept (DTO, value object, read model)
 * - `logical_data_attributes`: A field on a `logical_data_entities` candidate
 * - `physical_data_entities`: A physical data store or table (JPA `@Entity`, SQL table)
 * - `physical_data_attributes`: A persisted field/column on a `physical_data_entities`
 * - `interfaces`: An API interface, protocol, or contract (REST controller, GraphQL resolver)
 * - `endpoints`: An API endpoint (e.g., GET /api/users) belonging to an `interfaces` candidate
 * - `business_logics`: A business rule, validation, calculation, or domain logic operation
 * - `logical_data_entity_relationships`: an association between two data entities. The
 *   `logical_data_` prefix is historical — this type captures BOTH logical-to-logical
 *   AND physical-to-physical entity relationships (a `physical_data_entities`
 *   `@OneToMany` or SQL foreign key IS one of these). Use a single canonical arrow
 *   name `Parent → Child` regardless of layer.
 * - `interface_logical_entities`: Links an `interfaces` candidate to a
 *   `logical_data_entities` candidate that it references via a request body or
 *   response body. Undirected — one entry per (interface, logical_data_entity) pair
 *   regardless of whether the DTO appears as input, output, or both.
 * - `logical_data_entity_physical_data_entities`: Links a `logical_data_entities`
 *   candidate to its persisted `physical_data_entities` counterpart. JPA `@Entity`
 *   classes (and Hibernate HBM-XML mappings, merged into the same path) produce
 *   one such link per class — the in-memory class is the logical entity, the
 *   `@Table` (or HBM `<class table>`) is the physical entity.
 * - `logical_data_attribute_physical_data_attributes`: Links a
 *   `logical_data_attributes` candidate to its persisted
 *   `physical_data_attributes` counterpart (one link per JPA / HBM field).
 * - `endpoint_data_effects`: Links an `endpoints` candidate to a data entity it
 *   reads/writes (a controller→service→repository→entity data-effect edge).
 *   ONE per (endpoint, data-entity) pair, carrying `access_mode`
 *   (`read`/`write`/`read-write`), an operation hint, a `transactional` flag,
 *   and a structured ordered controller→service→repository path in
 *   `path_metadata_json`. Resolves the data-entity side BY NAME at save-back
 *   (Endpoint→Data-Effect Call Graph spec, 2026-05-29). Class/method hops are
 *   substrate only — `class`/`method` are NOT first-class candidate types.
 * - `data_movements`: An OUTBOUND integration edge — what a service/endpoint
 *   CALLS OUT TO (an outbound HTTP call, a published message topic/queue, a
 *   secondary store, a file/object, email/SMS, a third-party SDK). Realises the
 *   EXISTING `data_movements` relationship type (NOT a new type). Carries the
 *   source endpoint/service NAME + the resolved target NAME + the `integration_kind`
 *   on `data` (movement_type); save-back resolves the source/target
 *   `application_point`s LATE via the `ap_{serviceId}` convention — the candidate
 *   NEVER carries a point id and NEVER references a `*_points` wrapper. A purely
 *   external target leaves the target side NULL and is also captured as a rich
 *   `external_integration_dependency` Finding (Outbound Integration Graph spec,
 *   2026-05-30). The `endpoint_data_effects` entry above is its emit precedent.
 * - `ui_screens`: A top-level route-reachable UI view
 * - `ui_components`: A reusable UI fragment lower than screen level
 */
/**
 * All candidate types supported by the pipeline.
 *
 * Phase 1 LLM prompt uses a reduced set (service, interfaces, endpoints,
 * logical_data_entities, physical_data_entities) — enforced in
 * DEFAULT_CANDIDATE_TYPES in gateway/src/routes/discoveryDecisionTaskPrompts.ts.
 * Extension packs may still produce other types from AST analysis.
 */
export type CandidateType =
  | 'application'
  | 'app_component'
  | 'service'
  | 'logical_data_entities'
  | 'logical_data_attributes'
  | 'physical_data_entities'
  | 'physical_data_attributes'
  | 'interfaces'
  | 'business_process'
  | 'business_logics'
  | 'logical_data_entity_relationships'
  | 'interface_logical_entities'
  | 'logical_data_entity_physical_data_entities'
  | 'logical_data_attribute_physical_data_attributes'
  | 'endpoint_data_effects'
  // Outbound integration edge (REUSES the `data_movements` relationship type —
  // NOT a new type). Outbound Integration Graph, Spec #5, Task Group 3.
  | 'data_movements'
  | 'data_entity'
  | 'endpoints'
  | 'class'
  | 'method'
  // UI architecture types — added Chunk 3 (React V2 feature port).
  // Map to the architecture-model-service tables ui_screens / ui_components.
  | 'ui_screens'
  | 'ui_components';

/**
 * The lifecycle status of a discovery candidate.
 *
 * - `proposed`: Initial status; candidate awaits review
 * - `accepted`: Candidate has been reviewed and accepted into the model
 * - `rejected`: Candidate has been reviewed and rejected
 * - `merged`: Candidate has been merged with another candidate
 * - `committed`: Candidate has been promoted to the canonical model via save-back
 * - `pending_review`: Candidate is pending user review (Increment 13).
 *   Equivalent to `proposed` for review purposes; existing `proposed` rows
 *   are migrated to `pending_review` during the Increment 13 database migration.
 * - `deferred`: Candidate review has been deferred to a later time (Increment 13).
 *   Run-scoped -- does not carry forward across discovery runs.
 */
export type CandidateStatus =
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'merged'
  | 'committed'
  | 'pending_review'
  | 'deferred';

/**
 * Log enrichment metadata attached to a discovery candidate.
 *
 * Indicates whether log-derived evidence atoms contributed to this candidate,
 * how many log atoms were found in its source clusters, and a human-readable
 * summary of the log signals.
 */
export interface LogEnrichmentMetadata {
  /** Whether this candidate has log-derived evidence contributing to it */
  enriched: boolean;
  /** Count of evidence atoms with source: "log" in the candidate's source clusters */
  logAtomCount: number;
  /** Human-readable summary of log signal contributions (e.g., "3 endpoint hits observed, 5 error traces matched") */
  signalSummary: string;
}

/**
 * Core discovery candidate interface.
 *
 * Each candidate is synthesized from LLM file-level analysis, carries a
 * proposed name, a type matching meta-model element types, a confidence
 * score (0.0 to 1.0), a review status, references to source files,
 * and a metadata payload with proposed properties and evidence summaries.
 *
 * Persisted to the `discovery_candidate` table via the architecture-model-service.
 */
export interface DiscoveryCandidate {
  id: string;
  runId: string;
  candidateType: CandidateType;
  name: string;
  confidence: number;
  status: CandidateStatus;

  /**
   * The REVIEW disposition — AMS's `review_status` column, which is DISTINCT from
   * `status` (the lifecycle column above: proposed → committed). One of
   * `pending_review` | `approved` | `rejected` | `deferred`. It is written by the
   * AMS `bulk-review-cascade` / `resolve-conflict` endpoints, and the
   * discovery-review model MUST read THIS (not `status`) for a node's
   * `review_status` — otherwise an approve/reject/defer is never observed on the
   * next review-model read and the Review Room re-presents the same family forever.
   * Optional: a freshly-synthesized candidate carries no disposition yet (AMS
   * defaults the column to `pending_review`).
   */
  reviewStatus?: string;

  /**
   * Source file paths that produced this candidate.
   *
   * Originally named after cluster IDs (DB column: `source_cluster_ids`),
   * this field is repurposed to hold the file paths that the LLM analyzed
   * to produce the candidate. For example:
   * `["src/main/java/com/example/UserController.java"]`
   *
   * Provides traceability from candidate back to source files for
   * migration planning. No database migration -- the column name is
   * kept as-is (`source_cluster_ids` JSONB) to avoid schema changes.
   */
  sourceClusterIds: string[];

  data: Record<string, unknown>;
  synthesizedAt: string;

  /**
   * Optional self-referencing parent relationship.
   * Points to another DiscoveryCandidate's id within the same run,
   * establishing a parent-child hierarchy (e.g., service -> application,
   * interface -> service, endpoint -> interface, method -> class).
   */
  parentCandidateId?: string;

  /**
   * Optional log enrichment metadata (Increment 14).
   * Present when the candidate's source clusters contain log-derived
   * evidence atoms (source: "log"). Indicates enrichment status,
   * log atom count, and a human-readable signal summary.
   */
  logEnrichment?: LogEnrichmentMetadata;

  /**
   * Candidate operation dimension (Model-Aware Discovery, 2026-05-30).
   *
   * How this candidate relates to the EXISTING persisted model:
   *   - `create` (default) -- mint a brand-new entity (current behaviour).
   *   - `enrich`           -- add attributes / relationships to ONE existing
   *                           entity, referenced BY NAME in `data`
   *                           (target id resolved LATE at save-back).
   *   - `link`             -- create a logical<->physical mapping between TWO
   *                           existing entities, both referenced BY NAME in
   *                           `data` (resolved LATE at save-back).
   *
   * NOT a new entity/relationship TYPE -- a dimension on the candidate row
   * that lands on the AMS `discovery_candidate.operation` column. Absent /
   * undefined coerces to `create` (the AMS column default), so older rows and
   * operation-agnostic emitters round-trip as `create`.
   *
   * The LLM only PROPOSES `enrich` / `link`; the load-bearing target match is
   * deterministic in CODE at save-back -- never here, never in the prompt.
   */
  operation?: CandidateOperation;
}

/**
 * The operation dimension on a discovery candidate. See
 * {@link DiscoveryCandidate.operation}.
 */
export type CandidateOperation = 'create' | 'enrich' | 'link';

// ===========================================================================
// Merge / conflict / provenance data model (Spec 0 — Unique, Aggregate
// Discovery Candidates).
//
// The universal cross-source merge (`candidateMerge.ts`) folds every source's
// view of one real architecture element into a single surviving candidate and
// records the full provenance + any unresolved value conflicts inside the
// candidate's `data` JSONB passthrough (NO AMS schema change — `data` is
// persisted verbatim). These interfaces DOCUMENT and TYPE the reserved `data._*`
// keys. The shape is deliberately self-contained — it MUST be reusable by a
// later spec (Spec 3, the conversational Architect review persona, which
// CONSUMES this conflict model) and is NOT coupled to any UI or pipeline
// concern.
//
// The keys live under `data` (which stays `Record<string, unknown>`); these
// interfaces are the canonical reference for their value shapes and are imported
// by the merge engine, the save-back, and the grid UI rather than re-declared.
// ===========================================================================

/**
 * One competing value for a conflicted attribute, tagged with the SOURCE that
 * contributed it. Stored as `data._conflicts[attr]: ConflictingValue[]` — one
 * entry per DISTINCT present value across the grouped sources.
 */
export interface ConflictingValue {
  /** The competing value as the contributing source produced it. */
  value: unknown;
  /** The source label that produced this value (a `data._addedBy` member, or the runtime/LLM stage label). */
  source: string;
}

/**
 * A resolution of a single attribute conflict, written by the reviewer (Spec 0
 * grid, Group 7) or a later automated resolver (Spec 3). Stored as
 * `data._conflictResolutions[attr]`. When present, the chosen value is ALSO
 * written to the canonical attribute slot and the corresponding `_conflicts[attr]`
 * entry is cleared. The merge engine leaves this ABSENT for unresolved conflicts.
 */
export interface ConflictResolution {
  /** The value the reviewer chose for the canonical slot. */
  chosenValue: unknown;
  /** The source label whose value was chosen. */
  chosenSource: string;
  /** Identifier of who resolved it (user id / persona). */
  resolvedBy: string;
  /** ISO-8601 timestamp of the resolution. */
  resolvedAt: string;
}

/**
 * The reserved merge keys carried inside a candidate's `data` after the merge.
 * Documentation type only — `DiscoveryCandidate.data` stays
 * `Record<string, unknown>` for the JSONB passthrough. Use this as the typed
 * lens when reading merge output (merge engine, save-back, grid UI).
 */
export interface CandidateMergeData {
  /**
   * Set of contributing source labels (upgrades the legacy single-string
   * `_addedBy`). Every emitter wrote a single string; the merge UNIONs the
   * labels of all grouped sources into this array. Readers MUST tolerate both
   * the legacy string and this array (see `readAddedBy`).
   */
  _addedBy?: string[] | string;
  /** Ids of the collapsed source candidates folded into this survivor (audit trail). */
  _mergedFrom?: string[];
  /** Per-attribute provenance: the source label that won each populated attribute's canonical slot. */
  _attributeProvenance?: Record<string, string>;
  /** Per-attribute competing values (one entry per distinct present value) for UNRESOLVED conflicts. */
  _conflicts?: Record<string, ConflictingValue[]>;
  /** Per-attribute resolution stamps; present only once a conflict is resolved. */
  _conflictResolutions?: Record<string, ConflictResolution>;
}
