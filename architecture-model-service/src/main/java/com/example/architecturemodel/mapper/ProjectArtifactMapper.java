package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.ProjectArtifactDto;
import com.example.architecturemodel.model.entity.ProjectArtifactEntity;

import java.time.Instant;
import java.util.UUID;

/**
 * Mapper utility for converting between ProjectArtifactEntity and ProjectArtifactDto.
 */
public final class ProjectArtifactMapper {

    private ProjectArtifactMapper() {
        // Utility class - prevent instantiation
    }

    /**
     * Convert ProjectArtifactEntity to ProjectArtifactDto.
     *
     * @param entity the entity to convert
     * @return the DTO representation
     */
    public static ProjectArtifactDto toDto(ProjectArtifactEntity entity) {
        if (entity == null) {
            return null;
        }

        return new ProjectArtifactDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getArtifactType(),
            entity.getContent(),
            entity.getSource(),
            entity.getRevision(),
            entity.getCreatedAt()
        );
    }

    /**
     * Convert ProjectArtifactDto to ProjectArtifactEntity.
     * Note: revision should be set by the service layer for auto-increment.
     *
     * @param dto the DTO to convert
     * @param projectId the project ID (from path variable)
     * @param artifactType the artifact type (from path variable)
     * @param revision the revision number (calculated by service)
     * @return the entity representation
     */
    public static ProjectArtifactEntity toEntity(ProjectArtifactDto dto, UUID projectId,
                                                  String artifactType, Integer revision) {
        if (dto == null) {
            return null;
        }

        return ProjectArtifactEntity.builder()
            .id(dto.id() != null ? dto.id() : UUID.randomUUID())
            .projectId(projectId)
            .artifactType(artifactType)
            .content(dto.content())
            .source(dto.source() != null ? dto.source() : "AGENT_OS")
            .revision(revision)
            .createdAt(Instant.now())
            .build();
    }
}
