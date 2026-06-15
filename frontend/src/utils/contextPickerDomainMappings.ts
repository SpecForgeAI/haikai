/**
 * contextPickerDomainMappings.ts
 *
 * Spec 2026-01-17: Context Picker Modal UI Improvements
 * Task Group 1: Domain-to-entity and domain-to-relationship type mappings
 *
 * Spec 2026-01-17: Context Picker UX - Relationship Labels and Stable Chips
 * Task Group 3: Added application_point_business_logics to behavioural domain
 *
 * Spec 2026-05-04: Infrastructure Domain Frontend Types
 * - Added 'infrastructure' domain mappings (13 entity types, 3 relationship types)
 *
 * Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
 * - Appended 'iac_sources' to DOMAIN_TO_ENTITY_TYPES.infrastructure
 * - Appended 'iac_resource_bindings' to DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure
 *
 * This module provides:
 * - DOMAIN_TO_ENTITY_TYPES: Maps architecture domains to their entity collection keys
 * - DOMAIN_TO_RELATIONSHIP_TYPES: Maps architecture domains to their relationship collection keys
 *
 * These mappings are used by the ContextPickerModal to filter entities and relationships
 * by the selected domain tab.
 *
 * Note: 'interactions' is an ENTITY type (in MetaModelEntities), NOT a relationship type.
 * It appears under the 'behavioural' domain in DOMAIN_TO_ENTITY_TYPES.
 */

import type { ArchitectureDomain } from '../types/architectureDomain';

/**
 * Maps each architecture domain to the entity collection keys that belong to it.
 *
 * Business: business_users, business_processes, process_activities
 * Application: applications, app_components, services, interfaces, endpoints
 * Data: logical_data_entities, physical_data_entities
 * Behavioural: events, states, activities, interactions
 * UI: ui_screens, ui_components, ui_actions
 * Infrastructure: 12 typed entity collections + infrastructure_points polymorphic anchor
 *                 + iac_sources (Spec 2026-05-05)
 */
export const DOMAIN_TO_ENTITY_TYPES: Record<ArchitectureDomain, string[]> = {
  business: ['business_users', 'business_processes', 'process_activities'],
  application: ['applications', 'app_components', 'services', 'interfaces', 'endpoints', 'libraries'],
  data: ['logical_data_entities', 'physical_data_entities'],
  behavioural: ['events', 'states', 'activities', 'interactions'],
  ui: ['ui_screens', 'ui_components', 'ui_actions'],
  infrastructure: [
    'environments',
    'cloud_accounts',
    'locations',
    'networks',
    'subnets',
    'compute_clusters',
    'compute_resources',
    'deployment_units',
    'load_balancers',
    'listeners',
    'data_store_instances',
    'infrastructure_resources',
    'infrastructure_points',
    // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
    'iac_sources',
  ],
};

/**
 * Maps each architecture domain to the relationship collection keys that belong to it.
 *
 * These are the valid relationship types from MetaModelRelationships:
 * - business_user_business_points
 * - application_point_business_points
 * - application_point_business_logics
 * - logical_data_entity_relationships
 * - logical_data_entity_physical_data_entities
 * - logical_data_attribute_physical_data_attributes
 * - data_movements
 * - interface_logical_entities
 * - ui_workflow_transitions
 * - resource_subnet_hostings
 * - deployment_unit_compute_resources
 * - load_balancer_resource_routes
 *
 * Spec 2026-01-17: Context Picker UX - Task Group 3
 * - Added application_point_business_logics to behavioural domain
 *
 * Business: business_user_business_points
 * Application: application_point_business_points, interface_logical_entities
 * Data: logical_data_entity_relationships, logical_data_entity_physical_data_entities,
 *       logical_data_attribute_physical_data_attributes, data_movements
 * Behavioural: application_point_business_logics
 * UI: ui_workflow_transitions
 * Infrastructure: resource_subnet_hostings, deployment_unit_compute_resources,
 *                 load_balancer_resource_routes
 */
export const DOMAIN_TO_RELATIONSHIP_TYPES: Record<ArchitectureDomain, string[]> = {
  business: ['business_user_business_points'],
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - application gets Rels 1, 3, 4
  application: [
    'application_point_business_points',
    'interface_logical_entities',
    'application_compute_deployments',
    'application_infrastructure_resource_uses',
    'application_load_balancer_exposures',
    // Spec 2026-05-06: Library Frontend Types & Tables
    'code_unit_dependencies',
  ],
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - data gets Rel 2
  data: [
    'logical_data_entity_relationships',
    'logical_data_entity_physical_data_entities',
    'logical_data_attribute_physical_data_attributes',
    'data_movements',
    'data_entity_data_store_hostings',
  ],
  behavioural: ['application_point_business_logics'],
  ui: ['ui_workflow_transitions'],
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - infrastructure gets all 4 cross-domain rels
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - iac_resource_bindings
  infrastructure: [
    'resource_subnet_hostings',
    'deployment_unit_compute_resources',
    'load_balancer_resource_routes',
    'application_compute_deployments',
    'data_entity_data_store_hostings',
    'application_infrastructure_resource_uses',
    'application_load_balancer_exposures',
    // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
    'iac_resource_bindings',
  ],
};
