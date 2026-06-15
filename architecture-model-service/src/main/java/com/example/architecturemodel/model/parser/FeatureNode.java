package com.example.architecturemodel.model.parser;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Intermediate model representing a Feature parsed from Book of Work markdown.
 *
 * Spec 2026-01-10: Upload Book of Work from Markdown
 * Task Group 1.3: Create FeatureNode following EpicNode pattern
 *
 * Used during parsing before conversion to WorkItemEntity.
 * Features are parsed from H4 (####) headings and contain Stories as children.
 *
 * Fields:
 * - title: The feature title (from #### heading)
 * - normalizedTitle: lowercase, whitespace-collapsed version for ID generation
 * - computedId: deterministic UUID based on project, parent epic, and normalized title
 * - description: text collected between headings
 * - sortOrder: appearance order in the markdown (0-indexed)
 * - stories: child Story items (from ##### headings)
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FeatureNode {

    /**
     * The title of the feature (from #### heading).
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
     * The deterministic UUID computed from projectId, parent epic's normalizedTitle, and this feature's normalizedTitle.
     * Key format: "work_item|{projectId}|FEATURE|{parentNormalizedTitle}|{normalizedTitle}"
     * Set by the parser during parsing.
     */
    private UUID computedId;

    /**
     * The description of the feature, containing text content under the feature heading.
     * May be null if no description text is provided.
     */
    private String description;

    /**
     * The sort order of this feature within its parent epic.
     * Based on appearance order in the markdown (0-indexed).
     */
    private int sortOrder;

    /**
     * The list of stories belonging to this feature.
     * May be empty if the feature has no stories defined.
     */
    @Builder.Default
    private List<StoryNode> stories = new ArrayList<>();
}
