package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.model.dto.discovery.EndpointDataEffectDto;
import com.example.architecturemodel.model.dto.entity.UIWorkflowTransitionDto;
import com.example.architecturemodel.model.dto.relationship.*;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public record MetaModelRelationshipsDto(
    @JsonProperty("business_user_business_points")
    List<BusinessUserBusinessPointDto> businessUserBusinessPoints,

    @JsonProperty("application_point_business_points")
    List<ApplicationPointBusinessPointDto> applicationPointBusinessPoints,

    @JsonProperty("logical_data_entity_relationships")
    List<LogicalDataEntityRelationshipDto> logicalDataEntityRelationships,

    @JsonProperty("logical_data_entity_physical_data_entities")
    List<LogicalDataEntityPhysicalDataEntityDto> logicalDataEntityPhysicalDataEntities,

    @JsonProperty("logical_data_attribute_physical_data_attributes")
    List<LogicalDataAttributePhysicalDataAttributeDto> logicalDataAttributePhysicalDataAttributes,

    @JsonProperty("data_movements")
    List<DataMovementDto> dataMovements,

    @JsonProperty("interface_logical_entities")
    List<InterfaceLogicalEntityDto> interfaceLogicalEntities,

    @JsonProperty("ui_workflow_transitions")
    List<UIWorkflowTransitionDto> uiWorkflowTransitions,

    @JsonProperty("application_point_business_logics")
    List<ApplicationPointBusinessLogicDto> applicationPointBusinessLogics,

    @JsonProperty("user_journey_links")
    List<UserJourneyLinkDto> userJourneyLinks,

    // ========================================================================
    // Infrastructure Domain Relationships
    // Spec: 2026-05-04-infrastructure-domain-backend-foundation
    // Additive only -- 3 new lists appended at the end. Existing fields above
    // are unchanged in shape and order.
    // ========================================================================

    /**
     * R1: Resource-Subnet Hostings. Polymorphic source via
     * infrastructure_point_id; attaches an infrastructure point to a subnet.
     */
    @JsonProperty("resource_subnet_hostings")
    List<ResourceSubnetHostingDto> resourceSubnetHostings,

    /**
     * R2: Deployment-Unit Compute-Resource. Polymorphic compute target via
     * compute_infrastructure_point_id (A2). Allowed point_kind values
     * COMPUTE_RESOURCE / COMPUTE_CLUSTER are documentation-only.
     */
    @JsonProperty("deployment_unit_compute_resources")
    List<DeploymentUnitComputeResourceDto> deploymentUnitComputeResources,

    /**
     * R3: Load-Balancer Resource Routes. Polymorphic target via
     * target_infrastructure_point_id; routes load-balancer (and optionally a
     * specific listener) to a target infrastructure point.
     */
    @JsonProperty("load_balancer_resource_routes")
    List<LoadBalancerResourceRouteDto> loadBalancerResourceRoutes,

    // ========================================================================
    // Infrastructure Cross-Domain Relationships
    // Spec: 2026-05-05-infrastructure-cross-domain-integration
    // Additive only -- 4 new lists appended at the end. Existing fields above
    // are unchanged in shape and order.
    // ========================================================================

    /**
     * XR1: Application Compute Deployments. Application/Service (via
     * application_points) -> Compute Resource with optional drill-down to a
     * Deployment Unit.
     */
    @JsonProperty("application_compute_deployments")
    List<ApplicationComputeDeploymentDto> applicationComputeDeployments,

    /**
     * XR2: Data Entity Data Store Hostings. Data Entity (via
     * data_entity_points) -> Data Store Instance.
     */
    @JsonProperty("data_entity_data_store_hostings")
    List<DataEntityDataStoreHostingDto> dataEntityDataStoreHostings,

    /**
     * XR3: Application Infrastructure Resource Uses. Application/Service (via
     * application_points) -> Infrastructure Resource.
     */
    @JsonProperty("application_infrastructure_resource_uses")
    List<ApplicationInfrastructureResourceUseDto> applicationInfrastructureResourceUses,

    /**
     * XR4: Application Load Balancer Exposures. Application/Service (via
     * application_points) -> Load Balancer with optional drill-down to a
     * Listener (Q2).
     */
    @JsonProperty("application_load_balancer_exposures")
    List<ApplicationLoadBalancerExposureDto> applicationLoadBalancerExposures
,

    // ========================================================================
    // Infrastructure Terraform & Discovery Readiness (Spec: 2026-05-05-infrastructure-terraform-discovery-readiness)
    // 1 new list appended at the end. Existing fields above are unchanged in
    // shape and order.
    // ========================================================================

    /**
     * IaC Resource Bindings -- N:N mapping between an IaC source
     * ({@code iac_sources}) and an Infrastructure entity (via
     * {@code infrastructure_points} polymorphic supertype) at a specific
     * Terraform / cloud-resource address.
     */
    @JsonProperty("iac_resource_bindings")
    List<IaCResourceBindingDto> iacResourceBindings
,

    // ========================================================================
    // Library Backend Foundation (Spec: 2026-05-05-library-backend-foundation)
    // 1 new list appended at the end. Existing fields above are unchanged in
    // shape and order.
    // ========================================================================

    /**
     * Code Unit Dependencies -- polymorphic-source / Library-target dependency
     * edges via the existing application_points supertype. Doc-only target
     * type rules (test-enforced): source must be SERVICE or LIBRARY; target
     * must be LIBRARY.
     */
    @JsonProperty("code_unit_dependencies")
    List<CodeUnitDependencyDto> codeUnitDependencies
,

    // ========================================================================
    // Endpoint->Data-Effect Call Graph for Discovery
    // (Spec: 2026-05-29-endpoint-data-effect-graph) -- Task Group 1
    // 1 new list appended at the end. Existing fields above are unchanged in
    // shape and order. The prior-arity delegating constructor below defaults
    // this to an empty list so the ~24 existing call sites compile unchanged.
    // ========================================================================

    /**
     * Endpoint Data Effects -- the NEW dedicated endpoint->data-entity
     * data-effect edges (one edge per (endpoint, data-entity) pair) with
     * access_mode + structured path_metadata_json. References the data entity
     * via the dep_log_/dep_phy_ data-entity-point convention. Distinct from
     * interface_logical_entities (wire-payload / interface-level) and from the
     * endpoint's request_/response_data_entity_point_id payload columns.
     */
    @JsonProperty("endpoint_data_effects")
    List<EndpointDataEffectDto> endpointDataEffects
) {

    /**
     * Backward-compatible delegating constructor matching the pre-2026-05-29
     * arity (without {@code endpointDataEffects}). Defaults the new list to an
     * empty list so callers built against the previous shape (ModelService's
     * empty-relationships seed, ProjectSnapshotService, SessionProjectStore,
     * and the existing test factories / round-trip tests) compile and behave
     * unchanged.
     *
     * <p>NEW callers should use the canonical record constructor and pass the
     * {@code endpointDataEffects} list explicitly.</p>
     */
    public MetaModelRelationshipsDto(
            List<BusinessUserBusinessPointDto> businessUserBusinessPoints,
            List<ApplicationPointBusinessPointDto> applicationPointBusinessPoints,
            List<LogicalDataEntityRelationshipDto> logicalDataEntityRelationships,
            List<LogicalDataEntityPhysicalDataEntityDto> logicalDataEntityPhysicalDataEntities,
            List<LogicalDataAttributePhysicalDataAttributeDto> logicalDataAttributePhysicalDataAttributes,
            List<DataMovementDto> dataMovements,
            List<InterfaceLogicalEntityDto> interfaceLogicalEntities,
            List<UIWorkflowTransitionDto> uiWorkflowTransitions,
            List<ApplicationPointBusinessLogicDto> applicationPointBusinessLogics,
            List<UserJourneyLinkDto> userJourneyLinks,
            List<ResourceSubnetHostingDto> resourceSubnetHostings,
            List<DeploymentUnitComputeResourceDto> deploymentUnitComputeResources,
            List<LoadBalancerResourceRouteDto> loadBalancerResourceRoutes,
            List<ApplicationComputeDeploymentDto> applicationComputeDeployments,
            List<DataEntityDataStoreHostingDto> dataEntityDataStoreHostings,
            List<ApplicationInfrastructureResourceUseDto> applicationInfrastructureResourceUses,
            List<ApplicationLoadBalancerExposureDto> applicationLoadBalancerExposures,
            List<IaCResourceBindingDto> iacResourceBindings,
            List<CodeUnitDependencyDto> codeUnitDependencies) {
        this(
            businessUserBusinessPoints,
            applicationPointBusinessPoints,
            logicalDataEntityRelationships,
            logicalDataEntityPhysicalDataEntities,
            logicalDataAttributePhysicalDataAttributes,
            dataMovements,
            interfaceLogicalEntities,
            uiWorkflowTransitions,
            applicationPointBusinessLogics,
            userJourneyLinks,
            resourceSubnetHostings,
            deploymentUnitComputeResources,
            loadBalancerResourceRoutes,
            applicationComputeDeployments,
            dataEntityDataStoreHostings,
            applicationInfrastructureResourceUses,
            applicationLoadBalancerExposures,
            iacResourceBindings,
            codeUnitDependencies,
            List.of() // endpointDataEffects defaulted for backward compatibility
        );
    }
}
