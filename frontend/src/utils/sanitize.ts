/**
 * Model Sanitization Utilities
 *
 * Provides utilities for sanitizing the ArchitectureModel before sending to backend.
 * Converts empty-string FK references to undefined to avoid DB constraint violations.
 */

import type { ArchitectureModel, MetaModel, Diagram } from '../types/model';

/**
 * Check if a key represents a foreign key field.
 * FK fields end with '_id' or '_ids' (snake_case) or 'Id' (camelCase).
 */
function isForeignKeyField(key: string): boolean {
  return key.endsWith('_id') || key.endsWith('_ids') || key.endsWith('Id');
}

/**
 * Sanitize an object by converting empty-string FK fields to undefined.
 * Creates a shallow copy with sanitized values.
 *
 * @param obj - The object to sanitize
 * @returns A new object with empty-string FK fields converted to undefined
 */
function sanitizeObject<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  const result = { ...obj } as Record<string, unknown>;

  for (const [key, value] of Object.entries(result)) {
    if (isForeignKeyField(key) && value === '') {
      result[key] = undefined;
    }
  }

  return result as T;
}

/**
 * Sanitize an array of objects by converting empty-string FK fields to undefined.
 *
 * @param arr - The array of objects to sanitize
 * @returns A new array with sanitized objects
 */
function sanitizeArray<T>(arr: T[]): T[] {
  return arr.map(item => sanitizeObject(item));
}

/**
 * Sanitize the MetaModel by processing all entity and relationship arrays.
 *
 * @param metaModel - The MetaModel to sanitize
 * @returns A new MetaModel with sanitized FK fields
 */
function sanitizeMetaModel(metaModel: MetaModel): MetaModel {
  return {
    entities: {
      applications: sanitizeArray(metaModel.entities.applications),
      app_components: sanitizeArray(metaModel.entities.app_components),
      services: sanitizeArray(metaModel.entities.services),
      interfaces: sanitizeArray(metaModel.entities.interfaces),
      endpoints: sanitizeArray(metaModel.entities.endpoints),
      application_points: sanitizeArray(metaModel.entities.application_points),
      business_users: sanitizeArray(metaModel.entities.business_users),
      business_processes: sanitizeArray(metaModel.entities.business_processes),
      business_points: sanitizeArray(metaModel.entities.business_points),
      process_activities: sanitizeArray(metaModel.entities.process_activities),
      logical_data_entities: sanitizeArray(metaModel.entities.logical_data_entities),
      logical_data_attributes: sanitizeArray(metaModel.entities.logical_data_attributes),
      physical_data_entities: sanitizeArray(metaModel.entities.physical_data_entities),
      physical_data_attributes: sanitizeArray(metaModel.entities.physical_data_attributes),
      interactions: sanitizeArray(metaModel.entities.interactions),
      app_business_points: sanitizeArray(metaModel.entities.app_business_points),
      events: sanitizeArray(metaModel.entities.events),
      classes: sanitizeArray(metaModel.entities.classes),
      methods: sanitizeArray(metaModel.entities.methods),
      states: sanitizeArray(metaModel.entities.states),
      state_transitions: sanitizeArray(metaModel.entities.state_transitions),
      activities: sanitizeArray(metaModel.entities.activities),
      activity_flows: sanitizeArray(metaModel.entities.activity_flows),
      activity_partitions: sanitizeArray(metaModel.entities.activity_partitions),
      ui_screens: sanitizeArray(metaModel.entities.ui_screens),  // Spec 2026-01-02: UI Architecture
      ui_components: sanitizeArray(metaModel.entities.ui_components),  // Spec 2026-01-03: Meta-Model UI Domain Tab
      ui_actions: sanitizeArray(metaModel.entities.ui_actions),  // Spec 2026-01-03: Meta-Model UI Domain Tab
      business_logics: sanitizeArray(metaModel.entities.business_logics),  // Spec: Business Logic Entity v1
      package_sets: sanitizeArray(metaModel.entities.package_sets),  // Spec: Package Sets Persistence
      packages: sanitizeArray(metaModel.entities.packages),  // Spec: Package Sets Persistence
      ui_characteristics: sanitizeArray(metaModel.entities.ui_characteristics),  // Spec 2026-01-20: UI Characteristics
      user_journeys: sanitizeArray(metaModel.entities.user_journeys),  // Business domain: User Journeys
      activity_steps: sanitizeArray(metaModel.entities.activity_steps),  // Business domain: Activity Steps
      // Spec 2026-05-04: Infrastructure Domain Frontend Types - 13 entity collections
      environments: sanitizeArray(metaModel.entities.environments),
      cloud_accounts: sanitizeArray(metaModel.entities.cloud_accounts),
      locations: sanitizeArray(metaModel.entities.locations),
      networks: sanitizeArray(metaModel.entities.networks),
      subnets: sanitizeArray(metaModel.entities.subnets),
      compute_clusters: sanitizeArray(metaModel.entities.compute_clusters),
      compute_resources: sanitizeArray(metaModel.entities.compute_resources),
      deployment_units: sanitizeArray(metaModel.entities.deployment_units),
      load_balancers: sanitizeArray(metaModel.entities.load_balancers),
      listeners: sanitizeArray(metaModel.entities.listeners),
      data_store_instances: sanitizeArray(metaModel.entities.data_store_instances),
      infrastructure_resources: sanitizeArray(metaModel.entities.infrastructure_resources),
      infrastructure_points: sanitizeArray(metaModel.entities.infrastructure_points),
      // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
      iac_sources: sanitizeArray(metaModel.entities.iac_sources),
      // Spec 2026-05-06: Library Frontend Types & Tables
      libraries: sanitizeArray(metaModel.entities.libraries),
    },
    relationships: {
      business_user_business_points: sanitizeArray(metaModel.relationships.business_user_business_points),
      application_point_business_points: sanitizeArray(metaModel.relationships.application_point_business_points),
      logical_data_entity_relationships: sanitizeArray(metaModel.relationships.logical_data_entity_relationships),
      logical_data_entity_physical_data_entities: sanitizeArray(metaModel.relationships.logical_data_entity_physical_data_entities),
      logical_data_attribute_physical_data_attributes: sanitizeArray(metaModel.relationships.logical_data_attribute_physical_data_attributes),
      data_movements: sanitizeArray(metaModel.relationships.data_movements),
      interface_logical_entities: sanitizeArray(metaModel.relationships.interface_logical_entities),
      ui_workflow_transitions: sanitizeArray(metaModel.relationships.ui_workflow_transitions),  // Spec 2026-01-02: UI Architecture
      application_point_business_logics: sanitizeArray(metaModel.relationships.application_point_business_logics),  // Spec: Business Logic Entity v1
      // Spec 2026-05-04: Infrastructure Domain Frontend Types - 3 relationship collections
      resource_subnet_hostings: sanitizeArray(metaModel.relationships.resource_subnet_hostings),
      deployment_unit_compute_resources: sanitizeArray(metaModel.relationships.deployment_unit_compute_resources),
      load_balancer_resource_routes: sanitizeArray(metaModel.relationships.load_balancer_resource_routes),
      // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
      iac_resource_bindings: sanitizeArray(metaModel.relationships.iac_resource_bindings),
    },
  };
}

/**
 * Sanitize a diagram by processing nodes, edges, interaction_edges, and decorations.
 *
 * @param diagram - The Diagram to sanitize
 * @returns A new Diagram with sanitized FK fields
 */
function sanitizeDiagram(diagram: Diagram): Diagram {
  return {
    ...diagram,
    diagram_nodes: sanitizeArray(diagram.diagram_nodes || []),
    diagram_edges: sanitizeArray(diagram.diagram_edges || []),
    interaction_edges: sanitizeArray(diagram.interaction_edges || []),
    decorations: sanitizeArray(diagram.decorations || []),
  };
}

/**
 * Sanitize the entire ArchitectureModel for backend save.
 *
 * Converts empty-string FK references (fields ending with '_id' or '_ids')
 * to undefined throughout the model. This prevents DB FK constraint violations
 * where "" is not a valid foreign key value.
 *
 * @param model - The ArchitectureModel to sanitize
 * @returns A new ArchitectureModel with sanitized FK fields
 */
export function sanitizeModelForBackendSave(model: ArchitectureModel): ArchitectureModel {
  return {
    ...model,
    metaModel: sanitizeMetaModel(model.metaModel),
    diagrams: model.diagrams.map(sanitizeDiagram),
  };
}
