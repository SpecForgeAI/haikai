package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Data Transfer Object for a resolved diagram summary.
 *
 * Contains compact summary information about a diagram,
 * suitable for inclusion in LLM context for implementation planning.
 *
 * Uses @JsonProperty annotations with snake_case for API serialization consistency.
 *
 * Spec 2026-01-14: Implement Assistant Stage 4 - Feature-Specific Context Highlighting
 * Added referencedEntityNames field for human-readable entity names in highlighted context.
 */
public record ResolvedDiagramSummary(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("diagram_type")
    String diagramType,

    @JsonProperty("referenced_entity_ids")
    List<String> referencedEntityIds,

    /**
     * Human-readable names of referenced entities, resolved from referencedEntityIds.
     * Contains only successfully resolved names; IDs that fail resolution are excluded.
     * May be null or empty if no names could be resolved.
     *
     * Stage 4: Used in "HIGHLIGHTED FEATURE CONTEXT" section for LLM prompt.
     */
    @JsonProperty("referenced_entity_names")
    List<String> referencedEntityNames
) {
    /**
     * Constructor for backward compatibility when entity names are not yet resolved.
     * Creates a summary with null referencedEntityNames.
     */
    public ResolvedDiagramSummary(String id, String name, String diagramType, List<String> referencedEntityIds) {
        this(id, name, diagramType, referencedEntityIds, null);
    }
}
