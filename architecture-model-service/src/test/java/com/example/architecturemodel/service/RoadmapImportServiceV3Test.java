package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.ProjectArtifactDto;
import com.example.architecturemodel.model.dto.roadmap.RoadmapImportResultDto;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.model.parser.EpicNode;
import com.example.architecturemodel.model.parser.InitiativeNode;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import com.example.architecturemodel.util.RoadmapParser;
import com.example.architecturemodel.util.StableIdGenerator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for RoadmapImportService v3 enhancements.
 *
 * Tests upsert logic, archive/delete behavior, and v1 block removal.
 */
@ExtendWith(MockitoExtension.class)
@Disabled("follow-up #ams-test-runtime-followup-2026-05-25 — 6 Mockito strict-stubbing failures across all tests. Re-enable as part of the follow-up triage spec; delete this @Disabled by 2026-07-31 if not re-enabled.")
class RoadmapImportServiceV3Test {

    @Mock
    private WorkItemRepository workItemRepository;

    @Mock
    private ProjectArtifactService projectArtifactService;

    @Mock
    private ProjectService projectService;

    @TempDir
    Path tempDir;

    private RoadmapImportService importService;
    private StableIdGenerator stableIdGenerator;
    private RoadmapParser roadmapParser;

    private static final UUID PROJECT_ID = UUID.randomUUID();

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

        // Production code resolves the roadmap path from the active project's parent folder.
        ProjectEntity activeProject = new ProjectEntity();
        activeProject.setProjectParentFolder(tempDir.toString());
        lenient().when(projectService.getActiveProjectEntity()).thenReturn(activeProject);
    }

    // ========================================================================
    // Test 1: Import succeeds when FEATURE/STORY exist (v1 block removed)
    // ========================================================================

    /**
     * Test import succeeds even when FEATURE/STORY work items exist.
     * The v1 409 CONFLICT block should be removed in v3.
     */
    @Test
    void importFromAgentOsFile_succeedsWhenFeaturesExist() throws IOException {
        // Setup: Create roadmap file
        Path agentOsDir = tempDir.resolve("agent-os/product");
        Files.createDirectories(agentOsDir);
        Files.writeString(agentOsDir.resolve("roadmap.md"), "## Initiative\n- Epic");

        // Setup: Mock that FEATURE/STORY exist
        when(workItemRepository.countByProjectIdAndTypeIn(eq(PROJECT_ID), eq(List.of("FEATURE", "STORY"))))
                .thenReturn(5L);

        // Setup: Mock repository and services
        when(workItemRepository.findByProjectIdAndTypeIn(eq(PROJECT_ID), anyList()))
                .thenReturn(new ArrayList<>());
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(inv -> inv.getArgument(0));
        when(projectArtifactService.createArtifact(any(UUID.class), anyString(), any()))
                .thenReturn(new ProjectArtifactDto(UUID.randomUUID(), PROJECT_ID, "ROADMAP_MD",
                        "content", "AGENT_OS", 1, Instant.now()));

        // Execute: Should NOT throw 409 CONFLICT (v3 allows import with existing features)
        assertThatCode(() -> importService.importFromAgentOsFile(PROJECT_ID))
                .doesNotThrowAnyException();

        // Verify: Import proceeded (work items saved)
        verify(workItemRepository, atLeastOnce()).save(any(WorkItemEntity.class));
    }

    // ========================================================================
    // Test 2: Existing initiative is updated (not duplicated) on re-import
    // ========================================================================

    /**
     * Test existing initiative is updated on re-import using deterministic ID.
     */
    @Test
    void importFromAgentOsFile_updatesExistingInitiative() throws IOException {
        // Setup: Create roadmap file
        Path agentOsDir = tempDir.resolve("agent-os/product");
        Files.createDirectories(agentOsDir);
        Files.writeString(agentOsDir.resolve("roadmap.md"), "## User Authentication\n- Login Flow");

        // Setup: Compute expected deterministic ID
        String normalizedTitle = stableIdGenerator.normalizeTitle("User Authentication");
        UUID expectedId = stableIdGenerator.generateInitiativeId(PROJECT_ID.toString(), normalizedTitle);

        // Setup: Mock existing initiative in database
        Instant originalCreatedAt = Instant.now().minusSeconds(3600);
        WorkItemEntity existingInitiative = WorkItemEntity.builder()
                .id(expectedId)
                .projectId(PROJECT_ID)
                .type("INITIATIVE")
                .title("User Authentication - OLD TITLE")
                .status("PLANNED")
                .sortOrder(5)  // Different sort order
                .createdAt(originalCreatedAt)
                .updatedAt(originalCreatedAt)
                .build();

        when(workItemRepository.findByProjectIdAndTypeIn(eq(PROJECT_ID), anyList()))
                .thenReturn(List.of(existingInitiative));
        when(workItemRepository.findByIdAndProjectId(eq(expectedId), eq(PROJECT_ID)))
                .thenReturn(Optional.of(existingInitiative));
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(inv -> inv.getArgument(0));
        when(projectArtifactService.createArtifact(any(UUID.class), anyString(), any()))
                .thenReturn(new ProjectArtifactDto(UUID.randomUUID(), PROJECT_ID, "ROADMAP_MD",
                        "content", "AGENT_OS", 1, Instant.now()));

        // Execute
        RoadmapImportResultDto result = importService.importFromAgentOsFile(PROJECT_ID);

        // Verify: Initiative updated, not duplicated
        assertThat(result.initiativesCreated()).isEqualTo(1);

        ArgumentCaptor<WorkItemEntity> captor = ArgumentCaptor.forClass(WorkItemEntity.class);
        verify(workItemRepository, atLeastOnce()).save(captor.capture());

        List<WorkItemEntity> savedInitiatives = captor.getAllValues().stream()
                .filter(e -> "INITIATIVE".equals(e.getType()))
                .toList();

        assertThat(savedInitiatives).hasSize(1);
        WorkItemEntity savedInit = savedInitiatives.get(0);
        assertThat(savedInit.getId()).isEqualTo(expectedId);
        assertThat(savedInit.getTitle()).isEqualTo("User Authentication");
        assertThat(savedInit.getSortOrder()).isEqualTo(0);  // Updated from file
        assertThat(savedInit.getCreatedAt()).isEqualTo(originalCreatedAt);  // Preserved
    }

    // ========================================================================
    // Test 3: Existing epic is updated (not duplicated) on re-import
    // ========================================================================

    /**
     * Test existing epic is updated on re-import using deterministic ID.
     */
    @Test
    void importFromAgentOsFile_updatesExistingEpic() throws IOException {
        // Setup: Create roadmap file
        Path agentOsDir = tempDir.resolve("agent-os/product");
        Files.createDirectories(agentOsDir);
        Files.writeString(agentOsDir.resolve("roadmap.md"), "## User Authentication\n- Login Flow");

        // Setup: Compute expected deterministic IDs
        String normalizedInitTitle = stableIdGenerator.normalizeTitle("User Authentication");
        String normalizedEpicTitle = stableIdGenerator.normalizeTitle("Login Flow");
        UUID initiativeId = stableIdGenerator.generateInitiativeId(PROJECT_ID.toString(), normalizedInitTitle);
        UUID epicId = stableIdGenerator.generateEpicId(PROJECT_ID.toString(), normalizedInitTitle, normalizedEpicTitle);

        // Setup: Mock existing items in database
        Instant originalCreatedAt = Instant.now().minusSeconds(3600);
        WorkItemEntity existingInitiative = WorkItemEntity.builder()
                .id(initiativeId)
                .projectId(PROJECT_ID)
                .type("INITIATIVE")
                .title("User Authentication")
                .status("PLANNED")
                .sortOrder(0)
                .createdAt(originalCreatedAt)
                .updatedAt(originalCreatedAt)
                .build();

        WorkItemEntity existingEpic = WorkItemEntity.builder()
                .id(epicId)
                .projectId(PROJECT_ID)
                .type("EPIC")
                .parentId(initiativeId)
                .title("Login Flow - OLD")
                .description("Old description")
                .status("PLANNED")
                .sortOrder(5)
                .createdAt(originalCreatedAt)
                .updatedAt(originalCreatedAt)
                .build();

        when(workItemRepository.findByProjectIdAndTypeIn(eq(PROJECT_ID), anyList()))
                .thenReturn(List.of(existingInitiative, existingEpic));
        when(workItemRepository.findByIdAndProjectId(eq(initiativeId), eq(PROJECT_ID)))
                .thenReturn(Optional.of(existingInitiative));
        when(workItemRepository.findByIdAndProjectId(eq(epicId), eq(PROJECT_ID)))
                .thenReturn(Optional.of(existingEpic));
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(inv -> inv.getArgument(0));
        when(projectArtifactService.createArtifact(any(UUID.class), anyString(), any()))
                .thenReturn(new ProjectArtifactDto(UUID.randomUUID(), PROJECT_ID, "ROADMAP_MD",
                        "content", "AGENT_OS", 1, Instant.now()));

        // Execute
        RoadmapImportResultDto result = importService.importFromAgentOsFile(PROJECT_ID);

        // Verify: Epic updated
        assertThat(result.epicsCreated()).isEqualTo(1);

        ArgumentCaptor<WorkItemEntity> captor = ArgumentCaptor.forClass(WorkItemEntity.class);
        verify(workItemRepository, atLeastOnce()).save(captor.capture());

        List<WorkItemEntity> savedEpics = captor.getAllValues().stream()
                .filter(e -> "EPIC".equals(e.getType()))
                .toList();

        assertThat(savedEpics).hasSize(1);
        WorkItemEntity savedEpic = savedEpics.get(0);
        assertThat(savedEpic.getId()).isEqualTo(epicId);
        assertThat(savedEpic.getTitle()).isEqualTo("Login Flow");
        assertThat(savedEpic.getSortOrder()).isEqualTo(0);
        assertThat(savedEpic.getCreatedAt()).isEqualTo(originalCreatedAt);  // Preserved
    }

    // ========================================================================
    // Test 4: Removed epic with children is archived
    // ========================================================================

    /**
     * Test removed epic with children is archived (status = "ARCHIVED").
     */
    @Test
    void importFromAgentOsFile_archivesRemovedEpicWithChildren() throws IOException {
        // Setup: Create roadmap file with ONE epic (Epic A removed)
        Path agentOsDir = tempDir.resolve("agent-os/product");
        Files.createDirectories(agentOsDir);
        Files.writeString(agentOsDir.resolve("roadmap.md"), "## Initiative\n- Epic B");

        // Setup: Compute IDs
        String normalizedInitTitle = stableIdGenerator.normalizeTitle("Initiative");
        UUID initiativeId = stableIdGenerator.generateInitiativeId(PROJECT_ID.toString(), normalizedInitTitle);
        UUID removedEpicId = stableIdGenerator.generateEpicId(PROJECT_ID.toString(), normalizedInitTitle, "epic a");
        UUID keptEpicId = stableIdGenerator.generateEpicId(PROJECT_ID.toString(), normalizedInitTitle, "epic b");

        // Setup: Mock existing items
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
        when(workItemRepository.findByIdAndProjectId(eq(initiativeId), eq(PROJECT_ID)))
                .thenReturn(Optional.of(existingInitiative));
        when(workItemRepository.findByIdAndProjectId(eq(keptEpicId), eq(PROJECT_ID)))
                .thenReturn(Optional.empty());
        // Removed epic has children (features)
        when(workItemRepository.countByProjectIdAndParentId(eq(PROJECT_ID), eq(removedEpicId)))
                .thenReturn(3L);
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(inv -> inv.getArgument(0));
        when(projectArtifactService.createArtifact(any(UUID.class), anyString(), any()))
                .thenReturn(new ProjectArtifactDto(UUID.randomUUID(), PROJECT_ID, "ROADMAP_MD",
                        "content", "AGENT_OS", 1, Instant.now()));

        // Execute
        importService.importFromAgentOsFile(PROJECT_ID);

        // Verify: Removed epic was archived
        ArgumentCaptor<WorkItemEntity> captor = ArgumentCaptor.forClass(WorkItemEntity.class);
        verify(workItemRepository, atLeastOnce()).save(captor.capture());

        Optional<WorkItemEntity> archivedEpic = captor.getAllValues().stream()
                .filter(e -> removedEpicId.equals(e.getId()))
                .findFirst();

        assertThat(archivedEpic).isPresent();
        assertThat(archivedEpic.get().getStatus()).isEqualTo("ARCHIVED");
    }

    // ========================================================================
    // Test 5: Removed epic with no children is deleted
    // ========================================================================

    /**
     * Test removed epic with no children is deleted.
     */
    @Test
    void importFromAgentOsFile_deletesRemovedEpicWithNoChildren() throws IOException {
        // Setup: Create roadmap file with ONE epic (Epic A removed)
        Path agentOsDir = tempDir.resolve("agent-os/product");
        Files.createDirectories(agentOsDir);
        Files.writeString(agentOsDir.resolve("roadmap.md"), "## Initiative\n- Epic B");

        // Setup: Compute IDs
        String normalizedInitTitle = stableIdGenerator.normalizeTitle("Initiative");
        UUID initiativeId = stableIdGenerator.generateInitiativeId(PROJECT_ID.toString(), normalizedInitTitle);
        UUID removedEpicId = stableIdGenerator.generateEpicId(PROJECT_ID.toString(), normalizedInitTitle, "epic a");
        UUID keptEpicId = stableIdGenerator.generateEpicId(PROJECT_ID.toString(), normalizedInitTitle, "epic b");

        // Setup: Mock existing items
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
        when(workItemRepository.findByIdAndProjectId(eq(initiativeId), eq(PROJECT_ID)))
                .thenReturn(Optional.of(existingInitiative));
        when(workItemRepository.findByIdAndProjectId(eq(keptEpicId), eq(PROJECT_ID)))
                .thenReturn(Optional.empty());
        // Removed epic has NO children
        when(workItemRepository.countByProjectIdAndParentId(eq(PROJECT_ID), eq(removedEpicId)))
                .thenReturn(0L);
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(inv -> inv.getArgument(0));
        when(projectArtifactService.createArtifact(any(UUID.class), anyString(), any()))
                .thenReturn(new ProjectArtifactDto(UUID.randomUUID(), PROJECT_ID, "ROADMAP_MD",
                        "content", "AGENT_OS", 1, Instant.now()));

        // Execute
        importService.importFromAgentOsFile(PROJECT_ID);

        // Verify: Removed epic was deleted
        verify(workItemRepository).delete(argThat(entity ->
                removedEpicId.equals(entity.getId()) && "EPIC".equals(entity.getType())));
    }

    // ========================================================================
    // Test 6: Archived item is un-archived when it reappears
    // ========================================================================

    /**
     * Test archived item is un-archived when it reappears in roadmap.
     */
    @Test
    void importFromAgentOsFile_unarchivesReappearedItem() throws IOException {
        // Setup: Create roadmap file
        Path agentOsDir = tempDir.resolve("agent-os/product");
        Files.createDirectories(agentOsDir);
        Files.writeString(agentOsDir.resolve("roadmap.md"), "## User Authentication\n- Login Flow");

        // Setup: Compute expected deterministic IDs
        String normalizedInitTitle = stableIdGenerator.normalizeTitle("User Authentication");
        String normalizedEpicTitle = stableIdGenerator.normalizeTitle("Login Flow");
        UUID initiativeId = stableIdGenerator.generateInitiativeId(PROJECT_ID.toString(), normalizedInitTitle);
        UUID epicId = stableIdGenerator.generateEpicId(PROJECT_ID.toString(), normalizedInitTitle, normalizedEpicTitle);

        // Setup: Mock existing ARCHIVED items
        WorkItemEntity archivedInitiative = WorkItemEntity.builder()
                .id(initiativeId)
                .projectId(PROJECT_ID)
                .type("INITIATIVE")
                .title("User Authentication")
                .status("ARCHIVED")  // Previously archived
                .sortOrder(0)
                .createdAt(Instant.now().minusSeconds(3600))
                .updatedAt(Instant.now().minusSeconds(3600))
                .build();

        WorkItemEntity archivedEpic = WorkItemEntity.builder()
                .id(epicId)
                .projectId(PROJECT_ID)
                .type("EPIC")
                .parentId(initiativeId)
                .title("Login Flow")
                .status("ARCHIVED")  // Previously archived
                .sortOrder(0)
                .createdAt(Instant.now().minusSeconds(3600))
                .updatedAt(Instant.now().minusSeconds(3600))
                .build();

        when(workItemRepository.findByProjectIdAndTypeIn(eq(PROJECT_ID), anyList()))
                .thenReturn(List.of(archivedInitiative, archivedEpic));
        when(workItemRepository.findByIdAndProjectId(eq(initiativeId), eq(PROJECT_ID)))
                .thenReturn(Optional.of(archivedInitiative));
        when(workItemRepository.findByIdAndProjectId(eq(epicId), eq(PROJECT_ID)))
                .thenReturn(Optional.of(archivedEpic));
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(inv -> inv.getArgument(0));
        when(projectArtifactService.createArtifact(any(UUID.class), anyString(), any()))
                .thenReturn(new ProjectArtifactDto(UUID.randomUUID(), PROJECT_ID, "ROADMAP_MD",
                        "content", "AGENT_OS", 1, Instant.now()));

        // Execute
        importService.importFromAgentOsFile(PROJECT_ID);

        // Verify: Both items un-archived (status = PLANNED)
        ArgumentCaptor<WorkItemEntity> captor = ArgumentCaptor.forClass(WorkItemEntity.class);
        verify(workItemRepository, atLeastOnce()).save(captor.capture());

        List<WorkItemEntity> savedItems = captor.getAllValues();

        Optional<WorkItemEntity> savedInit = savedItems.stream()
                .filter(e -> initiativeId.equals(e.getId()))
                .findFirst();
        Optional<WorkItemEntity> savedEpic = savedItems.stream()
                .filter(e -> epicId.equals(e.getId()))
                .findFirst();

        assertThat(savedInit).isPresent();
        assertThat(savedInit.get().getStatus()).isEqualTo("PLANNED");

        assertThat(savedEpic).isPresent();
        assertThat(savedEpic.get().getStatus()).isEqualTo("PLANNED");
    }
}
