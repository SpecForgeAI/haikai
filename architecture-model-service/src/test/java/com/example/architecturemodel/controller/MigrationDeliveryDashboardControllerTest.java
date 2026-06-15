package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.MigrationDeliveryBacklogSaveSummaryDto;
import com.example.architecturemodel.model.dto.MigrationDeliveryDashboardDto;
import com.example.architecturemodel.model.dto.MigrationDeliveryEvidenceSummaryDto;
import com.example.architecturemodel.model.dto.MigrationDeliveryHierarchyNodeDto;
import com.example.architecturemodel.model.dto.MigrationDeliveryImplementationSummaryDto;
import com.example.architecturemodel.model.dto.MigrationDeliveryNeedsAttentionItemDto;
import com.example.architecturemodel.model.dto.MigrationDeliverySpecGenerationSummaryDto;
import com.example.architecturemodel.model.dto.MigrationDeliverySummaryDto;
import com.example.architecturemodel.model.dto.MigrationDeliveryWorkstreamSummaryDto;
import com.example.architecturemodel.model.dto.MissingInputEntry;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.service.MigrationDeliveryDashboardService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Collections;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Controller tests for {@link MigrationDeliveryDashboardController}.
 *
 * <p>Covers AMS test 1 (returns 200 with full DTO for a saved book) and AMS
 * test 19 (DTO field set on the wire matches the contract). The DTO contract
 * is also asserted at record-shape level in
 * {@code MigrationDeliveryDashboardDtoContractTest}; this class confirms the
 * field set survives Spring's JSON serialization end-to-end through the
 * controller -- the surface downstream callers actually see.</p>
 *
 * <p>Modeled structurally on
 * {@link com.example.architecturemodel.controller.DiscoveryRunControllerTest}
 * (same {@code @WebMvcTest} + {@code @MockBean} pattern).</p>
 *
 * <p>Log prefix for new diagnostic lines: {@code [diag-ams] migration-delivery-dashboard ...}.</p>
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19) --
 * tasks.md sub-tasks 5.3, 5.4. AC 1, AC 19.</p>
 */
@WebMvcTest(MigrationDeliveryDashboardController.class)
class MigrationDeliveryDashboardControllerTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID BOOK_ID = UUID.randomUUID();
    private static final UUID CURRENT_ARCH_ID = UUID.randomUUID();
    private static final UUID TARGET_ARCH_ID = UUID.randomUUID();
    private static final String URL = "/api/projects/{projectId}/migration-books-of-work/{bookId}/delivery-dashboard";

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private MigrationDeliveryDashboardService dashboardService;

    @MockBean
    private ProjectRepository projectRepository;

    // -----------------------------------------------------------------------
    // AMS test 1 -- GET returns 200 with the populated DTO.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 1 -- GET /delivery-dashboard returns 200 with full DTO for a saved book")
    void returns200WithFullDtoForSavedBook() throws Exception {
        when(projectRepository.existsById(PROJECT_ID)).thenReturn(true);

        MigrationDeliveryDashboardDto dto = buildPopulatedDto();
        when(dashboardService.loadDashboard(eq(PROJECT_ID), eq(BOOK_ID))).thenReturn(dto);

        mockMvc.perform(get(URL, PROJECT_ID, BOOK_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentTypeCompatibleWith("application/json"))
            .andExpect(jsonPath("$.book_of_work_id").value(BOOK_ID.toString()))
            .andExpect(jsonPath("$.project_id").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.current_architecture_id").value(CURRENT_ARCH_ID.toString()))
            .andExpect(jsonPath("$.target_architecture_id").value(TARGET_ARCH_ID.toString()))
            .andExpect(jsonPath("$.title").value("Test Book"))
            .andExpect(jsonPath("$.status").value("ACTIVE"))
            .andExpect(jsonPath("$.summary.total_initiative_count").value(1))
            .andExpect(jsonPath("$.summary.total_story_count").value(2))
            .andExpect(jsonPath("$.hierarchy[0].id").value("I1"))
            .andExpect(jsonPath("$.workstream_summaries[0].workstream").value("Alpha"))
            .andExpect(jsonPath("$.spec_generation_summary.generated_count").value(1))
            .andExpect(jsonPath("$.backlog_save_summary.saved_count").value(2))
            .andExpect(jsonPath("$.implementation_summary.not_started_count").value(2))
            .andExpect(jsonPath("$.evidence_summary.any_coverage_count").value(1))
            .andExpect(jsonPath("$.needs_attention[0].type").value("insufficient_context"))
            .andExpect(jsonPath("$.needs_attention[0].missing_inputs[0].kind").value("Mapping"))
            .andExpect(jsonPath("$.warnings").isArray());
    }

    // -----------------------------------------------------------------------
    // AMS test 19 (wire-level companion) -- top-level DTO field set on the
    // wire matches the contract. The record-shape assertion lives in
    // MigrationDeliveryDashboardDtoContractTest; this test confirms the field
    // names survive Jackson serialization through the controller.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 19 -- wire response exposes the 16 contract field names (snake_case)")
    void wireResponseExposesAllContractFields() throws Exception {
        when(projectRepository.existsById(PROJECT_ID)).thenReturn(true);
        when(dashboardService.loadDashboard(eq(PROJECT_ID), eq(BOOK_ID)))
            .thenReturn(buildPopulatedDto());

        mockMvc.perform(get(URL, PROJECT_ID, BOOK_ID))
            .andExpect(status().isOk())
            // All 16 top-level fields must be present on the JSON body.
            .andExpect(jsonPath("$.book_of_work_id").exists())
            .andExpect(jsonPath("$.project_id").exists())
            .andExpect(jsonPath("$.current_architecture_id").exists())
            .andExpect(jsonPath("$.target_architecture_id").exists())
            .andExpect(jsonPath("$.title").exists())
            .andExpect(jsonPath("$.status").exists())
            .andExpect(jsonPath("$.generated_at").exists())
            .andExpect(jsonPath("$.summary").exists())
            .andExpect(jsonPath("$.hierarchy").exists())
            .andExpect(jsonPath("$.workstream_summaries").exists())
            .andExpect(jsonPath("$.spec_generation_summary").exists())
            .andExpect(jsonPath("$.backlog_save_summary").exists())
            .andExpect(jsonPath("$.implementation_summary").exists())
            .andExpect(jsonPath("$.evidence_summary").exists())
            .andExpect(jsonPath("$.needs_attention").exists())
            .andExpect(jsonPath("$.warnings").exists());
    }

    // -----------------------------------------------------------------------
    // Supporting -- 404 paths confirm the controller surface for project
    // mismatch and book-not-found (already covered structurally by tasks.md
    // 5.2). Kept brief here.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Unknown project -> 404")
    void unknownProjectReturns404() throws Exception {
        when(projectRepository.existsById(PROJECT_ID)).thenReturn(false);

        mockMvc.perform(get(URL, PROJECT_ID, BOOK_ID))
            .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("Book not found / project mismatch -> 404 (controller maps ResourceNotFoundException)")
    void bookNotFoundReturns404() throws Exception {
        when(projectRepository.existsById(PROJECT_ID)).thenReturn(true);
        when(dashboardService.loadDashboard(eq(PROJECT_ID), eq(BOOK_ID)))
            .thenThrow(new ResourceNotFoundException("Migration book of work not found: " + BOOK_ID));

        mockMvc.perform(get(URL, PROJECT_ID, BOOK_ID))
            .andExpect(status().isNotFound());
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private MigrationDeliveryDashboardDto buildPopulatedDto() {
        MigrationDeliverySummaryDto summary = new MigrationDeliverySummaryDto(
            1L, 1L, 1L, 2L, 1L);
        MigrationDeliveryHierarchyNodeDto storyNode = new MigrationDeliveryHierarchyNodeDto(
            "S1", "F1", "story", "Story 1", "Alpha", 0,
            UUID.randomUUID(), "saved", "insufficient_context", "low",
            "not_started", "no_coverage", 1L, 2L, Collections.emptyList());
        MigrationDeliveryHierarchyNodeDto featureNode = new MigrationDeliveryHierarchyNodeDto(
            "F1", "E1", "feature", "Feature 1", "Alpha", 0, null,
            "not_saved_to_backlog", null, null, null, "no_coverage", 1L, 2L,
            List.of(storyNode));
        MigrationDeliveryHierarchyNodeDto epicNode = new MigrationDeliveryHierarchyNodeDto(
            "E1", "I1", "epic", "Epic 1", "Alpha", 0, null,
            "not_saved_to_backlog", null, null, null, "no_coverage", 1L, 2L,
            List.of(featureNode));
        MigrationDeliveryHierarchyNodeDto initiativeNode = new MigrationDeliveryHierarchyNodeDto(
            "I1", null, "initiative", "Initiative 1", "Alpha", 0, null,
            "not_saved_to_backlog", null, null, null, "no_coverage", 1L, 2L,
            List.of(epicNode));

        MigrationDeliveryWorkstreamSummaryDto workstream = new MigrationDeliveryWorkstreamSummaryDto(
            "Alpha", 2L, 2L, 1L, 0L, 1L, 1L);

        MigrationDeliverySpecGenerationSummaryDto specs =
            new MigrationDeliverySpecGenerationSummaryDto(0L, 1L, 0L, 1L, 0L, 0L);
        MigrationDeliveryBacklogSaveSummaryDto backlog =
            new MigrationDeliveryBacklogSaveSummaryDto(2L, 0L);
        MigrationDeliveryImplementationSummaryDto impl =
            new MigrationDeliveryImplementationSummaryDto(2L, 0L, 0L, 0L, 0L);
        MigrationDeliveryEvidenceSummaryDto evidence =
            new MigrationDeliveryEvidenceSummaryDto(1L, 0L, 0L, 0L, 0L, 1L);

        MigrationDeliveryNeedsAttentionItemDto needsItem = new MigrationDeliveryNeedsAttentionItemDto(
            "S1", UUID.randomUUID(), "insufficient_context", 1,
            "Story 1", "Alpha",
            "insufficient_context", "low", "not_started",
            "Spec generation reported insufficient context.",
            List.of(
                new MissingInputEntry("Mapping", "map-1", "No mapping for endpoint /foo"),
                new MissingInputEntry("Baseline", null, "API baseline absent")));

        return new MigrationDeliveryDashboardDto(
            BOOK_ID,
            PROJECT_ID,
            CURRENT_ARCH_ID,
            TARGET_ARCH_ID,
            "Test Book",
            "ACTIVE",
            "2026-05-19T10:00:00Z",
            summary,
            List.of(initiativeNode),
            List.of(workstream),
            specs,
            backlog,
            impl,
            evidence,
            List.of(needsItem),
            Collections.emptyList());
    }
}
