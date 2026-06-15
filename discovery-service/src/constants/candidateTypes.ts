/**
 * Candidate Type Constants for Discovery Pipeline
 *
 * Defines the allowed candidate types for service-scoped discovery runs.
 * Service-scoped runs exclude the 'service' type since the service is
 * already known.
 *
 * Used as a post-filter on extension pack output in llmFileAnalysisStep.ts
 * to strip out any candidate types that are outside the service-scoped set.
 *
 * Spec: Service-Scoped Discovery (TG8)
 *
 * Naming note (2026-04-20): the canonical candidate type names mirror the
 * Architecture Meta-Model Reference. `logical_data_entity_relationships` is
 * historically named but captures BOTH logical-to-logical AND
 * physical-to-physical entity relationships (a `physical_data_entities`
 * `@OneToMany` or SQL foreign key IS one of these).
 */

/**
 * Candidate types allowed for service-scoped discovery runs.
 * Excludes 'service' (already known).
 */
export const SERVICE_SCOPED_CANDIDATE_TYPES: string[] = [
  'interfaces',
  'endpoints',
  'logical_data_entities',
  'physical_data_entities',
  'physical_data_attributes',
  'logical_data_attributes',
  'business_logics',
  'logical_data_entity_relationships',
  'interface_logical_entities',
  // UI taxonomy (for frontend service scans)
  'ui_screens',
  'ui_components',
];
