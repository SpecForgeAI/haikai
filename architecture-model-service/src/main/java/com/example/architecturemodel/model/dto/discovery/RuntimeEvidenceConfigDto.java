package com.example.architecturemodel.model.dto.discovery;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * Optional sub-DTO carried by {@link LogFilesPatchRequest} to persist
 * per-run runtime-evidence matcher configuration alongside the uploaded
 * log files. Today the only key is {@code maxLogPathPrefixSegments} ("M"),
 * the tier-3 suffix-matcher prefix-tolerance knob.
 *
 * <p>Persisted at {@code config_snapshot.runtimeEvidenceConfig.maxLogPathPrefixSegments}
 * (sibling of {@code config_snapshot.inputArtifacts.logFiles[]}). Conceptually
 * paired with the logs themselves because M only matters when log files exist,
 * so it rides the same log-files PATCH rather than introducing a new endpoint.
 *
 * <p>The discovery-service orchestrator reads this value via
 * {@code readMaxLogPathPrefixSegments(configSnapshot)} (see
 * {@code runDiscoveryRuntimeEvidence.ts}); missing/invalid values are
 * defensively clamped to {@code [0..5]} with a default of {@code 1} at the
 * read site.
 *
 * <p>JSON field names are camelCase to match the gateway payload shape and
 * the on-disk persistence convention used by {@code inputArtifacts}.
 *
 * <p>Spec: Discovery Run Robustness (2026-05-11) -- Task Group 3.
 *
 * @param maxLogPathPrefixSegments the per-run "M" value: tolerate up to N
 *                                 leading proxy-prefix segments when matching
 *                                 log paths to candidate endpoints. Range
 *                                 {@code [0..5]}; {@code 0} disables tier-3
 *                                 suffix matching entirely. Frontend default
 *                                 is {@code 1}. Optional so the field can be
 *                                 omitted in PATCH bodies that don't set M.
 */
public record RuntimeEvidenceConfigDto(
    @JsonProperty("maxLogPathPrefixSegments")
    @Min(value = 0, message = "maxLogPathPrefixSegments must be >= 0")
    @Max(value = 5, message = "maxLogPathPrefixSegments must be <= 5")
    Integer maxLogPathPrefixSegments
) {}
