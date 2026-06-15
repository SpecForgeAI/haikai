package com.example.architecturemodel.service;

import com.example.architecturemodel.mapper.ProjectMapper;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.ProjectRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for the implementation-service init-status PATCH semantics on
 * {@link ProjectService#updateProjectConfig(UUID, Integer, Integer, Boolean,
 * Boolean, String, String)}.
 *
 * <p>Spec 2026-06-12: Implementation-Service Init and Integration Repair --
 * Task Group 1. Two critical behaviours:</p>
 * <ol>
 *   <li>The init fields (init-success / mode / project_dir) persist when the
 *       caller provides them (the gateway writes these after POST
 *       /projects/init returns).</li>
 *   <li>A PATCH that omits the init fields (null on the boxed wrappers) must
 *       NEVER wipe stored values -- per
 *       project_primitive_double_dto_overwrite.md a primitive boolean would
 *       silently reset TRUE to false on every config-only PATCH.</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class ProjectImplementationInitConfigTest {

    @Mock private ProjectRepository projectRepository;
    @Mock private ModelFileRepository modelFileRepository;
    @Mock private OrganisationService organisationService;
    @Mock private ArchitectureService architectureService;

    private ProjectService projectService;
    private UUID projectId;

    @BeforeEach
    void setUp() {
        projectService = new ProjectService(
            projectRepository,
            new ProjectMapper(),
            modelFileRepository,
            organisationService,
            architectureService,
            "."
        );
        projectId = UUID.randomUUID();
    }

    private ProjectEntity storedEntity() {
        return ProjectEntity.builder()
            .id(projectId)
            .name("acme-app")
            .projectParentFolder("/projects/acme-app/")
            .isActive(true)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }

    @Test
    @DisplayName("updateProjectConfig persists init-success/mode/project_dir when provided")
    void initFieldsPersistWhenProvided() {
        ProjectEntity entity = storedEntity();
        when(projectRepository.findById(projectId)).thenReturn(Optional.of(entity));
        when(projectRepository.save(any(ProjectEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        ProjectDto result = projectService.updateProjectConfig(
            projectId, null, null, null,
            Boolean.TRUE, "polyrepo", "/workspace/acme/acme-app");

        ArgumentCaptor<ProjectEntity> captor = ArgumentCaptor.forClass(ProjectEntity.class);
        verify(projectRepository).save(captor.capture());
        ProjectEntity saved = captor.getValue();
        assertThat(saved.getImplementationInitSuccess()).isTrue();
        assertThat(saved.getImplementationMode()).isEqualTo("polyrepo");
        assertThat(saved.getImplementationProjectDir()).isEqualTo("/workspace/acme/acme-app");

        // And the returned DTO round-trips the persisted values.
        assertThat(result.implementationInitSuccess()).isTrue();
        assertThat(result.implementationMode()).isEqualTo("polyrepo");
        assertThat(result.implementationProjectDir()).isEqualTo("/workspace/acme/acme-app");
    }

    @Test
    @DisplayName("PATCH omitting init fields (nulls) does NOT wipe stored values -- boxed null-guard semantics")
    void omittedInitFieldsAreNotWiped() {
        ProjectEntity entity = storedEntity();
        entity.setImplementationInitSuccess(Boolean.TRUE);
        entity.setImplementationMode("brownfield");
        entity.setImplementationProjectDir("/workspace/acme/acme-app");
        when(projectRepository.findById(projectId)).thenReturn(Optional.of(entity));
        when(projectRepository.save(any(ProjectEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        // A config-only PATCH: token cap set, EVERY init field omitted (null).
        ProjectDto result = projectService.updateProjectConfig(
            projectId, 32000, null, null, null, null, null);

        ArgumentCaptor<ProjectEntity> captor = ArgumentCaptor.forClass(ProjectEntity.class);
        verify(projectRepository).save(captor.capture());
        ProjectEntity saved = captor.getValue();
        assertThat(saved.getPerStoryContextTokenCap()).isEqualTo(32000);
        assertThat(saved.getImplementationInitSuccess())
            .as("stored init-success must survive a PATCH that omits it")
            .isTrue();
        assertThat(saved.getImplementationMode()).isEqualTo("brownfield");
        assertThat(saved.getImplementationProjectDir()).isEqualTo("/workspace/acme/acme-app");

        assertThat(result.implementationInitSuccess()).isTrue();
    }
}
