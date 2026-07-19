package com.example.architecturemodel.model.dto.security;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The Security Overview rollup (Security health dashboard, 2026-07-19,
 * Spec 1 of 3): severity counts per resolved application over one report
 * (latest by default), plus the Not-matched bucket rendered as a pseudo-box
 * with the same severity-circle treatment. Computed at READ time -- circle
 * counts are never persisted into diagram content, so a new upload updates
 * every circle with zero diagram edits.
 *
 * <p>Snake_case wire (AMS global default); severity count keys are the
 * normalized ladder values ({@code info|low|medium|high|critical}).</p>
 */
public record SecurityRollupDto(
    UUID reportId,
    Instant uploadedAt,
    String associationLevel,
    List<Entry> applications,
    Map<String, Long> unmatched,
    Map<String, Long> totals
) {

    /** Severity counts for one resolved application. */
    public record Entry(
        String applicationId,
        String applicationName,
        Map<String, Long> counts
    ) {
    }
}
