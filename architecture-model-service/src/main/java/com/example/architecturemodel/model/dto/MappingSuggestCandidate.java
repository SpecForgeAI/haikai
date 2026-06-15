package com.example.architecturemodel.model.dto;

/**
 * Single candidate current-architecture element returned by
 * {@code POST /api/projects/{projectId}/architectures/{archId}/mapping-suggest}.
 *
 * <p>AMS computes simple name-similarity candidates (substring + token
 * overlap). Confidence is a 0..1 score derived from the similarity heuristic;
 * gateway's LLM rerank may overwrite this value in the proxy layer.</p>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 4.</p>
 *
 * @param elementId    the current-arch element's row id on the supertype
 *                     table
 * @param elementType  one of {@code application_components} /
 *                     {@code interfaces} / {@code data_entity_points} /
 *                     {@code infrastructure_points}
 * @param name         human-readable name of the current element (for the
 *                     hint-chip UI)
 * @param confidence   0..1 similarity score; never null
 * @param rationale    one-sentence explanation suitable for the UI hint
 *                     tooltip (e.g. "Name exactly matches 'Orders Service'")
 */
public record MappingSuggestCandidate(
    String elementId,
    String elementType,
    String name,
    Double confidence,
    String rationale
) {
}
