package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.MigrationExecutionRunItemDto;
import com.example.architecturemodel.model.entity.MigrationExecutionRunItemEntity;

import java.time.Instant;
import java.util.UUID;

/**
 * Mapper utility for converting between
 * {@link MigrationExecutionRunItemEntity} and
 * {@link MigrationExecutionRunItemDto}.
 *
 * <p>Static helper class to match the established AMS pattern (see
 * {@link MigrationStorySpecGenerationMapper}). No MapStruct; the DTO is a
 * record.</p>
 *
 * <p><b>PATCH semantics</b> live in
 * {@link #updateEntityFromDto(MigrationExecutionRunItemEntity, MigrationExecutionRunItemDto)}.
 * Every editable field on the DTO is null-guarded so an omitted JSON property
 * never silently wipes the column (the canonical
 * {@code project_primitive_double_dto_overwrite.md} pattern). This is the
 * load-bearing guard for the Driver's per-spec advance: a PATCH that sets only
 * {@code outcome} (or only appends to the decision log) must leave
 * {@code dispatched} / {@code job_id} / {@code branch} / {@code pr_url} intact.
 * The two boolean flags ({@code dispatched} / {@code deployOnComplete}) are
 * boxed {@link Boolean} so a missing field arrives as {@code null}, not a
 * primitive {@code false} that would clobber the persisted value.</p>
 *
 * <p>Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 1.</p>
 */
public final class MigrationExecutionRunItemMapper {

    private MigrationExecutionRunItemMapper() {
        // Utility class - prevent instantiation
    }

    /**
     * Convert a run-item entity into its DTO wire shape. Timestamps are emitted
     * as ISO-8601 strings.
     *
     * @param entity the entity to convert; {@code null} returns {@code null}
     * @return the DTO representation
     */
    public static MigrationExecutionRunItemDto toDto(MigrationExecutionRunItemEntity entity) {
        if (entity == null) {
            return null;
        }
        return new MigrationExecutionRunItemDto(
            entity.getId(),
            entity.getRunId(),
            entity.getSequencePosition(),
            entity.getWorkItemId(),
            entity.getSpecGenerationId(),
            entity.getSpecName(),
            entity.getStatus(),
            entity.getDispatched() != null ? entity.getDispatched() : Boolean.FALSE,
            entity.getJobId(),
            entity.getBranch(),
            entity.getPrUrl(),
            entity.getOutcome(),
            entity.getDeployOnComplete() != null ? entity.getDeployOnComplete() : Boolean.FALSE,
            entity.getTargetBaseUrl(),
            entity.getErrorDetail(),
            entity.getAutoAnswerDecisionLogJson(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null,
            entity.getUpdatedAt() != null ? entity.getUpdatedAt().toString() : null
        );
    }

    /**
     * Build a fresh {@link MigrationExecutionRunItemEntity} from a DTO, bound to
     * the supplied {@code runId} (taken from the create-run context, never the
     * DTO body).
     *
     * @param dto   the run-item DTO
     * @param runId the owning run UUID
     * @return a fresh, unsaved entity ready for INSERT
     */
    public static MigrationExecutionRunItemEntity toNewEntity(
        MigrationExecutionRunItemDto dto, UUID runId) {
        if (dto == null) {
            return null;
        }
        Instant now = Instant.now();
        return MigrationExecutionRunItemEntity.builder()
            .id(dto.id() != null ? dto.id() : UUID.randomUUID())
            .runId(runId)
            .sequencePosition(dto.sequencePosition())
            .workItemId(dto.workItemId())
            .specGenerationId(dto.specGenerationId())
            .specName(dto.specName())
            .status(dto.status())
            .dispatched(dto.dispatched() != null ? dto.dispatched() : Boolean.FALSE)
            .jobId(dto.jobId())
            .branch(dto.branch())
            .prUrl(dto.prUrl())
            .outcome(dto.outcome())
            .deployOnComplete(dto.deployOnComplete() != null ? dto.deployOnComplete() : Boolean.FALSE)
            .targetBaseUrl(dto.targetBaseUrl())
            .errorDetail(dto.errorDetail())
            .autoAnswerDecisionLogJson(dto.autoAnswerDecisionLogJson())
            .createdAt(now)
            .updatedAt(now)
            .build();
    }

    /**
     * Apply PATCH-style updates onto a loaded run-item entity, null-guarding
     * every editable field. Omitted (null) DTO fields leave the existing column
     * untouched -- per {@code project_primitive_double_dto_overwrite.md}.
     *
     * <p>Editable fields: {@code specName}, {@code status}, {@code dispatched},
     * {@code jobId}, {@code branch}, {@code prUrl}, {@code outcome},
     * {@code deployOnComplete}, {@code targetBaseUrl}, {@code errorDetail},
     * {@code autoAnswerDecisionLogJson}. NOT editable: {@code id},
     * {@code runId}, {@code sequencePosition}, {@code workItemId},
     * {@code specGenerationId} (set at create-run), {@code createdAt},
     * {@code updatedAt} (auto-managed by {@code @PreUpdate}).</p>
     *
     * @param entity the existing entity loaded from the DB
     * @param dto    the PATCH DTO
     */
    public static void updateEntityFromDto(
        MigrationExecutionRunItemEntity entity,
        MigrationExecutionRunItemDto dto) {
        if (entity == null || dto == null) {
            return;
        }
        if (dto.specName() != null) {
            entity.setSpecName(dto.specName());
        }
        if (dto.status() != null) {
            entity.setStatus(dto.status());
        }
        if (dto.dispatched() != null) {
            entity.setDispatched(dto.dispatched());
        }
        if (dto.jobId() != null) {
            entity.setJobId(dto.jobId());
        }
        if (dto.branch() != null) {
            entity.setBranch(dto.branch());
        }
        if (dto.prUrl() != null) {
            entity.setPrUrl(dto.prUrl());
        }
        if (dto.outcome() != null) {
            entity.setOutcome(dto.outcome());
        }
        if (dto.deployOnComplete() != null) {
            entity.setDeployOnComplete(dto.deployOnComplete());
        }
        if (dto.targetBaseUrl() != null) {
            entity.setTargetBaseUrl(dto.targetBaseUrl());
        }
        if (dto.errorDetail() != null) {
            entity.setErrorDetail(dto.errorDetail());
        }
        if (dto.autoAnswerDecisionLogJson() != null) {
            entity.setAutoAnswerDecisionLogJson(dto.autoAnswerDecisionLogJson());
        }
    }
}
