package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.model.dto.entity.*;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public record MetaModelEntitiesDto(
    @JsonProperty("business_users")
    List<BusinessUserDto> businessUsers,

    @JsonProperty("business_processes")
    List<BusinessProcessDto> businessProcesses,

    @JsonProperty("process_activities")
    List<ProcessActivityDto> processActivities,

    @JsonProperty("business_points")
    List<BusinessPointDto> businessPoints,

    @JsonProperty("applications")
    List<ApplicationDto> applications,

    @JsonProperty("app_components")
    List<ApplicationComponentDto> appComponents,

    @JsonProperty("services")
    List<ServiceDto> services,

    @JsonProperty("interfaces")
    List<InterfaceDto> interfaces,

    @JsonProperty("endpoints")
    List<EndpointDto> endpoints,

    @JsonProperty("classes")
    List<ClassDto> classes,

    @JsonProperty("methods")
    List<MethodDto> methods,

    @JsonProperty("application_points")
    List<ApplicationPointDto> applicationPoints,

    @JsonProperty("logical_data_entities")
    List<LogicalDataEntityDto> logicalDataEntities,

    @JsonProperty("logical_data_attributes")
    List<LogicalDataAttributeDto> logicalDataAttributes,

    @JsonProperty("physical_data_entities")
    List<PhysicalDataEntityDto> physicalDataEntities,

    @JsonProperty("physical_data_attributes")
    List<PhysicalDataAttributeDto> physicalDataAttributes,

    /**
     * Data Entity Points - polymorphic reference wrappers for Logical and Physical Data Entities.
     * Enables future relationship tables to point to either entity type through a single foreign key.
     *
     * Spec: Data Entity Point Superclass
     */
    @JsonProperty("data_entity_points")
    List<DataEntityPointDto> dataEntityPoints,

    @JsonProperty("interactions")
    List<InteractionDto> interactions,

    @JsonProperty("app_business_points")
    List<AppBusinessPointDto> appBusinessPoints,

    @JsonProperty("events")
    List<EventDto> events,

    @JsonProperty("states")
    List<StateDto> states,

    @JsonProperty("state_transitions")
    List<StateTransitionDto> stateTransitions,

    @JsonProperty("activities")
    List<ActivityDto> activities,

    @JsonProperty("activity_flows")
    List<ActivityFlowDto> activityFlows,

    @JsonProperty("activity_partitions")
    List<ActivityPartitionDto> activityPartitions,

    @JsonProperty("ui_screens")
    List<UIScreenDto> uiScreens,

    @JsonProperty("ui_contracts")
    List<UIContractDto> uiContracts,

    @JsonProperty("ui_components")
    List<UIComponentDto> uiComponents,

    @JsonProperty("ui_actions")
    List<UIActionDto> uiActions,

    /**
     * UI Characteristics - captures business features and UI/UX/technical characteristics
     * associated with frontend UIs, linked to Application Points.
     *
     * Spec: UI Characteristics
     */
    @JsonProperty("ui_characteristics")
    List<UICharacteristicDto> uiCharacteristics,

    @JsonProperty("business_logics")
    List<BusinessLogicDto> businessLogics,

    @JsonProperty("package_sets")
    List<PackageSetDto> packageSets,

    @JsonProperty("packages")
    List<PackageDto> packages,

    /**
     * Package Set Default Rules for auto-resolving "Default (Auto)" package set selection.
     * These rules are imported from standards JSON files and used to match Services
     * based on their core_tech and service_type fields.
     *
     * Spec: Package Set Standards Import (Iteration 6)
     */
    @JsonProperty("package_set_default_rules")
    List<PackageSetDefaultRuleDto> packageSetDefaultRules,

    /**
     * User Journeys - map Business Users to end-to-end Business Processes,
     * modeling how specific users experience business flows through applications.
     *
     * Spec: User Journey Meta-Model Foundation
     */
    @JsonProperty("user_journeys")
    List<UserJourneyDto> userJourneys,

    /**
     * Activity Steps - ordered steps within a User Journey, each referencing
     * a Process Activity, Business User, and Application.
     *
     * Spec: User Journey Meta-Model Foundation
     */
    @JsonProperty("activity_steps")
    List<ActivityStepDto> activitySteps,

    // ========================================================================
    // Infrastructure Domain (Spec: 2026-05-04-infrastructure-domain-backend-foundation)
    // Additive only -- 13 new lists appended at the end of the record. Existing
    // fields above are unchanged in shape and order.
    // ========================================================================

    @JsonProperty("environments")
    List<EnvironmentDto> environments,

    @JsonProperty("cloud_accounts")
    List<CloudAccountDto> cloudAccounts,

    @JsonProperty("locations")
    List<LocationDto> locations,

    @JsonProperty("networks")
    List<NetworkDto> networks,

    @JsonProperty("subnets")
    List<SubnetDto> subnets,

    @JsonProperty("compute_clusters")
    List<ComputeClusterDto> computeClusters,

    @JsonProperty("compute_resources")
    List<ComputeResourceDto> computeResources,

    @JsonProperty("deployment_units")
    List<DeploymentUnitDto> deploymentUnits,

    @JsonProperty("load_balancers")
    List<LoadBalancerDto> loadBalancers,

    @JsonProperty("listeners")
    List<ListenerDto> listeners,

    @JsonProperty("data_store_instances")
    List<DataStoreInstanceDto> dataStoreInstances,

    @JsonProperty("infrastructure_resources")
    List<InfrastructureResourceDto> infrastructureResources,

    /**
     * Infrastructure Points - polymorphic reference wrappers for the 12
     * infrastructure entity types. Mirrors {@link DataEntityPointDto}'s shape
     * (typed-FK-per-target + discriminator) and is used by the 3 infrastructure
     * relationships (resource_subnet_hostings, deployment_unit_compute_resources,
     * load_balancer_resource_routes) to reference any infrastructure entity
     * through a single FK.
     */
    @JsonProperty("infrastructure_points")
    List<InfrastructurePointDto> infrastructurePoints
,

    // ========================================================================
    // Infrastructure Terraform & Discovery Readiness (Spec: 2026-05-05-infrastructure-terraform-discovery-readiness)
    // 1 new list appended at the end. Existing fields above are unchanged in
    // shape and order.
    // ========================================================================

    /**
     * IaC Sources -- entity-shaped concept recording IaC source-of-record
     * (Terraform repo / path / workspace / commit SHA / provider). Bound to
     * Infrastructure entities through {@code iac_resource_bindings} rows.
     */
    @JsonProperty("iac_sources")
    List<IaCSourceDto> iacSources
,

    // ========================================================================
    // Library Backend Foundation (Spec: 2026-05-05-library-backend-foundation)
    // 1 new list appended at the end. Existing fields above are unchanged in
    // shape and order.
    // ========================================================================

    /**
     * Libraries -- entity parallel to Service. Carries the standard envelope
     * plus library-specific fields (ecosystem, repo_location/subfolder),
     * the 5 tech-hints columns, the 6 provenance columns, and a package_set
     * FK. Library identity is (name, ecosystem); dedup happens at the
     * resolver layer (Spec 3), not the DB.
     */
    @JsonProperty("libraries")
    List<LibraryDto> libraries
) {}
