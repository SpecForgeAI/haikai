package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourDiffItemDto;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourDiffItemService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc test for {@link ApiBehaviourDiffItemController}'s list endpoint.
 *
 * <p>Covers Task Group 2.1 of the API Test Harness — Diff Engine spec
 * (2026-05-25): the list endpoint returns items in deterministic
 * (method, path) order -- backed by the
 * {@code findByDiffIdOrderByMethodAscPathAsc} repository finder.</p>
 */
@ExtendWith(MockitoExtension.class)
class ApiBehaviourDiffItemControllerTest {

    @Mock
    private ApiBehaviourDiffItemService diffItemService;

    private MockMvc mockMvc;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID DIFF_ID =
        UUID.fromString("33333333-3333-3333-3333-333333333333");

    private static final Instant NOW = Instant.parse("2026-05-25T10:00:00Z");

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
            .standaloneSetup(new ApiBehaviourDiffItemController(diffItemService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    @Test
    @DisplayName("GET .../diffs/{diffId}/items returns items in deterministic (method, path) order")
    void listReturnsItemsInOrder() throws Exception {
        ApiBehaviourDiffItemDto a = new ApiBehaviourDiffItemDto(
            UUID.randomUUID(), DIFF_ID,
            "GET", "/a", "happy-path",
            UUID.randomUUID(), UUID.randomUUID(),
            "status_match", "body_match",
            200, 200,
            null,
            null,
            NOW
        );
        ApiBehaviourDiffItemDto b = new ApiBehaviourDiffItemDto(
            UUID.randomUUID(), DIFF_ID,
            "GET", "/b", "happy-path",
            UUID.randomUUID(), UUID.randomUUID(),
            "status_drift", null,
            200, 500,
            null,
            null,
            NOW
        );
        ApiBehaviourDiffItemDto c = new ApiBehaviourDiffItemDto(
            UUID.randomUUID(), DIFF_ID,
            "POST", "/a", "happy-path",
            UUID.randomUUID(), null,
            "source_only", null,
            201, null,
            null,
            "mutating_skipped",
            NOW
        );
        when(diffItemService.listByDiffId(PROJECT_ID, DIFF_ID))
            .thenReturn(List.of(a, b, c));

        mockMvc.perform(get(
                "/api/projects/{projectId}/api-behaviour/diffs/{diffId}/items",
                PROJECT_ID, DIFF_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(3))
            .andExpect(jsonPath("$[0].method").value("GET"))
            .andExpect(jsonPath("$[0].path").value("/a"))
            .andExpect(jsonPath("$[0].statusClassification").value("status_match"))
            .andExpect(jsonPath("$[0].bodyClassification").value("body_match"))
            .andExpect(jsonPath("$[1].method").value("GET"))
            .andExpect(jsonPath("$[1].path").value("/b"))
            .andExpect(jsonPath("$[1].statusClassification").value("status_drift"))
            .andExpect(jsonPath("$[2].method").value("POST"))
            .andExpect(jsonPath("$[2].path").value("/a"))
            .andExpect(jsonPath("$[2].statusClassification").value("source_only"))
            .andExpect(jsonPath("$[2].notes").value("mutating_skipped"));

        verify(diffItemService).listByDiffId(PROJECT_ID, DIFF_ID);
    }
}
