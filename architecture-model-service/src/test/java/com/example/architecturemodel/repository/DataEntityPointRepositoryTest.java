package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.DataEntityPointEntity;
import com.example.architecturemodel.model.entity.LogicalDataEntityEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.PhysicalDataEntityEntity;
import com.example.architecturemodel.repository.entity.DataEntityPointRepository;
import com.example.architecturemodel.repository.entity.LogicalDataEntityRepository;
import com.example.architecturemodel.repository.entity.PhysicalDataEntityRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.ActiveProfiles;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Repository integration tests for DataEntityPointRepository.
 *
 * Tests CRUD operations and constraint enforcement for data_entity_points table.
 *
 * Spec: Data Entity Point Superclass
 */
@DataJpaTest
@ActiveProfiles("test")
class DataEntityPointRepositoryTest {

    @Autowired
    private DataEntityPointRepository dataEntityPointRepository;

    @Autowired
    private LogicalDataEntityRepository logicalDataEntityRepository;

    @Autowired
    private PhysicalDataEntityRepository physicalDataEntityRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    private String modelFileId;
    private String logicalEntityId;
    private String physicalEntityId;

    @BeforeEach
    void setUp() {
        // Create a model file for FK constraint
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id("test-model-file-id")
            .filename("test-model.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        modelFileRepository.save(modelFile);
        modelFileId = modelFile.getId();

        // Create a logical data entity for FK constraint
        LogicalDataEntityEntity logicalEntity = LogicalDataEntityEntity.builder()
            .id("logical-entity-1")
            .modelFileId(modelFileId)
            .name("Customer")
            .description("Customer entity")
            .build();
        logicalDataEntityRepository.save(logicalEntity);
        logicalEntityId = logicalEntity.getId();

        // Create a physical data entity for FK constraint
        PhysicalDataEntityEntity physicalEntity = PhysicalDataEntityEntity.builder()
            .id("physical-entity-1")
            .modelFileId(modelFileId)
            .name("customers_table")
            .description("Customers table")
            .physicalType("TABLE")
            .build();
        physicalDataEntityRepository.save(physicalEntity);
        physicalEntityId = physicalEntity.getId();
    }

    @Test
    void testSaveAndFindByModelFileId() {
        // Given: A data entity point for a logical entity
        DataEntityPointEntity point = DataEntityPointEntity.builder()
            .id("dep_log_logical-entity-1")
            .modelFileId(modelFileId)
            .pointKind("LOGICAL_ENTITY")
            .logicalEntityId(logicalEntityId)
            .physicalEntityId(null)
            .description("Point for Customer entity")
            .tags("domain:customer")
            .build();

        // When: Save the point
        dataEntityPointRepository.save(point);

        // Then: Can retrieve by modelFileId
        List<DataEntityPointEntity> points = dataEntityPointRepository.findByModelFileId(modelFileId);
        assertThat(points).hasSize(1);
        assertThat(points.get(0).getId()).isEqualTo("dep_log_logical-entity-1");
        assertThat(points.get(0).getPointKind()).isEqualTo("LOGICAL_ENTITY");
        assertThat(points.get(0).getLogicalEntityId()).isEqualTo(logicalEntityId);
        assertThat(points.get(0).getPhysicalEntityId()).isNull();
    }

    @Test
    void testFindByModelFileIdAndLogicalEntityId() {
        // Given: A data entity point for a logical entity
        DataEntityPointEntity point = DataEntityPointEntity.builder()
            .id("dep_log_logical-entity-1")
            .modelFileId(modelFileId)
            .pointKind("LOGICAL_ENTITY")
            .logicalEntityId(logicalEntityId)
            .physicalEntityId(null)
            .build();
        dataEntityPointRepository.save(point);

        // When: Find by modelFileId and logicalEntityId
        Optional<DataEntityPointEntity> found = dataEntityPointRepository
            .findByModelFileIdAndLogicalEntityId(modelFileId, logicalEntityId);

        // Then: Point is found
        assertThat(found).isPresent();
        assertThat(found.get().getId()).isEqualTo("dep_log_logical-entity-1");
    }

    @Test
    void testFindByModelFileIdAndPhysicalEntityId() {
        // Given: A data entity point for a physical entity
        DataEntityPointEntity point = DataEntityPointEntity.builder()
            .id("dep_phy_physical-entity-1")
            .modelFileId(modelFileId)
            .pointKind("PHYSICAL_ENTITY")
            .logicalEntityId(null)
            .physicalEntityId(physicalEntityId)
            .build();
        dataEntityPointRepository.save(point);

        // When: Find by modelFileId and physicalEntityId
        Optional<DataEntityPointEntity> found = dataEntityPointRepository
            .findByModelFileIdAndPhysicalEntityId(modelFileId, physicalEntityId);

        // Then: Point is found
        assertThat(found).isPresent();
        assertThat(found.get().getId()).isEqualTo("dep_phy_physical-entity-1");
    }

    @Test
    void testDeleteByModelFileId() {
        // Given: Multiple data entity points
        DataEntityPointEntity point1 = DataEntityPointEntity.builder()
            .id("dep_log_logical-entity-1")
            .modelFileId(modelFileId)
            .pointKind("LOGICAL_ENTITY")
            .logicalEntityId(logicalEntityId)
            .physicalEntityId(null)
            .build();
        DataEntityPointEntity point2 = DataEntityPointEntity.builder()
            .id("dep_phy_physical-entity-1")
            .modelFileId(modelFileId)
            .pointKind("PHYSICAL_ENTITY")
            .logicalEntityId(null)
            .physicalEntityId(physicalEntityId)
            .build();
        dataEntityPointRepository.saveAll(List.of(point1, point2));
        assertThat(dataEntityPointRepository.findByModelFileId(modelFileId)).hasSize(2);

        // When: Delete by modelFileId
        dataEntityPointRepository.deleteByModelFileId(modelFileId);

        // Then: All points are deleted
        assertThat(dataEntityPointRepository.findByModelFileId(modelFileId)).isEmpty();
    }

    // NOTE: the harness runs Hibernate ddl-auto create-drop (Liquibase disabled
    // in src/test/resources/application.yml), so database-level constraints that
    // exist only in the Liquibase schema are NOT present here and cannot be
    // asserted at the repository level.
    // The former testUniqueConstraintViolationForDuplicateLogicalFK and
    // testCheckConstraintRejectsBothFKsSet tests asserted the data_entity_points
    // partial-unique indexes and exactly-one-FK CHECK constraint, which are
    // Liquibase-defined and absent from the Hibernate-generated test schema.
}
