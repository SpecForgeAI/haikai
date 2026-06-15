package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.apibehaviour.ApiBehaviourMapper;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourOperationDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourOperationRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourOperationRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourOperationEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourOperationRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * CRUD service for {@code api_behaviour_operations}.
 *
 * <p>PATCH semantics: every field on
 * {@link UpdateApiBehaviourOperationRequest} is boxed/reference and the
 * service null-guards every one (boxed-{@link Boolean} {@code included} and
 * {@code safeToExecute} survive a PATCH that omits them — see project memory
 * note {@code project_primitive_double_dto_overwrite.md}).</p>
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
public class ApiBehaviourOperationService {

    private final ApiBehaviourOperationRepository repository;

    @Transactional(readOnly = true)
    public List<ApiBehaviourOperationDto> listBySession(UUID sessionId) {
        return repository.findBySessionIdOrderByCreatedAtAsc(sessionId)
            .stream()
            .map(ApiBehaviourMapper::toDto)
            .toList();
    }

    @Transactional(readOnly = true)
    public ApiBehaviourOperationDto get(UUID id) {
        return ApiBehaviourMapper.toDto(findOrThrow(id));
    }

    @Transactional
    public ApiBehaviourOperationDto create(CreateApiBehaviourOperationRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Operation request body is required");
        }
        if (request.sessionId() == null) {
            throw new IllegalArgumentException("sessionId is required");
        }
        if (request.method() == null || request.method().isBlank()) {
            throw new IllegalArgumentException("method is required");
        }
        if (request.path() == null || request.path().isBlank()) {
            throw new IllegalArgumentException("path is required");
        }
        if (request.oasOperationJson() == null) {
            throw new IllegalArgumentException("oasOperationJson is required");
        }

        ApiBehaviourOperationEntity entity = ApiBehaviourOperationEntity.builder()
            .id(UUID.randomUUID())
            .sessionId(request.sessionId())
            .operationId(request.operationId())
            .method(request.method())
            .path(request.path())
            .summary(request.summary())
            .description(request.description())
            .included(request.included() == null ? Boolean.TRUE : request.included())
            .safeToExecute(request.safeToExecute() == null
                ? Boolean.FALSE : request.safeToExecute())
            .requestSchemaJson(request.requestSchemaJson())
            .responseSchemaJson(request.responseSchemaJson())
            .oasOperationJson(request.oasOperationJson())
            .exclusionReason(request.exclusionReason())
            .build();

        return ApiBehaviourMapper.toDto(repository.saveAndFlush(entity));
    }

    @Transactional
    public ApiBehaviourOperationDto update(UUID id, UpdateApiBehaviourOperationRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Operation update body is required");
        }
        ApiBehaviourOperationEntity entity = findOrThrow(id);

        if (request.operationId() != null) {
            entity.setOperationId(request.operationId());
        }
        if (request.method() != null) {
            entity.setMethod(request.method());
        }
        if (request.path() != null) {
            entity.setPath(request.path());
        }
        if (request.summary() != null) {
            entity.setSummary(request.summary());
        }
        if (request.description() != null) {
            entity.setDescription(request.description());
        }
        if (request.included() != null) {
            entity.setIncluded(request.included());
        }
        if (request.safeToExecute() != null) {
            entity.setSafeToExecute(request.safeToExecute());
        }
        if (request.requestSchemaJson() != null) {
            entity.setRequestSchemaJson(request.requestSchemaJson());
        }
        if (request.responseSchemaJson() != null) {
            entity.setResponseSchemaJson(request.responseSchemaJson());
        }
        if (request.oasOperationJson() != null) {
            entity.setOasOperationJson(request.oasOperationJson());
        }
        // Exclude-with-reason accounting (Spec: Model-Seeded Capture
        // Inventory, 2026-06-11; changeset 178) -- null-guarded per PATCH.
        if (request.exclusionReason() != null) {
            entity.setExclusionReason(request.exclusionReason());
        }

        return ApiBehaviourMapper.toDto(repository.saveAndFlush(entity));
    }

    @Transactional
    public void delete(UUID id) {
        repository.delete(findOrThrow(id));
    }

    private ApiBehaviourOperationEntity findOrThrow(UUID id) {
        return repository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException(
                "API behaviour operation not found: " + id));
    }
}
