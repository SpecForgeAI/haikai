package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryRunDto;
import com.example.architecturemodel.service.DiscoveryRunService;
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
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller-layer tests for the {@code discovery_kind} discriminator added in
 * Spec: Database Discovery Packs (Sybase + PostgreSQL) (2026-05-16) -- Task Group 1.
 *
 * Verifies:
 *   - POST /discovery/runs with {@code discovery_kind='database'} forwards the
 *     value into the service.
 *   - POST /discovery/runs with no {@code discovery_kind} field (back-compat)
 *     surfaces the default 'code' kind on the response.
 *   - POST /discovery/runs with an invalid {@code discovery_kind} returns 400.
 *   - GET /discovery/runs?discovery_kind=database calls the kind-filtered
 *     service method with the correct argument and returns only matching runs.
 *
 * Style modeled on {@link DiscoveryRunControllerTest} and follows the same
 * {@link WebMvcTest} + {@link MockBean} pattern.
 */
@WebMvcTest(DiscoveryRunController.class)
class DiscoveryRunControllerKindTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private DiscoveryRunService discoveryRunService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();

    private static final String BASE_PATH =
        "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs";

    /**
     * Test 1: POST /discovery/runs with {@code discovery_kind='database'}
     * forwards the value into the 8-arg createRun service call.
     */
    @Test
    @DisplayName("POST createRun with discovery_kind='database' forwards into service createRun")
    void createRun_forwardsDatabaseKindIntoService() throws Exception {
        UUID runId = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryRunDto dto = new DiscoveryRunDto(
            runId, PROJECT_ID, ARCHITECTURE_ID, null, null, null, null, false,
            "database", null, null, "PENDING", null,
            Map.of(), Map.of(), null,
            now.toString(), now.toString()
        );

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

        String body = "{ \"discovery_kind\": \"database\" }";
        mockMvc.perform(post(BASE_PATH, PROJECT_ID, ARCHITECTURE_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.discovery_kind").value("database"));

        // Confirm the service was invoked with discoveryKind='database' as the 8th positional arg.
        verify(discoveryRunService).createRun(
            eq(PROJECT_ID),
            eq(ARCHITECTURE_ID),
            nullable(String.class),
            nullable(String.class),
            nullable(String.class),
            anyBoolean(),
            nullable(Map.class),
            eq("database")
        );
    }

    /**
     * Test 2: POST /discovery/runs with no {@code discovery_kind} field in the
     * body surfaces the default 'code' value via the service mock. Back-compat
     * with existing clients that pre-date the database packs spec.
     */
    @Test
    @DisplayName("POST createRun without discovery_kind defaults to 'code' on the response")
    void createRun_defaultsKindToCodeWhenAbsent() throws Exception {
        UUID runId = UUID.randomUUID();
        Instant now = Instant.now();

        // Service returns a DTO with discoveryKind='code' because the service
        // layer normalises null -> 'code' (we test that behaviour directly in
        // DiscoveryRunKindPersistenceTest).
        DiscoveryRunDto dto = new DiscoveryRunDto(
            runId, PROJECT_ID, ARCHITECTURE_ID, null, null, null, null, false,
            "code", null, null, "PENDING", null,
            Map.of(), Map.of(), null,
            now.toString(), now.toString()
        );

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

        mockMvc.perform(post(BASE_PATH, PROJECT_ID, ARCHITECTURE_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.discovery_kind").value("code"));

        // Service received null for the 8th positional arg (normalised inside the service).
        verify(discoveryRunService).createRun(
            eq(PROJECT_ID),
            eq(ARCHITECTURE_ID),
            nullable(String.class),
            nullable(String.class),
            nullable(String.class),
            anyBoolean(),
            nullable(Map.class),
            nullable(String.class)
        );
    }

    /**
     * Test 3: POST /discovery/runs with an invalid {@code discovery_kind} value
     * yields 400 Bad Request. The service throws IllegalArgumentException
     * (from validateDiscoveryKind) which the controller maps to 400.
     */
    @Test
    @DisplayName("POST createRun with an invalid discovery_kind returns 400")
    void createRun_rejectsInvalidKindWith400() throws Exception {
        when(discoveryRunService.createRun(
                any(UUID.class),
                any(UUID.class),
                nullable(String.class),
                nullable(String.class),
                nullable(String.class),
                anyBoolean(),
                nullable(Map.class),
                nullable(String.class)))
            .thenThrow(new IllegalArgumentException(
                "Invalid discovery_kind: graph. Allowed values: [code, database, combined]"));

        String body = "{ \"discovery_kind\": \"graph\" }";
        mockMvc.perform(post(BASE_PATH, PROJECT_ID, ARCHITECTURE_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").exists())
            .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("discovery_kind")));
    }

    /**
     * Test 4: GET /discovery/runs?discovery_kind=database calls the
     * kind-filtered service method with the correct argument and returns only
     * matching runs in the JSON response.
     */
    @Test
    @DisplayName("GET listRuns?discovery_kind=database filters to database runs")
    void listRuns_filtersByDatabaseKind() throws Exception {
        UUID runIdDb = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryRunDto dbRun = new DiscoveryRunDto(
            runIdDb, PROJECT_ID, ARCHITECTURE_ID, null, null, null, null, false,
            "database", null, null, "COMPLETED", null,
            Map.of(), Map.of(), null,
            now.toString(), now.toString()
        );

        when(discoveryRunService.getRunsByProjectAndArchitectureAndKind(
                eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq("database")))
            .thenReturn(List.of(dbRun));

        mockMvc.perform(get(BASE_PATH + "?discovery_kind=database",
                PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].id").value(runIdDb.toString()))
            .andExpect(jsonPath("$[0].discovery_kind").value("database"));

        // Confirm the service method was called with kind='database'.
        verify(discoveryRunService).getRunsByProjectAndArchitectureAndKind(
            eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq("database"));
    }
}
