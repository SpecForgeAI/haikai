package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.dto.roadmap.RoadmapImportResultDto;
import com.example.architecturemodel.model.entity.ProjectArtifactEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.repository.entity.ProjectArtifactRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import com.example.architecturemodel.service.RoadmapImportService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for Roadmap Import feature.
 *
 * Tests end-to-end import workflows using real database and file system.
 * Uses @TempDir for file system isolation.
 */
@SpringBootTest
@ActiveProfiles("test")
class RoadmapImportIntegrationTest {

    @TempDir
    static Path tempDir;

    @Autowired
    private RoadmapImportService roadmapImportService;

    @Autowired
    private WorkItemRepository workItemRepository;

    @Autowired
    private ProjectArtifactRepository projectArtifactRepository;

    @Autowired
    private com.example.architecturemodel.repository.ProjectRepository projectRepository;

    private static final UUID PROJECT_ID = UUID.fromString("11111111-2222-3333-4444-555555555555");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("app.projectRootDir", () -> tempDir.toString());
    }

    @BeforeEach
    void setUp() throws IOException {
        // Clean up database (deleteAll is transactional on SimpleJpaRepository;
        // the derived deleteByProjectId is not and fails outside a transaction)
        workItemRepository.deleteAll();
        projectArtifactRepository.deleteAll();

        // The v3 import resolves the roadmap path from the ACTIVE project's
        // parent folder, so seed an active project pointing at the temp dir.
        projectRepository.findAll().forEach(pr -> {
            pr.setIsActive(false);
            projectRepository.save(pr);
        });
        ProjectEntity project = projectRepository.findById(PROJECT_ID)
                .orElseGet(() -> ProjectEntity.builder()
                        .id(PROJECT_ID)
                        .name("Roadmap Import IT Project")
                        .build());
        project.setProjectParentFolder(tempDir.toString());
        project.setIsActive(true);
        projectRepository.save(project);

        // Create agent-os directory structure
        Path agentOsDir = tempDir.resolve("agent-os/product");
        Files.createDirectories(agentOsDir);
    }

    /**
     * Integration test: Full import flow from file to database.
     */
    @Test
    void fullImportFlow_fromFileToDatabase() throws IOException {
        // Setup: Create roadmap file with Format B/C content
        String roadmapContent = """
                # Product Roadmap

                ## Initiative Alpha
                Focus on core functionality

                - Epic: User Authentication
                  - Implement login
                  - Add password reset

                - Epic: User Profile
                  - Profile page
                  - Avatar upload

                ## Initiative Beta
                Enhance user experience

                - Performance Optimization
                - Mobile Responsiveness
                """;

        writeRoadmapFile(roadmapContent);

        // Execute
        RoadmapImportResultDto result = roadmapImportService.importFromAgentOsFile(PROJECT_ID);

        // Verify result
        assertThat(result.projectId()).isEqualTo(PROJECT_ID);
        assertThat(result.artifactRevision()).isEqualTo(1);
        assertThat(result.initiativesCreated()).isEqualTo(2);
        assertThat(result.epicsCreated()).isEqualTo(4);

        // Verify database state - Initiatives
        List<WorkItemEntity> initiatives = workItemRepository
                .findByProjectIdAndTypeOrderBySortOrderAscCreatedAtAscIdAsc(PROJECT_ID, "INITIATIVE");
        assertThat(initiatives).hasSize(2);
        assertThat(initiatives.get(0).getTitle()).isEqualTo("Initiative Alpha");
        assertThat(initiatives.get(1).getTitle()).isEqualTo("Initiative Beta");

        // Verify database state - Epics
        List<WorkItemEntity> epics = workItemRepository
                .findByProjectIdAndTypeOrderBySortOrderAscCreatedAtAscIdAsc(PROJECT_ID, "EPIC");
        assertThat(epics).hasSize(4);
        assertThat(epics).extracting(WorkItemEntity::getTitle)
                .contains("User Authentication", "User Profile",
                        "Performance Optimization", "Mobile Responsiveness");

        // Verify parent relationships
        UUID alphaId = initiatives.get(0).getId();
        UUID betaId = initiatives.get(1).getId();

        List<WorkItemEntity> alphaEpics = epics.stream()
                .filter(e -> alphaId.equals(e.getParentId()))
                .toList();
        List<WorkItemEntity> betaEpics = epics.stream()
                .filter(e -> betaId.equals(e.getParentId()))
                .toList();

        assertThat(alphaEpics).hasSize(2);
        assertThat(betaEpics).hasSize(2);

        // Verify artifact was stored
        List<ProjectArtifactEntity> artifacts = projectArtifactRepository
                .findByProjectIdAndArtifactTypeOrderByRevisionDesc(PROJECT_ID, "ROADMAP_MD");
        assertThat(artifacts).hasSize(1);
        assertThat(artifacts.get(0).getContent()).contains("Initiative Alpha");
    }

    /**
     * Integration test: Re-import updates artifacts and work items.
     */
    @Test
    void reImport_updatesArtifactsAndWorkItems() throws IOException {
        // First import
        String firstContent = """
                ## Original Initiative

                - Original Epic
                """;
        writeRoadmapFile(firstContent);
        RoadmapImportResultDto firstResult = roadmapImportService.importFromAgentOsFile(PROJECT_ID);

        assertThat(firstResult.artifactRevision()).isEqualTo(1);
        assertThat(firstResult.initiativesCreated()).isEqualTo(1);
        assertThat(firstResult.epicsCreated()).isEqualTo(1);

        // Second import with different content
        String secondContent = """
                ## New Initiative One

                - New Epic A
                - New Epic B

                ## New Initiative Two

                - New Epic C
                """;
        writeRoadmapFile(secondContent);
        RoadmapImportResultDto secondResult = roadmapImportService.importFromAgentOsFile(PROJECT_ID);

        // Verify second import results
        assertThat(secondResult.artifactRevision()).isEqualTo(2);
        assertThat(secondResult.initiativesCreated()).isEqualTo(2);
        assertThat(secondResult.epicsCreated()).isEqualTo(3);

        // Verify old work items were replaced
        List<WorkItemEntity> allItems = workItemRepository
                .findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(PROJECT_ID);

        // Should have 2 initiatives + 3 epics = 5 total (not 1+1+2+3 = 7)
        assertThat(allItems).hasSize(5);

        // Verify no "Original" items remain
        assertThat(allItems).noneMatch(item ->
                item.getTitle().contains("Original"));

        // Verify artifact revisions
        List<ProjectArtifactEntity> artifacts = projectArtifactRepository
                .findByProjectIdAndArtifactTypeOrderByRevisionDesc(PROJECT_ID, "ROADMAP_MD");
        assertThat(artifacts).hasSize(2);
        assertThat(artifacts.get(0).getRevision()).isEqualTo(2);
        assertThat(artifacts.get(1).getRevision()).isEqualTo(1);
    }

    /**
     * Integration test: Format A parsing end-to-end.
     */
    @Test
    void formatAParsing_endToEnd() throws IOException {
        String formatAContent = """
                # Roadmap

                ## Initiative One

                ### Epic Alpha
                Description for Alpha epic.
                - Detail point 1
                - Detail point 2

                ### Epic Beta
                Description for Beta.

                ## Initiative Two

                ### Epic Gamma
                The only epic in initiative two.
                """;
        writeRoadmapFile(formatAContent);

        RoadmapImportResultDto result = roadmapImportService.importFromAgentOsFile(PROJECT_ID);

        assertThat(result.initiativesCreated()).isEqualTo(2);
        assertThat(result.epicsCreated()).isEqualTo(3);

        // Verify Format A epics have descriptions
        List<WorkItemEntity> epics = workItemRepository
                .findByProjectIdAndTypeOrderBySortOrderAscCreatedAtAscIdAsc(PROJECT_ID, "EPIC");

        WorkItemEntity alphaEpic = epics.stream()
                .filter(e -> "Epic Alpha".equals(e.getTitle()))
                .findFirst()
                .orElseThrow();

        assertThat(alphaEpic.getDescription()).contains("Description for Alpha");
        assertThat(alphaEpic.getDescription()).contains("Detail point 1");
    }

    /**
     * Integration test: Format B/C parsing end-to-end with sanitization.
     */
    @Test
    void formatBCParsing_withSanitization_endToEnd() throws IOException {
        String formatBCContent = """
                ## Initiative

                - [ ] Epic: Unchecked Epic with Prefix
                - [x] EPIC: Checked Epic with Uppercase Prefix
                - Plain Epic No Prefix
                1. Ordered Epic One
                2. Ordered Epic Two
                """;
        writeRoadmapFile(formatBCContent);

        RoadmapImportResultDto result = roadmapImportService.importFromAgentOsFile(PROJECT_ID);

        assertThat(result.epicsCreated()).isEqualTo(5);

        List<WorkItemEntity> epics = workItemRepository
                .findByProjectIdAndTypeOrderBySortOrderAscCreatedAtAscIdAsc(PROJECT_ID, "EPIC");

        // Verify sanitization removed checkboxes and prefixes
        assertThat(epics).extracting(WorkItemEntity::getTitle)
                .containsExactly(
                        "Unchecked Epic with Prefix",
                        "Checked Epic with Uppercase Prefix",
                        "Plain Epic No Prefix",
                        "Ordered Epic One",
                        "Ordered Epic Two"
                );
    }

    /**
     * Integration test: v3 import proceeds when features/stories exist (the
     * v1 409-conflict block was removed; upsert semantics keep lower levels).
     */
    @Test
    void proceeds_whenFeaturesExist() throws IOException {
        // Create existing FEATURE
        WorkItemEntity feature = WorkItemEntity.builder()
                .id(UUID.randomUUID())
                .projectId(PROJECT_ID)
                .type("FEATURE")
                .title("Existing Feature")
                .status("PLANNED")
                .sortOrder(0)
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build();
        workItemRepository.save(feature);

        // Create roadmap file
        writeRoadmapFile("## Initiative\n- Epic");

        // Import proceeds and the existing FEATURE survives untouched
        RoadmapImportResultDto result = roadmapImportService.importFromAgentOsFile(PROJECT_ID);
        assertThat(result.initiativesCreated()).isEqualTo(1);
        assertThat(result.epicsCreated()).isEqualTo(1);
        assertThat(workItemRepository.findById(feature.getId())).isPresent();
    }

    /**
     * Helper method to write roadmap.md file.
     */
    private void writeRoadmapFile(String content) throws IOException {
        Path roadmapPath = tempDir.resolve("agent-os/product/roadmap.md");
        Files.writeString(roadmapPath, content);
    }
}
