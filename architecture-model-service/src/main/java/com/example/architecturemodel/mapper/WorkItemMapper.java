package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.WorkItemDto;
import com.example.architecturemodel.model.entity.WorkItemEntity;

import java.time.Instant;
import java.util.UUID;

/**
 * Mapper utility for converting between WorkItemEntity and WorkItemDto.
 */
public final class WorkItemMapper {

    private WorkItemMapper() {
        // Utility class - prevent instantiation
    }

    /**
     * Convert WorkItemEntity to WorkItemDto.
     *
     * @param entity the entity to convert
     * @return the DTO representation
     */
    public static WorkItemDto toDto(WorkItemEntity entity) {
        if (entity == null) {
            return null;
        }

        return new WorkItemDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getType(),
            entity.getParentId(),
            entity.getTitle(),
            entity.getDescription(),
            entity.getStatus(),
            entity.getSortOrder(),
            entity.getPriority(),
            entity.getTargetWindow(),
            entity.getTagsJson(),
            entity.getExternalSystem(),
            entity.getExternalKey(),
            entity.getExternalUrl(),
            entity.getCreatedAt(),
            entity.getUpdatedAt(),
            entity.getImplementationBranch(),
            entity.getImplementationPrUrl(),
            entity.getImplementationLogsUrl(),
            entity.getDeferred() != null ? entity.getDeferred() : Boolean.FALSE,
            entity.getSourceCapabilityId(),
            entity.getProvenance() != null
                ? entity.getProvenance() : WorkItemEntity.PROVENANCE_CARRY_OVER
        );
    }

    /**
     * Convert WorkItemDto to WorkItemEntity.
     * Does not set id or timestamps - those should be managed by the service layer.
     *
     * @param dto the DTO to convert
     * @param projectId the project ID (from path variable)
     * @return the entity representation
     */
    public static WorkItemEntity toEntity(WorkItemDto dto, UUID projectId) {
        if (dto == null) {
            return null;
        }

        return WorkItemEntity.builder()
            .id(dto.id() != null ? dto.id() : UUID.randomUUID())
            .projectId(projectId)
            .type(dto.type())
            .parentId(dto.parentId())
            .title(dto.title())
            .description(dto.description())
            .status(dto.status() != null ? dto.status() : "PLANNED")
            .sortOrder(dto.sortOrder() != null ? dto.sortOrder() : 0)
            .priority(dto.priority())
            .targetWindow(dto.targetWindow())
            .tagsJson(dto.tags())
            .externalSystem(dto.externalSystem())
            .externalKey(dto.externalKey())
            .externalUrl(dto.externalUrl())
            .implementationBranch(dto.implementationBranch())
            .implementationPrUrl(dto.implementationPrUrl())
            .implementationLogsUrl(dto.implementationLogsUrl())
            .deferred(dto.deferred() != null ? dto.deferred() : Boolean.FALSE)
            .sourceCapabilityId(dto.sourceCapabilityId())
            .provenance(dto.provenance() != null
                ? dto.provenance() : WorkItemEntity.PROVENANCE_CARRY_OVER)
            .createdAt(dto.createdAt() != null ? dto.createdAt() : Instant.now())
            .updatedAt(Instant.now())
            .build();
    }

    /**
     * Update an existing entity from a DTO.
     * Preserves the entity's id, projectId, and createdAt.
     *
     * Spec 2026-01-18: Fix Feature Edit 400 Error
     * Uses patch semantics for type and parentId:
     * - Only set type when dto.type() is non-null and non-blank
     * - Only set parentId when dto.parentId() is non-null
     * This allows updates that omit these fields to preserve existing values.
     *
     * @param entity the existing entity to update
     * @param dto the DTO with new values
     */
    public static void updateEntityFromDto(WorkItemEntity entity, WorkItemDto dto) {
        if (entity == null || dto == null) {
            return;
        }

        // Spec 2026-01-18: Only set type when non-null and non-blank (patch semantics)
        if (dto.type() != null && !dto.type().isBlank()) {
            entity.setType(dto.type());
        }
        // Spec 2026-01-18: Only set parentId when non-null (patch semantics)
        if (dto.parentId() != null) {
            entity.setParentId(dto.parentId());
        }
        entity.setTitle(dto.title());
        entity.setDescription(dto.description());
        entity.setStatus(dto.status() != null ? dto.status() : entity.getStatus());
        entity.setSortOrder(dto.sortOrder() != null ? dto.sortOrder() : entity.getSortOrder());
        entity.setPriority(dto.priority());
        entity.setTargetWindow(dto.targetWindow());
        entity.setTagsJson(dto.tags());

        // External link fields use a sentinel pattern: an empty-string external_key
        // means "unlink" — clear all three external fields atomically. Otherwise
        // patch semantics: only set the field if dto provides a non-null value.
        if (dto.externalKey() != null && dto.externalKey().isEmpty()) {
            entity.setExternalSystem(null);
            entity.setExternalKey(null);
            entity.setExternalUrl(null);
        } else {
            if (dto.externalSystem() != null) entity.setExternalSystem(dto.externalSystem());
            if (dto.externalKey() != null) entity.setExternalKey(dto.externalKey());
            if (dto.externalUrl() != null) entity.setExternalUrl(dto.externalUrl());
        }

        // Implementation git-outcome fields (Spec 2026-06-12, Task Group 1):
        // null-guarded PATCH semantics -- a null DTO value means "do not
        // change". Nullable Strings, so an omitted field on update can never
        // wipe a stored branch/PR/logs URL.
        if (dto.implementationBranch() != null) {
            entity.setImplementationBranch(dto.implementationBranch());
        }
        if (dto.implementationPrUrl() != null) {
            entity.setImplementationPrUrl(dto.implementationPrUrl());
        }
        if (dto.implementationLogsUrl() != null) {
            entity.setImplementationLogsUrl(dto.implementationLogsUrl());
        }

        // Defer flag (Spec 2026-06-14, Task Group 1, CD-7): null-guarded PATCH
        // semantics. Boxed Boolean, so an omitted field on a general work-item
        // update never flips the defer state -- the dedicated set/clear endpoint
        // (WorkItemController.setDeferred) is the explicit toggle path; this
        // guard keeps an unrelated PUT from silently un-deferring a story.
        if (dto.deferred() != null) {
            entity.setDeferred(dto.deferred());
        }

        // Capability provenance (Spec 2026-06-14 D4, Task Group 1, changeset 185):
        // null-guarded PATCH semantics. Boxed UUID, so an omitted
        // source_capability_id on a general work-item update never wipes the
        // capability provenance the carry_over completeness gate joins on. The
        // appendCapabilityStory mint is the path that SETS it; this guard keeps an
        // unrelated PUT from silently clearing a capability story's citation.
        if (dto.sourceCapabilityId() != null) {
            entity.setSourceCapabilityId(dto.sourceCapabilityId());
        }

        // Net-new vs carry_over provenance (Spec 2026-06-14 D5, Task Group 1,
        // changeset 186): null-guarded PATCH semantics exactly like deferred /
        // sourceCapabilityId. The column is NOT NULL DEFAULT 'carry_over'; an
        // omitted provenance on a general work-item update must NEVER wipe the
        // marker (per project_primitive_double_dto_overwrite.md). The add-item
        // mint is the path that SETS net_new; this guard keeps an unrelated PUT
        // from silently re-classifying an item back to carry_over.
        if (dto.provenance() != null) {
            entity.setProvenance(dto.provenance());
        }

        entity.setUpdatedAt(Instant.now());
    }
}
