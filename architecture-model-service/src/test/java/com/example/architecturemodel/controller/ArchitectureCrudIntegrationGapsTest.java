package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.mapper.ArchitectureMapper;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ArchitectureTagRepository;
import com.example.architecturemodel.service.ArchitectureService;
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

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Spec #3 Task Group 8 strategic gap-fill tests for the Architecture CRUD layer.
 *
 * Two tests added to fill specific holes left by the Group 1 unit-style tests:
 *
 *   1. Case-insensitive duplicate-name enforcement is invoked for ALL of
 *      "default", "Default", "DEFAULT" (and similar variants). The Group 1
 *      test only covered the lower->lower variant; this test exercises the
 *      controller -> service -> repository hand-off for three case shapes
 *      to make the case-insensitive behaviour visible at the seam where the
 *      frontend's spec-required surface lives.
 *
 *   2. The archive flow correctly invokes the last-architecture-protection
 *      check before persisting (i.e. when count > 1, the archive proceeds
 *      and the entity is saved with archived=true). The Group 1 test
 *      covered the protection trigger (count <= 1 -> 422); this test covers
 *      the happy path so the integration of countByProjectIdAndArchivedFalse
 *      with the actual save is verified end-to-end through the controller
 *      surface.
 *
 * Uses standalone MockMvc setup (mirrors ArchitectureCrudControllerTest) so
 * the test class is self-contained and avoids the Spring application
 * context, which is known to have unrelated pre-existing test failures.
 */
@ExtendWith(MockitoExtension.class)
class ArchitectureCrudIntegrationGapsTest {

    @Mock
    private ArchitectureRepository architectureRepository;
    @Mock
    private ArchitectureTagRepository architectureTagRepository;

    private ArchitectureService architectureService;
    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID ARCH_ID =
        UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    @BeforeEach
    void setUp() {
        ArchitectureMapper architectureMapper = new ArchitectureMapper();
        architectureService = new ArchitectureService(
            architectureRepository, architectureTagRepository, architectureMapper);
        ArchitectureController controller = new ArchitectureController(architectureService, null, null, null);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        objectMapper = new ObjectMapper();
    }

    // ========================================================================
    // Gap test 1 -- safety property (a) extended:
    // case-insensitive duplicate enforcement for "default", "Default",
    // "DEFAULT" (all three case variants must trigger 409).
    //
    // The controller / service must always pass the trimmed name through to
    // the repository's existsByProjectIdAndNameIgnoreCase call, which then
    // returns true for any case-equivalent existing row.
    // ========================================================================
    @Test
    @DisplayName("POST returns 409 case-insensitively for 'default', 'Default', and 'DEFAULT' when 'Default' already exists")
    void createArchitecture_caseInsensitiveDuplicate_acrossThreeCaseVariants_returns409() throws Exception {
        // The repository's case-insensitive existence check returns true for
        // any case-equivalent name already in the project. Mock that
        // behaviour for any input.
        when(architectureRepository.existsByProjectIdAndNameIgnoreCase(eq(PROJECT_ID), any()))
            .thenReturn(true);

        for (String variant : List.of("default", "Default", "DEFAULT")) {
            String body = objectMapper.writeValueAsString(Map.of(
                "name", variant,
                "tags", List.of()));

            mockMvc.perform(post("/api/projects/{projectId}/architectures", PROJECT_ID)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(body))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("duplicate_name"))
                .andExpect(jsonPath("$.field").value("name"))
                .andExpect(jsonPath("$.message").value(
                    "An architecture named '" + variant + "' already exists in this project."));
        }

        // Critical: no insertion should ever have happened across the three
        // duplicate attempts.
        verify(architectureRepository, never()).save(any());
    }

    // ========================================================================
    // Gap test 2 -- archive happy path (last-architecture protection passes
    // because count > 1, so the archive proceeds and persists).
    //
    // The Group 1 test covered the rejection arm. This covers the success
    // arm: 200 + the row saved with archived=true.
    // ========================================================================
    @Test
    @DisplayName("POST /archive returns 200 and persists archived=true when count > 1 (protection passes)")
    void archiveArchitecture_countGreaterThanOne_persistsArchivedTrue() throws Exception {
        ArchitectureEntity target = ArchitectureEntity.builder()
            .id(ARCH_ID)
            .projectId(PROJECT_ID)
            .name("Variant")
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        when(architectureRepository.findById(ARCH_ID)).thenReturn(Optional.of(target));
        // Two non-archived rows -> last-architecture protection passes.
        when(architectureRepository.countByProjectIdAndArchivedFalse(PROJECT_ID)).thenReturn(2L);
        when(architectureRepository.save(any(ArchitectureEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        when(architectureTagRepository.findByArchitectureId(ARCH_ID)).thenReturn(List.of());

        mockMvc.perform(post(
                "/api/projects/{projectId}/architectures/{architectureId}/archive",
                PROJECT_ID, ARCH_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(ARCH_ID.toString()))
            .andExpect(jsonPath("$.archived").value(true));

        // Save fired exactly once with archived=true on the entity.
        verify(architectureRepository, times(1)).save(any(ArchitectureEntity.class));
        // Confirm the entity that was saved had archived flipped to true.
        org.junit.jupiter.api.Assertions.assertTrue(target.getArchived(),
            "expected target.archived to be flipped to true on save");
    }
}
