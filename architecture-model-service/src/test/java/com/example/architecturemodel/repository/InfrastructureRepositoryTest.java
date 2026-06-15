package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.ComputeResourceEntity;
import com.example.architecturemodel.model.entity.DeploymentUnitComputeResourceEntity;
import com.example.architecturemodel.model.entity.EnvironmentEntity;
import com.example.architecturemodel.model.entity.InfrastructurePointEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.entity.EnvironmentRepository;
import com.example.architecturemodel.repository.entity.InfrastructurePointRepository;
import com.example.architecturemodel.repository.relationship.DeploymentUnitComputeResourceRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.time.OffsetDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Repository scoping tests for the infrastructure-domain repositories.
 *
 * Tests asserted by Task 4.1:
 *   1. EnvironmentRepository.findByModelFileId(modelFileId) returns only rows
 *      for that model file.
 *   2. InfrastructurePointRepository.findByModelFileId(modelFileId) returns
 *      rows across multiple point_kind values.
 *   3. DeploymentUnitComputeResourceRepository.deleteByModelFileId(modelFileId)
 *      removes only the matching rows.
 *
 * H2 does not natively understand JSONB; the {@code INIT=CREATE DOMAIN} clause
 * registers JSONB as a domain alias for JSON so Hibernate-generated DDL for the
 * runtime_config column is accepted, mirroring the convention used by
 * InfrastructureEntityMappingTest.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation (Task Group 4.1)
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:infrastructurerepository;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class InfrastructureRepositoryTest {

    @Autowired
    private ModelFileRepository modelFileRepository;

    @Autowired
    private EnvironmentRepository environmentRepository;

    @Autowired
    private InfrastructurePointRepository infrastructurePointRepository;

    @Autowired
    private DeploymentUnitComputeResourceRepository deploymentUnitComputeResourceRepository;

    @Autowired
    private com.example.architecturemodel.repository.entity.ComputeResourceRepository computeResourceRepository;

    @Autowired
    private com.example.architecturemodel.repository.entity.ComputeClusterRepository computeClusterRepository;

    private String modelFileIdA;
    private String modelFileIdB;

    @BeforeEach
    void setUp() {
        ModelFileEntity mfA = ModelFileEntity.builder()
            .id("mf-A")
            .filename("model-A.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        ModelFileEntity mfB = ModelFileEntity.builder()
            .id("mf-B")
            .filename("model-B.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        modelFileRepository.save(mfA);
        modelFileRepository.save(mfB);
        modelFileRepository.flush();
        modelFileIdA = mfA.getId();
        modelFileIdB = mfB.getId();
    }

    /**
     * Test 1 (4.1): EnvironmentRepository.findByModelFileId returns only rows
     * for the requested model file (no cross-model-file leakage).
     */
    @Test
    void environmentRepositoryFindByModelFileIdScopesByModelFile() {
        EnvironmentEntity envA1 = EnvironmentEntity.builder()
            .id("env-A1").modelFileId(modelFileIdA).name("PROD-A").build();
        EnvironmentEntity envA2 = EnvironmentEntity.builder()
            .id("env-A2").modelFileId(modelFileIdA).name("DEV-A").build();
        EnvironmentEntity envB1 = EnvironmentEntity.builder()
            .id("env-B1").modelFileId(modelFileIdB).name("PROD-B").build();
        environmentRepository.save(envA1);
        environmentRepository.save(envA2);
        environmentRepository.save(envB1);
        environmentRepository.flush();

        List<EnvironmentEntity> resultA = environmentRepository.findByModelFileId(modelFileIdA);
        List<EnvironmentEntity> resultB = environmentRepository.findByModelFileId(modelFileIdB);

        assertThat(resultA).extracting(EnvironmentEntity::getId)
            .containsExactlyInAnyOrder("env-A1", "env-A2");
        assertThat(resultB).extracting(EnvironmentEntity::getId)
            .containsExactlyInAnyOrder("env-B1");
    }

    /**
     * Test 2 (4.1): InfrastructurePointRepository.findByModelFileId returns
     * rows across multiple point_kind values.
     */
    @Test
    void infrastructurePointRepositoryFindByModelFileIdSpansMultiplePointKinds() {
        // Arrange parent rows so the polymorphic CHECK is satisfied.
        environmentRepository.save(EnvironmentEntity.builder()
            .id("env-multi").modelFileId(modelFileIdA).name("PROD").build());
        computeResourceRepository.save(ComputeResourceEntity.builder()
            .id("cr-multi").modelFileId(modelFileIdA)
            .name("api-vm").environmentId("env-multi")
            .build());
        computeClusterRepository.save(com.example.architecturemodel.model.entity.ComputeClusterEntity.builder()
            .id("cc-multi").modelFileId(modelFileIdA)
            .name("api-cluster").environmentId("env-multi")
            .build());

        InfrastructurePointEntity pEnv = InfrastructurePointEntity.builder()
            .id("ip-env").modelFileId(modelFileIdA)
            .pointKind("ENVIRONMENT").environmentId("env-multi")
            .build();
        InfrastructurePointEntity pCr = InfrastructurePointEntity.builder()
            .id("ip-cr").modelFileId(modelFileIdA)
            .pointKind("COMPUTE_RESOURCE").computeResourceId("cr-multi")
            .build();
        InfrastructurePointEntity pCc = InfrastructurePointEntity.builder()
            .id("ip-cc").modelFileId(modelFileIdA)
            .pointKind("COMPUTE_CLUSTER").computeClusterId("cc-multi")
            .build();
        infrastructurePointRepository.save(pEnv);
        infrastructurePointRepository.save(pCr);
        infrastructurePointRepository.save(pCc);
        infrastructurePointRepository.flush();

        List<InfrastructurePointEntity> result =
            infrastructurePointRepository.findByModelFileId(modelFileIdA);

        assertThat(result).extracting(InfrastructurePointEntity::getId)
            .containsExactlyInAnyOrder("ip-env", "ip-cr", "ip-cc");
        assertThat(result).extracting(InfrastructurePointEntity::getPointKind)
            .containsExactlyInAnyOrder("ENVIRONMENT", "COMPUTE_RESOURCE", "COMPUTE_CLUSTER");
    }

    /**
     * Test 3 (4.1): DeploymentUnitComputeResourceRepository.deleteByModelFileId
     * removes only the rows matching the given modelFileId.
     */
    @Test
    void deploymentUnitComputeResourceRepositoryDeleteByModelFileIdScopesByModelFile() {
        // Arrange parents (FKs not enforced at the H2 layer for plain String
        // columns, but we keep realistic shapes for clarity).
        environmentRepository.save(EnvironmentEntity.builder()
            .id("env-delA").modelFileId(modelFileIdA).name("ENV-A").build());
        environmentRepository.save(EnvironmentEntity.builder()
            .id("env-delB").modelFileId(modelFileIdB).name("ENV-B").build());
        computeResourceRepository.save(ComputeResourceEntity.builder()
            .id("cr-delA").modelFileId(modelFileIdA)
            .name("api-A").environmentId("env-delA").build());
        computeResourceRepository.save(ComputeResourceEntity.builder()
            .id("cr-delB").modelFileId(modelFileIdB)
            .name("api-B").environmentId("env-delB").build());

        InfrastructurePointEntity pA = InfrastructurePointEntity.builder()
            .id("ip-delA").modelFileId(modelFileIdA)
            .pointKind("COMPUTE_RESOURCE").computeResourceId("cr-delA")
            .build();
        InfrastructurePointEntity pB = InfrastructurePointEntity.builder()
            .id("ip-delB").modelFileId(modelFileIdB)
            .pointKind("COMPUTE_RESOURCE").computeResourceId("cr-delB")
            .build();
        infrastructurePointRepository.save(pA);
        infrastructurePointRepository.save(pB);
        infrastructurePointRepository.flush();

        DeploymentUnitComputeResourceEntity ducrA = DeploymentUnitComputeResourceEntity.builder()
            .id("ducr-delA").modelFileId(modelFileIdA)
            .deploymentUnitId("du-A").computeInfrastructurePointId("ip-delA")
            .environmentId("env-delA").build();
        DeploymentUnitComputeResourceEntity ducrB = DeploymentUnitComputeResourceEntity.builder()
            .id("ducr-delB").modelFileId(modelFileIdB)
            .deploymentUnitId("du-B").computeInfrastructurePointId("ip-delB")
            .environmentId("env-delB").build();
        deploymentUnitComputeResourceRepository.save(ducrA);
        deploymentUnitComputeResourceRepository.save(ducrB);
        deploymentUnitComputeResourceRepository.flush();

        // Sanity: both rows present.
        assertThat(deploymentUnitComputeResourceRepository.findByModelFileId(modelFileIdA)).hasSize(1);
        assertThat(deploymentUnitComputeResourceRepository.findByModelFileId(modelFileIdB)).hasSize(1);

        // Act
        deploymentUnitComputeResourceRepository.deleteByModelFileId(modelFileIdA);
        deploymentUnitComputeResourceRepository.flush();

        // Assert: only model-A rows are removed.
        assertThat(deploymentUnitComputeResourceRepository.findByModelFileId(modelFileIdA)).isEmpty();
        assertThat(deploymentUnitComputeResourceRepository.findByModelFileId(modelFileIdB))
            .extracting(DeploymentUnitComputeResourceEntity::getId)
            .containsExactly("ducr-delB");
    }
}
