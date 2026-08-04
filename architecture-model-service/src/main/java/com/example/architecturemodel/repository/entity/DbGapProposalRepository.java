package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DbGapProposalEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link DbGapProposalEntity}.
 *
 * <p>{@link #findByProjectIdAndProposalKey(UUID, String)} backs the
 * upsert-by-proposal_key re-link semantics (unique index
 * {@code uq_dgp_project_proposal_key}, changeset 216): a re-proposed gap
 * refreshes the existing project-scoped row (when still unreviewed) instead
 * of duplicating it.</p>
 *
 * <p>Spec: LLM gap-proposal queue (2026-08-04) -- Spec 4.</p>
 */
@Repository
public interface DbGapProposalRepository
    extends JpaRepository<DbGapProposalEntity, UUID> {

    /** All proposal rows for a project, oldest first (stable list order). */
    List<DbGapProposalEntity> findByProjectIdOrderByCreatedAtAsc(UUID projectId);

    /** Proposal rows for one structural finding, oldest first (idx_dgp_project_finding). */
    List<DbGapProposalEntity> findByProjectIdAndFindingKeyOrderByCreatedAtAsc(
        UUID projectId, String findingKey);

    /** The upsert/re-link lookup by stable proposal key. */
    Optional<DbGapProposalEntity> findByProjectIdAndProposalKey(
        UUID projectId, String proposalKey);

    /** Project-scoped row lookup for PATCH / DELETE (unknown pair -> 404). */
    Optional<DbGapProposalEntity> findByIdAndProjectId(UUID id, UUID projectId);
}
