package com.example.architecturemodel.model.parser;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Intermediate model representing an Initiative parsed from roadmap markdown.
 *
 * Used during parsing before conversion to WorkItemEntity.
 * Contains child epics parsed from the initiative section.
 *
 * V3 additions:
 * - normalizedTitle: lowercase, whitespace-collapsed version for ID generation
 * - computedId: deterministic UUID based on project and normalized title
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InitiativeNode {

    /**
     * The title of the initiative (from ## heading).
     * Preserved as-is from the markdown for display purposes.
     */
    private String title;

    /**
     * The normalized title used for deterministic ID generation.
     * Computed as: trim + collapse whitespace + lowercase.
     * Set by the parser during v3+ parsing.
     */
    private String normalizedTitle;

    /**
     * The deterministic UUID computed from projectId and normalizedTitle.
     * Key format: "work_item|{projectId}|INITIATIVE|{normalizedTitle}"
     * Set by the parser during v3+ parsing.
     */
    private UUID computedId;

    /**
     * The sort order of this initiative in the roadmap.
     * Based on appearance order in the markdown (0-indexed).
     */
    private int sortOrder;

    /**
     * The list of epics belonging to this initiative.
     * May be empty if the initiative section contains no epics.
     */
    @Builder.Default
    private List<EpicNode> epics = new ArrayList<>();
}
