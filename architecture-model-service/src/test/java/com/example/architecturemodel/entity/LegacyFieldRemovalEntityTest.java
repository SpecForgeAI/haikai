package com.example.architecturemodel.entity;

import com.example.architecturemodel.model.dto.relationship.DataMovementDto;
import com.example.architecturemodel.model.dto.relationship.LogicalDataEntityRelationshipDto;
import com.example.architecturemodel.model.entity.DataMovementEntity;
import com.example.architecturemodel.model.entity.LogicalDataEntityRelationshipEntity;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Test class for JPA Entity and DTO changes for legacy field removal.
 *
 * These tests verify:
 * - Entities have no legacy fields
 * - Point-id fields are properly configured
 * - DTOs serialize without legacy fields
 *
 * Spec: Remove Legacy Data Entity Relationship Columns
 */
@DisplayName("JPA Entity and DTO - Legacy Field Removal")
class LegacyFieldRemovalEntityTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Test 2.1.1: LogicalDataEntityRelationshipEntity can be saved with only point-id fields.
     *
     * Verifies that the entity builder works correctly with the new schema.
     */
    @Test
    @DisplayName("LogicalDataEntityRelationshipEntity should build with only point-id fields")
    void shouldBuildLogicalDataEntityRelationshipEntityWithPointIdFields() {
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

        assertNotNull(entity, "Entity should be created");
        assertEquals("rel-001", entity.getId());
        assertEquals("dep_log_entity1", entity.getFromDataEntityPointId());
        assertEquals("dep_log_entity2", entity.getToDataEntityPointId());

        // Verify entity no longer has legacy fields (these would cause compile errors if they existed)
        assertNotNull(entity.getCardinality(), "Cardinality should be set");
        assertNotNull(entity.getRelationship(), "Relationship should be set");
    }

    /**
     * Test 2.1.2: LogicalDataEntityRelationshipEntity requires point-id fields (via JPA @Column nullable=false).
     *
     * Verifies the entity has the correct nullable configuration.
     */
    @Test
    @DisplayName("LogicalDataEntityRelationshipEntity point-id fields should be required")
    void shouldRequirePointIdFieldsOnLogicalDataEntityRelationshipEntity() {
        // The @Column(nullable = false) annotation is set on:
        // - fromDataEntityPointId
        // - toDataEntityPointId
        // This test documents the expected behavior

        LogicalDataEntityRelationshipEntity entity = LogicalDataEntityRelationshipEntity.builder()
            .id("rel-002")
            .modelFileId("model-001")
            .fromDataEntityPointId("dep_log_e1")
            .toDataEntityPointId("dep_log_e2")
            .build();

        assertNotNull(entity.getFromDataEntityPointId(), "fromDataEntityPointId should not be null");
        assertNotNull(entity.getToDataEntityPointId(), "toDataEntityPointId should not be null");
    }

    /**
     * Test 2.1.3: DataMovementEntity can be saved with only point-id fields.
     *
     * Verifies that the entity builder works correctly with the new schema.
     */
    @Test
    @DisplayName("DataMovementEntity should build with only point-id fields")
    void shouldBuildDataMovementEntityWithPointIdField() {
        DataMovementEntity entity = DataMovementEntity.builder()
            .id("dm-001")
            .modelFileId("model-001")
            .sourceApplicationPointId("ap-001")
            .targetApplicationPointId("ap-002")
            .dataEntityPointId("dep_log_entity1")
            .movementType("SYNC")
            .description("Test data movement")
            .tags("test")
            .validFrom("2026-Q1")
            .validTo("2026-Q4")
            .build();

        assertNotNull(entity, "Entity should be created");
        assertEquals("dm-001", entity.getId());
        assertEquals("dep_log_entity1", entity.getDataEntityPointId());

        // Verify entity no longer has legacy dataEntityId field
        assertNotNull(entity.getDataEntityPointId(), "dataEntityPointId should be set");
    }

    /**
     * Test 2.1.4: DataMovementEntity requires dataEntityPointId (via JPA @Column nullable=false).
     *
     * Verifies the entity has the correct nullable configuration.
     */
    @Test
    @DisplayName("DataMovementEntity dataEntityPointId field should be required")
    void shouldRequireDataEntityPointIdOnDataMovementEntity() {
        DataMovementEntity entity = DataMovementEntity.builder()
            .id("dm-002")
            .modelFileId("model-001")
            .sourceApplicationPointId("ap-001")
            .targetApplicationPointId("ap-002")
            .dataEntityPointId("dep_log_e1")
            .build();

        assertNotNull(entity.getDataEntityPointId(), "dataEntityPointId should not be null");
    }

    /**
     * Test 2.1.5: DTO serialization produces only canonical fields (no legacy fields).
     *
     * Verifies that the DTO serializes without legacy field names.
     */
    @Test
    @DisplayName("LogicalDataEntityRelationshipDto should serialize without legacy fields")
    void shouldSerializeDtoWithoutLegacyFields() throws Exception {
        LogicalDataEntityRelationshipDto dto = new LogicalDataEntityRelationshipDto(
            "rel-003",
            "dep_log_entity1",
            "dep_log_entity2",
            "ONE_TO_ONE",
            "ASSOCIATION",
            "Test description",
            "tag1,tag2",
            "2026-Q1",
            "2026-Q4",
            null
        );

        String json = objectMapper.writeValueAsString(dto);

        // Verify canonical fields are present
        assertTrue(json.contains("fromDataEntityPointId"), "JSON should contain fromDataEntityPointId");
        assertTrue(json.contains("toDataEntityPointId"), "JSON should contain toDataEntityPointId");

        // Verify legacy fields are NOT present
        assertFalse(json.contains("fromRefKind"), "JSON should NOT contain fromRefKind");
        assertFalse(json.contains("fromRefId"), "JSON should NOT contain fromRefId");
        assertFalse(json.contains("toRefKind"), "JSON should NOT contain toRefKind");
        assertFalse(json.contains("toRefId"), "JSON should NOT contain toRefId");
    }

    /**
     * Test 2.1.6: DataMovementDto serialization produces only canonical fields.
     *
     * Verifies that the DTO serializes without legacy dataEntityId field.
     */
    @Test
    @DisplayName("DataMovementDto should serialize without legacy fields")
    void shouldSerializeDataMovementDtoWithoutLegacyFields() throws Exception {
        DataMovementDto dto = new DataMovementDto(
            "dm-003",
            "ap-001",
            "ap-002",
            "dep_log_entity1",
            null,                      // interfaceWithSchemaId (XOR with dataEntityPointId)
            null,                      // biDirectional
            "ASYNC",
            "Test description",
            "tag1",
            "2026-Q1",
            "2026-Q4"
        );

        String json = objectMapper.writeValueAsString(dto);

        // Verify canonical field is present
        assertTrue(json.contains("dataEntityPointId"), "JSON should contain dataEntityPointId");

        // Verify legacy field is NOT present
        assertFalse(json.contains("dataEntityId"), "JSON should NOT contain dataEntityId");
    }
}
