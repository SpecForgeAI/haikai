package com.example.architecturemodel.model.dto.discovery;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

/**
 * DTO describing a single uploaded runtime-log file's metadata, persisted on
 * the {@code DiscoveryRunEntity.config_snapshot.inputArtifacts.logFiles[]} JSONB
 * payload by the gateway after writing the file to disk under the project folder.
 *
 * <p>The raw log content is NEVER persisted to the database -- only this
 * metadata block, with {@code relativePath} acting as the bridge from the
 * discovery_run row to the on-disk file. Spec 5 will read the file back via
 * the {@code relativePath} resolved against the project folder.
 *
 * <p>JSON field names are camelCase to match the gateway payload shape; the
 * service-wide Jackson {@code SNAKE_CASE} property naming strategy is
 * overridden via explicit {@link JsonProperty} annotations on every field.
 *
 * <p>Spec: Runtime Log Input at Discovery Run Start (2026-05-10) -- Task Group 1.
 *
 * @param artifactId       gateway-assigned UUID for this artifact entry; the
 *                         PATCH endpoint uses this as the merge key
 *                         (re-PATCHing the same id REPLACES the entry,
 *                         it does not append a duplicate).
 * @param originalFileName the sanitised but recognisable file name (path
 *                         separators stripped, control chars stripped,
 *                         whitespace runs collapsed to underscores by the
 *                         gateway sanitiser).
 * @param sizeBytes        the on-disk size of the written file in bytes
 *                         (must be >= 0).
 * @param fileExtension    the original file's extension including the leading
 *                         dot (e.g. {@code ".log"}, {@code ".jsonl"}).
 * @param contentType      the browser-reported MIME type; optional because
 *                         some browsers omit it for unknown extensions.
 * @param uploadedAtIso    the ISO-8601 timestamp at which the gateway wrote
 *                         the file to disk.
 * @param relativePath     the path of the written file relative to the project
 *                         folder (e.g. {@code discovery-runs/{runId}/logs/web.log}).
 *                         NEVER an absolute path -- keeps the project folder
 *                         portable.
 */
public record LogFileMetaDto(
    @JsonProperty("artifactId")
    @NotBlank(message = "artifactId must not be blank")
    String artifactId,

    @JsonProperty("originalFileName")
    @NotBlank(message = "originalFileName must not be blank")
    String originalFileName,

    @JsonProperty("sizeBytes")
    @NotNull(message = "sizeBytes is required")
    @PositiveOrZero(message = "sizeBytes must be >= 0")
    Long sizeBytes,

    @JsonProperty("fileExtension")
    @NotBlank(message = "fileExtension must not be blank")
    String fileExtension,

    @JsonProperty("contentType")
    String contentType,

    @JsonProperty("uploadedAtIso")
    @NotBlank(message = "uploadedAtIso must not be blank")
    String uploadedAtIso,

    @JsonProperty("relativePath")
    @NotBlank(message = "relativePath must not be blank")
    String relativePath
) {}
