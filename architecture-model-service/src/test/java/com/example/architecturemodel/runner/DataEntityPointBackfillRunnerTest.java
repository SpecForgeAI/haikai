package com.example.architecturemodel.runner;

import com.example.architecturemodel.model.dto.entity.LogicalDataEntityDto;
import com.example.architecturemodel.model.dto.entity.PhysicalDataEntityDto;
import com.example.architecturemodel.model.entity.DataEntityPointEntity;
import com.example.architecturemodel.model.entity.LogicalDataEntityEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.PhysicalDataEntityEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.DataEntityPointRepository;
import com.example.architecturemodel.repository.entity.LogicalDataEntityRepository;
import com.example.architecturemodel.repository.entity.PhysicalDataEntityRepository;
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

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for DataEntityPointBackfillRunner.
 *
 * Tests verify:
 * - Startup runner creates missing points for model files with entities but no points
 * - Startup runner is idempotent (running twice creates no duplicates)
 * - Startup runner respects config property and skips execution when disabled
 *
 * Spec: Data Entity Point Backfill and Legacy Snapshot Compatibility
 * Task Group 3: Startup Backfill Runner
 */
@DataJpaTest
@ActiveProfiles("test")
@Import(DataEntityPointEnsureService.class)
class DataEntityPointBackfillRunnerTest {

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

    private DataEntityPointBackfillRunner runner;
    private ModelFileEntity modelFile;

    @BeforeEach
    void setUp() {
        // Create the runner with dependencies
        runner = new DataEntityPointBackfillRunner(
            modelFileRepository,
            logicalDataEntityRepository,
            physicalDataEntityRepository,
            dataEntityPointEnsureService
        );

        // Create a model file for testing
        modelFile = ModelFileEntity.builder()
            .id("runner-test-model-1")
            .filename("runner-test-project")
            .isDefault(false)
            .build();
        modelFile = modelFileRepository.save(modelFile);
        entityManager.flush();
    }

    /**
     * Test 1: Startup runner creates missing points for model files with entities but no points.
     */
    @Test
    @DisplayName("Startup runner creates missing points for model files with entities but no points")
    void testRunnerCreatesMissingPoints() {
        // Given: Model file with logical and physical entities but no data entity points
        LogicalDataEntityEntity logicalEntity = LogicalDataEntityEntity.builder()
            .id("runner-log-001")
            .modelFileId(modelFile.getId())
            .name("Customer")
            .description("Customer entity")
            .build();
        PhysicalDataEntityEntity physicalEntity = PhysicalDataEntityEntity.builder()
            .id("runner-phy-001")
            .modelFileId(modelFile.getId())
            .name("customers_table")
            .description("Customers table")
            .build();

        logicalDataEntityRepository.save(logicalEntity);
        physicalDataEntityRepository.save(physicalEntity);
        entityManager.flush();

        // Verify no data entity points exist initially
        assertThat(dataEntityPointRepository.findByModelFileId(modelFile.getId())).isEmpty();

        // Enable the runner
        ReflectionTestUtils.setField(runner, "startupEnsureEnabled", true);

        // When: Run the backfill runner
        runner.run(null);
        entityManager.flush();

        // Then: Data entity points are created
        List<DataEntityPointEntity> points = dataEntityPointRepository.findByModelFileId(modelFile.getId());
        assertThat(points).hasSize(2);

        // Verify logical entity point
        assertThat(dataEntityPointRepository.findByModelFileIdAndLogicalEntityId(
            modelFile.getId(), "runner-log-001")).isPresent();

        // Verify physical entity point
        assertThat(dataEntityPointRepository.findByModelFileIdAndPhysicalEntityId(
            modelFile.getId(), "runner-phy-001")).isPresent();
    }

    /**
     * Test 2: Startup runner is idempotent (running twice creates no duplicates).
     */
    @Test
    @DisplayName("Startup runner is idempotent - running twice creates no duplicates")
    void testRunnerIdempotency() {
        // Given: Model file with entities
        LogicalDataEntityEntity logicalEntity = LogicalDataEntityEntity.builder()
            .id("runner-idem-log")
            .modelFileId(modelFile.getId())
            .name("Order")
            .description("Order entity")
            .build();

        logicalDataEntityRepository.save(logicalEntity);
        entityManager.flush();

        // Enable the runner
        ReflectionTestUtils.setField(runner, "startupEnsureEnabled", true);

        // When: Run the backfill runner first time
        runner.run(null);
        entityManager.flush();

        // Verify point was created
        List<DataEntityPointEntity> pointsAfterFirst = dataEntityPointRepository.findByModelFileId(modelFile.getId());
        assertThat(pointsAfterFirst).hasSize(1);
        String firstPointId = pointsAfterFirst.get(0).getId();

        // When: Run the backfill runner second time
        runner.run(null);
        entityManager.flush();

        // Then: Still only 1 point (no duplicates)
        List<DataEntityPointEntity> pointsAfterSecond = dataEntityPointRepository.findByModelFileId(modelFile.getId());
        assertThat(pointsAfterSecond).hasSize(1);

        // Verify ID is unchanged
        assertThat(pointsAfterSecond.get(0).getId()).isEqualTo(firstPointId);
    }

    /**
     * Test 3: Startup runner respects config property and skips execution when disabled.
     */
    @Test
    @DisplayName("Startup runner skips execution when disabled via config")
    void testRunnerRespectsConfigProperty() {
        // Given: Model file with entities but no points
        LogicalDataEntityEntity logicalEntity = LogicalDataEntityEntity.builder()
            .id("runner-disabled-log")
            .modelFileId(modelFile.getId())
            .name("Product")
            .description("Product entity")
            .build();

        logicalDataEntityRepository.save(logicalEntity);
        entityManager.flush();

        // Verify no data entity points exist initially
        assertThat(dataEntityPointRepository.findByModelFileId(modelFile.getId())).isEmpty();

        // Disable the runner via config property
        ReflectionTestUtils.setField(runner, "startupEnsureEnabled", false);

        // When: Run the backfill runner (disabled)
        runner.run(null);
        entityManager.flush();

        // Then: No data entity points were created (runner skipped)
        List<DataEntityPointEntity> points = dataEntityPointRepository.findByModelFileId(modelFile.getId());
        assertThat(points).isEmpty();
    }

    /**
     * Test: Runner handles multiple model files correctly.
     */
    @Test
    @DisplayName("Runner processes multiple model files correctly")
    void testRunnerProcessesMultipleModelFiles() {
        // Given: Two model files with entities
        ModelFileEntity modelFile2 = ModelFileEntity.builder()
            .id("runner-test-model-2")
            .filename("runner-test-project-2")
            .isDefault(false)
            .build();
        modelFile2 = modelFileRepository.save(modelFile2);

        LogicalDataEntityEntity entity1 = LogicalDataEntityEntity.builder()
            .id("multi-log-1")
            .modelFileId(modelFile.getId())
            .name("Entity1")
            .build();
        LogicalDataEntityEntity entity2 = LogicalDataEntityEntity.builder()
            .id("multi-log-2")
            .modelFileId(modelFile2.getId())
            .name("Entity2")
            .build();

        logicalDataEntityRepository.save(entity1);
        logicalDataEntityRepository.save(entity2);
        entityManager.flush();

        // Enable the runner
        ReflectionTestUtils.setField(runner, "startupEnsureEnabled", true);

        // When: Run the backfill runner
        runner.run(null);
        entityManager.flush();

        // Then: Points are created for both model files
        assertThat(dataEntityPointRepository.findByModelFileId(modelFile.getId())).hasSize(1);
        assertThat(dataEntityPointRepository.findByModelFileId(modelFile2.getId())).hasSize(1);
    }
}
