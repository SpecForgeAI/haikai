package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.exception.ArchivedArchitectureSourceException;
import com.example.architecturemodel.exception.DuplicateArchitectureNameException;
import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.model.dto.ArchitectureDto;
import com.example.architecturemodel.service.ArchitectureCloneService;
import com.example.architecturemodel.service.ArchitectureService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Focused tests for the new Architecture Clone endpoint introduced in Spec #6.
 *
 * Spec: Multi-Architecture Full Clone (Spec #6) -- Task Group 2.
 *
 * Required tests covered:
 *   1. {@link #cloneArchitecture_happyPath_returns201()}
 *      -- happy path: POST with a valid body returns 201 + the new
 *         architecture DTO.
 *   2. {@link #cloneArchitecture_archivedSource_returns422()}
 *      -- safety property (d): when the service throws
 *         {@link ArchivedArchitectureSourceException} the response is 422
 *         with envelope {@code {code: "archived_source"}}.
 *   3. {@link #cloneArchitecture_sourceMissing_returns404()}
 *      -- 404 when the source architecture does not exist.
 *   4. {@link #cloneArchitecture_duplicateName_returns409()}
 *      -- 409 with envelope {@code {code: "duplicate_name", field: "name"}}
 *         when the target name collides with an existing architecture in the
 *         project.
 *   5. {@link #cloneArchitecture_emptyName_returns400()}
 *      -- 400 when the name is empty (whitespace-only) after trim.
 *
 * Mirrors {@link ArchitectureCrudControllerTest}'s standalone MockMvc setup
 * (the project pattern; avoids the Spring application context, which is
 * known to have unrelated pre-existing test failures per project memory).
 * The clone service is mocked because the controller's only job is to wire
 * the request body / path variables and forward the result -- the clone
 * service's own behaviour is exhaustively covered by its unit tests
 * (Group 1) and the upcoming Group 3 integration test.
 */
@ExtendWith(MockitoExtension.class)
class ArchitectureCloneControllerTest {

    @Mock
    private ArchitectureService architectureService;
    @Mock
    private ArchitectureCloneService architectureCloneService;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID SOURCE_ARCH_ID =
        UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID NEW_ARCH_ID =
        UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    @BeforeEach
    void setUp() {
        ArchitectureController controller = new ArchitectureController(
            architectureService, architectureCloneService, null, null);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        objectMapper = new ObjectMapper();
    }

    // ========================================================================
    // Test 1 -- happy path: POST returns 201 + new architecture DTO
    // ========================================================================
    @Test
    @DisplayName("POST /clone happy path returns 201 with the new architecture DTO")
    void cloneArchitecture_happyPath_returns201() throws Exception {
        Instant now = Instant.now();
        // ArchitectureDto constructor order:
        //   id, projectId, name, description, tags, archived, createdAt, updatedAt
        ArchitectureDto cloned = new ArchitectureDto(
            NEW_ARCH_ID,
            PROJECT_ID,
            "Copy of Default",
            "Cloned for target-state design",
            List.of("target-state"),
            false,
            now,
            now);
        when(architectureCloneService.cloneArchitecture(
                eq(PROJECT_ID),
                eq(SOURCE_ARCH_ID),
                eq("Copy of Default"),
                eq("Cloned for target-state design"),
                eq(List.of("target-state"))))
            .thenReturn(cloned);

        String body = objectMapper.writeValueAsString(Map.of(
            "name", "Copy of Default",
            "description", "Cloned for target-state design",
            "tags", List.of("target-state")));

        mockMvc.perform(post(
                "/api/projects/{projectId}/architectures/{sourceArchitectureId}/clone",
                PROJECT_ID, SOURCE_ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(NEW_ARCH_ID.toString()))
            .andExpect(jsonPath("$.projectId").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.name").value("Copy of Default"))
            .andExpect(jsonPath("$.description").value("Cloned for target-state design"))
            .andExpect(jsonPath("$.archived").value(false))
            .andExpect(jsonPath("$.tags.length()").value(1))
            .andExpect(jsonPath("$.tags[0]").value("target-state"))
            .andExpect(jsonPath("$.createdAt").exists())
            .andExpect(jsonPath("$.updatedAt").exists());
    }

    // ========================================================================
    // Test 2 -- safety property (d): archived source -> 422 archived_source
    // ========================================================================
    @Test
    @DisplayName("POST /clone returns 422 archived_source when source architecture is archived")
    void cloneArchitecture_archivedSource_returns422() throws Exception {
        when(architectureCloneService.cloneArchitecture(
                eq(PROJECT_ID), eq(SOURCE_ARCH_ID), any(), any(), any()))
            .thenThrow(new ArchivedArchitectureSourceException());

        String body = objectMapper.writeValueAsString(Map.of(
            "name", "Copy of Old State",
            "tags", List.of()));

        mockMvc.perform(post(
                "/api/projects/{projectId}/architectures/{sourceArchitectureId}/clone",
                PROJECT_ID, SOURCE_ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.code").value("archived_source"))
            .andExpect(jsonPath("$.message").value(
                ArchivedArchitectureSourceException.DEFAULT_MESSAGE));
    }

    // ========================================================================
    // Test 3 -- 404 when source architecture does not exist
    // ========================================================================
    @Test
    @DisplayName("POST /clone returns 404 when source architecture does not exist")
    void cloneArchitecture_sourceMissing_returns404() throws Exception {
        when(architectureCloneService.cloneArchitecture(
                eq(PROJECT_ID), eq(SOURCE_ARCH_ID), any(), any(), any()))
            .thenThrow(new ArchitectureNotFoundException(
                "Architecture not found: " + SOURCE_ARCH_ID));

        String body = objectMapper.writeValueAsString(Map.of(
            "name", "Copy of Missing",
            "tags", List.of()));

        mockMvc.perform(post(
                "/api/projects/{projectId}/architectures/{sourceArchitectureId}/clone",
                PROJECT_ID, SOURCE_ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isNotFound());
    }

    // ========================================================================
    // Test 4 -- 409 duplicate_name when target name collides
    // ========================================================================
    @Test
    @DisplayName("POST /clone returns 409 duplicate_name when target name collides with an existing architecture")
    void cloneArchitecture_duplicateName_returns409() throws Exception {
        when(architectureCloneService.cloneArchitecture(
                eq(PROJECT_ID), eq(SOURCE_ARCH_ID), eq("Default"), any(), any()))
            .thenThrow(new DuplicateArchitectureNameException("Default"));

        String body = objectMapper.writeValueAsString(Map.of(
            "name", "Default",
            "tags", List.of()));

        mockMvc.perform(post(
                "/api/projects/{projectId}/architectures/{sourceArchitectureId}/clone",
                PROJECT_ID, SOURCE_ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("duplicate_name"))
            .andExpect(jsonPath("$.field").value("name"))
            .andExpect(jsonPath("$.message").value(
                "An architecture named 'Default' already exists in this project."));
    }

    // ========================================================================
    // Test 5 -- 400 on validation failure (empty name after trim).
    //
    // The clone service delegates name validation to the same shared
    // validateAndTrimName helper as create / update; an empty / whitespace-only
    // name surfaces as IllegalArgumentException, which the
    // GlobalExceptionHandler maps to 400.
    // ========================================================================
    @Test
    @DisplayName("POST /clone returns 400 when name is empty (whitespace-only) after trim")
    void cloneArchitecture_emptyName_returns400() throws Exception {
        when(architectureCloneService.cloneArchitecture(
                eq(PROJECT_ID), eq(SOURCE_ARCH_ID), eq("   "), any(), any()))
            .thenThrow(new IllegalArgumentException("Architecture name is required"));

        String body = objectMapper.writeValueAsString(Map.of(
            "name", "   ",
            "tags", List.of()));

        mockMvc.perform(post(
                "/api/projects/{projectId}/architectures/{sourceArchitectureId}/clone",
                PROJECT_ID, SOURCE_ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("Architecture name is required"));

        // Confirm no other branch was triggered.
        verify(architectureService, never()).create(any(), any(), any(), any());
    }
}
