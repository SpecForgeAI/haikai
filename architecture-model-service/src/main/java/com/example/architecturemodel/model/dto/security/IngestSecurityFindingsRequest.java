package com.example.architecturemodel.model.dto.security;

import java.util.List;
import java.util.Map;

/**
 * Gateway-forwarded ingest payload for one security-findings upload (Security
 * health dashboard, 2026-07-19, Spec 1 of 3).
 *
 * <p>A multi-file upload arrives as ONE request: each file was parsed
 * independently at the gateway and the normalized rows appended (the "handy
 * append"); {@code originalFilenames} lists every file. {@code columnMapping}
 * is the user-CONFIRMED mapping (file header -&gt; generic attribute) persisted
 * on the report for audit + next-upload prefill. {@code associationLevel} is a
 * per-upload property ({@code application} in v1).</p>
 *
 * <p>Snake_case wire (AMS global default).</p>
 */
public record IngestSecurityFindingsRequest(
    String source,
    String associationLevel,
    List<String> originalFilenames,
    Map<String, String> columnMapping,
    Integer parserDroppedCount,
    String parserNotes,
    List<IngestSecurityFindingRowDto> rows
) {
}
