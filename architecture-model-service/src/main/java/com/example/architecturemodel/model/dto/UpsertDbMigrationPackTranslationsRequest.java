package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Request body for the bulk upsert-by-{@code translation_key} of a pack's
 * translation rows -- the seeding / regeneration re-link surface used by the
 * gateway translation pipeline. Snake_case wire per the AMS global default.
 *
 * <p>Semantics (per row, matched by {@code translation_key}):</p>
 * <ul>
 *   <li>Existing row -> ONLY the non-null caller-supplied fields are applied
 *       (sparse merge); omitted fields -- draft, verdict, disposition, review
 *       lifecycle -- are preserved verbatim. The demote-on-source-change
 *       policy is computed by the GATEWAY, which supplies the demoted
 *       {@code review_status} + appended note explicitly.</li>
 *   <li>Unknown key -> a new row inserts with the entity defaults
 *       ({@code translate} / {@code pending} / {@code unreviewed}) overlaid
 *       with the supplied fields.</li>
 *   <li>{@code delete_absent: true} -> rows for the pack whose
 *       {@code translation_key} is NOT in this batch are deleted
 *       (deterministic removal of manifest-dropped objects).</li>
 * </ul>
 *
 * <p>Spec: LLM-Assisted DB Object Translation Drafts (2026-06-11) --
 * Task Group 2.</p>
 *
 * @param translations The translation rows to upsert (matched by
 *     {@code translation_key}; non-blank, unique within the batch).
 * @param deleteAbsent When {@code true}, delete the pack's rows whose key is
 *     absent from this batch. Boxed Boolean -- omitted means {@code false}.
 */
public record UpsertDbMigrationPackTranslationsRequest(
    @JsonProperty("translations")
    List<DbMigrationPackTranslationDto> translations,

    @JsonProperty("delete_absent")
    Boolean deleteAbsent
) {}
