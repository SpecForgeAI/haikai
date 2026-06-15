package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.ModelFileEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Repository for ModelFileEntity.
 *
 * Spec 2026-01-10: Project Menu + Delete Project
 * Added deleteByFilename method for project deletion support.
 *
 * Spec "Multi-Architecture Plumbing" (Spec #1):
 * Added architecture-scoped finder. Every Bucket A query that previously
 * filtered by project_id alone now goes through this method so the
 * (project_id, architecture_id) pair is enforced at the repository layer.
 *
 * Spec "Cross-Architecture Save Bug Fix" (Spec 2026-05-01):
 * Added {@link #findByFilenameAndArchitectureId(String, UUID)} so
 * post-clone saves disambiguate between the two model_files rows that share
 * a filename across architectures (changeset 096 relaxed the global UNIQUE
 * to a per-architecture composite UNIQUE INDEX). Without it,
 * {@link #findByFilename(String)} returns whichever row PostgreSQL hands
 * back first, which after a clone is non-deterministic and corrupts the
 * other architecture on save.
 */
@Repository
public interface ModelFileRepository extends JpaRepository<ModelFileEntity, String> {

    /**
     * Find a model file by filename only.
     *
     * <p><b>WARNING:</b> after spec #6 (changeset 096) made
     * {@code (architecture_id, filename)} the uniqueness boundary, this
     * method returns at most ONE row but the choice is non-deterministic
     * when multiple architectures share a filename (e.g. after a full
     * architecture clone). New callers should prefer
     * {@link #findByFilenameAndArchitectureId(String, UUID)} or
     * {@link #findByProjectIdAndArchitectureId(UUID, UUID)} so the lookup
     * is architecture-aware. This method is preserved for legacy
     * single-architecture flows that have no architecture context.</p>
     */
    Optional<ModelFileEntity> findByFilename(String filename);

    /**
     * Find a model file by (filename, architecture_id) pair.
     *
     * <p>This is the architecture-scoped equivalent of
     * {@link #findByFilename(String)}. After spec #6 (changeset 096) made
     * filename uniqueness scoped per architecture, callers that have an
     * architecture context (the active architecture from the URL or the
     * resolved Default for the active project) MUST use this method.</p>
     *
     * <p>Spec: Cross-Architecture Save Bug Fix (Spec 2026-05-01).</p>
     *
     * @param filename       the filename
     * @param architectureId the architecture UUID the file belongs to
     * @return the matching model file, or empty if no row matches.
     */
    Optional<ModelFileEntity> findByFilenameAndArchitectureId(String filename, UUID architectureId);

    Optional<ModelFileEntity> findByFilenameIgnoreCase(String filename);

    Optional<ModelFileEntity> findByIsDefaultTrue();

    boolean existsByFilename(String filename);

    /**
     * Find a model file by its associated project UUID.
     *
     * Note: this method is preserved for non-Bucket-A callers (Bucket B
     * controllers, internal save flows). Bucket A callers MUST use
     * {@link #findByProjectIdAndArchitectureId(UUID, UUID)} so the
     * architecture scoping is enforced.
     *
     * @param projectId The project UUID
     * @return The model file entity, or empty if not found
     */
    Optional<ModelFileEntity> findByProjectId(UUID projectId);

    /**
     * Find a model file by project UUID AND architecture UUID.
     *
     * This is the architecture-scoped query used by every Bucket A
     * service entry-point. Returns empty when either the project has no
     * model file or the model file does not belong to the requested
     * architecture.
     *
     * Spec: Multi-Architecture Plumbing (Spec #1)
     *
     * @param projectId The project UUID
     * @param architectureId The architecture UUID (must match the model
     *   file's architecture_id column)
     * @return The model file entity, or empty if not found
     */
    Optional<ModelFileEntity> findByProjectIdAndArchitectureId(UUID projectId, UUID architectureId);

    /**
     * Deletes a model file by its filename.
     *
     * Spec 2026-01-10: Project Menu + Delete Project
     *
     * @param filename The filename to delete
     */
    void deleteByFilename(String filename);
}
