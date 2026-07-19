package com.example.architecturemodel.model.dto.security;

import com.example.architecturemodel.model.entity.security.SecurityFindingReportEntity;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Wire mirror of one {@code security_finding_reports} row (Security health
 * dashboard, 2026-07-19, Spec 1 of 3): the history list ("Load previous"
 * modal) and the latest-report read. Snake_case wire (AMS global default).
 */
public record SecurityFindingReportDto(
    UUID id,
    UUID projectId,
    UUID architectureId,
    String source,
    String associationLevel,
    List<String> originalFilenames,
    Map<String, String> columnMapping,
    Instant uploadedAt,
    Boolean isLatest,
    Integer rowCountIngested,
    Integer rowCountDropped,
    String notes
) {

    public static SecurityFindingReportDto from(SecurityFindingReportEntity e) {
        return new SecurityFindingReportDto(
            e.getId(),
            e.getProjectId(),
            e.getArchitectureId(),
            e.getSource(),
            e.getAssociationLevel(),
            e.getOriginalFilenames(),
            e.getColumnMapping(),
            e.getUploadedAt(),
            e.getIsLatest(),
            e.getRowCountIngested(),
            e.getRowCountDropped(),
            e.getNotes());
    }
}
