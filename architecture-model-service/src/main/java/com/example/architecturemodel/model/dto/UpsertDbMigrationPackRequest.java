package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Request body for {@code PUT /api/projects/{projectId}/db-migration-packs}
 * -- the create/regenerate upsert keyed by {@code (projectId,
 * architecture_id)}.
 *
 * <p>ONE logical persist operation per generation run (spec stage 6):
 * pack upsert -&gt; files replace -&gt; decisions upsert by
 * {@code decision_key} -- executed inside a single service transaction.</p>
 *
 * <p>Upsert semantics:</p>
 * <ul>
 *   <li>The pack row is created on first generation and updated IN PLACE
 *       (same id) on regeneration, so decisions + drift history survive by
 *       pack id. Pack-level fields ({@code status}, {@code
 *       input_snapshot_hash}, coverage counts, {@code seed_margin},
 *       {@code manifest_json}, {@code stale_reason}) are FULL-WRITE: each
 *       generation provides the complete row, so they are assigned verbatim
 *       (including null). {@code status} defaults to {@code generated};
 *       {@code generated_at} is stamped server-side.</li>
 *   <li>{@code work_item_id} is the one exception: the DB-epic attachment is
 *       user state, not generator output, so it is PRESERVED on regeneration
 *       unless explicitly provided here (null = keep existing).</li>
 *   <li>{@code files}, when non-null, REPLACES the pack's file set wholesale.
 *       A null {@code files} list leaves existing files untouched.</li>
 *   <li>{@code decisions}, when non-null, are upserted by
 *       {@code decision_key}: existing rows RE-LINK (question/options/
 *       object_ref/category refreshed; status/resolution/resolved_at
 *       preserved); unknown keys insert as {@code open}. Decisions are never
 *       deleted by upsert.</li>
 * </ul>
 *
 * <p>All numerics are boxed per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 *
 * @param architectureId The architecture the pack belongs to (required).
 * @param status Optional explicit status; defaults to {@code generated}.
 * @param staleReason Staleness reason; normally null on (re)generation.
 * @param inputSnapshotHash SHA-256 of the canonical generation inputs.
 * @param workItemId DB-epic link; null preserves the existing value.
 * @param translatedCount Coverage ledger: translated objects (boxed).
 * @param skippedCount Coverage ledger: skipped objects (boxed).
 * @param flaggedCount Coverage ledger: flagged objects (boxed).
 * @param seedMargin Sequence-seed margin (boxed).
 * @param manifestJson The pack manifest.
 * @param files Full replacement file set (null = leave untouched).
 * @param decisions Decisions to upsert by decision_key (null = none).
 */
public record UpsertDbMigrationPackRequest(
    @JsonProperty("architecture_id")
    UUID architectureId,

    @JsonProperty("status")
    String status,

    @JsonProperty("stale_reason")
    String staleReason,

    @JsonProperty("input_snapshot_hash")
    String inputSnapshotHash,

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

    @JsonProperty("files")
    List<DbMigrationPackFileDto> files,

    @JsonProperty("decisions")
    List<DbMigrationPackDecisionDto> decisions
) {}
