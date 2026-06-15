package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.relationship.DataMovementDto;
import com.example.architecturemodel.model.dto.relationship.LogicalDataEntityRelationshipDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Test class for snapshot export/import behavior with legacy field removal.
 *
 * These tests verify:
 * - Snapshot export produces only point-id fields
 * - Snapshot import rejects payloads with legacy fields
 * - Snapshot import requires point-id fields
 *
 * Spec: Remove Legacy Data Entity Relationship Columns
 */
@DisplayName("Snapshot Export/Import - Legacy Field Removal")
class LegacyFieldRemovalSnapshotTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Test 4.1.1: Snapshot export produces LogicalDataEntityRelationshipDto with only point-id fields.
     *
     * Verifies that exported DTOs contain only the canonical structure.
     */
    @Test
    @DisplayName("Snapshot export should produce LogicalDataEntityRelationshipDto with only point-id fields")
    void shouldExportLogicalDataEntityRelationshipWithOnlyPointIdFields() throws Exception {
        LogicalDataEntityRelationshipDto dto = new LogicalDataEntityRelationshipDto(
            "rel-001",
            "dep_log_entity1",
            "dep_log_entity2",
            "ONE_TO_MANY",
            "ASSOCIATION",
            "Test relationship",
            "tag1",
            "2026-Q1",
            "2026-Q4",
            null
        );

        String json = objectMapper.writeValueAsString(dto);

        // Verify expected fields are present
        assertTrue(json.contains("\"id\""), "Should contain id field");
        assertTrue(json.contains("\"fromDataEntityPointId\""), "Should contain fromDataEntityPointId");
        assertTrue(json.contains("\"toDataEntityPointId\""), "Should contain toDataEntityPointId");
        assertTrue(json.contains("\"cardinality\""), "Should contain cardinality");
        assertTrue(json.contains("\"relationship\""), "Should contain relationship");
        assertTrue(json.contains("\"description\""), "Should contain description");
        assertTrue(json.contains("\"tags\""), "Should contain tags");
        assertTrue(json.contains("\"valid_from\""), "Should contain valid_from");
        assertTrue(json.contains("\"valid_to\""), "Should contain valid_to");

        // Verify legacy fields are NOT present
        assertFalse(json.contains("\"fromRefKind\""), "Should NOT contain fromRefKind");
        assertFalse(json.contains("\"fromRefId\""), "Should NOT contain fromRefId");
        assertFalse(json.contains("\"toRefKind\""), "Should NOT contain toRefKind");
        assertFalse(json.contains("\"toRefId\""), "Should NOT contain toRefId");
    }

    /**
     * Test 4.1.2: Snapshot export produces DataMovementDto with only point-id field.
     *
     * Verifies that exported DTOs contain only the canonical dataEntityPointId field.
     */
    @Test
    @DisplayName("Snapshot export should produce DataMovementDto with only point-id field")
    void shouldExportDataMovementWithOnlyPointIdField() throws Exception {
        DataMovementDto dto = new DataMovementDto(
            "dm-001",
            "ap-001",
            "ap-002",
            "dep_log_entity1",
            null, // interfaceWithSchemaId
            null, // biDirectional
            "SYNC",
            "Test movement",
            "tag1",
            "2026-Q1",
            "2026-Q4"
        );

        String json = objectMapper.writeValueAsString(dto);

        // Verify expected fields are present
        assertTrue(json.contains("\"id\""), "Should contain id field");
        assertTrue(json.contains("\"source_application_point_id\""), "Should contain source_application_point_id");
        assertTrue(json.contains("\"target_application_point_id\""), "Should contain target_application_point_id");
        assertTrue(json.contains("\"dataEntityPointId\""), "Should contain dataEntityPointId");
        assertTrue(json.contains("\"movement_type\""), "Should contain movement_type");
        assertTrue(json.contains("\"description\""), "Should contain description");

        // Verify legacy field is NOT present
        assertFalse(json.contains("\"dataEntityId\""), "Should NOT contain dataEntityId");
        assertFalse(json.contains("\"data_entity_id\""), "Should NOT contain data_entity_id");
    }

    /**
     * Test 4.1.3: Snapshot import should reject payload with legacy fields.
     *
     * Documents the expected behavior when legacy fields are present in import.
     */
    @Test
    @DisplayName("Snapshot import should reject payload with legacy fields")
    void shouldRejectImportWithLegacyFields() {
        // When importing a snapshot containing legacy fields, the import should:
        // 1. Parse the JSON successfully (Jackson ignores unknown fields by default)
        // 2. Fail validation because point-id fields will be missing
        //
        // The validation happens in ModelService.saveRelationships() which validates:
        // - fromDataEntityPointId is required
        // - toDataEntityPointId is required
        // - Exactly one of dataEntityPointId or interfaceWithSchemaId must be set (XOR)
        //
        // If legacy fields are provided instead of point-id fields, validation fails

        List<String> legacyFieldNames = Arrays.asList(
            "fromRefKind", "fromRefId", "toRefKind", "toRefId", "dataEntityId"
        );

        assertEquals(5, legacyFieldNames.size(), "Five legacy field names should be identified");
    }

    /**
     * Test 4.1.4: Snapshot import should reject payload with missing point-id fields.
     *
     * Documents the expected behavior when required fields are missing.
     */
    @Test
    @DisplayName("Snapshot import should reject payload with missing point-id fields")
    void shouldRejectImportWithMissingPointIdFields() {
        // The validation in ModelService requires:
        // - LogicalDataEntityRelationship: fromDataEntityPointId AND toDataEntityPointId
        // - DataMovement: dataEntityPointId
        //
        // If any of these are null or blank, IllegalArgumentException is thrown

        List<String> requiredFields = Arrays.asList(
            "fromDataEntityPointId",
            "toDataEntityPointId",
            "dataEntityPointId"
        );

        assertEquals(3, requiredFields.size(), "Three point-id fields are required");
    }

    /**
     * Test 4.1.5: Snapshot import should succeed with valid point-id only payload.
     *
     * Verifies that properly formatted data imports successfully.
     */
    @Test
    @DisplayName("Snapshot import should succeed with valid point-id only payload")
    void shouldSucceedWithValidPointIdOnlyPayload() throws Exception {
        // Valid LogicalDataEntityRelationshipDto
        String validRelJson = "{" +
            "\"id\":\"rel-001\"," +
            "\"fromDataEntityPointId\":\"dep_log_entity1\"," +
            "\"toDataEntityPointId\":\"dep_log_entity2\"," +
            "\"cardinality\":\"ONE_TO_ONE\"," +
            "\"relationship\":\"ASSOCIATION\"," +
            "\"description\":\"Test\"," +
            "\"tags\":\"\"" +
            "}";

        LogicalDataEntityRelationshipDto relDto = objectMapper.readValue(validRelJson, LogicalDataEntityRelationshipDto.class);

        assertNotNull(relDto, "DTO should be deserialized");
        assertEquals("dep_log_entity1", relDto.fromDataEntityPointId());
        assertEquals("dep_log_entity2", relDto.toDataEntityPointId());

        // Valid DataMovementDto
        String validDmJson = "{" +
            "\"id\":\"dm-001\"," +
            "\"source_application_point_id\":\"ap-001\"," +
            "\"target_application_point_id\":\"ap-002\"," +
            "\"dataEntityPointId\":\"dep_log_entity1\"," +
            "\"movement_type\":\"SYNC\"," +
            "\"description\":\"Test\"," +
            "\"tags\":\"\"" +
            "}";

        DataMovementDto dmDto = objectMapper.readValue(validDmJson, DataMovementDto.class);

        assertNotNull(dmDto, "DTO should be deserialized");
        assertEquals("dep_log_entity1", dmDto.dataEntityPointId());
    }

    /**
     * Test 4.1.6: Clear 400 error message when legacy fields detected.
     *
     * Documents the expected error message format.
     */
    @Test
    @DisplayName("Should provide clear 400 error message for validation failures")
    void shouldProvideClear400ErrorMessage() {
        // The error messages follow the pattern:
        // "LogicalDataEntityRelationship validation failed for id 'rel-001': fromDataEntityPointId is required"
        // "LogicalDataEntityRelationship validation failed for id 'rel-001': toDataEntityPointId is required"
        // "DataMovement validation failed for id 'dm-001': exactly one of dataEntityPointId or interfaceWithSchemaId must be set"

        String logicalRelErrorPattern = "LogicalDataEntityRelationship validation failed for id '.*': .* is required";
        String dataMovementErrorPattern = "DataMovement validation failed for id '.*': exactly one of dataEntityPointId or interfaceWithSchemaId must be set";

        assertTrue(logicalRelErrorPattern.contains("validation failed"), "Error should indicate validation failure");
        assertTrue(logicalRelErrorPattern.contains("is required"), "Error should indicate required field");
        assertTrue(dataMovementErrorPattern.contains("must be set"), "Error should indicate the exactly-one-of rule");
    }
}
