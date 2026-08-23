package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.DiscoveryOrphanSummaryDto;
import com.example.architecturemodel.model.dto.DiscoveryRunDto;
import com.example.architecturemodel.model.dto.discovery.LogFileMetaDto;
import com.example.architecturemodel.model.dto.discovery.ContractFilesPatchRequest;
import com.example.architecturemodel.model.dto.discovery.LogFilesPatchRequest;
import com.example.architecturemodel.model.entity.DiscoveryConfigEntity;
import com.example.architecturemodel.model.entity.DiscoveryRunEntity;
import com.example.architecturemodel.repository.discovery.DiscoveryCapabilityRepository;
import com.example.architecturemodel.repository.entity.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Service for managing discovery runs.
 *
 * Provides create, retrieve, and update operations for Phase 1 discovery runs.
 * Enforces the active-run constraint (only one PENDING or RUNNING run per project)
 * at the service layer. Snapshots the Phase 0 discovery config at run creation
 * time for immutability and reproducibility.
 *
 * Extended with orphan detection and cleanup operations for data hygiene.
 *
 * Spec: Discovery Run Model and Orchestration (Increment 5)
 * Task Group 2: Entity, DTO, Repository, Service, Controller
 *
 * Extended: Discovery Refinement (Increment 16)
 * Task Group 4: Orphan Detection and Cleanup Endpoints
 *
 * Extended: V3 Discovery Pipeline Foundation
 * - Adds support for reading/writing the `mode` column (A/B/C tier) on runs.
 *
 * Extended: V3 Tier UX
 * - Adds create-time inputs for `mode`, `warnings` (JSON-encoded string[]), and
 *   `confirmedLlmSolo` (explicit Tier C opt-in).
 * - Extends `updateRun` to accept `warnings` so the discovery-service gate can
 *   overwrite them on the proceed-after-gate flow without touching
 *   `confirmedLlmSolo` (which is create-only by design).
 * - `toDto` exposes the derived `tier` field (same value as `mode`).
 *
 * Extended: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 * - createRun now accepts {@code architectureId} from the URL path and persists
 *   it on the new {@link DiscoveryRunEntity}; the binding is permanent for the
 *   run's lifetime.
 * - getRunsByProjectAndArchitecture filters by both project and architecture so
 *   cross-architecture runs are hidden from the URL-filtered run list (safety
 *   property (c)).
 * - getRunInArchitecture / updateRunInArchitecture verify the run belongs to
 *   the requested architecture before returning / updating; mismatches yield
 *   404 (cross-architecture leakage prevention).
 * - Update paths NEVER mutate {@code architectureId} -- run-architecture
 *   binding is permanent.
 *
 * Extended: Runtime Log Input at Discovery Run Start (Spec 2026-05-10)
 * - Adds {@link #patchLogFileArtifacts} to merge runtime-log file metadata
 *   entries into {@code config_snapshot.inputArtifacts.logFiles[]} on the
 *   discovery run. Idempotent on {@code artifactId} (re-PATCH replaces the
 *   entry, does not duplicate-append). {@code attemptedCount} is updated via
 *   {@code max(existing, incoming)} so a partial-failure state cannot be
 *   silently lowered by a follow-up PATCH.
 *
 * Extended: Oracle Integrity & Determinism (2026-05-30) -- Task Group 1
 * - Adds the advisory {@code degraded} (boxed Boolean) + {@code degradedReasons}
 *   (JSON-encoded string[]) run-integrity signal, mirroring the {@code warnings}
 *   field. {@code toDto} surfaces both fields. {@code updateRun} /
 *   {@code updateRunInArchitecture} gain a widest overload accepting both so the
 *   discovery-service can persist the signal alongside the COMPLETED transition.
 *   The update applies a NON-CLOBBER null-guard (a PATCH carrying null leaves the
 *   stored value unchanged) -- identical to the {@code warnings} semantics and
 *   required because the field is a boxed Boolean (a null PATCH must not wipe a
 *   previously-set flag). The flag rides ALONGSIDE {@code COMPLETED}; it is NOT a
 *   new terminal status and the discovery-service state machine is untouched.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DiscoveryRunService {

    private final DiscoveryRunRepository runRepository;
    private final DiscoveryConfigRepository configRepository;
    private final DiscoveryEvidenceRepository evidenceRepository;
    private final DiscoveryCandidateRepository candidateRepository;
    private final DiscoveryRelationshipRepository relationshipRepository;
    private final DiscoveryClusterRepository clusterRepository;
    private final DiscoveryDecisionTaskRepository decisionTaskRepository;
    // discovery_capability carries a SOFT run_id (nullable, NO foreign key), so
    // it is the ONE child table that does not ride the DB ON DELETE CASCADE
    // chain off discovery_run(id). A full run delete must remove its rows
    // explicitly (its members cascade via their capability_id FK).
    private final DiscoveryCapabilityRepository capabilityRepository;

    private static final Set<String> ALLOWED_STATUSES = Set.of(
        "PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"
    );

    /**
     * Allowed values for {@code discovery_kind}. 'combined' is reserved for a
     * future spec and accepted by the validator but not emitted by any v1
     * producer path. Spec: Database Discovery Packs (2026-05-16) -- Task Group 1.
     */
    private static final Set<String> ALLOWED_DISCOVERY_KINDS = Set.of(
        "code", "database", "combined"
    );

    private static final String DEFAULT_DISCOVERY_KIND = "code";

    private static final List<String> STALE_RUN_STATUSES = List.of("FAILED", "CANCELLED");

    /**
     * Create a new discovery run for a project, bound to the given architecture
     * for life. Convenience overload with no service / V3 metadata.
     *
     * Spec: Discovery Service architectureId Integration (Spec #4).
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID this run is bound to for life
     * @return the created discovery run DTO
     * @throws IllegalStateException if an active run already exists
     * @throws IllegalArgumentException if config is missing or not COMPLETE
     */
    @Transactional
    public DiscoveryRunDto createRun(UUID projectId, UUID architectureId) {
        return createRun(projectId, architectureId, null, null, null, false);
    }

    /**
     * Create a new discovery run for a project, optionally scoped to a service,
     * bound to the given architecture for life.
     *
     * Spec: Discovery Service architectureId Integration (Spec #4).
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID this run is bound to for life
     * @param serviceId the optional service UUID for service-scoped runs (may be null)
     * @return the created discovery run DTO
     * @throws IllegalStateException if an active run already exists
     * @throws IllegalArgumentException if config is missing or not COMPLETE
     */
    @Transactional
    public DiscoveryRunDto createRun(UUID projectId, UUID architectureId, String serviceId) {
        return createRun(projectId, architectureId, serviceId, null, null, false);
    }

    /**
     * Create a new discovery run for a project bound to the given architecture
     * for life, optionally scoped to a service and with V3 tier metadata
     * pre-computed at the discovery-service gate.
     *
     * Validates that:
     * 1. {@code architectureId} is provided (non-null) -- the controller layer
     *    cannot reach this method without it because the path segment is
     *    mandatory; this is a defence-in-depth assertion.
     * 2. No active run (PENDING or RUNNING) exists for the project
     * 3. For project-scoped runs only: a discovery config exists for the project
     *    with status COMPLETE. Service-scoped runs (serviceId != null) skip this
     *    check -- the service row + its parent application/component carry all
     *    inputs the pipeline needs, so Phase 0 is redundant.
     *
     * Snapshots the config payload into the run's configSnapshot field. For
     * service-scoped runs with no config, an empty map is used.
     *
     * Persists (no server-side re-validation -- the discovery-service gate is
     * the single source of truth for the Tier C opt-in):
     *   - {@code architectureId}: the bound architecture (REQUIRED, never mutated again)
     *   - {@code mode}: 'A', 'B', 'C', or null
     *   - {@code warnings}: JSON-encoded string[] (passed through verbatim)
     *   - {@code confirmedLlmSolo}: TRUE only when tier C proceeded via opt-in
     *
     * Spec: V3 Tier UX.
     * Spec: Discovery Service architectureId Integration (Spec #4).
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID this run is bound to for life
     * @param serviceId the optional service UUID for service-scoped runs (may be null)
     * @param mode the V3 tier ('A', 'B', 'C', or null) -- optional
     * @param warnings JSON-encoded string[] of tier warnings -- optional
     * @param confirmedLlmSolo explicit Tier C opt-in flag (defaults to false)
     * @return the created discovery run DTO
     * @throws IllegalStateException if an active run already exists
     * @throws IllegalArgumentException if config is missing/not COMPLETE, or if
     *         architectureId is null
     */
    @Transactional
    public DiscoveryRunDto createRun(UUID projectId, UUID architectureId, String serviceId,
                                     String mode, String warnings,
                                     boolean confirmedLlmSolo) {
        return createRun(projectId, architectureId, serviceId, mode, warnings,
            confirmedLlmSolo, null);
    }

    /**
     * Seven-arg overload accepting an optional service-identity snapshot. The
     * snapshot is captured by the discovery-service route at run-create time
     * (only on the service-scoped branch where the service entity was already
     * fetched for tier computation) and persisted here into
     * {@code config_snapshot.serviceIdentitySnapshot} atomic with the run
     * row insert. Null on library-scoped / project-scoped runs and on legacy
     * callers using the 6-arg overload (which delegates here with null).
     *
     * Spec: 2026-05-11 Discovery Run Robustness -- Section 2.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID this run is bound to for life
     * @param serviceId the optional service UUID for service-scoped runs (may be null)
     * @param mode the V3 tier ('A', 'B', 'C', or null) -- optional
     * @param warnings JSON-encoded string[] of tier warnings -- optional
     * @param confirmedLlmSolo explicit Tier C opt-in flag (defaults to false)
     * @param serviceIdentitySnapshot six identifier-ish service fields (may be null)
     * @return the created discovery run DTO
     */
    @Transactional
    public DiscoveryRunDto createRun(UUID projectId, UUID architectureId, String serviceId,
                                     String mode, String warnings,
                                     boolean confirmedLlmSolo,
                                     Map<String, Object> serviceIdentitySnapshot) {
        // Default to 'code' for back-compat: existing callers (discovery-service
        // V3 gate, controller paths that pre-date the database packs spec) do not
        // supply a kind, and the historical behaviour was 100% code runs.
        // Spec: Database Discovery Packs (2026-05-16) -- Task Group 1.
        return createRun(projectId, architectureId, serviceId, mode, warnings,
            confirmedLlmSolo, serviceIdentitySnapshot, null);
    }

    /**
     * Widest createRun overload. Accepts the discovery-kind discriminator
     * ('code' | 'database' | 'combined'). Null is normalised to the default
     * 'code' so existing callers that pre-date the database packs spec keep
     * producing code runs.
     *
     * Note: the advisory {@code degraded} signal (Oracle Integrity &
     * Determinism, 2026-05-30) is NOT a create-time input -- it is computed by
     * the discovery-service pipeline at the COMPLETED transition and persisted
     * via the update path. A freshly created run therefore has a null
     * {@code degraded} flag and null {@code degraded_reasons}, which is valid
     * (the columns are nullable with no backfill).
     *
     * Spec: Database Discovery Packs (Sybase + PostgreSQL) (2026-05-16) --
     * Task Group 1.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID this run is bound to for life
     * @param serviceId the optional service UUID for service-scoped runs (may be null)
     * @param mode the V3 tier ('A', 'B', 'C', or null) -- optional
     * @param warnings JSON-encoded string[] of tier warnings -- optional
     * @param confirmedLlmSolo explicit Tier C opt-in flag (defaults to false)
     * @param serviceIdentitySnapshot six identifier-ish service fields (may be null)
     * @param discoveryKind 'code' | 'database' | 'combined'; null defaults to 'code'
     * @return the created discovery run DTO
     * @throws IllegalArgumentException if discoveryKind is not in the allowed set
     */
    @Transactional
    public DiscoveryRunDto createRun(UUID projectId, UUID architectureId, String serviceId,
                                     String mode, String warnings,
                                     boolean confirmedLlmSolo,
                                     Map<String, Object> serviceIdentitySnapshot,
                                     String discoveryKind) {
        // Normalise and validate discoveryKind BEFORE any side-effecting checks
        // (active-run check, config lookup) so a bad-input request fails fast
        // with a clear 400-mapped IllegalArgumentException.
        String resolvedKind = (discoveryKind == null || discoveryKind.isBlank())
            ? DEFAULT_DISCOVERY_KIND
            : discoveryKind;
        validateDiscoveryKind(resolvedKind);

        log.debug("Creating discovery run for project: {}, architecture: {}, serviceId: {}, mode: {}, "
            + "confirmedLlmSolo: {}, snapshotPresent: {}, discoveryKind: {}",
            projectId, architectureId, serviceId, mode, confirmedLlmSolo,
            serviceIdentitySnapshot != null, resolvedKind);

        // Defence-in-depth: spec #4 forbids null architectureId on every Discovery
        // entry point. Controllers cannot reach this method without the path
        // segment (would be NoHandlerFoundException -> 404), but a future caller
        // wiring a service-to-service flow could miss this constraint.
        if (architectureId == null) {
            throw new IllegalArgumentException(
                "architectureId is required for every discovery run (spec #4: one run -> one architecture for life)"
            );
        }

        // Check for active runs
        List<DiscoveryRunEntity> activeRuns = runRepository.findByProjectIdAndStatusIn(
            projectId, List.of("PENDING", "RUNNING")
        );
        if (!activeRuns.isEmpty()) {
            throw new IllegalStateException("Active run already exists for project: " + projectId);
        }

        // Fetch and validate discovery config.
        // Service-scoped runs (serviceId != null) do NOT require Phase 0 config:
        // the service row + its parent application/component carry everything the
        // pipeline needs (repo, subfolder, resolved language/framework packs).
        // Project-scoped CODE runs still require a COMPLETE config.
        // Database runs (discoveryKind='database') are project-scoped but their
        // connection details ride the discovery-service request body, so the
        // Phase 0 config check is skipped for them too.
        Optional<DiscoveryConfigEntity> configOpt = configRepository.findByProjectId(projectId);
        Map<String, Object> snapshotPayload;
        if (serviceId == null && !"database".equals(resolvedKind)) {
            if (configOpt.isEmpty()) {
                throw new IllegalArgumentException("Discovery config not found for project: " + projectId);
            }
            DiscoveryConfigEntity config = configOpt.get();
            if (!"COMPLETE".equals(config.getStatus())) {
                throw new IllegalArgumentException(
                    "Discovery config is not COMPLETE for project: " + projectId
                    + ". Current status: " + config.getStatus()
                );
            }
            snapshotPayload = new HashMap<>(config.getConfigPayload());
        } else {
            // Service-scoped or database runs: snapshot whatever config exists
            // (informational), else empty.
            snapshotPayload = configOpt
                .map(c -> new HashMap<>(c.getConfigPayload()))
                .orElseGet(HashMap::new);
        }

        // Inject the service identity snapshot atomic with the run insert so a
        // later service-deletion (which nulls the service_id FK via the
        // ON DELETE SET NULL action from Liquibase changeset 126) still leaves
        // the orphaned run with enough identity to render the original service
        // name on the UI. Only persisted when the caller supplied a snapshot
        // (service-scoped runs only, see DiscoveryRunController).
        // Spec: 2026-05-11 Discovery Run Robustness -- Section 2.
        if (serviceIdentitySnapshot != null && !serviceIdentitySnapshot.isEmpty()) {
            snapshotPayload.put("serviceIdentitySnapshot", serviceIdentitySnapshot);
        }

        // Build and save the run entity with config snapshot AND bound architecture
        DiscoveryRunEntity entity = DiscoveryRunEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .serviceId(serviceId)
            .mode(mode)
            .warnings(warnings)
            .confirmedLlmSolo(confirmedLlmSolo)
            // Spec: Database Discovery Packs (2026-05-16) -- TG1.
            .discoveryKind(resolvedKind)
            .configSnapshot(snapshotPayload)
            .build();

        DiscoveryRunEntity saved = runRepository.save(entity);
        log.debug("Created discovery run with id: {} bound to architecture: {}",
            saved.getId(), saved.getArchitectureId());

        return toDto(saved);
    }

    /**
     * Get a discovery run by its ID.
     *
     * Note: this overload performs no architecture-scoping check. Prefer
     * {@link #getRunInArchitecture(UUID, UUID, UUID)} for any path that comes
     * through the architecture-scoped controller.
     *
     * @param runId the run UUID
     * @return the discovery run DTO, or null if not found
     */
    @Transactional(readOnly = true)
    public DiscoveryRunDto getRun(UUID runId) {
        log.debug("Getting discovery run: {}", runId);

        return runRepository.findById(runId)
            .map(this::toDto)
            .orElse(null);
    }

    /**
     * Get a discovery run by its ID, scoped to a specific (project, architecture)
     * pair. Returns null if the run does not exist OR if it exists but is bound
     * to a different architecture or project.
     *
     * Spec: Discovery Service architectureId Integration (Spec #4) -- prevents
     * cross-architecture leakage on GET /runs/{runId}.
     *
     * @param runId the run UUID
     * @param projectId the project UUID from the URL path
     * @param architectureId the architecture UUID from the URL path
     * @return the discovery run DTO, or null if not found in the scope
     */
    @Transactional(readOnly = true)
    public DiscoveryRunDto getRunInArchitecture(UUID runId, UUID projectId, UUID architectureId) {
        log.debug("Getting discovery run: {} scoped to project: {}, architecture: {}",
            runId, projectId, architectureId);

        return runRepository.findById(runId)
            .filter(e -> projectId.equals(e.getProjectId()))
            .filter(e -> architectureId.equals(e.getArchitectureId()))
            .map(this::toDto)
            .orElse(null);
    }

    /**
     * Delete a discovery run and ALL of its child data, scoped to the given
     * (project, architecture). Used by the Discovery Runs UI's right-click
     * "Delete" action so a user can clean up test/iteration runs without
     * starting a fresh project.
     *
     * <p>Scoping mirrors {@link #getRunInArchitecture}: the run is only removed
     * when it belongs to BOTH the URL's {@code projectId} and
     * {@code architectureId}. A run that does not exist, or that belongs to a
     * different project/architecture, yields {@code false} so the controller can
     * surface a 404 (no cross-architecture deletes).
     *
     * <p>Cascade: every HARD child of a run -- candidates, evidence,
     * relationships, clusters (+ members), decision tasks, candidate-entity
     * mappings, findings (+ links) -- carries a DB-level {@code ON DELETE
     * CASCADE} foreign key to {@code discovery_run(id)}, so a single
     * {@code runRepository.deleteById} removes them atomically in this
     * transaction (the same mechanism {@link #cleanupOrphanedData} relies on).
     * The ONE exception is {@code discovery_capability}, whose {@code run_id} is
     * a soft, FK-less reference; its rows (and their members, which DO cascade
     * off {@code capability_id}) are removed explicitly FIRST so the delete does
     * not leave them orphaned.
     *
     * <p>NOTE: any runtime-log files the gateway wrote to disk under
     * {@code {projectFolder}/discovery-runs/{runId}/logs/} are not this
     * service's concern -- AMS only ever stored their metadata. Disk cleanup, if
     * desired, is the gateway's responsibility.
     *
     * @param runId the run UUID to delete
     * @param projectId the project UUID from the URL path (scoping)
     * @param architectureId the architecture UUID from the URL path (scoping)
     * @return {@code true} if a matching run was found and deleted; {@code false}
     *         if no run matched the (runId, projectId, architectureId) scope
     */
    @Transactional
    public boolean deleteRunInArchitecture(UUID runId, UUID projectId, UUID architectureId) {
        log.debug("Deleting discovery run: {} scoped to project: {}, architecture: {}",
            runId, projectId, architectureId);

        DiscoveryRunEntity run = runRepository.findById(runId)
            .filter(e -> projectId.equals(e.getProjectId()))
            .filter(e -> architectureId.equals(e.getArchitectureId()))
            .orElse(null);
        if (run == null) {
            return false;
        }

        // (1) Remove the FK-less capability rows first (members cascade via
        // their capability_id FK) -- otherwise they'd be orphaned by the run
        // delete below.
        capabilityRepository.deleteByRunId(runId);

        // (2) Delete the run row; the DB ON DELETE CASCADE chain removes every
        // hard child (candidates / evidence / relationships / clusters /
        // decision tasks / findings / mappings) in the same transaction.
        runRepository.deleteById(runId);

        log.info("Deleted discovery run {} (project {}, architecture {}) and its child data",
            runId, projectId, architectureId);
        return true;
    }

    /**
     * Get all discovery runs for a project, ordered by creation time descending.
     *
     * Note: this overload returns runs for ALL architectures in the project.
     * Prefer {@link #getRunsByProjectAndArchitecture(UUID, UUID)} for any path
     * that comes through the architecture-scoped controller.
     *
     * @param projectId the project UUID
     * @return list of discovery run DTOs
     */
    @Transactional(readOnly = true)
    public List<DiscoveryRunDto> getRunsByProject(UUID projectId) {
        log.debug("Getting discovery runs for project: {}", projectId);

        return runRepository.findByProjectIdOrderByCreatedAtDesc(projectId)
            .stream()
            .map(this::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Get all discovery runs for a (project, architecture) pair, ordered by
     * creation time descending. Runs targeting other architectures within the
     * same project are excluded.
     *
     * Spec: Discovery Service architectureId Integration (Spec #4) -- safety
     * property (c). Cross-architecture runs are hidden.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID to filter by
     * @return list of discovery run DTOs for the pair
     */
    @Transactional(readOnly = true)
    public List<DiscoveryRunDto> getRunsByProjectAndArchitecture(UUID projectId, UUID architectureId) {
        log.debug("Getting discovery runs for project: {}, architecture: {}",
            projectId, architectureId);

        return runRepository.findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(
                projectId, architectureId)
            .stream()
            .map(this::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Get discovery runs for a (project, architecture) pair filtered by source
     * kind, ordered by creation time descending. Used when the unified Discovery
     * Runs list UI sends a {@code ?discovery_kind=...} query parameter.
     *
     * When {@code discoveryKind} is null or blank, behaves identically to
     * {@link #getRunsByProjectAndArchitecture(UUID, UUID)} (no kind filter).
     *
     * Spec: Database Discovery Packs (Sybase + PostgreSQL) (2026-05-16) --
     * Task Group 1.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID to filter by
     * @param discoveryKind 'code' | 'database' | 'combined' (null/blank = no filter)
     * @return list of discovery run DTOs matching all filters, newest first
     * @throws IllegalArgumentException if discoveryKind is non-blank but not in the allowed set
     */
    @Transactional(readOnly = true)
    public List<DiscoveryRunDto> getRunsByProjectAndArchitectureAndKind(
            UUID projectId, UUID architectureId, String discoveryKind) {
        log.debug("Getting discovery runs for project: {}, architecture: {}, kind: {}",
            projectId, architectureId, discoveryKind);

        if (discoveryKind == null || discoveryKind.isBlank()) {
            return getRunsByProjectAndArchitecture(projectId, architectureId);
        }
        // Validate the filter value -- a malformed kind comes from a client bug
        // and should surface as 400, not silently return an empty list.
        validateDiscoveryKind(discoveryKind);

        return runRepository
            .findByProjectIdAndArchitectureIdAndDiscoveryKindOrderByCreatedAtDesc(
                projectId, architectureId, discoveryKind)
            .stream()
            .map(this::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Update a discovery run's status, current step, steps payload, and error message.
     *
     * Backward-compatible overload (no architecture scoping). Prefer
     * {@link #updateRunInArchitecture} for paths that come through the
     * architecture-scoped controller.
     *
     * @param runId the run UUID
     * @param status the new status (must be one of ALLOWED_STATUSES)
     * @param currentStep the current step being executed
     * @param stepsPayload the updated per-step status payload
     * @param errorMessage error details if the run failed
     * @return the updated discovery run DTO
     * @throws NoSuchElementException if the run is not found
     * @throws IllegalArgumentException if the status is not valid
     */
    @Transactional
    public DiscoveryRunDto updateRun(UUID runId, String status, String currentStep,
                                     Map<String, Object> stepsPayload, String errorMessage) {
        return updateRun(runId, status, currentStep, stepsPayload, errorMessage, null, null);
    }

    /**
     * Update a discovery run's status, current step, steps payload, error message,
     * and optionally the V3 pipeline tier (mode).
     *
     * Spec: V3 Discovery Pipeline Foundation.
     *
     * @param runId the run UUID
     * @param status the new status (must be one of ALLOWED_STATUSES)
     * @param currentStep the current step being executed
     * @param stepsPayload the updated per-step status payload
     * @param errorMessage error details if the run failed
     * @param mode optional V3 tier ("A", "B", "C", or null to leave unchanged)
     * @return the updated discovery run DTO
     * @throws NoSuchElementException if the run is not found
     * @throws IllegalArgumentException if the status is not valid
     */
    @Transactional
    public DiscoveryRunDto updateRun(UUID runId, String status, String currentStep,
                                     Map<String, Object> stepsPayload, String errorMessage,
                                     String mode) {
        return updateRun(runId, status, currentStep, stepsPayload, errorMessage, mode, null);
    }

    /**
     * Update a discovery run with optional V3 tier (mode) and warnings payload.
     *
     * Note: {@code confirmedLlmSolo} is deliberately NOT updatable here -- it is
     * set once at run creation (via the gate-proceed flow) and is never mutated.
     * Note: {@code architectureId} is deliberately NOT updatable here either --
     * run-architecture binding is permanent (spec #4).
     *
     * Spec: V3 Tier UX.
     *
     * @param runId the run UUID
     * @param status the new status (must be one of ALLOWED_STATUSES)
     * @param currentStep the current step being executed
     * @param stepsPayload the updated per-step status payload
     * @param errorMessage error details if the run failed
     * @param mode optional V3 tier ("A", "B", "C", or null to leave unchanged)
     * @param warnings optional JSON-encoded string[] of tier warnings (null to leave unchanged)
     * @return the updated discovery run DTO
     * @throws NoSuchElementException if the run is not found
     * @throws IllegalArgumentException if the status is not valid
     */
    @Transactional
    public DiscoveryRunDto updateRun(UUID runId, String status, String currentStep,
                                     Map<String, Object> stepsPayload, String errorMessage,
                                     String mode, String warnings) {
        return updateRun(runId, status, currentStep, stepsPayload, errorMessage,
            mode, warnings, null, null);
    }

    /**
     * Widest non-scoped update overload. Adds the advisory {@code degraded}
     * (boxed Boolean) + {@code degradedReasons} (JSON-encoded string[]) signal so
     * the discovery-service can persist run-integrity state alongside the
     * COMPLETED transition.
     *
     * Both new fields are NON-CLOBBER: a null incoming value leaves the stored
     * value unchanged (identical to the {@code warnings} semantics). This matters
     * because {@code degraded} is a boxed Boolean -- a null PATCH must NOT wipe a
     * previously-set flag (see project memory primitive_double_dto_overwrite).
     *
     * Note: {@code confirmedLlmSolo} and {@code architectureId} remain
     * non-updatable. The {@code degraded} signal rides ALONGSIDE the status; it
     * is NOT a terminal status and {@code status} validation is unchanged.
     *
     * Spec: Oracle Integrity & Determinism (2026-05-30) -- Task Group 1.
     *
     * @param runId the run UUID
     * @param status the new status (must be one of ALLOWED_STATUSES)
     * @param currentStep the current step being executed
     * @param stepsPayload the updated per-step status payload
     * @param errorMessage error details if the run failed
     * @param mode optional V3 tier ("A", "B", "C", or null to leave unchanged)
     * @param warnings optional JSON-encoded string[] of tier warnings (null to leave unchanged)
     * @param degraded optional advisory degraded flag (null to leave unchanged)
     * @param degradedReasons optional JSON-encoded string[] of degraded reasons (null to leave unchanged)
     * @return the updated discovery run DTO
     * @throws NoSuchElementException if the run is not found
     * @throws IllegalArgumentException if the status is not valid
     */
    @Transactional
    public DiscoveryRunDto updateRun(UUID runId, String status, String currentStep,
                                     Map<String, Object> stepsPayload, String errorMessage,
                                     String mode, String warnings,
                                     Boolean degraded, String degradedReasons) {
        log.debug("Updating discovery run: {}, status: {}, currentStep: {}, mode: {}, "
            + "warnings present: {}, degraded: {}, degradedReasons present: {}",
            runId, status, currentStep, mode, warnings != null, degraded,
            degradedReasons != null);

        DiscoveryRunEntity entity = runRepository.findById(runId)
            .orElseThrow(() -> new NoSuchElementException("Discovery run not found: " + runId));

        applyUpdate(entity, status, currentStep, stepsPayload, errorMessage, mode, warnings,
            degraded, degradedReasons);

        DiscoveryRunEntity saved = runRepository.save(entity);
        log.debug("Updated discovery run: {}", saved.getId());

        return toDto(saved);
    }

    /**
     * Update a discovery run scoped to a specific (project, architecture) pair.
     *
     * Returns null (caller maps to 404) if the run does not exist OR if it
     * exists but is bound to a different architecture or project.
     *
     * Run-architecture binding is permanent: this method does NOT change
     * {@code architectureId} on the entity. The architectureId from the URL is
     * used purely as a scoping check -- it MUST equal the run's stored value
     * for the update to apply.
     *
     * Spec: Discovery Service architectureId Integration (Spec #4) -- run
     * binding immutability.
     *
     * @param runId the run UUID
     * @param projectId the project UUID from the URL path
     * @param architectureId the architecture UUID from the URL path
     * @param status the new status (must be one of ALLOWED_STATUSES)
     * @param currentStep the current step being executed
     * @param stepsPayload the updated per-step status payload
     * @param errorMessage error details if the run failed
     * @param mode optional V3 tier ("A", "B", "C", or null to leave unchanged)
     * @param warnings optional JSON-encoded string[] of tier warnings (null to leave unchanged)
     * @return the updated discovery run DTO
     * @throws NoSuchElementException if the run is not found in the scope
     * @throws IllegalArgumentException if the status is not valid
     */
    @Transactional
    public DiscoveryRunDto updateRunInArchitecture(UUID runId, UUID projectId, UUID architectureId,
                                                   String status, String currentStep,
                                                   Map<String, Object> stepsPayload, String errorMessage,
                                                   String mode, String warnings) {
        return updateRunInArchitecture(runId, projectId, architectureId, status, currentStep,
            stepsPayload, errorMessage, mode, warnings, null, null);
    }

    /**
     * Widest architecture-scoped update overload. Adds the advisory
     * {@code degraded} + {@code degradedReasons} signal (Oracle Integrity &
     * Determinism, 2026-05-30) with the same NON-CLOBBER null-guard as the
     * non-scoped overload. The bound {@code architectureId} is never mutated.
     *
     * Spec: Oracle Integrity & Determinism (2026-05-30) -- Task Group 1.
     *
     * @param runId the run UUID
     * @param projectId the project UUID from the URL path
     * @param architectureId the architecture UUID from the URL path
     * @param status the new status (must be one of ALLOWED_STATUSES)
     * @param currentStep the current step being executed
     * @param stepsPayload the updated per-step status payload
     * @param errorMessage error details if the run failed
     * @param mode optional V3 tier ("A", "B", "C", or null to leave unchanged)
     * @param warnings optional JSON-encoded string[] of tier warnings (null to leave unchanged)
     * @param degraded optional advisory degraded flag (null to leave unchanged)
     * @param degradedReasons optional JSON-encoded string[] of degraded reasons (null to leave unchanged)
     * @return the updated discovery run DTO
     * @throws NoSuchElementException if the run is not found in the scope
     * @throws IllegalArgumentException if the status is not valid
     */
    @Transactional
    public DiscoveryRunDto updateRunInArchitecture(UUID runId, UUID projectId, UUID architectureId,
                                                   String status, String currentStep,
                                                   Map<String, Object> stepsPayload, String errorMessage,
                                                   String mode, String warnings,
                                                   Boolean degraded, String degradedReasons) {
        log.debug("Updating discovery run: {} scoped to project: {}, architecture: {}",
            runId, projectId, architectureId);

        DiscoveryRunEntity entity = runRepository.findById(runId)
            .filter(e -> projectId.equals(e.getProjectId()))
            .filter(e -> architectureId.equals(e.getArchitectureId()))
            .orElseThrow(() -> new NoSuchElementException(
                "Discovery run not found in architecture: runId=" + runId
                    + ", projectId=" + projectId + ", architectureId=" + architectureId));

        // Capture the immutable architectureId for an after-save assertion.
        UUID boundArchitectureBefore = entity.getArchitectureId();

        applyUpdate(entity, status, currentStep, stepsPayload, errorMessage, mode, warnings,
            degraded, degradedReasons);

        DiscoveryRunEntity saved = runRepository.save(entity);

        // Defence-in-depth: assert the bound architecture did not move.
        if (!boundArchitectureBefore.equals(saved.getArchitectureId())) {
            throw new IllegalStateException(
                "BUG: discovery run architectureId mutated during update (was=" + boundArchitectureBefore
                    + ", now=" + saved.getArchitectureId() + "). Run binding is permanent (spec #4).");
        }

        log.debug("Updated discovery run: {} (architecture binding preserved: {})",
            saved.getId(), saved.getArchitectureId());

        return toDto(saved);
    }

    /**
     * Apply update fields to an entity. NEVER touches {@code architectureId} or
     * {@code confirmedLlmSolo} -- both are permanent post-creation.
     *
     * Every field is NON-CLOBBER: a null incoming value leaves the stored value
     * unchanged. This is the established {@code warnings} semantics and is
     * REQUIRED for the boxed {@code degraded} Boolean (a null PATCH must not wipe
     * a previously-set flag -- see project memory primitive_double_dto_overwrite).
     *
     * Spec: Oracle Integrity & Determinism (2026-05-30) -- Task Group 1 adds the
     * {@code degraded} / {@code degradedReasons} parameters.
     */
    private void applyUpdate(DiscoveryRunEntity entity, String status, String currentStep,
                             Map<String, Object> stepsPayload, String errorMessage,
                             String mode, String warnings,
                             Boolean degraded, String degradedReasons) {
        if (status != null) {
            validateStatus(status);
            entity.setStatus(status);
        }

        if (currentStep != null) {
            entity.setCurrentStep(currentStep);
        }

        if (stepsPayload != null) {
            entity.setStepsPayload(stepsPayload);
        }

        if (errorMessage != null) {
            entity.setErrorMessage(errorMessage);
        }

        if (mode != null) {
            entity.setMode(mode);
        }

        if (warnings != null) {
            entity.setWarnings(warnings);
        }

        // Advisory degraded signal (Oracle Integrity & Determinism). NON-CLOBBER:
        // a null incoming value preserves the stored flag. The field is a boxed
        // Boolean precisely so this guard can distinguish "leave unchanged" (null)
        // from an explicit false. The flag rides ALONGSIDE the status -- it is NOT
        // a terminal status and no status transition is implied here.
        if (degraded != null) {
            entity.setDegraded(degraded);
        }

        if (degradedReasons != null) {
            entity.setDegradedReasons(degradedReasons);
        }

        // Note: serviceId, confirmedLlmSolo, and architectureId are preserved as-is
        // (set once at run creation time, not updatable -- spec #4 binding rule for
        // architectureId; existing rule for the other two).
    }

    /**
     * Detect orphaned data for a project.
     *
     * Counts:
     * - Evidence records whose run_id does not exist in discovery_runs
     * - Candidate records whose run_id does not exist in discovery_runs
     * - Relationship records whose run_id does not exist in discovery_runs
     * - Cluster records whose run_id does not exist in discovery_runs
     * - Decision task records whose run_id does not exist in discovery_runs
     * - Stale FAILED/CANCELLED runs older than the given threshold
     *
     * Spec: Discovery Refinement (Increment 16) - Task Group 4
     *
     * @param projectId the project UUID
     * @param staleRunDaysThreshold number of days after which FAILED/CANCELLED runs are stale
     * @return summary DTO with orphan counts
     */
    @Transactional(readOnly = true)
    public DiscoveryOrphanSummaryDto findOrphanedData(UUID projectId, int staleRunDaysThreshold) {
        log.debug("Finding orphaned data for project: {}, staleDays: {}", projectId, staleRunDaysThreshold);

        long orphanedEvidence = evidenceRepository.countAllOrphaned();
        long orphanedCandidates = candidateRepository.countAllOrphaned();
        long orphanedRelationships = relationshipRepository.countAllOrphaned();
        long orphanedClusters = clusterRepository.countAllOrphaned();
        long orphanedDecisionTasks = decisionTaskRepository.countAllOrphaned();

        Instant cutoff = Instant.now().minus(staleRunDaysThreshold, ChronoUnit.DAYS);
        long staleRuns = runRepository.countByProjectIdAndStatusInAndUpdatedAtBefore(
            projectId, STALE_RUN_STATUSES, cutoff
        );

        DiscoveryOrphanSummaryDto summary = new DiscoveryOrphanSummaryDto(
            orphanedEvidence,
            orphanedCandidates,
            orphanedRelationships,
            orphanedClusters,
            orphanedDecisionTasks,
            staleRuns
        );

        log.debug("Orphan detection complete for project {}: {}", projectId, summary);
        return summary;
    }

    /**
     * Clean up orphaned data for a project.
     *
     * Deletes:
     * - Evidence records whose run_id does not exist in discovery_runs
     * - Candidate records whose run_id does not exist in discovery_runs
     * - Relationship records whose run_id does not exist in discovery_runs
     * - Cluster records whose run_id does not exist in discovery_runs
     * - Decision task records whose run_id does not exist in discovery_runs
     * - Stale FAILED/CANCELLED runs older than the given threshold
     *   (cascade deletes their related records)
     *
     * Returns a summary of what was removed.
     *
     * Spec: Discovery Refinement (Increment 16) - Task Group 4
     *
     * @param projectId the project UUID
     * @param staleRunDaysThreshold number of days after which FAILED/CANCELLED runs are stale
     * @return summary DTO with counts of deleted records
     */
    @Transactional
    public DiscoveryOrphanSummaryDto cleanupOrphanedData(UUID projectId, int staleRunDaysThreshold) {
        log.info("Cleaning up orphaned data for project: {}, staleDays: {}", projectId, staleRunDaysThreshold);

        // Delete orphaned records (records whose run_id does not exist)
        int deletedEvidence = evidenceRepository.deleteAllOrphaned();
        int deletedRelationships = relationshipRepository.deleteAllOrphaned();
        int deletedClusters = clusterRepository.deleteAllOrphaned();
        int deletedCandidates = candidateRepository.deleteAllOrphaned();
        int deletedDecisionTasks = decisionTaskRepository.deleteAllOrphaned();

        // Delete stale FAILED/CANCELLED runs for this project
        Instant cutoff = Instant.now().minus(staleRunDaysThreshold, ChronoUnit.DAYS);
        List<DiscoveryRunEntity> staleRuns = runRepository.findByProjectIdAndStatusInAndUpdatedAtBefore(
            projectId, STALE_RUN_STATUSES, cutoff
        );
        int staleRunCount = staleRuns.size();

        if (!staleRuns.isEmpty()) {
            // For each stale run, delete its associated records first, then delete the run
            for (DiscoveryRunEntity staleRun : staleRuns) {
                UUID runId = staleRun.getId();
                log.debug("Deleting stale run {} and its associated records", runId);
            }
            runRepository.deleteAll(staleRuns);
        }

        DiscoveryOrphanSummaryDto summary = new DiscoveryOrphanSummaryDto(
            deletedEvidence,
            deletedCandidates,
            deletedRelationships,
            deletedClusters,
            deletedDecisionTasks,
            staleRunCount
        );

        log.info("Cleanup complete for project {}: {}", projectId, summary);
        return summary;
    }

    /**
     * Merge runtime-log file metadata into a discovery run's
     * {@code config_snapshot.inputArtifacts.logFiles[]} JSONB payload.
     *
     * <p>Behaviour (spec 2026-05-10, Task Group 1):
     * <ol>
     *   <li>Loads the run by ({@code projectId}, {@code architectureId},
     *       {@code runId}); throws {@link ResourceNotFoundException} (mapped to
     *       HTTP 404) if no row matches all three.</li>
     *   <li>Reads {@code config_snapshot}; lazily creates the
     *       {@code inputArtifacts} sub-map and the {@code logFiles} list inside
     *       it when first invoked on a run.</li>
     *   <li>For each incoming {@link LogFileMetaDto}, MERGES into
     *       {@code logFiles[]} keyed on {@code artifactId}: replaces the
     *       existing entry if {@code artifactId} matches, otherwise appends.
     *       Idempotent on {@code artifactId} so a follow-up PATCH with the
     *       same id never duplicates the entry.</li>
     *   <li>Sets {@code inputArtifacts.attemptedCount} to
     *       {@code max(existing or 0, request.attemptedCount())} so a
     *       partial-failure state cannot be silently lowered.</li>
     *   <li>Persists via the existing JPA save path and returns the
     *       updated {@code inputArtifacts} sub-map for the controller to
     *       echo back to the gateway.</li>
     * </ol>
     *
     * <p>The bound {@code architectureId} on the run is NEVER mutated --
     * scoping is read-only here, identical to {@link #updateRunInArchitecture}.
     *
     * <p>Spec: Runtime Log Input at Discovery Run Start (2026-05-10).
     *
     * @param projectId the project UUID from the URL path
     * @param architectureId the architecture UUID from the URL path (must match
     *                       the run's bound id; mismatch yields 404)
     * @param runId the run UUID
     * @param request the validated PATCH body
     * @return the updated {@code inputArtifacts} sub-map (containing the merged
     *         {@code logFiles[]} and the {@code attemptedCount})
     * @throws ResourceNotFoundException if the run does not exist in the scope
     */
    @Transactional
    public Map<String, Object> patchLogFileArtifacts(UUID projectId, UUID architectureId,
                                                     UUID runId, LogFilesPatchRequest request) {
        log.debug("PATCH log-file artifacts on run: {} scoped to project: {}, architecture: {}, "
            + "incoming logFiles count: {}, attemptedCount: {}",
            runId, projectId, architectureId,
            request.logFiles() == null ? 0 : request.logFiles().size(),
            request.attemptedCount());

        DiscoveryRunEntity entity = runRepository.findById(runId)
            .filter(e -> projectId.equals(e.getProjectId()))
            .filter(e -> architectureId.equals(e.getArchitectureId()))
            .orElseThrow(() -> new ResourceNotFoundException(
                "Discovery run not found in architecture: runId=" + runId
                    + ", projectId=" + projectId + ", architectureId=" + architectureId));

        // Capture the immutable architectureId for an after-save assertion.
        UUID boundArchitectureBefore = entity.getArchitectureId();

        // Read the current snapshot. Defensive copy so we never mutate the map
        // returned by the JsonType converter in a way that escapes the entity.
        Map<String, Object> configSnapshot = entity.getConfigSnapshot();
        if (configSnapshot == null) {
            configSnapshot = new HashMap<>();
        } else {
            configSnapshot = new HashMap<>(configSnapshot);
        }

        // Lazily initialise inputArtifacts as a Map<String, Object>. The
        // payload may already exist from a prior PATCH on this run (idempotent
        // re-PATCH) or may be absent for a first-time PATCH.
        @SuppressWarnings("unchecked")
        Map<String, Object> inputArtifacts =
            (Map<String, Object>) configSnapshot.get("inputArtifacts");
        if (inputArtifacts == null) {
            inputArtifacts = new HashMap<>();
        } else {
            inputArtifacts = new HashMap<>(inputArtifacts);
        }

        // Lazily initialise logFiles as a List<Map<String, Object>>.
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> existingLogFiles =
            (List<Map<String, Object>>) inputArtifacts.get("logFiles");
        List<Map<String, Object>> mergedLogFiles = (existingLogFiles == null)
            ? new ArrayList<>()
            : new ArrayList<>(existingLogFiles);

        // Merge each incoming entry keyed on artifactId: replace an existing
        // entry with the same id, otherwise append. This is the idempotency
        // contract -- re-PATCHing with the same artifactId never duplicates.
        if (request.logFiles() != null) {
            for (LogFileMetaDto incoming : request.logFiles()) {
                Map<String, Object> incomingMap = toMap(incoming);
                String incomingId = incoming.artifactId();

                int replaceIdx = -1;
                for (int i = 0; i < mergedLogFiles.size(); i++) {
                    Object existingId = mergedLogFiles.get(i).get("artifactId");
                    if (incomingId != null && incomingId.equals(existingId)) {
                        replaceIdx = i;
                        break;
                    }
                }

                if (replaceIdx >= 0) {
                    mergedLogFiles.set(replaceIdx, incomingMap);
                } else {
                    mergedLogFiles.add(incomingMap);
                }
            }
        }

        // attemptedCount = max(existing or 0, incoming). Never lower the count
        // on a follow-up PATCH so partial-failure state can't be hidden.
        int existingAttempted = 0;
        Object existingAttemptedRaw = inputArtifacts.get("attemptedCount");
        if (existingAttemptedRaw instanceof Number) {
            existingAttempted = ((Number) existingAttemptedRaw).intValue();
        }
        int incomingAttempted = request.attemptedCount() == null ? 0 : request.attemptedCount();
        int mergedAttempted = Math.max(existingAttempted, incomingAttempted);

        inputArtifacts.put("logFiles", mergedLogFiles);
        inputArtifacts.put("attemptedCount", mergedAttempted);
        configSnapshot.put("inputArtifacts", inputArtifacts);

        // Merge optional runtimeEvidenceConfig sibling key when present in the
        // PATCH body. This carries the per-run "M" prefix-tolerance knob set in
        // the run-start modals. When the request omits the field, the existing
        // snapshot value (if any) is left UNCHANGED -- we do NOT null it on
        // a subsequent PATCH that only carries log files.
        // Spec: Discovery Run Robustness (2026-05-11) -- Task Group 3.
        if (request.runtimeEvidenceConfig() != null
                && request.runtimeEvidenceConfig().maxLogPathPrefixSegments() != null) {
            @SuppressWarnings("unchecked")
            Map<String, Object> existingRuntimeEvidenceConfig =
                (Map<String, Object>) configSnapshot.get("runtimeEvidenceConfig");
            Map<String, Object> mergedRuntimeEvidenceConfig = (existingRuntimeEvidenceConfig == null)
                ? new LinkedHashMap<>()
                : new LinkedHashMap<>(existingRuntimeEvidenceConfig);
            mergedRuntimeEvidenceConfig.put(
                "maxLogPathPrefixSegments",
                request.runtimeEvidenceConfig().maxLogPathPrefixSegments());
            configSnapshot.put("runtimeEvidenceConfig", mergedRuntimeEvidenceConfig);
        }
        if (request.runtimeEvidenceConfig() != null
                && request.runtimeEvidenceConfig().logPatternHint() != null
                && !request.runtimeEvidenceConfig().logPatternHint().isBlank()) {
            @SuppressWarnings("unchecked")
            Map<String, Object> existingRuntimeEvidenceConfig =
                (Map<String, Object>) configSnapshot.get("runtimeEvidenceConfig");
            Map<String, Object> mergedRuntimeEvidenceConfig = (existingRuntimeEvidenceConfig == null)
                ? new LinkedHashMap<>()
                : new LinkedHashMap<>(existingRuntimeEvidenceConfig);
            mergedRuntimeEvidenceConfig.put(
                "logPatternHint",
                request.runtimeEvidenceConfig().logPatternHint().trim());
            configSnapshot.put("runtimeEvidenceConfig", mergedRuntimeEvidenceConfig);
        }
        entity.setConfigSnapshot(configSnapshot);

        DiscoveryRunEntity saved = runRepository.save(entity);

        // Defence-in-depth: assert the bound architecture did not move.
        if (!boundArchitectureBefore.equals(saved.getArchitectureId())) {
            throw new IllegalStateException(
                "BUG: discovery run architectureId mutated during PATCH log-files (was="
                    + boundArchitectureBefore + ", now=" + saved.getArchitectureId()
                    + "). Run binding is permanent (spec #4).");
        }

        log.debug("PATCH log-file artifacts saved on run: {} -- merged logFiles count: {}, "
            + "attemptedCount: {}", saved.getId(), mergedLogFiles.size(), mergedAttempted);

        // Return the updated sub-map so the controller can echo it back.
        @SuppressWarnings("unchecked")
        Map<String, Object> savedInputArtifacts =
            (Map<String, Object>) saved.getConfigSnapshot().get("inputArtifacts");
        return savedInputArtifacts == null ? inputArtifacts : savedInputArtifacts;
    }

    /**
     * Merge operator-uploaded API contract files into the run's
     * {@code config_snapshot.contractFiles[]} JSONB array (2026-08-02).
     *
     * <p>Idempotent on {@code fileName}: re-PATCHing with the same name
     * REPLACES that entry, never appends a duplicate (so a gateway retry is
     * safe). The content is stored inline — WADL/XSD are small and the
     * discovery pipeline reads them straight from the config as an
     * authoritative Interface/Endpoint source. Returns the merged list.</p>
     */
    @Transactional
    public List<Map<String, Object>> patchContractFiles(UUID projectId, UUID architectureId,
                                                        UUID runId, ContractFilesPatchRequest request) {
        log.debug("PATCH contract-files on run: {} scoped to project: {}, architecture: {}, "
            + "incoming contractFiles count: {}",
            runId, projectId, architectureId,
            request.contractFiles() == null ? 0 : request.contractFiles().size());

        DiscoveryRunEntity entity = runRepository.findById(runId)
            .filter(e -> projectId.equals(e.getProjectId()))
            .filter(e -> architectureId.equals(e.getArchitectureId()))
            .orElseThrow(() -> new ResourceNotFoundException(
                "Discovery run not found in architecture: runId=" + runId
                    + ", projectId=" + projectId + ", architectureId=" + architectureId));

        UUID boundArchitectureBefore = entity.getArchitectureId();

        Map<String, Object> configSnapshot = entity.getConfigSnapshot();
        configSnapshot = (configSnapshot == null) ? new HashMap<>() : new HashMap<>(configSnapshot);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> existing =
            (List<Map<String, Object>>) configSnapshot.get("contractFiles");
        List<Map<String, Object>> merged = (existing == null)
            ? new ArrayList<>()
            : new ArrayList<>(existing);

        if (request.contractFiles() != null) {
            for (ContractFilesPatchRequest.ContractFileDto incoming : request.contractFiles()) {
                Map<String, Object> incomingMap = new LinkedHashMap<>();
                incomingMap.put("fileName", incoming.fileName());
                incomingMap.put("content", incoming.content());

                int replaceIdx = -1;
                for (int i = 0; i < merged.size(); i++) {
                    Object existingName = merged.get(i).get("fileName");
                    if (incoming.fileName() != null && incoming.fileName().equals(existingName)) {
                        replaceIdx = i;
                        break;
                    }
                }
                if (replaceIdx >= 0) {
                    merged.set(replaceIdx, incomingMap);
                } else {
                    merged.add(incomingMap);
                }
            }
        }

        configSnapshot.put("contractFiles", merged);
        entity.setConfigSnapshot(configSnapshot);
        DiscoveryRunEntity saved = runRepository.save(entity);

        if (!boundArchitectureBefore.equals(saved.getArchitectureId())) {
            throw new IllegalStateException(
                "BUG: discovery run architectureId mutated during PATCH contract-files (was="
                    + boundArchitectureBefore + ", now=" + saved.getArchitectureId() + ").");
        }

        log.debug("PATCH contract-files saved on run: {} -- merged contractFiles count: {}",
            saved.getId(), merged.size());
        return merged;
    }

    /**
     * Convert a {@link LogFileMetaDto} into a {@code Map<String, Object>} so it
     * can be stored in the JSONB {@code config_snapshot} payload alongside
     * other arbitrary keys. Field names are camelCase to match the on-disk
     * shape that Spec 5 will read.
     */
    private static Map<String, Object> toMap(LogFileMetaDto dto) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("artifactId", dto.artifactId());
        m.put("originalFileName", dto.originalFileName());
        m.put("sizeBytes", dto.sizeBytes());
        m.put("fileExtension", dto.fileExtension());
        // contentType is optional -- include only when present to keep the
        // stored shape minimal and match the gateway's payload exactly.
        if (dto.contentType() != null) {
            m.put("contentType", dto.contentType());
        }
        m.put("uploadedAtIso", dto.uploadedAtIso());
        m.put("relativePath", dto.relativePath());
        return m;
    }

    /**
     * Validate that {@code discoveryKind} is one of the allowed values.
     * Allowed: 'code' | 'database' | 'combined' (case-sensitive). 'combined' is
     * reserved -- accepted by the validator, never emitted in v1.
     *
     * Spec: Database Discovery Packs (Sybase + PostgreSQL) (2026-05-16) --
     * Task Group 1.
     *
     * @param discoveryKind the kind to validate (must be non-null; callers
     *                      normalise null to {@link #DEFAULT_DISCOVERY_KIND})
     * @throws IllegalArgumentException if the value is not in the allowed set
     */
    private void validateDiscoveryKind(String discoveryKind) {
        if (!ALLOWED_DISCOVERY_KINDS.contains(discoveryKind)) {
            throw new IllegalArgumentException(
                "Invalid discovery_kind: " + discoveryKind
                    + ". Allowed values: " + ALLOWED_DISCOVERY_KINDS
            );
        }
    }

    /**
     * Validate that the status is an allowed value.
     *
     * @param status the status to validate
     * @throws IllegalArgumentException if the status is not allowed
     */
    private void validateStatus(String status) {
        if (!ALLOWED_STATUSES.contains(status)) {
            throw new IllegalArgumentException(
                "Invalid status: " + status + ". Allowed values: " + ALLOWED_STATUSES
            );
        }
    }

    /**
     * Convert entity to DTO with ISO-8601 timestamp strings.
     *
     * Includes the V3 pipeline tier (mode) field. Spec: V3 Discovery Pipeline Foundation.
     *
     * Extended for V3 Tier UX -- exposes `tier` (derived from `mode`, same value),
     * `warnings` (JSON-encoded string[] passed through verbatim), and
     * `confirmedLlmSolo` (explicit Tier C opt-in).
     *
     * Extended for Oracle Integrity & Determinism (2026-05-30) -- exposes the
     * advisory `degraded` (boxed Boolean) and `degradedReasons` (JSON-encoded
     * string[] passed through verbatim) run-integrity signal. Both are null when
     * absent, mirroring the `warnings` passthrough.
     */
    private DiscoveryRunDto toDto(DiscoveryRunEntity entity) {
        return new DiscoveryRunDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getArchitectureId(),
            entity.getServiceId(),
            entity.getMode(),
            // tier is derived from mode on every read -- same single-char value,
            // exposed under both names for API consumer clarity
            entity.getMode(),
            entity.getWarnings(),
            entity.isConfirmedLlmSolo(),
            // Spec: Database Discovery Packs (2026-05-16) -- TG1.
            // discoveryKind discriminates code vs database runs (default 'code').
            entity.getDiscoveryKind(),
            // Spec: Oracle Integrity & Determinism (2026-05-30) -- TG1.
            // Advisory run-integrity signal, passed through verbatim (null when
            // absent), riding alongside the COMPLETED status.
            entity.getDegraded(),
            entity.getDegradedReasons(),
            entity.getStatus(),
            entity.getCurrentStep(),
            entity.getConfigSnapshot(),
            entity.getStepsPayload(),
            entity.getErrorMessage(),
            entity.getCreatedAt().toString(),
            entity.getUpdatedAt().toString()
        );
    }
}
