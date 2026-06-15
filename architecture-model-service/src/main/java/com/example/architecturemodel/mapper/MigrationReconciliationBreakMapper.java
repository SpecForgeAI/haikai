package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.MigrationReconciliationBreakDto;
import com.example.architecturemodel.model.entity.MigrationReconciliationBreakEntity;
import com.example.architecturemodel.model.entity.MigrationReconciliationBreakStatus;

import java.time.Instant;
import java.util.UUID;

/**
 * Mapper utility for converting between
 * {@link MigrationReconciliationBreakEntity} and
 * {@link MigrationReconciliationBreakDto}.
 *
 * <p>Static helper class to match the established AMS pattern (see
 * {@link MigrationExecutionRunMapper}). No MapStruct; the DTO is a record.</p>
 *
 * <p><b>PATCH semantics</b> live in
 * {@link #updateEntityFromDto(MigrationReconciliationBreakEntity, MigrationReconciliationBreakDto)}.
 * Every editable field on the DTO is null-guarded so an omitted JSON property
 * never silently wipes the column (the canonical
 * {@code project_primitive_double_dto_overwrite.md} pattern -- all DTO fields
 * are boxed reference types so a missing field arrives as {@code null}). This is
 * the load-bearing guard for the gateway loop's per-break advance: a PATCH that
 * sets only {@code dispositionStatus} (a human disposition) must leave
 * {@code attemptCount} / {@code bugId} / {@code circuitBroken} / {@code needsHuman}
 * intact; the {@code attemptCount} boxed {@link Integer} in particular must never
 * be reset to {@code 0} by an unrelated PATCH.</p>
 *
 * <p>Spec: Migration Reconciliation + Bug Loop (2026-06-14, Spec 4 of 4) --
 * Task Group 1.</p>
 */
public final class MigrationReconciliationBreakMapper {

    private MigrationReconciliationBreakMapper() {
        // Utility class - prevent instantiation
    }

    /**
     * Convert a break entity into its DTO wire shape. Timestamps are emitted as
     * ISO-8601 strings, matching the {@link MigrationExecutionRunMapper}
     * precedent. The boxed flags are normalised to a non-null value on read
     * (defensive: the DB columns are NOT NULL DEFAULT, but a directly-built
     * entity could carry null).
     *
     * @param entity the entity to convert; {@code null} returns {@code null}
     * @return the DTO representation
     */
    public static MigrationReconciliationBreakDto toDto(MigrationReconciliationBreakEntity entity) {
        if (entity == null) {
            return null;
        }
        return new MigrationReconciliationBreakDto(
            entity.getId(),
            entity.getRunId(),
            entity.getPinnedBaselineId(),
            entity.getSourceBaselineItemId(),
            entity.getDiffItemId(),
            entity.getDetailJson(),
            entity.getDispositionStatus(),
            entity.getBugId(),
            entity.getAttemptCount() != null ? entity.getAttemptCount() : 0,
            entity.getCircuitBroken() != null ? entity.getCircuitBroken() : Boolean.FALSE,
            entity.getNeedsHuman() != null ? entity.getNeedsHuman() : Boolean.FALSE,
            entity.getErrorDetail(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null,
            entity.getUpdatedAt() != null ? entity.getUpdatedAt().toString() : null
        );
    }

    /**
     * Build a fresh {@link MigrationReconciliationBreakEntity} from a DTO, bound
     * to the supplied {@code runId} (taken from the create context, never the
     * DTO body). A break is born {@code open} with attempt 0 unless the DTO
     * carries explicit values.
     *
     * @param dto   the break DTO
     * @param runId the owning reconcile run UUID
     * @return a fresh, unsaved entity ready for INSERT
     */
    public static MigrationReconciliationBreakEntity toNewEntity(
        MigrationReconciliationBreakDto dto, UUID runId) {
        if (dto == null) {
            return null;
        }
        Instant now = Instant.now();
        return MigrationReconciliationBreakEntity.builder()
            .id(dto.id() != null ? dto.id() : UUID.randomUUID())
            .runId(runId)
            .pinnedBaselineId(dto.pinnedBaselineId())
            .sourceBaselineItemId(dto.sourceBaselineItemId())
            .diffItemId(dto.diffItemId())
            .detailJson(dto.detailJson())
            .dispositionStatus(dto.dispositionStatus() != null
                ? dto.dispositionStatus()
                : MigrationReconciliationBreakStatus.OPEN)
            .bugId(dto.bugId())
            .attemptCount(dto.attemptCount() != null ? dto.attemptCount() : 0)
            .circuitBroken(dto.circuitBroken() != null ? dto.circuitBroken() : Boolean.FALSE)
            .needsHuman(dto.needsHuman() != null ? dto.needsHuman() : Boolean.FALSE)
            .errorDetail(dto.errorDetail())
            .createdAt(now)
            .updatedAt(now)
            .build();
    }

    /**
     * Apply PATCH-style updates onto a loaded break entity, null-guarding every
     * editable field. Omitted (null) DTO fields leave the existing column
     * untouched -- per {@code project_primitive_double_dto_overwrite.md}.
     *
     * <p>Editable fields: {@code dispositionStatus}, {@code bugId},
     * {@code attemptCount}, {@code circuitBroken}, {@code needsHuman},
     * {@code errorDetail}, {@code detailJson}. NOT editable: {@code id},
     * {@code runId}, {@code pinnedBaselineId}, {@code sourceBaselineItemId},
     * {@code diffItemId} (all set at create), {@code createdAt},
     * {@code updatedAt} (auto-managed by {@code @PreUpdate}).</p>
     *
     * @param entity the existing entity loaded from the DB
     * @param dto    the PATCH DTO
     */
    public static void updateEntityFromDto(
        MigrationReconciliationBreakEntity entity,
        MigrationReconciliationBreakDto dto) {
        if (entity == null || dto == null) {
            return;
        }
        if (dto.dispositionStatus() != null) {
            entity.setDispositionStatus(dto.dispositionStatus());
        }
        if (dto.bugId() != null) {
            entity.setBugId(dto.bugId());
        }
        if (dto.attemptCount() != null) {
            entity.setAttemptCount(dto.attemptCount());
        }
        if (dto.circuitBroken() != null) {
            entity.setCircuitBroken(dto.circuitBroken());
        }
        if (dto.needsHuman() != null) {
            entity.setNeedsHuman(dto.needsHuman());
        }
        if (dto.errorDetail() != null) {
            entity.setErrorDetail(dto.errorDetail());
        }
        if (dto.detailJson() != null) {
            entity.setDetailJson(dto.detailJson());
        }
    }
}
