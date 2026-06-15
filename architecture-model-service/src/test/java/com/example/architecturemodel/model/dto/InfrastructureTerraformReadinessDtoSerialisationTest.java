package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.model.dto.entity.IaCSourceDto;
import com.example.architecturemodel.model.dto.relationship.IaCResourceBindingDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * JSON serialisation / deserialisation tests for the 2 new IaC DTOs (Spec:
 * 2026-05-05-infrastructure-terraform-discovery-readiness, Task 3.1).
 *
 * <p>Tests:</p>
 * <ol>
 *   <li>{@link IaCSourceDto} round-trips through Jackson with snake_case JSON
 *       property names ({@code repository_url}, {@code commit_sha},
 *       {@code last_scanned_at}); {@code model_file_id} excluded.</li>
 *   <li>{@link IaCResourceBindingDto} serialises {@code confidence} as decimal
 *       scale 3, {@code start_line} / {@code end_line} as integer JSON,
 *       {@code iac_source_id} / {@code infrastructure_point_id} as snake_case;
 *       {@code model_file_id} excluded.</li>
 * </ol>
 */
class InfrastructureTerraformReadinessDtoSerialisationTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
    }

    @Test
    @DisplayName("IaCSourceDto round-trips with snake_case JSON property names and no model_file_id")
    void iacSourceDtoRoundTripsWithSnakeCase() throws Exception {
        IaCSourceDto dto = new IaCSourceDto(
            "iac-src-1",
            "Orders Terraform Repo",
            "Primary IaC source for the Orders service",
            "[\"terraform\",\"orders\"]",
            "2026-01-01T00:00:00Z",
            null,
            "env-prod",
            "TERRAFORM",
            "https://github.com/example/orders-iac",
            "GITHUB",
            "main",
            "a1b2c3d4e5f6",
            "modules/orders",
            "default",
            "orders_service",
            "modules/orders/service",
            "GCP",
            "platform-team",
            "2026-05-05T10:00:00Z",
            "2026-05-05T10:05:00Z"
        );

        String json = objectMapper.writeValueAsString(dto);

        assertThat(json).contains("\"id\":\"iac-src-1\"");
        assertThat(json).contains("\"name\":\"Orders Terraform Repo\"");
        assertThat(json).contains("\"valid_from\":\"2026-01-01T00:00:00Z\"");
        assertThat(json).contains("\"environment_id\":\"env-prod\"");
        assertThat(json).contains("\"source_type\":\"TERRAFORM\"");
        assertThat(json).contains("\"repository_url\":\"https://github.com/example/orders-iac\"");
        assertThat(json).contains("\"repository_provider\":\"GITHUB\"");
        assertThat(json).contains("\"commit_sha\":\"a1b2c3d4e5f6\"");
        assertThat(json).contains("\"module_name\":\"orders_service\"");
        assertThat(json).contains("\"module_path\":\"modules/orders/service\"");
        assertThat(json).contains("\"last_scanned_at\":\"2026-05-05T10:00:00Z\"");
        assertThat(json).contains("\"last_imported_at\":\"2026-05-05T10:05:00Z\"");

        // model_file_id MUST NOT be present in the DTO JSON.
        assertThat(json).doesNotContain("model_file_id");
        // camelCase Java field names MUST NOT leak into JSON.
        assertThat(json).doesNotContain("repositoryUrl");
        assertThat(json).doesNotContain("commitSha");
        assertThat(json).doesNotContain("lastScannedAt");

        IaCSourceDto parsed = objectMapper.readValue(json, IaCSourceDto.class);
        assertThat(parsed).isEqualTo(dto);
    }

    @Test
    @DisplayName("IaCResourceBindingDto serialises confidence, line numbers, snake_case keys, and excludes model_file_id")
    void iacResourceBindingDtoSerialisesConfidenceAndLineNumbersAndExcludesModelFileId() throws Exception {
        IaCResourceBindingDto dto = new IaCResourceBindingDto(
            "iac-bind-1",
            "iac-src-1",
            "ip-cr-1",
            "env-prod",
            "module.orders.google_cloud_run_v2_service.service",
            "google_cloud_run_v2_service",
            "service",
            "GCP",
            "modules/orders/main.tf",
            42,
            75,
            "state-abc",
            "projects/p/locations/l/services/orders",
            "CONFIRMED",
            new BigDecimal("0.875"),
            "2026-05-05T10:00:00Z",
            "Binds Cloud Run service compute resource to Terraform",
            "[\"terraform\",\"prod\"]"
        );

        String json = objectMapper.writeValueAsString(dto);

        // start_line / end_line serialise as integer JSON (no quotes).
        assertThat(json).contains("\"start_line\":42");
        assertThat(json).contains("\"end_line\":75");
        // confidence is decimal -- value present at scale 3.
        assertThat(json).contains("\"confidence\":0.875");
        // snake_case JSON property names present.
        assertThat(json).contains("\"iac_source_id\":\"iac-src-1\"");
        assertThat(json).contains("\"infrastructure_point_id\":\"ip-cr-1\"");
        assertThat(json).contains("\"iac_address\":\"module.orders.google_cloud_run_v2_service.service\"");
        assertThat(json).contains("\"iac_resource_type\":\"google_cloud_run_v2_service\"");
        assertThat(json).contains("\"file_path\":\"modules/orders/main.tf\"");
        assertThat(json).contains("\"binding_status\":\"CONFIRMED\"");
        assertThat(json).contains("\"last_seen_at\":\"2026-05-05T10:00:00Z\"");

        // model_file_id MUST NOT be present in the DTO JSON.
        assertThat(json).doesNotContain("model_file_id");
        // camelCase Java field names MUST NOT leak into JSON.
        assertThat(json).doesNotContain("iacSourceId");
        assertThat(json).doesNotContain("infrastructurePointId");
        assertThat(json).doesNotContain("startLine");
        assertThat(json).doesNotContain("endLine");
        assertThat(json).doesNotContain("filePath");

        IaCResourceBindingDto parsed = objectMapper.readValue(json, IaCResourceBindingDto.class);
        assertThat(parsed).isEqualTo(dto);
    }
}
