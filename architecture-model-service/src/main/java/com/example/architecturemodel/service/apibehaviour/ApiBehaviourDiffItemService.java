package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.apibehaviour.ApiBehaviourMapper;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourDiffItemDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourDiffItemRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiffEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiffItemEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourDiffItemRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourDiffRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * CRUD service for {@code api_behaviour_diff_items}. Pure persistence helper
 * for {@code diffRunner.ts} -- one row per classified scenario.
 *
 * <h2>Classification validation (service layer, no DB enum)</h2>
 * <ul>
 *   <li>{@code statusClassification} MUST be one of {@code status_match} |
 *       {@code status_drift} | {@code source_only} | {@code target_only}.</li>
 *   <li>{@code bodyClassification} (when present) MUST be one of
 *       {@code body_match} | {@code body_shape_drift} | {@code body_value_drift}
 *       | {@code body_ordering_drift}. NULL is allowed (and required) when
 *       classification is {@code source_only} / {@code target_only}. The
 *       {@code body_ordering_drift} value (Reconcile Full-Response Fidelity,
 *       2026-06-17) tags a non-volatile array reorder -- existing column,
 *       service-layer validation only, NO schema change.</li>
 *   <li>{@code headerClassification} (when present) MUST be one of
 *       {@code header_match} | {@code header_value_drift} |
 *       {@code header_presence_drift}. NULL is allowed when the header
 *       dimension is skipped (no pair, or a side lacks the {@code {headers,
 *       body}} wrapper). Mirrors the {@code bodyClassification} validator.</li>
 * </ul>
 *
 * <p>Throws {@link IllegalArgumentException} on validation breach -- the
 * existing {@code GlobalExceptionHandler} surfaces this as HTTP 400.</p>
 *
 * <p>Spec: API Test Harness — Diff Engine (2026-05-25) — Task Group 2</p>
 * <p>Extended: Reconcile Full-Response Fidelity (2026-06-17) — Task Group 1
 * ({@code headerClassification} validator + {@code body_ordering_drift}
 * body value).</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourDiffItemService {

    public static final Set<String> ALLOWED_STATUS_CLASSIFICATIONS =
        Set.of("status_match", "status_drift", "source_only", "target_only");

    public static final Set<String> ALLOWED_BODY_CLASSIFICATIONS =
        Set.of("body_match", "body_shape_drift", "body_value_drift",
            "body_ordering_drift");

    public static final Set<String> ALLOWED_HEADER_CLASSIFICATIONS =
        Set.of("header_match", "header_value_drift", "header_presence_drift");

    private final ApiBehaviourDiffItemRepository diffItemRepository;
    private final ApiBehaviourDiffRepository diffRepository;

    @Transactional
    public ApiBehaviourDiffItemDto create(
            UUID projectId, UUID diffId,
            CreateApiBehaviourDiffItemRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Diff item request body is required");
        }
        if (request.method() == null || request.method().isBlank()) {
            throw new IllegalArgumentException("method is required");
        }
        if (request.path() == null || request.path().isBlank()) {
            throw new IllegalArgumentException("path is required");
        }
        if (request.scenarioName() == null || request.scenarioName().isBlank()) {
            throw new IllegalArgumentException("scenarioName is required");
        }
        if (request.statusClassification() == null
            || request.statusClassification().isBlank()) {
            throw new IllegalArgumentException("statusClassification is required");
        }
        requireAllowedStatusClassification(request.statusClassification());
        if (request.bodyClassification() != null) {
            requireAllowedBodyClassification(request.bodyClassification());
        }
        if (request.headerClassification() != null) {
            requireAllowedHeaderClassification(request.headerClassification());
        }

        // Resolve parent diff via the URL-path diffId AND verify it exists
        // under the given project. The request body's diffId (if present) is
        // ignored if it doesn't match the URL -- URL wins.
        ApiBehaviourDiffEntity parentDiff = diffRepository.findById(diffId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "API behaviour diff not found: " + diffId));
        if (!projectId.equals(parentDiff.getProjectId())) {
            throw new ResourceNotFoundException(
                "API behaviour diff " + diffId + " not found in project " + projectId);
        }

        ApiBehaviourDiffItemEntity entity = ApiBehaviourDiffItemEntity.builder()
            .id(UUID.randomUUID())
            .diffId(parentDiff.getId())
            .method(request.method())
            .path(request.path())
            .scenarioName(request.scenarioName())
            .sourceBaselineItemId(request.sourceBaselineItemId())
            .targetBaselineItemId(request.targetBaselineItemId())
            .statusClassification(request.statusClassification())
            .bodyClassification(request.bodyClassification())
            .headerClassification(request.headerClassification())
            .sourceResponseStatus(request.sourceResponseStatus())
            .targetResponseStatus(request.targetResponseStatus())
            .bodyDiffJson(request.bodyDiffJson())
            .notes(request.notes())
            .build();

        return ApiBehaviourMapper.toDto(diffItemRepository.saveAndFlush(entity));
    }

    /**
     * Primary listing path -- ordered by ({@code method}, {@code path}) for
     * deterministic UI rendering.
     */
    @Transactional(readOnly = true)
    public List<ApiBehaviourDiffItemDto> listByDiffId(
            UUID projectId, UUID diffId) {
        ApiBehaviourDiffEntity parentDiff = diffRepository.findById(diffId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "API behaviour diff not found: " + diffId));
        if (!projectId.equals(parentDiff.getProjectId())) {
            throw new ResourceNotFoundException(
                "API behaviour diff " + diffId + " not found in project " + projectId);
        }
        return diffItemRepository
            .findByDiffIdOrderByMethodAscPathAsc(diffId)
            .stream()
            .map(ApiBehaviourMapper::toDto)
            .toList();
    }

    /**
     * Recompute support -- wipes all items for the given diff before the
     * runner persists fresh rows. Cascade FK at the DB level handles this
     * implicitly on diff deletion, but explicit recompute flows
     * (Spec #6) need to wipe-and-reinsert without touching the diff header
     * row itself.
     */
    @Transactional
    public void deleteByDiffId(UUID projectId, UUID diffId) {
        ApiBehaviourDiffEntity parentDiff = diffRepository.findById(diffId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "API behaviour diff not found: " + diffId));
        if (!projectId.equals(parentDiff.getProjectId())) {
            throw new ResourceNotFoundException(
                "API behaviour diff " + diffId + " not found in project " + projectId);
        }
        diffItemRepository.deleteByDiffId(diffId);
    }

    private static void requireAllowedStatusClassification(String value) {
        if (!ALLOWED_STATUS_CLASSIFICATIONS.contains(value)) {
            throw new IllegalArgumentException(
                "statusClassification '" + value
                    + "' is not in the allowed set " + ALLOWED_STATUS_CLASSIFICATIONS);
        }
    }

    private static void requireAllowedBodyClassification(String value) {
        if (!ALLOWED_BODY_CLASSIFICATIONS.contains(value)) {
            throw new IllegalArgumentException(
                "bodyClassification '" + value
                    + "' is not in the allowed set " + ALLOWED_BODY_CLASSIFICATIONS);
        }
    }

    private static void requireAllowedHeaderClassification(String value) {
        if (!ALLOWED_HEADER_CLASSIFICATIONS.contains(value)) {
            throw new IllegalArgumentException(
                "headerClassification '" + value
                    + "' is not in the allowed set " + ALLOWED_HEADER_CLASSIFICATIONS);
        }
    }
}
