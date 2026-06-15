package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.ProjectArtifactDto;
import com.example.architecturemodel.model.dto.roadmap.RoadmapImportResultDto;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.model.parser.EpicNode;
import com.example.architecturemodel.model.parser.InitiativeNode;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import com.example.architecturemodel.util.RoadmapParser;
import org.junit.jupiter.api.BeforeEach;
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
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for RoadmapImportService.
 *
 * Tests import functionality including file reading, safety checks,
 * artifact storage, and work item creation.
 */
@ExtendWith(MockitoExtension.class)
class RoadmapImportServiceTest {

    @Mock
    private WorkItemRepository workItemRepository;

    @Mock
    private ProjectArtifactService projectArtifactService;

    @Mock
    private RoadmapParser roadmapParser;

    @Mock
    private ProjectService projectService;

    @TempDir
    Path tempDir;

    private RoadmapImportService importService;

    private static final UUID PROJECT_ID = UUID.randomUUID();

    @BeforeEach
    void setUp() {
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

    /**
     * Test successful import creates artifact with correct revision.
     */
    @Test
    void importFromAgentOsFile_createsArtifactWithCorrectRevision() throws IOException {
        // Setup: Create roadmap file
        Path agentOsDir = tempDir.resolve("agent-os/product");
        Files.createDirectories(agentOsDir);
        Files.writeString(agentOsDir.resolve("roadmap.md"), "## Initiative 1\n- Epic 1");

        // Setup: Mock parser
        InitiativeNode initiative = InitiativeNode.builder()
                .title("Initiative 1")
                .sortOrder(0)
                .epics(List.of(EpicNode.builder()
                        .title("Epic 1")
                        .sortOrder(0)
                        .build()))
                .build();
        when(roadmapParser.parse(anyString(), anyString())).thenReturn(List.of(initiative));

        // Setup: Mock artifact creation
        ProjectArtifactDto artifactDto = new ProjectArtifactDto(
                UUID.randomUUID(), PROJECT_ID, "ROADMAP_MD",
                "content", "AGENT_OS", 3, Instant.now());
        when(projectArtifactService.createArtifact(eq(PROJECT_ID), eq("ROADMAP_MD"), any()))
                .thenReturn(artifactDto);

        // Setup: Mock repository (v3 upsert flow loads existing INITIATIVE/EPIC items)
        when(workItemRepository.findByProjectIdAndTypeIn(eq(PROJECT_ID), anyList()))
                .thenReturn(new java.util.ArrayList<>());
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(invocation -> {
            WorkItemEntity entity = invocation.getArgument(0);
            if (entity.getId() == null) entity.setId(UUID.randomUUID());
            return entity;
        });

        // Execute
        RoadmapImportResultDto result = importService.importFromAgentOsFile(PROJECT_ID);

        // Verify artifact revision
        assertThat(result.artifactRevision()).isEqualTo(3);

        // Verify artifact was created with ROADMAP_MD type and AGENT_OS source
        ArgumentCaptor<ProjectArtifactDto> artifactCaptor = ArgumentCaptor.forClass(ProjectArtifactDto.class);
        verify(projectArtifactService).createArtifact(eq(PROJECT_ID), eq("ROADMAP_MD"), artifactCaptor.capture());
        assertThat(artifactCaptor.getValue().source()).isEqualTo("AGENT_OS");
    }

    /**
     * Test successful import creates initiatives with correct sort order.
     */
    @Test
    void importFromAgentOsFile_createsInitiativesWithCorrectSortOrder() throws IOException {
        // Setup: Create roadmap file
        Path agentOsDir = tempDir.resolve("agent-os/product");
        Files.createDirectories(agentOsDir);
        Files.writeString(agentOsDir.resolve("roadmap.md"), "## Init 1\n## Init 2\n## Init 3");

        // Setup: Mock parser with 3 initiatives
        List<InitiativeNode> initiatives = List.of(
                InitiativeNode.builder().title("Init 1").sortOrder(0).epics(List.of()).build(),
                InitiativeNode.builder().title("Init 2").sortOrder(1).epics(List.of()).build(),
                InitiativeNode.builder().title("Init 3").sortOrder(2).epics(List.of()).build()
        );
        when(roadmapParser.parse(anyString(), anyString())).thenReturn(initiatives);

        // Setup: Mock services
        when(projectArtifactService.createArtifact(any(UUID.class), anyString(), any()))
                .thenReturn(new ProjectArtifactDto(UUID.randomUUID(), PROJECT_ID, "ROADMAP_MD",
                        "content", "AGENT_OS", 1, Instant.now()));
        when(workItemRepository.findByProjectIdAndTypeIn(eq(PROJECT_ID), anyList()))
                .thenReturn(new java.util.ArrayList<>());
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(invocation -> {
            WorkItemEntity entity = invocation.getArgument(0);
            if (entity.getId() == null) entity.setId(UUID.randomUUID());
            return entity;
        });

        // Execute
        RoadmapImportResultDto result = importService.importFromAgentOsFile(PROJECT_ID);

        // Verify initiatives created
        assertThat(result.initiativesCreated()).isEqualTo(3);

        // Verify sort orders
        ArgumentCaptor<WorkItemEntity> entityCaptor = ArgumentCaptor.forClass(WorkItemEntity.class);
        verify(workItemRepository, times(3)).save(entityCaptor.capture());

        List<WorkItemEntity> saved = entityCaptor.getAllValues();
        assertThat(saved).extracting(WorkItemEntity::getSortOrder).containsExactly(0, 1, 2);
        assertThat(saved).allMatch(e -> "INITIATIVE".equals(e.getType()));
    }

    /**
     * Test successful import creates epics linked to parent initiatives.
     */
    @Test
    void importFromAgentOsFile_createsEpicsLinkedToParentInitiatives() throws IOException {
        // Setup: Create roadmap file
        Path agentOsDir = tempDir.resolve("agent-os/product");
        Files.createDirectories(agentOsDir);
        Files.writeString(agentOsDir.resolve("roadmap.md"), "## Initiative\n- Epic 1\n- Epic 2");

        // Setup: Mock parser
        InitiativeNode initiative = InitiativeNode.builder()
                .title("Initiative")
                .sortOrder(0)
                .epics(List.of(
                        EpicNode.builder().title("Epic 1").sortOrder(0).build(),
                        EpicNode.builder().title("Epic 2").sortOrder(1).build()
                ))
                .build();
        when(roadmapParser.parse(anyString(), anyString())).thenReturn(List.of(initiative));

        // Setup: Mock services
        when(projectArtifactService.createArtifact(any(UUID.class), anyString(), any()))
                .thenReturn(new ProjectArtifactDto(UUID.randomUUID(), PROJECT_ID, "ROADMAP_MD",
                        "content", "AGENT_OS", 1, Instant.now()));
        when(workItemRepository.findByProjectIdAndTypeIn(eq(PROJECT_ID), anyList()))
                .thenReturn(new java.util.ArrayList<>());

        UUID initiativeId = UUID.randomUUID();
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(invocation -> {
            WorkItemEntity entity = invocation.getArgument(0);
            if (entity.getId() == null) {
                if ("INITIATIVE".equals(entity.getType())) {
                    entity.setId(initiativeId);
                } else {
                    entity.setId(UUID.randomUUID());
                }
            }
            return entity;
        });

        // Execute
        RoadmapImportResultDto result = importService.importFromAgentOsFile(PROJECT_ID);

        // Verify counts
        assertThat(result.initiativesCreated()).isEqualTo(1);
        assertThat(result.epicsCreated()).isEqualTo(2);

        // Verify epic parent linkage
        ArgumentCaptor<WorkItemEntity> entityCaptor = ArgumentCaptor.forClass(WorkItemEntity.class);
        verify(workItemRepository, times(3)).save(entityCaptor.capture());

        List<WorkItemEntity> epics = entityCaptor.getAllValues().stream()
                .filter(e -> "EPIC".equals(e.getType()))
                .toList();
        assertThat(epics).hasSize(2);
        assertThat(epics).allMatch(e -> initiativeId.equals(e.getParentId()));
    }

    /**
     * Test import throws ResourceNotFoundException when file not found.
     */
    @Test
    void importFromAgentOsFile_throwsNotFoundWhenFileNotFound() {
        // Don't create the file - let it not exist

        assertThatThrownBy(() -> importService.importFromAgentOsFile(PROJECT_ID))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("roadmap.md");
    }

    /**
     * v3: the v1 FEATURE/STORY import block was removed -- the import proceeds
     * regardless of existing FEATURE/STORY items (upsert semantics preserve
     * the lower levels of the hierarchy).
     */
    @Test
    void importFromAgentOsFile_proceedsWhenFeaturesExist() throws IOException {
        // Setup: Create roadmap file
        Path agentOsDir = tempDir.resolve("agent-os/product");
        Files.createDirectories(agentOsDir);
        Files.writeString(agentOsDir.resolve("roadmap.md"), "## Initiative 1");

        when(roadmapParser.parse(anyString(), anyString())).thenReturn(List.of(
                InitiativeNode.builder().title("Initiative 1").sortOrder(0).epics(List.of()).build()));
        when(projectArtifactService.createArtifact(any(UUID.class), anyString(), any()))
                .thenReturn(new ProjectArtifactDto(UUID.randomUUID(), PROJECT_ID, "ROADMAP_MD",
                        "content", "AGENT_OS", 1, Instant.now()));
        when(workItemRepository.findByProjectIdAndTypeIn(eq(PROJECT_ID), anyList()))
                .thenReturn(new java.util.ArrayList<>());
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(invocation -> {
            WorkItemEntity entity = invocation.getArgument(0);
            if (entity.getId() == null) entity.setId(UUID.randomUUID());
            return entity;
        });

        // Execute and verify: no exception, the initiative is imported
        RoadmapImportResultDto result = importService.importFromAgentOsFile(PROJECT_ID);
        assertThat(result.initiativesCreated()).isEqualTo(1);
    }

    /**
     * v3: import UPSERTS existing INITIATIVE/EPIC work items (no blanket
     * delete-and-recreate; removed items are archived or deleted per-item).
     */
    @Test
    void importFromAgentOsFile_upsertsInitiativesAndEpics() throws IOException {
        // Setup: Create roadmap file
        Path agentOsDir = tempDir.resolve("agent-os/product");
        Files.createDirectories(agentOsDir);
        Files.writeString(agentOsDir.resolve("roadmap.md"), "## New Initiative\n- New Epic");

        // Setup: Mock parser
        InitiativeNode initiative = InitiativeNode.builder()
                .title("New Initiative")
                .sortOrder(0)
                .epics(List.of(EpicNode.builder().title("New Epic").sortOrder(0).build()))
                .build();
        when(roadmapParser.parse(anyString(), anyString())).thenReturn(List.of(initiative));

        // Setup: Mock services
        when(projectArtifactService.createArtifact(any(UUID.class), anyString(), any()))
                .thenReturn(new ProjectArtifactDto(UUID.randomUUID(), PROJECT_ID, "ROADMAP_MD",
                        "content", "AGENT_OS", 1, Instant.now()));
        when(workItemRepository.findByProjectIdAndTypeIn(eq(PROJECT_ID), anyList()))
                .thenReturn(new java.util.ArrayList<>());
        when(workItemRepository.save(any(WorkItemEntity.class))).thenAnswer(invocation -> {
            WorkItemEntity entity = invocation.getArgument(0);
            if (entity.getId() == null) entity.setId(UUID.randomUUID());
            return entity;
        });

        // Execute
        RoadmapImportResultDto result = importService.importFromAgentOsFile(PROJECT_ID);

        // Verify upsert semantics: 1 initiative + 1 epic inserted, nothing
        // blanket-deleted by type.
        assertThat(result.initiativesInserted()).isEqualTo(1);
        assertThat(result.epicsInserted()).isEqualTo(1);
        verify(workItemRepository, times(2)).save(any(WorkItemEntity.class));
        verify(workItemRepository, never()).deleteByProjectIdAndTypeIn(any(), anyList());
    }
}
