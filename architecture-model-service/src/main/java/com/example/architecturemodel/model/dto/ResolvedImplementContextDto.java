package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.model.dto.diagram.ResolvedDiagramSummary;
import com.example.architecturemodel.model.dto.entity.ResolvedEntitySummary;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Data Transfer Object for resolved implement context.
 *
 * Contains lists of resolved entity and diagram summaries for a work item's
 * implement context. Used by the gateway to enrich LLM prompts with actual
 * entity details rather than raw IDs.
 *
 * Uses @JsonProperty annotations with snake_case for API serialization consistency.
 */
public record ResolvedImplementContextDto(
    @JsonProperty("resolved_entities")
    List<ResolvedEntitySummary> resolvedEntities,

    @JsonProperty("resolved_diagrams")
    List<ResolvedDiagramSummary> resolvedDiagrams
) {}
