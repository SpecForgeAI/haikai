package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourComparisonWaiverDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourComparisonWaiverRequest;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourComparisonWaiverService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc test for {@link ApiBehaviourComparisonWaiverController}
 * (Spec 2026-07-06-j — Parity Exactness &amp; First-Class SOAP).
 *
 * <p>Pins: the effective list carries BOTH the global seed rows and the
 * project rows (snake_case wire); create returns 201 and routes through the
 * service with the path project; delete returns 204.</p>
 */
@ExtendWith(MockitoExtension.class)
class ApiBehaviourComparisonWaiverControllerTest {

    @Mock
    private ApiBehaviourComparisonWaiverService service;

    private MockMvc mockMvc;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant NOW = Instant.parse("2026-07-06T10:00:00Z");

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
            .standaloneSetup(new ApiBehaviourComparisonWaiverController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    @Test
    @DisplayName("GET returns the effective set (global seed + project rows, snake_case wire)")
    void listReturnsEffectiveSet() throws Exception {
        ApiBehaviourComparisonWaiverDto seed = new ApiBehaviourComparisonWaiverDto(
            UUID.randomUUID(), null, "global", "header", "date",
            "Legacy in-code header allowlist", "system", "seed:legacy-allowlist", NOW);
        ApiBehaviourComparisonWaiverDto mine = new ApiBehaviourComparisonWaiverDto(
            UUID.randomUUID(), PROJECT_ID, "project", "body_path", "/generated_id",
            "Server-generated id — replay cannot pin it", "gary", null, NOW);
        when(service.listEffective(PROJECT_ID)).thenReturn(List.of(seed, mine));

        mockMvc.perform(get(
                "/api/projects/{projectId}/api-behaviour/comparison-waivers", PROJECT_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].scope").value("global"))
            .andExpect(jsonPath("$[0].dimension").value("header"))
            .andExpect(jsonPath("$[0].provenance").value("seed:legacy-allowlist"))
            // NOTE: standalone MockMvc uses a default ObjectMapper, so the
            // property renders camelCase HERE; the running app's global
            // SNAKE_CASE strategy makes the real wire `project_id`.
            .andExpect(jsonPath("$[1].projectId").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$[1].dimension").value("body_path"));
    }

    @Test
    @DisplayName("POST creates a project-scoped waiver (201) through the service")
    void createRoutesThroughService() throws Exception {
        ApiBehaviourComparisonWaiverDto created = new ApiBehaviourComparisonWaiverDto(
            UUID.randomUUID(), PROJECT_ID, "project", "header", "x-custom-noise",
            "Load balancer stamps it", "gary", null, NOW);
        when(service.create(eq(PROJECT_ID), any())).thenReturn(created);

        mockMvc.perform(post(
                    "/api/projects/{projectId}/api-behaviour/comparison-waivers", PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"dimension\":\"header\",\"target\":\"X-Custom-Noise\"," +
                    "\"reason\":\"Load balancer stamps it\",\"author\":\"gary\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.target").value("x-custom-noise"))
            .andExpect(jsonPath("$.scope").value("project"));

        ArgumentCaptor<CreateApiBehaviourComparisonWaiverRequest> captor =
            ArgumentCaptor.forClass(CreateApiBehaviourComparisonWaiverRequest.class);
        verify(service).create(eq(PROJECT_ID), captor.capture());
        assertThat(captor.getValue().dimension()).isEqualTo("header");
        assertThat(captor.getValue().reason()).isEqualTo("Load balancer stamps it");
    }

    @Test
    @DisplayName("DELETE returns 204 and routes the id to the service")
    void deleteReturnsNoContent() throws Exception {
        UUID id = UUID.randomUUID();
        mockMvc.perform(delete(
                "/api/projects/{projectId}/api-behaviour/comparison-waivers/{id}",
                PROJECT_ID, id))
            .andExpect(status().isNoContent());
        verify(service).delete(id);
    }
}
