package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.ProjectArtifactDto;
import com.example.architecturemodel.model.entity.ProjectArtifactEntity;
import com.example.architecturemodel.repository.entity.ProjectArtifactRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for ProjectArtifactService validation and revision logic.
 */
@ExtendWith(MockitoExtension.class)
class ProjectArtifactServiceTest {

    @Mock
    private ProjectArtifactRepository projectArtifactRepository;

    @InjectMocks
    private ProjectArtifactService projectArtifactService;

    private static final UUID PROJECT_ID = UUID.randomUUID();

    /**
     * Test that auto-revision increments correctly when prior revisions exist.
     */
    @Test
    void createArtifact_autoIncrementsRevision() {
        ProjectArtifactEntity latestEntity = ProjectArtifactEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .artifactType("MISSION_MD")
            .content("Previous content")
            .source("AGENT_OS")
            .revision(2)
            .createdAt(Instant.now())
            .build();

        when(projectArtifactRepository.findFirstByProjectIdAndArtifactTypeOrderByRevisionDesc(
            PROJECT_ID, "MISSION_MD")).thenReturn(Optional.of(latestEntity));

        when(projectArtifactRepository.save(any(ProjectArtifactEntity.class))).thenAnswer(invocation -> {
            ProjectArtifactEntity entity = invocation.getArgument(0);
            if (entity.getId() == null) {
                entity.setId(UUID.randomUUID());
            }
            return entity;
        });

        ProjectArtifactDto dto = new ProjectArtifactDto(
            null, null, null,
            "New content",
            "AGENT_OS",
            null, null
        );

        ProjectArtifactDto result = projectArtifactService.createArtifact(
            PROJECT_ID, "MISSION_MD", dto);

        assertThat(result).isNotNull();
        assertThat(result.revision()).isEqualTo(3);  // Should be previous + 1
    }

    /**
     * Test that revision defaults to 1 when no prior revisions exist.
     */
    @Test
    void createArtifact_firstRevisionIs1() {
        when(projectArtifactRepository.findFirstByProjectIdAndArtifactTypeOrderByRevisionDesc(
            PROJECT_ID, "ROADMAP_MD")).thenReturn(Optional.empty());

        when(projectArtifactRepository.save(any(ProjectArtifactEntity.class))).thenAnswer(invocation -> {
            ProjectArtifactEntity entity = invocation.getArgument(0);
            if (entity.getId() == null) {
                entity.setId(UUID.randomUUID());
            }
            return entity;
        });

        ProjectArtifactDto dto = new ProjectArtifactDto(
            null, null, null,
            "First revision content",
            "AGENT_OS",
            null, null
        );

        ProjectArtifactDto result = projectArtifactService.createArtifact(
            PROJECT_ID, "ROADMAP_MD", dto);

        assertThat(result).isNotNull();
        assertThat(result.revision()).isEqualTo(1);
    }

    /**
     * Test that getLatestArtifact returns the highest revision.
     */
    @Test
    void getLatestArtifact_returnsHighestRevision() {
        ProjectArtifactEntity latestEntity = ProjectArtifactEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .artifactType("BACKLOG_MD")
            .content("Latest content")
            .source("USER_EDIT")
            .revision(5)
            .createdAt(Instant.now())
            .build();

        when(projectArtifactRepository.findFirstByProjectIdAndArtifactTypeOrderByRevisionDesc(
            PROJECT_ID, "BACKLOG_MD")).thenReturn(Optional.of(latestEntity));

        ProjectArtifactDto result = projectArtifactService.getLatestArtifact(PROJECT_ID, "BACKLOG_MD");

        assertThat(result).isNotNull();
        assertThat(result.revision()).isEqualTo(5);
        assertThat(result.content()).isEqualTo("Latest content");
    }

    /**
     * Test that getLatestArtifact throws 404 when no revisions exist.
     */
    @Test
    void getLatestArtifact_noRevisions_throws404() {
        when(projectArtifactRepository.findFirstByProjectIdAndArtifactTypeOrderByRevisionDesc(
            PROJECT_ID, "MISSION_MD")).thenReturn(Optional.empty());

        assertThatThrownBy(() ->
            projectArtifactService.getLatestArtifact(PROJECT_ID, "MISSION_MD"))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("No artifact found");
    }

    /**
     * Test that invalid artifact type is rejected.
     */
    @Test
    void createArtifact_invalidArtifactType_throws400() {
        ProjectArtifactDto dto = new ProjectArtifactDto(
            null, null, null,
            "Content",
            "AGENT_OS",
            null, null
        );

        assertThatThrownBy(() ->
            projectArtifactService.createArtifact(PROJECT_ID, "INVALID_TYPE", dto))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid artifact type");
    }

    /**
     * Test that invalid source is rejected.
     */
    @Test
    void createArtifact_invalidSource_throws400() {
        ProjectArtifactDto dto = new ProjectArtifactDto(
            null, null, null,
            "Content",
            "INVALID_SOURCE",
            null, null
        );

        assertThatThrownBy(() ->
            projectArtifactService.createArtifact(PROJECT_ID, "MISSION_MD", dto))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid source");
    }

    /**
     * Test that empty content is rejected.
     */
    @Test
    void createArtifact_emptyContent_throws400() {
        ProjectArtifactDto dto = new ProjectArtifactDto(
            null, null, null,
            "",  // Empty content
            "AGENT_OS",
            null, null
        );

        assertThatThrownBy(() ->
            projectArtifactService.createArtifact(PROJECT_ID, "MISSION_MD", dto))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("content is required");
    }
}
