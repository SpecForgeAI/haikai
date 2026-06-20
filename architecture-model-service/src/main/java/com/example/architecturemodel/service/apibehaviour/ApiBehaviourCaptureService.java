package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.apibehaviour.ApiBehaviourMapper;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourCaptureDto;
import com.example.architecturemodel.model.dto.apibehaviour.BatchUpdateApiBehaviourCapturesRequest;
import com.example.architecturemodel.model.dto.apibehaviour.BatchUpdateApiBehaviourCapturesResponse;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourCaptureRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourCaptureRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourCaptureRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * CRUD service for {@code api_behaviour_captures}.
 *
 * <p>The Test Engineer review flow PATCHes {@code accepted}, {@code acceptedAt},
 * {@code reviewerNotes} on rows. Boxed {@link Boolean}/{@link Integer} fields
 * preserve {@code null} on PATCH (see project memory note
 * {@code project_primitive_double_dto_overwrite.md}).</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourCaptureService {

    private final ApiBehaviourCaptureRepository repository;

    /**
     * Max captures accepted on a single best-effort batch-PATCH call.
     * Mirrors {@code DiscoveryFindingService.MAX_BULK_FINDINGS}; requests over
     * the cap are rejected with 400 rather than truncated.
     */
    public static final int MAX_BATCH_ITEMS = 500;

    @Transactional(readOnly = true)
    public List<ApiBehaviourCaptureDto> listBySession(UUID sessionId) {
        return repository.findBySessionIdOrderByCapturedAtAsc(sessionId)
            .stream()
            .map(ApiBehaviourMapper::toDto)
            .toList();
    }

    @Transactional(readOnly = true)
    public List<ApiBehaviourCaptureDto> listByScenario(UUID scenarioId) {
        return repository.findByScenarioIdOrderByCapturedAtAsc(scenarioId)
            .stream()
            .map(ApiBehaviourMapper::toDto)
            .toList();
    }

    @Transactional(readOnly = true)
    public ApiBehaviourCaptureDto get(UUID id) {
        return ApiBehaviourMapper.toDto(findOrThrow(id));
    }

    @Transactional
    public ApiBehaviourCaptureDto create(CreateApiBehaviourCaptureRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Capture request body is required");
        }
        if (request.sessionId() == null) {
            throw new IllegalArgumentException("sessionId is required");
        }
        if (request.scenarioId() == null) {
            throw new IllegalArgumentException("scenarioId is required");
        }
        if (request.operationId() == null) {
            throw new IllegalArgumentException("operationId is required");
        }
        if (request.requestMethod() == null || request.requestMethod().isBlank()) {
            throw new IllegalArgumentException("requestMethod is required");
        }
        if (request.requestUrlRedacted() == null || request.requestUrlRedacted().isBlank()) {
            throw new IllegalArgumentException("requestUrlRedacted is required");
        }
        if (request.requestPath() == null || request.requestPath().isBlank()) {
            throw new IllegalArgumentException("requestPath is required");
        }

        ApiBehaviourCaptureEntity entity = ApiBehaviourCaptureEntity.builder()
            .id(UUID.randomUUID())
            .sessionId(request.sessionId())
            .scenarioId(request.scenarioId())
            .operationId(request.operationId())
            .attemptNumber(request.attemptNumber() == null ? 1 : request.attemptNumber())
            .requestMethod(request.requestMethod())
            .requestUrlRedacted(request.requestUrlRedacted())
            .requestPath(request.requestPath())
            .requestQueryJson(request.requestQueryJson())
            .requestHeadersRedactedJson(request.requestHeadersRedactedJson())
            .requestBodyJson(request.requestBodyJson())
            .responseStatus(request.responseStatus())
            .responseHeadersRedactedJson(request.responseHeadersRedactedJson())
            .responseBodyJson(request.responseBodyJson())
            .durationMs(request.durationMs())
            .errorType(request.errorType())
            .errorMessage(request.errorMessage())
            .capturedAt(request.capturedAt() == null ? Instant.now() : request.capturedAt())
            // Pass null through = un-reviewed (blank in UI). Previously coerced to
            // FALSE, which mis-rendered fresh captures as "rejected" pre-review.
            // The canonical-capture pass or a human reviewer sets TRUE/FALSE later.
            .accepted(request.accepted())
            .acceptedAt(request.acceptedAt())
            .reviewerNotes(request.reviewerNotes())
            // Write-once at capture create time -- the volatility envelope the
            // probe measured in execute_http_request. There is deliberately NO
            // PATCH path for it. Spec: Reconcile-Time Determinism &
            // Volatile-Value Handling (2026-06-16) -- FU-2.
            .volatilePathsJson(request.volatilePathsJson())
            .build();

        return ApiBehaviourMapper.toDto(repository.saveAndFlush(entity));
    }

    @Transactional
    public ApiBehaviourCaptureDto update(UUID id, UpdateApiBehaviourCaptureRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Capture update body is required");
        }
        ApiBehaviourCaptureEntity entity = findOrThrow(id);

        if (request.attemptNumber() != null) {
            entity.setAttemptNumber(request.attemptNumber());
        }
        if (request.requestMethod() != null) {
            entity.setRequestMethod(request.requestMethod());
        }
        if (request.requestUrlRedacted() != null) {
            entity.setRequestUrlRedacted(request.requestUrlRedacted());
        }
        if (request.requestPath() != null) {
            entity.setRequestPath(request.requestPath());
        }
        if (request.requestQueryJson() != null) {
            entity.setRequestQueryJson(request.requestQueryJson());
        }
        if (request.requestHeadersRedactedJson() != null) {
            entity.setRequestHeadersRedactedJson(request.requestHeadersRedactedJson());
        }
        if (request.requestBodyJson() != null) {
            entity.setRequestBodyJson(request.requestBodyJson());
        }
        if (request.responseStatus() != null) {
            entity.setResponseStatus(request.responseStatus());
        }
        if (request.responseHeadersRedactedJson() != null) {
            entity.setResponseHeadersRedactedJson(request.responseHeadersRedactedJson());
        }
        if (request.responseBodyJson() != null) {
            entity.setResponseBodyJson(request.responseBodyJson());
        }
        if (request.durationMs() != null) {
            entity.setDurationMs(request.durationMs());
        }
        if (request.errorType() != null) {
            entity.setErrorType(request.errorType());
        }
        if (request.errorMessage() != null) {
            entity.setErrorMessage(request.errorMessage());
        }
        if (request.capturedAt() != null) {
            entity.setCapturedAt(request.capturedAt());
        }
        if (request.accepted() != null) {
            entity.setAccepted(request.accepted());
        }
        if (request.acceptedAt() != null) {
            entity.setAcceptedAt(request.acceptedAt());
        }
        if (request.reviewerNotes() != null) {
            entity.setReviewerNotes(request.reviewerNotes());
        }
        // NOTE: volatilePathsJson is intentionally NOT PATCH-mutable -- it is
        // write-once at capture create time (the probe's measured envelope),
        // mirroring baseline immutability. No update branch here on purpose.

        return ApiBehaviourMapper.toDto(repository.saveAndFlush(entity));
    }

    /**
     * Best-effort, NON-atomic batch PATCH.
     *
     * <p>Each {@code {id, patch}} item is applied via the existing per-row
     * {@link #update} field-merge independently: a failing item (e.g. a
     * missing capture, or a validation error) is recorded in {@code failed[]}
     * (id + reason) and the loop continues -- it does NOT abort the rest. The
     * {@code {id, patch}} shape lets Reject-All preserve each capture's own
     * {@code reviewer_notes} masks; Accept-All sends the same patch per id.</p>
     *
     * <p>{@code projectId} is accepted for controller-surface symmetry; a
     * capture row is addressed by its own id, so it is not used to scope the
     * merge (mirrors {@link #update}).</p>
     *
     * <p>Spec: Baseline Save &amp; Review -- Batch + Activate + Table Detail +
     * Postman Export (2026-06-20) -- Task Group 1 (R1).</p>
     */
    @Transactional
    public BatchUpdateApiBehaviourCapturesResponse updateBatch(
            UUID projectId, List<BatchUpdateApiBehaviourCapturesRequest.ItemPatch> items) {
        if (items == null) {
            throw new IllegalArgumentException("Batch captures request body is required");
        }
        if (items.size() > MAX_BATCH_ITEMS) {
            throw new IllegalArgumentException(
                "Batch captures request exceeds the per-call cap of "
                    + MAX_BATCH_ITEMS + " (received " + items.size() + ")");
        }
        List<ApiBehaviourCaptureDto> updated = new ArrayList<>(items.size());
        List<BatchUpdateApiBehaviourCapturesResponse.FailedItem> failed = new ArrayList<>();
        for (BatchUpdateApiBehaviourCapturesRequest.ItemPatch item : items) {
            UUID id = item == null ? null : item.id();
            try {
                if (item == null || item.id() == null) {
                    throw new IllegalArgumentException("id is required for each batch item");
                }
                updated.add(update(item.id(), item.patch()));
            } catch (RuntimeException ex) {
                failed.add(new BatchUpdateApiBehaviourCapturesResponse.FailedItem(
                    id, ex.getMessage()));
            }
        }
        return new BatchUpdateApiBehaviourCapturesResponse(updated, failed);
    }

    @Transactional
    public void delete(UUID id) {
        repository.delete(findOrThrow(id));
    }

    private ApiBehaviourCaptureEntity findOrThrow(UUID id) {
        return repository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException(
                "API behaviour capture not found: " + id));
    }
}
