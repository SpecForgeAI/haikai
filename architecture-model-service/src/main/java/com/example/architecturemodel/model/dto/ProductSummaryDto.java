package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Data Transfer Object for product summary.
 *
 * Contains a condensed hierarchical structure of the Product Book of Work:
 * Initiatives > Epics > Features (excluding Stories and detailed spec content).
 *
 * This summary is designed to be concise for LLM context windows while providing
 * sufficient product context for implementation planning.
 *
 * Spec: Implement Assistant Stage 3 - Bootstrap Phase
 */
public record ProductSummaryDto(
    @JsonProperty("initiatives")
    List<InitiativeSummary> initiatives
) {
    /**
     * Summary of an Initiative work item.
     * Contains nested Epics.
     */
    public record InitiativeSummary(
        @JsonProperty("id")
        String id,

        @JsonProperty("title")
        String title,

        @JsonProperty("description")
        String description,

        @JsonProperty("epics")
        List<EpicSummary> epics
    ) {}

    /**
     * Summary of an Epic work item.
     * Contains nested Features.
     */
    public record EpicSummary(
        @JsonProperty("id")
        String id,

        @JsonProperty("title")
        String title,

        @JsonProperty("description")
        String description,

        @JsonProperty("features")
        List<FeatureSummary> features
    ) {}

    /**
     * Summary of a Feature work item.
     * Does not contain Stories (excluded for conciseness).
     */
    public record FeatureSummary(
        @JsonProperty("id")
        String id,

        @JsonProperty("title")
        String title,

        @JsonProperty("description")
        String description
    ) {}
}
