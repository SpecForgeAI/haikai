package com.example.architecturemodel.model.dto.security;

import java.time.Instant;
import java.util.List;

/**
 * One normalized finding row forwarded by the gateway after parse + wizard
 * resolution (Security health dashboard, 2026-07-19, Spec 1 of 3).
 *
 * <p>The gateway has already: parsed each file (GitLab export in v1, including
 * the Ruby-hash Location field), applied the user-confirmed column mapping,
 * split multi-value CVE/CWE cells, and resolved attribution through the
 * wizard's value matcher ({@code applicationId} + {@code matchStatus}). This
 * DTO carries ONLY deterministic, already-resolved data -- AMS re-normalizes
 * severity defensively but performs no matching of its own.</p>
 *
 * <p>Snake_case wire (AMS global default).</p>
 */
public record IngestSecurityFindingRowDto(
    String linkingValue,
    /**
     * Authoritative resolved entity id for the request's association level
     * (changeset 213). {@code applicationId} is the pre-213 field name kept
     * for wire back-compat -- ingestion falls back to it when
     * {@code entityId} is absent.
     */
    String entityId,
    String applicationId,
    String matchStatus,
    String severityRaw,
    String title,
    String description,
    Instant detectedAt,
    String location,
    String sourcePath,
    String cvssVectorReported,
    String sourceFindingId,
    List<String> otherIdentifiers,
    List<String> cveIds,
    List<String> cweIds
) {
}
