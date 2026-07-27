package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.ProjectMapper;
import com.example.architecturemodel.model.dto.OrganisationDto;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.ModelFileRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Service for managing Projects.
 *
 * Provides operations for creating, listing, activating, and deleting projects.
 * Ensures only one project is active at any time through transactional
 * deactivation before activation.
 *
 * Spec 2026-01-05: Project Model with Active Project
 * Spec 2026-01-10: Project Menu + Delete Project
 * Spec 2026-01-10: Project Hierarchy Grouping - Added projectHierarchy parameter
 * Spec 2026-01-18: Organisations Iteration 1 - Added organisationId parameter
 * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Changed organisationId from UUID to String
 * Spec 2026-01-19: Startup Configuration for Feature Toggles - Made conditional on includeDatabase
 */
@Service
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ProjectService {

    private final ProjectRepository projectRepository;
    private final ProjectMapper projectMapper;
    private final ModelFileRepository modelFileRepository;
    private final OrganisationService organisationService;
    private final ArchitectureService architectureService;
    private final String projectRootDir;

    public ProjectService(
            ProjectRepository projectRepository,
            ProjectMapper projectMapper,
            ModelFileRepository modelFileRepository,
            OrganisationService organisationService,
            @Lazy ArchitectureService architectureService,
            @Value("${app.projectRootDir:.}") String projectRootDir) {
        this.projectRepository = projectRepository;
        this.projectMapper = projectMapper;
        this.modelFileRepository = modelFileRepository;
        this.organisationService = organisationService;
        this.architectureService = architectureService;
        this.projectRootDir = projectRootDir;
    }

    /**
     * Creates a new project with optional hierarchy grouping and organisation.
     *
     * When setActive is true, deactivates all existing projects first,
     * then creates the new project with isActive = true.
     *
     * Validates that required fields are provided before creating the project.
     * The projectHierarchy is optional; blank/whitespace values are normalized to null.
     * The organisationId is optional; if provided, the project is linked to that organisation.
     *
     * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Changed organisationId from UUID to String
     *
     * @param name The project name
     * @param parentFolder The project parent folder path
     * @param projectHierarchy Optional logical grouping for the project (null or blank = no hierarchy)
     * @param organisationId Optional organisation ID to link the project to (String, e.g., "org-xxxx")
     * @param repoUrl Git repository URL for the project (e.g., "https://github.com/acme/backend.git")
     * @param setActive Whether to set this project as active
     * @return The created ProjectDto
     * @throws IllegalArgumentException if name or parentFolder is blank/null
     *
     * Spec 2026-01-05: Fix Create Project parent folder null
     * Spec 2026-01-10: Project Hierarchy Grouping - Added projectHierarchy parameter
     * Spec 2026-01-18: Organisations Iteration 1 - Added organisationId parameter
     * Spec 2026-03-21: Project Repo URL - Added repoUrl parameter
     */
    @Transactional
    public ProjectDto createProject(String name, String parentFolder, String projectHierarchy, String organisationId, String repoUrl, boolean setActive) {
        log.info("Creating project: name='{}', parentFolder='{}', projectHierarchy='{}', organisationId='{}', repoUrl='{}', setActive={}",
            name, parentFolder, projectHierarchy, organisationId, repoUrl, setActive);

        // Validate required fields
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Project name is required");
        }

        // Default parentFolder to <projectRootDir>/<orgName>/<projectName>/ when not provided
        String effectiveParentFolder = parentFolder;
        if (effectiveParentFolder == null || effectiveParentFolder.isBlank()) {
            String orgName = resolveOrganisationName(organisationId);
            effectiveParentFolder = projectRootDir + "/" + normalizeForPath(orgName) + "/" + normalizeForPath(name) + "/";
            log.info("Defaulting parentFolder to: {}", effectiveParentFolder);
        }

        // Resolve to absolute path so all consumers (Java backend, Node gateway, MCP server) see the same location
        effectiveParentFolder = Paths.get(effectiveParentFolder).toAbsolutePath().normalize().toString() + "/";

        // Normalize projectHierarchy: trim whitespace, treat blank as null
        String normalizedHierarchy = normalizeHierarchy(projectHierarchy);

        if (setActive) {
            log.debug("Deactivating all projects before creating new active project");
            projectRepository.deactivateAll();
        }

        // Normalize repoUrl: trim whitespace, treat blank as null
        String normalizedRepoUrl = (repoUrl != null && !repoUrl.isBlank()) ? repoUrl.trim() : null;

        ProjectEntity entity = ProjectEntity.builder()
            .id(UUID.randomUUID())
            .name(name)
            .projectParentFolder(effectiveParentFolder)
            .projectHierarchy(normalizedHierarchy)
            .organisationId(organisationId)
            .repoUrl(normalizedRepoUrl)
            .isActive(setActive)
            .build();

        ProjectEntity saved = projectRepository.save(entity);
        log.info("Created project with id: {}, hierarchy: {}, organisationId: {}",
            saved.getId(), normalizedHierarchy, organisationId);

        // Auto-create a "Current State" architecture so the frontend always has
        // an architecture to navigate into after project creation. Without this,
        // /projects/{id} resolves to a route that requires :architectureId and
        // ProjectLayout finds no architectures, leaving the user on a white
        // screen. The user can rename this via Manage Architectures > Edit.
        architectureService.create(saved.getId(), "Current State", null, Collections.emptyList());

        return projectMapper.toDto(saved);
    }

    /**
     * Creates a new project with optional hierarchy grouping (backward compatible).
     *
     * This overload maintains backward compatibility with existing callers
     * that don't specify an organisationId.
     *
     * @param name The project name
     * @param parentFolder The project parent folder path
     * @param projectHierarchy Optional logical grouping for the project
     * @param setActive Whether to set this project as active
     * @return The created ProjectDto
     */
    @Transactional
    public ProjectDto createProject(String name, String parentFolder, String projectHierarchy, String organisationId, boolean setActive) {
        return createProject(name, parentFolder, projectHierarchy, organisationId, null, setActive);
    }

    /**
     * Creates a new project with optional hierarchy grouping (backward compatible).
     *
     * This overload maintains backward compatibility with existing callers
     * that don't specify organisationId or repoUrl.
     *
     * @param name The project name
     * @param parentFolder The project parent folder path
     * @param projectHierarchy Optional logical grouping for the project
     * @param setActive Whether to set this project as active
     * @return The created ProjectDto
     */
    @Transactional
    public ProjectDto createProject(String name, String parentFolder, String projectHierarchy, boolean setActive) {
        return createProject(name, parentFolder, projectHierarchy, null, null, setActive);
    }

    /**
     * Normalizes project hierarchy value.
     * Trims whitespace and treats blank/whitespace-only as null.
     *
     * @param hierarchy The raw hierarchy value
     * @return Trimmed hierarchy or null if blank/whitespace-only
     */
    private String normalizeHierarchy(String hierarchy) {
        if (hierarchy == null) {
            return null;
        }
        String trimmed = hierarchy.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /**
     * Normalises a name to a kebab-case path segment.
     * Matches the frontend normalizeIdentifier() algorithm:
     * trim, lowercase, collapse whitespace runs to a single hyphen.
     */
    private String normalizeForPath(String input) {
        if (input == null || input.isBlank()) return "default";
        return input.trim().toLowerCase().replaceAll("\\s+", "-");
    }

    /**
     * Resolves the organisation name from an organisation ID.
     * Used for constructing the default parent folder path.
     *
     * @param organisationId The organisation ID (may be null)
     * @return The organisation name, or "default" if no organisation is linked
     */
    private String resolveOrganisationName(String organisationId) {
        if (organisationId != null && !organisationId.isBlank()) {
            try {
                OrganisationDto org = organisationService.getOrganisationById(organisationId);
                return org.name();
            } catch (ResourceNotFoundException e) {
                log.warn("Organisation not found for id '{}', using 'default' for parent folder", organisationId);
                return "default";
            }
        }
        return "default";
    }

    /**
     * Lists all projects.
     *
     * @return List of all ProjectDto
     */
    @Transactional(readOnly = true)
    public List<ProjectDto> listProjects() {
        log.debug("Listing all projects");
        return projectRepository.findAll().stream()
            .map(projectMapper::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Gets the currently active project.
     *
     * @return The active ProjectDto
     * @throws ResourceNotFoundException if no project is active
     */
    @Transactional(readOnly = true)
    public ProjectDto getActiveProject() {
        log.debug("Getting active project");
        return projectRepository.findByIsActiveTrue()
            .map(projectMapper::toDto)
            .orElseThrow(() -> new ResourceNotFoundException(
                "No active project. Create or open a project first."));
    }

    /**
     * Gets the currently active project entity.
     * Internal method for use by other services.
     *
     * @return The active ProjectEntity
     * @throws ResourceNotFoundException if no project is active
     */
    @Transactional(readOnly = true)
    public ProjectEntity getActiveProjectEntity() {
        log.debug("Getting active project entity");
        return projectRepository.findByIsActiveTrue()
            .orElseThrow(() -> new ResourceNotFoundException(
                "No active project. Create or open a project first."));
    }

    /**
     * Activates a specific project by ID.
     *
     * Deactivates all projects first, then sets the specified project as active.
     * This is done atomically within a single transaction.
     *
     * @param id The project ID to activate
     * @return The activated ProjectDto
     * @throws ResourceNotFoundException if the project does not exist
     */

    /**
     * Retrieves a single project by ID.
     *
     * @param id The project ID
     * @return The ProjectDto
     * @throws ResourceNotFoundException if the project does not exist
     */
    public ProjectDto getProjectById(UUID id) {
        ProjectEntity entity = projectRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Project not found with id: " + id));
        return projectMapper.toDto(entity);
    }

    /**
     * Updates the per-project shape-spec generation config.
     *
     * <p>Null-guarded PATCH semantics per project_primitive_double_dto_overwrite.md:
     * each parameter is a boxed reference type; a {@code null} value means
     * "do not change this field" and is preserved on the row. Only non-null
     * parameters are written. The fallback values (24000 / 12000 / TRUE) come
     * from the DB DEFAULT clauses in Liquibase changeset 143, not from this
     * method.</p>
     *
     * <p>Spec 2026-05-20: Cross-Story Context Injection -- Task Group 9</p>
     *
     * @param id The project ID
     * @param perStoryContextTokenCap Optional new per-story token cap (null = unchanged)
     * @param crossStoryContextTokenCap Optional new cross-story token cap (null = unchanged)
     * @param autoRunPass2 Optional new auto-run-pass-2 flag (null = unchanged)
     * @return The updated ProjectDto
     * @throws ResourceNotFoundException if the project does not exist
     */
    @Transactional
    public ProjectDto updateProjectConfig(
            UUID id,
            Integer perStoryContextTokenCap,
            Integer crossStoryContextTokenCap,
            Boolean autoRunPass2) {
        return updateProjectConfig(id, perStoryContextTokenCap,
            crossStoryContextTokenCap, autoRunPass2, null, null, null);
    }

    /**
     * Updates the per-project config including the implementation-service
     * init-status fields.
     *
     * <p>Same null-guarded PATCH semantics as the 4-arg overload: every
     * parameter is a boxed reference type and {@code null} means "do not
     * change this field" (project_primitive_double_dto_overwrite.md). In
     * particular a PATCH that omits {@code implementation_init_success} must
     * never wipe a stored TRUE back to false -- which is exactly what a
     * primitive {@code boolean} would silently do.</p>
     *
     * <p>Spec 2026-06-12: Implementation-Service Init and Integration Repair
     * -- Task Group 1</p>
     *
     * @param id The project ID
     * @param perStoryContextTokenCap Optional new per-story token cap (null = unchanged)
     * @param crossStoryContextTokenCap Optional new cross-story token cap (null = unchanged)
     * @param autoRunPass2 Optional new auto-run-pass-2 flag (null = unchanged)
     * @param implementationInitSuccess Optional new init-success flag (null = unchanged)
     * @param implementationMode Optional new overall workspace mode (null = unchanged)
     * @param implementationProjectDir Optional new workspace root dir (null = unchanged)
     * @return The updated ProjectDto
     * @throws ResourceNotFoundException if the project does not exist
     */
    @Transactional
    public ProjectDto updateProjectConfig(
            UUID id,
            Integer perStoryContextTokenCap,
            Integer crossStoryContextTokenCap,
            Boolean autoRunPass2,
            Boolean implementationInitSuccess,
            String implementationMode,
            String implementationProjectDir) {
        return updateProjectConfig(id, perStoryContextTokenCap,
            crossStoryContextTokenCap, autoRunPass2, implementationInitSuccess,
            implementationMode, implementationProjectDir, null);
    }

    /**
     * Full-width overload adding the single-repo {@code repoUrl} (Edit-project
     * flow, 2026-07-27). Same null-guarded PATCH semantics -- with ONE
     * deliberate extension: {@code repoUrl} null = do not change, BLANK =
     * explicitly clear the column back to null (the poly-repo convention: the
     * workspace repo map is the authoritative store), non-blank = trim + set
     * (mirrors the create-time normalisation).
     */
    @Transactional
    public ProjectDto updateProjectConfig(
            UUID id,
            Integer perStoryContextTokenCap,
            Integer crossStoryContextTokenCap,
            Boolean autoRunPass2,
            Boolean implementationInitSuccess,
            String implementationMode,
            String implementationProjectDir,
            String repoUrl) {
        log.info("Updating project config for id={}: perStoryCap={}, crossStoryCap={}, autoRunPass2={}, "
                + "implInitSuccess={}, implMode={}, implProjectDir={}, repoUrl={}",
            id, perStoryContextTokenCap, crossStoryContextTokenCap, autoRunPass2,
            implementationInitSuccess, implementationMode, implementationProjectDir, repoUrl);

        ProjectEntity entity = projectRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Project not found with id: " + id));

        // Null-guarded assignment: only update fields the caller explicitly set.
        // A missing JSON key deserialises to null on the boxed wrapper, which we
        // treat as "do not change" -- per project_primitive_double_dto_overwrite.md.
        if (perStoryContextTokenCap != null) {
            entity.setPerStoryContextTokenCap(perStoryContextTokenCap);
        }
        if (crossStoryContextTokenCap != null) {
            entity.setCrossStoryContextTokenCap(crossStoryContextTokenCap);
        }
        if (autoRunPass2 != null) {
            entity.setAutoRunPass2(autoRunPass2);
        }
        if (implementationInitSuccess != null) {
            entity.setImplementationInitSuccess(implementationInitSuccess);
        }
        if (implementationMode != null) {
            entity.setImplementationMode(implementationMode);
        }
        if (implementationProjectDir != null) {
            entity.setImplementationProjectDir(implementationProjectDir);
        }
        if (repoUrl != null) {
            // Blank = explicit clear (poly mode); non-blank = trim + set.
            entity.setRepoUrl(repoUrl.isBlank() ? null : repoUrl.trim());
        }

        ProjectEntity saved = projectRepository.save(entity);
        return projectMapper.toDto(saved);
    }

    @Transactional
    public ProjectDto activateProject(UUID id) {
        log.info("Activating project with id: {}", id);

        // Verify project exists
        ProjectEntity entity = projectRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Project not found with id: " + id));

        // Deactivate all projects
        projectRepository.deactivateAll();

        // Activate the specified project
        entity.setIsActive(true);
        ProjectEntity saved = projectRepository.save(entity);

        log.info("Activated project: {}", saved.getName());
        return projectMapper.toDto(saved);
    }

    @Transactional
    public void deactivateAllProjects() {
        log.info("Deactivating all projects");
        projectRepository.deactivateAll();
    }

    // =========================================================================
    // Spec 2026-01-10: Project Menu + Delete Project
    // =========================================================================

    /**
     * Validates that a path is safe for deletion.
     *
     * Rejects:
     * - null or blank paths
     * - empty strings
     * - root directories (/, C:\, D:\, etc.)
     * - paths containing traversal patterns (../)
     *
     * @param path The path to validate
     * @throws IllegalArgumentException if the path is unsafe
     */
    public void validatePathSafety(String path) {
        // Check for null or blank
        if (path == null || path.isBlank()) {
            throw new IllegalArgumentException("Project parent folder is blank or invalid");
        }

        // Normalize path for consistent checking
        String normalizedPath = path.trim();

        // Check for empty string after trim
        if (normalizedPath.isEmpty()) {
            throw new IllegalArgumentException("Project parent folder is blank or invalid");
        }

        // Check for path traversal patterns
        if (normalizedPath.contains("..")) {
            throw new IllegalArgumentException("Cannot delete path with traversal pattern");
        }

        // Check for root-like paths
        if (isRootLikePath(normalizedPath)) {
            throw new IllegalArgumentException("Cannot delete root directory or root-like path");
        }
    }

    /**
     * Checks if a path is a root-like path that should not be deleted.
     *
     * @param path The path to check
     * @return true if the path is root-like
     */
    private boolean isRootLikePath(String path) {
        String normalizedPath = path.replace("\\", "/").trim();

        // Check for Unix root
        if (normalizedPath.equals("/")) {
            return true;
        }

        // Check for Windows root patterns (C:, C:\, C:/, D:, etc.)
        if (normalizedPath.matches("^[A-Za-z]:[\\\\/]?$")) {
            return true;
        }

        // Check for patterns like "C:" without trailing slash
        if (normalizedPath.matches("^[A-Za-z]:$")) {
            return true;
        }

        return false;
    }

    /**
     * Deletes project files from the filesystem.
     *
     * Uses Java NIO Files.walk() for recursive directory traversal.
     * Deletes files first, then directories (bottom-up order).
     *
     * @param projectParentFolder The folder path to delete
     * @throws IOException if deletion fails
     */
    public void deleteProjectFilesystem(String projectParentFolder) throws IOException {
        Path folderPath = Paths.get(projectParentFolder);

        log.info("Deleting project filesystem at: {}", folderPath.toAbsolutePath());

        if (!Files.exists(folderPath)) {
            log.warn("Project folder does not exist, skipping filesystem deletion: {}", folderPath);
            return;
        }

        // Walk the file tree and delete in reverse order (files before directories)
        try (Stream<Path> walk = Files.walk(folderPath)) {
            walk.sorted(Comparator.reverseOrder())
                .forEach(path -> {
                    try {
                        Files.delete(path);
                        log.debug("Deleted: {}", path);
                    } catch (IOException e) {
                        log.error("Failed to delete: {}", path, e);
                        throw new RuntimeException("Failed to delete: " + path, e);
                    }
                });
        }

        log.info("Successfully deleted project filesystem at: {}", folderPath);
    }

    /**
     * Deletes project data from the database.
     *
     * Deletes child records first (model file data via model filename),
     * then the project row itself.
     *
     * @param projectId The project ID to delete
     * @param projectName The project name (used as model filename)
     */
    @Transactional
    public void deleteProjectDatabase(UUID projectId, String projectName) {
        log.info("Deleting project database records for project: {} ({})", projectName, projectId);

        // Delete model file data if it exists (the model file uses project name as filename)
        // Model file repository handles the architecture model data
        try {
            modelFileRepository.deleteByFilename(projectName);
            log.debug("Deleted model file for project: {}", projectName);
        } catch (Exception e) {
            log.warn("No model file found for project: {} - {}", projectName, e.getMessage());
        }

        // Delete the project row
        projectRepository.deleteById(projectId);
        log.info("Deleted project row: {}", projectId);

        // Deactivate all projects to ensure clean state
        projectRepository.deactivateAll();
        log.debug("Deactivated all projects after deletion");
    }

    /**
     * Deletes a project completely (filesystem + database).
     *
     * Orchestrates the full deletion process:
     * 1. Fetch project entity, validate exists (404 if not)
     * 2. Validate path safety (400 if invalid)
     * 3. Delete filesystem contents
     * 4. Delete database records (transactional)
     *
     * All deletion attempts are logged for audit trail.
     *
     * @param projectId The project ID to delete
     * @throws ResourceNotFoundException if project does not exist
     * @throws IllegalArgumentException if project path is invalid
     * @throws IOException if filesystem deletion fails
     */
    @Transactional
    public void deleteProject(UUID projectId) throws IOException {
        log.info("DELETE PROJECT - Starting deletion for project id: {}", projectId);

        // 1. Fetch project entity
        ProjectEntity entity = projectRepository.findById(projectId)
            .orElseThrow(() -> {
                log.warn("DELETE PROJECT - Project not found: {}", projectId);
                return new ResourceNotFoundException("Project not found with id: " + projectId);
            });

        String projectName = entity.getName();
        String projectParentFolder = entity.getProjectParentFolder();

        log.info("DELETE PROJECT - Found project: name='{}', folder='{}'", projectName, projectParentFolder);

        // 2. Validate path safety
        validatePathSafety(projectParentFolder);
        log.debug("DELETE PROJECT - Path safety validated for: {}", projectParentFolder);

        // 3. Delete filesystem contents first
        try {
            deleteProjectFilesystem(projectParentFolder);
            log.info("DELETE PROJECT - Filesystem deletion complete for: {}", projectParentFolder);
        } catch (IOException e) {
            log.error("DELETE PROJECT - Filesystem deletion failed for: {}", projectParentFolder, e);
            throw e;
        }

        // 4. Delete database records (transactional)
        deleteProjectDatabase(projectId, projectName);
        log.info("DELETE PROJECT - Database deletion complete for project: {}", projectId);

        log.info("DELETE PROJECT - Successfully deleted project: {} ({})", projectName, projectId);
    }
}
