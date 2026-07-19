package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.security.IngestSecurityFindingsRequest;
import com.example.architecturemodel.model.dto.security.SecurityFindingReportDto;
import com.example.architecturemodel.model.dto.security.SecurityIngestSummaryDto;
import com.example.architecturemodel.model.dto.security.SecurityRegisterResponse;
import com.example.architecturemodel.model.dto.security.SecurityRollupDto;
import com.example.architecturemodel.service.security.SecurityFindingIngestionService;
import com.example.architecturemodel.service.security.SecurityRegisterService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc wire tests for {@link SecurityFindingController} (Security health
 * dashboard, 2026-07-19, Spec 1 of 3). Standalone setup with the SNAKE_CASE
 * converter so assertions exercise the REAL production wire shape the gateway
 * (Spec 2) and frontend (Spec 3) consume: snake_case bodies AND snake_case
 * query params ({@code match_status}, {@code application_id}, {@code report_id},
 * {@code columns}).
 */
@ExtendWith(MockitoExtension.class)
class SecurityFindingControllerTest {

    @Mock private SecurityFindingIngestionService ingestionService;
    @Mock private SecurityRegisterService registerService;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ARCHITECTURE_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID REPORT_ID =
        UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final Instant NOW = Instant.parse("2026-07-19T10:00:00Z");

    private static final String BASE =
        "/api/model/projects/" + PROJECT_ID + "/architectures/" + ARCHITECTURE_ID + "/security";

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        MappingJackson2HttpMessageConverter converter =
            new MappingJackson2HttpMessageConverter(objectMapper);
        mockMvc = MockMvcBuilders
            .standaloneSetup(new SecurityFindingController(ingestionService, registerService))
            .setControllerAdvice(new com.example.architecturemodel.exception.GlobalExceptionHandler())
            .setMessageConverters(converter)
            .build();
    }

    @Test
    @DisplayName("POST .../security/reports ingests and answers 201 with the snake_case summary")
    void ingestReport() throws Exception {
        when(ingestionService.ingest(eq(PROJECT_ID), eq(ARCHITECTURE_ID), any()))
            .thenReturn(new SecurityIngestSummaryDto(
                REPORT_ID, "gitlab_export", "application", NOW,
                List.of("a.csv", "b.csv"), 10, 9, 1, 7, 2, 4, 3, 4, 2, "notes"));

        String body = objectMapper.writeValueAsString(new IngestSecurityFindingsRequest(
            "gitlab_export", "application", List.of("a.csv", "b.csv"),
            Map.of("Project Name", "linking_value"), 0, null, List.of()));

        mockMvc.perform(post(BASE + "/reports")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.report_id").value(REPORT_ID.toString()))
            .andExpect(jsonPath("$.association_level").value("application"))
            .andExpect(jsonPath("$.row_count_ingested").value(9))
            .andExpect(jsonPath("$.unmatched_count").value(2))
            .andExpect(jsonPath("$.cve_stubs_created").value(4));
    }

    @Test
    @DisplayName("GET .../security/register forwards snake_case filters (incl. component/service entity filters) + the comma-separated column set")
    void registerForwardsParameters() throws Exception {
        when(registerService.register(eq(PROJECT_ID), eq(ARCHITECTURE_ID), isNull(),
                eq("app-1"), eq("comp-1"), eq("svc-1"),
                eq("unmatched"), eq("high"), eq("spring"),
                eq(List.of("finding_id", "title")), eq(2), eq(25)))
            .thenReturn(new SecurityRegisterResponse(
                List.of(Map.of("finding_id", "f-1", "title", "Spring DoS")),
                1, 2, 25, List.of("finding_id", "title")));

        mockMvc.perform(get(BASE + "/register")
                .param("application_id", "app-1")
                .param("application_component_id", "comp-1")
                .param("service_id", "svc-1")
                .param("match_status", "unmatched")
                .param("severity", "high")
                .param("text", "spring")
                .param("columns", "finding_id, title")
                .param("page", "2")
                .param("size", "25"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.total").value(1))
            .andExpect(jsonPath("$.columns[0]").value("finding_id"))
            .andExpect(jsonPath("$.data[0].title").value("Spring DoS"));

        verify(registerService).register(eq(PROJECT_ID), eq(ARCHITECTURE_ID), isNull(),
            eq("app-1"), eq("comp-1"), eq("svc-1"),
            eq("unmatched"), eq("high"), eq("spring"),
            eq(List.of("finding_id", "title")), eq(2), eq(25));
    }

    @Test
    @DisplayName("GET .../security/rollup answers the per-application counts + not-matched bucket; report_id param selects history")
    void rollup() throws Exception {
        when(registerService.rollup(PROJECT_ID, ARCHITECTURE_ID, REPORT_ID))
            .thenReturn(new SecurityRollupDto(REPORT_ID, NOW, "application",
                List.of(new SecurityRollupDto.EntityEntry(
                    "application", "app-1", "MRX", "app-1", null, Map.of("high", 3L))),
                List.of(new SecurityRollupDto.Entry("app-1", "MRX",
                    Map.of("high", 3L))),
                Map.of("critical", 1L),
                Map.of("high", 3L, "critical", 1L)));

        mockMvc.perform(get(BASE + "/rollup").param("report_id", REPORT_ID.toString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.report_id").value(REPORT_ID.toString()))
            .andExpect(jsonPath("$.association_level").value("application"))
            .andExpect(jsonPath("$.entities[0].entity_name").value("MRX"))
            .andExpect(jsonPath("$.entities[0].level").value("application"))
            .andExpect(jsonPath("$.entities[0].counts.high").value(3))
            .andExpect(jsonPath("$.applications[0].application_name").value("MRX"))
            .andExpect(jsonPath("$.applications[0].counts.high").value(3))
            .andExpect(jsonPath("$.unmatched.critical").value(1));
    }

    @Test
    @DisplayName("GET .../security/reports lists history newest first on the snake_case wire")
    void listReports() throws Exception {
        when(registerService.listReportHistory(PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(List.of(new SecurityFindingReportDto(
                REPORT_ID, PROJECT_ID, ARCHITECTURE_ID, "gitlab_export", "application",
                List.of("a.csv"), Map.of("Severity", "severity"), NOW, Boolean.TRUE,
                9, 1, "notes")));

        mockMvc.perform(get(BASE + "/reports"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].id").value(REPORT_ID.toString()))
            .andExpect(jsonPath("$[0].is_latest").value(true))
            .andExpect(jsonPath("$[0].association_level").value("application"))
            .andExpect(jsonPath("$[0].original_filenames[0]").value("a.csv"));
    }
}
