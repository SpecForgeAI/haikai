package com.example.architecturemodel.dto;

import com.example.architecturemodel.mapper.DiagramMapper;
import com.example.architecturemodel.model.dto.diagram.*;
import com.example.architecturemodel.model.entity.DiagramEntity;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for Task Group 2: DiagramEntity and DiagramDto typedContent field handling.
 *
 * These tests verify:
 * 1. DiagramEntity correctly stores/retrieves typedContentJson (Map<String, Object>)
 * 2. DiagramDto includes typedContent in serialization
 * 3. DiagramMapper correctly converts between entity and DTO
 * 4. NULL typedContentJson maps to null typedContent
 */
class DiagramTypedContentTest {

    private ObjectMapper objectMapper;
    private DiagramMapper diagramMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        diagramMapper = new DiagramMapper();
    }

    /**
     * Test 1: DiagramEntity correctly stores/retrieves Map<String, Object> typedContentJson.
     *
     * This test verifies that the entity can hold the typed content structure
     * using Map<String, Object> for flexible JSON handling.
     */
    @Test
    @DisplayName("Test 1: DiagramEntity correctly stores/retrieves typedContentJson as Map")
    void testDiagramEntityStoresAndRetrievesTypedContentJson() {
        // Arrange - Create typed content structure
        Map<String, Object> typedContent = new HashMap<>();
        typedContent.put("type", "Sequence");
        typedContent.put("version", 1);

        Map<String, Object> content = new HashMap<>();
        content.put("participants", new ArrayList<>());
        content.put("messages", new ArrayList<>());
        content.put("fragments", new ArrayList<>());
        content.put("operands", new ArrayList<>());
        content.put("sequenceNodes", new ArrayList<>());
        typedContent.put("content", content);

        // Act - Create entity with typed content
        DiagramEntity entity = DiagramEntity.builder()
                .id("diagram-1")
                .modelFileId("mf-1")
                .name("Test Sequence Diagram")
                .description("Testing typed content storage")
                .diagramType("Sequence")
                .typedContentJson(typedContent)
                .build();

        // Assert - Verify typed content is stored correctly
        assertNotNull(entity.getTypedContentJson(), "typedContentJson should not be null");
        assertEquals("Sequence", entity.getTypedContentJson().get("type"));
        assertEquals(1, entity.getTypedContentJson().get("version"));

        @SuppressWarnings("unchecked")
        Map<String, Object> retrievedContent = (Map<String, Object>) entity.getTypedContentJson().get("content");
        assertNotNull(retrievedContent, "content object should exist");
        assertTrue(retrievedContent.containsKey("participants"), "should have participants key");
        assertTrue(retrievedContent.containsKey("messages"), "should have messages key");
    }

    /**
     * Test 2: DiagramDto includes typedContent in JSON serialization.
     *
     * This test verifies that the DTO correctly serializes and deserializes
     * the typed_content field to/from JSON.
     */
    @Test
    @DisplayName("Test 2: DiagramDto includes typedContent in JSON serialization")
    void testDiagramDtoSerializesTypedContent() throws Exception {
        // Arrange - Create typed content structure
        Map<String, Object> typedContent = new HashMap<>();
        typedContent.put("type", "Sequence");
        typedContent.put("version", 1);

        Map<String, Object> content = new HashMap<>();
        List<Map<String, Object>> participants = new ArrayList<>();
        Map<String, Object> participant = new HashMap<>();
        participant.put("id", "part-1");
        participant.put("refKind", "Application");
        participant.put("refId", "app-1");
        participant.put("orderIndex", 0);
        participants.add(participant);
        content.put("participants", participants);
        content.put("messages", new ArrayList<>());
        content.put("fragments", new ArrayList<>());
        content.put("operands", new ArrayList<>());
        content.put("sequenceNodes", new ArrayList<>());
        typedContent.put("content", content);

        // Create DTO with typed content
        DiagramDto dto = new DiagramDto(
                "diagram-1",
                "Test Sequence Diagram",
                "Testing serialization",
                "Sequence",
                null,
                null,
                Collections.emptyList(),
                Collections.emptyList(),
                Collections.emptyList(),
                Collections.emptyList(),
                typedContent
        );

        // Act - Serialize to JSON
        String json = objectMapper.writeValueAsString(dto);

        // Assert - Verify typed_content is in JSON
        assertTrue(json.contains("\"typed_content\""), "JSON should contain typed_content field");
        assertTrue(json.contains("\"type\":\"Sequence\""), "JSON should contain type field");
        assertTrue(json.contains("\"version\":1"), "JSON should contain version field");
        assertTrue(json.contains("\"participants\""), "JSON should contain participants array");

        // Act - Deserialize back
        DiagramDto deserialized = objectMapper.readValue(json, DiagramDto.class);

        // Assert - Verify round-trip
        assertNotNull(deserialized.typedContent(), "typedContent should not be null after deserialization");
        assertEquals("Sequence", deserialized.typedContent().get("type"));
        assertEquals(1, deserialized.typedContent().get("version"));
    }

    /**
     * Test 3: DiagramMapper correctly converts between entity and DTO.
     *
     * This test verifies that the mapper correctly maps typedContentJson
     * from entity to typedContent in DTO and vice versa.
     */
    @Test
    @DisplayName("Test 3: Mapper correctly converts between entity typedContentJson and DTO typedContent")
    void testMapperConvertsTypedContentBetweenEntityAndDto() {
        // Arrange - Create typed content structure for an Activity diagram
        Map<String, Object> typedContent = new HashMap<>();
        typedContent.put("type", "Activity");
        typedContent.put("version", 1);

        Map<String, Object> content = new HashMap<>();
        List<Map<String, Object>> partitions = new ArrayList<>();
        Map<String, Object> partition = new HashMap<>();
        partition.put("id", "partition-1");
        partition.put("name", "User");
        partition.put("refKind", "BusinessUser");
        partition.put("refId", "bu-1");
        partitions.add(partition);
        content.put("partitions", partitions);
        content.put("flows", new ArrayList<>());
        typedContent.put("content", content);

        // Create entity with typed content
        DiagramEntity entity = DiagramEntity.builder()
                .id("diagram-activity-1")
                .modelFileId("mf-1")
                .name("Test Activity Diagram")
                .description("Testing mapper")
                .diagramType("Activity")
                .typedContentJson(typedContent)
                .build();

        // Act - Convert entity to DTO
        DiagramDto dto = diagramMapper.toDto(
                entity,
                Collections.emptyList(),
                Collections.emptyList(),
                Collections.emptyList(),
                Collections.emptyList()
        );

        // Assert - Verify DTO has typed content
        assertNotNull(dto.typedContent(), "DTO typedContent should not be null");
        assertEquals("Activity", dto.typedContent().get("type"));
        assertEquals(1, dto.typedContent().get("version"));

        @SuppressWarnings("unchecked")
        Map<String, Object> dtoContent = (Map<String, Object>) dto.typedContent().get("content");
        assertNotNull(dtoContent, "DTO content should not be null");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> dtoPartitions = (List<Map<String, Object>>) dtoContent.get("partitions");
        assertEquals(1, dtoPartitions.size(), "should have 1 partition");
        assertEquals("User", dtoPartitions.get(0).get("name"));

        // Act - Convert DTO back to entity
        DiagramEntity convertedEntity = diagramMapper.toEntity(dto, "mf-1");

        // Assert - Verify entity has typed content
        assertNotNull(convertedEntity.getTypedContentJson(), "Entity typedContentJson should not be null");
        assertEquals("Activity", convertedEntity.getTypedContentJson().get("type"));
        assertEquals(1, convertedEntity.getTypedContentJson().get("version"));
    }

    /**
     * Test 4: NULL typedContentJson maps to null typedContent.
     *
     * This test verifies that General diagrams (which have no typed content)
     * correctly map NULL in both directions.
     */
    @Test
    @DisplayName("Test 4: NULL typedContentJson maps to null typedContent for General diagrams")
    void testNullTypedContentJsonMapsToNullTypedContent() {
        // Arrange - Create General diagram entity with null typed content
        DiagramEntity entity = DiagramEntity.builder()
                .id("diagram-general-1")
                .modelFileId("mf-1")
                .name("General Diagram")
                .description("A general diagram with no typed content")
                .diagramType("General")
                .typedContentJson(null)  // General diagrams have null typed content
                .build();

        // Act - Convert entity to DTO
        DiagramDto dto = diagramMapper.toDto(
                entity,
                Collections.emptyList(),
                Collections.emptyList(),
                Collections.emptyList(),
                Collections.emptyList()
        );

        // Assert - Verify DTO has null typed content
        assertNull(dto.typedContent(), "DTO typedContent should be null for General diagrams");
        assertEquals("General", dto.diagramType());

        // Act - Convert DTO back to entity
        DiagramEntity convertedEntity = diagramMapper.toEntity(dto, "mf-1");

        // Assert - Verify entity has null typed content
        assertNull(convertedEntity.getTypedContentJson(),
                "Entity typedContentJson should be null for General diagrams");
        assertEquals("General", convertedEntity.getDiagramType());

        // Also test creating a DTO with explicit null for typedContent
        DiagramDto dtoWithNull = new DiagramDto(
                "diagram-general-2",
                "Another General Diagram",
                null,
                "General",
                null,
                null,
                null,
                null,
                null,
                null,
                null  // Explicit null for typedContent
        );

        // Verify serialization handles null correctly
        try {
            String json = objectMapper.writeValueAsString(dtoWithNull);
            // Null fields may be omitted or explicitly null depending on ObjectMapper config
            // Either way, deserialization should work
            DiagramDto deserializedNull = objectMapper.readValue(json, DiagramDto.class);
            assertNull(deserializedNull.typedContent(), "Deserialized typedContent should be null");
        } catch (Exception e) {
            fail("Serialization with null typedContent should not throw: " + e.getMessage());
        }
    }
}
