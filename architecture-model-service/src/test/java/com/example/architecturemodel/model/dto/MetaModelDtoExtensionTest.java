package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.model.dto.entity.EnvironmentDto;
import com.example.architecturemodel.model.dto.entity.InfrastructurePointDto;
import com.example.architecturemodel.model.dto.relationship.DeploymentUnitComputeResourceDto;
import com.example.architecturemodel.model.dto.relationship.LoadBalancerResourceRouteDto;
import com.example.architecturemodel.model.dto.relationship.ResourceSubnetHostingDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.RecordComponent;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for the MetaModel DTO extensions added by the Infrastructure Domain
 * spec:
 *
 *   - 13 new entity lists on {@link MetaModelEntitiesDto}: environments,
 *     cloud_accounts, locations, networks, subnets, compute_clusters,
 *     compute_resources, deployment_units, load_balancers, listeners,
 *     data_store_instances, infrastructure_resources, infrastructure_points.
 *   - 3 new relationship lists on {@link MetaModelRelationshipsDto}:
 *     resource_subnet_hostings, deployment_unit_compute_resources,
 *     load_balancer_resource_routes.
 *
 * Tests asserted by Task 6.1:
 *   1. MetaModelEntitiesDto JSON includes the 13 new lists with snake_case
 *      JSON property names.
 *   2. MetaModelRelationshipsDto JSON includes the 3 new lists with
 *      snake_case JSON property names.
 *   3. New lists serialise as JSON arrays (and round-trip through Jackson).
 *   4. Existing Business / Application / Data / Behavioural / UI domain JSON
 *      property names are unchanged (regression-safe additive change).
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation (Task Group 6.1)
 */
class MetaModelDtoExtensionTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
    }

    /**
     * Test 1 (6.1): MetaModelEntitiesDto JSON includes all 13 new
     * infrastructure entity lists with snake_case JSON property names.
     */
    @Test
    @DisplayName("MetaModelEntitiesDto exposes 13 new infrastructure lists with snake_case JSON names")
    void metaModelEntitiesDtoExposesInfrastructureLists() throws Exception {
        // Build a fully-populated MetaModelEntitiesDto with empty lists for
        // every existing field so we exercise serialisation across the whole
        // record without dependency on the order of arguments.
        MetaModelEntitiesDto dto = newEmptyEntitiesDto();
        JsonNode json = objectMapper.valueToTree(dto);

        // 13 new infrastructure entity list properties, all snake_case.
        assertThat(json.has("environments")).isTrue();
        assertThat(json.has("cloud_accounts")).isTrue();
        assertThat(json.has("locations")).isTrue();
        assertThat(json.has("networks")).isTrue();
        assertThat(json.has("subnets")).isTrue();
        assertThat(json.has("compute_clusters")).isTrue();
        assertThat(json.has("compute_resources")).isTrue();
        assertThat(json.has("deployment_units")).isTrue();
        assertThat(json.has("load_balancers")).isTrue();
        assertThat(json.has("listeners")).isTrue();
        assertThat(json.has("data_store_instances")).isTrue();
        assertThat(json.has("infrastructure_resources")).isTrue();
        assertThat(json.has("infrastructure_points")).isTrue();

        // Each new list serialises as an array (not a scalar / not an object).
        assertThat(json.get("environments").isArray()).isTrue();
        assertThat(json.get("cloud_accounts").isArray()).isTrue();
        assertThat(json.get("infrastructure_points").isArray()).isTrue();

        // The infrastructure_points list contains real InfrastructurePointDto
        // instances when populated -- round-trip a single point through Jackson.
        InfrastructurePointDto point = new InfrastructurePointDto(
            "ip-1", "ENVIRONMENT",
            "env-prod", null, null, null, null, null, null, null, null, null, null, null
        );
        EnvironmentDto env = new EnvironmentDto(
            "env-prod", "Production", null, null, null, null,
            "PROD", "ACTIVE", true, false, null, "CRITICAL",
            null, null, null, null, null, null,
            null, null, null, null, null
        );
        MetaModelEntitiesDto populated = newEntitiesDtoWith(
            List.of(env), List.of(point)
        );
        String roundTripJson = objectMapper.writeValueAsString(populated);
        assertThat(roundTripJson).contains("\"environments\"");
        assertThat(roundTripJson).contains("\"infrastructure_points\"");
        assertThat(roundTripJson).contains("\"id\":\"ip-1\"");
        assertThat(roundTripJson).contains("\"point_kind\":\"ENVIRONMENT\"");
        assertThat(roundTripJson).contains("\"environment_type\":\"PROD\"");
    }

    /**
     * Test 2 (6.1): MetaModelRelationshipsDto JSON includes all 3 new
     * infrastructure relationship lists with snake_case JSON property names.
     */
    @Test
    @DisplayName("MetaModelRelationshipsDto exposes 3 new infrastructure relationship lists with snake_case JSON names")
    void metaModelRelationshipsDtoExposesInfrastructureRelationshipLists() throws Exception {
        MetaModelRelationshipsDto dto = newEmptyRelationshipsDto();
        JsonNode json = objectMapper.valueToTree(dto);

        assertThat(json.has("resource_subnet_hostings")).isTrue();
        assertThat(json.has("deployment_unit_compute_resources")).isTrue();
        assertThat(json.has("load_balancer_resource_routes")).isTrue();

        assertThat(json.get("resource_subnet_hostings").isArray()).isTrue();
        assertThat(json.get("deployment_unit_compute_resources").isArray()).isTrue();
        assertThat(json.get("load_balancer_resource_routes").isArray()).isTrue();

        // Round-trip a populated DTO so we exercise nested DTO serialisation
        // and the A2/R3 JSON property names (compute_infrastructure_point_id,
        // target_infrastructure_point_id).
        DeploymentUnitComputeResourceDto ducr = new DeploymentUnitComputeResourceDto(
            "ducr-1", "du-1", "ip-cluster-1", "env-prod",
            "1.0.0", null, null, null, null, null, null, null, null,
            null, null, null, null, null, null
        );
        LoadBalancerResourceRouteDto route = new LoadBalancerResourceRouteDto(
            "lbr-1", "lb-1", null, "ip-target-1", "env-prod",
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null
        );
        ResourceSubnetHostingDto host = new ResourceSubnetHostingDto(
            "rsh-1", "ip-host-1", "subnet-1", "env-prod",
            null, null, null, null, null, null, null,
            null, null, null, null, null, null
        );
        MetaModelRelationshipsDto populated = newRelationshipsDtoWith(
            List.of(host), List.of(ducr), List.of(route)
        );
        String roundTripJson = objectMapper.writeValueAsString(populated);
        assertThat(roundTripJson).contains("\"compute_infrastructure_point_id\":\"ip-cluster-1\"");
        assertThat(roundTripJson).contains("\"target_infrastructure_point_id\":\"ip-target-1\"");
        assertThat(roundTripJson).contains("\"infrastructure_point_id\":\"ip-host-1\"");
    }

    /**
     * Test 3 (6.1): Existing Business / Application / Data / Behavioural / UI
     * domain JSON property names are unchanged in shape (regression-safe
     * additive change). We exhaustively assert that every pre-existing JSON
     * property name from the 35 entity fields and 10 relationship fields is
     * present.
     */
    @Test
    @DisplayName("Existing MetaModel JSON shapes are unchanged (regression-safe additive change)")
    void existingMetaModelShapesAreUnchanged() {
        JsonNode entitiesJson = objectMapper.valueToTree(newEmptyEntitiesDto());
        // 35 pre-existing entity field JSON names (verbatim from prior code):
        String[] entityNames = new String[]{
            "business_users", "business_processes", "process_activities",
            "business_points", "applications", "app_components", "services",
            "interfaces", "endpoints", "classes", "methods",
            "application_points", "logical_data_entities",
            "logical_data_attributes", "physical_data_entities",
            "physical_data_attributes", "data_entity_points", "interactions",
            "app_business_points", "events", "states", "state_transitions",
            "activities", "activity_flows", "activity_partitions",
            "ui_screens", "ui_contracts", "ui_components", "ui_actions",
            "ui_characteristics", "business_logics", "package_sets",
            "packages", "package_set_default_rules", "user_journeys",
            "activity_steps"
        };
        for (String name : entityNames) {
            assertThat(entitiesJson.has(name))
                .as("Pre-existing entity JSON property '%s' must still be present", name)
                .isTrue();
        }

        JsonNode relsJson = objectMapper.valueToTree(newEmptyRelationshipsDto());
        // 10 pre-existing relationship field JSON names:
        String[] relNames = new String[]{
            "business_user_business_points",
            "application_point_business_points",
            "logical_data_entity_relationships",
            "logical_data_entity_physical_data_entities",
            "logical_data_attribute_physical_data_attributes",
            "data_movements",
            "interface_logical_entities",
            "ui_workflow_transitions",
            "application_point_business_logics",
            "user_journey_links"
        };
        for (String name : relNames) {
            assertThat(relsJson.has(name))
                .as("Pre-existing relationship JSON property '%s' must still be present", name)
                .isTrue();
        }
    }

    /**
     * Test 4 (6.1): The new infrastructure fields appear at the END of each
     * record's component list (so existing positional callers can be migrated
     * additively, and the JSON ordering is stable). We assert this by
     * inspecting the record components reflectively rather than by parsing
     * source.
     */
    @Test
    @DisplayName("New infrastructure fields are present on each record's component list")
    void newInfrastructureFieldsArePresent() {
        // Order-insensitive: later specs append further components after the
        // infrastructure ones, so we assert PRESENCE of the 13 infrastructure
        // entity lists rather than their tail position.
        RecordComponent[] entityComponents = MetaModelEntitiesDto.class.getRecordComponents();
        assertThat(entityComponents.length).isGreaterThanOrEqualTo(13 + 35);
        java.util.List<String> entityNames = java.util.Arrays.stream(entityComponents)
            .map(RecordComponent::getName)
            .toList();
        assertThat(entityNames).contains(
            "environments", "cloudAccounts", "locations", "networks", "subnets",
            "computeClusters", "computeResources", "deploymentUnits",
            "loadBalancers", "listeners", "dataStoreInstances",
            "infrastructureResources", "infrastructurePoints");

        RecordComponent[] relComponents = MetaModelRelationshipsDto.class.getRecordComponents();
        assertThat(relComponents.length).isGreaterThanOrEqualTo(3 + 10);
        java.util.List<String> relNames = java.util.Arrays.stream(relComponents)
            .map(RecordComponent::getName)
            .toList();
        assertThat(relNames).contains(
            "resourceSubnetHostings",
            "deploymentUnitComputeResources",
            "loadBalancerResourceRoutes");
    }

    // ============================================================================
    // Helpers: build empty MetaModel DTOs without depending on positional order.
    //
    // We use reflection on the canonical record constructor with a List.of()
    // for every component so the test does not have to be edited each time
    // a new field is added to either record (and so the test remains
    // resilient to additive changes by future specs).
    // ============================================================================

    private MetaModelEntitiesDto newEmptyEntitiesDto() {
        return invokeCanonicalConstructorWithEmptyLists(MetaModelEntitiesDto.class);
    }

    private MetaModelRelationshipsDto newEmptyRelationshipsDto() {
        return invokeCanonicalConstructorWithEmptyLists(MetaModelRelationshipsDto.class);
    }

    /**
     * Build a MetaModelEntitiesDto where the `environments` and
     * `infrastructure_points` lists are populated and every other list is
     * empty. We do this reflectively to avoid coupling the test to the
     * positional order of components.
     */
    private MetaModelEntitiesDto newEntitiesDtoWith(
        List<EnvironmentDto> environments,
        List<InfrastructurePointDto> infrastructurePoints
    ) {
        return invokeCanonicalConstructorWithLists(
            MetaModelEntitiesDto.class,
            (componentName) -> {
                if ("environments".equals(componentName)) return environments;
                if ("infrastructurePoints".equals(componentName)) return infrastructurePoints;
                return List.of();
            }
        );
    }

    private MetaModelRelationshipsDto newRelationshipsDtoWith(
        List<ResourceSubnetHostingDto> hostings,
        List<DeploymentUnitComputeResourceDto> ducrs,
        List<LoadBalancerResourceRouteDto> routes
    ) {
        return invokeCanonicalConstructorWithLists(
            MetaModelRelationshipsDto.class,
            (componentName) -> {
                if ("resourceSubnetHostings".equals(componentName)) return hostings;
                if ("deploymentUnitComputeResources".equals(componentName)) return ducrs;
                if ("loadBalancerResourceRoutes".equals(componentName)) return routes;
                return List.of();
            }
        );
    }

    @SuppressWarnings("unchecked")
    private <T> T invokeCanonicalConstructorWithEmptyLists(Class<T> recordClass) {
        return invokeCanonicalConstructorWithLists(recordClass, (n) -> List.of());
    }

    @SuppressWarnings("unchecked")
    private <T> T invokeCanonicalConstructorWithLists(
        Class<T> recordClass,
        java.util.function.Function<String, List<?>> listForComponent
    ) {
        try {
            RecordComponent[] components = recordClass.getRecordComponents();
            Class<?>[] paramTypes = new Class<?>[components.length];
            Object[] args = new Object[components.length];
            for (int i = 0; i < components.length; i++) {
                paramTypes[i] = components[i].getType();
                args[i] = listForComponent.apply(components[i].getName());
            }
            return recordClass.getDeclaredConstructor(paramTypes).newInstance(args);
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException("Failed to invoke canonical constructor for " + recordClass, e);
        }
    }
}
