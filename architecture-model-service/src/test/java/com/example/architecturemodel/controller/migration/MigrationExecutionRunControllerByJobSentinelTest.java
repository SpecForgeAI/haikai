package com.example.architecturemodel.controller.migration;

import com.example.architecturemodel.controller.MigrationExecutionRunController;
import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.model.dto.MigrationExecutionRunDto;
import com.example.architecturemodel.model.dto.MigrationExecutionRunItemDto;
import com.example.architecturemodel.service.MigrationExecutionRunService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Optional;
import java.util.UUID;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The {@code "by-job"} sentinel project segment MUST bind (2026-07-29).
 *
 * <p>Live failure: the gateway's build-results advance correlates purely on
 * the globally-unique job id and calls both lookup endpoints with the literal
 * project segment {@code "by-job"} (the real project id is recovered from the
 * run afterwards). Both handlers ignored {@code projectId} but declared it as
 * {@code @PathVariable UUID}, so Spring returned {@code 400 Bad Request}
 * before either handler ran — every migration run halted at spec 0 with
 * "driver advance failed". These tests pin the {@code String} declaration by
 * driving the EXACT sentinel URLs the gateway uses.</p>
 */
@ExtendWith(MockitoExtension.class)
class MigrationExecutionRunControllerByJobSentinelTest {

    @Mock
    private MigrationExecutionRunService service;

    private MockMvc mockMvc;

    private static final UUID RUN_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ITEM_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final String JOB_ID = "4e4971e7-0e46-4371-b774-7760eaacee78";

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
            .standaloneSetup(new MigrationExecutionRunController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    private static MigrationExecutionRunItemDto item() {
        return new MigrationExecutionRunItemDto(
            ITEM_ID, RUN_ID, 0, null, null, "2026-07-28-demo-spec",
            "submitted", Boolean.TRUE, JOB_ID, null, null, null,
            Boolean.FALSE, null, null, null, null, null, null, null, null);
    }

    private static MigrationExecutionRunDto run() {
        return new MigrationExecutionRunDto(
            RUN_ID, UUID.randomUUID(), UUID.randomUUID(), "dispatching",
            0, null, null, null, null, null);
    }

    @Test
    @DisplayName("GET by-job-id with the 'by-job' sentinel segment binds and returns the item (was 400)")
    void byJobIdLookupAcceptsSentinelSegment() throws Exception {
        when(service.findRunItemByJobId(JOB_ID)).thenReturn(Optional.of(item()));

        mockMvc.perform(get(
                "/api/projects/by-job/migration-execution-run-items/by-job-id/{jobId}",
                JOB_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.job_id").value(JOB_ID))
            .andExpect(jsonPath("$.run_id").value(RUN_ID.toString()));
    }

    @Test
    @DisplayName("GET run-state with the 'by-job' sentinel segment binds and returns the run (was 400)")
    void runStateLookupAcceptsSentinelSegment() throws Exception {
        when(service.getRunState(RUN_ID)).thenReturn(run());

        mockMvc.perform(get(
                "/api/projects/by-job/migration-execution-runs/{runId}", RUN_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(RUN_ID.toString()))
            .andExpect(jsonPath("$.status").value("dispatching"));
    }

    @Test
    @DisplayName("unknown job id under the sentinel is an honest 404, not a 400")
    void unknownJobIdIsNotFound() throws Exception {
        when(service.findRunItemByJobId("job-unknown")).thenReturn(Optional.empty());

        mockMvc.perform(get(
                "/api/projects/by-job/migration-execution-run-items/by-job-id/{jobId}",
                "job-unknown"))
            .andExpect(status().isNotFound());
    }
}
