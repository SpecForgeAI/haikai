package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.ArchitectureDto;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.ArchitectureTagEntity;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.List;

/**
 * Mapper for converting ArchitectureEntity (+ associated tags) into ArchitectureDto.
 *
 * Spec: Multi-Architecture Plumbing (Spec #1)
 * Extended: Target Architecture Authoring Flow (2026-05-20) -- surfaces the
 * {@code kind} and {@code draftState} discriminators on the DTO so the
 * frontend can drive the drafts panel + target-authoring workspace directly
 * from the standard architecture wire shape.
 */
@Component
public class ArchitectureMapper {

    /**
     * Converts an ArchitectureEntity (and its associated tag rows) into a DTO.
     *
     * @param entity the architecture entity (nullable; returns null if null)
     * @param tags   the associated tag rows (nullable / empty -> empty list)
     * @return the DTO, or null if entity is null
     */
    public ArchitectureDto toDto(ArchitectureEntity entity, List<ArchitectureTagEntity> tags) {
        if (entity == null) {
            return null;
        }
        List<String> tagValues = (tags == null)
            ? Collections.emptyList()
            : tags.stream().map(ArchitectureTagEntity::getTagValue).toList();
        return new ArchitectureDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getName(),
            entity.getDescription(),
            tagValues,
            entity.getArchived(),
            entity.getKind(),
            entity.getDraftState(),
            entity.getCreatedAt(),
            entity.getUpdatedAt(),
            null,
            entity.getConversationSavedAt()
        );
    }
}
