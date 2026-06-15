package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.model.dto.entity.EnvironmentDto;
import com.example.architecturemodel.model.dto.entity.InfrastructurePointDto;
import com.example.architecturemodel.model.dto.relationship.DeploymentUnitComputeResourceDto;
import com.example.architecturemodel.model.dto.relationship.LoadBalancerResourceRouteDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * JSON serialisation / deserialisation tests for the 16 infrastructure DTOs.
 *
 * Tests asserted by Task 3.1:
 *   1. EnvironmentDto round-trips through Jackson with snake_case JSON property
 *      names (e.g. valid_from, is_current_state).
 *   2. InfrastructurePointDto serialises point_kind and the 12 nullable typed
 *      FK fields as snake_case.
 *   3. DeploymentUnitComputeResourceDto.compute_infrastructure_point_id is the
 *      JSON property name (Java field computeInfrastructurePointId) -- A2.
 *   4. LoadBalancerResourceRouteDto.target_infrastructure_point_id JSON name
 *      and Java field name match the spec -- R3.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation (Task Group 3.1)
 */
class InfrastructureDtoSerialisationTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
    }

    /**
     * Test 1 (3.1): EnvironmentDto round-trips through Jackson with snake_case
     * JSON property names.
     */
    @Test
    @DisplayName("EnvironmentDto round-trips with snake_case JSON property names")
    void environmentDtoRoundTripsWithSnakeCase() throws Exception {
        EnvironmentDto dto = new EnvironmentDto(
            "env-1",
            "Production",
            "Live customer-facing environment",
            "tier:1",
            "2026-01-01",
            "2027-01-01",
            "PROD",
            "ACTIVE",
            Boolean.TRUE,
            Boolean.FALSE,
            "platform-team",
            "CRITICAL",
            null, null, null, null, null, null,
            null, null, null, null, null
        );

        String json = objectMapper.writeValueAsString(dto);

        // snake_case JSON property names are present
        assertThat(json).contains("\"id\":\"env-1\"");
        assertThat(json).contains("\"name\":\"Production\"");
        assertThat(json).contains("\"valid_from\":\"2026-01-01\"");
        assertThat(json).contains("\"valid_to\":\"2027-01-01\"");
        assertThat(json).contains("\"environment_type\":\"PROD\"");
        assertThat(json).contains("\"lifecycle_state\":\"ACTIVE\"");
        assertThat(json).contains("\"is_current_state\":true");
        assertThat(json).contains("\"is_target_state\":false");
        assertThat(json).contains("\"criticality\":\"CRITICAL\"");

        // model_file_id MUST NOT be present in the DTO JSON
        assertThat(json).doesNotContain("model_file_id");

        // camelCase Java field names MUST NOT leak into JSON
        assertThat(json).doesNotContain("validFrom");
        assertThat(json).doesNotContain("isCurrentState");
        assertThat(json).doesNotContain("environmentType");

        // Round-trip back to DTO
        EnvironmentDto parsed = objectMapper.readValue(json, EnvironmentDto.class);
        assertThat(parsed).isEqualTo(dto);
    }

    /**
     * Test 2 (3.1): InfrastructurePointDto serialises point_kind and the 12
     * nullable typed FK fields as snake_case.
     */
    @Test
    @DisplayName("InfrastructurePointDto serialises point_kind and 12 typed FK fields as snake_case")
    void infrastructurePointDtoSerialisesPointKindAndTypedFksAsSnakeCase() throws Exception {
        InfrastructurePointDto dto = new InfrastructurePointDto(
            "ip-1",
            "COMPUTE_RESOURCE",
            null,            // environment_id
            null,            // cloud_account_id
            null,            // location_id
            null,            // network_id
            null,            // subnet_id
            null,            // compute_cluster_id
            "cr-100",        // compute_resource_id (the only one set)
            null,            // deployment_unit_id
            null,            // load_balancer_id
            null,            // listener_id
            null,            // data_store_instance_id
            null             // infrastructure_resource_id
        );

        String json = objectMapper.writeValueAsString(dto);

        // discriminator + the populated typed FK present in snake_case
        assertThat(json).contains("\"point_kind\":\"COMPUTE_RESOURCE\"");
        assertThat(json).contains("\"compute_resource_id\":\"cr-100\"");

        // the 12 typed FK names should all be snake_case keys
        assertThat(json).contains("\"environment_id\"");
        assertThat(json).contains("\"cloud_account_id\"");
        assertThat(json).contains("\"location_id\"");
        assertThat(json).contains("\"network_id\"");
        assertThat(json).contains("\"subnet_id\"");
        assertThat(json).contains("\"compute_cluster_id\"");
        assertThat(json).contains("\"compute_resource_id\"");
        assertThat(json).contains("\"deployment_unit_id\"");
        assertThat(json).contains("\"load_balancer_id\"");
        assertThat(json).contains("\"listener_id\"");
        assertThat(json).contains("\"data_store_instance_id\"");
        assertThat(json).contains("\"infrastructure_resource_id\"");

        // camelCase variants must not leak
        assertThat(json).doesNotContain("pointKind");
        assertThat(json).doesNotContain("computeResourceId");
        assertThat(json).doesNotContain("computeClusterId");

        // model_file_id must not be present (server-side only)
        assertThat(json).doesNotContain("model_file_id");

        // Round-trip back to DTO
        InfrastructurePointDto parsed = objectMapper.readValue(json, InfrastructurePointDto.class);
        assertThat(parsed).isEqualTo(dto);
    }

    /**
     * Test 3 (3.1): DeploymentUnitComputeResourceDto.compute_infrastructure_point_id
     * is the JSON property name (A2 decision). The Java field is
     * computeInfrastructurePointId. Also verify runtime_config snake_case for
     * the JSONB raw-JSON field, and confidence as BigDecimal scale 3.
     */
    @Test
    @DisplayName("DeploymentUnitComputeResourceDto serialises compute_infrastructure_point_id (A2)")
    void deploymentUnitComputeResourceDtoSerialisesComputeInfrastructurePointId() throws Exception {
        DeploymentUnitComputeResourceDto dto = new DeploymentUnitComputeResourceDto(
            "ducr-1",
            "du-1",
            "ip-cluster-7",                                // compute_infrastructure_point_id
            "env-1",
            "1.2.3",
            "{\"replicas\":3}",                            // runtime_config (raw JSON String)
            3,
            1,
            5,
            "DEPLOYED",
            "ci-pipeline-12345",
            new BigDecimal("0.875"),
            "tier:1",
            null, null, null, null, null, null
        );

        String json = objectMapper.writeValueAsString(dto);

        // The renamed A2 field must serialise as compute_infrastructure_point_id
        assertThat(json).contains("\"compute_infrastructure_point_id\":\"ip-cluster-7\"");

        // The old camelCase or pre-rename identifier must NOT leak
        assertThat(json).doesNotContain("computeInfrastructurePointId");
        assertThat(json).doesNotContain("compute_resource_id");

        // runtime_config snake_case + raw JSON String shape
        assertThat(json).contains("\"runtime_config\":\"{\\\"replicas\\\":3}\"");

        // confidence is a BigDecimal scale 3
        assertThat(json).contains("\"confidence\":0.875");

        // remaining snake_case keys
        assertThat(json).contains("\"deployment_unit_id\":\"du-1\"");
        assertThat(json).contains("\"environment_id\":\"env-1\"");
        assertThat(json).contains("\"desired_instances\":3");
        assertThat(json).contains("\"min_instances\":1");
        assertThat(json).contains("\"max_instances\":5");
        assertThat(json).contains("\"deployment_status\":\"DEPLOYED\"");
        assertThat(json).contains("\"evidence_source\":\"ci-pipeline-12345\"");

        // model_file_id must not be present
        assertThat(json).doesNotContain("model_file_id");

        // Round-trip back to DTO; Java field stays computeInfrastructurePointId
        DeploymentUnitComputeResourceDto parsed =
            objectMapper.readValue(json, DeploymentUnitComputeResourceDto.class);
        assertThat(parsed.computeInfrastructurePointId()).isEqualTo("ip-cluster-7");
        assertThat(parsed.runtimeConfig()).isEqualTo("{\"replicas\":3}");
        assertThat(parsed.confidence().compareTo(new BigDecimal("0.875"))).isZero();
    }

    /**
     * Test 4 (3.1): LoadBalancerResourceRouteDto.target_infrastructure_point_id
     * JSON name and Java field name (targetInfrastructurePointId) match the
     * R3 spec.
     */
    @Test
    @DisplayName("LoadBalancerResourceRouteDto serialises target_infrastructure_point_id (R3)")
    void loadBalancerResourceRouteDtoSerialisesTargetInfrastructurePointId() throws Exception {
        LoadBalancerResourceRouteDto dto = new LoadBalancerResourceRouteDto(
            "lbrr-1",
            "lb-1",
            "ls-1",
            "ip-target-9",                  // target_infrastructure_point_id
            "env-1",
            "HTTPS",
            443,
            "api.example.com",
            "/v1/*",
            "WEIGHTED",
            100,
            "/health",
            "tier:1",
            null, null, null, null, null, null
        );

        String json = objectMapper.writeValueAsString(dto);

        // The R3 polymorphic target field serialises as snake_case
        assertThat(json).contains("\"target_infrastructure_point_id\":\"ip-target-9\"");

        // camelCase Java field name must NOT leak
        assertThat(json).doesNotContain("targetInfrastructurePointId");

        // remaining snake_case keys
        assertThat(json).contains("\"load_balancer_id\":\"lb-1\"");
        assertThat(json).contains("\"listener_id\":\"ls-1\"");
        assertThat(json).contains("\"environment_id\":\"env-1\"");
        assertThat(json).contains("\"target_port\":443");
        assertThat(json).contains("\"host_name\":\"api.example.com\"");
        assertThat(json).contains("\"path_pattern\":\"/v1/*\"");
        assertThat(json).contains("\"routing_type\":\"WEIGHTED\"");
        assertThat(json).contains("\"health_check_path\":\"/health\"");

        // model_file_id must not be present
        assertThat(json).doesNotContain("model_file_id");

        // Round-trip back to DTO; Java field stays targetInfrastructurePointId
        LoadBalancerResourceRouteDto parsed =
            objectMapper.readValue(json, LoadBalancerResourceRouteDto.class);
        assertThat(parsed.targetInfrastructurePointId()).isEqualTo("ip-target-9");
        assertThat(parsed.loadBalancerId()).isEqualTo("lb-1");
        assertThat(parsed.listenerId()).isEqualTo("ls-1");
    }
}
