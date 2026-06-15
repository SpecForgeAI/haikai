package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Wire DTO for one pack-scoped needs_decision row. Snake_case wire per the
 * AMS global default.
 *
 * <p>Also the inline shape inside
 * {@link UpsertDbMigrationPackRequest#decisions()}: on upsert the server
 * matches by {@code decision_key} (unique per pack) and RE-LINKS the existing
 * row -- updating {@code object_ref} / {@code category} / {@code question} /
 * {@code options_json} while PRESERVING {@code status} /
 * {@code resolution_json} / {@code resolved_at} -- instead of duplicating.
 * Client-sent {@code id} / {@code pack_id} / {@code status} /
 * {@code resolution_json} / {@code resolved_at} are ignored on upsert.</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 *
 * @param id Internal database UUID (server-generated).
 * @param packId Owning pack UUID (server-stamped).
 * @param decisionKey Stable object identity + question kind, unique per pack.
 * @param objectRef Human-readable schema/table/column reference.
 * @param category One of {@code type_mapping | computed_column | collation |
 *     delta_key | other}.
 * @param question The concrete question the generator could not answer.
 * @param optionsJson The concrete options offered (array of strings/objects).
 * @param resolutionJson The chosen resolution payload (set on resolve).
 * @param status {@code open | resolved}.
 * @param resolvedAt ISO-8601 timestamp of resolution (nullable).
 * @param createdAt ISO-8601 creation timestamp.
 * @param updatedAt ISO-8601 last-update timestamp.
 */
public record DbMigrationPackDecisionDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("pack_id")
    UUID packId,

    @JsonProperty("decision_key")
    String decisionKey,

    @JsonProperty("object_ref")
    String objectRef,

    @JsonProperty("category")
    String category,

    @JsonProperty("question")
    String question,

    @JsonProperty("options_json")
    List<Object> optionsJson,

    @JsonProperty("resolution_json")
    Map<String, Object> resolutionJson,

    @JsonProperty("status")
    String status,

    @JsonProperty("resolved_at")
    String resolvedAt,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("updated_at")
    String updatedAt
) {}
