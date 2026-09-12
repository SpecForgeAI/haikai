package com.example.architecturemodel.service.procbehaviour;

import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.CreateProcBaselineRequest;
import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.CreateProcBaselineRequest.ProcBaselineItemDto;
import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.CreateProcCaptureSessionRequest;
import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.InsertProcCapturesRequest;
import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.InsertProcCapturesRequest.ProcCaptureDto;
import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.InsertProcDiagnosticsRequest;
import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.InsertProcDiagnosticsRequest.ProcDiagnosticDto;
import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.PatchProcCaptureSessionRequest;
import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.UpsertProcScenariosRequest;
import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.UpsertProcScenariosRequest.ProcScenarioDto;
import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourBaselineItemEntity;
import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourCaptureEntity;
import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourCaptureSessionEntity;
import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourDiagnosticEntity;
import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourScenarioEntity;
import com.example.architecturemodel.repository.entity.ProcBehaviourBaselineItemRepository;
import com.example.architecturemodel.repository.entity.ProcBehaviourBaselineRepository;
import com.example.architecturemodel.repository.entity.ProcBehaviourCaptureRepository;
import com.example.architecturemodel.repository.entity.ProcBehaviourCaptureSessionRepository;
import com.example.architecturemodel.repository.entity.ProcBehaviourDiagnosticRepository;
import com.example.architecturemodel.repository.entity.ProcBehaviourScenarioRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;

/**
 * Proc behaviour capture data plane -- Stored Proc &amp; Function Behaviour
 * Program, Spec 3 (changeset 230).
 *
 * <p>Owns four things the controllers must not re-implement:</p>
 * <ol>
 *   <li>The session STATE MACHINE (draft -&gt; configured -&gt; running -&gt;
 *       terminal, plus configured -&gt; draft for re-scoping). An illegal
 *       transition throws {@link IllegalStateException}, which the controller
 *       renders as 409 rather than letting a bad status reach the CHECK
 *       constraint as a 500.</li>
 *   <li>Scenario UPSERT by the natural key (session, routine, scenario_name)
 *       so a retry re-uses the row instead of colliding with the unique
 *       index.</li>
 *   <li>Baseline CONTENT HASH: a SHA-256 over the SORTED
 *       {@code routine_id|scenario_name|expected_envelope_json} strings, with
 *       the envelope serialised with map keys ordered. Same expectations in
 *       any order produce the same hash, so a re-save is recognisable as a
 *       no-op.</li>
 *   <li>PIN: exactly ONE pinned baseline per (architecture, kind). Pinning
 *       supersedes the other pinned baselines of that kind and leaves the
 *       other kind alone.</li>
 * </ol>
 */
@Service
@RequiredArgsConstructor
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ProcBehaviourService {

    /**
     * Canonical serialiser for the content hash: map entries ordered by key so
     * the digest depends on the CONTENT of an expected envelope, never on the
     * insertion order Jackson happened to produce upstream.
     */
    private static final ObjectMapper CANONICAL_JSON = new ObjectMapper()
        .configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);

    /** The state machine. A status absent from the map is terminal. */
    private static final Map<String, Set<String>> ALLOWED_TRANSITIONS = Map.of(
        ProcBehaviourCaptureSessionEntity.STATUS_DRAFT,
        Set.of(ProcBehaviourCaptureSessionEntity.STATUS_CONFIGURED),

        ProcBehaviourCaptureSessionEntity.STATUS_CONFIGURED,
        Set.of(ProcBehaviourCaptureSessionEntity.STATUS_RUNNING,
               ProcBehaviourCaptureSessionEntity.STATUS_DRAFT),

        ProcBehaviourCaptureSessionEntity.STATUS_RUNNING,
        Set.of(ProcBehaviourCaptureSessionEntity.STATUS_COMPLETED,
               ProcBehaviourCaptureSessionEntity.STATUS_COMPLETED_WITH_FINDINGS,
               ProcBehaviourCaptureSessionEntity.STATUS_FAILED,
               ProcBehaviourCaptureSessionEntity.STATUS_CANCELLED));

    private static final Set<String> ALL_STATUSES = Set.of(
        ProcBehaviourCaptureSessionEntity.STATUS_DRAFT,
        ProcBehaviourCaptureSessionEntity.STATUS_CONFIGURED,
        ProcBehaviourCaptureSessionEntity.STATUS_RUNNING,
        ProcBehaviourCaptureSessionEntity.STATUS_COMPLETED,
        ProcBehaviourCaptureSessionEntity.STATUS_COMPLETED_WITH_FINDINGS,
        ProcBehaviourCaptureSessionEntity.STATUS_FAILED,
        ProcBehaviourCaptureSessionEntity.STATUS_CANCELLED);

    private static final Set<String> KINDS = Set.of(
        ProcBehaviourCaptureSessionEntity.KIND_CURRENT,
        ProcBehaviourCaptureSessionEntity.KIND_TARGET);

    private final ProcBehaviourCaptureSessionRepository sessionRepository;
    private final ProcBehaviourScenarioRepository scenarioRepository;
    private final ProcBehaviourCaptureRepository captureRepository;
    private final ProcBehaviourBaselineRepository baselineRepository;
    private final ProcBehaviourBaselineItemRepository baselineItemRepository;
    private final ProcBehaviourDiagnosticRepository diagnosticRepository;

    // ------------------------------------------------------------------
    // Sessions
    // ------------------------------------------------------------------

    @Transactional
    public ProcBehaviourCaptureSessionEntity createSession(
            UUID projectId, UUID architectureId, CreateProcCaptureSessionRequest request) {
        if (request == null || request.name() == null || request.name().isBlank()) {
            throw new IllegalArgumentException("name is required");
        }
        String kind = normaliseKind(request.kind());
        ProcBehaviourCaptureSessionEntity session = ProcBehaviourCaptureSessionEntity.builder()
            .projectId(projectId)
            .architectureId(architectureId)
            .name(request.name().trim())
            .status(ProcBehaviourCaptureSessionEntity.STATUS_DRAFT)
            .kind(kind)
            .scopeRoutineIdsJson(request.scopeRoutineIdsJson() == null
                ? new ArrayList<>() : new ArrayList<>(request.scopeRoutineIdsJson()))
            .dbConfigRedactedJson(request.dbConfigRedactedJson())
            .sessionProfileJson(request.sessionProfileJson())
            .captureTuningJson(request.captureTuningJson())
            .build();
        ProcBehaviourCaptureSessionEntity saved = sessionRepository.save(session);
        log.info("[diag-ams] op=proc_behaviour_session_create arch={} kind={} scope={}",
            shortId(architectureId), kind, saved.getScopeRoutineIdsJson().size());
        return saved;
    }

    @Transactional(readOnly = true)
    public List<ProcBehaviourCaptureSessionEntity> listSessions(UUID architectureId) {
        return sessionRepository.findByArchitectureIdOrderByCreatedAtDesc(architectureId);
    }

    @Transactional(readOnly = true)
    public Optional<ProcBehaviourCaptureSessionEntity> getSession(UUID architectureId, UUID sessionId) {
        return sessionRepository.findById(sessionId)
            .filter(s -> architectureId == null || architectureId.equals(s.getArchitectureId()));
    }

    /**
     * Delete a capture session (2026-09-12; the API-behaviour tab could, the
     * stored-proc tab could not). Scenarios, captures and diagnostics go with
     * it (ON DELETE CASCADE, changeset 230). Baselines saved FROM the session
     * are KEPT: their {@code session_id} is nullable and carries no FK, so it
     * is detached here rather than left dangling. A RUNNING session is a
     * conflict (cancel it first) -- deleting under a live run would strand
     * the validation service's in-flight state.
     *
     * @return true when deleted, false when no such session in the architecture
     */
    @Transactional
    public boolean deleteSession(UUID architectureId, UUID sessionId) {
        Optional<ProcBehaviourCaptureSessionEntity> found = getSession(architectureId, sessionId);
        if (found.isEmpty()) {
            return false;
        }
        ProcBehaviourCaptureSessionEntity session = found.get();
        if (ProcBehaviourCaptureSessionEntity.STATUS_RUNNING.equals(session.getStatus())) {
            throw new IllegalStateException(
                "Proc capture session " + sessionId + " is still running -- cancel it before deleting.");
        }
        for (ProcBehaviourBaselineEntity baseline
                : baselineRepository.findByArchitectureIdOrderByCreatedAtDesc(session.getArchitectureId())) {
            if (sessionId.equals(baseline.getSessionId())) {
                baseline.setSessionId(null);
                baselineRepository.save(baseline);
            }
        }
        sessionRepository.delete(session);
        log.info("[diag-ams] op=proc_capture_session_delete session={} architecture={}",
            sessionId, session.getArchitectureId());
        return true;
    }

    /**
     * Sparse PATCH. Supplied jsonb fields REPLACE their column; a null field is
     * "not supplied" and is left alone. A supplied {@code status} must be a
     * legal transition from the current one.
     *
     * @throws IllegalStateException on an unknown or illegal target status
     */
    @Transactional
    public ProcBehaviourCaptureSessionEntity patchSession(
            UUID architectureId, UUID sessionId, PatchProcCaptureSessionRequest request) {
        ProcBehaviourCaptureSessionEntity session = getSession(architectureId, sessionId)
            .orElseThrow(() -> new IllegalArgumentException("capture session not found: " + sessionId));
        if (request == null) {
            return session;
        }
        if (request.status() != null && !request.status().isBlank()) {
            String target = request.status().trim().toLowerCase(Locale.ROOT);
            assertTransitionAllowed(session.getStatus(), target);
            session.setStatus(target);
        }
        if (request.name() != null && !request.name().isBlank()) {
            session.setName(request.name().trim());
        }
        if (request.scopeRoutineIdsJson() != null) {
            session.setScopeRoutineIdsJson(new ArrayList<>(request.scopeRoutineIdsJson()));
        }
        if (request.dbConfigRedactedJson() != null) {
            session.setDbConfigRedactedJson(request.dbConfigRedactedJson());
        }
        if (request.sessionProfileJson() != null) {
            session.setSessionProfileJson(request.sessionProfileJson());
        }
        if (request.captureTuningJson() != null) {
            session.setCaptureTuningJson(request.captureTuningJson());
        }
        if (request.coverageSummaryJson() != null) {
            session.setCoverageSummaryJson(request.coverageSummaryJson());
        }
        if (request.s0FingerprintJson() != null) {
            session.setS0FingerprintJson(request.s0FingerprintJson());
        }
        if (request.startedAt() != null) {
            session.setStartedAt(request.startedAt());
        }
        if (request.completedAt() != null) {
            session.setCompletedAt(request.completedAt());
        }
        return sessionRepository.save(session);
    }

    /**
     * The state machine gate. Same-status PATCHes are idempotent no-ops, not
     * transitions; anything else must be in {@link #ALLOWED_TRANSITIONS}.
     */
    static void assertTransitionAllowed(String from, String to) {
        if (!ALL_STATUSES.contains(to)) {
            throw new IllegalStateException("unknown capture session status: " + to);
        }
        String current = from == null ? ProcBehaviourCaptureSessionEntity.STATUS_DRAFT : from;
        if (current.equals(to)) {
            return;
        }
        Set<String> allowed = ALLOWED_TRANSITIONS.getOrDefault(current, Set.of());
        if (!allowed.contains(to)) {
            throw new IllegalStateException(
                "illegal capture session transition: " + current + " -> " + to);
        }
    }

    // ------------------------------------------------------------------
    // Scenarios
    // ------------------------------------------------------------------

    /** Batch upsert keyed by (session_id, routine_id, scenario_name). */
    @Transactional
    public List<ProcBehaviourScenarioEntity> upsertScenarios(
            UUID sessionId, UpsertProcScenariosRequest request) {
        List<ProcScenarioDto> dtos = request == null || request.scenarios() == null
            ? List.of() : request.scenarios();
        Map<String, ProcBehaviourScenarioEntity> existing = new HashMap<>();
        for (ProcBehaviourScenarioEntity e : scenarioRepository.findBySessionId(sessionId)) {
            existing.put(scenarioKey(e.getRoutineId(), e.getScenarioName()), e);
        }
        List<ProcBehaviourScenarioEntity> toSave = new ArrayList<>();
        for (ProcScenarioDto dto : dtos) {
            if (dto.routineId() == null || dto.scenarioName() == null || dto.scenarioName().isBlank()) {
                continue;
            }
            String key = scenarioKey(dto.routineId(), dto.scenarioName());
            ProcBehaviourScenarioEntity entity = existing.get(key);
            if (entity == null) {
                entity = ProcBehaviourScenarioEntity.builder()
                    .sessionId(sessionId)
                    .routineId(dto.routineId())
                    .scenarioName(dto.scenarioName().trim())
                    .build();
                existing.put(key, entity);
            }
            entity.setScenarioType(dto.scenarioType());
            entity.setGenerationSource(dto.generationSource());
            entity.setInputsJson(dto.inputsJson() == null ? new ArrayList<>() : new ArrayList<>(dto.inputsJson()));
            entity.setSequenceJson(dto.sequenceJson());
            if (dto.status() != null && !dto.status().isBlank()) {
                entity.setStatus(dto.status().trim().toLowerCase(Locale.ROOT));
            }
            entity.setExclusionReason(dto.exclusionReason());
            entity.setNotes(dto.notes());
            toSave.add(entity);
        }
        List<ProcBehaviourScenarioEntity> saved = scenarioRepository.saveAll(toSave);
        log.info("[diag-ams] op=proc_behaviour_scenarios_upsert session={} upserted={} skipped={}",
            shortId(sessionId), saved.size(), dtos.size() - toSave.size());
        return saved;
    }

    @Transactional(readOnly = true)
    public List<ProcBehaviourScenarioEntity> listScenarios(UUID sessionId, UUID routineId) {
        return routineId == null
            ? scenarioRepository.findBySessionId(sessionId)
            : scenarioRepository.findBySessionIdAndRoutineId(sessionId, routineId);
    }

    private static String scenarioKey(UUID routineId, String scenarioName) {
        return routineId + "|" + (scenarioName == null ? "" : scenarioName.trim());
    }

    // ------------------------------------------------------------------
    // Captures
    // ------------------------------------------------------------------

    /** Batch insert. Captures are append-only evidence -- never updated. */
    @Transactional
    public List<ProcBehaviourCaptureEntity> insertCaptures(
            UUID sessionId, InsertProcCapturesRequest request) {
        List<ProcCaptureDto> dtos = request == null || request.captures() == null
            ? List.of() : request.captures();
        List<ProcBehaviourCaptureEntity> toSave = new ArrayList<>();
        for (ProcCaptureDto dto : dtos) {
            if (dto.scenarioId() == null || dto.routineId() == null) {
                continue;
            }
            toSave.add(ProcBehaviourCaptureEntity.builder()
                .sessionId(sessionId)
                .scenarioId(dto.scenarioId())
                .routineId(dto.routineId())
                .attemptNumber(dto.attemptNumber() == null ? 1 : dto.attemptNumber())
                .envelopeJson(dto.envelopeJson() == null ? new LinkedHashMap<>() : dto.envelopeJson())
                .stateDeltaJson(dto.stateDeltaJson())
                .volatileCellsJson(dto.volatileCellsJson())
                .bracketOutcome(dto.bracketOutcome())
                .durationMs(dto.durationMs())
                .errorType(dto.errorType())
                .errorMessage(dto.errorMessage())
                .accepted(Boolean.TRUE.equals(dto.accepted()))
                .build());
        }
        List<ProcBehaviourCaptureEntity> saved = captureRepository.saveAll(toSave);
        log.info("[diag-ams] op=proc_behaviour_captures_insert session={} inserted={}",
            shortId(sessionId), saved.size());
        return saved;
    }

    @Transactional(readOnly = true)
    public List<ProcBehaviourCaptureEntity> listCaptures(UUID sessionId, UUID scenarioId) {
        return scenarioId == null
            ? captureRepository.findBySessionId(sessionId)
            : captureRepository.findByScenarioId(scenarioId);
    }

    // ------------------------------------------------------------------
    // Diagnostics
    // ------------------------------------------------------------------

    @Transactional
    public List<ProcBehaviourDiagnosticEntity> insertDiagnostics(
            UUID sessionId, InsertProcDiagnosticsRequest request) {
        List<ProcDiagnosticDto> dtos = request == null || request.diagnostics() == null
            ? List.of() : request.diagnostics();
        List<ProcBehaviourDiagnosticEntity> toSave = new ArrayList<>();
        for (ProcDiagnosticDto dto : dtos) {
            String type = dto.diagnosticType() == null
                ? "" : dto.diagnosticType().trim().toLowerCase(Locale.ROOT);
            if (!ProcBehaviourDiagnosticEntity.TYPES.contains(type)) {
                throw new IllegalArgumentException("unknown diagnostic_type: " + dto.diagnosticType());
            }
            toSave.add(ProcBehaviourDiagnosticEntity.builder()
                .sessionId(sessionId)
                .routineId(dto.routineId())
                .diagnosticType(type)
                .message(dto.message())
                .detailJson(dto.detailJson())
                .build());
        }
        return diagnosticRepository.saveAll(toSave);
    }

    @Transactional(readOnly = true)
    public List<ProcBehaviourDiagnosticEntity> listDiagnostics(UUID sessionId) {
        return diagnosticRepository.findBySessionId(sessionId);
    }

    // ------------------------------------------------------------------
    // Baselines
    // ------------------------------------------------------------------

    @Transactional
    public ProcBehaviourBaselineEntity createBaseline(
            UUID projectId, UUID architectureId, CreateProcBaselineRequest request) {
        if (request == null || request.name() == null || request.name().isBlank()) {
            throw new IllegalArgumentException("name is required");
        }
        List<ProcBaselineItemDto> items = request.items() == null ? List.of() : request.items();
        Set<UUID> routines = new LinkedHashSet<>();
        for (ProcBaselineItemDto item : items) {
            if (item.routineId() != null) {
                routines.add(item.routineId());
            }
        }
        ProcBehaviourBaselineEntity baseline = ProcBehaviourBaselineEntity.builder()
            .sessionId(request.sessionId())
            .projectId(projectId)
            .architectureId(architectureId)
            .name(request.name().trim())
            .status(ProcBehaviourBaselineEntity.STATUS_DRAFT)
            .kind(normaliseKind(request.kind()))
            .s0FingerprintJson(request.s0FingerprintJson())
            .contentHash(computeContentHash(items))
            .routineCount(routines.size())
            .scenarioCount(items.size())
            .build();
        ProcBehaviourBaselineEntity saved = baselineRepository.save(baseline);

        List<ProcBehaviourBaselineItemEntity> itemEntities = new ArrayList<>();
        for (ProcBaselineItemDto dto : items) {
            itemEntities.add(ProcBehaviourBaselineItemEntity.builder()
                .baselineId(saved.getId())
                .routineId(dto.routineId())
                .routineBodyHash(dto.routineBodyHash())
                .scenarioId(dto.scenarioId())
                .scenarioName(dto.scenarioName())
                .scenarioType(dto.scenarioType())
                .exitOutcome(dto.exitOutcome())
                .inputsJson(dto.inputsJson() == null ? new ArrayList<>() : new ArrayList<>(dto.inputsJson()))
                .sequenceJson(dto.sequenceJson())
                .expectedEnvelopeJson(dto.expectedEnvelopeJson() == null
                    ? new LinkedHashMap<>() : dto.expectedEnvelopeJson())
                .stateDeltaJson(dto.stateDeltaJson())
                .volatileCellsJson(dto.volatileCellsJson())
                .businessNotes(dto.businessNotes())
                .build());
        }
        baselineItemRepository.saveAll(itemEntities);
        log.info("[diag-ams] op=proc_behaviour_baseline_create arch={} routines={} scenarios={} hash={}",
            shortId(architectureId), saved.getRoutineCount(), saved.getScenarioCount(),
            saved.getContentHash() == null ? "-" : saved.getContentHash().substring(0, 12));
        return saved;
    }

    @Transactional(readOnly = true)
    public List<ProcBehaviourBaselineEntity> listBaselines(UUID architectureId) {
        return baselineRepository.findByArchitectureIdOrderByCreatedAtDesc(architectureId);
    }

    @Transactional(readOnly = true)
    public Optional<ProcBehaviourBaselineEntity> getBaseline(UUID architectureId, UUID baselineId) {
        return baselineRepository.findById(baselineId)
            .filter(b -> architectureId == null || architectureId.equals(b.getArchitectureId()));
    }

    @Transactional(readOnly = true)
    public Optional<ProcBehaviourBaselineEntity> getPinnedBaseline(UUID architectureId, String kind) {
        return baselineRepository.findFirstByArchitectureIdAndKindAndStatus(
            architectureId, normaliseKind(kind), ProcBehaviourBaselineEntity.STATUS_PINNED);
    }

    @Transactional(readOnly = true)
    public List<ProcBehaviourBaselineItemEntity> listBaselineItems(UUID baselineId, UUID routineId) {
        return routineId == null
            ? baselineItemRepository.findByBaselineId(baselineId)
            : baselineItemRepository.findByBaselineIdAndRoutineId(baselineId, routineId);
    }

    /**
     * Pin a baseline. ONE pinned per (architecture, kind): every OTHER pinned
     * baseline of the SAME architecture and SAME kind is superseded; the other
     * kind is untouched.
     */
    @Transactional
    public ProcBehaviourBaselineEntity pin(UUID architectureId, UUID baselineId) {
        ProcBehaviourBaselineEntity baseline = getBaseline(architectureId, baselineId)
            .orElseThrow(() -> new IllegalArgumentException("baseline not found: " + baselineId));

        List<ProcBehaviourBaselineEntity> superseded = new ArrayList<>();
        for (ProcBehaviourBaselineEntity other
                : baselineRepository.findByArchitectureIdOrderByCreatedAtDesc(baseline.getArchitectureId())) {
            if (other.getId() != null && other.getId().equals(baseline.getId())) {
                continue;
            }
            if (ProcBehaviourBaselineEntity.STATUS_PINNED.equals(other.getStatus())
                && java.util.Objects.equals(other.getKind(), baseline.getKind())) {
                other.setStatus(ProcBehaviourBaselineEntity.STATUS_SUPERSEDED);
                superseded.add(other);
            }
        }
        if (!superseded.isEmpty()) {
            baselineRepository.saveAll(superseded);
        }

        baseline.setStatus(ProcBehaviourBaselineEntity.STATUS_PINNED);
        baseline.setPinnedAt(Instant.now());
        ProcBehaviourBaselineEntity saved = baselineRepository.save(baseline);
        log.info("[diag-ams] op=proc_behaviour_baseline_pin baseline={} kind={} superseded={}",
            shortId(baselineId), baseline.getKind(), superseded.size());
        return saved;
    }

    /**
     * Drift (Spec 5): apply {@link #markItemsStale(UUID, Map)} to EVERY pinned
     * baseline of the architecture (one per kind) after a re-scan changed the
     * given routines' bodies. A signal for the baseline / workbench screens,
     * never a lock.
     *
     * @return items flipped to stale across the pinned baselines
     */
    @Transactional
    public int markItemsStaleForArchitecture(UUID architectureId, Map<String, String> currentBodyHashes) {
        if (architectureId == null || currentBodyHashes == null || currentBodyHashes.isEmpty()) {
            return 0;
        }
        int total = 0;
        for (ProcBehaviourBaselineEntity baseline : baselineRepository.findByArchitectureIdOrderByCreatedAtDesc(architectureId)) {
            if (!ProcBehaviourBaselineEntity.STATUS_PINNED.equals(baseline.getStatus())) {
                continue;
            }
            total += markItemsStale(baseline.getId(), currentBodyHashes);
        }
        return total;
    }

    /**
     * Mark baseline items stale where the routine body has moved on. Only
     * routines named in {@code currentBodyHashes} are considered -- an absent
     * routine is "no information", not "unchanged".
     *
     * @return how many items were flipped to stale by this call
     */
    @Transactional
    public int markItemsStale(UUID baselineId, Map<String, String> currentBodyHashes) {
        if (currentBodyHashes == null || currentBodyHashes.isEmpty()) {
            return 0;
        }
        Map<String, String> byRoutine = new HashMap<>();
        currentBodyHashes.forEach((routineId, hash) -> {
            if (routineId != null) {
                byRoutine.put(routineId.trim().toLowerCase(Locale.ROOT), hash);
            }
        });
        List<ProcBehaviourBaselineItemEntity> changed = new ArrayList<>();
        for (ProcBehaviourBaselineItemEntity item : baselineItemRepository.findByBaselineId(baselineId)) {
            if (item.getRoutineId() == null) {
                continue;
            }
            String key = item.getRoutineId().toString().toLowerCase(Locale.ROOT);
            if (!byRoutine.containsKey(key)) {
                continue;
            }
            String current = byRoutine.get(key);
            if (java.util.Objects.equals(current, item.getRoutineBodyHash())) {
                continue;
            }
            if (item.isStale()
                && ProcBehaviourBaselineItemEntity.STALE_REASON_BODY_CHANGED.equals(item.getStaleReason())) {
                continue;
            }
            item.setStale(true);
            item.setStaleReason(ProcBehaviourBaselineItemEntity.STALE_REASON_BODY_CHANGED);
            changed.add(item);
        }
        if (!changed.isEmpty()) {
            baselineItemRepository.saveAll(changed);
        }
        log.info("[diag-ams] op=proc_behaviour_items_stale baseline={} marked={}",
            shortId(baselineId), changed.size());
        return changed.size();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /**
     * SHA-256 over the SORTED {@code routine_id|scenario_name|envelope} lines.
     * Sorting makes the hash order-independent; the canonical serialiser makes
     * it key-order-independent.
     */
    static String computeContentHash(List<ProcBaselineItemDto> items) {
        List<String> lines = new ArrayList<>();
        for (ProcBaselineItemDto item : items) {
            lines.add((item.routineId() == null ? "" : item.routineId().toString())
                + "|" + (item.scenarioName() == null ? "" : item.scenarioName())
                + "|" + canonicalJson(item.expectedEnvelopeJson()));
        }
        lines.sort(Comparator.naturalOrder());
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(String.join("\n", lines).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static String canonicalJson(Map<String, Object> value) {
        if (value == null || value.isEmpty()) {
            return "{}";
        }
        try {
            return CANONICAL_JSON.writeValueAsString(new TreeMap<>(value));
        } catch (JsonProcessingException e) {
            // Never fail a save over an unserialisable envelope -- degrade to a
            // stable textual form and let the hash reflect that, loudly.
            log.warn("[diag-ams] op=proc_behaviour_hash_fallback reason={}", e.getMessage());
            return new TreeMap<>(value).toString();
        }
    }

    private static String normaliseKind(String kind) {
        if (kind == null || kind.isBlank()) {
            return ProcBehaviourCaptureSessionEntity.KIND_CURRENT;
        }
        String normalised = kind.trim().toLowerCase(Locale.ROOT);
        if (!KINDS.contains(normalised)) {
            throw new IllegalArgumentException("unknown kind: " + kind);
        }
        return normalised;
    }

    private static String shortId(UUID id) {
        return id == null ? "-" : id.toString().substring(0, 8);
    }
}
