package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.apibehaviour.ApiBehaviourMapper;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourBaselineItemDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourBaselineItemRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourBaselineItemRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineItemEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineItemRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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

        ApiBehaviourBaselineItemEntity entity = ApiBehaviourBaselineItemEntity.builder()
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
            .businessNotes(request.businessNotes())
            .build();

        return ApiBehaviourMapper.toDto(repository.saveAndFlush(entity));
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
}
