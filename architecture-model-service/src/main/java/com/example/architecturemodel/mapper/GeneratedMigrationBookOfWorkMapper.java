package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.GeneratedMigrationBookOfWorkDto;
import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkEntity;
import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkStatus;

import java.time.Instant;
import java.util.UUID;

/**
 * Mapper utility for converting between {@link GeneratedMigrationBookOfWorkEntity}
 * and {@link GeneratedMigrationBookOfWorkDto}.
 *
 * <p>Static helper class to match the established AMS pattern (see
 * {@link WorkItemMapper}, {@code ProjectMapper}, {@code DeliveryTeamMapper},
 * etc.). No MapStruct -- the DTO is a record and the column count is small
 * enough that a hand-rolled mapper is the readable choice.</p>
 *
 * <p><b>PATCH semantics</b> live in {@link #updateEntityFromDto(GeneratedMigrationBookOfWorkEntity, GeneratedMigrationBookOfWorkDto)}.
 * Every editable field on the DTO is null-guarded so an omitted JSON property
 * never silently wipes the column. This is the canonical pattern from
 * {@code project_primitive_double_dto_overwrite.md}: all DTO fields here are
 * boxed reference types ({@link String}, {@link UUID},
 * {@link java.util.Map}) so missing JSON arrives as {@code null} rather than
 * a primitive default that would clobber the persisted value.</p>
 *
 * <p>JSONB blobs are passed through by reference. The four sibling JSONB
 * columns are addressed individually so the service layer can decide which
 * blobs are editable post-create (per spec: only {@code book_of_work_json}
 * is editable post-create in the canonical save-draft flow, but the mapper
 * itself is policy-free and copies any non-null blob the caller provides --
 * the service enforces immutability where required).</p>
 *
 * <p>Spec: Product Manager Migration Delivery Plan + Draft Book-of-Work
 * Generation (2026-05-17) -- Task Group 1 sub-task 1.6, retroactively
 * completed by Task Group 7.</p>
 */
public final class GeneratedMigrationBookOfWorkMapper {

    private GeneratedMigrationBookOfWorkMapper() {
        // Utility class - prevent instantiation
    }

    /**
     * Convert a {@link GeneratedMigrationBookOfWorkEntity} into its DTO wire
     * shape. Timestamps are emitted as ISO-8601 strings to match the
     * {@code DiscoveryRunDto} precedent.
     *
     * @param entity the entity to convert; {@code null} returns {@code null}
     * @return the DTO representation
     */
    public static GeneratedMigrationBookOfWorkDto toDto(GeneratedMigrationBookOfWorkEntity entity) {
        if (entity == null) {
            return null;
        }
        return new GeneratedMigrationBookOfWorkDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getCurrentArchitectureId(),
            entity.getTargetArchitectureId(),
            entity.getStatus(),
            entity.getTitle(),
            entity.getSummary(),
            entity.getGenerationInputsJson(),
            entity.getGenerationSummaryJson(),
            entity.getQualityAssessmentJson(),
            entity.getBookOfWorkJson(),
            entity.getCreatedByTask(),
            entity.getSavedToBacklogAt() != null ? entity.getSavedToBacklogAt().toString() : null,
            entity.getErrorMessage(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null,
            entity.getUpdatedAt() != null ? entity.getUpdatedAt().toString() : null
        );
    }

    /**
     * Build a fresh {@link GeneratedMigrationBookOfWorkEntity} from a create
     * request DTO. The {@code projectId} is taken from the URL path variable
     * (preferred) and overrides whatever the DTO may carry, matching the
     * established AMS controller convention.
     *
     * <p>Defaults applied:</p>
     * <ul>
     *   <li>{@code id} -- generated if absent</li>
     *   <li>{@code status} -- defaulted to {@code 'draft'} if absent</li>
     *   <li>{@code createdByTask} -- defaulted to the standard task id if absent</li>
     *   <li>{@code createdAt} / {@code updatedAt} -- defaulted to {@link Instant#now()}
     *       (the entity's {@code @PrePersist} would do this anyway; we set them
     *       explicitly so the same builder can be used by tests that bypass
     *       JPA lifecycle callbacks)</li>
     * </ul>
     *
     * @param dto the create-request DTO
     * @param projectId the project UUID from the URL path
     * @return a fresh, unsaved entity ready for INSERT
     */
    public static GeneratedMigrationBookOfWorkEntity toNewEntity(
        GeneratedMigrationBookOfWorkDto dto, UUID projectId) {
        if (dto == null) {
            return null;
        }
        Instant now = Instant.now();
        return GeneratedMigrationBookOfWorkEntity.builder()
            .id(dto.id() != null ? dto.id() : UUID.randomUUID())
            .projectId(projectId)
            .currentArchitectureId(dto.currentArchitectureId())
            .targetArchitectureId(dto.targetArchitectureId())
            .status(dto.status() != null ? dto.status() : GeneratedMigrationBookOfWorkStatus.DRAFT)
            .title(dto.title())
            .summary(dto.summary())
            .generationInputsJson(dto.generationInputsJson())
            .generationSummaryJson(dto.generationSummaryJson())
            .qualityAssessmentJson(dto.qualityAssessmentJson())
            .bookOfWorkJson(dto.bookOfWorkJson())
            .createdByTask(dto.createdByTask() != null
                ? dto.createdByTask()
                : "product-manager--migration-delivery-plan")
            .savedToBacklogAt(null)
            .errorMessage(dto.errorMessage())
            .createdAt(now)
            .updatedAt(now)
            .build();
    }

    /**
     * Apply PATCH-style updates onto a loaded entity, null-guarding every
     * editable field. Omitted (null) DTO fields leave the existing column
     * untouched -- per {@code project_primitive_double_dto_overwrite.md}.
     *
     * <p>Editable fields (per spec.md AMS section): {@code title}, {@code summary},
     * {@code status}, {@code bookOfWorkJson}. The other three JSONB columns are
     * immutable post-create in the canonical flow and are NOT touched here even
     * if the DTO carries them -- the controller / service layer is the place to
     * reject attempts to mutate them.</p>
     *
     * <p>{@code updatedAt} is bumped via the entity's {@code @PreUpdate} callback;
     * we do not set it here.</p>
     *
     * @param entity the existing entity loaded from the DB
     * @param dto the PATCH DTO
     */
    public static void updateEntityFromDto(
        GeneratedMigrationBookOfWorkEntity entity,
        GeneratedMigrationBookOfWorkDto dto) {
        if (entity == null || dto == null) {
            return;
        }
        if (dto.title() != null) {
            entity.setTitle(dto.title());
        }
        if (dto.summary() != null) {
            entity.setSummary(dto.summary());
        }
        if (dto.status() != null) {
            entity.setStatus(dto.status());
        }
        if (dto.bookOfWorkJson() != null) {
            entity.setBookOfWorkJson(dto.bookOfWorkJson());
        }
        if (dto.errorMessage() != null) {
            entity.setErrorMessage(dto.errorMessage());
        }
    }
}
