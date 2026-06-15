package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.OrganisationDto;
import com.example.architecturemodel.service.OrganisationService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Tests for OrganisationController PATCH endpoint.
 *
 * Spec 2026-01-31: Trigger Global Standards Generation
 * Task Group 1: Backend PATCH Endpoint for Flag Update
 */
@WebMvcTest(OrganisationController.class)
class OrganisationPatchEndpointTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private OrganisationService organisationService;

    @Nested
    @DisplayName("PATCH /api/v1/organisations/{id}")
    class PatchOrganisationTests {

        @Test
        @DisplayName("successfully updates techStandardsGenerated to true")
        void testPatchTechStandardsGeneratedTrue() throws Exception {
            String orgId = "org-" + UUID.randomUUID().toString();
            OrganisationDto updatedOrg = new OrganisationDto(
                orgId, "Test Org", "Description",
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
                true // techStandardsGenerated set to true
            );

            when(organisationService.updateOrganisation(eq(orgId), eq(true)))
                .thenReturn(updatedOrg);

            String requestBody = """
                {
                    "tech_standards_generated": true
                }
                """;

            mockMvc.perform(patch("/api/v1/organisations/{id}", orgId)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(orgId))
                .andExpect(jsonPath("$.tech_standards_generated").value(true));

            verify(organisationService).updateOrganisation(orgId, true);
        }

        @Test
        @DisplayName("returns 404 when organisation ID not found")
        void testPatchOrganisationNotFound() throws Exception {
            String nonExistentId = "org-nonexistent";

            when(organisationService.updateOrganisation(eq(nonExistentId), eq(true)))
                .thenThrow(new ResourceNotFoundException("Organisation not found with id: " + nonExistentId));

            String requestBody = """
                {
                    "tech_standards_generated": true
                }
                """;

            mockMvc.perform(patch("/api/v1/organisations/{id}", nonExistentId)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
                .andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("preserves other fields when updating only techStandardsGenerated")
        void testPatchPreservesOtherFields() throws Exception {
            String orgId = "org-" + UUID.randomUUID().toString();
            // Organisation has existing data that should be preserved
            OrganisationDto updatedOrg = new OrganisationDto(
                orgId, "Existing Org", "Existing Description",
                List.of("doc1.md"), // existing docs
                List.of("tech.md"),
                List.of("style.md"),
                List.of("conventions.md"),
                List.of("errors.md"),
                List.of("validation.md"),
                true // only this changed
            );

            when(organisationService.updateOrganisation(eq(orgId), eq(true)))
                .thenReturn(updatedOrg);

            String requestBody = """
                {
                    "tech_standards_generated": true
                }
                """;

            mockMvc.perform(patch("/api/v1/organisations/{id}", orgId)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(orgId))
                .andExpect(jsonPath("$.name").value("Existing Org"))
                .andExpect(jsonPath("$.description").value("Existing Description"))
                .andExpect(jsonPath("$.docs_applied_to_all_sources[0]").value("doc1.md"))
                .andExpect(jsonPath("$.tech_standards_generated").value(true));
        }

        @Test
        @DisplayName("accepts camelCase field name in request body")
        void testPatchAcceptsCamelCaseFieldName() throws Exception {
            String orgId = "org-" + UUID.randomUUID().toString();
            OrganisationDto updatedOrg = new OrganisationDto(
                orgId, "Test Org", null,
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
                true
            );

            when(organisationService.updateOrganisation(eq(orgId), eq(true)))
                .thenReturn(updatedOrg);

            // camelCase field name
            String requestBody = """
                {
                    "techStandardsGenerated": true
                }
                """;

            mockMvc.perform(patch("/api/v1/organisations/{id}", orgId)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tech_standards_generated").value(true));

            verify(organisationService).updateOrganisation(orgId, true);
        }
    }
}
