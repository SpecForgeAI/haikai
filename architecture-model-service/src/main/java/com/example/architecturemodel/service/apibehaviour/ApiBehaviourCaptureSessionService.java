package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.apibehaviour.ApiBehaviourMapper;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourCaptureSessionDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourCaptureSessionRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourCaptureSessionRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureSessionEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourCaptureSessionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * CRUD + status-lifecycle service for {@code api_behaviour_capture_sessions}.
 *
 * <h2>Status transitions</h2>
 * <ul>
 *   <li>{@code draft → configured | cancelled}</li>
 *   <li>{@code configured → running | cancelled | draft}</li>
 *   <li>{@code running → completed | failed | cancelled}</li>
 *   <li>{@code completed | failed | cancelled} → terminal (no transitions out)</li>
 * </ul>
 *
 * <p>The {@code draft → configured → running → terminal} happy path is
 * validated; any move into a terminal status is allowed from any non-terminal
 * status (mirrors the discovery-run lifecycle pattern).</p>
 *
 * <h2>PATCH semantics</h2>
 * Every field on {@link UpdateApiBehaviourCaptureSessionRequest} is
 * boxed/reference; the {@code update} method null-guards every one. A
 * boxed-{@link Boolean} {@code mutating_calls_confirmed} is preserved on
 * {@code null}, so a PATCH that omits it does NOT silently flip the column
 * to {@code false} (per project memory note
 * {@code project_primitive_double_dto_overwrite.md}).
 *
 * <h2>Mutating-confirmation lock</h2>
 * Once a session moves to {@code configured}, the {@code mutatingCallsConfirmed}
 * flag is locked — subsequent PATCHes that try to flip it are rejected with
 * {@link ConflictException}. The wizard's mutating-confirmation toggle is
 * editable only while {@code status='draft'}.
 *
 * <h2>Kind discriminator + pairing invariant (Spec: 2026-05-25 API Test Harness — Target-Side Capture)</h2>
 * <ul>
 *   <li>{@code kind} valid values: {@code "current"} | {@code "target"}.
 *       Anything else is rejected at create / update with an
 *       {@link IllegalArgumentException} (→ HTTP 400).</li>
 *   <li>If {@code kind="target"} then {@code sourceBaselineId} MUST be
 *       non-null AND MUST resolve to an existing baseline with
 *       {@code kind="current"} in the same {@code projectId} +
 *       {@code architectureId}.</li>
 *   <li>If {@code kind="current"} then {@code sourceBaselineId} MUST be
 *       null.</li>
 *   <li>On create, omitted {@code kind} defaults to {@code "current"}.</li>
 *   <li>On PATCH, the {@code kind} + {@code sourceBaselineId} fields are
 *       null-guarded; whenever either is provided, the invariant is
 *       re-checked against the resulting (kind, sourceBaselineId) pair.</li>
 * </ul>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 * <p>Extended: API Test Harness — Target-Side Capture (2026-05-25) — Task Group 2</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourCaptureSessionService {

    public static final Set<String> ALLOWED_STATUSES = Set.of(
        "draft", "configured", "running", "completed", "failed", "cancelled"
    );
    public static final Set<String> ALLOWED_KINDS = Set.of("current", "target");
    private static final Set<String> TERMINAL_STATUSES = Set.of(
        "completed", "failed", "cancelled"
    );

    /**
     * Allowed forward transitions per source status. Terminal statuses have
     * no entry — any attempt to transition out is rejected.
     */
    private static final Map<String, Set<String>> ALLOWED_TRANSITIONS = Map.of(
        "draft",      Set.of("configured", "cancelled"),
        "configured", Set.of("running", "cancelled", "draft"),
        "running",    Set.of("completed", "failed", "cancelled")
    );

    private final ApiBehaviourCaptureSessionRepository repository;
    private final ApiBehaviourBaselineRepository baselineRepository;

    @Transactional(readOnly = true)
    public List<ApiBehaviourCaptureSessionDto> listByProjectAndArchitecture(
            UUID projectId, UUID architectureId) {
        return repository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(projectId, architectureId)
            .stream()
            .map(ApiBehaviourMapper::toDto)
            .toList();
    }

    /**
     * List every capture session in {@code status}, ACROSS ALL PROJECTS.
     *
     * <p>Internal, non-project-scoped query used by the
     * {@code api-migration-validation-service} for (a) startup orphan-session
     * reconciliation and (b) resolving a target-replay session by id without
     * knowing the owning project up front. Exposed -- outside the project
     * scoping the user-facing routes enforce -- via
     * {@link com.example.architecturemodel.controller.apibehaviour.ApiBehaviourCaptureSessionGlobalController}
     * at {@code GET /api/api-behaviour/capture-sessions?status=...}.</p>
     */
    @Transactional(readOnly = true)
    public List<ApiBehaviourCaptureSessionDto> listByStatus(String status) {
        requireAllowedStatus(status);
        return repository.findByStatus(status)
            .stream()
            .map(ApiBehaviourMapper::toDto)
            .toList();
    }

    @Transactional(readOnly = true)
    public ApiBehaviourCaptureSessionDto get(UUID projectId, UUID sessionId) {
        ApiBehaviourCaptureSessionEntity entity = findOrThrow(projectId, sessionId);
        return ApiBehaviourMapper.toDto(entity);
    }

    @Transactional
    public ApiBehaviourCaptureSessionDto create(
            UUID projectId, CreateApiBehaviourCaptureSessionRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Capture session request body is required");
        }
        if (request.architectureId() == null) {
            throw new IllegalArgumentException("architectureId is required");
        }
        String status = request.status() == null ? "draft" : request.status();
        requireAllowedStatus(status);
        if (!"draft".equals(status)) {
            throw new ConflictException(
                "New capture sessions must start in 'draft' status (got '" + status + "')");
        }

        String kind = request.kind() == null ? "current" : request.kind();
        requireAllowedKind(kind);
        UUID sourceBaselineId = request.sourceBaselineId();
        requirePairingInvariant(projectId, request.architectureId(),
            kind, sourceBaselineId);

        ApiBehaviourCaptureSessionEntity entity = ApiBehaviourCaptureSessionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(request.architectureId())
            .name(request.name())
            .status(status)
            .environmentName(request.environmentName())
            .apiBaseUrl(request.apiBaseUrl())
            .authType(request.authType())
            .authConfigRedactedJson(request.authConfigRedactedJson())
            .defaultHeadersRedactedJson(request.defaultHeadersRedactedJson())
            .oasSpecRefsJson(request.oasSpecRefsJson())
            .dbConfigRedactedJson(request.dbConfigRedactedJson())
            .mutatingCallsConfirmed(request.mutatingCallsConfirmed() == null
                ? Boolean.FALSE : request.mutatingCallsConfirmed())
            .kind(kind)
            .sourceBaselineId(sourceBaselineId)
            .build();

        ApiBehaviourCaptureSessionEntity saved = repository.saveAndFlush(entity);
        log.info("Created api-behaviour capture session id={} project={} arch={} kind={}",
            saved.getId(), projectId, request.architectureId(), kind);
        return ApiBehaviourMapper.toDto(saved);
    }

    /**
     * PATCH update. Every field is null-guarded — an omitted JSON key (which
     * Jackson binds to {@code null} on the boxed/reference DTO field) means
     * "preserve the existing value". This is true PATCH semantics — the
     * primitive-numeric/Boolean wipe-to-zero pitfall is avoided by the boxed
     * DTO types and by the explicit null-guards below.
     */
    @Transactional
    public ApiBehaviourCaptureSessionDto update(
            UUID projectId, UUID sessionId,
            UpdateApiBehaviourCaptureSessionRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Capture session update body is required");
        }
        ApiBehaviourCaptureSessionEntity entity = findOrThrow(projectId, sessionId);

        if (request.name() != null) {
            entity.setName(request.name());
        }
        if (request.status() != null) {
            requireAllowedStatus(request.status());
            requireAllowedTransition(entity.getStatus(), request.status());
            entity.setStatus(request.status());
        }
        if (request.environmentName() != null) {
            entity.setEnvironmentName(request.environmentName());
        }
        if (request.apiBaseUrl() != null) {
            entity.setApiBaseUrl(request.apiBaseUrl());
        }
        if (request.authType() != null) {
            entity.setAuthType(request.authType());
        }
        if (request.authConfigRedactedJson() != null) {
            entity.setAuthConfigRedactedJson(request.authConfigRedactedJson());
        }
        if (request.defaultHeadersRedactedJson() != null) {
            entity.setDefaultHeadersRedactedJson(request.defaultHeadersRedactedJson());
        }
        if (request.oasSpecRefsJson() != null) {
            entity.setOasSpecRefsJson(request.oasSpecRefsJson());
        }
        if (request.dbConfigRedactedJson() != null) {
            entity.setDbConfigRedactedJson(request.dbConfigRedactedJson());
        }
        if (request.mutatingCallsConfirmed() != null) {
            // Mutating-confirmation lock: once status has moved past 'draft',
            // the toggle is frozen. Re-asserting the same value is a no-op
            // (allowed); attempting to flip it is rejected.
            if (!"draft".equals(entity.getStatus())
                && !request.mutatingCallsConfirmed().equals(entity.getMutatingCallsConfirmed())) {
                throw new ConflictException(
                    "mutatingCallsConfirmed is locked once the session leaves 'draft' status");
            }
            entity.setMutatingCallsConfirmed(request.mutatingCallsConfirmed());
        }
        if (request.startedAt() != null) {
            entity.setStartedAt(request.startedAt());
        }
        if (request.completedAt() != null) {
            entity.setCompletedAt(request.completedAt());
        }
        if (request.errorMessage() != null) {
            entity.setErrorMessage(request.errorMessage());
        }
        // Scenario outcome tallies (changeset 171, misleading-COMPLETED fix) —
        // null-guarded boxed Integers per the PATCH rule, set by the capture
        // orchestrator's completion PATCH.
        if (request.scenariosAttempted() != null) {
            entity.setScenariosAttempted(request.scenariosAttempted());
        }
        if (request.scenariosCompleted() != null) {
            entity.setScenariosCompleted(request.scenariosCompleted());
        }
        if (request.scenariosErrored() != null) {
            entity.setScenariosErrored(request.scenariosErrored());
        }
        // Inventory-reconciliation scope + Start coverage-override audit trio
        // (Spec: Model-Seeded Capture Inventory, 2026-06-11; changeset 178) --
        // all null-guarded boxed/reference fields per the PATCH rule.
        if (request.scopeInterfaceIdsJson() != null) {
            entity.setScopeInterfaceIdsJson(request.scopeInterfaceIdsJson());
        }
        if (request.coverageOverrideJustification() != null) {
            entity.setCoverageOverrideJustification(request.coverageOverrideJustification());
        }
        if (request.coverageOverrideUnaccountedCount() != null) {
            entity.setCoverageOverrideUnaccountedCount(request.coverageOverrideUnaccountedCount());
        }
        if (request.coverageOverrideAt() != null) {
            entity.setCoverageOverrideAt(request.coverageOverrideAt());
        }
        // Coverage summary (Spec: Oracle Coverage Scoring, 2026-06-17;
        // changeset 189) -- written on the completion PATCH by the single-source
        // scorer. Null-guarded reference field per the PATCH rule: an absent key
        // (Jackson-bound to null) preserves any existing summary; it never
        // clobbers a previously-recorded summary back to null.
        if (request.coverageSummaryJson() != null) {
            entity.setCoverageSummaryJson(request.coverageSummaryJson());
        }
        // Data-type format defaults (Spec: Capture data-type format defaults,
        // 2026-06-20; changeset 195) -- persisted by the capture wizard step.
        // Null-guarded reference field per the PATCH rule: an absent key
        // (Jackson-bound to null) preserves any existing map; it never wipes
        // a previously-recorded set of defaults. A null VALUE *inside* the map
        // (an explicit "no default" for a category) is meaningful and is
        // persisted verbatim -- only an omitted whole field is a no-op.
        if (request.dataTypeDefaultsJson() != null) {
            entity.setDataTypeDefaultsJson(request.dataTypeDefaultsJson());
        }

        // Kind + pairing invariant — null-guarded per PATCH semantics. If
        // either field appears in the body, re-check the invariant against
        // the resulting (kind, sourceBaselineId) pair.
        boolean kindOrPairingTouched =
            request.kind() != null || request.sourceBaselineId() != null;
        if (kindOrPairingTouched) {
            String effectiveKind =
                request.kind() != null ? request.kind() : entity.getKind();
            requireAllowedKind(effectiveKind);
            UUID effectiveSource = request.sourceBaselineId() != null
                ? request.sourceBaselineId()
                : entity.getSourceBaselineId();
            requirePairingInvariant(projectId, entity.getArchitectureId(),
                effectiveKind, effectiveSource);
            entity.setKind(effectiveKind);
            entity.setSourceBaselineId(effectiveSource);
        }

        ApiBehaviourCaptureSessionEntity saved = repository.saveAndFlush(entity);
        return ApiBehaviourMapper.toDto(saved);
    }

    @Transactional
    public void delete(UUID projectId, UUID sessionId) {
        ApiBehaviourCaptureSessionEntity entity = findOrThrow(projectId, sessionId);
        repository.delete(entity);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private ApiBehaviourCaptureSessionEntity findOrThrow(UUID projectId, UUID sessionId) {
        ApiBehaviourCaptureSessionEntity entity = repository.findById(sessionId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "API behaviour capture session not found: " + sessionId));
        if (!projectId.equals(entity.getProjectId())) {
            throw new ResourceNotFoundException(
                "API behaviour capture session " + sessionId
                    + " not found in project " + projectId);
        }
        return entity;
    }

    private static void requireAllowedStatus(String status) {
        if (!ALLOWED_STATUSES.contains(status)) {
            throw new IllegalArgumentException(
                "status '" + status + "' is not in the allowed set " + ALLOWED_STATUSES);
        }
    }

    private static void requireAllowedKind(String kind) {
        if (!ALLOWED_KINDS.contains(kind)) {
            throw new IllegalArgumentException(
                "kind '" + kind + "' is not in the allowed set " + ALLOWED_KINDS);
        }
    }

    /**
     * Enforce the FK-pairing invariant on capture sessions:
     * <ul>
     *   <li>{@code kind="target"} → {@code sourceBaselineId} non-null AND
     *       MUST resolve to an existing baseline with {@code kind="current"}
     *       in the same project + architecture.</li>
     *   <li>{@code kind="current"} → {@code sourceBaselineId} MUST be
     *       null.</li>
     * </ul>
     */
    private void requirePairingInvariant(
            UUID projectId, UUID architectureId,
            String kind, UUID sourceBaselineId) {
        if ("target".equals(kind)) {
            if (sourceBaselineId == null) {
                throw new IllegalArgumentException(
                    "kind='target' capture sessions require a non-null sourceBaselineId");
            }
            ApiBehaviourBaselineEntity source = baselineRepository.findById(sourceBaselineId)
                .orElseThrow(() -> new IllegalArgumentException(
                    "sourceBaselineId '" + sourceBaselineId
                        + "' does not resolve to an existing baseline"));
            if (!projectId.equals(source.getProjectId())
                || !architectureId.equals(source.getArchitectureId())) {
                throw new IllegalArgumentException(
                    "sourceBaselineId '" + sourceBaselineId
                        + "' must be in the same project + architecture as the target session");
            }
            if (!"current".equals(source.getKind())) {
                throw new IllegalArgumentException(
                    "sourceBaselineId '" + sourceBaselineId
                        + "' must point at a kind='current' baseline (got kind='"
                        + source.getKind() + "')");
            }
        } else {
            // kind="current"
            if (sourceBaselineId != null) {
                throw new IllegalArgumentException(
                    "kind='current' capture sessions MUST NOT carry a sourceBaselineId");
            }
        }
    }

    private static void requireAllowedTransition(String from, String to) {
        if (from.equals(to)) {
            return;
        }
        if (TERMINAL_STATUSES.contains(from)) {
            throw new ConflictException(
                "Capture session in terminal status '" + from + "' cannot transition to '" + to + "'");
        }
        Set<String> next = ALLOWED_TRANSITIONS.getOrDefault(from, Set.of());
        if (!next.contains(to)) {
            throw new ConflictException(
                "Illegal status transition for api-behaviour capture session: '"
                    + from + "' -> '" + to + "'");
        }
    }
}
