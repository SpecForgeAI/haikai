package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.apibehaviour.ApiBehaviourMapper;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourDiffDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourDiffRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourDiffRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiffEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourDiffRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * CRUD service for {@code api_behaviour_diffs}. Pure system-of-record --
 * the diff computation itself lives in {@code diffRunner.ts} in
 * {@code api-migration-validation-service}.
 *
 * <h2>Status transitions</h2>
 * <p>{@code computing → completed | failed} is the natural lifecycle; PATCH
 * accepts any of the three values without enforcing transitions
 * (recompute legitimately rewinds {@code completed → computing} when the
 * user clicks "Recompute").</p>
 *
 * <h2>FK-pairing invariant (service layer, no DB enum)</h2>
 * <ul>
 *   <li>{@code sourceBaselineId} MUST resolve to an existing baseline with
 *       {@code kind="current"}.</li>
 *   <li>{@code targetBaselineId} MUST resolve to an existing baseline with
 *       {@code kind="target"} AND whose {@code paired_with_baseline_id}
 *       equals {@code sourceBaselineId}.</li>
 * </ul>
 *
 * <p>Throws {@link IllegalArgumentException} on any invariant breach -- the
 * existing {@code GlobalExceptionHandler} surfaces this as HTTP 400.</p>
 *
 * <h2>PATCH safety</h2>
 * <p>{@link #update(UUID, UUID, UpdateApiBehaviourDiffRequest)} null-guards
 * EVERY field. Per {@code project_primitive_double_dto_overwrite.md}, the
 * 6 count fields are boxed {@link Integer} on the DTO; the null guard here
 * is the matching service-layer half of that contract -- a missing JSON
 * field MUST NOT overwrite the existing value with {@code null}.</p>
 *
 * <p>Spec: API Test Harness — Diff Engine (2026-05-25) — Task Group 2</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourDiffService {

    public static final Set<String> ALLOWED_STATUSES =
        Set.of("computing", "completed", "failed");

    private final ApiBehaviourDiffRepository diffRepository;
    private final ApiBehaviourBaselineRepository baselineRepository;

    @Transactional
    public ApiBehaviourDiffDto create(
            UUID projectId, CreateApiBehaviourDiffRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Diff request body is required");
        }
        if (request.architectureId() == null) {
            throw new IllegalArgumentException("architectureId is required");
        }
        if (request.sourceBaselineId() == null) {
            throw new IllegalArgumentException("sourceBaselineId is required");
        }
        if (request.targetBaselineId() == null) {
            throw new IllegalArgumentException("targetBaselineId is required");
        }

        // FK-pairing invariant enforcement.
        requireFkPairingInvariant(
            projectId, request.architectureId(),
            request.sourceBaselineId(), request.targetBaselineId());

        ApiBehaviourDiffEntity entity = ApiBehaviourDiffEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(request.architectureId())
            .sourceBaselineId(request.sourceBaselineId())
            .targetBaselineId(request.targetBaselineId())
            .status("computing")
            .build();

        return ApiBehaviourMapper.toDto(diffRepository.saveAndFlush(entity));
    }

    /**
     * PATCH semantics -- each field is null-guarded. A missing field in the
     * request leaves the existing entity value untouched.
     */
    @Transactional
    public ApiBehaviourDiffDto update(
            UUID projectId, UUID id, UpdateApiBehaviourDiffRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Diff update body is required");
        }
        ApiBehaviourDiffEntity entity = findOrThrow(projectId, id);

        if (request.status() != null) {
            requireAllowedStatus(request.status());
            entity.setStatus(request.status());
        }
        if (request.matchedCount() != null) {
            entity.setMatchedCount(request.matchedCount());
        }
        if (request.statusDriftCount() != null) {
            entity.setStatusDriftCount(request.statusDriftCount());
        }
        if (request.bodyShapeDriftCount() != null) {
            entity.setBodyShapeDriftCount(request.bodyShapeDriftCount());
        }
        if (request.bodyValueDriftCount() != null) {
            entity.setBodyValueDriftCount(request.bodyValueDriftCount());
        }
        if (request.sourceOnlyCount() != null) {
            entity.setSourceOnlyCount(request.sourceOnlyCount());
        }
        if (request.targetOnlyCount() != null) {
            entity.setTargetOnlyCount(request.targetOnlyCount());
        }
        if (request.sourceBaselineUpdatedAt() != null) {
            entity.setSourceBaselineUpdatedAt(request.sourceBaselineUpdatedAt());
        }
        if (request.targetBaselineUpdatedAt() != null) {
            entity.setTargetBaselineUpdatedAt(request.targetBaselineUpdatedAt());
        }
        if (request.computedAt() != null) {
            entity.setComputedAt(request.computedAt());
        }
        if (request.errorMessage() != null) {
            entity.setErrorMessage(request.errorMessage());
        }

        return ApiBehaviourMapper.toDto(diffRepository.saveAndFlush(entity));
    }

    @Transactional(readOnly = true)
    public ApiBehaviourDiffDto get(UUID projectId, UUID id) {
        return ApiBehaviourMapper.toDto(findOrThrow(projectId, id));
    }

    /**
     * Primary UI lookup -- a given target baseline has AT MOST one diff
     * (enforced by the UNIQUE (source, target) constraint). Returns 404 when
     * no diff has been computed yet (the UI shows "Computing..." in that
     * case).
     */
    @Transactional(readOnly = true)
    public ApiBehaviourDiffDto getByTargetBaselineId(
            UUID projectId, UUID targetBaselineId) {
        ApiBehaviourDiffEntity entity = diffRepository
            .findByTargetBaselineId(targetBaselineId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "API behaviour diff not found for target baseline " + targetBaselineId));
        if (!projectId.equals(entity.getProjectId())) {
            throw new ResourceNotFoundException(
                "API behaviour diff for target baseline " + targetBaselineId
                    + " not found in project " + projectId);
        }
        return ApiBehaviourMapper.toDto(entity);
    }

    /**
     * Source-side lookup -- one source baseline can have multiple diffs (one
     * per target it was replayed against). v1 UI navigation is target-driven;
     * this finder exists for Spec #6 + v2 reverse-lookup.
     */
    @Transactional(readOnly = true)
    public List<ApiBehaviourDiffDto> listBySourceBaselineId(
            UUID projectId, UUID sourceBaselineId) {
        return diffRepository
            .findBySourceBaselineIdOrderByCreatedAtDesc(sourceBaselineId)
            .stream()
            .filter(d -> projectId.equals(d.getProjectId()))
            .map(ApiBehaviourMapper::toDto)
            .toList();
    }

    @Transactional
    public void delete(UUID projectId, UUID id) {
        diffRepository.delete(findOrThrow(projectId, id));
    }

    private ApiBehaviourDiffEntity findOrThrow(UUID projectId, UUID id) {
        ApiBehaviourDiffEntity entity = diffRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException(
                "API behaviour diff not found: " + id));
        if (!projectId.equals(entity.getProjectId())) {
            throw new ResourceNotFoundException(
                "API behaviour diff " + id + " not found in project " + projectId);
        }
        return entity;
    }

    private static void requireAllowedStatus(String status) {
        if (!ALLOWED_STATUSES.contains(status)) {
            throw new IllegalArgumentException(
                "status '" + status + "' is not in the allowed set " + ALLOWED_STATUSES);
        }
    }

    /**
     * Enforce the FK-pairing invariant on the source + target baseline IDs:
     * <ul>
     *   <li>Source MUST exist, be in the given project + architecture, and
     *       have {@code kind="current"}.</li>
     *   <li>Target MUST exist, be in the given project + architecture, have
     *       {@code kind="target"}, and have {@code paired_with_baseline_id}
     *       equal to the source baseline id.</li>
     * </ul>
     */
    private void requireFkPairingInvariant(
            UUID projectId, UUID architectureId,
            UUID sourceBaselineId, UUID targetBaselineId) {
        Optional<ApiBehaviourBaselineEntity> sourceOpt =
            baselineRepository.findById(sourceBaselineId);
        if (sourceOpt.isEmpty()) {
            throw new IllegalArgumentException(
                "sourceBaselineId '" + sourceBaselineId
                    + "' does not resolve to an existing baseline");
        }
        ApiBehaviourBaselineEntity source = sourceOpt.get();
        if (!projectId.equals(source.getProjectId())
            || !architectureId.equals(source.getArchitectureId())) {
            throw new IllegalArgumentException(
                "sourceBaselineId '" + sourceBaselineId
                    + "' must be in the same project + architecture as the diff");
        }
        if (!"current".equals(source.getKind())) {
            throw new IllegalArgumentException(
                "sourceBaselineId '" + sourceBaselineId
                    + "' must point at a kind='current' baseline (got kind='"
                    + source.getKind() + "')");
        }

        Optional<ApiBehaviourBaselineEntity> targetOpt =
            baselineRepository.findById(targetBaselineId);
        if (targetOpt.isEmpty()) {
            throw new IllegalArgumentException(
                "targetBaselineId '" + targetBaselineId
                    + "' does not resolve to an existing baseline");
        }
        ApiBehaviourBaselineEntity target = targetOpt.get();
        if (!projectId.equals(target.getProjectId())
            || !architectureId.equals(target.getArchitectureId())) {
            throw new IllegalArgumentException(
                "targetBaselineId '" + targetBaselineId
                    + "' must be in the same project + architecture as the diff");
        }
        if (!"target".equals(target.getKind())) {
            throw new IllegalArgumentException(
                "targetBaselineId '" + targetBaselineId
                    + "' must point at a kind='target' baseline (got kind='"
                    + target.getKind() + "')");
        }
        if (!sourceBaselineId.equals(target.getPairedWithBaselineId())) {
            throw new IllegalArgumentException(
                "targetBaselineId '" + targetBaselineId
                    + "' must be paired with sourceBaselineId '" + sourceBaselineId
                    + "' (target.pairedWithBaselineId='"
                    + target.getPairedWithBaselineId() + "')");
        }
    }
}
