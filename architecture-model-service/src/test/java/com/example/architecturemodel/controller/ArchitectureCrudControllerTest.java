package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.mapper.ArchitectureMapper;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.ArchitectureTagEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ArchitectureTagRepository;
import com.example.architecturemodel.service.ArchitectureService;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Focused tests for the new Architecture CRUD endpoints introduced in Spec #3.
 *
 * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3) -- Task Group 1.
 *
 * Required tests covered:
 *   1. {@link #createArchitecture_duplicateName_caseInsensitive_returns409()}
 *      -- safety property (a): duplicate name (case-insensitive) -> 409.
 *   2. {@link #archiveArchitecture_lastNonArchived_returns422()}
 *      -- safety property (b): cannot archive the last live architecture -> 422.
 *   3. {@link #updateArchitecture_replacesFullTagSetAtomically()}
 *      -- safety property (c): PATCH replaces the full tag set atomically.
 *   4. {@link #createArchitecture_happyPath_returns201()}
 *      -- happy path: 201 + new architecture body with tags.
 *   5. {@link #updateArchitecture_wrongProject_returns404()}
 *      -- 404 when architecture id belongs to a different project.
 *   6. {@link #createArchitecture_emptyName_returns400()}
 *      -- 400 on validation failure (empty name after trim).
 *
 * Uses standalone MockMvc setup (matches the project's pattern in
 * {@link ArchitectureScopedRoutesTest}) so the test class is self-contained
 * and avoids the Spring application context, which is known to have unrelated
 * pre-existing test failures per project memory.
 */
@ExtendWith(MockitoExtension.class)
class ArchitectureCrudControllerTest {

    @Mock
    private ArchitectureRepository architectureRepository;
    @Mock
    private ArchitectureTagRepository architectureTagRepository;

    private ArchitectureMapper architectureMapper;
    private ArchitectureService architectureService;
    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID OTHER_PROJECT_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID ARCH_ID =
        UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

    @BeforeEach
    void setUp() {
        architectureMapper = new ArchitectureMapper();
        architectureService = new ArchitectureService(
            architectureRepository, architectureTagRepository, architectureMapper);
        ArchitectureController controller = new ArchitectureController(architectureService, null, null, null);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        objectMapper = new ObjectMapper();
    }

    // ========================================================================
    // Test 1 -- safety property (a): duplicate name (case-insensitive) -> 409
    // ========================================================================
    @Test
    @DisplayName("POST returns 409 when name collides case-insensitively with an existing architecture")
    void createArchitecture_duplicateName_caseInsensitive_returns409() throws Exception {
        when(architectureRepository.existsByProjectIdAndNameIgnoreCase(PROJECT_ID, "default"))
            .thenReturn(true);

        String body = objectMapper.writeValueAsString(Map.of(
            "name", "default",
            "tags", List.of()));

        mockMvc.perform(post("/api/projects/{projectId}/architectures", PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("duplicate_name"))
            .andExpect(jsonPath("$.field").value("name"))
            .andExpect(jsonPath("$.message").value(
                "An architecture named 'default' already exists in this project."));

        // Critical: insertion must NOT have occurred when the name is a duplicate.
        verify(architectureRepository, never()).save(any());
    }

    // ========================================================================
    // Test 2 -- safety property (b): archive last -> 422
    // ========================================================================
    @Test
    @DisplayName("POST /archive returns 422 when only one non-archived architecture remains")
    void archiveArchitecture_lastNonArchived_returns422() throws Exception {
        ArchitectureEntity onlyOne = ArchitectureEntity.builder()
            .id(ARCH_ID)
            .projectId(PROJECT_ID)
            .name("Default")
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        when(architectureRepository.findById(ARCH_ID)).thenReturn(Optional.of(onlyOne));
        when(architectureRepository.countByProjectIdAndArchivedFalse(PROJECT_ID)).thenReturn(1L);

        mockMvc.perform(post(
                "/api/projects/{projectId}/architectures/{architectureId}/archive",
                PROJECT_ID, ARCH_ID))
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.code").value("last_architecture"))
            .andExpect(jsonPath("$.message").value(
                "A project must have at least one architecture."));

        // Critical: the archive flag must NOT have been flipped.
        verify(architectureRepository, never()).save(any());
    }

    // ========================================================================
    // Test 3 -- safety property (c): PATCH atomically replaces the full tag set
    // ========================================================================
    @Test
    @DisplayName("PATCH replaces the full tag set: pre-existing tags removed, new ones inserted")
    void updateArchitecture_replacesFullTagSetAtomically() throws Exception {
        ArchitectureEntity existing = ArchitectureEntity.builder()
            .id(ARCH_ID)
            .projectId(PROJECT_ID)
            .name("Default")
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        ArchitectureTagEntity tagA = ArchitectureTagEntity.builder()
            .architectureId(ARCH_ID).tagValue("a").build();
        ArchitectureTagEntity tagB = ArchitectureTagEntity.builder()
            .architectureId(ARCH_ID).tagValue("b").build();
        // After the delete-all + insert-all, the repository should return the new tags.
        ArchitectureTagEntity tagX = ArchitectureTagEntity.builder()
            .architectureId(ARCH_ID).tagValue("x").build();
        ArchitectureTagEntity tagY = ArchitectureTagEntity.builder()
            .architectureId(ARCH_ID).tagValue("y").build();

        when(architectureRepository.findById(ARCH_ID)).thenReturn(Optional.of(existing));
        when(architectureRepository.existsByProjectIdAndNameIgnoreCaseAndIdNot(
                eq(PROJECT_ID), any(), eq(ARCH_ID))).thenReturn(false);
        when(architectureRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        // First call: load the existing pre-payload tags (for deletion).
        // Second call: read the resulting state for the response DTO.
        when(architectureTagRepository.findByArchitectureId(ARCH_ID))
            .thenReturn(List.of(tagA, tagB))
            .thenReturn(List.of(tagX, tagY));

        String body = objectMapper.writeValueAsString(Map.of(
            "name", "Default",
            "description", "",
            "tags", List.of("x", "y")));

        mockMvc.perform(patch(
                "/api/projects/{projectId}/architectures/{architectureId}",
                PROJECT_ID, ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.tags[0]").value("x"))
            .andExpect(jsonPath("$.tags[1]").value("y"))
            .andExpect(jsonPath("$.tags.length()").value(2));

        // Verify the safety property: pre-existing tags are deleted as a unit.
        ArgumentCaptor<Iterable<ArchitectureTagEntity>> deleteCaptor =
            ArgumentCaptor.forClass(Iterable.class);
        verify(architectureTagRepository).deleteAll(deleteCaptor.capture());
        List<String> deletedValues = new java.util.ArrayList<>();
        deleteCaptor.getValue().forEach(t -> deletedValues.add(t.getTagValue()));
        org.junit.jupiter.api.Assertions.assertTrue(
            deletedValues.containsAll(List.of("a", "b")) && deletedValues.size() == 2,
            "expected pre-existing tags ['a', 'b'] to be deleted, got " + deletedValues);

        // Verify the new tags were inserted.
        ArgumentCaptor<ArchitectureTagEntity> insertCaptor =
            ArgumentCaptor.forClass(ArchitectureTagEntity.class);
        verify(architectureTagRepository, times(2)).save(insertCaptor.capture());
        List<String> insertedValues = insertCaptor.getAllValues().stream()
            .map(ArchitectureTagEntity::getTagValue).toList();
        org.junit.jupiter.api.Assertions.assertTrue(
            insertedValues.containsAll(List.of("x", "y")) && insertedValues.size() == 2,
            "expected new tags ['x', 'y'] to be inserted, got " + insertedValues);
    }

    // ========================================================================
    // Test 4 -- happy path: POST returns 201 with new architecture
    // ========================================================================
    @Test
    @DisplayName("POST happy path returns 201 with the created architecture (id, name, description, tags, archived=false)")
    void createArchitecture_happyPath_returns201() throws Exception {
        when(architectureRepository.existsByProjectIdAndNameIgnoreCase(PROJECT_ID, "Target State"))
            .thenReturn(false);
        when(architectureRepository.save(any(ArchitectureEntity.class)))
            .thenAnswer(inv -> {
                ArchitectureEntity e = inv.getArgument(0);
                // Simulate the @PrePersist defaults (timestamps are normally
                // set by the JPA lifecycle hooks).
                if (e.getCreatedAt() == null) e.setCreatedAt(Instant.now());
                if (e.getUpdatedAt() == null) e.setUpdatedAt(Instant.now());
                return e;
            });
        when(architectureTagRepository.findByArchitectureId(any())).thenAnswer(inv -> {
            UUID id = inv.getArgument(0);
            return List.of(
                ArchitectureTagEntity.builder().architectureId(id).tagValue("current-state").build(),
                ArchitectureTagEntity.builder().architectureId(id).tagValue("v1").build());
        });

        String body = objectMapper.writeValueAsString(Map.of(
            "name", "Target State",
            "description", "Where we are heading",
            "tags", List.of("current-state", "v1")));

        mockMvc.perform(post("/api/projects/{projectId}/architectures", PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").exists())
            .andExpect(jsonPath("$.projectId").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.name").value("Target State"))
            .andExpect(jsonPath("$.description").value("Where we are heading"))
            .andExpect(jsonPath("$.archived").value(false))
            .andExpect(jsonPath("$.tags.length()").value(2))
            .andExpect(jsonPath("$.createdAt").exists())
            .andExpect(jsonPath("$.updatedAt").exists());
    }

    // ========================================================================
    // Test 5 -- 404 when architecture belongs to a different project
    // ========================================================================
    @Test
    @DisplayName("PATCH returns 404 when architectureId belongs to a different project than the path's projectId")
    void updateArchitecture_wrongProject_returns404() throws Exception {
        // The architecture exists, but it lives in OTHER_PROJECT_ID; the URL
        // is scoped to PROJECT_ID. Cross-project access must look identical
        // to "not found" so the caller cannot infer foreign architectures.
        ArchitectureEntity foreignArch = ArchitectureEntity.builder()
            .id(ARCH_ID)
            .projectId(OTHER_PROJECT_ID)
            .name("Default")
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        when(architectureRepository.findById(ARCH_ID)).thenReturn(Optional.of(foreignArch));

        String body = objectMapper.writeValueAsString(Map.of(
            "name", "Renamed",
            "description", "",
            "tags", List.of()));

        mockMvc.perform(patch(
                "/api/projects/{projectId}/architectures/{architectureId}",
                PROJECT_ID, ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isNotFound());

        // Critical: no save should have happened against the foreign-project row.
        verify(architectureRepository, never()).save(any());
        verify(architectureTagRepository, never()).deleteAll(any());
    }

    // ========================================================================
    // Test 6 -- 400 on validation failure (empty name after trim)
    // ========================================================================
    @Test
    @DisplayName("POST returns 400 when name is empty (whitespace-only) after trim")
    void createArchitecture_emptyName_returns400() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
            "name", "   ",
            "tags", List.of()));

        mockMvc.perform(post("/api/projects/{projectId}/architectures", PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("Architecture name is required"));

        verify(architectureRepository, never()).existsByProjectIdAndNameIgnoreCase(any(), any());
        verify(architectureRepository, never()).save(any());
    }
}
