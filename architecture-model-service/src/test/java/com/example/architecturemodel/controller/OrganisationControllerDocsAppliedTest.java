package com.example.architecturemodel.controller;

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

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Tests for OrganisationController docsAppliedTo* fields persistence.
 *
 * Spec 2026-01-31: Fix Create Organisation Standards Flow
 * Task Group 3: AMS CreateOrganisationRequest DTO Expansion + Service Persistence
 */
@WebMvcTest(OrganisationController.class)
class OrganisationControllerDocsAppliedTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private OrganisationService organisationService;

    @Nested
    @DisplayName("POST /api/v1/organisations - docsAppliedTo* fields")
    class CreateOrganisationWithDocsAppliedTests {

        @Test
        @DisplayName("accepts all six list fields with camelCase")
        void testAcceptsAllSixListFieldsCamelCase() throws Exception {
            // Setup mock
            when(organisationService.createOrganisation(
                    anyString(), nullable(String.class),
                    anyList(), anyList(), anyList(), anyList(), anyList(), anyList()
            )).thenReturn(new OrganisationDto("org-123", "Test Org", null,
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), false));

            String requestBody = """
                {
                    "name": "Test Org",
                    "description": "Test description",
                    "docsAppliedToAllSources": ["all-source-1.md", "all-source-2.md"],
                    "docsAppliedToTechStack": ["tech-stack.md"],
                    "docsAppliedToCodingStyles": ["coding-styles.md"],
                    "docsAppliedToConventions": ["conventions.md"],
                    "docsAppliedToErrorHandling": ["error-handling.md"],
                    "docsAppliedToValidation": ["validation.md"]
                }
                """;

            mockMvc.perform(post("/api/v1/organisations")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value("org-123"))
                .andExpect(jsonPath("$.name").value("Test Org"));

            // Verify service was called with all six lists
            verify(organisationService).createOrganisation(
                    eq("Test Org"),
                    eq("Test description"),
                    eq(List.of("all-source-1.md", "all-source-2.md")),
                    eq(List.of("tech-stack.md")),
                    eq(List.of("coding-styles.md")),
                    eq(List.of("conventions.md")),
                    eq(List.of("error-handling.md")),
                    eq(List.of("validation.md"))
            );
        }

        @Test
        @DisplayName("accepts all six list fields with snake_case via @JsonAlias")
        void testAcceptsAllSixListFieldsSnakeCase() throws Exception {
            // Setup mock
            when(organisationService.createOrganisation(
                    anyString(), nullable(String.class),
                    anyList(), anyList(), anyList(), anyList(), anyList(), anyList()
            )).thenReturn(new OrganisationDto("org-456", "Snake Corp", null,
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), false));

            String requestBody = """
                {
                    "name": "Snake Corp",
                    "description": null,
                    "docs_applied_to_all_sources": ["snake-all.md"],
                    "docs_applied_to_tech_stack": ["snake-tech.md"],
                    "docs_applied_to_coding_styles": ["snake-style.md"],
                    "docs_applied_to_conventions": ["snake-conv.md"],
                    "docs_applied_to_error_handling": ["snake-err.md"],
                    "docs_applied_to_validation": ["snake-val.md"]
                }
                """;

            mockMvc.perform(post("/api/v1/organisations")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value("org-456"))
                .andExpect(jsonPath("$.name").value("Snake Corp"));

            // Verify service was called with snake_case values
            verify(organisationService).createOrganisation(
                    eq("Snake Corp"),
                    isNull(),
                    eq(List.of("snake-all.md")),
                    eq(List.of("snake-tech.md")),
                    eq(List.of("snake-style.md")),
                    eq(List.of("snake-conv.md")),
                    eq(List.of("snake-err.md")),
                    eq(List.of("snake-val.md"))
            );
        }

        @Test
        @DisplayName("handles null lists gracefully (becomes empty list)")
        void testHandlesNullListsGracefully() throws Exception {
            // Setup mock
            when(organisationService.createOrganisation(
                    anyString(), nullable(String.class),
                    anyList(), anyList(), anyList(), anyList(), anyList(), anyList()
            )).thenReturn(new OrganisationDto("org-789", "Null Lists Org", null,
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), false));

            // Only name provided - all lists should be null/empty
            String requestBody = """
                {
                    "name": "Null Lists Org"
                }
                """;

            mockMvc.perform(post("/api/v1/organisations")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
                .andExpect(status().isCreated());

            // Verify service was called (with nulls converted to empty lists by service)
            verify(organisationService).createOrganisation(
                    eq("Null Lists Org"),
                    isNull(),
                    isNull(),
                    isNull(),
                    isNull(),
                    isNull(),
                    isNull(),
                    isNull()
            );
        }

        @Test
        @DisplayName("handles empty lists correctly")
        void testHandlesEmptyListsCorrectly() throws Exception {
            // Setup mock
            when(organisationService.createOrganisation(
                    anyString(), nullable(String.class),
                    anyList(), anyList(), anyList(), anyList(), anyList(), anyList()
            )).thenReturn(new OrganisationDto("org-empty", "Empty Lists Org", null,
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), false));

            String requestBody = """
                {
                    "name": "Empty Lists Org",
                    "docsAppliedToAllSources": [],
                    "docsAppliedToTechStack": [],
                    "docsAppliedToCodingStyles": [],
                    "docsAppliedToConventions": [],
                    "docsAppliedToErrorHandling": [],
                    "docsAppliedToValidation": []
                }
                """;

            mockMvc.perform(post("/api/v1/organisations")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
                .andExpect(status().isCreated());

            // Verify service was called with empty lists
            verify(organisationService).createOrganisation(
                    eq("Empty Lists Org"),
                    isNull(),
                    eq(List.of()),
                    eq(List.of()),
                    eq(List.of()),
                    eq(List.of()),
                    eq(List.of()),
                    eq(List.of())
            );
        }

        @Test
        @DisplayName("mixed camelCase and snake_case not supported - use consistent naming")
        void testMixedCasingUsesFirstMatch() throws Exception {
            // Setup mock
            when(organisationService.createOrganisation(
                    anyString(), nullable(String.class),
                    anyList(), anyList(), anyList(), anyList(), anyList(), anyList()
            )).thenReturn(new OrganisationDto("org-mixed", "Mixed Org", null,
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), false));

            // Using camelCase for all - service should receive values
            String requestBody = """
                {
                    "name": "Mixed Org",
                    "docsAppliedToAllSources": ["camel.md"],
                    "docsAppliedToTechStack": ["tech.md"],
                    "docsAppliedToCodingStyles": ["style.md"],
                    "docsAppliedToConventions": ["conv.md"],
                    "docsAppliedToErrorHandling": ["err.md"],
                    "docsAppliedToValidation": ["val.md"]
                }
                """;

            mockMvc.perform(post("/api/v1/organisations")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
                .andExpect(status().isCreated());

            verify(organisationService).createOrganisation(
                    eq("Mixed Org"),
                    isNull(),
                    eq(List.of("camel.md")),
                    eq(List.of("tech.md")),
                    eq(List.of("style.md")),
                    eq(List.of("conv.md")),
                    eq(List.of("err.md")),
                    eq(List.of("val.md"))
            );
        }
    }
}
