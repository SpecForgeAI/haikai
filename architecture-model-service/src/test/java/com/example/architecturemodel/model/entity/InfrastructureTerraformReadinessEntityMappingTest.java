package com.example.architecturemodel.model.entity;

import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.IaCSourceRepository;
import com.example.architecturemodel.repository.relationship.IaCResourceBindingRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Entity-mapping round-trip tests for the 2 new JPA entities introduced by
 * Spec: 2026-05-05-infrastructure-terraform-discovery-readiness, Task 2.1.
 *
 * <p>Tests:</p>
 * <ol>
 *   <li>{@link IaCSourceEntity} round-trips through JPA with full envelope
 *       (name / description / tags) plus a representative source-specific
 *       field set ({@code commit_sha}, {@code provider},
 *       {@code repository_url}).</li>
 *   <li>{@link IaCResourceBindingEntity} round-trips with {@code confidence}
 *       as {@link BigDecimal} scale 3, {@code start_line} / {@code end_line}
 *       as nullable {@link Integer}, and {@code description} / {@code tags}
 *       as non-null strings (envelope contract).</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
class InfrastructureTerraformReadinessEntityMappingTest {

    @Autowired
    private IaCSourceRepository iacSourceRepository;

    @Autowired
    private IaCResourceBindingRepository iacResourceBindingRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    private String modelFileId;

    @BeforeEach
    void setUp() {
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id("iac-mapping-mf")
            .filename("iac-mapping-test.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        modelFileRepository.save(modelFile);
        modelFileRepository.flush();
        modelFileId = modelFile.getId();
    }

    /**
     * Test 1 (2.1): IaCSourceEntity round-trips through JPA with full
     * envelope plus a representative source-specific field set.
     */
    @Test
    void iacSourceRoundTripsWithEnvelopeAndSourceSpecificFields() {
        IaCSourceEntity entity = IaCSourceEntity.builder()
            .id("iac-src-1")
            .modelFileId(modelFileId)
            .name("Orders Terraform Repo")
            .description("Primary IaC source for the Orders service")
            .tags("[\"terraform\",\"orders\"]")
            .validFrom("2026-01-01T00:00:00Z")
            .validTo(null)
            .environmentId("env-prod")
            .sourceType("TERRAFORM")
            .repositoryUrl("https://github.com/example/orders-iac")
            .repositoryProvider("GITHUB")
            .branch("main")
            .commitSha("a1b2c3d4e5f6")
            .path("modules/orders")
            .workspace("default")
            .moduleName("orders_service")
            .modulePath("modules/orders/service")
            .provider("GCP")
            .owner("platform-team")
            .lastScannedAt("2026-05-05T10:00:00Z")
            .lastImportedAt("2026-05-05T10:05:00Z")
            .build();

        iacSourceRepository.save(entity);
        iacSourceRepository.flush();

        IaCSourceEntity loaded = iacSourceRepository.findById("iac-src-1").orElseThrow();

        assertThat(loaded.getId()).isEqualTo("iac-src-1");
        assertThat(loaded.getModelFileId()).isEqualTo(modelFileId);
        assertThat(loaded.getName()).isEqualTo("Orders Terraform Repo");
        assertThat(loaded.getDescription()).isEqualTo("Primary IaC source for the Orders service");
        assertThat(loaded.getTags()).isEqualTo("[\"terraform\",\"orders\"]");
        assertThat(loaded.getSourceType()).isEqualTo("TERRAFORM");
        assertThat(loaded.getCommitSha()).isEqualTo("a1b2c3d4e5f6");
        assertThat(loaded.getProvider()).isEqualTo("GCP");
        assertThat(loaded.getRepositoryUrl()).isEqualTo("https://github.com/example/orders-iac");
        assertThat(loaded.getRepositoryProvider()).isEqualTo("GITHUB");
        assertThat(loaded.getBranch()).isEqualTo("main");
        assertThat(loaded.getModuleName()).isEqualTo("orders_service");
        assertThat(loaded.getModulePath()).isEqualTo("modules/orders/service");
        assertThat(loaded.getOwner()).isEqualTo("platform-team");
    }

    /**
     * Test 2 (2.1): IaCResourceBindingEntity round-trips with confidence as
     * BigDecimal scale 3, start_line / end_line as nullable Integer, and
     * description / tags as non-null strings.
     */
    @Test
    void iacResourceBindingRoundTripsWithConfidenceLineNumbersAndEnvelope() {
        IaCResourceBindingEntity entity = IaCResourceBindingEntity.builder()
            .id("iac-bind-1")
            .modelFileId(modelFileId)
            .iacSourceId("iac-src-1")
            .infrastructurePointId("ip-cr-1")
            .environmentId("env-prod")
            .iacAddress("module.orders.google_cloud_run_v2_service.service")
            .iacResourceType("google_cloud_run_v2_service")
            .iacResourceName("service")
            .provider("GCP")
            .filePath("modules/orders/main.tf")
            .startLine(42)
            .endLine(75)
            .stateResourceId("state-abc")
            .externalId("projects/p/locations/l/services/orders")
            .bindingStatus("CONFIRMED")
            .confidence(new BigDecimal("0.875"))
            .lastSeenAt("2026-05-05T10:00:00Z")
            .description("Binds Cloud Run service compute resource to Terraform")
            .tags("[\"terraform\",\"prod\"]")
            .build();

        iacResourceBindingRepository.save(entity);
        iacResourceBindingRepository.flush();

        IaCResourceBindingEntity loaded =
            iacResourceBindingRepository.findById("iac-bind-1").orElseThrow();

        assertThat(loaded.getId()).isEqualTo("iac-bind-1");
        assertThat(loaded.getModelFileId()).isEqualTo(modelFileId);
        assertThat(loaded.getIacSourceId()).isEqualTo("iac-src-1");
        assertThat(loaded.getInfrastructurePointId()).isEqualTo("ip-cr-1");
        assertThat(loaded.getEnvironmentId()).isEqualTo("env-prod");
        assertThat(loaded.getIacAddress())
            .isEqualTo("module.orders.google_cloud_run_v2_service.service");
        assertThat(loaded.getIacResourceType()).isEqualTo("google_cloud_run_v2_service");
        assertThat(loaded.getStartLine()).isEqualTo(42);
        assertThat(loaded.getEndLine()).isEqualTo(75);
        assertThat(loaded.getBindingStatus()).isEqualTo("CONFIRMED");
        assertThat(loaded.getConfidence()).isEqualByComparingTo(new BigDecimal("0.875"));
        // Persisted scale should be 3 per DECIMAL(4,3) column definition.
        assertThat(loaded.getConfidence().scale()).isEqualTo(3);
        assertThat(loaded.getDescription())
            .isEqualTo("Binds Cloud Run service compute resource to Terraform");
        assertThat(loaded.getTags()).isEqualTo("[\"terraform\",\"prod\"]");
    }
}
