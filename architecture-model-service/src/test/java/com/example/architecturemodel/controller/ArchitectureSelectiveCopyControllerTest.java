package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ArchivedArchitectureSourceException;
import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.SameArchitectureCopyException;
import com.example.architecturemodel.model.dto.SelectiveCopyCommitRequest;
import com.example.architecturemodel.model.dto.SelectiveCopyCommitResponse;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightRequest;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightResponse;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightResponse.AutoIncludedItem;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightResponse.ConflictItem;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightResponse.Summary;
import com.example.architecturemodel.service.ArchitectureSelectiveCopyService;
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

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Focused tests for the new selective-copy preflight + commit endpoints
 * introduced in Spec #7.
 *
 * <p>Spec: Multi-Architecture Selective Cross-Architecture Copy (Spec #7) --
 * Task Group 3.</p>
 *
 * <p>Required tests covered:</p>
 * <ol>
 *   <li>{@link #selectiveCopyPreflight_happyPath_returns200()}
 *       -- happy path: POST {@code .../selective-copy/preflight} with a valid
 *          body returns 200 + the preflight response shape (conflicts +
 *          autoIncluded + summary).</li>
 *   <li>{@link #selectiveCopyCommit_happyPath_returns200()}
 *       -- happy path: POST {@code .../selective-copy/commit} with a valid
 *          body returns 200 + the commit response shape
 *          (copied / skipped / overwritten / duplicated / autoIncluded
 *          counts).</li>
 *   <li>{@link #selectiveCopyPreflight_sameArchitecture_returns422()}
 *       -- safety property (f): when the service throws
 *          {@link SameArchitectureCopyException}, the response is 422 with
 *          envelope {@code {code: "same_architecture"}}.</li>
 *   <li>{@link #selectiveCopyCommit_archivedSource_returns422()}
 *       -- safety property (e): when the service throws
 *          {@link ArchivedArchitectureSourceException}, the response is 422
 *          with envelope {@code {code: "archived_source"}}.</li>
 * </ol>
 *
 * <p>Mirrors {@link ArchitectureCloneControllerTest}'s standalone MockMvc
 * setup (the project pattern; avoids the Spring application context, which
 * is known to have unrelated pre-existing test failures per project memory).
 * The selective-copy service is mocked because the controller's only job is
 * to wire path variables + body and forward the result -- the service's own
 * behaviour is exhaustively covered by its unit tests (Group 2) and the
 * upcoming Group 4 integration test.</p>
 */
@ExtendWith(MockitoExtension.class)
class ArchitectureSelectiveCopyControllerTest {

    @Mock
    private ArchitectureSelectiveCopyService architectureSelectiveCopyService;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TARGET_ARCH_ID =
        UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID SOURCE_ARCH_ID =
        UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static final UUID ELEMENT_ID_ONE =
        UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final UUID ELEMENT_ID_TWO =
        UUID.fromString("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static final UUID AUTO_INCLUDED_ID =
        UUID.fromString("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");

    @BeforeEach
    void setUp() {
        // Three of the four constructor args are unused on these endpoints --
        // mirrors the spec #6 Group 2 pattern of nulling unused dependencies
        // for the controller-only test.
        ArchitectureController controller = new ArchitectureController(
            null, null, null, architectureSelectiveCopyService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        objectMapper = new ObjectMapper();
    }

    // ========================================================================
    // Test 1 -- happy path: preflight POST returns 200 + the preflight shape
    // ========================================================================
    @Test
    @DisplayName("POST /selective-copy/preflight happy path returns 200 with the preflight response shape")
    void selectiveCopyPreflight_happyPath_returns200() throws Exception {
        SelectiveCopyPreflightResponse stub = new SelectiveCopyPreflightResponse(
            List.of(new ConflictItem(
                ELEMENT_ID_ONE,
                "applications",
                "Order Service",
                "same_uuid")),
            List.of(new AutoIncludedItem(
                AUTO_INCLUDED_ID,
                "data_entities",
                "Order",
                "Order Service")),
            new Summary(2, 1, 1, 3));

        when(architectureSelectiveCopyService.preflight(
                eq(PROJECT_ID), eq(TARGET_ARCH_ID), any(SelectiveCopyPreflightRequest.class)))
            .thenReturn(stub);

        String body = objectMapper.writeValueAsString(Map.of(
            "sourceArchitectureId", SOURCE_ARCH_ID.toString(),
            "elementIds", List.of(ELEMENT_ID_ONE.toString(), ELEMENT_ID_TWO.toString())));

        mockMvc.perform(post(
                "/api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/preflight",
                PROJECT_ID, TARGET_ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.conflicts.length()").value(1))
            .andExpect(jsonPath("$.conflicts[0].elementId").value(ELEMENT_ID_ONE.toString()))
            .andExpect(jsonPath("$.conflicts[0].elementType").value("applications"))
            .andExpect(jsonPath("$.conflicts[0].name").value("Order Service"))
            .andExpect(jsonPath("$.conflicts[0].conflictReason").value("same_uuid"))
            .andExpect(jsonPath("$.autoIncluded.length()").value(1))
            .andExpect(jsonPath("$.autoIncluded[0].elementId").value(AUTO_INCLUDED_ID.toString()))
            .andExpect(jsonPath("$.autoIncluded[0].elementType").value("data_entities"))
            .andExpect(jsonPath("$.autoIncluded[0].name").value("Order"))
            .andExpect(jsonPath("$.autoIncluded[0].includedBecause").value("Order Service"))
            .andExpect(jsonPath("$.summary.totalSelected").value(2))
            .andExpect(jsonPath("$.summary.conflictCount").value(1))
            .andExpect(jsonPath("$.summary.autoIncludedCount").value(1))
            .andExpect(jsonPath("$.summary.willCopyCount").value(3));
    }

    // ========================================================================
    // Test 2 -- happy path: commit POST returns 200 + the commit shape
    // ========================================================================
    @Test
    @DisplayName("POST /selective-copy/commit happy path returns 200 with the commit response shape")
    void selectiveCopyCommit_happyPath_returns200() throws Exception {
        SelectiveCopyCommitResponse stub = new SelectiveCopyCommitResponse(
            5, 1, 2, 1, 3);

        when(architectureSelectiveCopyService.commit(
                eq(PROJECT_ID), eq(TARGET_ARCH_ID), any(SelectiveCopyCommitRequest.class)))
            .thenReturn(stub);

        String body = objectMapper.writeValueAsString(Map.of(
            "sourceArchitectureId", SOURCE_ARCH_ID.toString(),
            "elementIds", List.of(ELEMENT_ID_ONE.toString(), ELEMENT_ID_TWO.toString()),
            "resolutions", List.of(
                Map.of("elementId", ELEMENT_ID_ONE.toString(), "action", "overwrite"),
                Map.of("elementId", ELEMENT_ID_TWO.toString(), "action", "duplicate"))));

        mockMvc.perform(post(
                "/api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/commit",
                PROJECT_ID, TARGET_ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.copied").value(5))
            .andExpect(jsonPath("$.skipped").value(1))
            .andExpect(jsonPath("$.overwritten").value(2))
            .andExpect(jsonPath("$.duplicated").value(1))
            .andExpect(jsonPath("$.autoIncluded").value(3));
    }

    // ========================================================================
    // Test 3 -- safety property (f): same architecture -> 422 same_architecture
    // ========================================================================
    @Test
    @DisplayName("POST /selective-copy/preflight returns 422 same_architecture when source == target")
    void selectiveCopyPreflight_sameArchitecture_returns422() throws Exception {
        when(architectureSelectiveCopyService.preflight(
                eq(PROJECT_ID), eq(TARGET_ARCH_ID), any(SelectiveCopyPreflightRequest.class)))
            .thenThrow(new SameArchitectureCopyException());

        // Body uses TARGET_ARCH_ID for both source and target — the
        // service detects the collision and throws.
        String body = objectMapper.writeValueAsString(Map.of(
            "sourceArchitectureId", TARGET_ARCH_ID.toString(),
            "elementIds", List.of(ELEMENT_ID_ONE.toString())));

        mockMvc.perform(post(
                "/api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/preflight",
                PROJECT_ID, TARGET_ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.code").value("same_architecture"))
            .andExpect(jsonPath("$.message").value(
                SameArchitectureCopyException.DEFAULT_MESSAGE));
    }

    // ========================================================================
    // Test 4 -- safety property (e): archived source -> 422 archived_source
    // ========================================================================
    @Test
    @DisplayName("POST /selective-copy/commit returns 422 archived_source when source architecture is archived")
    void selectiveCopyCommit_archivedSource_returns422() throws Exception {
        when(architectureSelectiveCopyService.commit(
                eq(PROJECT_ID), eq(TARGET_ARCH_ID), any(SelectiveCopyCommitRequest.class)))
            .thenThrow(new ArchivedArchitectureSourceException());

        String body = objectMapper.writeValueAsString(Map.of(
            "sourceArchitectureId", SOURCE_ARCH_ID.toString(),
            "elementIds", List.of(ELEMENT_ID_ONE.toString()),
            "resolutions", List.of()));

        mockMvc.perform(post(
                "/api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/commit",
                PROJECT_ID, TARGET_ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.code").value("archived_source"))
            .andExpect(jsonPath("$.message").value(
                ArchivedArchitectureSourceException.DEFAULT_MESSAGE));
    }
}
