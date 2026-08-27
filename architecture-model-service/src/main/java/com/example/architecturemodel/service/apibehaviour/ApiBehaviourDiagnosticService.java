package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.apibehaviour.ApiBehaviourMapper;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourDiagnosticDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourDiagnosticRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourDiagnosticRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiagnosticEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourDiagnosticRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * CRUD service for {@code api_behaviour_diagnostics}.
 *
 * <p>{@code diagnosticType} is validated against the v1 allowed set per
 * the spec.</p>
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
public class ApiBehaviourDiagnosticService {

    public static final Set<String> ALLOWED_DIAGNOSTIC_TYPES = Set.of(
        "failed_request", "auth_failure", "db_sample_failure",
        "llm_generation_failure", "redaction_warning", "endpoint_skipped",
        "retry_exhausted",
        // Capture-State Discipline Spec 3 (2026-08-18): compensation-bracket
        // and S0-fingerprint session diagnostics.
        "compensation_no_effect_map", "compensation_refused",
        "compensation_residue", "compensation_inactive",
        "compensation_credential_split_recommended",
        "s0_fingerprint_mismatch", "s0_snapshot_missing",
        "s0_fingerprint_check_failed",
        // Proven-read classification (2026-08-20): write-verb endpoint with
        // READ-only committed effects fires unbracketed (info diagnostic).
        "proven_read_only", "scope_conflict", "keyless_write_recorded",
        // 2026-08-26: a scenario whose behaviour WAS captured as a
        // 200-with-business-error-code (the legacy negative idiom) is a
        // successful capture, not a skip — distinct type so the 100+
        // "endpoint skipped" rows stop mislabelling captured negatives.
        "captured_as_business_error",
        // State-discipline remediation (2026-08-27): the taxonomy stops
        // forcing the LLM to mislabel successes. captured_ok = clean
        // successful capture; contract_gap = the endpoint structurally
        // cannot produce the intended scenario (reason in detail_json:
        // no_negative_available | format_variant_impossible) — a fact, not
        // a failure; manual_rec_required = cannot be auto-captured or
        // auto-reconciled (e.g. four-eyes without a second identity) —
        // excluded from the coverage score, surfaced as a human todo;
        // state_healed = orchestrator receipt that a drifted table was
        // healed back to its snapshot mid-run; s0_restore_recorded = a
        // post-capture S0 restore receipt (the migrate/reconcile gate
        // reads it).
        "captured_ok", "contract_gap", "manual_rec_required",
        "state_healed", "s0_restore_recorded"
    );

    private final ApiBehaviourDiagnosticRepository repository;

    @Transactional(readOnly = true)
    public List<ApiBehaviourDiagnosticDto> listBySession(UUID sessionId) {
        return repository.findBySessionIdOrderByCreatedAtAsc(sessionId)
            .stream()
            .map(ApiBehaviourMapper::toDto)
            .toList();
    }

    @Transactional(readOnly = true)
    public ApiBehaviourDiagnosticDto get(UUID id) {
        return ApiBehaviourMapper.toDto(findOrThrow(id));
    }

    @Transactional
    public ApiBehaviourDiagnosticDto create(CreateApiBehaviourDiagnosticRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Diagnostic request body is required");
        }
        if (request.sessionId() == null) {
            throw new IllegalArgumentException("sessionId is required");
        }
        if (request.diagnosticType() == null || request.diagnosticType().isBlank()) {
            throw new IllegalArgumentException("diagnosticType is required");
        }
        if (request.message() == null || request.message().isBlank()) {
            throw new IllegalArgumentException("message is required");
        }
        requireAllowedType(request.diagnosticType());

        ApiBehaviourDiagnosticEntity entity = ApiBehaviourDiagnosticEntity.builder()
            .id(UUID.randomUUID())
            .sessionId(request.sessionId())
            .operationId(request.operationId())
            .scenarioId(request.scenarioId())
            .diagnosticType(request.diagnosticType())
            .message(request.message())
            .detailJson(request.detailJson())
            .build();

        return ApiBehaviourMapper.toDto(repository.saveAndFlush(entity));
    }

    @Transactional
    public ApiBehaviourDiagnosticDto update(UUID id, UpdateApiBehaviourDiagnosticRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Diagnostic update body is required");
        }
        ApiBehaviourDiagnosticEntity entity = findOrThrow(id);

        if (request.diagnosticType() != null) {
            requireAllowedType(request.diagnosticType());
            entity.setDiagnosticType(request.diagnosticType());
        }
        if (request.message() != null) {
            entity.setMessage(request.message());
        }
        if (request.detailJson() != null) {
            entity.setDetailJson(request.detailJson());
        }

        return ApiBehaviourMapper.toDto(repository.saveAndFlush(entity));
    }

    @Transactional
    public void delete(UUID id) {
        repository.delete(findOrThrow(id));
    }

    private ApiBehaviourDiagnosticEntity findOrThrow(UUID id) {
        return repository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException(
                "API behaviour diagnostic not found: " + id));
    }

    private static void requireAllowedType(String type) {
        if (!ALLOWED_DIAGNOSTIC_TYPES.contains(type)) {
            throw new IllegalArgumentException(
                "diagnosticType '" + type + "' is not in the allowed set "
                    + ALLOWED_DIAGNOSTIC_TYPES);
        }
    }
}
