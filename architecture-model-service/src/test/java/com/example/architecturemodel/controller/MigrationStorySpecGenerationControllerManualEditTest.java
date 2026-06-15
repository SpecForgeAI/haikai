package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.MigrationStorySpecGenerationDto;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.ManuallyEditedInScopeRow;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.ManuallyEditedSkipRequiredException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc tests for the In-Product Spec Editor + Confirm-Overwrite endpoints
 * on {@link MigrationStorySpecGenerationController}:
 *
 * <ul>
 *   <li>{@code POST /api/projects/{projectId}/spec-generations/{specId}/manual-edit}</li>
 *   <li>{@code GET .../migration-books-of-work/{bookId}/spec-generations/manually-edited-in-scope}</li>
 *   <li>{@code POST /api/projects/{projectId}/spec-generations/{specId}/regenerate}</li>
 * </ul>
 *
 * <p>Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) --
 * Task Group 3.1.</p>
 *
 * <p>Standalone setup mirrors the prior
 * {@link MigrationStorySpecGenerationControllerQualityRecomputeTest} pattern:
 * no full Spring context (AMS has pre-existing compile / wiring issues on
 * this branch), {@link GlobalExceptionHandler} wired by hand so error
 * envelopes follow production mapping. Tests use the default camelCase JSON
 * mapping since {@code MockMvcBuilders.standaloneSetup} does not load the
 * application's SNAKE_CASE configuration.</p>
 */
@ExtendWith(MockitoExtension.class)
class MigrationStorySpecGenerationControllerManualEditTest {

    @Mock
    private MigrationStorySpecGenerationService service;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID BOOK_ID =
        UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID SPEC_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID WORK_ITEM_ID =
        UUID.fromString("44444444-4444-4444-4444-444444444444");

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
            .standaloneSetup(new MigrationStorySpecGenerationController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        objectMapper = new ObjectMapper();
    }

    // -----------------------------------------------------------------------
    // 1) Manual-edit endpoint: persists + returns refreshed DTO; reads X-User-Id
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("manual-edit: persists + returns refreshed DTO; editedBy comes from X-User-Id header")
    void manualEdit_returnsRefreshedDtoFromService() throws Exception {
        MigrationStorySpecGenerationDto returned = sampleManuallyEditedDto();
        when(service.applyManualEdit(
                eq(PROJECT_ID),
                eq(SPEC_ID),
                eq("/agent-os:shape-spec NEW content"),
                eq("alice@example.com")))
            .thenReturn(returned);

        String body = objectMapper.writeValueAsString(java.util.Map.of(
            "specText", "/agent-os:shape-spec NEW content"));

        mockMvc.perform(post(
                "/api/projects/{p}/spec-generations/{s}/manual-edit",
                PROJECT_ID, SPEC_ID)
                .header("X-User-Id", "alice@example.com")
                .contentType(APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            // The DTO record components are annotated with @JsonProperty
            // pinning each wire field to snake_case (e.g. manually_edited).
            .andExpect(jsonPath("$.manually_edited").value(true))
            .andExpect(jsonPath("$.last_manually_edited_by").value("alice@example.com"))
            .andExpect(jsonPath("$.previous_spec_text").value("/agent-os:shape-spec OLD content"));

        verify(service).applyManualEdit(
            eq(PROJECT_ID), eq(SPEC_ID),
            eq("/agent-os:shape-spec NEW content"),
            eq("alice@example.com"));
    }

    // -----------------------------------------------------------------------
    // 2) Manual-edit 404 on wrong project (service raises ResourceNotFoundException)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("manual-edit: returns 404 when service throws ResourceNotFoundException (wrong project / missing spec)")
    void manualEdit_returns404OnResourceNotFound() throws Exception {
        when(service.applyManualEdit(
                eq(PROJECT_ID), eq(SPEC_ID), any(), any()))
            .thenThrow(new ResourceNotFoundException(
                "Spec generation row not in project " + PROJECT_ID + ": " + SPEC_ID));

        String body = objectMapper.writeValueAsString(java.util.Map.of(
            "specText", "/agent-os:shape-spec content"));

        mockMvc.perform(post(
                "/api/projects/{p}/spec-generations/{s}/manual-edit",
                PROJECT_ID, SPEC_ID)
                .header("X-User-Id", "alice@example.com")
                .contentType(APPLICATION_JSON)
                .content(body))
            .andExpect(status().isNotFound());
    }

    // -----------------------------------------------------------------------
    // 3) Pre-flight: returns list shape, scoped to the book
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("manually-edited-in-scope: returns the service's list shape verbatim")
    void manuallyEditedInScope_returnsListShape() throws Exception {
        ManuallyEditedInScopeRow row = new ManuallyEditedInScopeRow(
            SPEC_ID, WORK_ITEM_ID, "Migrate Accounts API",
            "2026-05-20T14:15:00Z", "alice@example.com");
        when(service.listManuallyEditedInScope(
                eq(PROJECT_ID), eq(BOOK_ID), isNull()))
            .thenReturn(List.of(row));

        mockMvc.perform(get(
                "/api/projects/{p}/migration-books-of-work/{b}/spec-generations/manually-edited-in-scope",
                PROJECT_ID, BOOK_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].workItemId").value(WORK_ITEM_ID.toString()))
            .andExpect(jsonPath("$[0].workItemTitle").value("Migrate Accounts API"))
            .andExpect(jsonPath("$[0].lastManuallyEditedBy").value("alice@example.com"))
            .andExpect(jsonPath("$[0].lastManuallyEditedAt").value("2026-05-20T14:15:00Z"));
    }

    // -----------------------------------------------------------------------
    // 4) Single-story regenerate without flag on manually_edited row -> 409
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("regenerate without overwriteManuallyEdited on a manually-edited row -> 409 + structured envelope")
    void regenerate_noFlag_manuallyEditedRow_returns409Envelope() throws Exception {
        when(service.regenerateSingleStory(
                eq(PROJECT_ID), eq(SPEC_ID), any(), eq(false)))
            .thenThrow(new ManuallyEditedSkipRequiredException(
                SPEC_ID, "alice@example.com", "2026-05-20T14:15:00Z"));

        mockMvc.perform(post(
                "/api/projects/{p}/spec-generations/{s}/regenerate",
                PROJECT_ID, SPEC_ID)
                .contentType(APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("manually_edited_skip_required"))
            .andExpect(jsonPath("$.specId").value(SPEC_ID.toString()))
            .andExpect(jsonPath("$.lastManuallyEditedBy").value("alice@example.com"))
            .andExpect(jsonPath("$.lastManuallyEditedAt").value("2026-05-20T14:15:00Z"));
    }

    // -----------------------------------------------------------------------
    // 5) Single-story regenerate WITH flag -> succeeds + clears manually_edited
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("regenerate with overwriteManuallyEdited=true -> 200 + DTO with manuallyEdited cleared to false")
    void regenerate_withFlag_succeedsAndClearsManuallyEdited() throws Exception {
        MigrationStorySpecGenerationDto returned = clearedDtoAfterOverwrite();
        when(service.regenerateSingleStory(
                eq(PROJECT_ID), eq(SPEC_ID), any(), eq(true)))
            .thenReturn(returned);

        mockMvc.perform(post(
                "/api/projects/{p}/spec-generations/{s}/regenerate",
                PROJECT_ID, SPEC_ID)
                .param("overwriteManuallyEdited", "true")
                .contentType(APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.manually_edited").value(false));

        verify(service).regenerateSingleStory(
            eq(PROJECT_ID), eq(SPEC_ID), any(), eq(true));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private MigrationStorySpecGenerationDto sampleManuallyEditedDto() {
        // Canonical 23-arg constructor so the four manual-edit fields appear
        // on the serialised response.
        return new MigrationStorySpecGenerationDto(
            SPEC_ID, PROJECT_ID, WORK_ITEM_ID, BOOK_ID, "bi-1",
            "generated", "high", null,
            "/agent-os:shape-spec NEW content",
            null, null, null, null,
            "2026-05-20T14:15:00Z", null,
            2, "product-manager--migration-shape-spec-generation",
            "2026-05-19T10:00:00Z", "2026-05-20T14:15:00Z",
            // 4 manual-edit fields
            Boolean.TRUE,
            "2026-05-20T14:15:00Z",
            "alice@example.com",
            "/agent-os:shape-spec OLD content",
            // 2 implementation-ready fields (unused by this test)
            null, null
        );
    }

    /**
     * The post-overwrite DTO: manually_edited cleared, audit fields nulled,
     * previousSpecText nulled (per the spec contract).
     */
    private MigrationStorySpecGenerationDto clearedDtoAfterOverwrite() {
        return new MigrationStorySpecGenerationDto(
            SPEC_ID, PROJECT_ID, WORK_ITEM_ID, BOOK_ID, "bi-1",
            "generated", "high", null,
            "/agent-os:shape-spec REGEN content",
            null, null, null, null,
            "2026-05-20T15:00:00Z", null,
            3, "product-manager--migration-shape-spec-generation",
            "2026-05-19T10:00:00Z", "2026-05-20T15:00:00Z",
            // 4 manual-edit fields all reset
            Boolean.FALSE, null, null, null,
            // 2 implementation-ready fields (unused by this test)
            null, null
        );
    }
}
