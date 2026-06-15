package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.ProjectImplementationRepoDto;
import com.example.architecturemodel.model.entity.ProjectImplementationRepoEntity;
import com.example.architecturemodel.repository.ProjectImplementationRepoRepository;
import com.example.architecturemodel.repository.ProjectRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for the implementation-service workspace repo map
 * ({@code project_implementation_repos}).
 *
 * <p>The only mutation is a FULL-MAP REPLACE: the gateway syncs the map that
 * the external implementation service reports (the external service is the
 * source of truth for what is actually cloned -- drift auto-sync,
 * external-wins). No per-row CRUD exists in AMS by design.</p>
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair -- Task Group 1
 */
@Service
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ProjectImplementationRepoService {

    private final ProjectImplementationRepoRepository repoRepository;
    private final ProjectRepository projectRepository;

    public ProjectImplementationRepoService(
            ProjectImplementationRepoRepository repoRepository,
            ProjectRepository projectRepository) {
        this.repoRepository = repoRepository;
        this.projectRepository = projectRepository;
    }

    /**
     * Lists the stored repo map for a project, ordered by folder.
     *
     * @param projectId The project ID
     * @return The repo map rows as DTOs (empty list when no map is stored)
     */
    @Transactional(readOnly = true)
    public List<ProjectImplementationRepoDto> listRepos(UUID projectId) {
        return repoRepository.findByProjectIdOrderByFolderAsc(projectId).stream()
            .map(this::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Replaces the stored repo map for a project wholesale.
     *
     * <p>Deletes all existing rows for the project (immediate JPQL delete --
     * see {@link ProjectImplementationRepoRepository#deleteByProjectId}) and
     * inserts one row per entry of the supplied map. Validates the project
     * exists (404) and that folders are non-blank and unique within the map
     * (400 via {@link IllegalArgumentException}).</p>
     *
     * @param projectId The project ID
     * @param repos The full replacement map (may be empty -- clears the map)
     * @return The persisted rows as DTOs, ordered by folder
     * @throws ResourceNotFoundException if the project does not exist
     * @throws IllegalArgumentException on blank/duplicate folders or blank git URLs
     */
    @Transactional
    public List<ProjectImplementationRepoDto> replaceRepos(
            UUID projectId,
            List<ProjectImplementationRepoDto> repos) {
        log.info("Replacing implementation repo map for project {}: {} entries",
            projectId, repos == null ? 0 : repos.size());

        if (!projectRepository.existsById(projectId)) {
            throw new ResourceNotFoundException("Project not found with id: " + projectId);
        }

        List<ProjectImplementationRepoDto> entries =
            repos == null ? List.of() : repos;

        // Validate before touching the stored map.
        Set<String> seenFolders = new HashSet<>();
        for (ProjectImplementationRepoDto entry : entries) {
            if (entry == null || entry.folder() == null || entry.folder().isBlank()) {
                throw new IllegalArgumentException("Each repo entry requires a non-blank folder");
            }
            if (entry.gitUrl() == null || entry.gitUrl().isBlank()) {
                throw new IllegalArgumentException(
                    "Repo entry '" + entry.folder() + "' requires a non-blank git_url");
            }
            if (!seenFolders.add(entry.folder().trim())) {
                throw new IllegalArgumentException(
                    "Duplicate folder in repo map: " + entry.folder());
            }
        }

        // Full replace: immediate bulk delete, then insert the new rows.
        repoRepository.deleteByProjectId(projectId);

        List<ProjectImplementationRepoEntity> newRows = new ArrayList<>();
        for (ProjectImplementationRepoDto entry : entries) {
            newRows.add(ProjectImplementationRepoEntity.builder()
                .id(UUID.randomUUID())
                .projectId(projectId)
                .folder(entry.folder().trim())
                .gitUrl(entry.gitUrl().trim())
                .workspaceDir(entry.workspaceDir())
                .mode(entry.mode())
                .build());
        }
        repoRepository.saveAll(newRows);

        return listRepos(projectId);
    }

    private ProjectImplementationRepoDto toDto(ProjectImplementationRepoEntity entity) {
        return new ProjectImplementationRepoDto(
            entity.getFolder(),
            entity.getGitUrl(),
            entity.getWorkspaceDir(),
            entity.getMode());
    }
}
