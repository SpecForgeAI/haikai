package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.ProjectArtifactDto;
import com.example.architecturemodel.model.dto.roadmap.RoadmapImportResultDto;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import com.example.architecturemodel.util.RoadmapParser;
import com.example.architecturemodel.util.StableIdGenerator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for RoadmapImportService detailed count tracking.
 *
 * Spec 2026-01-04: Roadmap Import UX Glue - Persisted Status + Detailed Counts + Error UX
 * Task Group 1: Tests for inserted/updated/archived/deleted count tracking.
 */
@ExtendWith(MockitoExtension.class)
class RoadmapImportServiceDetailedCountsTest {

    @Mock
    private WorkItemRepository workItemRepository;

    @Mock
    private ProjectArtifactService projectArtifactService;

    @TempDir
    Path tempDir;

    private RoadmapImportService importService;
    private StableIdGenerator stableIdGenerator;
    private RoadmapParser roadmapParser;

    @Mock
    private ProjectService projectService;

    private static final UUID PROJECT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @BeforeEach
    void setUp() {
        stableIdGenerator = new StableIdGenerator();
        roadmapParser = new RoadmapParser(stableIdGenerator);
        importService = new RoadmapImportService(
                workItemRepository,
                projectArtifactService,
                roadmapParser,
                projectService
        );

        // The import flow resolves the roadmap path from the ACTIVE project's
        // parent folder (Spec 2026-01-05); point it at this test's temp dir.
        lenient().when(projectService.getActiveProjectEntity())
                .thenReturn(com.example.architecturemodel.model.entity.ProjectEntity.builder()
                        .id(PROJECT_ID)
                        .projectParentFolder(tempDir.toString())
                        .build());
    }

    // ========================================================================
    // Test 1: New item not in existing map returns inserted=1
    // ========================================================================

    @Test
    void importFromAgentOsFile_newItem_returnsInsertedCount() throws IOException {
        // Setup: Create roadmap file with a new initiative
        Path agentOsDir = tempDir.resolve("agent-os/product");
        Files.createDirectories(agentOsDir);
        Files.writeString(agentOsDir.resolve("roadmap.md"), "## New Initiative\n- New Epic");

        // Setup: No existing items (all new)
        when(workItemRepository.findByProjectIdAndTypeIn(eq(PROJECT_ID), anyList()))
                .thenReturn(new ArrayList<>());
        when(workItemRepository.save(any(WorkItemEntity.class)))
                .thenAnswer(inv -> inv.getArgument(0));
        when(projectArtifactService.createArtifact(any(UUID.class), anyString(), any()))
                .thenReturn(new ProjectArtifactDto(UUID.randomUUID(), PROJECT_ID, "ROADMAP_MD",
                        "content", "AGENT_OS", 1, Instant.now()));

        // Execute
        RoadmapImportResultDto result = importService.importFromAgentOsFile(PROJECT_ID);

        // Verify: inserted counts are 1 each
        assertThat(result.initiativesInserted()).isEqualTo(1);
        assertThat(result.epicsInserted()).isEqualTo(1);
        assertThat(result.initiativesUpdated()).isEqualTo(0);
        assertThat(result.epicsUpdated()).isEqualTo(0);
    }

    // ========================================================================
    // Test 2: Existing item with field change returns updated=1
    // ========================================================================

    @Test
    void importFromAgentOsFile_existingItemWithChange_returnsUpdatedCount() throws IOException {
        // Setup: Create roadmap file
        Path agentOsDir = tempDir.resolve("agent-os/product");
        Files.createDirectories(agentOsDir);
        Files.writeString(agentOsDir.resolve("roadmap.md"), "## User Auth\n- Login Flow");

        // Compute expected IDs
        String normalizedInitTitle = stableIdGenerator.normalizeTitle("User Auth");
        String normalizedEpicTitle = stableIdGenerator.normalizeTitle("Login Flow");
        UUID initiativeId = stableIdGenerator.generateInitiativeId(PROJECT_ID.toString(), normalizedInitTitle);
        UUID epicId = stableIdGenerator.generateEpicId(PROJECT_ID.toString(), normalizedInitTitle, normalizedEpicTitle);

        // Setup: Existing items in database
        WorkItemEntity existingInitiative = WorkItemEntity.builder()
                .id(initiativeId)
                .projectId(PROJECT_ID)
                .type("INITIATIVE")
                .title("User Auth - OLD TITLE")  // Title has changed
                .status("PLANNED")
                .sortOrder(5)
                .createdAt(Instant.now().minusSeconds(3600))
                .updatedAt(Instant.now().minusSeconds(3600))
                .build();

        WorkItemEntity existingEpic = WorkItemEntity.builder()
                .id(epicId)
                .projectId(PROJECT_ID)
                .type("EPIC")
                .parentId(initiativeId)
                .title("Login Flow - OLD")  // Title has changed
                .status("PLANNED")
                .sortOrder(3)
                .createdAt(Instant.now().minusSeconds(3600))
                .updatedAt(Instant.now().minusSeconds(3600))
                .build();

        when(workItemRepository.findByProjectIdAndTypeIn(eq(PROJECT_ID), anyList()))
                .thenReturn(List.of(existingInitiative, existingEpic));
        when(workItemRepository.save(any(WorkItemEntity.class)))
                .thenAnswer(inv -> inv.getArgument(0));
        when(projectArtifactService.createArtifact(any(UUID.class), anyString(), any()))
                .thenReturn(new ProjectArtifactDto(UUID.randomUUID(), PROJECT_ID, "ROADMAP_MD",
                        "content", "AGENT_OS", 1, Instant.now()));

        // Execute
        RoadmapImportResultDto result = importService.importFromAgentOsFile(PROJECT_ID);

        // Verify: updated counts are 1 each
        assertThat(result.initiativesUpdated()).isEqualTo(1);
        assertThat(result.epicsUpdated()).isEqualTo(1);
        assertThat(result.initiativesInserted()).isEqualTo(0);
        assertThat(result.epicsInserted()).isEqualTo(0);
    }

    // ========================================================================
    // Test 3: Removed item with children returns archived=1
    // ========================================================================

    @Test
    void importFromAgentOsFile_removedItemWithChildren_returnsArchivedCount() throws IOException {
        // Setup: Create roadmap with only Epic B (Epic A removed)
        Path agentOsDir = tempDir.resolve("agent-os/product");
        Files.createDirectories(agentOsDir);
        Files.writeString(agentOsDir.resolve("roadmap.md"), "## Initiative\n- Epic B");

        // Compute IDs
        String normalizedInitTitle = stableIdGenerator.normalizeTitle("Initiative");
        UUID initiativeId = stableIdGenerator.generateInitiativeId(PROJECT_ID.toString(), normalizedInitTitle);
        UUID removedEpicId = stableIdGenerator.generateEpicId(PROJECT_ID.toString(), normalizedInitTitle, "epic a");

        // Setup: Existing items including Epic A that will be removed
        WorkItemEntity existingInitiative = WorkItemEntity.builder()
                .id(initiativeId)
                .projectId(PROJECT_ID)
                .type("INITIATIVE")
                .title("Initiative")
                .status("PLANNED")
                .sortOrder(0)
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build();

        WorkItemEntity removedEpic = WorkItemEntity.builder()
                .id(removedEpicId)
                .projectId(PROJECT_ID)
                .type("EPIC")
                .parentId(initiativeId)
                .title("Epic A")
                .status("PLANNED")
                .sortOrder(0)
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build();

        when(workItemRepository.findByProjectIdAndTypeIn(eq(PROJECT_ID), anyList()))
                .thenReturn(List.of(existingInitiative, removedEpic));
        // Removed epic HAS children (features)
        when(workItemRepository.countByProjectIdAndParentId(eq(PROJECT_ID), eq(removedEpicId)))
                .thenReturn(3L);
        when(workItemRepository.save(any(WorkItemEntity.class)))
                .thenAnswer(inv -> inv.getArgument(0));
        when(projectArtifactService.createArtifact(any(UUID.class), anyString(), any()))
                .thenReturn(new ProjectArtifactDto(UUID.randomUUID(), PROJECT_ID, "ROADMAP_MD",
                        "content", "AGENT_OS", 1, Instant.now()));

        // Execute
        RoadmapImportResultDto result = importService.importFromAgentOsFile(PROJECT_ID);

        // Verify: archived count is 1
        assertThat(result.epicsArchived()).isEqualTo(1);
        assertThat(result.epicsDeleted()).isEqualTo(0);
    }

    // ========================================================================
    // Test 4: Removed item without children returns deleted=1
    // ========================================================================

    @Test
    void importFromAgentOsFile_removedItemWithoutChildren_returnsDeletedCount() throws IOException {
        // Setup: Create roadmap with only Epic B (Epic A removed)
        Path agentOsDir = tempDir.resolve("agent-os/product");
        Files.createDirectories(agentOsDir);
        Files.writeString(agentOsDir.resolve("roadmap.md"), "## Initiative\n- Epic B");

        // Compute IDs
        String normalizedInitTitle = stableIdGenerator.normalizeTitle("Initiative");
        UUID initiativeId = stableIdGenerator.generateInitiativeId(PROJECT_ID.toString(), normalizedInitTitle);
        UUID removedEpicId = stableIdGenerator.generateEpicId(PROJECT_ID.toString(), normalizedInitTitle, "epic a");

        // Setup: Existing items including Epic A that will be removed
        WorkItemEntity existingInitiative = WorkItemEntity.builder()
                .id(initiativeId)
                .projectId(PROJECT_ID)
                .type("INITIATIVE")
                .title("Initiative")
                .status("PLANNED")
                .sortOrder(0)
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build();

        WorkItemEntity removedEpic = WorkItemEntity.builder()
                .id(removedEpicId)
                .projectId(PROJECT_ID)
                .type("EPIC")
                .parentId(initiativeId)
                .title("Epic A")
                .status("PLANNED")
                .sortOrder(0)
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build();

        when(workItemRepository.findByProjectIdAndTypeIn(eq(PROJECT_ID), anyList()))
                .thenReturn(List.of(existingInitiative, removedEpic));
        // Removed epic has NO children
        when(workItemRepository.countByProjectIdAndParentId(eq(PROJECT_ID), eq(removedEpicId)))
                .thenReturn(0L);
        when(workItemRepository.save(any(WorkItemEntity.class)))
                .thenAnswer(inv -> inv.getArgument(0));
        when(projectArtifactService.createArtifact(any(UUID.class), anyString(), any()))
                .thenReturn(new ProjectArtifactDto(UUID.randomUUID(), PROJECT_ID, "ROADMAP_MD",
                        "content", "AGENT_OS", 1, Instant.now()));

        // Execute
        RoadmapImportResultDto result = importService.importFromAgentOsFile(PROJECT_ID);

        // Verify: deleted count is 1
        assertThat(result.epicsDeleted()).isEqualTo(1);
        assertThat(result.epicsArchived()).isEqualTo(0);
    }

    // ========================================================================
    // Test 5: Mixed scenario with multiple operations returns correct totals
    // ========================================================================

    @Test
    void importFromAgentOsFile_mixedOperations_returnsCombinedCounts() throws IOException {
        // Setup: Create roadmap with 2 initiatives and 3 epics
        Path agentOsDir = tempDir.resolve("agent-os/product");
        Files.createDirectories(agentOsDir);
        Files.writeString(agentOsDir.resolve("roadmap.md"),
                "## New Initiative\n- New Epic\n## Existing Initiative\n- Updated Epic\n- Another New Epic");

        // Compute IDs for existing items
        String existingInitTitle = stableIdGenerator.normalizeTitle("Existing Initiative");
        String updatedEpicTitle = stableIdGenerator.normalizeTitle("Updated Epic");
        UUID existingInitId = stableIdGenerator.generateInitiativeId(PROJECT_ID.toString(), existingInitTitle);
        UUID updatedEpicId = stableIdGenerator.generateEpicId(PROJECT_ID.toString(), existingInitTitle, updatedEpicTitle);

        // Also create an epic that will be removed (not in the roadmap)
        UUID removedEpicId = stableIdGenerator.generateEpicId(PROJECT_ID.toString(), existingInitTitle, "removed epic");

        // Setup: Existing items
        WorkItemEntity existingInitiative = WorkItemEntity.builder()
                .id(existingInitId)
                .projectId(PROJECT_ID)
                .type("INITIATIVE")
                .title("Existing Initiative - OLD")  // Will be updated
                .status("PLANNED")
                .sortOrder(0)
                .createdAt(Instant.now().minusSeconds(3600))
                .updatedAt(Instant.now().minusSeconds(3600))
                .build();

        WorkItemEntity existingEpic = WorkItemEntity.builder()
                .id(updatedEpicId)
                .projectId(PROJECT_ID)
                .type("EPIC")
                .parentId(existingInitId)
                .title("Updated Epic - OLD")  // Will be updated
                .status("PLANNED")
                .sortOrder(0)
                .createdAt(Instant.now().minusSeconds(3600))
                .updatedAt(Instant.now().minusSeconds(3600))
                .build();

        WorkItemEntity removedEpic = WorkItemEntity.builder()
                .id(removedEpicId)
                .projectId(PROJECT_ID)
                .type("EPIC")
                .parentId(existingInitId)
                .title("Removed Epic")  // Will be deleted
                .status("PLANNED")
                .sortOrder(1)
                .createdAt(Instant.now().minusSeconds(3600))
                .updatedAt(Instant.now().minusSeconds(3600))
                .build();

        when(workItemRepository.findByProjectIdAndTypeIn(eq(PROJECT_ID), anyList()))
                .thenReturn(List.of(existingInitiative, existingEpic, removedEpic));
        // Removed epic has no children
        when(workItemRepository.countByProjectIdAndParentId(eq(PROJECT_ID), eq(removedEpicId)))
                .thenReturn(0L);
        when(workItemRepository.save(any(WorkItemEntity.class)))
                .thenAnswer(inv -> inv.getArgument(0));
        when(projectArtifactService.createArtifact(any(UUID.class), anyString(), any()))
                .thenReturn(new ProjectArtifactDto(UUID.randomUUID(), PROJECT_ID, "ROADMAP_MD",
                        "content", "AGENT_OS", 1, Instant.now()));

        // Execute
        RoadmapImportResultDto result = importService.importFromAgentOsFile(PROJECT_ID);

        // Verify combined counts:
        // - 1 new initiative ("New Initiative") inserted
        // - 1 existing initiative ("Existing Initiative") updated
        // - 2 new epics ("New Epic", "Another New Epic") inserted
        // - 1 epic ("Updated Epic") updated
        // - 1 epic ("Removed Epic") deleted
        assertThat(result.initiativesInserted()).isEqualTo(1);
        assertThat(result.initiativesUpdated()).isEqualTo(1);
        assertThat(result.epicsInserted()).isEqualTo(2);
        assertThat(result.epicsUpdated()).isEqualTo(1);
        assertThat(result.epicsDeleted()).isEqualTo(1);
        assertThat(result.epicsArchived()).isEqualTo(0);
    }
}
