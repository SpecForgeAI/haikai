package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.MigrationStorySpecGenerationDto;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.UUID;

/**
 * Mapper utility for converting between
 * {@link MigrationStorySpecGenerationEntity} and
 * {@link MigrationStorySpecGenerationDto}.
 *
 * <p>Static helper class to match the established AMS pattern (see
 * {@link GeneratedMigrationBookOfWorkMapper} -- Spec 1's mapper). No
 * MapStruct; the DTO is a record and the column count is small enough that a
 * hand-rolled mapper is the readable choice.</p>
 *
 * <p><b>PATCH semantics</b> live in
 * {@link #updateEntityFromDto(MigrationStorySpecGenerationEntity, MigrationStorySpecGenerationDto)}.
 * Every editable field on the DTO is null-guarded so an omitted JSON property
 * never silently wipes the column. This is the canonical pattern from
 * {@code project_primitive_double_dto_overwrite.md}: all DTO fields here are
 * boxed reference types so missing JSON arrives as {@code null} rather than
 * a primitive default that would clobber the persisted value. This is
 * particularly critical for {@link MigrationStorySpecGenerationDto#generationAttemptNumber()},
 * which is bumped across regenerate runs (R-8).</p>
 *
 * <p>JSONB blobs are passed through by reference; the mapper itself is
 * policy-free. Manual-edit protection (acceptance signal 17) is enforced by
 * the service layer, not here.</p>
 *
 * <p>Spec: PM Migration Shape-Spec Batch Generation (2026-05-19) -- Task Group 1.</p>
 */
public final class MigrationStorySpecGenerationMapper {

    private MigrationStorySpecGenerationMapper() {
        // Utility class - prevent instantiation
    }

    /**
     * Convert a {@link MigrationStorySpecGenerationEntity} into its DTO wire
     * shape. Timestamps are emitted as ISO-8601 strings to match the
     * {@link GeneratedMigrationBookOfWorkMapper} precedent.
     *
     * @param entity the entity to convert; {@code null} returns {@code null}
     * @return the DTO representation
     */
    public static MigrationStorySpecGenerationDto toDto(MigrationStorySpecGenerationEntity entity) {
        if (entity == null) {
            return null;
        }
        return new MigrationStorySpecGenerationDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getWorkItemId(),
            entity.getBookOfWorkId(),
            entity.getBookItemId(),
            entity.getStatus(),
            entity.getConfidence(),
            entity.getPredictedReadiness(),
            entity.getGeneratedSpecText(),
            entity.getWarningsJson(),
            entity.getMissingInputsJson(),
            entity.getFocusedContextRefsJson(),
            entity.getEvidenceRefsJson(),
            entity.getGeneratedAt() != null ? entity.getGeneratedAt().toString() : null,
            entity.getErrorMessage(),
            entity.getGenerationAttemptNumber(),
            entity.getCreatedByTask(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null,
            entity.getUpdatedAt() != null ? entity.getUpdatedAt().toString() : null,
            entity.getManuallyEdited() != null ? entity.getManuallyEdited() : Boolean.FALSE,
            entity.getLastManuallyEditedAt() != null
                ? entity.getLastManuallyEditedAt().toString() : null,
            entity.getLastManuallyEditedBy(),
            entity.getPreviousSpecText(),
            entity.getStructuredTestsJson(),
            entity.getCoveredEndpointIds()
        );
    }

    /**
     * Build a fresh {@link MigrationStorySpecGenerationEntity} from a create
     * request DTO. The {@code projectId} is taken from the URL path variable
     * (preferred) and overrides whatever the DTO may carry, matching the
     * established AMS controller convention.
     *
     * <p>Defaults applied:</p>
     * <ul>
     *   <li>{@code id} -- generated if absent</li>
     *   <li>{@code generationAttemptNumber} -- defaulted to {@code 0} if absent</li>
     *   <li>{@code createdByTask} -- defaulted to the standard task id if absent</li>
     *   <li>{@code createdAt} / {@code updatedAt} -- defaulted to {@link Instant#now()}
     *       (the entity's {@code @PrePersist} would do this anyway; we set them
     *       explicitly so the same builder can be used by tests that bypass
     *       JPA lifecycle callbacks)</li>
     * </ul>
     *
     * @param dto       the create-request DTO
     * @param projectId the project UUID from the URL path
     * @return a fresh, unsaved entity ready for INSERT
     */
    public static MigrationStorySpecGenerationEntity toNewEntity(
        MigrationStorySpecGenerationDto dto, UUID projectId) {
        if (dto == null) {
            return null;
        }
        Instant now = Instant.now();
        return MigrationStorySpecGenerationEntity.builder()
            .id(dto.id() != null ? dto.id() : UUID.randomUUID())
            .projectId(projectId)
            .workItemId(dto.workItemId())
            .bookOfWorkId(dto.bookOfWorkId())
            .bookItemId(dto.bookItemId())
            .status(dto.status())
            .confidence(dto.confidence())
            .predictedReadiness(dto.predictedReadiness())
            .generatedSpecText(dto.generatedSpecText())
            .warningsJson(dto.warningsJson())
            .missingInputsJson(dto.missingInputsJson())
            .focusedContextRefsJson(dto.focusedContextRefsJson())
            .evidenceRefsJson(dto.evidenceRefsJson())
            .generatedAt(parseInstantOrNull(dto.generatedAt()))
            .errorMessage(dto.errorMessage())
            .generationAttemptNumber(dto.generationAttemptNumber() != null
                ? dto.generationAttemptNumber()
                : 0)
            .createdByTask(dto.createdByTask() != null
                ? dto.createdByTask()
                : "product-manager--migration-shape-spec-generation")
            .createdAt(now)
            .updatedAt(now)
            .manuallyEdited(dto.manuallyEdited() != null
                ? dto.manuallyEdited()
                : Boolean.FALSE)
            .lastManuallyEditedAt(parseInstantOrNull(dto.lastManuallyEditedAt()))
            .lastManuallyEditedBy(dto.lastManuallyEditedBy())
            .previousSpecText(dto.previousSpecText())
            .structuredTestsJson(dto.structuredTestsJson())
            .coveredEndpointIds(dto.coveredEndpointIds())
            .build();
    }

    /**
     * Apply PATCH-style updates onto a loaded entity, null-guarding every
     * editable field. Omitted (null) DTO fields leave the existing column
     * untouched -- per {@code project_primitive_double_dto_overwrite.md}.
     *
     * <p>Editable fields: every column except {@code id}, {@code projectId},
     * {@code workItemId} (FK source of truth), {@code createdAt}, and
     * {@code updatedAt} (auto-managed by {@code @PreUpdate}).</p>
     *
     * <p><b>Critical null-guard for {@link MigrationStorySpecGenerationDto#generationAttemptNumber()}:</b>
     * this field is boxed {@link Integer} on the DTO so a missing JSON
     * property arrives as {@code null} (not {@code 0}). The null-guard here
     * is what prevents an unrelated PATCH from silently resetting a
     * previously-bumped attempt counter (R-8).</p>
     *
     * <p>{@code updatedAt} is bumped via the entity's {@code @PreUpdate}
     * callback; we do not set it here.</p>
     *
     * @param entity the existing entity loaded from the DB
     * @param dto    the PATCH DTO
     */
    public static void updateEntityFromDto(
        MigrationStorySpecGenerationEntity entity,
        MigrationStorySpecGenerationDto dto) {
        if (entity == null || dto == null) {
            return;
        }
        if (dto.bookOfWorkId() != null) {
            entity.setBookOfWorkId(dto.bookOfWorkId());
        }
        if (dto.bookItemId() != null) {
            entity.setBookItemId(dto.bookItemId());
        }
        if (dto.status() != null) {
            entity.setStatus(dto.status());
        }
        if (dto.confidence() != null) {
            entity.setConfidence(dto.confidence());
        }
        if (dto.predictedReadiness() != null) {
            entity.setPredictedReadiness(dto.predictedReadiness());
        }
        if (dto.generatedSpecText() != null) {
            entity.setGeneratedSpecText(dto.generatedSpecText());
        }
        if (dto.warningsJson() != null) {
            entity.setWarningsJson(dto.warningsJson());
        }
        if (dto.missingInputsJson() != null) {
            entity.setMissingInputsJson(dto.missingInputsJson());
        }
        if (dto.focusedContextRefsJson() != null) {
            entity.setFocusedContextRefsJson(dto.focusedContextRefsJson());
        }
        if (dto.evidenceRefsJson() != null) {
            entity.setEvidenceRefsJson(dto.evidenceRefsJson());
        }
        if (dto.generatedAt() != null) {
            Instant parsed = parseInstantOrNull(dto.generatedAt());
            if (parsed != null) {
                entity.setGeneratedAt(parsed);
            }
        }
        if (dto.errorMessage() != null) {
            entity.setErrorMessage(dto.errorMessage());
        }
        if (dto.generationAttemptNumber() != null) {
            entity.setGenerationAttemptNumber(dto.generationAttemptNumber());
        }
        if (dto.createdByTask() != null) {
            entity.setCreatedByTask(dto.createdByTask());
        }
        if (dto.manuallyEdited() != null) {
            entity.setManuallyEdited(dto.manuallyEdited());
        }
        if (dto.lastManuallyEditedAt() != null) {
            Instant parsedEdit = parseInstantOrNull(dto.lastManuallyEditedAt());
            if (parsedEdit != null) {
                entity.setLastManuallyEditedAt(parsedEdit);
            }
        }
        if (dto.lastManuallyEditedBy() != null) {
            entity.setLastManuallyEditedBy(dto.lastManuallyEditedBy());
        }
        if (dto.previousSpecText() != null) {
            entity.setPreviousSpecText(dto.previousSpecText());
        }
        if (dto.structuredTestsJson() != null) {
            entity.setStructuredTestsJson(dto.structuredTestsJson());
        }
        if (dto.coveredEndpointIds() != null) {
            entity.setCoveredEndpointIds(dto.coveredEndpointIds());
        }
    }

    private static Instant parseInstantOrNull(String iso) {
        if (iso == null || iso.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(iso);
        } catch (DateTimeParseException e) {
            return null;
        }
    }
}
