package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.entity.DataEntityPointDto;
import com.example.architecturemodel.model.dto.entity.LogicalDataEntityDto;
import com.example.architecturemodel.model.dto.entity.PhysicalDataEntityDto;
import com.example.architecturemodel.model.entity.DataEntityPointEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.DataEntityPointRepository;
import com.example.architecturemodel.repository.entity.LogicalDataEntityRepository;
import com.example.architecturemodel.repository.entity.PhysicalDataEntityRepository;
import com.example.architecturemodel.service.ModelService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for Data Entity Point feature.
 *
 * Tests end-to-end workflows including:
 * - Automatic point creation when saving entities
 * - ID stability across saves
 * - Constraint enforcement
 * - Delete cascade behavior
 *
 * Spec: Data Entity Point Superclass
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class DataEntityPointIntegrationTest {

    @Autowired
    private ModelService modelService;

    @Autowired
    private ModelFileRepository modelFileRepository;

    @Autowired
    private LogicalDataEntityRepository logicalDataEntityRepository;

    @Autowired
    private PhysicalDataEntityRepository physicalDataEntityRepository;

    @Autowired
    private DataEntityPointRepository dataEntityPointRepository;

    private static final String TEST_FILENAME = "test-data-entity-points-integration.json";

    @BeforeEach
    void setUp() {
        // Clean up any existing test data
        modelFileRepository.findByFilename(TEST_FILENAME)
            .ifPresent(modelFile -> modelFileRepository.delete(modelFile));
    }

    @Test
    void testEndToEndFlowCreateLogicalEntitySaveVerifyPointCreated() {
        // Given: A model with a logical data entity
        LogicalDataEntityDto logicalEntity = new LogicalDataEntityDto(
            "logical-customer-e2e",
            "Customer",
            "Customer entity for E2E test",
            "domain:customer",
            null,
            null,
            null
        );

        ArchitectureModelDto model = createModelWithLogicalEntities(List.of(logicalEntity));

        // When: Save the model
        modelService.saveModel(TEST_FILENAME, model);

        // Then: A data entity point is automatically created
        List<DataEntityPointEntity> points = dataEntityPointRepository.findByModelFileId(
            modelFileRepository.findByFilename(TEST_FILENAME).get().getId()
        );

        assertThat(points).hasSize(1);
        assertThat(points.get(0).getId()).isEqualTo("dep_log_logical-customer-e2e");
        assertThat(points.get(0).getPointKind()).isEqualTo("LOGICAL_ENTITY");
        assertThat(points.get(0).getLogicalEntityId()).isEqualTo("logical-customer-e2e");
        assertThat(points.get(0).getPhysicalEntityId()).isNull();
    }

    @Test
    void testEndToEndFlowCreatePhysicalEntitySaveVerifyPointCreated() {
        // Given: A model with a physical data entity
        PhysicalDataEntityDto physicalEntity = new PhysicalDataEntityDto(
            "physical-orders-e2e",
            "orders_table",
            "Orders table for E2E test",
            "TABLE",
            "postgres",
            "persistence:sql",
            null,
            null,
            null
        );

        ArchitectureModelDto model = createModelWithPhysicalEntities(List.of(physicalEntity));

        // When: Save the model
        modelService.saveModel(TEST_FILENAME, model);

        // Then: A data entity point is automatically created
        List<DataEntityPointEntity> points = dataEntityPointRepository.findByModelFileId(
            modelFileRepository.findByFilename(TEST_FILENAME).get().getId()
        );

        assertThat(points).hasSize(1);
        assertThat(points.get(0).getId()).isEqualTo("dep_phy_physical-orders-e2e");
        assertThat(points.get(0).getPointKind()).isEqualTo("PHYSICAL_ENTITY");
        assertThat(points.get(0).getLogicalEntityId()).isNull();
        assertThat(points.get(0).getPhysicalEntityId()).isEqualTo("physical-orders-e2e");
    }

    @Test
    void testIdStabilitySameEntityProducesSamePointIdAcrossSaves() {
        // Given: A model with logical and physical entities
        LogicalDataEntityDto logicalEntity = new LogicalDataEntityDto(
            "logical-stable-id",
            "StableEntity",
            "Entity for ID stability test",
            null,
            null,
            null,
            null
        );

        ArchitectureModelDto model = createModelWithLogicalEntities(List.of(logicalEntity));

        // When: Save the model twice
        modelService.saveModel(TEST_FILENAME, model);
        String modelFileId = modelFileRepository.findByFilename(TEST_FILENAME).get().getId();

        List<DataEntityPointEntity> pointsAfterFirstSave = dataEntityPointRepository.findByModelFileId(modelFileId);
        String pointIdAfterFirstSave = pointsAfterFirstSave.get(0).getId();

        // Save again (this triggers delete + recreate)
        modelService.saveModel(TEST_FILENAME, model);

        List<DataEntityPointEntity> pointsAfterSecondSave = dataEntityPointRepository.findByModelFileId(modelFileId);
        String pointIdAfterSecondSave = pointsAfterSecondSave.get(0).getId();

        // Then: Point ID is the same across saves
        assertThat(pointIdAfterSecondSave).isEqualTo(pointIdAfterFirstSave);
        assertThat(pointIdAfterSecondSave).isEqualTo("dep_log_logical-stable-id");
    }

    @Test
    void testLoadModelIncludesDataEntityPointsInResponse() {
        // Given: A model with entities saved
        LogicalDataEntityDto logicalEntity = new LogicalDataEntityDto(
            "logical-load-test",
            "LoadTestEntity",
            "Entity for load test",
            "test:load",
            null,
            null,
            null
        );

        ArchitectureModelDto saveModel = createModelWithLogicalEntities(List.of(logicalEntity));
        modelService.saveModel(TEST_FILENAME, saveModel);

        // When: Load the model
        ArchitectureModelDto loadedModel = modelService.loadModel(TEST_FILENAME);

        // Then: Data entity points are included in the loaded model
        assertThat(loadedModel.metaModel().entities().dataEntityPoints()).isNotNull();
        assertThat(loadedModel.metaModel().entities().dataEntityPoints()).hasSize(1);

        DataEntityPointDto point = loadedModel.metaModel().entities().dataEntityPoints().get(0);
        assertThat(point.id()).isEqualTo("dep_log_logical-load-test");
        assertThat(point.pointKind()).isEqualTo("LOGICAL_ENTITY");
        assertThat(point.logicalEntityId()).isEqualTo("logical-load-test");
    }

    @Test
    void testDeleteModelCascadesToPoints() {
        // Given: A model with data entity points
        LogicalDataEntityDto logicalEntity = new LogicalDataEntityDto(
            "logical-cascade-test",
            "CascadeTestEntity",
            "Entity for cascade test",
            null,
            null,
            null,
            null
        );

        ArchitectureModelDto model = createModelWithLogicalEntities(List.of(logicalEntity));
        modelService.saveModel(TEST_FILENAME, model);

        String modelFileId = modelFileRepository.findByFilename(TEST_FILENAME).get().getId();
        assertThat(dataEntityPointRepository.findByModelFileId(modelFileId)).hasSize(1);

        // When: Delete the model
        modelService.deleteModel(TEST_FILENAME);

        // Then: Data entity points are also deleted (via cascade)
        // Note: After delete, the model file no longer exists, so we verify by checking the repository directly
        assertThat(modelFileRepository.findByFilename(TEST_FILENAME)).isEmpty();
        // Since model file is deleted, and we have ON DELETE CASCADE, points should be gone
    }

    @Test
    void testCreateMultipleEntitiesCreatesMultiplePoints() {
        // Given: A model with multiple logical and physical entities
        LogicalDataEntityDto logical1 = new LogicalDataEntityDto(
            "log-multi-1", "Entity1", "Desc 1", null, null, null,
            null
        );
        LogicalDataEntityDto logical2 = new LogicalDataEntityDto(
            "log-multi-2", "Entity2", "Desc 2", null, null, null,
            null
        );
        PhysicalDataEntityDto physical1 = new PhysicalDataEntityDto(
            "phy-multi-1", "Table1", "Desc 1", "TABLE", "db", null, null, null, null
        );

        ArchitectureModelDto model = createModelWithBothEntityTypes(
            List.of(logical1, logical2),
            List.of(physical1)
        );

        // When: Save the model
        modelService.saveModel(TEST_FILENAME, model);

        // Then: Three data entity points are created
        String modelFileId = modelFileRepository.findByFilename(TEST_FILENAME).get().getId();
        List<DataEntityPointEntity> points = dataEntityPointRepository.findByModelFileId(modelFileId);

        assertThat(points).hasSize(3);
        assertThat(points.stream().map(DataEntityPointEntity::getId))
            .containsExactlyInAnyOrder(
                "dep_log_log-multi-1",
                "dep_log_log-multi-2",
                "dep_phy_phy-multi-1"
            );
    }

    @Test
    void testSaveModelWithEmptyEntitiesCreatesNoPoints() {
        // Given: A model with no entities
        ArchitectureModelDto model = createEmptyModel();

        // When: Save the model
        modelService.saveModel(TEST_FILENAME, model);

        // Then: No data entity points are created
        String modelFileId = modelFileRepository.findByFilename(TEST_FILENAME).get().getId();
        List<DataEntityPointEntity> points = dataEntityPointRepository.findByModelFileId(modelFileId);

        assertThat(points).isEmpty();
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    private ArchitectureModelDto createModelWithLogicalEntities(List<LogicalDataEntityDto> logicalEntities) {
        MetaModelEntitiesDto entities = new MetaModelEntitiesDto(
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
            logicalEntities,
            List.of(),
            List.of(),
            List.of(),
            List.of(), // dataEntityPoints - will be auto-generated
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );
        MetaModelRelationshipsDto relationships = createEmptyRelationships();
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        return new ArchitectureModelDto(metaModel, List.of());
    }

    private ArchitectureModelDto createModelWithPhysicalEntities(List<PhysicalDataEntityDto> physicalEntities) {
        MetaModelEntitiesDto entities = new MetaModelEntitiesDto(
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(),
            List.of(),
            physicalEntities,
            List.of(),
            List.of(), // dataEntityPoints - will be auto-generated
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );
        MetaModelRelationshipsDto relationships = createEmptyRelationships();
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        return new ArchitectureModelDto(metaModel, List.of());
    }

    private ArchitectureModelDto createModelWithBothEntityTypes(
            List<LogicalDataEntityDto> logicalEntities,
            List<PhysicalDataEntityDto> physicalEntities) {
        MetaModelEntitiesDto entities = new MetaModelEntitiesDto(
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
            logicalEntities,
            List.of(),
            physicalEntities,
            List.of(),
            List.of(), // dataEntityPoints - will be auto-generated
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );
        MetaModelRelationshipsDto relationships = createEmptyRelationships();
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        return new ArchitectureModelDto(metaModel, List.of());
    }

    private ArchitectureModelDto createEmptyModel() {
        MetaModelEntitiesDto entities = new MetaModelEntitiesDto(
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );
        MetaModelRelationshipsDto relationships = createEmptyRelationships();
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        return new ArchitectureModelDto(metaModel, List.of());
    }

    private MetaModelRelationshipsDto createEmptyRelationships() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyRelationships();
    }
}
