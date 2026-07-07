package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.apibehaviour.ApiBehaviourMapper;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourBaselineItemDto;
import com.example.architecturemodel.model.dto.apibehaviour.BatchCreateApiBehaviourBaselineItemsResponse;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourBaselineItemRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourBaselineItemRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineItemEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineItemRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourCaptureRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * CRUD service for {@code api_behaviour_baseline_items}.
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
public class ApiBehaviourBaselineItemService {

    private final ApiBehaviourBaselineItemRepository repository;

    /**
     * Spec 2026-07-06-j: server-side raw fallback — when the caller did not
     * pass {@code responseBodyRaw} (e.g. the frontend Save-as-baseline copy),
     * the referenced capture row's raw is copied onto the frozen item so
     * EVERY item creator inherits it without client changes.
     */
    private final ApiBehaviourCaptureRepository captureRepository;

    /**
     * Max baseline items accepted on a single best-effort batch-create call.
     * Mirrors {@code DiscoveryFindingService.MAX_BULK_FINDINGS}; requests over
     * the cap are rejected with 400 rather than truncated.
     */
    public static final int MAX_BATCH_ITEMS = 500;

    @Transactional(readOnly = true)
    public List<ApiBehaviourBaselineItemDto> listByBaseline(UUID baselineId) {
        return repository.findByBaselineIdOrderByCreatedAtAsc(baselineId)
            .stream()
            .map(ApiBehaviourMapper::toDto)
            .toList();
    }

    @Transactional(readOnly = true)
    public ApiBehaviourBaselineItemDto get(UUID id) {
        return ApiBehaviourMapper.toDto(findOrThrow(id));
    }

    @Transactional
    public ApiBehaviourBaselineItemDto create(CreateApiBehaviourBaselineItemRequest request) {
        // Validation lives in buildEntity (shared with createBatch); behaviour
        // is identical to the pre-extraction inline-validate-then-build path.
        ApiBehaviourBaselineItemEntity entity = buildEntity(request);
        return ApiBehaviourMapper.toDto(repository.saveAndFlush(entity));
    }

    /**
     * Best-effort, NON-atomic batch create.
     *
     * <p>Each item is validated + persisted independently via {@link
     * #buildEntity}: a bad item is recorded in {@code failed[]} (index +
     * capture_id + reason) and the loop continues -- it does NOT abort the
     * rest or roll back the successes. The integrity hash is NOT touched here
     * (it is stamped at activate time); this only persists rows, and item
     * order is irrelevant to the hash (it canonical-sorts).</p>
     *
     * <p>{@code projectId} is accepted for controller-surface symmetry with the
     * other endpoints; the baseline_items row is scoped by {@code baselineId},
     * so it is not used in the entity build (mirrors {@link #create}, which the
     * controller likewise calls without threading projectId into the row).</p>
     *
     * <p>Spec: Baseline Save &amp; Review -- Batch + Activate + Table Detail +
     * Postman Export (2026-06-20) -- Task Group 1 (R1).</p>
     */
    @Transactional
    public BatchCreateApiBehaviourBaselineItemsResponse createBatch(
            UUID projectId, List<CreateApiBehaviourBaselineItemRequest> items) {
        if (items == null) {
            throw new IllegalArgumentException("Batch baseline items request body is required");
        }
        if (items.size() > MAX_BATCH_ITEMS) {
            throw new IllegalArgumentException(
                "Batch baseline items request exceeds the per-call cap of "
                    + MAX_BATCH_ITEMS + " (received " + items.size() + ")");
        }
        List<ApiBehaviourBaselineItemDto> created = new ArrayList<>(items.size());
        List<BatchCreateApiBehaviourBaselineItemsResponse.FailedItem> failed = new ArrayList<>();
        for (int i = 0; i < items.size(); i++) {
            CreateApiBehaviourBaselineItemRequest request = items.get(i);
            try {
                ApiBehaviourBaselineItemEntity entity = buildEntity(request);
                created.add(ApiBehaviourMapper.toDto(repository.saveAndFlush(entity)));
            } catch (RuntimeException ex) {
                failed.add(new BatchCreateApiBehaviourBaselineItemsResponse.FailedItem(
                    i,
                    request == null ? null : request.captureId(),
                    ex.getMessage()));
            }
        }
        return new BatchCreateApiBehaviourBaselineItemsResponse(created, failed);
    }

    /**
     * Validate {@code request} and build the {@code api_behaviour_baseline_items}
     * entity (un-persisted). Extracted from {@link #create} so {@link #createBatch}
     * reuses the exact same validation + builder; {@code create} now calls this
     * and persists, behaving identically to before the extraction.
     *
     * <p>{@code projectId} is unused in the build (the row is scoped by
     * {@code baselineId}); it is on the signature for documented symmetry with
     * the other batch surfaces.</p>
     */
    private ApiBehaviourBaselineItemEntity buildEntity(
            CreateApiBehaviourBaselineItemRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Baseline item request body is required");
        }
        if (request.baselineId() == null) {
            throw new IllegalArgumentException("baselineId is required");
        }
        if (request.captureId() == null) {
            throw new IllegalArgumentException("captureId is required");
        }
        if (request.operationId() == null) {
            throw new IllegalArgumentException("operationId is required");
        }
        if (request.scenarioId() == null) {
            throw new IllegalArgumentException("scenarioId is required");
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
        if (request.requestJson() == null) {
            throw new IllegalArgumentException("requestJson is required");
        }
        if (request.responseStatus() == null) {
            throw new IllegalArgumentException("responseStatus is required");
        }
        if (request.responseJson() == null) {
            throw new IllegalArgumentException("responseJson is required");
        }

        return ApiBehaviourBaselineItemEntity.builder()
            .id(UUID.randomUUID())
            .baselineId(request.baselineId())
            .captureId(request.captureId())
            .operationId(request.operationId())
            .scenarioId(request.scenarioId())
            .method(request.method())
            .path(request.path())
            .scenarioName(request.scenarioName())
            .requestJson(request.requestJson())
            .responseStatus(request.responseStatus())
            .responseJson(request.responseJson())
            .volatilePathsJson(request.volatilePathsJson())
            .sequenceJson(request.sequenceJson())
            .responseBodyRaw(resolveResponseBodyRaw(request))
            .businessNotes(request.businessNotes())
            .build();
    }

    @Transactional
    public ApiBehaviourBaselineItemDto update(
            UUID id, UpdateApiBehaviourBaselineItemRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Baseline item update body is required");
        }
        ApiBehaviourBaselineItemEntity entity = findOrThrow(id);

        if (request.method() != null) {
            entity.setMethod(request.method());
        }
        if (request.path() != null) {
            entity.setPath(request.path());
        }
        if (request.scenarioName() != null) {
            entity.setScenarioName(request.scenarioName());
        }
        if (request.requestJson() != null) {
            entity.setRequestJson(request.requestJson());
        }
        if (request.responseStatus() != null) {
            entity.setResponseStatus(request.responseStatus());
        }
        if (request.responseJson() != null) {
            entity.setResponseJson(request.responseJson());
        }
        if (request.businessNotes() != null) {
            entity.setBusinessNotes(request.businessNotes());
        }

        return ApiBehaviourMapper.toDto(repository.saveAndFlush(entity));
    }

    @Transactional
    public void delete(UUID id) {
        repository.delete(findOrThrow(id));
    }

    private ApiBehaviourBaselineItemEntity findOrThrow(UUID id) {
        return repository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException(
                "API behaviour baseline item not found: " + id));
    }

    /**
     * Spec 2026-07-06-j: the item's raw comes from the request when the
     * caller passed it (target replay does), else it is COPIED from the
     * referenced capture row (the frontend Save-as-baseline path). Best-effort
     * — a missing capture row simply yields null ("raw unavailable"; strict
     * verdicts degrade visibly, never a false exact).
     */
    private String resolveResponseBodyRaw(CreateApiBehaviourBaselineItemRequest request) {
        if (request.responseBodyRaw() != null) {
            return request.responseBodyRaw();
        }
        if (request.captureId() == null) {
            return null;
        }
        return captureRepository.findById(request.captureId())
            .map(capture -> capture.getResponseBodyRaw())
            .orElse(null);
    }
}
