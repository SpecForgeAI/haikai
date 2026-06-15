package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.relationship.DataMovementDto;
import com.example.architecturemodel.model.dto.relationship.LogicalDataEntityRelationshipDto;
import com.example.architecturemodel.model.entity.DataMovementEntity;
import com.example.architecturemodel.model.entity.LogicalDataEntityRelationshipEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for EntityMapper focusing on the new Data Entity Point FK fields.
 *
 * Tests verify that:
 * - fromDataEntityPointId and toDataEntityPointId are correctly mapped for LogicalDataEntityRelationship
 * - dataEntityPointId is correctly mapped for DataMovement
 * - Both legacy and new fields coexist correctly (dual representation)
 * - Null values are handled correctly for new fields
 *
 * Spec: Add Data Entity Point FK Columns to Logical ER and Data Movements
 * Task Group 2: JPA Entities and DTOs for New FK Fields
 */
class DataEntityPointFkMapperTest {

    private EntityMapper mapper;
    private static final String MODEL_FILE_ID = "test-model-file";

    @BeforeEach
    void setUp() {
        mapper = new EntityMapper();
    }

    // ============================================================================
    // LogicalDataEntityRelationship Mapping Tests
    // ============================================================================

    /**
     * Test 1: Verify LogicalDataEntityRelationship entity to DTO mapping includes new FK fields.
     */
    @Test
    @DisplayName("toDto maps fromDataEntityPointId and toDataEntityPointId for LogicalDataEntityRelationship")
    void testLogicalDataEntityRelationshipToDtoMapsNewFields() {
        // Given: An entity with new FK fields (legacy fromRefKind/fromRefId/toRefKind/toRefId
        // were removed per "Remove Legacy Data Entity Relationship Columns" spec).
        LogicalDataEntityRelationshipEntity entity = LogicalDataEntityRelationshipEntity.builder()
            .id("rel-1")
            .modelFileId(MODEL_FILE_ID)
            .fromDataEntityPointId("dep_log_log-entity-1")
            .toDataEntityPointId("dep_phy_phy-entity-1")
            .cardinality("ONE_TO_MANY")
            .relationship("ASSOCIATION")
            .description("Test relationship")
            .build();

        // When: Map to DTO
        LogicalDataEntityRelationshipDto dto = mapper.toDto(entity);

        // Then: All fields including new FK fields are mapped
        assertThat(dto.id()).isEqualTo("rel-1");
        assertThat(dto.fromDataEntityPointId()).isEqualTo("dep_log_log-entity-1");
        assertThat(dto.toDataEntityPointId()).isEqualTo("dep_phy_phy-entity-1");
        assertThat(dto.cardinality()).isEqualTo("ONE_TO_MANY");
        assertThat(dto.relationship()).isEqualTo("ASSOCIATION");
    }

    /**
     * Test 2: Verify LogicalDataEntityRelationship DTO to entity mapping includes new FK fields.
     */
    @Test
    @DisplayName("toEntity maps fromDataEntityPointId and toDataEntityPointId for LogicalDataEntityRelationship")
    void testLogicalDataEntityRelationshipToEntityMapsNewFields() {
        // Given: A DTO with new FK fields only (legacy ref-kind/ref-id columns removed).
        LogicalDataEntityRelationshipDto dto = new LogicalDataEntityRelationshipDto(
            "rel-2",
            "dep_log_log-entity-2",
            "dep_log_log-entity-3",
            "MANY_TO_MANY",
            "GENERALIZATION",
            "Generalization test",
            "tag1,tag2",
            "2024-01-01",
            null,
            null
        );

        // When: Map to Entity
        LogicalDataEntityRelationshipEntity entity = mapper.toEntity(dto, MODEL_FILE_ID);

        // Then: All fields including new FK fields are mapped
        assertThat(entity.getId()).isEqualTo("rel-2");
        assertThat(entity.getModelFileId()).isEqualTo(MODEL_FILE_ID);
        assertThat(entity.getFromDataEntityPointId()).isEqualTo("dep_log_log-entity-2");
        assertThat(entity.getToDataEntityPointId()).isEqualTo("dep_log_log-entity-3");
        assertThat(entity.getCardinality()).isEqualTo("MANY_TO_MANY");
        assertThat(entity.getRelationship()).isEqualTo("GENERALIZATION");
    }

    /**
     * Test 3: Verify null FK fields are handled correctly for LogicalDataEntityRelationship.
     */
    @Test
    @DisplayName("Null new FK fields are handled correctly for LogicalDataEntityRelationship")
    void testLogicalDataEntityRelationshipNullNewFields() {
        // Given: An entity with null new FK fields
        // (legacy fromRefKind/fromRefId/toRefKind/toRefId fields were removed.)
        LogicalDataEntityRelationshipEntity entity = LogicalDataEntityRelationshipEntity.builder()
            .id("rel-null")
            .modelFileId(MODEL_FILE_ID)
            .fromDataEntityPointId(null)
            .toDataEntityPointId(null)
            .build();

        // When: Map to DTO and back
        LogicalDataEntityRelationshipDto dto = mapper.toDto(entity);
        LogicalDataEntityRelationshipEntity roundTripped = mapper.toEntity(dto, MODEL_FILE_ID);

        // Then: Null values are preserved
        assertThat(dto.fromDataEntityPointId()).isNull();
        assertThat(dto.toDataEntityPointId()).isNull();
        assertThat(roundTripped.getFromDataEntityPointId()).isNull();
        assertThat(roundTripped.getToDataEntityPointId()).isNull();
    }

    // ============================================================================
    // DataMovement Mapping Tests
    // ============================================================================

    /**
     * Test 4: Verify DataMovement entity to DTO mapping includes new FK field.
     */
    @Test
    @DisplayName("toDto maps dataEntityPointId for DataMovement")
    void testDataMovementToDtoMapsNewField() {
        // Given: An entity with new FK field (legacy dataEntityId column removed).
        DataMovementEntity entity = DataMovementEntity.builder()
            .id("dm-1")
            .modelFileId(MODEL_FILE_ID)
            .sourceApplicationPointId("ap-source-1")
            .targetApplicationPointId("ap-target-1")
            .dataEntityPointId("dep_log_log-entity-dm")
            .movementType("SYNC")
            .description("Data movement test")
            .build();

        // When: Map to DTO
        DataMovementDto dto = mapper.toDto(entity);

        // Then: All fields including new FK field are mapped
        assertThat(dto.id()).isEqualTo("dm-1");
        assertThat(dto.sourceApplicationPointId()).isEqualTo("ap-source-1");
        assertThat(dto.targetApplicationPointId()).isEqualTo("ap-target-1");
        assertThat(dto.dataEntityPointId()).isEqualTo("dep_log_log-entity-dm");
        assertThat(dto.movementType()).isEqualTo("SYNC");
    }

    /**
     * Test 5: Verify DataMovement DTO to entity mapping includes new FK field.
     */
    @Test
    @DisplayName("toEntity maps dataEntityPointId for DataMovement")
    void testDataMovementToEntityMapsNewField() {
        // Given: A DTO with new FK fields only (legacy dataEntityId column removed).
        DataMovementDto dto = new DataMovementDto(
            "dm-2",
            "ap-source-2",
            "ap-target-2",
            "dep_log_log-entity-dm-2",
            null,  // interfaceWithSchemaId (XOR with dataEntityPointId)
            false, // biDirectional
            "ASYNC",
            "Async data movement",
            "async,movement",
            null,
            null
        );

        // When: Map to Entity
        DataMovementEntity entity = mapper.toEntity(dto, MODEL_FILE_ID);

        // Then: All fields including new FK field are mapped
        assertThat(entity.getId()).isEqualTo("dm-2");
        assertThat(entity.getModelFileId()).isEqualTo(MODEL_FILE_ID);
        assertThat(entity.getSourceApplicationPointId()).isEqualTo("ap-source-2");
        assertThat(entity.getTargetApplicationPointId()).isEqualTo("ap-target-2");
        assertThat(entity.getDataEntityPointId()).isEqualTo("dep_log_log-entity-dm-2");
        assertThat(entity.getMovementType()).isEqualTo("ASYNC");
    }

    /**
     * Test 6: Verify null FK field is handled correctly for DataMovement.
     */
    @Test
    @DisplayName("Null new FK field is handled correctly for DataMovement")
    void testDataMovementNullNewField() {
        // Given: An entity with null new FK field (legacy dataEntityId column removed).
        DataMovementEntity entity = DataMovementEntity.builder()
            .id("dm-null")
            .modelFileId(MODEL_FILE_ID)
            .sourceApplicationPointId("ap-source-null")
            .targetApplicationPointId("ap-target-null")
            .dataEntityPointId(null)
            .movementType("BATCH")
            .build();

        // When: Map to DTO and back
        DataMovementDto dto = mapper.toDto(entity);
        DataMovementEntity roundTripped = mapper.toEntity(dto, MODEL_FILE_ID);

        // Then: Null value is preserved
        assertThat(dto.dataEntityPointId()).isNull();
        assertThat(roundTripped.getDataEntityPointId()).isNull();
    }
}
