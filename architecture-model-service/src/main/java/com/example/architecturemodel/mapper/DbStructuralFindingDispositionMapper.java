package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.DbStructuralFindingDispositionDto;
import com.example.architecturemodel.model.entity.DbStructuralFindingDispositionEntity;

/**
 * Mapper utility for {@link DbStructuralFindingDispositionEntity} and its
 * wire DTO.
 *
 * <p>Static helper class to match the established AMS pattern (see
 * {@link DbMigrationPackMapper}). Entity-to-DTO only -- the inverse direction
 * is owned by
 * {@link com.example.architecturemodel.service.DbStructuralFindingDispositionService}
 * because the write path carries upsert/sparse-merge/validation policy that
 * does not belong in a policy-free mapper. Timestamps are emitted as ISO-8601
 * strings (the {@code DiscoveryRunDto} precedent).</p>
 *
 * <p>Spec: Structural findings dispositions (2026-08-04) -- Spec 2.</p>
 */
public final class DbStructuralFindingDispositionMapper {

    private DbStructuralFindingDispositionMapper() {
        // Utility class - prevent instantiation
    }

    /** Convert a disposition entity to its wire DTO; {@code null} returns {@code null}. */
    public static DbStructuralFindingDispositionDto toDto(
        DbStructuralFindingDispositionEntity entity) {
        if (entity == null) {
            return null;
        }
        return new DbStructuralFindingDispositionDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getFindingKey(),
            entity.getKind(),
            entity.getSubject(),
            entity.getDisposition(),
            entity.getNote(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null,
            entity.getUpdatedAt() != null ? entity.getUpdatedAt().toString() : null
        );
    }
}
