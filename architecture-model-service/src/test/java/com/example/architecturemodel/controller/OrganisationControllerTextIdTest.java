package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.OrganisationDto;
import com.example.architecturemodel.model.dto.OrganisationListItemDto;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.service.OrganisationService;
import com.example.architecturemodel.service.ProjectService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Tests for controller layer with String ID types.
 *
 * Validates that:
 * - Organisation creation returns response with String id
 * - Project creation with String organisationId succeeds
 * - Listing organisations returns String IDs in response
 *
 * Spec: Organisation ID Type Change (UUID to TEXT)
 * Spec 2026-01-31: Organisation Model + DB + API DTOs - Updated for new DTO fields
 * Task Group 5: Controller Updates
 */
@WebMvcTest(OrganisationController.class)
class OrganisationControllerTextIdTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private OrganisationService organisationService;

    @Test
    @DisplayName("Organisation creation returns response with String id")
    void testOrganisationCreationReturnsStringId() throws Exception {
        // Given: Service returns organisation with String ID
        String orgId = "org-" + UUID.randomUUID().toString();
        OrganisationDto createdOrg = new OrganisationDto(
            orgId, "Test Org", "Description",
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
            false
        );
        when(organisationService.createOrganisation(eq("Test Org"), eq("Description"), any(), any(), any(), any(), any(), any()))
            .thenReturn(createdOrg);

        // When/Then: POST returns organisation with String ID
        mockMvc.perform(post("/api/v1/organisations")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Test Org\",\"description\":\"Description\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(orgId))
            .andExpect(jsonPath("$.id").value(org.hamcrest.Matchers.startsWith("org-")))
            .andExpect(jsonPath("$.name").value("Test Org"));
    }

    @Test
    @DisplayName("Listing organisations returns String IDs in response")
    void testListOrganisationsReturnsStringIds() throws Exception {
        // Given: Service returns list with String IDs
        String orgId1 = "org-" + UUID.randomUUID().toString();
        String orgId2 = "org-" + UUID.randomUUID().toString();
        List<OrganisationListItemDto> organisations = List.of(
            new OrganisationListItemDto(orgId1, "Alpha Org"),
            new OrganisationListItemDto(orgId2, "Beta Org")
        );
        when(organisationService.listOrganisations()).thenReturn(organisations);

        // When/Then: GET returns list with String IDs
        mockMvc.perform(get("/api/v1/organisations"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].id").value(orgId1))
            .andExpect(jsonPath("$[0].id").value(org.hamcrest.Matchers.startsWith("org-")))
            .andExpect(jsonPath("$[1].id").value(orgId2))
            .andExpect(jsonPath("$[1].id").value(org.hamcrest.Matchers.startsWith("org-")));
    }

    @Test
    @DisplayName("Get organisation by name returns String ID")
    void testGetOrganisationByNameReturnsStringId() throws Exception {
        // Given: Service returns organisation with String ID
        String orgId = "org-" + UUID.randomUUID().toString();
        OrganisationDto orgDto = new OrganisationDto(
            orgId, "Test Org", "Description",
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
            false
        );
        when(organisationService.getOrganisationByName("Test Org")).thenReturn(orgDto);

        // When/Then: GET returns organisation with String ID
        mockMvc.perform(get("/api/v1/organisations/by-name/Test Org"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(orgId))
            .andExpect(jsonPath("$.id").value(org.hamcrest.Matchers.startsWith("org-")));
    }
}
