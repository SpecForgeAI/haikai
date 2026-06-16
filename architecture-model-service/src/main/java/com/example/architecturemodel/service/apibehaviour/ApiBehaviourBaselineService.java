package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.apibehaviour.ApiBehaviourMapper;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourBaselineDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourBaselineRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourBaselineRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineRepository;
import com.example.architecturemodel.trace.HaikaiTrace;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * CRUD service for {@code api_behaviour_baselines}.
 *
 * <h2>Status transitions</h2>
 * <ul>
 *   <li>{@code draft → active | archived}</li>
 *   <li>{@code active → archived | draft}</li>
 *   <li>{@code archived → active}</li>
 * </ul>
 *
 * <h2>Kind discriminator + pairing invariant (Spec: 2026-05-25 API Test Harness — Target-Side Capture)</h2>
 * <ul>
 *   <li>{@code kind} valid values: {@code "current"} | {@code "target"}.
 *       Anything else is rejected at create / update with an
 *       {@link IllegalArgumentException} (→ HTTP 400).</li>
 *   <li>If {@code kind="target"} then {@code pairedWithBaselineId} MUST be
 *       non-null AND MUST resolve to an existing baseline with
 *       {@code kind="current"} in the same {@code projectId} +
 *       {@code architectureId}.</li>
 *   <li>If {@code kind="current"} then {@code pairedWithBaselineId} MUST be
 *       null.</li>
 *   <li>On create, omitted {@code kind} defaults to {@code "current"}.</li>
 *   <li>On PATCH, the {@code kind} + {@code pairedWithBaselineId} fields are
 *       null-guarded the same way the rest of the PATCH fields are; whenever
 *       either is provided, the invariant is re-checked against the resulting
 *       (kind, pairedWithBaselineId) pair.</li>
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
public class ApiBehaviourBaselineService {

    public static final Set<String> ALLOWED_STATUSES = Set.of("draft", "active", "archived");

    /**
     * Haikai workflow tracer (service name {@code ams}). OFF by default --
     * every call is a no-op unless {@code HAIKAI_TRACE} is set. See
     * {@code docs/trace-logging.md}.
     */
    private static final HaikaiTrace.Tracer TRACE = HaikaiTrace.forService("ams");

    public static final Set<String> ALLOWED_KINDS = Set.of("current", "target");

    private static final Map<String, Set<String>> ALLOWED_TRANSITIONS = Map.of(
        "draft",    Set.of("active", "archived"),
        "active",   Set.of("archived", "draft"),
        "archived", Set.of("active")
    );

    private final ApiBehaviourBaselineRepository repository;

    @Transactional(readOnly = true)
    public List<ApiBehaviourBaselineDto> listByProjectAndArchitecture(
            UUID projectId, UUID architectureId) {
        return repository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(projectId, architectureId)
            .stream()
            .map(ApiBehaviourMapper::toDto)
            .toList();
    }

    @Transactional(readOnly = true)
    public List<ApiBehaviourBaselineDto> listBySession(UUID sessionId) {
        return repository.findBySessionIdOrderByCreatedAtAsc(sessionId)
            .stream()
            .map(ApiBehaviourMapper::toDto)
            .toList();
    }

    /**
     * List the target-side baselines paired with the given source current-state
     * baseline, newest first. The source baseline MUST exist in the given
     * project AND have {@code kind="current"} — anything else 404s.
     *
     * <p>Consumer is Spec #5's diff UI (this spec's frontend does not call
     * the endpoint; ships here so the AMS contract is complete — accepted Q5).</p>
     */
    @Transactional(readOnly = true)
    public List<ApiBehaviourBaselineDto> listTargetBaselinesPairedWith(
            UUID projectId, UUID sourceId) {
        Optional<ApiBehaviourBaselineEntity> source = repository.findById(sourceId);
        if (source.isEmpty() || !projectId.equals(source.get().getProjectId())) {
            throw new ResourceNotFoundException(
                "API behaviour baseline " + sourceId + " not found in project " + projectId);
        }
        if (!"current".equals(source.get().getKind())) {
            throw new ResourceNotFoundException(
                "API behaviour baseline " + sourceId
                    + " is not a current-state baseline (kind='" + source.get().getKind() + "')");
        }
        return repository.findByPairedWithBaselineIdOrderByCreatedAtDesc(sourceId)
            .stream()
            .map(ApiBehaviourMapper::toDto)
            .toList();
    }

    @Transactional(readOnly = true)
    public ApiBehaviourBaselineDto get(UUID projectId, UUID id) {
        return ApiBehaviourMapper.toDto(findOrThrow(projectId, id));
    }

    @Transactional
    public ApiBehaviourBaselineDto create(
            UUID projectId, CreateApiBehaviourBaselineRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Baseline request body is required");
        }
        if (request.architectureId() == null) {
            throw new IllegalArgumentException("architectureId is required");
        }
        if (request.sessionId() == null) {
            throw new IllegalArgumentException("sessionId is required");
        }
        if (request.name() == null || request.name().isBlank()) {
            throw new IllegalArgumentException("name is required");
        }
        String status = request.status() == null ? "draft" : request.status();
        requireAllowedStatus(status);

        String kind = request.kind() == null ? "current" : request.kind();
        requireAllowedKind(kind);
        UUID pairedWithBaselineId = request.pairedWithBaselineId();
        requirePairingInvariant(projectId, request.architectureId(),
            kind, pairedWithBaselineId);

        ApiBehaviourBaselineEntity entity = ApiBehaviourBaselineEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(request.architectureId())
            .sessionId(request.sessionId())
            .name(request.name())
            .status(status)
            .acceptedCaptureCount(request.acceptedCaptureCount())
            .operationCount(request.operationCount())
            .notes(request.notes())
            .kind(kind)
            .pairedWithBaselineId(pairedWithBaselineId)
            .build();

        ApiBehaviourBaselineEntity saved = repository.saveAndFlush(entity);
        traceBaselineSaved(saved);
        return ApiBehaviourMapper.toDto(saved);
    }

    @Transactional
    public ApiBehaviourBaselineDto update(
            UUID projectId, UUID id, UpdateApiBehaviourBaselineRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Baseline update body is required");
        }
        ApiBehaviourBaselineEntity entity = findOrThrow(projectId, id);

        if (request.name() != null) {
            entity.setName(request.name());
        }
        String statusBefore = entity.getStatus();
        if (request.status() != null) {
            requireAllowedStatus(request.status());
            requireAllowedTransition(entity.getStatus(), request.status());
            entity.setStatus(request.status());
        }
        if (request.acceptedCaptureCount() != null) {
            entity.setAcceptedCaptureCount(request.acceptedCaptureCount());
        }
        if (request.operationCount() != null) {
            entity.setOperationCount(request.operationCount());
        }
        if (request.notes() != null) {
            entity.setNotes(request.notes());
        }

        // Kind + pairing invariant — null-guarded per PATCH semantics. If
        // either field appears in the body, re-check the invariant against
        // the resulting (kind, pairedWithBaselineId) pair.
        boolean kindOrPairingTouched =
            request.kind() != null || request.pairedWithBaselineId() != null;
        if (kindOrPairingTouched) {
            String effectiveKind =
                request.kind() != null ? request.kind() : entity.getKind();
            requireAllowedKind(effectiveKind);
            UUID effectivePair = request.pairedWithBaselineId() != null
                ? request.pairedWithBaselineId()
                : entity.getPairedWithBaselineId();
            requirePairingInvariant(projectId, entity.getArchitectureId(),
                effectiveKind, effectivePair);
            entity.setKind(effectiveKind);
            entity.setPairedWithBaselineId(effectivePair);
        }

        ApiBehaviourBaselineEntity saved = repository.saveAndFlush(entity);
        if ("active".equalsIgnoreCase(saved.getStatus())
                && !"active".equalsIgnoreCase(statusBefore)) {
            traceBaselineActivated(saved);
        }
        return ApiBehaviourMapper.toDto(saved);
    }

    @Transactional
    public void delete(UUID projectId, UUID id) {
        repository.delete(findOrThrow(projectId, id));
    }

    private ApiBehaviourBaselineEntity findOrThrow(UUID projectId, UUID id) {
        ApiBehaviourBaselineEntity entity = repository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException(
                "API behaviour baseline not found: " + id));
        if (!projectId.equals(entity.getProjectId())) {
            throw new ResourceNotFoundException(
                "API behaviour baseline " + id + " not found in project " + projectId);
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
     * Enforce the FK-pairing invariant:
     * <ul>
     *   <li>{@code kind="target"} → {@code pairedWithBaselineId} non-null AND
     *       MUST resolve to an existing baseline with {@code kind="current"}
     *       in the same project + architecture.</li>
     *   <li>{@code kind="current"} → {@code pairedWithBaselineId} MUST be
     *       null.</li>
     * </ul>
     */
    private void requirePairingInvariant(
            UUID projectId, UUID architectureId,
            String kind, UUID pairedWithBaselineId) {
        if ("target".equals(kind)) {
            if (pairedWithBaselineId == null) {
                throw new IllegalArgumentException(
                    "kind='target' baselines require a non-null pairedWithBaselineId");
            }
            ApiBehaviourBaselineEntity source = repository.findById(pairedWithBaselineId)
                .orElseThrow(() -> new IllegalArgumentException(
                    "pairedWithBaselineId '" + pairedWithBaselineId
                        + "' does not resolve to an existing baseline"));
            if (!projectId.equals(source.getProjectId())
                || !architectureId.equals(source.getArchitectureId())) {
                throw new IllegalArgumentException(
                    "pairedWithBaselineId '" + pairedWithBaselineId
                        + "' must be in the same project + architecture as the target baseline");
            }
            if (!"current".equals(source.getKind())) {
                throw new IllegalArgumentException(
                    "pairedWithBaselineId '" + pairedWithBaselineId
                        + "' must point at a kind='current' baseline (got kind='"
                        + source.getKind() + "')");
            }
        } else {
            // kind="current"
            if (pairedWithBaselineId != null) {
                throw new IllegalArgumentException(
                    "kind='current' baselines MUST NOT carry a pairedWithBaselineId");
            }
        }
    }

    // -----------------------------------------------------------------------
    // Haikai trace -- baseline save (draft) + activate
    // -----------------------------------------------------------------------

    /**
     * SUMMARY-trace a baseline save. {@code ok} line + a {@code baseline.saved}
     * detail. When the row is created directly as {@code active}, also emit the
     * activation trace. No-op unless {@code HAIKAI_TRACE} is set; NEVER throws.
     */
    private static void traceBaselineSaved(ApiBehaviourBaselineEntity b) {
        if (!TRACE.isEnabled() || b == null) {
            return;
        }
        try {
            boolean active = "active".equalsIgnoreCase(b.getStatus());
            String stage = active ? "active" : "draft";
            HaikaiTrace.Corr corr = corrFor(b);
            TRACE.ok("baseline saved (" + stage + ") — " + b.getName(), corr);
            TRACE.detail("baseline.saved", baselineDetail(b), corr);
            if (active) {
                traceBaselineActivated(b);
            }
        } catch (RuntimeException ignored) {
            // tracing must never affect the request
        }
    }

    /**
     * SUMMARY-trace a baseline activation (draft -> active PATCH). No-op unless
     * {@code HAIKAI_TRACE} is set; NEVER throws.
     */
    private static void traceBaselineActivated(ApiBehaviourBaselineEntity b) {
        if (!TRACE.isEnabled() || b == null) {
            return;
        }
        try {
            HaikaiTrace.Corr corr = corrFor(b);
            TRACE.ok("baseline activated — " + b.getName(), corr);
            TRACE.detail("baseline.activated", baselineDetail(b), corr);
        } catch (RuntimeException ignored) {
            // tracing must never affect the request
        }
    }

    private static HaikaiTrace.Corr corrFor(ApiBehaviourBaselineEntity b) {
        return HaikaiTrace.Corr.of()
            .project(b.getProjectId() == null ? null : b.getProjectId().toString())
            .arch(b.getArchitectureId() == null ? null : b.getArchitectureId().toString());
    }

    private static Map<String, Object> baselineDetail(ApiBehaviourBaselineEntity b) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("baselineId", b.getId() == null ? null : b.getId().toString());
        d.put("name", b.getName());
        d.put("status", b.getStatus());
        d.put("kind", b.getKind());
        d.put("sessionId", b.getSessionId() == null ? null : b.getSessionId().toString());
        d.put("operationCount", b.getOperationCount());
        d.put("acceptedCaptureCount", b.getAcceptedCaptureCount());
        return d;
    }

    private static void requireAllowedTransition(String from, String to) {
        if (from.equals(to)) {
            return;
        }
        Set<String> next = ALLOWED_TRANSITIONS.getOrDefault(from, Set.of());
        if (!next.contains(to)) {
            throw new ConflictException(
                "Illegal status transition for api-behaviour baseline: '"
                    + from + "' -> '" + to + "'");
        }
    }
}
