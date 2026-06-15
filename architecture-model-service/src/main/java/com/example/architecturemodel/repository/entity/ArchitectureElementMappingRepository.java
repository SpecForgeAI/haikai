package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link ArchitectureElementMappingEntity}.
 *
 * Supports:
 * <ul>
 *   <li>Lookup by project + source/target architecture pair (the Mapping Review
 *       modal's primary list seed).</li>
 *   <li>Filtered search across the optional query params surfaced by the
 *       controller ({@code sourceElementType}, {@code targetElementType},
 *       {@code mappingType}, {@code status}, free-text {@code q} searched
 *       against source/target element ids and notes).</li>
 *   <li>Existence check for the duplicate-mapping guard in the service layer
 *       (mirrors the unique constraint on
 *       {@code (project_id, source_arch, target_arch, source_type, source_id,
 *       target_type, target_id, mapping_type)}).</li>
 * </ul>
 *
 * <p>Spec: Create Target Baseline from Current State (2026-05-15) -- Task Group 1</p>
 */
@Repository
public interface ArchitectureElementMappingRepository
        extends JpaRepository<ArchitectureElementMappingEntity, UUID> {

    /**
     * Finds all mappings for a (project, source-arch, target-arch) triple,
     * with no additional filtering. Used as the unfiltered seed for the
     * Mapping Review modal.
     */
    List<ArchitectureElementMappingEntity>
        findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
            UUID projectId, UUID sourceArchitectureId, UUID targetArchitectureId);

    /**
     * Existence probe used by the service-layer duplicate guard. Mirrors the
     * unique constraint columns 1:1 so a successful pre-check avoids the
     * structural {@code DataIntegrityViolationException} round-trip in the
     * happy duplicate-add case.
     */
    boolean existsByProjectIdAndSourceArchitectureIdAndTargetArchitectureIdAndSourceElementTypeAndSourceElementIdAndTargetElementTypeAndTargetElementIdAndMappingType(
        UUID projectId,
        UUID sourceArchitectureId,
        UUID targetArchitectureId,
        String sourceElementType,
        String sourceElementId,
        String targetElementType,
        String targetElementId,
        String mappingType);

    /**
     * Filtered search supporting the controller's optional query params. All
     * parameters except {@code projectId} are optional and ignored when null
     * or blank. The free-text {@code q} parameter matches against
     * {@code sourceElementId}, {@code targetElementId}, and {@code notes}
     * (case-insensitive substring) — the existing search filters on the
     * Mapping Review modal.
     *
     * <p>The query keeps {@code sourceArchitectureId} and {@code targetArchitectureId}
     * optional so the controller can also serve a project-wide "all mappings"
     * call (future use); v1 wizard always passes both.</p>
     */
    @Query(
        "SELECT m FROM ArchitectureElementMappingEntity m " +
        "WHERE m.projectId = :projectId " +
        "  AND (:sourceArchitectureId IS NULL OR m.sourceArchitectureId = :sourceArchitectureId) " +
        "  AND (:targetArchitectureId IS NULL OR m.targetArchitectureId = :targetArchitectureId) " +
        "  AND (:sourceElementType IS NULL OR m.sourceElementType = :sourceElementType) " +
        "  AND (:targetElementType IS NULL OR m.targetElementType = :targetElementType) " +
        "  AND (:mappingType IS NULL OR m.mappingType = :mappingType) " +
        "  AND (:status IS NULL OR m.status = :status) " +
        "  AND (:q IS NULL OR " +
        "       LOWER(m.sourceElementId) LIKE LOWER(CONCAT('%', CAST(:q AS STRING), '%')) OR " +
        "       LOWER(m.targetElementId) LIKE LOWER(CONCAT('%', CAST(:q AS STRING), '%')) OR " +
        "       (m.notes IS NOT NULL AND LOWER(m.notes) LIKE LOWER(CONCAT('%', CAST(:q AS STRING), '%')))" +
        "  ) " +
        "ORDER BY m.createdAt ASC, m.id ASC")
    List<ArchitectureElementMappingEntity> search(
        @Param("projectId") UUID projectId,
        @Param("sourceArchitectureId") UUID sourceArchitectureId,
        @Param("targetArchitectureId") UUID targetArchitectureId,
        @Param("sourceElementType") String sourceElementType,
        @Param("targetElementType") String targetElementType,
        @Param("mappingType") String mappingType,
        @Param("status") String status,
        @Param("q") String q);
}
