package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.oas.SaveOasSpecRequestDto;
import com.example.architecturemodel.model.dto.oas.SaveOasSpecSummaryDto;
import com.example.architecturemodel.service.OasSpecService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for OasSpecController.
 * Tests endpoint behavior, validation, and response codes.
 */
@WebMvcTest(OasSpecController.class)
class OasSpecControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private OasSpecService oasSpecService;

    private ObjectMapper objectMapper;

    private static final String VALID_YAML = """
            openapi: 3.0.3
            info:
              title: Test API
              version: 1.0.0
            paths: {}
            """;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
    }

    /**
     * Test 1: PUT endpoint with valid request returns 201 (new file)
     */
    @Test
    void testPutEndpointReturns201ForNewFile() throws Exception {
        String interfaceId = "ifc-001";
        String filename = "my-architecture.json";

        SaveOasSpecSummaryDto summary = new SaveOasSpecSummaryDto(
                interfaceId,
                "Customer API",
                filename,
                "yaml",
                "/data/oas-specs/my-architecture/Customer-API.yml",
                "/data/oas-specs/my-architecture/Customer-API.yml",
                Instant.now(),
                true  // created=true
        );

        when(oasSpecService.saveOasSpec(eq(interfaceId), eq(filename), any(SaveOasSpecRequestDto.class)))
                .thenReturn(summary);

        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto("yaml", VALID_YAML, "Test API", "1.0.0");

        mockMvc.perform(put("/api/model/interfaces/{id}/oas", interfaceId)
                        .param("filename", filename)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.interfaceId").value(interfaceId))
                .andExpect(jsonPath("$.interfaceName").value("Customer API"))
                .andExpect(jsonPath("$.format").value("yaml"))
                .andExpect(jsonPath("$.created").value(true));
    }

    /**
     * Test 2: PUT endpoint with valid request returns 200 (overwrite)
     */
    @Test
    void testPutEndpointReturns200ForOverwrite() throws Exception {
        String interfaceId = "ifc-002";
        String filename = "existing-model.json";

        SaveOasSpecSummaryDto summary = new SaveOasSpecSummaryDto(
                interfaceId,
                "Existing API",
                filename,
                "json",
                "/data/oas-specs/existing-model/Existing-API.json",
                "/data/oas-specs/existing-model/Existing-API.json",
                Instant.now(),
                false  // created=false (overwrite)
        );

        when(oasSpecService.saveOasSpec(eq(interfaceId), eq(filename), any(SaveOasSpecRequestDto.class)))
                .thenReturn(summary);

        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto("json", "{}", null, null);

        mockMvc.perform(put("/api/model/interfaces/{id}/oas", interfaceId)
                        .param("filename", filename)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.interfaceId").value(interfaceId))
                .andExpect(jsonPath("$.created").value(false));
    }

    /**
     * Test 3: Missing filename query param returns 400
     */
    @Test
    void testMissingFilenameQueryParamReturns400() throws Exception {
        String interfaceId = "ifc-003";

        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto("yaml", VALID_YAML, null, null);

        mockMvc.perform(put("/api/model/interfaces/{id}/oas", interfaceId)
                        // No filename param
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    /**
     * Test 4: Missing format in body returns 400
     */
    @Test
    void testMissingFormatInBodyReturns400() throws Exception {
        String interfaceId = "ifc-004";
        String filename = "test-model.json";

        when(oasSpecService.saveOasSpec(eq(interfaceId), eq(filename), any(SaveOasSpecRequestDto.class)))
                .thenThrow(new IllegalArgumentException("Format is required"));

        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto(null, VALID_YAML, null, null);

        mockMvc.perform(put("/api/model/interfaces/{id}/oas", interfaceId)
                        .param("filename", filename)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Format is required"));
    }

    /**
     * Test 5: Missing contents in body returns 400
     */
    @Test
    void testMissingContentsInBodyReturns400() throws Exception {
        String interfaceId = "ifc-005";
        String filename = "test-model.json";

        when(oasSpecService.saveOasSpec(eq(interfaceId), eq(filename), any(SaveOasSpecRequestDto.class)))
                .thenThrow(new IllegalArgumentException("Contents is required"));

        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto("yaml", null, null, null);

        mockMvc.perform(put("/api/model/interfaces/{id}/oas", interfaceId)
                        .param("filename", filename)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Contents is required"));
    }

    /**
     * Test: Interface not found returns 404
     */
    @Test
    void testInterfaceNotFoundReturns404() throws Exception {
        String interfaceId = "nonexistent-ifc";
        String filename = "test-model.json";

        when(oasSpecService.saveOasSpec(eq(interfaceId), eq(filename), any(SaveOasSpecRequestDto.class)))
                .thenThrow(new ResourceNotFoundException("Interface not found: " + interfaceId));

        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto("yaml", VALID_YAML, null, null);

        mockMvc.perform(put("/api/model/interfaces/{id}/oas", interfaceId)
                        .param("filename", filename)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Interface not found: " + interfaceId));
    }

    /**
     * Test: Invalid format returns 400
     */
    @Test
    void testInvalidFormatReturns400() throws Exception {
        String interfaceId = "ifc-007";
        String filename = "test-model.json";

        when(oasSpecService.saveOasSpec(eq(interfaceId), eq(filename), any(SaveOasSpecRequestDto.class)))
                .thenThrow(new IllegalArgumentException("Format must be 'yaml' or 'json'"));

        SaveOasSpecRequestDto request = new SaveOasSpecRequestDto("xml", VALID_YAML, null, null);

        mockMvc.perform(put("/api/model/interfaces/{id}/oas", interfaceId)
                        .param("filename", filename)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Format must be 'yaml' or 'json'"));
    }
}
