package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.DbMigrationPackDecisionDto;
import com.example.architecturemodel.model.dto.DbMigrationPackDriftReportDto;
import com.example.architecturemodel.model.dto.DbMigrationPackDto;
import com.example.architecturemodel.model.dto.DbMigrationPackFileDto;
import com.example.architecturemodel.model.dto.DbMigrationPackTranslationDto;
import com.example.architecturemodel.model.entity.DbMigrationPackDecisionEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackDriftReportEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackFileEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackTranslationEntity;

/**
 * Mapper utility for the five DB migration pack entities and their DTOs
 * (packs / files / decisions / drift reports, Spec 1; translations, Spec 2
 * 2026-06-11 TG2).
 *
 * <p>Static helper class to match the established AMS pattern (see
 * {@link GeneratedMigrationBookOfWorkMapper}). Entity-to-DTO only -- the
 * inverse direction is owned by
 * {@link com.example.architecturemodel.service.DbMigrationPackService}
 * because the write paths carry upsert/re-link/null-guard policy that does
 * not belong in a policy-free mapper. Timestamps are emitted as ISO-8601
 * strings (the {@code DiscoveryRunDto} precedent).</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 */
public final class DbMigrationPackMapper {

    private DbMigrationPackMapper() {
        // Utility class - prevent instantiation
    }

    /** Convert a pack entity to its wire DTO; {@code null} returns {@code null}. */
    public static DbMigrationPackDto toDto(DbMigrationPackEntity entity) {
        if (entity == null) {
            return null;
        }
        return new DbMigrationPackDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getArchitectureId(),
            entity.getStatus(),
            entity.getStaleReason(),
            entity.getInputSnapshotHash(),
            entity.getGeneratedAt() != null ? entity.getGeneratedAt().toString() : null,
            entity.getWorkItemId(),
            entity.getTranslatedCount(),
            entity.getSkippedCount(),
            entity.getFlaggedCount(),
            entity.getSeedMargin(),
            entity.getManifestJson(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null,
            entity.getUpdatedAt() != null ? entity.getUpdatedAt().toString() : null
        );
    }

    /** Convert a file entity to its wire DTO; {@code null} returns {@code null}. */
    public static DbMigrationPackFileDto toDto(DbMigrationPackFileEntity entity) {
        if (entity == null) {
            return null;
        }
        return new DbMigrationPackFileDto(
            entity.getId(),
            entity.getPackId(),
            entity.getFilePath(),
            entity.getFileKind(),
            entity.getContent(),
            entity.getSortOrder()
        );
    }

    /** Convert a decision entity to its wire DTO; {@code null} returns {@code null}. */
    public static DbMigrationPackDecisionDto toDto(DbMigrationPackDecisionEntity entity) {
        if (entity == null) {
            return null;
        }
        return new DbMigrationPackDecisionDto(
            entity.getId(),
            entity.getPackId(),
            entity.getDecisionKey(),
            entity.getObjectRef(),
            entity.getCategory(),
            entity.getQuestion(),
            entity.getOptionsJson(),
            entity.getResolutionJson(),
            entity.getStatus(),
            entity.getResolvedAt() != null ? entity.getResolvedAt().toString() : null,
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null,
            entity.getUpdatedAt() != null ? entity.getUpdatedAt().toString() : null
        );
    }

    /** Convert a drift-report entity to its wire DTO; {@code null} returns {@code null}. */
    public static DbMigrationPackDriftReportDto toDto(DbMigrationPackDriftReportEntity entity) {
        if (entity == null) {
            return null;
        }
        return new DbMigrationPackDriftReportDto(
            entity.getId(),
            entity.getPackId(),
            entity.getScanScopeJson(),
            entity.getMatchCount(),
            entity.getMissingCount(),
            entity.getMismatchCount(),
            entity.getReportJson(),
            entity.getSource(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null
        );
    }
    /** Convert a translation entity to its wire DTO; {@code null} returns {@code null}. */
    public static DbMigrationPackTranslationDto toDto(DbMigrationPackTranslationEntity entity) {
        if (entity == null) {
            return null;
        }
        return new DbMigrationPackTranslationDto(
            entity.getId(),
            entity.getPackId(),
            entity.getTranslationKey(),
            entity.getObjectRef(),
            entity.getKind(),
            entity.getDisposition(),
            entity.getDropReason(),
            entity.getPipelineState(),
            entity.getSourceBody(),
            entity.getSourceBodyHash(),
            entity.getTruncated(),
            entity.getLegacyRedacted(),
            entity.getRoutineId(),
            entity.getDraftContent(),
            entity.getJudgeVerdictJson(),
            entity.getReviewStatus(),
            entity.getReviewerNotes(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null,
            entity.getTranslatedAt() != null ? entity.getTranslatedAt().toString() : null,
            entity.getReviewedAt() != null ? entity.getReviewedAt().toString() : null
        );
    }
}
