package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Upsert body for one structural-finding disposition row
 * ({@code PUT /api/projects/{projectId}/db-structural-finding-dispositions/{findingKey}}).
 * Snake_case wire per the AMS global default. EVERY field is nullable and
 * null-guarded in the service (per
 * {@code project_primitive_double_dto_overwrite.md}): on UPDATE an omitted
 * field leaves the column untouched (sparse merge); on CREATE the service
 * requires {@code disposition}, {@code kind} and {@code subject}.
 *
 * <p>Validation (service-enforced):</p>
 * <ul>
 *   <li>{@code disposition} must be one of
 *       {@code accepted | fix_upstream | known_gap} whenever supplied.</li>
 *   <li>{@code note} must be non-blank when the EFFECTIVE (post-merge)
 *       disposition is {@code accepted} or {@code known_gap}.</li>
 *   <li>{@code kind} / {@code subject} must be non-blank on CREATE.</li>
 * </ul>
 *
 * <p>Spec: Structural findings dispositions (2026-08-04) -- Spec 2.</p>
 *
 * @param disposition One of {@code accepted | fix_upstream | known_gap};
 *     required on create.
 * @param note Rationale; mandatory when the effective disposition is
 *     {@code accepted} or {@code known_gap}.
 * @param kind Finding kind (e.g. {@code no_primary_keys}); required on create.
 * @param subject Finding subject (e.g. {@code all_tables}); required on create.
 */
public record UpsertDbStructuralFindingDispositionRequest(
    @JsonProperty("disposition")
    String disposition,

    @JsonProperty("note")
    String note,

    @JsonProperty("kind")
    String kind,

    @JsonProperty("subject")
    String subject
) {}
