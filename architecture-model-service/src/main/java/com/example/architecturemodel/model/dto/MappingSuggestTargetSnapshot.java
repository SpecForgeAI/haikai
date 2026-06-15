package com.example.architecturemodel.model.dto;

/**
 * Lightweight snapshot of the target-side element the user is shaping when
 * the frontend requests mapping-suggest candidates. The fields are
 * intentionally minimal so the payload stays bounded -- AMS does not need any
 * other state to compute name-similarity candidates and the LLM rerank (in
 * gateway) only needs id+name+type per spec.md "bounded payload".
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 4.</p>
 *
 * @param name         the human-readable name the user typed for the target
 *                     element
 * @param elementType  one of {@code application_components} /
 *                     {@code interfaces} / {@code data_entity_points} /
 *                     {@code infrastructure_points}
 * @param description  optional one-liner; AMS does NOT consume this in v1
 */
public record MappingSuggestTargetSnapshot(
    String name,
    String elementType,
    String description
) {
}
