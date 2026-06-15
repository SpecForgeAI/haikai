package com.example.architecturemodel.controller.migration;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.service.migration.MissingInputCrossStoryMatcherService;
import com.example.architecturemodel.service.migration.MissingInputCrossStoryMatcherService.ReadyToRetryStoryRow;
import com.example.architecturemodel.service.migration.MissingInputCrossStoryMatcherService.ReadyToRetrySummary;
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

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc tests for {@link SpecGenerationRetryController}.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 4.1.</p>
 *
 * <p>Two focused tests:</p>
 * <ol>
 *   <li>{@link #getReadyToRetryReturnsCountAndSpecs} -- GET returns the
 *       count, the spec-id list, and the per-spec readiness rows from the
 *       matcher.</li>
 *   <li>{@link #postRetryBatchReturns501UseGatewayEnvelope} -- POST always
 *       returns HTTP 501 with the structured "use the gateway" envelope.
 *       Documents the contract that retry orchestration lives at the
 *       gateway (see class-level javadoc on the controller).</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class SpecGenerationRetryControllerTest {

    @Mock
    private MissingInputCrossStoryMatcherService matcherService;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID SPEC_A =
        UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID WORK_ITEM_A =
        UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID SPEC_B =
        UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final UUID WORK_ITEM_B =
        UUID.fromString("55555555-5555-5555-5555-555555555555");

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
            .standaloneSetup(new SpecGenerationRetryController(matcherService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        objectMapper = new ObjectMapper();
    }

    @Test
    @DisplayName("GET /ready-to-retry returns the count + spec ids + per-spec readiness rows")
    void getReadyToRetryReturnsCountAndSpecs() throws Exception {
        ReadyToRetryStoryRow a = new ReadyToRetryStoryRow(
            SPEC_A, WORK_ITEM_A, null, 2, 2);
        ReadyToRetryStoryRow b = new ReadyToRetryStoryRow(
            SPEC_B, WORK_ITEM_B, "Migrate Payments API", 1, 1);
        ReadyToRetrySummary summary = new ReadyToRetrySummary(
            2, List.of(SPEC_A, SPEC_B), List.of(a, b));
        when(matcherService.findReadyToRetry(eq(PROJECT_ID))).thenReturn(summary);

        mockMvc.perform(get(
                "/api/projects/{p}/spec-generations/ready-to-retry", PROJECT_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.count").value(2))
            .andExpect(jsonPath("$.specGenerationIds.length()").value(2))
            .andExpect(jsonPath("$.specGenerationIds[0]").value(SPEC_A.toString()))
            .andExpect(jsonPath("$.specGenerationIds[1]").value(SPEC_B.toString()))
            .andExpect(jsonPath("$.specs.length()").value(2))
            .andExpect(jsonPath("$.specs[0].specGenerationId").value(SPEC_A.toString()))
            .andExpect(jsonPath("$.specs[0].workItemId").value(WORK_ITEM_A.toString()))
            .andExpect(jsonPath("$.specs[0].totalKeys").value(2))
            .andExpect(jsonPath("$.specs[0].missingInputKeyCount").value(2))
            .andExpect(jsonPath("$.specs[0].resolvedKeys").value(2))
            .andExpect(jsonPath("$.specs[1].title").value("Migrate Payments API"))
            .andExpect(jsonPath("$.specs[1].missingInputKeyCount").value(1));

        verify(matcherService).findReadyToRetry(PROJECT_ID);
    }

    @Test
    @DisplayName("POST /retry-batch returns 501 with the use_gateway_retry envelope -- orchestration lives at the gateway")
    void postRetryBatchReturns501UseGatewayEnvelope() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
            "workItemIds", List.of(SPEC_A.toString(), SPEC_B.toString())));

        mockMvc.perform(post(
                "/api/projects/{p}/spec-generations/retry-batch", PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isNotImplemented())
            .andExpect(jsonPath("$.status").value(501))
            .andExpect(jsonPath("$.error").value("Not Implemented"))
            .andExpect(jsonPath("$.code").value(
                SpecGenerationRetryController.USE_GATEWAY_CODE))
            .andExpect(jsonPath("$.message")
                .value(org.hamcrest.Matchers.containsString("gateway")));
    }
}
