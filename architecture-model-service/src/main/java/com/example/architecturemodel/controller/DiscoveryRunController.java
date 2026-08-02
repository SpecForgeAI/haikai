package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryRunDto;
import com.example.architecturemodel.model.dto.discovery.ContractFilesPatchRequest;
import com.example.architecturemodel.model.dto.discovery.LogFilesPatchRequest;
import com.example.architecturemodel.service.DiscoveryRunService;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * REST Controller for Discovery Run endpoints.
 *
 * Provides create, list, get, and update access to Phase 1 discovery runs
 * for a project, scoped to a specific architecture.
 *
 * Spec: Discovery Run Model and Orchestration (Increment 5)
 * Task Group 2: Entity, DTO, Repository, Service, Controller
 *
 * Spec: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 * Task Group 2: All Discovery* endpoints adopt the {architectureId} path
 * segment (Bucket A pattern from spec #1). Forgetting the path segment yields
 * Spring 404 (NoHandlerFoundException -> GlobalExceptionHandler). The user
 * picks the target architecture explicitly at run start; the picked id is
 * persisted on DiscoveryRunEntity for the run's entire lifetime and propagates
 * through every Discovery endpoint and every save-back to architecture-model-service.
 *
 * Spec: Runtime Log Input at Discovery Run Start (2026-05-10) -- Task Group 1
 * Adds {@link #patchLogFileArtifacts} which merges runtime-log file metadata
 * into {@code config_snapshot.inputArtifacts.logFiles[]} idempotently on
 * {@code artifactId}. The gateway calls this endpoint after writing each
 * uploaded file to disk; the architecture-model-service NEVER touches the
 * raw file content -- only the metadata block.
 *
 * Spec: Oracle Integrity & Determinism (2026-05-30) -- Task Group 1
 * The PUT update body accepts the optional advisory {@code degraded} (boxed
 * Boolean) + {@code degraded_reasons} (JSON-encoded string[]) run-integrity
 * signal so the discovery-service can persist it alongside the COMPLETED
 * transition. Both are NON-CLOBBER at the service layer (a null incoming value
 * leaves the stored value unchanged). The signal rides ALONGSIDE the
 * {@code status}; it is NOT a new terminal status value.
 *
 * Base path: /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs")
@RequiredArgsConstructor
@Slf4j
public class DiscoveryRunController {

    private final DiscoveryRunService discoveryRunService;

    /**
     * POST /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs
     *
     * Create a new discovery run for a project, bound to the architecture from
     * the URL path for the run's entire lifetime.
     * Returns 409 if an active run already exists.
     * Returns 400 if the discovery config is missing or not COMPLETE.
     *
     * Spec: V3 Tier UX -- accepts optional {@code mode}, {@code warnings} (JSON-encoded
     * string[]), and {@code confirmLlmSolo} (boolean) so the discovery-service gate
     * can POST tier + mode + warnings + confirmedLlmSolo in a single call.
     * No server-side re-validation is performed; the discovery-service route is
     * the single source of truth for the Tier C opt-in gate.
     *
     * Spec: Discovery Service architectureId Integration (Spec #4) -- the
     * {@code architectureId} path variable is persisted onto the new
     * DiscoveryRunEntity row and binds the run for life. Run-architecture
     * binding is permanent: subsequent PUT/PATCH endpoints on this run will
     * not change architecture_id.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID this run is bound to for life
     * @param request optional request body containing service_id for service-scoped runs
     *                and V3 tier metadata
     * @return the created discovery run DTO
     */
    @PostMapping
    public ResponseEntity<?> createRun(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestBody(required = false) CreateDiscoveryRunRequest request) {
        String serviceId = (request != null) ? request.serviceId() : null;
        String mode = (request != null) ? request.mode() : null;
        String warnings = (request != null) ? request.warnings() : null;
        boolean confirmLlmSolo = (request != null && Boolean.TRUE.equals(request.confirmLlmSolo()));
        Map<String, Object> serviceIdentitySnapshot =
            (request != null) ? request.serviceIdentitySnapshot() : null;
        // Spec: Database Discovery Packs (2026-05-16) -- TG1.
        // Source kind discriminator ('code' | 'database' | 'combined'); null
        // is normalised to 'code' inside the service for back-compat with
        // pre-existing clients that omit the field.
        String discoveryKind = (request != null) ? request.discoveryKind() : null;

        log.debug("POST /api/model/projects/{}/architectures/{}/discovery/runs, serviceId: {}, mode: {}, "
            + "confirmLlmSolo: {}, snapshotPresent: {}, discoveryKind: {}",
            projectId, architectureId, serviceId, mode, confirmLlmSolo,
            serviceIdentitySnapshot != null, discoveryKind);

        try {
            DiscoveryRunDto dto = discoveryRunService.createRun(
                projectId, architectureId, serviceId, mode, warnings, confirmLlmSolo,
                serviceIdentitySnapshot, discoveryKind
            );
            return ResponseEntity.ok(dto);
        } catch (IllegalStateException e) {
            log.warn("Active run conflict for project {}: {}", projectId, e.getMessage());
            return ResponseEntity.status(409).body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            log.warn("Bad request creating run for project {}: {}", projectId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs
     *
     * List all discovery runs for a project filtered by architecture, ordered by
     * creation time descending. Runs targeting other architectures are not returned.
     *
     * Spec: V3 Tier UX -- each entry includes {@code mode} and {@code tier}
     * (derived from mode) via the DTO. Warnings are omitted from list output
     * for brevity and available on the detail endpoint.
     *
     * Spec: Discovery Service architectureId Integration (Spec #4) -- this
     * implements safety property (c): cross-architecture runs are hidden.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID to filter runs by
     * @return list of discovery run DTOs for the (project, architecture) pair
     */
    @GetMapping
    public ResponseEntity<?> listRuns(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestParam(name = "discovery_kind", required = false) String discoveryKind) {
        log.debug("GET /api/model/projects/{}/architectures/{}/discovery/runs?discovery_kind={}",
            projectId, architectureId, discoveryKind);

        try {
            // Spec: Database Discovery Packs (2026-05-16) -- TG1.
            // The service method handles null/blank by delegating to the
            // unfiltered list, and validates non-blank values against the
            // allowed set (yields 400 on a bad kind via IllegalArgumentException).
            List<DiscoveryRunDto> runs = discoveryRunService
                .getRunsByProjectAndArchitectureAndKind(projectId, architectureId, discoveryKind);
            return ResponseEntity.ok(runs);
        } catch (IllegalArgumentException e) {
            log.warn("Bad request listing runs for project {} architecture {}: {}",
                projectId, architectureId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}
     *
     * Get a single discovery run by ID, scoped to the project and architecture
     * from the URL.
     *
     * Returns 404 if not found OR if the run exists but is bound to a different
     * architecture or project (cross-architecture leakage prevention).
     *
     * Spec: V3 Tier UX -- response includes {@code mode}, {@code tier} (derived
     * from mode), {@code warnings}, and {@code confirmed_llm_solo} additively.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @param runId the run UUID
     * @return the discovery run DTO, or 404 if not found / not in this architecture
     */
    @GetMapping("/{runId}")
    public ResponseEntity<DiscoveryRunDto> getRun(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/discovery/runs/{}",
            projectId, architectureId, runId);

        DiscoveryRunDto dto = discoveryRunService.getRunInArchitecture(
            runId, projectId, architectureId);
        if (dto == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(dto);
    }

    /**
     * PUT /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}
     *
     * Update a discovery run's status, current step, steps payload, error message,
     * optionally the V3 pipeline tier (mode), the warnings payload, and the
     * advisory degraded run-integrity signal.
     *
     * The serviceId, confirmedLlmSolo, AND architectureId fields are preserved as-is
     * from creation and are NOT updatable. The architectureId from the URL is used
     * only to scope the lookup; the run's bound architecture is never mutated
     * (run-architecture binding is permanent for life).
     *
     * Spec: V3 Discovery Pipeline Foundation -- the optional `mode` field carries
     * the computed A/B/C tier written by `runDiscoveryV3` after Stage 2.
     *
     * Spec: V3 Tier UX -- the optional `warnings` field carries a JSON-encoded
     * string[] synthesized at the gate.
     *
     * Spec: Oracle Integrity & Determinism (2026-05-30) -- the optional
     * `degraded` (boxed Boolean) + `degraded_reasons` (JSON-encoded string[])
     * fields carry the advisory run-integrity signal computed at the COMPLETED
     * transition. Both are NON-CLOBBER at the service layer (null leaves the
     * stored value unchanged) so a status-only PUT never wipes a previously-set
     * flag. The signal rides ALONGSIDE the status -- it is NOT a terminal status.
     *
     * Spec: Discovery Service architectureId Integration (Spec #4) -- run-architecture
     * binding is permanent. PUT/PATCH leaves architecture_id untouched.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID (must match the run's bound id)
     * @param runId the run UUID
     * @param request the update request body
     * @return the updated discovery run DTO; 404 if not found in the given architecture
     */
    @PutMapping("/{runId}")
    public ResponseEntity<?> updateRun(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestBody UpdateDiscoveryRunRequest request) {
        log.debug("PUT /api/model/projects/{}/architectures/{}/discovery/runs/{}",
            projectId, architectureId, runId);

        try {
            DiscoveryRunDto dto = discoveryRunService.updateRunInArchitecture(
                runId,
                projectId,
                architectureId,
                request.status(),
                request.currentStep(),
                request.stepsPayload(),
                request.errorMessage(),
                request.mode(),
                request.warnings(),
                // Spec: Oracle Integrity & Determinism (2026-05-30) -- TG1.
                // Advisory degraded signal, NON-CLOBBER at the service layer.
                request.degraded(),
                request.degradedReasons()
            );
            return ResponseEntity.ok(dto);
        } catch (NoSuchElementException e) {
            log.warn("Run not found for update: {}", runId);
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad request updating run {}: {}", runId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * DELETE /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}
     *
     * Delete a discovery run and ALL of its child data (candidates, evidence,
     * relationships, clusters, decision tasks, findings, capabilities), scoped
     * to the project and architecture from the URL. Powers the Discovery Runs
     * UI's right-click "Delete" action so a user can clean up test/iteration
     * runs in place.
     *
     * Returns 204 No Content on success, or 404 if no run matches the
     * (projectId, architectureId, runId) scope -- a run bound to a different
     * architecture or project 404s (cross-architecture deletion prevention,
     * matching the GET scoping).
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID (must match the run's bound id)
     * @param runId the run UUID
     * @return 204 if deleted; 404 if not found in this architecture
     */
    @DeleteMapping("/{runId}")
    public ResponseEntity<Void> deleteRun(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId) {
        log.debug("DELETE /api/model/projects/{}/architectures/{}/discovery/runs/{}",
            projectId, architectureId, runId);

        boolean deleted = discoveryRunService.deleteRunInArchitecture(
            runId, projectId, architectureId);
        if (!deleted) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.noContent().build();
    }

    /**
     * PATCH /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/input-artifacts/log-files
     *
     * Merge a batch of runtime-log file metadata entries into the run's
     * {@code config_snapshot.inputArtifacts.logFiles[]} JSONB payload, and set
     * {@code attemptedCount = max(existing, incoming)}.
     *
     * <p>The gateway calls this AFTER writing each uploaded file to disk under
     * {@code {projectFolder}/discovery-runs/{runId}/logs/} -- the metadata
     * block is the only thing this service ever sees of the user's logs.
     *
     * <p>Idempotent on {@code artifactId}: re-PATCHing with the same id
     * REPLACES that entry; it never appends a duplicate. This lets the gateway
     * safely retry the PATCH on transient failures.
     *
     * <p>Returns:
     * <ul>
     *   <li>200 OK with the updated {@code inputArtifacts} sub-map (containing
     *       the merged {@code logFiles[]} and {@code attemptedCount})</li>
     *   <li>404 if no run exists for ({@code projectId}, {@code architectureId},
     *       {@code runId}). Mapped via {@link com.example.architecturemodel.exception.ResourceNotFoundException}
     *       handler in {@link com.example.architecturemodel.exception.GlobalExceptionHandler}.</li>
     *   <li>400 if the request body fails Bean Validation (missing required
     *       field, empty {@code logFiles}, etc.). Mapped by the
     *       controller-local {@link #handleValidationException} below; the
     *       service-wide {@code GlobalExceptionHandler} does not register a
     *       handler for {@link MethodArgumentNotValidException} and would
     *       otherwise fall through to its catch-all {@code Exception} handler
     *       (500). Spec: Runtime Log Input at Discovery Run Start (2026-05-10).</li>
     * </ul>
     *
     * <p>Spec: Runtime Log Input at Discovery Run Start (2026-05-10) -- Task Group 1.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @param runId the run UUID
     * @param request the validated PATCH body carrying the metadata entries
     *                and the original attemptedCount
     * @return the updated {@code inputArtifacts} sub-map
     */
    @PatchMapping("/{runId}/input-artifacts/log-files")
    public ResponseEntity<Map<String, Object>> patchLogFileArtifacts(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @Valid @RequestBody LogFilesPatchRequest request) {
        log.debug("PATCH /api/model/projects/{}/architectures/{}/discovery/runs/{}/input-artifacts/log-files "
            + "-- logFiles count: {}, attemptedCount: {}",
            projectId, architectureId, runId,
            request.logFiles() == null ? 0 : request.logFiles().size(),
            request.attemptedCount());

        Map<String, Object> updatedInputArtifacts = discoveryRunService.patchLogFileArtifacts(
            projectId, architectureId, runId, request);

        return ResponseEntity.ok(updatedInputArtifacts);
    }

    /**
     * PATCH /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/contract-files
     *
     * Merge operator-uploaded API contract files (WADL/WSDL/XSD content) into
     * the run's {@code config_snapshot.contractFiles[]} (2026-08-02). The
     * content is stored inline (small text) so the discovery pipeline reads it
     * as an authoritative Interface/Endpoint source. Idempotent on fileName.
     * 404 when the run is out of scope; 400 on validation failure.
     */
    @PatchMapping("/{runId}/contract-files")
    public ResponseEntity<Map<String, Object>> patchContractFiles(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @Valid @RequestBody ContractFilesPatchRequest request) {
        log.debug("PATCH /api/model/projects/{}/architectures/{}/discovery/runs/{}/contract-files "
            + "-- contractFiles count: {}",
            projectId, architectureId, runId,
            request.contractFiles() == null ? 0 : request.contractFiles().size());

        List<Map<String, Object>> merged = discoveryRunService.patchContractFiles(
            projectId, architectureId, runId, request);

        return ResponseEntity.ok(Map.of("contractFiles", merged));
    }

    /**
     * Controller-local handler for Bean Validation failures on
     * {@link #patchLogFileArtifacts}'s {@code @Valid @RequestBody}.
     *
     * <p>Required because {@link com.example.architecturemodel.exception.GlobalExceptionHandler}
     * registers a catch-all {@code @ExceptionHandler(Exception.class)} which
     * intercepts {@link MethodArgumentNotValidException} (Spring's normal 400
     * mapping is short-circuited). Without this controller-scoped handler, a
     * malformed PATCH body would surface as 500 instead of 400.
     *
     * <p>The handler is scoped to this controller (not the global advice) so
     * we don't accidentally change the 4xx semantics of any other endpoint
     * that today relies on the catch-all behaviour.
     *
     * <p>Spec: Runtime Log Input at Discovery Run Start (2026-05-10) -- Task Group 1.
     *
     * @param ex the validation exception thrown by Spring before the handler method runs
     * @return 400 Bad Request with a structured envelope listing each failed field
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidationException(
            MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
            .collect(Collectors.joining(", "));
        if (message.isEmpty()) {
            message = ex.getMessage();
        }
        log.warn("Bean validation failure on Discovery Run controller request: {}", message);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", HttpStatus.BAD_REQUEST.value());
        body.put("error", "Bad Request");
        body.put("code", "validation_failed");
        body.put("message", message);

        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
    }

    /**
     * Request body for creating a discovery run.
     * All fields are optional; when no body is provided, a project-level run is created
     * with default V3 metadata (no mode, no warnings, no LLM-solo opt-in). The bound
     * {@code architectureId} comes from the URL path, not the body.
     *
     * Spec: V3 Tier UX -- adds mode, warnings, and confirm_llm_solo as additive fields
     * populated by the discovery-service gate (see discovery-service/src/routes/runs.ts).
     *
     * @param serviceId optional service ID for service-scoped runs
     * @param mode optional V3 tier ('A', 'B', 'C', or null)
     * @param warnings optional JSON-encoded string[] of tier warnings
     * @param confirmLlmSolo optional explicit Tier C opt-in flag (null treated as false)
     */
    public record CreateDiscoveryRunRequest(
        @JsonProperty("service_id")
        String serviceId,

        @JsonProperty("mode")
        String mode,

        @JsonProperty("warnings")
        String warnings,

        @JsonProperty("confirm_llm_solo")
        Boolean confirmLlmSolo,

        /**
         * Six identifier-ish fields captured at run-create time from the
         * discovery-service's existing service fetch. Persisted by
         * {@link DiscoveryRunService#createRun} into
         * {@code config_snapshot.serviceIdentitySnapshot} so an orphaned
         * run (its {@code service_id} FK nulled by the
         * {@code ON DELETE SET NULL} action from Liquibase changeset 126)
         * still carries enough identity for the UI to render the original
         * service name plus a "Service deleted" chip.
         *
         * Null on library-scoped and project-scoped (no serviceId) runs.
         *
         * Spec: 2026-05-11 Discovery Run Robustness -- Section 2.
         */
        @JsonProperty("service_identity_snapshot")
        Map<String, Object> serviceIdentitySnapshot,

        /**
         * Source kind of the run: 'code' | 'database' | 'combined'.
         * Null/blank is normalised to 'code' by the service for back-compat
         * with existing clients that pre-date the database discovery packs
         * spec.
         *
         * Spec: Database Discovery Packs (Sybase + PostgreSQL) (2026-05-16) --
         * Task Group 1.
         */
        @JsonProperty("discovery_kind")
        String discoveryKind
    ) {}

    /**
     * Request body for updating a discovery run.
     *
     * @param status the new run status
     * @param currentStep the current step being executed
     * @param stepsPayload the updated per-step status payload
     * @param errorMessage error details if the run failed
     * @param mode optional V3 pipeline tier ("A", "B", "C", or null to leave unchanged).
     *             Spec: V3 Discovery Pipeline Foundation.
     * @param warnings optional JSON-encoded string[] of tier warnings (null to leave unchanged).
     *                 Spec: V3 Tier UX.
     * @param degraded optional advisory run-integrity flag (boxed Boolean; null to leave
     *                 unchanged -- NON-CLOBBER at the service layer). Rides alongside the
     *                 status; NOT a terminal status. Spec: Oracle Integrity & Determinism.
     * @param degradedReasons optional JSON-encoded string[] of the reasons `degraded` tripped
     *                        (null to leave unchanged). Spec: Oracle Integrity & Determinism.
     */
    public record UpdateDiscoveryRunRequest(
        @JsonProperty("status")
        String status,

        @JsonProperty("current_step")
        String currentStep,

        @JsonProperty("steps_payload")
        Map<String, Object> stepsPayload,

        @JsonProperty("error_message")
        String errorMessage,

        @JsonProperty("mode")
        String mode,

        @JsonProperty("warnings")
        String warnings,

        @JsonProperty("degraded")
        Boolean degraded,

        @JsonProperty("degraded_reasons")
        String degradedReasons
    ) {}
}
