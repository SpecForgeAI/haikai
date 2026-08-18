package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.SclContractDto;
import com.example.architecturemodel.model.dto.SclReachabilityItemDto;
import com.example.architecturemodel.model.dto.SclScanDto;
import com.example.architecturemodel.model.entity.SclContractEntity;
import com.example.architecturemodel.model.entity.SclReachabilityItemEntity;
import com.example.architecturemodel.model.entity.SclScanEntity;
import org.springframework.stereotype.Component;

import java.time.Instant;

/**
 * Mapper for converting between the SCL corpus entities and their DTOs
 * ({@link SclScanEntity} / {@link SclContractEntity} /
 * {@link SclReachabilityItemEntity}).
 *
 * Timestamps are rendered {@code Instant -> String} via {@code toString()}
 * (ISO-8601), matching the established AMS mapper idiom
 * ({@code entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null}).
 * On the DTO -> entity direction, timestamps are parsed when present and left
 * null otherwise (the entity {@code @PrePersist}/{@code @PreUpdate} hooks own
 * server-assigned values).
 *
 * Spec: SCL corpus persistence (Structural Contract Language) (2026-08-18).
 */
@Component
public class SclMapper {

    /**
     * Converts an SclScanEntity to SclScanDto.
     *
     * @param entity The scan entity
     * @return SclScanDto with all fields, or null for a null entity
     */
    public SclScanDto toDto(SclScanEntity entity) {
        if (entity == null) {
            return null;
        }
        return new SclScanDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getArchitectureId(),
            entity.getStatus(),
            entity.getStatsJson(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null,
            entity.getUpdatedAt() != null ? entity.getUpdatedAt().toString() : null
        );
    }

    /**
     * Converts an SclScanDto to SclScanEntity.
     *
     * @param dto The scan DTO
     * @return SclScanEntity with all fields, or null for a null DTO
     */
    public SclScanEntity toEntity(SclScanDto dto) {
        if (dto == null) {
            return null;
        }
        return SclScanEntity.builder()
            .id(dto.id())
            .projectId(dto.projectId())
            .architectureId(dto.architectureId())
            .status(dto.status())
            .statsJson(dto.statsJson())
            .createdAt(parseInstant(dto.createdAt()))
            .updatedAt(parseInstant(dto.updatedAt()))
            .build();
    }

    /**
     * Converts an SclContractEntity to SclContractDto (full body).
     *
     * @param entity The contract entity
     * @return SclContractDto with all fields, or null for a null entity
     */
    public SclContractDto toDto(SclContractEntity entity) {
        if (entity == null) {
            return null;
        }
        return new SclContractDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getArchitectureId(),
            entity.getScanId(),
            entity.getContractKey(),
            entity.getKind(),
            entity.getSourcePath(),
            entity.getSourceSymbol(),
            entity.getContentHash(),
            entity.getFanIn(),
            entity.getRootsJson(),
            entity.getBodyJson(),
            entity.getGlossJson(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null,
            entity.getUpdatedAt() != null ? entity.getUpdatedAt().toString() : null
        );
    }

    /**
     * Converts an SclContractEntity to a body-stripped SclContractDto:
     * {@code body_json} AND {@code gloss_json} are nulled so list payloads
     * stay light. Every other field (including {@code roots_json}) is carried.
     *
     * @param entity The contract entity
     * @return SclContractDto without body/gloss, or null for a null entity
     */
    public SclContractDto toDtoWithoutBody(SclContractEntity entity) {
        if (entity == null) {
            return null;
        }
        return new SclContractDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getArchitectureId(),
            entity.getScanId(),
            entity.getContractKey(),
            entity.getKind(),
            entity.getSourcePath(),
            entity.getSourceSymbol(),
            entity.getContentHash(),
            entity.getFanIn(),
            entity.getRootsJson(),
            null,
            null,
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null,
            entity.getUpdatedAt() != null ? entity.getUpdatedAt().toString() : null
        );
    }

    /**
     * Converts an SclContractDto to SclContractEntity.
     *
     * @param dto The contract DTO
     * @return SclContractEntity with all fields, or null for a null DTO
     */
    public SclContractEntity toEntity(SclContractDto dto) {
        if (dto == null) {
            return null;
        }
        return SclContractEntity.builder()
            .id(dto.id())
            .projectId(dto.projectId())
            .architectureId(dto.architectureId())
            .scanId(dto.scanId())
            .contractKey(dto.contractKey())
            .kind(dto.kind())
            .sourcePath(dto.sourcePath())
            .sourceSymbol(dto.sourceSymbol())
            .contentHash(dto.contentHash())
            .fanIn(dto.fanIn() != null ? dto.fanIn() : 0)
            .rootsJson(dto.rootsJson())
            .bodyJson(dto.bodyJson())
            .glossJson(dto.glossJson())
            .createdAt(parseInstant(dto.createdAt()))
            .updatedAt(parseInstant(dto.updatedAt()))
            .build();
    }

    /**
     * Converts an SclReachabilityItemEntity to SclReachabilityItemDto.
     *
     * @param entity The reachability item entity
     * @return SclReachabilityItemDto with all fields, or null for a null entity
     */
    public SclReachabilityItemDto toDto(SclReachabilityItemEntity entity) {
        if (entity == null) {
            return null;
        }
        return new SclReachabilityItemDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getScanId(),
            entity.getSourcePath(),
            entity.getSymbol(),
            entity.getSignalsJson(),
            entity.getDisposition(),
            entity.getCreatedAt() != null ? entity.getCreatedAt().toString() : null,
            entity.getUpdatedAt() != null ? entity.getUpdatedAt().toString() : null
        );
    }

    /**
     * Converts an SclReachabilityItemDto to SclReachabilityItemEntity.
     *
     * @param dto The reachability item DTO
     * @return SclReachabilityItemEntity with all fields, or null for a null DTO
     */
    public SclReachabilityItemEntity toEntity(SclReachabilityItemDto dto) {
        if (dto == null) {
            return null;
        }
        return SclReachabilityItemEntity.builder()
            .id(dto.id())
            .projectId(dto.projectId())
            .scanId(dto.scanId())
            .sourcePath(dto.sourcePath())
            .symbol(dto.symbol())
            .signalsJson(dto.signalsJson())
            .disposition(dto.disposition())
            .createdAt(parseInstant(dto.createdAt()))
            .updatedAt(parseInstant(dto.updatedAt()))
            .build();
    }

    /** Null-guarded ISO-8601 String -> Instant parse for the DTO -> entity direction. */
    private static Instant parseInstant(String value) {
        return (value == null || value.isBlank()) ? null : Instant.parse(value);
    }
}
