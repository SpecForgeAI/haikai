package com.example.architecturemodel.service.targetmanifest;

import com.example.architecturemodel.exception.ValidationException;
import com.example.architecturemodel.model.dto.targetmanifest.TargetManifestArtifactDto;
import com.example.architecturemodel.model.dto.targetmanifest.TargetManifestArtifactInput;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.ServiceEntity;
import com.example.architecturemodel.model.entity.targetmanifest.TargetManifestArtifactEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.ServiceRepository;
import com.example.architecturemodel.repository.targetmanifest.TargetManifestArtifactRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collection;
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
 * <h2>Service-element ownership validation (Spec 2026-06-26, Task Group 2)</h2>
 * Every non-null {@code target_service_element_id} carried by an artifact is
 * validated UP-FRONT (before any row is written) to resolve to a {@code services}
 * element that belongs to the path {@code targetArchitectureId} and is live
 * (still present -- elements are soft-deleted by removal, so a removed/archived
 * element no longer resolves). An unknown, removed/archived, or
 * cross-architecture id is rejected with a {@link ValidationException} (HTTP
 * 400) so a dangling logical FK is NEVER persisted.
 *
 * <p>Spec: Confirmed Manifest Producer Wiring (2026-06-25, Spec 5 Phase 2) --
 * Task Group 1. Extended: Target Manifest -&gt; Service Association (Foreign Key)
 * (2026-06-26) -- Task Group 2 (ownership validation + logical FK cleanup).</p>
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
    private final ModelFileRepository modelFileRepository;
    private final ServiceRepository serviceRepository;

    /**
     * Persist the confirmed manifest artifacts for a target architecture,
     * replacing the latest per tag and keeping history. Per artifact: demote the
     * prior latest for its {@code (project_id, target_architecture_id, tag)} to
     * {@code is_latest=false}, then insert the new {@code is_latest=true} row.
     * Artifacts with a blank tag are SKIPPED (and logged) -- the tag is the
     * latest-flip + per-module placement key and must be present; nothing is
     * silently dropped without a log line.
     *
     * <p>Every non-null {@code target_service_element_id} is validated UP-FRONT
     * (before any write) to belong to the path {@code targetArchitectureId} and
     * to still resolve to a live {@code services} element; an unknown,
     * removed/archived, or cross-architecture id aborts the whole write with a
     * {@link ValidationException} so no dangling logical FK is persisted.</p>
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

        // Validate EVERY non-null service-element FK up-front, before a single
        // row is written, so a reject leaves the store untouched (no partial
        // persist, no dangling FK).
        for (TargetManifestArtifactInput input : inputs) {
            if (input != null) {
                validateServiceElementOwnership(
                    projectId, targetArchitectureId, input.targetServiceElementId());
            }
        }

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
                .tier2Facts(input.tier2Facts() == null
                    ? new ArrayList<>() : new ArrayList<>(input.tier2Facts()))
                .targetServiceElementId(input.targetServiceElementId())
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
     * Ownership guard for a single artifact's {@code target_service_element_id}.
     * A {@code null} id is allowed (the FK is optional on the wire / legacy
     * rows). A non-null id MUST resolve to a {@code services} element that
     * belongs to the model file of the path {@code (projectId,
     * targetArchitectureId)} and still exists. Because {@code services} elements
     * are soft-deleted by removal (no per-row {@code archived} flag; a removed
     * element has no row), an archived element fails the {@code findById} lookup
     * and is rejected exactly like an unknown id. A live element belonging to a
     * DIFFERENT architecture fails the model-file match and is rejected as
     * cross-architecture.
     *
     * @throws ValidationException (HTTP 400) when the id is unknown,
     *         removed/archived, or cross-architecture.
     */
    private void validateServiceElementOwnership(UUID projectId,
                                                 UUID targetArchitectureId,
                                                 UUID serviceElementId) {
        if (serviceElementId == null) {
            return;
        }

        ModelFileEntity modelFile = modelFileRepository
            .findByProjectIdAndArchitectureId(projectId, targetArchitectureId)
            .orElseThrow(() -> new ValidationException(
                "services", "service_element_not_in_architecture", "target_service_element_id",
                serviceElementId.toString(), null,
                "Target service element " + serviceElementId
                    + " cannot be validated: no model file for project " + projectId
                    + " architecture " + targetArchitectureId));

        ServiceEntity service = serviceRepository.findById(serviceElementId.toString())
            .orElseThrow(() -> new ValidationException(
                "services", "service_element_not_found", "target_service_element_id",
                serviceElementId.toString(), null,
                "Target service element " + serviceElementId
                    + " not found (unknown or archived)"));

        if (!modelFile.getId().equals(service.getModelFileId())) {
            throw new ValidationException(
                "services", "service_element_not_in_architecture", "target_service_element_id",
                serviceElementId.toString(), service.getName(),
                "Target service element " + serviceElementId
                    + " does not belong to architecture " + targetArchitectureId);
        }
    }

    /**
     * Logical FK cleanup on archive (removal) of a single target-state
     * {@code services} element: null {@code target_service_element_id} on every
     * dependent manifest row (latest and history) so the logical FK never
     * dangles. There is NO physical DB foreign key (elements are soft-deleted,
     * not hard-deleted), so this is the cascade.
     *
     * @param serviceElementId the archived/removed service element id (no-op if
     *                         {@code null})
     * @return the number of manifest rows whose FK was nulled
     */
    @Transactional
    public int onServiceElementArchived(UUID serviceElementId) {
        if (serviceElementId == null) {
            return 0;
        }
        int cleared = repository.clearTargetServiceElementId(serviceElementId);
        if (cleared > 0) {
            log.info("Target manifest FK cleanup: nulled target_service_element_id on {} "
                + "manifest row(s) for archived service element {}", cleared, serviceElementId);
        }
        return cleared;
    }

    /**
     * Batch variant of {@link #onServiceElementArchived(UUID)} for the
     * whole-model save path which removes several {@code services} elements at
     * once. Null/empty input is a no-op.
     *
     * @param serviceElementIds the archived/removed service element ids
     * @return the number of manifest rows whose FK was nulled
     */
    @Transactional
    public int onServiceElementsArchived(Collection<UUID> serviceElementIds) {
        if (serviceElementIds == null || serviceElementIds.isEmpty()) {
            return 0;
        }
        int cleared = repository.clearTargetServiceElementIdIn(serviceElementIds);
        if (cleared > 0) {
            log.info("Target manifest FK cleanup: nulled target_service_element_id on {} "
                + "manifest row(s) for {} archived service element(s)",
                cleared, serviceElementIds.size());
        }
        return cleared;
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
