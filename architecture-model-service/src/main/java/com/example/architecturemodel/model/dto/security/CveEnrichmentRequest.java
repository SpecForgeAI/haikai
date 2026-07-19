package com.example.architecturemodel.model.dto.security;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * Enrichment payload for one CVE record, posted by the gateway OSV bridge
 * (Security health dashboard, 2026-07-19, Spec 1 of 3).
 *
 * <p>Applies world facts onto the {@code cves} stub. Null fields are left
 * untouched (partial enrichment is fine); {@code enrichmentStatus} defaults to
 * {@code enriched} when absent. Enrichment NEVER touches
 * {@code security_findings} -- the reported copy is immutable.</p>
 *
 * <p>Snake_case wire (AMS global default).</p>
 */
public record CveEnrichmentRequest(
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
    String enrichmentStatus
) {
}
