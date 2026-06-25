package com.example.architecturemodel.service.targetmanifest;

import com.example.architecturemodel.model.dto.targetmanifest.TargetManifestArtifactDto;
import com.example.architecturemodel.model.dto.targetmanifest.TargetManifestArtifactInput;
import com.example.architecturemodel.model.entity.targetmanifest.TargetManifestArtifactEntity;
import com.example.architecturemodel.repository.targetmanifest.TargetManifestArtifactRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Write + read service for the confirmed target manifest store (Spec 5 Phase 2,
 * Task Group 1): the replace-latest / keep-history persistence and the latest
 * read the producer consumes.
 *
 * <p>Mirrors {@code VulnerabilityIngestionService}'s write posture
 * ({@code @Transactional}, {@code @ConditionalOnProperty("app.features.include-database")})
 * and its demote-prior-latest-then-insert idiom -- but scoped per
 * {@code (project_id, target_architecture_id, tag)} rather than per
 * {@code (project_id, architecture_id, source)}.</p>
 *
 * <h2>Replace-latest / keep-history (per tag)</h2>
 * For each artifact in the upload, the prior latest row for its
 * {@code (project_id, target_architecture_id, tag)} is flipped
 * {@code is_latest=false} (NOT deleted); a new {@code is_latest=true} row is
 * inserted. Prior rows are retained as history (append-only, NO deletes). The
 * flip is scoped per tag so distinct tags flip independently -- a sibling tag's
 * latest is never demoted.
 *
 * <h2>Latest read (per architecture)</h2>
 * Returns the latest artifacts (one row per tag) for a
 * {@code (project_id, target_architecture_id)} -- the verbatim bytes the
 * producer emits into the generated target codebase.
 *
 * <p>Spec: Confirmed Manifest Producer Wiring (2026-06-25, Spec 5 Phase 2) --
 * Task Group 1.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class TargetManifestArtifactService {

    private final TargetManifestArtifactRepository repository;

    /**
     * Persist the confirmed manifest artifacts for a target architecture,
     * replacing the latest per tag and keeping history. Per artifact: demote the
     * prior latest for its {@code (project_id, target_architecture_id, tag)} to
     * {@code is_latest=false}, then insert the new {@code is_latest=true} row.
     * Artifacts with a blank tag are SKIPPED (and logged) -- the tag is the
     * latest-flip + per-module placement key and must be present; nothing is
     * silently dropped without a log line.
     *
     * @param projectId            the owning project
     * @param targetArchitectureId the owning target architecture
     * @param artifacts            the confirmed manifest artifacts (one per tag)
     * @return the persisted latest artifacts (one per tag), newest values
     */
    @Transactional
    public List<TargetManifestArtifactDto> persistLatest(UUID projectId,
                                                         UUID targetArchitectureId,
                                                         List<TargetManifestArtifactInput> artifacts) {
        List<TargetManifestArtifactInput> inputs =
            artifacts == null ? List.of() : artifacts;
        int received = inputs.size();
        int persisted = 0;
        int skipped = 0;

        for (TargetManifestArtifactInput input : inputs) {
            if (input == null) {
                skipped++;
                continue;
            }
            String tag = input.tag() == null ? null : input.tag().trim();
            if (tag == null || tag.isEmpty()) {
                // The tag is the latest-flip + per-module placement key -- an
                // artifact with no tag cannot be placed or scoped. Skip it but
                // NEVER silently: log so the drop is accounted for.
                skipped++;
                log.warn("Target manifest persist: skipping artifact with blank tag "
                    + "(project={}, targetArchitecture={})",
                    projectId, targetArchitectureId);
                continue;
            }

            // 1) Demote the prior latest for this (project, targetArchitecture, tag).
            Optional<TargetManifestArtifactEntity> priorLatest =
                repository.findFirstByProjectIdAndTargetArchitectureIdAndTagAndIsLatestTrue(
                    projectId, targetArchitectureId, tag);
            priorLatest.ifPresent(prior -> {
                prior.setIsLatest(false);
                repository.save(prior);
                log.debug("Target manifest persist: demoted prior latest artifact {} "
                    + "(project={}, targetArchitecture={}, tag={})",
                    prior.getId(), projectId, targetArchitectureId, tag);
            });

            // 2) Insert the new latest row (verbatim content carried unchanged).
            TargetManifestArtifactEntity entity = TargetManifestArtifactEntity.builder()
                .id(UUID.randomUUID())
                .projectId(projectId)
                .targetArchitectureId(targetArchitectureId)
                .tag(tag)
                .kind(input.kind())
                .ecosystem(input.ecosystem())
                .manifestPath(input.manifestPath())
                .content(input.content())
                .packageLockContent(input.packageLockContent())
                .resolvedDependencies(input.resolvedDependencies() == null
                    ? new ArrayList<>() : new ArrayList<>(input.resolvedDependencies()))
                .isLatest(Boolean.TRUE)
                .build();
            repository.save(entity);
            persisted++;
        }
        repository.flush();

        log.info("Target manifest persist complete: project={}, targetArchitecture={}, "
            + "received={}, persisted={}, skipped={}",
            projectId, targetArchitectureId, received, persisted, skipped);

        return findLatest(projectId, targetArchitectureId);
    }

    /**
     * The latest artifacts (one row per tag) for a
     * {@code (project_id, target_architecture_id)}. Filters
     * {@code is_latest=true}; this is the read the producer consumes to emit the
     * verbatim build file for each tag.
     */
    @Transactional(readOnly = true)
    public List<TargetManifestArtifactDto> findLatest(UUID projectId,
                                                     UUID targetArchitectureId) {
        return repository
            .findByProjectIdAndTargetArchitectureIdAndIsLatestTrueOrderByTagAsc(
                projectId, targetArchitectureId)
            .stream()
            .map(TargetManifestArtifactDto::fromEntity)
            .toList();
    }
}
