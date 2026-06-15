package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.mapper.WorkItemMapper;
import com.example.architecturemodel.model.dto.WorkItemDto;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.service.WorkItemService;
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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Tests for the work-item implementation git-outcome fields
 * (implementation_branch / implementation_pr_url / implementation_logs_url).
 *
 * <p>Spec 2026-06-12: Implementation-Service Init and Integration Repair --
 * Task Group 1. Covers (a) the snake_case wire round-trip through
 * {@link WorkItemController} (the {@code @JsonProperty} annotations make the
 * wire format independent of the ObjectMapper's naming strategy), and (b) the
 * null-guarded update semantics in
 * {@link WorkItemMapper#updateEntityFromDto}: an update that omits the
 * outcome fields must never wipe a stored branch/PR/logs URL.</p>
 */
@ExtendWith(MockitoExtension.class)
class WorkItemImplementationOutcomeTest {

    @Mock
    private WorkItemService workItemService;

    private MockMvc mockMvc;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ITEM_ID = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        WorkItemController controller = new WorkItemController(workItemService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    @Test
    @DisplayName("PUT /work-items/{id} round-trips implementation_branch / _pr_url / _logs_url snake_case")
    void outcomeFieldsRoundTripSnakeCase() throws Exception {
        Instant now = Instant.now();
        WorkItemDto persisted = new WorkItemDto(
            ITEM_ID, PROJECT_ID, "STORY", null, "Implement spec", null,
            "DEV_COMPLETE", 0, null, null, null, null, null, null, now, now,
            "feature/2026-06-12-impl-init",
            "https://github.com/acme/backend/pull/42",
            "https://jobs.example.com/jobs/job-1/logs");
        when(workItemService.updateWorkItem(eq(ITEM_ID), any(WorkItemDto.class)))
            .thenReturn(persisted);

        String body = """
            {
              "title": "Implement spec",
              "implementation_branch": "feature/2026-06-12-impl-init",
              "implementation_pr_url": "https://github.com/acme/backend/pull/42",
              "implementation_logs_url": "https://jobs.example.com/jobs/job-1/logs"
            }
            """;

        mockMvc.perform(put("/api/model/projects/{projectId}/work-items/{id}", PROJECT_ID, ITEM_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.implementation_branch")
                .value("feature/2026-06-12-impl-init"))
            .andExpect(jsonPath("$.implementation_pr_url")
                .value("https://github.com/acme/backend/pull/42"))
            .andExpect(jsonPath("$.implementation_logs_url")
                .value("https://jobs.example.com/jobs/job-1/logs"));

        // The snake_case request keys must deserialise onto the DTO components.
        ArgumentCaptor<WorkItemDto> captor = ArgumentCaptor.forClass(WorkItemDto.class);
        verify(workItemService).updateWorkItem(eq(ITEM_ID), captor.capture());
        WorkItemDto parsed = captor.getValue();
        assertThat(parsed.implementationBranch()).isEqualTo("feature/2026-06-12-impl-init");
        assertThat(parsed.implementationPrUrl()).isEqualTo("https://github.com/acme/backend/pull/42");
        assertThat(parsed.implementationLogsUrl()).isEqualTo("https://jobs.example.com/jobs/job-1/logs");
    }

    @Test
    @DisplayName("updateEntityFromDto null-guards the outcome fields: omitted (null) values never wipe stored ones")
    void updateEntityFromDtoNullGuardsOutcomeFields() {
        WorkItemEntity entity = WorkItemEntity.builder()
            .id(ITEM_ID)
            .projectId(PROJECT_ID)
            .type("STORY")
            .title("Implement spec")
            .implementationBranch("feature/existing-branch")
            .implementationPrUrl("https://github.com/acme/backend/pull/41")
            .implementationLogsUrl("https://jobs.example.com/jobs/job-0/logs")
            .build();

        // An ordinary edit (title/status change) that carries NO outcome fields.
        WorkItemDto editWithoutOutcome = new WorkItemDto(
            ITEM_ID, PROJECT_ID, "STORY", null, "Implement spec (renamed)", null,
            "IN_PROGRESS", 0, null, null, null, null, null, null, null, null);
        WorkItemMapper.updateEntityFromDto(entity, editWithoutOutcome);

        assertThat(entity.getTitle()).isEqualTo("Implement spec (renamed)");
        assertThat(entity.getImplementationBranch())
            .as("stored branch must survive an update that omits it")
            .isEqualTo("feature/existing-branch");
        assertThat(entity.getImplementationPrUrl())
            .isEqualTo("https://github.com/acme/backend/pull/41");
        assertThat(entity.getImplementationLogsUrl())
            .isEqualTo("https://jobs.example.com/jobs/job-0/logs");

        // And providing new values does update them.
        WorkItemDto outcomeUpdate = new WorkItemDto(
            ITEM_ID, PROJECT_ID, "STORY", null, "Implement spec (renamed)", null,
            null, null, null, null, null, null, null, null, null, null,
            "feature/new-branch", "https://github.com/acme/backend/pull/42", null);
        WorkItemMapper.updateEntityFromDto(entity, outcomeUpdate);

        assertThat(entity.getImplementationBranch()).isEqualTo("feature/new-branch");
        assertThat(entity.getImplementationPrUrl())
            .isEqualTo("https://github.com/acme/backend/pull/42");
        assertThat(entity.getImplementationLogsUrl())
            .as("logs URL omitted on the second update stays intact")
            .isEqualTo("https://jobs.example.com/jobs/job-0/logs");
    }
}
