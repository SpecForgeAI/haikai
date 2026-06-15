package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ComputeClusterEntity;
import com.example.architecturemodel.model.entity.ComputeResourceEntity;
import com.example.architecturemodel.model.entity.EnvironmentEntity;
import com.example.architecturemodel.model.entity.InfrastructurePointEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.ActiveProfiles;

import java.time.OffsetDateTime;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Repository integration tests for the polymorphic CHECK constraint and
 * partial unique indexes on the infrastructure_points table.
 *
 * Mirrors the DataEntityPointRepositoryTest constraint-coverage pattern but
 * exercises the 12-way disjunction CHECK and per-FK partial unique indexes
 * introduced by changeset 110-infrastructure-points.sql.
 *
 * Activated by Task Group 2 once entities and the supporting repositories
 * exist. The test profile uses H2 (MODE=PostgreSQL) with ddl-auto=create-drop
 * and Liquibase disabled. The 12-way CHECK is mirrored on the entity via
 * Hibernate's {@code @Check} annotation; the per-FK partial unique indexes
 * are mirrored via {@code @Table#uniqueConstraints}, which behave like
 * partial indexes because SQL standard treats NULLs as distinct in unique
 * constraints (so the rows where a given FK column is NULL never collide).
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation (Task Groups 1.1 + 2.0)
 */
@DataJpaTest
@ActiveProfiles("test")
class InfrastructurePointConstraintTest {

    @Autowired
    private InfrastructurePointRepository infrastructurePointRepository;

    @Autowired
    private EnvironmentRepository environmentRepository;

    @Autowired
    private ComputeResourceRepository computeResourceRepository;

    @Autowired
    private ComputeClusterRepository computeClusterRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    private String modelFileId;
    private String environmentId;
    private String computeResourceId;
    private String computeClusterId;

    @BeforeEach
    void setUp() {
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id("test-infra-mf")
            .filename("infra-test-model.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        modelFileRepository.save(modelFile);
        modelFileId = modelFile.getId();

        EnvironmentEntity env = EnvironmentEntity.builder()
            .id("env-prod")
            .modelFileId(modelFileId)
            .name("PROD")
            .environmentType("PROD")
            .build();
        environmentRepository.save(env);
        environmentId = env.getId();

        ComputeResourceEntity computeResource = ComputeResourceEntity.builder()
            .id("cr-1")
            .modelFileId(modelFileId)
            .name("api-vm-01")
            .environmentId(environmentId)
            .computeType("VM")
            .build();
        computeResourceRepository.save(computeResource);
        computeResourceId = computeResource.getId();

        ComputeClusterEntity computeCluster = ComputeClusterEntity.builder()
            .id("cc-1")
            .modelFileId(modelFileId)
            .name("api-cluster")
            .environmentId(environmentId)
            .platformType("KUBERNETES")
            .build();
        computeClusterRepository.save(computeCluster);
        computeClusterId = computeCluster.getId();

        modelFileRepository.flush();
    }

    /**
     * Test 1 (1.1): A point with point_kind set but every typed FK column
     * null is rejected by the polymorphic CHECK constraint.
     */
    @Test
    void rejectsRowWithZeroTypedFksSet() {
        InfrastructurePointEntity invalid = InfrastructurePointEntity.builder()
            .id("ip-zero-fk")
            .modelFileId(modelFileId)
            .pointKind("COMPUTE_RESOURCE")
            // every typed FK intentionally null
            .build();

        assertThatThrownBy(() -> {
            infrastructurePointRepository.save(invalid);
            infrastructurePointRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * Test 2 (1.1): A point with two typed FK columns set (e.g.
     * compute_resource_id and compute_cluster_id) is rejected by the CHECK.
     */
    @Test
    void rejectsRowWithTwoTypedFksSet() {
        InfrastructurePointEntity invalid = InfrastructurePointEntity.builder()
            .id("ip-two-fks")
            .modelFileId(modelFileId)
            .pointKind("COMPUTE_RESOURCE")
            .computeResourceId(computeResourceId)
            .computeClusterId(computeClusterId)
            .build();

        assertThatThrownBy(() -> {
            infrastructurePointRepository.save(invalid);
            infrastructurePointRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * Test 3 (1.1): A point whose point_kind mismatches the set FK
     * (e.g. point_kind = COMPUTE_RESOURCE but only compute_cluster_id set)
     * is rejected by the consistency clause of the CHECK.
     */
    @Test
    void rejectsRowWithPointKindMismatchingSetFk() {
        InfrastructurePointEntity invalid = InfrastructurePointEntity.builder()
            .id("ip-mismatch")
            .modelFileId(modelFileId)
            .pointKind("COMPUTE_RESOURCE")
            // mismatch: kind says resource but only cluster_id set
            .computeClusterId(computeClusterId)
            .build();

        assertThatThrownBy(() -> {
            infrastructurePointRepository.save(invalid);
            infrastructurePointRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * Test 4 (1.1): Two rows with the same (model_file_id,
     * compute_resource_id) pair are rejected by the partial unique index
     * uq_infra_points_compute_resource_per_model. Mirrored in the H2 test
     * environment by an entity-level @UniqueConstraint on
     * (model_file_id, compute_resource_id).
     */
    @Test
    void partialUniqueIndexRejectsDuplicateComputeResourcePair() {
        InfrastructurePointEntity first = InfrastructurePointEntity.builder()
            .id("ip-dup-1")
            .modelFileId(modelFileId)
            .pointKind("COMPUTE_RESOURCE")
            .computeResourceId(computeResourceId)
            .build();
        infrastructurePointRepository.save(first);
        infrastructurePointRepository.flush();

        InfrastructurePointEntity duplicate = InfrastructurePointEntity.builder()
            .id("ip-dup-2")
            .modelFileId(modelFileId)
            .pointKind("COMPUTE_RESOURCE")
            .computeResourceId(computeResourceId)
            .build();

        assertThatThrownBy(() -> {
            infrastructurePointRepository.save(duplicate);
            infrastructurePointRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }
}
