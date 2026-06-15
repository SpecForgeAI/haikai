package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

/**
 * Wire DTO for one generated DB migration pack file. Snake_case wire per the
 * AMS global default; {@code sort_order} is a boxed {@link Integer} per
 * {@code project_primitive_double_dto_overwrite.md}.
 *
 * <p>Also the inline shape inside {@link UpsertDbMigrationPackRequest#files()}
 * (server generates {@code id} / {@code pack_id} on write -- client-sent
 * values for those are ignored).</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 *
 * @param id Internal database UUID (server-generated).
 * @param packId Owning pack UUID (server-stamped).
 * @param filePath Relative path inside the download zip.
 * @param fileKind One of {@code liquibase_master | liquibase_changeset |
 *     bulk_load_script | incremental_script | manifest | readme}.
 * @param content The full file text.
 * @param sortOrder Deterministic pack ordering (boxed).
 */
public record DbMigrationPackFileDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("pack_id")
    UUID packId,

    @JsonProperty("file_path")
    String filePath,

    @JsonProperty("file_kind")
    String fileKind,

    @JsonProperty("content")
    String content,

    @JsonProperty("sort_order")
    Integer sortOrder
) {}
