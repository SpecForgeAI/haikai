package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.MigrationExecutionRunDto;
import com.example.architecturemodel.model.dto.MigrationExecutionRunItemDto;
import com.example.architecturemodel.model.entity.MigrationExecutionRunEntity;
import com.example.architecturemodel.model.entity.MigrationExecutionRunItemEntity;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Mapper utility for converting between {@link MigrationExecutionRunEntity} and
 * {@link MigrationExecutionRunDto}.
 *
 * <p>Static helper class to match the established AMS pattern (see
 * {@link MigrationStorySpecGenerationMapper}). No MapStruct; the DTO is a record
 * and the column count is small enough that a hand-rolled mapper is the readable
 * choice.</p>
 *
 * <p><b>PATCH semantics</b> live in
 * {@link #updateEntityFromDto(MigrationExecutionRunEntity, MigrationExecutionRunDto)}.
 * Every editable field on the DTO is null-guarded so an omitted JSON property
 * never silently wipes the column (the canonical
 * {@code project_primitive_double_dto_overwrite.md} pattern -- all DTO fields
 * are boxed reference types so a missing field arrives as {@code null}). This is
 * particularly important for {@code currentSequencePosition} (boxed
 * {@link Integer}): an unrelated PATCH must never reset the run's advance
 * position.</p>
 *
 * <p>Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 1.</p>
 */
public final class MigrationExecutionRunMapper {

    private MigrationExecutionRunMapper() {
        // Utility class - prevent instantiation
    }

    /**
     * Convert a run entity into its DTO wire shape WITHOUT the nested run-items
     * (used by create / PATCH / list responses). Timestamps are emitted as
     * ISO-8601 strings, matching the {@link MigrationStorySpecGenerationMapper}
     * precedent.
     *
     * @param entity the entity to convert; {@code null} returns {@code null}
     * @return the DTO representation, {@code items == null}
     */
    public static MigrationExecutionRunDto toDto(MigrationExecutionRunEntity entity) {
        if (entity == null) {
            return null;
        }
        return new MigrationExecutionRunDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getCompany(),
            entity.getProject(),
            entity.getBookOfWorkId(),
            entity.getStatus(),
            entity.getCurrentSequencePosition(),
            entity.getPinnedCurrentBaselineId(),
            entity.getTargetBaseUrl(),
            entity.getBaseSpec(),
            entity.getDecisionLogJson(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null,
            entity.getUpdatedAt() != null ? entity.getUpdatedAt().toString() : null
        );
    }

    /**
     * Convert a run entity into its DTO wire shape WITH the ordered nested
     * run-items (used by the run-state read endpoint that powers the
     * run-progress view).
     *
     * @param entity the run entity; {@code null} returns {@code null}
     * @param items  the ordered per-spec run-item entities (may be empty/null)
     * @return the DTO representation with {@code items} populated
     */
    public static MigrationExecutionRunDto toDtoWithItems(
        MigrationExecutionRunEntity entity,
        List<MigrationExecutionRunItemEntity> items) {
        if (entity == null) {
            return null;
        }
        List<MigrationExecutionRunItemDto> itemDtos = items == null ? null
            : items.stream().map(MigrationExecutionRunItemMapper::toDto).toList();
        return new MigrationExecutionRunDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getCompany(),
            entity.getProject(),
            entity.getBookOfWorkId(),
            entity.getStatus(),
            entity.getCurrentSequencePosition(),
            entity.getPinnedCurrentBaselineId(),
            entity.getTargetBaseUrl(),
            entity.getBaseSpec(),
            entity.getDecisionLogJson(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null,
            entity.getUpdatedAt() != null ? entity.getUpdatedAt().toString() : null,
            itemDtos
        );
    }

    /**
     * Build a fresh {@link MigrationExecutionRunEntity} from a create-request
     * DTO. The {@code projectId} is taken from the URL path variable and
     * overrides whatever the DTO may carry, matching the established AMS
     * controller convention.
     *
     * @param dto       the create-request DTO
     * @param projectId the project UUID from the URL path
     * @return a fresh, unsaved entity ready for INSERT
     */
    public static MigrationExecutionRunEntity toNewEntity(
        MigrationExecutionRunDto dto, UUID projectId) {
        if (dto == null) {
            return null;
        }
        Instant now = Instant.now();
        return MigrationExecutionRunEntity.builder()
            .id(dto.id() != null ? dto.id() : UUID.randomUUID())
            .projectId(projectId)
            // Scope NAMES (changeset 219): set once at creation for the
            // cross-project boot-recovery discovery; never PATCHed.
            .company(dto.company())
            .project(dto.project())
            .bookOfWorkId(dto.bookOfWorkId())
            .status(dto.status())
            .currentSequencePosition(dto.currentSequencePosition())
            .pinnedCurrentBaselineId(dto.pinnedCurrentBaselineId())
            .targetBaseUrl(dto.targetBaseUrl())
            .baseSpec(dto.baseSpec())
            .decisionLogJson(dto.decisionLogJson())
            .createdAt(now)
            .updatedAt(now)
            .build();
    }

    /**
     * Apply PATCH-style updates onto a loaded run entity, null-guarding every
     * editable field. Omitted (null) DTO fields leave the existing column
     * untouched -- per {@code project_primitive_double_dto_overwrite.md}.
     *
     * <p>Editable fields: {@code status}, {@code currentSequencePosition},
     * {@code pinnedCurrentBaselineId}, {@code targetBaseUrl}, {@code baseSpec},
     * {@code decisionLogJson}. NOT editable: {@code id}, {@code projectId},
     * {@code bookOfWorkId}, {@code createdAt}, {@code updatedAt} (auto-managed by
     * {@code @PreUpdate}).</p>
     *
     * @param entity the existing entity loaded from the DB
     * @param dto    the PATCH DTO
     */
    public static void updateEntityFromDto(
        MigrationExecutionRunEntity entity,
        MigrationExecutionRunDto dto) {
        if (entity == null || dto == null) {
            return;
        }
        if (dto.status() != null) {
            entity.setStatus(dto.status());
        }
        if (dto.currentSequencePosition() != null) {
            entity.setCurrentSequencePosition(dto.currentSequencePosition());
        }
        if (dto.pinnedCurrentBaselineId() != null) {
            entity.setPinnedCurrentBaselineId(dto.pinnedCurrentBaselineId());
        }
        if (dto.targetBaseUrl() != null) {
            entity.setTargetBaseUrl(dto.targetBaseUrl());
        }
        if (dto.baseSpec() != null) {
            entity.setBaseSpec(dto.baseSpec());
        }
        if (dto.decisionLogJson() != null) {
            entity.setDecisionLogJson(dto.decisionLogJson());
        }
    }
}
