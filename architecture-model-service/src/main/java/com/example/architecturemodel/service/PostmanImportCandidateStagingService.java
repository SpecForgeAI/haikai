package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryCandidateDto;
import com.example.architecturemodel.model.dto.StageImportedCandidateRequest;
import com.example.architecturemodel.model.entity.DiscoveryCandidateEntity;
import com.example.architecturemodel.model.entity.DiscoveryRunEntity;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import com.example.architecturemodel.repository.entity.DiscoveryRunRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Stages ONE imported (Postman) endpoint as an un-approved discovery candidate
 * scoped to a (project, architecture) pair -- the AMS side of "Add to
 * architecture" for the Postman import flow.
 *
 * Spec: 2026-06-23 Import a Postman Collection into Capture, R5 / A4 -- Task
 * Group 5.
 *
 * <h2>Why a synthetic parent run</h2>
 * {@code discovery_candidate.run_id} is NOT NULL and a FK to
 * {@code discovery_run(id)} (Liquibase {@code 070-discovery-candidate.sql}), so a
 * candidate REQUIRES a parent run. The Postman "Add to architecture" consumer has
 * a (project, architecture) but no run id. Rather than touch the schema, this
 * service FINDS-OR-CREATES a lightweight synthetic "imported" run for the
 * (project, architecture) -- {@code status='COMPLETED'}, {@code discovery_kind='code'},
 * empty config snapshot tagged with {@code importedEndpointStaging=true} -- created
 * DIRECTLY via the repository (NOT via {@code DiscoveryRunService.createRun}) so it
 * bypasses the active-run and COMPLETE-config gates that do not apply to an
 * import. The synthetic run is REUSED across repeated imports for the same
 * (project, architecture) so we never accumulate one run per staged endpoint.
 *
 * <h2>Why a dedicated service (not a method on DiscoveryCandidateService)</h2>
 * Deliberately a NEW service with its OWN {@code @RequiredArgsConstructor} so the
 * generated constructor of {@code DiscoveryCandidateService} is NOT changed --
 * five existing unit tests construct that service manually
 * ({@code new DiscoveryCandidateService(candidateRepository, runGuard)}) and would
 * all break on a new dependency.
 *
 * <h2>Un-approved by construction</h2>
 * The staged candidate is {@code review_status='pending_review'},
 * {@code status='proposed'}, {@code operation='create'} -- it flows through the
 * normal discovery review/approve path and is never a committed-architecture
 * write (A4).
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class PostmanImportCandidateStagingService {

    /**
     * Marker key written into the synthetic run's {@code config_snapshot} so the
     * find-or-create can recognise (and reuse) the same "imported" parent run for
     * a (project, architecture) across repeated imports.
     */
    static final String IMPORTED_RUN_MARKER = "importedEndpointStaging";

    /** Candidate type used for an imported API endpoint proposal. */
    static final String CANDIDATE_TYPE = "interface";

    private final DiscoveryCandidateRepository candidateRepository;
    private final DiscoveryRunRepository runRepository;

    /**
     * Stage one imported endpoint as an un-approved discovery candidate.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID the candidate is scoped to
     * @param request the imported endpoint (method + path required)
     * @return the persisted, un-approved candidate DTO (snake_case on the wire)
     * @throws IllegalArgumentException if method or path is missing/blank
     */
    @Transactional
    public DiscoveryCandidateDto stageImportedCandidate(
            UUID projectId, UUID architectureId, StageImportedCandidateRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        String method = request.method() == null ? null : request.method().trim();
        String path = request.path() == null ? null : request.path().trim();
        if (method == null || method.isBlank()) {
            throw new IllegalArgumentException("method is required");
        }
        if (path == null || path.isBlank()) {
            throw new IllegalArgumentException("path is required");
        }

        DiscoveryRunEntity run = findOrCreateImportedRun(projectId, architectureId);

        String name = (request.name() != null && !request.name().isBlank())
            ? request.name().trim()
            : method.toUpperCase() + " " + path;

        Map<String, Object> data = new HashMap<>();
        data.put("method", method.toUpperCase());
        data.put("path", path);
        data.put("source", "postman-import");
        if (request.sourceItemName() != null && !request.sourceItemName().isBlank()) {
            data.put("source_item_name", request.sourceItemName().trim());
        }
        if (request.summary() != null && !request.summary().isBlank()) {
            data.put("summary", request.summary().trim());
        }

        DiscoveryCandidateEntity entity = DiscoveryCandidateEntity.builder()
            .id(UUID.randomUUID())
            .runId(run.getId())
            .candidateType(CANDIDATE_TYPE)
            .name(name)
            .confidence(0.0)
            .status("proposed")
            .operation("create")
            .data(data)
            .reviewStatus("pending_review")
            .build();

        DiscoveryCandidateEntity saved = candidateRepository.save(entity);
        log.debug("Staged imported endpoint candidate {} ({}) under imported run {} "
                + "for project {} architecture {}",
            saved.getId(), name, run.getId(), projectId, architectureId);

        return toDto(saved);
    }

    /**
     * Find the existing synthetic "imported" run for the (project, architecture)
     * pair, or create one. The marker {@link #IMPORTED_RUN_MARKER} on
     * {@code config_snapshot} distinguishes it from real discovery runs.
     *
     * Created directly via the repository (NOT {@code DiscoveryRunService.createRun})
     * so it never trips the active-run / COMPLETE-config gates.
     */
    private DiscoveryRunEntity findOrCreateImportedRun(UUID projectId, UUID architectureId) {
        List<DiscoveryRunEntity> runs = runRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(projectId, architectureId);
        for (DiscoveryRunEntity run : runs) {
            Map<String, Object> snapshot = run.getConfigSnapshot();
            if (snapshot != null && Boolean.TRUE.equals(snapshot.get(IMPORTED_RUN_MARKER))) {
                return run;
            }
        }

        Map<String, Object> snapshot = new HashMap<>();
        snapshot.put(IMPORTED_RUN_MARKER, true);

        DiscoveryRunEntity run = DiscoveryRunEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .discoveryKind("code")
            .status("COMPLETED")
            .configSnapshot(snapshot)
            .build();
        return runRepository.save(run);
    }

    /**
     * Convert the staged entity to its DTO (ISO-8601 timestamps, null-safe).
     * Mirrors {@code DiscoveryCandidateService.toDto} so the staged candidate
     * serialises identically to every other candidate read.
     */
    private DiscoveryCandidateDto toDto(DiscoveryCandidateEntity entity) {
        return new DiscoveryCandidateDto(
            entity.getId(),
            entity.getRunId(),
            entity.getCandidateType(),
            entity.getName(),
            entity.getConfidence(),
            entity.getStatus(),
            entity.getSourceClusterIds(),
            entity.getData(),
            entity.getSynthesizedAt() != null ? entity.getSynthesizedAt().toString() : null,
            entity.getParentCandidateId(),
            entity.getReviewStatus(),
            entity.getReviewedBy(),
            entity.getReviewedAt() != null ? entity.getReviewedAt().toString() : null,
            entity.getPreviousReviewStatus(),
            entity.getLogEnrichment(),
            entity.getOperation()
        );
    }
}
