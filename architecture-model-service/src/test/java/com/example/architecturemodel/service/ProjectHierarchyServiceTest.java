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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for ProjectService project hierarchy functionality.
 *
 * Spec 2026-01-10: Project Hierarchy Grouping
 * Task Group 1: Backend Tests
 */
@ExtendWith(MockitoExtension.class)
class ProjectHierarchyServiceTest {

    @Mock
    private ProjectRepository projectRepository;

    @Mock
    private ModelFileRepository modelFileRepository;

    @Mock
    private OrganisationService organisationService;

    @Mock
    private ArchitectureService architectureService;

    private ProjectMapper projectMapper;
    private ProjectService projectService;

    @BeforeEach
    void setUp() {
        projectMapper = new ProjectMapper();
        projectService = new ProjectService(
            projectRepository,
            projectMapper,
            modelFileRepository,
            organisationService,
            architectureService,
            "."
        );
    }

    @Test
    @DisplayName("createProject stores projectHierarchy when provided")
    void createProject_storesHierarchy_whenProvided() {
        // Setup
        String hierarchy = "ClientA";
        ProjectEntity savedEntity = ProjectEntity.builder()
            .id(UUID.randomUUID())
            .name("Test Project")
            .projectParentFolder("/projects/test")
            .projectHierarchy(hierarchy)
            .isActive(true)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(projectRepository.save(any(ProjectEntity.class))).thenReturn(savedEntity);

        // Execute
        ProjectDto result = projectService.createProject("Test Project", "/projects/test", hierarchy, true);

        // Verify
        ArgumentCaptor<ProjectEntity> captor = ArgumentCaptor.forClass(ProjectEntity.class);
        verify(projectRepository).save(captor.capture());
        assertThat(captor.getValue().getProjectHierarchy()).isEqualTo(hierarchy);
        assertThat(result.projectHierarchy()).isEqualTo(hierarchy);
    }

    @Test
    @DisplayName("createProject stores null hierarchy when not provided")
    void createProject_storesNullHierarchy_whenNotProvided() {
        // Setup
        ProjectEntity savedEntity = ProjectEntity.builder()
            .id(UUID.randomUUID())
            .name("Test Project")
            .projectParentFolder("/projects/test")
            .projectHierarchy(null)
            .isActive(true)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(projectRepository.save(any(ProjectEntity.class))).thenReturn(savedEntity);

        // Execute
        ProjectDto result = projectService.createProject("Test Project", "/projects/test", null, true);

        // Verify
        ArgumentCaptor<ProjectEntity> captor = ArgumentCaptor.forClass(ProjectEntity.class);
        verify(projectRepository).save(captor.capture());
        assertThat(captor.getValue().getProjectHierarchy()).isNull();
        assertThat(result.projectHierarchy()).isNull();
    }

    @Test
    @DisplayName("createProject treats blank hierarchy as null")
    void createProject_treatsBlankHierarchyAsNull() {
        // Setup
        ProjectEntity savedEntity = ProjectEntity.builder()
            .id(UUID.randomUUID())
            .name("Test Project")
            .projectParentFolder("/projects/test")
            .projectHierarchy(null)
            .isActive(true)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(projectRepository.save(any(ProjectEntity.class))).thenReturn(savedEntity);

        // Execute
        projectService.createProject("Test Project", "/projects/test", "", true);

        // Verify
        ArgumentCaptor<ProjectEntity> captor = ArgumentCaptor.forClass(ProjectEntity.class);
        verify(projectRepository).save(captor.capture());
        assertThat(captor.getValue().getProjectHierarchy()).isNull();
    }

    @Test
    @DisplayName("createProject treats whitespace-only hierarchy as null")
    void createProject_treatsWhitespaceOnlyHierarchyAsNull() {
        // Setup
        ProjectEntity savedEntity = ProjectEntity.builder()
            .id(UUID.randomUUID())
            .name("Test Project")
            .projectParentFolder("/projects/test")
            .projectHierarchy(null)
            .isActive(true)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(projectRepository.save(any(ProjectEntity.class))).thenReturn(savedEntity);

        // Execute
        projectService.createProject("Test Project", "/projects/test", "   ", true);

        // Verify
        ArgumentCaptor<ProjectEntity> captor = ArgumentCaptor.forClass(ProjectEntity.class);
        verify(projectRepository).save(captor.capture());
        assertThat(captor.getValue().getProjectHierarchy()).isNull();
    }

    @Test
    @DisplayName("createProject trims leading/trailing whitespace from hierarchy")
    void createProject_trimsWhitespaceFromHierarchy() {
        // Setup
        String inputHierarchy = "  ClientA  ";
        String expectedHierarchy = "ClientA";
        ProjectEntity savedEntity = ProjectEntity.builder()
            .id(UUID.randomUUID())
            .name("Test Project")
            .projectParentFolder("/projects/test")
            .projectHierarchy(expectedHierarchy)
            .isActive(true)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(projectRepository.save(any(ProjectEntity.class))).thenReturn(savedEntity);

        // Execute
        projectService.createProject("Test Project", "/projects/test", inputHierarchy, true);

        // Verify
        ArgumentCaptor<ProjectEntity> captor = ArgumentCaptor.forClass(ProjectEntity.class);
        verify(projectRepository).save(captor.capture());
        assertThat(captor.getValue().getProjectHierarchy()).isEqualTo(expectedHierarchy);
    }
}
