/**
 * Palette Data Utilities
 *
 * Spec 2026-01-08: Domain-Derived Relationship Visibility
 * - Relationship section filtering now uses centralized derivation from relationshipDefinitions.ts
 * - Entity section filtering in domainToPaletteSections remains unchanged
 * - getRelationshipsForDomain provides the authoritative source for relationship visibility per domain
 *
 * Original Task Group 5: Domain-to-palette-section mapping
 * Maps each architecture domain to its corresponding palette sections.
 */

import { MetaModel, ENTITY_TYPES } from '../types/model';
import { ArchitectureDomain } from '../types/architectureDomain';
import { DiagramType } from '../types/diagramType';
import { filterItemsBySearch } from './paletteFilters';
import { getRelationshipsForDomain, relationshipKeyToDisplayName } from '../config/relationshipDefinitions';

export interface PaletteSection {
  id: string;
  label: string;
  items: Array<{ id: string; name: string }>;
  type: 'entity' | 'relationship';
}

/**
 * DOMAIN_ENTITY_SECTIONS: Entity types allowed per domain (UNCHANGED from original)
 *
 * Spec 2026-01-08: Entity section filtering remains static. Only relationship sections
 * are now derived from centralized relationshipDefinitions.ts.
 *
 * Business Domain:
 * - business_users, business_processes, process_activities
 *
 * Application Domain:
 * - applications, app_components, services, interfaces, endpoints, classes, methods
 * - ui_screens, ui_workflow_transitions (UI Architecture entities)
 *
 * Data Domain:
 * - logical_data_entities, physical_data_entities, logical_data_attributes, physical_data_attributes
 *
 * Behavioural Domain:
 * - events, states, state_transitions, activities, activity_flows, activity_partitions
 *
 * UI Domain (Spec 2026-01-03):
 * - ui_screens, ui_components, ui_actions
 */
export const DOMAIN_ENTITY_SECTIONS: Record<ArchitectureDomain, string[]> = {
  business: [
    'business_users',
    'business_processes',
    'process_activities',
  ],
  application: [
    'applications',
    'app_components',
    'services',
    'interfaces',
    'endpoints',
    'classes',      // Spec 2025-12-23: Added Classes to Application domain palette
    'methods',      // Spec 2025-12-23: Added Methods to Application domain palette
    'ui_screens',   // UI Architecture: UIScreen entities
  ],
  data: [
    'logical_data_entities',
    'logical_data_attributes',
    'physical_data_entities',
    'physical_data_attributes',
  ],
  behavioural: [
    // Behavioural domain entities
    'events',
    'states',
    'state_transitions',
    'activities',
    'activity_flows',
    'activity_partitions',
  ],
  // Spec 2026-01-03: Meta-Model UI Domain Tab
  ui: [
    'ui_screens',
    'ui_components',
    'ui_actions',
  ],
  // Spec 2026-05-05: Infrastructure Domain Diagram Support - 12 entity sections in containment-friendly order
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
  ],
};

/**
 * getRelationshipSectionsForDomain - Get relationship section IDs for a domain
 *
 * Spec 2026-01-08: This function derives relationship sections using the centralized
 * getRelationshipsForDomain function from relationshipDefinitions.ts.
 *
 * Special handling:
 * - 'ui_workflow_transitions' is added for APPLICATION and UI domains as a non-canonical
 *   relationship that is not part of the 9 core relationships
 *
 * @param domain - The architecture domain
 * @returns Array of relationship section IDs that should appear for this domain
 */
function getRelationshipSectionsForDomain(domain: ArchitectureDomain): string[] {
  // Get canonical relationship keys from centralized derivation
  const canonicalRelationshipKeys = getRelationshipsForDomain(domain);

  // Special handling for ui_workflow_transitions (not part of canonical 9 relationships)
  // This relationship appears in APPLICATION and UI domains for UI workflow diagrams
  const specialRelationships: string[] = [];
  if (domain === 'application' || domain === 'ui') {
    specialRelationships.push('ui_workflow_transitions');
  }

  return [...canonicalRelationshipKeys, ...specialRelationships];
}

/**
 * domainToPaletteSections - Combined entity and relationship sections per domain
 *
 * BACKWARD COMPATIBLE: This export maintains the same interface as before.
 * Internally, relationship sections are now derived dynamically.
 *
 * @deprecated Prefer using DOMAIN_ENTITY_SECTIONS and getRelationshipSectionsForDomain
 *             for more explicit separation of entity vs relationship filtering
 */
export const domainToPaletteSections: Record<ArchitectureDomain, string[]> = {
  business: [
    ...DOMAIN_ENTITY_SECTIONS.business,
    ...getRelationshipSectionsForDomain('business'),
  ],
  application: [
    ...DOMAIN_ENTITY_SECTIONS.application,
    ...getRelationshipSectionsForDomain('application'),
  ],
  data: [
    ...DOMAIN_ENTITY_SECTIONS.data,
    ...getRelationshipSectionsForDomain('data'),
  ],
  behavioural: [
    ...DOMAIN_ENTITY_SECTIONS.behavioural,
    ...getRelationshipSectionsForDomain('behavioural'),
  ],
  ui: [
    ...DOMAIN_ENTITY_SECTIONS.ui,
    ...getRelationshipSectionsForDomain('ui'),
  ],
  // Spec 2026-05-05: Infrastructure Domain Diagram Support - 12 entity sections + 3 relationship sections (15 total)
  infrastructure: [
    ...DOMAIN_ENTITY_SECTIONS.infrastructure,
    ...getRelationshipSectionsForDomain('infrastructure'),
  ],
};

/**
 * Task Group 4: Diagram Type Palette Rules Configuration
 *
 * Maps each diagram type to its allowed palette section IDs.
 * When a diagram type is selected, only these sections are shown in the palette.
 *
 * - General: All sections (no filtering) - backward compatible default
 * - ER: Logical/Physical data entities and attributes; Logical / Physical ER relationships
 * - Sequence: Business users, applications, app components, services, interfaces, endpoints, classes, methods, events; no relationships
 * - Activity: Activities and partitions; Activity flows
 * - State: States; State transitions
 * - UI_Workflow: UI screens; UI workflow transitions
 * - UI_SCREEN: UI screens, UI components, UI actions
 *
 * Note: 'null' is used to indicate "all sections" for the General type to
 * avoid duplicating the full list of section IDs.
 */
export const DIAGRAM_TYPE_PALETTE_RULES: Record<DiagramType, string[] | null> = {
  // General: All sections - null indicates no filtering
  General: null,

  // Security Summary (Security health dashboard, 2026-07-19, Spec 3 of 3):
  // generated from the Security Overview screen (application boxes +
  // data-movement edges); opened in the Diagrams area for basic editing.
  // Palette limited to the application hierarchy.
  SECURITY_SUMMARY: ['applications', 'app_components', 'services'],

  // ER: Entity-Relationship diagrams (data modeling)
  // Entities: logical_data_entities, logical_data_attributes, physical_data_entities, physical_data_attributes
  // Relationships: logical_data_entity_relationships
  ER: [
    'logical_data_entities',
    'logical_data_attributes',
    'physical_data_entities',
    'physical_data_attributes',
    'logical_data_entity_relationships',
  ],

  // Sequence: Sequence diagrams (interaction modeling)
  // Entities: business_users, applications, app_components, services, interfaces, endpoints, classes, methods, events
  // Relationships: none (for now)
  Sequence: [
    'business_users',
    'applications',
    'app_components',
    'services',
    'interfaces',
    'endpoints',
    'classes',
    'methods',
    'events',
  ],

  // Activity: Activity diagrams (workflow modeling)
  // Entities: activities, activity_partitions
  // Relationships: activity_flows
  Activity: [
    'activities',
    'activity_partitions',
    'activity_flows',
  ],

  // State: State machine diagrams (behavioural modeling)
  // Entities: states
  // Relationships: state_transitions
  State: [
    'states',
    'state_transitions',
  ],

  // UI_Workflow: UI workflow diagrams (navigation flow modeling)
  // Entities: ui_screens
  // Relationships: ui_workflow_transitions
  UI_Workflow: [
    'ui_screens',
    'ui_workflow_transitions',
  ],

  // UI_SCREEN: UI screen diagrams (screen specification modeling)
  // Entities: ui_screens, ui_components, ui_actions
  // Relationships: none
  UI_SCREEN: [
    'ui_screens',
    'ui_components',
    'ui_actions',
  ],

  // Spec 2026-05-05: Infrastructure Domain Diagram Support + Cross-Domain Integration
  // Infrastructure: Cloud topology diagrams - 12 entity sections + 3 Infra-internal relationship sections
  // + 4 cross-domain relationship sections (Spec 2026-05-05 cross-domain) = 19 total
  Infrastructure: [
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
    'resource_subnet_hostings',
    'deployment_unit_compute_resources',
    'load_balancer_resource_routes',
    // Cross-domain relationships - all 4 visible on Infrastructure diagrams
    'application_compute_deployments',
    'data_entity_data_store_hostings',
    'application_infrastructure_resource_uses',
    'application_load_balancer_exposures',
  ],

  // USER_JOURNEY: Generated diagram type (not manually created from palette)
  USER_JOURNEY: [],

  // USER_JOURNEY_OVERVIEW: Generated diagram type (not manually created from palette)
  USER_JOURNEY_OVERVIEW: [],
};

/**
 * Map entity type keys to ENTITY_TYPES constants
 * Note: application_points and business_points mappings retained for internal rendering logic
 * These derived entities are not displayed in user-facing palette but are used internally
 */
export function getEntityTypeConstant(entityKey: string): string {
  const mapping: Record<string, string> = {
    business_users: ENTITY_TYPES.BUSINESS_USER,
    business_processes: ENTITY_TYPES.BUSINESS_PROCESS,
    process_activities: ENTITY_TYPES.PROCESS_ACTIVITY,
    business_points: ENTITY_TYPES.BUSINESS_POINT,  // Internal mapping for Business Point super-entity
    applications: ENTITY_TYPES.APPLICATION,
    app_components: ENTITY_TYPES.APP_COMPONENT,
    services: ENTITY_TYPES.SERVICE,
    interfaces: ENTITY_TYPES.INTERFACE,
    endpoints: ENTITY_TYPES.ENDPOINT,
    classes: ENTITY_TYPES.CLASS,    // Spec 2025-12-23: Added Class entity type mapping
    methods: ENTITY_TYPES.METHOD,   // Spec 2025-12-23: Added Method entity type mapping
    application_points: ENTITY_TYPES.APPLICATION_POINT,
    logical_data_entities: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
    physical_data_entities: ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
    interactions: ENTITY_TYPES.INTERACTION,  // Interaction entity type mapping (retained for internal use)
    events: ENTITY_TYPES.EVENT,  // Task Group 5: Event entity type mapping
    states: ENTITY_TYPES.STATE,  // State entity type mapping
    state_transitions: ENTITY_TYPES.STATE_TRANSITION,  // State Transition entity type mapping
    activities: ENTITY_TYPES.ACTIVITY,  // Activity entity type mapping
    activity_flows: ENTITY_TYPES.ACTIVITY_FLOW,  // Activity Flow entity type mapping
    activity_partitions: ENTITY_TYPES.ACTIVITY_PARTITION,  // Activity Partition entity type mapping
    ui_screens: ENTITY_TYPES.UI_SCREEN,  // UI Architecture: UIScreen entity type mapping
    ui_workflow_transitions: ENTITY_TYPES.UI_WORKFLOW_TRANSITION,  // UI Architecture: UIWorkflowTransition entity type mapping
    ui_components: ENTITY_TYPES.UI_COMPONENT,  // Spec 2026-01-03: UIComponent entity type mapping
    ui_actions: ENTITY_TYPES.UI_ACTION,  // Spec 2026-01-03: UIAction entity type mapping
    // Spec 2026-05-05: Infrastructure Domain Diagram Support
    // 12 section-ID-to-SCREAMING_SNAKE_CASE-constant mappings; values match InfrastructurePointKind discriminator values
    environments: 'ENVIRONMENT',
    cloud_accounts: 'CLOUD_ACCOUNT',
    locations: 'LOCATION',
    networks: 'NETWORK',
    subnets: 'SUBNET',
    compute_clusters: 'COMPUTE_CLUSTER',
    compute_resources: 'COMPUTE_RESOURCE',
    deployment_units: 'DEPLOYMENT_UNIT',
    load_balancers: 'LOAD_BALANCER',
    listeners: 'LISTENER',
    data_store_instances: 'DATA_STORE_INSTANCE',
    infrastructure_resources: 'INFRASTRUCTURE_RESOURCE',
  };

  return mapping[entityKey] || entityKey;
}

/**
 * Helper to get entity name for palette display.
 * Handles entities that may not have a name field (like StateTransition, ActivityFlow).
 * Falls back to using the id if name is not available.
 */
function getEntityDisplayName(entity: { id: string; name?: string }): string {
  return entity.name || entity.id;
}

/**
 * Get the display label for a relationship section
 *
 * Spec 2026-01-08: Uses centralized relationshipKeyToDisplayName for canonical relationships.
 * Falls back to special handling for non-canonical relationships.
 */
function getRelationshipSectionLabel(sectionId: string): string {
  // Check if this is a canonical relationship with a centralized display name
  const centralizedName = relationshipKeyToDisplayName[sectionId];
  if (centralizedName) {
    return centralizedName;
  }

  // Special handling for non-canonical relationships
  const specialLabels: Record<string, string> = {
    'ui_workflow_transitions': 'UI Workflow Transitions',
  };

  return specialLabels[sectionId] || sectionId;
}

/**
 * Get all palette sections with filtered items
 * Note: application_points and business_points sections are removed from user-facing UI
 * - Application Points are derived internally from Applications, App Components, and Services
 * - Business Points are derived internally from Business Processes and Process Activities
 *
 * Task Group 2: Interactions moved from entitySections to relationshipSections
 * - Interactions are now rendered as relationship edges (dotted lines) rather than entity nodes
 * - Section type changed from 'entity' to 'relationship'
 * - Section label changed from "User Interactions" to "Interactions" for consistency with tab name
 *
 * Task Group 5: Added optional selectedDomain parameter for domain-based filtering
 * When selectedDomain is provided, only sections belonging to that domain are returned.
 *
 * Spec 2025-12-23: Added Classes and Methods entity sections for Application domain palette
 *
 * Spec 2025-12-24: Added States, State Transitions, Activities, Activity Flows, Activity Partitions
 * for Behavioural domain palette
 *
 * UI Architecture Phase 1: Added UIScreens and UIWorkflowTransitions for UI_Workflow diagrams
 *
 * Task Group 5 (Diagram Types): Added optional diagramType parameter for diagram type filtering
 * When diagramType is provided, sections are filtered using DIAGRAM_TYPE_PALETTE_RULES.
 * If both selectedDomain AND diagramType are provided, the result is the intersection
 * (both filters apply).
 *
 * Spec 2026-01-03: Added UIComponents and UIActions for UI domain palette
 *
 * Spec 2026-01-08: Relationship sections now use centralized labels from relationshipDefinitions.ts
 * - "Logical ER" renamed to "Logical / Physical ER"
 */
export function getPaletteSections(
  metaModel: MetaModel | null | undefined,
  searchQuery: string,
  selectedDomain?: ArchitectureDomain,
  diagramType?: DiagramType
): PaletteSection[] {
  if (!metaModel) {
    return [];
  }

  const sections: PaletteSection[] = [];

  // Entity sections - application_points, business_points, and interactions removed from user-facing palette
  // - Application Points and Business Points are derived entities managed internally
  // - Interactions are now treated as relationships and appear in relationship sections
  const entitySections: PaletteSection[] = [
    {
      id: 'business_users',
      label: 'Business Users',
      items: (metaModel.entities.business_users || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'business_processes',
      label: 'Business Processes',
      items: (metaModel.entities.business_processes || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'process_activities',
      label: 'Process Activities',
      items: (metaModel.entities.process_activities || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    // business_points section NOT included - Business Points are derived internally
    // When users add Business Processes or Process Activities, corresponding Business Points
    // are automatically created and used for relationship targeting
    //
    // Task Group 2.2: User Interactions section REMOVED from entitySections
    // Moved to relationshipSections below
    {
      id: 'applications',
      label: 'Applications',
      items: (metaModel.entities.applications || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'app_components',
      label: 'App Components',
      items: (metaModel.entities.app_components || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'services',
      label: 'Services',
      items: (metaModel.entities.services || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'interfaces',
      label: 'Interfaces',
      items: (metaModel.entities.interfaces || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'endpoints',
      label: 'Endpoints',
      items: (metaModel.entities.endpoints || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    // Spec 2025-12-23: Added Classes entity section for Application domain palette
    {
      id: 'classes',
      label: 'Classes',
      items: (metaModel.entities.classes || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    // Spec 2025-12-23: Added Methods entity section for Application domain palette
    {
      id: 'methods',
      label: 'Methods',
      items: (metaModel.entities.methods || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    // UI Architecture: UIScreens entity section for UI_Workflow diagrams
    {
      id: 'ui_screens',
      label: 'UI Screens',
      items: (metaModel.entities.ui_screens || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    // Spec 2026-01-03: UIComponents entity section for UI domain palette
    {
      id: 'ui_components',
      label: 'UI Components',
      items: (metaModel.entities.ui_components || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    // Spec 2026-01-03: UIActions entity section for UI domain palette
    {
      id: 'ui_actions',
      label: 'UI Actions',
      items: (metaModel.entities.ui_actions || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    // application_points section NOT included - Application Points are derived internally
    // When users add Applications/Components/Services, corresponding Application Points
    // are automatically created and used for diagram nodes
    {
      id: 'logical_data_entities',
      label: 'Logical Entities',
      items: (metaModel.entities.logical_data_entities || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    // Task Group 4: Added logical_data_attributes section for ER diagrams
    {
      id: 'logical_data_attributes',
      label: 'Logical Attributes',
      items: (metaModel.entities.logical_data_attributes || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'physical_data_entities',
      label: 'Physical Entities',
      items: (metaModel.entities.physical_data_entities || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    // Task Group 4: Added physical_data_attributes section for ER diagrams
    {
      id: 'physical_data_attributes',
      label: 'Physical Attributes',
      items: (metaModel.entities.physical_data_attributes || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    // Task Group 5: Events entity section for Behavioural domain
    {
      id: 'events',
      label: 'Events',
      items: (metaModel.entities.events || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    // Behavioural domain: States entity section
    {
      id: 'states',
      label: 'States',
      items: (metaModel.entities.states || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    // Behavioural domain: State Transitions entity section
    // Note: StateTransition does not have a name field, so we use id as the display name
    {
      id: 'state_transitions',
      label: 'State Transitions',
      items: (metaModel.entities.state_transitions || []).map(e => ({ id: e.id, name: e.id })),
      type: 'entity' as const,
    },
    // Behavioural domain: Activities entity section (UML Activity Diagram nodes)
    {
      id: 'activities',
      label: 'Activities',
      items: (metaModel.entities.activities || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    // Behavioural domain: Activity Flows entity section (UML Activity Diagram edges)
    // Note: ActivityFlow does not have a name field, so we use id as the display name
    {
      id: 'activity_flows',
      label: 'Activity Flows',
      items: (metaModel.entities.activity_flows || []).map(e => ({ id: e.id, name: e.id })),
      type: 'entity' as const,
    },
    // Behavioural domain: Activity Partitions entity section (UML swimlanes)
    {
      id: 'activity_partitions',
      label: 'Activity Partitions',
      items: (metaModel.entities.activity_partitions || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    // Spec 2026-05-05: Infrastructure Domain Diagram Support - 12 entity sections
    {
      id: 'environments',
      label: 'Environments',
      items: (metaModel.entities.environments || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'cloud_accounts',
      label: 'Cloud Accounts',
      items: (metaModel.entities.cloud_accounts || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'locations',
      label: 'Locations',
      items: (metaModel.entities.locations || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'networks',
      label: 'Networks',
      items: (metaModel.entities.networks || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'subnets',
      label: 'Subnets',
      items: (metaModel.entities.subnets || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'compute_clusters',
      label: 'Compute Clusters',
      items: (metaModel.entities.compute_clusters || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'compute_resources',
      label: 'Compute Resources',
      items: (metaModel.entities.compute_resources || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'deployment_units',
      label: 'Deployment Units',
      items: (metaModel.entities.deployment_units || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'load_balancers',
      label: 'Load Balancers',
      items: (metaModel.entities.load_balancers || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'listeners',
      label: 'Listeners',
      items: (metaModel.entities.listeners || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'data_store_instances',
      label: 'Data Stores',
      items: (metaModel.entities.data_store_instances || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
    {
      id: 'infrastructure_resources',
      label: 'Infrastructure Resources',
      items: (metaModel.entities.infrastructure_resources || []).map(e => ({ id: e.id, name: getEntityDisplayName(e) })),
      type: 'entity' as const,
    },
  ];

  // Relationship sections - note relationships may not have 'name' field
  // We'll need to handle this differently
  // Legacy relationship types (business_user_processes, application_point_business_processes) have been removed
  //
  // Task Group 2.2 & 2.3: Interactions added to relationshipSections
  // - Positioned after "App Point <-> Business Point"
  // - Type changed from 'entity' to 'relationship'
  // - Label changed from "User Interactions" to "Interactions"
  //
  // Spec 2026-01-08: Labels now use centralized getRelationshipSectionLabel function
  // - "Logical ER" renamed to "Logical / Physical ER"
  const relationshipSections: PaletteSection[] = [
    // Business Point relationship types (primary)
    {
      id: 'business_user_business_points',
      label: getRelationshipSectionLabel('business_user_business_points'),
      items: (metaModel.relationships.business_user_business_points || []).map(r => ({
        id: r.id,
        name: r.id, // Use id as name for relationships
      })),
      type: 'relationship' as const,
    },
    {
      id: 'application_point_business_points',
      label: getRelationshipSectionLabel('application_point_business_points'),
      items: (metaModel.relationships.application_point_business_points || []).map(r => ({
        id: r.id,
        name: r.id,
      })),
      type: 'relationship' as const,
    },
    // Task Group 2.2 & 2.3 & 2.4: Interactions section
    // - Moved here from entitySections
    // - Type is 'relationship' (not 'entity')
    // - Label is "Interactions" (not "User Interactions") for consistency with tab name
    {
      id: 'interactions',
      label: getRelationshipSectionLabel('interactions'),
      items: (metaModel.entities.interactions || []).map(i => ({
        id: i.id,
        name: i.name,
      })),
      type: 'relationship' as const,
    },
    // UI Architecture: UIWorkflowTransitions relationship section
    {
      id: 'ui_workflow_transitions',
      label: getRelationshipSectionLabel('ui_workflow_transitions'),
      items: (metaModel.relationships.ui_workflow_transitions || []).map(r => ({
        id: r.id,
        name: r.name || r.id,
      })),
      type: 'relationship' as const,
    },
    // Spec 2026-01-08: Label updated to "Logical / Physical ER" via centralized function
    {
      id: 'logical_data_entity_relationships',
      label: getRelationshipSectionLabel('logical_data_entity_relationships'),
      items: (metaModel.relationships.logical_data_entity_relationships || []).map(r => ({
        id: r.id,
        name: r.id,
      })),
      type: 'relationship' as const,
    },
    {
      id: 'logical_data_entity_physical_data_entities',
      label: getRelationshipSectionLabel('logical_data_entity_physical_data_entities'),
      items: (metaModel.relationships.logical_data_entity_physical_data_entities || []).map(r => ({
        id: r.id,
        name: r.id,
      })),
      type: 'relationship' as const,
    },
    {
      id: 'logical_data_attribute_physical_data_attributes',
      label: 'Logical <-> Physical Attrs', // Shortened label for palette display
      items: (metaModel.relationships.logical_data_attribute_physical_data_attributes || []).map(r => ({
        id: r.id,
        name: r.id,
      })),
      type: 'relationship' as const,
    },
    {
      id: 'interface_logical_entities',
      label: getRelationshipSectionLabel('interface_logical_entities'),
      items: (metaModel.relationships.interface_logical_entities || []).map(r => ({
        id: r.id,
        name: r.id,
      })),
      type: 'relationship' as const,
    },
    {
      id: 'data_movements',
      label: getRelationshipSectionLabel('data_movements'),
      items: (metaModel.relationships.data_movements || []).map(r => ({
        id: r.id,
        name: r.id,
      })),
      type: 'relationship' as const,
    },
    // Spec 2026-01-08: Added application_point_business_logics relationship section
    {
      id: 'application_point_business_logics',
      label: getRelationshipSectionLabel('application_point_business_logics'),
      items: (metaModel.relationships.application_point_business_logics || []).map(r => ({
        id: r.id,
        name: r.id,
      })),
      type: 'relationship' as const,
    },
    // Spec 2026-05-05: Infrastructure Domain Diagram Support - 3 relationship sections
    // Implementer chose explicit array literal entries (path b) to mirror the existing pattern
    // where every relationship has an explicit entry in this array. The auto-derivation in
    // getRelationshipSectionsForDomain handles filtering by section ID, not array population.
    {
      id: 'resource_subnet_hostings',
      label: getRelationshipSectionLabel('resource_subnet_hostings'),
      items: (metaModel.relationships.resource_subnet_hostings || []).map(r => ({
        id: r.id,
        name: r.id,
      })),
      type: 'relationship' as const,
    },
    {
      id: 'deployment_unit_compute_resources',
      label: getRelationshipSectionLabel('deployment_unit_compute_resources'),
      items: (metaModel.relationships.deployment_unit_compute_resources || []).map(r => ({
        id: r.id,
        name: r.id,
      })),
      type: 'relationship' as const,
    },
    {
      id: 'load_balancer_resource_routes',
      label: getRelationshipSectionLabel('load_balancer_resource_routes'),
      items: (metaModel.relationships.load_balancer_resource_routes || []).map(r => ({
        id: r.id,
        name: r.id,
      })),
      type: 'relationship' as const,
    },
    // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain relationship sections
    {
      id: 'application_compute_deployments',
      label: getRelationshipSectionLabel('application_compute_deployments'),
      items: (metaModel.relationships.application_compute_deployments || []).map(r => ({
        id: r.id,
        name: r.id,
      })),
      type: 'relationship' as const,
    },
    {
      id: 'data_entity_data_store_hostings',
      label: getRelationshipSectionLabel('data_entity_data_store_hostings'),
      items: (metaModel.relationships.data_entity_data_store_hostings || []).map(r => ({
        id: r.id,
        name: r.id,
      })),
      type: 'relationship' as const,
    },
    {
      id: 'application_infrastructure_resource_uses',
      label: getRelationshipSectionLabel('application_infrastructure_resource_uses'),
      items: (metaModel.relationships.application_infrastructure_resource_uses || []).map(r => ({
        id: r.id,
        name: r.id,
      })),
      type: 'relationship' as const,
    },
    {
      id: 'application_load_balancer_exposures',
      label: getRelationshipSectionLabel('application_load_balancer_exposures'),
      items: (metaModel.relationships.application_load_balancer_exposures || []).map(r => ({
        id: r.id,
        name: r.id,
      })),
      type: 'relationship' as const,
    },
  ];

  // Combine all sections
  const allSections = [...entitySections, ...relationshipSections];

  // Task Group 5: Filter sections by domain if selectedDomain is provided
  let filteredSections = allSections;
  if (selectedDomain) {
    const allowedSectionIds = new Set(domainToPaletteSections[selectedDomain] || []);
    filteredSections = allSections.filter(section => allowedSectionIds.has(section.id));
  }

  // Task Group 5 (Diagram Types): Apply diagram type filtering if diagramType is provided
  // This is applied AFTER domain filtering, so the result is the intersection
  // If diagramType is 'General' or undefined, no additional filtering is applied
  if (diagramType && diagramType !== 'General') {
    const allowedDiagramTypeSectionIds = DIAGRAM_TYPE_PALETTE_RULES[diagramType];
    if (allowedDiagramTypeSectionIds !== null) {
      const diagramTypeAllowedSet = new Set(allowedDiagramTypeSectionIds);
      filteredSections = filteredSections.filter(section => diagramTypeAllowedSet.has(section.id));
    }
    // If allowedDiagramTypeSectionIds is null (General type), no filtering is applied
  }

  // Filter items by search query
  for (const section of filteredSections) {
    sections.push({
      ...section,
      items: filterItemsBySearch(section.items, searchQuery),
    });
  }

  return sections;
}
