package com.example.architecturemodel.model.parser;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * Intermediate model representing a Story parsed from Book of Work markdown.
 *
 * Spec 2026-01-10: Upload Book of Work from Markdown
 * Task Group 1.3: Create StoryNode following EpicNode pattern
 *
 * Used during parsing before conversion to WorkItemEntity.
 * Stories are parsed from H5 (#####) headings and are leaf nodes in the hierarchy.
 *
 * Fields:
 * - title: The story title (from ##### heading)
 * - normalizedTitle: lowercase, whitespace-collapsed version for ID generation
 * - computedId: deterministic UUID based on project, parent feature, and normalized title
 * - description: text collected between headings
 * - sortOrder: appearance order in the markdown (0-indexed)
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StoryNode {

    /**
     * The title of the story (from ##### heading).
     * Preserved as-is from the markdown for display purposes.
     */
    private String title;

    /**
     * The normalized title used for deterministic ID generation.
     * Computed as: trim + collapse whitespace + lowercase.
     * Set by the parser during parsing.
     */
    private String normalizedTitle;

    /**
     * The deterministic UUID computed from projectId, parent feature's normalizedTitle, and this story's normalizedTitle.
     * Key format: "work_item|{projectId}|STORY|{parentNormalizedTitle}|{normalizedTitle}"
     * Set by the parser during parsing.
     */
    private UUID computedId;

    /**
     * The description of the story, containing text content under the story heading.
     * May be null if no description text is provided.
     */
    private String description;

    /**
     * The sort order of this story within its parent feature.
     * Based on appearance order in the markdown (0-indexed).
     */
    private int sortOrder;
}
