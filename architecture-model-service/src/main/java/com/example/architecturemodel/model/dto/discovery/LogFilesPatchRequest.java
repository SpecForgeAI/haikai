package com.example.architecturemodel.model.dto.discovery;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.util.List;

/**
 * Request body for the PATCH log-file artifacts endpoint.
 *
 * <p>Carries the gateway-built list of {@link LogFileMetaDto} entries that the
 * architecture-model-service merges into the discovery run's
 * {@code config_snapshot.inputArtifacts.logFiles[]} JSONB array, plus the
 * {@code attemptedCount} (the number of files the user originally tried to
 * upload, which may exceed the number successfully written if some failed at
 * the gateway). The PATCH service uses {@code attemptedCount} to expose the
 * "log-attach partial" state via {@code max(existing, incoming)} merge logic
 * so a follow-up PATCH cannot silently lower the count.
 *
 * <p>Optionally also carries a {@link RuntimeEvidenceConfigDto} block, which
 * the service merges into {@code config_snapshot.runtimeEvidenceConfig}
 * (sibling of {@code inputArtifacts}). Added by the Discovery Run Robustness
 * spec (2026-05-11) to thread the per-run "M" prefix-tolerance knob from the
 * run-start modals through to the matcher's tier-3 suffix pass in the SAME
 * PATCH write that persists the log files themselves. When the caller omits
 * the field, the existing snapshot value is left UNCHANGED (not nulled).
 *
 * <p>JSON field names are camelCase to match the gateway payload shape.
 *
 * <p>Spec: Runtime Log Input at Discovery Run Start (2026-05-10) -- Task Group 1.
 * <p>Spec: Discovery Run Robustness (2026-05-11) -- Task Group 3 (added
 *      optional {@code runtimeEvidenceConfig} sibling key).
 *
 * @param logFiles              non-empty list of metadata entries describing
 *                              each successfully written log file. Each entry
 *                              is itself validated via {@link Valid}.
 * @param attemptedCount        the number of files the user attempted to
 *                              upload, used to drive the partial-attach
 *                              warning chip on the run row. Must be >= 0.
 * @param runtimeEvidenceConfig optional per-run matcher config (today: just
 *                              {@code maxLogPathPrefixSegments}). When
 *                              omitted, the existing {@code config_snapshot.
 *                              runtimeEvidenceConfig} value (if any) is left
 *                              unchanged by the merge.
 */
public record LogFilesPatchRequest(
    @JsonProperty("logFiles")
    @NotNull(message = "logFiles is required")
    @NotEmpty(message = "logFiles must not be empty")
    @Valid
    List<LogFileMetaDto> logFiles,

    @JsonProperty("attemptedCount")
    @NotNull(message = "attemptedCount is required")
    @PositiveOrZero(message = "attemptedCount must be >= 0")
    Integer attemptedCount,

    @JsonProperty("runtimeEvidenceConfig")
    @Valid
    RuntimeEvidenceConfigDto runtimeEvidenceConfig
) {}
