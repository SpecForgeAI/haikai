package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ApplicationComputeDeploymentEntity;
import com.example.architecturemodel.model.entity.ApplicationInfrastructureResourceUseEntity;
import com.example.architecturemodel.model.entity.ApplicationLoadBalancerExposureEntity;
import com.example.architecturemodel.model.entity.DataEntityDataStoreHostingEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.relationship.ApplicationComputeDeploymentRepository;
import com.example.architecturemodel.repository.relationship.ApplicationInfrastructureResourceUseRepository;
import com.example.architecturemodel.repository.relationship.ApplicationLoadBalancerExposureRepository;
import com.example.architecturemodel.repository.relationship.DataEntityDataStoreHostingRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.ActiveProfiles;

import java.time.OffsetDateTime;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Cross-table constraint validation for the 4 new infrastructure cross-domain
 * relationship tables (Spec: 2026-05-05-infrastructure-cross-domain-integration,
 * Task 1.1).
 *
 * <p>The codebase's H2 test profile uses Hibernate ddl-auto=create-drop, which
 * generates the schema from JPA entity annotations. Since cross-domain FKs are
 * mapped as plain {@code @Column} String fields (matching DataMovementEntity
 * and the spec 2 Infra-internal relationship pattern), pure cross-table FK
 * constraints are not emitted by Hibernate at the H2 layer. The schema-level
 * constraints that ARE generated and enforced are the
 * {@code @Column(nullable = false)} markers on the required envelope columns
 * (description, tags, model_file_id, plus the per-relationship required FK
 * column ids).</p>
 *
 * <p>Each test inserts a row that omits one of the spec'd NOT NULL columns
 * (e.g. {@code description}) and asserts the persistence layer rejects it
 * with {@link DataIntegrityViolationException}. This is the closest practical
 * cross-table-shape constraint check available within the {@code @DataJpaTest}
 * slice for this codebase.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
class InfrastructureCrossDomainFkConstraintTest {

    @Autowired
    private ApplicationComputeDeploymentRepository applicationComputeDeploymentRepository;

    @Autowired
    private DataEntityDataStoreHostingRepository dataEntityDataStoreHostingRepository;

    @Autowired
    private ApplicationInfrastructureResourceUseRepository applicationInfrastructureResourceUseRepository;

    @Autowired
    private ApplicationLoadBalancerExposureRepository applicationLoadBalancerExposureRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    private String modelFileId;

    @BeforeEach
    void setUp() {
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id("xdom-fk-mf")
            .filename("xdom-fk-test.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        modelFileRepository.save(modelFile);
        modelFileRepository.flush();
        modelFileId = modelFile.getId();
    }

    /**
     * Test 1 (1.1): ApplicationComputeDeploymentEntity (XR1) rejects rows
     * missing the required {@code description} envelope column.
     */
    @Test
    void applicationComputeDeploymentRejectsRowWithNullDescription() {
        ApplicationComputeDeploymentEntity invalid = ApplicationComputeDeploymentEntity.builder()
            .id("xr1-bad-desc")
            .modelFileId(modelFileId)
            .applicationPointId("ap-x")
            .computeResourceId("cr-x")
            // description intentionally null -- spec contract: TEXT NOT NULL
            .tags("[]")
            .build();
        assertThatThrownBy(() -> {
            applicationComputeDeploymentRepository.save(invalid);
            applicationComputeDeploymentRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * Test 2 (1.1): DataEntityDataStoreHostingEntity (XR2) rejects rows
     * missing the required {@code tags} envelope column.
     */
    @Test
    void dataEntityDataStoreHostingRejectsRowWithNullTags() {
        DataEntityDataStoreHostingEntity invalid = DataEntityDataStoreHostingEntity.builder()
            .id("xr2-bad-tags")
            .modelFileId(modelFileId)
            .dataEntityPointId("dep-x")
            .dataStoreInstanceId("ds-x")
            .description("hosts customer entity in OLTP")
            // tags intentionally null -- spec contract: TEXT NOT NULL
            .build();
        assertThatThrownBy(() -> {
            dataEntityDataStoreHostingRepository.save(invalid);
            dataEntityDataStoreHostingRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * Test 3 (1.1): ApplicationInfrastructureResourceUseEntity (XR3) rejects
     * rows missing the required {@code application_point_id} FK column.
     */
    @Test
    void applicationInfrastructureResourceUseRejectsRowWithNullApplicationPointId() {
        ApplicationInfrastructureResourceUseEntity invalid =
            ApplicationInfrastructureResourceUseEntity.builder()
            .id("xr3-bad-ap")
            .modelFileId(modelFileId)
            // applicationPointId intentionally null -- spec contract: NOT NULL FK
            .infrastructureResourceId("ir-x")
            .description("queue consumer")
            .tags("[]")
            .build();
        assertThatThrownBy(() -> {
            applicationInfrastructureResourceUseRepository.save(invalid);
            applicationInfrastructureResourceUseRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * Test 4 (1.1): ApplicationLoadBalancerExposureEntity (XR4) rejects rows
     * missing the required {@code load_balancer_id} FK column. This validates
     * the Q2 endpoint shape: load_balancer_id is NOT NULL (listener_id is
     * nullable, by contrast).
     */
    @Test
    void applicationLoadBalancerExposureRejectsRowWithNullLoadBalancerId() {
        ApplicationLoadBalancerExposureEntity invalid = ApplicationLoadBalancerExposureEntity.builder()
            .id("xr4-bad-lb")
            .modelFileId(modelFileId)
            .applicationPointId("ap-x")
            // loadBalancerId intentionally null -- spec contract: NOT NULL (Q2)
            .description("public ingress")
            .tags("[]")
            .build();
        assertThatThrownBy(() -> {
            applicationLoadBalancerExposureRepository.save(invalid);
            applicationLoadBalancerExposureRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }
}
