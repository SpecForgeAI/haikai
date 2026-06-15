package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.TemporaryDiagramEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for TemporaryDiagramEntity.
 *
 * Provides CRUD operations and custom finder methods for temporary architecture diagrams.
 *
 * Spec 2026-03-26: MCP Endpoint for Saving Temporary Architecture Diagrams (Increment 3)
 * - Task Group 1: Liquibase Migration and JPA Entity
 *
 * Spec "Multi-Architecture Plumbing" (Spec #1):
 * - Added architecture-scoped finder. The legacy
 *   {@link #findByProjectIdAndTemporaryDiagramId(UUID, String)} method is
 *   preserved for non-Bucket-A internal use only; Bucket A callers MUST use
 *   {@link #findByProjectIdAndArchitectureIdAndTemporaryDiagramId(UUID, UUID, String)}.
 */
@Repository
public interface TemporaryDiagramRepository extends JpaRepository<TemporaryDiagramEntity, UUID> {

    /**
     * Find a temporary diagram by project ID and temporary diagram ID (legacy).
     *
     * Preserved for backwards compatibility within the architecture-model-service
     * itself; not safe to use from Bucket A controllers because it does not enforce
     * architecture scoping.
     *
     * @param projectId the project UUID
     * @param temporaryDiagramId the client/LLM-provided diagram identifier
     * @return the temporary diagram entity if found, empty Optional otherwise
     */
    Optional<TemporaryDiagramEntity> findByProjectIdAndTemporaryDiagramId(UUID projectId, String temporaryDiagramId);

    /**
     * Find a temporary diagram by (project ID, architecture ID, temporary diagram ID).
     *
     * Architecture-scoped lookup used by every Bucket A controller. Returns empty
     * if the diagram does not exist OR if it exists in a sibling architecture
     * within the same project.
     *
     * Spec: Multi-Architecture Plumbing (Spec #1)
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @param temporaryDiagramId the client/LLM-provided diagram identifier
     * @return the temporary diagram entity if found in the matching architecture,
     *   empty otherwise
     */
    Optional<TemporaryDiagramEntity> findByProjectIdAndArchitectureIdAndTemporaryDiagramId(
        UUID projectId, UUID architectureId, String temporaryDiagramId);
}
