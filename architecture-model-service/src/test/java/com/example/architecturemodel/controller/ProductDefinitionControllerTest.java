package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.ProductDefinitionDto;
import com.example.architecturemodel.service.ProductDefinitionService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Tests for ProductDefinitionController.
 *
 * Note: The application uses a global Jackson SNAKE_CASE naming strategy
 * (configured in application.yml), so all JSON field names in responses
 * are snake_case (e.g. project_id, product_name, created_at, updated_at).
 *
 * Spec: Increment 1 -- Add Product Tab + Minimal ProductDefinition (UI + DB only)
 * Task Group 1: Database Migration, Entity, Repository, Service, Controller, DTO, Mapper
 */
@WebMvcTest(ProductDefinitionController.class)
class ProductDefinitionControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private ProductDefinitionService productDefinitionService;

    private UUID testProjectId;
    private UUID testDefinitionId;
    private Instant testCreatedAt;
    private Instant testUpdatedAt;
    private ProductDefinitionDto testDto;

    @BeforeEach
    void setUp() {
        testProjectId = UUID.randomUUID();
        testDefinitionId = UUID.randomUUID();
        testCreatedAt = Instant.parse("2026-02-12T10:00:00Z");
        testUpdatedAt = Instant.parse("2026-02-12T10:00:00Z");
        testDto = new ProductDefinitionDto(
            testDefinitionId,
            testProjectId,
            "My Product",
            testCreatedAt,
            testUpdatedAt
        );
    }

    /**
     * Test 1: GET /api/projects/{projectId}/product returns 404 when no definition exists.
     */
    @Test
    @DisplayName("GET returns 404 when no product definition exists for project")
    void testGetReturns404WhenNoDefinitionExists() throws Exception {
        when(productDefinitionService.getByProjectId(any(UUID.class)))
            .thenReturn(Optional.empty());

        mockMvc.perform(get("/api/projects/{projectId}/product", testProjectId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound());
    }

    /**
     * Test 2: PUT /api/projects/{projectId}/product creates a new definition and returns 200 with DTO.
     */
    @Test
    @DisplayName("PUT creates a new product definition and returns 200 with DTO")
    void testPutCreatesNewDefinitionAndReturns200() throws Exception {
        when(productDefinitionService.upsert(any(UUID.class), anyString()))
            .thenReturn(testDto);

        String requestBody = objectMapper.writeValueAsString(
            new ProductDefinitionController.SaveProductDefinitionRequest("My Product")
        );

        mockMvc.perform(put("/api/projects/{projectId}/product", testProjectId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(testDefinitionId.toString()))
            .andExpect(jsonPath("$.project_id").value(testProjectId.toString()))
            .andExpect(jsonPath("$.product_name").value("My Product"))
            .andExpect(jsonPath("$.created_at").exists())
            .andExpect(jsonPath("$.updated_at").exists());
    }

    /**
     * Test 3: PUT upsert updates existing definition when one already exists for the project.
     */
    @Test
    @DisplayName("PUT upsert updates existing definition and returns 200 with updated DTO")
    void testPutUpdatesExistingDefinition() throws Exception {
        Instant updatedTime = Instant.parse("2026-02-12T12:00:00Z");
        ProductDefinitionDto updatedDto = new ProductDefinitionDto(
            testDefinitionId,
            testProjectId,
            "Updated Product Name",
            testCreatedAt,
            updatedTime
        );

        when(productDefinitionService.upsert(any(UUID.class), anyString()))
            .thenReturn(updatedDto);

        String requestBody = objectMapper.writeValueAsString(
            new ProductDefinitionController.SaveProductDefinitionRequest("Updated Product Name")
        );

        mockMvc.perform(put("/api/projects/{projectId}/product", testProjectId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(testDefinitionId.toString()))
            .andExpect(jsonPath("$.product_name").value("Updated Product Name"))
            .andExpect(jsonPath("$.updated_at").exists());
    }

    /**
     * Test 4: PUT with blank productName returns 400 Bad Request.
     */
    @Test
    @DisplayName("PUT with blank productName returns 400 Bad Request")
    void testPutWithBlankProductNameReturns400() throws Exception {
        when(productDefinitionService.upsert(any(UUID.class), anyString()))
            .thenThrow(new IllegalArgumentException("Product name is required"));

        String requestBody = objectMapper.writeValueAsString(
            new ProductDefinitionController.SaveProductDefinitionRequest("")
        );

        mockMvc.perform(put("/api/projects/{projectId}/product", testProjectId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("Product name is required"));
    }
}
