package com.example.architecturemodel.model.entity;

import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.ComputeResourceRepository;
import com.example.architecturemodel.repository.entity.EnvironmentRepository;
import com.example.architecturemodel.repository.entity.InfrastructurePointRepository;
import com.example.architecturemodel.repository.relationship.DeploymentUnitComputeResourceRepository;
import com.example.architecturemodel.repository.relationship.ResourceSubnetHostingRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Entity-mapping round-trip tests for the 16 infrastructure JPA entities.
 *
 * Tests asserted by Task 2.1:
 *   1. InfrastructurePointEntity round-trips with point_kind=COMPUTE_RESOURCE
 *      and only compute_resource_id set.
 *   2. EnvironmentEntity round-trips with all standard envelope fields
 *      populated.
 *   3. DeploymentUnitComputeResourceEntity.runtimeConfig round-trips a JSONB
 *      string blob.
 *   4. ResourceSubnetHostingEntity.confidence round-trips a BigDecimal with
 *      scale 3 (e.g. 0.875).
 *
 * H2 does not natively understand JSONB; the {@code INIT=CREATE DOMAIN}
 * clause registers JSONB as a domain alias for JSON so Hibernate's generated
 * DDL ("... jsonb ...") for the runtime_config column is accepted. This
 * mirrors the pattern already used by ServiceTechHintsResolvedPersistenceTest.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation (Task Group 2.1)
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:infrastructureentitymapping;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class InfrastructureEntityMappingTest {

    @Autowired
    private InfrastructurePointRepository infrastructurePointRepository;

    @Autowired
    private EnvironmentRepository environmentRepository;

    @Autowired
    private ComputeResourceRepository computeResourceRepository;

    @Autowired
    private ResourceSubnetHostingRepository resourceSubnetHostingRepository;

    @Autowired
    private DeploymentUnitComputeResourceRepository deploymentUnitComputeResourceRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    private String modelFileId;

    @BeforeEach
    void setUp() {
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id("test-mapping-mf")
            .filename("infra-mapping-test.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        modelFileRepository.save(modelFile);
        modelFileId = modelFile.getId();
        modelFileRepository.flush();
    }

    /**
     * Test 1 (2.1): InfrastructurePointEntity round-trips through JPA with
     * point_kind='COMPUTE_RESOURCE' and only compute_resource_id set.
     */
    @Test
    void infrastructurePointEntityRoundTripsWithComputeResourceKind() {
        // Arrange: parent rows
        EnvironmentEntity env = EnvironmentEntity.builder()
            .id("env-1")
            .modelFileId(modelFileId)
            .name("PROD")
            .build();
        environmentRepository.save(env);

        ComputeResourceEntity cr = ComputeResourceEntity.builder()
            .id("cr-100")
            .modelFileId(modelFileId)
            .name("api-vm")
            .environmentId(env.getId())
            .computeType("VM")
            .build();
        computeResourceRepository.save(cr);

        InfrastructurePointEntity point = InfrastructurePointEntity.builder()
            .id("ip-1")
            .modelFileId(modelFileId)
            .pointKind("COMPUTE_RESOURCE")
            .computeResourceId(cr.getId())
            .build();

        // Act
        infrastructurePointRepository.save(point);
        infrastructurePointRepository.flush();
        InfrastructurePointEntity loaded = infrastructurePointRepository.findById("ip-1").orElseThrow();

        // Assert: round-trip integrity, only compute_resource_id set
        assertThat(loaded.getId()).isEqualTo("ip-1");
        assertThat(loaded.getModelFileId()).isEqualTo(modelFileId);
        assertThat(loaded.getPointKind()).isEqualTo("COMPUTE_RESOURCE");
        assertThat(loaded.getComputeResourceId()).isEqualTo("cr-100");
        assertThat(loaded.getEnvironmentId()).isNull();
        assertThat(loaded.getCloudAccountId()).isNull();
        assertThat(loaded.getLocationId()).isNull();
        assertThat(loaded.getNetworkId()).isNull();
        assertThat(loaded.getSubnetId()).isNull();
        assertThat(loaded.getComputeClusterId()).isNull();
        assertThat(loaded.getDeploymentUnitId()).isNull();
        assertThat(loaded.getLoadBalancerId()).isNull();
        assertThat(loaded.getListenerId()).isNull();
        assertThat(loaded.getDataStoreInstanceId()).isNull();
        assertThat(loaded.getInfrastructureResourceId()).isNull();
    }

    /**
     * Test 2 (2.1): EnvironmentEntity round-trips with every standard
     * envelope field populated.
     */
    @Test
    void environmentEntityRoundTripsWithFullEnvelope() {
        EnvironmentEntity env = EnvironmentEntity.builder()
            .id("env-full")
            .modelFileId(modelFileId)
            .name("Production")
            .description("Live customer-facing environment")
            .tags("tier:1,owner:platform")
            .validFrom("2026-01-01")
            .validTo("2027-01-01")
            .environmentType("PROD")
            .lifecycleState("ACTIVE")
            .isCurrentState(Boolean.TRUE)
            .isTargetState(Boolean.FALSE)
            .owner("platform-team")
            .criticality("CRITICAL")
            .build();

        environmentRepository.save(env);
        environmentRepository.flush();
        EnvironmentEntity loaded = environmentRepository.findById("env-full").orElseThrow();

        assertThat(loaded.getId()).isEqualTo("env-full");
        assertThat(loaded.getModelFileId()).isEqualTo(modelFileId);
        assertThat(loaded.getName()).isEqualTo("Production");
        assertThat(loaded.getDescription()).isEqualTo("Live customer-facing environment");
        assertThat(loaded.getTags()).isEqualTo("tier:1,owner:platform");
        assertThat(loaded.getValidFrom()).isEqualTo("2026-01-01");
        assertThat(loaded.getValidTo()).isEqualTo("2027-01-01");
        assertThat(loaded.getEnvironmentType()).isEqualTo("PROD");
        assertThat(loaded.getLifecycleState()).isEqualTo("ACTIVE");
        assertThat(loaded.getIsCurrentState()).isTrue();
        assertThat(loaded.getIsTargetState()).isFalse();
        assertThat(loaded.getOwner()).isEqualTo("platform-team");
        assertThat(loaded.getCriticality()).isEqualTo("CRITICAL");
    }

    /**
     * Test 3 (2.1): DeploymentUnitComputeResourceEntity.runtimeConfig
     * round-trips a JSONB string blob.
     */
    @Test
    void deploymentUnitComputeResourceRuntimeConfigRoundTripsAsJsonbString() {
        // Arrange parents needed for the row's logical FK columns. FK
        // constraints are not enforced at the H2 schema level (the entities
        // map them as plain String columns), so we only need a
        // realistic-looking value.
        EnvironmentEntity env = EnvironmentEntity.builder()
            .id("env-r2")
            .modelFileId(modelFileId)
            .name("DEV")
            .build();
        environmentRepository.save(env);

        ComputeResourceEntity cr = ComputeResourceEntity.builder()
            .id("cr-r2")
            .modelFileId(modelFileId)
            .name("svc-vm")
            .environmentId(env.getId())
            .build();
        computeResourceRepository.save(cr);

        InfrastructurePointEntity point = InfrastructurePointEntity.builder()
            .id("ip-r2")
            .modelFileId(modelFileId)
            .pointKind("COMPUTE_RESOURCE")
            .computeResourceId(cr.getId())
            .build();
        infrastructurePointRepository.save(point);
        infrastructurePointRepository.flush();

        String runtimeConfigJson = "{\"replicas\":3,\"env\":{\"LOG_LEVEL\":\"info\"},\"flags\":[\"a\",\"b\"]}";

        DeploymentUnitComputeResourceEntity rel = DeploymentUnitComputeResourceEntity.builder()
            .id("ducr-1")
            .modelFileId(modelFileId)
            .deploymentUnitId("du-1")
            .computeInfrastructurePointId(point.getId())
            .environmentId(env.getId())
            .version("1.2.3")
            .runtimeConfig(runtimeConfigJson)
            .desiredInstances(3)
            .minInstances(1)
            .maxInstances(5)
            .deploymentStatus("DEPLOYED")
            .evidenceSource("ci-pipeline-12345")
            .confidence(new BigDecimal("0.950"))
            .tags("tier:1")
            .build();

        deploymentUnitComputeResourceRepository.save(rel);
        deploymentUnitComputeResourceRepository.flush();
        DeploymentUnitComputeResourceEntity loaded =
            deploymentUnitComputeResourceRepository.findById("ducr-1").orElseThrow();

        assertThat(loaded.getRuntimeConfig()).isNotNull();
        // Round-trip preserves logical JSON content. Whitespace formatting
        // through the JDBC JSON binding is deterministic but may vary by
        // driver, so assert on the parsed payload's substantive content.
        assertThat(loaded.getRuntimeConfig()).contains("\"replicas\":3");
        assertThat(loaded.getRuntimeConfig()).contains("\"LOG_LEVEL\":\"info\"");
        assertThat(loaded.getRuntimeConfig()).contains("\"flags\":[\"a\",\"b\"]");
        assertThat(loaded.getComputeInfrastructurePointId()).isEqualTo("ip-r2");
        assertThat(loaded.getDesiredInstances()).isEqualTo(3);
        assertThat(loaded.getMinInstances()).isEqualTo(1);
        assertThat(loaded.getMaxInstances()).isEqualTo(5);
    }

    /**
     * Test 4 (2.1): ResourceSubnetHostingEntity.confidence round-trips a
     * BigDecimal with scale 3 (e.g. 0.875).
     */
    @Test
    void resourceSubnetHostingConfidenceRoundTripsAsBigDecimalScale3() {
        BigDecimal expected = new BigDecimal("0.875");

        ResourceSubnetHostingEntity hosting = ResourceSubnetHostingEntity.builder()
            .id("rsh-1")
            .modelFileId(modelFileId)
            .infrastructurePointId("ip-x")
            .subnetId("sub-x")
            .environmentId("env-x")
            .relationshipRole("PRIMARY")
            .primaryIp("10.0.0.10")
            .privateIp("10.0.0.10")
            .publicIp(null)
            .evidenceSource("discovery-run-42")
            .confidence(expected)
            .tags("tier:1")
            .build();

        resourceSubnetHostingRepository.save(hosting);
        resourceSubnetHostingRepository.flush();
        ResourceSubnetHostingEntity loaded =
            resourceSubnetHostingRepository.findById("rsh-1").orElseThrow();

        assertThat(loaded.getConfidence()).isNotNull();
        assertThat(loaded.getConfidence().compareTo(expected)).isZero();
        // Verify scale precision is preserved at scale 3.
        assertThat(loaded.getConfidence().scale()).isEqualTo(3);
    }
}
