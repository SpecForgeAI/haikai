package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * Wire DTO for one per-project DB gap-proposal row. Snake_case wire per the
 * AMS global default (NO {@code @CamelCaseWire} -- the gateway gap-proposal
 * routes and the frontend review queue both speak snake_case).
 *
 * <p>Spec: LLM gap-proposal queue (2026-08-04) -- Spec 4.</p>
 *
 * @param id Internal database UUID (server-generated).
 * @param projectId Owning project UUID (server-stamped from the path).
 * @param proposalKey Stable identity {@code fk--<relationship_id>} /
 *     {@code pk--<table>}, unique per project.
 * @param findingKey The structural finding this proposal addresses.
 * @param kind One of {@code fk_join | primary_key}.
 * @param payloadJson Kind-shaped proposed change ({@code fk_join}:
 *     relationship_id, from_table, join_columns[], to_table,
 *     referenced_columns[]; {@code primary_key}: table, entity_id, columns[]).
 * @param rationale The proposer's reasoning (nullable).
 * @param confidence One of {@code high | medium | low} or {@code null}.
 * @param origin One of {@code llm | manual}.
 * @param reviewStatus One of
 *     {@code unreviewed | approved | rejected | needs_rework}.
 * @param reviewerNotes Reviewer commentary (nullable).
 * @param appliedAt ISO-8601 timestamp of the successful model write-back
 *     (nullable -- {@code null} until applied).
 * @param createdAt ISO-8601 creation timestamp.
 * @param reviewedAt ISO-8601 timestamp of the last review action (nullable).
 */
public record DbGapProposalDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("proposal_key")
    String proposalKey,

    @JsonProperty("finding_key")
    String findingKey,

    @JsonProperty("kind")
    String kind,

    @JsonProperty("payload_json")
    Map<String, Object> payloadJson,

    @JsonProperty("rationale")
    String rationale,

    @JsonProperty("confidence")
    String confidence,

    @JsonProperty("origin")
    String origin,

    @JsonProperty("review_status")
    String reviewStatus,

    @JsonProperty("reviewer_notes")
    String reviewerNotes,

    @JsonProperty("applied_at")
    String appliedAt,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("reviewed_at")
    String reviewedAt
) {}
