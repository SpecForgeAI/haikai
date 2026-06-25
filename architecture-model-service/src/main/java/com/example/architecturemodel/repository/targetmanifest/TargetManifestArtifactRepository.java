package com.example.architecturemodel.repository.targetmanifest;

import com.example.architecturemodel.model.entity.targetmanifest.TargetManifestArtifactEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

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
}
