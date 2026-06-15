package com.example.architecturemodel.model.dto.export;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;

/**
 * Metadata for a project snapshot export.
 *
 * Contains versioning and timing information for the snapshot.
 *
 * Spec 2026-01-06: Project Snapshot JSON Export
 *
 * @param snapshotVersion The version of the snapshot schema (starts at 1)
 * @param exportedAt The timestamp when the export was generated (ISO-8601 UTC)
 * @param exportKind The type of export (e.g., "PROJECT_SNAPSHOT")
 */
public record SnapshotMeta(
    @JsonProperty("snapshot_version")
    Integer snapshotVersion,

    @JsonProperty("exported_at")
    Instant exportedAt,

    @JsonProperty("export_kind")
    String exportKind
) {}
