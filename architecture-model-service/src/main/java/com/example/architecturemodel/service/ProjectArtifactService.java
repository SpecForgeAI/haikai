package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.ProjectArtifactMapper;
import com.example.architecturemodel.model.dto.ProjectArtifactDto;
import com.example.architecturemodel.model.dto.ProjectArtifactMetadataDto;
import com.example.architecturemodel.model.entity.ProjectArtifactEntity;
import com.example.architecturemodel.repository.entity.ProjectArtifactRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for managing Project Artifacts with auto-revision logic.
 *
 * Handles versioned markdown artifacts (mission.md, roadmap.md, backlog.md)
 * with automatic revision increment on each create.
 *
 * Spec 2026-01-04: Roadmap Import UX Glue - Added getLatestArtifactMetadata method.
 *
 * <p>Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Task Group 3 added the
 * {@link #ARTIFACT_TYPE_MISSING_INPUT_CONTRACT_UPLOAD} value to the
 * {@link #ALLOWED_ARTIFACT_TYPES} set so the parse-files endpoint can persist
 * the uploaded OAS / WSDL bytes back through the existing artefact write path
 * (no new entity, no new repository).</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ProjectArtifactService {

    private final ProjectArtifactRepository projectArtifactRepository;

    // ============================================================================
    // Allowed enum values for validation
    // ============================================================================

    /**
     * Artifact-type stamp written to {@code project_artifact.artifact_type}
     * when the OAS/WSDL parse-files endpoint persists the raw uploaded file
     * bytes on commit. Lowercase by convention (the existing markdown types
     * are uppercase but the contract-upload corpus is open-vocabulary per
     * spec, so we mirror the {@code resolution_source = 'oas_wsdl_upload'}
     * vocabulary for consistency).
     *
     * <p>Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Task Group 3.</p>
     */
    public static final String ARTIFACT_TYPE_MISSING_INPUT_CONTRACT_UPLOAD =
        "missing_input_contract_upload";

    private static final Set<String> ALLOWED_ARTIFACT_TYPES = Set.of(
        "MISSION_MD", "ROADMAP_MD", "BACKLOG_MD", "DISCOVERY_BRIEF_MD",
        ARTIFACT_TYPE_MISSING_INPUT_CONTRACT_UPLOAD
    );

    private static final Set<String> ALLOWED_SOURCES = Set.of(
        "AGENT_OS", "TOOL", "USER_EDIT"
    );

    // ============================================================================
    // Public API Methods
    // ============================================================================

    /**
     * Get the latest revision of an artifact by project and type.
     *
     * @param projectId the project ID
     * @param artifactType the artifact type
     * @return the latest revision
     * @throws ResourceNotFoundException if no revisions exist
     */
    @Transactional(readOnly = true)
    public ProjectArtifactDto getLatestArtifact(UUID projectId, String artifactType) {
        log.debug("Getting latest artifact for project: {}, type: {}", projectId, artifactType);

        validateArtifactType(artifactType);

        ProjectArtifactEntity entity = projectArtifactRepository
            .findFirstByProjectIdAndArtifactTypeOrderByRevisionDesc(projectId, artifactType)
            .orElseThrow(() -> new ResourceNotFoundException(
                "No artifact found for project: " + projectId + ", type: " + artifactType));

        return ProjectArtifactMapper.toDto(entity);
    }

    /**
     * Get lightweight metadata for the latest revision of an artifact.
     *
     * Spec 2026-01-04: Roadmap Import UX Glue - Task Group 2
     * Returns metadata without content for efficient status checks.
     *
     * @param projectId the project ID
     * @param artifactType the artifact type (must be in allowlist: MISSION_MD, ROADMAP_MD)
     * @return the latest revision metadata without content
     * @throws ResourceNotFoundException if no revisions exist
     * @throws IllegalArgumentException if artifact type is not allowed
     */
    @Transactional(readOnly = true)
    public ProjectArtifactMetadataDto getLatestArtifactMetadata(UUID projectId, String artifactType) {
        log.debug("Getting latest artifact metadata for project: {}, type: {}", projectId, artifactType);

        validateArtifactType(artifactType);

        ProjectArtifactEntity entity = projectArtifactRepository
            .findFirstByProjectIdAndArtifactTypeOrderByRevisionDesc(projectId, artifactType)
            .orElseThrow(() -> new ResourceNotFoundException(
                "No artifact found for project: " + projectId + ", type: " + artifactType));

        // Map to metadata DTO (excludes content)
        return new ProjectArtifactMetadataDto(
            entity.getProjectId(),
            entity.getArtifactType(),
            entity.getRevision(),
            entity.getCreatedAt(),
            entity.getSource()
        );
    }

    /**
     * Get all revisions of an artifact by project and type.
     *
     * @param projectId the project ID
     * @param artifactType the artifact type
     * @return list of all revisions, newest first
     */
    @Transactional(readOnly = true)
    public List<ProjectArtifactDto> getArtifactRevisions(UUID projectId, String artifactType) {
        log.debug("Getting all revisions for project: {}, type: {}", projectId, artifactType);

        validateArtifactType(artifactType);

        List<ProjectArtifactEntity> entities = projectArtifactRepository
            .findByProjectIdAndArtifactTypeOrderByRevisionDesc(projectId, artifactType);

        return entities.stream()
            .map(ProjectArtifactMapper::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Get an artifact by ID.
     *
     * @param id the artifact ID
     * @return the artifact DTO
     * @throws ResourceNotFoundException if not found
     */
    @Transactional(readOnly = true)
    public ProjectArtifactDto getArtifactById(UUID id) {
        log.debug("Getting artifact with id: {}", id);

        ProjectArtifactEntity entity = projectArtifactRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Artifact not found: " + id));

        return ProjectArtifactMapper.toDto(entity);
    }

    /**
     * Create a new artifact revision with auto-incremented revision number.
     *
     * @param projectId the project ID
     * @param artifactType the artifact type
     * @param dto the artifact DTO (content and source)
     * @return the created artifact DTO with revision number
     * @throws IllegalArgumentException if validation fails
     */
    @Transactional
    public ProjectArtifactDto createArtifact(UUID projectId, String artifactType,
                                              ProjectArtifactDto dto) {
        log.debug("Creating artifact for project: {}, type: {}", projectId, artifactType);

        // Validate artifact type and source
        validateArtifactType(artifactType);
        validateSource(dto.source());

        // Validate content is provided
        if (dto.content() == null || dto.content().isBlank()) {
            throw new IllegalArgumentException("Artifact content is required");
        }

        // Calculate next revision number
        int nextRevision = calculateNextRevision(projectId, artifactType);

        // Create and save entity
        ProjectArtifactEntity entity = ProjectArtifactMapper.toEntity(
            dto, projectId, artifactType, nextRevision);
        if (entity.getId() == null) {
            entity.setId(UUID.randomUUID());
        }

        ProjectArtifactEntity saved = projectArtifactRepository.save(entity);
        log.debug("Created artifact with id: {}, revision: {}", saved.getId(), saved.getRevision());

        return ProjectArtifactMapper.toDto(saved);
    }

    /**
     * Delete an artifact by ID.
     *
     * @param id the artifact ID
     * @throws ResourceNotFoundException if not found
     */
    @Transactional
    public void deleteArtifact(UUID id) {
        log.debug("Deleting artifact with id: {}", id);

        if (!projectArtifactRepository.existsById(id)) {
            throw new ResourceNotFoundException("Artifact not found: " + id);
        }

        projectArtifactRepository.deleteById(id);
        log.debug("Deleted artifact with id: {}", id);
    }

    // ============================================================================
    // Validation Methods
    // ============================================================================

    /**
     * Validate that the artifact type is allowed.
     *
     * @param artifactType the artifact type to validate
     * @throws IllegalArgumentException if invalid
     */
    private void validateArtifactType(String artifactType) {
        if (artifactType == null || artifactType.isBlank()) {
            throw new IllegalArgumentException("Artifact type is required");
        }
        if (!ALLOWED_ARTIFACT_TYPES.contains(artifactType)) {
            throw new IllegalArgumentException(
                "Invalid artifact type: " + artifactType +
                ". Allowed values: " + ALLOWED_ARTIFACT_TYPES);
        }
    }

    /**
     * Validate that the source is allowed.
     *
     * @param source the source to validate
     * @throws IllegalArgumentException if invalid
     */
    private void validateSource(String source) {
        if (source != null && !source.isBlank() && !ALLOWED_SOURCES.contains(source)) {
            throw new IllegalArgumentException(
                "Invalid source: " + source + ". Allowed values: " + ALLOWED_SOURCES);
        }
    }

    /**
     * Calculate the next revision number for an artifact.
     *
     * @param projectId the project ID
     * @param artifactType the artifact type
     * @return the next revision number (max + 1, or 1 if no prior revisions)
     */
    private int calculateNextRevision(UUID projectId, String artifactType) {
        return projectArtifactRepository
            .findFirstByProjectIdAndArtifactTypeOrderByRevisionDesc(projectId, artifactType)
            .map(entity -> entity.getRevision() + 1)
            .orElse(1);
    }
}
