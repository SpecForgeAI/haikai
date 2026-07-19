package com.example.architecturemodel.model.dto.security;

import com.example.architecturemodel.model.entity.security.CweEntity;

import java.time.Instant;
import java.util.UUID;

/**
 * Wire mirror of one {@code cwes} world-fact record (Security health dashboard,
 * 2026-07-19, Spec 1 of 3). Snake_case wire (AMS global default).
 */
public record CweRecordDto(
    UUID id,
    String cweId,
    String name,
    String description,
    String source,
    Instant fetchedAt,
    String enrichmentStatus
) {

    public static CweRecordDto from(CweEntity e) {
        return new CweRecordDto(
            e.getId(), e.getCweId(), e.getName(), e.getDescription(),
            e.getSource(), e.getFetchedAt(), e.getEnrichmentStatus());
    }
}
