package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO for a single missing-input entry surfaced on a needs-attention item or
 * hierarchy node for an {@code insufficient_context} spec-generation row.
 *
 * <p>This record is the AMS-side projection of one element of
 * {@code migration_story_spec_generations.missing_inputs_json[]} (Liquibase
 * changeset 140). The shape -- {@code { kind, id?, reason }} -- is taken
 * verbatim from the spec-generation row's persisted JSONB payload; no
 * normalisation or filtering happens at projection time.</p>
 *
 * <p>Used by:</p>
 * <ul>
 *   <li>{@link MigrationDeliveryNeedsAttentionItemDto#missingInputs()} -- the
 *       optional list surfaced on needs-attention rows of
 *       {@code type='insufficient_context'} (Addition C).</li>
 *   <li>The story result drawer "Missing inputs" subsection
 *       (Q-9: grouped by {@code kind}, full {@code id+reason} per row, no
 *       truncation; the frontend is responsible for the grouping presentation).</li>
 * </ul>
 *
 * <p>{@code id} is nullable because not every missing input kind has a stable
 * identifier (some "missing context" reasons are categorical rather than
 * referential).</p>
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19) --
 * {@code agent-os/specs/2026-05-19-migration-delivery-progress-and-evidence-tracking/spec.md}
 * -- Addition C, AC 8, AC 9. Task Group 2.</p>
 *
 * @param kind   The missing-input category (e.g. "Mapping", "Baseline",
 *               "Contract"). Source of grouping in the drawer.
 * @param id     Optional stable identifier for the missing entity (e.g. a
 *               mapping UUID); nullable per the persisted JSONB shape.
 * @param reason Free-text reason describing why the input is missing or
 *               insufficient. Rendered verbatim in the drawer with no
 *               truncation.
 */
public record MissingInputEntry(
    @JsonProperty("kind")
    String kind,

    @JsonProperty("id")
    String id,

    @JsonProperty("reason")
    String reason
) {}
