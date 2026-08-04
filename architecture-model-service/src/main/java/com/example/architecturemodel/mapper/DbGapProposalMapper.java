package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.DbGapProposalDto;
import com.example.architecturemodel.model.entity.DbGapProposalEntity;

/**
 * Mapper utility for {@link DbGapProposalEntity} and its wire DTO.
 *
 * <p>Static helper class to match the established AMS pattern (see
 * {@link DbStructuralFindingDispositionMapper}). Entity-to-DTO only -- the
 * inverse direction is owned by
 * {@link com.example.architecturemodel.service.DbGapProposalService} because
 * the write path carries upsert/refresh-guard/validation policy that does not
 * belong in a policy-free mapper. Timestamps are emitted as ISO-8601 strings
 * (the {@code DiscoveryRunDto} precedent).</p>
 *
 * <p>Spec: LLM gap-proposal queue (2026-08-04) -- Spec 4.</p>
 */
public final class DbGapProposalMapper {

    private DbGapProposalMapper() {
        // Utility class - prevent instantiation
    }

    /** Convert a gap-proposal entity to its wire DTO; {@code null} returns {@code null}. */
    public static DbGapProposalDto toDto(DbGapProposalEntity entity) {
        if (entity == null) {
            return null;
        }
        return new DbGapProposalDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getProposalKey(),
            entity.getFindingKey(),
            entity.getKind(),
            entity.getPayloadJson(),
            entity.getRationale(),
            entity.getConfidence(),
            entity.getOrigin(),
            entity.getReviewStatus(),
            entity.getReviewerNotes(),
            entity.getAppliedAt() != null ? entity.getAppliedAt().toString() : null,
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null,
            entity.getReviewedAt() != null ? entity.getReviewedAt().toString() : null
        );
    }
}
