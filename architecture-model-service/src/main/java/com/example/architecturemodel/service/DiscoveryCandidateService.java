package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryCandidateDto;
import com.example.architecturemodel.model.entity.DiscoveryCandidateEntity;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for managing discovery candidates.
 *
 * Provides bulk create, query (with optional type and/or status filters),
 * count, update, delete, and review operations for Phase 1d candidate synthesis results.
 * Candidates are scoped to a discovery run and represent synthesized
 * meta-model element proposals.
 *
 * Data flow: 1a atoms -> 1b relationships -> 1c clusters -> 1d candidates
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * Task Group 4: Candidate JPA Stack (1d)
 *
 * Extended: Phase 1d Candidate Generation (Increment 10)
 * Task Group 6: parentCandidateId mapping, deleteByRunId
 *
 * Extended: Candidate Review and Approval Workflow (Increment 13)
 * Task Group 1: reviewStatus, reviewedBy, reviewedAt, previousReviewStatus mapping in toDto and bulkCreate
 * Task Group 2: reviewCandidate() method for PATCH /review endpoint
 *
 * Extended: Log-based Discovery Enrichment (Increment 14)
 * Task Group 1: logEnrichment JSONB field mapping in toDto and bulkCreate
 *
 * Extended: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 2: Upsert semantics -- re-saving by stable ID updates rather than duplicates
 *
 * Extended: Model-Aware Discovery -- Dedup + Enrichment/Link (Spec 2026-05-30)
 * Task Group 1: operation dimension mapping in toDto and bulkCreate (null -> "create")
 *
 * Extended: Conversational Discovery-Review "Architect" Persona (Spec 3, 2026-06-02)
 * Task Group 1: resolveConflict() for the durable PATCH /resolve-conflict write
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DiscoveryCandidateService {

    private static final Set<String> VALID_REVIEW_STATUSES = Set.of("approved", "rejected", "deferred");

    private final DiscoveryCandidateRepository candidateRepository;

    private final DiscoveryRunArchitectureGuard runGuard;

    @Transactional
    public List<DiscoveryCandidateDto> bulkCreateInArchitecture(
            UUID runId, UUID projectId, UUID architectureId, List<DiscoveryCandidateDto> candidates) {
        runGuard.verify(runId, projectId, architectureId);
        return bulkCreate(runId, candidates);
    }

    @Transactional(readOnly = true)
    public List<DiscoveryCandidateDto> getByRunIdInArchitecture(
            UUID runId, UUID projectId, UUID architectureId, String type, String status) {
        runGuard.verify(runId, projectId, architectureId);
        return getByRunId(runId, type, status);
    }

    @Transactional(readOnly = true)
    public long countByRunIdInArchitecture(UUID runId, UUID projectId, UUID architectureId) {
        runGuard.verify(runId, projectId, architectureId);
        return countByRunId(runId);
    }

    @Transactional
    public long deleteByRunIdInArchitecture(UUID runId, UUID projectId, UUID architectureId) {
        runGuard.verify(runId, projectId, architectureId);
        return deleteByRunId(runId);
    }

    @Transactional
    public DiscoveryCandidateDto updateCandidateInArchitecture(
            UUID runId, UUID projectId, UUID architectureId,
            UUID candidateId, DiscoveryCandidateDto update) {
        runGuard.verify(runId, projectId, architectureId);
        return updateCandidate(runId, candidateId, update);
    }

    @Transactional
    public DiscoveryCandidateDto reviewCandidateInArchitecture(
            UUID runId, UUID projectId, UUID architectureId,
            UUID candidateId, String reviewStatus, String reviewedBy) {
        runGuard.verify(runId, projectId, architectureId);
        return reviewCandidate(runId, candidateId, reviewStatus, reviewedBy);
    }

    /**
     * Architecture-scoped entry point for the durable conflict-resolution write.
     * Mirrors {@link #reviewCandidateInArchitecture}: verifies the run belongs to the
     * (project, architecture) before delegating to {@link #resolveConflict}.
     *
     * Spec: Conversational Discovery-Review "Architect" Persona (Spec 3, 2026-06-02)
     * Task Group 1: durable server-side conflict-resolution write.
     */
    @Transactional
    public DiscoveryCandidateDto resolveConflictInArchitecture(
            UUID runId, UUID projectId, UUID architectureId,
            UUID candidateId, String attr, Object chosenValue,
            String chosenSource, String resolvedBy, String resolvedAt) {
        runGuard.verify(runId, projectId, architectureId);
        return resolveConflict(runId, candidateId, attr, chosenValue, chosenSource, resolvedBy, resolvedAt);
    }


    /**
     * Bulk create or update candidates for a discovery run (upsert semantics).
     *
     * Maps each DTO to an entity, overriding the runId with the path parameter value
     * for consistency. For entities with IDs that already exist in the database,
     * fields are updated in place (upsert). For new IDs, entities are inserted.
     * This ensures that re-persisting the same records by stable ID is a no-op
     * rather than causing duplicate key violations.
     *
     * Review fields are mapped from the DTO if provided; reviewStatus defaults to
     * "pending_review" if not specified. The operation dimension defaults to
     * "create" when the DTO omits it (null), so operation-agnostic callers keep
     * their existing behaviour.
     *
     * @param runId the discovery run UUID (from the URL path)
     * @param candidates list of candidate DTOs to persist
     * @return list of persisted candidate DTOs
     */
    @Transactional
    public List<DiscoveryCandidateDto> bulkCreate(UUID runId, List<DiscoveryCandidateDto> candidates) {
        log.debug("Bulk upserting {} candidates for run: {}", candidates.size(), runId);

        List<DiscoveryCandidateEntity> entities = candidates.stream()
            .map(dto -> {
                DiscoveryCandidateEntity.DiscoveryCandidateEntityBuilder builder = DiscoveryCandidateEntity.builder()
                    .id(dto.id() != null ? dto.id() : UUID.randomUUID())
                    .runId(runId)
                    .candidateType(dto.candidateType())
                    .name(dto.name())
                    // dto.confidence() returns Double (boxed) -- the entity field is primitive
                    // double, so a null DTO value must be coerced rather than auto-unboxed (NPE).
                    // bulkCreate is the synthesis path and confidence is always supplied, so the
                    // fallback only fires for malformed payloads.
                    .confidence(dto.confidence() != null ? dto.confidence() : 0.0)
                    .status(dto.status() != null ? dto.status() : "proposed")
                    // operation dimension (create / enrich / link). Null coerces to "create"
                    // so operation-agnostic callers and existing rows round-trip as create.
                    .operation(dto.operation() != null ? dto.operation() : "create")
                    .sourceClusterIds(dto.sourceClusterIds() != null ? new ArrayList<>(dto.sourceClusterIds()) : new ArrayList<>())
                    .data(dto.data() != null ? new HashMap<>(dto.data()) : new HashMap<>())
                    .parentCandidateId(dto.parentCandidateId())
                    .synthesizedAt(dto.synthesizedAt() != null ? Instant.parse(dto.synthesizedAt()) : Instant.now())
                    .reviewStatus(dto.reviewStatus() != null ? dto.reviewStatus() : "pending_review");

                // Map optional audit fields if provided
                if (dto.reviewedBy() != null) {
                    builder.reviewedBy(dto.reviewedBy());
                }
                if (dto.reviewedAt() != null) {
                    builder.reviewedAt(Instant.parse(dto.reviewedAt()));
                }
                if (dto.previousReviewStatus() != null) {
                    builder.previousReviewStatus(dto.previousReviewStatus());
                }

                // Map optional log enrichment field if provided
                if (dto.logEnrichment() != null) {
                    builder.logEnrichment(new HashMap<>(dto.logEnrichment()));
                }

                return builder.build();
            })
            .collect(Collectors.toList());

        // Collect all incoming IDs and find which already exist
        List<UUID> incomingIds = entities.stream()
            .map(DiscoveryCandidateEntity::getId)
            .collect(Collectors.toList());
        Map<UUID, DiscoveryCandidateEntity> existingMap = candidateRepository.findAllById(incomingIds)
            .stream()
            .collect(Collectors.toMap(DiscoveryCandidateEntity::getId, e -> e));

        // Partition into new inserts and existing updates
        List<DiscoveryCandidateEntity> toSave = new ArrayList<>();
        int updatedCount = 0;
        for (DiscoveryCandidateEntity entity : entities) {
            DiscoveryCandidateEntity existing = existingMap.get(entity.getId());
            if (existing != null) {
                // Update existing entity fields (upsert)
                existing.setRunId(entity.getRunId());
                existing.setCandidateType(entity.getCandidateType());
                existing.setName(entity.getName());
                existing.setConfidence(entity.getConfidence());
                existing.setStatus(entity.getStatus());
                existing.setOperation(entity.getOperation());
                existing.setSourceClusterIds(entity.getSourceClusterIds());
                existing.setData(entity.getData());
                existing.setParentCandidateId(entity.getParentCandidateId());
                existing.setSynthesizedAt(entity.getSynthesizedAt());
                existing.setReviewStatus(entity.getReviewStatus());
                existing.setReviewedBy(entity.getReviewedBy());
                existing.setReviewedAt(entity.getReviewedAt());
                existing.setPreviousReviewStatus(entity.getPreviousReviewStatus());
                existing.setLogEnrichment(entity.getLogEnrichment());
                toSave.add(existing);
                updatedCount++;
            } else {
                toSave.add(entity);
            }
        }

        List<DiscoveryCandidateEntity> saved = candidateRepository.saveAll(toSave);
        log.debug("Persisted {} candidates for run: {} ({} updated, {} inserted)",
            saved.size(), runId, updatedCount, saved.size() - updatedCount);

        return saved.stream()
            .map(this::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Get candidates by run ID with optional type and/or status filters.
     *
     * Delegates to the appropriate repository method based on which filters are present:
     * - Both type and status: findByRunIdAndCandidateTypeAndStatus
     * - Type only: findByRunIdAndCandidateType
     * - Status only: findByRunIdAndStatus
     * - Neither: findByRunId
     *
     * @param runId the discovery run UUID
     * @param type optional candidate type filter (application, app_component, service, etc.)
     * @param status optional status filter (proposed, accepted, rejected, merged)
     * @return list of matching candidate DTOs
     */
    @Transactional(readOnly = true)
    public List<DiscoveryCandidateDto> getByRunId(UUID runId, String type, String status) {
        log.debug("Getting candidates for run: {}, type filter: {}, status filter: {}", runId, type, status);

        boolean hasType = type != null && !type.isBlank();
        boolean hasStatus = status != null && !status.isBlank();

        List<DiscoveryCandidateEntity> entities;
        if (hasType && hasStatus) {
            entities = candidateRepository.findByRunIdAndCandidateTypeAndStatus(runId, type, status);
        } else if (hasType) {
            entities = candidateRepository.findByRunIdAndCandidateType(runId, type);
        } else if (hasStatus) {
            entities = candidateRepository.findByRunIdAndStatus(runId, status);
        } else {
            entities = candidateRepository.findByRunId(runId);
        }

        return entities.stream()
            .map(this::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Count candidates for a discovery run.
     *
     * @param runId the discovery run UUID
     * @return the number of candidates for the run
     */
    @Transactional(readOnly = true)
    public long countByRunId(UUID runId) {
        log.debug("Counting candidates for run: {}", runId);
        return candidateRepository.countByRunId(runId);
    }

    /**
     * Delete all candidates for a discovery run.
     *
     * Counts existing candidates before deletion for the return value, then deletes
     * all candidates matching the run ID. This supports delete-and-recreate semantics
     * for candidate updates after adjudication in Phase 1d.
     *
     * Spec: Phase 1d Candidate Generation (Increment 10)
     * Task Group 6: deleteByRunId for Candidate JPA Stack
     *
     * @param runId the discovery run UUID
     * @return the number of candidates deleted
     */
    @Transactional
    public long deleteByRunId(UUID runId) {
        log.debug("Deleting candidates for run: {}", runId);
        int count = candidateRepository.deleteByRunIdNative(runId);
        log.debug("Deleted {} candidates for run: {}", count, runId);
        return count;
    }

    /**
     * Update a candidate for a discovery run.
     *
     * Finds the existing candidate entity, updates fields from the provided DTO,
     * saves, and returns the updated DTO. Used primarily for status changes during
     * the review workflow.
     *
     * @param runId the discovery run UUID
     * @param candidateId the candidate UUID to update
     * @param update DTO containing the updated field values
     * @return the updated candidate DTO
     * @throws IllegalArgumentException if the candidate is not found or does not belong to the run
     */
    @Transactional
    public DiscoveryCandidateDto updateCandidate(UUID runId, UUID candidateId, DiscoveryCandidateDto update) {
        log.debug("Updating candidate {} for run: {}", candidateId, runId);

        DiscoveryCandidateEntity entity = candidateRepository.findById(candidateId)
            .orElseThrow(() -> new IllegalArgumentException("Candidate not found: " + candidateId));

        if (!entity.getRunId().equals(runId)) {
            throw new IllegalArgumentException("Candidate " + candidateId + " does not belong to run " + runId);
        }

        // Update fields from the DTO if they are non-null
        if (update.status() != null) {
            entity.setStatus(update.status());
        }
        // PATCH-style: only overwrite operation if supplied (null leaves the
        // persisted value alone, mirroring the confidence/review_status handling).
        if (update.operation() != null) {
            entity.setOperation(update.operation());
        }
        if (update.name() != null) {
            entity.setName(update.name());
        }
        if (update.candidateType() != null) {
            entity.setCandidateType(update.candidateType());
        }
        if (update.sourceClusterIds() != null) {
            entity.setSourceClusterIds(new ArrayList<>(update.sourceClusterIds()));
        }
        if (update.data() != null) {
            entity.setData(new HashMap<>(update.data()));
        }
        // Hotfix (2026-05-13): PATCH-style update -- only overwrite confidence
        // if the caller actually supplied it. The DTO field is now boxed
        // Double, so a null here means "field omitted in JSON body" and the
        // persisted value must NOT be clobbered. The previous unconditional
        // overwrite turned every save-back PATCH (which never sends
        // confidence) into a write of 0.0, hiding the committed row behind
        // the frontend's default 0.7 confidence-threshold filter.
        if (update.confidence() != null) {
            entity.setConfidence(update.confidence());
        }
        // Hotfix (2026-05-13): the MCP save-back PATCH sends review_status
        // (e.g. 'committed') so the UI can distinguish saved rows from
        // still-approved ones. The previous version of this method silently
        // dropped the field, leaving review_status stuck at 'approved' after
        // save and breaking the per-row Approve/Reject/Defer disable
        // predicate. We also propagate the review-audit trio when present so
        // the table can show who/when saved each row without a second
        // network round-trip. reviewCandidate() remains the canonical path
        // for the human review workflow (approve/reject/defer) -- this
        // branch only fires for the save-back path which uses the more
        // generic updateCandidate endpoint.
        if (update.reviewStatus() != null) {
            entity.setReviewStatus(update.reviewStatus());
        }
        if (update.reviewedBy() != null) {
            entity.setReviewedBy(update.reviewedBy());
        }
        if (update.reviewedAt() != null) {
            entity.setReviewedAt(Instant.parse(update.reviewedAt()));
        }
        if (update.previousReviewStatus() != null) {
            entity.setPreviousReviewStatus(update.previousReviewStatus());
        }

        DiscoveryCandidateEntity saved = candidateRepository.save(entity);
        log.debug("Updated candidate {} for run: {}", candidateId, runId);

        return toDto(saved);
    }

    /**
     * Review a candidate by updating its review workflow fields.
     *
     * Validates the review status, finds the candidate by ID, verifies it belongs
     * to the specified run, captures the previous review status, updates the review
     * fields, saves, and returns the updated DTO.
     *
     * This method is separate from updateCandidate() to keep review semantics
     * isolated from general-purpose candidate field updates.
     *
     * Spec: Candidate Review and Approval Workflow (Increment 13)
     * Task Group 2: reviewCandidate() for PATCH /review endpoint
     *
     * @param runId the discovery run UUID
     * @param candidateId the candidate UUID to review
     * @param reviewStatus the new review status (approved, rejected, or deferred)
     * @param reviewedBy optional label identifying who performed the review (defaults to "anonymous" if null/blank)
     * @return the updated candidate DTO
     * @throws IllegalArgumentException if reviewStatus is invalid, candidate is not found, or candidate does not belong to the run
     */
    @Transactional
    public DiscoveryCandidateDto reviewCandidate(UUID runId, UUID candidateId, String reviewStatus, String reviewedBy) {
        log.debug("Reviewing candidate {} for run: {} with status: {}", candidateId, runId, reviewStatus);

        // Validate reviewStatus
        if (reviewStatus == null || !VALID_REVIEW_STATUSES.contains(reviewStatus)) {
            throw new IllegalArgumentException("Invalid review_status: " + reviewStatus
                + ". Must be one of: approved, rejected, deferred");
        }

        // Find the candidate
        DiscoveryCandidateEntity entity = candidateRepository.findById(candidateId)
            .orElseThrow(() -> new IllegalArgumentException("Candidate not found: " + candidateId));

        // Verify it belongs to the run
        if (!entity.getRunId().equals(runId)) {
            throw new IllegalArgumentException("Candidate " + candidateId + " does not belong to run " + runId);
        }

        // Capture previous review status before overwriting
        String previousReviewStatus = entity.getReviewStatus();

        // Update review fields
        entity.setReviewStatus(reviewStatus);
        entity.setReviewedBy(reviewedBy != null && !reviewedBy.isBlank() ? reviewedBy : "anonymous");
        entity.setReviewedAt(Instant.now());
        entity.setPreviousReviewStatus(previousReviewStatus);

        DiscoveryCandidateEntity saved = candidateRepository.save(entity);
        log.debug("Reviewed candidate {} for run: {} - status changed from {} to {}",
            candidateId, runId, previousReviewStatus, reviewStatus);

        return toDto(saved);
    }

    /**
     * Durably resolve ONE conflicting attribute on a candidate.
     *
     * <p>Mirrors {@link #reviewCandidate} (focused, single-concern) rather than
     * round-tripping the whole candidate through {@link #updateCandidate}. It mutates
     * ONLY the candidate {@code data} JSONB map -- a passthrough column, so there is NO
     * schema / Liquibase change:</p>
     * <ul>
     *   <li>sets the canonical attribute slot {@code data[attr] = chosenValue};</li>
     *   <li>stamps {@code data._conflictResolutions[attr] = { chosenValue, chosenSource,
     *       resolvedBy, resolvedAt }} -- <b>camelCase keys</b>;</li>
     *   <li>removes {@code data._conflicts[attr]} (the conflict is no longer "live").</li>
     * </ul>
     *
     * <p><b>CRITICAL -- the resolution keys are camelCase.</b> Although the AMS wire is
     * snake_case by the global Jackson strategy (so the {@link
     * com.example.architecturemodel.model.dto.discovery.ResolveDiscoveryConflictRequest}
     * top-level fields are {@code chosen_value} / {@code chosen_source} / {@code resolved_by}
     * / {@code resolved_at}), the candidate {@code data} JSONB is a passthrough MAP whose
     * keys Jackson serializes VERBATIM (it does NOT snake_case map keys). The frontend
     * reader ({@code DiscoveryCandidateTable.tsx} {@code handleResolveConflicts} +
     * {@code ConflictResolutionModal} + the conflicts fixtures) reads camelCase. Stamping
     * snake_case here would silently break the grid + the conversation conflict reader --
     * the conflict would stay "live" forever despite being resolved in the DB. This write
     * shape therefore matches the grid's {@code handleResolveConflicts} payload exactly so a
     * future grid refactor can reuse the endpoint (that refactor is out of scope here).</p>
     *
     * <p><b>Committed-parity.</b> Like {@link #reviewCandidate} (the focused mirror target),
     * this write does NOT gate {@code status == 'committed'} rows. The committed-skip gate
     * lives only on the cascade bulk path ({@code DiscoveryCascadeReviewService}); the
     * single-candidate review path is ungated, so to stay consistent the single-attribute
     * resolve write is ungated too.</p>
     *
     * <p>The {@code data} map is defensively copied before mutation (new {@code HashMap}s for
     * {@code data}, {@code _conflicts}, {@code _conflictResolutions}) so the entity's pre-write
     * state is never mutated in place, mirroring the grid's optimistic-revert-safe clone.</p>
     *
     * <p>Spec: Conversational Discovery-Review "Architect" Persona (Spec 3, 2026-06-02)
     * Task Group 1: durable server-side conflict-resolution write.</p>
     *
     * @param runId the discovery run UUID
     * @param candidateId the candidate UUID whose conflict is being resolved
     * @param attr the conflicting attribute name (the key in {@code data._conflicts})
     * @param chosenValue the value chosen for {@code attr}
     * @param chosenSource the source the chosen value came from
     * @param resolvedBy freeform label identifying who resolved (defaults to "anonymous" if null/blank)
     * @param resolvedAt optional ISO-8601 timestamp; defaults to {@code Instant.now()} if null/blank
     * @return the updated candidate DTO
     * @throws IllegalArgumentException if {@code attr} is blank, the candidate is not found,
     *                                  or the candidate does not belong to the run
     */
    @Transactional
    public DiscoveryCandidateDto resolveConflict(
            UUID runId, UUID candidateId, String attr, Object chosenValue,
            String chosenSource, String resolvedBy, String resolvedAt) {
        log.debug("Resolving conflict on attr '{}' for candidate {} in run: {}", attr, candidateId, runId);

        // Validate the attribute name.
        if (attr == null || attr.isBlank()) {
            throw new IllegalArgumentException("attr is required to resolve a conflict");
        }

        // Find the candidate.
        DiscoveryCandidateEntity entity = candidateRepository.findById(candidateId)
            .orElseThrow(() -> new IllegalArgumentException("Candidate not found: " + candidateId));

        // Verify it belongs to the run (mirrors reviewCandidate / updateCandidate).
        if (!entity.getRunId().equals(runId)) {
            throw new IllegalArgumentException("Candidate " + candidateId + " does not belong to run " + runId);
        }

        // Defensive copy of the data map so we never mutate the pre-write state in
        // place (mirrors the grid's optimistic-revert-safe clone in handleResolveConflicts).
        Map<String, Object> data = entity.getData() != null
            ? new HashMap<>(entity.getData())
            : new HashMap<>();

        Map<String, Object> conflicts = asStringKeyedMap(data.get("_conflicts"));
        Map<String, Object> resolutions = asStringKeyedMap(data.get("_conflictResolutions"));

        // Canonical slot <- chosen value.
        data.put(attr, chosenValue);

        // Stamp the resolution with CAMELCASE keys (the frontend reads camelCase;
        // the data JSONB is a passthrough map Jackson never snake_cases).
        String resolvedByLabel = resolvedBy != null && !resolvedBy.isBlank() ? resolvedBy : "anonymous";
        String resolvedAtStamp = resolvedAt != null && !resolvedAt.isBlank()
            ? resolvedAt
            : Instant.now().toString();
        Map<String, Object> resolution = new HashMap<>();
        resolution.put("chosenValue", chosenValue);
        resolution.put("chosenSource", chosenSource);
        resolution.put("resolvedBy", resolvedByLabel);
        resolution.put("resolvedAt", resolvedAtStamp);
        resolutions.put(attr, resolution);

        // Clear the now-resolved conflict (no longer "live").
        conflicts.remove(attr);

        data.put("_conflicts", conflicts);
        data.put("_conflictResolutions", resolutions);
        entity.setData(data);

        DiscoveryCandidateEntity saved = candidateRepository.save(entity);
        log.debug("Resolved conflict on attr '{}' for candidate {} in run: {} (source={}, resolvedBy={})",
            attr, candidateId, runId, chosenSource, resolvedByLabel);

        return toDto(saved);
    }

    /**
     * Coerce a nested JSONB value into a mutable string-keyed map.
     *
     * The candidate {@code data} sub-objects ({@code _conflicts},
     * {@code _conflictResolutions}) deserialize as {@code Map<String, Object>}; this
     * returns a fresh mutable copy (or an empty map when the key is absent or the value
     * is not a map) so the write never mutates a shared/immutable sub-map in place.
     */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> asStringKeyedMap(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> copy = new HashMap<>();
            for (Map.Entry<?, ?> e : map.entrySet()) {
                copy.put(String.valueOf(e.getKey()), e.getValue());
            }
            return copy;
        }
        return new HashMap<>();
    }

    /**
     * Convert entity to DTO with ISO-8601 timestamp strings.
     *
     * Maps all entity fields including the four review workflow fields added
     * in Increment 13, the logEnrichment field added in Increment 14, and the
     * operation dimension added in the 2026-05-30 model-aware spec.
     * The reviewedAt Instant is converted to ISO-8601 string (null-safe).
     */
    DiscoveryCandidateDto toDto(DiscoveryCandidateEntity entity) {
        return new DiscoveryCandidateDto(
            entity.getId(),
            entity.getRunId(),
            entity.getCandidateType(),
            entity.getName(),
            entity.getConfidence(),
            entity.getStatus(),
            entity.getSourceClusterIds(),
            entity.getData(),
            entity.getSynthesizedAt().toString(),
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
