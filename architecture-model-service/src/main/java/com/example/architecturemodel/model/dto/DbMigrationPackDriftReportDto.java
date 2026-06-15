package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * Wire DTO for one schema verification (drift) run. Snake_case wire per the
 * AMS global default; summary counts are boxed {@link Integer} per
 * {@code project_primitive_double_dto_overwrite.md}.
 *
 * <p>Also the append-request body for
 * {@code POST .../db-migration-packs/{packId}/drift-reports}: the server
 * generates {@code id} / {@code created_at} and defaults {@code source} to
 * {@code in_tool} when absent. Rows are append-only -- never updated.</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 *
 * @param id Internal database UUID (server-generated).
 * @param packId Owning pack UUID (server-stamped).
 * @param scanScopeJson Area filter for the run (schemas/tables); null = full.
 * @param matchCount Objects classified {@code match} (boxed).
 * @param missingCount Objects classified {@code missing} (boxed).
 * @param mismatchCount Objects classified {@code mismatch} (boxed).
 * @param reportJson Full per-object classification report.
 * @param source Free-text producer tag ({@code in_tool} now).
 * @param createdAt ISO-8601 creation timestamp.
 */
public record DbMigrationPackDriftReportDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("pack_id")
    UUID packId,

    @JsonProperty("scan_scope_json")
    Map<String, Object> scanScopeJson,

    @JsonProperty("match_count")
    Integer matchCount,

    @JsonProperty("missing_count")
    Integer missingCount,

    @JsonProperty("mismatch_count")
    Integer mismatchCount,

    @JsonProperty("report_json")
    Map<String, Object> reportJson,

    @JsonProperty("source")
    String source,

    @JsonProperty("created_at")
    String createdAt
) {}
