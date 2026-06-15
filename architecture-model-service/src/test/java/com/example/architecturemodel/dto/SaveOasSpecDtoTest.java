package com.example.architecturemodel.dto;

import com.example.architecturemodel.model.dto.oas.SaveOasSpecRequestDto;
import com.example.architecturemodel.model.dto.oas.SaveOasSpecSummaryDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for SaveOasSpec DTOs - verifies record instantiation,
 * JSON serialization, and field access.
 */
class SaveOasSpecDtoTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
    }

    /**
     * Test 1: SaveOasSpecRequestDto record instantiation and field access
     */
    @Test
    void testSaveOasSpecRequestDtoInstantiationAndFieldAccess() {
        SaveOasSpecRequestDto dto = new SaveOasSpecRequestDto(
            "yaml",
            "openapi: 3.0.3\ninfo:\n  title: Test API\n  version: 1.0.0",
            "Test API",
            "1.0.0"
        );

        assertEquals("yaml", dto.format());
        assertTrue(dto.contents().contains("openapi: 3.0.3"));
        assertEquals("Test API", dto.title());
        assertEquals("1.0.0", dto.version());
    }

    /**
     * Test 2: SaveOasSpecRequestDto JSON serialization/deserialization
     */
    @Test
    void testSaveOasSpecRequestDtoJsonSerialization() throws Exception {
        SaveOasSpecRequestDto dto = new SaveOasSpecRequestDto(
            "json",
            "{\"openapi\":\"3.0.3\"}",
            null,
            null
        );

        String json = objectMapper.writeValueAsString(dto);

        // Verify field names in JSON
        assertTrue(json.contains("\"format\":\"json\""));
        assertTrue(json.contains("\"contents\":\"{\\\"openapi\\\":\\\"3.0.3\\\"}\""));
        assertTrue(json.contains("\"title\":null"));
        assertTrue(json.contains("\"version\":null"));

        // Round-trip deserialization
        SaveOasSpecRequestDto deserialized = objectMapper.readValue(json, SaveOasSpecRequestDto.class);
        assertEquals(dto.format(), deserialized.format());
        assertEquals(dto.contents(), deserialized.contents());
        assertNull(deserialized.title());
        assertNull(deserialized.version());
    }

    /**
     * Test 3: SaveOasSpecSummaryDto record instantiation with all fields
     */
    @Test
    void testSaveOasSpecSummaryDtoInstantiationWithAllFields() {
        Instant now = Instant.now();
        SaveOasSpecSummaryDto dto = new SaveOasSpecSummaryDto(
            "ifc-001",
            "Customer API",
            "my-architecture.json",
            "yaml",
            "/data/oas-specs/my-architecture/Customer-API.yml",
            "/data/oas-specs/my-architecture/Customer-API.yml",
            now,
            true
        );

        assertEquals("ifc-001", dto.interfaceId());
        assertEquals("Customer API", dto.interfaceName());
        assertEquals("my-architecture.json", dto.architectureFilename());
        assertEquals("yaml", dto.format());
        assertEquals("/data/oas-specs/my-architecture/Customer-API.yml", dto.savedPath());
        assertEquals("/data/oas-specs/my-architecture/Customer-API.yml", dto.specLink());
        assertEquals(now, dto.updatedAt());
        assertTrue(dto.created());
    }

    /**
     * Test 4: SaveOasSpecSummaryDto JSON serialization with created=false
     */
    @Test
    void testSaveOasSpecSummaryDtoJsonSerializationOverwrite() throws Exception {
        Instant now = Instant.parse("2024-01-15T10:30:00Z");
        SaveOasSpecSummaryDto dto = new SaveOasSpecSummaryDto(
            "ifc-002",
            "Order API",
            "order-model.json",
            "json",
            "C:\\data\\oas-specs\\order-model\\Order-API.json",
            "C:\\data\\oas-specs\\order-model\\Order-API.json",
            now,
            false  // overwrite scenario
        );

        String json = objectMapper.writeValueAsString(dto);

        // Verify field names and values
        assertTrue(json.contains("\"interfaceId\":\"ifc-002\""));
        assertTrue(json.contains("\"interfaceName\":\"Order API\""));
        assertTrue(json.contains("\"architectureFilename\":\"order-model.json\""));
        assertTrue(json.contains("\"format\":\"json\""));
        assertTrue(json.contains("\"created\":false"));

        // Round-trip deserialization
        SaveOasSpecSummaryDto deserialized = objectMapper.readValue(json, SaveOasSpecSummaryDto.class);
        assertEquals(dto.interfaceId(), deserialized.interfaceId());
        assertEquals(dto.interfaceName(), deserialized.interfaceName());
        assertEquals(dto.format(), deserialized.format());
        assertFalse(deserialized.created());
    }
}
