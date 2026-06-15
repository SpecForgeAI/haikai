package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.BulkRecomputeQualityResult;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.RecomputeQualityResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc tests for the two new quality-recompute endpoints on
 * {@link MigrationStorySpecGenerationController}.
 *
 * <p>Spec: Spec Quality Scoring (2026-05-20) -- Task Group 4.1.</p>
 *
 * <p>Standalone setup mirrors {@code EpicCapturedDecisionsControllerTest}: no
 * full Spring context (AMS has pre-existing compile / wiring issues on this
 * branch), and {@link GlobalExceptionHandler} is wired by hand so error
 * envelopes follow production mapping. Tests use the default camelCase JSON
 * mapping since {@code MockMvcBuilders.standaloneSetup} does not load the
 * application's SNAKE_CASE configuration.</p>
 *
 * <p>Tests cover:</p>
 * <ol>
 *   <li>Single-row recompute returns the four quality fields verbatim from
 *       the service.</li>
 *   <li>Single-row recompute on a missing spec id returns 404.</li>
 *   <li>Single-row recompute on an {@code insufficient_context}-style row
 *       returns 200 with all four nullable fields null + the
 *       {@code "N/A: no spec text to assess"} message.</li>
 *   <li>Bulk recompute returns the {@code totalScored} + {@code totalSkipped}
 *       + {@code gradeBreakdown} summary verbatim.</li>
 *   <li>Bulk recompute counts insufficient_context + failed rows into
 *       {@code na} (not {@code F}) via the service's grade breakdown.</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class MigrationStorySpecGenerationControllerQualityRecomputeTest {

    @Mock
    private MigrationStorySpecGenerationService service;

    private MockMvc mockMvc;
    @SuppressWarnings("unused")
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID SPEC_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
            .standaloneSetup(new MigrationStorySpecGenerationController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        objectMapper = new ObjectMapper();
    }

    // -----------------------------------------------------------------------
    // 1) Single-row recompute returns the quality fields verbatim
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("single-row recompute returns qualityScore + qualityGrade + qualityDimensions + previousQualityScore from the service")
    void singleRow_returnsQualityFieldsFromService() throws Exception {
        Map<String, Object> dim1 = new LinkedHashMap<>();
        dim1.put("name", "completeness");
        dim1.put("score", 86);
        dim1.put("reason", "7/7 expected sections present");
        Map<String, Object> dim2 = new LinkedHashMap<>();
        dim2.put("name", "ac_measurability");
        dim2.put("score", 75);
        dim2.put("reason", "3 of 4 ACs include measurable signals; weakest: x");

        RecomputeQualityResult result = new RecomputeQualityResult(
            88, "A", List.of(dim1, dim2), 60, null);
        when(service.recomputeQualityForSpec(eq(PROJECT_ID), eq(SPEC_ID)))
            .thenReturn(result);

        mockMvc.perform(post(
                "/api/projects/{p}/spec-generations/{s}/recompute-quality",
                PROJECT_ID, SPEC_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.qualityScore").value(88))
            .andExpect(jsonPath("$.qualityGrade").value("A"))
            .andExpect(jsonPath("$.previousQualityScore").value(60))
            .andExpect(jsonPath("$.qualityDimensions").isArray())
            .andExpect(jsonPath("$.qualityDimensions[0].name").value("completeness"))
            .andExpect(jsonPath("$.qualityDimensions[0].score").value(86))
            .andExpect(jsonPath("$.qualityDimensions[1].name").value("ac_measurability"))
            .andExpect(jsonPath("$.qualityDimensions[1].score").value(75));

        verify(service).recomputeQualityForSpec(eq(PROJECT_ID), eq(SPEC_ID));
    }

    // -----------------------------------------------------------------------
    // 2) Spec id not found / cross-project -> 404 (service throws RNFE)
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("single-row recompute returns 404 when service throws ResourceNotFoundException (missing or cross-project)")
    void singleRow_returns404OnResourceNotFound() throws Exception {
        when(service.recomputeQualityForSpec(eq(PROJECT_ID), eq(SPEC_ID)))
            .thenThrow(new ResourceNotFoundException(
                "Spec generation row not found: " + SPEC_ID));

        mockMvc.perform(post(
                "/api/projects/{p}/spec-generations/{s}/recompute-quality",
                PROJECT_ID, SPEC_ID))
            .andExpect(status().isNotFound());

        verify(service).recomputeQualityForSpec(eq(PROJECT_ID), eq(SPEC_ID));
    }

    // -----------------------------------------------------------------------
    // 3) insufficient_context -> 200 with null fields + N/A message
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("single-row recompute on insufficient_context row returns 200 with null fields + N/A message")
    void singleRow_insufficientContext_returnsNaResponse() throws Exception {
        RecomputeQualityResult result = new RecomputeQualityResult(
            null, null, null, null, "N/A: no spec text to assess");
        when(service.recomputeQualityForSpec(eq(PROJECT_ID), eq(SPEC_ID)))
            .thenReturn(result);

        mockMvc.perform(post(
                "/api/projects/{p}/spec-generations/{s}/recompute-quality",
                PROJECT_ID, SPEC_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.qualityScore").doesNotExist())
            .andExpect(jsonPath("$.qualityGrade").doesNotExist())
            .andExpect(jsonPath("$.qualityDimensions").doesNotExist())
            .andExpect(jsonPath("$.previousQualityScore").doesNotExist())
            .andExpect(jsonPath("$.message").value("N/A: no spec text to assess"));
    }

    // -----------------------------------------------------------------------
    // 4) Bulk recompute returns summary shape verbatim
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("bulk recompute returns totalScored + totalSkipped + gradeBreakdown from the service")
    void bulk_returnsSummaryShape() throws Exception {
        Map<String, Integer> grades = new LinkedHashMap<>();
        grades.put("A", 3);
        grades.put("B", 5);
        grades.put("C", 2);
        grades.put("D", 1);
        grades.put("F", 0);
        grades.put("na", 4);
        BulkRecomputeQualityResult result =
            new BulkRecomputeQualityResult(11, 4, grades);
        when(service.bulkRecomputeQualityForProject(eq(PROJECT_ID)))
            .thenReturn(result);

        mockMvc.perform(post(
                "/api/projects/{p}/spec-generations/recompute-quality-bulk",
                PROJECT_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.totalScored").value(11))
            .andExpect(jsonPath("$.totalSkipped").value(4))
            .andExpect(jsonPath("$.gradeBreakdown.A").value(3))
            .andExpect(jsonPath("$.gradeBreakdown.B").value(5))
            .andExpect(jsonPath("$.gradeBreakdown.C").value(2))
            .andExpect(jsonPath("$.gradeBreakdown.D").value(1))
            .andExpect(jsonPath("$.gradeBreakdown.F").value(0))
            .andExpect(jsonPath("$.gradeBreakdown.na").value(4));

        verify(service).bulkRecomputeQualityForProject(eq(PROJECT_ID));
    }

    // -----------------------------------------------------------------------
    // 5) Bulk recompute counts skipped (insufficient_context + failed) into na
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("bulk recompute increments na (not F) for insufficient_context + failed rows")
    void bulk_naCountReflectsSkippedRows() throws Exception {
        // Simulate a project with only skipped rows -- totalScored=0, all
        // counts in na. F MUST remain zero.
        Map<String, Integer> grades = new LinkedHashMap<>();
        grades.put("A", 0);
        grades.put("B", 0);
        grades.put("C", 0);
        grades.put("D", 0);
        grades.put("F", 0);
        grades.put("na", 3);
        BulkRecomputeQualityResult result =
            new BulkRecomputeQualityResult(0, 3, grades);
        when(service.bulkRecomputeQualityForProject(eq(PROJECT_ID)))
            .thenReturn(result);

        mockMvc.perform(post(
                "/api/projects/{p}/spec-generations/recompute-quality-bulk",
                PROJECT_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.totalScored").value(0))
            .andExpect(jsonPath("$.totalSkipped").value(3))
            .andExpect(jsonPath("$.gradeBreakdown.na").value(3))
            .andExpect(jsonPath("$.gradeBreakdown.F").value(0));
    }
}
