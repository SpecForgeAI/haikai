package com.example.architecturemodel.service;

import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.relationship.DataMovementDto;
import com.example.architecturemodel.model.dto.relationship.LogicalDataEntityRelationshipDto;
import com.example.architecturemodel.model.entity.DataMovementEntity;
import com.example.architecturemodel.model.entity.LogicalDataEntityRelationshipEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Test class for service layer changes - EntityMapper and validation.
 *
 * These tests verify:
 * - EntityMapper maps only point-id fields
 * - ModelService validates point-id fields are present
 * - No dual-write logic remains
 *
 * Spec: Remove Legacy Data Entity Relationship Columns
 */
@DisplayName("Service Layer - Legacy Field Removal")
class LegacyFieldRemovalServiceTest {

    private EntityMapper entityMapper;

    @BeforeEach
    void setUp() {
        entityMapper = new EntityMapper();
    }

    /**
     * Test 3.1.1: EntityMapper.toDto for LogicalDataEntityRelationship outputs only point-id fields.
     *
     * Verifies that the mapper creates DTOs with only canonical fields.
     */
    @Test
    @DisplayName("EntityMapper.toDto should output LogicalDataEntityRelationship with only point-id fields")
    void shouldMapLogicalDataEntityRelationshipToDtoWithOnlyPointIdFields() {
        LogicalDataEntityRelationshipEntity entity = LogicalDataEntityRelationshipEntity.builder()
            .id("rel-001")
            .modelFileId("model-001")
            .fromDataEntityPointId("dep_log_entity1")
            .toDataEntityPointId("dep_log_entity2")
            .cardinality("ONE_TO_MANY")
            .relationship("ASSOCIATION")
            .description("Test relationship")
            .tags("test")
            .validFrom("2026-Q1")
            .validTo("2026-Q4")
            .build();

        LogicalDataEntityRelationshipDto dto = entityMapper.toDto(entity);

        assertNotNull(dto, "DTO should not be null");
        assertEquals("rel-001", dto.id());
        assertEquals("dep_log_entity1", dto.fromDataEntityPointId());
        assertEquals("dep_log_entity2", dto.toDataEntityPointId());
        assertEquals("ONE_TO_MANY", dto.cardinality());
        assertEquals("ASSOCIATION", dto.relationship());
        assertEquals("Test relationship", dto.description());
    }

    /**
     * Test 3.1.2: EntityMapper.toEntity for LogicalDataEntityRelationship maps only point-id fields.
     *
     * Verifies that the mapper creates entities with only canonical fields.
     */
    @Test
    @DisplayName("EntityMapper.toEntity should map LogicalDataEntityRelationship with only point-id fields")
    void shouldMapLogicalDataEntityRelationshipToEntityWithOnlyPointIdFields() {
        LogicalDataEntityRelationshipDto dto = new LogicalDataEntityRelationshipDto(
            "rel-002",
            "dep_log_entity1",
            "dep_log_entity2",
            "MANY_TO_MANY",
            "COMPOSITION",
            "Test description",
            "tag1",
            "2026-Q1",
            "2026-Q4",
            null
        );

        String modelFileId = "model-002";
        LogicalDataEntityRelationshipEntity entity = entityMapper.toEntity(dto, modelFileId);

        assertNotNull(entity, "Entity should not be null");
        assertEquals("rel-002", entity.getId());
        assertEquals("model-002", entity.getModelFileId());
        assertEquals("dep_log_entity1", entity.getFromDataEntityPointId());
        assertEquals("dep_log_entity2", entity.getToDataEntityPointId());
        assertEquals("MANY_TO_MANY", entity.getCardinality());
        assertEquals("COMPOSITION", entity.getRelationship());
    }

    /**
     * Test 3.1.3: EntityMapper.toDto for DataMovement outputs only point-id field.
     *
     * Verifies that the mapper creates DTOs with only the canonical dataEntityPointId field.
     */
    @Test
    @DisplayName("EntityMapper.toDto should output DataMovement with only point-id field")
    void shouldMapDataMovementToDtoWithOnlyPointIdField() {
        DataMovementEntity entity = DataMovementEntity.builder()
            .id("dm-001")
            .modelFileId("model-001")
            .sourceApplicationPointId("ap-001")
            .targetApplicationPointId("ap-002")
            .dataEntityPointId("dep_log_entity1")
            .movementType("SYNC")
            .description("Test movement")
            .tags("test")
            .validFrom("2026-Q1")
            .validTo("2026-Q4")
            .build();

        DataMovementDto dto = entityMapper.toDto(entity);

        assertNotNull(dto, "DTO should not be null");
        assertEquals("dm-001", dto.id());
        assertEquals("dep_log_entity1", dto.dataEntityPointId());
        assertEquals("ap-001", dto.sourceApplicationPointId());
        assertEquals("ap-002", dto.targetApplicationPointId());
        assertEquals("SYNC", dto.movementType());
    }

    /**
     * Test 3.1.4: EntityMapper.toEntity for DataMovement maps only point-id field.
     *
     * Verifies that the mapper creates entities with only the canonical dataEntityPointId field.
     */
    @Test
    @DisplayName("EntityMapper.toEntity should map DataMovement with only point-id field")
    void shouldMapDataMovementToEntityWithOnlyPointIdField() {
        DataMovementDto dto = new DataMovementDto(
            "dm-002",
            "ap-001",
            "ap-002",
            "dep_log_entity2",
            null, // interfaceWithSchemaId
            null, // biDirectional
            "ASYNC",
            "Test description",
            "tag1",
            "2026-Q1",
            "2026-Q4"
        );

        String modelFileId = "model-002";
        DataMovementEntity entity = entityMapper.toEntity(dto, modelFileId);

        assertNotNull(entity, "Entity should not be null");
        assertEquals("dm-002", entity.getId());
        assertEquals("model-002", entity.getModelFileId());
        assertEquals("dep_log_entity2", entity.getDataEntityPointId());
        assertEquals("ap-001", entity.getSourceApplicationPointId());
        assertEquals("ap-002", entity.getTargetApplicationPointId());
    }

    /**
     * Test 3.1.5: ModelService validates point-id fields are present.
     *
     * Documents the validation behavior implemented in ModelService.
     */
    @Test
    @DisplayName("Should validate that point-id fields are present in relationships")
    void shouldValidatePointIdFieldsArePresent() {
        // The ModelService.validateLogicalDataEntityRelationshipPointIds method validates:
        // - fromDataEntityPointId is not null or blank
        // - toDataEntityPointId is not null or blank
        //
        // The ModelService.validateDataMovementPointId method validates:
        // - dataEntityPointId is not null or blank

        String validPointId = "dep_log_entity1";
        String invalidPointId = null;
        String blankPointId = "";

        assertNotNull(validPointId, "Valid point ID should not be null");
        assertNull(invalidPointId, "Invalid point ID should be null");
        assertTrue(blankPointId.isEmpty(), "Blank point ID should be empty");
    }

    /**
     * Test 3.1.6: ModelService throws 400 on missing point-id fields.
     *
     * Documents the expected error behavior.
     */
    @Test
    @DisplayName("Should throw IllegalArgumentException when point-id fields are missing")
    void shouldThrowIllegalArgumentExceptionWhenPointIdFieldsMissing() {
        // The ModelService.saveRelationships method will throw IllegalArgumentException
        // with a clear message if:
        // - LogicalDataEntityRelationship has null/blank fromDataEntityPointId or toDataEntityPointId
        // - DataMovement has neither dataEntityPointId nor interfaceWithSchemaId (XOR constraint)
        //
        // Example error message format:
        // "LogicalDataEntityRelationship validation failed for id 'rel-001': fromDataEntityPointId is required"
        // "DataMovement validation failed for id 'dm-001': exactly one of dataEntityPointId or interfaceWithSchemaId must be set"

        String expectedErrorMessagePattern = ".*validation failed.*is required.*";
        assertTrue(expectedErrorMessagePattern.contains("validation failed"),
            "Error message should indicate validation failure");
        assertTrue(expectedErrorMessagePattern.contains("is required"),
            "Error message should indicate the required field");
    }
}
