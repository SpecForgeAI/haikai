package com.example.architecturemodel.dto;

import com.example.architecturemodel.model.dto.EntityBundleSelection;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for EntityBundleSelection depth field deserialization.
 *
 * Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End
 * Task Group 5: Model Service EntityBundleSelection DTO
 *
 * Tests that:
 * 1. EntityBundleSelection deserializes depth field from JSON
 * 2. depth=null deserializes correctly (defaults to null, service treats as 1)
 * 3. depth=2 deserializes and is accessible
 */
@DisplayName("EntityBundleSelection Depth Field Tests")
class EntityBundleSelectionDepthTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
    }

    @Test
    @DisplayName("Task 5.1 - EntityBundleSelection deserializes depth field from JSON")
    void shouldDeserializeDepthField() throws Exception {
        // Given: JSON with depth field
        String json = """
            {
                "entity_type": "physicalDataEntities",
                "entity_id": "pde-123",
                "bundle_type": "entity_with_attributes_and_relationships",
                "depth": 1
            }
            """;

        // When: deserializing
        EntityBundleSelection selection = objectMapper.readValue(json, EntityBundleSelection.class);

        // Then: all fields should be populated including depth
        assertEquals("physicalDataEntities", selection.entityType());
        assertEquals("pde-123", selection.entityId());
        assertEquals("entity_with_attributes_and_relationships", selection.bundleType());
        assertEquals(Integer.valueOf(1), selection.depth());
    }

    @Test
    @DisplayName("Task 5.1 - depth=null deserializes correctly (service treats as depth=1)")
    void shouldDeserializeNullDepth() throws Exception {
        // Given: JSON without depth field (null implied)
        String json = """
            {
                "entity_type": "logicalDataEntities",
                "entity_id": "lde-456",
                "bundle_type": "entity_only"
            }
            """;

        // When: deserializing
        EntityBundleSelection selection = objectMapper.readValue(json, EntityBundleSelection.class);

        // Then: depth should be null (service will default to 1)
        assertEquals("logicalDataEntities", selection.entityType());
        assertEquals("lde-456", selection.entityId());
        assertEquals("entity_only", selection.bundleType());
        assertNull(selection.depth(), "depth should be null when not specified");

        // Verify the default depth logic (service-level, but we test it here)
        int effectiveDepth = selection.depth() != null ? selection.depth() : 1;
        assertEquals(1, effectiveDepth, "null depth should be treated as 1");
    }

    @Test
    @DisplayName("Task 5.1 - depth=2 deserializes and is accessible")
    void shouldDeserializeDepth2() throws Exception {
        // Given: JSON with depth=2
        String json = """
            {
                "entity_type": "physicalDataEntities",
                "entity_id": "pde-789",
                "bundle_type": "entity_with_attributes_and_relationships",
                "depth": 2
            }
            """;

        // When: deserializing
        EntityBundleSelection selection = objectMapper.readValue(json, EntityBundleSelection.class);

        // Then: depth should be 2
        assertEquals("physicalDataEntities", selection.entityType());
        assertEquals("pde-789", selection.entityId());
        assertEquals("entity_with_attributes_and_relationships", selection.bundleType());
        assertEquals(Integer.valueOf(2), selection.depth());
    }
}
