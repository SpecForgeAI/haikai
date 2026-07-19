package com.example.architecturemodel.model.dto.security;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Ingest response summary (Security health dashboard, 2026-07-19, Spec 1 of 3):
 * the upload wizard's final screen shows these counts without a second
 * round-trip. No-silent-drop: dropped rows are counted AND summarized in the
 * report notes. Snake_case wire (AMS global default).
 */
public record SecurityIngestSummaryDto(
    UUID reportId,
    String source,
    String associationLevel,
    Instant uploadedAt,
    List<String> originalFilenames,
    Integer rowsReceived,
    Integer rowCountIngested,
    Integer rowCountDropped,
    Integer matchedCount,
    Integer unmatchedCount,
    Integer distinctCves,
    Integer distinctCwes,
    Integer cveStubsCreated,
    Integer cweStubsCreated,
    String notes
) {
}
