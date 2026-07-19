package com.example.architecturemodel.model.dto.security;

import java.util.List;
import java.util.Map;

/**
 * The Findings Register page response (Security health dashboard, 2026-07-19,
 * Spec 1 of 3).
 *
 * <p>Each row is the DELIBERATE flattening of the structured store -- assembled
 * in exactly one place ({@code SecurityRegisterService}) -- with provenance
 * carried in the key names ({@code severity_reported} vs
 * {@code cve_severity_official} etc.). Rows are ordered maps containing ONLY
 * the requested column set ({@code columns} echoes it), so future register
 * UI-configurability is pure client work over this same contract.</p>
 *
 * <p>Snake_case wire: row keys are literal snake_case strings (maps pass
 * through Jackson untouched).</p>
 */
public record SecurityRegisterResponse(
    List<Map<String, Object>> data,
    long total,
    int page,
    int size,
    List<String> columns
) {
}
