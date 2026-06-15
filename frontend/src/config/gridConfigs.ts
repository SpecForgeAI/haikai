import { GridColumnConfig } from '../types/config';
import { ArchitectureDomain } from '../types/architectureDomain';
import {
  appTypeOptions,
  statusOptions,
  pointTypeOptions,
  physicalTypeOptions,
  OAS_DATA_TYPE_OPTIONS,
  SQL_DATA_TYPE_OPTIONS,
  movementTypeOptions,
  actorHintOptions,
  userInteractionLevelOptions,
  processActivityFrequencyOptions,
  interfaceTypeOptions,
  endpointTypeOptions,
  endpointDirectionOptions,
  endpointLifecycleStatusOptions,
  sourceRefKindOptions,
  payloadRefKindOptions,
  payloadPrimitiveTypeOptions,
  stateKindOptions,
  triggerRefKindOptions,
  guardRefKindOptions,
  effectRefKindOptions,
  activityKindOptions,
  activityFlowKindOptions,
  activityPartitionRefKindOptions,
  cardinalityOptions,
  logicalERRelationshipOptions,
  uiComponentTypeOptions,
  uiActionTriggerTypeOptions,
  uiActionOwnerTypeOptions,
  uiActionEffectTypeOptions,
  applicationPointTargetTypeOptions,
  uiCharacteristicTypeOptions,
  techTypeOptions,
  userJourneyLinkTypeOptions,
  // Spec 2026-05-04: Infrastructure Domain Tables UI - 23 picklist option arrays
  environmentTypeOptions,
  lifecycleStateOptions,
  criticalityOptions,
  providerOptions,
  locationTypeOptions,
  networkTypeOptions,
  routingModeOptions,
  subnetTypeOptions,
  subnetVisibilityOptions,
  platformTypeOptions,
  operatingModelOptions,
  computeTypeOptions,
  deploymentUnitTypeOptions,
  loadBalancerTypeOptions,
  exposureOptions,
  protocolOptions,
  dataStoreTypeOptions,
  engineOptions,
  resourceTypeOptions,
  infrastructurePointKindOptions,
  relationshipRoleOptions,
  deploymentStatusOptions,
  routingTypeOptions,
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 new picklist arrays
  deploymentRoleOptions,
  hostingRoleOptions,
  dependencyTypeOptions,
  accessModeOptions,
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 4 new picklist arrays consumed by grids
  iacSourceTypeOptions,
  repositoryProviderOptions,
  iacSourceProviderOptions,
  bindingStatusOptions,
  // Spec 2026-05-06: Library Frontend Types & Tables - 2 new + 2 reused picklist arrays
  ecosystemOptions,
  dependencyScopeOptions,
  sourceOriginOptions,
  generationStatusOptions,
} from './defaults';
import { BUSINESS_LOGIC_TYPE_SUGGESTIONS } from './businessLogicTypeSuggestions';
import { COMMON_EXCEPTION_SUGGESTIONS } from './commonExceptionSuggestions';
import { applicationPointDisplayFormatter,  businessPointDisplayFormatter, infrastructurePointDisplayFormatter } from '../utils/formatters';
import { snakeCaseToTitleCase } from '../components/Grid/GridCell';

export const gridConfigs: Record<string, GridColumnConfig[]> = {
  business_users: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'abbreviation', displayName: 'Name Abbreviated', cellType: 'text', required: true, width: 120 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 300 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
  ],
  business_processes: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 150 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  process_activities: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'business_process_id', displayName: 'Business Process', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'business_processes' },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 180 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
    { field: 'frequency', displayName: 'Frequency', cellType: 'dropdown', required: false, width: 120, options: processActivityFrequencyOptions },
    { field: 'sequence_order', displayName: 'Sequence Order', cellType: 'text', required: false, width: 100 },
    { field: 'actor_hint', displayName: 'Actor Hint', cellType: 'dropdown', required: false, width: 140, options: actorHintOptions },
    { field: 'user_interaction_level', displayName: 'User Interaction Level', cellType: 'dropdown', required: true, width: 160, options: userInteractionLevelOptions },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 120 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  // Spec 2026-04-01: User Journeys Grid Configuration (Business domain)
  user_journeys: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'primary_business_user_id', displayName: 'Primary Business User', cellType: 'fk_typeahead', required: false, width: 180, fkTarget: 'business_users' },
    { field: 'parent_business_process_id', displayName: 'Parent Business Process', cellType: 'fk_typeahead', required: false, width: 180, fkTarget: 'business_processes' },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 150 },
  ],
  // Spec 2026-04-01: Activity Steps Grid Configuration (Business domain)
  activity_steps: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'user_journey_id', displayName: 'User Journey', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'user_journeys' },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'diagram_label', displayName: 'Diagram Label', cellType: 'text', required: true, width: 160 },
    { field: 'sequence_order', displayName: 'Sequence Order', cellType: 'text', required: false, width: 100 },
    { field: 'process_activity_id', displayName: 'Process Activity', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'process_activities' },
    { field: 'business_user_id', displayName: 'Business User', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'business_users' },
    { field: 'application_id', displayName: 'Application', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'applications' },
    { field: 'activity_issues', displayName: 'Activity Issues', cellType: 'text', required: false, width: 250 },
    { field: 'ui_issues', displayName: 'UI Issues', cellType: 'text', required: false, width: 250 },
  ],

  // Interactions grid configuration - for creating/editing Interaction entities
  // Note: Interactions are now treated as relationships (dotted edges) rather than entity nodes
  interactions: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 180 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 180 },
    { field: 'user_id', displayName: 'User', cellType: 'fk_typeahead', required: true, width: 150, fkTarget: 'business_users' },
    { field: 'primary_app_business_point_id', displayName: 'Primary Point', cellType: 'fk_typeahead', required: true, width: 200, fkTarget: 'app_business_points' },
    { field: 'secondary_app_business_point_id', displayName: 'Secondary Point', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'app_business_points' },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 120 },
  ],
  // ============================================================================
  // Applications Grid Configuration
  // Spec 2026-01-26: Sequence Diagram Participant Colour and Icons
  // - Added is_internal boolean column after status
  // ============================================================================
  applications: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 180 },
    { field: 'abbreviation', displayName: 'Name Abbreviated', cellType: 'text', required: true, width: 120 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 180 },
    { field: 'app_type', displayName: 'Type', cellType: 'dropdown', required: false, width: 100, options: appTypeOptions },
    { field: 'status', displayName: 'Status', cellType: 'dropdown', required: false, width: 100, options: statusOptions },
    // Spec 2026-01-26: Sequence Diagram Participant Colour and Icons - is_internal column
    { field: 'is_internal', displayName: 'Is Internal?', cellType: 'boolean', required: false, width: 100 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 120 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  // ============================================================================
  // App Components Grid Configuration
  // Spec 2026-01-26: Sequence Diagram Participant Colour and Icons
  // - Added is_internal boolean column after application_id
  // - Added tech_type dropdown column after is_internal
  // ============================================================================
  app_components: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 180 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 180 },
    { field: 'application_id', displayName: 'Application', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'applications' },
    // Spec 2026-01-26: Sequence Diagram Participant Colour and Icons - is_internal column
    { field: 'is_internal', displayName: 'Is Internal?', cellType: 'boolean', required: false, width: 100 },
    // Spec 2026-01-26: Sequence Diagram Participant Colour and Icons - tech_type dropdown column
    { field: 'tech_type', displayName: 'Tech Type', cellType: 'dropdown', required: false, width: 120, options: techTypeOptions },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 120 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  // ============================================================================
  // Services Grid Configuration
  // Spec 2026-01-06: Added 'package_set_id' column after 'core_tech'
  // Spec 2026-01-26: Sequence Diagram Participant Colour and Icons
  // - Added is_internal boolean column after package_set_id
  // ============================================================================
  services: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 150 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 150 },
    { field: 'application_id', displayName: 'Application', cellType: 'fk_typeahead', required: false, width: 140, fkTarget: 'applications' },
    { field: 'app_component_id', displayName: 'App Component', cellType: 'fk_typeahead', required: false, width: 140, fkTarget: 'app_components' },
    // Spec 2026-04-16: Service-Scoped Discovery - repo location and subfolder columns
    // Spec 2026-04-20: Tech Hints LLM Resolution - repo columns moved BEFORE core_tech
    // so by the time core_tech blurs the repo fields are available for cross-check.
    { field: 'repo_location', displayName: 'Repo Location', cellType: 'text', required: false, width: 200 },
    { field: 'repo_subfolder', displayName: 'Repo Subfolder', cellType: 'text', required: false, width: 150 },
    // Spec 2026-04-20: Tech Hints LLM Resolution - custom cell renders chips + confirmation
    // sentence inline after save-time LLM resolution against the registered pack set.
    { field: 'core_tech', displayName: 'Core Tech', cellType: 'tech_hints_cell', required: false, width: 220 },
    // Spec 2026-01-06: Package Set dropdown column - custom cell type for package set assignment
    { field: 'package_set_id', displayName: 'Package Set', cellType: 'package_set_dropdown', required: false, width: 160 },
    // Spec 2026-01-26: Sequence Diagram Participant Colour and Icons - is_internal column
    { field: 'is_internal', displayName: 'Is Internal?', cellType: 'boolean', required: false, width: 100 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 100 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  interfaces: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 150 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 150 },
    { field: 'service_id', displayName: 'Service', cellType: 'fk_typeahead', required: true, width: 150, fkTarget: 'services' },
    { field: 'interface_type', displayName: 'Interface Type', cellType: 'dropdown', required: true, width: 130, options: interfaceTypeOptions },
    { field: 'spec_link', displayName: 'Spec Link', cellType: 'text', required: false, width: 200 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 100 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  endpoints: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 150 },
    { field: 'interface_id', displayName: 'Interface', cellType: 'fk_typeahead', required: true, width: 150, fkTarget: 'interfaces' },
    { field: 'endpoint_type', displayName: 'Type', cellType: 'dropdown', required: true, width: 120, options: endpointTypeOptions.map(o => o.value) },
    { field: 'path_or_address', displayName: 'Path/Address', cellType: 'text', required: true, width: 200 },
    { field: 'protocol', displayName: 'Protocol', cellType: 'text', required: false, width: 80 },
    { field: 'operation_verb', displayName: 'Verb', cellType: 'text', required: false, width: 80 },
    { field: 'direction', displayName: 'Direction', cellType: 'dropdown', required: false, width: 100, options: endpointDirectionOptions.map(o => o.value) },
    { field: 'request_data_entity_point_id', displayName: 'Request Data', cellType: 'data_entity_point_picker', required: false, width: 200 },
    { field: 'response_data_entity_point_id', displayName: 'Response Data', cellType: 'data_entity_point_picker', required: false, width: 200 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 150 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  // ============================================================================
  // Class and Method Entities (Application Architecture Domain)
  // Spec: Extension Pack Framework - replaced Application Point with Service dropdown
  // ============================================================================
  classes: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 180 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
    { field: 'namespace', displayName: 'Namespace', cellType: 'text', required: false, width: 180 },
    // Spec: Extension Pack Framework - Service dropdown (replaced Application Point)
    { field: 'service_id', displayName: 'Service', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'services' },
  ],
  // ============================================================================
  // Methods Grid Configuration
  // Spec: Method Parameters/Returns/Throws Type-Oriented Input
  // - Parameters: Free-text entry (accepts any string)
  // - Returns/Throws: Single-token typeahead with entity-derived suggestions
  // ============================================================================
  methods: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'class_id', displayName: 'Class', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'classes' },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 180 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 180 },
    // Spec: Method Parameters/Returns/Throws Type-Oriented Input
    // Parameters: Free-text entry - accepts any string including commas and spaces
    { field: 'parameters_json', displayName: 'Parameters', cellType: 'text', required: false, width: 180 },
    // Spec: Method Parameters/Returns/Throws Type-Oriented Input
    // Returns: Single-token typeahead with suggestions from logical/physical data entities
    { field: 'returns_json', displayName: 'Returns', cellType: 'free_text_typeahead_single_token', required: false, width: 130, suggestionSources: ['logical_data_entities', 'physical_data_entities'] },
    // Spec: Method Parameters/Returns/Throws Type-Oriented Input
    // Throws: Single-token typeahead with suggestions from logical/physical data entities plus common exceptions
    { field: 'throws_json', displayName: 'Throws', cellType: 'free_text_typeahead_single_token', required: false, width: 130, suggestionSources: ['logical_data_entities', 'physical_data_entities'], staticSuggestions: COMMON_EXCEPTION_SUGGESTIONS },
  ],
  application_points: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 180 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 150 },
    { field: 'kind', displayName: 'Kind', cellType: 'text', required: true, width: 120 },
    // application_id is NOT NULL on the underlying column (schema.sql:146) and
    // ModelService.saveModel rejects any ApplicationPoint without it. Marking
    // required:true here surfaces the rule at edit time instead of as a 400 on
    // save. Reconcile + the polymorphic tuple fields ensure derived APs (e.g.
    // for Library) inherit the parent Application's id automatically.
    { field: 'application_id', displayName: 'Application', cellType: 'fk_typeahead', required: true, width: 160, fkTarget: 'applications' },
    { field: 'application_component_id', displayName: 'App Component', cellType: 'fk_typeahead', required: false, width: 160, fkTarget: 'app_components' },
    { field: 'service_id', displayName: 'Service', cellType: 'fk_typeahead', required: false, width: 160, fkTarget: 'services' },
    // Spec: Expand Application Points to Reference Service/Class/Method
    // Target Type dropdown - indicates what entity the point targets
    { field: 'target_type', displayName: 'Target Type', cellType: 'dropdown', required: false, width: 120, options: applicationPointTargetTypeOptions },
    // Target Reference - fk_typeahead that dynamically resolves based on target_type
    // Default fkTarget is 'services', dynamically changed by Grid component based on target_type value
    { field: 'target_ref_id', displayName: 'Target Reference', cellType: 'fk_typeahead', required: false, width: 180, fkTarget: 'services', dynamicFkTargetField: 'target_type', dynamicFkTargetMap: { 'SERVICE': 'services', 'CLASS': 'classes', 'METHOD': 'methods' } },
    { field: 'point_type', displayName: 'Point Type', cellType: 'dropdown', required: false, width: 100, options: pointTypeOptions },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 100 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  business_points: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 180 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 150 },
    { field: 'kind', displayName: 'Kind', cellType: 'text', required: true, width: 120 },
    { field: 'business_process_id', displayName: 'Business Process', cellType: 'fk_typeahead', required: true, width: 160, fkTarget: 'business_processes' },
    { field: 'process_activity_id', displayName: 'Process Activity', cellType: 'fk_typeahead', required: false, width: 160, fkTarget: 'process_activities' },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 100 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  logical_data_entities: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 150 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  logical_data_attributes: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 150 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 150 },
    { field: 'logical_entity_id', displayName: 'Logical Entity', cellType: 'fk_typeahead', required: true, width: 150, fkTarget: 'logical_data_entities' },
    { field: 'data_type', displayName: 'Data Type', cellType: 'dropdown', required: false, width: 130, options: [...OAS_DATA_TYPE_OPTIONS] },
    { field: 'is_primary_key', displayName: 'Primary Key', cellType: 'boolean', required: false, width: 80 },
    { field: 'is_nullable', displayName: 'Nullable', cellType: 'boolean', required: false, width: 70 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 120 },
  ],
  physical_data_entities: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 150 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 150 },
    { field: 'physical_type', displayName: 'Physical Type', cellType: 'dropdown', required: false, width: 100, options: physicalTypeOptions },
    { field: 'database', displayName: 'Database', cellType: 'text', required: false, width: 100 },
    // Spec: DB Structural Fidelity for Discovery (2026-05-29) - Group A ripple.
    // Constraint/index metadata (PK / unique / check / index) captured verbatim
    // by the discovery DB scan, matching the AMS PhysicalDataEntityDto
    // `constraints_metadata` JSONB. Read-only summary cell (full JSON on hover);
    // metadata ON the entity, NOT a new entity type. Excluded from XLSX export.
    { field: 'constraints_metadata', displayName: 'Constraints', cellType: 'json_summary', required: false, width: 220 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 100 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  physical_data_attributes: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 150 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 150 },
    { field: 'physical_entity_id', displayName: 'Physical Entity', cellType: 'fk_typeahead', required: true, width: 150, fkTarget: 'physical_data_entities' },
    { field: 'data_type', displayName: 'Data Type', cellType: 'dropdown', required: false, width: 100, options: [...SQL_DATA_TYPE_OPTIONS] },
    // Spec: DB Structural Fidelity for Discovery (2026-05-29) - Group A ripple.
    // Structural-fidelity fields captured verbatim by the discovery DB scan
    // (snake_case, matching the AMS PhysicalDataAttributeDto). Plain text/boolean
    // cells: read-only-in-spirit display that also round-trips through XLSX. NO
    // type normalization - source_type / column_default are verbatim.
    { field: 'source_type', displayName: 'Source Type', cellType: 'text', required: false, width: 140 },
    { field: 'precision', displayName: 'Precision', cellType: 'text', required: false, width: 90 },
    { field: 'scale', displayName: 'Scale', cellType: 'text', required: false, width: 80 },
    { field: 'column_default', displayName: 'Default', cellType: 'text', required: false, width: 140 },
    { field: 'ordinal', displayName: 'Ordinal', cellType: 'text', required: false, width: 80 },
    { field: 'is_identity', displayName: 'Identity', cellType: 'boolean', required: false, width: 80 },
    { field: 'is_primary_key', displayName: 'Primary Key', cellType: 'boolean', required: false, width: 80 },
    { field: 'is_nullable', displayName: 'Nullable', cellType: 'boolean', required: false, width: 70 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 120 },
  ],
  // ============================================================================
  // Behavioural Domain: Events Entity Grid Configuration
  // ============================================================================
  events: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 150 },
    { field: 'source_ref_kind', displayName: 'Source Type', cellType: 'dropdown', required: false, width: 150, options: sourceRefKindOptions },
    { field: 'source_ref_id', displayName: 'Source ID', cellType: 'text', required: false, width: 180 },
    { field: 'payload_ref_kind', displayName: 'Payload Type', cellType: 'dropdown', required: false, width: 130, options: payloadRefKindOptions },
    { field: 'payload_ref_id', displayName: 'Payload ID', cellType: 'text', required: false, width: 180 },
    { field: 'payload_primitive_type', displayName: 'Primitive Type', cellType: 'dropdown', required: false, width: 130, options: payloadPrimitiveTypeOptions },
  ],
  // ============================================================================
  // Behavioural Domain: States Entity Grid Configuration
  // ============================================================================
  states: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'state_kind', displayName: 'State Kind', cellType: 'dropdown', required: true, width: 100, options: stateKindOptions },
    { field: 'owner_ref_kind', displayName: 'Owner Type', cellType: 'text', required: false, width: 120 },
    { field: 'owner_ref_id', displayName: 'Owner ID', cellType: 'text', required: false, width: 180 },
  ],
  // ============================================================================
  // Behavioural Domain: State Transitions Entity Grid Configuration
  // ============================================================================
  state_transitions: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'from_state_id', displayName: 'From State', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'states' },
    { field: 'to_state_id', displayName: 'To State', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'states' },
    { field: 'order_index', displayName: 'Order', cellType: 'text', required: false, width: 60 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 180 },
    { field: 'trigger_ref_kind', displayName: 'Trigger Type', cellType: 'dropdown', required: false, width: 100, options: triggerRefKindOptions.map(o => o.value) },
    { field: 'trigger_ref_id', displayName: 'Trigger ID', cellType: 'text', required: false, width: 150 },
    { field: 'trigger_label_text', displayName: 'Trigger Label', cellType: 'text', required: false, width: 150 },
    { field: 'guard_ref_kind', displayName: 'Guard Type', cellType: 'dropdown', required: false, width: 100, options: guardRefKindOptions.map(o => o.value) },
    { field: 'guard_ref_id', displayName: 'Guard ID', cellType: 'text', required: false, width: 150 },
    { field: 'guard_expression', displayName: 'Guard Expr', cellType: 'text', required: false, width: 150 },
    { field: 'effect_ref_kind', displayName: 'Effect Type', cellType: 'dropdown', required: false, width: 100, options: effectRefKindOptions.map(o => o.value) },
    { field: 'effect_ref_id', displayName: 'Effect ID', cellType: 'text', required: false, width: 150 },
    { field: 'effect_label_text', displayName: 'Effect Label', cellType: 'text', required: false, width: 150 },
  ],
  // ============================================================================
  // Behavioural Domain: Activities Entity Grid Configuration
  // ============================================================================
  activities: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'activity_kind', displayName: 'Activity Kind', cellType: 'dropdown', required: true, width: 120, options: activityKindOptions },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
  ],
  // ============================================================================
  // Behavioural Domain: Activity Flows Entity Grid Configuration
  // ============================================================================
  activity_flows: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'from_activity_id', displayName: 'From Activity', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'activities' },
    { field: 'to_activity_id', displayName: 'To Activity', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'activities' },
    { field: 'flow_kind', displayName: 'Flow Kind', cellType: 'dropdown', required: true, width: 100, options: activityFlowKindOptions },
    { field: 'order_index', displayName: 'Order', cellType: 'text', required: false, width: 60 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 180 },
    { field: 'trigger_ref_kind', displayName: 'Trigger Type', cellType: 'dropdown', required: false, width: 100, options: triggerRefKindOptions.map(o => o.value) },
    { field: 'trigger_ref_id', displayName: 'Trigger ID', cellType: 'text', required: false, width: 150 },
    { field: 'trigger_label_text', displayName: 'Trigger Label', cellType: 'text', required: false, width: 150 },
    { field: 'condition_ref_kind', displayName: 'Cond Type', cellType: 'dropdown', required: false, width: 100, options: guardRefKindOptions.map(o => o.value) },
    { field: 'condition_ref_id', displayName: 'Cond ID', cellType: 'text', required: false, width: 150 },
    { field: 'condition_expression', displayName: 'Condition', cellType: 'text', required: false, width: 150 },
  ],
  // ============================================================================
  // Behavioural Domain: Activity Partitions Entity Grid Configuration
  // ============================================================================
  activity_partitions: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: false, width: 180 },
    { field: 'ref_kind', displayName: 'Reference Type', cellType: 'dropdown', required: false, width: 150, options: ['', ...activityPartitionRefKindOptions] },
    { field: 'ref_id', displayName: 'Reference ID', cellType: 'text', required: false, width: 180 },
    { field: 'order_index', displayName: 'Order', cellType: 'text', required: false, width: 60 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
  ],
  // ============================================================================
  // Behavioural Domain: Business Logics Entity Grid Configuration
  // Spec: Business Logic Type Suggestions (Non-Enforcing)
  // ============================================================================
  business_logics: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'type_text', displayName: 'Type', cellType: 'text_with_suggestions', required: false, width: 150, suggestions: BUSINESS_LOGIC_TYPE_SUGGESTIONS },
    { field: 'description_md', displayName: 'Description (MD)', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 150 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  // ============================================================================
  // UI Domain: UI Screens Entity Grid Configuration
  // Spec: Meta-Model View - UI Domain Tab (2026-01-03)
  // ============================================================================
  ui_screens: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'route', displayName: 'Route', cellType: 'text', required: true, width: 200 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'application_point_id', displayName: 'Application', cellType: 'application_point_picker', required: false, width: 220, fkTarget: 'application_points', displayFormatter: applicationPointDisplayFormatter, allowedKinds: ['APPLICATION', 'APP_COMPONENT', 'SERVICE'] },
  ],
  // ============================================================================
  // UI Domain: UI Workflow Transitions Entity Grid Configuration
  // Spec: Meta-Model View - UI Domain Tab (2026-01-03)
  // ============================================================================
  ui_workflow_transitions: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 150 },
    { field: 'source_screen_id', displayName: 'Source Screen', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'ui_screens' },
    { field: 'target_screen_id', displayName: 'Target Screen', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'ui_screens' },
    { field: 'trigger', displayName: 'Trigger', cellType: 'text', required: false, width: 150 },
    { field: 'guard', displayName: 'Guard', cellType: 'text', required: false, width: 150 },
  ],
  // ============================================================================
  // UI Domain: UI Components Entity Grid Configuration
  // Spec: Meta-Model View - UI Domain Tab (2026-01-03)
  // ============================================================================
  ui_components: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'component_type', displayName: 'Component Type', cellType: 'dropdown', required: false, width: 150, options: uiComponentTypeOptions },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
  ],
  // ============================================================================
  // UI Domain: UI Actions Entity Grid Configuration
  // Spec: Meta-Model View - UI Domain Tab (2026-01-03)
  // ============================================================================
  ui_actions: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 180 },
    { field: 'trigger_type', displayName: 'Trigger Type', cellType: 'dropdown', required: true, width: 130, options: uiActionTriggerTypeOptions },
    { field: 'owner_type', displayName: 'Owner Type', cellType: 'dropdown', required: true, width: 130, options: uiActionOwnerTypeOptions },
    { field: 'owner_id', displayName: 'Owner ID', cellType: 'text', required: true, width: 180 },
    { field: 'effect_type', displayName: 'Effect Type', cellType: 'dropdown', required: true, width: 130, options: uiActionEffectTypeOptions },
  ],
  // ============================================================================
  // UI Domain: UI Characteristics Entity Grid Configuration
  // Spec 2026-01-20: UI Characteristics Entity
  // Spec 2026-01-20: Fix UI Characteristics Type Dropdown Crash
  // - Changed options from uiCharacteristicTypeOptions to uiCharacteristicTypeOptions.map(o => o.value)
  // - Added formatOptionLabel: snakeCaseToTitleCase for human-friendly labels
  // ============================================================================
  ui_characteristics: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'uiId', displayName: 'UI', cellType: 'application_point_picker', required: true, width: 220, fkTarget: 'application_points', displayFormatter: applicationPointDisplayFormatter },
    { field: 'type', displayName: 'Type', cellType: 'dropdown', required: true, width: 180, options: uiCharacteristicTypeOptions.map(o => o.value), formatOptionLabel: snakeCaseToTitleCase },
    { field: 'key', displayName: 'Key', cellType: 'text_with_suggestions', required: false, width: 150, dynamicSuggestions: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 180 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
    { field: 'evidence', displayName: 'Evidence', cellType: 'text', required: false, width: 200 },
  ],
  // Business Point relationship grid configs (new format only - legacy configs removed)
  business_user_business_points: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'business_user_id', displayName: 'Business User', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'business_users' },
    { field: 'business_point_id', displayName: 'Business Point', cellType: 'fk_typeahead', required: true, width: 220, fkTarget: 'business_points', displayFormatter: businessPointDisplayFormatter },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 130 },
  ],
  // ============================================================================
  // Spec: Global Application Point Picker with Derived ApplicationPoints
  // application_point_id uses 'application_point_picker' cellType for grouped dropdown
  // ============================================================================
  application_point_business_points: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    // Spec: Global Application Point Picker - use application_point_picker cell type
    { field: 'application_point_id', displayName: 'Application Point', cellType: 'application_point_picker', required: true, width: 220, fkTarget: 'application_points', displayFormatter: applicationPointDisplayFormatter },
    { field: 'business_point_id', displayName: 'Business Point', cellType: 'fk_typeahead', required: true, width: 220, fkTarget: 'business_points', displayFormatter: businessPointDisplayFormatter },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 130 },
  ],
  // ============================================================================
  // Logical Data Entity Relationships (Logical / Physical ER)
  // Spec: Data Entity Point UI Switch
  // Spec 2026-01-08: Renamed from "Logical ER" to "Logical / Physical ER"
  // Replaced legacy from_ref_kind/from_ref_id and to_ref_kind/to_ref_id columns
  // with unified Data Entity Point picker columns
  // ============================================================================
  logical_data_entity_relationships: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    // Spec: Data Entity Point UI Switch - unified "From" picker for logical/physical entities
    { field: 'fromDataEntityPointId', displayName: 'From Data Entity', cellType: 'data_entity_point_picker', required: false, width: 200 },
    // Spec: Data Entity Point UI Switch - unified "To" picker for logical/physical entities
    { field: 'toDataEntityPointId', displayName: 'To Data Entity', cellType: 'data_entity_point_picker', required: false, width: 200 },
    // Cardinality (renamed from relationship_type)
    { field: 'cardinality', displayName: 'Cardinality', cellType: 'dropdown', required: false, width: 140, options: cardinalityOptions },
    // UML relationship type
    { field: 'relationship', displayName: 'Relationship', cellType: 'dropdown', required: false, width: 140, options: logicalERRelationshipOptions },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 150 },
    // Spec: DB Structural Fidelity for Discovery (2026-05-29) - Group A ripple.
    // FK join/referenced column detail captured verbatim by the discovery DB
    // scan, matching the AMS LogicalDataEntityRelationshipDto `fk_columns` JSONB.
    // Read-only summary cell (full JSON on hover); metadata on the relationship,
    // NOT a new entity type. The point-id endpoints are unchanged. Excluded from
    // XLSX export.
    { field: 'fk_columns', displayName: 'FK Columns', cellType: 'json_summary', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 130 },
  ],
  logical_data_entity_physical_data_entities: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'logical_entity_id', displayName: 'Logical Entity', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'logical_data_entities' },
    { field: 'physical_entity_id', displayName: 'Physical Entity', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'physical_data_entities' },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 130 },
  ],
  logical_data_attribute_physical_data_attributes: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'logical_attribute_id', displayName: 'Logical Attribute', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'logical_data_attributes' },
    { field: 'physical_attribute_id', displayName: 'Physical Attribute', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'physical_data_attributes' },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 130 },
  ],
  // ============================================================================
  // Interface <-> Entity Relationship Grid Configuration
  // Spec 2026-01-11: Interface Entity Relationship Refactor
  // - Renamed from "Interface <-> Logical Entity" to "Interface <-> Entity"
  // - Replaced logical_entity_id (fk_typeahead) with dataEntityPointId (data_entity_point_picker)
  // - Allows selection of either Logical OR Physical data entities
  // ============================================================================
  interface_logical_entities: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'interface_id', displayName: 'Interface', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'interfaces' },
    // Spec 2026-01-11: Data Entity picker for Logical OR Physical entity selection
    // Uses data_entity_point_picker cellType (same as Data Movements relationship)
    { field: 'dataEntityPointId', displayName: 'Data Entity', cellType: 'data_entity_point_picker', required: true, width: 180 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 130 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  // ============================================================================
  // Data Movements Grid Configuration
  // Spec: Data Entity Point UI Switch
  // Spec: Global Application Point Picker with Derived ApplicationPoints
  // Spec 2026-01-11: Data Movement Interface Schema Extension
  // - dataEntityPointId changed from required to optional (XOR with interfaceWithSchemaId)
  // - Added interfaceWithSchemaId column (optional, XOR with dataEntityPointId)
  // - Added biDirectional column (optional boolean)
  // source/target_application_point_id use 'application_point_picker' cellType
  // ============================================================================
  data_movements: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    // Spec: Global Application Point Picker - use application_point_picker cell type
    { field: 'source_application_point_id', displayName: 'Source App Point', cellType: 'application_point_picker', required: true, width: 180, fkTarget: 'application_points', displayFormatter: applicationPointDisplayFormatter },
    { field: 'target_application_point_id', displayName: 'Target App Point', cellType: 'application_point_picker', required: true, width: 180, fkTarget: 'application_points', displayFormatter: applicationPointDisplayFormatter },
    // Spec 2026-01-11: Data Entity Point UI Switch - unified picker for logical/physical entities
    // Changed to required: false - XOR with interfaceWithSchemaId (exactly one must be set)
    { field: 'dataEntityPointId', displayName: 'Data Entity', cellType: 'data_entity_point_picker', required: false, width: 160 },
    // Spec 2026-01-11: Interface (with Schema) - alternative to Data Entity for data movement
    // XOR with dataEntityPointId (exactly one must be set)
    { field: 'interfaceWithSchemaId', displayName: 'Interface (with Schema)', cellType: 'fk_typeahead', required: false, width: 180, fkTarget: 'interfaces' },
    // Spec 2026-01-11: Bi-directional flag for data movement
    { field: 'biDirectional', displayName: 'Bi-directional?', cellType: 'boolean', required: false, width: 100 },
    { field: 'movement_type', displayName: 'Type', cellType: 'dropdown', required: false, width: 100, options: movementTypeOptions },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 120 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 80 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  // ============================================================================
  // Application Point to Business Logic Relationship Grid Configuration
  // Spec: Business Logic Entity v1
  // Spec: Global Application Point Picker with Derived ApplicationPoints
  // ============================================================================
  application_point_business_logics: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    // Spec: Global Application Point Picker - use application_point_picker cell type
    { field: 'application_point_id', displayName: 'Application Point', cellType: 'application_point_picker', required: true, width: 220, fkTarget: 'application_points', displayFormatter: applicationPointDisplayFormatter },
    { field: 'business_logic_id', displayName: 'Business Logic', cellType: 'fk_typeahead', required: true, width: 220, fkTarget: 'business_logics' },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 130 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  // ============================================================================
  // User Journey Links Grid Configuration
  // Spec: User Journey Links Meta-Model Foundation
  // Directed relationships between User Journeys
  // ============================================================================
  user_journey_links: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'source_user_journey_id', displayName: 'Source User Journey', cellType: 'fk_typeahead', required: true, width: 220, fkTarget: 'user_journeys' },
    { field: 'target_user_journey_id', displayName: 'Target User Journey', cellType: 'fk_typeahead', required: true, width: 220, fkTarget: 'user_journeys' },
    { field: 'relationship_type', displayName: 'Relationship Type', cellType: 'dropdown', required: true, width: 180, options: userJourneyLinkTypeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'label', displayName: 'Label', cellType: 'text', required: false, width: 150 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 130 },
  ],
  // ============================================================================
  // Spec 2026-05-04: Infrastructure Domain Tables UI
  // 12 visible Infrastructure entity tables + 1 hidden infrastructure_points entry.
  // Per-table column shapes follow spec.md / requirements.md verbatim.
  // - All 12 visible entities carry the standard envelope (description, tags,
  //   valid_from, valid_to). `name` is the only required column on entities.
  // - All FK columns use cellType: 'fk_typeahead' with fkTarget pointing at the
  //   referenced entity table.
  // - All enum columns use cellType: 'dropdown' with formatOptionLabel:
  //   snakeCaseToTitleCase so UPPER_SNAKE_CASE values render as Title Case.
  // - Numeric fields (port, scaling_min/max) use cellType: 'text' (no 'number'
  //   cellType exists in the codebase).
  // - `provider` is a dropdown ONLY on cloud_accounts; everywhere else it is
  //   freetext text by-design.
  // ============================================================================
  environments: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'environment_type', displayName: 'Environment Type', cellType: 'dropdown', required: false, width: 160, options: environmentTypeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'lifecycle_state', displayName: 'Lifecycle State', cellType: 'dropdown', required: false, width: 160, options: lifecycleStateOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'is_current_state', displayName: 'Is Current State?', cellType: 'boolean', required: false, width: 80 },
    { field: 'is_target_state', displayName: 'Is Target State?', cellType: 'boolean', required: false, width: 80 },
    { field: 'owner', displayName: 'Owner', cellType: 'text', required: false, width: 160 },
    { field: 'criticality', displayName: 'Criticality', cellType: 'dropdown', required: false, width: 120, options: criticalityOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  cloud_accounts: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    // `provider` is a dropdown ONLY on cloud_accounts (spec Q12); freetext on all other tables.
    { field: 'provider', displayName: 'Provider', cellType: 'dropdown', required: false, width: 140, options: providerOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'external_account_id', displayName: 'External Account ID', cellType: 'text', required: false, width: 180 },
    { field: 'parent_org_id', displayName: 'Parent Org ID', cellType: 'text', required: false, width: 180 },
    { field: 'billing_owner', displayName: 'Billing Owner', cellType: 'text', required: false, width: 160 },
    { field: 'technical_owner', displayName: 'Technical Owner', cellType: 'text', required: false, width: 160 },
    { field: 'landing_zone_name', displayName: 'Landing Zone Name', cellType: 'text', required: false, width: 160 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  locations: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    { field: 'cloud_account_id', displayName: 'Cloud Account', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'cloud_accounts' },
    { field: 'location_type', displayName: 'Location Type', cellType: 'dropdown', required: false, width: 160, options: locationTypeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'provider', displayName: 'Provider', cellType: 'text', required: false, width: 140 },
    { field: 'provider_region_code', displayName: 'Region Code', cellType: 'text', required: false, width: 140 },
    { field: 'provider_zone_code', displayName: 'Zone Code', cellType: 'text', required: false, width: 140 },
    { field: 'country', displayName: 'Country', cellType: 'text', required: false, width: 120 },
    { field: 'city', displayName: 'City', cellType: 'text', required: false, width: 140 },
    { field: 'address', displayName: 'Address', cellType: 'text', required: false, width: 200 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  networks: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    { field: 'cloud_account_id', displayName: 'Cloud Account', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'cloud_accounts' },
    { field: 'location_id', displayName: 'Location', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'locations' },
    { field: 'network_type', displayName: 'Network Type', cellType: 'dropdown', required: false, width: 140, options: networkTypeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'provider', displayName: 'Provider', cellType: 'text', required: false, width: 140 },
    { field: 'cidr', displayName: 'CIDR', cellType: 'text', required: false, width: 140 },
    { field: 'external_id', displayName: 'External ID', cellType: 'text', required: false, width: 160 },
    { field: 'is_shared', displayName: 'Is Shared?', cellType: 'boolean', required: false, width: 80 },
    { field: 'routing_mode', displayName: 'Routing Mode', cellType: 'dropdown', required: false, width: 140, options: routingModeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  subnets: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    { field: 'network_id', displayName: 'Network', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'networks' },
    { field: 'location_id', displayName: 'Location', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'locations' },
    { field: 'cidr', displayName: 'CIDR', cellType: 'text', required: false, width: 140 },
    { field: 'subnet_type', displayName: 'Subnet Type', cellType: 'dropdown', required: false, width: 140, options: subnetTypeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'visibility', displayName: 'Visibility', cellType: 'dropdown', required: false, width: 140, options: subnetVisibilityOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'provider_region_code', displayName: 'Region Code', cellType: 'text', required: false, width: 140 },
    { field: 'provider_zone_code', displayName: 'Zone Code', cellType: 'text', required: false, width: 140 },
    { field: 'external_id', displayName: 'External ID', cellType: 'text', required: false, width: 160 },
    { field: 'gateway_address', displayName: 'Gateway Address', cellType: 'text', required: false, width: 160 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  compute_clusters: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    { field: 'cloud_account_id', displayName: 'Cloud Account', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'cloud_accounts' },
    { field: 'location_id', displayName: 'Location', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'locations' },
    { field: 'network_id', displayName: 'Network', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'networks' },
    { field: 'platform_type', displayName: 'Platform Type', cellType: 'dropdown', required: false, width: 160, options: platformTypeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'provider', displayName: 'Provider', cellType: 'text', required: false, width: 140 },
    { field: 'version', displayName: 'Version', cellType: 'text', required: false, width: 120 },
    { field: 'external_id', displayName: 'External ID', cellType: 'text', required: false, width: 160 },
    { field: 'owner', displayName: 'Owner', cellType: 'text', required: false, width: 160 },
    { field: 'operating_model', displayName: 'Operating Model', cellType: 'dropdown', required: false, width: 160, options: operatingModelOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  compute_resources: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    { field: 'cloud_account_id', displayName: 'Cloud Account', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'cloud_accounts' },
    { field: 'location_id', displayName: 'Location', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'locations' },
    { field: 'cluster_id', displayName: 'Compute Cluster', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'compute_clusters' },
    { field: 'compute_type', displayName: 'Compute Type', cellType: 'dropdown', required: false, width: 180, options: computeTypeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'provider', displayName: 'Provider', cellType: 'text', required: false, width: 140 },
    { field: 'hostname', displayName: 'Hostname', cellType: 'text', required: false, width: 160 },
    { field: 'fqdn', displayName: 'FQDN', cellType: 'text', required: false, width: 200 },
    { field: 'private_ip', displayName: 'Private IP', cellType: 'text', required: false, width: 140 },
    { field: 'public_ip', displayName: 'Public IP', cellType: 'text', required: false, width: 140 },
    { field: 'os', displayName: 'OS', cellType: 'text', required: false, width: 120 },
    { field: 'runtime', displayName: 'Runtime', cellType: 'text', required: false, width: 140 },
    { field: 'instance_size', displayName: 'Instance Size', cellType: 'text', required: false, width: 140 },
    // Numeric-as-text per endpoints.port precedent (no 'number' cellType in codebase).
    { field: 'scaling_min', displayName: 'Scaling Min', cellType: 'text', required: false, width: 100 },
    { field: 'scaling_max', displayName: 'Scaling Max', cellType: 'text', required: false, width: 100 },
    { field: 'external_id', displayName: 'External ID', cellType: 'text', required: false, width: 160 },
    { field: 'lifecycle_state', displayName: 'Lifecycle State', cellType: 'dropdown', required: false, width: 160, options: lifecycleStateOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'owner', displayName: 'Owner', cellType: 'text', required: false, width: 160 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  // Spec 2026-05-04 Q1: deployment_units.service_id (NOT application_entity_id)
  // is the locked direct typed FK to services per spec 1 + spec 3 contract.
  // runtime_config is NOT exposed (Q10) — round-trips via save/load only.
  deployment_units: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'service_id', displayName: 'Service', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'services' },
    { field: 'deployment_unit_type', displayName: 'Deployment Unit Type', cellType: 'dropdown', required: false, width: 180, options: deploymentUnitTypeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'version', displayName: 'Version', cellType: 'text', required: false, width: 120 },
    { field: 'artifact_uri', displayName: 'Artifact URI', cellType: 'text', required: false, width: 220 },
    { field: 'image_name', displayName: 'Image Name', cellType: 'text', required: false, width: 200 },
    { field: 'image_tag', displayName: 'Image Tag', cellType: 'text', required: false, width: 140 },
    { field: 'source_repository', displayName: 'Source Repository', cellType: 'text', required: false, width: 220 },
    { field: 'source_commit', displayName: 'Source Commit', cellType: 'text', required: false, width: 160 },
    { field: 'build_pipeline', displayName: 'Build Pipeline', cellType: 'text', required: false, width: 200 },
    { field: 'owner', displayName: 'Owner', cellType: 'text', required: false, width: 160 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  load_balancers: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    { field: 'cloud_account_id', displayName: 'Cloud Account', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'cloud_accounts' },
    { field: 'location_id', displayName: 'Location', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'locations' },
    { field: 'network_id', displayName: 'Network', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'networks' },
    { field: 'load_balancer_type', displayName: 'Load Balancer Type', cellType: 'dropdown', required: false, width: 200, options: loadBalancerTypeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'provider', displayName: 'Provider', cellType: 'text', required: false, width: 140 },
    { field: 'exposure', displayName: 'Exposure', cellType: 'dropdown', required: false, width: 140, options: exposureOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'scheme', displayName: 'Scheme', cellType: 'text', required: false, width: 120 },
    { field: 'dns_name', displayName: 'DNS Name', cellType: 'text', required: false, width: 200 },
    { field: 'ip_address', displayName: 'IP Address', cellType: 'text', required: false, width: 140 },
    { field: 'external_id', displayName: 'External ID', cellType: 'text', required: false, width: 160 },
    { field: 'owner', displayName: 'Owner', cellType: 'text', required: false, width: 160 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  // Spec 2026-05-04 A1: listeners.compute_resource_id is a DIRECT typed FK
  // to compute_resources (NOT polymorphic).
  listeners: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    { field: 'load_balancer_id', displayName: 'Load Balancer', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'load_balancers' },
    { field: 'compute_resource_id', displayName: 'Compute Resource', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'compute_resources' },
    { field: 'protocol', displayName: 'Protocol', cellType: 'dropdown', required: false, width: 120, options: protocolOptions, formatOptionLabel: snakeCaseToTitleCase },
    // Numeric-as-text per endpoints.port precedent.
    { field: 'port', displayName: 'Port', cellType: 'text', required: false, width: 100 },
    { field: 'host_name', displayName: 'Host Name', cellType: 'text', required: false, width: 200 },
    { field: 'path_pattern', displayName: 'Path Pattern', cellType: 'text', required: false, width: 200 },
    { field: 'exposure', displayName: 'Exposure', cellType: 'dropdown', required: false, width: 140, options: exposureOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'is_public', displayName: 'Is Public?', cellType: 'boolean', required: false, width: 80 },
    { field: 'certificate_reference', displayName: 'Certificate Ref', cellType: 'text', required: false, width: 200 },
    { field: 'external_id', displayName: 'External ID', cellType: 'text', required: false, width: 160 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  data_store_instances: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    { field: 'cloud_account_id', displayName: 'Cloud Account', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'cloud_accounts' },
    { field: 'location_id', displayName: 'Location', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'locations' },
    { field: 'data_store_type', displayName: 'Data Store Type', cellType: 'dropdown', required: false, width: 180, options: dataStoreTypeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'engine', displayName: 'Engine', cellType: 'dropdown', required: false, width: 140, options: engineOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'engine_version', displayName: 'Engine Version', cellType: 'text', required: false, width: 140 },
    { field: 'provider', displayName: 'Provider', cellType: 'text', required: false, width: 140 },
    { field: 'host', displayName: 'Host', cellType: 'text', required: false, width: 200 },
    // Numeric-as-text per endpoints.port precedent.
    { field: 'port', displayName: 'Port', cellType: 'text', required: false, width: 100 },
    { field: 'external_id', displayName: 'External ID', cellType: 'text', required: false, width: 160 },
    { field: 'encrypted', displayName: 'Encrypted?', cellType: 'boolean', required: false, width: 80 },
    { field: 'ha_enabled', displayName: 'HA Enabled?', cellType: 'boolean', required: false, width: 80 },
    { field: 'backup_enabled', displayName: 'Backup Enabled?', cellType: 'boolean', required: false, width: 80 },
    { field: 'owner', displayName: 'Owner', cellType: 'text', required: false, width: 160 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  infrastructure_resources: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    { field: 'cloud_account_id', displayName: 'Cloud Account', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'cloud_accounts' },
    { field: 'location_id', displayName: 'Location', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'locations' },
    { field: 'resource_type', displayName: 'Resource Type', cellType: 'dropdown', required: false, width: 180, options: resourceTypeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'provider', displayName: 'Provider', cellType: 'text', required: false, width: 140 },
    { field: 'provider_resource_type', displayName: 'Provider Resource Type', cellType: 'text', required: false, width: 180 },
    { field: 'endpoint', displayName: 'Endpoint', cellType: 'text', required: false, width: 220 },
    { field: 'external_id', displayName: 'External ID', cellType: 'text', required: false, width: 160 },
    { field: 'criticality', displayName: 'Criticality', cellType: 'dropdown', required: false, width: 120, options: criticalityOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'owner', displayName: 'Owner', cellType: 'text', required: false, width: 160 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  // ============================================================================
  // Spec 2026-05-04: Hidden internal entity for the polymorphic InfrastructurePoint
  // supertype. Registered in tabToEntityType and gridConfigs for internal model-update
  // wiring (the picker writes back via the same plumbing) but excluded from
  // entityTabNames and domainGroupings.infrastructure (Q5 - mirrors application_points).
  // The 12 typed FK columns are NOT exposed; they are populated by
  // infrastructurePointDerivation.ts when the picker auto-creates a row.
  // ============================================================================
  infrastructure_points: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'point_kind', displayName: 'Point Kind', cellType: 'dropdown', required: true, width: 180, options: infrastructurePointKindOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  // ============================================================================
  // Spec 2026-05-04: Infrastructure Domain Tables UI - 3 relationship gridConfigs
  // - Relationships have NO `name`, `valid_from`, or `valid_to` columns.
  // - Polymorphic FK columns use cellType: 'infrastructure_point_picker' with
  //   per-relationship `allowedKinds` filters (Q4).
  // - All concrete-FK endpoints + environment_id are required: true (backend
  //   NOT NULL columns).
  // ============================================================================
  resource_subnet_hostings: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'infrastructure_point_id', displayName: 'Infrastructure Point', cellType: 'infrastructure_point_picker', required: true, width: 280, fkTarget: 'infrastructure_points', displayFormatter: infrastructurePointDisplayFormatter, allowedKinds: ['COMPUTE_RESOURCE', 'DATA_STORE_INSTANCE', 'LOAD_BALANCER', 'INFRASTRUCTURE_RESOURCE'] },
    { field: 'subnet_id', displayName: 'Subnet', cellType: 'fk_typeahead', required: true, width: 200, fkTarget: 'subnets' },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: true, width: 200, fkTarget: 'environments' },
    { field: 'relationship_role', displayName: 'Relationship Role', cellType: 'dropdown', required: false, width: 180, options: relationshipRoleOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'primary_ip', displayName: 'Primary IP', cellType: 'text', required: false, width: 140 },
    { field: 'private_ip', displayName: 'Private IP', cellType: 'text', required: false, width: 140 },
    { field: 'public_ip', displayName: 'Public IP', cellType: 'text', required: false, width: 140 },
    { field: 'evidence_source', displayName: 'Evidence Source', cellType: 'text', required: false, width: 180 },
    { field: 'confidence', displayName: 'Confidence', cellType: 'text', required: false, width: 100 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
  ],
  // runtime_config is NOT exposed (Q10) — round-trips via save/load only.
  deployment_unit_compute_resources: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'deployment_unit_id', displayName: 'Deployment Unit', cellType: 'fk_typeahead', required: true, width: 220, fkTarget: 'deployment_units' },
    { field: 'compute_infrastructure_point_id', displayName: 'Compute Target', cellType: 'infrastructure_point_picker', required: true, width: 280, fkTarget: 'infrastructure_points', displayFormatter: infrastructurePointDisplayFormatter, allowedKinds: ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER'] },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: true, width: 200, fkTarget: 'environments' },
    { field: 'version', displayName: 'Version', cellType: 'text', required: false, width: 120 },
    // Numeric-as-text per endpoints.port precedent.
    { field: 'desired_instances', displayName: 'Desired Instances', cellType: 'text', required: false, width: 100 },
    { field: 'min_instances', displayName: 'Min Instances', cellType: 'text', required: false, width: 100 },
    { field: 'max_instances', displayName: 'Max Instances', cellType: 'text', required: false, width: 100 },
    { field: 'deployment_status', displayName: 'Deployment Status', cellType: 'dropdown', required: false, width: 160, options: deploymentStatusOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'evidence_source', displayName: 'Evidence Source', cellType: 'text', required: false, width: 180 },
    { field: 'confidence', displayName: 'Confidence', cellType: 'text', required: false, width: 100 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
  ],
  load_balancer_resource_routes: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'load_balancer_id', displayName: 'Load Balancer', cellType: 'fk_typeahead', required: true, width: 200, fkTarget: 'load_balancers' },
    { field: 'listener_id', displayName: 'Listener', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'listeners' },
    { field: 'target_infrastructure_point_id', displayName: 'Target', cellType: 'infrastructure_point_picker', required: true, width: 280, fkTarget: 'infrastructure_points', displayFormatter: infrastructurePointDisplayFormatter, allowedKinds: ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER', 'DATA_STORE_INSTANCE', 'INFRASTRUCTURE_RESOURCE'] },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: true, width: 200, fkTarget: 'environments' },
    { field: 'protocol', displayName: 'Protocol', cellType: 'dropdown', required: false, width: 120, options: protocolOptions, formatOptionLabel: snakeCaseToTitleCase },
    // Numeric-as-text per endpoints.port precedent.
    { field: 'target_port', displayName: 'Target Port', cellType: 'text', required: false, width: 100 },
    { field: 'host_name', displayName: 'Host Name', cellType: 'text', required: false, width: 200 },
    { field: 'path_pattern', displayName: 'Path Pattern', cellType: 'text', required: false, width: 200 },
    { field: 'routing_type', displayName: 'Routing Type', cellType: 'dropdown', required: false, width: 160, options: routingTypeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'weight', displayName: 'Weight', cellType: 'text', required: false, width: 100 },
    { field: 'health_check_path', displayName: 'Health Check Path', cellType: 'text', required: false, width: 200 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
  ],
  // ============================================================================
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain relationship gridConfigs
  // - Source-side endpoint reuses existing application_point_picker (Rels 1, 3, 4)
  //   or data_entity_point_picker (Rel 2) cellType - no new cellType.
  // - Primary target FK is required: true; environment_id is optional (nullable on backend).
  // - exposureOptions and protocolOptions are reused from spec 4 - imported above, no redeclaration.
  // - Numeric-as-text precedent for confidence and target_port columns.
  // ============================================================================
  application_compute_deployments: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'application_point_id', displayName: 'Application Point', cellType: 'application_point_picker', required: true, width: 220, fkTarget: 'application_points', displayFormatter: applicationPointDisplayFormatter },
    { field: 'compute_resource_id', displayName: 'Compute Resource', cellType: 'fk_typeahead', required: true, width: 200, fkTarget: 'compute_resources' },
    { field: 'deployment_unit_id', displayName: 'Deployment Unit', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'deployment_units' },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    { field: 'deployment_role', displayName: 'Deployment Role', cellType: 'dropdown', required: false, width: 160, options: deploymentRoleOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'runtime_name', displayName: 'Runtime Name', cellType: 'text', required: false, width: 160 },
    { field: 'runtime_version', displayName: 'Runtime Version', cellType: 'text', required: false, width: 140 },
    { field: 'evidence_source', displayName: 'Evidence Source', cellType: 'text', required: false, width: 180 },
    { field: 'confidence', displayName: 'Confidence', cellType: 'text', required: false, width: 100 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
  ],
  data_entity_data_store_hostings: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'data_entity_point_id', displayName: 'Data Entity', cellType: 'data_entity_point_picker', required: true, width: 220 },
    { field: 'data_store_instance_id', displayName: 'Data Store', cellType: 'fk_typeahead', required: true, width: 200, fkTarget: 'data_store_instances' },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    { field: 'database_name', displayName: 'Database Name', cellType: 'text', required: false, width: 160 },
    { field: 'schema_name', displayName: 'Schema Name', cellType: 'text', required: false, width: 160 },
    { field: 'table_or_collection_name', displayName: 'Table / Collection', cellType: 'text', required: false, width: 200 },
    { field: 'hosting_role', displayName: 'Hosting Role', cellType: 'dropdown', required: false, width: 160, options: hostingRoleOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'evidence_source', displayName: 'Evidence Source', cellType: 'text', required: false, width: 180 },
    { field: 'confidence', displayName: 'Confidence', cellType: 'text', required: false, width: 100 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
  ],
  application_infrastructure_resource_uses: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'application_point_id', displayName: 'Application Point', cellType: 'application_point_picker', required: true, width: 220, fkTarget: 'application_points', displayFormatter: applicationPointDisplayFormatter },
    { field: 'infrastructure_resource_id', displayName: 'Infrastructure Resource', cellType: 'fk_typeahead', required: true, width: 220, fkTarget: 'infrastructure_resources' },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    { field: 'dependency_type', displayName: 'Dependency Type', cellType: 'dropdown', required: false, width: 180, options: dependencyTypeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'protocol', displayName: 'Protocol', cellType: 'dropdown', required: false, width: 120, options: protocolOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'endpoint_or_topic', displayName: 'Endpoint / Topic', cellType: 'text', required: false, width: 200 },
    { field: 'access_mode', displayName: 'Access Mode', cellType: 'dropdown', required: false, width: 160, options: accessModeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'evidence_source', displayName: 'Evidence Source', cellType: 'text', required: false, width: 180 },
    { field: 'confidence', displayName: 'Confidence', cellType: 'text', required: false, width: 100 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
  ],
  application_load_balancer_exposures: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'application_point_id', displayName: 'Application Point', cellType: 'application_point_picker', required: true, width: 220, fkTarget: 'application_points', displayFormatter: applicationPointDisplayFormatter },
    { field: 'load_balancer_id', displayName: 'Load Balancer', cellType: 'fk_typeahead', required: true, width: 200, fkTarget: 'load_balancers' },
    { field: 'listener_id', displayName: 'Listener', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'listeners' },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    { field: 'host_name', displayName: 'Host Name', cellType: 'text', required: false, width: 200 },
    { field: 'path_pattern', displayName: 'Path Pattern', cellType: 'text', required: false, width: 200 },
    { field: 'protocol', displayName: 'Protocol', cellType: 'dropdown', required: false, width: 120, options: protocolOptions, formatOptionLabel: snakeCaseToTitleCase },
    // Numeric-as-text per spec 4 precedent (target_port is INTEGER on backend).
    { field: 'target_port', displayName: 'Target Port', cellType: 'text', required: false, width: 100 },
    { field: 'exposure', displayName: 'Exposure', cellType: 'dropdown', required: false, width: 140, options: exposureOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'evidence_source', displayName: 'Evidence Source', cellType: 'text', required: false, width: 180 },
    { field: 'confidence', displayName: 'Confidence', cellType: 'text', required: false, width: 100 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
  ],
  // ============================================================================
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 2 new gridConfigs
  // - iac_sources: entity-shaped grid (full envelope: name/description/tags + 13 source-specific
  //   fields). `name` is required. Repository / module / commit / provider / timestamp
  //   columns track the IaC source-of-record.
  // - iac_resource_bindings: relationship-shaped grid binding an Infrastructure entity
  //   (via the polymorphic infrastructure_point_picker - NO `allowedKinds` restriction
  //   per spec 7) to a current/future IaC resource address. `infrastructure_point_id`
  //   and `iac_source_id` are required. `confidence` / `start_line` / `end_line` use
  //   numeric-as-text per spec 4 precedent.
  // ============================================================================
  iac_sources: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'source_type', displayName: 'Source Type', cellType: 'dropdown', required: false, width: 160, options: iacSourceTypeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'provider', displayName: 'Provider', cellType: 'dropdown', required: false, width: 140, options: iacSourceProviderOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'repository_url', displayName: 'Repository URL', cellType: 'text', required: false, width: 240 },
    { field: 'repository_provider', displayName: 'Repository Provider', cellType: 'dropdown', required: false, width: 160, options: repositoryProviderOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'branch', displayName: 'Branch', cellType: 'text', required: false, width: 140 },
    { field: 'commit_sha', displayName: 'Commit SHA', cellType: 'text', required: false, width: 180 },
    { field: 'path', displayName: 'Path', cellType: 'text', required: false, width: 200 },
    { field: 'workspace', displayName: 'Workspace', cellType: 'text', required: false, width: 160 },
    { field: 'module_name', displayName: 'Module Name', cellType: 'text', required: false, width: 180 },
    { field: 'module_path', displayName: 'Module Path', cellType: 'text', required: false, width: 200 },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    { field: 'owner', displayName: 'Owner', cellType: 'text', required: false, width: 160 },
    { field: 'last_scanned_at', displayName: 'Last Scanned At', cellType: 'text', required: false, width: 180 },
    { field: 'last_imported_at', displayName: 'Last Imported At', cellType: 'text', required: false, width: 180 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  iac_resource_bindings: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    // NO `allowedKinds` restriction per spec 7 - bindings can target any of the 12 Infra entity kinds.
    { field: 'infrastructure_point_id', displayName: 'Infrastructure Point', cellType: 'infrastructure_point_picker', required: true, width: 280, fkTarget: 'infrastructure_points', displayFormatter: infrastructurePointDisplayFormatter },
    { field: 'iac_source_id', displayName: 'IaC Source', cellType: 'fk_typeahead', required: true, width: 220, fkTarget: 'iac_sources' },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    { field: 'iac_address', displayName: 'IaC Address', cellType: 'text', required: false, width: 280 },
    { field: 'iac_resource_type', displayName: 'IaC Resource Type', cellType: 'text', required: false, width: 220 },
    { field: 'iac_resource_name', displayName: 'IaC Resource Name', cellType: 'text', required: false, width: 200 },
    { field: 'provider', displayName: 'Provider', cellType: 'dropdown', required: false, width: 140, options: iacSourceProviderOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'file_path', displayName: 'File Path', cellType: 'text', required: false, width: 240 },
    // Numeric-as-text per spec 4 precedent (start_line / end_line are INTEGER on backend).
    { field: 'start_line', displayName: 'Start Line', cellType: 'text', required: false, width: 100 },
    { field: 'end_line', displayName: 'End Line', cellType: 'text', required: false, width: 100 },
    { field: 'state_resource_id', displayName: 'State Resource ID', cellType: 'text', required: false, width: 220 },
    { field: 'external_id', displayName: 'External ID', cellType: 'text', required: false, width: 180 },
    { field: 'binding_status', displayName: 'Binding Status', cellType: 'dropdown', required: false, width: 160, options: bindingStatusOptions, formatOptionLabel: snakeCaseToTitleCase },
    // DECIMAL(4,3) on backend - numeric-as-text per spec 4 precedent.
    { field: 'confidence', displayName: 'Confidence', cellType: 'text', required: false, width: 100 },
    { field: 'last_seen_at', displayName: 'Last Seen At', cellType: 'text', required: false, width: 180 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
  ],
  // ============================================================================
  // Spec 2026-05-06: Library Frontend Types & Tables - 2 new gridConfigs
  // - libraries: entity-shaped grid (16 columns). `name` and `description` required.
  //   Reuses tech_hints_cell + package_set_dropdown via structural TechHintsRow typing
  //   (Group 4). All 6 provenance columns visible at the END after valid_to (Q5 override).
  // - code_unit_dependencies: relationship-shaped grid (12 columns). Both source/target
  //   application_point columns required. allowedKinds restricts to SERVICE+LIBRARY for
  //   source and LIBRARY for target. Reuses applicationPointDisplayFormatter.
  //   No name / valid_from / valid_to (relationship convention). manifest_line and
  //   confidence use cellType: 'text' (matches endpoints.port precedent).
  // ============================================================================
  libraries: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'ecosystem', displayName: 'Ecosystem', cellType: 'dropdown', required: false, width: 140, options: ecosystemOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'repo_location', displayName: 'Repo Location', cellType: 'text', required: false, width: 200 },
    { field: 'repo_subfolder', displayName: 'Repo Subfolder', cellType: 'text', required: false, width: 150 },
    { field: 'core_tech', displayName: 'Core Tech', cellType: 'tech_hints_cell', required: false, width: 220 },
    { field: 'package_set_id', displayName: 'Package Set', cellType: 'package_set_dropdown', required: false, width: 160 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: true, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
    // 6 provenance columns positioned at end after valid_to (Q5 override).
    { field: 'source_origin', displayName: 'Source Origin', cellType: 'dropdown', required: false, width: 140, options: sourceOriginOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'source_system', displayName: 'Source System', cellType: 'text', required: false, width: 160 },
    { field: 'source_reference', displayName: 'Source Reference', cellType: 'text', required: false, width: 200 },
    { field: 'generation_status', displayName: 'Generation Status', cellType: 'dropdown', required: false, width: 160, options: generationStatusOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'generation_notes', displayName: 'Generation Notes', cellType: 'text', required: false, width: 250 },
    { field: 'last_verified_at', displayName: 'Last Verified At', cellType: 'text', required: false, width: 140 },
  ],
  code_unit_dependencies: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    { field: 'source_application_point_id', displayName: 'Source Application Point', cellType: 'application_point_picker', required: true, width: 280, allowedKinds: ['SERVICE', 'LIBRARY'], displayFormatter: applicationPointDisplayFormatter },
    { field: 'target_application_point_id', displayName: 'Target Application Point', cellType: 'application_point_picker', required: true, width: 280, allowedKinds: ['LIBRARY'], displayFormatter: applicationPointDisplayFormatter },
    { field: 'declared_name', displayName: 'Declared Name', cellType: 'text', required: false, width: 220 },
    { field: 'declared_version', displayName: 'Declared Version', cellType: 'text', required: false, width: 120 },
    { field: 'declared_version_range', displayName: 'Declared Version Range', cellType: 'text', required: false, width: 160 },
    { field: 'scope', displayName: 'Scope', cellType: 'dropdown', required: false, width: 140, options: dependencyScopeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'manifest_path', displayName: 'Manifest Path', cellType: 'text', required: false, width: 240 },
    // Numeric-as-text per endpoints.port precedent (manifest_line is INTEGER on backend).
    { field: 'manifest_line', displayName: 'Manifest Line', cellType: 'text', required: false, width: 100 },
    { field: 'evidence_source', displayName: 'Evidence Source', cellType: 'text', required: false, width: 180 },
    // Numeric-as-text per endpoints.port precedent (confidence is DECIMAL on backend).
    { field: 'confidence', displayName: 'Confidence', cellType: 'text', required: false, width: 100 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
  ],
};

// tabToEntityType mapping - maps entity tab names to their type keys
// NOTE: 'Interactions' was REMOVED to fix double-rendering bug
// (spec: 2025-12-09-fix-interactions-double-rendering-and-abp-mapping)
// Interactions is now ONLY in relationshipTabToType to ensure MetaModelView
// renders RelationshipGrid only (not both Grid and RelationshipGrid)
// NOTE: 'Business Points' and 'Application Points' mappings are preserved for internal API wiring
// even though these tabs are hidden from the domainGroupings UI (spec: 2025-12-23-hide-superpoints-expose-class-method-palette)
// NOTE: 'Activity Nodes' used instead of 'Activities' to avoid conflict with process_activities
// Spec 2026-01-06: Added 'Package Sets' mapping - Packages NOT exposed as separate tab
// Spec 2026-01-20: Added 'UI Characteristics' mapping for UI domain
// Spec 2026-05-04: Infrastructure Domain Tables UI - 13 new entries (12 visible + 1 hidden)
export const tabToEntityType: Record<string, string> = {
  'Users': 'business_users',
  'Processes': 'business_processes',
  'Activities': 'process_activities',
  // 'Interactions' REMOVED - was causing double grid rendering
  'Applications': 'applications',
  'App Components': 'app_components',
  'Services': 'services',
  'Libraries': 'libraries',  // Spec 2026-05-06: Library Frontend Types & Tables
  'Interfaces': 'interfaces',
  'Endpoints': 'endpoints',
  'Classes': 'classes',
  'Methods': 'methods',
  'Package Sets': 'package_sets',  // Spec 2026-01-06: Package Sets Screen
  'Logical Entities': 'logical_data_entities',
  'Logical Attributes': 'logical_data_attributes',
  'Physical Entities': 'physical_data_entities',
  'Physical Attributes': 'physical_data_attributes',
  'Application Points': 'application_points',
  'Business Points': 'business_points',
  'Events': 'events',
  'States': 'states',
  'State Transitions': 'state_transitions',
  'Activity Nodes': 'activities',
  'Activity Flows': 'activity_flows',
  'Activity Partitions': 'activity_partitions',
  'Business Logics': 'business_logics',
  // UI Domain tab mappings
  'UI Screens': 'ui_screens',
  'UI Workflow Transitions': 'ui_workflow_transitions',
  'UI Components': 'ui_components',
  'UI Actions': 'ui_actions',
  'UI Characteristics': 'ui_characteristics',  // Spec 2026-01-20: UI Characteristics Entity
  // Spec 2026-04-01: User Journey & Activity Step Business Architecture
  'User Journeys': 'user_journeys',
  'Activity Steps': 'activity_steps',
  // Spec 2026-05-04: Infrastructure Domain Tables UI - 12 visible entity tabs
  'Environments': 'environments',
  'Cloud Accounts': 'cloud_accounts',
  'Locations': 'locations',
  'Networks': 'networks',
  'Subnets': 'subnets',
  'Compute Clusters': 'compute_clusters',
  'Compute Resources': 'compute_resources',
  'Deployment Units': 'deployment_units',
  'Load Balancers': 'load_balancers',
  'Listeners': 'listeners',
  'Data Stores': 'data_store_instances',
  'Infrastructure Resources': 'infrastructure_resources',
  // Spec 2026-05-04: Hidden internal entity for the polymorphic InfrastructurePoint
  // supertype - registered for model-update plumbing dispatch but NOT in entityTabNames
  // or domainGroupings.infrastructure (mirrors Application Points / Business Points pattern).
  'Infrastructure Points': 'infrastructure_points',
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
  'IaC Sources': 'iac_sources',
};

// Task Group 2: relationshipTabToType mapping - maps relationship tab names to their type keys
// Task 2.3: Added "Interactions" mapping to "interactions" type
// Spec 2026-01-08: Renamed "Logical ER" to "Logical / Physical ER"
// Spec 2026-01-11: Renamed "Interface <-> Logical Entity" to "Interface <-> Entity"
// Spec 2026-05-04: Infrastructure Domain Tables UI - 3 new relationship tabs
// (display names match RELATIONSHIP_TAB_ORDER strings landed by spec 3)
export const relationshipTabToType: Record<string, string> = {
  'User <-> Business Point': 'business_user_business_points',
  'App Point <-> Business Point': 'application_point_business_points',
  'Interactions': 'interactions',  // Task 2.3: Added - routes to RelationshipGrid with interactions data
  'Logical / Physical ER': 'logical_data_entity_relationships',  // Spec 2026-01-08: Renamed from "Logical ER"
  'Logical <-> Physical Entities': 'logical_data_entity_physical_data_entities',
  'Logical <-> Physical Attributes': 'logical_data_attribute_physical_data_attributes',
  'Interface <-> Entity': 'interface_logical_entities',  // Spec 2026-01-11: Renamed from "Interface <-> Logical Entity"
  'Data Movements': 'data_movements',
  'App Point <-> Business Logic': 'application_point_business_logics',
  'User Journey Links': 'user_journey_links',
  // Spec 2026-05-04: Infrastructure Domain Tables UI - 3 new relationship tabs
  'Resource <-> Subnet': 'resource_subnet_hostings',
  'Deployment Unit <-> Compute': 'deployment_unit_compute_resources',
  'Load Balancer Routes': 'load_balancer_resource_routes',
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 new relationship tabs
  'App <-> Compute': 'application_compute_deployments',
  'Data Entity <-> Data Store': 'data_entity_data_store_hostings',
  'App <-> Infrastructure Resource': 'application_infrastructure_resource_uses',
  'App <-> Load Balancer': 'application_load_balancer_exposures',
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
  'IaC Resource Bindings': 'iac_resource_bindings',
  // Spec 2026-05-06: Library Frontend Types & Tables
  'Library Dependency': 'code_unit_dependencies',
};

// Task Group 2: entityTabNames - entity tabs rendered via EntityGrid
// Task 2.2: Removed "Interactions" - it now routes to RelationshipGrid
// Spec 2026-01-20: Added "UI Characteristics" after "UI Actions"
// Spec 2026-05-04: Infrastructure Domain Tables UI - 12 visible entity tab names appended
// (Infrastructure Points is hidden, mirrors Application Points / Business Points)
export const entityTabNames = [
  'Users',
  'Processes',
  'Activities',
  // 'Interactions' removed - now in relationshipTabNames (Task 2.2)
  'Applications',
  'App Components',
  'Services',
  'Libraries',  // Spec 2026-05-06: Library Frontend Types & Tables
  'Interfaces',
  'Endpoints',
  'Classes',
  'Methods',
  'Logical Entities',
  'Logical Attributes',
  'Physical Entities',
  'Physical Attributes',
  'Events',
  'States',
  'State Transitions',
  'Activity Nodes',
  'Activity Flows',
  'Activity Partitions',
  'Business Logics',
  // UI Domain entity tabs
  'UI Screens',
  'UI Workflow Transitions',
  'UI Components',
  'UI Actions',
  'UI Characteristics',  // Spec 2026-01-20: UI Characteristics Entity
  // Spec 2026-04-01: User Journey & Activity Step Business Architecture
  'User Journeys',
  'Activity Steps',
  // Spec 2026-05-04: Infrastructure Domain Tables UI - 12 visible entity tabs
  // Containment-driven order: Environments -> Cloud Accounts -> Locations ->
  // Networks -> Subnets -> Compute Clusters -> Compute Resources ->
  // Deployment Units -> Load Balancers -> Listeners -> Data Stores ->
  // Infrastructure Resources (Q13).
  'Environments',
  'Cloud Accounts',
  'Locations',
  'Networks',
  'Subnets',
  'Compute Clusters',
  'Compute Resources',
  'Deployment Units',
  'Load Balancers',
  'Listeners',
  'Data Stores',
  'Infrastructure Resources',
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
  'IaC Sources',
];

// Task Group 2: domainGroupings - groups entity tabs by domain for UI organization
// Task 2.2: Removed "Interactions" from business domain
// Spec 2025-12-23: Removed 'Business Points' and 'Application Points' from UI tabs
// These are derived super-entities not meant for direct editing
// NOTE: tabToEntityType mappings for these are preserved for internal API wiring
// Spec 2026-01-06: Added 'Package Sets' to application domain after 'Methods'
// Spec 2026-01-20: Added 'UI Characteristics' to ui domain after 'UI Actions' (5th position)
// Spec 2026-05-04: Infrastructure Domain Tables UI - replace empty placeholder
// with the 12 visible entity tab names in containment-driven order (Q13).
// 'Infrastructure Points' is intentionally NOT included here (hidden tab,
// mirrors Application Points / Business Points pattern).
export const domainGroupings: Record<ArchitectureDomain, string[]> = {
  business: ['Users', 'Processes', 'Activities', 'User Journeys', 'Activity Steps'],  // Spec 2026-04-01: Added User Journeys and Activity Steps
  application: ['Applications', 'App Components', 'Services', 'Libraries', 'Interfaces', 'Endpoints', 'Classes', 'Methods', 'Package Sets'],  // Spec 2026-05-06: Added Libraries after Services; Spec 2026-01-06: Added Package Sets
  data: ['Logical Entities', 'Logical Attributes', 'Physical Entities', 'Physical Attributes'],
  behavioural: ['Events', 'States', 'State Transitions', 'Activity Nodes', 'Activity Flows', 'Activity Partitions', 'Business Logics'],
  ui: ['UI Screens', 'UI Workflow Transitions', 'UI Components', 'UI Actions', 'UI Characteristics'],  // Spec 2026-01-20: UI Characteristics at 5th position
  infrastructure: [
    'Environments',
    'Cloud Accounts',
    'Locations',
    'Networks',
    'Subnets',
    'Compute Clusters',
    'Compute Resources',
    'Deployment Units',
    'Load Balancers',
    'Listeners',
    'Data Stores',
    'Infrastructure Resources',
    // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
    'IaC Sources',
  ],
};

/**
 * DOMAIN_ENTITY_TYPES: Authoritative mapping of domain to entity type keys.
 * Includes ALL entity types per domain, including hidden super-entities
 * (application_points, business_points) that are not shown as UI tabs.
 *
 * Used for relationship filtering to ensure relationships involving hidden
 * entities are still visible in relevant domains.
 *
 * Contrast with domainGroupings which only includes VISIBLE entity tabs.
 *
 * Spec 2026-01-06: Added 'package_sets' and 'packages' to application domain
 * Spec 2026-01-20: Added 'ui_characteristics' to ui domain
 * Spec 2026-05-04: Infrastructure Domain Tables UI - 13 entity-type strings
 * (12 visible + 'infrastructure_points' hidden for relationship filtering).
 */
export const DOMAIN_ENTITY_TYPES: Record<ArchitectureDomain, string[]> = {
  business: ['business_users', 'business_processes', 'process_activities', 'business_points', 'user_journeys', 'activity_steps'],  // Spec 2026-04-01: Added user_journeys, activity_steps
  application: ['applications', 'app_components', 'services', 'libraries', 'interfaces', 'endpoints', 'classes', 'methods', 'application_points', 'package_sets', 'packages'],  // Spec 2026-05-06: Added libraries
  data: ['logical_data_entities', 'logical_data_attributes', 'physical_data_entities', 'physical_data_attributes'],
  behavioural: ['events', 'states', 'state_transitions', 'activities', 'activity_flows', 'activity_partitions', 'business_logics'],
  ui: ['ui_screens', 'ui_workflow_transitions', 'ui_components', 'ui_actions', 'ui_characteristics'],  // Spec 2026-01-20: Added ui_characteristics
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

// Task Group 2: relationshipTabNames - relationship tabs rendered via RelationshipGrid
// Task 2.3: Added "Interactions" after "App Point <-> Business Point" and before "Logical / Physical ER"
// Spec 2026-01-08: Renamed "Logical ER" to "Logical / Physical ER"
// Spec 2026-01-11: Renamed "Interface <-> Logical Entity" to "Interface <-> Entity"
// Spec 2026-05-04: Infrastructure Domain Tables UI - 3 new relationship tab names appended
// (exact match to spec 3's RELATIONSHIP_TAB_ORDER strings).
export const relationshipTabNames = [
  'User <-> Business Point',
  'App Point <-> Business Point',
  'Interactions',  // Task 2.3: Added - positioned per spec requirements
  'Logical / Physical ER',  // Spec 2026-01-08: Renamed from "Logical ER"
  'Logical <-> Physical Entities',
  'Logical <-> Physical Attributes',
  'Interface <-> Entity',  // Spec 2026-01-11: Renamed from "Interface <-> Logical Entity"
  'Data Movements',
  'App Point <-> Business Logic',
  'User Journey Links',
  // Spec 2026-05-04: Infrastructure Domain Tables UI - 3 new relationship tabs
  'Resource <-> Subnet',
  'Deployment Unit <-> Compute',
  'Load Balancer Routes',
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 new relationship tabs
  'App <-> Compute',
  'Data Entity <-> Data Store',
  'App <-> Infrastructure Resource',
  'App <-> Load Balancer',
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
  'IaC Resource Bindings',
  // Spec 2026-05-06: Library Frontend Types & Tables
  'Library Dependency',
];

export const tabNames = entityTabNames;
