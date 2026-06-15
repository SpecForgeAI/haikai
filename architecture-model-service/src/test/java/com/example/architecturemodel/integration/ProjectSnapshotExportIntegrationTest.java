package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.dto.*;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import com.example.architecturemodel.model.dto.export.SnapshotMeta;
import com.example.architecturemodel.model.entity.ProjectArtifactEntity;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.entity.ProjectArtifactRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import com.example.architecturemodel.service.ModelService;
import com.example.architecturemodel.service.ProjectSnapshotService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration tests for Project Snapshot Export feature.
 *
 * These tests verify the full export flow through all layers:
 * Controller -> Service -> Repository
 *
 * Spec 2026-01-06: Project Snapshot JSON Export
 * Task Group 4: Integration Tests
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ProjectSnapshotExportIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private WorkItemRepository workItemRepository;

    @Autowired
    private ProjectArtifactRepository projectArtifactRepository;

    @Autowired
    private ProjectSnapshotService projectSnapshotService;

    @Autowired
    private ModelService modelService;

    private UUID testProjectId;
    private ProjectEntity testProject;

    @BeforeEach
    void setUp() {
        // Clear existing data
        projectArtifactRepository.deleteAll();
        workItemRepository.deleteAll();
        projectRepository.deleteAll();

        // Create test project
        testProjectId = UUID.randomUUID();
        testProject = ProjectEntity.builder()
            .id(testProjectId)
            .name("Integration Test Project")
            .projectParentFolder("/test/projects")
            .isActive(true)
            .build();
        projectRepository.save(testProject);
    }

    @Test
    @DisplayName("Full export flow: create project, export returns complete snapshot")
    void testFullExportFlow_returnsCompleteSnapshot() throws Exception {
        // Execute export via REST endpoint
        String responseJson = mockMvc.perform(get("/api/projects/active/export")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andReturn().getResponse().getContentAsString();

        // Parse response
        ProjectSnapshotDto snapshot = objectMapper.readValue(responseJson, ProjectSnapshotDto.class);

        // Verify complete snapshot structure
        assertThat(snapshot).isNotNull();
        assertThat(snapshot.meta()).isNotNull();
        assertThat(snapshot.meta().snapshotVersion()).isEqualTo(1);
        assertThat(snapshot.meta().exportKind()).isEqualTo("PROJECT_SNAPSHOT");
        assertThat(snapshot.project()).isNotNull();
        assertThat(snapshot.project().name()).isEqualTo("Integration Test Project");
        assertThat(snapshot.model()).isNotNull();
        assertThat(snapshot.workItems()).isNotNull();
        assertThat(snapshot.artifacts()).isNotNull();
    }

    @Test
    @DisplayName("Export with empty work items list returns empty array")
    void testExportWithEmptyWorkItems_returnsEmptyArray() throws Exception {
        // Project exists but no work items

        // Execute
        String responseJson = mockMvc.perform(get("/api/projects/active/export")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        ProjectSnapshotDto snapshot = objectMapper.readValue(responseJson, ProjectSnapshotDto.class);

        // Verify
        assertThat(snapshot.workItems()).isEmpty();
    }

    @Test
    @DisplayName("Export with empty artifacts list returns empty array")
    void testExportWithEmptyArtifacts_returnsEmptyArray() throws Exception {
        // Project exists but no artifacts

        // Execute
        String responseJson = mockMvc.perform(get("/api/projects/active/export")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        ProjectSnapshotDto snapshot = objectMapper.readValue(responseJson, ProjectSnapshotDto.class);

        // Verify
        assertThat(snapshot.artifacts()).isEmpty();
    }

    @Test
    @DisplayName("Export with no model file returns empty default model")
    void testExportWithNoModelFile_returnsEmptyModel() throws Exception {
        // Project exists but no model file saved yet

        // Execute
        String responseJson = mockMvc.perform(get("/api/projects/active/export")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        ProjectSnapshotDto snapshot = objectMapper.readValue(responseJson, ProjectSnapshotDto.class);

        // Verify - model should be default empty structure
        assertThat(snapshot.model()).isNotNull();
        assertThat(snapshot.model().metaModel()).isNotNull();
        assertThat(snapshot.model().diagrams()).isEmpty();
    }

    @Test
    @DisplayName("Export with work items includes all work items")
    void testExportWithWorkItems_includesAllWorkItems() throws Exception {
        // Create work items
        WorkItemEntity initiative = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(testProjectId)
            .type("INITIATIVE")
            .title("Test Initiative")
            .status("PLANNED")
            .sortOrder(1)
            .build();
        workItemRepository.save(initiative);

        WorkItemEntity epic = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(testProjectId)
            .type("EPIC")
            .parentId(initiative.getId())
            .title("Test Epic")
            .status("PLANNED")
            .sortOrder(1)
            .build();
        workItemRepository.save(epic);

        // Execute
        String responseJson = mockMvc.perform(get("/api/projects/active/export")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        ProjectSnapshotDto snapshot = objectMapper.readValue(responseJson, ProjectSnapshotDto.class);

        // Verify
        assertThat(snapshot.workItems()).hasSize(2);
    }

    @Test
    @DisplayName("Export with artifacts includes all artifacts")
    void testExportWithArtifacts_includesAllArtifacts() throws Exception {
        // Create artifacts
        ProjectArtifactEntity mission = ProjectArtifactEntity.builder()
            .id(UUID.randomUUID())
            .projectId(testProjectId)
            .artifactType("MISSION_MD")
            .content("# Mission Statement")
            .source("AGENT_OS")
            .revision(1)
            .createdAt(Instant.now())
            .build();
        projectArtifactRepository.save(mission);

        ProjectArtifactEntity roadmap = ProjectArtifactEntity.builder()
            .id(UUID.randomUUID())
            .projectId(testProjectId)
            .artifactType("ROADMAP_MD")
            .content("# Roadmap")
            .source("AGENT_OS")
            .revision(1)
            .createdAt(Instant.now())
            .build();
        projectArtifactRepository.save(roadmap);

        // Execute
        String responseJson = mockMvc.perform(get("/api/projects/active/export")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        ProjectSnapshotDto snapshot = objectMapper.readValue(responseJson, ProjectSnapshotDto.class);

        // Verify
        assertThat(snapshot.artifacts()).hasSize(2);
    }

    @Test
    @DisplayName("snapshot_version field is always 1 for initial implementation")
    void testSnapshotVersionIsAlways1() throws Exception {
        // Execute multiple times
        for (int i = 0; i < 3; i++) {
            String responseJson = mockMvc.perform(get("/api/projects/active/export")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

            ProjectSnapshotDto snapshot = objectMapper.readValue(responseJson, ProjectSnapshotDto.class);

            // Verify version is always 1
            assertThat(snapshot.meta().snapshotVersion()).isEqualTo(1);
        }
    }
}
