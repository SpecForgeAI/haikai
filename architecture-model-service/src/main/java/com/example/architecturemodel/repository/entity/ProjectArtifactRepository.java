package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ProjectArtifactEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for ProjectArtifactEntity.
 *
 * Provides CRUD operations and custom query methods for versioned
 * project artifacts with revision tracking.
 */
@Repository
public interface ProjectArtifactRepository extends JpaRepository<ProjectArtifactEntity, UUID> {

    /**
     * Find the latest revision of an artifact by project and type.
     *
     * @param projectId the project UUID
     * @param artifactType the artifact type (MISSION_MD, ROADMAP_MD, BACKLOG_MD)
     * @return the latest revision, or empty if none exist
     */
    Optional<ProjectArtifactEntity> findFirstByProjectIdAndArtifactTypeOrderByRevisionDesc(
        UUID projectId, String artifactType);

    /**
     * Find all revisions of an artifact by project and type, ordered by revision descending.
     *
     * @param projectId the project UUID
     * @param artifactType the artifact type
     * @return list of all revisions, newest first
     */
    List<ProjectArtifactEntity> findByProjectIdAndArtifactTypeOrderByRevisionDesc(
        UUID projectId, String artifactType);

    /**
     * Find a specific revision of an artifact.
     *
     * @param projectId the project UUID
     * @param artifactType the artifact type
     * @param revision the revision number
     * @return the artifact at that revision, or empty if not found
     */
    Optional<ProjectArtifactEntity> findByProjectIdAndArtifactTypeAndRevision(
        UUID projectId, String artifactType, Integer revision);

    /**
     * Find all artifacts for a project, ordered by creation date descending.
     *
     * @param projectId the project UUID
     * @return list of all artifacts for the project
     */
    List<ProjectArtifactEntity> findByProjectIdOrderByCreatedAtDesc(UUID projectId);

    /**
     * Delete all artifacts for a project.
     *
     * @param projectId the project UUID
     */
    void deleteByProjectId(UUID projectId);

    /**
     * Count artifacts for a project.
     *
     * @param projectId the project UUID
     * @return count of artifacts
     */
    long countByProjectId(UUID projectId);
}
