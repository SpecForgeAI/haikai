package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.OrganisationDto;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.dto.ProjectImplementationRepoDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import com.example.architecturemodel.service.OrganisationService;
import com.example.architecturemodel.service.ProjectImplementationRepoService;
import com.example.architecturemodel.service.ProjectService;
import com.example.architecturemodel.service.ProjectSnapshotService;
import com.fasterxml.jackson.annotation.JsonAlias;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * REST Controller for Project operations.
 *
 * Provides endpoints for creating, listing, activating, and deleting projects.
 *
 * Note: Active project endpoints (GET /active, GET /active/export, POST /import)
 * are handled by ActiveProjectController to maintain clear separation of concerns.
 *
 * Spec 2026-01-05: Project Model with Active Project
 * Spec 2026-01-10: Project Menu + Delete Project
 * Spec 2026-01-10: Project Hierarchy Grouping - Added projectHierarchy to CreateProjectRequest
 * Spec 2026-01-18: Organisations Iteration 1 - Added organisationName/organisationId to CreateProjectRequest
 * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Changed organisationId from UUID to String
 * Spec 2026-01-19: Startup Configuration for Feature Toggles - Made conditional on includeDatabase
 * Spec 2026-01-24: Fix Ambiguous Mapping - Removed duplicate /active endpoints (now in ActiveProjectController)
 * Spec 2026-05-20: Cross-Story Context Injection (Task Group 9) - Added PATCH
 *   endpoint for editing per-project shape-spec generation config.
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair (Task
 *   Group 1) - PATCH now also carries the implementation init-status fields
 *   (null-guarded); added PUT /{id}/implementation-repos (full-map replace of
 *   the workspace repo map) and attached the stored repo map on project reads.
 */
@RestController
@RequestMapping("/api/projects")
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ProjectController {

    private final ProjectService projectService;
    private final OrganisationService organisationService;
    private final ProjectSnapshotService projectSnapshotService;
    private final ProjectImplementationRepoService projectImplementationRepoService;

    public ProjectController(
            ProjectService projectService,
            OrganisationService organisationService,
            ProjectSnapshotService projectSnapshotService,
            ProjectImplementationRepoService projectImplementationRepoService) {
        this.projectService = projectService;
        this.organisationService = organisationService;
        this.projectSnapshotService = projectSnapshotService;
        this.projectImplementationRepoService = projectImplementationRepoService;
    }

    /**
     * Request body for creating a project.
     *
     * Supports both camelCase and snake_case JSON keys for compatibility with
     * frontends sending either format. The global Jackson SNAKE_CASE strategy
     * expects snake_case, but @JsonAlias allows camelCase as an alternative.
     *
     * Spec 2026-01-05: Fix Create Project parent folder null
     * Spec 2026-01-10: Project Hierarchy Grouping - Added projectHierarchy field
     * Spec 2026-01-18: Organisations Iteration 1 - Added organisationName and organisationId fields
     * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Changed organisationId from UUID to String
     * Spec 2026-03-21: Project Repo URL - Added repoUrl field
     */
    public record CreateProjectRequest(
        String name,
        @JsonAlias({"projectParentFolder", "project_parent_folder"})
        String projectParentFolder,
        @JsonAlias({"projectHierarchy", "project_hierarchy"})
        String projectHierarchy,
        @JsonAlias({"organisationName", "organisation_name"})
        String organisationName,
        @JsonAlias({"organisationId", "organisation_id"})
        String organisationId,
        @JsonAlias({"repoUrl", "repo_url"})
        String repoUrl,
        @JsonAlias({"setActive", "set_active"})
        Boolean setActive
    ) {
        /**
         * Returns setActive with default value of true if not specified.
         */
        public boolean effectiveSetActive() {
            return setActive == null || setActive;
        }
    }

    /**
     * Request body for PATCH /api/projects/{id}.
     *
     * <p>All fields are BOXED reference types ({@link Integer} / {@link Boolean})
     * so a missing JSON key deserialises to {@code null} rather than the
     * primitive default -- the service layer treats null as "do not change"
     * per project_primitive_double_dto_overwrite.md. A primitive {@code int}
     * default of 0 or primitive {@code boolean} default of {@code false} would
     * silently wipe an explicit user setting whenever the caller omitted the
     * field on PATCH.</p>
     *
     * <p>Currently only the three Task-Group-9 fields are PATCH-able. Other
     * fields (name, parent folder, organisation, etc.) are managed via
     * dedicated endpoints; expanding this DTO to cover additional editable
     * fields is a follow-up choice rather than a defaulting hazard.</p>
     *
     * Spec 2026-05-20: Cross-Story Context Injection -- Task Group 9
     */
    public record UpdateProjectConfigRequest(
        @JsonAlias({"perStoryContextTokenCap", "per_story_context_token_cap"})
        Integer perStoryContextTokenCap,
        @JsonAlias({"crossStoryContextTokenCap", "cross_story_context_token_cap"})
        Integer crossStoryContextTokenCap,
        @JsonAlias({"autoRunPass2", "auto_run_pass_2"})
        Boolean autoRunPass2,
        @JsonAlias({"implementationInitSuccess", "implementation_init_success"})
        Boolean implementationInitSuccess,
        @JsonAlias({"implementationMode", "implementation_mode"})
        String implementationMode,
        @JsonAlias({"implementationProjectDir", "implementation_project_dir"})
        String implementationProjectDir,
        /**
         * Single-repo git URL (Edit-project flow, 2026-07-27). Null = do not
         * change; BLANK = explicitly clear the column back to null (the
         * poly-repo convention -- the workspace repo map becomes the
         * authoritative store); non-blank = trim + set.
         */
        @JsonAlias({"repoUrl", "repo_url"})
        String repoUrl
    ) {
        /**
         * Backward-compatible 3-arg constructor preserving the pre
         * Implementation-Init signature (Spec 2026-06-12 -- Task Group 1).
         */
        public UpdateProjectConfigRequest(
                Integer perStoryContextTokenCap,
                Integer crossStoryContextTokenCap,
                Boolean autoRunPass2) {
            this(perStoryContextTokenCap, crossStoryContextTokenCap, autoRunPass2,
                null, null, null);
        }

        /**
         * Backward-compatible 6-arg constructor preserving the pre-repoUrl
         * signature (2026-07-27 Edit-project flow).
         */
        public UpdateProjectConfigRequest(
                Integer perStoryContextTokenCap,
                Integer crossStoryContextTokenCap,
                Boolean autoRunPass2,
                Boolean implementationInitSuccess,
                String implementationMode,
                String implementationProjectDir) {
            this(perStoryContextTokenCap, crossStoryContextTokenCap, autoRunPass2,
                implementationInitSuccess, implementationMode,
                implementationProjectDir, null);
        }
    }

    /**
     * Request body for PUT /api/projects/{id}/implementation-repos.
     *
     * <p>Carries the FULL replacement repo map -- the stored map is replaced
     * wholesale (the external implementation service is the source of truth
     * for what is cloned; the gateway syncs its reported map here).</p>
     *
     * Spec 2026-06-12: Implementation-Service Init and Integration Repair -- Task Group 1
     */
    public record ReplaceImplementationReposRequest(
        List<ProjectImplementationRepoDto> repos
    ) {
    }

    /**
     * Creates a new project.
     *
     * POST /api/projects
     * Body: { name, projectParentFolder, projectHierarchy?, organisationName?, organisationId?, setActive? }
     *
     * When setActive is true (default), the new project becomes the active project.
     * The projectHierarchy field is optional; blank/whitespace values are treated as null.
     *
     * Organisation linking:
     * - If organisationId is provided: validate it exists and use it
     * - If organisationName is provided: lookup by name, fail with 400 if not found
     * - If both provided: organisationId takes precedence
     *
     * Spec 2026-01-10: Project Hierarchy Grouping - Pass projectHierarchy to service
     * Spec 2026-01-18: Organisations Iteration 1 - Handle organisation resolution
     * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - organisationId is now String
     *
     * @param request The create project request
     * @return ResponseEntity with created ProjectDto and 201 status
     */
    @PostMapping
    public ResponseEntity<ProjectDto> createProject(@RequestBody CreateProjectRequest request) {
        log.info("POST /api/projects - Creating project: {}", request.name());

        // Resolve organisation ID
        String resolvedOrganisationId = resolveOrganisationId(request.organisationId(), request.organisationName());

        ProjectDto created = projectService.createProject(
            request.name(),
            request.projectParentFolder(),
            request.projectHierarchy(),
            resolvedOrganisationId,
            request.repoUrl(),
            request.effectiveSetActive()
        );

        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /**
     * Resolves an organisation ID from either direct ID or organisation name lookup.
     *
     * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Changed parameter and return type from UUID to String
     *
     * @param organisationId Direct organisation ID (takes precedence if provided) - String type e.g., "org-xxxx"
     * @param organisationName Organisation name to lookup
     * @return Resolved organisation ID (String), or null if neither provided
     * @throws IllegalArgumentException if organisationName is provided but not found
     */
    private String resolveOrganisationId(String organisationId, String organisationName) {
        // If organisationId is directly provided, validate it exists
        if (organisationId != null && !organisationId.isBlank()) {
            log.debug("Validating organisation exists with id: {}", organisationId);
            organisationService.getOrganisationById(organisationId); // throws if not found
            return organisationId;
        }

        // If organisationName is provided, lookup and return ID
        if (organisationName != null && !organisationName.isBlank()) {
            log.debug("Looking up organisation by name: {}", organisationName);
            try {
                OrganisationDto org = organisationService.getOrganisationByName(organisationName.trim());
                return org.id();
            } catch (ResourceNotFoundException e) {
                // Convert 404 to 400 for organisationName lookup failure
                throw new IllegalArgumentException("Organisation not found: " + organisationName);
            }
        }

        // Neither provided - organisation is optional
        return null;
    }

    /**
     * Lists all projects.
     *
     * GET /api/projects
     *
     * @return List of all ProjectDto
     */
    @GetMapping
    public ResponseEntity<List<ProjectDto>> listProjects() {
        log.debug("GET /api/projects - Listing all projects");
        List<ProjectDto> projects = projectService.listProjects().stream()
            .map(p -> p.withImplementationRepos(
                projectImplementationRepoService.listRepos(p.id())))
            .toList();
        return ResponseEntity.ok(projects);
    }

    /**
     * Retrieves a single project by ID.
     *
     * GET /api/projects/{id}
     *
     * @param id The project ID
     * @return The ProjectDto
     * @throws ResourceNotFoundException if the project does not exist
     */
    @GetMapping("/{id}")
    public ResponseEntity<ProjectDto> getProjectById(@PathVariable UUID id) {
        log.debug("GET /api/projects/{} - Fetching project", id);
        ProjectDto project = projectService.getProjectById(id)
            .withImplementationRepos(projectImplementationRepoService.listRepos(id));
        return ResponseEntity.ok(project);
    }

    /**
     * Updates the per-project shape-spec generation config.
     *
     * <p>PATCH /api/projects/{id}</p>
     *
     * <p>Body: {@link UpdateProjectConfigRequest} -- carries the three nullable
     * Task-Group-9 fields. Any field set to {@code null} (or omitted from the
     * JSON body) is preserved as-is on the row; only non-null fields are
     * written. This null-guarded posture is required by
     * project_primitive_double_dto_overwrite.md: a primitive type would
     * silently wipe values on omitted-field PATCHes.</p>
     *
     * <p>Spec 2026-05-20: Cross-Story Context Injection -- Task Group 9</p>
     *
     * @param id The project ID
     * @param request The update config request
     * @return The updated ProjectDto with all current field values
     */
    @PatchMapping("/{id}")
    public ResponseEntity<ProjectDto> updateProjectConfig(
            @PathVariable UUID id,
            @RequestBody UpdateProjectConfigRequest request) {
        log.info("PATCH /api/projects/{} (perStoryCap={}, crossStoryCap={}, autoRunPass2={}, "
                + "implInitSuccess={}, implMode={}, implProjectDir={}, repoUrl={})",
            id,
            request.perStoryContextTokenCap(),
            request.crossStoryContextTokenCap(),
            request.autoRunPass2(),
            request.implementationInitSuccess(),
            request.implementationMode(),
            request.implementationProjectDir(),
            request.repoUrl());
        ProjectDto updated = projectService.updateProjectConfig(
            id,
            request.perStoryContextTokenCap(),
            request.crossStoryContextTokenCap(),
            request.autoRunPass2(),
            request.implementationInitSuccess(),
            request.implementationMode(),
            request.implementationProjectDir(),
            request.repoUrl());
        return ResponseEntity.ok(updated);
    }

    /**
     * Replaces the stored implementation-service workspace repo map wholesale.
     *
     * <p>PUT /api/projects/{id}/implementation-repos</p>
     *
     * <p>Body: {@link ReplaceImplementationReposRequest} -- the FULL
     * replacement map ({@code {repos: [{folder, git_url, workspace_dir?,
     * mode?}]}}). The gateway calls this to persist init results and to
     * auto-sync drift from the external service's reported map
     * (external-wins; AMS never pushes its stored map upstream).</p>
     *
     * <p>Returns the persisted rows in snake_case, ordered by folder.</p>
     *
     * <p>Spec 2026-06-12: Implementation-Service Init and Integration Repair
     * -- Task Group 1</p>
     *
     * @param id The project ID
     * @param request The full replacement repo map
     * @return The persisted repo map rows
     */
    @PutMapping("/{id}/implementation-repos")
    public ResponseEntity<List<ProjectImplementationRepoDto>> replaceImplementationRepos(
            @PathVariable UUID id,
            @RequestBody ReplaceImplementationReposRequest request) {
        int count = request != null && request.repos() != null ? request.repos().size() : 0;
        log.info("PUT /api/projects/{}/implementation-repos ({} entries)", id, count);
        List<ProjectImplementationRepoDto> stored =
            projectImplementationRepoService.replaceRepos(
                id, request == null ? null : request.repos());
        return ResponseEntity.ok(stored);
    }

    /**
     * Activates a specific project by ID.
     *
     * POST /api/projects/{id}/activate
     *
     * Deactivates all other projects and sets the specified project as active.
     *
     * @param id The project ID to activate
     * @return The activated ProjectDto
     */
    @PostMapping("/{id}/activate")
    public ResponseEntity<ProjectDto> activateProject(@PathVariable UUID id) {
        log.info("POST /api/projects/{}/activate - Activating project", id);
        ProjectDto activated = projectService.activateProject(id);
        return ResponseEntity.ok(activated);
    }

    @PostMapping("/deactivate-all")
    public ResponseEntity<Map<String, Object>> deactivateAllProjects() {
        log.info("POST /api/projects/deactivate-all");
        projectService.deactivateAllProjects();
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("message", "All projects deactivated successfully");
        return ResponseEntity.ok(response);
    }

    /**
     * Exports a specific project as a complete snapshot by project ID.
     *
     * GET /api/projects/{id}/export
     *
     * More robust than GET /api/projects/active/export because it does not
     * rely on the is_active flag, which can become stale if the frontend
     * context and database state diverge.
     *
     * @param id The project ID to export
     * @return ResponseEntity with ProjectSnapshotDto
     * @throws ResourceNotFoundException if the project does not exist
     */
    @GetMapping("/{id}/export")
    public ResponseEntity<ProjectSnapshotDto> exportProjectById(@PathVariable UUID id) {
        log.info("GET /api/projects/{}/export - Exporting project snapshot", id);
        ProjectSnapshotDto snapshot = projectSnapshotService.exportProjectById(id);
        return ResponseEntity.ok(snapshot);
    }

    /**
     * Deletes a project by ID.
     *
     * DELETE /api/projects/{id}
     *
     * Deletes both the project's filesystem contents (projectParentFolder)
     * and all database records associated with the project.
     *
     * Returns:
     * - 200 OK with success message on successful deletion
     * - 400 Bad Request if projectParentFolder is blank/invalid or root-like
     * - 404 Not Found if project does not exist
     * - 500 Internal Server Error if filesystem or database deletion fails
     *
     * Spec 2026-01-10: Project Menu + Delete Project
     *
     * @param id The project ID to delete
     * @return ResponseEntity with success message
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> deleteProject(@PathVariable UUID id) throws IOException {
        log.info("DELETE /api/projects/{} - Deleting project", id);

        projectService.deleteProject(id);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("message", "Project deleted successfully");

        return ResponseEntity.ok(response);
    }
}
