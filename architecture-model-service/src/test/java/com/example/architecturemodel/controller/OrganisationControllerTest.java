package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.OrganisationDto;
import com.example.architecturemodel.model.dto.OrganisationListItemDto;
import com.example.architecturemodel.service.OrganisationService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Collections;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Tests for OrganisationController.
 *
 * Spec 2026-01-18: Organisations Iteration 1 - Add Organisation Model + Project FK + APIs
 * Task Group 3: API Layer - Organisation Controller and Project Integration
 */
@WebMvcTest(OrganisationController.class)
class OrganisationControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private OrganisationService organisationService;

    private String testOrgId;
    private OrganisationDto testOrganisation;
    private OrganisationListItemDto testListItem;

    @BeforeEach
    void setUp() {
        testOrgId = "org-" + UUID.randomUUID();
        testOrganisation = new OrganisationDto(
            testOrgId, "Test Organisation", "Test description",
            null, null, null, null, null, null, null
        );
        testListItem = new OrganisationListItemDto(testOrgId, "Test Organisation");
    }

    @Nested
    @DisplayName("GET /api/v1/organisations")
    class ListOrganisationsTests {

        @Test
        @DisplayName("returns empty array when no organisations")
        void testListOrganisationsReturnsEmptyArray() throws Exception {
            when(organisationService.listOrganisations()).thenReturn(Collections.emptyList());

            mockMvc.perform(get("/api/v1/organisations")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray())
                .andExpect(jsonPath("$.length()").value(0));
        }

        @Test
        @DisplayName("returns ordered list of organisations")
        void testListOrganisationsReturnsOrderedList() throws Exception {
            OrganisationListItemDto org1 = new OrganisationListItemDto("org-" + UUID.randomUUID(), "Alpha Corp");
            OrganisationListItemDto org2 = new OrganisationListItemDto("org-" + UUID.randomUUID(), "Beta Inc");
            when(organisationService.listOrganisations()).thenReturn(List.of(org1, org2));

            mockMvc.perform(get("/api/v1/organisations")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].name").value("Alpha Corp"))
                .andExpect(jsonPath("$[1].name").value("Beta Inc"));
        }
    }

    @Nested
    @DisplayName("GET /api/v1/organisations/by-name/{name}")
    class GetOrganisationByNameTests {

        @Test
        @DisplayName("returns organisation when found")
        void testGetOrganisationByNameReturnsOrganisation() throws Exception {
            when(organisationService.getOrganisationByName("Test Organisation")).thenReturn(testOrganisation);

            mockMvc.perform(get("/api/v1/organisations/by-name/Test Organisation")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(testOrgId))
                .andExpect(jsonPath("$.name").value("Test Organisation"))
                .andExpect(jsonPath("$.description").value("Test description"));
        }

        @Test
        @DisplayName("returns 404 when organisation not found")
        void testGetOrganisationByNameReturns404() throws Exception {
            when(organisationService.getOrganisationByName("Non-Existent"))
                .thenThrow(new ResourceNotFoundException("Organisation not found with name: Non-Existent"));

            mockMvc.perform(get("/api/v1/organisations/by-name/Non-Existent")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound());
        }
    }

    @Nested
    @DisplayName("POST /api/v1/organisations")
    class CreateOrganisationTests {

        @Test
        @DisplayName("creates organisation and returns 201")
        void testCreateOrganisationReturns201() throws Exception {
            when(organisationService.createOrganisation(eq("New Org"), eq("Description"), any(), any(), any(), any(), any(), any()))
                .thenReturn(new OrganisationDto(
                    testOrgId, "New Org", "Description",
                    null, null, null, null, null, null, null
                ));

            String requestBody = """
                {
                    "name": "New Org",
                    "description": "Description"
                }
                """;

            mockMvc.perform(post("/api/v1/organisations")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(testOrgId))
                .andExpect(jsonPath("$.name").value("New Org"))
                .andExpect(jsonPath("$.description").value("Description"));
        }

        @Test
        @DisplayName("returns 400 for blank name")
        void testCreateOrganisationReturns400ForBlankName() throws Exception {
            when(organisationService.createOrganisation(eq(""), any(), any(), any(), any(), any(), any(), any()))
                .thenThrow(new IllegalArgumentException("Organisation name is required"));

            String requestBody = """
                {
                    "name": "",
                    "description": "Description"
                }
                """;

            mockMvc.perform(post("/api/v1/organisations")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Organisation name is required"));
        }

        @Test
        @DisplayName("returns 409 for duplicate name")
        void testCreateOrganisationReturns409ForDuplicateName() throws Exception {
            when(organisationService.createOrganisation(eq("Existing Org"), any(), any(), any(), any(), any(), any(), any()))
                .thenThrow(new ConflictException("Organisation with name 'Existing Org' already exists"));

            String requestBody = """
                {
                    "name": "Existing Org",
                    "description": "Description"
                }
                """;

            mockMvc.perform(post("/api/v1/organisations")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("Organisation with name 'Existing Org' already exists"));
        }

        @Test
        @DisplayName("creates organisation without description")
        void testCreateOrganisationWithoutDescription() throws Exception {
            when(organisationService.createOrganisation(eq("Minimal Org"), isNull(), any(), any(), any(), any(), any(), any()))
                .thenReturn(new OrganisationDto(
                    testOrgId, "Minimal Org", null,
                    null, null, null, null, null, null, null
                ));

            String requestBody = """
                {
                    "name": "Minimal Org"
                }
                """;

            mockMvc.perform(post("/api/v1/organisations")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Minimal Org"))
                .andExpect(jsonPath("$.description").doesNotExist());
        }
    }
}
