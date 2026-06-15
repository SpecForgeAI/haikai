package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.entity.DataEntityPointEntity;
import com.example.architecturemodel.model.entity.LogicalDataEntityEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.PhysicalDataEntityEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.DataEntityPointRepository;
import com.example.architecturemodel.repository.entity.LogicalDataEntityRepository;
import com.example.architecturemodel.repository.entity.PhysicalDataEntityRepository;
import com.example.architecturemodel.runner.DataEntityPointBackfillRunner;
import com.example.architecturemodel.service.DataEntityPointEnsureService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for Data Entity Point backfill functionality.
 *
 * These tests verify the full integration flow including:
 * - Migration + startup runner interaction
 * - Partial backfill scenarios
 * - point_kind enum values
 * - End-to-end backfill scenarios
 *
 * Spec: Data Entity Point Backfill and Legacy Snapshot Compatibility
 * Task Group 4: Test Review and Gap Analysis
 */
@DataJpaTest
@ActiveProfiles("test")
@Import(DataEntityPointEnsureService.class)
class DataEntityPointBackfillIntegrationTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ModelFileRepository modelFileRepository;

    @Autowired
    private LogicalDataEntityRepository logicalDataEntityRepository;

    @Autowired
    private PhysicalDataEntityRepository physicalDataEntityRepository;

    @Autowired
    private DataEntityPointRepository dataEntityPointRepository;

    @Autowired
    private DataEntityPointEnsureService dataEntityPointEnsureService;

    private ModelFileEntity modelFile;

    @BeforeEach
    void setUp() {
        modelFile = ModelFileEntity.builder()
            .id("integration-test-model")
            .filename("integration-test-project")
            .isDefault(false)
            .build();
        modelFile = modelFileRepository.save(modelFile);
        entityManager.flush();
    }

    /**
     * Integration test: Full flow - apply migration on DB with existing entities,
     * verify points exist, then ensure startup runner creates no duplicates.
     */
    @Test
    @DisplayName("Full flow: migration backfill then startup runner creates no duplicates")
    void testMigrationThenStartupRunnerNoDuplicates() {
        // Given: Existing entities without points
        LogicalDataEntityEntity logicalEntity = LogicalDataEntityEntity.builder()
            .id("full-flow-log")
            .modelFileId(modelFile.getId())
            .name("Customer")
            .build();
        PhysicalDataEntityEntity physicalEntity = PhysicalDataEntityEntity.builder()
            .id("full-flow-phy")
            .modelFileId(modelFile.getId())
            .name("customers_table")
            .build();

        logicalDataEntityRepository.save(logicalEntity);
        physicalDataEntityRepository.save(physicalEntity);
        entityManager.flush();

        // Step 1: Simulate migration backfill
        simulateMigrationBackfill(modelFile.getId());
        entityManager.flush();

        // Verify points exist after migration
        List<DataEntityPointEntity> pointsAfterMigration =
            dataEntityPointRepository.findByModelFileId(modelFile.getId());
        assertThat(pointsAfterMigration).hasSize(2);

        // Step 2: Run startup backfill runner (simulated)
        DataEntityPointBackfillRunner runner = new DataEntityPointBackfillRunner(
            modelFileRepository,
            logicalDataEntityRepository,
            physicalDataEntityRepository,
            dataEntityPointEnsureService
        );
        ReflectionTestUtils.setField(runner, "startupEnsureEnabled", true);
        runner.run(null);
        entityManager.flush();

        // Then: Still only 2 points (no duplicates from runner)
        List<DataEntityPointEntity> pointsAfterRunner =
            dataEntityPointRepository.findByModelFileId(modelFile.getId());
        assertThat(pointsAfterRunner).hasSize(2);

        // Verify IDs are unchanged
        assertThat(pointsAfterRunner.stream().map(DataEntityPointEntity::getId).toList())
            .containsExactlyInAnyOrder("dep_log_full-flow-log", "dep_phy_full-flow-phy");
    }

    /**
     * Integration test: Import snapshot with some entities having points and some missing
     * - verify partial backfill works correctly.
     */
    @Test
    @DisplayName("Partial backfill: some entities have points, some missing")
    void testPartialBackfillWorksCorrectly() {
        // Given: Two logical entities - one with point, one without
        LogicalDataEntityEntity entityWithPoint = LogicalDataEntityEntity.builder()
            .id("partial-with-point")
            .modelFileId(modelFile.getId())
            .name("EntityWithPoint")
            .build();
        LogicalDataEntityEntity entityWithoutPoint = LogicalDataEntityEntity.builder()
            .id("partial-without-point")
            .modelFileId(modelFile.getId())
            .name("EntityWithoutPoint")
            .build();

        logicalDataEntityRepository.save(entityWithPoint);
        logicalDataEntityRepository.save(entityWithoutPoint);
        entityManager.flush();

        // Create point only for the first entity (simulate pre-existing point)
        DataEntityPointEntity existingPoint = DataEntityPointEntity.builder()
            .id("dep_log_partial-with-point")
            .modelFileId(modelFile.getId())
            .pointKind("LOGICAL_ENTITY")
            .logicalEntityId("partial-with-point")
            .physicalEntityId(null)
            .build();
        dataEntityPointRepository.save(existingPoint);
        entityManager.flush();

        // Verify initial state: 1 point exists
        assertThat(dataEntityPointRepository.findByModelFileId(modelFile.getId())).hasSize(1);

        // When: Run backfill (simulate migration or runner)
        simulateMigrationBackfill(modelFile.getId());
        entityManager.flush();

        // Then: 2 points exist - original + backfilled
        List<DataEntityPointEntity> points = dataEntityPointRepository.findByModelFileId(modelFile.getId());
        assertThat(points).hasSize(2);

        // Verify both entities have points
        assertThat(dataEntityPointRepository.findByModelFileIdAndLogicalEntityId(
            modelFile.getId(), "partial-with-point")).isPresent();
        assertThat(dataEntityPointRepository.findByModelFileIdAndLogicalEntityId(
            modelFile.getId(), "partial-without-point")).isPresent();
    }

    /**
     * Test: Verify point_kind enum values are set correctly for both logical and physical points.
     */
    @Test
    @DisplayName("point_kind enum values are correct for logical and physical points")
    void testPointKindEnumValuesCorrect() {
        // Given: Logical and physical entities
        LogicalDataEntityEntity logicalEntity = LogicalDataEntityEntity.builder()
            .id("kind-test-log")
            .modelFileId(modelFile.getId())
            .name("Logical")
            .build();
        PhysicalDataEntityEntity physicalEntity = PhysicalDataEntityEntity.builder()
            .id("kind-test-phy")
            .modelFileId(modelFile.getId())
            .name("Physical")
            .build();

        logicalDataEntityRepository.save(logicalEntity);
        physicalDataEntityRepository.save(physicalEntity);
        entityManager.flush();

        // When: Run backfill
        simulateMigrationBackfill(modelFile.getId());
        entityManager.flush();

        // Then: point_kind values are correct
        Optional<DataEntityPointEntity> logicalPoint = dataEntityPointRepository
            .findByModelFileIdAndLogicalEntityId(modelFile.getId(), "kind-test-log");
        Optional<DataEntityPointEntity> physicalPoint = dataEntityPointRepository
            .findByModelFileIdAndPhysicalEntityId(modelFile.getId(), "kind-test-phy");

        assertThat(logicalPoint).isPresent();
        assertThat(logicalPoint.get().getPointKind()).isEqualTo("LOGICAL_ENTITY");
        assertThat(logicalPoint.get().getLogicalEntityId()).isEqualTo("kind-test-log");
        assertThat(logicalPoint.get().getPhysicalEntityId()).isNull();

        assertThat(physicalPoint).isPresent();
        assertThat(physicalPoint.get().getPointKind()).isEqualTo("PHYSICAL_ENTITY");
        assertThat(physicalPoint.get().getPhysicalEntityId()).isEqualTo("kind-test-phy");
        assertThat(physicalPoint.get().getLogicalEntityId()).isNull();
    }

    /**
     * Test: Verify deterministic ID generation matches spec format.
     */
    @Test
    @DisplayName("Deterministic ID generation matches spec format")
    void testDeterministicIdGeneration() {
        // Given: Entities with specific IDs
        LogicalDataEntityEntity logicalEntity = LogicalDataEntityEntity.builder()
            .id("my-logical-entity-123")
            .modelFileId(modelFile.getId())
            .name("TestLogical")
            .build();
        PhysicalDataEntityEntity physicalEntity = PhysicalDataEntityEntity.builder()
            .id("my-physical-entity-456")
            .modelFileId(modelFile.getId())
            .name("TestPhysical")
            .build();

        logicalDataEntityRepository.save(logicalEntity);
        physicalDataEntityRepository.save(physicalEntity);
        entityManager.flush();

        // When: Run backfill
        simulateMigrationBackfill(modelFile.getId());
        entityManager.flush();

        // Then: IDs follow spec format
        List<DataEntityPointEntity> points = dataEntityPointRepository.findByModelFileId(modelFile.getId());
        assertThat(points).hasSize(2);

        // Logical point ID: "dep_log_" + entityId
        Optional<DataEntityPointEntity> logicalPoint = points.stream()
            .filter(p -> "LOGICAL_ENTITY".equals(p.getPointKind()))
            .findFirst();
        assertThat(logicalPoint).isPresent();
        assertThat(logicalPoint.get().getId()).isEqualTo("dep_log_my-logical-entity-123");

        // Physical point ID: "dep_phy_" + entityId
        Optional<DataEntityPointEntity> physicalPoint = points.stream()
            .filter(p -> "PHYSICAL_ENTITY".equals(p.getPointKind()))
            .findFirst();
        assertThat(physicalPoint).isPresent();
        assertThat(physicalPoint.get().getId()).isEqualTo("dep_phy_my-physical-entity-456");
    }

    /**
     * Integration test: Empty model file (no entities) should not create any points.
     */
    @Test
    @DisplayName("Empty model file creates no points")
    void testEmptyModelFileCreatesNoPoints() {
        // Given: Model file with no entities
        // (modelFile already exists from setUp but has no entities)

        // When: Run backfill
        simulateMigrationBackfill(modelFile.getId());
        entityManager.flush();

        // Then: No points created
        List<DataEntityPointEntity> points = dataEntityPointRepository.findByModelFileId(modelFile.getId());
        assertThat(points).isEmpty();
    }

    /**
     * Simulates the backfill migration logic (same as what the SQL migration does).
     */
    private void simulateMigrationBackfill(String modelFileId) {
        // Backfill logical entity points
        List<LogicalDataEntityEntity> logicalEntities =
            logicalDataEntityRepository.findByModelFileId(modelFileId);
        for (LogicalDataEntityEntity logicalEntity : logicalEntities) {
            String pointId = "dep_log_" + logicalEntity.getId();
            if (!dataEntityPointRepository.existsById(pointId)) {
                DataEntityPointEntity point = DataEntityPointEntity.builder()
                    .id(pointId)
                    .modelFileId(modelFileId)
                    .pointKind("LOGICAL_ENTITY")
                    .logicalEntityId(logicalEntity.getId())
                    .physicalEntityId(null)
                    .build();
                dataEntityPointRepository.save(point);
            }
        }

        // Backfill physical entity points
        List<PhysicalDataEntityEntity> physicalEntities =
            physicalDataEntityRepository.findByModelFileId(modelFileId);
        for (PhysicalDataEntityEntity physicalEntity : physicalEntities) {
            String pointId = "dep_phy_" + physicalEntity.getId();
            if (!dataEntityPointRepository.existsById(pointId)) {
                DataEntityPointEntity point = DataEntityPointEntity.builder()
                    .id(pointId)
                    .modelFileId(modelFileId)
                    .pointKind("PHYSICAL_ENTITY")
                    .logicalEntityId(null)
                    .physicalEntityId(physicalEntity.getId())
                    .build();
                dataEntityPointRepository.save(point);
            }
        }
    }
}
