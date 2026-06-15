/**
 * Central Relationship Definitions
 *
 * Spec: Domain-Derived Relationship Visibility
 *
 * This file serves as the SINGLE SOURCE OF TRUTH for:
 * 1. Relationship definitions (key, display name, endpoint entity types)
 * 2. Entity type to domain mapping
 * 3. Domain-based relationship derivation logic
 *
 * The derivation function determines which relationships should be visible
 * for a given architecture domain based on the entity types at each endpoint.
 * A relationship appears in a domain if ANY of its endpoint entity types
 * belongs to that domain.
 *
 * IMPORTANT: This derivation MUST NOT inspect grid column configurations,
 * cellType values, or fkTarget properties.
 */

import { ArchitectureDomain } from '../types/architectureDomain';

/**
 * RelationshipDefinition interface
 *
 * Defines the structure for a canonical relationship type:
 * - relationshipKey: The unique identifier for the relationship (matches grid config keys)
 * - displayName: Human-readable name for UI display
 * - endpointEntityTypes: Array of entity type keys that participate in this relationship
 */
export interface RelationshipDefinition {
  relationshipKey: string;
  displayName: string;
  endpointEntityTypes: string[];
}

/**
 * RELATIONSHIP_DEFINITIONS - All canonical relationships
 *
 * Each relationship declares its endpoint entity types. These entity types
 * are used to derive which domains should show the relationship tab/section.
 *
 * Note: "Logical ER" has been renamed to "Logical / Physical ER" per spec.
 * Note: "Interface <-> Logical Entity" has been renamed to "Interface <-> Entity" per spec 2026-01-11.
 *
 * IMPORTANT: For a relationship to appear in a domain, at least one of its
 * endpointEntityTypes must map to that domain in ENTITY_TYPE_TO_DOMAIN.
 *
 * The 'interactions' relationship includes 'interactions' as an endpoint type
 * to ensure it appears in the BEHAVIOURAL domain (where 'interactions' entity is mapped).
 */
export const RELATIONSHIP_DEFINITIONS: RelationshipDefinition[] = [
  {
    relationshipKey: 'business_user_business_points',
    displayName: 'User <-> Business Point',
    endpointEntityTypes: ['business_users', 'business_points'],
  },
  {
    relationshipKey: 'application_point_business_points',
    displayName: 'App Point <-> Business Point',
    endpointEntityTypes: ['application_points', 'business_points'],
  },
  {
    relationshipKey: 'interactions',
    displayName: 'Interactions',
    // Interactions connect business users, app_business_points (virtual), and application_points
    // Also includes 'interactions' self-reference to ensure derivation for BEHAVIOURAL domain
    // Per LOCKED requirements: BEHAVIOURAL must show Interactions
    endpointEntityTypes: ['business_users', 'app_business_points', 'application_points', 'interactions'],
  },
  {
    relationshipKey: 'logical_data_entity_relationships',
    displayName: 'Logical / Physical ER',
    // Renamed from "Logical ER" - connects logical, physical, and data entity points
    endpointEntityTypes: ['logical_data_entities', 'physical_data_entities', 'data_entity_points'],
  },
  {
    relationshipKey: 'logical_data_entity_physical_data_entities',
    displayName: 'Logical <-> Physical Entities',
    endpointEntityTypes: ['logical_data_entities', 'physical_data_entities'],
  },
  {
    relationshipKey: 'logical_data_attribute_physical_data_attributes',
    displayName: 'Logical <-> Physical Attributes',
    endpointEntityTypes: ['logical_data_attributes', 'physical_data_attributes'],
  },
  {
    // Spec 2026-01-11: Interface Entity Relationship Refactor
    // - Renamed from "Interface <-> Logical Entity" to "Interface <-> Entity"
    // - Now connects interfaces to BOTH logical AND physical data entities via data_entity_points
    relationshipKey: 'interface_logical_entities',
    displayName: 'Interface <-> Entity',
    endpointEntityTypes: ['interfaces', 'logical_data_entities', 'physical_data_entities', 'data_entity_points'],
  },
  {
    // Spec 2026-01-11: Data Movement Interface Schema Extension
    // - Added 'interfaces' to endpoint types to support interfaceWithSchemaId field
    // - Data movements can now reference either data_entity_points OR interfaces
    relationshipKey: 'data_movements',
    displayName: 'Data Movements',
    endpointEntityTypes: ['application_points', 'data_entity_points', 'interfaces'],
  },
  {
    relationshipKey: 'application_point_business_logics',
    displayName: 'App Point <-> Business Logic',
    endpointEntityTypes: ['application_points', 'business_logics'],
  },
  {
    relationshipKey: 'user_journey_links',
    displayName: 'User Journey Links',
    endpointEntityTypes: ['user_journeys'],
  },
  {
    // Spec 2026-05-04: Infrastructure Domain Frontend Types
    // - Polymorphic infrastructure_points endpoint plus concrete subnets endpoint
    relationshipKey: 'resource_subnet_hostings',
    displayName: 'Resource <-> Subnet',
    endpointEntityTypes: ['infrastructure_points', 'subnets'],
  },
  {
    // Spec 2026-05-04: Infrastructure Domain Frontend Types
    // - Deployment unit running on a polymorphic compute infrastructure point
    relationshipKey: 'deployment_unit_compute_resources',
    displayName: 'Deployment Unit <-> Compute',
    endpointEntityTypes: ['deployment_units', 'infrastructure_points'],
  },
  {
    // Spec 2026-05-04: Infrastructure Domain Frontend Types
    // - Load balancer routes via optional listener to a polymorphic target infrastructure point
    relationshipKey: 'load_balancer_resource_routes',
    displayName: 'Load Balancer Routes',
    endpointEntityTypes: ['load_balancers', 'listeners', 'infrastructure_points'],
  },
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain relationships
  {
    // Application/service deployed to a Compute Resource (optionally via a Deployment Unit).
    relationshipKey: 'application_compute_deployments',
    displayName: 'App <-> Compute',
    endpointEntityTypes: ['application_points', 'compute_resources', 'deployment_units'],
  },
  {
    // Data entity hosted on a Data Store Instance.
    relationshipKey: 'data_entity_data_store_hostings',
    displayName: 'Data Entity <-> Data Store',
    endpointEntityTypes: ['data_entity_points', 'data_store_instances'],
  },
  {
    // Application/service uses an Infrastructure Resource (bucket, queue, topic, cache, etc.).
    relationshipKey: 'application_infrastructure_resource_uses',
    displayName: 'App <-> Infrastructure Resource',
    endpointEntityTypes: ['application_points', 'infrastructure_resources'],
  },
  {
    // Application/service exposed through a Load Balancer (and optionally a specific Listener).
    relationshipKey: 'application_load_balancer_exposures',
    displayName: 'App <-> Load Balancer',
    endpointEntityTypes: ['application_points', 'load_balancers', 'listeners'],
  },
  {
    // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
    // - IaC source-of-record bound to an Infrastructure entity via the polymorphic
    //   infrastructure_points supertype. Endpoint types include `iac_sources`
    //   plus the 12 concrete Infra entity types as targets (so the relationship
    //   surfaces under the Infrastructure domain via getRelationshipsForDomain).
    relationshipKey: 'iac_resource_bindings',
    displayName: 'IaC Source <-> Infrastructure',
    endpointEntityTypes: [
      'iac_sources',
      'infrastructure_points',
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
    ],
  },
  {
    // Spec 2026-05-06: Library Frontend Types & Tables
    // - Library Dependency relationship: polymorphic via application_points
    //   anchor; concrete endpoint types are services and libraries (so the
    //   relationship surfaces in the Application domain via getRelationshipsForDomain).
    relationshipKey: 'code_unit_dependencies',
    displayName: 'Library Dependency',
    endpointEntityTypes: ['application_points', 'services', 'libraries'],
  },
];

/**
 * relationshipKeyToDisplayName - Map from relationship key to display name
 *
 * Generated from RELATIONSHIP_DEFINITIONS for quick lookup.
 * Used by MetaModelView and PalettePanel to get human-readable names.
 */
export const relationshipKeyToDisplayName: Record<string, string> = Object.fromEntries(
  RELATIONSHIP_DEFINITIONS.map(def => [def.relationshipKey, def.displayName])
);

/**
 * displayNameToRelationshipKey - Map from display name to relationship key
 *
 * Reverse lookup map for converting tab names back to relationship keys.
 */
export const displayNameToRelationshipKey: Record<string, string> = Object.fromEntries(
  RELATIONSHIP_DEFINITIONS.map(def => [def.displayName, def.relationshipKey])
);

/**
 * ENTITY_TYPE_TO_DOMAIN - Authoritative mapping of entity types to domains
 *
 * This is the SINGLE SOURCE OF TRUTH for which domain each entity type belongs to.
 * Used by getRelationshipsForDomain to derive relationship visibility.
 *
 * Key mappings (per spec):
 * - interfaces -> APPLICATION
 * - data_entity_points -> DATA
 * - business_logics -> BEHAVIOURAL
 * - app_business_points -> BUSINESS (virtual entity appearing in interactions)
 * - interactions -> BEHAVIOURAL (ensures Interactions relationship appears in BEHAVIOURAL domain)
 */
export const ENTITY_TYPE_TO_DOMAIN: Record<string, ArchitectureDomain> = {
  // Business domain entities
  business_users: 'business',
  business_processes: 'business',
  process_activities: 'business',
  business_points: 'business',
  app_business_points: 'business', // Virtual entity for interactions
  user_journeys: 'business',  // Spec: User Journey Links Meta-Model Foundation - fixes ENTITY_TYPE_TO_DOMAIN gap

  // Application domain entities
  applications: 'application',
  app_components: 'application',
  services: 'application',
  interfaces: 'application', // Key mapping per spec
  endpoints: 'application',
  classes: 'application',
  methods: 'application',
  application_points: 'application',
  package_sets: 'application',
  packages: 'application',

  // Data domain entities
  logical_data_entities: 'data',
  logical_data_attributes: 'data',
  physical_data_entities: 'data',
  physical_data_attributes: 'data',
  data_entity_points: 'data', // Key mapping per spec

  // Behavioural domain entities
  events: 'behavioural',
  states: 'behavioural',
  state_transitions: 'behavioural',
  activities: 'behavioural',
  activity_flows: 'behavioural',
  activity_partitions: 'behavioural',
  business_logics: 'behavioural', // Key mapping per spec
  interactions: 'behavioural', // Interactions entity type maps to BEHAVIOURAL domain

  // UI domain entities
  ui_screens: 'ui',
  ui_workflow_transitions: 'ui',
  ui_components: 'ui',
  ui_actions: 'ui',

  // Infrastructure domain entities (Spec 2026-05-04)
  environments: 'infrastructure',
  cloud_accounts: 'infrastructure',
  locations: 'infrastructure',
  networks: 'infrastructure',
  subnets: 'infrastructure',
  compute_clusters: 'infrastructure',
  compute_resources: 'infrastructure',
  deployment_units: 'infrastructure',
  load_balancers: 'infrastructure',
  listeners: 'infrastructure',
  data_store_instances: 'infrastructure',
  infrastructure_resources: 'infrastructure',
  infrastructure_points: 'infrastructure',
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
  iac_sources: 'infrastructure',

  // Spec 2026-05-06: Library Frontend Types & Tables
  libraries: 'application',
};

/**
 * getRelationshipsForDomain - Derive which relationships should be visible for a domain
 *
 * A relationship MUST appear in domain D if ANY endpointEntityType of that
 * relationship maps to domain D.
 *
 * IMPORTANT: This function MUST NOT:
 * - Inspect grid column configurations
 * - Rely on fkTarget presence or cellType values
 * - Use any picker type information
 *
 * @param domain - The architecture domain to get relationships for
 * @returns Array of relationship keys that should be visible for this domain
 */
export function getRelationshipsForDomain(domain: ArchitectureDomain): string[] {
  return RELATIONSHIP_DEFINITIONS
    .filter(relationship => {
      // Check if ANY endpoint entity type belongs to this domain
      return relationship.endpointEntityTypes.some(entityType => {
        const entityDomain = ENTITY_TYPE_TO_DOMAIN[entityType];
        return entityDomain === domain;
      });
    })
    .map(relationship => relationship.relationshipKey);
}

/**
 * getRelationshipDisplayNamesForDomain - Get display names of relationships for a domain
 *
 * Convenience function that returns display names instead of keys.
 * Used by MetaModelView for rendering tab names.
 *
 * @param domain - The architecture domain to get relationship display names for
 * @returns Array of relationship display names that should be visible for this domain
 */
export function getRelationshipDisplayNamesForDomain(domain: ArchitectureDomain): string[] {
  const relationshipKeys = getRelationshipsForDomain(domain);
  return relationshipKeys.map(key => relationshipKeyToDisplayName[key]).filter(Boolean);
}

/**
 * RELATIONSHIP_TAB_ORDER - Defines the canonical order for relationship tabs
 *
 * This ensures consistent ordering across MetaModelView and palette.
 * Spec 2026-01-11: Renamed "Interface <-> Logical Entity" to "Interface <-> Entity"
 */
export const RELATIONSHIP_TAB_ORDER: string[] = [
  'User <-> Business Point',
  'App Point <-> Business Point',
  'Interactions',
  'Logical / Physical ER',
  'Logical <-> Physical Entities',
  'Logical <-> Physical Attributes',
  'Interface <-> Entity',  // Spec 2026-01-11: Renamed from "Interface <-> Logical Entity"
  'Data Movements',
  'App Point <-> Business Logic',
  'User Journey Links',
  'Resource <-> Subnet',  // Spec 2026-05-04: Infrastructure Domain Frontend Types
  'Deployment Unit <-> Compute',  // Spec 2026-05-04: Infrastructure Domain Frontend Types
  'Load Balancer Routes',  // Spec 2026-05-04: Infrastructure Domain Frontend Types
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain relationship tabs
  'App <-> Compute',
  'Data Entity <-> Data Store',
  'App <-> Infrastructure Resource',
  'App <-> Load Balancer',
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 1 new relationship tab
  'IaC Source <-> Infrastructure',
  // Spec 2026-05-06: Library Frontend Types & Tables - Library Dependency relationship tab
  'Library Dependency',
];

/**
 * getOrderedRelationshipDisplayNamesForDomain - Get ordered display names for a domain
 *
 * Returns relationship display names in the canonical tab order.
 *
 * @param domain - The architecture domain
 * @returns Array of relationship display names in canonical order
 */
export function getOrderedRelationshipDisplayNamesForDomain(domain: ArchitectureDomain): string[] {
  const visibleNames = getRelationshipDisplayNamesForDomain(domain);
  // Filter RELATIONSHIP_TAB_ORDER to only include visible names, maintaining order
  return RELATIONSHIP_TAB_ORDER.filter(name => visibleNames.includes(name));
}
