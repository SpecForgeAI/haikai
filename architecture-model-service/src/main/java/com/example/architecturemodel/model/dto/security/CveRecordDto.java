package com.example.architecturemodel.model.dto.security;

import com.example.architecturemodel.model.entity.security.CveEntity;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Wire mirror of one {@code cves} world-fact record (Security health dashboard,
 * 2026-07-19, Spec 1 of 3). Snake_case wire (AMS global default).
 */
public record CveRecordDto(
    UUID id,
    String cveId,
    String summary,
    String description,
    String cvssVector,
    BigDecimal cvssScore,
    String severityOfficial,
    List<String> cweIds,
    List<String> aliases,
    List<String> referenceUrls,
    Instant publishedAt,
    Instant modifiedAt,
    Boolean kevListed,
    BigDecimal epssScore,
    String source,
    Instant fetchedAt,
    String enrichmentStatus
) {

    public static CveRecordDto from(CveEntity e) {
        return new CveRecordDto(
            e.getId(),
            e.getCveId(),
            e.getSummary(),
            e.getDescription(),
            e.getCvssVector(),
            e.getCvssScore(),
            e.getSeverityOfficial(),
            e.getCweIds(),
            e.getAliases(),
            e.getReferenceUrls(),
            e.getPublishedAt(),
            e.getModifiedAt(),
            e.getKevListed(),
            e.getEpssScore(),
            e.getSource(),
            e.getFetchedAt(),
            e.getEnrichmentStatus());
    }
}
