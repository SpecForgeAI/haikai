package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.DbGapProposalMapper;
import com.example.architecturemodel.model.dto.DbGapProposalDto;
import com.example.architecturemodel.model.dto.UpdateDbGapProposalRequest;
import com.example.architecturemodel.model.dto.UpsertDbGapProposalsRequest;
import com.example.architecturemodel.model.entity.DbGapProposalEntity;
import com.example.architecturemodel.repository.entity.DbGapProposalRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Service for the per-project DB gap-proposal queue rows
 * ({@code db_gap_proposals}, changeset 216) -- the AMS half of Spec 4 (LLM
 * gap-proposal queue). The gateway/LLM loop owns proposal derivation and the
 * model write-back; AMS persists the queue and its review state only.
 *
 * <p>Rows are keyed by {@code project_id} + the stable {@code proposal_key}
 * identity ({@code fk--<relationship_id>} / {@code pk--<table>}) -- NOT by
 * pack -- so proposals and their human review state survive pack
 * regeneration.</p>
 *
 * <p><b>Operations:</b></p>
 * <ul>
 *   <li>{@link #listByProject(UUID, String)} -- the read surface, oldest
 *       first, optionally filtered by {@code finding_key}.</li>
 *   <li>{@link #bulkUpsert(UUID, UpsertDbGapProposalsRequest)} -- upsert by
 *       {@code proposal_key}. NEW keys create {@code unreviewed} rows;
 *       EXISTING rows are refreshed ({@code payload_json} / {@code rationale}
 *       / {@code confidence}) ONLY while still {@code unreviewed} -- reviewed
 *       rows (approved / rejected / needs_rework) are human state, left
 *       verbatim but still returned.</li>
 *   <li>{@link #patch(UUID, UUID, UpdateDbGapProposalRequest)} -- sparse
 *       review update; a supplied {@code review_status} stamps
 *       {@code reviewed_at}; {@code applied_at} records the successful model
 *       write-back.</li>
 *   <li>{@link #delete(UUID, UUID)} -- remove a proposal (404 when
 *       absent).</li>
 * </ul>
 *
 * <p>Modeled structurally on {@link DbStructuralFindingDispositionService};
 * identical {@code @ConditionalOnProperty} guard for the no-database profile.
 * Structured diagnostic log lines use the
 * {@code [diag-ams] db_gap_proposal} prefix.</p>
 *
 * <p>Spec: LLM gap-proposal queue (2026-08-04) -- Spec 4.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DbGapProposalService {

    private final DbGapProposalRepository repository;

    // -----------------------------------------------------------------
    // Read surface
    // -----------------------------------------------------------------

    /**
     * All proposal rows for a project, oldest first (stable list order).
     * A non-blank {@code findingKey} narrows to that structural finding.
     */
    @Transactional(readOnly = true)
    public List<DbGapProposalDto> listByProject(UUID projectId, String findingKey) {
        if (projectId == null) {
            throw new IllegalArgumentException("project_id is required");
        }
        List<DbGapProposalEntity> rows =
            (findingKey == null || findingKey.isBlank())
                ? repository.findByProjectIdOrderByCreatedAtAsc(projectId)
                : repository.findByProjectIdAndFindingKeyOrderByCreatedAtAsc(
                    projectId, findingKey);
        return rows.stream().map(DbGapProposalMapper::toDto).toList();
    }

    // -----------------------------------------------------------------
    // Bulk upsert by proposal_key (survives pack regeneration)
    // -----------------------------------------------------------------

    /**
     * Bulk upsert by {@code proposal_key}. NEW keys create rows with
     * {@code review_status=unreviewed} (origin defaults to {@code llm});
     * EXISTING rows are refreshed ({@code payload_json} / {@code rationale} /
     * {@code confidence}) ONLY while still {@code unreviewed} -- approved /
     * rejected / needs_rework rows are left verbatim, but are still returned
     * so the caller sees the full batch state.
     *
     * @return the post-upsert DTOs for every proposal in the batch, in batch
     *     order
     * @throws IllegalArgumentException empty batch, blank / in-batch duplicate
     *     {@code proposal_key}, blank {@code finding_key}, missing
     *     {@code payload_json}, or an invalid {@code kind} / {@code origin} /
     *     {@code confidence} enum value (400)
     */
    @Transactional
    public List<DbGapProposalDto> bulkUpsert(
        UUID projectId, UpsertDbGapProposalsRequest request) {
        if (projectId == null) {
            throw new IllegalArgumentException("project_id is required");
        }
        if (request == null || request.proposals() == null
            || request.proposals().isEmpty()) {
            throw new IllegalArgumentException(
                "proposals is required and must be non-empty");
        }

        // Validate the WHOLE batch up front -- all-or-nothing (the
        // transaction rolls back on any bad item, so no partial writes).
        Set<String> seenKeys = new HashSet<>();
        for (UpsertDbGapProposalsRequest.Proposal proposal : request.proposals()) {
            validateProposal(proposal, seenKeys);
        }

        List<DbGapProposalDto> results = new ArrayList<>(request.proposals().size());
        int created = 0;
        int refreshed = 0;
        int preserved = 0;
        for (UpsertDbGapProposalsRequest.Proposal proposal : request.proposals()) {
            Optional<DbGapProposalEntity> prior =
                repository.findByProjectIdAndProposalKey(
                    projectId, proposal.proposalKey());
            DbGapProposalEntity entity;
            if (prior.isEmpty()) {
                // NEW proposal: created unreviewed; origin defaults to llm.
                entity = DbGapProposalEntity.builder()
                    .id(UUID.randomUUID())
                    .projectId(projectId)
                    .proposalKey(proposal.proposalKey())
                    .findingKey(proposal.findingKey())
                    .kind(proposal.kind())
                    .payloadJson(proposal.payloadJson())
                    .rationale(blankToNull(proposal.rationale()))
                    .confidence(proposal.confidence())
                    .origin(proposal.origin() != null
                        ? proposal.origin()
                        : DbGapProposalEntity.ORIGIN_LLM)
                    .reviewStatus(DbGapProposalEntity.REVIEW_UNREVIEWED)
                    .createdAt(Instant.now())
                    .build();
                entity = repository.save(entity);
                created++;
            } else if (DbGapProposalEntity.REVIEW_UNREVIEWED
                .equals(prior.get().getReviewStatus())) {
                // Still unreviewed: refresh the proposal content ONLY
                // (payload_json / rationale / confidence). Identity fields
                // (proposal_key / finding_key / kind / origin) and review
                // state are not refresh material.
                entity = prior.get();
                entity.setPayloadJson(proposal.payloadJson());
                entity.setRationale(blankToNull(proposal.rationale()));
                entity.setConfidence(proposal.confidence());
                entity = repository.save(entity);
                refreshed++;
            } else {
                // Reviewed (approved / rejected / needs_rework): HUMAN state.
                // Leave the row verbatim -- but still return it so the caller
                // sees the full batch.
                entity = prior.get();
                preserved++;
            }
            results.add(DbGapProposalMapper.toDto(entity));
        }
        log.info(
            "[diag-ams] db_gap_proposal stage=bulk_upsert projectId={} batch={} "
                + "created={} refreshed={} preservedReviewed={}",
            projectId, request.proposals().size(), created, refreshed, preserved);
        return results;
    }

    // -----------------------------------------------------------------
    // Sparse PATCH (review + applied stamping)
    // -----------------------------------------------------------------

    /**
     * Sparse review update: only supplied fields are applied. A supplied
     * {@code review_status} stamps {@code reviewed_at}; {@code applied_at}
     * (ISO-8601) records the successful model write-back.
     *
     * @throws ResourceNotFoundException unknown project/proposal id pair (404)
     * @throws IllegalArgumentException invalid {@code review_status} enum or
     *     unparseable {@code applied_at} (400)
     */
    @Transactional
    public DbGapProposalDto patch(
        UUID projectId, UUID proposalId, UpdateDbGapProposalRequest request) {
        if (projectId == null) {
            throw new IllegalArgumentException("project_id is required");
        }
        if (proposalId == null) {
            throw new IllegalArgumentException("proposal id is required");
        }
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        DbGapProposalEntity entity =
            repository.findByIdAndProjectId(proposalId, projectId)
                .orElseThrow(() -> new ResourceNotFoundException(
                    "DB gap proposal not found: " + proposalId));

        if (request.reviewStatus() != null) {
            validateValue("review_status", request.reviewStatus(),
                DbGapProposalEntity.ALL_REVIEW_STATUSES);
            entity.setReviewStatus(request.reviewStatus());
            entity.setReviewedAt(Instant.now());
        }
        if (request.reviewerNotes() != null) {
            entity.setReviewerNotes(blankToNull(request.reviewerNotes()));
        }
        if (request.appliedAt() != null) {
            try {
                entity.setAppliedAt(Instant.parse(request.appliedAt()));
            } catch (DateTimeParseException e) {
                throw new IllegalArgumentException(
                    "applied_at must be an ISO-8601 instant, got '"
                        + request.appliedAt() + "'");
            }
        }

        DbGapProposalEntity saved = repository.save(entity);
        log.info(
            "[diag-ams] db_gap_proposal stage=patch projectId={} proposalId={} "
                + "proposalKey={} reviewStatus={} appliedAt={}",
            projectId, proposalId, saved.getProposalKey(),
            saved.getReviewStatus(), saved.getAppliedAt());
        return DbGapProposalMapper.toDto(saved);
    }

    // -----------------------------------------------------------------
    // Delete
    // -----------------------------------------------------------------

    /**
     * Remove a proposal row.
     *
     * @throws ResourceNotFoundException unknown project/proposal id pair (404)
     */
    @Transactional
    public void delete(UUID projectId, UUID proposalId) {
        DbGapProposalEntity entity =
            repository.findByIdAndProjectId(proposalId, projectId)
                .orElseThrow(() -> new ResourceNotFoundException(
                    "DB gap proposal not found: " + proposalId));
        repository.delete(entity);
        log.info(
            "[diag-ams] db_gap_proposal stage=delete projectId={} proposalId={} proposalKey={}",
            projectId, proposalId, entity.getProposalKey());
    }

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------

    /**
     * Per-item batch validation: identity fields present, enums valid,
     * {@code proposal_key} unique within the batch.
     */
    private static void validateProposal(
        UpsertDbGapProposalsRequest.Proposal proposal, Set<String> seenKeys) {
        if (proposal == null) {
            throw new IllegalArgumentException("proposals must not contain null items");
        }
        if (proposal.proposalKey() == null || proposal.proposalKey().isBlank()) {
            throw new IllegalArgumentException("proposal_key is required");
        }
        if (!seenKeys.add(proposal.proposalKey())) {
            throw new IllegalArgumentException(
                "duplicate proposal_key in batch: '" + proposal.proposalKey() + "'");
        }
        if (proposal.findingKey() == null || proposal.findingKey().isBlank()) {
            throw new IllegalArgumentException(
                "finding_key is required for proposal '" + proposal.proposalKey() + "'");
        }
        if (proposal.kind() == null) {
            throw new IllegalArgumentException(
                "kind is required for proposal '" + proposal.proposalKey()
                    + "'; allowed values: " + DbGapProposalEntity.ALL_KINDS);
        }
        validateValue("kind", proposal.kind(), DbGapProposalEntity.ALL_KINDS);
        if (proposal.payloadJson() == null || proposal.payloadJson().isEmpty()) {
            throw new IllegalArgumentException(
                "payload_json is required for proposal '" + proposal.proposalKey() + "'");
        }
        if (proposal.origin() != null) {
            validateValue("origin", proposal.origin(), DbGapProposalEntity.ALL_ORIGINS);
        }
        if (proposal.confidence() != null) {
            validateValue("confidence", proposal.confidence(),
                DbGapProposalEntity.ALL_CONFIDENCES);
        }
    }

    private static void validateValue(String field, String value, Set<String> allowed) {
        if (!allowed.contains(value)) {
            throw new IllegalArgumentException(
                "Invalid " + field + " '" + value + "'; allowed values: " + allowed);
        }
    }

    private static String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value;
    }
}
