package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryRunDto;
import com.example.architecturemodel.service.DiscoveryRunService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Spec #4 Task Group 2 controller tests for the architecture-scoped Discovery
 * Run endpoints.
 *
 * Three tests of the four required by Task 2.1 live here (the fourth, the
 * "PUT does NOT mutate architecture_id" service-level binding test, lives in
 * {@code DiscoveryRunServiceArchitectureBindingTest} for tighter coverage of
 * the binding-immutability invariant on the service side).
 *
 * Covered:
 * <ol>
 *   <li>POST /runs persists the URL path's {@code architectureId} on the new
 *       {@link com.example.architecturemodel.model.entity.DiscoveryRunEntity}
 *       (via {@link DiscoveryRunService#createRun(UUID, UUID, String, String, String, boolean, Map)}).</li>
 *   <li>Path-segment 404 safety (property (b)): omitting {@code architectureId}
 *       from the URL produces a Spring 404 -- no fallback / silent default.</li>
 *   <li>List endpoint filters by {@code (projectId, architectureId)}: the
 *       controller passes both ids through to the architecture-scoped service
 *       method, so cross-architecture runs are excluded by the WHERE clause
 *       in the repository.</li>
 * </ol>
 *
 * Spec: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 * Spec: Discovery Run Robustness (2026-05-11) -- Section 2 added the seventh
 *       {@code serviceIdentitySnapshot} positional argument to createRun.
 */
@WebMvcTest(DiscoveryRunController.class)
class DiscoveryRunControllerArchitectureScopingTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private DiscoveryRunService discoveryRunService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_A = UUID.randomUUID();
    private static final UUID ARCHITECTURE_B = UUID.randomUUID();

    /**
     * Property: POST /runs persists the URL path's architectureId on the new entity.
     *
     * The controller MUST pass the path-segment {@code architectureId} into the
     * service create call (which in turn writes it onto the entity). We verify
     * by capturing the second positional argument and asserting it equals the
     * URL value, NOT some default / null.
     */
    @Test
    @DisplayName("POST /runs creates a run bound to the URL path's architectureId")
    void postCreateRun_persistsArchitectureIdFromUrl() throws Exception {
        // Given: service returns a DTO carrying the picked architectureId.
        UUID runId = UUID.randomUUID();
        Instant now = Instant.now();
        DiscoveryRunDto dto = new DiscoveryRunDto(
            runId, PROJECT_ID, ARCHITECTURE_A, null, null, null, null, false,
            null,
            null, null,
            "PENDING", null, Map.of(), Map.of(), null,
            now.toString(), now.toString()
        );
        // Controller calls the 8-arg createRun signature (Spec: Database Discovery
        // Packs 2026-05-16 added the trailing discoveryKind discriminator).
        when(discoveryRunService.createRun(
                any(UUID.class),
                any(UUID.class),
                nullable(String.class),
                nullable(String.class),
                nullable(String.class),
                anyBoolean(),
                nullable(Map.class),
                nullable(String.class)))
            .thenReturn(dto);

        // When: POST to the architecture-scoped URL.
        mockMvc.perform(post(
                "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs",
                PROJECT_ID, ARCHITECTURE_A)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isOk());

        // Then: capture the architectureId argument the controller passed to the service.
        ArgumentCaptor<UUID> projectCaptor = ArgumentCaptor.forClass(UUID.class);
        ArgumentCaptor<UUID> architectureCaptor = ArgumentCaptor.forClass(UUID.class);
        verify(discoveryRunService).createRun(
            projectCaptor.capture(),
            architectureCaptor.capture(),
            nullable(String.class),
            nullable(String.class),
            nullable(String.class),
            anyBoolean(),
            nullable(Map.class),
            nullable(String.class)
        );

        assertThat(projectCaptor.getValue())
            .as("controller must pass the URL path projectId to the service")
            .isEqualTo(PROJECT_ID);
        assertThat(architectureCaptor.getValue())
            .as("controller must pass the URL path architectureId to the service "
                + "(this becomes the bound architecture on the new DiscoveryRunEntity)")
            .isEqualTo(ARCHITECTURE_A);
    }

    /**
     * Property (b) -- path-segment 404 safety.
     *
     * Hits the OLD project-only URL (the one in use before spec #4) for both a
     * list endpoint and an item endpoint. With the architectureId path segment
     * required in the new URL shape, the project-only URLs MUST 404 with no
     * fallback. The default Spring Boot {@link
     * org.springframework.web.servlet.resource.NoResourceFoundException}
     * handler in {@link com.example.architecturemodel.exception.GlobalExceptionHandler}
     * emits the standard 404 envelope.
     */
    @Test
    @DisplayName("path-segment 404 safety: missing architectureId on list and item endpoints both yield 404")
    void missingArchitectureIdSegment_returns404() throws Exception {
        UUID runId = UUID.randomUUID();

        // List endpoint without :architectureId -- old project-only URL.
        mockMvc.perform(get("/api/model/projects/{projectId}/discovery/runs", PROJECT_ID))
            .andExpect(status().isNotFound());

        // Item endpoint without :architectureId.
        mockMvc.perform(get(
                "/api/model/projects/{projectId}/discovery/runs/{runId}",
                PROJECT_ID, runId))
            .andExpect(status().isNotFound());
    }

    /**
     * Property (c) -- list filtered by URL active architecture.
     *
     * When two architectures (A and B) have parallel runs in the same project,
     * GET /architectures/A/.../runs MUST only return A's runs. The controller
     * must call {@link DiscoveryRunService#getRunsByProjectAndArchitecture}
     * (the architecture-scoped method) rather than the project-only one.
     *
     * We mock the service to return ONLY A's run when called with
     * (projectId, ARCHITECTURE_A) and verify the response carries that single
     * run, plus that the controller did indeed call the architecture-scoped
     * service method with the right arguments.
     */
    @Test
    @DisplayName("GET /runs filters by URL architectureId; cross-architecture runs are excluded")
    void getRuns_filtersByArchitectureId_excludingCrossArchitectureRuns() throws Exception {
        // Given: only architecture A's run is returned by the scoped service call.
        UUID runIdA = UUID.randomUUID();
        Instant now = Instant.now();
        DiscoveryRunDto runInA = new DiscoveryRunDto(
            runIdA, PROJECT_ID, ARCHITECTURE_A, null, null, null, null, false,
            null,
            null, null,
            "COMPLETED", null, Map.of(), Map.of(), null,
            now.toString(), now.toString()
        );

        when(discoveryRunService.getRunsByProjectAndArchitectureAndKind(PROJECT_ID, ARCHITECTURE_A, null))
            .thenReturn(List.of(runInA));
        // Defence-in-depth: if the controller wrongly called the project-only
        // method, this empty stub would surface as a zero-length list.
        when(discoveryRunService.getRunsByProject(PROJECT_ID))
            .thenReturn(List.of(/* would-leak architecture B run */));

        // When/Then: response contains only architecture A's run, and the
        // returned DTO carries its bound architecture_id (Spec: Discovery Run
        // Robustness Section 3 — AC3.3: DTO surfaces architecture_id verbatim).
        mockMvc.perform(get(
                "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs",
                PROJECT_ID, ARCHITECTURE_A))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].id").value(runIdA.toString()))
            .andExpect(jsonPath("$[0].architecture_id").value(ARCHITECTURE_A.toString()));

        // And: the architecture-scoped service method was called with the right ids.
        verify(discoveryRunService).getRunsByProjectAndArchitectureAndKind(
            eq(PROJECT_ID), eq(ARCHITECTURE_A), nullable(String.class));
    }
}
