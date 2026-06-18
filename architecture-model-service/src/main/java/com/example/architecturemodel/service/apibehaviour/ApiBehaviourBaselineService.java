package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.apibehaviour.ApiBehaviourMapper;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourBaselineDto;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourBaselineIntegrityDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourBaselineRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourBaselineRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineItemEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureSessionEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineItemRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourCaptureSessionRepository;
import com.example.architecturemodel.trace.HaikaiTrace;
import com.example.architecturemodel.util.BaselineContentHashUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
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
 * <h2>Integrity + provenance stamping (Spec: 2026-06-17 Baseline Integrity &amp; Provenance)</h2>
 * <p>At the draft→active ACTIVATE transition, and ONLY for {@code kind='current'}
 * baselines, the service reads the baseline's OWN persisted items, computes the
 * deterministic canonical content hash (see {@link BaselineContentHashUtil}),
 * and stamps {@code content_hash} + {@code provenance_json} onto the header in
 * the SAME transaction as the activation. This makes the pinned oracle
 * tamper-EVIDENT and auditable. Drafts and {@code kind='target'} baselines are
 * never stamped (stamping happens only on transition INTO active). The
 * {@link #verifyIntegrity} operation recomputes the same hash over the current
 * stored items and reports verified / mismatch / no-hash-recorded.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 * <p>Extended: API Test Harness — Target-Side Capture (2026-05-25) — Task Group 2</p>
 * <p>Extended: Baseline Integrity &amp; Provenance (2026-06-17) — Task Group 1
 * (stamp-at-activate + verify).</p>
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
    private final ApiBehaviourBaselineItemRepository itemRepository;
    private final ApiBehaviourCaptureSessionRepository sessionRepository;

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

    /**
     * Server-side integrity verify: recompute the canonical content hash over
     * the baseline's CURRENT stored items (identical canonical form to the
     * stamp-at-activate path) and compare it to the stamped
     * {@code content_hash}.
     *
     * <p>{@code integrity_verified} = {@code content_hash != null && content_hash
     * == recomputed_hash}. A baseline with a null {@code content_hash}
     * (pre-existing / never-activated / draft) yields the NEUTRAL result
     * ({@code content_hash: null}, {@code integrity_verified: false}) — the
     * consumer treats null-hash as "no hash recorded", NOT a mismatch.
     * Verification is only meaningful for {@code kind='current'} baselines;
     * other kinds are never stamped so they surface as null-hash neutral.</p>
     */
    @Transactional(readOnly = true)
    public ApiBehaviourBaselineIntegrityDto verifyIntegrity(UUID projectId, UUID id) {
        ApiBehaviourBaselineEntity entity = findOrThrow(projectId, id);
        String stored = entity.getContentHash();
        // Recompute over the CURRENT stored items using the identical canonical
        // form (BaselineContentHashUtil) used at stamp time.
        List<ApiBehaviourBaselineItemEntity> items =
            itemRepository.findByBaselineIdOrderByCreatedAtAsc(id);
        String recomputed = BaselineContentHashUtil.computeContentHash(items);
        boolean verified = stored != null && stored.equals(recomputed);
        return new ApiBehaviourBaselineIntegrityDto(stored, recomputed, verified);
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
        // A baseline created directly as active (e.g. target replay writer) is an
        // activation INTO active too: stamp integrity + provenance for current.
        if ("active".equalsIgnoreCase(saved.getStatus())) {
            saved = stampIntegrityIfCurrent(saved);
        }
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
            // Draft→active ACTIVATE transition. Stamp the integrity hash +
            // provenance onto the header in the SAME transaction, BEFORE
            // returning the DTO, but ONLY for kind='current' (the pinned
            // oracle). The items are already persisted by the frontend draft
            // flow. This is layered on top of immutability-by-no-mutation-path;
            // it never mutates the pinned item content.
            saved = stampIntegrityIfCurrent(saved);
            traceBaselineActivated(saved);
        }
        return ApiBehaviourMapper.toDto(saved);
    }

    @Transactional
    public void delete(UUID projectId, UUID id) {
        repository.delete(findOrThrow(projectId, id));
    }

    // -----------------------------------------------------------------------
    // Integrity + provenance stamping at draft->active (Spec: 2026-06-17)
    // -----------------------------------------------------------------------

    /**
     * Stamp {@code content_hash} + {@code provenance_json} onto the baseline
     * header at the moment immutability takes effect (the activate transition),
     * over the items AS PERSISTED. ONLY for {@code kind='current'} baselines —
     * target baselines are transient / regenerated, not the pinned trust anchor
     * (R8), so they are left unstamped and returned unchanged.
     *
     * <p>Returns the (possibly re-saved) entity so the caller maps the stamped
     * DTO.</p>
     */
    private ApiBehaviourBaselineEntity stampIntegrityIfCurrent(
            ApiBehaviourBaselineEntity baseline) {
        if (!"current".equalsIgnoreCase(baseline.getKind())) {
            // R8: out of scope for target baselines.
            return baseline;
        }

        // Read the baseline's OWN items (already persisted by the draft flow)
        // and compute the deterministic canonical content hash. Same canonical
        // form as verifyIntegrity, so a later verify recomputes byte-identical.
        List<ApiBehaviourBaselineItemEntity> items =
            itemRepository.findByBaselineIdOrderByCreatedAtAsc(baseline.getId());
        String contentHash = BaselineContentHashUtil.computeContentHash(items);

        Instant activatedAt = Instant.now();
        Map<String, Object> provenance =
            buildProvenance(baseline, contentHash, activatedAt);

        baseline.setContentHash(contentHash);
        baseline.setProvenanceJson(provenance);
        return repository.saveAndFlush(baseline);
    }

    /**
     * Assemble the provenance record stamped at activate:
     * {@code { session_id, environment_name, activated_at, coverage_score,
     * coverage_summary, accepted_capture_count, operation_count,
     * hash_algo, canonical_version }}.
     *
     * <p>{@code session_id}, {@code accepted_capture_count},
     * {@code operation_count} come from the baseline header.
     * {@code environment_name}, {@code coverage_score}, {@code coverage_summary}
     * are read from the linked capture session via the baseline's
     * {@code session_id}. {@code coverage_score} is Spec A's
     * {@code overall_score} from the session's {@code coverage_summary_json}
     * (changeset 189) — NOT {@code in_scope_coverage_pct}. If the session has no
     * coverage summary (legacy / not recorded), {@code coverage_score} is null
     * and {@code coverage_summary} is null — never fabricated.</p>
     */
    private Map<String, Object> buildProvenance(
            ApiBehaviourBaselineEntity baseline,
            String contentHash,
            Instant activatedAt) {
        Map<String, Object> provenance = new LinkedHashMap<>();
        provenance.put("session_id",
            baseline.getSessionId() == null ? null : baseline.getSessionId().toString());

        // Resolve the originating capture session for environment_name + coverage.
        String environmentName = null;
        Object coverageScore = null;
        Map<String, Object> coverageSummary = null;
        if (baseline.getSessionId() != null) {
            ApiBehaviourCaptureSessionEntity session =
                sessionRepository.findById(baseline.getSessionId()).orElse(null);
            if (session != null) {
                environmentName = session.getEnvironmentName();
                Map<String, Object> summary = session.getCoverageSummaryJson();
                if (summary != null) {
                    coverageSummary = summary;
                    // Spec A's overall coverage score — null-safe if absent.
                    coverageScore = summary.get("overall_score");
                }
            }
        }

        provenance.put("environment_name", environmentName);
        provenance.put("activated_at", activatedAt.toString());
        provenance.put("coverage_score", coverageScore);
        provenance.put("coverage_summary", coverageSummary);
        provenance.put("accepted_capture_count", baseline.getAcceptedCaptureCount());
        provenance.put("operation_count", baseline.getOperationCount());
        provenance.put("hash_algo", BaselineContentHashUtil.HASH_ALGO);
        provenance.put("canonical_version", BaselineContentHashUtil.CANONICAL_VERSION);
        return provenance;
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
