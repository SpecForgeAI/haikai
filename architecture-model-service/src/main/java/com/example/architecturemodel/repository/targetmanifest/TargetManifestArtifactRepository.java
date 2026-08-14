package com.example.architecturemodel.repository.targetmanifest;

import com.example.architecturemodel.model.entity.targetmanifest.TargetManifestArtifactEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data repository for {@link TargetManifestArtifactEntity}.
 *
 * <p>Backs the "replace latest, keep history" lifecycle for the confirmed
 * target manifest store: the demote lookup scoped per
 * {@code (project_id, target_architecture_id, tag)} that the write service
 * flips to {@code is_latest=false} before inserting the new latest row, and the
 * latest read (one row per tag) the producer consumes for a
 * {@code (project_id, target_architecture_id)}. Mirrors
 * {@code repository/vulnerability/VulnerabilityReportRepository.java}
 * conventions (derived finders, no service logic in the repo).</p>
 *
 * <p>Spec: Confirmed Manifest Producer Wiring (2026-06-25, Spec 5 Phase 2) --
 * Task Group 1.</p>
 */
@Repository
public interface TargetManifestArtifactRepository
        extends JpaRepository<TargetManifestArtifactEntity, UUID> {

    /**
     * The current latest artifact for a
     * {@code (project_id, target_architecture_id, tag)} triple. AT MOST one row
     * carries {@code is_latest=true} per triple (the write service guarantees
     * this by flipping the prior latest before insert). Used by the write
     * service to find the row to demote on re-upload. The flip is scoped to this
     * triple so distinct tags flip independently.
     */
    Optional<TargetManifestArtifactEntity>
        findFirstByProjectIdAndTargetArchitectureIdAndTagAndIsLatestTrue(
            UUID projectId, UUID targetArchitectureId, String tag);

    /**
     * The current latest artifacts for a
     * {@code (project_id, target_architecture_id)} -- one latest row per tag.
     * The producer reads this to emit the verbatim build file for each tag into
     * the generated target codebase. Filters {@code is_latest=true}; ordered by
     * {@code tag} for a stable read.
     */
    List<TargetManifestArtifactEntity>
        findByProjectIdAndTargetArchitectureIdAndIsLatestTrueOrderByTagAsc(
            UUID projectId, UUID targetArchitectureId);

    /**
     * Logical FK cleanup: null {@code target_service_element_id} on EVERY row
     * (latest and historical) that points at the supplied target-state
     * {@code services} element id. Invoked when a {@code services} element is
     * archived (removed) from a target architecture so the manifest's logical
     * FK never dangles -- there is NO physical DB foreign key (elements are
     * soft-deleted, not hard-deleted), so the cascade is applied here.
     *
     * <p>Service element ids are globally unique STRINGS ({@code svc-<slug>} --
     * 2026-08-14, changeset 223), so nulling by element id alone is precise and
     * needs no {@code (project, target_architecture)} scoping. Returns the
     * number of rows updated.</p>
     *
     * <p>Spec: Target Manifest -&gt; Service Association (Foreign Key)
     * (2026-06-26) -- Task Group 2, FR6.</p>
     */
    @Modifying
    @Query("UPDATE TargetManifestArtifactEntity e SET e.targetServiceElementId = null "
        + "WHERE e.targetServiceElementId = :serviceElementId")
    int clearTargetServiceElementId(@Param("serviceElementId") String serviceElementId);

    /**
     * Batch variant of {@link #clearTargetServiceElementId(String)}: null
     * {@code target_service_element_id} on every row pointing at any of the
     * supplied (archived/removed) service element ids. Used by the whole-model
     * save path which removes several {@code services} elements at once.
     * Returns the number of rows updated.
     *
     * <p>Spec: Target Manifest -&gt; Service Association (Foreign Key)
     * (2026-06-26) -- Task Group 2, FR6.</p>
     */
    @Modifying
    @Query("UPDATE TargetManifestArtifactEntity e SET e.targetServiceElementId = null "
        + "WHERE e.targetServiceElementId IN :serviceElementIds")
    int clearTargetServiceElementIdIn(
        @Param("serviceElementIds") Collection<String> serviceElementIds);
}
