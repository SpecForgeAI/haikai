package com.example.architecturemodel.controller.procbehaviour;

import com.example.architecturemodel.model.entity.procbehaviour.ProcParityReportEntity;
import com.example.architecturemodel.repository.entity.ProcParityReportRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc slice over {@link ProcParityReportController} with a mocked
 * repository -- Stored Proc &amp; Function Behaviour Program, Spec 4
 * (changeset 231).
 *
 * <p>Pins the two things every consumer of the table relies on: the POST LIFTS
 * the comparator's snake_case keys onto columns (while keeping the body
 * verbatim in {@code report_json}), and {@code /latest-by-routine} collapses
 * the newest-first stream to exactly ONE entry per routine.</p>
 */
@ExtendWith(MockitoExtension.class)
class ProcParityReportControllerTest {

    @Mock
    private ProcParityReportRepository repository;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ARCH_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID ROUTINE_A =
        UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID ROUTINE_B =
        UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final UUID BASELINE_ID =
        UUID.fromString("55555555-5555-5555-5555-555555555555");
    private static final UUID PACK_ID =
        UUID.fromString("66666666-6666-6666-6666-666666666666");
    private static final UUID ATTEMPT_ID =
        UUID.fromString("77777777-7777-7777-7777-777777777777");

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        mockMvc = MockMvcBuilders
            .standaloneSetup(new ProcParityReportController(repository))
            .setMessageConverters(new MappingJackson2HttpMessageConverter(objectMapper))
            .build();
    }

    @Test
    @DisplayName("POST lifts routine / baseline / pack / attempt / purpose / status / pair / ruleset onto columns and keeps the body verbatim")
    void postLiftsColumns() throws Exception {
        when(repository.save(any(ProcParityReportEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("status", "divergent");
        summary.put("scenarios_total", 12);
        summary.put("scenarios_divergent", 2);

        Map<String, Object> report = new LinkedHashMap<>();
        report.put("routine_id", ROUTINE_A.toString());
        report.put("baseline_id", BASELINE_ID.toString());
        report.put("pack_id", PACK_ID.toString());
        report.put("translation_attempt_id", ATTEMPT_ID.toString());
        report.put("purpose", "workbench");
        report.put("pair_id", "sybase15-postgres18");
        report.put("ruleset_version", 4);
        report.put("summary", summary);
        report.put("results", List.of(Map.of(
            "scenario_name", "zero_rows",
            "verdict", "divergent",
            "dimension", "result_sets")));

        mockMvc.perform(post(
                "/api/projects/{p}/architectures/{a}/proc-parity-reports", PROJECT_ID, ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(report)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").exists());

        ArgumentCaptor<ProcParityReportEntity> captor =
            ArgumentCaptor.forClass(ProcParityReportEntity.class);
        org.mockito.Mockito.verify(repository).save(captor.capture());
        ProcParityReportEntity saved = captor.getValue();
        assertThat(saved.getProjectId()).isEqualTo(PROJECT_ID);
        assertThat(saved.getArchitectureId()).isEqualTo(ARCH_ID);
        assertThat(saved.getRoutineId()).isEqualTo(ROUTINE_A);
        assertThat(saved.getBaselineId()).isEqualTo(BASELINE_ID);
        assertThat(saved.getPackId()).isEqualTo(PACK_ID);
        assertThat(saved.getTranslationAttemptId()).isEqualTo(ATTEMPT_ID);
        assertThat(saved.getPurpose()).isEqualTo("workbench");
        assertThat(saved.getStatus()).isEqualTo("divergent");
        assertThat(saved.getMigrationPair()).isEqualTo("sybase15-postgres18");
        assertThat(saved.getRulesetVersion()).isEqualTo(4);
        assertThat(saved.getSummaryJson()).containsEntry("scenarios_divergent", 2);
        // The body rides verbatim -- per-scenario results are never flattened.
        assertThat(saved.getReportJson()).containsKey("results");
        assertThat(saved.getReportJson()).containsEntry("pair_id", "sybase15-postgres18");
    }

    @Test
    @DisplayName("POST without a routine_id is a 400; an unknown purpose is a 400")
    void postValidates() throws Exception {
        mockMvc.perform(post(
                "/api/projects/{p}/architectures/{a}/proc-parity-reports", PROJECT_ID, ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"purpose\":\"workbench\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value(
                org.hamcrest.Matchers.containsString("routine_id is required")));

        mockMvc.perform(post(
                "/api/projects/{p}/architectures/{a}/proc-parity-reports", PROJECT_ID, ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"routine_id\":\"" + ROUTINE_A + "\",\"purpose\":\"guesswork\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value(
                org.hamcrest.Matchers.containsString("Invalid purpose")));
    }

    @Test
    @DisplayName("latest-by-routine returns exactly one entry per routine -- the newest report")
    void latestByRoutineReturnsOnePerRoutine() throws Exception {
        when(repository.findByArchitectureIdOrderByCreatedAtDesc(ARCH_ID)).thenReturn(List.of(
            report(ROUTINE_A, "clean", "workbench", "2026-09-09T12:00:00Z"),
            report(ROUTINE_A, "divergent", "workbench", "2026-09-09T11:00:00Z"),
            report(ROUTINE_B, "unverifiable", "execution", "2026-09-09T10:30:00Z"),
            report(ROUTINE_A, "divergent", "workbench", "2026-09-09T09:00:00Z")));

        mockMvc.perform(get(
                "/api/projects/{p}/architectures/{a}/proc-parity-reports/latest-by-routine",
                PROJECT_ID, ARCH_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$['" + ROUTINE_A + "'].status").value("clean"))
            .andExpect(jsonPath("$['" + ROUTINE_A + "'].purpose").value("workbench"))
            .andExpect(jsonPath("$['" + ROUTINE_A + "'].summary_json.status").value("clean"))
            .andExpect(jsonPath("$['" + ROUTINE_B + "'].status").value("unverifiable"))
            .andExpect(jsonPath("$['" + ROUTINE_B + "'].purpose").value("execution"));
    }

    @Test
    @DisplayName("latest-by-routine?purpose= narrows the pool to that purpose")
    void latestByRoutineNarrowsByPurpose() throws Exception {
        when(repository.findByArchitectureIdOrderByCreatedAtDesc(ARCH_ID)).thenReturn(List.of(
            report(ROUTINE_A, "clean", "workbench", "2026-09-09T12:00:00Z"),
            report(ROUTINE_A, "divergent", "execution", "2026-09-09T11:00:00Z"),
            report(ROUTINE_B, "clean", "workbench", "2026-09-09T10:00:00Z")));

        mockMvc.perform(get(
                "/api/projects/{p}/architectures/{a}/proc-parity-reports/latest-by-routine",
                PROJECT_ID, ARCH_ID)
                .param("purpose", "execution"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$['" + ROUTINE_A + "'].status").value("divergent"));
    }

    @Test
    @DisplayName("latest?routine_id= is the routine's newest report; 404 when it has none")
    void latestForOneRoutine() throws Exception {
        when(repository.findFirstByArchitectureIdAndRoutineIdOrderByCreatedAtDesc(
            ARCH_ID, ROUTINE_A))
            .thenReturn(Optional.of(
                report(ROUTINE_A, "clean_with_waivers", "workbench", "2026-09-09T12:00:00Z")));
        when(repository.findFirstByArchitectureIdAndRoutineIdOrderByCreatedAtDesc(
            ARCH_ID, ROUTINE_B))
            .thenReturn(Optional.empty());

        mockMvc.perform(get(
                "/api/projects/{p}/architectures/{a}/proc-parity-reports/latest", PROJECT_ID, ARCH_ID)
                .param("routine_id", ROUTINE_A.toString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("clean_with_waivers"))
            .andExpect(jsonPath("$.routine_id").value(ROUTINE_A.toString()));

        mockMvc.perform(get(
                "/api/projects/{p}/architectures/{a}/proc-parity-reports/latest", PROJECT_ID, ARCH_ID)
                .param("routine_id", ROUTINE_B.toString()))
            .andExpect(status().isNotFound());
    }

    private static ProcParityReportEntity report(
            UUID routineId, String status, String purpose, String createdAt) {
        return ProcParityReportEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .architectureId(ARCH_ID)
            .routineId(routineId)
            .purpose(purpose)
            .status(status)
            .summaryJson(Map.of("status", status))
            .reportJson(Map.of("routine_id", routineId.toString()))
            .createdAt(Instant.parse(createdAt))
            .build();
    }
}
