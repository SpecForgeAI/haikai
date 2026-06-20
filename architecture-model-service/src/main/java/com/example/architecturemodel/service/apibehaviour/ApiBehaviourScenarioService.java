package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.apibehaviour.ApiBehaviourMapper;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourScenarioDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourScenarioRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourScenarioRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourScenarioEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourScenarioRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * CRUD service for {@code api_behaviour_scenarios}.
 *
 * <p>Status / scenarioType / generationSource are validated at the service
 * layer against the v1 allowed sets per the spec.</p>
 *
 * <p>PATCH semantics: every field on
 * {@link UpdateApiBehaviourScenarioRequest} is reference-typed and the
 * service null-guards every one.</p>
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
public class ApiBehaviourScenarioService {

    public static final Set<String> ALLOWED_SCENARIO_TYPES = Set.of(
        "happy_path", "not_found", "validation_error", "empty_result",
        "boundary_value", "auth_error", "business_edge_case", "generated_candidate",
        "manual"
    );
    public static final Set<String> ALLOWED_STATUSES = Set.of(
        "draft", "executed_success", "executed_error",
        "accepted", "rejected", "needs_review"
    );
    public static final Set<String> ALLOWED_GENERATION_SOURCES = Set.of(
        "oas_example", "db_sample", "llm_generated", "llm_refined", "user_edited",
        "manual"
    );

    private final ApiBehaviourScenarioRepository repository;

    @Transactional(readOnly = true)
    public List<ApiBehaviourScenarioDto> listBySession(UUID sessionId) {
        return repository.findBySessionIdOrderByCreatedAtAsc(sessionId)
            .stream()
            .map(ApiBehaviourMapper::toDto)
            .toList();
    }

    @Transactional(readOnly = true)
    public List<ApiBehaviourScenarioDto> listByOperation(UUID operationId) {
        return repository.findByOperationIdOrderByCreatedAtAsc(operationId)
            .stream()
            .map(ApiBehaviourMapper::toDto)
            .toList();
    }

    @Transactional(readOnly = true)
    public ApiBehaviourScenarioDto get(UUID id) {
        return ApiBehaviourMapper.toDto(findOrThrow(id));
    }

    @Transactional
    public ApiBehaviourScenarioDto create(CreateApiBehaviourScenarioRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Scenario request body is required");
        }
        if (request.sessionId() == null) {
            throw new IllegalArgumentException("sessionId is required");
        }
        if (request.operationId() == null) {
            throw new IllegalArgumentException("operationId is required");
        }
        if (request.scenarioName() == null || request.scenarioName().isBlank()) {
            throw new IllegalArgumentException("scenarioName is required");
        }
        if (request.requestMethod() == null || request.requestMethod().isBlank()) {
            throw new IllegalArgumentException("requestMethod is required");
        }
        if (request.requestPath() == null || request.requestPath().isBlank()) {
            throw new IllegalArgumentException("requestPath is required");
        }

        String scenarioType = request.scenarioType() == null
            ? "happy_path" : request.scenarioType();
        String status = request.status() == null ? "draft" : request.status();
        String generationSource = request.generationSource() == null
            ? "llm_generated" : request.generationSource();
        requireAllowed(ALLOWED_SCENARIO_TYPES, scenarioType, "scenarioType");
        requireAllowed(ALLOWED_STATUSES, status, "status");
        requireAllowed(ALLOWED_GENERATION_SOURCES, generationSource, "generationSource");

        ApiBehaviourScenarioEntity entity = ApiBehaviourScenarioEntity.builder()
            .id(UUID.randomUUID())
            .sessionId(request.sessionId())
            .operationId(request.operationId())
            .scenarioName(request.scenarioName())
            .scenarioType(scenarioType)
            .status(status)
            .generationSource(generationSource)
            .requestMethod(request.requestMethod())
            .requestPath(request.requestPath())
            .requestQueryJson(request.requestQueryJson())
            .requestHeadersRedactedJson(request.requestHeadersRedactedJson())
            .requestBodyJson(request.requestBodyJson())
            .notes(request.notes())
            .build();

        return ApiBehaviourMapper.toDto(repository.saveAndFlush(entity));
    }

    @Transactional
    public ApiBehaviourScenarioDto update(UUID id, UpdateApiBehaviourScenarioRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Scenario update body is required");
        }
        ApiBehaviourScenarioEntity entity = findOrThrow(id);

        if (request.scenarioName() != null) {
            entity.setScenarioName(request.scenarioName());
        }
        if (request.scenarioType() != null) {
            requireAllowed(ALLOWED_SCENARIO_TYPES, request.scenarioType(), "scenarioType");
            entity.setScenarioType(request.scenarioType());
        }
        if (request.status() != null) {
            requireAllowed(ALLOWED_STATUSES, request.status(), "status");
            entity.setStatus(request.status());
        }
        if (request.generationSource() != null) {
            requireAllowed(ALLOWED_GENERATION_SOURCES, request.generationSource(), "generationSource");
            entity.setGenerationSource(request.generationSource());
        }
        if (request.requestMethod() != null) {
            entity.setRequestMethod(request.requestMethod());
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
        if (request.notes() != null) {
            entity.setNotes(request.notes());
        }

        return ApiBehaviourMapper.toDto(repository.saveAndFlush(entity));
    }

    @Transactional
    public void delete(UUID id) {
        repository.delete(findOrThrow(id));
    }

    private ApiBehaviourScenarioEntity findOrThrow(UUID id) {
        return repository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException(
                "API behaviour scenario not found: " + id));
    }

    private static void requireAllowed(Set<String> allowed, String value, String field) {
        if (!allowed.contains(value)) {
            throw new IllegalArgumentException(
                field + " '" + value + "' is not in the allowed set " + allowed);
        }
    }
}
