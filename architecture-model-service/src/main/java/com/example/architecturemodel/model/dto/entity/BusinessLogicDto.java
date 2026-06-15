package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

/**
 * DTO for a {@code business_logics} row.
 *
 * <h2>Wire format</h2>
 *
 * <p>AMS speaks {@code snake_case} at the wire by default (the global
 * {@code spring.jackson.property-naming-strategy: SNAKE_CASE} in
 * {@code application.yml}). The explicit {@code @JsonProperty} declarations are
 * belt-and-braces and consistent with the surrounding DTOs. There is
 * intentionally NO {@code @CamelCaseWire} annotation -- the discovery-service
 * AMS client and the frontend's snake_case-typed API modules consume this in
 * {@code snake_case} (per CLAUDE.md).</p>
 *
 * <h2>Behaviour block</h2>
 *
 * <p>{@code behavior} is a passthrough JSON object ({@link Map}) carrying the
 * per-method 7-part structured behaviour block produced by the discovery
 * behaviour-capture stage and keyed by the stable method id Spec 1 stamps. It
 * is typed enough for the UI to render the 7 parts section-by-section, loose
 * enough that prose sub-fields are free text. The block embeds its own internal
 * {@code schema_version} + {@code source_hash}, and an embedded confidence
 * score that stays a boxed {@link Double} INSIDE the map shape the LLM emits --
 * never a top-level primitive (primitives silently wipe to 0 on missing JSON
 * during PATCH; see {@code project_primitive_double_dto_overwrite.md}). A
 * null/absent block round-trips cleanly.</p>
 *
 * <p>Spec: Business-logic behaviour capture for discovery
 * (2026-05-29) -- Task Group 1.</p>
 */
public record BusinessLogicDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("type_text")
    String typeText,

    @JsonProperty("description_md")
    String descriptionMd,

    @JsonProperty("tags")
    String tags,

    /**
     * Per-method 7-part structured behaviour block (passthrough JSON object).
     * Embeds {@code schema_version}, {@code source_hash}, and a boxed
     * {@link Double} confidence inside the map shape. snake_case wire key
     * {@code "behavior"}.
     */
    @JsonProperty("behavior")
    Map<String, Object> behavior,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo
) {}
