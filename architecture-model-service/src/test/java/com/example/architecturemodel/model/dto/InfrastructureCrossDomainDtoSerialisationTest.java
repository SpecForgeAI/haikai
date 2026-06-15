package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.model.dto.relationship.ApplicationComputeDeploymentDto;
import com.example.architecturemodel.model.dto.relationship.ApplicationLoadBalancerExposureDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * JSON serialisation / deserialisation tests for the 4 infrastructure
 * cross-domain DTOs (Spec:
 * 2026-05-05-infrastructure-cross-domain-integration, Task 3.1).
 *
 * <p>Tests:</p>
 * <ol>
 *   <li>{@link ApplicationComputeDeploymentDto} round-trips through Jackson
 *       with snake_case JSON property names
 *       ({@code application_point_id}, {@code compute_resource_id},
 *       {@code deployment_unit_id}, {@code runtime_name},
 *       {@code runtime_version}).</li>
 *   <li>{@link ApplicationLoadBalancerExposureDto} serialises
 *       {@code target_port} as integer JSON, {@code confidence} as decimal
 *       scale 3, and does NOT include {@code model_file_id}.</li>
 * </ol>
 */
class InfrastructureCrossDomainDtoSerialisationTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
    }

    @Test
    @DisplayName("ApplicationComputeDeploymentDto round-trips with snake_case JSON property names")
    void applicationComputeDeploymentDtoRoundTripsWithSnakeCase() throws Exception {
        ApplicationComputeDeploymentDto dto = new ApplicationComputeDeploymentDto(
            "xr1-1",
            "ap-1",
            "cr-1",
            "du-1",
            "env-1",
            "PRIMARY",
            "node",
            "20.10",
            "ci-pipeline",
            new BigDecimal("0.950"),
            "Orders app on primary EKS cluster",
            "[\"prod\"]"
        );

        String json = objectMapper.writeValueAsString(dto);

        assertThat(json).contains("\"id\":\"xr1-1\"");
        assertThat(json).contains("\"application_point_id\":\"ap-1\"");
        assertThat(json).contains("\"compute_resource_id\":\"cr-1\"");
        assertThat(json).contains("\"deployment_unit_id\":\"du-1\"");
        assertThat(json).contains("\"environment_id\":\"env-1\"");
        assertThat(json).contains("\"deployment_role\":\"PRIMARY\"");
        assertThat(json).contains("\"runtime_name\":\"node\"");
        assertThat(json).contains("\"runtime_version\":\"20.10\"");
        assertThat(json).contains("\"evidence_source\":\"ci-pipeline\"");
        assertThat(json).contains("\"description\":\"Orders app on primary EKS cluster\"");

        // model_file_id MUST NOT be present in the DTO JSON.
        assertThat(json).doesNotContain("model_file_id");
        // camelCase Java field names MUST NOT leak into JSON.
        assertThat(json).doesNotContain("applicationPointId");
        assertThat(json).doesNotContain("runtimeName");
        assertThat(json).doesNotContain("deploymentRole");

        ApplicationComputeDeploymentDto parsed = objectMapper.readValue(json, ApplicationComputeDeploymentDto.class);
        assertThat(parsed).isEqualTo(dto);
    }

    @Test
    @DisplayName("ApplicationLoadBalancerExposureDto serialises target_port, confidence, and excludes model_file_id")
    void applicationLoadBalancerExposureDtoSerialisesTargetPortAndConfidenceAndExcludesModelFileId() throws Exception {
        ApplicationLoadBalancerExposureDto dto = new ApplicationLoadBalancerExposureDto(
            "xr4-1",
            "ap-1",
            "lb-1",
            "lst-1",
            "env-1",
            "api.example.com",
            "/v1/*",
            "HTTPS",
            443,
            "PUBLIC",
            "manual",
            new BigDecimal("0.875"),
            "Public API ingress for Orders",
            "[\"public\"]"
        );

        String json = objectMapper.writeValueAsString(dto);

        // target_port serialises as integer JSON (no quotes).
        assertThat(json).contains("\"target_port\":443");
        // confidence is decimal -- value present at scale 3.
        assertThat(json).contains("\"confidence\":0.875");
        // snake_case JSON property names present.
        assertThat(json).contains("\"application_point_id\":\"ap-1\"");
        assertThat(json).contains("\"load_balancer_id\":\"lb-1\"");
        assertThat(json).contains("\"listener_id\":\"lst-1\"");
        assertThat(json).contains("\"host_name\":\"api.example.com\"");
        assertThat(json).contains("\"path_pattern\":\"/v1/*\"");
        assertThat(json).contains("\"exposure\":\"PUBLIC\"");

        // model_file_id MUST NOT be present in the DTO JSON.
        assertThat(json).doesNotContain("model_file_id");
        // camelCase Java field names MUST NOT leak into JSON.
        assertThat(json).doesNotContain("targetPort");
        assertThat(json).doesNotContain("loadBalancerId");
        assertThat(json).doesNotContain("hostName");

        ApplicationLoadBalancerExposureDto parsed =
            objectMapper.readValue(json, ApplicationLoadBalancerExposureDto.class);
        assertThat(parsed).isEqualTo(dto);
    }
}
