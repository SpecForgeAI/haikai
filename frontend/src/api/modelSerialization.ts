/**
 * Model Serialization Utilities
 *
 * Provides deterministic snake_case/camelCase key mapping at the API boundary
 * for typed diagram content (typedContent <-> typed_content).
 *
 * This module is the single source of truth for API boundary key mapping:
 * - `normalizeModelFromApi`: Maps `typed_content` to `typedContent` on load
 * - `prepareModelForApiSave`: Maps `typedContent` to `typed_content` on save
 *
 * 2026-01-03: Added UI entity array backfilling (spec: metamodel-ui-workflow-transitions-crash-fix)
 * - Backfills missing ui_screens, ui_components, ui_actions, ui_workflow_transitions arrays
 * - Prevents crashes when loading older saved projects that don't have UI entities
 *
 * Reference: frontend/src/utils/fileOperations.ts parseTypedContent function
 */

import type { ArchitectureModel, Diagram } from '../types/model';

/**
 * Extended Diagram type to handle raw API responses with snake_case keys.
 * Backend sends `typed_content` (snake_case), frontend uses `typedContent` (camelCase).
 */
interface RawDiagram extends Omit<Diagram, 'typedContent'> {
  typed_content?: Diagram['typedContent'];
  typedContent?: Diagram['typedContent'];
}

/**
 * Raw API response type for architecture models.
 * This is a standalone interface (not extending ArchitectureModel) to handle
 * incomplete data from the API, including missing metaModel or entity arrays.
 */
interface RawArchitectureModel {
  diagrams?: RawDiagram[];
  metaModel?: {
    entities?: Record<string, unknown[]>;
    relationships?: Record<string, unknown[]>;
  };
}

/**
 * Normalizes a raw model from the API by mapping snake_case keys to camelCase
 * and backfilling missing entity arrays.
 *
 * This function:
 * 1. Deep clones the input to avoid mutation
 * 2. Ensures metaModel.entities exists and backfills missing UI entity arrays
 * 3. For each diagram: if `typedContent` is undefined and `typed_content` is present,
 *    copies `typed_content` to `typedContent`
 * 4. Deletes `typed_content` from each diagram after copying
 * 5. Returns a properly typed ArchitectureModel
 *
 * @param rawModel - Raw model from API (may include snake_case `typed_content`)
 * @returns ArchitectureModel with camelCase `typedContent` keys and backfilled UI arrays
 */
export function normalizeModelFromApi(rawModel: unknown): ArchitectureModel {
  // Deep clone to avoid mutating the input
  const cloned = JSON.parse(JSON.stringify(rawModel)) as RawArchitectureModel;

  // ============================================================================
  // 2026-01-03: Backfill missing metaModel.entities (spec: metamodel-ui-workflow-transitions-crash-fix)
  // Ensures that old projects without UI entity arrays don't crash the Grid component
  // ============================================================================

  // Ensure metaModel exists
  if (!cloned.metaModel) {
    cloned.metaModel = { entities: {}, relationships: {} };
  }

  // Ensure metaModel.entities exists
  if (!cloned.metaModel.entities) {
    cloned.metaModel.entities = {};
  }

  // Backfill UI domain entity arrays if missing or null
  // Using nullish coalescing assignment (??=) to only assign if undefined/null
  cloned.metaModel.entities.ui_screens ??= [];
  cloned.metaModel.entities.ui_components ??= [];
  cloned.metaModel.entities.ui_actions ??= [];
  cloned.metaModel.entities.ui_workflow_transitions ??= [];

  // ============================================================================
  // Spec 2026-05-04: Infrastructure Domain Frontend Types
  // Backfill the 13 Infrastructure entity arrays + 3 relationship arrays so older
  // saved projects that pre-date the Infrastructure domain load cleanly.
  // ============================================================================
  cloned.metaModel.entities.environments ??= [];
  cloned.metaModel.entities.cloud_accounts ??= [];
  cloned.metaModel.entities.locations ??= [];
  cloned.metaModel.entities.networks ??= [];
  cloned.metaModel.entities.subnets ??= [];
  cloned.metaModel.entities.compute_clusters ??= [];
  cloned.metaModel.entities.compute_resources ??= [];
  cloned.metaModel.entities.deployment_units ??= [];
  cloned.metaModel.entities.load_balancers ??= [];
  cloned.metaModel.entities.listeners ??= [];
  cloned.metaModel.entities.data_store_instances ??= [];
  cloned.metaModel.entities.infrastructure_resources ??= [];
  cloned.metaModel.entities.infrastructure_points ??= [];
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
  cloned.metaModel.entities.iac_sources ??= [];
  // Spec 2026-05-06: Library Frontend Types & Tables
  cloned.metaModel.entities.libraries ??= [];

  // Ensure metaModel.relationships container exists before backfilling new arrays
  if (!cloned.metaModel.relationships) {
    cloned.metaModel.relationships = {};
  }
  cloned.metaModel.relationships.resource_subnet_hostings ??= [];
  cloned.metaModel.relationships.deployment_unit_compute_resources ??= [];
  cloned.metaModel.relationships.load_balancer_resource_routes ??= [];
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain relationship arrays
  cloned.metaModel.relationships.application_compute_deployments ??= [];
  cloned.metaModel.relationships.data_entity_data_store_hostings ??= [];
  cloned.metaModel.relationships.application_infrastructure_resource_uses ??= [];
  cloned.metaModel.relationships.application_load_balancer_exposures ??= [];
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
  cloned.metaModel.relationships.iac_resource_bindings ??= [];
  // Spec 2026-05-06: Library Frontend Types & Tables
  cloned.metaModel.relationships.code_unit_dependencies ??= [];
  // Spec 2026-05-29: Endpoint->Data-Effect Call Graph for Discovery (Task Group 4.5)
  // Backfill the new snake_case relationship array so older saved projects that
  // pre-date the edge load cleanly and downstream consumers can rely on its
  // presence. Wire shape matches AMS (snake_case) per the EndpointDataEffect type.
  cloned.metaModel.relationships.endpoint_data_effects ??= [];

  // ============================================================================
  // Process diagrams: typed_content -> typedContent
  // ============================================================================

  // Handle missing or empty diagrams array gracefully
  if (!cloned.diagrams || !Array.isArray(cloned.diagrams)) {
    cloned.diagrams = [];
    return cloned as unknown as ArchitectureModel;
  }

  // Process each diagram
  for (const diagram of cloned.diagrams) {
    // If typedContent is undefined but typed_content is present, copy it
    if (diagram.typedContent === undefined && diagram.typed_content !== undefined) {
      diagram.typedContent = diagram.typed_content;
    }
    // Delete snake_case key to prevent ambiguity
    delete diagram.typed_content;
  }

  return cloned as unknown as ArchitectureModel;
}

/**
 * Prepares a model for API save by mapping camelCase keys to snake_case.
 *
 * This function:
 * 1. Creates a deep clone to avoid mutating app state
 * 2. For each diagram: if `typedContent` is present, copies to `typed_content`
 * 3. Deletes `typedContent` from each diagram in the payload
 * 4. Returns a payload object ready for API submission
 *
 * @param model - In-memory ArchitectureModel from app state
 * @returns Payload object with snake_case `typed_content` keys ready for API
 */
export function prepareModelForApiSave(model: ArchitectureModel): unknown {
  // Deep clone to avoid mutating app state
  const payload = JSON.parse(JSON.stringify(model)) as RawArchitectureModel;

  // Handle missing or empty diagrams array gracefully
  if (!payload.diagrams || !Array.isArray(payload.diagrams)) {
    return payload;
  }

  // Process each diagram
  for (const diagram of payload.diagrams) {
    // If typedContent is present, copy to snake_case key
    if (diagram.typedContent !== undefined) {
      diagram.typed_content = diagram.typedContent;
    }
    // Delete camelCase key to prevent ambiguity
    delete diagram.typedContent;
  }

  return payload;
}
