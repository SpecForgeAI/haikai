package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * Wire DTO for a DB migration pack row.
 *
 * <p>Snake_case wire per the AMS global default (no {@code @CamelCaseWire} --
 * all consumers of this surface are new); explicit {@link JsonProperty}
 * declarations are the belt-and-braces repo convention (see
 * {@link GeneratedMigrationBookOfWorkDto}).</p>
 *
 * <p>All numeric fields are BOXED ({@link Integer} / {@link Long}) per
 * {@code project_primitive_double_dto_overwrite.md}: an omitted JSON field
 * arrives as {@code null} and must never wipe a column to {@code 0} via
 * primitive defaulting. Update handlers null-guard every field.</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 *
 * @param id Internal database UUID.
 * @param projectId Owning project UUID.
 * @param architectureId Architecture the pack was generated from.
 * @param status Lifecycle status ({@code generated | stale}).
 * @param staleReason Human-readable staleness reason (nullable).
 * @param inputSnapshotHash SHA-256 of the canonical generation inputs.
 * @param generatedAt ISO-8601 timestamp of the last (re)generation.
 * @param workItemId DB-epic book-of-work item id (nullable text).
 * @param translatedCount Coverage ledger: translated objects (boxed).
 * @param skippedCount Coverage ledger: explicitly skipped objects (boxed).
 * @param flaggedCount Coverage ledger: needs_decision objects (boxed).
 * @param seedMargin Sequence-seed margin over captured high-water (boxed).
 * @param manifestJson The pack manifest (JSONB).
 * @param createdAt ISO-8601 creation timestamp.
 * @param updatedAt ISO-8601 last-update timestamp.
 */
public record DbMigrationPackDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("architecture_id")
    UUID architectureId,

    @JsonProperty("status")
    String status,

    @JsonProperty("stale_reason")
    String staleReason,

    @JsonProperty("input_snapshot_hash")
    String inputSnapshotHash,

    @JsonProperty("generated_at")
    String generatedAt,

    @JsonProperty("work_item_id")
    String workItemId,

    @JsonProperty("translated_count")
    Integer translatedCount,

    @JsonProperty("skipped_count")
    Integer skippedCount,

    @JsonProperty("flagged_count")
    Integer flaggedCount,

    @JsonProperty("seed_margin")
    Long seedMargin,

    @JsonProperty("manifest_json")
    Map<String, Object> manifestJson,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("updated_at")
    String updatedAt
) {}
