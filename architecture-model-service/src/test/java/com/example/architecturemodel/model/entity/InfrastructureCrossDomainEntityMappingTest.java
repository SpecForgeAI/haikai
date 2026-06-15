package com.example.architecturemodel.model.entity;

import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.relationship.ApplicationComputeDeploymentRepository;
import com.example.architecturemodel.repository.relationship.ApplicationLoadBalancerExposureRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Entity-mapping round-trip tests for the 4 infrastructure cross-domain
 * relationship JPA entities (Spec:
 * 2026-05-05-infrastructure-cross-domain-integration, Task 2.1).
 *
 * <p>Tests:</p>
 * <ol>
 *   <li>{@link ApplicationLoadBalancerExposureEntity} round-trips with optional
 *       {@code listener_id} set and {@code target_port} as {@code Integer}
 *       (Q2 + numeric-as-text-at-grid precedent).</li>
 *   <li>{@link ApplicationComputeDeploymentEntity} round-trips with
 *       {@code confidence} as {@link BigDecimal} scale 3 and {@code description}
 *       / {@code tags} as non-null strings (envelope contract).</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
class InfrastructureCrossDomainEntityMappingTest {

    @Autowired
    private ApplicationComputeDeploymentRepository applicationComputeDeploymentRepository;

    @Autowired
    private ApplicationLoadBalancerExposureRepository applicationLoadBalancerExposureRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    private String modelFileId;

    @BeforeEach
    void setUp() {
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id("xdom-mapping-mf")
            .filename("xdom-mapping-test.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        modelFileRepository.save(modelFile);
        modelFileRepository.flush();
        modelFileId = modelFile.getId();
    }

    /**
     * Test 1 (2.1): ApplicationLoadBalancerExposureEntity round-trips with
     * optional listener_id set and target_port as Integer.
     */
    @Test
    void applicationLoadBalancerExposureRoundTripsWithListenerAndTargetPort() {
        ApplicationLoadBalancerExposureEntity entity = ApplicationLoadBalancerExposureEntity.builder()
            .id("xr4-1")
            .modelFileId(modelFileId)
            .applicationPointId("ap-1")
            .loadBalancerId("lb-1")
            .listenerId("lst-1")
            .environmentId("env-1")
            .hostName("api.example.com")
            .pathPattern("/v1/*")
            .protocol("HTTPS")
            .targetPort(443)
            .exposure("PUBLIC")
            .evidenceSource("manual")
            .confidence(new BigDecimal("0.875"))
            .description("Public API ingress for the Orders app")
            .tags("[\"public\",\"tier:1\"]")
            .build();

        applicationLoadBalancerExposureRepository.save(entity);
        applicationLoadBalancerExposureRepository.flush();
        ApplicationLoadBalancerExposureEntity loaded =
            applicationLoadBalancerExposureRepository.findById("xr4-1").orElseThrow();

        assertThat(loaded.getId()).isEqualTo("xr4-1");
        assertThat(loaded.getModelFileId()).isEqualTo(modelFileId);
        assertThat(loaded.getApplicationPointId()).isEqualTo("ap-1");
        assertThat(loaded.getLoadBalancerId()).isEqualTo("lb-1");
        assertThat(loaded.getListenerId()).isEqualTo("lst-1");
        assertThat(loaded.getTargetPort()).isEqualTo(443);
        assertThat(loaded.getExposure()).isEqualTo("PUBLIC");
        assertThat(loaded.getProtocol()).isEqualTo("HTTPS");
        assertThat(loaded.getDescription()).isEqualTo("Public API ingress for the Orders app");
        assertThat(loaded.getTags()).isEqualTo("[\"public\",\"tier:1\"]");
    }

    /**
     * Test 2 (2.1): ApplicationComputeDeploymentEntity round-trips with
     * confidence as BigDecimal scale 3 and description / tags as non-null
     * strings.
     */
    @Test
    void applicationComputeDeploymentRoundTripsWithConfidenceAndEnvelope() {
        ApplicationComputeDeploymentEntity entity = ApplicationComputeDeploymentEntity.builder()
            .id("xr1-1")
            .modelFileId(modelFileId)
            .applicationPointId("ap-1")
            .computeResourceId("cr-1")
            .deploymentUnitId("du-1")
            .environmentId("env-1")
            .deploymentRole("PRIMARY")
            .runtimeName("node")
            .runtimeVersion("20.10")
            .evidenceSource("ci-pipeline")
            .confidence(new BigDecimal("0.950"))
            .description("Orders app on primary EKS cluster")
            .tags("[\"prod\"]")
            .build();

        applicationComputeDeploymentRepository.save(entity);
        applicationComputeDeploymentRepository.flush();
        ApplicationComputeDeploymentEntity loaded =
            applicationComputeDeploymentRepository.findById("xr1-1").orElseThrow();

        assertThat(loaded.getId()).isEqualTo("xr1-1");
        assertThat(loaded.getConfidence()).isEqualByComparingTo(new BigDecimal("0.950"));
        // Persisted scale should be 3 per DECIMAL(4,3) column definition.
        assertThat(loaded.getConfidence().scale()).isEqualTo(3);
        assertThat(loaded.getDescription()).isEqualTo("Orders app on primary EKS cluster");
        assertThat(loaded.getTags()).isEqualTo("[\"prod\"]");
        assertThat(loaded.getDeploymentRole()).isEqualTo("PRIMARY");
        assertThat(loaded.getRuntimeName()).isEqualTo("node");
        assertThat(loaded.getRuntimeVersion()).isEqualTo("20.10");
    }
}
