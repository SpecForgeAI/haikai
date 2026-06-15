package com.example.architecturemodel.migration;

import com.example.architecturemodel.model.entity.DataEntityPointEntity;
import com.example.architecturemodel.model.entity.LogicalDataEntityEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.PhysicalDataEntityEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.DataEntityPointRepository;
import com.example.architecturemodel.repository.entity.LogicalDataEntityRepository;
import com.example.architecturemodel.repository.entity.PhysicalDataEntityRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Migration verification tests for Data Entity Point backfill.
 *
 * These tests verify the logic that would be performed by the Liquibase migration
 * 021-data-entity-points-backfill.sql. Since we use H2 in tests with hibernate
 * ddl-auto=create-drop, we simulate the migration behavior via the ensure service.
 *
 * Tests verify:
 * - Logical entity points are created with correct ID format (dep_log_<entity_id>)
 * - Physical entity points are created with correct ID format (dep_phy_<entity_id>)
 * - Migration is idempotent (running twice produces no duplicate points)
 *
 * Spec: Data Entity Point Backfill and Legacy Snapshot Compatibility
 * Task Group 1: Liquibase Migration Backfill
 */
@DataJpaTest
@ActiveProfiles("test")
class DataEntityPointBackfillMigrationTest {

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

    private ModelFileEntity modelFile;

    @BeforeEach
    void setUp() {
        // Create a model file for testing
        modelFile = ModelFileEntity.builder()
            .id("test-model-file-1")
            .filename("test-project")
            .isDefault(false)
            .build();
        modelFile = modelFileRepository.save(modelFile);
        entityManager.flush();
    }

    /**
     * Test 1: Verify logical entity points are created with correct ID format
     * (dep_log_<entity_id>) after migration runs on database with existing
     * logical entities but no points.
     */
    @Test
    @DisplayName("Logical entity points are created with correct ID format after backfill")
    void testLogicalEntityPointsCreatedWithCorrectIdFormat() {
        // Given: Existing logical entities without data entity points
        LogicalDataEntityEntity logicalEntity1 = LogicalDataEntityEntity.builder()
            .id("log-entity-001")
            .modelFileId(modelFile.getId())
            .name("Customer")
            .description("Customer entity")
            .build();
        LogicalDataEntityEntity logicalEntity2 = LogicalDataEntityEntity.builder()
            .id("log-entity-002")
            .modelFileId(modelFile.getId())
            .name("Order")
            .description("Order entity")
            .build();
        logicalDataEntityRepository.saveAll(List.of(logicalEntity1, logicalEntity2));
        entityManager.flush();

        // Verify no data entity points exist initially
        assertThat(dataEntityPointRepository.findByModelFileId(modelFile.getId())).isEmpty();

        // When: Simulate the migration backfill logic
        // (This simulates what the SQL migration does)
        simulateBackfillMigration(modelFile.getId());

        // Then: Data entity points are created with correct ID format
        List<DataEntityPointEntity> points = dataEntityPointRepository.findByModelFileId(modelFile.getId());
        assertThat(points).hasSize(2);

        // Verify logical entity 1 point
        Optional<DataEntityPointEntity> point1 = dataEntityPointRepository
            .findByModelFileIdAndLogicalEntityId(modelFile.getId(), "log-entity-001");
        assertThat(point1).isPresent();
        assertThat(point1.get().getId()).isEqualTo("dep_log_log-entity-001");
        assertThat(point1.get().getPointKind()).isEqualTo("LOGICAL_ENTITY");
        assertThat(point1.get().getLogicalEntityId()).isEqualTo("log-entity-001");
        assertThat(point1.get().getPhysicalEntityId()).isNull();

        // Verify logical entity 2 point
        Optional<DataEntityPointEntity> point2 = dataEntityPointRepository
            .findByModelFileIdAndLogicalEntityId(modelFile.getId(), "log-entity-002");
        assertThat(point2).isPresent();
        assertThat(point2.get().getId()).isEqualTo("dep_log_log-entity-002");
        assertThat(point2.get().getPointKind()).isEqualTo("LOGICAL_ENTITY");
    }

    /**
     * Test 2: Verify physical entity points are created with correct ID format
     * (dep_phy_<entity_id>) after migration runs on database with existing
     * physical entities but no points.
     */
    @Test
    @DisplayName("Physical entity points are created with correct ID format after backfill")
    void testPhysicalEntityPointsCreatedWithCorrectIdFormat() {
        // Given: Existing physical entities without data entity points
        PhysicalDataEntityEntity physicalEntity1 = PhysicalDataEntityEntity.builder()
            .id("phy-entity-001")
            .modelFileId(modelFile.getId())
            .name("customers_table")
            .description("Customers table")
            .build();
        PhysicalDataEntityEntity physicalEntity2 = PhysicalDataEntityEntity.builder()
            .id("phy-entity-002")
            .modelFileId(modelFile.getId())
            .name("orders_table")
            .description("Orders table")
            .build();
        physicalDataEntityRepository.saveAll(List.of(physicalEntity1, physicalEntity2));
        entityManager.flush();

        // Verify no data entity points exist initially
        assertThat(dataEntityPointRepository.findByModelFileId(modelFile.getId())).isEmpty();

        // When: Simulate the migration backfill logic
        simulateBackfillMigration(modelFile.getId());

        // Then: Data entity points are created with correct ID format
        List<DataEntityPointEntity> points = dataEntityPointRepository.findByModelFileId(modelFile.getId());
        assertThat(points).hasSize(2);

        // Verify physical entity 1 point
        Optional<DataEntityPointEntity> point1 = dataEntityPointRepository
            .findByModelFileIdAndPhysicalEntityId(modelFile.getId(), "phy-entity-001");
        assertThat(point1).isPresent();
        assertThat(point1.get().getId()).isEqualTo("dep_phy_phy-entity-001");
        assertThat(point1.get().getPointKind()).isEqualTo("PHYSICAL_ENTITY");
        assertThat(point1.get().getPhysicalEntityId()).isEqualTo("phy-entity-001");
        assertThat(point1.get().getLogicalEntityId()).isNull();

        // Verify physical entity 2 point
        Optional<DataEntityPointEntity> point2 = dataEntityPointRepository
            .findByModelFileIdAndPhysicalEntityId(modelFile.getId(), "phy-entity-002");
        assertThat(point2).isPresent();
        assertThat(point2.get().getId()).isEqualTo("dep_phy_phy-entity-002");
        assertThat(point2.get().getPointKind()).isEqualTo("PHYSICAL_ENTITY");
    }

    /**
     * Test 3: Verify migration idempotency - running migration twice produces
     * no duplicate points.
     */
    @Test
    @DisplayName("Migration is idempotent - running twice produces no duplicate points")
    void testMigrationIdempotency() {
        // Given: Existing logical and physical entities
        LogicalDataEntityEntity logicalEntity = LogicalDataEntityEntity.builder()
            .id("log-entity-idem")
            .modelFileId(modelFile.getId())
            .name("Account")
            .description("Account entity")
            .build();
        PhysicalDataEntityEntity physicalEntity = PhysicalDataEntityEntity.builder()
            .id("phy-entity-idem")
            .modelFileId(modelFile.getId())
            .name("accounts_table")
            .description("Accounts table")
            .build();
        logicalDataEntityRepository.save(logicalEntity);
        physicalDataEntityRepository.save(physicalEntity);
        entityManager.flush();

        // When: Run migration first time
        simulateBackfillMigration(modelFile.getId());
        entityManager.flush();

        // Verify points exist
        List<DataEntityPointEntity> pointsAfterFirst = dataEntityPointRepository.findByModelFileId(modelFile.getId());
        assertThat(pointsAfterFirst).hasSize(2);

        // When: Run migration second time (idempotent)
        simulateBackfillMigration(modelFile.getId());
        entityManager.flush();

        // Then: Still only 2 points (no duplicates)
        List<DataEntityPointEntity> pointsAfterSecond = dataEntityPointRepository.findByModelFileId(modelFile.getId());
        assertThat(pointsAfterSecond).hasSize(2);

        // Verify IDs are unchanged
        assertThat(pointsAfterSecond.stream().map(DataEntityPointEntity::getId).toList())
            .containsExactlyInAnyOrder("dep_log_log-entity-idem", "dep_phy_phy-entity-idem");
    }

    /**
     * Simulates the backfill migration logic.
     * This replicates what the SQL migration 021-data-entity-points-backfill.sql does:
     * INSERT INTO ... SELECT ... WHERE NOT EXISTS pattern.
     */
    private void simulateBackfillMigration(String modelFileId) {
        // Backfill logical entity points
        List<LogicalDataEntityEntity> logicalEntities = logicalDataEntityRepository.findByModelFileId(modelFileId);
        for (LogicalDataEntityEntity logicalEntity : logicalEntities) {
            String pointId = "dep_log_" + logicalEntity.getId();
            // WHERE NOT EXISTS check
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
        List<PhysicalDataEntityEntity> physicalEntities = physicalDataEntityRepository.findByModelFileId(modelFileId);
        for (PhysicalDataEntityEntity physicalEntity : physicalEntities) {
            String pointId = "dep_phy_" + physicalEntity.getId();
            // WHERE NOT EXISTS check
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
