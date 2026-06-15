package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.diagram.DiagramDto;
import com.example.architecturemodel.model.entity.DiagramEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for DiagramMapper normalizeDiagramType functionality.
 *
 * These tests verify:
 * 1. Uppercase diagram types are normalized to canonical form (e.g., "SEQUENCE" -> "Sequence")
 * 2. Whitespace is trimmed and casing is normalized (e.g., " sequence " -> "Sequence")
 * 3. Null input returns null (graceful handling)
 * 4. Unknown diagram types are preserved (trimmed) without throwing exceptions
 * 5. USER_JOURNEY is normalized to canonical "USER_JOURNEY" form
 */
class DiagramMapperNormalizationTest {

    private DiagramMapper diagramMapper;
    private Method normalizeDiagramTypeMethod;

    @BeforeEach
    void setUp() throws Exception {
        diagramMapper = new DiagramMapper();
        // Use reflection to access the private method for direct testing
        normalizeDiagramTypeMethod = DiagramMapper.class.getDeclaredMethod("normalizeDiagramType", String.class);
        normalizeDiagramTypeMethod.setAccessible(true);
    }

    /**
     * Helper method to invoke the private normalizeDiagramType method.
     */
    private String invokeNormalizeDiagramType(String raw) throws Exception {
        return (String) normalizeDiagramTypeMethod.invoke(diagramMapper, raw);
    }

    /**
     * Test 1: normalizeDiagramType("SEQUENCE") returns "Sequence"
     *
     * Verifies that uppercase diagram types are normalized to their canonical form.
     */
    @Test
    @DisplayName("Test 1: normalizeDiagramType(\"SEQUENCE\") returns \"Sequence\"")
    void testNormalizeDiagramTypeUppercaseSequence() throws Exception {
        String result = invokeNormalizeDiagramType("SEQUENCE");
        assertEquals("Sequence", result, "SEQUENCE should normalize to Sequence");
    }

    /**
     * Test 2: normalizeDiagramType(" sequence ") returns "Sequence"
     *
     * Verifies that whitespace is trimmed and casing is normalized.
     */
    @Test
    @DisplayName("Test 2: normalizeDiagramType(\" sequence \") returns \"Sequence\"")
    void testNormalizeDiagramTypeTrimAndLowercase() throws Exception {
        String result = invokeNormalizeDiagramType(" sequence ");
        assertEquals("Sequence", result, "' sequence ' should normalize to Sequence");
    }

    /**
     * Test 3: normalizeDiagramType(null) returns null
     *
     * Verifies that null input is handled gracefully by returning null.
     */
    @Test
    @DisplayName("Test 3: normalizeDiagramType(null) returns null")
    void testNormalizeDiagramTypeNull() throws Exception {
        String result = invokeNormalizeDiagramType(null);
        assertNull(result, "null input should return null");
    }

    /**
     * Test 4: normalizeDiagramType("unknown") returns "unknown" (trimmed, no exception)
     *
     * Verifies that unknown diagram types are preserved (trimmed) without throwing exceptions.
     */
    @Test
    @DisplayName("Test 4: normalizeDiagramType(\"unknown\") returns \"unknown\" (trimmed, no exception)")
    void testNormalizeDiagramTypeUnknown() throws Exception {
        String result = invokeNormalizeDiagramType("unknown");
        assertEquals("unknown", result, "unknown type should be returned as-is (trimmed)");

        // Also test with whitespace around unknown value
        String resultWithSpaces = invokeNormalizeDiagramType("  unknown  ");
        assertEquals("unknown", resultWithSpaces, "unknown type with spaces should be trimmed");
    }

    /**
     * Additional test: Verify all canonical diagram types are correctly normalized.
     */
    @Test
    @DisplayName("All canonical diagram types are correctly normalized")
    void testAllCanonicalDiagramTypes() throws Exception {
        // Test GENERAL
        assertEquals("General", invokeNormalizeDiagramType("GENERAL"));
        assertEquals("General", invokeNormalizeDiagramType("general"));
        assertEquals("General", invokeNormalizeDiagramType("General"));
        assertEquals("General", invokeNormalizeDiagramType(" GENERAL "));

        // Test ER
        assertEquals("ER", invokeNormalizeDiagramType("ER"));
        assertEquals("ER", invokeNormalizeDiagramType("er"));
        assertEquals("ER", invokeNormalizeDiagramType("Er"));
        assertEquals("ER", invokeNormalizeDiagramType(" er "));

        // Test SEQUENCE
        assertEquals("Sequence", invokeNormalizeDiagramType("SEQUENCE"));
        assertEquals("Sequence", invokeNormalizeDiagramType("sequence"));
        assertEquals("Sequence", invokeNormalizeDiagramType("Sequence"));

        // Test ACTIVITY
        assertEquals("Activity", invokeNormalizeDiagramType("ACTIVITY"));
        assertEquals("Activity", invokeNormalizeDiagramType("activity"));
        assertEquals("Activity", invokeNormalizeDiagramType("Activity"));

        // Test STATE
        assertEquals("State", invokeNormalizeDiagramType("STATE"));
        assertEquals("State", invokeNormalizeDiagramType("state"));
        assertEquals("State", invokeNormalizeDiagramType("State"));
    }

    // ============================================================================
    // Spec 2026-04-03: USER_JOURNEY normalization tests (Task Group 1)
    // ============================================================================

    /**
     * Test: normalizeDiagramType("USER_JOURNEY") returns "USER_JOURNEY" (exact canonical value)
     *
     * Verifies that the explicit USER_JOURNEY case returns the canonical value.
     */
    @Test
    @DisplayName("normalizeDiagramType(\"USER_JOURNEY\") returns \"USER_JOURNEY\" (exact canonical value)")
    void testNormalizeDiagramTypeUserJourney() throws Exception {
        String result = invokeNormalizeDiagramType("USER_JOURNEY");
        assertEquals("USER_JOURNEY", result, "USER_JOURNEY should normalize to USER_JOURNEY");
    }

    /**
     * Test: normalizeDiagramType("user_journey") returns "USER_JOURNEY" (case-insensitive handling)
     *
     * Verifies that lowercase user_journey is normalized to canonical USER_JOURNEY
     * via the explicit case in the switch statement (upper-cased input matches "USER_JOURNEY" case).
     */
    @Test
    @DisplayName("normalizeDiagramType(\"user_journey\") returns \"USER_JOURNEY\" (case-insensitive)")
    void testNormalizeDiagramTypeUserJourneyLowercase() throws Exception {
        String result = invokeNormalizeDiagramType("user_journey");
        assertEquals("USER_JOURNEY", result, "user_journey should normalize to USER_JOURNEY");
    }

    /**
     * Integration test: Verify toEntity() normalizes diagram type.
     */
    @Test
    @DisplayName("toEntity() normalizes diagram type")
    void testToEntityNormalizesDiagramType() {
        // Create a DTO with uppercase diagram type
        DiagramDto dto = new DiagramDto(
                "diagram-1",
                "Test Diagram",
                "Description",
                "SEQUENCE",  // Uppercase - should be normalized
                null,
                null,
                Collections.emptyList(),
                Collections.emptyList(),
                Collections.emptyList(),
                Collections.emptyList(),
                null
        );

        // Convert to entity
        DiagramEntity entity = diagramMapper.toEntity(dto, "model-file-1");

        // Verify diagram type is normalized
        assertEquals("Sequence", entity.getDiagramType(),
                "Entity diagram type should be normalized from SEQUENCE to Sequence");
    }

    /**
     * Integration test: Verify toDto() normalizes diagram type (defensive for legacy DB values).
     */
    @Test
    @DisplayName("toDto() normalizes diagram type (defensive for legacy DB values)")
    void testToDtoNormalizesDiagramType() {
        // Create an entity with lowercase diagram type (simulating legacy DB value)
        DiagramEntity entity = DiagramEntity.builder()
                .id("diagram-1")
                .modelFileId("model-file-1")
                .name("Test Diagram")
                .description("Description")
                .diagramType("sequence")  // Lowercase - simulates legacy DB value
                .build();

        // Convert to DTO
        DiagramDto dto = diagramMapper.toDto(
                entity,
                Collections.emptyList(),
                Collections.emptyList(),
                Collections.emptyList(),
                Collections.emptyList()
        );

        // Verify diagram type is normalized
        assertEquals("Sequence", dto.diagramType(),
                "DTO diagram type should be normalized from sequence to Sequence");
    }
}
