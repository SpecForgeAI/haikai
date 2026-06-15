/**
 * Cluster Evidence Types (Layer 1c) -- DEPRECATED
 *
 * @deprecated The clustering pipeline (steps 1c/1d) has been replaced by
 * LLM-driven file-level analysis (step 1c-llm-analysis) as of
 * Spec 2026-04-07: Extension Pack Framework & LLM File Analysis.
 *
 * These types are retained because they are still referenced by:
 *   - archModelClient.ts (cluster CRUD methods for historical data)
 *   - hypothesisGenerationEngine.ts (hypothesis generation from clusters)
 *   - hypothesisRefinementEngine.ts (hypothesis refinement with clusters)
 *   - logEnrichmentMetadata.ts (log enrichment uses cluster maps)
 *   - analyzerPack.ts (AnalyzerResult.clusters field)
 *   - decisionTask.ts (ClusterType used in decision task types)
 *
 * The discovery_cluster database table is preserved for historical data
 * from prior runs. No new clusters are produced by the current pipeline.
 *
 * Defines the core cluster interface, cluster member types, and
 * related data shapes produced by the former Phase 1c cluster formation.
 *
 * Data flow position (historical): 1a atoms -> 1b relationships -> 1c clusters -> 1d candidates
 */

/**
 * The types of clusters that can be formed from evidence atoms and relationships.
 *
 * @deprecated Retained for historical data compatibility. No new clusters are produced.
 *
 * - `service_boundary`: A group of atoms and relationships forming a logical service
 * - `data_domain`: A group of data-related atoms forming a coherent data domain
 * - `shared_library`: A group of atoms representing shared/utility code
 * - `api_layer`: A group of atoms and relationships forming an API surface
 * - `ui_module`: A group of atoms forming a user interface module
 * - `package_module`: A group of atoms forming a package or module boundary (e.g., directory-based grouping)
 * - `unknown`: A cluster whose type could not be determined deterministically
 */
export type ClusterType =
  | 'service_boundary'
  | 'data_domain'
  | 'shared_library'
  | 'api_layer'
  | 'ui_module'
  | 'package_module'
  | 'unknown';

/**
 * The types of members that can belong to a cluster.
 *
 * @deprecated Retained for historical data compatibility. No new clusters are produced.
 *
 * - `atom`: A Phase 1a evidence atom (references discovery_evidence.id)
 * - `relationship`: A Phase 1b evidence relationship (references discovery_relationship.id)
 */
export type ClusterMemberType = 'atom' | 'relationship';

/**
 * A member entry within a cluster.
 *
 * @deprecated Retained for historical data compatibility. No new clusters are produced.
 *
 * Each member references either an evidence atom or an evidence relationship
 * by its type and ID. The `memberType` discriminator indicates which table
 * the `memberId` references.
 */
export interface ClusterMember {
  memberType: ClusterMemberType;
  memberId: string;
}

/**
 * Core evidence cluster interface (Layer 1c).
 *
 * @deprecated Retained for historical data compatibility. No new clusters are produced.
 *
 * Each cluster groups related atoms and relationships together, carries
 * a type discriminator, an optional human-readable name, a confidence
 * score (0.0 to 1.0), a list of member references, and a metadata payload.
 *
 * Persisted to the `discovery_cluster` table (with members in
 * `discovery_cluster_member`) via the architecture-model-service.
 */
export interface EvidenceCluster {
  id: string;
  runId: string;
  clusterType: ClusterType;
  name?: string;
  confidence: number;
  members: ClusterMember[];
  data: Record<string, unknown>;
  formedAt: string;
}
